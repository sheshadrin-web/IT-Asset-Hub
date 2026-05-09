// ─── Roles ────────────────────────────────────────────────────────────────────
export type UserRole = "super_admin" | "it_admin" | "it_agent" | "end_user";
export type UserStatus = "active" | "inactive";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  it_admin:    "IT Admin",
  it_agent:    "IT Agent",
  end_user:    "End User",
};

// ─── Supabase Profile ────────────────────────────────────────────────────────
// Matches the public.profiles table schema.
export interface Profile {
  id:         string;      // UUID — matches Supabase auth.users.id
  full_name:  string;
  email:      string;
  role:       UserRole;
  department: string;
  location:   string;
  status:     UserStatus;
  created_at: string;
  updated_at: string;
}

// ─── CurrentUser (computed from Profile for backward-compat with pages) ──────
export interface CurrentUser {
  userId:         string;
  name:           string;
  email:          string;
  role:           UserRole;
  department:     string;
  status:         UserStatus;
  assignedAssets: number;
}

// Helper: map Profile → CurrentUser shape used throughout the app
export function profileToCurrentUser(p: Profile): CurrentUser {
  return {
    userId:         p.id,
    name:           p.full_name,
    email:          p.email,
    role:           p.role,
    department:     p.department,
    status:         p.status,
    assignedAssets: 0,
  };
}

// ─── Asset types ─────────────────────────────────────────────────────────────
export type AssetType   = "Laptop" | "Mobile";
export type AssetStatus = "Available" | "Assigned" | "Under Repair" | "Lost" | "Retired";

export interface Asset {
  id?:            string;   // Supabase UUID (populated after fetch)
  assetId:        string;   // e.g. AST-001
  assetType:      AssetType;
  brand:          string;
  model:          string;
  serialNumber:   string;
  imeiNumber?:    string;
  purchaseDate:   string;
  warrantyEndDate:string;
  status:         AssetStatus;
  assignedTo?:    string;
  assignedEmail?: string;
  department?:    string;
  location:       string;
  accessories:    string;
  remarks:        string;
}

// ─── Ticket types ─────────────────────────────────────────────────────────────
export type TicketStatus   = "Open" | "Assigned" | "In Progress" | "Waiting for User" | "Resolved" | "Closed" | "Rejected";
export type TicketPriority = "Low" | "Medium" | "High" | "Critical";

export interface TicketComment {
  id:     string;
  author: string;
  role:   UserRole;
  text:   string;
  date:   string;
}

export interface Ticket {
  id?:            string;   // Supabase UUID
  ticketId:       string;   // e.g. TKT-0001
  raisedBy:       string;   // user's full_name
  employeeEmail?: string;
  assetId:        string;
  category:       string;
  subcategory:    string;
  priority:       TicketPriority;
  status:         TicketStatus;
  assignedAgent:  string;
  description:    string;
  createdDate:    string;
  updatedDate:    string;
  resolutionNote: string;
  comments:       TicketComment[];
}

// ─── Ticket categories ────────────────────────────────────────────────────────
export const TICKET_CATEGORIES: Record<string, string[]> = {
  "Laptop Issue":      ["Battery Issue", "Display Issue", "Keyboard Issue", "Charger Issue", "Software Issue", "Slow Performance"],
  "Mobile Issue":      ["Battery Issue", "Screen Issue", "SIM Issue", "App Issue", "Network Issue"],
  "Asset Request":     ["New Laptop Request", "Replacement Request", "Mobile Request"],
  "Asset Return":      ["Resignation Handover", "Device Return"],
  "Lost or Damage":    ["Lost Device", "Physical Damage"],
  "Accessory Request": ["Charger", "Mouse", "Keyboard", "Laptop Bag"],
};

// No mock data — all data comes from Supabase.
export const mockUsers:   never[] = [];
export const mockAssets:  never[] = [];
export const mockTickets: never[] = [];
