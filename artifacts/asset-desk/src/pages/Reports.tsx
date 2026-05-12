import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, Monitor, Ticket, Users, Download, FileText,
  PieChart as PieChartIcon, BarChart2 as BarChartIcon,
} from "lucide-react";
import { useAssets } from "@/context/AssetContext";
import { useTickets } from "@/context/TicketContext";
import { useUsers } from "@/context/UsersContext";
import { ROLE_LABELS, Asset, Ticket as TicketType, Profile } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border:          "1px solid hsl(var(--border))",
  borderRadius:    "8px",
  fontSize:        "12px",
};

function EmptyChart({ icon: Icon, message, sub }: { icon: React.ElementType; message: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[220px] gap-2 text-center px-4">
      <Icon className="h-10 w-10 text-muted-foreground/20" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {sub && <p className="text-xs text-muted-foreground/60">{sub}</p>}
    </div>
  );
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportAssetsCsv(assets: Asset[]) {
  const header = ["Asset ID","Type","Brand","Model","Serial Number","IMEI","Status","Assigned To","Assigned Email","Department","Location","Purchase Date","Warranty End","Accessories","Remarks"];
  const rows = assets.map((a) => [
    a.assetId, a.assetType, a.brand, a.model, a.serialNumber,
    a.imeiNumber ?? "", a.status, a.assignedTo ?? "", a.assignedEmail ?? "", a.department ?? "",
    a.location, a.purchaseDate, a.warrantyEndDate, a.accessories ?? "", a.remarks ?? "",
  ]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  downloadCsv(csv, `assets_report_${new Date().toISOString().split("T")[0]}.csv`);
}

function exportTicketsCsv(tickets: TicketType[]) {
  const header = ["Ticket ID","Raised By","Employee Email","Asset ID","Category","Subcategory","Priority","Status","Assigned Agent","Created Date","Updated Date","Description"];
  const rows = tickets.map((t) => [
    t.ticketId, t.raisedBy, t.employeeEmail ?? "", t.assetId, t.category, t.subcategory,
    t.priority, t.status, t.assignedAgent, t.createdDate, t.updatedDate, t.description,
  ]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  downloadCsv(csv, `tickets_report_${new Date().toISOString().split("T")[0]}.csv`);
}

function exportUsersCsv(users: Profile[]) {
  const header = ["User ID","Name","Email","Role","Department","Location","Status"];
  const rows = users.map((u) => [
    u.id, u.full_name, u.email, ROLE_LABELS[u.role], u.department, u.location, u.status,
  ]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  downloadCsv(csv, `users_report_${new Date().toISOString().split("T")[0]}.csv`);
}

function exportSummaryCsv(assets: Asset[], tickets: TicketType[], users: Profile[]) {
  const resolved = tickets.filter((t) => t.status === "Resolved").length;
  const resRate  = tickets.length > 0 ? `${Math.round((resolved / tickets.length) * 100)}%` : "N/A";
  const lines: string[] = [
    `"Miles Education — IT Helpdesk Full Report — ${new Date().toLocaleDateString()}"`,
    "",
    '"=== SUMMARY ==="',
    `"Total Assets","${assets.length}"`,
    `"Total Tickets","${tickets.length}"`,
    `"Total Users","${users.length}"`,
    `"Resolution Rate","${resRate}"`,
    "",
    '"=== ASSETS BY STATUS ==="',
    ...["In Procurement","Available","Assigned","Under Repair","Lost","Retired"].map((s) => `"${s}","${assets.filter((a) => a.status === s).length}"`),
    "",
    '"=== TICKETS BY PRIORITY ==="',
    ...["Critical","High","Medium","Low"].map((p) => `"${p}","${tickets.filter((t) => t.priority === p).length}"`),
    "",
    '"=== USERS BY ROLE ==="',
    `"Super Admin","${users.filter((u) => u.role === "super_admin").length}"`,
    `"IT Admin","${users.filter((u) => u.role === "it_admin").length}"`,
    `"IT Agent","${users.filter((u) => u.role === "it_agent").length}"`,
    `"End User","${users.filter((u) => u.role === "end_user").length}"`,
  ];
  downloadCsv(lines.join("\n"), `full_report_${new Date().toISOString().split("T")[0]}.csv`);
}

function ExportCardButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button
      variant="ghost" size="sm"
      className="gap-1.5 text-xs text-muted-foreground hover:text-foreground h-7 px-2"
      onClick={onClick} title={`Export ${label}`}
    >
      <Download className="h-3.5 w-3.5" />Export
    </Button>
  );
}

export default function Reports() {
  const { toast }     = useToast();
  const { assets }    = useAssets();
  const { tickets }   = useTickets();
  const { users }     = useUsers();

  const handleExport = (fn: () => void, label: string) => {
    fn();
    toast({ title: `${label} exported`, description: "CSV file downloaded to your device" });
  };

  const assetsByType = [
    { name: "Laptop", count: assets.filter((a) => a.assetType === "Laptop").length },
    { name: "Mobile", count: assets.filter((a) => a.assetType === "Mobile").length },
  ];
  const assetsByStatus = [
    { name: "Available",    count: assets.filter((a) => a.status === "Available").length,    color: "#22c55e" },
    { name: "Assigned",     count: assets.filter((a) => a.status === "Assigned").length,     color: "#3b82f6" },
    { name: "Under Repair", count: assets.filter((a) => a.status === "Under Repair").length, color: "#f59e0b" },
    { name: "Lost",         count: assets.filter((a) => a.status === "Lost").length,         color: "#ef4444" },
    { name: "Retired",      count: assets.filter((a) => a.status === "Retired").length,      color: "#6b7280" },
  ].filter((d) => d.count > 0);

  const ticketsByStatus = [
    { name: "Open",        count: tickets.filter((t) => t.status === "Open").length },
    { name: "Assigned",    count: tickets.filter((t) => t.status === "Assigned").length },
    { name: "In Progress", count: tickets.filter((t) => t.status === "In Progress").length },
    { name: "Resolved",    count: tickets.filter((t) => t.status === "Resolved").length },
    { name: "Closed",      count: tickets.filter((t) => t.status === "Closed").length },
  ].filter((d) => d.count > 0);

  const ticketsByCategory = Object.entries(
    tickets.reduce<Record<string, number>>((acc, t) => { acc[t.category] = (acc[t.category] || 0) + 1; return acc; }, {})
  ).map(([name, count]) => ({ name: name.replace(" Issue", "").replace(" Request", " Req"), count }));

  const ticketsByPriority = [
    { name: "Critical", count: tickets.filter((t) => t.priority === "Critical").length, color: "#ef4444" },
    { name: "High",     count: tickets.filter((t) => t.priority === "High").length,     color: "#f59e0b" },
    { name: "Medium",   count: tickets.filter((t) => t.priority === "Medium").length,   color: "#3b82f6" },
    { name: "Low",      count: tickets.filter((t) => t.priority === "Low").length,      color: "#6b7280" },
  ].filter((d) => d.count > 0);

  const usersByRole = [
    { name: "Super Admin", count: users.filter((u) => u.role === "super_admin").length },
    { name: "IT Admin",    count: users.filter((u) => u.role === "it_admin").length },
    { name: "IT Agent",    count: users.filter((u) => u.role === "it_agent").length },
    { name: "End User",    count: users.filter((u) => u.role === "end_user").length },
  ];

  const resolved = tickets.filter((t) => t.status === "Resolved").length;
  const resRate  = tickets.length > 0 ? `${Math.round((resolved / tickets.length) * 100)}%` : "—";

  const summaryCards = [
    { label: "Total Assets",    value: assets.length,  icon: Monitor,    color: "text-blue-500",    bg: "bg-blue-500/10" },
    { label: "Total Tickets",   value: tickets.length, icon: Ticket,     color: "text-purple-500",  bg: "bg-purple-500/10" },
    { label: "Total Users",     value: users.length,   icon: Users,      color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Resolution Rate", value: resRate,        icon: TrendingUp, color: "text-amber-500",   bg: "bg-amber-500/10" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Analytics and insights</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="gap-2" data-testid="button-export-report">
              <Download className="h-4 w-4" />Export Data
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem className="flex items-center gap-2 cursor-pointer" onClick={() => handleExport(() => exportAssetsCsv(assets), "Assets report")}>
              <Monitor className="h-3.5 w-3.5 text-blue-500" />Export Assets
            </DropdownMenuItem>
            <DropdownMenuItem className="flex items-center gap-2 cursor-pointer" onClick={() => handleExport(() => exportTicketsCsv(tickets), "Tickets report")}>
              <Ticket className="h-3.5 w-3.5 text-purple-500" />Export Tickets
            </DropdownMenuItem>
            <DropdownMenuItem className="flex items-center gap-2 cursor-pointer" onClick={() => handleExport(() => exportUsersCsv(users), "Users report")}>
              <Users className="h-3.5 w-3.5 text-emerald-500" />Export Users
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="flex items-center gap-2 cursor-pointer font-medium" onClick={() => handleExport(() => exportSummaryCsv(assets, tickets, users), "Full summary report")}>
              <FileText className="h-3.5 w-3.5 text-amber-500" />Export Full Summary
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Asset Status Breakdown</CardTitle>
            <ExportCardButton onClick={() => handleExport(() => exportAssetsCsv(assets), "Assets report")} label="assets" />
          </CardHeader>
          <CardContent>
            {assetsByStatus.length === 0 ? (
              <EmptyChart icon={PieChartIcon} message="No assets yet" sub="Add assets to see the status breakdown" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={assetsByStatus} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="count">
                    {assetsByStatus.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: "12px", color: "hsl(var(--foreground))" }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Tickets by Status</CardTitle>
            <ExportCardButton onClick={() => handleExport(() => exportTicketsCsv(tickets), "Tickets report")} label="tickets" />
          </CardHeader>
          <CardContent>
            {ticketsByStatus.length === 0 ? (
              <EmptyChart icon={BarChartIcon} message="No tickets yet" sub="Ticket status data will appear here once tickets are raised" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ticketsByStatus} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4,4,0,0]} name="Tickets" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Tickets by Category</CardTitle>
            <ExportCardButton onClick={() => handleExport(() => exportTicketsCsv(tickets), "Tickets report")} label="tickets" />
          </CardHeader>
          <CardContent>
            {ticketsByCategory.length === 0 ? (
              <EmptyChart icon={BarChartIcon} message="No tickets yet" sub="Categories will populate as tickets are raised" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ticketsByCategory} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4,4,0,0]} name="Tickets" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Tickets by Priority</CardTitle>
            <ExportCardButton onClick={() => handleExport(() => exportTicketsCsv(tickets), "Tickets report")} label="tickets" />
          </CardHeader>
          <CardContent>
            {ticketsByPriority.length === 0 ? (
              <EmptyChart icon={BarChartIcon} message="No tickets yet" sub="Priority breakdown will appear as tickets are raised" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ticketsByPriority} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" radius={[4,4,0,0]} name="Tickets">
                    {ticketsByPriority.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Assets by Type</CardTitle>
            <ExportCardButton onClick={() => handleExport(() => exportAssetsCsv(assets), "Assets report")} label="assets" />
          </CardHeader>
          <CardContent>
            {assets.length === 0 ? (
              <EmptyChart icon={BarChartIcon} message="No assets yet" sub="Laptop vs Mobile breakdown will appear here" />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={assetsByType} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill="#6366f1" radius={[4,4,0,0]} name="Assets" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Users by Role</CardTitle>
            <ExportCardButton onClick={() => handleExport(() => exportUsersCsv(users), "Users report")} label="users" />
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
