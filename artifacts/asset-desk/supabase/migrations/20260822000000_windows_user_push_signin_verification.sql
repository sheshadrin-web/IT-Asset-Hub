-- Agent-only credential-state attestation for safe provision_user replays.
-- This intentionally returns status metadata only: no ciphertext, password, or
-- credential expiry data leaves the database through this RPC.
CREATE OR REPLACE FUNCTION public.agent_get_provisioning_credential_status(
  p_token text, p_command_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_asset_id uuid;
  v_status text;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;

  UPDATE public.device_user_credentials c
     SET credential_status = 'expired'
   WHERE c.command_id = p_command_id
     AND c.asset_id = v_asset_id
     AND c.credential_status IN ('prepared', 'available')
     AND c.expires_at <= now();

  SELECT c.credential_status INTO v_status
    FROM public.device_user_credentials c
    JOIN public.device_commands dc ON dc.id = c.command_id
    JOIN public.managed_devices md ON md.id = dc.managed_device_id
   WHERE c.command_id = p_command_id
     AND c.asset_id = v_asset_id
     AND md.laptop_asset_id = v_asset_id
   FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'credential not found for this command');
  END IF;
  IF v_status <> 'available' THEN
    RETURN jsonb_build_object('success', false, 'error', 'credential is not available');
  END IF;

  RETURN jsonb_build_object('success', true, 'credential_status', v_status);
END $$;

REVOKE ALL ON FUNCTION public.agent_get_provisioning_credential_status(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_get_provisioning_credential_status(text, uuid)
  TO service_role;