import { useMemo } from "react";
import { Link } from "wouter";
import { MapPin, ChevronRight } from "lucide-react";
import { useAssets } from "@/context/AssetContext";
import { useAuth } from "@/context/AuthContext";
import { LOCATION_OPTIONS } from "@/lib/locationOptions";
import { canAccessLocationModule } from "@/lib/locationPermissions";

// Dashboard widget: per-location asset counts (RLS-scoped, so a Location GM only
// sees their own locations). Hidden for end users. Deep-links into /locations.
export default function AssetsByLocationCard() {
  const { assets } = useAssets();
  const { currentUser } = useAuth();

  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    assets.forEach(a => {
      const key = a.location || "Unassigned";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    const ordered = (LOCATION_OPTIONS as readonly string[])
      .map(l => ({ location: l, count: counts.get(l) ?? 0 }))
      .filter(r => r.count > 0);
    const unassigned = counts.get("Unassigned") ?? 0;
    if (unassigned > 0) ordered.push({ location: "Unassigned", count: unassigned });
    return ordered.sort((a, b) => b.count - a.count);
  }, [assets]);

  if (!canAccessLocationModule(currentUser)) return null;

  return (
    <div className="rounded-2xl border border-card-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> Assets by Location</h3>
        <Link href="/locations" className="text-xs text-primary hover:underline flex items-center gap-0.5" data-testid="link-view-all-locations">
          View all <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No assets to show.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {rows.map(r => (
            <Link key={r.location} href="/locations" data-testid={`dash-location-${r.location}`}
              className="rounded-lg border border-border/60 bg-muted/30 p-3 hover:border-primary/40 hover:shadow transition-all">
              <p className="text-lg font-bold">{r.count}</p>
              <p className="text-xs text-muted-foreground truncate">{r.location}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
