-- ============================================================================
-- macOS employee OS account provisioning (Phase 1)
--
-- Asset assignment remains the ownership source of truth. This table only
-- records the state of the local OS account requested for that assignment.
-- Passwords are stored only as Edge-Function-encrypted ciphertext in the
-- dedicated credential table and are never returned by normal asset APIs.
-- ============================================================================

ALTER TABLE public.device_commands
  DROP CONSTRAINT IF EXISTS device_commands_command_type_check;

ALTER TABLE public.device_commands
  ADD CONSTRAINT device_commands_command_type_check CHECK (command_type IN (
    'sync_now','update_wallpaper','lock_screen',
    'collect_system_info','clear_company_temp_files','sign_out_user',
    'update_agent','notify_restart','schedule_restart','force_restart',
    'uninstall_agent','force_remove_agent','unlock','provision_user'
  ));

CREATE TABLE IF NOT EXISTS public.device_user_provisioning (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id            uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  managed_device_id   uuid REFERENCES public.managed_devices(id) ON DELETE SET NULL,
  assigned_user_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  employee_code       text NOT NULL,
  employee_name       text NOT NULL,
  employee_email      text,
  platform            text NOT NULL,
  os_username         text NOT NULL,
  account_type        text NOT NULL DEFAULT 'standard'
                        CHECK (account_type = 'standard'),
  provisioning_status text NOT NULL DEFAULT 'not_provisioned'
                        CHECK (provisioning_status IN
                          ('not_provisioned','pending','provisioning','provisioned','failed')),
  requested_at        timestamptz,
  requested_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  provisioned_at      timestamptz,
  last_error          text,
  command_id          uuid REFERENCES public.device_commands(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id)
);

CREATE TABLE IF NOT EXISTS public.device_user_credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provisioning_id   uuid NOT NULL UNIQUE REFERENCES public.device_user_provisioning(id) ON DELETE CASCADE,
  command_id        uuid NOT NULL UNIQUE REFERENCES public.device_commands(id) ON DELETE CASCADE,
  asset_id          uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  employee_code     text NOT NULL,
  os_username       text NOT NULL,
  ciphertext        text NOT NULL,
  credential_status text NOT NULL DEFAULT 'prepared'
                    CHECK (credential_status IN ('prepared','available','consumed','expired','revoked')),
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  revealed_at       timestamptz,
  consumed_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_user_credentials_expiry_idx
  ON public.device_user_credentials(expires_at, credential_status);
ALTER TABLE public.device_user_credentials ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS device_user_provisioning_status_idx
  ON public.device_user_provisioning(provisioning_status);
CREATE INDEX IF NOT EXISTS device_user_provisioning_user_idx
  ON public.device_user_provisioning(assigned_user_id);

ALTER TABLE public.device_user_provisioning ENABLE ROW LEVEL SECURITY;

-- Direct table access stays closed. The RPCs below apply role and assignment
-- checks in one place and never expose a credential field.
DROP POLICY IF EXISTS device_user_provisioning_read ON public.device_user_provisioning;

CREATE OR REPLACE FUNCTION public._provisioning_username(p_employee_code text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_code text := lower(btrim(COALESCE(p_employee_code, '')));
BEGIN
  IF v_code !~ '^[a-z][a-z0-9._-]{2,31}$' THEN
    RETURN NULL;
  END IF;
  RETURN v_code;
END $$;

CREATE OR REPLACE FUNCTION public.get_user_provisioning(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.device_user_provisioning;
BEGIN
  IF NOT public._hr_can_read() THEN
    RAISE EXCEPTION 'forbidden: IT or HR admin required';
  END IF;

  SELECT * INTO v_row
    FROM public.device_user_provisioning
   WHERE asset_id = p_asset_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'provisioning_status', 'not_provisioned'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_row.id,
    'asset_id', v_row.asset_id,
    'managed_device_id', v_row.managed_device_id,
    'assigned_user_id', v_row.assigned_user_id,
    'employee_code', v_row.employee_code,
    'employee_name', v_row.employee_name,
    'employee_email', v_row.employee_email,
    'platform', v_row.platform,
    'os_username', v_row.os_username,
    'account_type', v_row.account_type,
    'provisioning_status', v_row.provisioning_status,
    'requested_at', v_row.requested_at,
    'requested_by', v_row.requested_by,
    'provisioned_at', v_row.provisioned_at,
    'last_error', v_row.last_error,
    'command_id', v_row.command_id,
    'updated_at', v_row.updated_at,
    'credential_status', (
      SELECT CASE
        WHEN c.credential_status IN ('prepared','available')
             AND c.expires_at <= now() THEN 'expired'
        ELSE c.credential_status
      END
      FROM public.device_user_credentials c
      WHERE c.provisioning_id = v_row.id
    ),
    'credential_expires_at', (
      SELECT c.expires_at
      FROM public.device_user_credentials c
      WHERE c.provisioning_id = v_row.id
    )
  );
END $$;

CREATE OR REPLACE FUNCTION public.request_user_provisioning(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_asset     record;
  v_profile   record;
  v_device    record;
  v_existing  public.device_user_provisioning;
  v_username  text;
  v_command   uuid;
  v_row_id    uuid;
  v_tag       text;
BEGIN
  IF NOT public._hr_can_act() THEN
    RAISE EXCEPTION 'forbidden: super_admin or it_admin required';
  END IF;

  SELECT a.id, a.asset_id, a.asset_type, a.status, a.assigned_to,
         a.operating_system
    INTO v_asset
    FROM public.assets a
   WHERE a.id = p_asset_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'asset not found'; END IF;
  IF v_asset.asset_type <> 'Laptop' THEN
    RAISE EXCEPTION 'user provisioning is only supported for laptop assets';
  END IF;
  IF v_asset.assigned_to IS NULL OR v_asset.status <> 'Assigned' THEN
    RAISE EXCEPTION 'asset must be assigned before User Push';
  END IF;

  SELECT id, full_name, email, ecode, status
    INTO v_profile
    FROM public.profiles
   WHERE id = v_asset.assigned_to;
  IF NOT FOUND THEN RAISE EXCEPTION 'assigned employee not found'; END IF;
  IF v_profile.status <> 'active' THEN
    RAISE EXCEPTION 'assigned employee is inactive';
  END IF;

  v_username := public._provisioning_username(v_profile.ecode);
  IF v_username IS NULL THEN
    RAISE EXCEPTION 'assigned employee has an invalid Employee Code';
  END IF;
  IF v_username IN ('root','daemon','nobody','miles-it-support','administrator',
                    'system','loginwindow','_windowserver') THEN
    RAISE EXCEPTION 'Employee Code resolves to a protected macOS account';
  END IF;

  SELECT id, os_name, status, is_managed
    INTO v_device
    FROM public.managed_devices
   WHERE laptop_asset_id = p_asset_id
   FOR UPDATE;
  IF NOT FOUND OR v_device.is_managed IS NOT TRUE OR v_device.status <> 'online' THEN
    RAISE EXCEPTION 'macOS agent must be online and managed before User Push';
  END IF;
  IF lower(COALESCE(v_device.os_name, v_asset.operating_system, '')) NOT LIKE '%mac%'
     AND lower(COALESCE(v_device.os_name, v_asset.operating_system, '')) NOT LIKE '%darwin%' THEN
    RAISE EXCEPTION 'User Push Phase 1 supports macOS only';
  END IF;

  SELECT * INTO v_existing
    FROM public.device_user_provisioning
   WHERE asset_id = p_asset_id
   FOR UPDATE;

  IF FOUND AND v_existing.provisioning_status IN ('pending','provisioning') THEN
    RETURN jsonb_build_object('success', true, 'duplicate', true,
                              'command_id', v_existing.command_id,
                              'provisioning_status', v_existing.provisioning_status);
  END IF;
  IF FOUND AND v_existing.provisioning_status = 'provisioned' THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true,
                              'command_id', v_existing.command_id,
                              'provisioning_status', 'provisioned');
  END IF;

  INSERT INTO public.device_commands (
    managed_device_id, command_type, command_payload, requested_by
  ) VALUES (
    v_device.id, 'provision_user',
    jsonb_build_object(
      'employee_code', upper(v_profile.ecode),
      'display_name', v_profile.full_name,
      'email', v_profile.email
    ),
    v_uid
  ) RETURNING id INTO v_command;

  INSERT INTO public.device_user_provisioning (
    asset_id, managed_device_id, assigned_user_id, employee_code,
    employee_name, employee_email, platform, os_username, account_type,
    provisioning_status, requested_at, requested_by, last_error, command_id,
    updated_at
  ) VALUES (
    p_asset_id, v_device.id, v_profile.id, upper(v_profile.ecode),
    v_profile.full_name, v_profile.email, 'macOS', v_username, 'standard',
    'pending', now(), v_uid, NULL, v_command, now()
  )
  ON CONFLICT (asset_id) DO UPDATE SET
    managed_device_id = EXCLUDED.managed_device_id,
    assigned_user_id = EXCLUDED.assigned_user_id,
    employee_code = EXCLUDED.employee_code,
    employee_name = EXCLUDED.employee_name,
    employee_email = EXCLUDED.employee_email,
    platform = EXCLUDED.platform,
    os_username = EXCLUDED.os_username,
    account_type = EXCLUDED.account_type,
    provisioning_status = 'pending',
    requested_at = now(),
    requested_by = EXCLUDED.requested_by,
    provisioned_at = NULL,
    last_error = NULL,
    command_id = EXCLUDED.command_id,
    updated_at = now()
  RETURNING id INTO v_row_id;

  SELECT asset_id INTO v_tag FROM public.assets WHERE id = p_asset_id;
  PERFORM public._hr_audit(
    'device.user_provision_requested',
    'managed_device',
    v_device.id,
    'User Push requested for ' || COALESCE(v_tag, 'device') ||
      ' — ' || upper(v_profile.ecode) || ' (' || v_username || ')',
    jsonb_build_object(
      'command_id', v_command,
      'asset_tag', v_tag,
      'employee_code', upper(v_profile.ecode),
      'employee_name', v_profile.full_name,
      'os_username', v_username,
      'account_type', 'standard'
    )
  );

  RETURN jsonb_build_object(
    'success', true, 'command_id', v_command, 'provisioning_id', v_row_id,
    'provisioning_status', 'pending', 'os_username', v_username
  );
END $$;

CREATE OR REPLACE FUNCTION public.agent_prepare_provisioning_credential(
  p_token text, p_command_id uuid, p_employee_code text,
  p_os_username text, p_ciphertext text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_asset_id uuid;
  v_provisioning public.device_user_provisioning;
  v_type text;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;
  IF p_ciphertext IS NULL OR length(p_ciphertext) < 24 OR length(p_ciphertext) > 4096 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid credential envelope');
  END IF;

  SELECT command_type INTO v_type
    FROM public.device_commands dc
    JOIN public.managed_devices md ON md.id = dc.managed_device_id
   WHERE dc.id = p_command_id AND md.laptop_asset_id = v_asset_id;
  IF v_type <> 'provision_user' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid provisioning command');
  END IF;

  SELECT * INTO v_provisioning
    FROM public.device_user_provisioning
   WHERE command_id = p_command_id
     AND asset_id = v_asset_id
     AND employee_code = upper(btrim(p_employee_code))
     AND os_username = lower(btrim(p_os_username))
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'provisioning request mismatch');
  END IF;

  INSERT INTO public.device_user_credentials (
    provisioning_id, command_id, asset_id, employee_code, os_username, ciphertext
  ) VALUES (
    v_provisioning.id, p_command_id, v_asset_id,
    upper(btrim(p_employee_code)), lower(btrim(p_os_username)), p_ciphertext
  )
  ON CONFLICT (provisioning_id) DO UPDATE SET
    ciphertext = EXCLUDED.ciphertext,
    credential_status = 'prepared',
    expires_at = now() + interval '24 hours',
    revealed_at = NULL,
    consumed_by = NULL;
  RETURN jsonb_build_object('success', true);
END $$;

CREATE OR REPLACE FUNCTION public.agent_confirm_provisioning_credential(
  p_token text, p_command_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_asset_id uuid; v_changed integer;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;
  UPDATE public.device_user_credentials c
     SET credential_status = 'available'
    FROM public.device_user_provisioning p
   WHERE c.command_id = p_command_id AND c.provisioning_id = p.id
     AND c.asset_id = v_asset_id AND c.expires_at > now()
     AND c.credential_status = 'prepared';
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'credential not prepared');
  END IF;
  RETURN jsonb_build_object('success', true);
END $$;

CREATE OR REPLACE FUNCTION public.agent_revoke_provisioning_credential(
  p_token text, p_command_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_asset_id uuid;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;
  UPDATE public.device_user_credentials
     SET credential_status = 'revoked'
   WHERE command_id = p_command_id AND asset_id = v_asset_id
     AND credential_status IN ('prepared','available');
  RETURN jsonb_build_object('success', true);
END $$;

-- This is called only by the dedicated credential Edge Function. The
-- ciphertext is atomically consumed before it leaves the database.
CREATE OR REPLACE FUNCTION public.reveal_provisioning_credential(
  p_actor_user_id uuid, p_asset_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_credential public.device_user_credentials;
BEGIN
  SELECT role INTO v_role
    FROM public.profiles
   WHERE id = p_actor_user_id AND status = 'active';
  IF v_role NOT IN ('super_admin','it_admin') THEN
    RAISE EXCEPTION 'forbidden: super_admin or it_admin required';
  END IF;

  UPDATE public.device_user_credentials
     SET credential_status = 'expired'
   WHERE asset_id = p_asset_id
     AND credential_status IN ('prepared','available')
     AND expires_at <= now();

  SELECT * INTO v_credential
    FROM public.device_user_credentials
   WHERE asset_id = p_asset_id
     AND credential_status = 'available'
     AND expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'credential unavailable or already consumed');
  END IF;

  UPDATE public.device_user_credentials
     SET credential_status = 'consumed',
         revealed_at = now(),
         consumed_by = p_actor_user_id
   WHERE id = v_credential.id;

  RETURN jsonb_build_object(
    'success', true,
    'ciphertext', v_credential.ciphertext,
    'expires_at', v_credential.expires_at
  );
END $$;

-- Add provisioning state transitions to the existing agent command callback.
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
     SET status = p_status,
         result_message = COALESCE(p_result, result_message),
         error_message = COALESCE(p_error, error_message),
         completed_at = CASE WHEN p_status IN ('completed','failed','requires_admin')
                             THEN now() ELSE completed_at END
   WHERE id = p_command_id;

  -- Preserve the existing lock/unlock source of truth. Provisioning must be
  -- additive and cannot change any lock lifecycle behavior.
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

  IF v_ctype IN ('lock_screen','unlock') THEN
    SELECT asset_id INTO v_tag FROM public.assets WHERE id = v_asset_id;
    v_users := substring(COALESCE(p_result, '') FROM '\|USERS=([^|]*)');
    IF v_users IS NOT NULL AND btrim(v_users) <> '' THEN
      SELECT jsonb_agg(btrim(u)) INTO v_users_arr
        FROM unnest(string_to_array(v_users, ',')) AS u
       WHERE btrim(u) <> '';
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
      UPDATE public.device_user_credentials
         SET credential_status = 'revoked'
       WHERE command_id = p_command_id
         AND credential_status IN ('prepared','available');
    END IF;
    UPDATE public.device_user_provisioning
       SET provisioning_status = CASE
             WHEN p_status = 'completed' THEN 'provisioned'
             WHEN p_status IN ('failed','requires_admin') THEN 'failed'
             WHEN p_status = 'running' THEN 'provisioning'
             ELSE provisioning_status
           END,
           provisioned_at = CASE WHEN p_status = 'completed' THEN now() ELSE provisioned_at END,
           last_error = CASE WHEN p_status IN ('failed','requires_admin') THEN p_error ELSE NULL END,
           updated_at = now()
     WHERE command_id = p_command_id;

    SELECT asset_id INTO v_tag FROM public.assets WHERE id = v_asset_id;
    v_action := CASE
      WHEN p_status = 'running' THEN 'device.user_provision_executing'
      WHEN p_status = 'completed' THEN 'device.user_provision_success'
      ELSE 'device.user_provision_failed'
    END;
    v_label := CASE
      WHEN p_status = 'running' THEN 'Agent is provisioning employee account on '
      WHEN p_status = 'completed' THEN 'Employee OS account provisioned on '
      ELSE 'Employee OS account provisioning FAILED on '
    END;
    INSERT INTO public.audit_logs (
      actor_user_id, action, entity_type, entity_id, description, metadata
    ) VALUES (
      NULL, v_action, 'managed_device', v_dev_id,
      v_label || COALESCE(v_tag, 'device'),
      jsonb_strip_nulls(jsonb_build_object(
        'command_id', p_command_id,
        'asset_tag', v_tag,
        'status', p_status,
        'result', p_result,
        'error', p_error
      ))
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END $$;

GRANT EXECUTE ON FUNCTION public.get_user_provisioning(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_user_provisioning(uuid) TO authenticated;