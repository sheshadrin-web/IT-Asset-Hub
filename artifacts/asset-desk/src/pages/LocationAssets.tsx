import { useState, useEffect, useMemo, useCallback } from "react";
import {
  MapPin, ArrowLeft, Package, CheckCircle2, Wrench, AlertTriangle,
  RotateCcw, ShieldAlert, Plus, Search, RefreshCw, Download,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useAssets } from "@/context/AssetContext";
import { useUsers } from "@/context/UsersContext";
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
import { Card, CardContent } from "@/components/ui/card";
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
  const { assets, updateAssetCondition, refresh: refreshAssets } = useAssets();
  const { users } = useUsers();
  const { toast } = useToast();

  const [access,    setAccess]    = useState<UserLocationAccess[]>([]);
  const [shortages, setShortages] = useState<ShortageRequest[]>([]);
  const [returns,   setReturns]   = useState<ReturnRequest[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState<string | null>(null);
  const [search,    setSearch]    = useState("");
  const [shortageOpen, setShortageOpen] = useState(false);
  const [returnOpen,   setReturnOpen]   = useState(false);

  const isAdmin = canViewAllLocations(currentUser);
  const canApprove = canApproveRequests(currentUser);

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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MapPin className="h-6 w-6 text-primary" /> Location-wise Assets
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Asset distribution, condition, and replenishment requests across Miles locations.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { refreshAssets(); loadRequests(); }} data-testid="button-refresh-locations">
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="locations">
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
            <LocationGrid
              locations={locations}
              assets={assets}
              shortages={shortages}
              returns={returns}
              onSelect={setSelected}
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
              canRaise={canRaiseRequestsForLocation(currentUser, selected, myAccess)}
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

// ─── Location detail ────────────────────────────────────────────────────────
function LocationDetail({
  location, assets, metrics, search, setSearch, onBack, canEditCondition, canRaise,
  onCondition, onReportShortage, onRaiseReturn, userName,
}: {
  location: string; assets: Asset[]; metrics: LocationMetrics;
  search: string; setSearch: (s: string) => void; onBack: () => void;
  canEditCondition: boolean; canRaise: boolean;
  onCondition: (a: Asset, c: AssetCondition) => void;
  onReportShortage: () => void; onRaiseReturn: () => void;
  userName: (id: string) => string;
}) {
  const [fType, setFType] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fCondition, setFCondition] = useState("all");

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter(a => {
      if (fType !== "all" && a.assetType !== fType) return false;
      if (fStatus !== "all" && a.status !== fStatus) return false;
      if (fCondition !== "all" && (a.condition ?? "Good") !== fCondition) return false;
      if (!q) return true;
      return (
        a.assetId.toLowerCase().includes(q) ||
        a.assetType.toLowerCase().includes(q) ||
        `${a.brand} ${a.model}`.toLowerCase().includes(q) ||
        (a.serialNumber ?? "").toLowerCase().includes(q) ||
        (a.assignedTo ?? a.assignedEmail ?? "").toLowerCase().includes(q)
      );
    });
  }, [assets, search, fType, fStatus, fCondition]);

  const handleExport = () => {
    exportCsv(
      `${location}-assets-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Asset ID", "Type", "Brand", "Model", "Serial No", "Status", "Condition", "Assigned To", "Responsible", "Location", "Last Updated"],
      filtered.map(a => [
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
        {canRaise && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onReportShortage} data-testid="button-report-shortage">
              <Plus className="h-4 w-4 mr-1" /> Report Shortage
            </Button>
            <Button size="sm" onClick={onRaiseReturn} data-testid="button-raise-return">
              <RotateCcw className="h-4 w-4 mr-1" /> Return / Repair / Replace
            </Button>
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search assets…" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-location-assets" />
        </div>
        <Select value={fType} onValueChange={setFType}>
          <SelectTrigger className="h-9 w-[150px]" data-testid="select-filter-type"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {typeOptions.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger className="h-9 w-[150px]" data-testid="select-filter-status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fCondition} onValueChange={setFCondition}>
          <SelectTrigger className="h-9 w-[150px]" data-testid="select-filter-condition"><SelectValue placeholder="Condition" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Conditions</SelectItem>
            {conditionOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{filtered.length} of {assets.length}</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={handleExport} disabled={filtered.length === 0} data-testid="button-export-location-assets">
          <Download className="h-4 w-4 mr-1" /> Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Brand &amp; Model</TableHead>
                <TableHead>Serial No</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Responsible</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">No assets found at this location.</TableCell></TableRow>
              ) : filtered.map(a => (
                <TableRow key={a.id ?? a.assetId} data-testid={`row-asset-${a.assetId}`}>
                  <TableCell className="font-medium">{a.assetId}</TableCell>
                  <TableCell>{a.assetType}</TableCell>
                  <TableCell>{[a.brand, a.model].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell>{a.serialNumber || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{a.status}</Badge></TableCell>
                  <TableCell>
                    {canEditCondition ? (
                      <Select value={a.condition ?? "Good"} onValueChange={(v) => onCondition(a, v as AssetCondition)}>
                        <SelectTrigger className="h-8 w-[150px]" data-testid={`select-condition-${a.assetId}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSET_CONDITION_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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
        </CardContent>
      </Card>
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
function ReturnTable({ rows, assets, canApprove, myAccess, userName, onStatus }: {
  rows: ReturnRequest[]; assets: Asset[]; canApprove: boolean;
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
                  ) : canMark(r.location) && r.status !== "Closed" ? (
                    <Button size="sm" variant="outline" onClick={() => onStatus(r.id, { status: "Received at Bangalore" })} data-testid={`button-mark-received-${r.id}`}>
                      Mark Received
                    </Button>
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
