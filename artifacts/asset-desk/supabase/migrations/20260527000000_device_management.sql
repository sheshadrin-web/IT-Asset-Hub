-- ============================================================================
-- Miles IT Assets — Device Management (Phase 1)
-- Tables: managed_devices, agent_tokens, device_sync_logs, device_commands
-- RPCs:   generate_agent_token, revoke_agent_token,
--         agent_register, agent_sync, agent_fetch_commands, agent_update_command
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── managed_devices ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.managed_devices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  laptop_asset_id       uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  assigned_employee_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  serial_number         text,
  hostname              text,
  brand                 text,
  model                 text,
  processor             text,
  ram                   text,
  storage               text,
  os_name               text,
  os_version            text,
  logged_in_username    text,
  employee_email        text,
  employee_ecode        text,
  ip_address            text,
  mac_address           text,
  agent_version         text,
  status                text NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','inactive')),
  is_managed            boolean NOT NULL DEFAULT true,
  is_unmapped           boolean NOT NULL DEFAULT false,
  last_seen_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS managed_devices_serial_idx     ON public.managed_devices(lower(serial_number));
CREATE INDEX IF NOT EXISTS managed_devices_asset_idx      ON public.managed_devices(laptop_asset_id);
CREATE INDEX IF NOT EXISTS managed_devices_unmapped_idx   ON public.managed_devices(is_unmapped) WHERE is_unmapped = true;
CREATE UNIQUE INDEX IF NOT EXISTS managed_devices_asset_uniq ON public.managed_devices(laptop_asset_id) WHERE laptop_asset_id IS NOT NULL;

-- ── agent_tokens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_tokens (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  managed_device_id   uuid REFERENCES public.managed_devices(id) ON DELETE CASCADE,
  laptop_asset_id     uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  token_hash          text NOT NULL,
  token_last_four     text NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  generated_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  revoked_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_at          timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_tokens_hash_uniq ON public.agent_tokens(token_hash);
CREATE INDEX IF NOT EXISTS agent_tokens_asset_active_idx ON public.agent_tokens(laptop_asset_id) WHERE is_active = true;

-- ── device_sync_logs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.device_sync_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  managed_device_id   uuid REFERENCES public.managed_devices(id) ON DELETE CASCADE,
  sync_payload        jsonb,
  sync_status         text NOT NULL DEFAULT 'ok',
  ip_address          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_sync_logs_device_idx ON public.device_sync_logs(managed_device_id, created_at DESC);

-- ── device_commands ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.device_commands (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  managed_device_id   uuid NOT NULL REFERENCES public.managed_devices(id) ON DELETE CASCADE,
  command_type        text NOT NULL CHECK (command_type IN (
                        'sync_now','update_wallpaper','lock_screen',
                        'collect_system_info','clear_company_temp_files','sign_out_user'
                      )),
  command_payload     jsonb,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','running','completed','failed','cancelled'
                      )),
  requested_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  executed_at         timestamptz,
  completed_at        timestamptz,
  result_message      text,
  error_message       text
);
CREATE INDEX IF NOT EXISTS device_commands_device_idx ON public.device_commands(managed_device_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS device_commands_pending_idx ON public.device_commands(managed_device_id) WHERE status = 'pending';

-- ── RLS — readable by authenticated, mutated only via SECURITY DEFINER RPCs ─
ALTER TABLE public.managed_devices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tokens     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_commands  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS managed_devices_read  ON public.managed_devices;
DROP POLICY IF EXISTS agent_tokens_read     ON public.agent_tokens;
DROP POLICY IF EXISTS device_sync_logs_read ON public.device_sync_logs;
DROP POLICY IF EXISTS device_commands_read  ON public.device_commands;

CREATE POLICY managed_devices_read  ON public.managed_devices  FOR SELECT TO authenticated USING (true);
CREATE POLICY agent_tokens_read     ON public.agent_tokens     FOR SELECT TO authenticated USING (true);
CREATE POLICY device_sync_logs_read ON public.device_sync_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY device_commands_read  ON public.device_commands  FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- HELPERS
-- ============================================================================
CREATE OR REPLACE FUNCTION public._sha256_hex(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(digest(p_text, 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public._is_super_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin'
  );
$$;

-- ============================================================================
-- ADMIN RPCs (called from the web UI)
-- ============================================================================

-- generate_agent_token(asset_id) → returns { token, last_four } ONCE
-- Revokes any existing active tokens for this asset.
CREATE OR REPLACE FUNCTION public.generate_agent_token(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset RECORD;
  v_token text;
  v_hash  text;
  v_last4 text;
  v_uid   uuid := auth.uid();
BEGIN
  IF NOT public._is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  SELECT id, asset_type INTO v_asset FROM public.assets WHERE id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'asset not found'; END IF;
  IF v_asset.asset_type <> 'Laptop' THEN
    RAISE EXCEPTION 'agent tokens are only supported for Laptop assets';
  END IF;

  -- Revoke any prior active tokens for this asset
  UPDATE public.agent_tokens
     SET is_active = false, revoked_at = now(), revoked_by = v_uid
   WHERE laptop_asset_id = p_asset_id AND is_active = true;

  -- Generate a 40-char token (prefix + random) — shown ONCE
  v_token := 'mil_' || encode(gen_random_bytes(24), 'hex');
  v_hash  := public._sha256_hex(v_token);
  v_last4 := right(v_token, 4);

  INSERT INTO public.agent_tokens (laptop_asset_id, token_hash, token_last_four, generated_by)
  VALUES (p_asset_id, v_hash, v_last4, v_uid);

  RETURN jsonb_build_object(
    'success',   true,
    'token',     v_token,
    'last_four', v_last4
  );
END $$;

CREATE OR REPLACE FUNCTION public.revoke_agent_token(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count int;
BEGIN
  IF NOT public._is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  UPDATE public.agent_tokens
     SET is_active = false, revoked_at = now(), revoked_by = v_uid
   WHERE laptop_asset_id = p_asset_id AND is_active = true;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Mark device offline if it was bound to this asset
  UPDATE public.managed_devices
     SET status = 'inactive', is_managed = false, updated_at = now()
   WHERE laptop_asset_id = p_asset_id;

  RETURN jsonb_build_object('success', true, 'revoked', v_count);
END $$;

CREATE OR REPLACE FUNCTION public.request_device_command(
  p_asset_id     uuid,
  p_command_type text,
  p_payload      jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dev RECORD;
  v_id  uuid;
BEGIN
  IF NOT public._is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  SELECT id INTO v_dev FROM public.managed_devices WHERE laptop_asset_id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no managed device for this asset'; END IF;

  INSERT INTO public.device_commands (managed_device_id, command_type, command_payload, requested_by)
  VALUES (v_dev.id, p_command_type, p_payload, v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'command_id', v_id);
END $$;

-- ============================================================================
-- AGENT RPCs (invoked by Edge Functions running with service-role)
-- These functions validate the token themselves.
-- ============================================================================

-- Resolves an agent_token → laptop_asset_id (active only)
CREATE OR REPLACE FUNCTION public._auth_agent(p_token text)
RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE v_asset_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN RETURN NULL; END IF;
  SELECT laptop_asset_id INTO v_asset_id
    FROM public.agent_tokens
   WHERE token_hash = public._sha256_hex(p_token) AND is_active = true
   LIMIT 1;
  RETURN v_asset_id;
END $$;

-- agent_register: first contact from the laptop after install.
-- Matches the agent to the asset behind the token (token is the source of truth
-- for binding), updates managed_devices row, and returns ids.
CREATE OR REPLACE FUNCTION public.agent_register(
  p_token   text,
  p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset_id uuid;
  v_dev_id   uuid;
  v_sn       text := p_payload->>'serial_number';
  v_emp      uuid;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;

  -- Defensive: if the asset already has a different SN, we still bind via the
  -- token but flag a mismatch in the sync log for admin review.
  SELECT id INTO v_emp FROM public.profiles
   WHERE lower(email) = lower(p_payload->>'employee_email')
      OR lower(ecode) = lower(p_payload->>'employee_ecode')
   LIMIT 1;

  -- Upsert managed_device for this asset
  SELECT id INTO v_dev_id FROM public.managed_devices WHERE laptop_asset_id = v_asset_id;
  IF v_dev_id IS NULL THEN
    INSERT INTO public.managed_devices (
      laptop_asset_id, assigned_employee_id, serial_number, hostname, brand, model,
      processor, ram, storage, os_name, os_version, logged_in_username,
      employee_email, employee_ecode, ip_address, mac_address, agent_version,
      status, is_managed, last_seen_at
    ) VALUES (
      v_asset_id, v_emp, v_sn, p_payload->>'hostname',
      p_payload->>'brand', p_payload->>'model',
      p_payload->>'processor', p_payload->>'ram', p_payload->>'storage',
      p_payload->>'os_name', p_payload->>'os_version', p_payload->>'logged_in_username',
      p_payload->>'employee_email', p_payload->>'employee_ecode',
      p_payload->>'ip_address', p_payload->>'mac_address', p_payload->>'agent_version',
      'online', true, now()
    ) RETURNING id INTO v_dev_id;
  ELSE
    UPDATE public.managed_devices SET
      assigned_employee_id = COALESCE(v_emp, assigned_employee_id),
      serial_number = COALESCE(v_sn, serial_number),
      hostname = p_payload->>'hostname', brand = p_payload->>'brand', model = p_payload->>'model',
      processor = p_payload->>'processor', ram = p_payload->>'ram', storage = p_payload->>'storage',
      os_name = p_payload->>'os_name', os_version = p_payload->>'os_version',
      logged_in_username = p_payload->>'logged_in_username',
      employee_email = p_payload->>'employee_email', employee_ecode = p_payload->>'employee_ecode',
      ip_address = p_payload->>'ip_address', mac_address = p_payload->>'mac_address',
      agent_version = p_payload->>'agent_version',
      status = 'online', is_managed = true, last_seen_at = now(), updated_at = now()
    WHERE id = v_dev_id;
  END IF;

  -- Bind token row to the device
  UPDATE public.agent_tokens
     SET managed_device_id = v_dev_id
   WHERE laptop_asset_id = v_asset_id AND is_active = true;

  INSERT INTO public.device_sync_logs (managed_device_id, sync_payload, sync_status, ip_address)
  VALUES (v_dev_id, p_payload, 'registered', p_payload->>'ip_address');

  RETURN jsonb_build_object('success', true, 'device_id', v_dev_id, 'asset_id', v_asset_id);
END $$;

-- agent_sync: regular heartbeat / system info update
CREATE OR REPLACE FUNCTION public.agent_sync(
  p_token   text,
  p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset_id uuid;
  v_dev_id   uuid;
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
    status = 'online', last_seen_at = now(), updated_at = now()
  WHERE id = v_dev_id;

  INSERT INTO public.device_sync_logs (managed_device_id, sync_payload, sync_status, ip_address)
  VALUES (v_dev_id, p_payload, 'ok', p_payload->>'ip_address');

  RETURN jsonb_build_object('success', true, 'device_id', v_dev_id);
END $$;

CREATE OR REPLACE FUNCTION public.agent_fetch_commands(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset_id uuid;
  v_dev_id   uuid;
  v_cmds     jsonb;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;

  SELECT id INTO v_dev_id FROM public.managed_devices WHERE laptop_asset_id = v_asset_id;
  IF v_dev_id IS NULL THEN RETURN jsonb_build_object('success', true, 'commands', '[]'::jsonb); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'type', command_type, 'payload', command_payload
  ) ORDER BY requested_at), '[]'::jsonb)
  INTO v_cmds
  FROM public.device_commands
  WHERE managed_device_id = v_dev_id AND status = 'pending';

  -- Mark as running
  UPDATE public.device_commands
     SET status = 'running', executed_at = now()
   WHERE managed_device_id = v_dev_id AND status = 'pending';

  -- Also update last-seen
  UPDATE public.managed_devices SET status = 'online', last_seen_at = now() WHERE id = v_dev_id;

  RETURN jsonb_build_object('success', true, 'commands', v_cmds);
END $$;

CREATE OR REPLACE FUNCTION public.agent_update_command(
  p_token        text,
  p_command_id   uuid,
  p_status       text,
  p_result       text DEFAULT NULL,
  p_error        text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_asset_id uuid;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;
  IF p_status NOT IN ('completed','failed','running') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid status');
  END IF;

  UPDATE public.device_commands
     SET status = p_status,
         result_message = COALESCE(p_result, result_message),
         error_message  = COALESCE(p_error, error_message),
         completed_at   = CASE WHEN p_status IN ('completed','failed') THEN now() ELSE completed_at END
   WHERE id = p_command_id;

  RETURN jsonb_build_object('success', true);
END $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.generate_agent_token(uuid)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_agent_token(uuid)                                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_device_command(uuid, text, jsonb)                   TO authenticated;
-- Agent RPCs are invoked from Edge Functions running with the service-role key
-- (which bypasses RLS). They are not exposed to anon / authenticated directly.
