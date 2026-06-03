// ── HR Integration service layer ─────────────────────────────────────────────
//
// Thin wrappers over the Supabase RPCs. Every call goes through a SECURITY
// DEFINER function so credentials never reach the client and role checks are
// enforced server-side. Each wrapper throws on error so callers can surface an
// honest failure message (no silent fallbacks).

import { supabase } from "@/lib/supabaseClient";
import type {
  IntegrationRow,
  SyncLogRow,
  SyncResult,
  TestResult,
} from "@/lib/hrSyncTypes";
import type { FieldMappingRow } from "@/lib/hrIntegrations";

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function getIntegrations(): Promise<IntegrationRow[]> {
  const { data, error } = await supabase.rpc("get_hr_integrations");
  return unwrap(data, error) ?? [];
}

export interface SaveIntegrationInput {
  provider_type: string;
  provider_name: string;
  api_base_url: string | null;
  /** Raw credential field values. Pass `{}` to keep the stored secret unchanged. */
  credentials: Record<string, string>;
  auto_sync: boolean;
  frequency: string;
}

export async function saveIntegration(input: SaveIntegrationInput): Promise<IntegrationRow> {
  const { data, error } = await supabase.rpc("save_hr_integration", {
    p_provider_type: input.provider_type,
    p_provider_name: input.provider_name,
    p_api_base_url: input.api_base_url,
    p_credentials: input.credentials,
    p_auto_sync: input.auto_sync,
    p_frequency: input.frequency,
  });
  return unwrap(data, error);
}

export async function disconnectIntegration(id: string): Promise<IntegrationRow> {
  const { data, error } = await supabase.rpc("disconnect_hr_integration", { p_id: id });
  return unwrap(data, error);
}

export async function deleteIntegration(id: string): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc("delete_hr_integration", { p_id: id });
  return unwrap(data, error);
}

export async function testIntegration(id: string): Promise<TestResult> {
  const { data, error } = await supabase.rpc("test_hr_integration", { p_id: id });
  return unwrap(data, error);
}

export async function runSync(id: string): Promise<SyncResult> {
  const { data, error } = await supabase.rpc("run_hr_sync", { p_id: id });
  return unwrap(data, error);
}

export async function getSyncLogs(limit = 50): Promise<SyncLogRow[]> {
  const { data, error } = await supabase.rpc("get_hr_sync_logs", { p_limit: limit });
  return unwrap(data, error) ?? [];
}

// ── Field mapping ────────────────────────────────────────────────────────────
export interface MappingRow {
  source_field: string;
  target_field: string;
  is_required?: boolean;
  default_value?: string | null;
}

export async function getFieldMapping(integrationId: string): Promise<MappingRow[]> {
  const { data, error } = await supabase.rpc("get_field_mapping", { p_integration_id: integrationId });
  return unwrap(data, error) ?? [];
}

export async function saveFieldMapping(integrationId: string, rows: FieldMappingRow[]): Promise<void> {
  const payload: MappingRow[] = rows.map(r => ({ source_field: r.hrField, target_field: r.milesField }));
  const { error } = await supabase.rpc("save_field_mapping", {
    p_integration_id: integrationId,
    p_rows: payload,
  });
  if (error) throw new Error(error.message);
}

// ── Automation rules ─────────────────────────────────────────────────────────
export interface AutomationRulePayload {
  rule_key: string;
  rule_name: string;
  is_enabled: boolean;
  actions: Record<string, boolean>;
}

export async function getAutomationRules(): Promise<AutomationRulePayload[]> {
  const { data, error } = await supabase.rpc("get_automation_rules");
  return unwrap(data, error) ?? [];
}

export async function saveAutomationRules(rules: AutomationRulePayload[]): Promise<void> {
  const { error } = await supabase.rpc("save_automation_rules", { p_rules: rules });
  if (error) throw new Error(error.message);
}
