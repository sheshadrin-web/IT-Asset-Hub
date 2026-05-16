import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  Plus, Search, Monitor, Smartphone, Tablet, Eye, Edit,
  UserPlus, Wrench, Archive, MoreHorizontal, X,
  Upload, Download, Trash2, FileText, AlertCircle, CheckCircle2,
  RotateCcw, ChevronUp, ChevronDown, ChevronsUpDown,
  Users, CheckSquare, Package,
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
import ColumnFilterDropdown from "@/components/ColumnFilterDropdown";
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

type ColKey = "assetId" | "assetType" | "brand" | "serialNumber" | "assignedTo" | "department" | "status" | "assignedAt" | "warrantyEndDate";

function getColValue(a: Asset, col: ColKey): string {
  switch (col) {
    case "assetId":         return a.assetId || "";
    case "assetType":       return a.assetType || "";
    case "brand":           return a.brand ? `${a.brand} – ${a.model}` : "";
    case "serialNumber":    return a.serialNumber || "";
    case "assignedTo":      return a.assignedTo || "—";
    case "department":      return a.department || "—";
    case "status":          return a.status || "";
    case "assignedAt":      return a.assignedAt
      ? new Date(a.assignedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "—";
    case "warrantyEndDate": return a.warrantyEndDate || "—";
  }
}

function makeEmptyColFilters(): Record<ColKey, Set<string>> {
  return {
    assetId: new Set(), assetType: new Set(), brand: new Set(),
    serialNumber: new Set(), assignedTo: new Set(), department: new Set(),
    status: new Set(), assignedAt: new Set(), warrantyEndDate: new Set(),
  };
}

const COL_DEFS: { label: string; key?: ColKey; align?: "left" | "right" }[] = [
  { label: "Asset ID",      key: "assetId" },
  { label: "Type",          key: "assetType" },
  { label: "Brand / Model", key: "brand" },
  { label: "Serial Number", key: "serialNumber" },
  { label: "Assigned To",   key: "assignedTo" },
  { label: "Department",    key: "department" },
  { label: "Status",        key: "status" },
  { label: "Assigned Date", key: "assignedAt",      align: "right" },
  { label: "Warranty End",  key: "warrantyEndDate", align: "right" },
  { label: "Actions" },
];

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
    if (!["Laptop", "Mobile", "Desktop", "Tab"].includes(row.assetType ?? "")) errors.push("assetType must be Laptop, Mobile, Desktop, or Tab");
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
        assetType:       (row.assetType as "Laptop" | "Mobile" | "Desktop" | "Tab") || "Laptop",
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
  const { assets, addAssets, assignAsset, bulkAssignAssets, updateStatus, unassignAsset, deleteAssets } = useAssets();
  const { users } = useUsers();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [search, setSearch]           = useState("");
  const [typeFilter, setTypeFilter]     = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [userFilter, setUserFilter]     = useState("all");
  const [deptFilter, setDeptFilter]     = useState("all");
  const [colFilters, setColFilters]     = useState<Record<ColKey, Set<string>>>(makeEmptyColFilters);
  const [sortCol, setSortCol]           = useState<ColKey>("assetId");
  const [sortDir, setSortDir]           = useState<"asc" | "desc">("asc");

  const handleSort = (col: ColKey) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  const setColFilter = (col: ColKey, vals: Set<string>) =>
    setColFilters(prev => ({ ...prev, [col]: vals }));

  const hasColFilters = Object.values(colFilters).some(s => s.size > 0);
  const hasAnyFilter  = search !== "" || typeFilter !== "all" || statusFilter !== "all"
    || userFilter !== "all" || deptFilter !== "all" || hasColFilters;

  const clearAllFilters = () => {
    setSearch(""); setTypeFilter("all"); setStatusFilter("all");
    setUserFilter("all"); setDeptFilter("all");
    setColFilters(makeEmptyColFilters());
  };

  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const selectAllRef = useRef<HTMLButtonElement>(null);

  // Assign state
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [assignStep,   setAssignStep]   = useState<"select" | "handover">("select");
  const [assignUser,   setAssignUser]   = useState("");
  const [userSearch,   setUserSearch]   = useState("");
  const [handoverDate, setHandoverDate] = useState(new Date().toISOString().split("T")[0]);
  const [handoverAcc,  setHandoverAcc]  = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  const [assignConfirmOpen, setAssignConfirmOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);

  // Bulk Assign state
  const [bulkOpen,        setBulkOpen]        = useState(false);
  const [bulkStep,        setBulkStep]        = useState<1 | 2 | 3>(1);
  const [bulkUser,        setBulkUser]        = useState("");
  const [bulkUserSearch,  setBulkUserSearch]  = useState("");
  const [bulkAssetIds,    setBulkAssetIds]    = useState<Set<string>>(new Set());
  const [bulkTypeFilter,  setBulkTypeFilter]  = useState("All");
  const [bulkAssetSearch, setBulkAssetSearch] = useState("");
  const [bulkReason,      setBulkReason]      = useState("New Joiner");
  const [bulkDate,        setBulkDate]        = useState(new Date().toISOString().split("T")[0]);
  const [bulkNote,        setBulkNote]        = useState("");
  const [bulkAssigning,   setBulkAssigning]   = useState(false);

  const openBulkAssign = () => {
    setBulkStep(1); setBulkUser(""); setBulkUserSearch("");
    setBulkAssetIds(new Set()); setBulkTypeFilter("All"); setBulkAssetSearch("");
    setBulkReason("New Joiner"); setBulkDate(new Date().toISOString().split("T")[0]);
    setBulkNote(""); setBulkOpen(true);
  };

  const bulkSelectedUser  = users.find(u => u.id === bulkUser);
  const bulkFilteredUsers = users.filter(u => u.status === "active" && (
    !bulkUserSearch.trim() ||
    u.full_name.toLowerCase().includes(bulkUserSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(bulkUserSearch.toLowerCase()) ||
    (u.ecode ?? "").toLowerCase().includes(bulkUserSearch.toLowerCase()) ||
    (u.department ?? "").toLowerCase().includes(bulkUserSearch.toLowerCase())
  ));

  const availableAssets = assets.filter(a => a.status === "Available");
  const bulkPickerAssets = availableAssets.filter(a => {
    const matchType = bulkTypeFilter === "All" || a.assetType === bulkTypeFilter;
    const q = bulkAssetSearch.toLowerCase();
    const matchSearch = !q ||
      a.assetId.toLowerCase().includes(q) ||
      a.brand.toLowerCase().includes(q) ||
      a.model.toLowerCase().includes(q) ||
      (a.serialNumber ?? "").toLowerCase().includes(q);
    return matchType && matchSearch;
  });

  const toggleBulkAsset = (id: string) =>
    setBulkAssetIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const handleBulkAssignConfirm = async () => {
    if (!bulkSelectedUser || bulkAssetIds.size === 0) return;
    setBulkAssigning(true);
    try {
      await bulkAssignAssets(
        [...bulkAssetIds],
        bulkSelectedUser.id, bulkSelectedUser.full_name, bulkSelectedUser.email,
        bulkSelectedUser.department ?? "",
        bulkNote || undefined,
        bulkReason,
      );
      toast({
        title: `${bulkAssetIds.size} asset${bulkAssetIds.size > 1 ? "s" : ""} assigned`,
        description: `All assigned to ${bulkSelectedUser.full_name}. Email sent with asset details.`,
      });
      setBulkOpen(false);
    } catch (err) {
      toast({ title: "Bulk assign failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
    setBulkAssigning(false);
  };

  // Bulk upload
  const [uploadOpen, setUploadOpen]   = useState(false);
  const [parsedRows, setParsedRows]   = useState<ParsedRow[]>([]);
  const [uploadFileName, setUploadFileName] = useState("");
  const [dragOver, setDragOver]       = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "it_admin";
  const canEdit = isAdmin || currentUser?.role === "it_agent";

  const baseFiltered = assets.filter(a => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || a.assetId.toLowerCase().includes(q)
      || a.serialNumber.toLowerCase().includes(q)
      || a.model.toLowerCase().includes(q)
      || a.brand.toLowerCase().includes(q)
      || (a.assignedTo?.toLowerCase().includes(q)    ?? false)
      || (a.assignedEcode?.toLowerCase().includes(q) ?? false)
      || (a.assignedEmail?.toLowerCase().includes(q) ?? false);
    const matchType   = typeFilter   === "all" || a.assetType === typeFilter;
    const matchStatus = statusFilter === "all" || a.status    === statusFilter;
    const matchUser   = userFilter   === "all" || a.assignedEmail === userFilter || a.assignedEcode === userFilter;
    const matchDept   = deptFilter   === "all" || (a.department ?? "") === deptFilter;
    return matchSearch && matchType && matchStatus && matchUser && matchDept;
  });

  const filtered = baseFiltered.filter(a =>
    (Object.keys(colFilters) as ColKey[]).every(col => {
      const vals = colFilters[col];
      return vals.size === 0 || vals.has(getColValue(a, col));
    })
  );

  const getColAllValues = (col: ColKey) =>
    [...new Set(baseFiltered.map(a => getColValue(a, col)))]
      .filter(v => v !== "")
      .sort((a, b) => a.localeCompare(b));

  const sorted = [...filtered].sort((a, b) => {
    const av = getColValue(a, sortCol);
    const bv = getColValue(b, sortCol);
    const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
    return sortDir === "asc" ? cmp : -cmp;
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

  const activeUsers    = users.filter(u => u.status === "active");
  const selectedUser   = users.find(u => u.id === assignUser);
  const assignAssetObj = assets.find(a => a.assetId === assignTarget);

  const filteredUsers = userSearch.trim()
    ? activeUsers.filter(u => {
        const q = userSearch.toLowerCase();
        return (
          u.full_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.ecode ?? "").toLowerCase().includes(q) ||
          (u.department ?? "").toLowerCase().includes(q)
        );
      })
    : activeUsers;

  const openAssignDialog = (assetId: string) => {
    const a = assets.find(x => x.assetId === assetId);
    setAssignTarget(assetId);
    setAssignUser("");
    setUserSearch("");
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

  const existingAssetIds = new Set(assets.map(a => a.assetId));
  const validRows     = parsedRows.filter(r => r.errors.length === 0 && !existingAssetIds.has(r.data.assetId ?? ""));
  const duplicateRows = parsedRows.filter(r => r.errors.length === 0 &&  existingAssetIds.has(r.data.assetId ?? ""));
  const invalidRows   = parsedRows.filter(r => r.errors.length > 0);

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
    total:     filtered.length,
    available: filtered.filter(a => a.status === "Available").length,
    assigned:  filtered.filter(a => a.status === "Assigned").length,
    repair:    filtered.filter(a => a.status === "Under Repair").length,
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
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/assets/import">
              <Button variant="outline" className="gap-2" data-testid="button-bulk-upload">
                <Upload className="h-4 w-4" /> Bulk Import
              </Button>
            </Link>
            <Button variant="outline" className="gap-2" onClick={openBulkAssign} data-testid="button-bulk-assign">
              <Users className="h-4 w-4" /> Bulk Assign
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
                <SelectItem value="Tab"><span className="flex items-center gap-2"><Tablet className="h-3.5 w-3.5" /> Tab</span></SelectItem>
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
            {/* Assigned-to user filter — only shows users who have ≥1 assigned asset */}
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="w-full sm:w-52" data-testid="select-user-filter">
                <SelectValue placeholder="Assigned To" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {users
                  .filter(u => assets.some(a => a.assignedEmail === u.email || a.assignedEcode === u.ecode))
                  .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""))
                  .map(u => (
                    <SelectItem key={u.id} value={u.email}>
                      <span className="flex flex-col leading-tight">
                        <span className="font-medium">{u.full_name}</span>
                        {u.ecode && <span className="text-xs text-muted-foreground font-mono">{u.ecode}</span>}
                      </span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {/* Department filter — only shows departments that have ≥1 asset */}
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="w-full sm:w-48" data-testid="select-dept-filter">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {[...new Set(assets.map(a => a.department).filter(Boolean))]
                  .sort()
                  .map(dept => (
                    <SelectItem key={dept} value={dept!}>{dept}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {hasAnyFilter && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {filtered.length} of {assets.length} assets match active filters
              </span>
              <button
                type="button"
                onClick={clearAllFilters}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium underline-offset-2 hover:underline"
              >
                <X className="h-3 w-3" /> Clear all filters
              </button>
            </div>
          )}
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
                  {COL_DEFS.map(col => (
                    <th key={col.label} className="px-4 py-3 text-left whitespace-nowrap">
                      <div className="flex items-center gap-0.5">
                        {col.key ? (
                          <ColumnFilterDropdown
                            label={col.label}
                            allValues={getColAllValues(col.key)}
                            selected={colFilters[col.key]}
                            onApply={vals => setColFilter(col.key!, vals)}
                            align={col.align}
                          />
                        ) : (
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {col.label}
                          </span>
                        )}
                        {col.key && (
                          <button
                            type="button"
                            onClick={() => handleSort(col.key!)}
                            className={cn(
                              "ml-0.5 rounded p-0.5 transition-colors",
                              sortCol === col.key
                                ? "text-primary"
                                : "text-muted-foreground/30 hover:text-muted-foreground"
                            )}
                            title={`Sort by ${col.label}`}
                          >
                            {sortCol === col.key
                              ? (sortDir === "asc"
                                  ? <ChevronUp   className="h-3 w-3" />
                                  : <ChevronDown className="h-3 w-3" />)
                              : <ChevronsUpDown className="h-3 w-3" />}
                          </button>
                        )}
                      </div>
                    </th>
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
                {sorted.map(asset => {
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
                           asset.assetType === "Tab"     ? <Tablet     className="h-3.5 w-3.5 text-teal-500"   /> :
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
                          const displayName = asset.assignedTo;
                          const ecode       = asset.assignedEcode;
                          if (!displayName) return <span className="text-muted-foreground text-xs">—</span>;
                          const initials = displayName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
                          return (
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6 flex-shrink-0">
                                <AvatarFallback className="text-[10px] bg-primary/20 text-primary font-semibold">{initials}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                {ecode && (
                                  <div className="text-[10px] font-mono font-semibold text-muted-foreground leading-none mb-0.5">{ecode}</div>
                                )}
                                <span className="text-sm text-foreground leading-tight">{displayName}</span>
                                {asset.acknowledged ? (
                                  <div className="flex items-center gap-0.5 mt-0.5">
                                    <svg className="h-2.5 w-2.5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                                    <span className="text-[10px] text-emerald-600 font-semibold">Acknowledged</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-0.5 mt-0.5">
                                    <svg className="h-2.5 w-2.5 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path strokeLinecap="round" d="M12 8v4m0 4h.01"/></svg>
                                    <span className="text-[10px] text-amber-600 font-semibold">Pending Ack</span>
                                  </div>
                                )}
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
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {asset.assignedAt
                          ? new Date(asset.assignedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                          : "—"}
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

                {assignUser && selectedUser ? (
                  <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{selectedUser.full_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{selectedUser.email} · {selectedUser.department}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setAssignUser(""); setUserSearch(""); }}
                      className="ml-2 shrink-0 rounded p-0.5 hover:bg-muted"
                      aria-label="Clear selection"
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        data-testid="input-user-search"
                        placeholder="Search by name, email, e-code, dept…"
                        className="pl-8 pr-8 text-sm"
                        value={userSearch}
                        onChange={e => setUserSearch(e.target.value)}
                        autoFocus
                      />
                      {userSearch && (
                        <button
                          type="button"
                          onClick={() => setUserSearch("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-muted"
                        >
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                    <div
                      data-testid="select-assign-user"
                      className="max-h-52 overflow-y-auto rounded-md border divide-y text-sm"
                    >
                      {filteredUsers.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">No users match your search</p>
                      ) : filteredUsers.map(u => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => { setAssignUser(u.id); setUserSearch(""); }}
                          className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-muted/60 transition-colors"
                        >
                          <span className="font-medium">{u.full_name}</span>
                          <span className="text-xs text-muted-foreground">{u.email}{u.department ? ` · ${u.department}` : ""}{u.ecode ? ` · ${u.ecode}` : ""}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
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
                <div className="flex items-center gap-3 text-sm flex-wrap">
                  <span className="flex items-center gap-1.5 text-emerald-600"><CheckCircle2 className="h-4 w-4" />{validRows.length} will be imported</span>
                  {duplicateRows.length > 0 && <span className="flex items-center gap-1.5 text-amber-600"><AlertCircle className="h-4 w-4" />{duplicateRows.length} duplicate{duplicateRows.length !== 1 ? "s" : ""} skipped</span>}
                  {invalidRows.length > 0 && <span className="flex items-center gap-1.5 text-destructive"><AlertCircle className="h-4 w-4" />{invalidRows.length} error{invalidRows.length !== 1 ? "s" : ""}</span>}
                </div>
                {duplicateRows.map(r => (
                  <div key={r.index} className="text-xs text-amber-700 bg-amber-500/10 rounded px-3 py-2">
                    <span className="font-semibold">Row {r.index}:</span> Asset ID <code className="font-mono">{r.data.assetId}</code> already exists — skipped
                  </div>
                ))}
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

      {/* ── Bulk Assign Dialog ───────────────────────────────────────────────── */}
      <Dialog open={bulkOpen} onOpenChange={v => { if (!bulkAssigning) setBulkOpen(v); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">

          {/* Header */}
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4 text-primary" /> Bulk Assign — New Joiner Onboarding
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Step {bulkStep} of 3 — {bulkStep === 1 ? "Select employee" : bulkStep === 2 ? "Select assets" : "Review & confirm"}
                </p>
              </div>
              {/* Step progress dots */}
              <div className="flex items-center gap-1.5 mr-2">
                {([1, 2, 3] as const).map(s => (
                  <div key={s} className={cn("h-2 w-2 rounded-full transition-colors",
                    s < bulkStep ? "bg-primary" : s === bulkStep ? "bg-primary" : "bg-muted-foreground/20"
                  )} />
                ))}
              </div>
            </div>
          </DialogHeader>

          {/* ── Step 1: Select User ─────────────────────────────── */}
          {bulkStep === 1 && (
            <div className="flex flex-col flex-1 overflow-hidden px-6 py-4 gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="Search by name, email, E-Code, or department…"
                  className="pl-9"
                  value={bulkUserSearch}
                  onChange={e => setBulkUserSearch(e.target.value)}
                />
              </div>
              <div className="overflow-y-auto flex-1 rounded-lg border border-border divide-y divide-border">
                {bulkFilteredUsers.length === 0 && (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">No active users found</div>
                )}
                {bulkFilteredUsers.map(u => (
                  <button
                    key={u.id} type="button"
                    onClick={() => setBulkUser(u.id)}
                    className={cn(
                      "w-full text-left px-4 py-3 transition-colors flex items-center gap-3",
                      bulkUser === u.id ? "bg-primary/8 border-l-2 border-primary" : "hover:bg-muted/50"
                    )}
                  >
                    <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                      {u.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{u.full_name}</div>
                      <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                    </div>
                    <div className="text-right shrink-0">
                      {u.ecode && <div className="text-xs font-mono text-muted-foreground">{u.ecode}</div>}
                      {u.department && <div className="text-xs text-muted-foreground">{u.department}</div>}
                    </div>
                    {bulkUser === u.id && (
                      <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                    )}
                  </button>
                ))}
              </div>
              {bulkUser && (
                <div className="text-xs text-primary font-medium flex items-center gap-1.5">
                  <CheckSquare className="h-3.5 w-3.5" />
                  Selected: {bulkSelectedUser?.full_name} ({bulkSelectedUser?.ecode ?? bulkSelectedUser?.email})
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Select Assets ───────────────────────────── */}
          {bulkStep === 2 && (
            <div className="flex flex-col flex-1 overflow-hidden px-6 py-4 gap-3">
              {/* Selected user pill */}
              <div className="flex items-center gap-2 text-sm bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
                <div className="h-6 w-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                  {bulkSelectedUser?.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                </div>
                <span className="font-medium">{bulkSelectedUser?.full_name}</span>
                <span className="text-muted-foreground">· {bulkSelectedUser?.department}</span>
                <span className="ml-auto text-primary font-medium">{bulkAssetIds.size} selected</span>
              </div>

              {/* Type chips + search */}
              <div className="flex items-center gap-2 flex-wrap">
                {["All", "Laptop", "Mobile", "Desktop", "Tab"].map(t => (
                  <button key={t} type="button"
                    onClick={() => setBulkTypeFilter(t)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                      bulkTypeFilter === t ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/40"
                    )}
                  >{t}</button>
                ))}
                <div className="relative ml-auto">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search assets…"
                    className="pl-8 h-7 text-xs w-44"
                    value={bulkAssetSearch}
                    onChange={e => setBulkAssetSearch(e.target.value)}
                  />
                </div>
              </div>

              {/* Asset picker list */}
              <div className="overflow-y-auto flex-1 rounded-lg border border-border divide-y divide-border">
                {bulkPickerAssets.length === 0 && (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                    No available assets{bulkTypeFilter !== "All" ? ` of type ${bulkTypeFilter}` : ""}
                  </div>
                )}
                {bulkPickerAssets.map(a => {
                  const checked = bulkAssetIds.has(a.assetId);
                  const TypeIcon = a.assetType === "Mobile" ? Smartphone
                    : a.assetType === "Tab" ? Tablet : Monitor;
                  return (
                    <button
                      key={a.assetId} type="button"
                      onClick={() => toggleBulkAsset(a.assetId)}
                      className={cn(
                        "w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors",
                        checked ? "bg-primary/5" : "hover:bg-muted/50"
                      )}
                    >
                      <Checkbox checked={checked} className="pointer-events-none shrink-0" />
                      <TypeIcon className={cn("h-4 w-4 shrink-0",
                        a.assetType === "Laptop" ? "text-blue-500"
                        : a.assetType === "Mobile" ? "text-emerald-500"
                        : a.assetType === "Desktop" ? "text-violet-500"
                        : "text-amber-500"
                      )} />
                      <div className="flex-1 min-w-0">
                        <span className="font-mono text-xs font-semibold text-foreground">{a.assetId}</span>
                        <span className="text-sm text-muted-foreground ml-2">{a.brand} {a.model}</span>
                      </div>
                      {a.serialNumber && (
                        <span className="text-xs text-muted-foreground font-mono shrink-0">S/N: {a.serialNumber}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Step 3: Review & Confirm ────────────────────────── */}
          {bulkStep === 3 && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* User summary */}
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Assigning to</p>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {bulkSelectedUser?.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{bulkSelectedUser?.full_name}</div>
                    <div className="text-xs text-muted-foreground">{bulkSelectedUser?.email} · {bulkSelectedUser?.department}</div>
                  </div>
                </div>
              </div>

              {/* Selected assets chips */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Assets to assign ({bulkAssetIds.size})
                </p>
                <div className="flex flex-wrap gap-2">
                  {[...bulkAssetIds].map(id => {
                    const a = assets.find(x => x.assetId === id);
                    if (!a) return null;
                    const TypeIcon = a.assetType === "Mobile" ? Smartphone
                      : a.assetType === "Tab" ? Tablet : Monitor;
                    return (
                      <div key={id} className="flex items-center gap-1.5 bg-muted border border-border rounded-full px-3 py-1 text-xs">
                        <TypeIcon className="h-3 w-3 text-muted-foreground" />
                        <span className="font-mono font-semibold">{id}</span>
                        <span className="text-muted-foreground">{a.brand} {a.model}</span>
                        <button type="button" onClick={() => toggleBulkAsset(id)} className="ml-1 text-muted-foreground hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Reason */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Reason for Assignment</Label>
                  <Select value={bulkReason} onValueChange={setBulkReason}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="New Joiner">New Joiner</SelectItem>
                      <SelectItem value="Replacement">Replacement</SelectItem>
                      <SelectItem value="Additional Asset">Additional Asset</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Handover Date</Label>
                  <Input type="date" className="h-9 text-sm" value={bulkDate} onChange={e => setBulkDate(e.target.value)} />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs">Handover Notes (optional)</Label>
                <Textarea
                  placeholder="Any notes about the handover, conditions, accessories…"
                  className="text-sm resize-none"
                  rows={3}
                  value={bulkNote}
                  onChange={e => setBulkNote(e.target.value)}
                />
              </div>

              <p className="text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                All {bulkAssetIds.size} assets will be marked <strong>Assigned</strong> and a single email listing all asset details will be sent to {bulkSelectedUser?.email}.
              </p>
            </div>
          )}

          {/* Footer nav */}
          <div className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between gap-2">
            <Button variant="outline" onClick={() => {
              if (bulkStep === 1) setBulkOpen(false);
              else setBulkStep(s => (s - 1) as 1 | 2 | 3);
            }} disabled={bulkAssigning}>
              {bulkStep === 1 ? "Cancel" : "← Back"}
            </Button>

            {bulkStep < 3 ? (
              <Button
                onClick={() => setBulkStep(s => (s + 1) as 1 | 2 | 3)}
                disabled={bulkStep === 1 ? !bulkUser : bulkAssetIds.size === 0}
              >
                {bulkStep === 1
                  ? `Next — Select Assets →`
                  : `Review & Confirm (${bulkAssetIds.size}) →`}
              </Button>
            ) : (
              <Button
                onClick={handleBulkAssignConfirm}
                disabled={bulkAssigning || bulkAssetIds.size === 0}
                className="gap-2"
              >
                <UserPlus className="h-4 w-4" />
                {bulkAssigning ? "Assigning…" : `Assign ${bulkAssetIds.size} Asset${bulkAssetIds.size !== 1 ? "s" : ""}`}
              </Button>
            )}
          </div>

        </DialogContent>
      </Dialog>

    </div>
  );
}
