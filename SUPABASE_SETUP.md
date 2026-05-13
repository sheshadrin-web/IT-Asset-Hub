# Supabase Setup — Miles Education IT Asset Desk

## Overview

This app uses Supabase for authentication and database. The frontend needs only the anon key.
The `service_role` key is used exclusively inside the Supabase Edge Function — never in frontend code.

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

Go to **Render → your service → Environment** and add the **same two variables**, then:
**Save Changes → Manual Deploy → Deploy latest commit.**

> Vite bakes `VITE_*` variables into the bundle at build time — set them **before** the build.

> ⚠️ **DO NOT** add `SUPABASE_SERVICE_ROLE_KEY` to Replit Secrets or Render environment.
> It belongs only in the Supabase Edge Function environment (see Section 10).

---

## 2. Where to Find Your Keys

**Supabase Dashboard → Project Settings → API**

- **Project URL** → `VITE_SUPABASE_URL`
- **anon / public** key → `VITE_SUPABASE_ANON_KEY`
- **service_role** key → used in Edge Function only (see Section 10)

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

### asset_assignments table

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

### asset_returns table

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
> Use `auth.uid() is not null` — NOT `auth.role() = 'authenticated'` — in all policies on the `profiles`
> table. `auth.role()` triggers a DB lookup that can recursively evaluate the policy.

### Step 1 — Enable RLS

```sql
alter table public.profiles          enable row level security;
alter table public.assets            enable row level security;
alter table public.tickets           enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.asset_returns     enable row level security;
```

### Step 2 — Drop all existing policies (safe to run multiple times)

```sql
drop policy if exists "profiles_select_authenticated"  on public.profiles;
drop policy if exists "profiles_update_own"            on public.profiles;
drop policy if exists "profiles_insert_authenticated"  on public.profiles;
drop policy if exists "profiles_select"                on public.profiles;
drop policy if exists "profiles_insert"                on public.profiles;
drop policy if exists "profiles_update"                on public.profiles;
drop policy if exists "assets_select"                  on public.assets;
drop policy if exists "assets_insert"                  on public.assets;
drop policy if exists "assets_update"                  on public.assets;
drop policy if exists "assets_delete"                  on public.assets;
drop policy if exists "tickets_select"                 on public.tickets;
drop policy if exists "tickets_insert"                 on public.tickets;
drop policy if exists "tickets_update"                 on public.tickets;
drop policy if exists "tickets_delete"                 on public.tickets;
drop policy if exists "asset_assignments_select"       on public.asset_assignments;
drop policy if exists "asset_assignments_insert"       on public.asset_assignments;
drop policy if exists "asset_returns_select"           on public.asset_returns;
drop policy if exists "asset_returns_insert"           on public.asset_returns;
```

### Step 3 — Create correct policies

```sql
-- profiles
create policy "profiles_select" on public.profiles for select using (auth.uid() is not null);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() is not null);
create policy "profiles_update" on public.profiles for update using (auth.uid() is not null);

-- assets
create policy "assets_select" on public.assets for select using (auth.uid() is not null);
create policy "assets_insert" on public.assets for insert with check (auth.uid() is not null);
create policy "assets_update" on public.assets for update using (auth.uid() is not null);
create policy "assets_delete" on public.assets for delete using (auth.uid() is not null);

-- tickets
create policy "tickets_select" on public.tickets for select using (auth.uid() is not null);
create policy "tickets_insert" on public.tickets for insert with check (auth.uid() is not null);
create policy "tickets_update" on public.tickets for update using (auth.uid() is not null);
create policy "tickets_delete" on public.tickets for delete using (auth.uid() is not null);

-- asset_assignments
create policy "asset_assignments_select" on public.asset_assignments for select using (auth.uid() is not null);
create policy "asset_assignments_insert" on public.asset_assignments for insert with check (auth.uid() is not null);

-- asset_returns
create policy "asset_returns_select" on public.asset_returns for select using (auth.uid() is not null);
create policy "asset_returns_insert" on public.asset_returns for insert with check (auth.uid() is not null);
```

---

## 4b. Explicit Grants + Auto-Profile Trigger

> ⚠️ **Run this if the Edge Function returns "permission denied for table profiles"**
>
> By default, `service_role` in Supabase bypasses RLS but still needs table-level
> Postgres `GRANT` permissions. Run the block below once to fix it.

### Step 1 — Explicit grants (required for Edge Function inserts)

```sql
-- Grant service_role full access to all public schema tables
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Ensure future tables also get these grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
```

### Step 2 — Auto-profile trigger (recommended — makes profile creation bulletproof)

This trigger runs as `SECURITY DEFINER` (with `postgres` privileges), so it
bypasses both RLS and permission checks. Whenever a Supabase Auth user is created
(via Edge Function, Supabase dashboard, or Supabase invite), the profile row is
created automatically from `user_metadata`.

```sql
-- Function that creates a profile row from auth.user metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, department, location, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'end_user'),
    COALESCE(NEW.raw_user_meta_data->>'department', ''),
    COALESCE(NEW.raw_user_meta_data->>'location', ''),
    'Active'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger: fires after every new auth user is inserted
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

After running both SQL blocks, **redeploy the Edge Function** so it picks up the changes:

```bash
supabase functions deploy admin-users --no-verify-jwt
```

---

## 4c. Add Missing Columns to profiles (run once if ecode / reporting_manager are missing)

```sql
-- Add ecode and reporting_manager if they don't exist yet
alter table public.profiles add column if not exists ecode             text not null default '';
alter table public.profiles add column if not exists reporting_manager text not null default '';
```

> Run in **Supabase Dashboard → SQL Editor**. Safe to run multiple times (`IF NOT EXISTS`).

---

## 5. First Super Admin

### Step 1 — Confirm the auth user exists

Go to **Supabase Dashboard → Authentication → Users** and confirm:
- Email: `sheshadri.n@mileseducation.com`
- UID: `dc2af1b7-2d17-4b4a-af00-f4b873d916e1`

If the user doesn't exist, use **Invite user** and set their password.

### Step 2 — Insert the profile row

```sql
insert into public.profiles (id, full_name, email, role, department, location, status)
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
  id=excluded.id, full_name=excluded.full_name, role=excluded.role,
  department=excluded.department, location=excluded.location, status=excluded.status;
```

---

## 6. Diagnostic Page

Visit `/supabase-check` (no login required) to verify:
- Both env vars present
- Supabase client initialised
- Session and profile after login

---

## 7. Build Command (Render)

```
pnpm install --frozen-lockfile && pnpm --filter @workspace/asset-desk run build:render
```

**Publish directory:** `artifacts/asset-desk/dist/public`

---

## 8. Replit Deployment Checklist

- [ ] `VITE_SUPABASE_URL` in Replit Secrets
- [ ] `VITE_SUPABASE_ANON_KEY` in Replit Secrets
- [ ] Restart Replit app
- [ ] `/supabase-check` → all green
- [ ] `/login` → sign in → profile found, role = `super_admin`
- [ ] `/users` → user list loads, Add User button visible

---

## 9. Render Deployment Checklist

- [ ] `VITE_SUPABASE_URL` in Render service → Environment
- [ ] `VITE_SUPABASE_ANON_KEY` in Render service → Environment
- [ ] Save Changes → Manual Deploy → Deploy latest commit
- [ ] Confirm env vars were set BEFORE the build

---

## 10. Supabase Edge Function — admin-users

The Edge Function handles user creation and deletion, which requires the `service_role` key.
The frontend never sees or uses the service_role key.

### File location in this repo

```
supabase/
  functions/
    admin-users/
      index.ts      ← Edge Function source
```

### Supported actions

| Action | What it does |
|--------|-------------|
| `createUser` | Creates Supabase Auth user + profile row |
| `updateUserProfile` | Updates profile fields via service role |
| `deactivateUser` | Sets `status = 'Inactive'` in profiles |
| `deleteUser` | Deletes auth user (cascades to profile) |

### Deploy the Edge Function

#### Prerequisites

Install the Supabase CLI:

```bash
npm install -g supabase
```

#### Step 1 — Login and link

```bash
supabase login
supabase link --project-ref dimbgprindvmzoylzyud
```

#### Step 2 — Set the service_role secret on the function

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

Get your service_role key from **Supabase Dashboard → Project Settings → API → service_role (secret)**.

> ⚠️ This key is stored securely in Supabase's function environment only.
> Do NOT add it to Replit Secrets, Render env, or any frontend config.

#### Step 3 — Deploy the function

```bash
supabase functions deploy admin-users --no-verify-jwt
```

> `--no-verify-jwt` is used because the function verifies the JWT manually and checks the
> caller's profile role (`super_admin`). This gives us more control over the auth check.

#### Step 4 — Test the function

```bash
curl -i --request POST \
  "https://dimbgprindvmzoylzyud.supabase.co/functions/v1/admin-users" \
  --header "Authorization: Bearer <your-anon-or-user-jwt>" \
  --header "Content-Type: application/json" \
  --data '{ "action": "createUser", "payload": { "email": "test@example.com", "password": "Test1234!", "full_name": "Test User", "role": "end_user", "department": "IT", "location": "Bangalore" } }'
```

### How the function enforces security

1. Reads `Authorization: Bearer <token>` from request header
2. Creates a caller-scoped Supabase client with that token
3. Calls `getUser()` to verify the token is valid and not expired
4. Fetches the caller's profile row and checks `role = 'super_admin'`
5. If not `super_admin` → returns `403 Forbidden`
6. Only then uses the service-role client for the actual operation
7. The service_role key is never returned in any response

### Secrets summary

| Secret | Where it lives | Purpose |
|--------|---------------|---------|
| `VITE_SUPABASE_URL` | Replit Secrets + Render env | Frontend Supabase connection |
| `VITE_SUPABASE_ANON_KEY` | Replit Secrets + Render env | Frontend Supabase connection |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function secrets ONLY | Admin user operations inside Edge Function |

---

## 11. Adding Users (In-App Flow)

Once the Edge Function is deployed, Super Admin can:

1. Go to **Users** page in the app
2. Click **Add User**
3. Fill in: Full Name, Email, Role, Department, Location, Temporary Password
4. Click **Create User**
5. The Edge Function creates the auth user and profile in one step
6. Share the temporary password with the new user securely
7. The user can log in immediately — no email confirmation required

### Without the Edge Function

If the Edge Function is not deployed, the app shows a banner:
> "Admin user management backend is not configured yet. Please deploy the Supabase Edge Function."

You can still:
- View all users
- Edit user profiles (name, role, department, location, status)
- Deactivate / reactivate users
- Export users to CSV

You cannot:
- Create new users from inside the app
- Hard-delete users from inside the app

---

## 12. Security Checklist

- [x] Only `anon` / `public` key used in frontend
- [x] `service_role` key never in any frontend config
- [x] RLS enabled on all tables with `auth.uid() is not null`
- [x] Edge Function verifies caller is `super_admin` before any operation
- [x] No demo credentials or hardcoded users in source code
- [x] Anon key value never shown in `/supabase-check` UI
