// ── HR Portal Integrations — shared definitions (Phase 1, UI layer) ──────────
//
// This module holds the *static* definitions that drive the Settings →
// Integrations UI: which HR providers exist, what configuration fields each
// one needs, the default HRMS → Miles field mapping, and the onboarding /
// offboarding automation rules.
//
// Phase 1 is intentionally front-end only. None of these credentials are sent
// anywhere yet — live sync (Zoho / Keka API calls, secure credential storage,
// onboarding/offboarding automation) is wired up in later phases on the
// Supabase backend. Keeping the shape here means the backend phase can reuse
// the exact same field/mapping/rule definitions.

export type IntegrationStatus = "connected" | "not_connected" | "error";

export type SyncFrequency = "hourly" | "daily" | "weekly";

export const SYNC_FREQUENCY_OPTIONS: { value: SyncFrequency; label: string }[] = [
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Once a day" },
  { value: "weekly", label: "Once a week" },
];

export type ConfigFieldType = "text" | "password" | "url";

export interface ConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  placeholder?: string;
  /** Sensitive values are masked in the UI and never echoed back from storage. */
  secret?: boolean;
  required?: boolean;
  help?: string;
}

export type ProviderId = "zoho" | "keka" | "custom";

export interface ProviderDef {
  id: ProviderId;
  name: string;
  /** Short tagline shown on the integration card. */
  tagline: string;
  /** Two-letter monogram used for the logo placeholder. */
  monogram: string;
  /** Tailwind classes for the logo placeholder tint. */
  accent: string;
  fields: ConfigField[];
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "zoho",
    name: "Zoho People",
    tagline: "Sync employees from Zoho People HRMS",
    monogram: "Zo",
    accent: "bg-red-50 text-red-600 ring-red-100",
    fields: [
      { key: "client_id", label: "Client ID", type: "text", required: true, placeholder: "1000.XXXXXXXXXXXX" },
      { key: "client_secret", label: "Client Secret", type: "password", secret: true, required: true },
      { key: "refresh_token", label: "Refresh Token", type: "password", secret: true, required: true, help: "Generated via Zoho OAuth self-client setup." },
      { key: "organization_id", label: "Organization ID", type: "text", required: true },
      { key: "api_base_url", label: "API Base URL", type: "url", required: true, placeholder: "https://people.zoho.com/api" },
    ],
  },
  {
    id: "keka",
    name: "Keka",
    tagline: "Sync employees from Keka HR",
    monogram: "Ke",
    accent: "bg-emerald-50 text-emerald-600 ring-emerald-100",
    fields: [
      { key: "api_key", label: "API Key", type: "password", secret: true, required: true },
      { key: "tenant_id", label: "Tenant / Company ID", type: "text", required: true },
      { key: "api_base_url", label: "API Base URL", type: "url", required: true, placeholder: "https://company.keka.com/api/v1" },
    ],
  },
  {
    id: "custom",
    name: "Custom HRMS / API",
    tagline: "Connect any HRMS via a generic REST API",
    monogram: "Cu",
    accent: "bg-blue-50 text-blue-600 ring-blue-100",
    fields: [
      { key: "api_base_url", label: "API Base URL", type: "url", required: true, placeholder: "https://hr.yourcompany.com/api" },
      { key: "api_key", label: "API Key / Token", type: "password", secret: true, required: true },
      { key: "employees_path", label: "Employees Endpoint Path", type: "text", placeholder: "/v1/employees" },
    ],
  },
];

export function getProvider(id: ProviderId): ProviderDef {
  const p = PROVIDERS.find(x => x.id === id);
  if (!p) throw new Error(`Unknown HR provider: ${id}`);
  return p;
}

// ── Field mapping (HRMS field → Miles IT Hub field) ──────────────────────────

/** Fields available on a Miles IT Hub user record that an HRMS field can map to. */
export const MILES_FIELDS: { value: string; label: string }[] = [
  { value: "employee_id", label: "Employee ID" },
  { value: "name", label: "Full Name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "department", label: "Department" },
  { value: "designation", label: "Designation" },
  { value: "manager", label: "Reporting Manager" },
  { value: "location", label: "Location" },
  { value: "joining_date", label: "Joining Date" },
  { value: "status", label: "Employment Status" },
  { value: "offboarding_date", label: "Offboarding Date" },
  { value: "__ignore__", label: "— Do not import —" },
];

export interface FieldMappingRow {
  hrField: string;
  milesField: string;
}

export const DEFAULT_FIELD_MAPPING: FieldMappingRow[] = [
  { hrField: "employee_id", milesField: "employee_id" },
  { hrField: "full_name", milesField: "name" },
  { hrField: "work_email", milesField: "email" },
  { hrField: "mobile", milesField: "phone" },
  { hrField: "department", milesField: "department" },
  { hrField: "designation", milesField: "designation" },
  { hrField: "reporting_manager", milesField: "manager" },
  { hrField: "location", milesField: "location" },
  { hrField: "date_of_joining", milesField: "joining_date" },
  { hrField: "employment_status", milesField: "status" },
  { hrField: "resignation_date", milesField: "offboarding_date" },
];

// ── Automation rules (onboarding / offboarding) ──────────────────────────────

export interface AutomationAction {
  key: string;
  label: string;
  /** Default enabled state for this action. */
  enabled: boolean;
}

export interface AutomationRuleDef {
  id: string;
  title: string;
  trigger: string;
  description: string;
  actions: AutomationAction[];
}

export const AUTOMATION_RULES: AutomationRuleDef[] = [
  {
    id: "offboarding",
    title: "Offboarding & Asset Recovery",
    trigger: 'Employee status becomes "Resigned" / "Terminated" / "Inactive"',
    description: "Runs automatically when an HR sync detects an employee has left.",
    actions: [
      { key: "move_recovery", label: "Move assigned asset to Recovery Mode", enabled: true },
      { key: "notify_it", label: "Notify IT Admin", enabled: true },
      { key: "notify_manager", label: "Notify Manager", enabled: true },
      { key: "start_tracking", label: "Start device location tracking", enabled: true },
      { key: "create_ticket", label: "Create recovery ticket", enabled: true },
    ],
  },
  {
    id: "onboarding",
    title: "New Employee Onboarding",
    trigger: "A new employee appears in the HR portal",
    description: "Runs automatically when an HR sync detects a newly added employee.",
    actions: [
      { key: "create_user", label: "Create user in Miles IT Hub", enabled: true },
      { key: "onboarding_queue", label: "Add to onboarding queue", enabled: true },
      { key: "notify_it_assign", label: "Notify IT Admin for asset assignment", enabled: true },
    ],
  },
];

export const STATUS_META: Record<IntegrationStatus, { label: string; badge: "secondary" | "default" | "destructive"; dot: string }> = {
  connected: { label: "Connected", badge: "default", dot: "bg-emerald-500" },
  not_connected: { label: "Not Connected", badge: "secondary", dot: "bg-muted-foreground/40" },
  error: { label: "Error", badge: "destructive", dot: "bg-red-500" },
};

export function formatLastSync(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
