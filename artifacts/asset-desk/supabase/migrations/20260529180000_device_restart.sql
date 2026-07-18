-- ============================================================================
-- Device Restart Management
--
-- Goals:
--   * Track how long each device has been running (uptime) and when it last booted.
--   * Let admins safely ask a device to restart. Every restart path warns the user
--     first and waits a grace period — there is no silent immediate restart.
--
-- New command types (handled by the agent's execute_command):
--   notify_restart   -> just shows the user a "please restart" message.
--   schedule_restart -> warns the user + schedules a restart after a delay.
--   force_restart    -> warns the user + forces apps closed + restarts after a delay.
-- ============================================================================

-- 1. Uptime / last-boot columns persisted on each heartbeat.
ALTER TABLE public.managed_devices
  ADD COLUMN IF NOT EXISTS uptime_seconds bigint,
  ADD COLUMN IF NOT EXISTS last_boot_at   timestamptz;

-- 2. Allow the new restart command types.
ALTER TABLE public.device_commands DROP CONSTRAINT IF EXISTS device_commands_command_type_check;
ALTER TABLE public.device_commands ADD CONSTRAINT device_commands_command_type_check
  CHECK (command_type IN (
    'sync_now','update_wallpaper','lock_screen','unlock',
    'collect_system_info','clear_company_temp_files','sign_out_user',
    'notify_restart','schedule_restart','force_restart'
  ));

-- 3. Persist uptime + last_boot on every sync. (CREATE OR REPLACE keeps the rest
--    of agent_sync identical to the device-management migration, only adding the
--    two new fields.)
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
    uptime_seconds = COALESCE((p_payload->>'uptime_seconds')::bigint, uptime_seconds),
    last_boot_at = COALESCE((p_payload->>'last_boot_at')::timestamptz, last_boot_at),
    status = 'online', last_seen_at = now(), updated_at = now()
  WHERE id = v_dev_id
  RETURNING is_locked INTO v_locked;

  INSERT INTO public.device_sync_logs (managed_device_id, sync_payload, sync_status, ip_address)
  VALUES (v_dev_id, p_payload, 'ok', p_payload->>'ip_address');

  -- Return the durable lock flag so the agent can reconcile the OS lock each heartbeat.
  RETURN jsonb_build_object('success', true, 'device_id', v_dev_id, 'locked', COALESCE(v_locked, false));
END $$;
