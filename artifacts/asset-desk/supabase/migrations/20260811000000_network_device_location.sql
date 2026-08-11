-- Phase 1 device location: approximate public-IP location only.
-- This migration is intentionally local until explicitly approved/applied.

ALTER TABLE public.managed_devices
  ADD COLUMN IF NOT EXISTS location_source text,
  ADD COLUMN IF NOT EXISTS location_city text,
  ADD COLUMN IF NOT EXISTS location_region text,
  ADD COLUMN IF NOT EXISTS location_postal_code text,
  ADD COLUMN IF NOT EXISTS location_country text,
  ADD COLUMN IF NOT EXISTS location_public_ip text,
  ADD COLUMN IF NOT EXISTS location_latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS location_longitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS location_accuracy_m numeric,
  ADD COLUMN IF NOT EXISTS location_captured_at timestamptz;

ALTER TABLE public.managed_devices
  DROP CONSTRAINT IF EXISTS managed_devices_location_source_check;
ALTER TABLE public.managed_devices
  ADD CONSTRAINT managed_devices_location_source_check
  CHECK (location_source IS NULL OR location_source IN ('network', 'os'));

-- Effective agent_register definition after the existing removal lifecycle
-- migration. Location is written only when the server-side provider produced
-- a validated object; otherwise every existing location value is preserved.
CREATE OR REPLACE FUNCTION public.agent_register(
  p_token text, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset_id uuid;
  v_dev_id uuid;
  v_sn text := p_payload->>'serial_number';
  v_emp uuid;
  v_loc jsonb := CASE WHEN jsonb_typeof(p_payload->'location') = 'object'
                      THEN p_payload->'location' ELSE NULL END;
  v_lat numeric := CASE WHEN (p_payload->'location'->>'latitude') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                        THEN (p_payload->'location'->>'latitude')::numeric END;
  v_lon numeric := CASE WHEN (p_payload->'location'->>'longitude') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                        THEN (p_payload->'location'->>'longitude')::numeric END;
  v_acc numeric := CASE WHEN (p_payload->'location'->>'accuracy_m') ~ '^[0-9]+(\\.[0-9]+)?$'
                        THEN (p_payload->'location'->>'accuracy_m')::numeric END;
  v_loc_valid boolean := false;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token'); END IF;
  BEGIN
    v_loc_valid := COALESCE(v_loc->>'source' IN ('network','os'), false)
      AND v_lat BETWEEN -90 AND 90 AND v_lon BETWEEN -180 AND 180
      AND v_acc >= 0 AND (v_loc->>'captured_at')::timestamptz IS NOT NULL;
  EXCEPTION WHEN others THEN v_loc_valid := false;
  END;
  SELECT id INTO v_emp FROM public.profiles
    WHERE lower(email) = lower(p_payload->>'employee_email')
       OR lower(ecode) = lower(p_payload->>'employee_ecode') LIMIT 1;
  SELECT id INTO v_dev_id FROM public.managed_devices WHERE laptop_asset_id = v_asset_id;
  IF v_dev_id IS NULL THEN
    INSERT INTO public.managed_devices (
      laptop_asset_id, assigned_employee_id, serial_number, hostname, brand, model,
      processor, ram, storage, os_name, os_version, logged_in_username,
      employee_email, employee_ecode, ip_address, mac_address, agent_version,
      status, is_managed, last_seen_at,
      location_source, location_city, location_region, location_postal_code,
      location_country, location_public_ip, location_latitude, location_longitude,
      location_accuracy_m, location_captured_at
    ) VALUES (
      v_asset_id, v_emp, v_sn, p_payload->>'hostname', p_payload->>'brand', p_payload->>'model',
      p_payload->>'processor', p_payload->>'ram', p_payload->>'storage',
      p_payload->>'os_name', p_payload->>'os_version', p_payload->>'logged_in_username',
      p_payload->>'employee_email', p_payload->>'employee_ecode', p_payload->>'ip_address',
      p_payload->>'mac_address', p_payload->>'agent_version', 'online', true, now(),
      CASE WHEN v_loc_valid THEN v_loc->>'source' END, CASE WHEN v_loc_valid THEN v_loc->>'city' END,
      CASE WHEN v_loc_valid THEN v_loc->>'region' END, CASE WHEN v_loc_valid THEN v_loc->>'postal_code' END,
      CASE WHEN v_loc_valid THEN v_loc->>'country' END, CASE WHEN v_loc_valid THEN v_loc->>'public_ip' END,
      CASE WHEN v_loc_valid THEN v_lat END, CASE WHEN v_loc_valid THEN v_lon END,
      CASE WHEN v_loc_valid THEN v_acc END,
      CASE WHEN v_loc_valid THEN (v_loc->>'captured_at')::timestamptz END
    ) RETURNING id INTO v_dev_id;
  ELSE
    UPDATE public.managed_devices SET
      assigned_employee_id = COALESCE(v_emp, assigned_employee_id),
      serial_number = COALESCE(v_sn, serial_number), hostname = p_payload->>'hostname',
      brand = p_payload->>'brand', model = p_payload->>'model', processor = p_payload->>'processor',
      ram = p_payload->>'ram', storage = p_payload->>'storage', os_name = p_payload->>'os_name',
      os_version = p_payload->>'os_version', logged_in_username = p_payload->>'logged_in_username',
      employee_email = p_payload->>'employee_email', employee_ecode = p_payload->>'employee_ecode',
      ip_address = p_payload->>'ip_address', mac_address = p_payload->>'mac_address',
      agent_version = p_payload->>'agent_version', status = 'online', is_managed = true,
      last_seen_at = now(), updated_at = now(), agent_removed_at = NULL, agent_removed_by = NULL,
      agent_removed_reason = NULL, agent_remove_requested_at = NULL,
      location_source = CASE WHEN v_loc_valid THEN v_loc->>'source' ELSE location_source END,
      location_city = CASE WHEN v_loc_valid THEN v_loc->>'city' ELSE location_city END,
      location_region = CASE WHEN v_loc_valid THEN v_loc->>'region' ELSE location_region END,
      location_postal_code = CASE WHEN v_loc_valid THEN v_loc->>'postal_code' ELSE location_postal_code END,
      location_country = CASE WHEN v_loc_valid THEN v_loc->>'country' ELSE location_country END,
      location_public_ip = CASE WHEN v_loc_valid THEN v_loc->>'public_ip' ELSE location_public_ip END,
      location_latitude = CASE WHEN v_loc_valid THEN v_lat ELSE location_latitude END,
      location_longitude = CASE WHEN v_loc_valid THEN v_lon ELSE location_longitude END,
      location_accuracy_m = CASE WHEN v_loc_valid THEN v_acc ELSE location_accuracy_m END,
      location_captured_at = CASE WHEN v_loc_valid THEN (v_loc->>'captured_at')::timestamptz ELSE location_captured_at END
    WHERE id = v_dev_id;
  END IF;
  UPDATE public.agent_tokens SET managed_device_id = v_dev_id
    WHERE laptop_asset_id = v_asset_id AND is_active = true;
  INSERT INTO public.device_sync_logs (managed_device_id, sync_payload, sync_status, ip_address)
    VALUES (v_dev_id, p_payload, 'registered', p_payload->>'ip_address');
  RETURN jsonb_build_object('success', true, 'device_id', v_dev_id, 'asset_id', v_asset_id);
END $$;

-- Effective agent_sync definition after the polling migration. The existing
-- lock and poll response are preserved; only validated latest-location fields
-- are added to the managed-device update.
CREATE OR REPLACE FUNCTION public.agent_sync(
  p_token text, p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset_id uuid; v_dev_id uuid; v_locked boolean := false;
  v_active integer := 5; v_idle integer := 30;
  v_loc jsonb := CASE WHEN jsonb_typeof(p_payload->'location') = 'object' THEN p_payload->'location' ELSE NULL END;
  v_lat numeric; v_lon numeric; v_acc numeric; v_loc_valid boolean := false;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token'); END IF;
  SELECT id INTO v_dev_id FROM public.managed_devices WHERE laptop_asset_id = v_asset_id;
  IF v_dev_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'device not registered'); END IF;
  BEGIN
    v_lat := (v_loc->>'latitude')::numeric; v_lon := (v_loc->>'longitude')::numeric;
    v_acc := (v_loc->>'accuracy_m')::numeric;
    v_loc_valid := v_loc->>'source' IN ('network','os')
      AND v_lat BETWEEN -90 AND 90 AND v_lon BETWEEN -180 AND 180
      AND v_acc >= 0 AND (v_loc->>'captured_at')::timestamptz IS NOT NULL;
  EXCEPTION WHEN others THEN v_loc_valid := false;
  END;
  UPDATE public.managed_devices SET
    hostname = COALESCE(p_payload->>'hostname', hostname), processor = COALESCE(p_payload->>'processor', processor),
    ram = COALESCE(p_payload->>'ram', ram), storage = COALESCE(p_payload->>'storage', storage),
    os_name = COALESCE(p_payload->>'os_name', os_name), os_version = COALESCE(p_payload->>'os_version', os_version),
    logged_in_username = COALESCE(p_payload->>'logged_in_username', logged_in_username),
    ip_address = COALESCE(p_payload->>'ip_address', ip_address), mac_address = COALESCE(p_payload->>'mac_address', mac_address),
    agent_version = COALESCE(p_payload->>'agent_version', agent_version),
    uptime_seconds = COALESCE((p_payload->>'uptime_seconds')::bigint, uptime_seconds),
    last_boot_at = COALESCE((p_payload->>'last_boot_at')::timestamptz, last_boot_at),
    location_source = CASE WHEN v_loc_valid THEN v_loc->>'source' ELSE location_source END,
    location_city = CASE WHEN v_loc_valid THEN v_loc->>'city' ELSE location_city END,
    location_region = CASE WHEN v_loc_valid THEN v_loc->>'region' ELSE location_region END,
    location_postal_code = CASE WHEN v_loc_valid THEN v_loc->>'postal_code' ELSE location_postal_code END,
    location_country = CASE WHEN v_loc_valid THEN v_loc->>'country' ELSE location_country END,
    location_public_ip = CASE WHEN v_loc_valid THEN v_loc->>'public_ip' ELSE location_public_ip END,
    location_latitude = CASE WHEN v_loc_valid THEN v_lat ELSE location_latitude END,
    location_longitude = CASE WHEN v_loc_valid THEN v_lon ELSE location_longitude END,
    location_accuracy_m = CASE WHEN v_loc_valid THEN v_acc ELSE location_accuracy_m END,
    location_captured_at = CASE WHEN v_loc_valid THEN (v_loc->>'captured_at')::timestamptz ELSE location_captured_at END,
    status = 'online', last_seen_at = now(), updated_at = now()
  WHERE id = v_dev_id RETURNING is_locked INTO v_locked;
  INSERT INTO public.device_sync_logs (managed_device_id, sync_payload, sync_status, ip_address)
    VALUES (v_dev_id, p_payload, 'ok', p_payload->>'ip_address');
  SELECT agent_active_poll_sec, agent_idle_poll_sec INTO v_active, v_idle FROM public.org_settings WHERE id = true;
  RETURN jsonb_build_object('success', true, 'device_id', v_dev_id, 'locked', COALESCE(v_locked, false),
    'poll', jsonb_build_object('active', COALESCE(v_active, 5), 'idle', COALESCE(v_idle, 30)));
END $$;