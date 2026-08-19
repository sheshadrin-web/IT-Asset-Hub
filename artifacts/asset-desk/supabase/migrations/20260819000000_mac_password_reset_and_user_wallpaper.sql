-- Local-only design for macOS employee wallpaper status and OS password reset.
-- Do not apply to production without the approved deployment review.

ALTER TABLE public.device_commands
  DROP CONSTRAINT IF EXISTS device_commands_command_type_check;
ALTER TABLE public.device_commands
  ADD CONSTRAINT device_commands_command_type_check CHECK (command_type IN (
    'sync_now','update_wallpaper','lock_screen','collect_system_info',
    'clear_company_temp_files','sign_out_user','update_agent','notify_restart',
    'schedule_restart','force_restart','uninstall_agent','force_remove_agent',
    'unlock','provision_user','reset_user_password'
  ));

ALTER TABLE public.device_user_provisioning
  ADD COLUMN IF NOT EXISTS wallpaper_status text NOT NULL DEFAULT 'pending'
    CHECK (wallpaper_status IN ('applied','pending','failed')),
  ADD COLUMN IF NOT EXISTS wallpaper_error text,
  ADD COLUMN IF NOT EXISTS wallpaper_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.device_user_password_resets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provisioning_id   uuid NOT NULL REFERENCES public.device_user_provisioning(id) ON DELETE CASCADE,
  asset_id          uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  managed_device_id uuid NOT NULL REFERENCES public.managed_devices(id) ON DELETE CASCADE,
  command_id        uuid NOT NULL UNIQUE REFERENCES public.device_commands(id) ON DELETE CASCADE,
  employee_code     text NOT NULL,
  os_username       text NOT NULL,
  ciphertext        text NOT NULL,
  reset_status      text NOT NULL DEFAULT 'prepared'
                    CHECK (reset_status IN ('prepared','available','consumed','expired','revoked')),
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  revealed_at       timestamptz,
  consumed_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_user_password_resets_asset_idx
  ON public.device_user_password_resets(asset_id, reset_status, expires_at);
ALTER TABLE public.device_user_password_resets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.request_user_password_reset(
  p_asset_id uuid, p_ciphertext text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_asset record;
  v_device record;
  v_prov record;
  v_command uuid;
  v_reset uuid;
BEGIN
  IF NOT public._hr_can_act() THEN
    RAISE EXCEPTION 'forbidden: super_admin or it_admin required';
  END IF;
  IF p_ciphertext IS NULL OR length(p_ciphertext) < 24 OR length(p_ciphertext) > 4096 THEN
    RAISE EXCEPTION 'invalid credential envelope';
  END IF;
  SELECT id, asset_id, assigned_to, status, asset_type, operating_system
    INTO v_asset FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND OR v_asset.asset_type <> 'Laptop' OR v_asset.status <> 'Assigned'
     OR v_asset.assigned_to IS NULL THEN
    RAISE EXCEPTION 'asset must be assigned before password reset';
  END IF;
  SELECT id, status, is_managed, os_name INTO v_device
    FROM public.managed_devices WHERE laptop_asset_id = p_asset_id FOR UPDATE;
  IF NOT FOUND OR v_device.is_managed IS NOT TRUE OR v_device.status <> 'online' THEN
    RAISE EXCEPTION 'macOS agent must be online and managed before password reset';
  END IF;
  IF lower(COALESCE(v_device.os_name, v_asset.operating_system, '')) NOT LIKE '%mac%'
     AND lower(COALESCE(v_device.os_name, v_asset.operating_system, '')) NOT LIKE '%darwin%' THEN
    RAISE EXCEPTION 'password reset supports macOS only';
  END IF;
  SELECT * INTO v_prov FROM public.device_user_provisioning
   WHERE asset_id = p_asset_id AND provisioning_status = 'provisioned' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'employee macOS account is not provisioned'; END IF;
  IF v_prov.employee_code IS NULL OR v_prov.os_username IS NULL
     OR lower(v_prov.employee_code) <> lower(v_prov.os_username) THEN
    RAISE EXCEPTION 'provisioning identity is invalid';
  END IF;
  IF lower(v_prov.os_username) IN (
    'root','daemon','nobody','miles-it-support','administrator',
    'system','loginwindow','_windowserver'
  ) THEN
    RAISE EXCEPTION 'protected macOS account cannot be reset';
  END IF;

  INSERT INTO public.device_commands (
    managed_device_id, command_type, command_payload, requested_by
  ) VALUES (
    v_device.id, 'reset_user_password',
    jsonb_build_object(
      'employee_code', v_prov.employee_code,
      'os_username', v_prov.os_username,
      'credential_reference', 'pending'
    ), v_uid
  ) RETURNING id INTO v_command;

  INSERT INTO public.device_user_password_resets (
    provisioning_id, asset_id, managed_device_id, command_id,
    employee_code, os_username, ciphertext, requested_by
  ) VALUES (
    v_prov.id, p_asset_id, v_device.id, v_command,
    upper(v_prov.employee_code), lower(v_prov.os_username), p_ciphertext, v_uid
  ) RETURNING id INTO v_reset;

  UPDATE public.device_commands
     SET command_payload = jsonb_build_object(
       'employee_code', v_prov.employee_code,
       'os_username', v_prov.os_username,
       'credential_reference', v_reset
     )
   WHERE id = v_command;

  PERFORM public._hr_audit(
    'device.user_password_reset_requested', 'managed_device', v_device.id,
    'OS password reset requested for employee account on assigned device',
    jsonb_build_object(
      'command_id', v_command, 'asset_id', p_asset_id,
      'employee_code', upper(v_prov.employee_code),
      'os_username', lower(v_prov.os_username), 'requested_by', v_uid
    )
  );
  RETURN jsonb_build_object('success', true, 'command_id', v_command,
                            'reset_id', v_reset, 'reset_status', 'prepared');
END $$;

CREATE OR REPLACE FUNCTION public.agent_reveal_password_reset(
  p_token text, p_command_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_asset_id uuid; v_row record;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token'); END IF;
  UPDATE public.device_user_password_resets SET reset_status = 'expired'
   WHERE asset_id = v_asset_id AND reset_status = 'prepared' AND expires_at <= now();
  SELECT * INTO v_row FROM public.device_user_password_resets
   WHERE command_id = p_command_id AND asset_id = v_asset_id
     AND reset_status = 'prepared' AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'reset credential unavailable'); END IF;
  RETURN jsonb_build_object('success', true, 'ciphertext', v_row.ciphertext);
END $$;

CREATE OR REPLACE FUNCTION public.agent_confirm_password_reset(
  p_token text, p_command_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_asset_id uuid; v_changed integer;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token'); END IF;
  UPDATE public.device_user_password_resets SET reset_status = 'available'
   WHERE command_id = p_command_id AND asset_id = v_asset_id
     AND reset_status = 'prepared' AND expires_at > now();
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN jsonb_build_object('success', v_changed > 0,
    'error', CASE WHEN v_changed > 0 THEN NULL ELSE 'reset credential not prepared' END);
END $$;

CREATE OR REPLACE FUNCTION public.reveal_user_password_reset(
  p_actor_user_id uuid, p_asset_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text; v_row record;
BEGIN
  SELECT role INTO v_role FROM public.profiles
   WHERE id = p_actor_user_id AND status = 'active';
  IF v_role NOT IN ('super_admin','it_admin') THEN RAISE EXCEPTION 'forbidden: super_admin or it_admin required'; END IF;
  UPDATE public.device_user_password_resets SET reset_status = 'expired'
   WHERE asset_id = p_asset_id AND reset_status = 'available' AND expires_at <= now();
  SELECT * INTO v_row FROM public.device_user_password_resets
   WHERE asset_id = p_asset_id AND reset_status = 'available'
     AND expires_at > now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'reset credential unavailable or already consumed'); END IF;
  UPDATE public.device_user_password_resets
     SET reset_status = 'consumed', revealed_at = now(), consumed_by = p_actor_user_id
   WHERE id = v_row.id;
  RETURN jsonb_build_object('success', true, 'ciphertext', v_row.ciphertext,
                            'expires_at', v_row.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.agent_report_user_wallpaper(
  p_token text, p_os_username text, p_status text, p_error text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_asset_id uuid;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token'); END IF;
  IF p_status NOT IN ('applied','pending','failed') THEN RETURN jsonb_build_object('success', false, 'error', 'invalid status'); END IF;
  UPDATE public.device_user_provisioning
     SET wallpaper_status = p_status, wallpaper_error = p_error,
         wallpaper_updated_at = now(), updated_at = now()
   WHERE asset_id = v_asset_id AND lower(os_username) = lower(btrim(p_os_username));
  RETURN jsonb_build_object('success', true);
END $$;

CREATE OR REPLACE FUNCTION public.get_user_provisioning(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.device_user_provisioning;
BEGIN
  IF NOT public._hr_can_read() THEN RAISE EXCEPTION 'forbidden: IT or HR admin required'; END IF;
  SELECT * INTO v_row FROM public.device_user_provisioning WHERE asset_id = p_asset_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', true, 'provisioning_status', 'not_provisioned'); END IF;
  RETURN jsonb_build_object(
    'success', true, 'id', v_row.id, 'asset_id', v_row.asset_id,
    'managed_device_id', v_row.managed_device_id, 'assigned_user_id', v_row.assigned_user_id,
    'employee_code', v_row.employee_code, 'employee_name', v_row.employee_name,
    'employee_email', v_row.employee_email, 'platform', v_row.platform,
    'os_username', v_row.os_username, 'account_type', v_row.account_type,
    'provisioning_status', v_row.provisioning_status, 'requested_at', v_row.requested_at,
    'requested_by', v_row.requested_by, 'provisioned_at', v_row.provisioned_at,
    'last_error', v_row.last_error, 'command_id', v_row.command_id,
    'updated_at', v_row.updated_at, 'wallpaper_status', v_row.wallpaper_status,
    'wallpaper_error', v_row.wallpaper_error, 'wallpaper_updated_at', v_row.wallpaper_updated_at,
    'credential_status', (SELECT c.credential_status FROM public.device_user_credentials c
       WHERE c.provisioning_id = v_row.id),
    'credential_expires_at', (SELECT c.expires_at FROM public.device_user_credentials c
       WHERE c.provisioning_id = v_row.id),
    'reset_status', (SELECT r.reset_status FROM public.device_user_password_resets r
       WHERE r.provisioning_id = v_row.id ORDER BY r.created_at DESC LIMIT 1)
  );
END $$;

-- Re-state the existing callback with lock/unlock reconciliation preserved.
CREATE OR REPLACE FUNCTION public.agent_update_command(
  p_token        text,
  p_command_id   uuid,
  p_status       text,
  p_result       text DEFAULT NULL,
  p_error        text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_asset_id uuid;
  v_ctype text;
  v_dev_id uuid;
  v_tag text;
  v_action text;
  v_label text;
  v_users text;
  v_users_arr jsonb := NULL;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token'); END IF;
  IF p_status NOT IN ('completed','failed','running','requires_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid status');
  END IF;
  SELECT dc.command_type, dc.managed_device_id INTO v_ctype, v_dev_id
    FROM public.device_commands dc JOIN public.managed_devices md ON md.id = dc.managed_device_id
   WHERE dc.id = p_command_id AND md.laptop_asset_id = v_asset_id;
  IF v_dev_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'command not found for this device'); END IF;

  UPDATE public.device_commands SET status = p_status,
    result_message = COALESCE(p_result, result_message),
    error_message = COALESCE(p_error, error_message),
    completed_at = CASE WHEN p_status IN ('completed','failed','requires_admin')
                        THEN now() ELSE completed_at END
   WHERE id = p_command_id;

  IF v_ctype = 'lock_screen' AND p_status = 'completed' THEN
    UPDATE public.managed_devices SET is_locked = true, locked_at = now(), updated_at = now()
     WHERE id = v_dev_id;
  ELSIF v_ctype = 'unlock' AND p_status = 'completed' THEN
    UPDATE public.managed_devices SET is_locked = false, locked_at = NULL, locked_by = NULL,
      lock_reason = NULL, updated_at = now() WHERE id = v_dev_id;
  END IF;

  IF v_ctype IN ('lock_screen','unlock') THEN
    SELECT asset_id INTO v_tag FROM public.assets WHERE id = v_asset_id;
    v_users := substring(COALESCE(p_result, '') FROM '\|USERS=([^|]*)');
    IF v_users IS NOT NULL AND btrim(v_users) <> '' THEN
      SELECT jsonb_agg(btrim(u)) INTO v_users_arr
        FROM unnest(string_to_array(v_users, ',')) AS u WHERE btrim(u) <> '';
    END IF;
    v_action := CASE
      WHEN v_ctype = 'lock_screen' AND p_status = 'running' THEN 'device.lock_executing'
      WHEN v_ctype = 'lock_screen' AND p_status = 'completed' THEN 'device.lock_success'
      WHEN v_ctype = 'lock_screen' THEN 'device.lock_failed'
      WHEN v_ctype = 'unlock' AND p_status = 'running' THEN 'device.unlock_executing'
      WHEN v_ctype = 'unlock' AND p_status = 'completed' THEN 'device.unlock_success'
      ELSE 'device.unlock_failed'
    END;
    v_label := CASE
      WHEN v_action = 'device.lock_executing' THEN 'Agent is applying lock on '
      WHEN v_action = 'device.lock_success' THEN 'Device locked: '
      WHEN v_action = 'device.lock_failed' THEN 'Lock FAILED on '
      WHEN v_action = 'device.unlock_executing' THEN 'Agent is unlocking '
      WHEN v_action = 'device.unlock_success' THEN 'Device unlocked: '
      ELSE 'Unlock FAILED on '
    END || COALESCE(v_tag, 'device');
    INSERT INTO public.audit_logs
      (actor_user_id, action, entity_type, entity_id, description, metadata)
    VALUES
      (NULL, v_action, 'managed_device', v_dev_id,
       v_label || CASE WHEN p_status = 'requires_admin'
                       THEN ' (requires admin privileges)' ELSE '' END,
       jsonb_strip_nulls(jsonb_build_object(
         'command_id', p_command_id, 'asset_tag', v_tag, 'status', p_status,
         'result', p_result, 'error', p_error, 'affected_users', v_users_arr
       )));
  END IF;

  IF v_ctype = 'provision_user' THEN
    IF p_status IN ('failed','requires_admin') THEN
      UPDATE public.device_user_credentials SET credential_status = 'revoked'
       WHERE command_id = p_command_id AND credential_status IN ('prepared','available');
    END IF;
    UPDATE public.device_user_provisioning
       SET provisioning_status = CASE
             WHEN p_status = 'completed' THEN 'provisioned'
             WHEN p_status IN ('failed','requires_admin') THEN 'failed'
             WHEN p_status = 'running' THEN 'provisioning'
             ELSE provisioning_status END,
           provisioned_at = CASE WHEN p_status = 'completed' THEN now() ELSE provisioned_at END,
           last_error = CASE WHEN p_status IN ('failed','requires_admin') THEN p_error ELSE NULL END,
           updated_at = now()
     WHERE command_id = p_command_id;
    SELECT asset_id INTO v_tag FROM public.assets WHERE id = v_asset_id;
    v_action := CASE WHEN p_status = 'running' THEN 'device.user_provision_executing'
                     WHEN p_status = 'completed' THEN 'device.user_provision_success'
                     ELSE 'device.user_provision_failed' END;
    v_label := CASE WHEN p_status = 'running' THEN 'Agent is provisioning employee account on '
                    WHEN p_status = 'completed' THEN 'Employee OS account provisioned on '
                    ELSE 'Employee OS account provisioning FAILED on ' END;
    INSERT INTO public.audit_logs
      (actor_user_id, action, entity_type, entity_id, description, metadata)
    VALUES
      (NULL, v_action, 'managed_device', v_dev_id, v_label || COALESCE(v_tag, 'device'),
       jsonb_strip_nulls(jsonb_build_object(
         'command_id', p_command_id, 'asset_tag', v_tag, 'status', p_status,
         'result', p_result, 'error', p_error
       )));
  END IF;

  IF v_ctype = 'reset_user_password' THEN
    IF p_status IN ('failed','requires_admin') THEN
      UPDATE public.device_user_password_resets SET reset_status = 'revoked'
       WHERE command_id = p_command_id AND reset_status IN ('prepared','available');
    ELSIF p_status = 'completed' THEN
      UPDATE public.device_user_password_resets SET reset_status = 'available'
       WHERE command_id = p_command_id AND reset_status = 'prepared';
    END IF;
    SELECT asset_id INTO v_tag FROM public.assets WHERE id = v_asset_id;
    INSERT INTO public.audit_logs
      (actor_user_id, action, entity_type, entity_id, description, metadata)
    SELECT NULL,
      CASE WHEN p_status = 'completed' THEN 'device.user_password_reset_success'
           ELSE 'device.user_password_reset_failed' END,
      'managed_device', v_dev_id,
      CASE WHEN p_status = 'completed' THEN 'OS password reset completed on '
           ELSE 'OS password reset FAILED on ' END || COALESCE(v_tag, 'device'),
      jsonb_strip_nulls(jsonb_build_object(
        'command_id', p_command_id, 'asset_tag', v_tag, 'status', p_status,
        'result', p_result, 'error', p_error,
        'employee_code', (SELECT employee_code FROM public.device_user_password_resets WHERE command_id = p_command_id),
        'os_username', (SELECT os_username FROM public.device_user_password_resets WHERE command_id = p_command_id)
      ));
  END IF;
  RETURN jsonb_build_object('success', true);
END $$;

GRANT EXECUTE ON FUNCTION public.request_user_password_reset(uuid, text) TO authenticated;