# Supabase Setup — Miles Education IT Asset Desk

## Overview

This app uses Supabase for authentication and database. It needs two environment variables.
The anon/publishable key is safe for frontend use — **never use the service_role key**.

---

## 1. Environment Variables

### Replit (development)

Go to **Replit → Secrets** and add:

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | `https://dimbgprindvmzoylzyud.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your `anon` / `public` key from Supabase Dashboard |

After adding secrets, **restart the Replit app**.

Test at: `/supabase-check`

### Render (production)

Go to **Render → your service → Environment** and add the same two variables:

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | `https://dimbgprindvmzoylzyud.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your `anon` / `public` key |

Then: **Save Changes → Manual Deploy → Deploy latest commit.**

> Vite bakes `VITE_*` variables into the bundle at build time.
> Variables must be set **before** the build runs.

---

## 2. Where to Find Your Keys

**Supabase Dashboard → your project → Project Settings → API**

- **Project URL** → `VITE_SUPABASE_URL`
- **anon / public** key → `VITE_SUPABASE_ANON_KEY`
- **Never use the `service_role` key** in frontend code.

---

## 3. Database Schema (run in Supabase SQL Editor)

### Profiles table

```sql
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text        not null,
  email         text        not null unique,
  role          text        not null check (role in ('super_admin', 'it_admin', 'it_agent', 'end_user')),
  department    text        not null default '',
  location      text        not null default '',
  status        text        not null default 'Active' check (status in ('Active', 'Inactive', 'active', 'inactive')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

### Assets table

```sql
create table if not exists public.assets (
  asset_id          text        primary key,
  asset_type        text        not null check (asset_type in ('Laptop', 'Mobile')),
  brand             text        not null,
  model             text        not null,
  serial_number     text        not null unique,
  imei_1            text,
  status            text        not null default 'Available'
                                check (status in ('Available', 'Assigned', 'Under Repair', 'Lost', 'Retired')),
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

### Tickets table

```sql
create table if not exists public.tickets (
  ticket_id      text        primary key,
  raised_by      text        not null,
  employee_email text,
  asset_id       text        not null default 'N/A',
  category       text        not null,
  subcategory    text        not null,
  priority       text        not null check (priority in ('Critical', 'High', 'Medium', 'Low')),
  status         text        not null default 'Open'
                             check (status in ('Open', 'Assigned', 'In Progress', 'Waiting for User', 'Resolved', 'Closed', 'Rejected')),
  assigned_agent text        not null default '',
  description    text        not null,
  comments       jsonb       not null default '[]',
  created_date   text        not null,
  updated_date   text        not null
);
```

### Asset Assignments table (audit trail)

```sql
create table if not exists public.asset_assignments (
  id            uuid        primary key default gen_random_uuid(),
  asset_id      text        not null references public.assets(asset_id) on delete cascade,
  assigned_to   text        not null,
  assigned_email text       not null,
  department    text        not null default '',
  assigned_by   text        not null,
  assigned_at   timestamptz not null default now(),
  notes         text
);
```

### Asset Returns table (audit trail)

```sql
create table if not exists public.asset_returns (
  id            uuid        primary key default gen_random_uuid(),
  asset_id      text        not null references public.assets(asset_id) on delete cascade,
  returned_by   text        not null,
  returned_email text       not null,
  received_by   text        not null,
  returned_at   timestamptz not null default now(),
  condition     text        not null default 'Good',
  notes         text
);
```

---

## 4. Row Level Security (RLS)

```sql
-- Enable RLS on all tables
alter table public.profiles          enable row level security;
alter table public.assets            enable row level security;
alter table public.tickets           enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.asset_returns     enable row level security;

-- Profiles: any authenticated user can read all profiles
create policy "profiles_select_authenticated"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- Profiles: users can update only their own row
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Profiles: only service role can insert (handled via Supabase Dashboard)
-- To allow inserts from the app, add:
create policy "profiles_insert_authenticated"
  on public.profiles for insert
  with check (auth.role() = 'authenticated');

-- Assets: all authenticated users can read
create policy "assets_select_authenticated"
  on public.assets for select
  using (auth.role() = 'authenticated');

-- Assets: all authenticated users can write (app enforces role checks)
create policy "assets_insert_authenticated"
  on public.assets for insert
  with check (auth.role() = 'authenticated');

create policy "assets_update_authenticated"
  on public.assets for update
  using (auth.role() = 'authenticated');

create policy "assets_delete_authenticated"
  on public.assets for delete
  using (auth.role() = 'authenticated');

-- Tickets: all authenticated users can read and write
create policy "tickets_select_authenticated"
  on public.tickets for select
  using (auth.role() = 'authenticated');

create policy "tickets_insert_authenticated"
  on public.tickets for insert
  with check (auth.role() = 'authenticated');

create policy "tickets_update_authenticated"
  on public.tickets for update
  using (auth.role() = 'authenticated');

create policy "tickets_delete_authenticated"
  on public.tickets for delete
  using (auth.role() = 'authenticated');

-- Asset assignments + returns: authenticated users can read and write
create policy "asset_assignments_all"
  on public.asset_assignments for all
  using (auth.role() = 'authenticated');

create policy "asset_returns_all"
  on public.asset_returns for all
  using (auth.role() = 'authenticated');
```

---

## 5. First Super Admin Profile

**Step 1** — Create the auth user in Supabase Dashboard:
- Go to **Authentication → Users → Add user** (or invite)
- Email: `sheshadri.n@mileseducation.com`
- Set a password

**Step 2** — Insert the profile row (run in SQL Editor):

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

> The UUID `dc2af1b7-2d17-4b4a-af00-f4b873d916e1` must match the **User UID** shown in
> Supabase Dashboard → Authentication → Users → click the user.

---

## 6. Diagnostic Page

After setup, visit `/supabase-check` to verify:
- Env vars present
- Supabase client initialised
- Session status
- Profile row found (role, status, department)

---

## 7. Replit Deployment Checklist

- [ ] Add `VITE_SUPABASE_URL` in Replit Secrets
- [ ] Add `VITE_SUPABASE_ANON_KEY` in Replit Secrets
- [ ] Restart Replit app
- [ ] Visit `/login` and sign in
- [ ] Visit `/supabase-check` and confirm all checks pass
- [ ] Confirm role-based routing works before pushing to GitHub

## 8. Render Deployment Checklist

- [ ] Add `VITE_SUPABASE_URL` in Render service → Environment
- [ ] Add `VITE_SUPABASE_ANON_KEY` in Render service → Environment
- [ ] Click **Save Changes**
- [ ] Click **Manual Deploy → Deploy latest commit**
- [ ] Confirm the deployed commit includes Supabase authentication changes
- [ ] Visit the deployed URL → `/supabase-check` to verify

## 9. Build Command (Render)

```
pnpm install --frozen-lockfile && pnpm --filter @workspace/asset-desk run build:render
```

**Publish directory:** `artifacts/asset-desk/dist/public`

---

## Security Checklist

- [x] Only `anon` / `public` key used in frontend code
- [x] `service_role` key is **never** in the codebase
- [x] RLS enabled on all tables
- [x] Env vars stored in Replit Secrets / Render Environment only
- [x] No demo credentials, hardcoded users, or test data in source code
- [x] Anon key value never displayed in the UI (including `/supabase-check`)
