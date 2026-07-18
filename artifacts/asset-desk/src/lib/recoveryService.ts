// ── Asset recovery service layer ─────────────────────────────────────────────
//
// Wrappers over the recovery RPCs. All actions are SECURITY DEFINER and gated to
// super_admin / it_admin server-side. Throws on error.

import { supabase } from "@/lib/supabaseClient";
import type { RecoveryRow, RecoveryStatus } from "@/lib/hrSyncTypes";

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function getRecoveryAssets(status?: RecoveryStatus | null): Promise<RecoveryRow[]> {
  const { data, error } = await supabase.rpc("get_recovery_assets", { p_status: status ?? null });
  return unwrap(data, error) ?? [];
}

export async function getAssetRecovery(assetId: string): Promise<RecoveryRow | null> {
  const { data, error } = await supabase.rpc("get_asset_recovery", { p_asset_id: assetId });
  if (error) throw new Error(error.message);
  return (data as RecoveryRow | null) ?? null;
}

export async function locateRecovery(recoveryId: string): Promise<RecoveryRow> {
  const { data, error } = await supabase.rpc("recovery_locate", { p_recovery_id: recoveryId });
  return unwrap(data, error);
}

export async function updateRecoveryStatus(recoveryId: string, status: RecoveryStatus): Promise<RecoveryRow> {
  const { data, error } = await supabase.rpc("recovery_update_status", {
    p_recovery_id: recoveryId,
    p_status: status,
  });
  return unwrap(data, error);
}

export async function markRecovered(recoveryId: string): Promise<RecoveryRow> {
  const { data, error } = await supabase.rpc("recovery_mark_recovered", { p_recovery_id: recoveryId });
  return unwrap(data, error);
}

export interface NotifyResult {
  ok: boolean;
  target: string;
  to: string;
  message: string;
}

export async function notifyRecovery(recoveryId: string, target: "employee" | "manager"): Promise<NotifyResult> {
  const { data, error } = await supabase.rpc("recovery_notify", {
    p_recovery_id: recoveryId,
    p_target: target,
  });
  return unwrap(data, error);
}
