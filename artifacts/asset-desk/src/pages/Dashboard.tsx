import { useState } from "react";
import { Link } from "wouter";
import {
  Monitor, Ticket, CheckCircle, AlertTriangle, Package,
  Clock, Plus, ArrowRight, MapPin, Search, Bell,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useAssets } from "@/context/AssetContext";
import { useTickets } from "@/context/TicketContext";
import { useUsers } from "@/context/UsersContext";
import { getAssetEmoji, ASSET_TYPE_CATEGORIES } from "@/lib/assetEmoji";
import AssetsInRecovery from "@/components/dashboard/AssetsInRecovery";
import DevicesPendingRestart from "@/components/dashboard/DevicesPendingRestart";
import { useManagedDevices } from "@/hooks/useManagedDevices";
import { computeRestartPending, RESTART_PENDING_DEFAULT_DAYS } from "@/lib/restartPending";
import { useDashboardFeeds } from "@/hooks/useDashboardFeeds";
import AdminKpiRow from "@/components/dashboard/AdminKpiRow";
import AssetsByLocationBars from "@/components/dashboard/AssetsByLocationBars";
import AssetHealthOverview from "@/components/dashboard/AssetHealthOverview";
import PendingActionsPanel from "@/components/dashboard/PendingActionsPanel";
import RecentActivitiesPanel from "@/components/dashboard/RecentActivitiesPanel";
import AlertCards from "@/components/dashboard/AlertCards";
import TopLocationsAvailability from "@/components/dashboard/TopLocationsAvailability";
import AssetsByTypeDonut from "@/components/dashboard/AssetsByTypeDonut";
import WarrantyPanel from "@/components/dashboard/WarrantyPanel";
import QuickActions from "@/components/dashboard/QuickActions";
import ShortageRequestsTable from "@/components/dashboard/ShortageRequestsTable";

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

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function StatCard({
  label, value, icon: Icon, color, bg, border, href,
}: {
  label: string; value: number; icon: React.ElementType;
  color: string; bg: string; border: string; href: string;
}) {
  return (
    <Link href={href}>
      <Card className="cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden group">
        <div className={`h-0.5 ${border} w-full`} />
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className={`inline-flex rounded-xl p-2.5 ${bg}`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
          </div>
          <div className={`text-2xl font-bold text-foreground`}>{value}</div>
          <div className="text-xs text-muted-foreground mt-0.5 leading-tight font-medium">{label}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

function EndUserDashboard({ userName }: { userName: string }) {
  const { assets }      = useAssets();
  const { tickets }     = useTickets();
  const { currentUser } = useAuth();

  const myTickets     = tickets.filter((t) =>
    (currentUser?.email && t.employeeEmail === currentUser.email) ||
    t.raisedBy === userName
  );
  const myAssets      = assets.filter((a) =>
    (a.assignedTo && a.assignedTo === userName) ||
    (a.assignedEmail && a.assignedEmail === currentUser?.email)
  );
  const openCount     = myTickets.filter((t) => !["Resolved", "Closed", "Rejected"].includes(t.status)).length;
  const resolvedCount = myTickets.filter((t) => ["Resolved", "Closed"].includes(t.status)).length;
  const recentTickets = [...myTickets].sort((a, b) => b.createdDate.localeCompare(a.createdDate)).slice(0, 5);

  const myTypeCounts = myAssets.reduce<Record<string, number>>((acc, a) => {
    const t = a.assetType || "Generic Asset";
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const myTypeGroups = ASSET_TYPE_CATEGORIES
    .map(cat => ({
      label: cat.label,
      items: cat.types
        .map(t => ({ type: t, count: myTypeCounts[t] || 0 }))
        .filter(i => i.count > 0),
    }))
    .filter(g => g.items.length > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs text-muted-foreground font-medium">{todayLabel()}</p>
          <h1 className="text-xl font-bold text-foreground mt-0.5">{greeting()}, {userName.split(" ")[0]} 👋</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Here's your helpdesk overview</p>
        </div>
        <Link href="/tickets/new">
          <Button className="gap-2 shadow-sm"><Plus className="h-4 w-4" />Raise a Ticket</Button>
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "My Tickets",  value: myTickets.length,  icon: Ticket,       color: "text-blue-600",    bg: "bg-blue-50",    border: "bg-blue-500",    href: "/tickets" },
          { label: "Open",        value: openCount,          icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50",   border: "bg-amber-500",   href: "/tickets" },
          { label: "Resolved",    value: resolvedCount,      icon: CheckCircle,  color: "text-emerald-600", bg: "bg-emerald-50", border: "bg-emerald-500", href: "/tickets" },
          { label: "My Assets",   value: myAssets.length,   icon: Monitor,      color: "text-indigo-600",  bg: "bg-indigo-50",  border: "bg-indigo-500",  href: "/my-assets" },
        ].map((c) => <StatCard key={c.label} {...c} />)}
      </div>

      {/* Location GM: quick access to the Location-wise Assets module */}
      {currentUser?.role === "location_gm" && (
        <Link href="/locations">
          <Card className="cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 border-primary/30 bg-primary/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="inline-flex rounded-xl p-2.5 bg-primary/10">
                <MapPin className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Location-wise Assets</p>
                <p className="text-xs text-muted-foreground">View and manage assets across your assigned locations</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* My assets by type */}
      {myTypeGroups.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              My Assets by Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              {myTypeGroups.map(group => (
                <div key={group.label}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{group.label}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
                    {group.items.map(item => (
                      <div
                        key={item.type}
                        className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
                        data-testid={`my-asset-type-count-${item.type}`}
                      >
                        <span className="text-xl leading-none">{getAssetEmoji(item.type)}</span>
                        <div className="min-w-0">
                          <p className="text-lg font-bold text-foreground leading-tight">{item.count}</p>
                          <p className="text-xs text-muted-foreground truncate">{item.type}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assigned Assets */}
      {myAssets.length > 0 && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Monitor className="h-4 w-4 text-muted-foreground" />My Assigned Assets
            </CardTitle>
            <Link href="/my-assets" className="text-xs text-primary hover:underline font-medium">View all →</Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Asset ID","Device","Status","Warranty"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {myAssets.map((a) => (
                    <tr key={a.assetId} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-primary font-semibold">{a.assetId}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{a.brand} {a.model}</div>
                        <div className="text-xs text-muted-foreground">{a.assetType}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-blue-500/15 text-blue-600 border-blue-500/20">{a.status}</span>
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

      {/* Recent Tickets */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />My Recent Tickets
          </CardTitle>
          <Link href="/tickets" className="text-xs text-primary hover:underline font-medium">View all →</Link>
        </CardHeader>
        <CardContent className="p-0">
          {recentTickets.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Ticket className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No tickets yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Ticket ID","Category","Priority","Status","Date"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentTickets.map((t) => (
                    <tr key={t.ticketId} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/tickets/${t.ticketId}`} className="text-primary font-semibold hover:underline">{t.ticketId}</Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{t.category}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[t.status]}`}>{t.status}</span>
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
  const { users }        = useUsers();

  const isAdminView = currentUser?.role !== "end_user" && currentUser?.role !== "location_gm";
  const feeds = useDashboardFeeds(isAdminView);
  const [restartThresholdDays, setRestartThresholdDays] = useState(RESTART_PENDING_DEFAULT_DAYS);
  const {
    devices: managedDevices,
    loading: devicesLoading,
    error:   devicesError,
    refresh: refreshDevices,
  } = useManagedDevices(isAdminView);
  const restartPending = computeRestartPending(managedDevices, assets, users, restartThresholdDays);

  if (currentUser?.role === "end_user" || currentUser?.role === "location_gm") {
    return <EndUserDashboard userName={currentUser.name} />;
  }

  const openTickets      = tickets.filter((t) => !["Resolved", "Closed", "Rejected"].includes(t.status)).length;
  const underRepair      = assets.filter((a) => a.status === "Under Repair").length;
  const pendingAck       = assets.filter((a) => a.status === "Assigned" && !a.acknowledged).length;
  const shortagesPending = feeds.shortages.filter((s) => s.status === "Pending").length;
  const returnsActive    = feeds.returns.filter((r) => !/completed|closed|rejected|cancelled/i.test(r.status)).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs text-muted-foreground font-medium">{todayLabel()}</p>
          <h1 className="text-xl font-bold text-foreground mt-0.5">{greeting()}, {currentUser?.name.split(" ")[0]} 👋</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Here's your IT asset management overview</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search assets, users…"
              className="h-9 w-60 rounded-xl border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition"
            />
          </div>
          <Link
            href="/tickets"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card hover:bg-muted transition"
            aria-label="Open tickets"
          >
            <Bell className="h-4 w-4 text-muted-foreground" />
            {openTickets > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {openTickets > 99 ? "99+" : openTickets}
              </span>
            )}
          </Link>
        </div>
      </div>

      {feeds.error && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Some dashboard data could not be loaded. Showing what's available.
        </div>
      )}

      {/* KPI row */}
      <AdminKpiRow assets={assets} openTickets={openTickets} />

      {/* Location / Health / Pending actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <AssetsByLocationBars assets={assets} />
        <AssetHealthOverview assets={assets} />
        <PendingActionsPanel
          shortagesPending={shortagesPending}
          underRepair={underRepair}
          returnsActive={returnsActive}
          pendingAck={pendingAck}
          loading={feeds.loading}
        />
      </div>

      {/* Alert cards */}
      <AlertCards assets={assets} shortages={feeds.shortages} />

      {/* Recent activity / Top locations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <RecentActivitiesPanel audits={feeds.audits} loading={feeds.loading} />
        <TopLocationsAvailability assets={assets} />
      </div>

      {/* Assets by type / Warranty / Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <AssetsByTypeDonut assets={assets} />
        <WarrantyPanel assets={assets} />
        <QuickActions />
      </div>

      {/* Recent shortage requests */}
      <ShortageRequestsTable shortages={feeds.shortages} users={users} loading={feeds.loading} />

      {/* Pending acknowledgement alert */}
      {pendingAck > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
          <Clock className="h-4 w-4 text-orange-500 flex-shrink-0" />
          <p className="text-sm text-orange-700">
            <strong>{pendingAck} asset{pendingAck > 1 ? "s" : ""}</strong> {pendingAck > 1 ? "are" : "is"} awaiting acknowledgement from assigned users.
          </p>
          <Link href="/assets" className="ml-auto text-xs font-semibold text-orange-600 hover:underline whitespace-nowrap">View assets →</Link>
        </div>
      )}

      {/* Devices pending restart */}
      <DevicesPendingRestart
        devices={restartPending}
        loading={devicesLoading}
        error={devicesError}
        refresh={refreshDevices}
        thresholdDays={restartThresholdDays}
        onThresholdChange={setRestartThresholdDays}
      />

      {/* Assets in recovery */}
      <AssetsInRecovery />
    </div>
  );
}
