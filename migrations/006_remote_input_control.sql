-- ============================================================================
-- Migration 006 — Remote INPUT control state + audit
-- ============================================================================
-- Commit 4 of the custom remote-desktop engine. Adds the server-side record and
-- audit trail for when an admin takes/releases mouse+keyboard control of a
-- machine during a remote session.
--
-- The actual input transport is the SAME private Realtime channel proven in
-- Commit 3 (`remote:session:<id>`), so the existing RLS gate already governs
-- whether input may flow: a terminated or token-expired session can no longer
-- write to the channel. This migration is the *system of record* for the
-- control toggle: it flips `remote_access_sessions.input_enabled` and writes an
-- `input_enabled` / `input_disabled` row to `audit_logs` for compliance.
-- ============================================================================

-- Record + audit a control take / release for a session.
-- Authorization mirrors renew_remote_session_token: caller must be an active
-- it_admin/super_admin AND either the session's requester or a super_admin.
CREATE OR REPLACE FUNCTION public.log_remote_input_state(p_session_id uuid, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role    text;
  v_session remote_access_sessions;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid() AND status = 'active';
  IF v_role NOT IN ('super_admin', 'it_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  SELECT * INTO v_session FROM remote_access_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found');
  END IF;
  IF v_session.requested_by <> auth.uid() AND NOT public._is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not your session');
  END IF;

  -- Releasing control is always allowed (so we can always disable on teardown);
  -- enabling control requires the session to still be active.
  IF p_enabled AND v_session.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not active');
  END IF;

  UPDATE remote_access_sessions
     SET input_enabled = p_enabled
   WHERE id = p_session_id;

  PERFORM _log_remote_access_audit(
    CASE WHEN p_enabled THEN 'remote_access.input_enabled'
                        ELSE 'remote_access.input_disabled' END,
    v_session.asset_id,
    p_session_id,
    CASE WHEN p_enabled
         THEN 'Admin took mouse & keyboard control of the machine'
         ELSE 'Admin released mouse & keyboard control of the machine' END
  );

  RETURN jsonb_build_object('success', true, 'input_enabled', p_enabled);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.log_remote_input_state(uuid, boolean) TO authenticated;
