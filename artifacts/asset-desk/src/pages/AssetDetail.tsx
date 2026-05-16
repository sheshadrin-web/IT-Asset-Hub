import { useParams, Link } from "wouter";
import {
  ArrowLeft, Monitor, Smartphone, Calendar, MapPin,
  User, Building, Tag, Package, Edit, AlertTriangle,
  Wrench, Archive, UserPlus, RotateCcw, CheckCircle2,
  ShoppingCart, PackageCheck, ClipboardCheck, Search, X,
} from "lucide-react";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAssets } from "@/context/AssetContext";
import { useTickets } from "@/context/TicketContext";
import { useUsers } from "@/context/UsersContext";
import { useAuth } from "@/context/AuthContext";
import { AssetStatus } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";

interface HistoryRow {
  id:           string;
  user_name:    string | null;
  user_email:   string | null;
  user_ecode:   string | null;
  department:   string | null;
  event_type:   "assigned" | "returned" | "unassigned";
  event_by_name:string | null;
  notes:        string | null;
  created_at:   string;
}

const STATUS_COLORS: Record<AssetStatus, string> = {
  "In Procurement": "bg-orange-500/15 text-orange-600 border-orange-500/20",
  Available:        "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Assigned:         "bg-blue-500/15 text-blue-600 border-blue-500/20",
  "Under Repair":   "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Lost:             "bg-red-500/15 text-red-500 border-red-500/20",
  Retired:          "bg-gray-500/15 text-gray-500 border-gray-500/20",
};

// ─── Lifecycle stages ─────────────────────────────────────────────────────────
const LIFECYCLE_STAGES = [
  { key: "procurement", label: "Procurement",   Icon: ShoppingCart,  statuses: ["In Procurement"] as AssetStatus[] },
  { key: "inventory",   label: "In Inventory",  Icon: Package,       statuses: ["Available"] as AssetStatus[] },
  { key: "allocated",   label: "Allocated",     Icon: UserPlus,      statuses: ["Assigned"] as AssetStatus[] },
  { key: "return",      label: "Return",        Icon: RotateCcw,     statuses: ["Under Repair"] as AssetStatus[] },
  { key: "verified",    label: "Re-verified",   Icon: ClipboardCheck,statuses: ["Retired"] as AssetStatus[] },
];

function getLifecycleStageIdx(status: AssetStatus): number {
  if (status === "In Procurement") return 0;
  if (status === "Available")      return 1;
  if (status === "Assigned")       return 2;
  if (status === "Under Repair")   return 3;
  if (status === "Retired")        return 4;
  return 1;
}
const PRIORITY_COLORS: Record<string, string> = {
  Critical: "bg-red-500/15 text-red-500 border-red-500/20",
  High:     "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Medium:   "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Low:      "bg-gray-500/15 text-gray-500 border-gray-500/20",
};
const TICKET_STATUS_COLORS: Record<string, string> = {
  Open:               "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Assigned:           "bg-purple-500/15 text-purple-600 border-purple-500/20",
  "In Progress":      "bg-amber-500/15 text-amber-600 border-amber-500/20",
  "Waiting for User": "bg-orange-500/15 text-orange-600 border-orange-500/20",
  Resolved:           "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Closed:             "bg-gray-500/15 text-gray-500 border-gray-500/20",
  Rejected:           "bg-red-500/15 text-red-500 border-red-500/20",
};

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const { getAsset, assignAsset, updateStatus, unassignAsset } = useAssets();
  const { tickets } = useTickets();
  const { users }   = useUsers();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignUserId,     setAssignUserId]      = useState("");
  const [assignSearch,     setAssignSearch]      = useState("");
  const [assignReason,     setAssignReason]      = useState("");
  const [history,          setHistory]           = useState<HistoryRow[]>([]);
  const [historyLoading,   setHistoryLoading]    = useState(false);

  useEffect(() => {
    if (!id || !supabaseConfigured) return;
    setHistoryLoading(true);
    supabase
      .from("asset_assignment_history")
      .select("id,user_name,user_email,user_ecode,department,event_type,event_by_name,notes,created_at")
      .eq("asset_id", id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setHistory((data ?? []) as HistoryRow[]);
        setHistoryLoading(false);
      });
  }, [id]);

  const asset          = getAsset(id);
  const relatedTickets = tickets.filter(t => t.assetId === id);
  const isAdmin        = currentUser?.role === "super_admin" || currentUser?.role === "it_admin";
  const canEdit        = isAdmin || currentUser?.role === "it_agent";
  const activeUsers    = users.filter(u => u.status === "active");
  const selectedUser   = users.find(u => u.id === assignUserId);

  const closeAssignDialog = () => {
    setAssignDialogOpen(false);
    setAssignUserId("");
    setAssignSearch("");
    setAssignReason("");
  };

  const handleAssignConfirm = async () => {
    if (!asset || !selectedUser) return;
    try {
      await assignAsset(asset.assetId, selectedUser.id, selectedUser.full_name, selectedUser.email, selectedUser.department ?? "", undefined, assignReason);
      toast({ title: "Asset assigned", description: `Assigned to ${selectedUser.full_name}` });
      closeAssignDialog();
    } catch (err) {
      toast({ title: "Failed to assign asset", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    }
  };

  // Search-filtered users: match ecode prefix OR name contains query
  const nk = (s: string) => s.toLowerCase().trim();
  const searchedUsers = assignSearch.trim().length === 0
    ? activeUsers
    : activeUsers.filter(u => {
        const q = nk(assignSearch);
        return nk(u.ecode ?? "").startsWith(q) || nk(u.full_name).includes(q);
      });

  const handleUpdateStatus = async (status: AssetStatus) => {
    if (!asset) return;
    try {
      await updateStatus(asset.assetId, status);
      toast({ title: `Marked as ${status}` });
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    }
  };

  const handleUnassign = async () => {
    if (!asset) return;
    try {
      await unassignAsset(asset.assetId);
      toast({ title: "Asset unassigned" });
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    }
  };

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Asset not found.</p>
        <Link href="/assets">
          <Button variant="outline" className="gap-2"><ArrowLeft className="h-4 w-4" /> Back to Assets</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Link href="/assets">
            <Button variant="ghost" size="icon" data-testid="button-back"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                {asset.assetType === "Laptop" ? <Monitor className="h-5 w-5 text-primary" /> : <Smartphone className="h-5 w-5 text-primary" />}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-foreground">{asset.assetId}</h1>
                  <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", STATUS_COLORS[asset.status])}>
                    {asset.status}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{asset.brand} {asset.model}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Move to Inventory — for In Procurement only */}
          {isAdmin && asset.status === "In Procurement" && (
            <Button variant="outline" size="sm" className="gap-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50" onClick={() => handleUpdateStatus("Available")} data-testid="button-move-inventory">
              <PackageCheck className="h-4 w-4" /> Move to Inventory
            </Button>
          )}
          {/* Mark Available — for Under Repair, Retired, Lost */}
          {isAdmin && (asset.status === "Under Repair" || asset.status === "Retired" || asset.status === "Lost") && (
            <Button variant="outline" size="sm" className="gap-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50" onClick={() => handleUpdateStatus("Available")} data-testid="button-mark-available">
              <CheckCircle2 className="h-4 w-4" /> Mark Available
            </Button>
          )}
          {/* Assign — for Available or Under Repair (not Assigned, not Retired) */}
          {isAdmin && (asset.status === "Available" || asset.status === "Under Repair") && (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => { setAssignDialogOpen(true); setAssignUserId(""); }} data-testid="button-assign">
              <UserPlus className="h-4 w-4" /> Assign
            </Button>
          )}
          {/* Return / Unassign — only for Assigned */}
          {isAdmin && asset.status === "Assigned" && (
            <>
              <Link href={`/assets/${asset.assetId}/return`}>
                <Button variant="outline" size="sm" className="gap-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50" data-testid="button-return-asset">
                  <RotateCcw className="h-4 w-4" /> Return Asset
                </Button>
              </Link>
              <Button variant="outline" size="sm" className="gap-2" onClick={handleUnassign}>
                <UserPlus className="h-4 w-4" /> Unassign
              </Button>
            </>
          )}
          {/* Mark Repair — for Available or Assigned */}
          {isAdmin && (asset.status === "Available" || asset.status === "Assigned") && (
            <Button variant="outline" size="sm" className="gap-2 text-amber-600 border-amber-300 hover:bg-amber-50" onClick={() => handleUpdateStatus("Under Repair")} data-testid="button-mark-repair">
              <Wrench className="h-4 w-4" /> Mark Repair
            </Button>
          )}
          {/* Retire — for anything except already Retired */}
          {isAdmin && asset.status !== "Retired" && (
            <Button variant="outline" size="sm" className="gap-2 text-muted-foreground" onClick={() => handleUpdateStatus("Retired")} data-testid="button-retire">
              <Archive className="h-4 w-4" /> Retire
            </Button>
          )}
          {canEdit && (
            <Link href={`/assets/${asset.assetId}/edit`}>
              <Button size="sm" className="gap-2" data-testid="button-edit-asset">
                <Edit className="h-4 w-4" /> Edit
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* ── Lifecycle tracker ──────────────────────────────────────────────── */}
      {asset.status !== "Lost" && (
        <Card className="overflow-hidden">
          <CardContent className="py-4 px-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Asset Lifecycle</p>
            <div className="flex items-start gap-0">
              {LIFECYCLE_STAGES.map((stage, idx) => {
                const currentIdx = getLifecycleStageIdx(asset.status);
                const isActive  = idx === currentIdx;
                const isDone    = idx < currentIdx;
                const { Icon }  = stage;
                return (
                  <div key={stage.key} className="flex items-center flex-1 min-w-0">
                    <div className="flex flex-col items-center flex-1 min-w-0">
                      <div className={cn(
                        "h-9 w-9 rounded-full flex items-center justify-center mb-2 transition-all border-2",
                        isActive ? "bg-primary text-primary-foreground border-primary shadow-md" :
                        isDone   ? "bg-primary/20 text-primary border-primary/40" :
                                   "bg-muted text-muted-foreground border-border"
                      )}>
                        {isDone
                          ? <CheckCircle2 className="h-4 w-4" />
                          : <Icon className="h-4 w-4" />}
                      </div>
                      <span className={cn(
                        "text-[10px] font-medium text-center leading-tight px-1 truncate w-full text-center",
                        isActive ? "text-primary font-semibold" : isDone ? "text-primary/70" : "text-muted-foreground"
                      )}>
                        {stage.label}
                      </span>
                    </div>
                    {idx < LIFECYCLE_STAGES.length - 1 && (
                      <div className={cn("h-0.5 w-full mx-1 mb-5 flex-shrink rounded-full", idx < currentIdx ? "bg-primary/40" : "bg-border")} />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Device Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                {[
                  { icon: <Tag />,     label: "Asset ID",      value: asset.assetId },
                  { icon: asset.assetType === "Laptop" ? <Monitor /> : <Smartphone />, label: "Type", value: asset.assetType },
                  { icon: <Package />, label: "Brand",         value: asset.brand },
                  { icon: <Package />, label: "Model",         value: asset.model },
                  { icon: <Tag />,     label: "Serial Number", value: asset.serialNumber },
                  ...(asset.assetType === "Mobile" ? [{ icon: <Tag />, label: "IMEI", value: asset.imeiNumber ?? "—" }] : []),
                  { icon: <Calendar />, label: "Purchase Date",  value: asset.purchaseDate },
                  { icon: <Calendar />, label: "Warranty Ends",  value: asset.warrantyEndDate },
                  { icon: <MapPin />,   label: "Location",       value: asset.location },
                  { icon: <Package />,  label: "Accessories",    value: asset.accessories || "—" },
                ].map(f => (
                  <div key={f.label} className="flex items-start gap-3">
                    <div className="mt-0.5 flex-shrink-0 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{f.icon}</div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">{f.label}</p>
                      <p className="text-sm text-foreground mt-0.5 font-medium">{f.value}</p>
                    </div>
                  </div>
                ))}
              </div>
              {asset.remarks && (
                <div className="mt-5 pt-4 border-t border-border">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Remarks</p>
                  <p className="text-sm text-foreground">{asset.remarks}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Related Tickets <span className="text-muted-foreground font-normal">({relatedTickets.length})</span></CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {relatedTickets.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">No tickets raised for this asset.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["Ticket ID","Category","Priority","Status","Date"].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {relatedTickets.map(t => (
                        <tr key={t.ticketId} className="border-b border-border last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3"><Link href={`/tickets/${t.ticketId}`} className="text-primary font-medium hover:underline">{t.ticketId}</Link></td>
                          <td className="px-4 py-3 text-muted-foreground">{t.category} — {t.subcategory}</td>
                          <td className="px-4 py-3"><span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", PRIORITY_COLORS[t.priority])}>{t.priority}</span></td>
                          <td className="px-4 py-3"><span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", TICKET_STATUS_COLORS[t.status])}>{t.status}</span></td>
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

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Status</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Current Status</span>
                <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", STATUS_COLORS[asset.status])}>{asset.status}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Open Tickets</span>
                <span className="font-bold text-foreground">
                  {relatedTickets.filter(t => !["Resolved","Closed","Rejected"].includes(t.status)).length}
                </span>
              </div>
            </CardContent>
          </Card>

          {(asset.assignedTo || asset.assignedEmail) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Assigned User</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary/20 text-primary font-semibold text-sm">
                      {(asset.assignedTo ?? asset.assignedEmail ?? "?").split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{asset.assignedTo ?? asset.assignedEmail}</p>
                    <p className="text-xs text-muted-foreground">{asset.department}</p>
                    {asset.assignedEmail && <p className="text-xs text-muted-foreground">{asset.assignedEmail}</p>}
                    {asset.assignedAt && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Assigned on{" "}
                        <span className="font-medium text-blue-600">
                          {new Date(asset.assignedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                      </p>
                    )}
                    {asset.acknowledged ? (
                      <span className="inline-flex items-center gap-1 mt-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                        Acknowledged
                        {asset.acknowledgedAt && (
                          <span className="font-normal text-emerald-600 ml-0.5">
                            · {new Date(asset.acknowledgedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 mt-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path strokeLinecap="round" d="M12 8v4m0 4h.01"/></svg>
                        Pending Acknowledgement
                      </span>
                    )}
                  </div>
                </div>
                {(() => {
                  const assignedRow  = [...history].find(r => r.event_type === "assigned");
                  const returnedRow  = [...history].find(r => r.event_type === "returned" || r.event_type === "unassigned");
                  const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
                  return (
                    <div className="border-t border-border pt-3 space-y-2 text-sm">
                      {assignedRow && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Assigned On</span>
                          <span className="font-medium text-blue-600">{fmt(assignedRow.created_at)}</span>
                        </div>
                      )}
                      {returnedRow && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Returned On</span>
                          <span className="font-medium text-emerald-600">{fmt(returnedRow.created_at)}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Warranty</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Purchased</span><span className="font-medium">{asset.purchaseDate}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Expires</span><span className="font-medium">{asset.warrantyEndDate}</span></div>
            </CardContent>
          </Card>

          {/* ── User History ──────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                User History
                {history.length > 0 && (
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{history.length} event{history.length !== 1 ? "s" : ""}</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {historyLoading ? (
                <p className="px-4 py-5 text-center text-xs text-muted-foreground">Loading…</p>
              ) : history.length === 0 ? (
                <p className="px-4 py-5 text-center text-xs text-muted-foreground">No assignment history yet.</p>
              ) : (
                <ol className="relative ml-4 border-l border-border pb-2">
                  {history.map((row, i) => {
                    const isAssigned  = row.event_type === "assigned";
                    const isReturned  = row.event_type === "returned" || row.event_type === "unassigned";
                    const dotClass    = isAssigned
                      ? "bg-blue-500 ring-blue-100"
                      : isReturned
                      ? "bg-emerald-500 ring-emerald-100"
                      : "bg-gray-400 ring-gray-100";
                    const label       = isAssigned ? "Assigned" : isReturned ? "Returned" : row.event_type;
                    const labelClass  = isAssigned
                      ? "text-blue-600 bg-blue-50 border-blue-200"
                      : isReturned
                      ? "text-emerald-600 bg-emerald-50 border-emerald-200"
                      : "text-gray-500 bg-gray-50 border-gray-200";
                    const displayName = [row.user_ecode, row.user_name].filter(Boolean).join(" · ") || row.user_email || "Unknown user";
                    const date        = row.created_at
                      ? new Date(row.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                      : "";
                    return (
                      <li key={row.id ?? i} className="ml-4 mb-4 last:mb-0">
                        <span className={cn("absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ring-4", dotClass)} />
                        <div className="pl-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold", labelClass)}>{label}</span>
                            <span className="text-xs text-muted-foreground">{date}</span>
                          </div>
                          <p className="mt-0.5 text-sm font-medium text-foreground leading-snug">{displayName}</p>
                          {row.department && <p className="text-xs text-muted-foreground">{row.department}</p>}
                          {row.user_email && row.user_name && <p className="text-xs text-muted-foreground">{row.user_email}</p>}
                          {row.notes && <p className="mt-1 text-xs italic text-muted-foreground">"{row.notes}"</p>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={assignDialogOpen} onOpenChange={v => !v && closeAssignDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assign {asset.assetId}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">

            {/* Reason for assignment */}
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">
                Reason for Assignment <span className="text-destructive">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["New Joiner", "Replacement", "Additional Asset"] as const).map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAssignReason(r)}
                    className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors text-center ${
                      assignReason === r
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-muted/30 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Search box */}
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">
                Search by Ecode or Name <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  data-testid="input-assign-search"
                  className="pl-8 pr-8"
                  placeholder="e.g. MPE1234 or Anjali…"
                  value={assignSearch}
                  onChange={e => { setAssignSearch(e.target.value); setAssignUserId(""); }}
                  autoFocus
                />
                {assignSearch && (
                  <button
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => { setAssignSearch(""); setAssignUserId(""); }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Results list — only show when no user selected yet */}
            {!selectedUser && (
              <ScrollArea className="max-h-52 rounded-lg border border-border">
                {searchedUsers.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">No users found</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {searchedUsers.map(u => (
                      <li key={u.id}>
                        <button
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                          onClick={() => { setAssignUserId(u.id); setAssignSearch(""); }}
                          data-testid={`user-result-${u.id}`}
                        >
                          <Avatar className="h-7 w-7 flex-shrink-0">
                            <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                              {u.full_name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{u.full_name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {u.ecode && <span className="font-mono mr-1.5">{u.ecode}</span>}
                              {u.department}
                            </p>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            )}

            {/* Selected user confirmation card */}
            {selectedUser && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9 flex-shrink-0">
                    <AvatarFallback className="bg-primary/20 text-primary font-semibold text-sm">
                      {selectedUser.full_name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{selectedUser.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedUser.ecode && <span className="font-mono mr-1.5">{selectedUser.ecode}</span>}
                      {selectedUser.department}
                    </p>
                    <p className="text-xs text-muted-foreground">{selectedUser.email}</p>
                  </div>
                  <button
                    className="text-muted-foreground hover:text-foreground flex-shrink-0"
                    title="Change user"
                    onClick={() => { setAssignUserId(""); setAssignSearch(""); }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAssignDialog}>Cancel</Button>
            <Button onClick={handleAssignConfirm} disabled={!assignUserId || !assignReason} data-testid="button-confirm-assign-detail">
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
