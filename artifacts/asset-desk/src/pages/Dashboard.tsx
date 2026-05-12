import { Link } from "wouter";
import {
  Monitor, Ticket, CheckCircle, AlertTriangle, Wrench, Package,
  TrendingUp, Clock, Plus, PieChart as PieChartIcon, BarChart2 as BarChartIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { useAuth } from "@/context/AuthContext";
import { useAssets } from "@/context/AssetContext";
import { useTickets } from "@/context/TicketContext";

const PRIORITY_COLORS: Record<string, string> = {
  Critical: "bg-red-500/15 text-red-500 border-red-500/20",
  High:     "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Medium:   "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Low:      "bg-gray-500/15 text-gray-500 border-gray-500/20",
};
const STATUS_COLORS: Record<string, string> = {
  Open:               "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Assigned:           "bg-purple-500/15 text-purple-600 border-purple-500/20",
  "In Progress":      "bg-amber-500/15 text-amber-600 border-amber-500/20",
  "Waiting for User": "bg-orange-500/15 text-orange-600 border-orange-500/20",
  Resolved:           "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Closed:             "bg-gray-500/15 text-gray-500 border-gray-500/20",
  Rejected:           "bg-red-500/15 text-red-500 border-red-500/20",
};

function EmptyChart({ icon: Icon, message, sub }: { icon: React.ElementType; message: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[220px] gap-2 text-center">
      <Icon className="h-10 w-10 text-muted-foreground/20" />
      <p className="text-sm text-muted-foreground">{message}</p>
      {sub && <p className="text-xs text-muted-foreground/60">{sub}</p>}
    </div>
  );
}

function EndUserDashboard({ userName }: { userName: string }) {
  const { assets }      = useAssets();
  const { tickets }     = useTickets();
  const { currentUser } = useAuth();

  const myTickets     = tickets.filter((t) => t.raisedBy === userName);
  const myAssets      = assets.filter((a) =>
    (a.assignedTo && a.assignedTo === userName) ||
    (a.assignedEmail && a.assignedEmail === currentUser?.email)
  );
  const openCount     = myTickets.filter((t) => !["Resolved", "Closed", "Rejected"].includes(t.status)).length;
  const resolvedCount = myTickets.filter((t) => ["Resolved", "Closed"].includes(t.status)).length;
  const recentTickets = [...myTickets].sort((a, b) => b.createdDate.localeCompare(a.createdDate)).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">My Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Welcome back, {userName.split(" ")[0]}</p>
        </div>
        <Link href="/tickets/new">
          <Button className="gap-2"><Plus className="h-4 w-4" />Raise a Ticket</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "My Tickets",  value: myTickets.length,  icon: Ticket,       color: "text-blue-500",    bg: "bg-blue-500/10",    href: "/tickets" },
          { label: "Open",        value: openCount,          icon: AlertTriangle, color: "text-amber-500",  bg: "bg-amber-500/10",   href: "/tickets" },
          { label: "Resolved",    value: resolvedCount,      icon: CheckCircle,  color: "text-emerald-500", bg: "bg-emerald-500/10", href: "/tickets" },
          { label: "My Assets",   value: myAssets.length,   icon: Monitor,      color: "text-indigo-500",  bg: "bg-indigo-500/10",  href: "/my-assets" },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.label} href={card.href}>
              <Card className="cursor-pointer hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className={`inline-flex rounded-lg p-2 ${card.bg} mb-3`}>
                    <Icon className={`h-4 w-4 ${card.color}`} />
                  </div>
                  <div className="text-2xl font-bold text-foreground">{card.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{card.label}</div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {myAssets.length > 0 && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Monitor className="h-4 w-4 text-muted-foreground" />My Assigned Assets
            </CardTitle>
            <Link href="/my-assets" className="text-xs text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Asset ID","Device","Status","Warranty"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {myAssets.map((a) => (
                    <tr key={a.assetId} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3 font-mono text-xs text-primary">{a.assetId}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{a.brand} {a.model}</div>
                        <div className="text-xs text-muted-foreground">{a.assetType}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium bg-blue-500/15 text-blue-600 border-blue-500/20">{a.status}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{a.warrantyEndDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />My Recent Tickets
          </CardTitle>
          <Link href="/tickets" className="text-xs text-primary hover:underline">View all</Link>
        </CardHeader>
        <CardContent className="p-0">
          {recentTickets.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Ticket className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No tickets yet.</p>
              <Link href="/tickets/new">
                <Button variant="outline" size="sm" className="mt-3 gap-2">
                  <Plus className="h-3.5 w-3.5" />Raise your first ticket
                </Button>
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Ticket ID","Category","Priority","Status","Date"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentTickets.map((t) => (
                    <tr key={t.ticketId} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <Link href={`/tickets/${t.ticketId}`} className="text-primary font-medium hover:underline">{t.ticketId}</Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{t.category}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[t.status]}`}>{t.status}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{t.createdDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Dashboard() {
  const { currentUser }  = useAuth();
  const { assets }       = useAssets();
  const { tickets }      = useTickets();

  if (currentUser?.role === "end_user") {
    return <EndUserDashboard userName={currentUser.name} />;
  }

  // ── Derived stats ──────────────────────────────────────────────────────────
  const assetStatusData = [
    { name: "In Procurement", value: assets.filter((a) => a.status === "In Procurement").length, color: "#f97316" },
    { name: "Available",      value: assets.filter((a) => a.status === "Available").length,      color: "#22c55e" },
    { name: "Assigned",       value: assets.filter((a) => a.status === "Assigned").length,       color: "#3b82f6" },
    { name: "Under Repair",   value: assets.filter((a) => a.status === "Under Repair").length,   color: "#f59e0b" },
    { name: "Lost",           value: assets.filter((a) => a.status === "Lost").length,           color: "#ef4444" },
    { name: "Retired",        value: assets.filter((a) => a.status === "Retired").length,        color: "#6b7280" },
  ];
  const assetChartData = assetStatusData.filter((d) => d.value > 0);

  const ticketCategoryMap = tickets.reduce<Record<string, number>>((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + 1;
    return acc;
  }, {});
  const ticketCategoryData = Object.entries(ticketCategoryMap).map(([name, count]) => ({
    name: name.replace(" Issue", "").replace(" Request", " Req"),
    count,
  }));

  const recentTickets = [...tickets]
    .filter((t) => !["Resolved", "Closed"].includes(t.status))
    .slice(0, 5);

  const statCards = [
    { label: "Total Assets",        value: assets.length,                                                                                             icon: Package,       color: "text-blue-500",    bg: "bg-blue-500/10",    href: "/assets" },
    { label: "Assigned Assets",     value: assets.filter((a) => a.status === "Assigned").length,                                                      icon: Monitor,       color: "text-indigo-500",  bg: "bg-indigo-500/10",  href: "/assets" },
    { label: "Available Assets",    value: assets.filter((a) => a.status === "Available").length,                                                     icon: CheckCircle,   color: "text-emerald-500", bg: "bg-emerald-500/10", href: "/assets" },
    { label: "Under Repair",        value: assets.filter((a) => a.status === "Under Repair").length,                                                  icon: Wrench,        color: "text-amber-500",   bg: "bg-amber-500/10",   href: "/assets" },
    { label: "Open Tickets",        value: tickets.filter((t) => !["Resolved", "Closed", "Rejected"].includes(t.status)).length,                      icon: Ticket,        color: "text-blue-500",    bg: "bg-blue-500/10",    href: "/tickets" },
    { label: "Critical Tickets",    value: tickets.filter((t) => t.priority === "Critical" && !["Resolved", "Closed", "Rejected"].includes(t.status)).length, icon: AlertTriangle, color: "text-red-500",     bg: "bg-red-500/10",     href: "/tickets" },
    { label: "Resolved This Month", value: tickets.filter((t) => t.status === "Resolved").length,                                                     icon: TrendingUp,    color: "text-emerald-500", bg: "bg-emerald-500/10", href: "/tickets" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">IT Asset Management Overview</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.label} href={card.href}>
              <Card className="cursor-pointer hover:shadow-md transition-shadow" data-testid={`card-stat-${card.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <CardContent className="p-4">
                  <div className={`inline-flex rounded-lg p-2 ${card.bg} mb-3`}>
                    <Icon className={`h-4 w-4 ${card.color}`} />
                  </div>
                  <div className="text-2xl font-bold text-foreground">{card.value}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{card.label}</div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Asset Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {assetChartData.length === 0 ? (
              <EmptyChart icon={PieChartIcon} message="No assets added yet" sub="Assets will appear here once added" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={assetChartData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                    {assetChartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
                  <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ fontSize: "12px", color: "hsl(var(--foreground))" }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Tickets by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {ticketCategoryData.length === 0 ? (
              <EmptyChart icon={BarChartIcon} message="No tickets raised yet" sub="Ticket categories will appear here once tickets are created" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ticketCategoryData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Tickets" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Tickets Table */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />Active Tickets
          </CardTitle>
          <Link href="/tickets" className="text-xs text-primary hover:underline">View all</Link>
        </CardHeader>
        <CardContent className="p-0">
          {recentTickets.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Clock className="h-8 w-8 mx-auto text-muted-foreground/25 mb-3" />
              <p className="text-sm text-muted-foreground">No active tickets.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Open and in-progress tickets raised by users will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Ticket ID","Raised By","Category","Priority","Status","Date"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentTickets.map((ticket) => (
                    <tr key={ticket.ticketId} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/tickets/${ticket.ticketId}`} className="text-primary font-medium hover:underline">{ticket.ticketId}</Link>
                      </td>
                      <td className="px-4 py-3 text-foreground">{ticket.raisedBy}</td>
                      <td className="px-4 py-3 text-muted-foreground">{ticket.category}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[ticket.priority]}`}>{ticket.priority}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[ticket.status]}`}>{ticket.status}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{ticket.createdDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
