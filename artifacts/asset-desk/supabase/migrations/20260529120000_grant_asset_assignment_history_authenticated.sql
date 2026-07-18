-- asset_assignment_history had RLS policies (SELECT + INSERT for IT staff:
-- super_admin / it_admin / it_agent) but was never GRANTed table-level
-- privileges to `authenticated`. In Postgres both are required — a privilege
-- GRANT *and* a permissive RLS policy. Without the GRANT, every client-side
-- history write returned "permission denied for table asset_assignment_history"
-- and was swallowed by the non-fatal catch, so the User History timeline on
-- asset detail pages stayed permanently empty (0 rows).
--
-- INSERT is required because assign / return / unassign / bulk-assign log their
-- events client-side. RLS still scopes both reads and writes to IT roles, so a
-- broad GRANT to `authenticated` does not expose history to end users.
-- anon intentionally keeps NO access.

GRANT SELECT, INSERT ON public.asset_assignment_history TO authenticated;
