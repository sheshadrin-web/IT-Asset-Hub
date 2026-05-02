export type AssetType = "Laptop" | "Mobile";
export type AssetStatus = "Available" | "Assigned" | "Under Repair" | "Lost" | "Retired";
export type TicketStatus = "Open" | "Assigned" | "In Progress" | "Waiting for User" | "Resolved" | "Closed" | "Rejected";
export type TicketPriority = "Low" | "Medium" | "High" | "Critical";
export type UserRole = "super_admin" | "agent" | "end_user";
export type UserStatus = "Active" | "Inactive";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  agent: "IT Agent",
  end_user: "End User",
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

export const mockUsers: User[] = [
  { userId: "USR-001", name: "Sarah Mitchell", email: "admin@demo.com",   role: "super_admin", department: "IT",          assignedAssets: 1, status: "Active" },
  { userId: "USR-002", name: "James Thornton", email: "agent1@demo.com",  role: "agent",       department: "IT",          assignedAssets: 0, status: "Active" },
  { userId: "USR-003", name: "Raj Patel",       email: "agent2@demo.com",  role: "agent",       department: "IT",          assignedAssets: 1, status: "Active" },
  { userId: "USR-004", name: "Alex Kim",         email: "agent3@demo.com",  role: "agent",       department: "IT",          assignedAssets: 0, status: "Active" },
  { userId: "USR-005", name: "Emily Clarke",     email: "user@demo.com",    role: "end_user",    department: "Marketing",   assignedAssets: 1, status: "Active" },
  { userId: "USR-006", name: "Laura Bennett",    email: "laura.b@demo.com", role: "end_user",    department: "Finance",     assignedAssets: 0, status: "Active" },
  { userId: "USR-007", name: "Marcus Johnson",   email: "marcus@demo.com",  role: "end_user",    department: "Engineering", assignedAssets: 1, status: "Active" },
  { userId: "USR-008", name: "Sofia Rossi",      email: "sofia@demo.com",   role: "end_user",    department: "HR",          assignedAssets: 0, status: "Inactive" },
  { userId: "USR-009", name: "Daniel Park",      email: "daniel@demo.com",  role: "end_user",    department: "Sales",       assignedAssets: 1, status: "Active" },
];

// 5 Laptops + 5 Mobiles
export const mockAssets: Asset[] = [
  // ─── LAPTOPS ────────────────────────────────────────────────────────
  {
    assetId:        "AST-001",
    assetType:      "Laptop",
    brand:          "Dell",
    model:          "Latitude 5540",
    serialNumber:   "DL5540-SN-001",
    purchaseDate:   "2024-01-15",
    warrantyEndDate:"2027-01-15",
    status:         "Available",
    location:       "IT Storage Room",
    accessories:    "Charger, Laptop Bag",
    remarks:        "New stock — ready for assignment",
  },
  {
    assetId:        "AST-002",
    assetType:      "Laptop",
    brand:          "Apple",
    model:          "MacBook Pro 14 M3",
    serialNumber:   "APMBP14M3-002",
    purchaseDate:   "2024-03-10",
    warrantyEndDate:"2027-03-10",
    status:         "Assigned",
    assignedTo:     "Emily Clarke",
    department:     "Marketing",
    location:       "HQ – Floor 3",
    accessories:    "Charger, USB-C Hub",
    remarks:        "Minor scratch on bottom cover",
  },
  {
    assetId:        "AST-003",
    assetType:      "Laptop",
    brand:          "Lenovo",
    model:          "ThinkPad X1 Carbon G11",
    serialNumber:   "LNX1CG11-003",
    purchaseDate:   "2023-08-22",
    warrantyEndDate:"2026-08-22",
    status:         "Assigned",
    assignedTo:     "Marcus Johnson",
    department:     "Engineering",
    location:       "HQ – Floor 2",
    accessories:    "Charger, Docking Station",
    remarks:        "",
  },
  {
    assetId:        "AST-004",
    assetType:      "Laptop",
    brand:          "HP",
    model:          "EliteBook 840 G10",
    serialNumber:   "HP840G10-004",
    purchaseDate:   "2023-05-18",
    warrantyEndDate:"2026-05-18",
    status:         "Under Repair",
    department:     "Finance",
    location:       "IT Repair Center",
    accessories:    "Charger",
    remarks:        "Battery replacement in progress — ETA 3 days",
  },
  {
    assetId:        "AST-005",
    assetType:      "Laptop",
    brand:          "Dell",
    model:          "XPS 15 9530",
    serialNumber:   "DLXPS9530-005",
    purchaseDate:   "2023-11-30",
    warrantyEndDate:"2026-11-30",
    status:         "Assigned",
    assignedTo:     "Sarah Mitchell",
    department:     "IT",
    location:       "HQ – Floor 1",
    accessories:    "Charger, External Mouse",
    remarks:        "",
  },
  // ─── MOBILES ────────────────────────────────────────────────────────
  {
    assetId:        "AST-006",
    assetType:      "Mobile",
    brand:          "Apple",
    model:          "iPhone 15 Pro",
    serialNumber:   "APIPH15P-006",
    imeiNumber:     "356789012345678",
    purchaseDate:   "2024-02-05",
    warrantyEndDate:"2026-02-05",
    status:         "Available",
    location:       "IT Storage Room",
    accessories:    "Charger, Protective Case",
    remarks:        "Available for assignment",
  },
  {
    assetId:        "AST-007",
    assetType:      "Mobile",
    brand:          "Samsung",
    model:          "Galaxy S24 Ultra",
    serialNumber:   "SGS24U-007",
    imeiNumber:     "490123456789012",
    purchaseDate:   "2024-01-28",
    warrantyEndDate:"2026-01-28",
    status:         "Assigned",
    assignedTo:     "Daniel Park",
    department:     "Sales",
    location:       "HQ – Floor 4",
    accessories:    "Charger, S-Pen",
    remarks:        "",
  },
  {
    assetId:        "AST-008",
    assetType:      "Mobile",
    brand:          "Google",
    model:          "Pixel 8 Pro",
    serialNumber:   "GKPX8P-008",
    imeiNumber:     "352012345678901",
    purchaseDate:   "2023-10-12",
    warrantyEndDate:"2025-10-12",
    status:         "Assigned",
    assignedTo:     "Raj Patel",
    department:     "IT",
    location:       "HQ – Floor 1",
    accessories:    "Charger, Case",
    remarks:        "",
  },
  {
    assetId:        "AST-009",
    assetType:      "Mobile",
    brand:          "Samsung",
    model:          "Galaxy A55",
    serialNumber:   "SGA55-009",
    imeiNumber:     "351234567890123",
    purchaseDate:   "2023-07-04",
    warrantyEndDate:"2025-07-04",
    status:         "Under Repair",
    location:       "IT Repair Center",
    accessories:    "Charger",
    remarks:        "Cracked screen — awaiting replacement part",
  },
  {
    assetId:        "AST-010",
    assetType:      "Mobile",
    brand:          "Apple",
    model:          "iPhone 13",
    serialNumber:   "APIPH13-010",
    imeiNumber:     "354876543210987",
    purchaseDate:   "2021-10-20",
    warrantyEndDate:"2023-10-20",
    status:         "Retired",
    location:       "IT Storage Room",
    accessories:    "",
    remarks:        "End of life — decommissioned after 3 years of use",
  },
];

export const mockTickets: Ticket[] = [
  {
    ticketId: "TKT-001", raisedBy: "Marcus Johnson", assetId: "AST-003", category: "Laptop Issue", subcategory: "Slow Performance", priority: "High", status: "In Progress", assignedAgent: "James Thornton",
    description: "My laptop has been extremely slow for the past week. Applications take forever to open and the fan is constantly running at full speed.",
    createdDate: "2024-11-15", updatedDate: "2024-11-16", resolutionNote: "",
    comments: [{ id: "c1", author: "James Thornton", role: "agent", text: "Ran diagnostics — found malware and excessive startup items. Starting cleanup.", date: "2024-11-16" }],
  },
  {
    ticketId: "TKT-002", raisedBy: "Emily Clarke", assetId: "AST-002", category: "Laptop Issue", subcategory: "Display Issue", priority: "Medium", status: "Assigned", assignedAgent: "Raj Patel",
    description: "The screen flickers occasionally, especially when on battery power. It goes away when plugged in.",
    createdDate: "2024-11-14", updatedDate: "2024-11-15", resolutionNote: "",
    comments: [],
  },
  {
    ticketId: "TKT-003", raisedBy: "Emily Clarke", assetId: "AST-002", category: "Laptop Issue", subcategory: "Battery Issue", priority: "Critical", status: "In Progress", assignedAgent: "James Thornton",
    description: "Laptop battery drains from 100% to 0% in under 30 minutes. Requires immediate replacement.",
    createdDate: "2024-11-10", updatedDate: "2024-11-18", resolutionNote: "",
    comments: [
      { id: "c2", author: "James Thornton", role: "agent", text: "New battery has been ordered. ETA 3 business days.", date: "2024-11-11" },
      { id: "c3", author: "Emily Clarke", role: "end_user", text: "I have a presentation on Nov 20th — please prioritize.", date: "2024-11-12" },
      { id: "c4", author: "James Thornton", role: "agent", text: "Battery received, currently being installed.", date: "2024-11-18" },
    ],
  },
  {
    ticketId: "TKT-004", raisedBy: "Daniel Park", assetId: "AST-007", category: "Mobile Issue", subcategory: "Network Issue", priority: "Medium", status: "Open", assignedAgent: "",
    description: "Unable to connect to office Wi-Fi on my phone. Personal hotspot works fine but office network shows 'Authentication failed'.",
    createdDate: "2024-11-18", updatedDate: "2024-11-18", resolutionNote: "",
    comments: [],
  },
  {
    ticketId: "TKT-005", raisedBy: "Marcus Johnson", assetId: "AST-003", category: "Laptop Issue", subcategory: "Software Issue", priority: "Low", status: "Resolved", assignedAgent: "Raj Patel",
    description: "Company email app keeps crashing. Happens every time I try to attach a file.",
    createdDate: "2024-11-01", updatedDate: "2024-11-05", resolutionNote: "Cleared app cache and reinstalled. Issue resolved after latest update.",
    comments: [{ id: "c5", author: "Raj Patel", role: "agent", text: "Known issue with v3.2.0. Pushed v3.2.1 update to your device.", date: "2024-11-05" }],
  },
  {
    ticketId: "TKT-006", raisedBy: "Raj Patel", assetId: "AST-008", category: "Accessory Request", subcategory: "Keyboard", priority: "Low", status: "Closed", assignedAgent: "James Thornton",
    description: "Request for a mechanical keyboard for daily use. Current keyboard has sticky keys.",
    createdDate: "2024-10-28", updatedDate: "2024-11-02", resolutionNote: "Logitech MX Keys keyboard issued from IT stock.",
    comments: [],
  },
  {
    ticketId: "TKT-007", raisedBy: "Emily Clarke", assetId: "N/A", category: "Asset Request", subcategory: "New Laptop Request", priority: "Medium", status: "Waiting for User", assignedAgent: "Sarah Mitchell",
    description: "I need a second monitor and a more powerful laptop for video editing work.",
    createdDate: "2024-11-08", updatedDate: "2024-11-12", resolutionNote: "",
    comments: [
      { id: "c6", author: "Sarah Mitchell", role: "super_admin", text: "Please fill out the asset request form and get approval from your department head.", date: "2024-11-09" },
      { id: "c7", author: "Emily Clarke", role: "end_user", text: "Form submitted. Waiting for manager approval.", date: "2024-11-12" },
    ],
  },
  {
    ticketId: "TKT-008", raisedBy: "Marcus Johnson", assetId: "N/A", category: "Asset Request", subcategory: "Mobile Request", priority: "Medium", status: "Open", assignedAgent: "",
    description: "Need a company phone for client calls as I am taking on a client-facing role starting next month.",
    createdDate: "2024-11-17", updatedDate: "2024-11-17", resolutionNote: "",
    comments: [],
  },
];
