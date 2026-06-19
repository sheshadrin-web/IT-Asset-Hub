import { supabase } from "@/lib/supabaseClient";

// ─── Types ──────────────────────────────────────────────────────────────────
export interface AccessPermission {
  key:       string;
  label:     string;
  category:  string;
  sortOrder: number;
}

export interface RolePermission {
  roleKey:       string;
  permissionKey: string;
  enabled:       boolean;
}

export interface AccessPolicy {
  key:       string;
  label:     string;
  enabled:   boolean;
  sortOrder: number;
}

// The five roles configurable in the Access Control matrix. These mirror the
// existing system roles — Access Control is configuration only and never
// creates, mutates, or assigns roles.
export const ACCESS_ROLES = [
  { key: "super_admin", label: "Super Admin" },
  { key: "it_admin",    label: "IT Admin" },
  { key: "hr_admin",    label: "HR Admin" },
  { key: "end_user",    label: "End User" },
  { key: "location_gm", label: "Location GM" },
] as const;

export type AccessRoleKey = (typeof ACCESS_ROLES)[number]["key"];

// Row shape for a single location-access entry passed to the set RPC.
export interface UserLocationRow {
  location:                   string;
  accessRole?:                string;
  canViewAssets?:             boolean;
  canRaiseRequests?:          boolean;
  canMarkReceived?:           boolean;
  canReleaseAfterItApproval?: boolean;
}

// ─── Reads ──────────────────────────────────────────────────────────────────
export async function fetchPermissions(): Promise<AccessPermission[]> {
  const { data, error } = await supabase
    .from("access_permissions")
    .select("*")
    .order("category")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    key:       String(r.key),
    label:     String(r.label),
    category:  String(r.category),
    sortOrder: Number(r.sort_order ?? 0),
  }));
}

export async function fetchRolePermissions(): Promise<RolePermission[]> {
  const { data, error } = await supabase
    .from("access_role_permissions")
    .select("*");
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    roleKey:       String(r.role_key),
    permissionKey: String(r.permission_key),
    enabled:       Boolean(r.enabled),
  }));
}

export async function fetchPolicies(): Promise<AccessPolicy[]> {
  const { data, error } = await supabase
    .from("access_policies")
    .select("*")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    key:       String(r.key),
    label:     String(r.label),
    enabled:   Boolean(r.enabled),
    sortOrder: Number(r.sort_order ?? 0),
  }));
}

// ─── Writes (audited, super-admin only — enforced server-side) ──────────────
export async function setRolePermission(
  roleKey: string, permissionKey: string, enabled: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("access_set_role_permission", {
    p_role_key:       roleKey,
    p_permission_key: permissionKey,
    p_enabled:        enabled,
  });
  if (error) throw new Error(error.message);
}

export async function setPolicy(key: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("access_set_policy", {
    p_key:     key,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
}

export async function setUserLocations(
  userId: string, rows: UserLocationRow[],
): Promise<void> {
  const payload = rows.map(r => ({
    location:                      r.location,
    access_role:                   r.accessRole ?? "location_gm",
    can_view_assets:               r.canViewAssets ?? true,
    can_raise_requests:            r.canRaiseRequests ?? true,
    can_mark_received:             r.canMarkReceived ?? false,
    can_release_after_it_approval: r.canReleaseAfterItApproval ?? false,
  }));
  const { error } = await supabase.rpc("access_set_user_locations", {
    p_user_id: userId,
    p_rows:    payload,
  });
  if (error) throw new Error(error.message);
}
