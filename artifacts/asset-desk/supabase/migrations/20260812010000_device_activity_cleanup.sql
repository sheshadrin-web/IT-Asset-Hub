-- ============================================================================
-- Device activity cleanup controls
--
-- These controls let IT clean up stale command noise without deleting:
--   * asset assignment history
--   * security audit_logs
--   * the managed device or agent key
--
-- A pending lock can be cancelled only before the agent claims it. Running
-- commands are intentionally left alone because the device may still apply
-- them and report completion.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.clear_device_lock_pending(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dev_id uuid;
  v_cancelled integer := 0;
  v_running integer := 0;
BEGIN
  IF NOT public._hr_can_act() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden: administrator required');
  END IF;

  SELECT id INTO v_dev_id
    FROM public.managed_devices
   WHERE laptop_asset_id = p_asset_id;
  IF v_dev_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no managed device for this asset');
  END IF;

  SELECT count(*)::integer INTO v_running
    FROM public.device_commands
   WHERE managed_device_id = v_dev_id
     AND command_type IN ('lock_screen', 'unlock')
     AND status = 'running';
  IF v_running > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'the lock command is already executing and cannot be cleared safely'
    );
  END IF;

  UPDATE public.device_commands
     SET status = 'cancelled',
         completed_at = now(),
         error_message = 'Cancelled by administrator before agent execution'
   WHERE managed_device_id = v_dev_id
     AND command_type IN ('lock_screen', 'unlock')
     AND status = 'pending';
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  IF v_cancelled > 0 THEN
    UPDATE public.managed_devices
       SET locked_by = NULL,
           lock_reason = NULL,
           updated_at = now()
     WHERE id = v_dev_id
       AND COALESCE(is_locked, false) = false;
  END IF;

  IF v_cancelled > 0 THEN
    PERFORM public._hr_audit(
      'device.lock_pending_cleared',
      'managed_device',
      v_dev_id,
      'Pending device lock/unlock command cleared by administrator',
      jsonb_build_object('asset_id', p_asset_id, 'cancelled_count', v_cancelled, 'actor_user_id', v_uid)
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'cancelled_count', v_cancelled);
END $$;

GRANT EXECUTE ON FUNCTION public.clear_device_lock_pending(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_device_activity(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dev_id uuid;
  v_deleted integer := 0;
BEGIN
  IF NOT public._hr_can_act() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden: administrator required');
  END IF;

  SELECT id INTO v_dev_id
    FROM public.managed_devices
   WHERE laptop_asset_id = p_asset_id;
  IF v_dev_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no managed device for this asset');
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.device_commands
     WHERE managed_device_id = v_dev_id
       AND status IN ('pending', 'running')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'clear the pending or executing device command before clearing activity'
    );
  END IF;

  DELETE FROM public.device_commands
   WHERE managed_device_id = v_dev_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  PERFORM public._hr_audit(
    'device.activity_cleared',
    'managed_device',
    v_dev_id,
    'Device command activity cleared by administrator',
    jsonb_build_object('asset_id', p_asset_id, 'deleted_count', v_deleted)
  );

  RETURN jsonb_build_object('success', true, 'deleted_count', v_deleted);
END $$;

GRANT EXECUTE ON FUNCTION public.clear_device_activity(uuid) TO authenticated;