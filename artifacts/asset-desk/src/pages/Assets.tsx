import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  Plus, Search, Monitor, Smartphone, Eye, Edit,
  UserPlus, Wrench, Archive, MoreHorizontal, X,
  Upload, Download, Trash2, FileText, AlertCircle, CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAssets } from "@/context/AssetContext";
import { useUsers } from "@/context/UsersContext";
import { useAuth } from "@/context/AuthContext";
import { AssetStatus, Asset } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<AssetStatus, string> = {
  "In Procurement": "bg-orange-500/15 text-orange-600 border-orange-500/20",
  Available:        "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Assigned:         "bg-blue-500/15 text-blue-600 border-blue-500/20",
  "Under Repair":   "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Lost:             "bg-red-500/15 text-red-500 border-red-500/20",
  Retired:          "bg-gray-500/15 text-gray-500 border-gray-500/20",
};
const STATUS_DOT: Record<AssetStatus, string> = {
  "In Procurement": "bg-orange-500",
  Available:        "bg-emerald-500",
  Assigned:         "bg-blue-500",
  "Under Repair":   "bg-amber-500",
  Lost:             "bg-red-500",
  Retired:          "bg-gray-400",
};

const CSV_HEADERS = [
  "assetId","assetType","brand","model","serialNumber","imeiNumber",
  "purchaseDate","warrantyEndDate","location","accessories","remarks",
];
const CSV_TEMPLATE = [
  CSV_HEADERS.join(","),
  "LAP-001,Laptop,Dell,Latitude 5540,SN-EXAMPLE-001,,2024-01-15,2027-01-15,IT Storage,Charger,New stock",
  "MOB-001,Mobile,Apple,iPhone 15 Pro,SN-EXAMPLE-002,358765432109876,2024-02-01,2026-02-01,IT Storage,Charger,",
  "DSK-001,Desktop,Dell,OptiPlex 7090,SN-EXAMPLE-003,,2024-03-01,2027-03-01,IT Storage,Power Cable,",
].join("\n");

interface ParsedRow {
  index: number;
  data: Partial<Omit<Asset, "id">> & { assetType?: string };
  errors: string[];
}

function parseCsvText(text: string): ParsedRow[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const [headerLine, ...dataLines] = lines;
  const headers = headerLine.split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return dataLines.map((line, i) => {
    const values = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = values[j] ?? ""; });
    const errors: string[] = [];
    if (!row.assetId) errors.push("assetId is required");
    if (!["Laptop", "Mobile", "Desktop"].includes(row.assetType ?? "")) errors.push("assetType must be Laptop, Mobile, or Desktop");
    if (!row.brand) errors.push("brand is required");
    if (!row.model) errors.push("model is required");
    if (!row.serialNumber) errors.push("serialNumber is required");
    if (!row.purchaseDate) errors.push("purchaseDate is required");
    if (!row.warrantyEndDate) errors.push("warrantyEndDate is required");
    if (!row.location) errors.push("location is required");
    return {
      index: i + 1,
      data: {
        assetId:         row.assetId,
        assetType:       (row.assetType as "Laptop" | "Mobile" | "Desktop") || "Laptop",
        brand:           row.brand,
        model:           row.model,
        serialNumber:    row.serialNumber,
        imeiNumber:      row.imeiNumber || undefined,
        purchaseDate:    row.purchaseDate,
        warrantyEndDate: row.warrantyEndDate,
        status:          "Available" as AssetStatus,
        location:        row.location,
        accessories:     row.accessories ?? "",
        remarks:         row.remarks ?? "",
      },
      errors,
    };
  });
}

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "asset_bulk_upload_template.csv"; a.click();
  URL.revokeObjectURL(url);
}

export default function Assets() {
  const { assets, addAssets, assignAsset, updateStatus, unassignAsset, deleteAssets } = useAssets();
  const { users } = useUsers();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [search, setSearch]           = useState("");
  const [typeFilter, setTypeFilter]   = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const selectAllRef = useRef<HTMLButtonElement>(null);

  // Assign state
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [assignStep,   setAssignStep]   = useState<"select" | "handover">("select");
  const [assignUser,   setAssignUser]   = useState("");
  const [handoverDate, setHandoverDate] = useState(new Date().toISOString().split("T")[0]);
  const [handoverAcc,  setHandoverAcc]  = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  const [assignConfirmOpen, setAssignConfirmOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);

  // Bulk upload
  const [uploadOpen, setUploadOpen]   = useState(false);
  const [parsedRows, setParsedRows]   = useState<ParsedRow[]>([]);
  const [uploadFileName, setUploadFileName] = useState("");
  const [dragOver, setDragOver]       = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "it_admin";
  const canEdit = isAdmin || currentUser?.role === "it_agent";

  const filtered = assets.filter(a => {
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

  const allFilteredIds = filtered.map(a => a.assetId);
  const allSelected    = allFilteredIds.length > 0 && allFilteredIds.every(id => selected.has(id));
  const someSelected   = allFilteredIds.some(id => selected.has(id)) && !allSelected;
  const selectedCount  = [...selected].filter(id => allFilteredIds.includes(id)).length;

  useEffect(() => {
    if (selectAllRef.current)
      (selectAllRef.current as unknown as HTMLInputElement).indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); allFilteredIds.forEach(id => n.delete(id)); return n; });
    } else {
      setSelected(prev => new Set([...prev, ...allFilteredIds]));
    }
  };
  const toggleRow = (id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleBulkDelete = async () => {
    const ids = [...selected].filter(id => allFilteredIds.includes(id));
    try {
      await deleteAssets(ids);
      setSelected(new Set()); setDeleteConfirmOpen(false);
      toast({ title: `${ids.length} asset${ids.length !== 1 ? "s" : ""} deleted` });
    } catch {
      toast({ title: "Failed to delete assets", variant: "destructive" });
    }
  };

  const activeUsers  = users.filter(u => u.status === "active");
  const selectedUser = users.find(u => u.id === assignUser);
  const assignAssetObj = assets.find(a => a.assetId === assignTarget);

  const openAssignDialog = (assetId: string) => {
    const a = assets.find(x => x.assetId === assetId);
    setAssignTarget(assetId);
    setAssignUser("");
    setAssignStep("select");
    setHandoverDate(new Date().toISOString().split("T")[0]);
    setHandoverAcc(a?.accessories ?? "");
    setHandoverNote("");
  };

  const handleAssignConfirm = async () => {
    if (!assignTarget || !selectedUser) return;
    setAssigning(true);
    try {
      const note = [
        `Handover Date: ${handoverDate}`,
        handoverAcc  ? `Accessories: ${handoverAcc}` : "",
        handoverNote ? `Notes: ${handoverNote}` : "",
      ].filter(Boolean).join(" | ");
      await assignAsset(assignTarget, selectedUser.id, selectedUser.full_name, selectedUser.email, selectedUser.department ?? "", note);
      toast({ title: "Asset assigned", description: `${assignTarget} → ${selectedUser.full_name}` });
    } catch (err) {
      toast({ title: "Failed to assign asset", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
    setAssigning(false);
    setAssignTarget(null);
    setAssignConfirmOpen(false);
  };

  const handleMarkRepair = async (id: string) => {
    try { await updateStatus(id, "Under Repair"); toast({ title: "Marked as Under Repair", description: id }); }
    catch { toast({ title: "Failed to update status", variant: "destructive" }); }
  };
  const handleRetire = async (id: string) => {
    try { await updateStatus(id, "Retired"); toast({ title: "Asset retired", description: id }); }
    catch { toast({ title: "Failed to retire asset", variant: "destructive" }); }
  };
  const handleMarkAvailable = async (id: string) => {
    try { await updateStatus(id, "Available"); toast({ title: "Marked as Available", description: id }); }
    catch { toast({ title: "Failed to update status", variant: "destructive" }); }
  };

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast({ title: "Invalid file", description: "Please upload a .csv file", variant: "destructive" });
      return;
    }
    setUploadFileName(file.name);
    const reader = new FileReader();
    reader.onload = e => setParsedRows(parseCsvText(e.target?.result as string));
    reader.readAsText(file);
  }, [toast]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) handleFile(file); e.target.value = "";
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0]; if (file) handleFile(file);
  };

  const validRows   = parsedRows.filter(r => r.errors.length === 0);
  const invalidRows = parsedRows.filter(r => r.errors.length > 0);

  const handleImport = async () => {
    try {
      const created = await addAssets(validRows.map(r => r.data as Omit<Asset, "id">));
      toast({ title: `${created.length} asset${created.length !== 1 ? "s" : ""} imported successfully` });
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    }
    setUploadOpen(false); setParsedRows([]); setUploadFileName("");
  };

  const counts = {
    total:     assets.length,
    available: assets.filter(a => a.status === "Available").length,
    assigned:  assets.filter(a => a.status === "Assigned").length,
    repair:    assets.filter(a => a.status === "Under Repair").length,
  };

  return (
    <div className="space-y-5 pb-20">
      {/* Header */}
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

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: "Total",        val: counts.total,     color: "bg-slate-100 text-slate-700 border-slate-200" },
          { label: "Available",    val: counts.available, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
          { label: "Assigned",     val: counts.assigned,  color: "bg-blue-50 text-blue-700 border-blue-200" },
          { label: "Under Repair", val: counts.repair,    color: "bg-amber-50 text-amber-700 border-amber-200" },
        ].map(chip => (
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
                className="pl-9" value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-search-assets"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-40" data-testid="select-type-filter"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Laptop"><span className="flex items-center gap-2"><Monitor className="h-3.5 w-3.5" /> Laptop</span></SelectItem>
                <SelectItem value="Mobile"><span className="flex items-center gap-2"><Smartphone className="h-3.5 w-3.5" /> Mobile</span></SelectItem>
                <SelectItem value="Desktop"><span className="flex items-center gap-2"><Monitor className="h-3.5 w-3.5" /> Desktop</span></SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44" data-testid="select-status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {(["In Procurement","Available","Assigned","Under Repair","Lost","Retired"] as AssetStatus[]).map(s => (
                  <SelectItem key={s} value={s}>
                    <span className="flex items-center gap-2"><span className={cn("h-2 w-2 rounded-full", STATUS_DOT[s])} />{s}</span>
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
            <table className="w-full text-sm min-w-[960px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {isAdmin && (
                    <th className="w-10 px-3 py-3">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll}
                        aria-label="Select all" data-testid="checkbox-select-all"
                        className={someSelected ? "data-[state=unchecked]:bg-primary/20" : ""}
                      />
                    </th>
                  )}
                  {["Asset ID","Type","Brand / Model","Serial Number","Assigned To","Department","Status","Warranty End","Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={isAdmin ? 10 : 9} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Monitor className="h-10 w-10 text-muted-foreground/40" />
                        <p className="text-muted-foreground font-medium">No assets found</p>
                        <p className="text-xs text-muted-foreground">
                          {assets.length === 0 ? "Add your first asset to get started." : "Try adjusting your search or filters."}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
                {filtered.map(asset => {
                  const isSelected = selected.has(asset.assetId);
                  return (
                    <tr key={asset.assetId}
                      className={cn("border-b border-border last:border-0 transition-colors",
                        isSelected ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-muted/25"
                      )}
                      data-testid={`row-asset-${asset.assetId}`}
                    >
                      {isAdmin && (
                        <td className="w-10 px-3 py-3">
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleRow(asset.assetId)}
                            aria-label={`Select ${asset.assetId}`} data-testid={`checkbox-${asset.assetId}`}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <Link href={`/assets/${asset.assetId}`} className="font-semibold text-primary hover:underline">{asset.assetId}</Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {asset.assetType === "Laptop"  ? <Monitor    className="h-3.5 w-3.5 text-blue-500"   /> :
                           asset.assetType === "Desktop" ? <Monitor    className="h-3.5 w-3.5 text-violet-500" /> :
                                                           <Smartphone className="h-3.5 w-3.5 text-indigo-500" />}
                          <span className="text-xs font-medium text-foreground">{asset.assetType}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground leading-tight">{asset.brand}</div>
                        <div className="text-xs text-muted-foreground">{asset.model}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{asset.serialNumber}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const assignedUser = asset.assignedEmail ? users.find(u => u.email === asset.assignedEmail) : undefined;
                          const displayName  = asset.assignedTo || assignedUser?.full_name;
                          if (!displayName && !assignedUser) return <span className="text-muted-foreground text-xs">—</span>;
                          const initials = (displayName ?? "?").split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
                          return (
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6 flex-shrink-0">
                                <AvatarFallback className="text-[10px] bg-primary/20 text-primary font-semibold">{initials}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                {assignedUser?.ecode && (
                                  <div className="text-[10px] font-mono font-semibold text-muted-foreground leading-none mb-0.5">{assignedUser.ecode}</div>
                                )}
                                <span className="text-sm text-foreground leading-tight">{displayName ?? asset.assignedEmail}</span>
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{asset.department ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium", STATUS_COLORS[asset.status])}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[asset.status])} />
                          {asset.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{asset.warrantyEndDate}</td>
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-actions-${asset.assetId}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
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
                            {isAdmin && (
                              <>
                                <DropdownMenuSeparator />
                                {/* Mark Available — Retired, Under Repair, Lost */}
                                {(asset.status === "Retired" || asset.status === "Under Repair" || asset.status === "Lost") && (
                                  <DropdownMenuItem onClick={() => handleMarkAvailable(asset.assetId)} className="flex items-center gap-2 cursor-pointer text-emerald-600">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Mark Available
                                  </DropdownMenuItem>
                                )}
                                {/* Assign — Available or Under Repair */}
                                {(asset.status === "Available" || asset.status === "Under Repair") && (
                                  <DropdownMenuItem onClick={() => openAssignDialog(asset.assetId)} className="flex items-center gap-2 cursor-pointer">
                                    <UserPlus className="h-3.5 w-3.5 text-muted-foreground" /> Assign
                                  </DropdownMenuItem>
                                )}
                                {/* Return / Unassign — Assigned only */}
                                {asset.status === "Assigned" && (
                                  <>
                                    <DropdownMenuItem asChild>
                                      <Link href={`/assets/${asset.assetId}/return`} className="flex items-center gap-2 cursor-pointer">
                                        <RotateCcw className="h-3.5 w-3.5 text-emerald-600" /> Return Asset
                                      </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => { unassignAsset(asset.assetId); toast({ title: "Asset unassigned" }); }} className="flex items-center gap-2 cursor-pointer">
                                      <UserPlus className="h-3.5 w-3.5 text-muted-foreground" /> Unassign
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {/* Mark Repair — Available or Assigned */}
                                {(asset.status === "Available" || asset.status === "Assigned") && (
                                  <DropdownMenuItem onClick={() => handleMarkRepair(asset.assetId)} className="flex items-center gap-2 cursor-pointer">
                                    <Wrench className="h-3.5 w-3.5 text-amber-500" /> Mark Repair
                                  </DropdownMenuItem>
                                )}
                                {/* Retire — not already Retired */}
                                {asset.status !== "Retired" && (
                                  <DropdownMenuItem onClick={() => handleRetire(asset.assetId)} className="flex items-center gap-2 cursor-pointer text-muted-foreground">
                                    <Archive className="h-3.5 w-3.5" /> Retire
                                  </DropdownMenuItem>
                                )}
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
              {selectedCount > 0 && <span className="ml-2 text-primary font-medium">· {selectedCount} selected</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      {isAdmin && selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-border bg-popover shadow-xl px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Checkbox checked className="pointer-events-none" />
            <span>{selectedCount} asset{selectedCount !== 1 ? "s" : ""} selected</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>Clear</Button>
          <Button size="sm" variant="destructive" className="gap-2" onClick={() => setDeleteConfirmOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete {selectedCount}
          </Button>
        </div>
      )}

      {/* ── Assign Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!assignTarget && !assignConfirmOpen} onOpenChange={v => !v && setAssignTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Asset</DialogTitle>
            <DialogDescription>
              {assignAssetObj ? `${assignAssetObj.assetId} — ${assignAssetObj.brand} ${assignAssetObj.model}` : ""}
            </DialogDescription>
          </DialogHeader>

          {assignStep === "select" ? (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Assign To <span className="text-destructive">*</span></Label>
                <Select value={assignUser} onValueChange={setAssignUser}>
                  <SelectTrigger data-testid="select-assign-user">
                    <SelectValue placeholder="Select a user…" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeUsers.map(u => (
                      <SelectItem key={u.id} value={u.id}>
                        <div className="flex flex-col">
                          <span className="font-medium">{u.full_name}</span>
                          <span className="text-xs text-muted-foreground">{u.email} · {u.department}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="bg-muted/50 rounded-lg px-4 py-3 text-sm">
                <span className="text-muted-foreground">Assigning to: </span>
                <span className="font-semibold text-foreground">{selectedUser?.full_name}</span>
                <span className="text-muted-foreground ml-2">({selectedUser?.department})</span>
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-medium">Handover Date</Label>
                <Input type="date" value={handoverDate} onChange={e => setHandoverDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-medium">Accessories Being Handed Over</Label>
                <Input value={handoverAcc} onChange={e => setHandoverAcc(e.target.value)}
                  placeholder="e.g. Charger, Mouse, Laptop Bag" />
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-medium">Additional Notes</Label>
                <Textarea value={handoverNote} onChange={e => setHandoverNote(e.target.value)}
                  rows={2} placeholder="Any handover instructions or remarks…" />
              </div>
            </div>
          )}

          <DialogFooter>
            {assignStep === "select" ? (
              <>
                <Button variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
                <Button disabled={!assignUser} onClick={() => setAssignStep("handover")}>
                  Next →
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setAssignStep("select")}>← Back</Button>
                <Button onClick={() => setAssignConfirmOpen(true)} disabled={!selectedUser}>
                  Review & Confirm
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Confirmation */}
      <AlertDialog open={assignConfirmOpen} onOpenChange={setAssignConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Asset Assignment</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div className="bg-muted rounded-lg px-4 py-3 space-y-1">
                  <div><span className="font-semibold">Asset:</span> {assignTarget} — {assignAssetObj?.brand} {assignAssetObj?.model}</div>
                  <div><span className="font-semibold">Assign To:</span> {selectedUser?.full_name} ({selectedUser?.email})</div>
                  <div><span className="font-semibold">Department:</span> {selectedUser?.department}</div>
                  <div><span className="font-semibold">Handover Date:</span> {handoverDate}</div>
                  {handoverAcc && <div><span className="font-semibold">Accessories:</span> {handoverAcc}</div>}
                </div>
                <p className="text-muted-foreground">Asset status will change to <strong>Assigned</strong>. A handover record will be saved in remarks.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={assigning}>Back</AlertDialogCancel>
            <AlertDialogAction onClick={handleAssignConfirm} disabled={assigning}>
              {assigning ? "Assigning…" : "Confirm Assignment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirm */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} Asset{selectedCount !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the selected assets. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleBulkDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={v => { setUploadOpen(v); if (!v) { setParsedRows([]); setUploadFileName(""); } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Upload Assets</DialogTitle>
            <DialogDescription>Upload a CSV file to import multiple assets at once.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button variant="outline" size="sm" className="gap-2" onClick={downloadTemplate}>
              <Download className="h-4 w-4" /> Download Template
            </Button>
            <div
              className={cn("border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"
              )}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{uploadFileName || "Drop your CSV file here or click to browse"}</p>
              <p className="text-xs text-muted-foreground mt-1">Supports .csv files only</p>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileInput} />
            </div>
            {parsedRows.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex items-center gap-1.5 text-emerald-600"><CheckCircle2 className="h-4 w-4" />{validRows.length} valid</span>
                  {invalidRows.length > 0 && <span className="flex items-center gap-1.5 text-destructive"><AlertCircle className="h-4 w-4" />{invalidRows.length} errors</span>}
                </div>
                {invalidRows.map(r => (
                  <div key={r.index} className="text-xs text-destructive bg-destructive/5 rounded px-3 py-2">
                    <span className="font-semibold">Row {r.index}:</span> {r.errors.join(", ")}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUploadOpen(false); setParsedRows([]); setUploadFileName(""); }}>Cancel</Button>
            <Button disabled={validRows.length === 0} onClick={handleImport} className="gap-2">
              <FileText className="h-4 w-4" /> Import {validRows.length > 0 ? `${validRows.length} Assets` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
