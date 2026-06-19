-- ════════════════════════════════════════════════════════════════════════════
-- 008_location_module.sql
-- Location-wise Assets module: real location_gm role, per-user location access,
-- DB-backed asset condition tracking, shortage requests, and return/recovery
-- requests.
--
-- PURELY ADDITIVE & BACKWARD-COMPATIBLE:
--   * No existing rows are deleted; no existing columns dropped or retyped.
--   * Existing assets are backfilled with a real `condition` derived from their
--     current status (Good unless status says otherwise), per requirement.
--   * `asset_returns` (the post-return record) is left untouched. The new
--     `asset_return_requests` is the location workflow/approval table and is a
--     separate concern.
-- RLS mirrors the existing pattern: role checks via public.current_user_role().
-- ════════════════════════════════════════════════════════════════════════════

-- ── shared updated_at trigger ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- A. Role: add location_gm to the profiles role CHECK constraint
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY[
    'super_admin'::text, 'it_admin'::text, 'hr_admin'::text,
    'it_agent'::text, 'end_user'::text, 'location_gm'::text
  ]));

-- ════════════════════════════════════════════════════════════════════════════
-- B. Asset condition tracking (additive columns on assets)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS condition            text,
  ADD COLUMN IF NOT EXISTS condition_updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS condition_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS condition_notes      text;

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_condition_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_condition_check
  CHECK (condition IS NULL OR condition = ANY (ARRAY[
    'Good'::text, 'Needs Inspection'::text, 'Under Repair'::text,
    'Damaged'::text, 'Lost'::text, 'Scrapped'::text,
    'Returned'::text, 'Recovery Pending'::text
  ]));

-- Backfill existing assets: Good unless current status indicates otherwise.
UPDATE public.assets SET condition = CASE
    WHEN status = 'Under Repair'   THEN 'Under Repair'
    WHEN status = 'Lost'           THEN 'Lost'
    WHEN status = 'Recovery Stage' THEN 'Recovery Pending'
    WHEN status = 'Retired'        THEN 'Scrapped'
    ELSE 'Good'
  END
  WHERE condition IS NULL;

ALTER TABLE public.assets ALTER COLUMN condition SET DEFAULT 'Good';

-- ════════════════════════════════════════════════════════════════════════════
-- C. user_location_access — maps existing users to one or more locations
--    (location stored as the location NAME text, matching assets.location /
--     LOCATION_OPTIONS; there is no separate locations table in this schema.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.user_location_access (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  location                      text NOT NULL,
  access_role                   text NOT NULL DEFAULT 'location_gm'
                                  CHECK (access_role = ANY (ARRAY['location_gm'::text, 'location_admin'::text])),
  can_view_assets               boolean NOT NULL DEFAULT true,
  can_raise_requests            boolean NOT NULL DEFAULT true,
  can_mark_received             boolean NOT NULL DEFAULT false,
  can_release_after_it_approval boolean NOT NULL DEFAULT false,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, location)
);
CREATE INDEX IF NOT EXISTS idx_user_location_access_user     ON public.user_location_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_location_access_location ON public.user_location_access(location);

-- ════════════════════════════════════════════════════════════════════════════
-- D. asset_shortage_requests — location GMs request more assets from Bangalore
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.asset_shortage_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location           text NOT NULL,
  requested_by       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  asset_type         text NOT NULL,
  quantity_requested integer NOT NULL CHECK (quantity_requested > 0),
  quantity_available integer NOT NULL DEFAULT 0,
  priority           text NOT NULL DEFAULT 'Medium'
                       CHECK (priority = ANY (ARRAY['Low'::text,'Medium'::text,'High'::text,'Critical'::text])),
  reason             text,
  status             text NOT NULL DEFAULT 'Pending'
                       CHECK (status = ANY (ARRAY['Pending'::text,'Approved'::text,'Partially Approved'::text,'Rejected'::text,'Fulfilled'::text])),
  approved_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shortage_location ON public.asset_shortage_requests(location);
CREATE INDEX IF NOT EXISTS idx_shortage_status   ON public.asset_shortage_requests(status);
DROP TRIGGER IF EXISTS trg_shortage_updated_at ON public.asset_shortage_requests;
CREATE TRIGGER trg_shortage_updated_at BEFORE UPDATE ON public.asset_shortage_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- E. asset_return_requests — return/replacement/repair workflow to Bangalore
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.asset_return_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id         uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  location         text NOT NULL,
  requested_by     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason           text,
  return_type      text NOT NULL
                     CHECK (return_type = ANY (ARRAY['Employee Exit'::text,'Hardware Issue'::text,'Damaged'::text,'Replacement'::text,'Repair'::text,'Lost Recovery'::text,'Other'::text])),
  status           text NOT NULL DEFAULT 'Pending IT Review'
                     CHECK (status = ANY (ARRAY['Pending IT Review'::text,'Approved'::text,'Courier Pending'::text,'In Transit'::text,'Received at Bangalore'::text,'Under Inspection'::text,'Closed'::text])),
  approved_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  courier_tracking text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_return_req_location ON public.asset_return_requests(location);
CREATE INDEX IF NOT EXISTS idx_return_req_status   ON public.asset_return_requests(status);
CREATE INDEX IF NOT EXISTS idx_return_req_asset    ON public.asset_return_requests(asset_id);
DROP TRIGGER IF EXISTS trg_return_req_updated_at ON public.asset_return_requests;
CREATE TRIGGER trg_return_req_updated_at BEFORE UPDATE ON public.asset_return_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- F. Row Level Security (mirrors existing current_user_role() pattern)
-- ════════════════════════════════════════════════════════════════════════════

-- ── user_location_access ────────────────────────────────────────────────────
ALTER TABLE public.user_location_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ula_select ON public.user_location_access;
CREATE POLICY ula_select ON public.user_location_access FOR SELECT
  USING (
    public.current_user_role() = ANY (ARRAY['super_admin','it_admin','it_agent'])
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS ula_write ON public.user_location_access;
CREATE POLICY ula_write ON public.user_location_access FOR ALL
  USING      (public.current_user_role() = ANY (ARRAY['super_admin','it_admin']))
  WITH CHECK (public.current_user_role() = ANY (ARRAY['super_admin','it_admin']));

-- ── asset_shortage_requests ─────────────────────────────────────────────────
ALTER TABLE public.asset_shortage_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shortage_select ON public.asset_shortage_requests;
CREATE POLICY shortage_select ON public.asset_shortage_requests FOR SELECT
  USING (
    public.current_user_role() = ANY (ARRAY['super_admin','it_admin','it_agent'])
    OR requested_by = auth.uid()
    OR location IN (SELECT location FROM public.user_location_access WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS shortage_insert ON public.asset_shortage_requests;
CREATE POLICY shortage_insert ON public.asset_shortage_requests FOR INSERT
  WITH CHECK (
    requested_by = auth.uid()
    AND (
      public.current_user_role() = ANY (ARRAY['super_admin','it_admin','it_agent'])
      OR location IN (SELECT location FROM public.user_location_access
                       WHERE user_id = auth.uid() AND can_raise_requests)
    )
  );

-- Only Super Admin + Bangalore IT (it_admin) approve/finalise shortage requests.
DROP POLICY IF EXISTS shortage_update ON public.asset_shortage_requests;
CREATE POLICY shortage_update ON public.asset_shortage_requests FOR UPDATE
  USING      (public.current_user_role() = ANY (ARRAY['super_admin','it_admin']))
  WITH CHECK (public.current_user_role() = ANY (ARRAY['super_admin','it_admin']));

-- ── asset_return_requests ───────────────────────────────────────────────────
ALTER TABLE public.asset_return_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS return_req_select ON public.asset_return_requests;
CREATE POLICY return_req_select ON public.asset_return_requests FOR SELECT
  USING (
    public.current_user_role() = ANY (ARRAY['super_admin','it_admin','it_agent'])
    OR requested_by = auth.uid()
    OR location IN (SELECT location FROM public.user_location_access WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS return_req_insert ON public.asset_return_requests;
CREATE POLICY return_req_insert ON public.asset_return_requests FOR INSERT
  WITH CHECK (
    requested_by = auth.uid()
    AND (
      public.current_user_role() = ANY (ARRAY['super_admin','it_admin','it_agent'])
      OR location IN (SELECT location FROM public.user_location_access
                       WHERE user_id = auth.uid() AND can_raise_requests)
    )
  );

-- Super Admin + Bangalore IT approve/advance the workflow. Location GMs with
-- can_mark_received may move their own-location requests forward (e.g. confirm
-- receipt) but final approval/replacement release stays with Bangalore IT.
DROP POLICY IF EXISTS return_req_update ON public.asset_return_requests;
CREATE POLICY return_req_update ON public.asset_return_requests FOR UPDATE
  USING (
    public.current_user_role() = ANY (ARRAY['super_admin','it_admin'])
    OR (
      location IN (SELECT location FROM public.user_location_access
                    WHERE user_id = auth.uid() AND can_mark_received)
    )
  )
  WITH CHECK (
    public.current_user_role() = ANY (ARRAY['super_admin','it_admin'])
    OR location IN (SELECT location FROM public.user_location_access
                     WHERE user_id = auth.uid() AND can_mark_received)
  );
