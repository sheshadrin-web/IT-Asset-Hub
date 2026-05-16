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
export interface Profile {
  id:                 string;
  full_name:          string;
  email:              string;
  role:               UserRole;
  ecode:              string;
  department:         string;
  location:           string;
  reporting_manager:  string;
  status:             UserStatus;
  created_at:         string;
  updated_at:         string;
  profile_photo_url?: string;
}

export interface CurrentUser {
  userId:           string;
  name:             string;
  email:            string;
  role:             UserRole;
  ecode:            string;
  department:       string;
  location:         string;
  reportingManager: string;
  status:           UserStatus;
  assignedAssets:   number;
  avatarUrl?:       string;
}

export function profileToCurrentUser(p: Profile): CurrentUser {
  return {
    userId:           p.id,
    name:             p.full_name,
    email:            p.email,
    role:             p.role,
    ecode:            p.ecode            ?? "",
    department:       p.department,
    location:         p.location,
    reportingManager: p.reporting_manager ?? "",
    status:           p.status,
    assignedAssets:   0,
    avatarUrl:        p.profile_photo_url ?? undefined,
  };
}

// ─── Asset types ─────────────────────────────────────────────────────────────
export type AssetType   = "Laptop" | "Mobile" | "Desktop";
export type AssetStatus = "In Procurement" | "Available" | "Assigned" | "Under Repair" | "Lost" | "Retired";

export interface Asset {
  id?:              string;   // Supabase UUID
  assetId:          string;   // e.g. AST-001 — manually entered
  assetType:        AssetType;
  brand:            string;
  model:            string;
  serialNumber:     string;
  productNumber?:   string;
  // Laptop-specific
  processor?:       string;
  ram?:             string;
  operatingSystem?: string;
  // Mobile-specific
  imeiNumber?:      string;   // IMEI 1
  imei2?:           string;   // IMEI 2
  simNumber?:       string;
  phoneNumber?:     string;
  // Desktop-specific
  monitorBrand?:    string;
  monitorModel?:    string;
  monitorSize?:     string;
  keyboard?:        string;
  mouse?:           string;
  cpu?:             string;
  others?:          string;
  // Shared
  storage?:         string;
  purchaseDate:     string;
  warrantyEndDate:  string;
  vendor?:          string;
  invoice?:         string;
  status:           AssetStatus;
  assignedTo?:      string;
  assignedEmail?:   string;
  assignedEcode?:   string;
  assignedAt?:      string;
  ackToken?:        string;
  acknowledged?:    boolean;
  acknowledgedAt?:  string;
  department?:      string;
  location:         string;
  accessories:      string;
  remarks:          string;
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
  id?:              string;
  ticketId:         string;
  raisedBy:         string;
  employeeEmail?:   string;
  assetId:          string;
  category:         string;
  subcategory:      string;
  priority:         TicketPriority;
  status:           TicketStatus;
  assignedAgent:    string;   // display name (resolved from profiles join)
  assignedAgentId?: string;   // UUID FK — used for DB writes
  description:      string;
  createdDate:      string;
  updatedDate:      string;
  resolutionNote:   string;
  comments:         TicketComment[];
}

// ─── Ticket categories ────────────────────────────────────────────────────────
export const TICKET_CATEGORIES: Record<string, string[]> = {
  "Laptop Issue":      ["Battery Issue", "Display Issue", "Keyboard Issue", "Charger Issue", "Slow Performance", "Overheating", "Boot Issue", "Other"],
  "Mobile Issue":      ["Battery Issue", "Screen Issue", "SIM Issue", "App Issue", "Network Issue", "Camera Issue", "Other"],
  "Desktop Issue":     ["Monitor Issue", "CPU Issue", "Keyboard/Mouse Issue", "Power Issue", "Slow Performance", "Boot Issue", "Other"],
  "Accessory Issue":   ["Charger Not Working", "Mouse Issue", "Keyboard Issue", "Headset Issue", "Adapter Issue", "Other Accessory"],
  "Software Issue":    ["Application Error", "OS Issue", "Driver Issue", "Antivirus Issue", "License Issue", "Installation Request", "Other Software"],
  "Network Issue":     ["No Internet", "Slow Internet", "WiFi Issue", "VPN Issue", "LAN Issue", "Other Network"],
  "Account & Access":  ["Password Reset", "Account Locked", "New Access Request", "Permission Issue", "Email Issue", "MFA Setup", "Other Access"],
  "Lost / Damage":     ["Lost Device", "Physical Damage", "Theft", "Liquid Damage", "Other"],
  "Asset Request":     ["New Laptop Request", "New Desktop Request", "Replacement Request", "Mobile Request", "Accessory Request", "Other Request"],
  "Other IT Support":  ["General Query", "Data Backup / Recovery", "Printer Issue", "Others"],
};

export const mockUsers:   never[] = [];
export const mockAssets:  never[] = [];
export const mockTickets: never[] = [];
