-- ============================================================================
-- Device HARD lock + honest command status reporting + audit log
--
-- Goals (offboarding / lost-or-stolen device):
--   * A device must only show "Locked" once the agent CONFIRMS the OS lock truly
--     took effect. No optimistic flag flipping.
--   * Command status is end-to-end truthful: Pending -> Executing -> Success /
--     Failed / Requires Admin Privileges, with the exact failure reason stored.
--   * Every lock/unlock is auditable: who initiated, device, when, outcome, why.
--
-- Status model (device_commands.status -> portal label):
--   pending        -> Pending
--   running        -> Executing
--   completed      -> Success
--   failed         -> Failed
--   requires_admin -> Requires Admin Privileges
--   cancelled      -> (superseded)
-- ============================================================================

-- 1. Allow the agent to report a privilege failure distinct from a generic one.
ALTER TABLE public.device_commands DROP CONSTRAINT IF EXISTS device_commands_status_check;
ALTER TABLE public.device_commands ADD CONSTRAINT device_commands_status_check
  CHECK (status IN ('pending','running','completed','failed','cancelled','requires_admin'));

-- ── Admin: request a device lock ────────────────────────────────────────────
-- IMPORTANT: this only QUEUES the lock and records who/why. managed_devices.is_locked
-- is NOT flipped here — it becomes true only when the agent confirms the OS lock
-- actually took effect (see agent_update_command). This guarantees the portal never
-- shows "Locked" for a device that is still usable.
CREATE OR REPLACE FUNCTION public.lock_device(p_asset_id uuid, p_reason text DEFAULT NULL)
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

  -- Record intent (who initiated + reason) but leave is_locked untouched until confirmed.
  UPDATE public.managed_devices
     SET locked_by = v_uid, lock_reason = p_reason, updated_at = now()
   WHERE id = v_dev.id;

  -- Supersede any still-pending lock/unlock, then queue a fresh lock.
  UPDATE public.device_commands
     SET status = 'cancelled', completed_at = now()
   WHERE managed_device_id = v_dev.id AND status = 'pending'
     AND command_type IN ('lock_screen','unlock');

  INSERT INTO public.device_commands (managed_device_id, command_type, requested_by)
  VALUES (v_dev.id, 'lock_screen', v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'command_id', v_id);
END $$;

-- ── Admin: request a device unlock (re-grant access) ────────────────────────
-- Also only queues. is_locked is cleared when the agent confirms the unlock.
CREATE OR REPLACE FUNCTION public.unlock_device(p_asset_id uuid)
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

  UPDATE public.device_commands
     SET status = 'cancelled', completed_at = now()
   WHERE managed_device_id = v_dev.id AND status = 'pending'
     AND command_type IN ('lock_screen','unlock');

  INSERT INTO public.device_commands (managed_device_id, command_type, requested_by)
  VALUES (v_dev.id, 'unlock', v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'command_id', v_id);
END $$;

-- ── agent_update_command: the single source of truth for lock state ──────────
-- The agent reports the REAL outcome here. Only a confirmed lock_screen 'completed'
-- sets is_locked = true; only a confirmed unlock 'completed' clears it. A failed or
-- requires_admin lock leaves the device UNLOCKED (honest) and stores the reason.
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

  -- Resolve the command and make sure it belongs to THIS agent's device.
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

  -- Reconcile the durable lock flag ONLY on confirmed success.
  IF v_ctype = 'lock_screen' AND p_status = 'completed' THEN
    UPDATE public.managed_devices
       SET is_locked = true, locked_at = now(), updated_at = now()
     WHERE id = v_dev_id;
  ELSIF v_ctype = 'unlock' AND p_status = 'completed' THEN
    UPDATE public.managed_devices
       SET is_locked = false, locked_at = NULL, locked_by = NULL,
           lock_reason = NULL, updated_at = now()
     WHERE id = v_dev_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END $$;

-- ── Audit log: recent commands for a device, with the initiator's name ──────
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

-- ── agent_fetch_commands: atomic claim (prevents duplicate execution) ───────
-- The original version SELECTed pending rows and then UPDATEd them in a separate
-- statement, so two concurrent pollers (e.g. a leftover per-user agent plus the
-- new root system service during a Linux upgrade) could both claim the same
-- command. Claim atomically with a single UPDATE ... RETURNING so each command
-- is handed to exactly one poller.
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

  WITH claimed AS (
    UPDATE public.device_commands
       SET status = 'running', executed_at = now()
     WHERE id IN (
       SELECT id FROM public.device_commands
        WHERE managed_device_id = v_dev_id AND status = 'pending'
        ORDER BY requested_at
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, command_type, command_payload, requested_at
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'type', command_type, 'payload', command_payload
  ) ORDER BY requested_at), '[]'::jsonb)
  INTO v_cmds
  FROM claimed;

  UPDATE public.managed_devices SET status = 'online', last_seen_at = now() WHERE id = v_dev_id;

  RETURN jsonb_build_object('success', true, 'commands', v_cmds);
END $$;

GRANT EXECUTE ON FUNCTION public.lock_device(uuid, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_device(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.device_command_history(uuid, int) TO authenticated;
