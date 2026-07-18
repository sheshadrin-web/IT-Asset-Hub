import { supabase } from "@/lib/supabaseClient";

export type ShortagePriority = "Low" | "Medium" | "High" | "Critical";
export type ShortageStatus =
  | "Pending" | "Approved" | "Partially Approved" | "Rejected" | "Fulfilled";

export const SHORTAGE_PRIORITIES: ShortagePriority[] = ["Low", "Medium", "High", "Critical"];
export const SHORTAGE_STATUSES:   ShortageStatus[]   = ["Pending", "Approved", "Partially Approved", "Rejected", "Fulfilled"];

export interface ShortageRequest {
  id:                string;
  location:          string;
  requestedBy:       string;   // profiles.id (uuid)
  assetType:         string;
  quantityRequested: number;
  quantityAvailable: number;
  priority:          ShortagePriority;
  reason?:           string;
  status:            ShortageStatus;
  approvedBy?:       string;
  createdAt:         string;
  updatedAt:         string;
}

export interface ShortageRequestInput {
  location:           string;
  assetType:          string;
  quantityRequested:  number;
  quantityAvailable?: number;
  priority?:          ShortagePriority;
  reason?:            string;
}

function map(row: Record<string, unknown>): ShortageRequest {
  return {
    id:                String(row.id),
    location:          String(row.location ?? ""),
    requestedBy:       String(row.requested_by ?? ""),
    assetType:         String(row.asset_type ?? ""),
    quantityRequested: Number(row.quantity_requested ?? 0),
    quantityAvailable: Number(row.quantity_available ?? 0),
    priority:          (row.priority as ShortagePriority) ?? "Medium",
    reason:            row.reason ? String(row.reason) : undefined,
    status:            (row.status as ShortageStatus) ?? "Pending",
    approvedBy:        row.approved_by ? String(row.approved_by) : undefined,
    createdAt:         String(row.created_at ?? ""),
    updatedAt:         String(row.updated_at ?? ""),
  };
}

export async function fetchShortageRequests(): Promise<ShortageRequest[]> {
  const { data, error } = await supabase
    .from("asset_shortage_requests").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => map(r as Record<string, unknown>));
}

export async function createShortageRequest(input: ShortageRequestInput): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.from("asset_shortage_requests").insert({
    location:           input.location,
    requested_by:       user.id,
    asset_type:         input.assetType,
    quantity_requested: input.quantityRequested,
    quantity_available: input.quantityAvailable ?? 0,
    priority:           input.priority ?? "Medium",
    reason:             input.reason ?? null,
  });
  if (error) throw new Error(error.message);
}

// Approve / reject / fulfil — Super Admin + Bangalore IT only (RLS enforces).
export async function updateShortageStatus(id: string, status: ShortageStatus): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("asset_shortage_requests")
    .update({ status, approved_by: user?.id ?? null }).eq("id", id);
  if (error) throw new Error(error.message);
}
