-- Add locale preferences (timezone + date format) to org_settings so the premium
-- Settings "General" tab can persist them like the rest of the org preferences.
-- Mirrors the existing save_org_settings pattern (SECURITY DEFINER + super_admin gate).

ALTER TABLE public.org_settings
  ADD COLUMN IF NOT EXISTS timezone    text NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS date_format text NOT NULL DEFAULT 'DD MMM YYYY';

-- Recreate save_org_settings with the two new params appended (keeps the old
-- 8-arg signature droppable; we replace with the extended one).
DROP FUNCTION IF EXISTS public.save_org_settings(
  text, text, boolean, boolean, boolean, boolean, boolean, integer
);

CREATE OR REPLACE FUNCTION public.save_org_settings(
  p_org_name            text,
  p_support_email       text,
  p_email_notifications boolean,
  p_ticket_assignment   boolean,
  p_status_updates      boolean,
  p_warranty_alerts     boolean,
  p_two_factor          boolean,
  p_session_timeout     integer,
  p_timezone            text,
  p_date_format         text
)
RETURNS public.org_settings LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.org_settings;
BEGIN
  IF NOT public._is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super_admin required';
  END IF;
  IF p_session_timeout IS NULL OR p_session_timeout < 5 OR p_session_timeout > 480 THEN
    RAISE EXCEPTION 'session_timeout must be between 5 and 480 minutes';
  END IF;

  UPDATE public.org_settings SET
    org_name            = p_org_name,
    support_email       = p_support_email,
    email_notifications = p_email_notifications,
    ticket_assignment   = p_ticket_assignment,
    status_updates      = p_status_updates,
    warranty_alerts     = p_warranty_alerts,
    two_factor          = p_two_factor,
    session_timeout     = p_session_timeout,
    timezone            = COALESCE(p_timezone, timezone),
    date_format         = COALESCE(p_date_format, date_format),
    updated_at          = now(),
    updated_by          = v_uid
  WHERE id = true
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    INSERT INTO public.org_settings (
      id, org_name, support_email, email_notifications, ticket_assignment,
      status_updates, warranty_alerts, two_factor, session_timeout,
      timezone, date_format, updated_at, updated_by
    ) VALUES (
      true, p_org_name, p_support_email, p_email_notifications, p_ticket_assignment,
      p_status_updates, p_warranty_alerts, p_two_factor, p_session_timeout,
      COALESCE(p_timezone, 'Asia/Kolkata'), COALESCE(p_date_format, 'DD MMM YYYY'),
      now(), v_uid
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.save_org_settings(
  text, text, boolean, boolean, boolean, boolean, boolean, integer, text, text
) TO authenticated;
