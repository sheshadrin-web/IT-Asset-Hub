-- ════════════════════════════════════════════════════════════════════════════
-- 003_remote_desktop_foundation.sql
-- Commit 1 of the in-house remote desktop engine: DB + session-token foundation.
--
-- PURELY ADDITIVE. No existing column, row, RPC, or behavior is modified.
-- Existing remote-access request/approve/deny flow keeps working unchanged.
--
-- Token model (foundation): each session carries a short-lived shared secret
-- (`session_token`) plus a derived Realtime `channel_name`. The session UUID is
-- itself an unguessable rendezvous; the token is the app-layer auth secret that
-- both peers (portal viewer + device agent) present. The portal ISSUES the token
-- (issue_remote_session_token); the agent RETRIEVES the same token after it has
-- approved (agent_get_remote_session_token). Defense-in-depth (Realtime private
-- channels + RLS, token rotation) lands in the later security-hardening commit.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Session columns ──────────────────────────────────────────────────────
ALTER TABLE remote_access_sessions
  ADD COLUMN IF NOT EXISTS session_token       TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS channel_name        TEXT,
  ADD COLUMN IF NOT EXISTS viewer_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_frame_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS input_enabled       BOOLEAN NOT NULL DEFAULT TRUE;

-- ── 2. Per-device unattended opt-in ─────────────────────────────────────────
ALTER TABLE managed_devices
  ADD COLUMN IF NOT EXISTS unattended_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 3. issue_remote_session_token (PORTAL) ──────────────────────────────────
-- Called by the portal once a session is approved (assisted) or authorised
-- (unattended). Generates the shared secret + channel, marks the session active.
CREATE OR REPLACE FUNCTION public.issue_remote_session_token(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role    TEXT;
  v_session remote_access_sessions;
  v_token   TEXT;
  v_channel TEXT;
  v_expires TIMESTAMPTZ;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid() AND status = 'active';
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF v_role NOT IN ('super_admin', 'it_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  SELECT * INTO v_session FROM remote_access_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found');
  END IF;

  -- Assisted sessions must be approved (or already active) before a token issues.
  IF v_session.mode = 'assisted' AND v_session.status NOT IN ('approved', 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session is not approved yet');
  END IF;

  -- Unattended sessions require super_admin AND the device opt-in flag.
  IF v_session.mode = 'unattended' THEN
    IF v_role <> 'super_admin' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unattended access requires super_admin');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM managed_devices
       WHERE laptop_asset_id = v_session.asset_id AND unattended_enabled = TRUE
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unattended access is not enabled for this device');
    END IF;
  END IF;

  v_token   := encode(extensions.gen_random_bytes(32), 'hex');
  v_channel := 'remote:session:' || p_session_id::text;
  v_expires := NOW() + INTERVAL '10 minutes';

  UPDATE remote_access_sessions
     SET session_token    = v_token,
         channel_name     = v_channel,
         token_expires_at = v_expires,
         status           = 'active',
         started_at       = COALESCE(started_at, NOW())
   WHERE id = p_session_id;

  PERFORM _log_remote_access_audit(
    'remote_access.token_issued', v_session.asset_id, p_session_id,
    'Remote session token issued; viewer connecting (' || v_session.mode || ')'
  );

  RETURN jsonb_build_object(
    'success',       true,
    'session_id',    p_session_id,
    'token',         v_token,
    'channel_name',  v_channel,
    'expires_at',    v_expires,
    'input_enabled', v_session.input_enabled,
    'mode',          v_session.mode
  );
END;
$$;

-- ── 4. agent_get_remote_session_token (AGENT) ───────────────────────────────
-- The agent calls this after approving, polling until the portal has issued the
-- token. Returns ready=false while waiting so the agent simply keeps polling.
CREATE OR REPLACE FUNCTION public.agent_get_remote_session_token(p_token text, p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    'session_token', v_session.session_token,
    'channel_name',  v_session.channel_name,
    'status',        v_session.status,
    'input_enabled', v_session.input_enabled,
    'mode',          v_session.mode,
    'expires_at',    v_session.token_expires_at
  );
END;
$$;

-- ── 5. validate_remote_session_token (EITHER PEER) ──────────────────────────
CREATE OR REPLACE FUNCTION public.validate_remote_session_token(p_token text, p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session remote_access_sessions;
BEGIN
  SELECT * INTO v_session FROM remote_access_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'session not found');
  END IF;
  IF v_session.session_token IS NULL OR v_session.session_token <> p_token THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid token');
  END IF;
  IF v_session.status <> 'active' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'session not active', 'status', v_session.status);
  END IF;
  IF v_session.token_expires_at < NOW() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'token expired');
  END IF;
  RETURN jsonb_build_object(
    'valid',         true,
    'channel_name',  v_session.channel_name,
    'status',        v_session.status,
    'input_enabled', v_session.input_enabled,
    'mode',          v_session.mode
  );
END;
$$;

-- ── 6. heartbeat_remote_session (EITHER PEER) ───────────────────────────────
-- Keepalive: refreshes liveness timestamps and slides the token expiry forward.
-- Returns the live status so a peer learns when the other side ends the session.
CREATE OR REPLACE FUNCTION public.heartbeat_remote_session(p_session_id uuid, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session remote_access_sessions;
BEGIN
  SELECT * INTO v_session FROM remote_access_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session not found');
  END IF;
  IF v_session.session_token IS NULL OR v_session.session_token <> p_token THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid token');
  END IF;
  IF v_session.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'session not active', 'status', v_session.status);
  END IF;

  UPDATE remote_access_sessions
     SET last_frame_at       = NOW(),
         viewer_connected_at = COALESCE(viewer_connected_at, NOW()),
         token_expires_at    = NOW() + INTERVAL '10 minutes'
   WHERE id = p_session_id;

  RETURN jsonb_build_object('success', true, 'status', v_session.status);
END;
$$;

-- ── 7. Grants ───────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.issue_remote_session_token(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_remote_session_token(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_get_remote_session_token(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_remote_session(uuid, text)     TO anon, authenticated;
