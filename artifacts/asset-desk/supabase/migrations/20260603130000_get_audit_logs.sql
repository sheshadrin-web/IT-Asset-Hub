-- Read path for the audit_logs table so the Settings → Audit Logs tab can show a
-- real activity feed. audit_logs is RLS-locked (no direct client access); this
-- SECURITY DEFINER RPC is the only reader. Gated by _hr_can_read() (the same roles
-- allowed to view HR/integration data: super_admin, it_admin, it_agent, hr_admin).
-- Joins the actor's profile for a human-readable name. Returns a jsonb array.

CREATE OR REPLACE FUNCTION public.get_audit_logs(p_limit int DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public._hr_can_read() THEN
    RAISE EXCEPTION 'forbidden: insufficient role to view audit logs';
  END IF;

  SELECT COALESCE(jsonb_agg(sub.j ORDER BY sub.created_at DESC), '[]'::jsonb)
  INTO v
  FROM (
    SELECT
      jsonb_build_object(
        'id',          al.id,
        'actor_name',  p.full_name,
        'actor_email', p.email,
        'action',      al.action,
        'entity_type', al.entity_type,
        'entity_id',   al.entity_id,
        'description', al.description,
        'metadata',    al.metadata,
        'created_at',  al.created_at
      ) AS j,
      al.created_at
    FROM public.audit_logs al
    LEFT JOIN public.profiles p ON p.id = al.actor_user_id
    ORDER BY al.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
  ) sub;

  RETURN v;
END $$;

GRANT EXECUTE ON FUNCTION public.get_audit_logs(int) TO authenticated;
