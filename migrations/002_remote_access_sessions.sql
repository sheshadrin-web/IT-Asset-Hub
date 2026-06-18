-- ============================================================
-- Migration 002: Remote Access Sessions
-- Date: 2026-06-18
-- ============================================================
-- SAFE TO RUN MULTIPLE TIMES (IF NOT EXISTS / CREATE OR REPLACE throughout)
-- NO existing production data is modified, renamed, or deleted.
-- ============================================================

-- ── 1. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS remote_access_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      UUID        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  agent_key_id  UUID        REFERENCES agent_tokens(id) ON DELETE SET NULL,
  requested_by  UUID        NOT NULL REFERENCES profiles(id),
  mode          TEXT        NOT NULL
                CHECK (mode IN ('assisted', 'unattended')),
  status        TEXT        NOT NULL DEFAULT 'requested'
                CHECK (status IN ('requested', 'approved', 'denied', 'active', 'ended', 'failed')),
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE remote_access_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage remote_access_sessions" ON remote_access_sessions;
CREATE POLICY "admins manage remote_access_sessions"
  ON remote_access_sessions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
       WHERE id = auth.uid()
         AND role IN ('super_admin', 'it_admin')
         AND status = 'active'
    )
  );

-- ── 2. Internal audit-log helper ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _log_remote_access_audit(
  p_action      TEXT,
  p_asset_id    UUID,
  p_session_id  UUID,
  p_description TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- audit_logs schema: actor_user_id (uuid), action, entity_type, entity_id (uuid),
  --                    description, metadata (jsonb) — no actor_name/actor_email columns
  INSERT INTO audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    description,
    metadata
  ) VALUES (
    auth.uid(),
    p_action,
    'remote_access',
    p_asset_id,
    p_description,
    jsonb_build_object('session_id', p_session_id)
  );
END;
$$;

-- ── 3. RPC: request_remote_access ────────────────────────────────────────────
-- Creates a new remote access session and writes an audit log entry.
-- Returns: { success, session_id } or { success: false, error }

CREATE OR REPLACE FUNCTION request_remote_access(
  p_asset_id     UUID,
  p_agent_key_id UUID,
  p_mode         TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role       TEXT;
  v_session_id UUID;
BEGIN
  -- Auth check
  SELECT role INTO v_role
    FROM profiles
   WHERE id = auth.uid() AND status = 'active';

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF v_role NOT IN ('super_admin', 'it_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  -- Unattended mode requires super_admin
  IF p_mode = 'unattended' AND v_role <> 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unattended access requires super_admin role');
  END IF;

  IF p_mode NOT IN ('assisted', 'unattended') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid mode: must be assisted or unattended');
  END IF;

  -- Create session
  INSERT INTO remote_access_sessions (asset_id, agent_key_id, requested_by, mode, status)
  VALUES (p_asset_id, p_agent_key_id, auth.uid(), p_mode, 'requested')
  RETURNING id INTO v_session_id;

  -- Audit log
  PERFORM _log_remote_access_audit(
    'remote_access.requested',
    p_asset_id,
    v_session_id,
    'Remote access (' || p_mode || ') session requested'
  );

  RETURN jsonb_build_object('success', true, 'session_id', v_session_id);
END;
$$;

-- ── 4. RPC: update_remote_access_session ─────────────────────────────────────
-- Transitions a session to a new status and writes an audit log entry.
-- Valid transitions: requested → approved | denied | active | failed
--                   approved  → active | denied | failed
--                   active    → ended | failed

CREATE OR REPLACE FUNCTION update_remote_access_session(
  p_session_id UUID,
  p_status     TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role    TEXT;
  v_session remote_access_sessions;
  v_action  TEXT;
  v_desc    TEXT;
BEGIN
  SELECT role INTO v_role
    FROM profiles
   WHERE id = auth.uid() AND status = 'active';

  IF v_role NOT IN ('super_admin', 'it_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  SELECT * INTO v_session
    FROM remote_access_sessions
   WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found');
  END IF;

  IF p_status NOT IN ('approved', 'denied', 'active', 'ended', 'failed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid status');
  END IF;

  -- Apply transition
  IF p_status = 'active' THEN
    UPDATE remote_access_sessions
       SET status = 'active', started_at = NOW()
     WHERE id = p_session_id;
    v_action := 'remote_access.started';
    v_desc   := 'Remote access session started (' || v_session.mode || ')';

  ELSIF p_status IN ('ended', 'failed') THEN
    UPDATE remote_access_sessions
       SET status = p_status, ended_at = NOW()
     WHERE id = p_session_id;
    v_action := 'remote_access.ended';
    v_desc   := 'Remote access session ' || p_status || ' (' || v_session.mode || ')';

  ELSIF p_status = 'approved' THEN
    UPDATE remote_access_sessions SET status = 'approved' WHERE id = p_session_id;
    v_action := 'remote_access.approved';
    v_desc   := 'Remote access session approved';

  ELSIF p_status = 'denied' THEN
    UPDATE remote_access_sessions SET status = 'denied' WHERE id = p_session_id;
    v_action := 'remote_access.denied';
    v_desc   := 'Remote access session denied';
  END IF;

  PERFORM _log_remote_access_audit(v_action, v_session.asset_id, p_session_id, v_desc);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── 5. RPC: get_remote_access_sessions ───────────────────────────────────────
-- Returns recent sessions for an asset as JSONB (newest first).

CREATE OR REPLACE FUNCTION get_remote_access_sessions(
  p_asset_id UUID,
  p_limit    INTEGER DEFAULT 10
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
    FROM profiles
   WHERE id = auth.uid() AND status = 'active';

  IF v_role NOT IN ('super_admin', 'it_admin') THEN
    RETURN '[]'::JSONB;
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(r ORDER BY r.created_at DESC), '[]'::JSONB)
      FROM (
        SELECT
          ras.id,
          ras.mode,
          ras.status,
          ras.started_at,
          ras.ended_at,
          ras.created_at,
          p.full_name AS requested_by_name
        FROM remote_access_sessions ras
        LEFT JOIN profiles p ON p.id = ras.requested_by
        WHERE ras.asset_id = p_asset_id
        ORDER BY ras.created_at DESC
        LIMIT p_limit
      ) r
  );
END;
$$;
