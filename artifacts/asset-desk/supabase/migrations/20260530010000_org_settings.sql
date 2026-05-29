-- Organization settings (singleton). Previously the Settings page "Save" button
-- only wrote to local React state, so every preference reset on page refresh —
-- a dead feature. This adds a real persistent store.
--
-- Design: a single-row table keyed by a fixed boolean PK (id = true) so there can
-- only ever be one settings row. Any authenticated user may READ settings (the UI
-- needs them on load), but only super_admin may WRITE — enforced by the
-- save_org_settings RPC (SECURITY DEFINER + _is_super_admin gate), mirroring the
-- device-management RPCs. Direct table writes are blocked by RLS.

CREATE TABLE IF NOT EXISTS public.org_settings (
  id                  boolean PRIMARY KEY DEFAULT true,
  org_name            text    NOT NULL DEFAULT 'Miles Education Pvt Ltd',
  support_email       text    NOT NULL DEFAULT 'it.helpdesk@mileseducation.com',
  email_notifications boolean NOT NULL DEFAULT true,
  ticket_assignment   boolean NOT NULL DEFAULT true,
  status_updates      boolean NOT NULL DEFAULT true,
  warranty_alerts     boolean NOT NULL DEFAULT true,
  two_factor          boolean NOT NULL DEFAULT false,
  session_timeout     integer NOT NULL DEFAULT 30,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES public.profiles(id),
  CONSTRAINT org_settings_singleton CHECK (id = true)
);

-- Seed the single row so reads always return defaults even before first save.
INSERT INTO public.org_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

-- Any signed-in user may read settings (UI loads them on mount). No writes via RLS;
-- all writes go through save_org_settings (super_admin gated). anon gets nothing.
DROP POLICY IF EXISTS org_settings_select ON public.org_settings;
CREATE POLICY org_settings_select ON public.org_settings
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.org_settings TO authenticated;

-- ── Save (super_admin only) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_org_settings(
  p_org_name            text,
  p_support_email       text,
  p_email_notifications boolean,
  p_ticket_assignment   boolean,
  p_status_updates      boolean,
  p_warranty_alerts     boolean,
  p_two_factor          boolean,
  p_session_timeout     integer
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
    updated_at          = now(),
    updated_by          = v_uid
  WHERE id = true
  RETURNING * INTO v_row;

  -- Defensive: if the singleton row was somehow missing, create it rather than
  -- returning NULL (which would surface as a false-success in the UI).
  IF NOT FOUND THEN
    INSERT INTO public.org_settings (
      id, org_name, support_email, email_notifications, ticket_assignment,
      status_updates, warranty_alerts, two_factor, session_timeout, updated_at, updated_by
    ) VALUES (
      true, p_org_name, p_support_email, p_email_notifications, p_ticket_assignment,
      p_status_updates, p_warranty_alerts, p_two_factor, p_session_timeout, now(), v_uid
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.save_org_settings(
  text, text, boolean, boolean, boolean, boolean, boolean, integer
) TO authenticated;
