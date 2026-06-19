-- ════════════════════════════════════════════════════════════════════════════
-- 009_location_rls_and_rpcs.sql
-- Supplements 008: lets a location_gm READ the assets in their mapped locations,
-- and provides a SECURITY DEFINER RPC for scoped condition updates (RLS cannot
-- restrict which columns an UPDATE touches, so granting a location_gm raw UPDATE
-- on assets would be too broad — the RPC limits writes to condition fields only).
-- PURELY ADDITIVE. Existing assets policies are untouched (RLS policies OR together).
-- ════════════════════════════════════════════════════════════════════════════

-- ── location_gm may read assets in their mapped, view-enabled locations ──────
DROP POLICY IF EXISTS assets_select_location_gm ON public.assets;
CREATE POLICY assets_select_location_gm ON public.assets FOR SELECT
  USING (
    public.current_user_role() = 'location_gm'
    AND location IN (
      SELECT location FROM public.user_location_access
      WHERE user_id = auth.uid() AND can_view_assets
    )
  );

-- ── set_asset_condition: scoped condition write ─────────────────────────────
-- IT staff (super_admin/it_admin/it_agent) may set condition on any asset.
-- A location_gm may set condition only on assets in their mapped locations.
CREATE OR REPLACE FUNCTION public.set_asset_condition(
  p_asset_id  uuid,
  p_condition text,
  p_notes     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text;
  v_location text;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid() AND status = 'active';
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF p_condition NOT IN ('Good','Needs Inspection','Under Repair','Damaged','Lost','Scrapped','Returned','Recovery Pending') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid condition');
  END IF;

  SELECT location INTO v_location FROM assets WHERE id = p_asset_id;
  IF v_location IS NULL AND NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Asset not found');
  END IF;

  IF v_role IN ('super_admin','it_admin','it_agent') THEN
    -- allowed for any asset
    NULL;
  ELSIF v_role = 'location_gm' THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_location_access
      WHERE user_id = auth.uid() AND can_view_assets
        AND location = (SELECT location FROM assets WHERE id = p_asset_id)
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not permitted for this location');
    END IF;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  UPDATE assets
     SET condition            = p_condition,
         condition_notes      = p_notes,
         condition_updated_by = auth.uid(),
         condition_updated_at = now()
   WHERE id = p_asset_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
