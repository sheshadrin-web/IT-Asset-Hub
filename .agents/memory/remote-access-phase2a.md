---
name: Remote Access Phase 2A
description: Four critical blocker fixes for the Miles Education remote access feature — what was done, what still needs manual steps, and what comes next.
---

## Branch
`feature/fix-existing-remote-access` — pushed to GitHub. Never commit remote access changes to main directly.

## What was fixed (commit 3cffbf9)

### Blocker 1 — Session never becomes active
`issue_remote_session_token` in **migrations/008_remote_access_blockers.sql** now has an idempotency guard: if the session is already `active` with an unexpired token, it returns the existing token/channel without regenerating. This prevents `RemoteTransportTest` (now DEV-only) from having called the RPC first, causing the viewer's second call to invalidate the agent's already-retrieved token.

### Blocker 2 — Dual channel conflict
`RemoteAccessModal.tsx`: `<RemoteTransportTest>` is now behind `import.meta.env.DEV &&` — Vite dead-code-eliminates it in production. The "Open Live Viewer" button is now `<Button asChild><a target="_blank" rel="noopener noreferrer">` — real anchor, never blocked as popup.

### Blocker 3 — No agent-side session-end reporting
- New columns `ended_by TEXT`, `end_reason TEXT`, `duration_seconds INTEGER` in `remote_access_sessions`.
- New RPC `agent_end_remote_session` — idempotent (returns `already_ended:true` on repeat), rejects wrong-device calls.
- New Edge Function route `POST /remote-access/session/end`.
- `_report_remote_session_end()` in agent — at-most-once per session-id, 10s timeout, 1 retry.
- `_run_remote_session` now tracks `_exit` dict and calls `_report_remote_session_end` from `finally` block. All 9 exit paths covered.

### Blocker 4 — Broken agent self-update URL
- `DEFAULT_AGENT_URL` fixed to `https://it.assets.mileseducation.org/agent/laptop_agent.py`.
- `_self_update()` now fetches `version.json` first, compares version, verifies SHA-256, backs up, rolls back on failure.
- `public/agent/version.json` created (sha256 = a6e7964258223e5bb6f0b6db8f9307cfcbe532e8d8be5caedd042ad51d7aee34).
- `public/agent/laptop_agent.py` synced.

## MANUAL STEPS REQUIRED BEFORE TESTING

### 1. Apply migration 008 in Supabase SQL Editor
Open: https://supabase.com/dashboard → SQL Editor
Run the full contents of: `migrations/008_remote_access_blockers.sql`
This adds the three new columns and two updated/new RPCs.

### 2. Deploy the Edge Function
The updated `artifacts/asset-desk/supabase/functions/agent-api/index.ts` must be deployed:
```
supabase functions deploy agent-api --project-ref dimbgprindvmzoylzyud
```
Or use `SUPABASE_ACCESS_TOKEN` secret if available.

### 3. Deploy the frontend to Render
Push `feature/fix-existing-remote-access` to main (or open a PR) and trigger a Render deploy to serve the new `public/agent/version.json` and updated `RemoteAccessModal.tsx`.

## Migrations file location
Root-level `migrations/` directory (not inside `artifacts/`). These are **not** Supabase CLI migrations — they are manually applied via the SQL Editor.

## Known remaining issues (Phase 2B+)
- Consent dialog: still shows only "Allow/Deny", no countdown, no mode selection, no reason/ticket display.
- Employee banner: only shows when admin takes control, not on session join.
- Admin-initiated disconnect does not set ended_by/end_reason/duration_seconds (viewer uses update_remote_access_session which lacks these params).
- No reconnect logic in viewer or agent.
- Multi-monitor not supported.
- Portal still polls every 5s for session status changes instead of Realtime subscription.

**Why:** Phase 2A was scoped to the four critical blockers only. Remaining items are Phase 2B+.
