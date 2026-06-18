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

### 🔌 Remote Access (Portal Phase)
- ✅ **Assisted Access** — send a remote access request; end user approves on their device (agent integration Phase 2)
- ✅ **Unattended Access** — super_admin only; direct session without user approval
- ✅ Session lifecycle: requested → approved/denied → active → ended/failed
- ✅ Full audit log for every session transition
- ✅ Per-asset session history panel

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
              └────────────────────────────────────────────────┘
                                      ▲
                                      │ Agent API (HTTPS polling)
                       ┌─────────────────────────────────┐
                       │   Laptop Agent (Python)         │
                       │   Runs on managed Windows /     │
                       │   macOS / Linux devices         │
                       │   Picks up commands → executes  │
                       │   → reports back status         │
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
│       └── src/
│           ├── components/      # UI components
│           │   ├── DeviceAgentCard.tsx   # Agent commands, remote access
│           │   ├── RemoteAccessModal.tsx # Assisted / Unattended sessions
│           │   ├── AssetForm.tsx         # Dynamic asset form (reads DB config)
│           │   ├── AssetDetail.tsx       # Full asset detail page
│           │   ├── WallpaperManager.tsx  # Push wallpapers to devices
│           │   └── settings/
│           │       └── AssetTypesConfig.tsx  # Schema admin panel
│           ├── context/
│           │   ├── AuthContext.tsx       # Role, session, hasRole()
│           │   └── AssetConfigContext.tsx# Asset types + fields from DB
│           ├── lib/
│           │   ├── supabaseClient.ts
│           │   └── auditService.ts
│           └── pages/           # Route pages
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

### 4. Start dev server

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

| RPC                            | Role required       | What it does                                      |
|--------------------------------|---------------------|---------------------------------------------------|
| `generate_agent_token`         | super_admin         | Creates a signed agent key + managed_device row   |
| `revoke_agent_token`           | super_admin         | Revokes a key and marks device inactive           |
| `queue_device_command`         | super_admin         | Enqueues lock / unlock / restart / update command |
| `force_remove_agent`           | super_admin         | Unmanages a device and writes audit log           |
| `request_remote_access`        | super_admin/it_admin | Creates a remote access session                  |
| `update_remote_access_session` | super_admin/it_admin | Transitions session status, writes audit log     |
| `get_remote_access_sessions`   | super_admin/it_admin | Returns recent sessions for an asset             |
| `get_audit_logs`               | hr_admin+           | Returns the audit log (read-only)                 |

---

## 🤖 Device Agent System

The device agent is a Python script that runs as a background service on managed laptops.

### How it works

1. IT admin generates an **Agent Key** from the portal for a specific asset
2. The portal shows a **one-line install command** (with the key embedded) for Windows / macOS / Linux
3. The agent script is downloaded and started — it registers the device in `managed_devices`
4. The agent **polls Supabase** every 30 seconds for pending `device_commands`
5. On receiving a command, the agent executes it locally (lock screen, restart, etc.) and reports back the result
6. The portal shows live status, last-seen time, and command history

### Supported commands

| Command           | Effect on device                            |
|-------------------|---------------------------------------------|
| `lock_screen`     | Locks the Windows / macOS / Linux session   |
| `unlock_screen`   | Unlocks the session                         |
| `force_restart`   | Initiates a system reboot                   |
| `push_wallpaper`  | Downloads and sets a new wallpaper          |
| `update_agent`    | Self-updates the agent script               |

---

## 🔌 Remote Access

Remote access sessions are tracked in the portal with a full audit trail. The live remote desktop engine is planned for Phase 2.

### Session flow

```
IT Admin opens RemoteAccessModal
         │
         ▼
  ┌──────────────┐    ┌────────────────────────────────────────┐
  │   Assisted   │───▶│ status: requested                      │
  │   Access     │    │ End-user sees approval prompt (Phase 2)│
  └──────────────┘    │ → approved / denied by user            │
                      │ → active / ended by admin              │
                      └────────────────────────────────────────┘

  ┌──────────────┐    ┌────────────────────────────────────────┐
  │  Unattended  │───▶│ Warning confirmation shown to admin    │
  │  Access      │    │ status: active immediately             │
  │ (super_admin)│    │ → ended by admin when done             │
  └──────────────┘    └────────────────────────────────────────┘
```

Every transition writes to `audit_logs` via `_log_remote_access_audit()`.

---

## 📸 Screenshots

*Screenshots will be added here once production UI is stable.*

---

## 🚀 Deployment

The portal is deployed as a **Vite static build** on [Render](https://render.com) with automatic deploys on every push to `main`.

### Render settings

| Setting         | Value                                |
|-----------------|--------------------------------------|
| Build command   | `pnpm --filter @workspace/asset-desk run build` |
| Publish dir     | `artifacts/asset-desk/dist`          |
| Auto-deploy     | Yes (from `main` branch)             |

### Database

Supabase manages the PostgreSQL database, Auth, and Storage — no separate DB deployment needed. Run new migration files from `migrations/` in the Supabase SQL Editor after each schema change.

---

## 🚧 Future Enhancements

- [ ] 🖥️ **Live remote desktop** — Phase 2 of remote access (WebRTC or third-party engine)
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
