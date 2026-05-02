export type AssetType = "Laptop" | "Mobile";
export type AssetStatus = "Available" | "Assigned" | "Under Repair" | "Lost" | "Retired";
export type TicketStatus = "Open" | "Assigned" | "In Progress" | "Waiting for User" | "Resolved" | "Closed" | "Rejected";
export type TicketPriority = "Low" | "Medium" | "High" | "Critical";
export type UserRole = "Super Admin" | "IT Agent" | "End User";
export type UserStatus = "Active" | "Inactive";

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
  password?: string;
}

export const TICKET_CATEGORIES: Record<string, string[]> = {
  "Laptop Issue": ["Battery Issue", "Display Issue", "Keyboard Issue", "Charger Issue", "Software Issue", "Slow Performance"],
  "Mobile Issue": ["Battery Issue", "Screen Issue", "SIM Issue", "App Issue", "Network Issue"],
  "Asset Request": ["New Laptop Request", "Replacement Request", "Mobile Request"],
  "Asset Return": ["Resignation Handover", "Device Return"],
  "Lost or Damage": ["Lost Device", "Physical Damage"],
  "Accessory Request": ["Charger", "Mouse", "Keyboard", "Laptop Bag"],
};

export const mockUsers: User[] = [
  { userId: "USR-001", name: "Sarah Mitchell", email: "admin@assetdesk.demo", role: "Super Admin", department: "IT", assignedAssets: 2, status: "Active" },
  { userId: "USR-002", name: "James Thornton", email: "agent@assetdesk.demo", role: "IT Agent", department: "IT", assignedAssets: 1, status: "Active" },
  { userId: "USR-003", name: "Emily Clarke", email: "user@assetdesk.demo", role: "End User", department: "Marketing", assignedAssets: 1, status: "Active" },
  { userId: "USR-004", name: "Raj Patel", email: "raj.patel@assetdesk.demo", role: "IT Agent", department: "IT", assignedAssets: 1, status: "Active" },
  { userId: "USR-005", name: "Laura Bennett", email: "laura.b@assetdesk.demo", role: "End User", department: "Finance", assignedAssets: 1, status: "Active" },
  { userId: "USR-006", name: "Marcus Johnson", email: "marcus.j@assetdesk.demo", role: "End User", department: "Engineering", assignedAssets: 2, status: "Active" },
  { userId: "USR-007", name: "Sofia Rossi", email: "sofia.r@assetdesk.demo", role: "End User", department: "HR", assignedAssets: 1, status: "Inactive" },
  { userId: "USR-008", name: "Daniel Park", email: "daniel.p@assetdesk.demo", role: "End User", department: "Sales", assignedAssets: 1, status: "Active" },
];

export const mockAssets: Asset[] = [
  { assetId: "AST-001", assetType: "Laptop", brand: "Dell", model: "Latitude 5520", serialNumber: "DL5520X001", purchaseDate: "2022-03-15", warrantyEndDate: "2025-03-15", status: "Assigned", assignedTo: "Marcus Johnson", department: "Engineering", location: "HQ - Floor 2", accessories: "Charger, Mouse", remarks: "Good condition" },
  { assetId: "AST-002", assetType: "Laptop", brand: "Apple", model: "MacBook Pro 14", serialNumber: "APMBP14002", purchaseDate: "2023-01-10", warrantyEndDate: "2026-01-10", status: "Assigned", assignedTo: "Emily Clarke", department: "Marketing", location: "HQ - Floor 3", accessories: "Charger, USB-C Hub", remarks: "Minor scratch on lid" },
  { assetId: "AST-003", assetType: "Laptop", brand: "Lenovo", model: "ThinkPad X1 Carbon", serialNumber: "LNX1C003", purchaseDate: "2021-07-20", warrantyEndDate: "2024-07-20", status: "Under Repair", assignedTo: "Laura Bennett", department: "Finance", location: "IT Repair Center", accessories: "Charger", remarks: "Battery replacement in progress" },
  { assetId: "AST-004", assetType: "Laptop", brand: "HP", model: "EliteBook 840", serialNumber: "HP840004", purchaseDate: "2022-11-05", warrantyEndDate: "2025-11-05", status: "Available", department: "IT", location: "IT Storage Room", accessories: "Charger, Laptop Bag", remarks: "" },
  { assetId: "AST-005", assetType: "Laptop", brand: "Dell", model: "XPS 15", serialNumber: "DLXPS15005", purchaseDate: "2023-04-18", warrantyEndDate: "2026-04-18", status: "Assigned", assignedTo: "Sarah Mitchell", department: "IT", location: "HQ - Floor 1", accessories: "Charger, Docking Station", remarks: "" },
  { assetId: "AST-006", assetType: "Mobile", brand: "Apple", model: "iPhone 14 Pro", serialNumber: "APIPH14006", imeiNumber: "352099007778888", purchaseDate: "2023-02-14", warrantyEndDate: "2025-02-14", status: "Assigned", assignedTo: "Daniel Park", department: "Sales", location: "HQ - Floor 4", accessories: "Charger, Case", remarks: "" },
  { assetId: "AST-007", assetType: "Mobile", brand: "Samsung", model: "Galaxy S23", serialNumber: "SGS23007", imeiNumber: "490154203237518", purchaseDate: "2023-05-01", warrantyEndDate: "2025-05-01", status: "Available", location: "IT Storage Room", accessories: "Charger", remarks: "Newly procured" },
  { assetId: "AST-008", assetType: "Mobile", brand: "Samsung", model: "Galaxy A54", serialNumber: "SGA54008", imeiNumber: "353879234567891", purchaseDate: "2022-08-12", warrantyEndDate: "2024-08-12", status: "Assigned", assignedTo: "Marcus Johnson", department: "Engineering", location: "HQ - Floor 2", accessories: "Charger, Screen Protector", remarks: "" },
  { assetId: "AST-009", assetType: "Laptop", brand: "HP", model: "ProBook 450", serialNumber: "HPPB450009", purchaseDate: "2021-03-10", warrantyEndDate: "2024-03-10", status: "Retired", location: "IT Storage Room", accessories: "Charger", remarks: "End of life - hardware failure" },
  { assetId: "AST-010", assetType: "Laptop", brand: "Lenovo", model: "IdeaPad 5", serialNumber: "LNIP5010", purchaseDate: "2022-09-22", warrantyEndDate: "2025-09-22", status: "Assigned", assignedTo: "James Thornton", department: "IT", location: "HQ - Floor 1", accessories: "Charger", remarks: "" },
  { assetId: "AST-011", assetType: "Mobile", brand: "Apple", model: "iPhone 13", serialNumber: "APIPH13011", imeiNumber: "491287340012345", purchaseDate: "2022-01-15", warrantyEndDate: "2024-01-15", status: "Lost", department: "HR", location: "Unknown", accessories: "Charger", remarks: "Reported lost by Sofia Rossi - under investigation" },
  { assetId: "AST-012", assetType: "Laptop", brand: "Dell", model: "Inspiron 15", serialNumber: "DLINS15012", purchaseDate: "2023-06-30", warrantyEndDate: "2026-06-30", status: "Available", location: "IT Storage Room", accessories: "Charger, Mouse, Laptop Bag", remarks: "New stock" },
  { assetId: "AST-013", assetType: "Mobile", brand: "Google", model: "Pixel 7", serialNumber: "GKPX7013", imeiNumber: "351234567890123", purchaseDate: "2023-03-08", warrantyEndDate: "2026-03-08", status: "Assigned", assignedTo: "Raj Patel", department: "IT", location: "HQ - Floor 1", accessories: "Charger, Case", remarks: "" },
  { assetId: "AST-014", assetType: "Laptop", brand: "Apple", model: "MacBook Air M2", serialNumber: "APMBAM2014", purchaseDate: "2023-08-15", warrantyEndDate: "2026-08-15", status: "Available", location: "IT Storage Room", accessories: "Charger", remarks: "Reserved for new hire" },
  { assetId: "AST-015", assetType: "Laptop", brand: "HP", model: "Spectre x360", serialNumber: "HPSPX360015", purchaseDate: "2022-12-01", warrantyEndDate: "2025-12-01", status: "Assigned", assignedTo: "Sofia Rossi", department: "HR", location: "HQ - Floor 3", accessories: "Charger, Stylus", remarks: "" },
];

export const mockTickets: Ticket[] = [
  {
    ticketId: "TKT-001", raisedBy: "Marcus Johnson", assetId: "AST-001", category: "Laptop Issue", subcategory: "Slow Performance", priority: "High", status: "In Progress", assignedAgent: "James Thornton", description: "My laptop has been extremely slow for the past week. Applications take forever to open and the fan is constantly running at full speed.", createdDate: "2024-11-15", updatedDate: "2024-11-16", resolutionNote: "",
    comments: [
      { id: "c1", author: "James Thornton", role: "IT Agent", text: "Ran diagnostics - found malware and excessive startup items. Starting cleanup.", date: "2024-11-16" },
    ]
  },
  {
    ticketId: "TKT-002", raisedBy: "Emily Clarke", assetId: "AST-002", category: "Laptop Issue", subcategory: "Display Issue", priority: "Medium", status: "Assigned", assignedAgent: "Raj Patel", description: "The screen flickers occasionally, especially when on battery power. It goes away when plugged in.", createdDate: "2024-11-14", updatedDate: "2024-11-15", resolutionNote: "",
    comments: []
  },
  {
    ticketId: "TKT-003", raisedBy: "Laura Bennett", assetId: "AST-003", category: "Laptop Issue", subcategory: "Battery Issue", priority: "Critical", status: "In Progress", assignedAgent: "James Thornton", description: "Laptop battery drains from 100% to 0% in under 30 minutes. Requires immediate replacement as I need it for client presentations.", createdDate: "2024-11-10", updatedDate: "2024-11-18", resolutionNote: "",
    comments: [
      { id: "c2", author: "James Thornton", role: "IT Agent", text: "New battery has been ordered. ETA 3 business days.", date: "2024-11-11" },
      { id: "c3", author: "Laura Bennett", role: "End User", text: "I have a presentation on Nov 20th - please prioritize.", date: "2024-11-12" },
      { id: "c4", author: "James Thornton", role: "IT Agent", text: "Battery received, currently being installed.", date: "2024-11-18" },
    ]
  },
  {
    ticketId: "TKT-004", raisedBy: "Daniel Park", assetId: "AST-006", category: "Mobile Issue", subcategory: "Network Issue", priority: "Medium", status: "Open", assignedAgent: "", description: "Unable to connect to office Wi-Fi on my phone. Personal hotspot works fine but office network shows 'Authentication failed'.", createdDate: "2024-11-18", updatedDate: "2024-11-18", resolutionNote: "",
    comments: []
  },
  {
    ticketId: "TKT-005", raisedBy: "Marcus Johnson", assetId: "AST-008", category: "Mobile Issue", subcategory: "App Issue", priority: "Low", status: "Resolved", assignedAgent: "Raj Patel", description: "Company email app keeps crashing on Android. Happens every time I try to attach a file.", createdDate: "2024-11-01", updatedDate: "2024-11-05", resolutionNote: "Cleared app cache and reinstalled. Issue resolved after latest app update (v3.2.1).",
    comments: [
      { id: "c5", author: "Raj Patel", role: "IT Agent", text: "Known issue with v3.2.0. Pushed v3.2.1 update to your device.", date: "2024-11-05" },
    ]
  },
  {
    ticketId: "TKT-006", raisedBy: "Sofia Rossi", assetId: "AST-011", category: "Lost or Damage", subcategory: "Lost Device", priority: "Critical", status: "Open", assignedAgent: "", description: "I cannot find my company iPhone. Last seen at the marketing conference on Nov 15th. Tried Find My iPhone but device appears offline.", createdDate: "2024-11-16", updatedDate: "2024-11-16", resolutionNote: "",
    comments: []
  },
  {
    ticketId: "TKT-007", raisedBy: "Emily Clarke", assetId: "N/A", category: "Asset Request", subcategory: "New Laptop Request", priority: "Medium", status: "Waiting for User", assignedAgent: "Sarah Mitchell", description: "I need a second monitor and a more powerful laptop for video editing work. Current MacBook Pro handles most tasks but struggles with 4K exports.", createdDate: "2024-11-08", updatedDate: "2024-11-12", resolutionNote: "",
    comments: [
      { id: "c6", author: "Sarah Mitchell", role: "Super Admin", text: "Please fill out the asset request form and get approval from your department head.", date: "2024-11-09" },
      { id: "c7", author: "Emily Clarke", role: "End User", text: "Form submitted. Waiting for manager approval.", date: "2024-11-12" },
    ]
  },
  {
    ticketId: "TKT-008", raisedBy: "Raj Patel", assetId: "AST-013", category: "Accessory Request", subcategory: "Keyboard", priority: "Low", status: "Closed", assignedAgent: "James Thornton", description: "Request for a mechanical keyboard for daily use. Current keyboard has sticky keys.", createdDate: "2024-10-28", updatedDate: "2024-11-02", resolutionNote: "Logitech MX Keys keyboard issued from IT stock.",
    comments: []
  },
  {
    ticketId: "TKT-009", raisedBy: "Daniel Park", assetId: "N/A", category: "Asset Return", subcategory: "Device Return", priority: "Low", status: "Closed", assignedAgent: "Sarah Mitchell", description: "Returning old laptop (AST-009) as I have been issued a new one.", createdDate: "2024-10-20", updatedDate: "2024-10-22", resolutionNote: "Device returned and processed. Asset marked as Retired due to hardware failure.",
    comments: []
  },
  {
    ticketId: "TKT-010", raisedBy: "Laura Bennett", assetId: "AST-003", category: "Laptop Issue", subcategory: "Charger Issue", priority: "High", status: "Resolved", assignedAgent: "Raj Patel", description: "Laptop charger stopped working. The charging light doesn't come on at all.", createdDate: "2024-10-15", updatedDate: "2024-10-17", resolutionNote: "Replacement charger issued from IT stock. Original charger confirmed faulty - disposed.",
    comments: []
  },
  {
    ticketId: "TKT-011", raisedBy: "Marcus Johnson", assetId: "N/A", category: "Asset Request", subcategory: "Mobile Request", priority: "Medium", status: "Open", assignedAgent: "", description: "Need a company phone for client calls as I am taking on a client-facing role starting next month.", createdDate: "2024-11-17", updatedDate: "2024-11-17", resolutionNote: "",
    comments: []
  },
  {
    ticketId: "TKT-012", raisedBy: "James Thornton", assetId: "AST-010", category: "Laptop Issue", subcategory: "Keyboard Issue", priority: "Low", status: "Rejected", assignedAgent: "Sarah Mitchell", description: "Requesting keyboard replacement - some keys feel mushy.", createdDate: "2024-11-05", updatedDate: "2024-11-07", resolutionNote: "Rejected - device is under warranty, sent for manufacturer service. Not eligible for in-house replacement.",
    comments: [
      { id: "c8", author: "Sarah Mitchell", role: "Super Admin", text: "Device is still under warranty. Sending to manufacturer for service instead.", date: "2024-11-07" },
    ]
  },
];
