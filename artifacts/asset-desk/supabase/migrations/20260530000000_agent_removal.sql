-- ============================================================================
-- Agent removal / uninstall (safe, non-destructive)
--
-- Lets a super_admin cleanly end the agent management connection for a device,
-- in two modes:
--
--   * remove_agent (graceful)       -> queues an `uninstall_agent` command. The
--     laptop agent stops its background service, deletes its local files and
--     saved token, then reports back. Only on that confirmation do we revoke the
--     server token and mark the device "Agent Removed" (honest, like the lock).
--
--   * force_remove_agent (portal)   -> for an unresponsive laptop. Immediately
--     revokes the token, marks the device "Agent Removed", clears the pending
--     command queue, and releases any lock. The laptop can be cleaned later with
--     the downloadable uninstall command.
--
-- INVARIANT: removing the agent only ends the *management connection*. It NEVER
-- deletes the asset, the assigned user, asset history, or the device sync logs.
-- All of that is preserved for audit/inventory.
-- ============================================================================

-- 1. Removal bookkeeping on the device row (management-connection state only).
ALTER TABLE public.managed_devices
  ADD COLUMN IF NOT EXISTS agent_removed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS agent_removed_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_removed_reason    text,
  ADD COLUMN IF NOT EXISTS agent_remove_requested_at timestamptz;

-- 2. Allow the new command types.
ALTER TABLE public.device_commands DROP CONSTRAINT IF EXISTS device_commands_command_type_check;
ALTER TABLE public.device_commands ADD CONSTRAINT device_commands_command_type_check
  CHECK (command_type IN (
    'sync_now','update_wallpaper','lock_screen','unlock',
    'collect_system_info','clear_company_temp_files','sign_out_user',
    'notify_restart','schedule_restart','force_restart',
    'uninstall_agent','force_remove_agent'
  ));

-- ── Admin: graceful remove (queues an uninstall the laptop performs) ─────────
-- Keeps the token ACTIVE so the agent can still fetch this command and report
-- its result. The token is revoked + the device marked removed only when the
-- agent confirms the uninstall (see agent_update_command below).
CREATE OR REPLACE FUNCTION public.remove_agent(p_asset_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
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

  -- Record intent (who/why/when) but do NOT mark removed yet — that happens on
  -- the agent's confirmation, so the portal never claims removal prematurely.
  UPDATE public.managed_devices
     SET agent_remove_requested_at = now(),
         agent_removed_by          = v_uid,
         agent_removed_reason      = p_reason,
         updated_at                = now()
   WHERE id = v_dev.id;

  -- Clear any still-pending commands so the agent's last act is the uninstall.
  UPDATE public.device_commands
     SET status = 'cancelled', completed_at = now()
   WHERE managed_device_id = v_dev.id AND status = 'pending';

  INSERT INTO public.device_commands (managed_device_id, command_type, command_payload, requested_by)
  VALUES (v_dev.id, 'uninstall_agent',
          jsonb_build_object('reason', p_reason), v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'command_id', v_id);
END $$;

-- ── Admin: force remove from portal (laptop not responding) ─────────────────
-- Immediate, server-side only. Revokes the token, ends management, clears the
-- queue, releases any lock. Preserves asset, assignment, history, sync logs.
CREATE OR REPLACE FUNCTION public.force_remove_agent(p_asset_id uuid, p_reason text DEFAULT NULL)
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

  -- Revoke the active agent token(s) so the laptop can no longer sync.
  UPDATE public.agent_tokens
     SET is_active = false, revoked_at = now(), revoked_by = v_uid
   WHERE laptop_asset_id = p_asset_id AND is_active = true;

  -- End management + mark removed + release any lock. Asset/assignment untouched.
  UPDATE public.managed_devices
     SET is_managed                = false,
         agent_removed_at          = now(),
         agent_remove_requested_at = COALESCE(agent_remove_requested_at, now()),
         agent_removed_by          = v_uid,
         agent_removed_reason      = p_reason,
         is_locked                 = false,
         locked_at                 = NULL,
         locked_by                 = NULL,
         lock_reason               = NULL,
         status                    = 'offline',
         updated_at                = now()
   WHERE id = v_dev.id;

  -- Clear the pending command queue.
  UPDATE public.device_commands
     SET status = 'cancelled', completed_at = now()
   WHERE managed_device_id = v_dev.id AND status IN ('pending','running');

  -- Audit row (so the action shows in the command history with who/when/why).
  INSERT INTO public.device_commands
    (managed_device_id, command_type, command_payload, status, requested_by,
     executed_at, completed_at, result_message)
  VALUES
    (v_dev.id, 'force_remove_agent', jsonb_build_object('reason', p_reason),
     'completed', v_uid, now(), now(),
     'Force-removed from portal (laptop not responding). Asset, assignment and history preserved.');

  RETURN jsonb_build_object('success', true);
END $$;

-- ── request_device_command: refuse new commands once removal is in flight ───
-- Replaces the original (device_management.sql) with the same behaviour plus a
-- guard: once an uninstall has been requested (agent_remove_requested_at set) or
-- the agent is already removed/unmanaged, never queue further commands. This
-- prevents a lock/restart racing in *after* the uninstall and being executed by
-- an agent that is mid-teardown.
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
  SELECT id, is_managed, agent_remove_requested_at, agent_removed_at
    INTO v_dev
    FROM public.managed_devices WHERE laptop_asset_id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no managed device for this asset'; END IF;

  IF v_dev.agent_removed_at IS NOT NULL OR v_dev.is_managed = false THEN
    RAISE EXCEPTION 'agent has been removed from this device';
  END IF;
  IF v_dev.agent_remove_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'agent removal in progress; no further commands accepted';
  END IF;

  INSERT INTO public.device_commands (managed_device_id, command_type, command_payload, requested_by)
  VALUES (v_dev.id, p_command_type, p_payload, v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'command_id', v_id);
END $$;

-- ── Centralised guard: block ALL command inserts once removal is in flight ──
-- request_device_command is guarded above, but lock_device / unlock_device and
-- any other path INSERT into device_commands directly. A single BEFORE INSERT
-- trigger enforces the rule everywhere: once an uninstall is requested or the
-- device is removed/unmanaged, no further commands may be queued. The two
-- removal commands themselves are always allowed (remove_agent queues
-- uninstall_agent *after* setting agent_remove_requested_at; force_remove_agent
-- writes its audit row *after* setting agent_removed_at).
CREATE OR REPLACE FUNCTION public._block_commands_after_removal()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_req     timestamptz;
  v_removed timestamptz;
  v_managed boolean;
BEGIN
  IF NEW.command_type IN ('uninstall_agent','force_remove_agent') THEN
    RETURN NEW;
  END IF;
  SELECT agent_remove_requested_at, agent_removed_at, is_managed
    INTO v_req, v_removed, v_managed
    FROM public.managed_devices WHERE id = NEW.managed_device_id;
  IF v_removed IS NOT NULL OR v_managed = false THEN
    RAISE EXCEPTION 'agent has been removed from this device; no commands accepted';
  END IF;
  IF v_req IS NOT NULL THEN
    RAISE EXCEPTION 'agent removal in progress; no further commands accepted';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_commands_after_removal ON public.device_commands;
CREATE TRIGGER trg_block_commands_after_removal
  BEFORE INSERT ON public.device_commands
  FOR EACH ROW EXECUTE FUNCTION public._block_commands_after_removal();

-- ── agent_update_command: now also finalises a confirmed uninstall ──────────
-- Identical to the hard-lock version, plus: when the agent confirms an
-- `uninstall_agent` completed, revoke the token, mark the device removed, and
-- release any lock. (CREATE OR REPLACE keeps everything else the same.)
CREATE OR REPLACE FUNCTION public.agent_update_command(
  p_token        text,
  p_command_id   uuid,
  p_status       text,
  p_result       text DEFAULT NULL,
  p_error        text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset_id uuid;
  v_ctype    text;
  v_dev_id   uuid;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;
  IF p_status NOT IN ('completed','failed','running','requires_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid status');
  END IF;

  SELECT dc.command_type, dc.managed_device_id
    INTO v_ctype, v_dev_id
    FROM public.device_commands dc
    JOIN public.managed_devices md ON md.id = dc.managed_device_id
   WHERE dc.id = p_command_id AND md.laptop_asset_id = v_asset_id;
  IF v_dev_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'command not found for this device');
  END IF;

  UPDATE public.device_commands
     SET status         = p_status,
         result_message = COALESCE(p_result, result_message),
         error_message  = COALESCE(p_error, error_message),
         completed_at   = CASE WHEN p_status IN ('completed','failed','requires_admin')
                               THEN now() ELSE completed_at END
   WHERE id = p_command_id;

  IF v_ctype = 'lock_screen' AND p_status = 'completed' THEN
    UPDATE public.managed_devices
       SET is_locked = true, locked_at = now(), updated_at = now()
     WHERE id = v_dev_id;
  ELSIF v_ctype = 'unlock' AND p_status = 'completed' THEN
    UPDATE public.managed_devices
       SET is_locked = false, locked_at = NULL, locked_by = NULL,
           lock_reason = NULL, updated_at = now()
     WHERE id = v_dev_id;
  ELSIF v_ctype = 'uninstall_agent' AND p_status = 'completed' THEN
    -- The laptop confirmed it removed itself: end management + revoke token.
    UPDATE public.managed_devices
       SET is_managed = false, agent_removed_at = now(),
           is_locked = false, locked_at = NULL, locked_by = NULL,
           lock_reason = NULL, status = 'offline', updated_at = now()
     WHERE id = v_dev_id;
    UPDATE public.agent_tokens
       SET is_active = false, revoked_at = now()
     WHERE laptop_asset_id = v_asset_id AND is_active = true;
  END IF;

  RETURN jsonb_build_object('success', true);
END $$;

-- ── agent_register: clear removal markers on re-onboard ─────────────────────
-- Identical to the device-management version, plus it resets the removal state
-- so re-installing the agent (with a fresh key) cleanly brings the device back
-- under management.
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

  SELECT id INTO v_emp FROM public.profiles
   WHERE lower(email) = lower(p_payload->>'employee_email')
      OR lower(ecode) = lower(p_payload->>'employee_ecode')
   LIMIT 1;

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
      status = 'online', is_managed = true, last_seen_at = now(), updated_at = now(),
      -- Re-onboarding clears any prior removal state.
      agent_removed_at = NULL, agent_removed_by = NULL,
      agent_removed_reason = NULL, agent_remove_requested_at = NULL
    WHERE id = v_dev_id;
  END IF;

  UPDATE public.agent_tokens
     SET managed_device_id = v_dev_id
   WHERE laptop_asset_id = v_asset_id AND is_active = true;

  INSERT INTO public.device_sync_logs (managed_device_id, sync_payload, sync_status, ip_address)
  VALUES (v_dev_id, p_payload, 'registered', p_payload->>'ip_address');

  RETURN jsonb_build_object('success', true, 'device_id', v_dev_id, 'asset_id', v_asset_id);
END $$;

-- ── device_command_history: also return command_payload (carries the reason) ─
CREATE OR REPLACE FUNCTION public.device_command_history(p_asset_id uuid, p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_dev_id uuid;
  v_rows   jsonb;
BEGIN
  IF NOT public._is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  SELECT id INTO v_dev_id FROM public.managed_devices WHERE laptop_asset_id = p_asset_id;
  IF v_dev_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT dc.id,
           dc.command_type,
           dc.command_payload,
           dc.status,
           dc.requested_at,
           dc.executed_at,
           dc.completed_at,
           dc.result_message,
           dc.error_message,
           COALESCE(p.full_name, p.email, 'System') AS requested_by_name
      FROM public.device_commands dc
      LEFT JOIN public.profiles p ON p.id = dc.requested_by
     WHERE dc.managed_device_id = v_dev_id
     ORDER BY dc.requested_at DESC
     LIMIT GREATEST(p_limit, 1)
  ) t;

  RETURN v_rows;
END $$;

GRANT EXECUTE ON FUNCTION public.remove_agent(uuid, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.force_remove_agent(uuid, text)  TO authenticated;
