-- ============================================================
-- Miles Education IT Asset Hub — Supabase Migrations
-- Run each section in: Supabase Dashboard → SQL Editor
-- Safe to run multiple times (IF NOT EXISTS / OR REPLACE).
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- SECTION 1 — New columns (from previous bug fixes)
-- ──────────────────────────────────────────────────────────

-- Persist the display name of the assigned user so it survives
-- page refreshes (Fix #2 from prior session).
ALTER TABLE assets ADD COLUMN IF NOT EXISTS assigned_to_name TEXT;

-- Persist ticket comments across sessions as a JSONB array
-- (Fix #5 from prior session). Matches existing schema definition.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS comments JSONB DEFAULT '[]'::jsonb;


-- ──────────────────────────────────────────────────────────
-- SECTION 2 — CRITICAL: Fix asset_type constraint
-- The original constraint only allows 'Laptop' and 'Mobile',
-- but the app supports 'Desktop'. Adding a Desktop asset
-- currently throws a DB constraint violation.
-- ──────────────────────────────────────────────────────────

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_asset_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_asset_type_check
  CHECK (asset_type IN ('Laptop', 'Mobile', 'Desktop'));


-- ──────────────────────────────────────────────────────────
-- SECTION 3 — CRITICAL: Fix profiles status case mismatch
-- DB stores 'Active'/'Inactive' (capitalised) but the app
-- normalises to lowercase 'active'/'inactive'. This causes
-- soft-deleted users to still appear active.
-- Option A: normalise existing rows to lowercase (recommended).
-- ──────────────────────────────────────────────────────────

UPDATE profiles SET status = LOWER(status) WHERE status != LOWER(status);

-- Also fix the default so new rows use lowercase:
ALTER TABLE profiles ALTER COLUMN status SET DEFAULT 'active';


-- ──────────────────────────────────────────────────────────
-- SECTION 4 — SECURITY CRITICAL: Close the open self-signup
-- RLS bypass. The current policies only check
--   auth.uid() IS NOT NULL
-- which means ANY self-registered stranger (even without a
-- profile row) can read all assets, tickets, and profiles by
-- calling the Supabase API directly with their JWT.
--
-- Fix: add a helper function that looks up the caller's role
-- from profiles, then tighten every policy.
-- ──────────────────────────────────────────────────────────

-- Helper: returns the role of the currently-authenticated user.
-- SECURITY DEFINER so it can read profiles regardless of its
-- own RLS policies, preventing infinite recursion.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;


-- Drop old permissive policies
DROP POLICY IF EXISTS "profiles_select"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_update"  ON public.profiles;
DROP POLICY IF EXISTS "assets_select"    ON public.assets;
DROP POLICY IF EXISTS "assets_insert"    ON public.assets;
DROP POLICY IF EXISTS "assets_update"    ON public.assets;
DROP POLICY IF EXISTS "assets_delete"    ON public.assets;
DROP POLICY IF EXISTS "tickets_select"   ON public.tickets;
DROP POLICY IF EXISTS "tickets_insert"   ON public.tickets;
DROP POLICY IF EXISTS "tickets_update"   ON public.tickets;
DROP POLICY IF EXISTS "tickets_delete"   ON public.tickets;
DROP POLICY IF EXISTS "asset_assignments_select" ON public.asset_assignments;
DROP POLICY IF EXISTS "asset_assignments_insert" ON public.asset_assignments;
DROP POLICY IF EXISTS "asset_returns_select"     ON public.asset_returns;
DROP POLICY IF EXISTS "asset_returns_insert"     ON public.asset_returns;


-- ── profiles ──────────────────────────────────────────────
-- Any logged-in user with a known role can read all profiles
-- (needed for user-picker dropdowns throughout the app).
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (
    current_user_role() IN ('super_admin','it_admin','it_agent','end_user')
  );

-- Only super_admin and it_admin can insert profiles.
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT WITH CHECK (
    current_user_role() IN ('super_admin','it_admin')
  );

-- Users can update their own profile; admins can update any.
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (
    id = auth.uid()
    OR current_user_role() IN ('super_admin','it_admin')
  );

-- Only super_admin can delete profiles.
CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE USING (
    current_user_role() = 'super_admin'
  );


-- ── assets ────────────────────────────────────────────────
-- IT staff and admins can read all assets.
-- End users can only read assets assigned to them.
CREATE POLICY "assets_select" ON public.assets
  FOR SELECT USING (
    current_user_role() IN ('super_admin','it_admin','it_agent')
    OR (
      current_user_role() = 'end_user'
      AND assigned_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
    )
  );

-- Only admins and agents can insert assets.
CREATE POLICY "assets_insert" ON public.assets
  FOR INSERT WITH CHECK (
    current_user_role() IN ('super_admin','it_admin','it_agent')
  );

-- Only admins and agents can update assets.
CREATE POLICY "assets_update" ON public.assets
  FOR UPDATE USING (
    current_user_role() IN ('super_admin','it_admin','it_agent')
  );

-- Only admins can delete assets.
CREATE POLICY "assets_delete" ON public.assets
  FOR DELETE USING (
    current_user_role() IN ('super_admin','it_admin')
  );


-- ── tickets ───────────────────────────────────────────────
-- IT staff see all tickets; end users see only their own.
CREATE POLICY "tickets_select" ON public.tickets
  FOR SELECT USING (
    current_user_role() IN ('super_admin','it_admin','it_agent')
    OR (
      current_user_role() = 'end_user'
      AND employee_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
    )
  );

-- Any authenticated user with a known role can raise a ticket.
CREATE POLICY "tickets_insert" ON public.tickets
  FOR INSERT WITH CHECK (
    current_user_role() IN ('super_admin','it_admin','it_agent','end_user')
  );

-- IT staff can update any ticket; end users can update their own (e.g., add comments).
CREATE POLICY "tickets_update" ON public.tickets
  FOR UPDATE USING (
    current_user_role() IN ('super_admin','it_admin','it_agent')
    OR (
      current_user_role() = 'end_user'
      AND employee_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
    )
  );

-- Only admins can delete tickets.
CREATE POLICY "tickets_delete" ON public.tickets
  FOR DELETE USING (
    current_user_role() IN ('super_admin','it_admin')
  );


-- ── asset_assignments & asset_returns ─────────────────────
CREATE POLICY "asset_assignments_select" ON public.asset_assignments
  FOR SELECT USING (current_user_role() IN ('super_admin','it_admin','it_agent'));

CREATE POLICY "asset_assignments_insert" ON public.asset_assignments
  FOR INSERT WITH CHECK (current_user_role() IN ('super_admin','it_admin','it_agent'));

CREATE POLICY "asset_returns_select" ON public.asset_returns
  FOR SELECT USING (current_user_role() IN ('super_admin','it_admin','it_agent'));

CREATE POLICY "asset_returns_insert" ON public.asset_returns
  FOR INSERT WITH CHECK (current_user_role() IN ('super_admin','it_admin','it_agent'));


-- ──────────────────────────────────────────────────────────
-- SECTION 5 — Clean up the test account created during QA
-- This removes the rogue account that was self-registered.
-- ──────────────────────────────────────────────────────────

-- Delete from profiles first (FK constraint), then auth.users.
DELETE FROM public.profiles WHERE email = 'penetrationtest@example.com';
-- To delete the auth user: Supabase Dashboard → Authentication → Users
-- → find penetrationtest@example.com → Delete User.
-- (Cannot delete auth.users rows via SQL in the public schema.)


-- ──────────────────────────────────────────────────────────
-- SECTION 6 — Performance: add indexes for common queries
-- ──────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_assets_status       ON public.assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_assigned_email ON public.assets(assigned_email);
CREATE INDEX IF NOT EXISTS idx_assets_asset_type   ON public.assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_tickets_employee_email ON public.tickets(employee_email);
CREATE INDEX IF NOT EXISTS idx_tickets_status      ON public.tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at  ON public.tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_email      ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role       ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_status     ON public.profiles(status);


-- ──────────────────────────────────────────────────────────
-- SECTION 7 — Fix profiles status check constraint
-- Ensure only lowercase values can be stored going forward.
-- ──────────────────────────────────────────────────────────

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('active', 'inactive'));


-- ──────────────────────────────────────────────────────────
-- AFTER RUNNING THIS FILE:
--
-- 1. Supabase Dashboard → Authentication → Settings
--    → "Allow new users to sign up" → DISABLE (toggle OFF)
--    This prevents anyone from self-registering without admin
--    involvement. User accounts must be created by IT admins only.
--
-- 2. Supabase Dashboard → Authentication → Users
--    → Delete "penetrationtest@example.com" if still present.
--
-- 3. Redeploy on Render after the code changes are pushed to GitHub.
-- ──────────────────────────────────────────────────────────


-- ──────────────────────────────────────────────────────────
-- SECTION X — Asset Assignment History Table
-- Run once in Supabase SQL editor to enable history tracking.
-- ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.asset_assignment_history (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id      TEXT NOT NULL,
  asset_name    TEXT,
  user_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name     TEXT,
  user_email    TEXT,
  user_ecode    TEXT,
  department    TEXT,
  event_type    TEXT NOT NULL CHECK (event_type IN ('assigned', 'returned', 'unassigned')),
  event_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_by_name TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.asset_assignment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignment_history_select" ON public.asset_assignment_history;
DROP POLICY IF EXISTS "assignment_history_insert" ON public.asset_assignment_history;

CREATE POLICY "assignment_history_select" ON public.asset_assignment_history
  FOR SELECT TO authenticated
  USING (current_user_role() IN ('super_admin', 'it_admin', 'it_agent'));

-- it_agent is included because assets_update already permits it_agent to
-- assign/return/unassign assets; without insert rights here the audit-trail
-- write would silently fail (RLS) and lose history for it_agent actions.
CREATE POLICY "assignment_history_insert" ON public.asset_assignment_history
  FOR INSERT TO authenticated
  WITH CHECK (current_user_role() IN ('super_admin', 'it_admin', 'it_agent'));

-- ─── Asset Ownership ──────────────────────────────────────────────────────────
-- Tracks who owns the asset (Miles, Miles-GCC, Mojo, Rented, Employee Owned,
-- or Company Owned — default). Safe to re-run.
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS ownership TEXT DEFAULT 'Miles';

ALTER TABLE public.assets ALTER COLUMN ownership SET DEFAULT 'Miles';

UPDATE public.assets
  SET ownership = 'Miles'
  WHERE ownership IS NULL OR ownership = '';


-- ──────────────────────────────────────────────────────────
-- SECTION XI — Reporting Manager Transfer
--   1. Adds hr_admin to privileged profiles policies.
--   2. Creates reporting_manager_history (audit trail + per-user timeline).
-- Safe to re-run.
-- ──────────────────────────────────────────────────────────

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

GRANT SELECT, INSERT ON public.reporting_manager_history TO authenticated;

DROP POLICY IF EXISTS "rmh_select" ON public.reporting_manager_history;
DROP POLICY IF EXISTS "rmh_insert" ON public.reporting_manager_history;

CREATE POLICY "rmh_select" ON public.reporting_manager_history
  FOR SELECT TO authenticated
  USING (current_user_role() IN ('super_admin', 'it_admin', 'hr_admin'));

CREATE POLICY "rmh_insert" ON public.reporting_manager_history
  FOR INSERT TO authenticated
  WITH CHECK (current_user_role() IN ('super_admin', 'it_admin', 'hr_admin'));

-- Allow the hr_admin role on profiles (Task #1 follow-up fix).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['super_admin'::text, 'it_admin'::text, 'hr_admin'::text, 'it_agent'::text, 'end_user'::text]));

-- Allow the "Sim Card" asset type (follow-up fix).
ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_asset_type_check;

ALTER TABLE public.assets
  ADD CONSTRAINT assets_asset_type_check
  CHECK (asset_type = ANY (ARRAY[
    'Laptop'::text, 'Desktop'::text, 'Monitor'::text, 'Mobile'::text, 'Tab'::text,
    'Sim Card'::text, 'Camera'::text, 'CPU'::text, 'Generic Asset'::text,
    'Keyboard'::text, 'Mouse'::text, 'Headset'::text, 'Hard Disk'::text,
    'Speaker'::text, 'Docking Station'::text, 'Printer'::text, 'Router'::text,
    'Server'::text, 'CCTV'::text, 'Smart TV'::text, 'Projector'::text,
    'Network Device'::text, 'Firewall'::text
  ]));


-- ──────────────────────────────────────────────────────────
-- Atomic Reporting Manager reassignment (history + update in one transaction).
-- ──────────────────────────────────────────────────────────
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
