import { supabase } from "@/lib/supabaseClient";

export type ReturnType =
  | "Employee Exit" | "Hardware Issue" | "Damaged" | "Replacement"
  | "Repair" | "Lost Recovery" | "Other";
export type ReturnStatus =
  | "Pending IT Review" | "Approved" | "Courier Pending" | "In Transit"
  | "Received at Bangalore" | "Under Inspection" | "Closed";

export const RETURN_TYPES:    ReturnType[]   = ["Employee Exit", "Hardware Issue", "Damaged", "Replacement", "Repair", "Lost Recovery", "Other"];
export const RETURN_STATUSES: ReturnStatus[] = ["Pending IT Review", "Approved", "Courier Pending", "In Transit", "Received at Bangalore", "Under Inspection", "Closed"];

export interface ReturnRequest {
  id:              string;
  assetId?:        string;   // assets.id (uuid) — nullable if the asset was deleted
  location:        string;
  requestedBy:     string;
  reason?:         string;
  returnType:      ReturnType;
  status:          ReturnStatus;
  approvedBy?:     string;
  courierTracking?: string;
  createdAt:       string;
  updatedAt:       string;
}

export interface ReturnRequestInput {
  assetId?:    string;   // assets.id (uuid)
  location:    string;
  returnType:  ReturnType;
  reason?:     string;
}

function map(row: Record<string, unknown>): ReturnRequest {
  return {
    id:              String(row.id),
    assetId:         row.asset_id ? String(row.asset_id) : undefined,
    location:        String(row.location ?? ""),
    requestedBy:     String(row.requested_by ?? ""),
    reason:          row.reason ? String(row.reason) : undefined,
    returnType:      (row.return_type as ReturnType) ?? "Other",
    status:          (row.status as ReturnStatus) ?? "Pending IT Review",
    approvedBy:      row.approved_by ? String(row.approved_by) : undefined,
    courierTracking: row.courier_tracking ? String(row.courier_tracking) : undefined,
    createdAt:       String(row.created_at ?? ""),
    updatedAt:       String(row.updated_at ?? ""),
  };
}

export async function fetchReturnRequests(): Promise<ReturnRequest[]> {
  const { data, error } = await supabase
    .from("asset_return_requests").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => map(r as Record<string, unknown>));
}

export async function createReturnRequest(input: ReturnRequestInput): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.from("asset_return_requests").insert({
    asset_id:     input.assetId ?? null,
    location:     input.location,
    requested_by: user.id,
    return_type:  input.returnType,
    reason:       input.reason ?? null,
  });
  if (error) throw new Error(error.message);
}

// Advance the workflow. Super Admin + Bangalore IT can move through any state;
// a location_gm with can_mark_received may advance their own-location requests
// (RLS enforces the boundary).
export async function updateReturnRequest(
  id: string,
  patch: { status?: ReturnStatus; courierTracking?: string; markApproved?: boolean }
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const update: Record<string, unknown> = {};
  if (patch.status !== undefined)          update.status           = patch.status;
  if (patch.courierTracking !== undefined) update.courier_tracking = patch.courierTracking;
  if (patch.markApproved)                  update.approved_by      = user?.id ?? null;
  const { error } = await supabase.from("asset_return_requests").update(update).eq("id", id);
  if (error) throw new Error(error.message);
}
