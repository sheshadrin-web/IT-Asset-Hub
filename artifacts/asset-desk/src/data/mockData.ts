export type AssetType = "Laptop" | "Mobile";
export type AssetStatus = "Available" | "Assigned" | "Under Repair" | "Lost" | "Retired";
export type TicketStatus = "Open" | "Assigned" | "In Progress" | "Waiting for User" | "Resolved" | "Closed" | "Rejected";
export type TicketPriority = "Low" | "Medium" | "High" | "Critical";
export type UserRole = "super_admin" | "agent" | "end_user";
export type UserStatus = "Active" | "Inactive";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  agent:       "IT Agent",
  end_user:    "End User",
};

export interface Asset {
  assetId: string;
  assetType: AssetType;
  brand: string;
  model: string;
  serialNumber: string;
  imeiNumber?: string;
  purchaseDate: string;
  warrantyEndDate: string;
  status: AssetStatus;
  assignedTo?: string;
  department?: string;
  location: string;
  accessories: string;
  remarks: string;
}

export interface Ticket {
  ticketId: string;
  raisedBy: string;
  assetId: string;
  category: string;
  subcategory: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignedAgent: string;
  description: string;
  createdDate: string;
  updatedDate: string;
  resolutionNote: string;
  comments: TicketComment[];
}

export interface TicketComment {
  id: string;
  author: string;
  role: UserRole;
  text: string;
  date: string;
}

export interface User {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  assignedAssets: number;
  status: UserStatus;
}

export const TICKET_CATEGORIES: Record<string, string[]> = {
  "Laptop Issue":      ["Battery Issue", "Display Issue", "Keyboard Issue", "Charger Issue", "Software Issue", "Slow Performance"],
  "Mobile Issue":      ["Battery Issue", "Screen Issue", "SIM Issue", "App Issue", "Network Issue"],
  "Asset Request":     ["New Laptop Request", "Replacement Request", "Mobile Request"],
  "Asset Return":      ["Resignation Handover", "Device Return"],
  "Lost or Damage":    ["Lost Device", "Physical Damage"],
  "Accessory Request": ["Charger", "Mouse", "Keyboard", "Laptop Bag"],
};

// Production credentials are in AuthContext — not stored here.
export const mockUsers: User[] = [
  {
    userId:         "USR-001",
    name:           "Help Desk",
    email:          "help.desk@mileseducation.com",
    role:           "super_admin",
    department:     "IT",
    assignedAssets: 0,
    status:         "Active",
  },
];

// No sample data — all data must be entered by the admin.
export const mockAssets: Asset[] = [];
export const mockTickets: Ticket[] = [];
