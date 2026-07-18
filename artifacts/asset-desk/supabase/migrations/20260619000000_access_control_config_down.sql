-- Rollback for 20260619000000_access_control_config.sql
-- NOTE: kept in the repo for recovery only; NOT applied automatically.

drop function if exists public.access_set_user_locations(uuid, jsonb);
drop function if exists public.access_set_policy(text, boolean);
drop function if exists public.access_set_role_permission(text, text, boolean);

drop table if exists public.access_role_permissions;
drop table if exists public.access_policies;
drop table if exists public.access_permissions;

-- The user_location_access rows seeded by the up-migration are intentionally
-- NOT removed here, because that table pre-existed this migration. Remove any
-- unwanted seeded rows manually if a full revert is required.
