// ── HR dashboard summary service layer ──────────────────────────────────────

import { supabase } from "@/lib/supabaseClient";
import type { HrDashboardSummary } from "@/lib/hrSyncTypes";

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function getHrDashboardSummary(): Promise<HrDashboardSummary> {
  const { data, error } = await supabase.rpc("get_hr_dashboard_summary");
  return unwrap(data, error);
}
