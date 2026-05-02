import { useState } from "react";
import { Link } from "wouter";
import {
  Plus,
  Search,
  Filter,
  Monitor,
  Smartphone,
  MoreHorizontal,
  Edit,
  Eye,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mockAssets, Asset, AssetStatus, AssetType } from "@/data/mockData";
import { useAuth } from "@/context/AuthContext";
import AssetFormModal from "@/components/AssetFormModal";

const assetStatusColors: Record<AssetStatus, string> = {
  Available: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Assigned: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  "Under Repair": "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Lost: "bg-red-500/15 text-red-500 border-red-500/20",
  Retired: "bg-gray-500/15 text-gray-500 border-gray-500/20",
};

export default function Assets() {
  const { currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [assets, setAssets] = useState<Asset[]>(mockAssets);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);

  const isAdmin = currentUser?.role === "Super Admin";

  const filtered = assets.filter((a) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      a.assetId.toLowerCase().includes(q) ||
      a.serialNumber.toLowerCase().includes(q) ||
      (a.assignedTo?.toLowerCase().includes(q) ?? false) ||
      a.brand.toLowerCase().includes(q) ||
      a.model.toLowerCase().includes(q);
    const matchesType = typeFilter === "all" || a.assetType === typeFilter;
    const matchesStatus = statusFilter === "all" || a.status === statusFilter;
    return matchesSearch && matchesType && matchesStatus;
  });

  const handleSave = (asset: Asset) => {
    if (editingAsset) {
      setAssets((prev) => prev.map((a) => (a.assetId === asset.assetId ? asset : a)));
    } else {
      setAssets((prev) => [...prev, asset]);
    }
    setModalOpen(false);
    setEditingAsset(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Asset Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{assets.length} total assets</p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => { setEditingAsset(null); setModalOpen(true); }}
            data-testid="button-add-asset"
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Asset
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID, serial, user, brand..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-assets"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-40" data-testid="select-asset-type">
                <SelectValue placeholder="Asset Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Laptop">Laptop</SelectItem>
                <SelectItem value="Mobile">Mobile</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44" data-testid="select-asset-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Available">Available</SelectItem>
                <SelectItem value="Assigned">Assigned</SelectItem>
                <SelectItem value="Under Repair">Under Repair</SelectItem>
                <SelectItem value="Lost">Lost</SelectItem>
                <SelectItem value="Retired">Retired</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Asset ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Brand / Model</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Serial No.</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Assigned To</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Department</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Warranty</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                      No assets found matching your filters.
                    </td>
                  </tr>
                )}
                {filtered.map((asset) => (
                  <tr
                    key={asset.assetId}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    data-testid={`row-asset-${asset.assetId}`}
                  >
                    <td className="px-4 py-3">
                      <Link href={`/assets/${asset.assetId}`} className="font-semibold text-primary hover:underline">
                        {asset.assetId}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        {asset.assetType === "Laptop" ? (
                          <Monitor className="h-3.5 w-3.5" />
                        ) : (
                          <Smartphone className="h-3.5 w-3.5" />
                        )}
                        <span className="text-xs">{asset.assetType}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{asset.brand}</div>
                      <div className="text-xs text-muted-foreground">{asset.model}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{asset.serialNumber}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${assetStatusColors[asset.status]}`}>
                        {asset.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground">{asset.assignedTo ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{asset.department ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{asset.warrantyEndDate}</td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-actions-${asset.assetId}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/assets/${asset.assetId}`} className="flex items-center gap-2 cursor-pointer">
                              <Eye className="h-3.5 w-3.5" /> View Details
                            </Link>
                          </DropdownMenuItem>
                          {isAdmin && (
                            <DropdownMenuItem
                              onClick={() => { setEditingAsset(asset); setModalOpen(true); }}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <Edit className="h-3.5 w-3.5" /> Edit Asset
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <AssetFormModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingAsset(null); }}
        onSave={handleSave}
        asset={editingAsset}
        existingIds={assets.map((a) => a.assetId)}
      />
    </div>
  );
}
