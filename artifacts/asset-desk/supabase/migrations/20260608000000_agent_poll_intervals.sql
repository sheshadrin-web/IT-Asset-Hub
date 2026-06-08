-- ============================================================================
-- Server-driven agent polling intervals
--
-- Goal: let an admin retune how often installed device agents poll — once, from
-- the portal/DB — and have every agent pick it up automatically on its next
-- heavy /sync, with NO reinstall, restart, or environment change.
--
-- How it works:
--   * Two columns on the org_settings singleton hold the active/idle cadences.
--   * agent_sync (the heartbeat the agent already calls every SYNC_INTERVAL_SEC)
--     now returns them under a `poll` object. The agent-api edge function passes
--     the RPC result through verbatim, so no edge-function change is needed.
--   * The agent clamps the values and applies them live to its adaptive loop.
--
-- Defaults match the agent's built-in defaults: 5s active, 30s idle.
-- ============================================================================

-- 1. Settings columns (singleton row). Bounds mirror the agent-side clamp so a
--    bad value can never be persisted in the first place.
ALTER TABLE public.org_settings
  ADD COLUMN IF NOT EXISTS agent_active_poll_sec integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS agent_idle_poll_sec   integer NOT NULL DEFAULT 30;

ALTER TABLE public.org_settings DROP CONSTRAINT IF EXISTS org_settings_agent_poll_bounds;
ALTER TABLE public.org_settings ADD CONSTRAINT org_settings_agent_poll_bounds CHECK (
  agent_active_poll_sec BETWEEN 2 AND 3600
  AND agent_idle_poll_sec BETWEEN 2 AND 3600
  AND agent_idle_poll_sec >= agent_active_poll_sec
);

-- 2. Surface the cadence on the heartbeat. CREATE OR REPLACE keeps the rest of
--    agent_sync identical to the device-restart migration; only the trailing
--    SELECT + the `poll` object in the return are new. Registration and command
--    processing are untouched.
CREATE OR REPLACE FUNCTION public.agent_sync(
  p_token   text,
  p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset_id uuid;
  v_dev_id   uuid;
  v_locked   boolean := false;
  v_active   integer := 5;
  v_idle     integer := 30;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;

  SELECT id INTO v_dev_id FROM public.managed_devices WHERE laptop_asset_id = v_asset_id;
  IF v_dev_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'device not registered');
  END IF;

  UPDATE public.managed_devices SET
    hostname = COALESCE(p_payload->>'hostname', hostname),
    processor = COALESCE(p_payload->>'processor', processor),
    ram = COALESCE(p_payload->>'ram', ram),
    storage = COALESCE(p_payload->>'storage', storage),
    os_name = COALESCE(p_payload->>'os_name', os_name),
    os_version = COALESCE(p_payload->>'os_version', os_version),
    logged_in_username = COALESCE(p_payload->>'logged_in_username', logged_in_username),
    ip_address = COALESCE(p_payload->>'ip_address', ip_address),
    mac_address = COALESCE(p_payload->>'mac_address', mac_address),
    agent_version = COALESCE(p_payload->>'agent_version', agent_version),
    uptime_seconds = COALESCE((p_payload->>'uptime_seconds')::bigint, uptime_seconds),
    last_boot_at = COALESCE((p_payload->>'last_boot_at')::timestamptz, last_boot_at),
    status = 'online', last_seen_at = now(), updated_at = now()
  WHERE id = v_dev_id
  RETURNING is_locked INTO v_locked;

  INSERT INTO public.device_sync_logs (managed_device_id, sync_payload, sync_status, ip_address)
  VALUES (v_dev_id, p_payload, 'ok', p_payload->>'ip_address');

  -- Server-driven poll cadence (falls back to 5/30 if no settings row exists).
  SELECT agent_active_poll_sec, agent_idle_poll_sec
    INTO v_active, v_idle
    FROM public.org_settings WHERE id = true;
  v_active := COALESCE(v_active, 5);
  v_idle   := COALESCE(v_idle, 30);

  RETURN jsonb_build_object(
    'success', true,
    'device_id', v_dev_id,
    'locked', COALESCE(v_locked, false),
    'poll', jsonb_build_object('active', v_active, 'idle', v_idle)
  );
END $$;

-- 3. Extend save_org_settings with the two new params (appended, defaulted so the
--    call site stays backward-compatible). Drop the 10-arg signature and replace.
DROP FUNCTION IF EXISTS public.save_org_settings(
  text, text, boolean, boolean, boolean, boolean, boolean, integer, text, text
);

CREATE OR REPLACE FUNCTION public.save_org_settings(
  p_org_name              text,
  p_support_email         text,
  p_email_notifications   boolean,
  p_ticket_assignment     boolean,
  p_status_updates        boolean,
  p_warranty_alerts       boolean,
  p_two_factor            boolean,
  p_session_timeout       integer,
  p_timezone              text,
  p_date_format           text,
  p_agent_active_poll_sec integer DEFAULT 5,
  p_agent_idle_poll_sec   integer DEFAULT 30
)
RETURNS public.org_settings LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.org_settings;
  v_active integer := COALESCE(p_agent_active_poll_sec, 5);
  v_idle   integer := COALESCE(p_agent_idle_poll_sec, 30);
BEGIN
  IF NOT public._is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  IF p_session_timeout IS NULL OR p_session_timeout < 5 OR p_session_timeout > 480 THEN
    RAISE EXCEPTION 'session_timeout must be between 5 and 480 minutes';
  END IF;
  IF v_active < 2 OR v_active > 3600 THEN
    RAISE EXCEPTION 'agent_active_poll_sec must be between 2 and 3600 seconds';
  END IF;
  IF v_idle < 2 OR v_idle > 3600 THEN
    RAISE EXCEPTION 'agent_idle_poll_sec must be between 2 and 3600 seconds';
  END IF;
  IF v_idle < v_active THEN
    RAISE EXCEPTION 'agent_idle_poll_sec must be >= agent_active_poll_sec';
  END IF;

  UPDATE public.org_settings SET
    org_name              = p_org_name,
    support_email         = p_support_email,
    email_notifications   = p_email_notifications,
    ticket_assignment     = p_ticket_assignment,
    status_updates        = p_status_updates,
    warranty_alerts       = p_warranty_alerts,
    two_factor            = p_two_factor,
    session_timeout       = p_session_timeout,
    timezone              = COALESCE(p_timezone, timezone),
    date_format           = COALESCE(p_date_format, date_format),
    agent_active_poll_sec = v_active,
    agent_idle_poll_sec   = v_idle,
    updated_at            = now(),
    updated_by            = v_uid
  WHERE id = true
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    INSERT INTO public.org_settings (
      id, org_name, support_email, email_notifications, ticket_assignment,
      status_updates, warranty_alerts, two_factor, session_timeout,
      timezone, date_format, agent_active_poll_sec, agent_idle_poll_sec,
      updated_at, updated_by
    ) VALUES (
      true, p_org_name, p_support_email, p_email_notifications, p_ticket_assignment,
      p_status_updates, p_warranty_alerts, p_two_factor, p_session_timeout,
      COALESCE(p_timezone, 'Asia/Kolkata'), COALESCE(p_date_format, 'DD MMM YYYY'),
      v_active, v_idle, now(), v_uid
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.save_org_settings(
  text, text, boolean, boolean, boolean, boolean, boolean, integer, text, text, integer, integer
) TO authenticated;
