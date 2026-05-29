-- Device-management tables had RLS SELECT policies for `authenticated` but were
-- never GRANTed table-level SELECT to that role. Both are required in Postgres:
-- a privilege GRANT *and* a permissive RLS policy. Without the GRANT, logged-in
-- users got "permission denied for table ..." and the Device Agent / Wallpaper
-- panels wrongly showed "Not Installed" / empty.
--
-- anon intentionally keeps NO read access — these tables are admin/internal.

GRANT SELECT ON public.managed_devices         TO authenticated;
GRANT SELECT ON public.agent_tokens            TO authenticated;
GRANT SELECT ON public.wallpapers              TO authenticated;
GRANT SELECT ON public.device_wallpaper_status TO authenticated;

-- asset_assignment_history had RLS policies (select+insert for IT staff) but no
-- table-level GRANT, so every history write hit "permission denied" and was
-- swallowed by the non-fatal catch — the User History timeline stayed empty.
-- INSERT is needed because assign/return/unassign log events client-side.
GRANT SELECT, INSERT ON public.asset_assignment_history TO authenticated;
