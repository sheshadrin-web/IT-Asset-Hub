-- ════════════════════════════════════════════════════════════════════════════
-- 007_unattended_access_optin.sql
-- Commit 5: the missing super_admin control to opt a device IN/OUT of unattended
-- remote access.
--
-- WHY: 003 added managed_devices.unattended_enabled (default FALSE) and
-- issue_remote_session_token rejects unattended sessions for any device whose
-- flag is FALSE with "Unattended access is not enabled for this device". No RPC
-- or UI ever set the flag, so unattended access could never succeed. These two
-- RPCs let a super_admin read and flip the per-device opt-in. PURELY ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════

-- ── get_device_unattended_access (PORTAL, read) ─────────────────────────────
-- Returns whether the device is enrolled with an agent and whether unattended
-- access is currently enabled. Visible to both admin roles so the Remote Access
-- modal can show accurate state (only super_admin may actually flip it).
CREATE OR REPLACE FUNCTION public.get_device_unattended_access(p_asset_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role    TEXT;
  v_enabled BOOLEAN;
  v_found   BOOLEAN;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid() AND status = 'active';
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF v_role NOT IN ('super_admin', 'it_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  SELECT unattended_enabled INTO v_enabled
    FROM managed_devices
   WHERE laptop_asset_id = p_asset_id;
  v_found := FOUND;

  RETURN jsonb_build_object(
    'success',  true,
    'enrolled', v_found,
    'enabled',  COALESCE(v_enabled, false)
  );
END;
$$;

-- ── set_device_unattended_access (PORTAL, super_admin write) ─────────────────
CREATE OR REPLACE FUNCTION public.set_device_unattended_access(p_asset_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_rows INT;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid() AND status = 'active';
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF v_role <> 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unattended access requires super_admin');
  END IF;

  UPDATE managed_devices
     SET unattended_enabled = p_enabled
   WHERE laptop_asset_id = p_asset_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Device is not enrolled with an agent');
  END IF;

  PERFORM _log_remote_access_audit(
    CASE WHEN p_enabled THEN 'remote_access.unattended_enabled'
         ELSE 'remote_access.unattended_disabled' END,
    p_asset_id, NULL,
    CASE WHEN p_enabled THEN 'Unattended remote access enabled for this device'
         ELSE 'Unattended remote access disabled for this device' END
  );

  RETURN jsonb_build_object('success', true, 'enabled', p_enabled);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_device_unattended_access(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_device_unattended_access(uuid, boolean) TO authenticated;
