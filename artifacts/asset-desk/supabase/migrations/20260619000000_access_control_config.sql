-- Phase 1: Settings → Access Control (configuration storage only)
-- ADDITIVE ONLY. Does NOT change existing RLS, roles, profiles.role, or add any
-- permission enforcement. Three new config tables + audited super-admin RPCs.
-- Reuses the existing user_location_access table and _hr_audit() audit helper.

-- ── 1. Permission catalog ──────────────────────────────────────────────────
create table if not exists public.access_permissions (
  key         text primary key,
  label       text not null,
  category    text not null default 'general',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ── 2. Role × permission matrix (Sections A & C) ───────────────────────────
create table if not exists public.access_role_permissions (
  role_key        text not null,
  permission_key  text not null references public.access_permissions(key) on delete cascade,
  enabled         boolean not null default false,
  updated_at      timestamptz not null default now(),
  primary key (role_key, permission_key)
);

-- ── 3. Org-level policy toggles (Section D) ────────────────────────────────
create table if not exists public.access_policies (
  key         text primary key,
  label       text not null,
  enabled     boolean not null default false,
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- ── RLS: super-admin-only read; writes only through SECURITY DEFINER RPCs ───
alter table public.access_permissions      enable row level security;
alter table public.access_role_permissions enable row level security;
alter table public.access_policies         enable row level security;

drop policy if exists ap_select   on public.access_permissions;
drop policy if exists arp_select  on public.access_role_permissions;
drop policy if exists apol_select on public.access_policies;

create policy ap_select   on public.access_permissions      for select using (public._is_super_admin());
create policy arp_select  on public.access_role_permissions for select using (public._is_super_admin());
create policy apol_select on public.access_policies         for select using (public._is_super_admin());

-- ── Seed: permission catalog ───────────────────────────────────────────────
insert into public.access_permissions (key, label, category, sort_order) values
  ('view_dashboard',        'View Dashboard',            'general', 10),
  ('view_assets',           'View Assets',               'general', 20),
  ('create_assets',         'Create / Edit Assets',      'general', 30),
  ('delete_assets',         'Delete Assets',             'general', 40),
  ('assign_assets',         'Assign / Transfer Assets',  'general', 50),
  ('view_users',            'View Users',                'general', 60),
  ('manage_users',          'Manage Users',              'general', 70),
  ('view_reports',          'View Reports',              'general', 80),
  ('manage_settings',       'Manage Settings',           'general', 90),
  ('view_audit_logs',       'View Audit Logs',           'general', 100),
  ('approve_replacement',   'Approve Asset Replacement', 'general', 110),
  ('manage_asset_recovery', 'Manage Asset Recovery',     'general', 120),
  ('lgm_view_location_assets',    'View Location Assets',    'location_gm', 10),
  ('lgm_view_location_users',     'View Location Users',     'location_gm', 20),
  ('lgm_raise_shortage_request',  'Raise Shortage Request',  'location_gm', 30),
  ('lgm_raise_return_request',    'Raise Return Request',    'location_gm', 40),
  ('lgm_update_asset_condition',  'Update Asset Condition',  'location_gm', 50),
  ('lgm_mark_asset_received',     'Mark Asset Received',     'location_gm', 60),
  ('lgm_mark_courier_dispatched', 'Mark Courier Dispatched', 'location_gm', 70),
  ('lgm_view_location_reports',   'View Location Reports',   'location_gm', 80)
on conflict (key) do nothing;

-- ── Seed: role × permission defaults (mirror current behaviour, config only) ─
insert into public.access_role_permissions (role_key, permission_key, enabled)
  select 'super_admin', key, true
  from public.access_permissions where category = 'general'
on conflict (role_key, permission_key) do nothing;

insert into public.access_role_permissions (role_key, permission_key, enabled)
  select 'it_admin', key, (key <> 'manage_settings')
  from public.access_permissions where category = 'general'
on conflict (role_key, permission_key) do nothing;

insert into public.access_role_permissions (role_key, permission_key, enabled)
  select 'hr_admin', key,
    key in ('view_dashboard','view_users','manage_users','view_reports','view_audit_logs')
  from public.access_permissions where category = 'general'
on conflict (role_key, permission_key) do nothing;

insert into public.access_role_permissions (role_key, permission_key, enabled)
  select 'end_user', key, key in ('view_dashboard','view_assets')
  from public.access_permissions where category = 'general'
on conflict (role_key, permission_key) do nothing;

insert into public.access_role_permissions (role_key, permission_key, enabled)
  select 'location_gm', key, key in ('view_dashboard','view_assets','view_reports')
  from public.access_permissions where category = 'general'
on conflict (role_key, permission_key) do nothing;

insert into public.access_role_permissions (role_key, permission_key, enabled)
  select 'location_gm', key,
    key in ('lgm_view_location_assets','lgm_view_location_users','lgm_raise_shortage_request',
            'lgm_raise_return_request','lgm_view_location_reports')
  from public.access_permissions where category = 'location_gm'
on conflict (role_key, permission_key) do nothing;

-- ── Seed: policy toggles ───────────────────────────────────────────────────
insert into public.access_policies (key, label, enabled, sort_order) values
  ('require_bangalore_it_approval_before_replacement', 'Require Bangalore IT Approval Before Replacement',    true,  10),
  ('auto_move_asset_to_recovery_on_hr_exit',           'Auto Move Asset To Recovery On HR Exit',              false, 20),
  ('auto_lock_device_on_hr_exit',                      'Auto Lock Device On HR Exit',                         false, 30),
  ('allow_location_gm_mark_damaged',                   'Allow Location GM To Mark Damaged',                   false, 40),
  ('allow_location_gm_release_after_it_approval',      'Allow Location GM To Release Asset After IT Approval', false, 50)
on conflict (key) do nothing;

-- ── Seed: initial location mappings for detected users (idempotent) ─────────
insert into public.user_location_access
  (user_id, location, access_role, can_view_assets, can_raise_requests, can_mark_received, can_release_after_it_approval)
select v.user_id, v.location, 'location_gm', true, true, false, false
from (values
  ('d3c5ec99-1e5f-4e94-99e9-342105978c62'::uuid, 'Bangalore'),
  ('61cc4ad7-e8ed-4538-9970-f1a7b2de3b79'::uuid, 'Ahmedabad'),
  ('04601d8c-1a11-43e0-aaeb-2bb0bbadb9a3'::uuid, 'Chennai'),
  ('cea5e6ac-0819-437f-b06e-4dcd92ed640b'::uuid, 'Ernakulam - Kochi'),
  ('eeae2d5d-3681-4395-895e-1de06441f9ca'::uuid, 'Hyderabad'),
  ('9bb84162-35b5-4d69-a66c-eb6faf0ffc63'::uuid, 'Hyderabad'),
  ('90938de5-2f4a-406f-92f4-d2f514ce0ff9'::uuid, 'Kolkata'),
  ('bc0ba4db-1c0b-46c9-96e2-f099fe09f9b2'::uuid, 'Delhi'),
  ('a59f0841-98fe-4d63-a36b-8391fd67b770'::uuid, 'Pune')
) as v(user_id, location)
where not exists (
  select 1 from public.user_location_access ula
  where ula.user_id = v.user_id and ula.location = v.location
);

-- ── Admin RPCs (super-admin only, audited via _hr_audit) ───────────────────
create or replace function public.access_set_role_permission(
  p_role_key text, p_permission_key text, p_enabled boolean
) returns void
language plpgsql security definer set search_path to 'public'
as $func$
begin
  if not public._is_super_admin() then
    raise exception 'Not authorized';
  end if;
  insert into public.access_role_permissions (role_key, permission_key, enabled, updated_at)
  values (p_role_key, p_permission_key, p_enabled, now())
  on conflict (role_key, permission_key)
  do update set enabled = excluded.enabled, updated_at = now();
  perform public._hr_audit(
    'access_control.role_permission.updated', 'access_role_permissions', null::uuid,
    format('Set %s = %s for role %s', p_permission_key, p_enabled, p_role_key),
    jsonb_build_object('role_key', p_role_key, 'permission_key', p_permission_key, 'enabled', p_enabled)
  );
end;
$func$;

create or replace function public.access_set_policy(
  p_key text, p_enabled boolean
) returns void
language plpgsql security definer set search_path to 'public'
as $func$
begin
  if not public._is_super_admin() then
    raise exception 'Not authorized';
  end if;
  update public.access_policies set enabled = p_enabled, updated_at = now() where key = p_key;
  if not found then
    raise exception 'Unknown policy: %', p_key;
  end if;
  perform public._hr_audit(
    'access_control.policy.updated', 'access_policies', null::uuid,
    format('Set policy %s = %s', p_key, p_enabled),
    jsonb_build_object('key', p_key, 'enabled', p_enabled)
  );
end;
$func$;

create or replace function public.access_set_user_locations(
  p_user_id uuid, p_rows jsonb
) returns void
language plpgsql security definer set search_path to 'public'
as $func$
declare
  r jsonb;
begin
  if not public._is_super_admin() then
    raise exception 'Not authorized';
  end if;
  delete from public.user_location_access where user_id = p_user_id;
  if p_rows is not null then
    for r in select * from jsonb_array_elements(p_rows)
    loop
      insert into public.user_location_access (
        user_id, location, access_role,
        can_view_assets, can_raise_requests, can_mark_received, can_release_after_it_approval
      ) values (
        p_user_id,
        r->>'location',
        coalesce(r->>'access_role', 'location_gm'),
        coalesce((r->>'can_view_assets')::boolean, true),
        coalesce((r->>'can_raise_requests')::boolean, true),
        coalesce((r->>'can_mark_received')::boolean, false),
        coalesce((r->>'can_release_after_it_approval')::boolean, false)
      );
    end loop;
  end if;
  perform public._hr_audit(
    'access_control.location_access.updated', 'user_location_access', p_user_id,
    format('Updated location access (%s location(s))', coalesce(jsonb_array_length(p_rows), 0)),
    jsonb_build_object('user_id', p_user_id, 'rows', p_rows)
  );
end;
$func$;

grant execute on function public.access_set_role_permission(text, text, boolean) to authenticated;
grant execute on function public.access_set_policy(text, boolean)                to authenticated;
grant execute on function public.access_set_user_locations(uuid, jsonb)          to authenticated;
