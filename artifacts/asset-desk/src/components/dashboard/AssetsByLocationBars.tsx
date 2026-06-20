import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin } from "lucide-react";
import type { Asset } from "@/data/mockData";

export default function AssetsByLocationBars({ assets }: { assets: Asset[] }) {
  const total = assets.length;
  const counts = new Map<string, number>();
  for (const a of assets) {
    const loc = a.location || "Unassigned";
    counts.set(loc, (counts.get(loc) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([loc, n]) => ({ loc, n, pct: total ? (n / total) * 100 : 0 }))
    .sort((a, b) => b.n - a.n);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />Assets by Location
        </CardTitle>
        <Link href="/locations" className="text-xs text-primary hover:underline font-medium">View all →</Link>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No assets yet.</p>
        ) : rows.map(r => (
          <div key={r.loc} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">{r.loc}</span>
              <span className="text-muted-foreground tabular-nums">
                {r.n} <span className="text-muted-foreground/60">({r.pct.toFixed(1)}%)</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(r.pct, 2)}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
