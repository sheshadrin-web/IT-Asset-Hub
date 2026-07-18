-- ============================================================================
-- Miles IT Assets — Wallpaper resolution variants
-- Adds `variants` jsonb to wallpapers so we can ship the right-sized image
-- per laptop resolution (1920x1080, 2560x1440, 3840x2160, …) composited on a
-- dark background. Agent picks the variant matching its screen.
-- variants schema: [{ "width": int, "height": int, "url": text, "sha256": text }]
-- ============================================================================

ALTER TABLE public.wallpapers
  ADD COLUMN IF NOT EXISTS variants jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Replace wallpaper_register so it accepts the variants payload
CREATE OR REPLACE FUNCTION public.wallpaper_register(
  p_name         text,
  p_storage_path text,
  p_public_url   text,
  p_sha256       text,
  p_mime_type    text DEFAULT NULL,
  p_file_size    bigint DEFAULT NULL,
  p_set_active   boolean DEFAULT false,
  p_variants     jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF NOT public._is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;

  IF p_set_active THEN
    UPDATE public.wallpapers SET is_active = false WHERE is_active = true;
  END IF;

  INSERT INTO public.wallpapers (
    name, storage_path, public_url, sha256, mime_type, file_size, is_active, uploaded_by, variants
  ) VALUES (
    p_name, p_storage_path, p_public_url, p_sha256, p_mime_type, p_file_size, p_set_active, v_uid,
    COALESCE(p_variants, '[]'::jsonb)
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'wallpaper_id', v_id);
END $$;

-- Agent endpoint — now includes variants[] so the agent can pick the right size
CREATE OR REPLACE FUNCTION public.agent_get_active_wallpaper(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset_id uuid;
  v_w        RECORD;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;
  SELECT id, name, public_url, sha256, mime_type, variants
    INTO v_w
    FROM public.wallpapers
   WHERE is_active = true
   ORDER BY uploaded_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'wallpaper', NULL);
  END IF;
  RETURN jsonb_build_object('success', true, 'wallpaper', jsonb_build_object(
    'id', v_w.id, 'name', v_w.name, 'url', v_w.public_url,
    'sha256', v_w.sha256, 'mime_type', v_w.mime_type,
    'variants', COALESCE(v_w.variants, '[]'::jsonb)
  ));
END $$;

GRANT EXECUTE ON FUNCTION public.wallpaper_register(text, text, text, text, text, bigint, boolean, jsonb) TO authenticated;
