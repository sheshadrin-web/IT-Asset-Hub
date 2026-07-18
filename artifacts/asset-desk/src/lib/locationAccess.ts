import { supabase } from "@/lib/supabaseClient";

export type LocationAccessRole = "location_gm" | "location_admin";

export interface UserLocationAccess {
  id:                        string;
  userId:                    string;
  location:                  string;
  accessRole:                LocationAccessRole;
  canViewAssets:             boolean;
  canRaiseRequests:          boolean;
  canMarkReceived:           boolean;
  canReleaseAfterItApproval: boolean;
  createdAt:                 string;
}

export interface LocationAccessInput {
  location:                   string;
  accessRole?:                LocationAccessRole;
  canViewAssets?:             boolean;
  canRaiseRequests?:          boolean;
  canMarkReceived?:           boolean;
  canReleaseAfterItApproval?: boolean;
}

function map(row: Record<string, unknown>): UserLocationAccess {
  return {
    id:                        String(row.id),
    userId:                    String(row.user_id),
    location:                  String(row.location),
    accessRole:                (row.access_role as LocationAccessRole) ?? "location_gm",
    canViewAssets:             Boolean(row.can_view_assets),
    canRaiseRequests:          Boolean(row.can_raise_requests),
    canMarkReceived:           Boolean(row.can_mark_received),
    canReleaseAfterItApproval: Boolean(row.can_release_after_it_approval),
    createdAt:                 String(row.created_at ?? ""),
  };
}

// Rows visible to the caller under RLS (a location_gm sees only their own rows;
// super_admin / it_admin / it_agent see all).
export async function fetchAllLocationAccess(): Promise<UserLocationAccess[]> {
  const { data, error } = await supabase
    .from("user_location_access").select("*").order("location");
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => map(r as Record<string, unknown>));
}

export async function fetchLocationAccessForUser(userId: string): Promise<UserLocationAccess[]> {
  const { data, error } = await supabase
    .from("user_location_access").select("*").eq("user_id", userId).order("location");
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => map(r as Record<string, unknown>));
}

export async function fetchMyLocationAccess(): Promise<UserLocationAccess[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  return fetchLocationAccessForUser(user.id);
}

// Replace a user's full set of location-access rows (admin only; RLS enforces).
export async function replaceUserLocationAccess(
  userId: string, entries: LocationAccessInput[]
): Promise<void> {
  const { error: delErr } = await supabase
    .from("user_location_access").delete().eq("user_id", userId);
  if (delErr) throw new Error(delErr.message);
  if (entries.length === 0) return;
  const rows = entries.map(e => ({
    user_id:                       userId,
    location:                      e.location,
    access_role:                   e.accessRole ?? "location_gm",
    can_view_assets:               e.canViewAssets ?? true,
    can_raise_requests:            e.canRaiseRequests ?? true,
    can_mark_received:             e.canMarkReceived ?? false,
    can_release_after_it_approval: e.canReleaseAfterItApproval ?? false,
  }));
  const { error: insErr } = await supabase.from("user_location_access").insert(rows);
  if (insErr) throw new Error(insErr.message);
}
