import { useParams, Link } from "wouter";
import {
  ArrowLeft, Monitor, Smartphone, Calendar, MapPin,
  User, Building, Tag, Package, Edit, AlertTriangle,
  Wrench, Archive, UserPlus,
} from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAssets } from "@/context/AssetContext";
import { useTickets } from "@/context/TicketContext";
import { useUsers } from "@/context/UsersContext";
import { useAuth } from "@/context/AuthContext";
import { AssetStatus } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<AssetStatus, string> = {
  Available:      "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Assigned:       "bg-blue-500/15 text-blue-600 border-blue-500/20",
  "Under Repair": "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Lost:           "bg-red-500/15 text-red-500 border-red-500/20",
  Retired:        "bg-gray-500/15 text-gray-500 border-gray-500/20",
};
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

  const asset          = getAsset(id);
  const relatedTickets = tickets.filter(t => t.assetId === id);
  const isAdmin        = currentUser?.role === "super_admin" || currentUser?.role === "it_admin";
  const canEdit        = isAdmin || currentUser?.role === "it_agent";
  const activeUsers    = users.filter(u => u.status === "Active");
  const selectedUser   = users.find(u => u.id === assignUserId);

  const handleAssignConfirm = async () => {
    if (!asset || !selectedUser) return;
    try {
      await assignAsset(asset.assetId, selectedUser.full_name, selectedUser.email, selectedUser.department);
      toast({ title: "Asset assigned", description: `Assigned to ${selectedUser.full_name}` });
      setAssignDialogOpen(false);
      setAssignUserId("");
    } catch (err) {
      toast({ title: "Failed to assign asset", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    }
  };

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
          {isAdmin && asset.status !== "Assigned" && asset.status !== "Retired" && (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => { setAssignDialogOpen(true); setAssignUserId(""); }} data-testid="button-assign">
              <UserPlus className="h-4 w-4" /> Assign
            </Button>
          )}
          {isAdmin && asset.status === "Assigned" && (
            <Button variant="outline" size="sm" className="gap-2" onClick={handleUnassign}>
              <UserPlus className="h-4 w-4" /> Unassign
            </Button>
          )}
          {isAdmin && asset.status !== "Under Repair" && asset.status !== "Retired" && (
            <Button variant="outline" size="sm" className="gap-2 text-amber-600 border-amber-300 hover:bg-amber-50" onClick={() => handleUpdateStatus("Under Repair")} data-testid="button-mark-repair">
              <Wrench className="h-4 w-4" /> Mark Repair
            </Button>
          )}
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

          {asset.assignedTo && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Assigned User</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary/20 text-primary font-semibold text-sm">
                      {asset.assignedTo.split(" ").map(n => n[0]).join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{asset.assignedTo}</p>
                    <p className="text-xs text-muted-foreground">{asset.department}</p>
                    {asset.assignedEmail && <p className="text-xs text-muted-foreground">{asset.assignedEmail}</p>}
                  </div>
                </div>
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
        </div>
      </div>

      <Dialog open={assignDialogOpen} onOpenChange={v => !v && setAssignDialogOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assign {asset.assetId}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Select User <span className="text-destructive">*</span></label>
              <Select value={assignUserId} onValueChange={setAssignUserId}>
                <SelectTrigger data-testid="select-assign-user-detail"><SelectValue placeholder="Choose a user…" /></SelectTrigger>
                <SelectContent>
                  {activeUsers.map(u => (
                    <SelectItem key={u.id} value={u.id}>
                      <span>{u.full_name} <span className="text-muted-foreground text-xs">— {u.department}</span></span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedUser && (
              <div className="rounded-lg bg-muted/50 border border-border px-4 py-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Department</span><span className="font-medium">{selectedUser.department}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="text-xs font-medium">{selectedUser.email}</span></div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAssignConfirm} disabled={!assignUserId} data-testid="button-confirm-assign-detail">Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
