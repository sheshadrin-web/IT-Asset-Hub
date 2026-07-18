// ── HR Integration backend types (shapes returned by the Supabase RPCs) ──────
//
// These mirror the jsonb returned by the SECURITY DEFINER functions defined in
// the `20260603000000_hr_integrations.sql` migration. Credentials are never part
// of any client-facing shape — `credentials_set` is a boolean instead.

import type { IntegrationStatus, ProviderId, SyncFrequency } from "@/lib/hrIntegrations";

export interface IntegrationRow {
  id: string;
  provider_type: ProviderId;
  provider_name: string;
  status: IntegrationStatus;
  api_base_url: string | null;
  auto_sync_enabled: boolean;
  sync_frequency: SyncFrequency;
  last_sync_at: string | null;
  last_tested_at: string | null;
  last_error: string | null;
  credentials_set: boolean;
  updated_at: string;
}

export type SyncStatus = "running" | "success" | "partial" | "failed";

export interface SyncLogRow {
  id: string;
  integration_id: string | null;
  provider_name: string | null;
  sync_status: SyncStatus;
  started_at: string;
  completed_at: string | null;
  employees_fetched: number;
  users_created: number;
  users_updated: number;
  users_deactivated: number;
  assets_recovered: number;
  offboarding_detected: number;
  errors_count: number;
  error_message: string | null;
  raw_summary: Record<string, unknown> | null;
}

export interface SyncResult {
  ok: boolean;
  log_id: string;
  employees_fetched: number;
  users_created: number;
  users_updated: number;
  users_deactivated: number;
  assets_recovered: number;
  offboarding_detected: number;
  errors: number;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

export type RecoveryStatus =
  | "recovery_pending"
  | "recovery_in_progress"
  | "recovered"
  | "not_reachable"
  | "escalated"
  | "lost";

export interface RecoveryRow {
  id: string;
  recovery_status: RecoveryStatus;
  recovery_reason: string | null;
  offboarding_date: string | null;
  last_working_date: string | null;
  recovery_started_at: string;
  recovered_at: string | null;
  last_seen_at: string | null;
  last_known_ip: string | null;
  last_known_location: string | null;
  signed_in_user: string | null;
  hostname: string | null;
  device_status: string | null;
  notes: string | null;
  asset_id: string | null;
  asset_tag: string | null;
  asset_model: string | null;
  asset_type: string | null;
  employee_name: string | null;
  employee_code: string | null;
  department: string | null;
  manager_name: string | null;
  manager_email: string | null;
}

export interface HrProfileRow {
  id: string;
  user_id: string | null;
  hr_provider: string;
  hr_employee_id: string;
  employee_code: string | null;
  full_name: string | null;
  work_email: string | null;
  employment_status: string | null;
  joining_date: string | null;
  resignation_date: string | null;
  last_working_date: string | null;
  department: string | null;
  designation: string | null;
  manager_name: string | null;
  manager_email: string | null;
  location: string | null;
  onboarding_done: boolean;
  last_synced_at: string | null;
}

export interface HrDashboardSummary {
  integrations_connected: number;
  active_users: number;
  deactivated_users: number;
  hr_synced_users: number;
  assets_in_recovery: number;
  last_hr_sync: string | null;
  sync_errors: number;
  devices_not_seen_recently: number;
  recovery_overdue: number;
}

export interface ManagerHierarchyOverview {
  total_managers: number;
  employees_without_manager: number;
  managers_with_direct_reports: number;
  largest_team_size: number;
}

export const RECOVERY_STATUS_META: Record<
  RecoveryStatus,
  { label: string; badge: "secondary" | "default" | "destructive" | "outline"; dot: string }
> = {
  recovery_pending: { label: "Pending", badge: "secondary", dot: "bg-amber-500" },
  recovery_in_progress: { label: "In Progress", badge: "default", dot: "bg-blue-500" },
  recovered: { label: "Recovered", badge: "outline", dot: "bg-emerald-500" },
  not_reachable: { label: "Not Reachable", badge: "destructive", dot: "bg-orange-500" },
  escalated: { label: "Escalated", badge: "destructive", dot: "bg-red-500" },
  lost: { label: "Lost", badge: "destructive", dot: "bg-red-600" },
};
