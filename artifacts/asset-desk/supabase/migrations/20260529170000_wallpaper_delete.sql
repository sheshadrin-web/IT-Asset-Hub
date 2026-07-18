-- ============================================================================
-- Miles IT Assets — delete a wallpaper from the library
-- Adds wallpaper_delete(p_wallpaper_id): super_admin only. Removes the DB row
-- and returns its storage_path so the client can purge the storage folder
-- (original + every resolution variant live under the same `<stem>/` prefix).
-- The ACTIVE wallpaper cannot be deleted — set another active first, otherwise
-- managed devices would point at a deleted image.
-- device_wallpaper_status.wallpaper_id is ON DELETE SET NULL, so history rows
-- are preserved (the wallpaper just becomes NULL there).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.wallpaper_delete(p_wallpaper_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_active boolean;
  v_path   text;
BEGIN
  IF NOT public._is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  SELECT is_active, storage_path INTO v_active, v_path
  FROM public.wallpapers WHERE id = p_wallpaper_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'wallpaper not found');
  END IF;

  IF v_active THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Cannot delete the active wallpaper. Set another wallpaper active first.');
  END IF;

  DELETE FROM public.wallpapers WHERE id = p_wallpaper_id;

  RETURN jsonb_build_object('success', true, 'storage_path', v_path);
END $$;

GRANT EXECUTE ON FUNCTION public.wallpaper_delete(uuid) TO authenticated;
