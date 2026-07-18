<div align="center">

# 🖥️ IT Asset Hub — Miles Education

### *One source of truth for every asset, device, and IT request at Miles Education.*

**Built for [Miles Education Pvt Ltd](https://www.mileseducation.com)** — a modern, full-stack IT Asset Management system that helps the Miles IT team track hardware, software licenses, employee allocations, helpdesk tickets, and live device agents — end to end.

[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react\&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite\&logoColor=white)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript\&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-38B2AC?logo=tailwind-css\&logoColor=white)](https://tailwindcss.com)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase\&logoColor=white)](https://supabase.com)
[![Render](https://img.shields.io/badge/Deployed_on-Render-46E3B7?logo=render\&logoColor=white)](https://render.com)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](#-license)
[![Status](https://img.shields.io/badge/Status-Production-success.svg)](https://it-asset-hub-a7rf.onrender.com)

[🌐 Live Portal](https://it-asset-hub-a7rf.onrender.com) · [📸 Screenshots](#-screenshots) · [🚀 Quick Start](#-quick-start) · [👥 Roles](#-role-based-access)

`Internal tool · Miles Education Pvt Ltd · Bengaluru, India 🇮🇳`

</div>

---

## 📑 Table of Contents

1. [Why This Project?](#-why-this-project)
2. [Features](#-features)
3. [Tech Stack](#-tech-stack)
4. [Architecture Overview](#-architecture-overview)
5. [Folder Structure](#-folder-structure)
6. [Quick Start](#-quick-start)
7. [Environment Variables](#-environment-variables)
8. [Role-Based Access](#-role-based-access)
9. [Database Schema](#-database-schema)
10. [Device Agent System](#-device-agent-system)
11. [Remote Access](#-remote-access)
12. [Screenshots](#-screenshots)
13. [Deployment](#-deployment)
14. [Future Enhancements](#-future-enhancements)
15. [License](#-license)
16. [Contact](#-contact)

---

## 💡 Why This Project?

Before IT Asset Hub, the Miles Education IT team was managing assets across **Excel sheets, WhatsApp threads, and email approvals** — which breaks down fast at 100+ employees.

**IT Asset Hub** solves this with:

- 🎯 A single searchable inventory for **22+ asset categories** (laptops, monitors, mobiles, peripherals, network gear, fixed assets)
- 🔐 **Role-based access** so super admins, IT admins, HR, helpdesk agents, and employees each see exactly what they need
- 🤖 **Live device agent** — remotely lock, unlock, restart, manage wallpapers, and start remote access sessions on managed laptops
- 📝 A built-in **helpdesk** that links every ticket to a real asset
- 📊 **Real-time reports** with one-click CSV / XLSX exports for finance & audit
- 📨 **Assignment emails** with employee acknowledgement

> Deployed to production and actively managing Miles Education's IT inventory across every office.

---

## ✨ Features

### 🖥️ Asset Management
- ✅ **22+ asset categories** grouped into Main Devices · Accessories · Fixed Assets
- ✅ Auto-generated asset tags (`MILES-LAP-001`, `MILES-MOB-042`, …)
- ✅ Full lifecycle tracking: *Available → Assigned → Under Repair → Retired / Lost*
- ✅ **Dynamic asset type & field configuration** — admins can add new asset types and custom fields through the portal with no code changes (stored in `schema_asset_types` + `schema_asset_fields`)
- ✅ Searchable, filterable inventory with photo uploads
- ✅ Warranty + purchase-date tracking

### 🤖 Device Agent System
- ✅ **Agent key generation** — issue signed keys per device for the Python laptop agent
- ✅ **Live device commands** — Lock, Unlock, Force Restart sent from the portal and picked up by the agent
- ✅ **Wallpaper management** — push custom wallpapers to managed devices
- ✅ **Agent health monitoring** — last-seen timestamp, online/offline/inactive status
- ✅ **Force remove agent** — unmanage a device from the portal
- ✅ One-line install command generated per OS (Windows / macOS / Linux)

### 🔌 Remote Access
- ✅ **Assisted Access** — IT admin sends a request; a native OS dialog appears on the end-user's screen (Windows: MessageBoxW, macOS: osascript, Linux: zenity/kdialog); user clicks Allow or Deny; 60-second auto-deny timeout
- ✅ **Unattended Access** — super_admin only; direct session without user approval
- ✅ Session lifecycle: `requested → approved/denied → active → ended/failed`
- ✅ Full audit log for every session transition
- ✅ Per-asset session history panel with auto-polling every 5 seconds
- ✅ Toast notifications on status changes
- ✅ Pulsing indicator when a session is active

### 👥 Employee Allocations
- ✅ One-click assign / un-assign with handover notes
- ✅ Bulk assignment workflow
- ✅ Email notification + in-app acknowledgement by employee
- ✅ Complete assignment history

### 📥 Bulk Import
- ✅ Per-type CSV templates for all categories
- ✅ Smart column detection
- ✅ Per-row validation with errors shown **before** import

### 🎫 Helpdesk Tickets
- ✅ Raise tickets linked to assets or stand-alone
- ✅ Priorities, categories, SLA timestamps, comment threads
- ✅ Auto-assign agents by category

### 📊 Reports & Analytics
- ✅ Assets by Category (donut) + Assets by Type (bar)
- ✅ Per-category CSV exports
- ✅ Full XLSX summary (Assets, Tickets, Users, By Type, By Status, By Category, By Department)

### 🔐 Security
- ✅ **Row-Level Security** on every Supabase table — users can only read/write rows they're allowed to
- ✅ **SECURITY DEFINER RPCs** for sensitive operations (device commands, remote access, audit writes)
- ✅ **Audit log** — every sensitive operation writes to `audit_logs` with actor, action, entity, and metadata
- ✅ **Role-based access control** enforced at the DB level via Postgres role checks inside RLS policies

---

## 🧰 Tech Stack

| Layer              | Technology                                                    |
|--------------------|---------------------------------------------------------------|
| **Frontend**       | React 18, Vite 5, TypeScript 5, Tailwind CSS 3, shadcn/ui    |
| **State / Data**   | React Context, TanStack Query, Zod validation                 |
| **Backend / DB**   | Supabase — PostgreSQL 16, Auth, Storage, RLS, Edge Functions  |
| **Database client**| Supabase JS client (`@supabase/supabase-js`)                  |
| **Auth**           | Supabase Auth (email/password + role stored in `profiles`)    |
| **Deployment**     | Render (static site, auto-deploy from `main`)                 |
| **Icons**          | Lucide React                                                  |
| **Package manager**| pnpm (monorepo)                                               |

---

## 🏗️ Architecture Overview

```
                       ┌─────────────────────────────────┐
                       │     End Users (Browser)         │
                       │  Admin / IT / Agent / Employee  │
                       └──────────────┬──────────────────┘
                                      │ HTTPS
                                      ▼
                       ┌─────────────────────────────────┐
                       │     Render CDN / Static Site    │
                       │   React + Vite (SPA)            │
                       └──────────────┬──────────────────┘
                                      │ Supabase JS (REST + Realtime)
                                      ▼
              ┌────────────────────────────────────────────────┐
              │                  Supabase                      │
              │                                                │
              │  ┌──────────────┐   ┌────────────────────┐    │
              │  │  PostgreSQL  │   │   Supabase Auth    │    │
              │  │  (16)        │   │  (JWT, profiles)   │    │
              │  │              │   └────────────────────┘    │
              │  │  Tables:     │                              │
              │  │  assets      │   ┌────────────────────┐    │
              │  │  profiles    │   │  Supabase Storage  │    │
              │  │  tickets     │   │  (photos, agents)  │    │
              │  │  agent_keys  │   └────────────────────┘    │
              │  │  audit_logs  │                              │
              │  │  remote_     │   ┌────────────────────┐    │
              │  │  access_     │   │  SECURITY DEFINER  │    │
              │  │  sessions    │   │  RPCs (gated ops)  │    │
              │  │  + more…     │   └────────────────────┘    │
              │  └──────────────┘                              │
              │                                                │
              │  ┌─────────────────────────────────────────┐  │
              │  │       Edge Function: agent-api          │  │
              │  │  POST /register   POST /sync            │  │
              │  │  GET  /commands   POST /commands/status │  │
              │  │  GET  /wallpaper/active                 │  │
              │  │  POST /wallpaper/status                 │  │
              │  │  GET  /remote-access          ← NEW     │  │
              │  │  POST /remote-access/respond  ← NEW     │  │
              │  └─────────────────────────────────────────┘  │
              └────────────────────────────────────────────────┘
                                      ▲
                                      │ Agent API (HTTPS polling)
                       ┌─────────────────────────────────┐
                       │   Laptop Agent (Python)         │
                       │   Runs on managed Windows /     │
                       │   macOS / Linux devices         │
                       │   Picks up commands → executes  │
                       │   Polls for remote access       │
                       │   → shows native Allow/Deny     │
                       │     popup to end user           │
                       └─────────────────────────────────┘
```

**Design principles**
- **Supabase-first** — all business logic is enforced at the DB layer via RLS + SECURITY DEFINER functions, not just in the frontend
- **Role checks in the DB** — even if the client is bypassed, the RPC will reject the call if the caller's `profiles.role` doesn't qualify
- **Audit everything** — every command, session, assignment, and deletion writes to `audit_logs`
- **Agent-side verification** — device agent validates its key against Supabase before executing any command

---

## 📁 Folder Structure

```
IT-Asset-Hub/
├── artifacts/
│   └── asset-desk/              # React + Vite SPA
│       ├── src/
│       │   ├── components/      # UI components
│       │   │   ├── DeviceAgentCard.tsx   # Agent commands + Remote Access button
│       │   │   ├── RemoteAccessModal.tsx # Assisted / Unattended sessions UI
│       │   │   ├── AssetForm.tsx         # Dynamic asset form (reads DB config)
│       │   │   ├── AssetDetail.tsx       # Full asset detail page
│       │   │   ├── WallpaperManager.tsx  # Push wallpapers to devices
│       │   │   └── settings/
│       │   │       └── AssetTypesConfig.tsx  # Schema admin panel
│       │   ├── context/
│       │   │   ├── AuthContext.tsx       # Role, session, hasRole()
│       │   │   └── AssetConfigContext.tsx# Asset types + fields from DB
│       │   ├── lib/
│       │   │   ├── supabaseClient.ts
│       │   │   └── auditService.ts
│       │   └── pages/           # Route pages
│       └── public/
│           └── agent/
│               └── laptop_agent.py      # Downloadable Python agent
│
├── artifacts/asset-desk/
│   └── supabase/functions/agent-api/
│       └── index.ts             # Supabase Edge Function (all agent routes)
│
├── migrations/
│   ├── 001_schema_asset_types.sql   # Asset type/field config tables
│   └── 002_remote_access_sessions.sql # Remote access table + RPCs
│
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+ and pnpm
- A Supabase project (free tier works)

### 1. Clone & install

```bash
git clone https://github.com/sheshadrin-web/IT-Asset-Hub.git
cd IT-Asset-Hub
pnpm install
```

### 2. Configure environment

```bash
cp artifacts/asset-desk/.env.example artifacts/asset-desk/.env.local
# Fill in your Supabase URL and anon key
```

### 3. Run migrations

Run all SQL files in `migrations/` in order against your Supabase project:

```
migrations/001_schema_asset_types.sql
migrations/002_remote_access_sessions.sql
```

You can run them from the Supabase Dashboard → SQL Editor, or via the Supabase Management API.

### 4. Deploy Edge Function

```bash
cd artifacts/asset-desk
supabase functions deploy agent-api \
  --project-ref <your-project-ref> \
  --no-verify-jwt \
  --use-api
```

### 5. Start dev server

```bash
pnpm --filter @workspace/asset-desk run dev
```

---

## 🔐 Environment Variables

```bash
# artifacts/asset-desk/.env.local

VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

> The anon key is safe to include in the frontend — all access is governed by Row-Level Security at the Postgres level. Never use the service role key in the frontend.

---

## 👥 Role-Based Access

Five roles are enforced at the database level (RLS policies check `profiles.role`):

| Role            | Assets                         | Agent Commands                 | Remote Access                    | Reports       | Users          |
|-----------------|--------------------------------|--------------------------------|----------------------------------|---------------|----------------|
| 🟣 **super_admin** | Full CRUD + delete             | All commands + force remove    | Assisted + Unattended            | Full + export | Full CRUD      |
| 🔵 **it_admin**    | Full CRUD, assign, import      | Read status, basic commands    | Assisted only                    | Full + export | Read           |
| 🟠 **hr_admin**    | Read + assignment history      | —                              | —                                | HR-scoped     | Read           |
| 🟢 **it_agent**    | Read + status update           | —                              | —                                | Read          | —              |
| ⚪ **end_user**    | Read own assigned assets       | —                              | —                                | —             | —              |

RBAC is enforced at **three layers**:
1. **Frontend** — UI elements are conditionally rendered by role
2. **RLS policies** — `SELECT/INSERT/UPDATE/DELETE` on every table checks `auth.uid()` + `profiles.role`
3. **SECURITY DEFINER RPCs** — sensitive operations (device commands, remote access) validate the caller's role inside the function body before executing

---

## 🗄️ Database Schema

### Core tables

| Table                    | Purpose                                                    |
|--------------------------|------------------------------------------------------------|
| `assets`                 | Every asset record with all fields                         |
| `profiles`               | Extended user info including `role`, `ecode`, `department` |
| `asset_assignment_history` | Full timeline of assign / return / acknowledge events    |
| `tickets`                | Helpdesk tickets linked to assets                          |
| `ticket_comments`        | Comment threads on tickets                                 |
| `audit_logs`             | Append-only log of every sensitive operation               |

### Agent tables

| Table                  | Purpose                                                      |
|------------------------|--------------------------------------------------------------|
| `agent_tokens`         | Signed keys issued to managed devices                        |
| `managed_devices`      | Live device status (hostname, OS, last_seen, is_managed)     |
| `device_commands`      | Queue of commands (lock, unlock, restart, …) + status        |
| `wallpaper_configs`    | Wallpaper assignments per device                             |
| `remote_access_sessions` | Remote access session lifecycle + audit trail              |

### Schema config tables

| Table                 | Purpose                                                        |
|-----------------------|----------------------------------------------------------------|
| `schema_asset_types`  | Admin-configurable asset type definitions (name, group, emoji) |
| `schema_asset_fields` | Per-type custom field definitions (key, label, type, section)  |

### Key RPCs (SECURITY DEFINER)

#### Portal-side (called by authenticated users via Supabase JS client)

| RPC                            | Role required        | What it does                                      |
|--------------------------------|----------------------|---------------------------------------------------|
| `generate_agent_token`         | super_admin          | Creates a signed agent key + managed_device row   |
| `revoke_agent_token`           | super_admin          | Revokes a key and marks device inactive           |
| `queue_device_command`         | super_admin          | Enqueues lock / unlock / restart / update command |
| `force_remove_agent`           | super_admin          | Unmanages a device and writes audit log           |
| `request_remote_access`        | super_admin/it_admin | Creates a remote access session                   |
| `update_remote_access_session` | super_admin/it_admin | Transitions session status, writes audit log      |
| `get_remote_access_sessions`   | super_admin/it_admin | Returns recent sessions for an asset              |
| `get_audit_logs`               | hr_admin+            | Returns the audit log (read-only)                 |

#### Agent-side (called by the Edge Function using the service role, keyed by agent token)

| RPC                                | Auth              | What it does                                                    |
|------------------------------------|-------------------|-----------------------------------------------------------------|
| `agent_register`                   | agent token       | Registers / updates device info in `managed_devices`            |
| `agent_sync`                       | agent token       | Periodic heartbeat — updates `last_seen`, returns config        |
| `agent_fetch_commands`             | agent token       | Returns pending commands for this device                        |
| `agent_update_command`             | agent token       | Reports command result (completed / failed)                     |
| `agent_get_active_wallpaper`       | agent token       | Returns the active wallpaper URL for this device                |
| `agent_report_wallpaper`           | agent token       | Reports wallpaper apply result                                  |
| `agent_get_pending_remote_access`  | agent token       | Returns `requested` sessions pending end-user approval          |
| `agent_respond_remote_access`      | agent token       | Posts the end-user's Allow/Deny response, updates session       |

All agent-side RPCs use `_auth_agent(p_token)` internally — if the token is invalid or revoked, the RPC returns `{ success: false }` without leaking any data.

---

## 🤖 Device Agent System

The device agent is a Python script that runs as a background service on managed laptops.

### How it works

1. IT admin generates an **Agent Key** from the portal for a specific asset
2. The portal shows a **one-line install command** (with the key embedded) for Windows / macOS / Linux
3. The agent script is downloaded and started — it registers the device in `managed_devices`
4. The agent **polls Supabase** (via the Edge Function) on an adaptive cadence:
   - Fast (5 s) while commands are flowing or a remote access session is pending
   - Slow (30 s) when idle — cuts edge-function invocations ~83%
5. On receiving a command, the agent executes it locally (lock screen, restart, etc.) and reports back the result
6. The agent also polls for **remote access approval requests** and shows a native dialog to the logged-in user
7. The portal shows live status, last-seen time, and command history

### Supported commands

| Command           | Effect on device                            |
|-------------------|---------------------------------------------|
| `lock_screen`     | Locks the Windows / macOS / Linux session   |
| `unlock_screen`   | Unlocks the session                         |
| `force_restart`   | Initiates a system reboot                   |
| `push_wallpaper`  | Downloads and sets a new wallpaper          |
| `update_agent`    | Self-updates the agent script               |

### Agent API routes (Edge Function)

All routes are authenticated via `X-Agent-Token` header.

| Method | Route                      | Purpose                                           |
|--------|----------------------------|---------------------------------------------------|
| POST   | `/register`                | First-run device registration                     |
| POST   | `/sync`                    | Periodic heartbeat + config pull                  |
| GET    | `/commands`                | Fetch pending commands                            |
| POST   | `/commands/status`         | Report command result                             |
| GET    | `/wallpaper/active`        | Get active wallpaper URL                          |
| POST   | `/wallpaper/status`        | Report wallpaper apply result                     |
| GET    | `/remote-access`           | Fetch pending Assisted Access sessions            |
| POST   | `/remote-access/respond`   | Post end-user Allow/Deny response                 |

---

## 🔌 Remote Access

Remote access sessions are tracked with a full audit trail. The end-user approval popup runs natively on the managed device via the Python agent.

### Session flow — Assisted Access

```
IT Admin clicks "Request Assisted Access" in portal
         │
         ▼
  Portal calls request_remote_access RPC
  → session created (status: requested)
         │
         ▼ (agent polls GET /remote-access every 5 s)
  Python agent finds pending session
         │
         ▼
  Native OS dialog appears on end-user's screen:
  ┌─────────────────────────────────────────────────────┐
  │  Miles IT — Remote Access Request                   │
  │                                                     │
  │  [Admin Name] is requesting remote access to        │
  │  your computer.                                     │
  │                                                     │
  │  Click Allow to permit, or Deny to reject.          │
  │  Auto-denied in 60 seconds if no response.          │
  │                                                     │
  │           [ Deny ]          [ Allow ]               │
  └─────────────────────────────────────────────────────┘

  Platform implementations:
    Windows  — ctypes MessageBoxW (no extra packages)
    macOS    — osascript display dialog
    Linux    — zenity → kdialog fallback

         │ user clicks Allow or Deny (or 60 s elapses)
         ▼
  Agent POSTs to /remote-access/respond
  → session status: approved / denied
  → audit log written
         │
         ▼
  Portal modal polls every 5 s → updates status
  → toast notification fires
  → pulsing dot shows when session is active
```

### Session flow — Unattended Access

```
super_admin only — confirmation dialog in portal
         │
         ▼
  Portal calls request_remote_access (mode: unattended)
  → session status: active immediately (no user prompt)
         │
         ▼
  Admin connects via remote desktop tool
  Admin clicks "End Session" when done
  → session status: ended + audit log
```

Every status transition writes to `audit_logs` via `_log_remote_access_audit()`.

---

## 📸 Screenshots

> Live portal: **[it-asset-hub-a7rf.onrender.com](https://it-asset-hub-a7rf.onrender.com)**

<table>
  <tr>
    <td width="50%"><strong>Sign In</strong><br/><img src="docs/screenshots/01-login.png" alt="Sign in" /></td>
    <td width="50%"><strong>Dashboard</strong><br/><img src="docs/screenshots/02-dashboard.png" alt="Dashboard" /></td>
  </tr>
  <tr>
    <td width="50%"><strong>Asset Inventory</strong><br/><img src="docs/screenshots/03-assets-list.png" alt="Asset inventory" /></td>
    <td width="50%"><strong>Add Asset</strong><br/><img src="docs/screenshots/04-add-asset.png" alt="Add asset" /></td>
  </tr>
  <tr>
    <td width="50%"><strong>Bulk Import</strong><br/><img src="docs/screenshots/05-bulk-import.png" alt="Bulk import" /></td>
    <td width="50%"><strong>Reports &amp; Analytics</strong><br/><img src="docs/screenshots/06-reports.png" alt="Reports and analytics" /></td>
  </tr>
  <tr>
    <td width="50%"><strong>Helpdesk Tickets</strong><br/><img src="docs/screenshots/07-tickets.png" alt="Helpdesk tickets" /></td>
    <td width="50%"><strong>Users &amp; Roles</strong><br/><img src="docs/screenshots/08-users.png" alt="Users and roles" /></td>
  </tr>
</table>

---

## 🚀 Deployment

The portal is deployed as a **Vite static build** on [Render](https://render.com) with automatic deploys on every push to `main`.

### Render settings

| Setting         | Value                                |
|-----------------|--------------------------------------|
| Build command   | `pnpm --filter @workspace/asset-desk run build` |
| Publish dir     | `artifacts/asset-desk/dist`          |
| Auto-deploy     | Yes (from `main` branch)             |

### Edge Function deployment

The agent API Edge Function must be deployed via the **Supabase CLI** (not the Management REST API) so the TypeScript is correctly bundled for Deno:

```bash
SUPABASE_ACCESS_TOKEN=<your-token> \
supabase functions deploy agent-api \
  --project-ref <your-project-ref> \
  --no-verify-jwt \
  --use-api
```

> **Note:** Deploying Edge Functions via the Management API's `body` field does **not** compile the TypeScript and causes a BOOT_ERROR. Always use `supabase functions deploy --use-api`.

### Database

Supabase manages the PostgreSQL database, Auth, and Storage — no separate DB deployment needed. Run new migration files from `migrations/` in the Supabase SQL Editor after each schema change.

---

## 🚧 Future Enhancements

- [ ] 🖥️ **Live remote desktop** — WebRTC or third-party engine for actual screen sharing (portal session tracking + end-user popup are complete ✅)
- [ ] 📱 **Mobile app** (Expo / React Native) for on-the-go asset scanning
- [ ] 📷 **QR / barcode** generation per asset + camera scan
- [ ] 🧾 **Software license** tracking with seat-count & renewal alerts
- [ ] 🔔 **Slack / MS Teams** notifications for tickets and device alerts
- [ ] 📅 **Procurement workflow** — purchase requests → approvals → PO → GRN
- [ ] 🤖 **AI ticket triage** — auto-classify category & suggest resolution
- [ ] 🌍 **Multi-location** dashboard filtered by Miles / Miles-GCC / Mojo offices
- [ ] 🌓 **Dark mode** toggle
- [ ] 🔌 **SSO** (Google Workspace)

---

## 📄 License

This project is **proprietary software** built for and owned by **Miles Education Pvt Ltd**.
The source is published for internal collaboration and portfolio reference only.

```
Copyright © 2026 Miles Education Pvt Ltd. All rights reserved.

This software is the confidential and proprietary information of
Miles Education Pvt Ltd ("Confidential Information"). You shall not
disclose such Confidential Information and shall use it only in
accordance with the terms of the agreement you entered into with
Miles Education.
```

---

## 📬 Contact

<div align="center">

**Sheshadri Nagaraj**
IT Asset Management Lead · **Miles Education Pvt Ltd** · [mileseducation.com](https://www.mileseducation.com)

[![Email](https://img.shields.io/badge/Email-sheshadri.n%40mileseducation.com-D14836?logo=gmail\&logoColor=white)](mailto:sheshadri.n@mileseducation.com)
[![GitHub](https://img.shields.io/badge/GitHub-sheshadrin--web-181717?logo=github\&logoColor=white)](https://github.com/sheshadrin-web)
[![Live Demo](https://img.shields.io/badge/Live-Demo-success?logo=render\&logoColor=white)](https://it-asset-hub-a7rf.onrender.com)

</div>
