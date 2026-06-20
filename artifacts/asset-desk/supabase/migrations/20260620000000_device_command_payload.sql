-- ============================================================================
-- Device command history — add command_payload to the returned row set
--
-- The previous version omitted command_payload, so the portal's "Reason given"
-- field in the audit log was always null. This additive CREATE OR REPLACE adds
-- command_payload to the SELECT so the portal can show the admin reason (e.g.
-- "HR Exit — employee offboarded", "Manual Admin Lock", "Asset Recovery").
-- No authz or RLS change — same guards as before.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.device_command_history(p_asset_id uuid, p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dev_id uuid;
  v_rows   jsonb;
BEGIN
  IF NOT public._hr_can_read() THEN
    RAISE EXCEPTION 'forbidden: IT or HR admin required';
  END IF;
  SELECT id INTO v_dev_id FROM public.managed_devices WHERE laptop_asset_id = p_asset_id;
  IF v_dev_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT dc.id, dc.command_type, dc.command_payload, dc.status,
           dc.requested_at, dc.executed_at,
           dc.completed_at, dc.result_message, dc.error_message,
           COALESCE(p.full_name, p.email, 'System') AS requested_by_name
      FROM public.device_commands dc
      LEFT JOIN public.profiles p ON p.id = dc.requested_by
     WHERE dc.managed_device_id = v_dev_id
     ORDER BY dc.requested_at DESC
     LIMIT GREATEST(p_limit, 1)
  ) t;

  RETURN v_rows;
END $$;

GRANT EXECUTE ON FUNCTION public.device_command_history(uuid, int) TO authenticated;
