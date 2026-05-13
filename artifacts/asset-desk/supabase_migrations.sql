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
