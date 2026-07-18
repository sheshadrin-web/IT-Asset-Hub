import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { Asset } from "@/data/mockData";

const DAMAGED_CONDITIONS = ["Damaged", "Lost", "Scrapped", "Needs Inspection"];

export default function AssetHealthOverview({ assets }: { assets: Asset[] }) {
  const total = assets.length;
  let healthy = 0, repair = 0, recovery = 0, damaged = 0;
  for (const a of assets) {
    if (a.status === "Under Repair") repair++;
    else if (a.status === "Recovery Stage") recovery++;
    else if (a.status === "Lost" || a.status === "Retired" || DAMAGED_CONDITIONS.includes(a.condition ?? "")) damaged++;
    else healthy++;
  }

  const data = [
    { name: "Healthy",          value: healthy,  color: "#22c55e" },
    { name: "Under Repair",     value: repair,   color: "#f59e0b" },
    { name: "In Recovery",      value: recovery, color: "#a855f7" },
    { name: "Damaged / Retired", value: damaged, color: "#ef4444" },
  ].filter(d => d.value > 0);

  const healthyPct = total ? Math.round((healthy / total) * 100) : 0;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />Asset Health Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">No assets added yet.</p>
        ) : (
          <div className="flex flex-col items-center">
            <div className="relative w-full" style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} cx="50%" cy="50%" innerRadius={58} outerRadius={82} paddingAngle={3} dataKey="value">
                    {data.map(d => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-bold text-foreground leading-none">{total}</span>
                <span className="text-[11px] text-muted-foreground mt-0.5">Total Assets</span>
              </div>
            </div>
            <div className="mt-3 w-full space-y-1.5">
              {data.map(d => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.name}
                  </span>
                  <span className="font-medium text-foreground tabular-nums">
                    {d.value} <span className="text-muted-foreground/60">({total ? ((d.value / total) * 100).toFixed(1) : 0}%)</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 w-full rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium text-center py-2">
              {healthyPct}% of assets are in good condition 👍
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
