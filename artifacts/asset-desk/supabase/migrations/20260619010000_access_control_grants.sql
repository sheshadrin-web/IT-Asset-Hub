-- Fix: tables created via raw SQL do not auto-grant table privileges to the
-- Supabase `authenticated` role, so PostgREST reads failed with
-- "permission denied for table ..." even for a super admin (the error happens
-- at the GRANT layer, before RLS row filtering). Grant SELECT so the super-admin
-- SELECT RLS policies can take effect. Writes are unaffected — they go through
-- SECURITY DEFINER RPCs that run as the table owner.

grant select on public.access_permissions      to authenticated;
grant select on public.access_role_permissions to authenticated;
grant select on public.access_policies         to authenticated;
