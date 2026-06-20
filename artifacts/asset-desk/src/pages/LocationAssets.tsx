import { useState, useEffect, useMemo, useCallback } from "react";
import {
  MapPin, ArrowLeft, Package, CheckCircle2, Wrench, AlertTriangle,
  RotateCcw, ShieldAlert, Plus, Search, RefreshCw, Download,
  Eye, Building2, Truck, Bell, TrendingUp, LayoutGrid, Table2,
  ArrowUpDown, ArrowUp, ArrowDown, Users as UsersIcon,
  ChevronUp, ChevronDown, ChevronsUpDown, X,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { isOnline, isManaged, type DeviceLike } from "@/lib/deviceHealth";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip, Legend,
} from "recharts";
import { useAuth } from "@/context/AuthContext";
import { useAssets } from "@/context/AssetContext";
import { useUsers } from "@/context/UsersContext";
import { cn } from "@/lib/utils";
import TablePagination from "@/components/TablePagination";
import AssetFormModal from "@/components/AssetFormModal";
import { Asset, ASSET_CONDITION_OPTIONS, AssetCondition } from "@/data/mockData";
import { LOCATION_OPTIONS } from "@/lib/locationOptions";
import { responsibleFor } from "@/lib/locationResponsibles";
import { exportCsv } from "@/lib/exportCsv";
import {
  canViewAllLocations, canApproveRequests, canRaiseRequestsForLocation,
  visibleLocations,
} from "@/lib/locationPermissions";
import {
  fetchMyLocationAccess, fetchAllLocationAccess, UserLocationAccess,
} from "@/lib/locationAccess";
import {
  fetchShortageRequests, createShortageRequest, updateShortageStatus,
  ShortageRequest, ShortageStatus, SHORTAGE_PRIORITIES, SHORTAGE_STATUSES, ShortagePriority,
} from "@/lib/shortageRequests";
import {
  fetchReturnRequests, createReturnRequest, updateReturnRequest,
  ReturnRequest, ReturnStatus, RETURN_TYPES, RETURN_STATUSES, ReturnType,
} from "@/lib/returnRequests";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

const UNASSIGNED = "Unassigned";

function fmtDate(s?: string): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function assetsInLocation(assets: Asset[], loc: string): Asset[] {
  if (loc === UNASSIGNED) return assets.filter(a => !a.location);
  return assets.filter(a => a.location === loc);
}

interface LocationMetrics {
  total: number; assigned: number; available: number; underRepair: number;
  damaged: number; recoveryPending: number; shortageOpen: number; returnPending: number;
}

function computeMetrics(
  list: Asset[], loc: string, shortages: ShortageRequest[], returns: ReturnRequest[],
): LocationMetrics {
  const openShortageStatuses: ShortageStatus[] = ["Pending", "Approved", "Partially Approved"];
  return {
    total:           list.length,
    assigned:        list.filter(a => a.status === "Assigned").length,
    available:       list.filter(a => a.status === "Available").length,
    underRepair:     list.filter(a => a.status === "Under Repair" || a.condition === "Under Repair").length,
    damaged:         list.filter(a => a.condition === "Damaged").length,
    recoveryPending: list.filter(a => a.status === "Recovery Stage" || a.condition === "Recovery Pending").length,
    shortageOpen:    shortages.filter(s => s.location === loc && openShortageStatuses.includes(s.status)).length,
    returnPending:   returns.filter(r => r.location === loc && r.status !== "Closed").length,
  };
}

// Conditions a location_gm (local custodian) may set. Disposal / recovery
// states (Scrapped, Lost, Returned, Recovery Pending) stay with Bangalore IT.
const CUSTODIAN_CONDITION_OPTIONS: AssetCondition[] = ["Good", "Needs Inspection", "Under Repair", "Damaged"];

const conditionTone: Record<string, string> = {
  "Good":             "bg-green-100 text-green-700",
  "Needs Inspection": "bg-amber-100 text-amber-700",
  "Under Repair":     "bg-orange-100 text-orange-700",
  "Damaged":          "bg-red-100 text-red-700",
  "Lost":             "bg-red-100 text-red-700",
  "Scrapped":         "bg-zinc-200 text-zinc-700",
  "Returned":         "bg-blue-100 text-blue-700",
  "Recovery Pending": "bg-purple-100 text-purple-700",
};

export default function LocationAssets() {
  const { currentUser } = useAuth();
  const { assets, updateAssetCondition, addAsset, refresh: refreshAssets } = useAssets();
  const { users } = useUsers();
  const { toast } = useToast();

  const [access,    setAccess]    = useState<UserLocationAccess[]>([]);
  const [shortages, setShortages] = useState<ShortageRequest[]>([]);
  const [returns,   setReturns]   = useState<ReturnRequest[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState<string | null>(null);
  const [search,    setSearch]    = useState("");
  const [tab,       setTab]       = useState("locations");
  const [shortageOpen, setShortageOpen] = useState(false);
  const [returnOpen,   setReturnOpen]   = useState(false);

  const isAdmin = canViewAllLocations(currentUser);
  const canApprove = canApproveRequests(currentUser);
  const isGm = currentUser?.role === "location_gm";

  const loadRequests = useCallback(async () => {
    const [s, r] = await Promise.all([fetchShortageRequests(), fetchReturnRequests()]);
    setShortages(s);
    setReturns(r);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const acc = isAdmin ? await fetchAllLocationAccess() : await fetchMyLocationAccess();
        if (!cancelled) setAccess(acc);
        await loadRequests();
      } catch (e) {
        if (!cancelled) toast({ title: "Failed to load location data", description: (e as Error).message, variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Locations the current user may see, plus an Unassigned bucket for admins.
  const myAccess = useMemo(
    () => (isAdmin ? access : access.filter(a => a.userId === currentUser?.userId)),
    [access, isAdmin, currentUser],
  );
  const locations = useMemo(() => {
    const base = visibleLocations(currentUser, LOCATION_OPTIONS, myAccess);
    const ordered = (LOCATION_OPTIONS as readonly string[]).filter(l => base.includes(l));
    if (isAdmin && assets.some(a => !a.location)) ordered.push(UNASSIGNED);
    return ordered;
  }, [currentUser, myAccess, isAdmin, assets]);

  const userName = useCallback((id: string): string => {
    if (id && id === currentUser?.userId) return currentUser?.name ?? "You";
    const u = users.find(x => x.id === id);
    return u?.full_name ?? "—";
  }, [users, currentUser]);

  const canEditCondition = useCallback((loc: string): boolean => {
    if (canApprove) return true;
    return myAccess.some(a => a.location === loc && a.canViewAssets);
  }, [canApprove, myAccess]);

  const handleCondition = async (asset: Asset, condition: AssetCondition) => {
    try {
      await updateAssetCondition(asset.assetId, condition);
      toast({ title: "Condition updated", description: `${asset.assetId} → ${condition}` });
    } catch (e) {
      toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading location data…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MapPin className="h-6 w-6 text-primary" /> Location-wise Assets
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Real-time overview of asset distribution, availability, and requests across all Miles locations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected === null && tab === "locations" && (
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search locations or managers…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-search-locations"
              />
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => { refreshAssets(); loadRequests(); toast({ title: "Refreshed" }); }} data-testid="button-refresh-locations">
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="locations" data-testid="tab-locations">Locations</TabsTrigger>
          <TabsTrigger value="requests" data-testid="tab-requests">
            Requests
            {(shortages.length + returns.length) > 0 && (
              <Badge variant="secondary" className="ml-2">{shortages.length + returns.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Locations ─────────────────────────────────────────────────────── */}
        <TabsContent value="locations" className="mt-4">
          {selected === null ? (
            <LocationBoard
              locations={locations}
              assets={assets}
              shortages={shortages}
              returns={returns}
              search={search}
              onSelect={(loc) => { setSelected(loc); setSearch(""); }}
              onViewRequests={() => setTab("requests")}
            />
          ) : (
            <LocationDetail
              location={selected}
              assets={assetsInLocation(assets, selected)}
              metrics={computeMetrics(assetsInLocation(assets, selected), selected, shortages, returns)}
              search={search}
              setSearch={setSearch}
              onBack={() => { setSelected(null); setSearch(""); }}
              canEditCondition={canEditCondition(selected)}
              editableConditions={isGm ? CUSTODIAN_CONDITION_OPTIONS : ASSET_CONDITION_OPTIONS}
              canRaise={canRaiseRequestsForLocation(currentUser, selected, myAccess)}
              canAddAsset={isAdmin}
              existingAssetIds={assets.map(a => a.assetId)}
              onAddAsset={async (data) => { await addAsset(data); await refreshAssets(); }}
              onCondition={handleCondition}
              onReportShortage={() => setShortageOpen(true)}
              onRaiseReturn={() => setReturnOpen(true)}
              userName={userName}
            />
          )}
        </TabsContent>

        {/* ── Requests ──────────────────────────────────────────────────────── */}
        <TabsContent value="requests" className="mt-4 space-y-8">
          <ShortageTable
            rows={shortages.filter(s => locations.includes(s.location))}
            canApprove={canApprove}
            userName={userName}
            onStatus={async (id, status) => {
              try { await updateShortageStatus(id, status); await loadRequests(); toast({ title: "Shortage request updated" }); }
              catch (e) { toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" }); }
            }}
          />
          <ReturnTable
            rows={returns.filter(r => locations.includes(r.location))}
            assets={assets}
            canApprove={canApprove}
            isGm={isGm}
            myAccess={myAccess}
            userName={userName}
            onStatus={async (id, patch) => {
              try { await updateReturnRequest(id, patch); await loadRequests(); toast({ title: "Return request updated" }); }
              catch (e) { toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" }); }
            }}
          />
        </TabsContent>
      </Tabs>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {selected && (
        <>
          <ShortageDialog
            open={shortageOpen}
            onOpenChange={setShortageOpen}
            location={selected}
            assetTypes={Array.from(new Set(assets.map(a => a.assetType))).sort()}
            onSubmit={async (input) => {
              await createShortageRequest(input);
              await loadRequests();
              setShortageOpen(false);
              toast({ title: "Shortage request raised", description: `${input.assetType} × ${input.quantityRequested} at ${input.location}` });
            }}
          />
          <ReturnDialog
            open={returnOpen}
            onOpenChange={setReturnOpen}
            location={selected}
            assets={assetsInLocation(assets, selected)}
            onSubmit={async (input) => {
              await createReturnRequest(input);
              await loadRequests();
              setReturnOpen(false);
              toast({ title: "Return request raised", description: `${input.returnType} at ${input.location}` });
            }}
          />
        </>
      )}
    </div>
  );
}

// ─── Location grid ──────────────────────────────────────────────────────────
function LocationGrid({ locations, assets, shortages, returns, onSelect }: {
  locations: string[]; assets: Asset[]; shortages: ShortageRequest[]; returns: ReturnRequest[];
  onSelect: (loc: string) => void;
}) {
  if (locations.length === 0) {
    return (
      <Card><CardContent className="py-16 text-center text-muted-foreground">
        No locations are assigned to your account yet. Contact a Super Admin to map your locations.
      </CardContent></Card>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {locations.map(loc => {
        const m = computeMetrics(assetsInLocation(assets, loc), loc, shortages, returns);
        const alerts = m.shortageOpen + m.returnPending + m.damaged + m.recoveryPending;
        return (
          <button key={loc} onClick={() => onSelect(loc)} data-testid={`card-location-${loc}`}
            className="text-left rounded-xl border border-card-border bg-card p-5 hover:shadow-lg hover:border-primary/40 transition-all">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <MapPin className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{loc}</p>
                  <p className="text-xs text-muted-foreground truncate">{responsibleFor(loc)}</p>
                </div>
              </div>
              {alerts > 0 && <Badge variant="destructive">{alerts}</Badge>}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Metric label="Total" value={m.total} />
              <Metric label="Assigned" value={m.assigned} />
              <Metric label="Available" value={m.available} />
              <Metric label="Repair" value={m.underRepair} tone="text-orange-600" />
              <Metric label="Shortage" value={m.shortageOpen} tone="text-amber-600" />
              <Metric label="Returns" value={m.returnPending} tone="text-blue-600" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 py-2">
      <p className={`text-lg font-bold ${tone ?? "text-foreground"}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Location board (overview) ──────────────────────────────────────────────
type LocStatus = "Healthy" | "Low Stock" | "Critical";

function locationStatus(m: LocationMetrics): LocStatus {
  if (m.total > 0 && (m.available === 0 || m.shortageOpen >= 3)) return "Critical";
  const availPct = m.total > 0 ? (m.available / m.total) * 100 : 0;
  if (availPct < 10 || m.shortageOpen > 0) return "Low Stock";
  return "Healthy";
}

type BoardSortKey =
  | "location" | "gm" | "total" | "assigned" | "available"
  | "underRepair" | "shortageOpen" | "returnPending" | "status";

function StatusBadge({ status }: { status: LocStatus }) {
  const tone =
    status === "Healthy"   ? "bg-green-100 text-green-700"  :
    status === "Low Stock" ? "bg-orange-100 text-orange-700" :
                             "bg-red-100 text-red-700";
  return <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-medium", tone)} data-testid={`status-${status}`}>{status}</span>;
}

function KpiCard({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4" data-testid={`kpi-${label}`}>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <p className={cn("text-2xl font-bold mt-2", tone ?? "text-foreground")}>{value}</p>
    </div>
  );
}

function WidgetCard({ icon: Icon, label, value, onClick }: { icon: React.ElementType; label: string; value: number; onClick?: () => void }) {
  const Comp: React.ElementType = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-xl border border-card-border bg-card p-4 flex items-center gap-3",
        onClick && "hover:shadow-md hover:border-primary/40 transition-all",
      )}
      data-testid={`widget-${label}`}
    >
      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1 truncate">{label}</p>
      </div>
    </Comp>
  );
}

function LocationBoard({ locations, assets, shortages, returns, search, onSelect, onViewRequests }: {
  locations: string[]; assets: Asset[]; shortages: ShortageRequest[]; returns: ReturnRequest[];
  search: string; onSelect: (loc: string) => void; onViewRequests: () => void;
}) {
  const [view, setView] = useState<"table" | "card">("table");
  const [sortKey, setSortKey] = useState<BoardSortKey>("location");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const rows = useMemo(() => locations.map(loc => {
    const m = computeMetrics(assetsInLocation(assets, loc), loc, shortages, returns);
    return { loc, gm: responsibleFor(loc), m, status: locationStatus(m) };
  }), [locations, assets, shortages, returns]);

  const kpi = useMemo(() => {
    const agg = rows.reduce((acc, r) => {
      acc.total += r.m.total; acc.assigned += r.m.assigned;
      acc.available += r.m.available; acc.underRepair += r.m.underRepair;
      acc.recoveryPending += r.m.recoveryPending;
      return acc;
    }, { total: 0, assigned: 0, available: 0, underRepair: 0, recoveryPending: 0 });
    return { ...agg, locations: rows.length };
  }, [rows]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () => !q ? rows : rows.filter(r => r.loc.toLowerCase().includes(q) || r.gm.toLowerCase().includes(q)),
    [rows, q],
  );

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: typeof rows[number]): string | number => {
      switch (sortKey) {
        case "location":      return r.loc;
        case "gm":            return r.gm;
        case "status":        return r.status;
        case "total":         return r.m.total;
        case "assigned":      return r.m.assigned;
        case "available":     return r.m.available;
        case "underRepair":   return r.m.underRepair;
        case "shortageOpen":  return r.m.shortageOpen;
        case "returnPending": return r.m.returnPending;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  useEffect(() => { setPage(1); }, [q, sortKey, sortDir, rowsPerPage]);

  const paged = sorted.slice((page - 1) * rowsPerPage, (page - 1) * rowsPerPage + rowsPerPage);

  const toggleSort = (key: BoardSortKey) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortHead = ({ label, k, className }: { label: string; k: BoardSortKey; className?: string }) => (
    <TableHead className={className}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground" data-testid={`sort-${k}`}>
        {label}
        {sortKey === k ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-50" />}
      </button>
    </TableHead>
  );

  const donut = [
    { name: "Assigned",     value: kpi.assigned,        color: "#2563eb" },
    { name: "Available",    value: kpi.available,       color: "#16a34a" },
    { name: "Under Repair", value: kpi.underRepair,     color: "#f59e0b" },
    { name: "In Recovery",  value: kpi.recoveryPending, color: "#a855f7" },
  ].filter(d => d.value > 0);

  const topAvail = useMemo(() => rows
    .map(r => ({ loc: r.loc, pct: r.m.total > 0 ? Math.round((r.m.available / r.m.total) * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5), [rows]);

  const alerts = useMemo(() => rows
    .filter(r => r.status !== "Healthy")
    .sort((a, b) => (a.status === "Critical" ? 0 : 1) - (b.status === "Critical" ? 0 : 1)), [rows]);

  const inScope          = useMemo(() => new Set(locations), [locations]);
  const pendingShortages = shortages.filter(s => inScope.has(s.location) && s.status === "Pending");
  const pendingReturns   = returns.filter(r => inScope.has(r.location) && r.status !== "Closed");
  const underRepairCount = assets.filter(a => inScope.has(a.location) && a.status === "Under Repair").length;
  const inTransitCount   = returns.filter(r => inScope.has(r.location) && r.status === "In Transit").length;

  if (locations.length === 0) {
    return (
      <Card><CardContent className="py-16 text-center text-muted-foreground">
        No locations are assigned to your account yet. Contact a Super Admin to map your locations.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={Package}      label="Total Assets"       value={kpi.total} />
        <KpiCard icon={CheckCircle2} label="Assigned"           value={kpi.assigned}        tone="text-blue-600" />
        <KpiCard icon={Package}      label="Available"          value={kpi.available}       tone="text-green-600" />
        <KpiCard icon={Wrench}       label="Under Repair"       value={kpi.underRepair}     tone="text-orange-600" />
        <KpiCard icon={ShieldAlert}  label="In Asset Recovery"  value={kpi.recoveryPending} tone="text-purple-600" />
        <KpiCard icon={Building2}    label="Total Locations"    value={kpi.locations} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Location Summary</CardTitle>
              <div className="flex items-center gap-1 rounded-md border p-0.5">
                <Button variant={view === "table" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setView("table")} data-testid="button-view-table"><Table2 className="h-4 w-4" /></Button>
                <Button variant={view === "card" ? "secondary" : "ghost"} size="sm" className="h-7 px-2" onClick={() => setView("card")} data-testid="button-view-card"><LayoutGrid className="h-4 w-4" /></Button>
              </div>
            </CardHeader>
            <CardContent>
              {view === "card" ? (
                <LocationGrid locations={filtered.map(r => r.loc)} assets={assets} shortages={shortages} returns={returns} onSelect={onSelect} />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <SortHead label="Location" k="location" />
                          <SortHead label="General Manager" k="gm" />
                          <SortHead label="Total" k="total" className="text-right" />
                          <SortHead label="Assigned" k="assigned" className="text-right" />
                          <SortHead label="Available" k="available" className="text-right" />
                          <SortHead label="Repair" k="underRepair" className="text-right" />
                          <SortHead label="Shortage" k="shortageOpen" className="text-right" />
                          <SortHead label="Returns" k="returnPending" className="text-right" />
                          <SortHead label="Status" k="status" />
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paged.map(r => (
                          <TableRow key={r.loc} data-testid={`row-location-${r.loc}`}>
                            <TableCell className="font-medium">{r.loc}</TableCell>
                            <TableCell>{r.gm}</TableCell>
                            <TableCell className="text-right">{r.m.total}</TableCell>
                            <TableCell className="text-right">{r.m.assigned}</TableCell>
                            <TableCell className="text-right">{r.m.available}</TableCell>
                            <TableCell className="text-right">{r.m.underRepair}</TableCell>
                            <TableCell className="text-right">{r.m.shortageOpen}</TableCell>
                            <TableCell className="text-right">{r.m.returnPending}</TableCell>
                            <TableCell><StatusBadge status={r.status} /></TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" onClick={() => onSelect(r.loc)} data-testid={`button-view-${r.loc}`}>
                                <Eye className="h-4 w-4 mr-1" /> View
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {paged.length === 0 && (
                          <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No locations match your search.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <TablePagination
                    total={sorted.length}
                    page={page}
                    rowsPerPage={rowsPerPage}
                    onPageChange={setPage}
                    onRowsPerPageChange={setRowsPerPage}
                    noun="location"
                    rowsOptions={[10, 25, 50, 100]}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Assets by Status</CardTitle></CardHeader>
            <CardContent>
              {donut.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No asset data.</p>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donut} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                        {donut.map(d => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <RTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4" /> Quick Alerts</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">All locations healthy.</p>
              ) : (
                alerts.slice(0, 6).map(r => (
                  <button key={r.loc} onClick={() => onSelect(r.loc)} className="w-full flex items-center justify-between rounded-md border p-2 text-left hover:bg-muted/50" data-testid={`alert-${r.loc}`}>
                    <span className="text-sm font-medium truncate">{r.loc}</span>
                    <StatusBadge status={r.status} />
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Top Locations by Availability %</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {topAvail.map(t => (
                <div key={t.loc} data-testid={`avail-${t.loc}`}>
                  <div className="flex justify-between text-xs mb-1"><span className="truncate">{t.loc}</span><span className="font-medium">{t.pct}%</span></div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${t.pct}%` }} /></div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <WidgetCard icon={Plus}      label="Pending Shortage Requests" value={pendingShortages.length} onClick={onViewRequests} />
        <WidgetCard icon={RotateCcw} label="Pending Returns"           value={pendingReturns.length}   onClick={onViewRequests} />
        <WidgetCard icon={Wrench}    label="Assets Under Repair"       value={underRepairCount} />
        <WidgetCard icon={Truck}     label="Assets In Transit"         value={inTransitCount}          onClick={onViewRequests} />
      </div>
    </div>
  );
}

// ─── Location detail ────────────────────────────────────────────────────────
type DetailCol =
  | "assetId" | "assetType" | "brand" | "serialNumber" | "status"
  | "condition" | "assignedTo" | "responsible" | "location" | "lastUpdated";

const DETAIL_COLS: { label: string; key: DetailCol }[] = [
  { label: "Asset ID",      key: "assetId" },
  { label: "Type",          key: "assetType" },
  { label: "Brand & Model", key: "brand" },
  { label: "Serial No",     key: "serialNumber" },
  { label: "Status",        key: "status" },
  { label: "Condition",     key: "condition" },
  { label: "Assigned To",   key: "assignedTo" },
  { label: "Responsible",   key: "responsible" },
  { label: "Location",      key: "location" },
  { label: "Last Updated",  key: "lastUpdated" },
];

function detailColValue(a: Asset, col: DetailCol): string {
  switch (col) {
    case "assetId":      return a.assetId || "";
    case "assetType":    return a.assetType || "";
    case "brand":        return [a.brand, a.model].filter(Boolean).join(" ");
    case "serialNumber": return a.serialNumber || "";
    case "status":       return a.status || "";
    case "condition":    return a.condition ?? "Good";
    case "assignedTo":   return a.assignedTo ?? a.assignedEmail ?? "";
    case "responsible":  return responsibleFor(a.location) || "";
    case "location":     return a.location || UNASSIGNED;
    case "lastUpdated":  return a.conditionUpdatedAt ?? a.updatedAt ?? "";
  }
}

function LocationDetail({
  location, assets, metrics, search, setSearch, onBack, canEditCondition, editableConditions, canRaise,
  canAddAsset, existingAssetIds, onAddAsset, onCondition, onReportShortage, onRaiseReturn, userName,
}: {
  location: string; assets: Asset[]; metrics: LocationMetrics;
  search: string; setSearch: (s: string) => void; onBack: () => void;
  canEditCondition: boolean; editableConditions: AssetCondition[]; canRaise: boolean;
  canAddAsset: boolean; existingAssetIds: string[];
  onAddAsset: (data: Omit<Asset, "id">) => Promise<void>;
  onCondition: (a: Asset, c: AssetCondition) => void;
  onReportShortage: () => void; onRaiseReturn: () => void;
  userName: (id: string) => string;
}) {
  const { toast } = useToast();
  const [fType, setFType] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fCondition, setFCondition] = useState("all");
  const [fDept, setFDept] = useState("all");
  const [fAck, setFAck] = useState<"all" | "acknowledged" | "pending">("all");
  const [fDevice, setFDevice] = useState<"all" | "online" | "offline" | "managed" | "unmanaged" | "agent_installed" | "agent_missing">("all");
  const [deviceMap, setDeviceMap] = useState<Map<string, DeviceLike>>(new Map());
  const [deviceMapLoaded, setDeviceMapLoaded] = useState(false);
  const [sortCol, setSortCol] = useState<DetailCol>("assetId");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [addOpen, setAddOpen] = useState(false);

  const typeOptions = useMemo(
    () => Array.from(new Set(assets.map(a => a.assetType).filter(Boolean))).sort(),
    [assets],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set(assets.map(a => a.status).filter(Boolean))).sort(),
    [assets],
  );
  const conditionOptions = useMemo(
    () => Array.from(new Set(assets.map(a => a.condition ?? "Good").filter(Boolean))).sort(),
    [assets],
  );
  const deptOptions = useMemo(
    () => Array.from(new Set(assets.map(a => a.department).filter((d): d is string => !!d))).sort((a, b) => a.localeCompare(b)),
    [assets],
  );

  // Managed-device status (for the Device filter). Failure is non-fatal: the map
  // stays empty and the device filters simply match nothing rather than crashing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("managed_devices")
        .select("laptop_asset_id, status, is_managed, last_seen_at, agent_removed_at, uptime_seconds");
      if (cancelled || error || !data) return;
      const m = new Map<string, DeviceLike>();
      for (const d of data as Array<DeviceLike & { laptop_asset_id?: string | null }>) {
        if (d.laptop_asset_id) m.set(String(d.laptop_asset_id), d);
      }
      setDeviceMap(m);
      setDeviceMapLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter(a => {
      if (fType !== "all" && a.assetType !== fType) return false;
      if (fStatus !== "all" && a.status !== fStatus) return false;
      if (fCondition !== "all" && (a.condition ?? "Good") !== fCondition) return false;
      if (fDept !== "all" && (a.department ?? "") !== fDept) return false;
      // Ack filter only applies to Assigned assets.
      if (fAck !== "all") {
        const ok = fAck === "acknowledged"
          ? (a.status === "Assigned" && !!a.acknowledged)
          : (a.status === "Assigned" && !a.acknowledged);
        if (!ok) return false;
      }
      // Device filters only apply to laptops (the only asset type the agent manages).
      if (fDevice !== "all") {
        const dev = a.id ? deviceMap.get(a.id) : undefined;
        const isLaptop = a.assetType === "Laptop";
        const ok =
          fDevice === "online"          ? isOnline(dev) :
          fDevice === "managed"         ? isManaged(dev) :
          fDevice === "agent_installed" ? !!dev :
          !deviceMapLoaded              ? false :
          fDevice === "offline"         ? (isLaptop && isManaged(dev) && !isOnline(dev)) :
          fDevice === "unmanaged"       ? (isLaptop && !isManaged(dev)) :
          /* agent_missing */             (isLaptop && !dev);
        if (!ok) return false;
      }
      if (!q) return true;
      return (
        a.assetId.toLowerCase().includes(q) ||
        a.assetType.toLowerCase().includes(q) ||
        `${a.brand} ${a.model}`.toLowerCase().includes(q) ||
        (a.serialNumber ?? "").toLowerCase().includes(q) ||
        (a.assignedTo ?? a.assignedEmail ?? "").toLowerCase().includes(q)
      );
    });
  }, [assets, search, fType, fStatus, fCondition, fDept, fAck, fDevice, deviceMap, deviceMapLoaded]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) =>
      detailColValue(a, sortCol).localeCompare(detailColValue(b, sortCol), undefined, { numeric: true, sensitivity: "base" }) * dir
    );
  }, [filtered, sortCol, sortDir]);

  useEffect(() => { setPage(1); }, [search, fType, fStatus, fCondition, fDept, fAck, fDevice, rowsPerPage]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  // Clamp if the underlying assets list shrinks externally (e.g. offboard / condition change)
  // while sitting on a now-out-of-range page.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const paged = sorted.slice((page - 1) * rowsPerPage, (page - 1) * rowsPerPage + rowsPerPage);

  const handleSort = (col: DetailCol) => {
    if (sortCol === col) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  const hasFilters = !!search || fType !== "all" || fStatus !== "all" || fCondition !== "all" || fDept !== "all" || fAck !== "all" || fDevice !== "all";
  const clearFilters = () => {
    setSearch(""); setFType("all"); setFStatus("all"); setFCondition("all");
    setFDept("all"); setFAck("all"); setFDevice("all");
  };

  const handleExport = () => {
    exportCsv(
      `${location}-assets-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Asset ID", "Type", "Brand", "Model", "Serial No", "Status", "Condition", "Assigned To", "Responsible", "Location", "Last Updated"],
      sorted.map(a => [
        a.assetId,
        a.assetType,
        a.brand,
        a.model,
        a.serialNumber ?? "",
        a.status,
        a.condition ?? "Good",
        a.assignedTo ?? a.assignedEmail ?? "",
        responsibleFor(a.location),
        a.location || UNASSIGNED,
        fmtDate(a.conditionUpdatedAt ?? a.updatedAt),
      ]),
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-locations">
            <ArrowLeft className="h-4 w-4 mr-1" /> All locations
          </Button>
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" />{location}</h2>
            <p className="text-xs text-muted-foreground">Responsible: {responsibleFor(location)}</p>
          </div>
        </div>
        {(canRaise || (canAddAsset && location !== UNASSIGNED)) && (
          <div className="flex items-center gap-2 flex-wrap">
            {canAddAsset && location !== UNASSIGNED && (
              <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-asset-location">
                <Plus className="h-4 w-4 mr-1" /> Add Asset
              </Button>
            )}
            {canRaise && (
              <>
                <Button size="sm" variant="outline" onClick={onReportShortage} data-testid="button-report-shortage">
                  <Plus className="h-4 w-4 mr-1" /> Report Shortage
                </Button>
                <Button size="sm" variant="outline" onClick={onRaiseReturn} data-testid="button-raise-return">
                  <RotateCcw className="h-4 w-4 mr-1" /> Return / Repair / Replace
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <StatTile icon={Package}      label="Total"      value={metrics.total} />
        <StatTile icon={CheckCircle2} label="Assigned"   value={metrics.assigned} />
        <StatTile icon={Package}      label="Available"  value={metrics.available} />
        <StatTile icon={Wrench}       label="Repair"     value={metrics.underRepair} />
        <StatTile icon={AlertTriangle} label="Damaged"   value={metrics.damaged} />
        <StatTile icon={ShieldAlert}  label="Recovery"   value={metrics.recoveryPending} />
        <StatTile icon={AlertTriangle} label="Shortage"  value={metrics.shortageOpen} />
        <StatTile icon={RotateCcw}    label="Returns"    value={metrics.returnPending} />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-stretch">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9 h-10 text-sm"
                placeholder="Search by Asset ID, serial, model, assigned user…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-search-location-assets"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Select value={fType} onValueChange={setFType}>
              <SelectTrigger className="w-[160px] h-10 text-sm" data-testid="select-filter-type"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {typeOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fStatus} onValueChange={setFStatus}>
              <SelectTrigger className="w-[170px] h-10 text-sm" data-testid="select-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fCondition} onValueChange={setFCondition}>
              <SelectTrigger className="w-[170px] h-10 text-sm" data-testid="select-filter-condition"><SelectValue placeholder="Condition" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Conditions</SelectItem>
                {conditionOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fDept} onValueChange={setFDept}>
              <SelectTrigger className="w-[190px] h-10 text-sm" data-testid="select-filter-dept"><SelectValue placeholder="Department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {deptOptions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fAck} onValueChange={(v) => setFAck(v as typeof fAck)}>
              <SelectTrigger className="w-[220px] h-10 text-sm" data-testid="select-filter-ack"><SelectValue placeholder="Acknowledgement" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Acknowledgement</SelectItem>
                <SelectItem value="acknowledged"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Acknowledged</span></SelectItem>
                <SelectItem value="pending"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-orange-500" /> Pending Acknowledgement</span></SelectItem>
              </SelectContent>
            </Select>
            <Select value={fDevice} onValueChange={(v) => setFDevice(v as typeof fDevice)}>
              <SelectTrigger className="w-[200px] h-10 text-sm" data-testid="select-filter-device"><SelectValue placeholder="Device" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Devices</SelectItem>
                <SelectItem value="online"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Online</span></SelectItem>
                <SelectItem value="offline"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-slate-400" /> Offline</span></SelectItem>
                <SelectItem value="managed">Managed</SelectItem>
                <SelectItem value="unmanaged">Unmanaged</SelectItem>
                <SelectItem value="agent_installed">Agent Installed</SelectItem>
                <SelectItem value="agent_missing">Agent Missing</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {filtered.length} of {assets.length} assets at {location}
            </span>
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium underline-offset-2 hover:underline" data-testid="button-clear-location-filters">
                <X className="h-3 w-3" /> Clear all filters
              </button>
            )}
            <Button variant="outline" size="sm" className="ml-auto" onClick={handleExport} disabled={sorted.length === 0} data-testid="button-export-location-assets">
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {DETAIL_COLS.map(col => (
                  <TableHead key={col.key}>
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      title={`Sort by ${col.label}`}
                      data-testid={`sort-${col.key}`}
                    >
                      {col.label}
                      <span className={cn("rounded p-0.5 transition-colors", sortCol === col.key ? "text-primary" : "text-muted-foreground/40")}>
                        {sortCol === col.key
                          ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
                          : <ChevronsUpDown className="h-3 w-3" />}
                      </span>
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">No assets match your filters.</TableCell></TableRow>
              ) : paged.map(a => (
                <TableRow key={a.id ?? a.assetId} data-testid={`row-asset-${a.assetId}`}>
                  <TableCell className="font-medium">{a.assetId}</TableCell>
                  <TableCell>{a.assetType}</TableCell>
                  <TableCell>{[a.brand, a.model].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell>{a.serialNumber || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{a.status}</Badge></TableCell>
                  <TableCell>
                    {canEditCondition && editableConditions.includes(a.condition ?? "Good") ? (
                      <Select value={a.condition ?? "Good"} onValueChange={(v) => onCondition(a, v as AssetCondition)}>
                        <SelectTrigger className="h-8 w-[150px]" data-testid={`select-condition-${a.assetId}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {editableConditions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className={`inline-block rounded px-2 py-0.5 text-xs ${conditionTone[a.condition ?? "Good"] ?? ""}`}>{a.condition ?? "Good"}</span>
                    )}
                  </TableCell>
                  <TableCell>{a.assignedTo ?? a.assignedEmail ?? "—"}</TableCell>
                  <TableCell>{responsibleFor(a.location)}</TableCell>
                  <TableCell>{a.location || UNASSIGNED}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{fmtDate(a.conditionUpdatedAt ?? a.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            total={sorted.length}
            page={page}
            rowsPerPage={rowsPerPage}
            onPageChange={setPage}
            onRowsPerPageChange={setRowsPerPage}
            noun="assets"
          />
        </CardContent>
      </Card>

      {canAddAsset && (
        <AssetFormModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          asset={null}
          existingIds={existingAssetIds}
          defaultLocation={location}
          onSave={async (data) => {
            await onAddAsset(data);
            setAddOpen(false);
            toast({ title: "Asset added", description: `${data.assetId} added to ${location}.` });
          }}
        />
      )}
    </div>
  );
}

function StatTile({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-card-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground"><Icon className="h-3.5 w-3.5" /><span className="text-[10px] uppercase tracking-wide">{label}</span></div>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  );
}

// ─── Shortage requests table ────────────────────────────────────────────────
function ShortageTable({ rows, canApprove, userName, onStatus }: {
  rows: ShortageRequest[]; canApprove: boolean; userName: (id: string) => string;
  onStatus: (id: string, status: ShortageStatus) => void;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> Shortage / Replacement Requests</h3>
      <Card><CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Location</TableHead><TableHead>Asset Type</TableHead><TableHead>Qty</TableHead>
            <TableHead>Priority</TableHead><TableHead>Requested By</TableHead><TableHead>Raised</TableHead>
            <TableHead>Status</TableHead>{canApprove && <TableHead className="text-right">Action</TableHead>}
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={canApprove ? 8 : 7} className="text-center py-8 text-muted-foreground">No shortage requests.</TableCell></TableRow>
            ) : rows.map(r => (
              <TableRow key={r.id} data-testid={`row-shortage-${r.id}`}>
                <TableCell>{r.location}</TableCell>
                <TableCell>{r.assetType}</TableCell>
                <TableCell>{r.quantityRequested}{r.quantityAvailable ? ` / ${r.quantityAvailable} avl` : ""}</TableCell>
                <TableCell><Badge variant="outline">{r.priority}</Badge></TableCell>
                <TableCell>{userName(r.requestedBy)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                {canApprove && (
                  <TableCell className="text-right">
                    <Select value={r.status} onValueChange={(v) => onStatus(r.id, v as ShortageStatus)}>
                      <SelectTrigger className="h-8 w-[170px] ml-auto" data-testid={`select-shortage-status-${r.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{SHORTAGE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// ─── Return requests table ──────────────────────────────────────────────────
function ReturnTable({ rows, assets, canApprove, isGm, myAccess, userName, onStatus }: {
  rows: ReturnRequest[]; assets: Asset[]; canApprove: boolean; isGm: boolean;
  myAccess: UserLocationAccess[]; userName: (id: string) => string;
  onStatus: (id: string, patch: { status?: ReturnStatus; markApproved?: boolean }) => void;
}) {
  const assetLabel = (uuid?: string) => {
    if (!uuid) return "—";
    const a = assets.find(x => x.id === uuid);
    return a ? a.assetId : "—";
  };
  const canMark = (loc: string) => myAccess.some(a => a.location === loc && a.canMarkReceived);
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-2"><RotateCcw className="h-4 w-4 text-blue-600" /> Return / Repair Requests</h3>
      <Card><CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Location</TableHead><TableHead>Asset</TableHead><TableHead>Type</TableHead>
            <TableHead>Requested By</TableHead><TableHead>Raised</TableHead><TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No return requests.</TableCell></TableRow>
            ) : rows.map(r => (
              <TableRow key={r.id} data-testid={`row-return-${r.id}`}>
                <TableCell>{r.location}</TableCell>
                <TableCell>{assetLabel(r.assetId)}</TableCell>
                <TableCell>{r.returnType}</TableCell>
                <TableCell>{userName(r.requestedBy)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                <TableCell className="text-right">
                  {canApprove ? (
                    <Select value={r.status} onValueChange={(v) => onStatus(r.id, { status: v as ReturnStatus, markApproved: true })}>
                      <SelectTrigger className="h-8 w-[200px] ml-auto" data-testid={`select-return-status-${r.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{RETURN_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : isGm && canMark(r.location) && r.status !== "Closed" ? (
                    <div className="flex items-center justify-end gap-2">
                      {(r.status === "Approved" || r.status === "Courier Pending") && (
                        <Button size="sm" variant="outline" onClick={() => onStatus(r.id, { status: "In Transit" })} data-testid={`button-courier-dispatched-${r.id}`}>
                          Courier Dispatched
                        </Button>
                      )}
                      {r.status === "In Transit" && (
                        <Button size="sm" variant="outline" onClick={() => onStatus(r.id, { status: "Received at Bangalore" })} data-testid={`button-mark-received-${r.id}`}>
                          Mark Received
                        </Button>
                      )}
                      {r.status !== "Approved" && r.status !== "Courier Pending" && r.status !== "In Transit" && (
                        <span className="text-xs text-muted-foreground">Awaiting Bangalore IT</span>
                      )}
                    </div>
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// ─── Shortage dialog ────────────────────────────────────────────────────────
function ShortageDialog({ open, onOpenChange, location, assetTypes, onSubmit }: {
  open: boolean; onOpenChange: (o: boolean) => void; location: string; assetTypes: string[];
  onSubmit: (input: { location: string; assetType: string; quantityRequested: number; quantityAvailable?: number; priority?: ShortagePriority; reason?: string }) => Promise<void>;
}) {
  const [assetType, setAssetType] = useState("");
  const [qtyReq, setQtyReq] = useState("1");
  const [qtyAvl, setQtyAvl] = useState("0");
  const [priority, setPriority] = useState<ShortagePriority>("Medium");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setAssetType(""); setQtyReq("1"); setQtyAvl("0"); setPriority("Medium"); setReason(""); } }, [open]);

  const submit = async () => {
    if (!assetType || Number(qtyReq) < 1) return;
    setSaving(true);
    try { await onSubmit({ location, assetType, quantityRequested: Number(qtyReq), quantityAvailable: Number(qtyAvl) || 0, priority, reason: reason || undefined }); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report Shortage — {location}</DialogTitle>
          <DialogDescription>Request replenishment for assets running short at this location.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Asset Type</Label>
            <Select value={assetType} onValueChange={setAssetType}>
              <SelectTrigger data-testid="select-shortage-asset-type"><SelectValue placeholder="Select asset type" /></SelectTrigger>
              <SelectContent>{assetTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Quantity Needed</Label><Input type="number" min={1} value={qtyReq} onChange={e => setQtyReq(e.target.value)} data-testid="input-shortage-qty" /></div>
            <div className="space-y-1.5"><Label>Currently Available</Label><Input type="number" min={0} value={qtyAvl} onChange={e => setQtyAvl(e.target.value)} data-testid="input-shortage-available" /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as ShortagePriority)}>
              <SelectTrigger data-testid="select-shortage-priority"><SelectValue /></SelectTrigger>
              <SelectContent>{SHORTAGE_PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Reason / Notes</Label><Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this needed?" data-testid="input-shortage-reason" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !assetType} data-testid="button-submit-shortage">{saving ? "Submitting…" : "Submit Request"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Return dialog ──────────────────────────────────────────────────────────
function ReturnDialog({ open, onOpenChange, location, assets, onSubmit }: {
  open: boolean; onOpenChange: (o: boolean) => void; location: string; assets: Asset[];
  onSubmit: (input: { assetId?: string; location: string; returnType: ReturnType; reason?: string }) => Promise<void>;
}) {
  const [assetUuid, setAssetUuid] = useState("");
  const [returnType, setReturnType] = useState<ReturnType>("Hardware Issue");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setAssetUuid(""); setReturnType("Hardware Issue"); setReason(""); } }, [open]);

  const submit = async () => {
    setSaving(true);
    try { await onSubmit({ assetId: assetUuid || undefined, location, returnType, reason: reason || undefined }); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Return / Repair / Replace — {location}</DialogTitle>
          <DialogDescription>Raise a return, repair, or replacement request routed to Bangalore IT.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Asset (optional)</Label>
            <Select value={assetUuid} onValueChange={setAssetUuid}>
              <SelectTrigger data-testid="select-return-asset"><SelectValue placeholder="Select an asset" /></SelectTrigger>
              <SelectContent>
                {assets.filter(a => a.id).map(a => <SelectItem key={a.id} value={a.id as string}>{a.assetId} — {a.brand} {a.model}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Request Type</Label>
            <Select value={returnType} onValueChange={(v) => setReturnType(v as ReturnType)}>
              <SelectTrigger data-testid="select-return-type"><SelectValue /></SelectTrigger>
              <SelectContent>{RETURN_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Reason / Notes</Label><Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe the issue or reason" data-testid="input-return-reason" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving} data-testid="button-submit-return">{saving ? "Submitting…" : "Submit Request"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
