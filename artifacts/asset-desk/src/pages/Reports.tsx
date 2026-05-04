import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid,
} from "recharts";
import { mockAssets, mockTickets, mockUsers, ROLE_LABELS } from "@/data/mockData";
import { TrendingUp, Monitor, Ticket, Users, Download, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Chart data (static from mockData) ──────────────────────────────────────
const assetsByType = [
  { name: "Laptop", count: mockAssets.filter((a) => a.assetType === "Laptop").length },
  { name: "Mobile", count: mockAssets.filter((a) => a.assetType === "Mobile").length },
];
const assetsByStatus = [
  { name: "Available",    count: mockAssets.filter((a) => a.status === "Available").length,    color: "#22c55e" },
  { name: "Assigned",     count: mockAssets.filter((a) => a.status === "Assigned").length,     color: "#3b82f6" },
  { name: "Under Repair", count: mockAssets.filter((a) => a.status === "Under Repair").length, color: "#f59e0b" },
  { name: "Lost",         count: mockAssets.filter((a) => a.status === "Lost").length,         color: "#ef4444" },
  { name: "Retired",      count: mockAssets.filter((a) => a.status === "Retired").length,      color: "#6b7280" },
];
const ticketsByStatus = [
  { name: "Open",        count: mockTickets.filter((t) => t.status === "Open").length },
  { name: "Assigned",    count: mockTickets.filter((t) => t.status === "Assigned").length },
  { name: "In Progress", count: mockTickets.filter((t) => t.status === "In Progress").length },
  { name: "Resolved",    count: mockTickets.filter((t) => t.status === "Resolved").length },
  { name: "Closed",      count: mockTickets.filter((t) => t.status === "Closed").length },
  { name: "Rejected",    count: mockTickets.filter((t) => t.status === "Rejected").length },
];
const ticketsByCategory = Object.entries(
  mockTickets.reduce<Record<string, number>>((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + 1;
    return acc;
  }, {})
).map(([name, count]) => ({ name: name.replace(" Issue", "").replace(" Request", " Req"), count }));

const ticketsByPriority = [
  { name: "Critical", count: mockTickets.filter((t) => t.priority === "Critical").length, color: "#ef4444" },
  { name: "High",     count: mockTickets.filter((t) => t.priority === "High").length,     color: "#f59e0b" },
  { name: "Medium",   count: mockTickets.filter((t) => t.priority === "Medium").length,   color: "#3b82f6" },
  { name: "Low",      count: mockTickets.filter((t) => t.priority === "Low").length,      color: "#6b7280" },
];
const usersByRole = [
  { name: "Super Admin", count: mockUsers.filter((u) => u.role === "super_admin").length },
  { name: "IT Agent",    count: mockUsers.filter((u) => u.role === "agent").length },
  { name: "End User",    count: mockUsers.filter((u) => u.role === "end_user").length },
];
const monthlyTickets = [
  { month: "Jun", open: 3, resolved: 5 },
  { month: "Jul", open: 5, resolved: 4 },
  { month: "Aug", open: 4, resolved: 6 },
  { month: "Sep", open: 6, resolved: 5 },
  { month: "Oct", open: 4, resolved: 7 },
  { month: "Nov", open: 7, resolved: 3 },
];
const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border:         "1px solid hsl(var(--border))",
  borderRadius:   "8px",
  fontSize:       "12px",
};
const summaryCards = [
  { label: "Total Assets",  value: mockAssets.length,  icon: Monitor,    color: "text-blue-500",   bg: "bg-blue-500/10" },
  { label: "Total Tickets", value: mockTickets.length, icon: Ticket,     color: "text-purple-500", bg: "bg-purple-500/10" },
  { label: "Total Users",   value: mockUsers.length,   icon: Users,      color: "text-emerald-500",bg: "bg-emerald-500/10" },
  {
    label: "Resolution Rate",
    value: `${Math.round((mockTickets.filter((t) => t.status === "Resolved").length / mockTickets.length) * 100)}%`,
    icon: TrendingUp,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
  },
];

// ─── CSV export helpers ──────────────────────────────────────────────────────
function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportAssets() {
  const header = ["Asset ID","Type","Brand","Model","Serial Number","IMEI","Status","Assigned To","Department","Location","Purchase Date","Warranty End","Accessories","Remarks"];
  const rows = mockAssets.map((a) => [
    a.assetId, a.assetType, a.brand, a.model, a.serialNumber,
    a.imeiNumber ?? "", a.status, a.assignedTo ?? "", a.department ?? "",
    a.location, a.purchaseDate, a.warrantyEndDate, a.accessories ?? "", a.remarks ?? "",
  ]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  downloadCsv(csv, `assets_report_${new Date().toISOString().split("T")[0]}.csv`);
}

function exportTickets() {
  const header = ["Ticket ID","Raised By","Asset ID","Category","Subcategory","Priority","Status","Assigned Agent","Created Date","Updated Date","Description"];
  const rows = mockTickets.map((t) => [
    t.ticketId, t.raisedBy, t.assetId, t.category, t.subcategory,
    t.priority, t.status, t.assignedAgent, t.createdDate, t.updatedDate, t.description,
  ]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  downloadCsv(csv, `tickets_report_${new Date().toISOString().split("T")[0]}.csv`);
}

function exportUsers() {
  const header = ["User ID","Name","Email","Role","Department","Status","Assigned Assets"];
  const rows = mockUsers.map((u) => [
    u.userId, u.name, u.email, ROLE_LABELS[u.role], u.department, u.status, String(u.assignedAssets ?? 0),
  ]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  downloadCsv(csv, `users_report_${new Date().toISOString().split("T")[0]}.csv`);
}

function exportSummary() {
  const lines: string[] = [
    `"Asset Desk — Full Report — ${new Date().toLocaleDateString()}"`,
    "",
    '"=== SUMMARY ==="',
    `"Total Assets","${mockAssets.length}"`,
    `"Total Tickets","${mockTickets.length}"`,
    `"Total Users","${mockUsers.length}"`,
    `"Resolution Rate","${Math.round((mockTickets.filter((t) => t.status === "Resolved").length / mockTickets.length) * 100)}%"`,
    "",
    '"=== ASSETS BY STATUS ==="',
    ...assetsByStatus.map((r) => `"${r.name}","${r.count}"`),
    "",
    '"=== TICKETS BY PRIORITY ==="',
    ...ticketsByPriority.map((r) => `"${r.name}","${r.count}"`),
    "",
    '"=== USERS BY ROLE ==="',
    ...usersByRole.map((r) => `"${r.name}","${r.count}"`),
  ];
  downloadCsv(lines.join("\n"), `full_report_${new Date().toISOString().split("T")[0]}.csv`);
}

// ─── Small inline export button ──────────────────────────────────────────────
function ExportCardButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5 text-xs text-muted-foreground hover:text-foreground h-7 px-2"
      onClick={onClick}
      title={`Export ${label}`}
    >
      <Download className="h-3.5 w-3.5" />
      Export
    </Button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Reports() {
  const { toast } = useToast();

  const handleExport = (fn: () => void, label: string) => {
    fn();
    toast({ title: `${label} exported`, description: "CSV file downloaded to your device" });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Analytics and insights</p>
        </div>
        {/* Main export dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="gap-2" data-testid="button-export-report">
              <Download className="h-4 w-4" /> Export Data
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => handleExport(exportAssets, "Assets report")}
            >
              <Monitor className="h-3.5 w-3.5 text-blue-500" /> Export Assets
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => handleExport(exportTickets, "Tickets report")}
            >
              <Ticket className="h-3.5 w-3.5 text-purple-500" /> Export Tickets
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => handleExport(exportUsers, "Users report")}
            >
              <Users className="h-3.5 w-3.5 text-emerald-500" /> Export Users
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="flex items-center gap-2 cursor-pointer font-medium"
              onClick={() => handleExport(exportSummary, "Full summary report")}
            >
              <FileText className="h-3.5 w-3.5 text-amber-500" /> Export Full Summary
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} data-testid={`card-report-${card.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <CardContent className="p-4">
                <div className={`inline-flex rounded-lg p-2 ${card.bg} mb-3`}>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                </div>
                <div className="text-2xl font-bold text-foreground">{card.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{card.label}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Asset Status */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Asset Status Breakdown</CardTitle>
            <ExportCardButton onClick={() => handleExport(exportAssets, "Assets report")} label="assets" />
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={assetsByStatus.filter((d) => d.count > 0)} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="count">
                  {assetsByStatus.filter((d) => d.count > 0).map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: "12px", color: "hsl(var(--foreground))" }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Monthly Tickets */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Monthly Ticket Trend</CardTitle>
            <ExportCardButton onClick={() => handleExport(exportTickets, "Tickets report")} label="tickets" />
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={monthlyTickets} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: "12px", color: "hsl(var(--foreground))" }}>{v}</span>} />
                <Line type="monotone" dataKey="open" stroke="#3b82f6" strokeWidth={2} dot={{ fill: "#3b82f6", r: 3 }} name="Opened" />
                <Line type="monotone" dataKey="resolved" stroke="#22c55e" strokeWidth={2} dot={{ fill: "#22c55e", r: 3 }} name="Resolved" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Tickets by Category */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Tickets by Category</CardTitle>
            <ExportCardButton onClick={() => handleExport(exportTickets, "Tickets report")} label="tickets" />
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={ticketsByCategory} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4,4,0,0]} name="Tickets" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Tickets by Priority */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Tickets by Priority</CardTitle>
            <ExportCardButton onClick={() => handleExport(exportTickets, "Tickets report")} label="tickets" />
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={ticketsByPriority} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" radius={[4,4,0,0]} name="Tickets">
                  {ticketsByPriority.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Asset & User breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Assets by Type</CardTitle>
            <ExportCardButton onClick={() => handleExport(exportAssets, "Assets report")} label="assets" />
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={assetsByType} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#6366f1" radius={[4,4,0,0]} name="Assets" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Users by Role</CardTitle>
            <ExportCardButton onClick={() => handleExport(exportUsers, "Users report")} label="users" />
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={usersByRole} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#8b5cf6" radius={[4,4,0,0]} name="Users" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
