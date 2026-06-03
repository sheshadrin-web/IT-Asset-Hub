// ── Audit log read service ───────────────────────────────────────────────────
// audit_logs is RLS-locked; the only reader is the get_audit_logs SECURITY DEFINER
// RPC (role-gated via _hr_can_read). Returns a chronological activity feed.

import { supabase } from "@/lib/supabaseClient";

export interface AuditLogRow {
  id:          string;
  actor_name:  string | null;
  actor_email: string | null;
  action:      string;
  entity_type: string | null;
  entity_id:   string | null;
  description: string | null;
  metadata:    Record<string, unknown> | null;
  created_at:  string;
}

export async function getAuditLogs(limit = 100): Promise<AuditLogRow[]> {
  const { data, error } = await supabase.rpc("get_audit_logs", { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditLogRow[];
}
