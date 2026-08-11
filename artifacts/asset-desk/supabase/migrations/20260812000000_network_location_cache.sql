-- Phase 1 network location scalability:
-- one shared provider result per public IP, a 24-hour freshness TTL, and
-- bounded retry backoff. This migration is local and intentionally unapplied.

CREATE TABLE IF NOT EXISTS public.network_location_cache (
  public_ip              text PRIMARY KEY,
  city                   text,
  region                 text,
  postal_code            text,
  country                text,
  latitude               numeric(9,6),
  longitude              numeric(9,6),
  accuracy_m             numeric,
  provider               text,
  captured_at            timestamptz,
  expires_at             timestamptz,
  failure_count          integer NOT NULL DEFAULT 0,
  retry_after            timestamptz,
  lookup_claimed_until   timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT network_location_cache_ip_not_blank CHECK (length(trim(public_ip)) > 0),
  CONSTRAINT network_location_cache_coords CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  ),
  CONSTRAINT network_location_cache_accuracy CHECK (accuracy_m IS NULL OR accuracy_m >= 0)
);

CREATE INDEX IF NOT EXISTS network_location_cache_expiry_idx
  ON public.network_location_cache(expires_at);

ALTER TABLE public.network_location_cache ENABLE ROW LEVEL SECURITY;

-- Agents never access this table directly. The SECURITY DEFINER RPCs below
-- validate the agent token and service-role Edge Function performs the lookup.
REVOKE ALL ON public.network_location_cache FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.agent_prepare_network_location(
  p_token text,
  p_public_ip text,
  p_ttl_seconds integer DEFAULT 86400
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset_id uuid;
  v_row public.network_location_cache;
  v_ttl integer := LEAST(GREATEST(COALESCE(p_ttl_seconds, 86400), 3600), 604800);
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'invalid token');
  END IF;
  IF p_public_ip IS NULL OR length(trim(p_public_ip)) = 0 THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'invalid request');
  END IF;

  INSERT INTO public.network_location_cache (public_ip)
    VALUES (trim(p_public_ip))
    ON CONFLICT (public_ip) DO NOTHING;
  SELECT * INTO v_row FROM public.network_location_cache
    WHERE public_ip = trim(p_public_ip) FOR UPDATE;

  IF v_row.captured_at IS NOT NULL AND v_row.expires_at > now() THEN
    RETURN jsonb_build_object(
      'action', 'cache',
      'location', jsonb_build_object(
        'source', 'network', 'city', v_row.city, 'region', v_row.region,
        'postal_code', v_row.postal_code, 'country', v_row.country,
        'public_ip', v_row.public_ip, 'latitude', v_row.latitude,
        'longitude', v_row.longitude, 'accuracy_m', v_row.accuracy_m,
        'captured_at', v_row.captured_at
      )
    );
  END IF;

  -- A failed provider result gets an exponential, bounded retry delay.
  IF v_row.retry_after IS NOT NULL AND v_row.retry_after > now() THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'provider backoff');
  END IF;

  -- Claim the IP briefly so concurrent devices sharing this IP reuse the
  -- first provider result instead of issuing duplicate calls.
  IF v_row.lookup_claimed_until IS NOT NULL AND v_row.lookup_claimed_until > now() THEN
    RETURN jsonb_build_object('action', 'skip', 'reason', 'lookup in progress');
  END IF;
  UPDATE public.network_location_cache SET
    lookup_claimed_until = now() + interval '30 seconds',
    updated_at = now()
  WHERE public_ip = trim(p_public_ip);
  RETURN jsonb_build_object('action', 'lookup');
END $$;

CREATE OR REPLACE FUNCTION public.agent_record_network_location(
  p_token text,
  p_public_ip text,
  p_location jsonb DEFAULT NULL,
  p_provider text DEFAULT 'ipwho.is',
  p_success boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset_id uuid;
  v_lat numeric;
  v_lon numeric;
  v_acc numeric;
  v_captured timestamptz;
  v_source text;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL OR p_public_ip IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid agent or IP');
  END IF;
  IF NOT p_success THEN
    INSERT INTO public.network_location_cache (
      public_ip, failure_count, retry_after, lookup_claimed_until, updated_at
    ) VALUES (
      trim(p_public_ip), 1, now() + interval '15 minutes', NULL, now()
    )
    ON CONFLICT (public_ip) DO UPDATE SET
      failure_count = LEAST(public.network_location_cache.failure_count + 1, 8),
      retry_after = now() + make_interval(
        mins => LEAST(15 * power(2, public.network_location_cache.failure_count)::integer, 360)
      ),
      lookup_claimed_until = NULL,
      updated_at = now();
    RETURN jsonb_build_object('success', true, 'preserved', true);
  END IF;

  v_source := p_location->>'source';
  BEGIN
    v_lat := (p_location->>'latitude')::numeric;
    v_lon := (p_location->>'longitude')::numeric;
    v_acc := (p_location->>'accuracy_m')::numeric;
    v_captured := (p_location->>'captured_at')::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('success', false, 'error', 'malformed location');
  END;
  IF v_source <> 'network' OR v_lat IS NULL OR v_lat NOT BETWEEN -90 AND 90
     OR v_lon IS NULL OR v_lon NOT BETWEEN -180 AND 180
     OR v_acc IS NULL OR v_acc < 0 OR v_captured IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid location');
  END IF;

  INSERT INTO public.network_location_cache (
    public_ip, city, region, postal_code, country, latitude, longitude,
    accuracy_m, provider, captured_at, expires_at, failure_count,
    retry_after, lookup_claimed_until, updated_at
  ) VALUES (
    trim(p_public_ip), left(p_location->>'city', 160), left(p_location->>'region', 160),
    left(p_location->>'postal_code', 40), left(p_location->>'country', 160),
    v_lat, v_lon, v_acc, left(p_provider, 80), v_captured, now() + interval '24 hours',
    0, NULL, NULL, now()
  )
  ON CONFLICT (public_ip) DO UPDATE SET
    city = EXCLUDED.city, region = EXCLUDED.region, postal_code = EXCLUDED.postal_code,
    country = EXCLUDED.country, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
    accuracy_m = EXCLUDED.accuracy_m, provider = EXCLUDED.provider,
    captured_at = EXCLUDED.captured_at, expires_at = EXCLUDED.expires_at,
    failure_count = 0, retry_after = NULL, lookup_claimed_until = NULL, updated_at = now();
  RETURN jsonb_build_object('success', true, 'location', p_location);
END $$;