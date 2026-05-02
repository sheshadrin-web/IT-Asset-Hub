import { useState } from "react";
import { Link } from "wouter";
import {
  Plus, Search, Monitor, Smartphone, Eye, Edit,
  UserPlus, Wrench, Archive, MoreHorizontal, X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAssets } from "@/context/AssetContext";
import { useAuth } from "@/context/AuthContext";
import { mockUsers, AssetStatus, AssetType } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<AssetStatus, string> = {
  Available:      "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Assigned:       "bg-blue-500/15 text-blue-600 border-blue-500/20",
  "Under Repair": "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Lost:           "bg-red-500/15 text-red-500 border-red-500/20",
  Retired:        "bg-gray-500/15 text-gray-500 border-gray-500/20",
};

const STATUS_DOT: Record<AssetStatus, string> = {
  Available:      "bg-emerald-500",
  Assigned:       "bg-blue-500",
  "Under Repair": "bg-amber-500",
  Lost:           "bg-red-500",
  Retired:        "bg-gray-400",
};

export default function Assets() {
  const { assets, assignAsset, updateStatus, unassignAsset } = useAssets();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [search, setSearch]             = useState("");
  const [typeFilter, setTypeFilter]     = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Assign dialog state
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [assignUser, setAssignUser]     = useState("");

  const isAdmin = currentUser?.role === "super_admin";
  const canEdit = currentUser?.role === "super_admin" || currentUser?.role === "agent";

  const filtered = assets.filter((a) => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || a.assetId.toLowerCase().includes(q)
      || a.serialNumber.toLowerCase().includes(q)
      || a.model.toLowerCase().includes(q)
      || a.brand.toLowerCase().includes(q)
      || (a.assignedTo?.toLowerCase().includes(q) ?? false);
    const matchType   = typeFilter   === "all" || a.assetType === typeFilter;
    const matchStatus = statusFilter === "all" || a.status    === statusFilter;
    return matchSearch && matchType && matchStatus;
  });

  const activeUsers = mockUsers.filter((u) => u.status === "Active");
  const selectedUser = mockUsers.find((u) => u.userId === assignUser);

  const handleAssignConfirm = () => {
    if (!assignTarget || !selectedUser) return;
    assignAsset(assignTarget, selectedUser.name, selectedUser.department);
    toast({ title: "Asset assigned", description: `${assignTarget} assigned to ${selectedUser.name}` });
    setAssignTarget(null);
    setAssignUser("");
  };

  const handleMarkRepair = (assetId: string) => {
    updateStatus(assetId, "Under Repair");
    toast({ title: "Marked as Under Repair", description: assetId });
  };

  const handleRetire = (assetId: string) => {
    updateStatus(assetId, "Retired");
    toast({ title: "Asset retired", description: assetId });
  };

  const counts = {
    total:    assets.length,
    available:assets.filter((a) => a.status === "Available").length,
    assigned: assets.filter((a) => a.status === "Assigned").length,
    repair:   assets.filter((a) => a.status === "Under Repair").length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Asset Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{assets.length} total assets</p>
        </div>
        {isAdmin && (
          <Link href="/assets/new">
            <Button className="gap-2" data-testid="button-add-asset">
              <Plus className="h-4 w-4" /> Add Asset
            </Button>
          </Link>
        )}
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: "Total",        val: counts.total,     color: "bg-slate-100 text-slate-700 border-slate-200" },
          { label: "Available",    val: counts.available, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
          { label: "Assigned",     val: counts.assigned,  color: "bg-blue-50 text-blue-700 border-blue-200" },
          { label: "Under Repair", val: counts.repair,    color: "bg-amber-50 text-amber-700 border-amber-200" },
        ].map((chip) => (
          <span key={chip.label} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", chip.color)}>
            <span className="font-bold">{chip.val}</span> {chip.label}
          </span>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by Asset ID, serial, model, or assigned user…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-assets"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-40" data-testid="select-type-filter">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Laptop">
                  <span className="flex items-center gap-2"><Monitor className="h-3.5 w-3.5" /> Laptop</span>
                </SelectItem>
                <SelectItem value="Mobile">
                  <span className="flex items-center gap-2"><Smartphone className="h-3.5 w-3.5" /> Mobile</span>
                </SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {(["Available","Assigned","Under Repair","Lost","Retired"] as AssetStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[s])} />
                      {s}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Asset ID","Type","Brand / Model","Serial Number","Assigned To","Department","Status","Warranty End","Actions"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-14 text-center text-muted-foreground">
                      No assets match your filters.
                    </td>
                  </tr>
                )}
                {filtered.map((asset) => (
                  <tr
                    key={asset.assetId}
                    className="border-b border-border last:border-0 hover:bg-muted/25 transition-colors"
                    data-testid={`row-asset-${asset.assetId}`}
                  >
                    {/* Asset ID */}
                    <td className="px-4 py-3">
                      <Link href={`/assets/${asset.assetId}`} className="font-semibold text-primary hover:underline">
                        {asset.assetId}
                      </Link>
                    </td>
                    {/* Type */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        {asset.assetType === "Laptop"
                          ? <Monitor className="h-3.5 w-3.5 text-blue-500" />
                          : <Smartphone className="h-3.5 w-3.5 text-indigo-500" />}
                        <span className="text-xs font-medium text-foreground">{asset.assetType}</span>
                      </div>
                    </td>
                    {/* Brand / Model */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground leading-tight">{asset.brand}</div>
                      <div className="text-xs text-muted-foreground">{asset.model}</div>
                    </td>
                    {/* Serial */}
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{asset.serialNumber}</td>
                    {/* Assigned To */}
                    <td className="px-4 py-3">
                      {asset.assignedTo ? (
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6 flex-shrink-0">
                            <AvatarFallback className="text-[10px] bg-primary/20 text-primary font-semibold">
                              {asset.assignedTo.split(" ").map((n) => n[0]).join("")}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm text-foreground">{asset.assignedTo}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    {/* Department */}
                    <td className="px-4 py-3 text-muted-foreground text-xs">{asset.department ?? "—"}</td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium", STATUS_COLORS[asset.status])}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[asset.status])} />
                        {asset.status}
                      </span>
                    </td>
                    {/* Warranty */}
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{asset.warrantyEndDate}</td>
                    {/* Actions */}
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-actions-${asset.assetId}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem asChild>
                            <Link href={`/assets/${asset.assetId}`} className="flex items-center gap-2 cursor-pointer">
                              <Eye className="h-3.5 w-3.5 text-muted-foreground" /> View Details
                            </Link>
                          </DropdownMenuItem>
                          {canEdit && (
                            <DropdownMenuItem asChild>
                              <Link href={`/assets/${asset.assetId}/edit`} className="flex items-center gap-2 cursor-pointer">
                                <Edit className="h-3.5 w-3.5 text-muted-foreground" /> Edit
                              </Link>
                            </DropdownMenuItem>
                          )}
                          {isAdmin && asset.status !== "Retired" && (
                            <>
                              <DropdownMenuSeparator />
                              {asset.status !== "Assigned" ? (
                                <DropdownMenuItem
                                  onClick={() => { setAssignTarget(asset.assetId); setAssignUser(""); }}
                                  className="flex items-center gap-2 cursor-pointer"
                                >
                                  <UserPlus className="h-3.5 w-3.5 text-muted-foreground" /> Assign
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() => { unassignAsset(asset.assetId); toast({ title: "Asset unassigned" }); }}
                                  className="flex items-center gap-2 cursor-pointer"
                                >
                                  <UserPlus className="h-3.5 w-3.5 text-muted-foreground" /> Unassign
                                </DropdownMenuItem>
                              )}
                              {asset.status !== "Under Repair" && (
                                <DropdownMenuItem
                                  onClick={() => handleMarkRepair(asset.assetId)}
                                  className="flex items-center gap-2 cursor-pointer"
                                >
                                  <Wrench className="h-3.5 w-3.5 text-amber-500" /> Mark Repair
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => handleRetire(asset.assetId)}
                                className="flex items-center gap-2 cursor-pointer text-muted-foreground focus:text-foreground"
                              >
                                <Archive className="h-3.5 w-3.5" /> Retire
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && (
            <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
              Showing {filtered.length} of {assets.length} assets
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assign Dialog */}
      <Dialog open={!!assignTarget} onOpenChange={(v) => !v && setAssignTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Asset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-xs text-muted-foreground mb-1 font-medium">Asset</p>
              <p className="text-sm font-semibold text-foreground">{assignTarget}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">
                Select User <span className="text-destructive">*</span>
              </label>
              <Select value={assignUser} onValueChange={setAssignUser}>
                <SelectTrigger data-testid="select-assign-user">
                  <SelectValue placeholder="Choose a user…" />
                </SelectTrigger>
                <SelectContent>
                  {activeUsers.map((u) => (
                    <SelectItem key={u.userId} value={u.userId}>
                      <span className="flex flex-col">
                        <span className="font-medium">{u.name}</span>
                        <span className="text-xs text-muted-foreground">{u.department}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedUser && (
              <div className="rounded-lg bg-muted/50 border border-border px-4 py-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">User</span>
                  <span className="font-medium">{selectedUser.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Department</span>
                  <span className="font-medium">{selectedUser.department}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium text-xs">{selectedUser.email}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button
              onClick={handleAssignConfirm}
              disabled={!assignUser}
              data-testid="button-confirm-assign"
            >
              Assign Asset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
