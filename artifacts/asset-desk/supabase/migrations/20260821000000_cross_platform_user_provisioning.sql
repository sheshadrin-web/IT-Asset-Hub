-- Local-only extension of the existing provision_user request path.
-- Windows and Ubuntu/Linux use the same command, state, credentials, and audit model.

CREATE OR REPLACE FUNCTION public.request_user_provisioning(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_asset     record;
  v_profile   record;
  v_device    record;
  v_existing  public.device_user_provisioning;
  v_username  text;
  v_platform  text;
  v_command   uuid;
  v_row_id    uuid;
  v_tag       text;
  v_os        text;
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

  SELECT id, os_name, status, is_managed
    INTO v_device
    FROM public.managed_devices
   WHERE laptop_asset_id = p_asset_id
   FOR UPDATE;
  IF NOT FOUND OR v_device.is_managed IS NOT TRUE OR v_device.status <> 'online' THEN
    RAISE EXCEPTION 'agent must be online and managed before User Push';
  END IF;

  v_os := lower(COALESCE(v_device.os_name, v_asset.operating_system, ''));
  IF v_os LIKE '%mac%' OR v_os LIKE '%darwin%' THEN
    v_platform := 'macOS';
  ELSIF v_os LIKE '%windows%' OR v_os LIKE '%win32%' THEN
    v_platform := 'Windows';
  ELSIF v_os LIKE '%ubuntu%' OR v_os LIKE '%linux%' OR v_os LIKE '%debian%'
        OR v_os LIKE '%fedora%' OR v_os LIKE '%red hat%' OR v_os LIKE '%rhel%' THEN
    v_platform := 'Ubuntu/Linux';
  ELSE
    RAISE EXCEPTION 'User Push is not supported for this operating system';
  END IF;

  IF v_username IN (
    'root','daemon','nobody','miles-it-support','administrator',
    'defaultaccount','guest','wdagutilityaccount','system',
    'local service','network service','gdm','messagebus','syslog','_apt'
  ) THEN
    RAISE EXCEPTION 'Employee Code resolves to a protected system account';
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
    v_profile.full_name, v_profile.email, v_platform, v_username, 'standard',
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
      'platform', v_platform,
      'account_type', 'standard'
    )
  );

  RETURN jsonb_build_object(
    'success', true, 'command_id', v_command, 'provisioning_id', v_row_id,
    'provisioning_status', 'pending', 'os_username', v_username,
    'platform', v_platform
  );
END $$;

REVOKE ALL ON FUNCTION public.request_user_provisioning(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_user_provisioning(uuid) TO authenticated;