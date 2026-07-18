-- ============================================================================
-- Miles IT Assets — Company Wallpaper / Logo push (Phase 1)
-- Tables : wallpapers, device_wallpaper_status
-- Bucket : storage.buckets 'wallpapers' (public read, super_admin write)
-- RPCs   : wallpaper_register, wallpaper_set_active, wallpaper_push_to_asset
--          agent_get_active_wallpaper, agent_report_wallpaper
-- ============================================================================

-- ── wallpapers ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallpapers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  storage_path  text NOT NULL UNIQUE,
  public_url    text NOT NULL,
  mime_type     text,
  sha256        text NOT NULL,
  file_size     bigint,
  is_active     boolean NOT NULL DEFAULT false,
  uploaded_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallpapers_active_idx ON public.wallpapers(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS wallpapers_uploaded_idx ON public.wallpapers(uploaded_at DESC);

-- Only one row may be active at a time
CREATE UNIQUE INDEX IF NOT EXISTS wallpapers_one_active_idx
  ON public.wallpapers((is_active)) WHERE is_active = true;

-- ── device_wallpaper_status ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.device_wallpaper_status (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  managed_device_id  uuid NOT NULL REFERENCES public.managed_devices(id) ON DELETE CASCADE,
  wallpaper_id       uuid REFERENCES public.wallpapers(id) ON DELETE SET NULL,
  status             text NOT NULL CHECK (status IN ('pending','applied','failed','skipped')),
  error_message      text,
  applied_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_wallpaper_status_device_idx
  ON public.device_wallpaper_status(managed_device_id, applied_at DESC);

-- ── RLS — read for authenticated, mutate only via SECURITY DEFINER ──────────
ALTER TABLE public.wallpapers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_wallpaper_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallpapers_read              ON public.wallpapers;
DROP POLICY IF EXISTS device_wallpaper_status_read ON public.device_wallpaper_status;
CREATE POLICY wallpapers_read              ON public.wallpapers              FOR SELECT TO authenticated USING (true);
CREATE POLICY device_wallpaper_status_read ON public.device_wallpaper_status FOR SELECT TO authenticated USING (true);

-- ── storage bucket: 'wallpapers' public ─────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('wallpapers', 'wallpapers', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS wallpapers_bucket_public_read  ON storage.objects;
DROP POLICY IF EXISTS wallpapers_bucket_admin_write  ON storage.objects;
DROP POLICY IF EXISTS wallpapers_bucket_admin_delete ON storage.objects;

CREATE POLICY wallpapers_bucket_public_read ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'wallpapers');

CREATE POLICY wallpapers_bucket_admin_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'wallpapers' AND public._is_super_admin());

CREATE POLICY wallpapers_bucket_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'wallpapers' AND public._is_super_admin());

-- ============================================================================
-- ADMIN RPCs (called from the portal UI)
-- ============================================================================

-- After the client uploads the file to storage, it calls this to register the
-- row. Returns the new wallpaper id.
CREATE OR REPLACE FUNCTION public.wallpaper_register(
  p_name         text,
  p_storage_path text,
  p_public_url   text,
  p_sha256       text,
  p_mime_type    text DEFAULT NULL,
  p_file_size    bigint DEFAULT NULL,
  p_set_active   boolean DEFAULT false
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

  INSERT INTO public.wallpapers (name, storage_path, public_url, sha256, mime_type, file_size, is_active, uploaded_by)
  VALUES (p_name, p_storage_path, p_public_url, p_sha256, p_mime_type, p_file_size, p_set_active, v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'wallpaper_id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.wallpaper_set_active(p_wallpaper_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public._is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  UPDATE public.wallpapers SET is_active = false WHERE is_active = true;
  UPDATE public.wallpapers SET is_active = true  WHERE id = p_wallpaper_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallpaper not found'; END IF;
  RETURN jsonb_build_object('success', true);
END $$;

-- "Push to device" queues a sync_now command — agent will pull the active
-- wallpaper on its very next sync (within seconds instead of waiting for the
-- 5-minute interval).
CREATE OR REPLACE FUNCTION public.wallpaper_push_to_asset(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dev RECORD;
  v_id  uuid;
BEGIN
  IF NOT public._is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  SELECT id INTO v_dev FROM public.managed_devices WHERE laptop_asset_id = p_asset_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'no managed device for this asset');
  END IF;
  INSERT INTO public.device_commands (managed_device_id, command_type, requested_by)
  VALUES (v_dev.id, 'update_wallpaper', v_uid)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'command_id', v_id);
END $$;

-- ============================================================================
-- AGENT RPCs (invoked from Edge Function with service-role)
-- ============================================================================

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
  SELECT id, name, public_url, sha256, mime_type
    INTO v_w
    FROM public.wallpapers
   WHERE is_active = true
   ORDER BY uploaded_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'wallpaper', NULL);
  END IF;
  RETURN jsonb_build_object('success', true, 'wallpaper', jsonb_build_object(
    'id', v_w.id, 'name', v_w.name, 'url', v_w.public_url,
    'sha256', v_w.sha256, 'mime_type', v_w.mime_type
  ));
END $$;

CREATE OR REPLACE FUNCTION public.agent_report_wallpaper(
  p_token        text,
  p_wallpaper_id uuid,
  p_status       text,
  p_error        text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset_id uuid;
  v_dev_id   uuid;
BEGIN
  v_asset_id := public._auth_agent(p_token);
  IF v_asset_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid or revoked token');
  END IF;
  IF p_status NOT IN ('applied','failed','skipped') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid status');
  END IF;

  SELECT id INTO v_dev_id FROM public.managed_devices WHERE laptop_asset_id = v_asset_id;
  IF v_dev_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'device not registered');
  END IF;

  INSERT INTO public.device_wallpaper_status (managed_device_id, wallpaper_id, status, error_message)
  VALUES (v_dev_id, p_wallpaper_id, p_status, p_error);

  -- If this was triggered by an update_wallpaper command, close any pending one.
  UPDATE public.device_commands
     SET status = CASE WHEN p_status = 'applied' THEN 'completed' ELSE 'failed' END,
         completed_at  = now(),
         result_message = CASE WHEN p_status = 'applied' THEN 'Wallpaper applied' ELSE NULL END,
         error_message  = p_error
   WHERE managed_device_id = v_dev_id
     AND command_type = 'update_wallpaper'
     AND status IN ('pending','running');

  RETURN jsonb_build_object('success', true);
END $$;

GRANT EXECUTE ON FUNCTION public.wallpaper_register(text, text, text, text, text, bigint, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wallpaper_set_active(uuid)                                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.wallpaper_push_to_asset(uuid)                                     TO authenticated;
