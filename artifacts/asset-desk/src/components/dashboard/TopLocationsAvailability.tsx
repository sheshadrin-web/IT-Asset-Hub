import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import type { Asset } from "@/data/mockData";

export default function TopLocationsAvailability({ assets }: { assets: Asset[] }) {
  const byLoc = new Map<string, { available: number; total: number }>();
  for (const a of assets) {
    const loc = a.location || "Unassigned";
    const cur = byLoc.get(loc) ?? { available: 0, total: 0 };
    cur.total++;
    if (a.status === "Available") cur.available++;
    byLoc.set(loc, cur);
  }
  const rows = [...byLoc.entries()]
    .map(([loc, v]) => ({ loc, ...v, pct: v.total ? (v.available / v.total) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />Top Locations by Availability %
        </CardTitle>
        <Link href="/locations" className="text-xs text-primary hover:underline font-medium">View all →</Link>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No assets yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Location", "Available %", "Status"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const healthy = r.pct >= 50;
                return (
                  <tr key={r.loc} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium text-foreground">{r.loc}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(r.pct, 2)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">{r.pct.toFixed(2)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                        healthy ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" : "bg-amber-500/15 text-amber-600 border-amber-500/20"
                      }`}>
                        {healthy ? "Healthy" : "Low Stock"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
