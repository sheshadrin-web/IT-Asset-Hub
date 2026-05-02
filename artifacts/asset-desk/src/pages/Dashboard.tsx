import { Link } from "wouter";
import {
  Monitor,
  Ticket,
  CheckCircle,
  AlertTriangle,
  Wrench,
  Package,
  TrendingUp,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { mockAssets, mockTickets } from "@/data/mockData";
import { Badge } from "@/components/ui/badge";

const assetStatusData = [
  { name: "Available", value: 0, color: "#22c55e" },
  { name: "Assigned", value: 0, color: "#3b82f6" },
  { name: "Under Repair", value: 0, color: "#f59e0b" },
  { name: "Lost", value: 0, color: "#ef4444" },
  { name: "Retired", value: 0, color: "#6b7280" },
];

mockAssets.forEach((a) => {
  const entry = assetStatusData.find((e) => e.name === a.status);
  if (entry) entry.value++;
});

const ticketPriorityData = [
  { name: "Critical", value: 0, color: "#ef4444" },
  { name: "High", value: 0, color: "#f59e0b" },
  { name: "Medium", value: 0, color: "#3b82f6" },
  { name: "Low", value: 0, color: "#6b7280" },
];

mockTickets.forEach((t) => {
  const entry = ticketPriorityData.find((e) => e.name === t.priority);
  if (entry) entry.value++;
});

const ticketCategoryData = Object.entries(
  mockTickets.reduce<Record<string, number>>((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + 1;
    return acc;
  }, {})
).map(([name, count]) => ({ name: name.replace(" Issue", "").replace(" Request", " Req"), count }));

const statCards = [
  {
    label: "Total Assets",
    value: mockAssets.length,
    icon: Package,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    href: "/assets",
  },
  {
    label: "Assigned Assets",
    value: mockAssets.filter((a) => a.status === "Assigned").length,
    icon: Monitor,
    color: "text-indigo-500",
    bg: "bg-indigo-500/10",
    href: "/assets",
  },
  {
    label: "Available Assets",
    value: mockAssets.filter((a) => a.status === "Available").length,
    icon: CheckCircle,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    href: "/assets",
  },
  {
    label: "Under Repair",
    value: mockAssets.filter((a) => a.status === "Under Repair").length,
    icon: Wrench,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    href: "/assets",
  },
  {
    label: "Open Tickets",
    value: mockTickets.filter((t) => !["Resolved", "Closed", "Rejected"].includes(t.status)).length,
    icon: Ticket,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    href: "/tickets",
  },
  {
    label: "Critical Tickets",
    value: mockTickets.filter((t) => t.priority === "Critical" && !["Resolved", "Closed", "Rejected"].includes(t.status)).length,
    icon: AlertTriangle,
    color: "text-red-500",
    bg: "bg-red-500/10",
    href: "/tickets",
  },
  {
    label: "Resolved This Month",
    value: mockTickets.filter((t) => t.status === "Resolved").length,
    icon: TrendingUp,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    href: "/tickets",
  },
];

const recentTickets = [...mockTickets]
  .filter((t) => !["Resolved", "Closed"].includes(t.status))
  .slice(0, 5);

const priorityColors: Record<string, string> = {
  Critical: "bg-red-500/15 text-red-500 border-red-500/20",
  High: "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Medium: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Low: "bg-gray-500/15 text-gray-500 border-gray-500/20",
};

const statusColors: Record<string, string> = {
  Open: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Assigned: "bg-purple-500/15 text-purple-600 border-purple-500/20",
  "In Progress": "bg-amber-500/15 text-amber-600 border-amber-500/20",
  "Waiting for User": "bg-orange-500/15 text-orange-600 border-orange-500/20",
  Resolved: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Closed: "bg-gray-500/15 text-gray-500 border-gray-500/20",
  Rejected: "bg-red-500/15 text-red-500 border-red-500/20",
};

export default function Dashboard() {
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
              <Card
                className="cursor-pointer hover:shadow-md transition-shadow"
                data-testid={`card-stat-${card.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
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
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={assetStatusData.filter((d) => d.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {assetStatusData
                    .filter((d) => d.value > 0)
                    .map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => (
                    <span style={{ fontSize: "12px", color: "hsl(var(--foreground))" }}>{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Tickets by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={ticketCategoryData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Tickets" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Recent Tickets */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Active Tickets
          </CardTitle>
          <Link href="/tickets" className="text-xs text-primary hover:underline">
            View all
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Ticket ID</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Raised By</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Category</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Priority</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentTickets.map((ticket) => (
                  <tr key={ticket.ticketId} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/tickets/${ticket.ticketId}`} className="text-primary font-medium hover:underline">
                        {ticket.ticketId}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-foreground">{ticket.raisedBy}</td>
                    <td className="px-4 py-3 text-muted-foreground">{ticket.category}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${priorityColors[ticket.priority]}`}>
                        {ticket.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusColors[ticket.status]}`}>
                        {ticket.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{ticket.createdDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
