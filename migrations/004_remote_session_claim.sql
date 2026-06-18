-- 004_remote_session_claim.sql
-- Commit 2 (validation hardening): single-agent enforcement + richer token info.
--
-- 1. agent_get_remote_session_token now also returns session_id + asset_id so the
--    agent can report its device_id in the transport handshake.
-- 2. agent_claim_remote_session: the first agent instance to claim a session wins;
--    any other instance presenting the SAME token is rejected. This prevents two
--    agents from serving one session (one stolen/shared token can't fan out).
--
-- Purely additive: two nullable columns + one CREATE OR REPLACE + one new RPC.

ALTER TABLE public.remote_access_sessions
  ADD COLUMN IF NOT EXISTS agent_instance_id  TEXT,
  ADD COLUMN IF NOT EXISTS agent_connected_at TIMESTAMPTZ;

-- ── agent_get_remote_session_token (now returns session_id + asset_id) ───────
CREATE OR REPLACE FUNCTION public.agent_get_remote_session_token(p_token text, p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_asset_id UUID;
  v_session  remote_access_sessions;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;

  SELECT * INTO v_session FROM remote_access_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session not found');
  END IF;
  IF v_session.asset_id <> v_asset_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'session does not belong to this device');
  END IF;

  IF v_session.session_token IS NULL OR v_session.status <> 'active' THEN
    RETURN jsonb_build_object('success', true, 'ready', false, 'status', v_session.status);
  END IF;
  IF v_session.token_expires_at < NOW() THEN
    RETURN jsonb_build_object('success', true, 'ready', false, 'status', v_session.status, 'error', 'token expired');
  END IF;

  RETURN jsonb_build_object(
    'success',       true,
    'ready',         true,
    'session_id',    v_session.id,
    'asset_id',      v_session.asset_id,
    'session_token', v_session.session_token,
    'channel_name',  v_session.channel_name,
    'status',        v_session.status,
    'input_enabled', v_session.input_enabled,
    'mode',          v_session.mode,
    'expires_at',    v_session.token_expires_at
  );
END;
$function$;

-- ── agent_claim_remote_session (single-agent lock) ──────────────────────────
-- Atomically binds the session to ONE agent instance. The first caller sets
-- agent_instance_id; later callers with a different instance are rejected even
-- though they hold a valid token. Re-claims by the same instance are idempotent
-- (so a transient reconnect by the same agent process still works).
CREATE OR REPLACE FUNCTION public.agent_claim_remote_session(
  p_token text, p_session_id uuid, p_instance_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_asset_id UUID;
  v_session  remote_access_sessions;
  v_claimed  BOOLEAN;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'claimed', false, 'error', 'invalid or revoked token');
  END IF;
  IF p_instance_id IS NULL OR length(p_instance_id) < 8 THEN
    RETURN jsonb_build_object('success', false, 'claimed', false, 'error', 'missing instance id');
  END IF;

  SELECT * INTO v_session FROM remote_access_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'claimed', false, 'error', 'session not found');
  END IF;
  IF v_session.asset_id <> v_asset_id THEN
    RETURN jsonb_build_object('success', false, 'claimed', false, 'error', 'session does not belong to this device');
  END IF;
  IF v_session.session_token IS NULL OR v_session.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'claimed', false, 'error', 'session not active');
  END IF;
  IF v_session.token_expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'claimed', false, 'error', 'token expired');
  END IF;

  -- Atomic compare-and-set: win only if unclaimed OR already ours.
  UPDATE remote_access_sessions
     SET agent_instance_id  = p_instance_id,
         agent_connected_at = NOW()
   WHERE id = p_session_id
     AND (agent_instance_id IS NULL OR agent_instance_id = p_instance_id)
  RETURNING true INTO v_claimed;

  IF v_claimed IS NOT TRUE THEN
    PERFORM public._log_remote_access_audit(
      'remote_access.claim_rejected', v_session.asset_id, p_session_id,
      'A second agent instance attempted to claim an already-claimed session');
    RETURN jsonb_build_object('success', true, 'claimed', false,
                              'error', 'session already claimed by another agent');
  END IF;

  PERFORM public._log_remote_access_audit(
    'remote_access.agent_connected', v_session.asset_id, p_session_id,
    'Agent instance claimed the remote session');
  RETURN jsonb_build_object('success', true, 'claimed', true);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.agent_claim_remote_session(text, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.agent_get_remote_session_token(text, uuid)    TO anon;
