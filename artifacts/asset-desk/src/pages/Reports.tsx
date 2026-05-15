import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
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

async function exportFullXlsx(
  assets: Asset[],
  tickets: TicketType[],
  users: Profile[],
  setExporting: (v: boolean) => void,
  toast: (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => void,
) {
  setExporting(true);
  try {
    const XLSX = await import("xlsx");
    const today  = new Date();
    const dateStr = today.toISOString().split("T")[0];

    // Fetch assignment history from Supabase
    const { data: historyRows } = await supabase
      .from("asset_assignment_history")
      .select("*")
      .order("created_at", { ascending: false });
    const history = (historyRows ?? []) as Record<string, unknown>[];

    // ── Helpers ──────────────────────────────────────────────────────────────
    const fmt = (v: unknown) => (v == null || v === "" ? "" : String(v));
    const fmtDate = (v: unknown) => {
      if (!v) return "";
      const d = new Date(String(v));
      return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-IN");
    };
    const addSheet = (wb: ReturnType<typeof XLSX.utils.book_new>, name: string, data: unknown[][], colWidths: number[]) => {
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws["!cols"] = colWidths.map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    const ROLE_MAP: Record<string, string> = {
      super_admin: "Super Admin", it_admin: "IT Admin", it_agent: "IT Agent", end_user: "End User",
    };

    // ── Sheet 1: Dashboard Summary ────────────────────────────────────────────
    const ninety = new Date(); ninety.setDate(ninety.getDate() + 90);
    const expiringSoon = assets.filter((a) => { const d = new Date(a.warrantyEndDate); return !isNaN(d.getTime()) && d > today && d <= ninety; }).length;
    const expired      = assets.filter((a) => { const d = new Date(a.warrantyEndDate); return !isNaN(d.getTime()) && d < today; }).length;
    const resolved     = tickets.filter((t) => t.status === "Resolved").length;
    const resRate      = tickets.length > 0 ? `${Math.round((resolved / tickets.length) * 100)}%` : "N/A";

    const deptMap = assets.reduce<Record<string, number>>((acc, a) => {
      const d = a.department || "Unassigned"; acc[d] = (acc[d] || 0) + 1; return acc;
    }, {});
    const empAssets = assets.filter((a) => a.assignedTo).reduce<Record<string, number>>((acc, a) => {
      const k = a.assignedTo!; acc[k] = (acc[k] || 0) + 1; return acc;
    }, {});
    const topEmp = Object.entries(empAssets).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const sheet1: unknown[][] = [
      ["Miles Education Pvt Ltd — IT Asset Management & Helpdesk — Full Report"],
      [`Generated: ${today.toLocaleString("en-IN")}   |   Period: All Time`],
      [],
      ["KEY METRICS", ""],
      ["Metric", "Value"],
      ["Total Assets",        assets.length],
      ["Total Users",         users.length],
      ["Total Tickets",       tickets.length],
      ["Assigned Assets",     assets.filter((a) => a.status === "Assigned").length],
      ["Available Assets",    assets.filter((a) => a.status === "Available").length],
      ["Under Repair",        assets.filter((a) => a.status === "Under Repair").length],
      ["Lost Assets",         assets.filter((a) => a.status === "Lost").length],
      ["Retired Assets",      assets.filter((a) => a.status === "Retired").length],
      ["In Procurement",      assets.filter((a) => a.status === "In Procurement").length],
      [],
      ["TICKET ANALYTICS", ""],
      ["Metric", "Value"],
      ["Open Tickets",        tickets.filter((t) => t.status === "Open").length],
      ["In Progress",         tickets.filter((t) => t.status === "In Progress").length],
      ["Resolved Tickets",    resolved],
      ["Closed Tickets",      tickets.filter((t) => t.status === "Closed").length],
      ["Resolution Rate",     resRate],
      [],
      ["ASSET STATUS BREAKDOWN", "", ""],
      ["Status", "Count", "% of Total"],
      ...["In Procurement","Available","Assigned","Under Repair","Lost","Retired"].map((s) => {
        const cnt = assets.filter((a) => a.status === s).length;
        return [s, cnt, assets.length > 0 ? `${Math.round(cnt / assets.length * 100)}%` : "0%"];
      }),
      [],
      ["WARRANTY ANALYTICS", ""],
      ["Metric", "Count"],
      ["Expiring Within 90 Days", expiringSoon],
      ["Already Expired",         expired],
      [],
      ["ASSETS BY DEPARTMENT", ""],
      ["Department", "Asset Count"],
      ...Object.entries(deptMap).sort((a, b) => b[1] - a[1]),
      [],
      ["TOP ASSET HOLDERS (by count)", ""],
      ["Employee Name", "Assets Held"],
      ...topEmp,
      [],
      ["TICKET PRIORITY BREAKDOWN", ""],
      ["Priority", "Count"],
      ...["Critical","High","Medium","Low"].map((p) => [p, tickets.filter((t) => t.priority === p).length]),
      [],
      ["USER ROLES", ""],
      ["Role", "Count"],
      ["Super Admin", users.filter((u) => u.role === "super_admin").length],
      ["IT Admin",    users.filter((u) => u.role === "it_admin").length],
      ["IT Agent",    users.filter((u) => u.role === "it_agent").length],
      ["End User",    users.filter((u) => u.role === "end_user").length],
    ];
    addSheet(XLSX.utils.book_new(), "init", [], []); // warmup
    const wb = XLSX.utils.book_new();
    addSheet(wb, "1 - Dashboard Summary", sheet1, [38, 22, 14]);

    // ── Sheet 2: Assets Master Data ───────────────────────────────────────────
    const assetsHeader = [
      "Asset ID","Type","Brand","Model","Serial Number","Product No.",
      "Processor","RAM","OS","Storage","IMEI 1","IMEI 2",
      "Purchase Date","Warranty End","Vendor","Invoice",
      "Status","Location","Accessories","Remarks",
    ];
    const assetsRows: unknown[][] = assets.map((a) => [
      fmt(a.assetId), fmt(a.assetType), fmt(a.brand), fmt(a.model),
      fmt(a.serialNumber), fmt(a.productNumber),
      fmt(a.processor), fmt(a.ram),
      fmt(a.operatingSystem), fmt(a.storage),
      fmt(a.imeiNumber), fmt(a.imei2),
      fmtDate(a.purchaseDate), fmtDate(a.warrantyEndDate),
      fmt(a.vendor), fmt(a.invoice),
      fmt(a.status), fmt(a.location), fmt(a.accessories), fmt(a.remarks),
    ]);
    addSheet(wb, "2 - Assets Master", [assetsHeader, ...assetsRows],
      [14,10,12,18,18,14,16,8,14,10,16,16,14,14,16,14,14,16,20,30]);

    // ── Sheet 3: Users Master Data ─────────────────────────────────────────────
    const usersHeader = ["E-Code","Full Name","Email","Role","Department","Location","Reporting Manager","Status"];
    const usersRows: unknown[][] = users.map((u) => [
      fmt(u.ecode), fmt(u.full_name), fmt(u.email),
      ROLE_MAP[u.role] ?? u.role,
      fmt(u.department), fmt(u.location),
      fmt(u.reporting_manager), fmt(u.status),
    ]);
    addSheet(wb, "3 - Users Master", [usersHeader, ...usersRows],
      [12,22,30,14,18,16,22,10]);

    // ── Sheet 4: Current Asset Assignments ────────────────────────────────────
    const assigned4 = assets.filter((a) => a.status === "Assigned");
    const assign4Header = [
      "Asset ID","Type","Brand","Model","Serial Number",
      "Assigned To","E-Code","Email","Department","Asset Status","Assigned Date","Warranty End",
    ];
    const assign4Rows: unknown[][] = assigned4.map((a) => [
      fmt(a.assetId), fmt(a.assetType), fmt(a.brand), fmt(a.model), fmt(a.serialNumber),
      fmt(a.assignedTo), fmt(a.assignedEcode),
      fmt(a.assignedEmail), fmt(a.department), fmt(a.status),
      a.assignedAt ? fmtDate(a.assignedAt) : "",
      fmtDate(a.warrantyEndDate),
    ]);
    addSheet(wb, "4 - Current Assignments", [assign4Header, ...assign4Rows],
      [14,10,12,18,18,22,12,28,18,12,14,14]);

    // ── Sheet 5: Assignment History ───────────────────────────────────────────
    const hist5Header = [
      "Asset ID","Asset Name/Model","Event Type",
      "User Name","User E-Code","User Email","Department",
      "Actioned By","Notes","Date",
    ];
    const hist5Rows: unknown[][] = history.length > 0
      ? history.map((h) => [
          fmt(h.asset_id), fmt(h.asset_name), fmt(h.event_type),
          fmt(h.user_name), fmt(h.user_ecode), fmt(h.user_email),
          fmt(h.department), fmt(h.event_by_name ?? "—"), fmt(h.notes),
          fmtDate(h.created_at),
        ])
      : [["No assignment history recorded yet. History is captured going forward from this export."]];
    addSheet(wb, "5 - Assignment History", [hist5Header, ...hist5Rows],
      [14,20,12,22,12,28,18,22,30,14]);

    // ── Sheet 6: Tickets Summary ──────────────────────────────────────────────
    const tickets6Header = [
      "Ticket ID","Category","Subcategory","Priority","Status",
      "Raised By","Employee Email","Asset ID","Assigned Agent",
      "Created Date","Updated Date","Description",
    ];
    const tickets6Rows: unknown[][] = tickets.map((t) => [
      fmt(t.ticketId), fmt(t.category), fmt(t.subcategory),
      fmt(t.priority), fmt(t.status),
      fmt(t.raisedBy), fmt(t.employeeEmail), fmt(t.assetId),
      fmt(t.assignedAgent),
      fmtDate(t.createdDate), fmtDate(t.updatedDate),
      fmt(t.description),
    ]);
    addSheet(wb, "6 - Tickets", [tickets6Header, ...tickets6Rows],
      [14,20,20,10,14,22,28,14,22,14,14,40]);

    // ── Sheet 7: Procurement & Warranty Details ───────────────────────────────
    const warranty7Header = [
      "Asset ID","Type","Brand","Model","Serial Number",
      "Purchase Date","Warranty End","Days Until Expiry","Warranty Status",
      "Vendor","Location","Asset Status",
    ];
    const warranty7Rows: unknown[][] = assets.map((a) => {
      const wEnd    = new Date(a.warrantyEndDate);
      const valid   = !isNaN(wEnd.getTime());
      const daysLeft = valid ? Math.ceil((wEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;
      const wStatus = daysLeft == null ? "Unknown" : daysLeft < 0 ? "Expired" : daysLeft <= 90 ? "Expiring Soon" : "Active";
      return [
        fmt(a.assetId), fmt(a.assetType), fmt(a.brand), fmt(a.model), fmt(a.serialNumber),
        fmtDate(a.purchaseDate), fmtDate(a.warrantyEndDate),
        daysLeft != null ? daysLeft : "",
        wStatus,
        fmt(a.vendor), fmt(a.location), fmt(a.status),
      ];
    }).sort((a, b) => {
      const o: Record<string, number> = { "Expired": 0, "Expiring Soon": 1, "Active": 2, "Unknown": 3 };
      return (o[String(a[8])] ?? 3) - (o[String(b[8])] ?? 3);
    });
    addSheet(wb, "7 - Warranty & Procurement", [warranty7Header, ...warranty7Rows],
      [14,10,12,18,18,14,14,18,16,16,16,12]);

    XLSX.writeFile(wb, `full_report_${dateStr}.xlsx`);
    toast({ title: "Full report exported", description: `full_report_${dateStr}.xlsx — 7 sheets downloaded` });
  } catch (err) {
    toast({
      title: "Export failed",
      description: err instanceof Error ? err.message : "Please try again.",
      variant: "destructive",
    });
  } finally {
    setExporting(false);
  }
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
  const { toast }         = useToast();
  const { assets }        = useAssets();
  const { tickets }       = useTickets();
  const { users }         = useUsers();
  const [exporting, setExporting] = useState(false);

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
            <DropdownMenuItem
              className="flex items-center gap-2 cursor-pointer font-medium"
              disabled={exporting}
              onClick={() => exportFullXlsx(assets, tickets, users, setExporting, toast)}
            >
              <FileText className="h-3.5 w-3.5 text-amber-500" />
              {exporting ? "Generating XLSX…" : "Export Full Summary (.xlsx)"}
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
