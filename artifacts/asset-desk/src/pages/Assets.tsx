import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  Plus, Search, Monitor, Smartphone, Eye, Edit,
  UserPlus, Wrench, Archive, MoreHorizontal, X,
  Upload, Download, Trash2, FileText, AlertCircle, CheckCircle2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAssets } from "@/context/AssetContext";
import { useAuth } from "@/context/AuthContext";
import { mockUsers, AssetStatus, Asset } from "@/data/mockData";
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

// ─── CSV helpers ────────────────────────────────────────────────────────────
const CSV_HEADERS = [
  "assetType","brand","model","serialNumber","imeiNumber",
  "purchaseDate","warrantyEndDate","location","accessories","remarks",
];

const CSV_TEMPLATE = [
  CSV_HEADERS.join(","),
  "Laptop,Dell,Latitude 5540,SN-EXAMPLE-001,,2024-01-15,2027-01-15,IT Storage,Charger,New stock",
  "Mobile,Apple,iPhone 15 Pro,SN-EXAMPLE-002,358765432109876,2024-02-01,2026-02-01,IT Storage,Charger,",
].join("\n");

interface ParsedRow {
  index: number;
  data: Partial<Omit<Asset, "assetId">> & { assetType?: string };
  errors: string[];
}

function parseCsvText(text: string): ParsedRow[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const [headerLine, ...dataLines] = lines;
  const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

  return dataLines.map((line, i) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = values[j] ?? ""; });

    const errors: string[] = [];
    if (!["Laptop","Mobile"].includes(row.assetType ?? ""))
      errors.push("assetType must be Laptop or Mobile");
    if (!row.brand) errors.push("brand is required");
    if (!row.model) errors.push("model is required");
    if (!row.serialNumber) errors.push("serialNumber is required");
    if (!row.purchaseDate) errors.push("purchaseDate is required");
    if (!row.warrantyEndDate) errors.push("warrantyEndDate is required");
    if (!row.location) errors.push("location is required");

    return {
      index: i + 1,
      data: {
        assetType:      (row.assetType as "Laptop" | "Mobile") || "Laptop",
        brand:          row.brand,
        model:          row.model,
        serialNumber:   row.serialNumber,
        imeiNumber:     row.imeiNumber || undefined,
        purchaseDate:   row.purchaseDate,
        warrantyEndDate:row.warrantyEndDate,
        status:         "Available" as AssetStatus,
        location:       row.location,
        accessories:    row.accessories ?? "",
        remarks:        row.remarks ?? "",
      },
      errors,
    };
  });
}

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "asset_bulk_upload_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function Assets() {
  const { assets, addAssets, assignAsset, updateStatus, unassignAsset, deleteAssets } = useAssets();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  // Filters
  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Row selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const selectAllRef = useRef<HTMLButtonElement>(null);

  // Assign dialog
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [assignUser, setAssignUser]     = useState("");

  // Bulk upload dialog
  const [uploadOpen, setUploadOpen]     = useState(false);
  const [parsedRows, setParsedRows]     = useState<ParsedRow[]>([]);
  const [uploadFileName, setUploadFileName] = useState("");
  const [dragOver, setDragOver]         = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const allFilteredIds   = filtered.map((a) => a.assetId);
  const allSelected      = allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.has(id));
  const someSelected     = allFilteredIds.some((id) => selected.has(id)) && !allSelected;
  const selectedCount    = [...selected].filter((id) => allFilteredIds.includes(id)).length;

  // Sync indeterminate state on the select-all checkbox
  useEffect(() => {
    if (selectAllRef.current) {
      (selectAllRef.current as unknown as HTMLInputElement).indeterminate = someSelected;
    }
  }, [someSelected]);

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        allFilteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => new Set([...prev, ...allFilteredIds]));
    }
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkDelete = () => {
    const ids = [...selected].filter((id) => allFilteredIds.includes(id));
    deleteAssets(ids);
    setSelected(new Set());
    setDeleteConfirmOpen(false);
    toast({ title: `${ids.length} asset${ids.length !== 1 ? "s" : ""} deleted` });
  };

  // Assign
  const activeUsers  = mockUsers.filter((u) => u.status === "Active");
  const selectedUser = mockUsers.find((u) => u.userId === assignUser);

  const handleAssignConfirm = () => {
    if (!assignTarget || !selectedUser) return;
    assignAsset(assignTarget, selectedUser.name, selectedUser.department);
    toast({ title: "Asset assigned", description: `${assignTarget} → ${selectedUser.name}` });
    setAssignTarget(null);
    setAssignUser("");
  };

  // Status actions
  const handleMarkRepair = (id: string) => { updateStatus(id, "Under Repair"); toast({ title: "Marked as Under Repair", description: id }); };
  const handleRetire     = (id: string) => { updateStatus(id, "Retired");      toast({ title: "Asset retired", description: id }); };

  // ─── CSV Upload ───────────────────────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast({ title: "Invalid file", description: "Please upload a .csv file", variant: "destructive" });
      return;
    }
    setUploadFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setParsedRows(parseCsvText(text));
    };
    reader.readAsText(file);
  }, [toast]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const validRows   = parsedRows.filter((r) => r.errors.length === 0);
  const invalidRows = parsedRows.filter((r) => r.errors.length > 0);

  const handleImport = () => {
    const toImport = validRows.map((r) => r.data as Omit<Asset, "assetId">);
    const created  = addAssets(toImport);
    toast({ title: `${created.length} asset${created.length !== 1 ? "s" : ""} imported successfully` });
    setUploadOpen(false);
    setParsedRows([]);
    setUploadFileName("");
  };

  const counts = {
    total:    assets.length,
    available:assets.filter((a) => a.status === "Available").length,
    assigned: assets.filter((a) => a.status === "Assigned").length,
    repair:   assets.filter((a) => a.status === "Under Repair").length,
  };

  return (
    <div className="space-y-5 pb-20">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Asset Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{assets.length} total assets</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={() => { setParsedRows([]); setUploadFileName(""); setUploadOpen(true); }} data-testid="button-bulk-upload">
              <Upload className="h-4 w-4" /> Bulk Upload
            </Button>
            <Link href="/assets/new">
              <Button className="gap-2" data-testid="button-add-asset">
                <Plus className="h-4 w-4" /> Add Asset
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* ── Summary chips ── */}
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

      {/* ── Filters ── */}
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
                <SelectItem value="Laptop"><span className="flex items-center gap-2"><Monitor className="h-3.5 w-3.5" /> Laptop</span></SelectItem>
                <SelectItem value="Mobile"><span className="flex items-center gap-2"><Smartphone className="h-3.5 w-3.5" /> Mobile</span></SelectItem>
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
                      <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[s])} /> {s}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Table ── */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {/* Select-all checkbox */}
                  {isAdmin && (
                    <th className="w-10 px-3 py-3">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Select all"
                        data-testid="checkbox-select-all"
                        className={someSelected ? "data-[state=unchecked]:bg-primary/20" : ""}
                      />
                    </th>
                  )}
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
                    <td colSpan={isAdmin ? 10 : 9} className="px-4 py-14 text-center text-muted-foreground">
                      No assets match your filters.
                    </td>
                  </tr>
                )}
                {filtered.map((asset) => {
                  const isSelected = selected.has(asset.assetId);
                  return (
                    <tr
                      key={asset.assetId}
                      className={cn(
                        "border-b border-border last:border-0 transition-colors",
                        isSelected ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-muted/25"
                      )}
                      data-testid={`row-asset-${asset.assetId}`}
                    >
                      {/* Row checkbox */}
                      {isAdmin && (
                        <td className="w-10 px-3 py-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleRow(asset.assetId)}
                            aria-label={`Select ${asset.assetId}`}
                            data-testid={`checkbox-${asset.assetId}`}
                          />
                        </td>
                      )}

                      {/* Asset ID */}
                      <td className="px-4 py-3">
                        <Link href={`/assets/${asset.assetId}`} className="font-semibold text-primary hover:underline">
                          {asset.assetId}
                        </Link>
                      </td>
                      {/* Type */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
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
                                  <DropdownMenuItem onClick={() => { setAssignTarget(asset.assetId); setAssignUser(""); }} className="flex items-center gap-2 cursor-pointer">
                                    <UserPlus className="h-3.5 w-3.5 text-muted-foreground" /> Assign
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => { unassignAsset(asset.assetId); toast({ title: "Asset unassigned" }); }} className="flex items-center gap-2 cursor-pointer">
                                    <UserPlus className="h-3.5 w-3.5 text-muted-foreground" /> Unassign
                                  </DropdownMenuItem>
                                )}
                                {asset.status !== "Under Repair" && (
                                  <DropdownMenuItem onClick={() => handleMarkRepair(asset.assetId)} className="flex items-center gap-2 cursor-pointer">
                                    <Wrench className="h-3.5 w-3.5 text-amber-500" /> Mark Repair
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => handleRetire(asset.assetId)} className="flex items-center gap-2 cursor-pointer text-muted-foreground">
                                  <Archive className="h-3.5 w-3.5" /> Retire
                                </DropdownMenuItem>
                              </>
                            )}
                            {isAdmin && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => { setSelected(new Set([asset.assetId])); setDeleteConfirmOpen(true); }}
                                  className="flex items-center gap-2 cursor-pointer text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && (
            <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
              Showing {filtered.length} of {assets.length} assets
              {selectedCount > 0 && (
                <span className="ml-2 text-primary font-medium">· {selectedCount} selected</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Bulk action bar (floats at bottom when rows are selected) ── */}
      {isAdmin && selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-border bg-popover shadow-xl px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Checkbox checked readOnly className="pointer-events-none" />
            <span>{selectedCount} asset{selectedCount !== 1 ? "s" : ""} selected</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="gap-2"
            onClick={() => setDeleteConfirmOpen(true)}
            data-testid="button-bulk-delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete {selectedCount}
          </Button>
        </div>
      )}

      {/* ── Assign Dialog ── */}
      <Dialog open={!!assignTarget} onOpenChange={(v) => !v && setAssignTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assign Asset</DialogTitle></DialogHeader>
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
                      <span className="font-medium">{u.name}</span>
                      <span className="text-xs text-muted-foreground ml-1">· {u.department}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedUser && (
              <div className="rounded-lg bg-muted/50 border border-border px-4 py-3 text-sm space-y-1">
                {[
                  { label: "User",       val: selectedUser.name },
                  { label: "Department", val: selectedUser.department },
                  { label: "Email",      val: selectedUser.email },
                ].map((r) => (
                  <div key={r.label} className="flex justify-between">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-medium text-xs">{r.val}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button onClick={handleAssignConfirm} disabled={!assignUser} data-testid="button-confirm-assign">
              Assign Asset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Delete Confirm ── */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} Asset{selectedCount !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the selected asset{selectedCount !== 1 ? "s" : ""} from the system.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmOpen(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Bulk Upload Dialog ── */}
      <Dialog open={uploadOpen} onOpenChange={(v) => { if (!v) { setUploadOpen(false); setParsedRows([]); setUploadFileName(""); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" /> Bulk Upload Assets
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2">
            {/* Instructions */}
            <div className="flex items-start gap-3 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
              <FileText className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-500" />
              <div className="space-y-1">
                <p className="font-medium">How it works</p>
                <p className="text-xs text-blue-700">Upload a CSV file with your asset data. Required columns: <code className="bg-blue-100 px-1 rounded">assetType</code>, <code className="bg-blue-100 px-1 rounded">brand</code>, <code className="bg-blue-100 px-1 rounded">model</code>, <code className="bg-blue-100 px-1 rounded">serialNumber</code>, <code className="bg-blue-100 px-1 rounded">purchaseDate</code>, <code className="bg-blue-100 px-1 rounded">warrantyEndDate</code>, <code className="bg-blue-100 px-1 rounded">location</code>.</p>
              </div>
            </div>

            {/* Download template */}
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={downloadTemplate}
              data-testid="button-download-template"
            >
              <Download className="h-3.5 w-3.5" /> Download CSV Template
            </Button>

            {/* Drop zone */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileInput}
            />
            <div
              className={cn(
                "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all",
                dragOver
                  ? "border-primary bg-primary/5"
                  : uploadFileName
                    ? "border-emerald-400 bg-emerald-50"
                    : "border-border hover:border-primary/40 hover:bg-muted/30"
              )}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              data-testid="upload-dropzone"
            >
              {uploadFileName ? (
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  <p className="text-sm font-semibold text-foreground">{uploadFileName}</p>
                  <p className="text-xs text-muted-foreground">{parsedRows.length} rows detected — click to replace</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-semibold text-foreground">Click to upload or drag & drop</p>
                  <p className="text-xs text-muted-foreground">.csv files only</p>
                </div>
              )}
            </div>

            {/* Preview */}
            {parsedRows.length > 0 && (
              <div className="space-y-3">
                {/* Summary */}
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                    <CheckCircle2 className="h-4 w-4" /> {validRows.length} valid
                  </span>
                  {invalidRows.length > 0 && (
                    <span className="flex items-center gap-1.5 text-red-500 font-medium">
                      <AlertCircle className="h-4 w-4" /> {invalidRows.length} with errors (will be skipped)
                    </span>
                  )}
                </div>

                {/* Table preview */}
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="overflow-x-auto max-h-56">
                    <table className="w-full text-xs min-w-[600px]">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="px-3 py-2 text-left text-muted-foreground font-semibold uppercase">#</th>
                          <th className="px-3 py-2 text-left text-muted-foreground font-semibold uppercase">Type</th>
                          <th className="px-3 py-2 text-left text-muted-foreground font-semibold uppercase">Brand</th>
                          <th className="px-3 py-2 text-left text-muted-foreground font-semibold uppercase">Model</th>
                          <th className="px-3 py-2 text-left text-muted-foreground font-semibold uppercase">Serial</th>
                          <th className="px-3 py-2 text-left text-muted-foreground font-semibold uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.map((row) => (
                          <tr
                            key={row.index}
                            className={cn(
                              "border-b border-border last:border-0",
                              row.errors.length > 0 ? "bg-red-50" : "hover:bg-muted/20"
                            )}
                          >
                            <td className="px-3 py-2 text-muted-foreground">{row.index}</td>
                            <td className="px-3 py-2">{row.data.assetType ?? <span className="text-red-500">—</span>}</td>
                            <td className="px-3 py-2">{row.data.brand || <span className="text-red-500">—</span>}</td>
                            <td className="px-3 py-2">{row.data.model || <span className="text-red-500">—</span>}</td>
                            <td className="px-3 py-2 font-mono">{row.data.serialNumber || <span className="text-red-500">—</span>}</td>
                            <td className="px-3 py-2">
                              {row.errors.length > 0 ? (
                                <span className="text-red-500 flex items-center gap-1">
                                  <AlertCircle className="h-3 w-3" /> {row.errors[0]}
                                </span>
                              ) : (
                                <span className="text-emerald-600 flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> OK
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="border-t border-border pt-4 mt-2">
            <Button variant="outline" onClick={() => { setUploadOpen(false); setParsedRows([]); setUploadFileName(""); }}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={validRows.length === 0}
              className="gap-2"
              data-testid="button-confirm-import"
            >
              <Upload className="h-3.5 w-3.5" />
              Import {validRows.length > 0 ? `${validRows.length} Asset${validRows.length !== 1 ? "s" : ""}` : "Assets"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
