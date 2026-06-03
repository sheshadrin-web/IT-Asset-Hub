// ── HR dashboard / onboarding-offboarding queue service layer ────────────────

import { supabase } from "@/lib/supabaseClient";
import type { HrDashboardSummary, HrProfileRow } from "@/lib/hrSyncTypes";

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function getHrDashboardSummary(): Promise<HrDashboardSummary> {
  const { data, error } = await supabase.rpc("get_hr_dashboard_summary");
  return unwrap(data, error);
}

export async function getOnboardingQueue(): Promise<HrProfileRow[]> {
  const { data, error } = await supabase.rpc("get_onboarding_queue");
  return unwrap(data, error) ?? [];
}

export async function getOffboardingQueue(): Promise<HrProfileRow[]> {
  const { data, error } = await supabase.rpc("get_offboarding_queue");
  return unwrap(data, error) ?? [];
}

export async function markOnboardingDone(profileId: string): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc("mark_onboarding_done", { p_profile_id: profileId });
  return unwrap(data, error);
}
