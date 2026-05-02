import { useParams, Link } from "wouter";
import {
  ArrowLeft,
  Monitor,
  Smartphone,
  Calendar,
  MapPin,
  User,
  Building,
  Tag,
  Package,
  Edit,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { mockAssets, mockTickets, AssetStatus } from "@/data/mockData";
import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import AssetFormModal from "@/components/AssetFormModal";
import { Asset } from "@/data/mockData";

const assetStatusColors: Record<AssetStatus, string> = {
  Available: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Assigned: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  "Under Repair": "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Lost: "bg-red-500/15 text-red-500 border-red-500/20",
  Retired: "bg-gray-500/15 text-gray-500 border-gray-500/20",
};

const priorityColors: Record<string, string> = {
  Critical: "bg-red-500/15 text-red-500 border-red-500/20",
  High: "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Medium: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Low: "bg-gray-500/15 text-gray-500 border-gray-500/20",
};

const ticketStatusColors: Record<string, string> = {
  Open: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Assigned: "bg-purple-500/15 text-purple-600 border-purple-500/20",
  "In Progress": "bg-amber-500/15 text-amber-600 border-amber-500/20",
  "Waiting for User": "bg-orange-500/15 text-orange-600 border-orange-500/20",
  Resolved: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Closed: "bg-gray-500/15 text-gray-500 border-gray-500/20",
  Rejected: "bg-red-500/15 text-red-500 border-red-500/20",
};

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const { currentUser } = useAuth();
  const [allAssets, setAllAssets] = useState(mockAssets);
  const [modalOpen, setModalOpen] = useState(false);

  const asset = allAssets.find((a) => a.assetId === id);
  const relatedTickets = mockTickets.filter((t) => t.assetId === id);
  const isAdmin = currentUser?.role === "Super Admin";

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Asset not found.</p>
        <Link href="/assets">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to Assets
          </Button>
        </Link>
      </div>
    );
  }

  const handleSave = (updated: Asset) => {
    setAllAssets((prev) => prev.map((a) => (a.assetId === updated.assetId ? updated : a)));
    setModalOpen(false);
  };

  const fields: { icon: React.ReactNode; label: string; value: string | undefined }[] = [
    { icon: <Tag className="h-4 w-4" />, label: "Asset ID", value: asset.assetId },
    { icon: asset.assetType === "Laptop" ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />, label: "Type", value: asset.assetType },
    { icon: <Package className="h-4 w-4" />, label: "Brand", value: asset.brand },
    { icon: <Package className="h-4 w-4" />, label: "Model", value: asset.model },
    { icon: <Tag className="h-4 w-4" />, label: "Serial Number", value: asset.serialNumber },
    ...(asset.assetType === "Mobile" ? [{ icon: <Tag className="h-4 w-4" />, label: "IMEI Number", value: asset.imeiNumber }] : []),
    { icon: <Calendar className="h-4 w-4" />, label: "Purchase Date", value: asset.purchaseDate },
    { icon: <Calendar className="h-4 w-4" />, label: "Warranty End Date", value: asset.warrantyEndDate },
    { icon: <User className="h-4 w-4" />, label: "Assigned To", value: asset.assignedTo ?? "Unassigned" },
    { icon: <Building className="h-4 w-4" />, label: "Department", value: asset.department ?? "—" },
    { icon: <MapPin className="h-4 w-4" />, label: "Location", value: asset.location },
    { icon: <Package className="h-4 w-4" />, label: "Accessories", value: asset.accessories || "—" },
    { icon: <Tag className="h-4 w-4" />, label: "Remarks", value: asset.remarks || "—" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/assets">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{asset.assetId}</h1>
              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${assetStatusColors[asset.status]}`}>
                {asset.status}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{asset.brand} {asset.model}</p>
          </div>
        </div>
        {isAdmin && (
          <Button onClick={() => setModalOpen(true)} className="gap-2" data-testid="button-edit-asset">
            <Edit className="h-4 w-4" /> Edit Asset
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Asset Details */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Asset Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {fields.map((f) => (
                  <div key={f.label} className="flex gap-3">
                    <div className="text-muted-foreground mt-0.5">{f.icon}</div>
                    <div>
                      <div className="text-xs text-muted-foreground font-medium">{f.label}</div>
                      <div className="text-sm text-foreground mt-0.5">{f.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Quick Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Status</span>
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${assetStatusColors[asset.status]}`}>
                  {asset.status}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Type</span>
                <span className="text-sm font-medium text-foreground">{asset.assetType}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Open Tickets</span>
                <span className="text-sm font-bold text-foreground">
                  {relatedTickets.filter((t) => !["Resolved", "Closed", "Rejected"].includes(t.status)).length}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Related Tickets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Related Tickets ({relatedTickets.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {relatedTickets.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">No tickets raised for this asset.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Ticket ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Priority</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {relatedTickets.map((t) => (
                    <tr key={t.ticketId} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Link href={`/tickets/${t.ticketId}`} className="text-primary font-medium hover:underline">{t.ticketId}</Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{t.category} — {t.subcategory}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${priorityColors[t.priority]}`}>{t.priority}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${ticketStatusColors[t.status]}`}>{t.status}</span>
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

      <AssetFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        asset={asset}
        existingIds={allAssets.map((a) => a.assetId)}
      />
    </div>
  );
}
