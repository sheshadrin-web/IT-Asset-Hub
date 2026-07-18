-- ============================================================================
-- Device remote lock (soft, persistent, non-destructive)
--
-- Lets a super_admin lock an offboarded employee's laptop so the end user can
-- no longer use it, WITHOUT erasing any data. The agent enforces a full-screen
-- lockout that re-applies after reboot (state persisted both server-side here
-- and locally on the device). IT can unlock at any time to re-grant access.
--
-- Delivery reuses the existing command queue + the agent's /sync response:
--   * managed_devices.is_locked is the durable source of truth.
--   * agent_sync() returns it every heartbeat -> the agent enforces continuously
--     and on boot (covers offline reboots via local persistence).
--   * lock_device / unlock_device also enqueue an immediate lock_screen / unlock
--     command for fast response between heartbeats.
-- ============================================================================

ALTER TABLE public.managed_devices
  ADD COLUMN IF NOT EXISTS is_locked   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lock_reason text;

-- Allow the 'unlock' command type (lock_screen already exists).
ALTER TABLE public.device_commands DROP CONSTRAINT IF EXISTS device_commands_command_type_check;
ALTER TABLE public.device_commands ADD CONSTRAINT device_commands_command_type_check
  CHECK (command_type IN (
    'sync_now','update_wallpaper','lock_screen','unlock',
    'collect_system_info','clear_company_temp_files','sign_out_user'
  ));

-- ── Admin: lock a device ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lock_device(p_asset_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dev RECORD;
BEGIN
  IF NOT public._is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  SELECT id INTO v_dev FROM public.managed_devices WHERE laptop_asset_id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no managed device for this asset'; END IF;

  UPDATE public.managed_devices
     SET is_locked = true, locked_at = now(), locked_by = v_uid,
         lock_reason = p_reason, updated_at = now()
   WHERE id = v_dev.id;

  -- Supersede any still-pending lock/unlock, then queue a fresh lock.
  UPDATE public.device_commands
     SET status = 'cancelled'
   WHERE managed_device_id = v_dev.id AND status = 'pending'
     AND command_type IN ('lock_screen','unlock');

  INSERT INTO public.device_commands (managed_device_id, command_type, requested_by)
  VALUES (v_dev.id, 'lock_screen', v_uid);

  RETURN jsonb_build_object('success', true);
END $$;

-- ── Admin: unlock a device (re-grant access) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.unlock_device(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dev RECORD;
BEGIN
  IF NOT public._is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  SELECT id INTO v_dev FROM public.managed_devices WHERE laptop_asset_id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no managed device for this asset'; END IF;

  UPDATE public.managed_devices
     SET is_locked = false, locked_at = NULL, locked_by = NULL,
         lock_reason = NULL, updated_at = now()
   WHERE id = v_dev.id;

  UPDATE public.device_commands
     SET status = 'cancelled'
   WHERE managed_device_id = v_dev.id AND status = 'pending'
     AND command_type IN ('lock_screen','unlock');

  INSERT INTO public.device_commands (managed_device_id, command_type, requested_by)
  VALUES (v_dev.id, 'unlock', v_uid);

  RETURN jsonb_build_object('success', true);
END $$;

-- ── agent_sync: now also returns the durable lock flag every heartbeat ──────
CREATE OR REPLACE FUNCTION public.agent_sync(
  p_token   text,
  p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset_id uuid;
  v_dev_id   uuid;
  v_locked   boolean := false;
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
  WHERE id = v_dev_id
  RETURNING is_locked INTO v_locked;

  INSERT INTO public.device_sync_logs (managed_device_id, sync_payload, sync_status, ip_address)
  VALUES (v_dev_id, p_payload, 'ok', p_payload->>'ip_address');

  RETURN jsonb_build_object('success', true, 'device_id', v_dev_id, 'locked', COALESCE(v_locked, false));
END $$;

GRANT EXECUTE ON FUNCTION public.lock_device(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_device(uuid)      TO authenticated;
