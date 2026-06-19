-- ============================================================================
-- Migration 005 — Private per-session Realtime channels for remote desktop
-- ============================================================================
-- Commit 3 of the custom remote-desktop engine. Frames flow ONLY over a private
-- Supabase Realtime broadcast channel `remote:session:<id>` gated by RLS on
-- `realtime.messages`. Two identities may use a channel:
--
--   * Portal (admin) — authorizes with their own auth JWT; allowed when they are
--     the session's requester or a super_admin.
--   * Agent — authorizes with a short-lived GENUINE Supabase auth token minted by
--     the Edge Function (admin generateLink magiclink -> verifyOtp). The resulting
--     ephemeral user id is bound to the session via agent_bind_realtime_uid() and
--     matched here.
--
-- The RLS gate ALSO requires the session to be active with an unexpired token, so
-- ending or expiring a session immediately revokes channel access for both sides.
--
-- NOTE: HMAC-signing an agent JWT inside the DB is not possible on this project —
-- the in-use JWT signing key is asymmetric ES256 and no HS256 secret is reachable
-- from SQL (no app.settings.jwt_secret, no jwt GUCs, empty vault). The genuine
-- short-lived token approach above is used instead.
-- ============================================================================

-- 1. Ephemeral agent identity bound to a session ------------------------------
ALTER TABLE public.remote_access_sessions
  ADD COLUMN IF NOT EXISTS agent_realtime_uid uuid;

COMMENT ON COLUMN public.remote_access_sessions.agent_realtime_uid IS
  'Ephemeral auth.users id of the agent identity authorized to join this session''s private Realtime channel. Set by agent_bind_realtime_uid().';

-- 2. Topic authorization helper ----------------------------------------------
-- Returns true iff the caller (auth.uid()) may read/write the private channel
-- for the session encoded in the Realtime topic `remote:session:<uuid>`.
CREATE OR REPLACE FUNCTION public._authz_remote_topic(p_topic text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sid uuid;
BEGIN
  IF p_topic IS NULL OR left(p_topic, 15) <> 'remote:session:' THEN
    RETURN false;
  END IF;
  BEGIN
    v_sid := substr(p_topic, 16)::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  RETURN EXISTS (
    SELECT 1
      FROM public.remote_access_sessions s
     WHERE s.id = v_sid
       AND s.status = 'active'
       AND s.token_expires_at IS NOT NULL
       AND s.token_expires_at > now()
       AND (
            -- Portal side: the requesting admin, or any super_admin.
            (auth.uid() IS NOT NULL
              AND (s.requested_by = auth.uid() OR public._is_super_admin()))
            -- Agent side: the ephemeral identity bound to this exact session.
            OR (s.agent_realtime_uid IS NOT NULL
              AND s.agent_realtime_uid = auth.uid())
       )
  );
END;
$function$;

-- 3. RLS policies on realtime.messages ---------------------------------------
-- realtime.messages already has RLS enabled by Supabase. These policies scope
-- broadcast read/write to the per-session topic, gated by the helper above.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS remote_session_read  ON realtime.messages;
DROP POLICY IF EXISTS remote_session_write ON realtime.messages;

CREATE POLICY remote_session_read
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (public._authz_remote_topic((SELECT realtime.topic())));

CREATE POLICY remote_session_write
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (public._authz_remote_topic((SELECT realtime.topic())));

-- 4. Bind an agent's ephemeral identity to a session -------------------------
-- Called by the Edge Function after minting the short-lived agent token. The
-- agent token (device-scoped) proves the caller owns the device; the bound uid
-- is then accepted by _authz_remote_topic() for this session only.
CREATE OR REPLACE FUNCTION public.agent_bind_realtime_uid(p_token text, p_session_id uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_asset   uuid;
  v_session remote_access_sessions;
BEGIN
  v_asset := public._auth_agent(p_token);
  IF v_asset IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;

  SELECT * INTO v_session FROM remote_access_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session not found');
  END IF;
  IF v_session.asset_id <> v_asset THEN
    RETURN jsonb_build_object('success', false, 'error', 'session does not belong to this device');
  END IF;
  IF v_session.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'session not active');
  END IF;

  UPDATE remote_access_sessions
     SET agent_realtime_uid = p_uid
   WHERE id = p_session_id;

  PERFORM _log_remote_access_audit(
    'remote_access.agent_realtime_bound', v_session.asset_id, p_session_id,
    'Agent bound an ephemeral realtime identity for the private channel'
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 5. Renew a session token so long viewing sessions don't expire -------------
CREATE OR REPLACE FUNCTION public.renew_remote_session_token(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role    text;
  v_session remote_access_sessions;
  v_expires timestamptz;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid() AND status = 'active';
  IF v_role NOT IN ('super_admin', 'it_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  SELECT * INTO v_session FROM remote_access_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found');
  END IF;
  IF v_session.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not active');
  END IF;
  IF v_session.requested_by <> auth.uid() AND NOT public._is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not your session');
  END IF;

  v_expires := now() + interval '10 minutes';
  UPDATE remote_access_sessions SET token_expires_at = v_expires WHERE id = p_session_id;
  RETURN jsonb_build_object('success', true, 'expires_at', v_expires);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.renew_remote_session_token(uuid) TO authenticated;
