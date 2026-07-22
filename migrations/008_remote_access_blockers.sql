-- ============================================================================
-- Migration 008 — Phase 2A: Four Critical Blocker Fixes
-- ============================================================================
-- PURELY ADDITIVE. No existing column, row, RPC, or behaviour is removed.
-- Safe to run multiple times (IF NOT EXISTS / CREATE OR REPLACE throughout).
-- ============================================================================

-- ── 1. Missing session-end columns ──────────────────────────────────────────
-- All three are nullable so existing rows are unaffected.

ALTER TABLE public.remote_access_sessions
  ADD COLUMN IF NOT EXISTS ended_by         TEXT,
  ADD COLUMN IF NOT EXISTS end_reason       TEXT,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

COMMENT ON COLUMN public.remote_access_sessions.ended_by IS
  'Who ended the session: employee | administrator | timeout | agent | network | error';
COMMENT ON COLUMN public.remote_access_sessions.end_reason IS
  'Short machine-readable reason for the session ending (e.g. employee_disconnect, session_timeout_1h).';
COMMENT ON COLUMN public.remote_access_sessions.duration_seconds IS
  'Wall-clock seconds the transport was live, as reported by the agent or computed by the portal.';

-- ── 2. Fix issue_remote_session_token — idempotent activation ───────────────
-- Problem: every call regenerated a new token even if the session was already
-- active, invalidating any token the agent had already retrieved and joined
-- with.  The RemoteTransportTest component (now DEV-only in the portal) was
-- calling this RPC first; then the real viewer called it again and overwrote
-- the token.
--
-- Fix: if the session is already active with an unexpired token, return the
-- existing values without touching the row.  Only generate a fresh token when
-- the session is transitioning from approved→active OR when the current token
-- has expired and needs renewal.
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
  -- ── Auth check ─────────────────────────────────────────────────────────────
  SELECT role INTO v_role
    FROM profiles
   WHERE id = auth.uid() AND status = 'active';

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF v_role NOT IN ('super_admin', 'it_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  -- ── Load session (WITH row lock) ──────────────────────────────────────────
  -- FOR UPDATE serializes concurrent callers: if two viewers call this at the
  -- same time on the same session (e.g. modal transport-test races with viewer),
  -- the second call blocks here until the first commits, then re-reads the
  -- now-active row and hits the idempotency guard below — returning the token the
  -- first call generated rather than overwriting it with a new one.
  SELECT * INTO v_session
    FROM remote_access_sessions
   WHERE id = p_session_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found');
  END IF;

  -- ── Reject terminal states ─────────────────────────────────────────────────
  IF v_session.status IN ('ended', 'failed', 'denied') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Session is already ' || v_session.status || ' and cannot be activated'
    );
  END IF;

  -- ── Mode-specific checks ───────────────────────────────────────────────────
  -- Assisted: must be approved or already active.
  IF v_session.mode = 'assisted' AND v_session.status NOT IN ('approved', 'active') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session is not approved yet');
  END IF;

  -- Unattended: super_admin + device opt-in.
  IF v_session.mode = 'unattended' THEN
    IF v_role <> 'super_admin' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unattended access requires super_admin');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM managed_devices
       WHERE laptop_asset_id = v_session.asset_id AND unattended_enabled = TRUE
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Unattended access is not enabled for this device'
      );
    END IF;
  END IF;

  -- ── Idempotency guard ──────────────────────────────────────────────────────
  -- If the session is already active with a valid, unexpired token return the
  -- existing token/channel without regenerating — a second call (e.g. from a
  -- reconnecting viewer) must not invalidate the token the agent already has.
  IF v_session.status = 'active'
     AND v_session.session_token    IS NOT NULL
     AND v_session.channel_name     IS NOT NULL
     AND v_session.token_expires_at IS NOT NULL
     AND v_session.token_expires_at > NOW() THEN

    RETURN jsonb_build_object(
      'success',       true,
      'session_id',    p_session_id,
      'token',         v_session.session_token,
      'channel_name',  v_session.channel_name,
      'expires_at',    v_session.token_expires_at,
      'input_enabled', v_session.input_enabled,
      'mode',          v_session.mode
    );
  END IF;

  -- ── Generate token (fresh activation or expired-token renewal) ─────────────
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
    'remote_access.token_issued',
    v_session.asset_id,
    p_session_id,
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

-- ── 3. agent_end_remote_session — idempotent agent-side session end ──────────
-- The agent calls this when the session ends for ANY reason (employee
-- disconnect, timeout, network failure, capture error, shutdown, etc.).
-- Idempotent: if the session is already ended it returns the existing final
-- state without error so multiple calls (retry, crash-restart) are safe.
CREATE OR REPLACE FUNCTION public.agent_end_remote_session(
  p_token            TEXT,
  p_session_id       UUID,
  p_ended_by         TEXT,    -- employee | administrator | timeout | agent | network | error
  p_end_reason       TEXT,    -- short machine-readable reason string
  p_duration_seconds INTEGER  -- wall-clock seconds the transport was live
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_id UUID;
  v_session  remote_access_sessions;
BEGIN
  -- ── Agent authentication ───────────────────────────────────────────────────
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;

  -- ── Load session (WITH row lock) ──────────────────────────────────────────
  -- FOR UPDATE prevents a concurrent end call from both reading status='active'
  -- and both executing the UPDATE, which would leave the last writer's
  -- ended_by/end_reason in the audit row and potentially overwrite a more
  -- accurate value from the first writer.
  SELECT * INTO v_session
    FROM remote_access_sessions
   WHERE id = p_session_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session not found');
  END IF;

  -- ── Ownership check ────────────────────────────────────────────────────────
  -- Reject attempts from another device's agent.
  IF v_session.asset_id <> v_asset_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'session does not belong to this device'
    );
  END IF;

  -- ── Idempotency: already ended ─────────────────────────────────────────────
  -- Return the current final state without error so retries are safe.
  IF v_session.status = 'ended' THEN
    RETURN jsonb_build_object(
      'success',          true,
      'already_ended',    true,
      'ended_at',         v_session.ended_at,
      'ended_by',         v_session.ended_by,
      'end_reason',       v_session.end_reason,
      'duration_seconds', v_session.duration_seconds
    );
  END IF;

  -- ── Guard: only transition from active or approved ─────────────────────────
  -- failed/denied/requested are terminal or pre-activation states.
  IF v_session.status NOT IN ('active', 'approved') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'session cannot be ended from status: ' || v_session.status
    );
  END IF;

  -- ── Apply the end ──────────────────────────────────────────────────────────
  -- The AND status != 'ended' guard is the concurrency safety net: if two
  -- concurrent calls both passed the idempotency guard above (both read
  -- status='active' before either committed), the second UPDATE is a no-op
  -- rather than overwriting the first writer's ended_by/end_reason values.
  UPDATE remote_access_sessions
     SET status           = 'ended',
         ended_at         = COALESCE(ended_at, NOW()),
         ended_by         = p_ended_by,
         end_reason       = p_end_reason,
         duration_seconds = p_duration_seconds
   WHERE id = p_session_id
     AND status != 'ended';

  PERFORM _log_remote_access_audit(
    'remote_access.agent_ended',
    v_session.asset_id,
    p_session_id,
    'Session ended by agent — ended_by: ' || COALESCE(p_ended_by, 'unknown') ||
    CASE WHEN p_end_reason IS NOT NULL
         THEN ' (' || p_end_reason || ')'
         ELSE '' END
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── 4. Grants ────────────────────────────────────────────────────────────────
-- agent_end_remote_session uses anon/agent-token auth (same as claim/bind).
GRANT EXECUTE ON FUNCTION public.agent_end_remote_session(TEXT, UUID, TEXT, TEXT, INTEGER) TO anon;
-- Re-grant issue_remote_session_token in case the REPLACE reset it.
GRANT EXECUTE ON FUNCTION public.issue_remote_session_token(UUID) TO authenticated;
