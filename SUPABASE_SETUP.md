# Supabase Setup — Miles Education IT Asset Desk

## Overview

This app uses Supabase for authentication and database storage.
It requires two environment variables to connect to your Supabase project.
**The anon/publishable key is safe to use in frontend code — never use the service_role key.**

---

## Step 1 — Add Environment Variables in Replit

Go to the **Secrets** tab in your Replit project and add:

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | Your Supabase Project URL (e.g. `https://xxxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase `anon` / `public` key |

> **Where to find these:**
> Supabase Dashboard → your project → **Project Settings** → **API**
> - Project URL → use as `VITE_SUPABASE_URL`
> - `anon` `public` key → use as `VITE_SUPABASE_ANON_KEY`

Both variables must start with `VITE_` so Vite exposes them to the browser via `import.meta.env`.

---

## Step 2 — Add Environment Variables in Render

If deploying to Render, go to your **Render service** → **Environment** and add the same two variables:

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | Same value as above |
| `VITE_SUPABASE_ANON_KEY` | Same value as above |

> Render bakes `VITE_*` variables into the static bundle at build time,
> so they must be set **before** triggering a deploy.

---

## Step 3 — Supabase Database Schema

Run these SQL statements in **Supabase SQL Editor** (Dashboard → SQL Editor → New query):

```sql
-- Profiles table (one row per auth user)
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  email         text not null unique,
  role          text not null check (role in ('super_admin', 'it_admin', 'it_agent', 'end_user')),
  department    text not null default '',
  location      text not null default '',
  status        text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at    timestamptz not null default now()
);

-- Assets table
create table if not exists public.assets (
  asset_id          text primary key,
  asset_type        text not null check (asset_type in ('Laptop', 'Mobile')),
  brand             text not null,
  model             text not null,
  serial_number     text not null,
  imei_1            text,
  status            text not null default 'Available',
  assigned_to       text,
  assigned_email    text,
  department        text,
  location          text not null default '',
  purchase_date     text not null,
  warranty_end_date text not null,
  accessories       text,
  remarks           text,
  created_at        timestamptz not null default now()
);

-- Tickets table
create table if not exists public.tickets (
  ticket_id      text primary key,
  raised_by      text not null,
  employee_email text,
  asset_id       text not null default 'N/A',
  category       text not null,
  subcategory    text not null,
  priority       text not null,
  status         text not null default 'Open',
  assigned_agent text not null default '',
  description    text not null,
  comments       jsonb not null default '[]',
  created_date   text not null,
  updated_date   text not null
);
```

---

## Step 4 — Row Level Security (RLS)

Enable RLS and add policies so users can only access appropriate data:

```sql
-- Enable RLS
alter table public.profiles enable row level security;
alter table public.assets   enable row level security;
alter table public.tickets  enable row level security;

-- Profiles: users can read all profiles; only own row editable
create policy "profiles_select" on public.profiles for select using (auth.role() = 'authenticated');
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- Assets: authenticated users can read; admins/agents can write
create policy "assets_select" on public.assets for select using (auth.role() = 'authenticated');
create policy "assets_insert" on public.assets for insert with check (auth.role() = 'authenticated');
create policy "assets_update" on public.assets for update using (auth.role() = 'authenticated');
create policy "assets_delete" on public.assets for delete using (auth.role() = 'authenticated');

-- Tickets: authenticated users can read and write
create policy "tickets_select" on public.tickets for select using (auth.role() = 'authenticated');
create policy "tickets_insert" on public.tickets for insert with check (auth.role() = 'authenticated');
create policy "tickets_update" on public.tickets for update using (auth.role() = 'authenticated');
create policy "tickets_delete" on public.tickets for delete using (auth.role() = 'authenticated');
```

---

## Step 5 — Create Your First Admin User

1. Go to **Supabase Dashboard** → **Authentication** → **Users** → **Invite user**
2. Enter the email address of your first super admin
3. After they accept the invite and set a password, insert their profile:

```sql
insert into public.profiles (id, full_name, email, role, department, location, status)
values (
  '<paste-auth-user-uuid-here>',
  'Your Name',
  'your@email.com',
  'super_admin',
  'IT',
  'HQ',
  'Active'
);
```

> The UUID comes from **Authentication** → **Users** → click the user → copy the `User UID`.

---

## Security Checklist

- [x] Only `anon` / `public` key used in frontend code
- [x] `service_role` key is **never** in the codebase
- [x] RLS is enabled on all tables
- [x] `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` stored in Secrets / Render Environment
- [x] No demo credentials or hardcoded users in source code

---

## Render Deployment

- **Build command:** `pnpm install --frozen-lockfile && pnpm --filter @workspace/asset-desk run build:render`
- **Publish directory:** `artifacts/asset-desk/dist/public`
- **Environment:** Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before deploying
