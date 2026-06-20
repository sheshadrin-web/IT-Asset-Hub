import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import type { Asset } from "@/data/mockData";

function parseDate(value?: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

export default function WarrantyPanel({ assets }: { assets: Asset[] }) {
  const now = Date.now();
  const in30 = now + 30 * 24 * 60 * 60 * 1000;

  let active = 0, expiringSoon = 0, expired = 0, noData = 0;
  for (const a of assets) {
    const end = parseDate(a.warrantyEndDate);
    if (end === null) { noData++; continue; }
    if (end < now) expired++;
    else if (end <= in30) expiringSoon++;
    else active++;
  }

  const rows = [
    { label: "Under Warranty",  value: active,       Icon: ShieldCheck, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Expiring ≤ 30d",  value: expiringSoon, Icon: ShieldAlert, color: "text-amber-600",   bg: "bg-amber-50" },
    { label: "Expired",         value: expired,      Icon: ShieldX,     color: "text-red-600",     bg: "bg-red-50" },
  ];

  return (
    <Card className="h-full">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />Warranty Status
        </CardTitle>
        <Link href="/assets" className="text-xs text-primary hover:underline font-medium">Manage →</Link>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {rows.map(({ label, value, Icon, color, bg }) => (
          <div key={label} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
            <div className={`inline-flex rounded-lg p-2 ${bg}`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <span className="text-sm font-medium text-foreground flex-1">{label}</span>
            <span className="text-lg font-bold text-foreground tabular-nums">{value}</span>
          </div>
        ))}
        {noData > 0 && (
          <p className="text-[11px] text-muted-foreground text-center pt-0.5">
            {noData} asset{noData === 1 ? "" : "s"} missing warranty data
          </p>
        )}
      </CardContent>
    </Card>
  );
}
