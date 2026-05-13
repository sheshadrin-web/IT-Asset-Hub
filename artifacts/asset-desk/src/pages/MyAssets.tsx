import { Link } from "wouter";
import { Monitor, Smartphone, MapPin, Package } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useAssets } from "@/context/AssetContext";
import { useAuth } from "@/context/AuthContext";
import { AssetStatus } from "@/data/mockData";
import { cn } from "@/lib/utils";

const assetStatusColors: Record<AssetStatus, string> = {
  "In Procurement": "bg-orange-500/15 text-orange-600 border-orange-500/20",
  Available:        "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Assigned:         "bg-blue-500/15 text-blue-600 border-blue-500/20",
  "Under Repair":   "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Lost:             "bg-red-500/15 text-red-500 border-red-500/20",
  Retired:          "bg-gray-500/15 text-gray-500 border-gray-500/20",
};

export default function MyAssets() {
  const { currentUser }  = useAuth();
  const { assets, loading } = useAssets();

  // Supabase RLS already restricts end-users to only their own assets,
  // so for end-users the full 'assets' array IS their assets.
  // For other roles (admins/agents viewing /my-assets — shouldn't normally
  // happen but handled gracefully), fall back to email matching.
  const myAssets = currentUser?.role === "end_user"
    ? assets
    : assets.filter(a =>
        (a.assignedEmail && currentUser?.email &&
          a.assignedEmail.toLowerCase() === currentUser.email.toLowerCase()) ||
        (a.assignedTo && currentUser?.name &&
          a.assignedTo.toLowerCase() === currentUser.name.toLowerCase())
      );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-foreground">My Assets</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {loading ? "Loading…" : `${myAssets.length} asset${myAssets.length !== 1 ? "s" : ""} assigned to you`}
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-6 w-6 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        </div>
      ) : myAssets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Package className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-base font-medium text-foreground">No assets assigned</p>
            <p className="text-sm text-muted-foreground mt-1">You don't have any assets assigned to you yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Contact IT support or{" "}
              <Link href="/tickets/new" className="text-primary hover:underline">raise a ticket</Link>{" "}
              to request one.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {myAssets.map(asset => (
            <Card key={asset.assetId} className="hover:shadow-md transition-shadow" data-testid={`card-my-asset-${asset.assetId}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                      {asset.assetType === "Laptop"
                        ? <Monitor className="h-4 w-4 text-primary" />
                        : <Smartphone className="h-4 w-4 text-primary" />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground leading-none">{asset.brand}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{asset.model}</p>
                    </div>
                  </div>
                  <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium flex-shrink-0", assetStatusColors[asset.status])}>
                    {asset.status}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Asset ID</p>
                    <p className="font-medium text-foreground">{asset.assetId}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Type</p>
                    <p className="font-medium text-foreground">{asset.assetType}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Serial No.</p>
                    <p className="font-mono text-xs text-foreground truncate">{asset.serialNumber}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Warranty</p>
                    <p className="text-xs text-foreground">{asset.warrantyEndDate}</p>
                  </div>
                </div>
                <div className="border-t border-border pt-2.5 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 flex-shrink-0" />
                    <span>{asset.location}</span>
                  </div>
                  {asset.accessories && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Package className="h-3 w-3 flex-shrink-0" />
                      <span>{asset.accessories}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  <Link href="/tickets/new" className="flex-1">
                    <button
                      className="w-full text-xs font-medium text-primary border border-primary/30 rounded-lg px-3 py-1.5 hover:bg-primary/5 transition-colors"
                      data-testid={`button-report-issue-${asset.assetId}`}
                    >
                      Report Issue
                    </button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
