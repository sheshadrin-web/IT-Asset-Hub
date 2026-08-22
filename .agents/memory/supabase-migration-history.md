---
name: Supabase migration history
description: Safe handling when a linked Supabase project has no matching local migration history
---

When a linked Supabase project has existing schema objects but no usable migration history, do not replay the entire repository blindly. Use the Supabase CLI from an isolated migration directory containing only the approved, idempotent migrations needed for the deployment, then confirm the remote migration list.

**Why:** Replaying unrelated historical migrations can fail on already-existing objects or apply changes outside the approved deployment scope.

**How to apply:** Confirm the target files are under the CLI's `supabase/migrations` path, run `db push --dry-run`, push, and verify `migration list --linked` shows the intended versions.