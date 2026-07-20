-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011: Multi-organisation support for hr_integrations
--
-- Allows multiple Zoho People organisations to be connected simultaneously.
-- Each row is now uniquely identified by (organization_id, provider_type,
-- organization_name) instead of the old (organization_id, provider_type).
--
-- Apply via: Supabase Dashboard → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add organisation_name column (empty string = legacy single-org rows)
ALTER TABLE hr_integrations
  ADD COLUMN IF NOT EXISTS organization_name text NOT NULL DEFAULT '';

-- 2. Drop old unique constraint (provider_type was unique per org_id)
ALTER TABLE hr_integrations
  DROP CONSTRAINT IF EXISTS hr_integrations_organization_id_provider_type_key;

-- 3. New constraint: allow many rows per provider as long as org_name differs
ALTER TABLE hr_integrations
  ADD CONSTRAINT hr_integrations_org_provider_name_key
  UNIQUE (organization_id, provider_type, organization_name);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Replace get_hr_integrations — now returns organization_name
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_hr_integrations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- Resolve the calling user's organisation
  SELECT organization_id INTO v_org_id
  FROM user_profiles WHERE id = auth.uid();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',                i.id,
        'provider_type',     i.provider_type,
        'provider_name',     i.provider_name,
        'organization_name', COALESCE(i.organization_name, ''),
        'status',            i.status,
        'api_base_url',      i.api_base_url,
        'auto_sync_enabled', i.auto_sync_enabled,
        'sync_frequency',    i.sync_frequency,
        'last_sync_at',      i.last_sync_at,
        'last_tested_at',    i.last_tested_at,
        'last_error',        i.last_error,
        'credentials_set',   (i.credentials_encrypted IS NOT NULL AND i.credentials_encrypted != '{}'::jsonb),
        'updated_at',        i.updated_at
      ) ORDER BY i.provider_type, i.organization_name
    ), '[]'::jsonb)
    FROM hr_integrations i
    WHERE i.organization_id = v_org_id
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Replace save_hr_integration — accepts organization_name + existing_id
--    existing_id: when set, update that specific row (multi-org edit)
--    otherwise:   upsert by (provider_type, organization_name)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION save_hr_integration(
  p_provider_type     text,
  p_provider_name     text,
  p_organization_name text    DEFAULT '',
  p_api_base_url      text    DEFAULT NULL,
  p_credentials       jsonb   DEFAULT '{}',
  p_auto_sync         boolean DEFAULT true,
  p_frequency         text    DEFAULT 'daily',
  p_existing_id       uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id       uuid;
  v_role         text;
  v_row          hr_integrations;
  v_merged_creds jsonb;
BEGIN
  SELECT organization_id, role INTO v_org_id, v_role
  FROM user_profiles WHERE id = auth.uid();

  IF v_org_id IS NULL OR v_role NOT IN ('super_admin', 'it_admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Merge credentials: keep existing secrets for keys not supplied
  IF p_existing_id IS NOT NULL THEN
    SELECT credentials_encrypted INTO v_merged_creds
    FROM hr_integrations
    WHERE id = p_existing_id AND organization_id = v_org_id;
  ELSE
    SELECT credentials_encrypted INTO v_merged_creds
    FROM hr_integrations
    WHERE organization_id = v_org_id
      AND provider_type = p_provider_type
      AND organization_name = p_organization_name;
  END IF;

  v_merged_creds := COALESCE(v_merged_creds, '{}'::jsonb);

  -- Overlay new non-empty values from caller
  SELECT v_merged_creds || jsonb_object_agg(k, v)
  INTO v_merged_creds
  FROM jsonb_each_text(p_credentials) AS kv(k, v)
  WHERE v IS NOT NULL AND v <> '';

  IF p_existing_id IS NOT NULL THEN
    -- Update specific row
    UPDATE hr_integrations SET
      provider_name        = p_provider_name,
      organization_name    = p_organization_name,
      api_base_url         = p_api_base_url,
      credentials_encrypted = v_merged_creds,
      auto_sync_enabled    = p_auto_sync,
      sync_frequency       = p_frequency,
      status               = CASE WHEN jsonb_typeof(v_merged_creds) = 'object'
                                    AND v_merged_creds <> '{}'::jsonb
                                  THEN 'connected'::integration_status
                                  ELSE status END,
      updated_at           = now()
    WHERE id = p_existing_id AND organization_id = v_org_id
    RETURNING * INTO v_row;
  ELSE
    -- Upsert by (provider_type, organization_name)
    INSERT INTO hr_integrations (
      organization_id, provider_type, provider_name, organization_name,
      api_base_url, credentials_encrypted, auto_sync_enabled,
      sync_frequency, status
    ) VALUES (
      v_org_id, p_provider_type, p_provider_name, p_organization_name,
      p_api_base_url, v_merged_creds, p_auto_sync,
      p_frequency,
      CASE WHEN v_merged_creds <> '{}'::jsonb
           THEN 'connected'::integration_status
           ELSE 'not_connected'::integration_status END
    )
    ON CONFLICT (organization_id, provider_type, organization_name)
    DO UPDATE SET
      provider_name         = EXCLUDED.provider_name,
      api_base_url          = EXCLUDED.api_base_url,
      credentials_encrypted = EXCLUDED.credentials_encrypted,
      auto_sync_enabled     = EXCLUDED.auto_sync_enabled,
      sync_frequency        = EXCLUDED.sync_frequency,
      status                = EXCLUDED.status,
      updated_at            = now()
    RETURNING * INTO v_row;
  END IF;

  RETURN get_hr_integrations();
END;
$$;

GRANT EXECUTE ON FUNCTION get_hr_integrations() TO authenticated;
GRANT EXECUTE ON FUNCTION save_hr_integration(text,text,text,text,jsonb,boolean,text,uuid) TO authenticated;
