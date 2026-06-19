import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, CartesianGrid,
} from "recharts";
import {
  TrendingUp, Monitor, Ticket, Users, Download, FileText,
  PieChart as PieChartIcon,
  Package, Cpu, Wrench, Network, FileSpreadsheet,
  Activity, Sparkles, CheckCircle2, Clock,
  Boxes, Gauge, Building2, UserCheck, Layers, Zap, TrendingDown,
} from "lucide-react";
import { useAssets } from "@/context/AssetContext";
import LocationReportSection from "@/components/LocationReportSection";
import { useTickets } from "@/context/TicketContext";
import { useUsers } from "@/context/UsersContext";
import { ROLE_LABELS, Asset, Ticket as TicketType, Profile } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { ASSET_TYPE_CATEGORIES, getAssetEmoji } from "@/lib/assetEmoji";
import { managerDisplayName } from "@/lib/reportingManager";
import {
  KpiCard, ChartContainer, MetricTile, HealthBar, InsightCard,
  type TrendChip,
} from "@/components/reports/widgets";
import {
  assetGrowthSeries, userGrowthSeries, ticketTrendSeries, utilizationSeries,
  ticketMetrics, assetHealth, utilizationPct, assetTypeCounts, departmentUsage,
  latestDelta, SLA_TARGET_DAYS,
} from "@/lib/reportsAnalytics";

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

function exportAssetsCsv(assets: Asset[], filenameSuffix = "") {
  const header = [
    "Asset ID","Type","Brand","Model","Serial Number","Product No.",
    "Processor","RAM","Storage","Operating System",
    "IMEI 1","IMEI 2","SIM Number","Phone Number",
    "Status","Ownership","Assigned To","E-Code","Assigned Email","Department",
    "Location","Purchase Date","Warranty End","Vendor","Invoice",
    "Accessories","Remarks",
  ];
  const rows = assets.map((a) => [
    a.assetId, a.assetType, a.brand, a.model, a.serialNumber, a.productNumber ?? "",
    a.processor ?? "", a.ram ?? "", a.storage ?? "", a.operatingSystem ?? "",
    a.imeiNumber ?? "", a.imei2 ?? "", a.simNumber ?? "", a.phoneNumber ?? "",
    a.status, a.ownership ?? "Miles", a.assignedTo ?? "", a.assignedEcode ?? "", a.assignedEmail ?? "", a.department ?? "",
    a.location, a.purchaseDate, a.warrantyEndDate, a.vendor ?? "", a.invoice ?? "",
    a.accessories ?? "", a.remarks ?? "",
  ]);
  const csv = "\ufeff" + [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const slug = filenameSuffix ? `_${filenameSuffix.toLowerCase().replace(/\s+/g, "_")}` : "";
  downloadCsv(csv, `assets${slug}_report_${new Date().toISOString().split("T")[0]}.csv`);
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

// ── Reporting structure (employee → reporting manager) ──────────────────────
const REPORTING_HEADER = [
  "Employee", "Employee ID", "Reporting Manager", "Department", "Location", "Status",
];

const statusLabel = (s: Profile["status"]) => (s === "active" ? "Active" : "Inactive");

/** One row per employee, sorted by reporting manager then employee name. */
function reportingStructureRows(users: Profile[]): string[][] {
  return [...users]
    .sort((a, b) => {
      const ma = managerDisplayName(a.reporting_manager, users);
      const mb = managerDisplayName(b.reporting_manager, users);
      return ma.localeCompare(mb) || a.full_name.localeCompare(b.full_name);
    })
    .map((u) => [
      u.full_name,
      u.ecode || "",
      managerDisplayName(u.reporting_manager, users),
      u.department || "",
      u.location || "",
      statusLabel(u.status),
    ]);
}

function exportReportingStructureCsv(users: Profile[]) {
  const rows = reportingStructureRows(users);
  const csv = "\ufeff" + [REPORTING_HEADER, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadCsv(csv, `reporting_structure_${new Date().toISOString().split("T")[0]}.csv`);
}

async function exportReportingStructureXlsx(users: Profile[]) {
  const XLSX = await import("xlsx");
  const rows = reportingStructureRows(users);
  const ws = XLSX.utils.aoa_to_sheet([REPORTING_HEADER, ...rows]);
  ws["!cols"] = [
    { wch: 24 }, { wch: 14 }, { wch: 24 }, { wch: 20 }, { wch: 18 }, { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Reporting Structure");
  XLSX.writeFile(wb, `reporting_structure_${new Date().toISOString().split("T")[0]}.xlsx`);
}

async function exportReportingStructurePdf(users: Profile[]) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape" });
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  doc.setFontSize(16);
  doc.text("Reporting Structure", 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`Miles Education IT Asset Hub · Generated ${dateStr}`, 14, 22);
  doc.setTextColor(0);

  const body = reportingStructureRows(users);

  if (body.length === 0) {
    doc.setFontSize(11);
    doc.text("No employees have been added yet.", 14, 34);
  } else {
    autoTable(doc, {
      startY: 28,
      head: [REPORTING_HEADER],
      body,
      styles: { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: [99, 102, 241], textColor: 255 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
      alternateRowStyles: { fillColor: [245, 245, 250] },
    });
  }

  doc.save(`reporting_structure_${new Date().toISOString().split("T")[0]}.pdf`);
}

// ── Device Agents (managed devices reporting via the laptop agent) ──────────
type ManagedDevice = Record<string, unknown>;

async function fetchManagedDevices(): Promise<ManagedDevice[]> {
  const { data, error } = await supabase
    .from("managed_devices")
    .select("*")
    .order("last_seen_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ManagedDevice[];
}

const DEVICE_AGENT_HEADER = [
  "Asset ID","Hostname","Serial Number","Brand","Model","Processor","RAM","Storage",
  "Operating System","Logged-in User","Employee Email","E-Code",
  "IP Address","MAC Address","Agent Version","Managed","Status","Last Seen",
];

function deviceAgentRow(
  d: ManagedDevice,
  assetIdByUuid: Map<string, string>,
  fmtDate: (v: unknown) => string,
): unknown[] {
  const s = (v: unknown) => (v == null || v === "" ? "" : String(v));
  const os = [d.os_name, d.os_version].filter(Boolean).join(" ");
  return [
    assetIdByUuid.get(String(d.laptop_asset_id)) ?? "",
    s(d.hostname), s(d.serial_number), s(d.brand), s(d.model),
    s(d.processor), s(d.ram), s(d.storage), os,
    s(d.logged_in_username), s(d.employee_email), s(d.employee_ecode),
    s(d.ip_address), s(d.mac_address), s(d.agent_version),
    d.is_managed ? "Yes" : "No", s(d.status), fmtDate(d.last_seen_at),
  ];
}

async function exportDeviceAgentsCsv(
  assets: Asset[],
  toast: (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => void,
) {
  try {
    const devices = await fetchManagedDevices();
    if (devices.length === 0) {
      toast({ title: "No agent devices", description: "No managed devices have reported in yet.", variant: "destructive" });
      return;
    }
    const assetIdByUuid = new Map(assets.map((a) => [String(a.id), a.assetId]));
    const fmtDate = (v: unknown) => {
      if (!v) return "";
      const dt = new Date(String(v));
      return isNaN(dt.getTime()) ? String(v) : dt.toLocaleString("en-IN");
    };
    const rows = devices.map((d) => deviceAgentRow(d, assetIdByUuid, fmtDate));
    const csv = "\ufeff" + [DEVICE_AGENT_HEADER, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadCsv(csv, `device_agents_report_${new Date().toISOString().split("T")[0]}.csv`);
    toast({ title: "Device Agents exported", description: `${devices.length} managed device(s) downloaded` });
  } catch (err) {
    toast({ title: "Export failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
  }
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
      super_admin: "Super Admin", it_admin: "IT Admin", hr_admin: "HR Admin", it_agent: "IT Agent", end_user: "End User",
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
      ["HR Admin",    users.filter((u) => u.role === "hr_admin").length],
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
      "Purchase Date","Warranty End","Vendor","Invoice","Ownership",
      "Status","Location","Accessories","Remarks",
    ];
    const assetsRows: unknown[][] = assets.map((a) => [
      fmt(a.assetId), fmt(a.assetType), fmt(a.brand), fmt(a.model),
      fmt(a.serialNumber), fmt(a.productNumber),
      fmt(a.processor), fmt(a.ram),
      fmt(a.operatingSystem), fmt(a.storage),
      fmt(a.imeiNumber), fmt(a.imei2),
      fmtDate(a.purchaseDate), fmtDate(a.warrantyEndDate),
      fmt(a.vendor), fmt(a.invoice), fmt(a.ownership ?? "Miles"),
      fmt(a.status), fmt(a.location), fmt(a.accessories), fmt(a.remarks),
    ]);
    addSheet(wb, "2 - Assets Master", [assetsHeader, ...assetsRows],
      [14,10,12,18,18,14,16,8,14,10,16,16,14,14,16,14,16,14,16,20,30]);

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

    // ── Sheet 8: Device Agents (managed devices) ──────────────────────────────
    const devices = await fetchManagedDevices();
    const assetIdByUuid = new Map(assets.map((a) => [String(a.id), a.assetId]));
    const devices8Rows: unknown[][] = devices.length > 0
      ? devices.map((d) => deviceAgentRow(d, assetIdByUuid, (v) => {
          if (!v) return "";
          const dt = new Date(String(v));
          return isNaN(dt.getTime()) ? String(v) : dt.toLocaleString("en-IN");
        }))
      : [["No managed devices have reported in yet. Install the laptop agent to populate this report."]];
    addSheet(wb, "8 - Device Agents", [DEVICE_AGENT_HEADER, ...devices8Rows],
      [14,18,18,12,18,18,8,10,18,18,28,12,16,18,12,8,12,18]);

    XLSX.writeFile(wb, `full_report_${dateStr}.xlsx`);
    toast({ title: "Full report exported", description: `full_report_${dateStr}.xlsx — 8 sheets downloaded` });
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

  const handleExportAsync = async (fn: () => Promise<void>, label: string) => {
    try {
      await fn();
      toast({ title: `${label} exported`, description: "File downloaded to your device" });
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    }
  };

  // Category roll-up: Main Devices / Accessories / Fixed Assets (used by export menu)
  const assetsByCategory = ASSET_TYPE_CATEGORIES.map((cat) => ({
    name:  cat.label,
    types: cat.types as readonly string[],
    count: assets.filter((a) => cat.types.includes(a.assetType)).length,
  })).filter((d) => d.count > 0);

  const CATEGORY_COLORS: Record<string, string> = {
    "Main Devices": "#3b82f6",
    "Accessories":  "#a855f7",
    "Fixed Assets": "#f59e0b",
  };
  const assetsByStatus = [
    { name: "Available",    count: assets.filter((a) => a.status === "Available").length,    color: "#22c55e" },
    { name: "Assigned",     count: assets.filter((a) => a.status === "Assigned").length,     color: "#2563eb" },
    { name: "Under Repair", count: assets.filter((a) => a.status === "Under Repair").length, color: "#f59e0b" },
    { name: "Lost",         count: assets.filter((a) => a.status === "Lost").length,         color: "#ef4444" },
    { name: "Retired",      count: assets.filter((a) => a.status === "Retired").length,      color: "#6b7280" },
  ].filter((d) => d.count > 0);

  const usersByRole = [
    { name: "Super Admin", count: users.filter((u) => u.role === "super_admin").length },
    { name: "IT Admin",    count: users.filter((u) => u.role === "it_admin").length },
    { name: "HR Admin",    count: users.filter((u) => u.role === "hr_admin").length },
    { name: "IT Agent",    count: users.filter((u) => u.role === "it_agent").length },
    { name: "End User",    count: users.filter((u) => u.role === "end_user").length },
  ].filter((d) => d.count > 0);

  // ── Real analytics (time-series + derived metrics from live records) ────────
  const assetGrowth = assetGrowthSeries(assets, 12);
  const userGrowth  = userGrowthSeries(users, 12);
  const ticketTrend = ticketTrendSeries(tickets, 12);
  const utilTrend   = utilizationSeries(assets, 12);
  const tm          = ticketMetrics(tickets);
  const health      = assetHealth(assets);
  const utilization = utilizationPct(assets);
  const typeCounts  = assetTypeCounts(assets);
  const deptUsage   = departmentUsage(assets, 6);

  const activeUsers   = users.filter((u) => u.status === "active").length;
  const inactiveUsers = users.length - activeUsers;
  const openTickets   = tm.open + tm.assigned + tm.inProgress + tm.waiting;
  const resolvedTotal = tm.resolved + tm.closed;
  const resRate       = tickets.length > 0 ? `${Math.round((resolvedTotal / tickets.length) * 100)}%` : "—";

  const assetsAddedThisMonth = latestDelta(assetGrowth);
  const usersAddedThisMonth  = latestDelta(userGrowth);
  const activeUsersChip: TrendChip = {
    value: `${usersAddedThisMonth >= 0 ? "+" : ""}${usersAddedThisMonth} this mo`,
    direction: usersAddedThisMonth > 0 ? "up" : usersAddedThisMonth < 0 ? "down" : "flat",
  };
  const assetsChip: TrendChip = {
    value: `${assetsAddedThisMonth >= 0 ? "+" : ""}${assetsAddedThisMonth} this mo`,
    direction: assetsAddedThisMonth > 0 ? "up" : assetsAddedThisMonth < 0 ? "down" : "flat",
  };

  // Smart insights: most assigned vs least utilised asset types
  const mostAssets  = typeCounts.slice(0, 3).map((t) => ({ ...t, emoji: getAssetEmoji(t.type) }));
  const leastAssets = (typeCounts.length > 3 ? typeCounts.slice(-3).reverse() : [])
    .map((t) => ({ ...t, emoji: getAssetEmoji(t.type) }));
  const maxMost = Math.max(1, ...mostAssets.map((t) => t.count));

  // AI insights computed from real aggregates
  const aiInsights: { icon: React.ElementType; tone: "blue" | "green" | "amber" | "purple" | "red"; title: string; text: string }[] = [];
  if (health.total > 0) {
    aiInsights.push({
      icon: Gauge, tone: utilization >= 75 ? "green" : "blue",
      title: `${utilization}% of assets are assigned`,
      text: `${health.assigned} of ${health.total} assets are actively in use across the org.`,
    });
  }
  aiInsights.push(
    openTickets === 0
      ? { icon: CheckCircle2, tone: "green", title: "All tickets are resolved", text: "There are no open helpdesk tickets right now." }
      : { icon: Ticket, tone: openTickets > 10 ? "amber" : "blue", title: `${openTickets} ticket${openTickets === 1 ? "" : "s"} still open`, text: `${resolvedTotal} resolved out of ${tm.total} total raised.` },
  );
  if (assetsAddedThisMonth > 0) {
    aiInsights.push({
      icon: TrendingUp, tone: "green",
      title: `${assetsAddedThisMonth} new asset${assetsAddedThisMonth === 1 ? "" : "s"} this month`,
      text: `Inventory has grown to ${health.total} total assets.`,
    });
  }
  if (tm.slaCompliancePct !== null) {
    aiInsights.push({
      icon: CheckCircle2, tone: tm.slaCompliancePct >= 80 ? "green" : "amber",
      title: `${tm.slaCompliancePct}% SLA compliance`,
      text: `Share of tickets resolved within the ${SLA_TARGET_DAYS}-day target.`,
    });
  }
  if (deptUsage.length > 0) {
    aiInsights.push({
      icon: Building2, tone: "purple",
      title: `${deptUsage[0].name} leads asset usage`,
      text: `Holds ${deptUsage[0].count} assets — the most of any department.`,
    });
  }
  if (tm.avgResolutionDays !== null) {
    aiInsights.push({
      icon: Clock, tone: tm.avgResolutionDays <= SLA_TARGET_DAYS ? "green" : "amber",
      title: `${tm.avgResolutionDays.toFixed(1)} day avg resolution`,
      text: `Average time to resolve across ${resolvedTotal} closed ticket${resolvedTotal === 1 ? "" : "s"}.`,
    });
  }
  const insightsToShow = aiInsights.slice(0, 6);

  const ROLE_BAR_COLORS = ["#8B5CF6", "#2563EB", "#EC4899", "#06B6D4", "#22C55E"];
  const activeSplit = [
    { name: "Active",   count: activeUsers,   color: "#22C55E" },
    { name: "Inactive", count: inactiveUsers, color: "#EF4444" },
  ].filter((d) => d.count > 0);

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
          <DropdownMenuContent align="end" className="w-64 max-h-[70vh] overflow-y-auto">
            <DropdownMenuItem className="flex items-center gap-2 cursor-pointer" onClick={() => handleExport(() => exportAssetsCsv(assets), "Assets report")}>
              <Monitor className="h-3.5 w-3.5 text-blue-500" />Export All Assets
            </DropdownMenuItem>

            {/* By category */}
            {assetsByCategory.length > 0 && <DropdownMenuSeparator />}
            {assetsByCategory.map((cat) => {
              const Icon = cat.name === "Main Devices" ? Cpu : cat.name === "Accessories" ? Package : Wrench;
              return (
                <DropdownMenuItem
                  key={cat.name}
                  className="flex items-center gap-2 cursor-pointer text-xs"
                  onClick={() => handleExport(
                    () => exportAssetsCsv(assets.filter((a) => cat.types.includes(a.assetType)), cat.name),
                    `${cat.name} report`,
                  )}
                >
                  <Icon className="h-3.5 w-3.5" style={{ color: CATEGORY_COLORS[cat.name] }} />
                  Export {cat.name} <span className="ml-auto text-muted-foreground">{cat.count}</span>
                </DropdownMenuItem>
              );
            })}

            <DropdownMenuSeparator />
            <DropdownMenuItem className="flex items-center gap-2 cursor-pointer" onClick={() => handleExport(() => exportTicketsCsv(tickets), "Tickets report")}>
              <Ticket className="h-3.5 w-3.5 text-purple-500" />Export Tickets
            </DropdownMenuItem>
            <DropdownMenuItem className="flex items-center gap-2 cursor-pointer" onClick={() => handleExport(() => exportUsersCsv(users), "Users report")}>
              <Users className="h-3.5 w-3.5 text-emerald-500" />Export Users
            </DropdownMenuItem>
            <DropdownMenuItem className="flex items-center gap-2 cursor-pointer" onClick={() => handleExport(() => exportReportingStructureCsv(users), "Reporting structure")}>
              <Network className="h-3.5 w-3.5 text-pink-500" />Export Reporting Structure
            </DropdownMenuItem>
            <DropdownMenuItem className="flex items-center gap-2 cursor-pointer" onClick={() => exportDeviceAgentsCsv(assets, toast)}>
              <Cpu className="h-3.5 w-3.5 text-cyan-500" />Export Device Agents
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

      {/* ── Executive KPI cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={Boxes} label="Total Assets" value={health.total} accent="#2563EB"
          chip={assetsChip} spark={assetGrowth.map((p) => p.total)}
          footer={`Across ${assetsByCategory.length || 0} categor${assetsByCategory.length === 1 ? "y" : "ies"}`}
          data-testid="card-kpi-total-assets"
        />
        <KpiCard
          icon={UserCheck} label="Active Users" value={activeUsers} accent="#22C55E"
          chip={activeUsersChip} spark={userGrowth.map((p) => p.total)}
          footer={`${inactiveUsers} inactive · ${users.length} total`}
          data-testid="card-kpi-active-users"
        />
        <KpiCard
          icon={Ticket} label="Open Tickets" value={openTickets} accent="#F59E0B"
          spark={ticketTrend.map((p) => p.created)}
          footer={`${resolvedTotal} resolved · ${resRate} rate`}
          data-testid="card-kpi-open-tickets"
        />
        <KpiCard
          icon={Gauge} label="Asset Utilization" value={`${utilization}%`} accent="#8B5CF6"
          spark={utilTrend.map((p) => p.pct)}
          footer={`${health.assigned} of ${health.total} assigned`}
          data-testid="card-kpi-utilization"
        />
      </div>

      {/* ── Asset analytics: growth trend + distribution ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <ChartContainer
          className="lg:col-span-3" icon={TrendingUp} accent="#2563EB"
          title="Asset Growth Trend" subtitle="Cumulative inventory over the last 12 months"
          action={<ExportCardButton onClick={() => handleExport(() => exportAssetsCsv(assets), "Assets report")} label="assets" />}
        >
          {health.total === 0 ? (
            <EmptyChart icon={TrendingUp} message="No assets yet" sub="Asset growth will plot here once inventory is added" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={assetGrowth} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="assetGrowthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} width={36} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="total" name="Total Assets" stroke="#2563EB" strokeWidth={2.5} fill="url(#assetGrowthFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>

        <ChartContainer
          className="lg:col-span-2" icon={PieChartIcon} accent="#8B5CF6"
          title="Asset Distribution" subtitle="By current status"
        >
          {assetsByStatus.length === 0 ? (
            <EmptyChart icon={PieChartIcon} message="No assets yet" sub="Status breakdown will appear here" />
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={assetsByStatus} cx="50%" cy="50%" innerRadius={62} outerRadius={92} paddingAngle={3} dataKey="count">
                    {assetsByStatus.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: "12px", color: "hsl(var(--foreground))" }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center -mt-7">
                <span className="text-2xl font-bold text-foreground">{health.total}</span>
                <span className="text-xs text-muted-foreground">Total Assets</span>
              </div>
            </div>
          )}
        </ChartContainer>
      </div>

      {/* ── Location-wise asset report ───────────────────────────────────── */}
      <LocationReportSection />

      {/* ── Ticket performance metrics ───────────────────────────────────── */}
      <ChartContainer
        icon={Activity} accent="#F59E0B"
        title="Ticket Performance" subtitle="Live helpdesk health & SLA"
        action={<ExportCardButton onClick={() => handleExport(() => exportTicketsCsv(tickets), "Tickets report")} label="tickets" />}
      >
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <MetricTile icon={Ticket} label="Open" value={tm.open + tm.assigned} accent="#F59E0B" />
          <MetricTile icon={Activity} label="In Progress" value={tm.inProgress} accent="#2563EB" />
          <MetricTile icon={CheckCircle2} label="Resolved" value={tm.resolved} accent="#22C55E" />
          <MetricTile icon={Layers} label="Closed" value={tm.closed} accent="#6B7280" />
          <MetricTile
            icon={CheckCircle2} label="SLA Compliance"
            value={tm.slaCompliancePct !== null ? `${tm.slaCompliancePct}%` : "—"}
            accent="#8B5CF6" hint={`${SLA_TARGET_DAYS}-day target`}
          />
          <MetricTile
            icon={Clock} label="Avg Resolution"
            value={tm.avgResolutionDays !== null ? `${tm.avgResolutionDays.toFixed(1)}d` : "—"}
            accent="#EC4899" hint="time to close"
          />
        </div>
      </ChartContainer>

      {/* ── Asset health + smart insights ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartContainer icon={Gauge} accent="#22C55E" title="Asset Health" subtitle="Status distribution">
          {health.total === 0 ? (
            <EmptyChart icon={Gauge} message="No assets yet" sub="Health bars will appear here" />
          ) : (
            <div className="space-y-4 pt-1">
              <HealthBar label="Assigned"    value={health.assigned}    total={health.total} color="#2563EB" />
              <HealthBar label="Available"   value={health.available}   total={health.total} color="#22C55E" />
              <HealthBar label="Maintenance" value={health.maintenance} total={health.total} color="#F59E0B" />
              <HealthBar label="Retired"     value={health.retired}     total={health.total} color="#6B7280" />
            </div>
          )}
        </ChartContainer>

        <ChartContainer icon={Zap} accent="#2563EB" title="Most Assigned Assets" subtitle="Top asset types in use">
          {mostAssets.length === 0 ? (
            <EmptyChart icon={Zap} message="No assets yet" sub="Top types will appear here" />
          ) : (
            <div className="space-y-3.5 pt-1">
              {mostAssets.map((t) => (
                <div key={t.type}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="font-medium text-foreground truncate">{t.emoji} {t.type}</span>
                    <span className="font-semibold text-foreground">{t.count}</span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((t.count / maxMost) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </ChartContainer>

        <ChartContainer icon={TrendingDown} accent="#F59E0B" title="Least Utilized Assets" subtitle="Lowest-count asset types">
          {leastAssets.length === 0 ? (
            <EmptyChart icon={TrendingDown} message="Not enough variety yet" sub="Add more asset types to compare utilisation" />
          ) : (
            <div className="space-y-2.5 pt-1">
              {leastAssets.map((t) => (
                <div key={t.type} className="flex items-center justify-between rounded-xl border border-card-border/70 bg-card/60 px-3.5 py-2.5">
                  <span className="text-sm font-medium text-foreground truncate">{t.emoji} {t.type}</span>
                  <span className="text-xs font-semibold text-muted-foreground bg-muted rounded-full px-2.5 py-0.5">{t.count}</span>
                </div>
              ))}
            </div>
          )}
        </ChartContainer>
      </div>

      {/* ── User analytics ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartContainer
          icon={Users} accent="#8B5CF6" title="Users by Role" subtitle="Access distribution"
          action={<ExportCardButton onClick={() => handleExport(() => exportUsersCsv(users), "Users report")} label="users" />}
        >
          {usersByRole.length === 0 ? (
            <EmptyChart icon={Users} message="No users yet" sub="Roles will appear once users are added" />
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={usersByRole} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} name="Users">
                  {usersByRole.map((entry, i) => <Cell key={entry.name} fill={ROLE_BAR_COLORS[i % ROLE_BAR_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>

        <ChartContainer icon={Building2} accent="#2563EB" title="Department Usage" subtitle="Assets held per department">
          {deptUsage.length === 0 ? (
            <EmptyChart icon={Building2} message="No department data" sub="Assign assets to departments to compare" />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, deptUsage.length * 34)}>
              <BarChart data={deptUsage} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }} axisLine={false} tickLine={false} interval={0} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#2563EB" radius={[0, 6, 6, 0]} name="Assets" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>

        <ChartContainer icon={UserCheck} accent="#22C55E" title="Active vs Inactive" subtitle="User account status">
          {activeSplit.length === 0 ? (
            <EmptyChart icon={UserCheck} message="No users yet" sub="Account status will appear here" />
          ) : (
            <div className="relative">
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={activeSplit} cx="50%" cy="50%" innerRadius={58} outerRadius={86} paddingAngle={3} dataKey="count">
                    {activeSplit.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: "12px", color: "hsl(var(--foreground))" }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center -mt-7">
                <span className="text-2xl font-bold text-foreground">{users.length}</span>
                <span className="text-xs text-muted-foreground">Total Users</span>
              </div>
            </div>
          )}
        </ChartContainer>
      </div>

      {/* ── AI insights panel ────────────────────────────────────────────── */}
      <ChartContainer
        icon={Sparkles} accent="#8B5CF6"
        title="AI Insights" subtitle="Auto-generated from your live asset, ticket & user data"
      >
        {insightsToShow.length === 0 ? (
          <EmptyChart icon={Sparkles} message="No insights yet" sub="Insights appear as assets, tickets and users are added" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {insightsToShow.map((ins) => (
              <InsightCard key={ins.title} icon={ins.icon} tone={ins.tone} title={ins.title} text={ins.text} />
            ))}
          </div>
        )}
      </ChartContainer>
    </div>
  );
}
