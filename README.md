# IT Asset Hub — Miles Education Pvt Ltd

Internal IT Asset Management & Helpdesk portal for Miles Education.
Live: **https://it-asset-hub-a7rf.onrender.com**

Track laptops, mobiles and 20 other asset categories across the org, assign them
to employees, manage helpdesk tickets, and pull rich CSV / XLSX reports.

---

## Features

### Assets
- **22 asset categories**, grouped into 3 buckets:
  - **Main Devices** — Laptop, Desktop, Mobile, Tab, CPU
  - **Accessories** — Monitor, Keyboard, Mouse, Headset, Hard Disk, Speaker, Docking Station, Camera, Generic Asset
  - **Fixed Assets** — Printer, Router, Server, CCTV, Smart TV, Projector, Network Device, Firewall
- Auto-generated asset IDs (`MILES-LAP-001`, `MILES-MOB-001`, …)
- Searchable type combobox, full asset detail pages, photo uploads
- Assignment workflow with employee acknowledgement (email + in-app)
- Status tracking: Available / Assigned / Under Repair / Retired / Lost

### Bulk Import (CSV)
- Per-type dropdown with **22 downloadable CSV templates**
- Smart column detection (handles Google Sheets / Excel exports, fuzzy header
  matching, UTF-8 BOM)
- Per-row validation with errors shown before import
- Failed-row DB error messages surfaced on the Done screen for self-diagnosis

### Helpdesk Tickets
- Raise / assign / track tickets linked to assets or stand-alone
- Categories, priorities, SLA timestamps, comment threads

### Reports
- **Assets by Category** donut + **Assets by Type** horizontal bar (all 22 types)
- Per-category CSV exports (Main Devices / Accessories / Fixed Assets)
- Full XLSX summary (7 sheets: Assets, Tickets, Users, By Type, By Status,
  By Category, By Department) — 26-column richer CSV with processor, RAM,
  storage, OS, IMEI 1/2, SIM, phone, vendor, invoice, e-code, etc.

### Users & Roles
- Super Admin, IT Admin, Helpdesk Agent, Employee
- Bulk user import, role management, profile photos
- Supabase Auth (email + magic link)

---

## Stack

| Layer       | Tech                                                         |
| ----------- | ------------------------------------------------------------ |
| Frontend    | React 18 + Vite 7 + TypeScript 5.9                           |
| UI          | shadcn/ui + Tailwind CSS + lucide-react + Recharts           |
| State       | TanStack Query + React Context                               |
| Backend     | Supabase (Postgres + Auth + Storage + RLS)                   |
| Email       | Nodemailer via Gmail SMTP (assignment / ack notifications)   |
| Hosting     | Render (static site)                                         |
| Monorepo    | pnpm workspaces                                              |

---

## Project Structure

```
artifacts/asset-desk/
├── src/
│   ├── pages/           # Dashboard, Assets, AssetDetail, BulkImport,
│   │                    # Tickets, TicketDetail, Reports, Users, Login, ...
│   ├── components/      # AssetForm, Layout, ProfileSettingsModal, ui/...
│   ├── context/         # AuthContext, AssetContext, TicketContext, UsersContext
│   ├── lib/             # supabaseClient, assetEmoji, utils
│   ├── hooks/           # use-toast, use-mobile
│   └── data/            # mockData (TypeScript types)
└── public/              # logo, favicons
```

---

## Environment Variables

Required (set in Render → Environment, or `.env` locally):

| Variable                  | Purpose                                      |
| ------------------------- | -------------------------------------------- |
| `VITE_SUPABASE_URL`       | `https://<project-ref>.supabase.co`          |
| `VITE_SUPABASE_ANON_KEY`  | Supabase anon/public key                     |
| `GMAIL_USER`              | SMTP sender address (e.g. it@mileseducation) |
| `GMAIL_APP_PASSWORD`      | 16-char Google app password                  |
| `SESSION_SECRET`          | Random string for session cookies            |

---

## Local Development

```bash
# Install deps (pnpm workspace root)
pnpm install

# Run only the asset-desk web app
pnpm --filter @workspace/asset-desk run dev

# Typecheck before committing
pnpm --filter @workspace/asset-desk run typecheck

# Production build
pnpm --filter @workspace/asset-desk run build
```

App runs on the port assigned by the Replit workflow (`$PORT`) and is reached
through the shared proxy at `localhost:80/`.

---

## Database (Supabase)

- Project ref: `dimbgprindvmzoylzyud`
- Schema-managed via Supabase Studio; key tables:
  - `assets` — 42 columns, `asset_type` CHECK constraint enforces the 22 types
  - `profiles` — extended user info linked to `auth.users`
  - `tickets`, `ticket_comments`
  - `asset_assignment_history` — full audit trail of assignments / returns
- RLS enabled on every table; policies based on `auth.uid()` and role.

### Asset ID convention
`MILES-<TYPE>-<NNN>` (e.g. `MILES-LAP-001`, `MILES-MOB-042`, `MILES-CCTV-007`)

---

## Deployment

Auto-deploys to **Render** on every push to `main`:
- Build command: `pnpm install && pnpm --filter @workspace/asset-desk run build`
- Publish directory: `artifacts/asset-desk/dist`
- SPA rewrites: `/*` → `/index.html`

Live URL: https://it-asset-hub-a7rf.onrender.com

---

## Contributing

1. Create a branch, make changes, run `pnpm --filter @workspace/asset-desk run typecheck`
2. Open a PR to `main`
3. Render builds & ships automatically on merge

Owner: **sheshadri.n@mileseducation.com**
Repo: https://github.com/sheshadrin-web/IT-Asset-Hub
