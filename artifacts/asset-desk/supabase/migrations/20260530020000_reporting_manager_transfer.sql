-- ──────────────────────────────────────────────────────────
-- Reporting Manager Transfer
--   1. Adds hr_admin to the privileged role set on profiles policies.
--   2. Creates reporting_manager_history (audit trail + per-user timeline).
-- Safe to re-run.
-- ──────────────────────────────────────────────────────────

-- ─── 1. Widen profiles policies to include hr_admin ───────────────────────────
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (
    current_user_role() IN ('super_admin','it_admin','hr_admin','it_agent','end_user')
  );

CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT WITH CHECK (
    current_user_role() IN ('super_admin','it_admin','hr_admin')
  );

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (
    id = auth.uid()
    OR current_user_role() IN ('super_admin','it_admin','hr_admin')
  );

-- ─── 2. Reporting manager history / audit trail ───────────────────────────────
-- One row per affected employee per transfer operation. Rows belonging to a
-- single bulk operation share a batch_id so the audit trail can group them.
CREATE TABLE IF NOT EXISTS public.reporting_manager_history (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id           UUID NOT NULL,
  user_id            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name          TEXT,
  user_email         TEXT,
  event_type         TEXT NOT NULL CHECK (event_type IN ('reassigned', 'unassigned')),
  old_manager_email  TEXT,
  old_manager_name   TEXT,
  new_manager_email  TEXT,
  new_manager_name   TEXT,
  affected_count     INTEGER NOT NULL DEFAULT 1,
  event_by           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_by_name      TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rmh_user_id  ON public.reporting_manager_history(user_id);
CREATE INDEX IF NOT EXISTS idx_rmh_batch_id ON public.reporting_manager_history(batch_id);
CREATE INDEX IF NOT EXISTS idx_rmh_created  ON public.reporting_manager_history(created_at);

ALTER TABLE public.reporting_manager_history ENABLE ROW LEVEL SECURITY;

-- Custom tables need an explicit table GRANT in addition to RLS policies,
-- otherwise authenticated reads/writes silently return permission denied.
GRANT SELECT, INSERT ON public.reporting_manager_history TO authenticated;

DROP POLICY IF EXISTS "rmh_select" ON public.reporting_manager_history;
DROP POLICY IF EXISTS "rmh_insert" ON public.reporting_manager_history;

CREATE POLICY "rmh_select" ON public.reporting_manager_history
  FOR SELECT TO authenticated
  USING (current_user_role() IN ('super_admin', 'it_admin', 'hr_admin'));

CREATE POLICY "rmh_insert" ON public.reporting_manager_history
  FOR INSERT TO authenticated
  WITH CHECK (current_user_role() IN ('super_admin', 'it_admin', 'hr_admin'));
