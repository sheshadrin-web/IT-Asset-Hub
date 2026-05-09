# Supabase Setup — Miles Education IT Asset Desk

## Overview

This app uses Supabase for authentication and database. It requires two environment variables.
The anon/publishable key is safe for frontend use — **never use the service_role key**.

---

## 1. Environment Variables

### Replit (development)

Go to **Replit → Secrets** and add:

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | `https://dimbgprindvmzoylzyud.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your `anon` / `public` key from Supabase Dashboard |

After adding secrets → **restart the Replit app** → test `/supabase-check`.

### Render (production)

Go to **Render → your service → Environment** and add the same two variables, then:
**Save Changes → Manual Deploy → Deploy latest commit.**

> Vite bakes `VITE_*` variables into the bundle at build time — set them **before** the build.

---

## 2. Where to Find Your Keys

**Supabase Dashboard → Project Settings → API**

- **Project URL** → `VITE_SUPABASE_URL`
- **anon / public** key → `VITE_SUPABASE_ANON_KEY`
- ⚠️ **Never use the `service_role` key** in frontend code.

---

## 3. Database Schema

Run in **Supabase Dashboard → SQL Editor → New query**.

### profiles table

```sql
create table if not exists public.profiles (
  id          uuid        primary key references auth.users(id) on delete cascade,
  full_name   text        not null,
  email       text        not null unique,
  role        text        not null check (role in ('super_admin','it_admin','it_agent','end_user')),
  department  text        not null default '',
  location    text        not null default '',
  status      text        not null default 'Active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

### assets table

```sql
create table if not exists public.assets (
  asset_id          text        primary key,
  asset_type        text        not null check (asset_type in ('Laptop','Mobile')),
  brand             text        not null,
  model             text        not null,
  serial_number     text        not null unique,
  imei_1            text,
  status            text        not null default 'Available',
  assigned_to       text,
  assigned_email    text,
  department        text,
  location          text        not null default '',
  purchase_date     text        not null,
  warranty_end_date text        not null,
  accessories       text,
  remarks           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```

### tickets table

```sql
create table if not exists public.tickets (
  ticket_id      text        primary key,
  raised_by      text        not null,
  employee_email text,
  asset_id       text        not null default 'N/A',
  category       text        not null,
  subcategory    text        not null,
  priority       text        not null,
  status         text        not null default 'Open',
  assigned_agent text        not null default '',
  description    text        not null,
  comments       jsonb       not null default '[]',
  created_date   text        not null,
  updated_date   text        not null
);
```

### asset_assignments table (audit trail)

```sql
create table if not exists public.asset_assignments (
  id             uuid        primary key default gen_random_uuid(),
  asset_id       text        not null references public.assets(asset_id) on delete cascade,
  assigned_to    text        not null,
  assigned_email text        not null,
  department     text        not null default '',
  assigned_by    text        not null,
  assigned_at    timestamptz not null default now(),
  notes          text
);
```

### asset_returns table (audit trail)

```sql
create table if not exists public.asset_returns (
  id             uuid        primary key default gen_random_uuid(),
  asset_id       text        not null references public.assets(asset_id) on delete cascade,
  returned_by    text        not null,
  returned_email text        not null,
  received_by    text        not null,
  returned_at    timestamptz not null default now(),
  condition      text        not null default 'Good',
  notes          text
);
```

---

## 4. Row Level Security (RLS)

> ⚠️ **IMPORTANT — avoid infinite recursion (error 42P17)**
>
> Do **not** use `auth.role() = 'authenticated'` in policies on the `profiles` table.
> This causes Postgres to recursively evaluate the policy, leading to error `42P17`.
> Use `auth.uid() is not null` instead — it checks the JWT directly without a DB lookup.

### Step 1 — Enable RLS

```sql
alter table public.profiles          enable row level security;
alter table public.assets            enable row level security;
alter table public.tickets           enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.asset_returns     enable row level security;
```

### Step 2 — Drop any broken policies (if you already ran old policies)

```sql
-- Drop old policies if they exist
drop policy if exists "profiles_select_authenticated"  on public.profiles;
drop policy if exists "profiles_update_own"            on public.profiles;
drop policy if exists "profiles_insert_authenticated"  on public.profiles;
drop policy if exists "assets_select_authenticated"    on public.assets;
drop policy if exists "assets_insert_authenticated"    on public.assets;
drop policy if exists "assets_update_authenticated"    on public.assets;
drop policy if exists "assets_delete_authenticated"    on public.assets;
drop policy if exists "tickets_select_authenticated"   on public.tickets;
drop policy if exists "tickets_insert_authenticated"   on public.tickets;
drop policy if exists "tickets_update_authenticated"   on public.tickets;
drop policy if exists "tickets_delete_authenticated"   on public.tickets;
drop policy if exists "asset_assignments_all"          on public.asset_assignments;
drop policy if exists "asset_returns_all"              on public.asset_returns;
```

### Step 3 — Create correct policies

```sql
-- ── profiles ──────────────────────────────────────────────────────────────────
-- Use auth.uid() is not null — avoids the 42P17 infinite recursion bug
create policy "profiles_select"
  on public.profiles for select
  using (auth.uid() is not null);

create policy "profiles_insert"
  on public.profiles for insert
  with check (auth.uid() is not null);

create policy "profiles_update"
  on public.profiles for update
  using (auth.uid() is not null);

-- ── assets ────────────────────────────────────────────────────────────────────
create policy "assets_select"
  on public.assets for select
  using (auth.uid() is not null);

create policy "assets_insert"
  on public.assets for insert
  with check (auth.uid() is not null);

create policy "assets_update"
  on public.assets for update
  using (auth.uid() is not null);

create policy "assets_delete"
  on public.assets for delete
  using (auth.uid() is not null);

-- ── tickets ───────────────────────────────────────────────────────────────────
create policy "tickets_select"
  on public.tickets for select
  using (auth.uid() is not null);

create policy "tickets_insert"
  on public.tickets for insert
  with check (auth.uid() is not null);

create policy "tickets_update"
  on public.tickets for update
  using (auth.uid() is not null);

create policy "tickets_delete"
  on public.tickets for delete
  using (auth.uid() is not null);

-- ── asset_assignments ─────────────────────────────────────────────────────────
create policy "asset_assignments_select"
  on public.asset_assignments for select
  using (auth.uid() is not null);

create policy "asset_assignments_insert"
  on public.asset_assignments for insert
  with check (auth.uid() is not null);

-- ── asset_returns ─────────────────────────────────────────────────────────────
create policy "asset_returns_select"
  on public.asset_returns for select
  using (auth.uid() is not null);

create policy "asset_returns_insert"
  on public.asset_returns for insert
  with check (auth.uid() is not null);
```

---

## 5. First Super Admin Profile

### Step 1 — Confirm the auth user exists

Go to **Supabase Dashboard → Authentication → Users** and confirm:
- Email: `sheshadri.n@mileseducation.com`
- UID: `dc2af1b7-2d17-4b4a-af00-f4b873d916e1`

If the user doesn't exist, use **Invite user** and set their password.

### Step 2 — Insert the profile row

```sql
insert into public.profiles (
  id,
  full_name,
  email,
  role,
  department,
  location,
  status
)
values (
  'dc2af1b7-2d17-4b4a-af00-f4b873d916e1',
  'Sheshadri N',
  'sheshadri.n@mileseducation.com',
  'super_admin',
  'IT',
  'Bangalore',
  'Active'
)
on conflict (email) do update set
  id         = excluded.id,
  full_name  = excluded.full_name,
  role       = excluded.role,
  department = excluded.department,
  location   = excluded.location,
  status     = excluded.status;
```

> **Status must be `'Active'` (capital A).** The app also accepts `'active'` (lowercase) and normalises it automatically.

---

## 6. Diagnostic Page

After setup, visit `/supabase-check` (no login required) to verify:
- Both env vars present
- Supabase client initialised
- Session and profile after login

---

## 7. Replit Deployment Checklist

- [ ] Add `VITE_SUPABASE_URL` in Replit Secrets
- [ ] Add `VITE_SUPABASE_ANON_KEY` in Replit Secrets
- [ ] Restart Replit app
- [ ] Visit `/supabase-check` → confirm env vars present
- [ ] Visit `/login` → sign in → confirm no error
- [ ] Visit `/supabase-check` again → confirm profile found, role = `super_admin`
- [ ] Confirm role-based dashboard loads correctly
- [ ] Push to GitHub once login is verified

## 8. Render Deployment Checklist

- [ ] Add `VITE_SUPABASE_URL` in Render service → Environment
- [ ] Add `VITE_SUPABASE_ANON_KEY` in Render service → Environment
- [ ] Click **Save Changes**
- [ ] Click **Manual Deploy → Deploy latest commit**
- [ ] Confirm deployed commit includes Supabase auth changes
- [ ] Visit deployed URL → `/supabase-check` → verify all checks pass

## 9. Build Command (Render)

```
pnpm install --frozen-lockfile && pnpm --filter @workspace/asset-desk run build:render
```

**Publish directory:** `artifacts/asset-desk/dist/public`

---

## Security Checklist

- [x] Only `anon` / `public` key used in frontend code
- [x] `service_role` key never in codebase
- [x] RLS enabled on all tables with `auth.uid() is not null` (avoids 42P17)
- [x] Env vars stored in Replit Secrets / Render Environment only
- [x] No demo credentials or hardcoded users in source code
- [x] Anon key value never shown in `/supabase-check` UI
