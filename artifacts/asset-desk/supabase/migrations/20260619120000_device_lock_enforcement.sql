-- ============================================================================
-- Device Lock Enforcement — additive hardening (backward compatible)
--
-- Builds on 20260529160000_device_hard_lock.sql. Changes, all additive:
--   1. Authorization broadened from super_admin-only to super_admin OR it_admin
--      (via public._hr_can_act()) for lock_device / unlock_device, and to
--      super_admin/it_admin/it_agent/hr_admin (public._hr_can_read()) for
--      device_command_history so IT staff can view the audit trail.
--   2. lock_device now defaults a human reason ("Manual Admin Lock") and embeds
--      the human-readable Asset ID (assets.asset_id, e.g. MILES-LAP-519) in the
--      command_payload so the agent's branded lock screen can show it offline.
--   3. Every lock/unlock lifecycle transition is written to audit_logs:
--        device.lock_requested / device.unlock_requested  (admin, who + why)
--        device.lock_executing / device.unlock_executing  (agent claimed it)
--        device.lock_success   / device.unlock_success     (agent confirmed)
--        device.lock_failed    / device.unlock_failed       (incl. requires_admin)
--      Per-user OS results are parsed from a "|USERS=a,b" suffix the agent may
--      append to its result string, and stored in metadata.affected_users — so
--      NO Edge Function change is required (avoids agent-api redeploy/BOOT_ERROR).
--
-- Nothing here wipes data, deletes users/files, or changes Agent Key logic.
-- ============================================================================

-- ── Admin: request a device lock ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lock_device(p_asset_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_dev    RECORD;
  v_id     uuid;
  v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'Manual Admin Lock');
  v_tag    text;
BEGIN
  IF NOT public._hr_can_act() THEN
    RAISE EXCEPTION 'forbidden: super_admin or it_admin required';
  END IF;
  SELECT id, laptop_asset_id INTO v_dev
    FROM public.managed_devices WHERE laptop_asset_id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no managed device for this asset'; END IF;

  SELECT asset_id INTO v_tag FROM public.assets WHERE id = p_asset_id;

  -- Record intent (who initiated + reason) but leave is_locked untouched until
  -- the agent confirms the OS lock actually took effect (agent_update_command).
  UPDATE public.managed_devices
     SET locked_by = v_uid, lock_reason = v_reason, updated_at = now()
   WHERE id = v_dev.id;

  -- Supersede any still-pending lock/unlock, then queue a fresh lock that carries
  -- the human-readable Asset ID + reason so the branded lock screen can render
  -- them even with no network.
  UPDATE public.device_commands
     SET status = 'cancelled', completed_at = now()
   WHERE managed_device_id = v_dev.id AND status = 'pending'
     AND command_type IN ('lock_screen','unlock');

  INSERT INTO public.device_commands (managed_device_id, command_type, requested_by, command_payload)
  VALUES (v_dev.id, 'lock_screen', v_uid,
          jsonb_build_object('asset_tag', v_tag, 'reason', v_reason))
  RETURNING id INTO v_id;

  PERFORM public._hr_audit('device.lock_requested', 'managed_device', v_dev.id,
    'Lock requested for ' || COALESCE(v_tag, 'device') || ' — ' || v_reason,
    jsonb_build_object('command_id', v_id, 'asset_tag', v_tag, 'reason', v_reason));

  RETURN jsonb_build_object('success', true, 'command_id', v_id);
END $$;

-- ── Admin: request a device unlock (re-grant access) ────────────────────────
CREATE OR REPLACE FUNCTION public.unlock_device(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dev RECORD;
  v_id  uuid;
  v_tag text;
BEGIN
  IF NOT public._hr_can_act() THEN
    RAISE EXCEPTION 'forbidden: super_admin or it_admin required';
  END IF;
  SELECT id INTO v_dev FROM public.managed_devices WHERE laptop_asset_id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no managed device for this asset'; END IF;

  SELECT asset_id INTO v_tag FROM public.assets WHERE id = p_asset_id;

  UPDATE public.device_commands
     SET status = 'cancelled', completed_at = now()
   WHERE managed_device_id = v_dev.id AND status = 'pending'
     AND command_type IN ('lock_screen','unlock');

  INSERT INTO public.device_commands (managed_device_id, command_type, requested_by)
  VALUES (v_dev.id, 'unlock', v_uid)
  RETURNING id INTO v_id;

  PERFORM public._hr_audit('device.unlock_requested', 'managed_device', v_dev.id,
    'Unlock requested for ' || COALESCE(v_tag, 'device'),
    jsonb_build_object('command_id', v_id, 'asset_tag', v_tag));

  RETURN jsonb_build_object('success', true, 'command_id', v_id);
END $$;

-- ── agent_update_command: source of truth for lock state + lifecycle audit ──
CREATE OR REPLACE FUNCTION public.agent_update_command(
  p_token        text,
  p_command_id   uuid,
  p_status       text,
  p_result       text DEFAULT NULL,
  p_error        text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_asset_id uuid;
  v_ctype    text;
  v_dev_id   uuid;
  v_tag      text;
  v_users    text;
  v_users_arr jsonb := NULL;
  v_action   text;
  v_label    text;
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

  -- ── Lifecycle audit (only for lock/unlock commands) ──────────────────────
  IF v_ctype IN ('lock_screen','unlock') THEN
    SELECT asset_id INTO v_tag FROM public.assets WHERE id = v_asset_id;

    -- Parse an optional "|USERS=a,b,c" suffix the agent may append to its result
    -- to report exactly which OS accounts were disabled/enabled.
    v_users := substring(COALESCE(p_result, '') FROM '\|USERS=([^|]*)');
    IF v_users IS NOT NULL AND btrim(v_users) <> '' THEN
      SELECT jsonb_agg(btrim(u)) INTO v_users_arr
        FROM unnest(string_to_array(v_users, ',')) AS u
       WHERE btrim(u) <> '';
    END IF;

    v_action :=
      CASE
        WHEN v_ctype = 'lock_screen' AND p_status = 'running'   THEN 'device.lock_executing'
        WHEN v_ctype = 'lock_screen' AND p_status = 'completed' THEN 'device.lock_success'
        WHEN v_ctype = 'lock_screen'                            THEN 'device.lock_failed'
        WHEN v_ctype = 'unlock'      AND p_status = 'running'   THEN 'device.unlock_executing'
        WHEN v_ctype = 'unlock'      AND p_status = 'completed' THEN 'device.unlock_success'
        ELSE 'device.unlock_failed'
      END;
    v_label :=
      CASE
        WHEN v_action = 'device.lock_executing'   THEN 'Agent is applying lock on '
        WHEN v_action = 'device.lock_success'     THEN 'Device locked: '
        WHEN v_action = 'device.lock_failed'      THEN 'Lock FAILED on '
        WHEN v_action = 'device.unlock_executing' THEN 'Agent is unlocking '
        WHEN v_action = 'device.unlock_success'   THEN 'Device unlocked: '
        ELSE 'Unlock FAILED on '
      END || COALESCE(v_tag, 'device');

    INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, description, metadata)
    VALUES (NULL, v_action, 'managed_device', v_dev_id,
            v_label || CASE WHEN p_status = 'requires_admin' THEN ' (requires admin privileges)' ELSE '' END,
            jsonb_strip_nulls(jsonb_build_object(
              'command_id', p_command_id,
              'asset_tag',  v_tag,
              'status',     p_status,
              'result',     p_result,
              'error',      p_error,
              'affected_users', v_users_arr
            )));
  END IF;

  RETURN jsonb_build_object('success', true);
END $$;

-- ── device_command_history: viewable by IT staff (not just super_admin) ─────
CREATE OR REPLACE FUNCTION public.device_command_history(p_asset_id uuid, p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dev_id uuid;
  v_rows   jsonb;
BEGIN
  IF NOT public._hr_can_read() THEN
    RAISE EXCEPTION 'forbidden: IT or HR admin required';
  END IF;
  SELECT id INTO v_dev_id FROM public.managed_devices WHERE laptop_asset_id = p_asset_id;
  IF v_dev_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT dc.id, dc.command_type, dc.status, dc.requested_at, dc.executed_at,
           dc.completed_at, dc.result_message, dc.error_message,
           COALESCE(p.full_name, p.email, 'System') AS requested_by_name
      FROM public.device_commands dc
      LEFT JOIN public.profiles p ON p.id = dc.requested_by
     WHERE dc.managed_device_id = v_dev_id
     ORDER BY dc.requested_at DESC
     LIMIT GREATEST(p_limit, 1)
  ) t;

  RETURN v_rows;
END $$;

GRANT EXECUTE ON FUNCTION public.lock_device(uuid, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_device(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.device_command_history(uuid, int) TO authenticated;
