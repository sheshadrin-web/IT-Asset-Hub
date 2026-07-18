-- ──────────────────────────────────────────────────────────
-- Atomic Reporting Manager reassignment.
--   Writes the audit/history rows AND updates profiles inside a single
--   transaction (a plpgsql function body is one transaction), so a transfer
--   can never succeed without its audit trail being recorded — if either step
--   fails, the whole operation rolls back.
-- Safe to re-run.
-- ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.change_reporting_manager(
  p_user_ids          UUID[],
  p_new_manager_email TEXT,
  p_notes             TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role        TEXT;
  v_batch       UUID := gen_random_uuid();
  v_actor       UUID := auth.uid();
  v_actor_name  TEXT;
  v_is_unassign BOOLEAN;
  v_new_email   TEXT;
  v_new_name    TEXT;
  v_count       INTEGER;
BEGIN
  -- Authorize: only privileged admins may reassign managers (mirrors RLS).
  v_role := current_user_role();
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'it_admin', 'hr_admin') THEN
    RAISE EXCEPTION 'forbidden: role % may not reassign reporting managers', COALESCE(v_role, 'unknown');
  END IF;

  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('count', 0, 'batch_id', NULL);
  END IF;

  v_new_email   := COALESCE(TRIM(p_new_manager_email), '');
  v_is_unassign := v_new_email = '';

  SELECT full_name INTO v_actor_name FROM profiles WHERE id = v_actor;

  IF NOT v_is_unassign THEN
    SELECT full_name INTO v_new_name
    FROM profiles
    WHERE LOWER(TRIM(email)) = LOWER(v_new_email)
    LIMIT 1;
    v_new_name := COALESCE(v_new_name, v_new_email);
  END IF;

  SELECT COUNT(*) INTO v_count FROM profiles WHERE id = ANY(p_user_ids);

  IF v_count = 0 THEN
    RETURN jsonb_build_object('count', 0, 'batch_id', NULL);
  END IF;

  -- 1. Record the audit trail FIRST (captures the OLD manager from profiles).
  INSERT INTO reporting_manager_history (
    batch_id, user_id, user_name, user_email, event_type,
    old_manager_email, old_manager_name, new_manager_email, new_manager_name,
    affected_count, event_by, event_by_name, notes
  )
  SELECT
    v_batch, p.id, p.full_name, p.email,
    CASE WHEN v_is_unassign THEN 'unassigned' ELSE 'reassigned' END,
    NULLIF(TRIM(p.reporting_manager), ''),
    COALESCE(om.full_name, NULLIF(TRIM(p.reporting_manager), '')),
    CASE WHEN v_is_unassign THEN NULL ELSE v_new_email END,
    CASE WHEN v_is_unassign THEN NULL ELSE v_new_name END,
    v_count, v_actor, v_actor_name, p_notes
  FROM profiles p
  LEFT JOIN profiles om
    ON LOWER(TRIM(om.email)) = LOWER(NULLIF(TRIM(p.reporting_manager), ''))
  WHERE p.id = ANY(p_user_ids);

  -- 2. Apply the reassignment. If this fails, step 1 rolls back too.
  UPDATE profiles
  SET reporting_manager = v_new_email,
      updated_at        = NOW()
  WHERE id = ANY(p_user_ids);

  RETURN jsonb_build_object('count', v_count, 'batch_id', v_batch);
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_reporting_manager(UUID[], TEXT, TEXT) TO authenticated;
