import { Link } from "wouter";
import { AlertTriangle, PackageX, Wrench, ShieldAlert } from "lucide-react";
import type { Asset } from "@/data/mockData";
import type { ShortageRequest } from "@/lib/shortageRequests";

const PRIORITY_RANK: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

export default function AlertCards({ assets, shortages }: { assets: Asset[]; shortages: ShortageRequest[] }) {
  const total = assets.length;

  // Most urgent pending shortage.
  const urgent = [...shortages]
    .filter(s => s.status === "Pending")
    .sort((a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0))[0];

  // Location with the lowest availability (min available count, needs >0 assets).
  const byLoc = new Map<string, { available: number; total: number }>();
  for (const a of assets) {
    const loc = a.location || "Unassigned";
    const cur = byLoc.get(loc) ?? { available: 0, total: 0 };
    cur.total++;
    if (a.status === "Available") cur.available++;
    byLoc.set(loc, cur);
  }
  const lowAvail = [...byLoc.entries()]
    .filter(([, v]) => v.total >= 5)
    .sort((a, b) => a[1].available - b[1].available)[0];

  const underRepair = assets.filter(a => a.status === "Under Repair").length;
  const inRecovery  = assets.filter(a => a.status === "Recovery Stage").length;

  const cards = [
    urgent
      ? {
          tone: "amber" as const, Icon: AlertTriangle,
          title: `${urgent.location} needs ${urgent.quantityRequested} ${urgent.assetType}${urgent.quantityRequested > 1 ? "s" : ""}`,
          sub: `Priority: ${urgent.priority}`, badge: urgent.priority === "Critical" || urgent.priority === "High" ? "Urgent" : undefined,
          cta: "Review Request", href: "/locations",
        }
      : {
          tone: "emerald" as const, Icon: AlertTriangle,
          title: "No pending shortage requests", sub: "All location requests are handled",
          cta: "View Locations", href: "/locations",
        },
    lowAvail
      ? {
          tone: "blue" as const, Icon: PackageX,
          title: `${lowAvail[0]} low availability`, sub: `${lowAvail[1].available} asset${lowAvail[1].available === 1 ? "" : "s"} available`,
          badge: lowAvail[1].available <= 2 ? "Low Stock" : undefined, cta: "View Details", href: "/locations",
        }
      : {
          tone: "blue" as const, Icon: PackageX,
          title: "Availability looks healthy", sub: `${total} assets tracked`, cta: "View Details", href: "/locations",
        },
    {
      tone: "orange" as const, Icon: Wrench,
      title: `${underRepair} asset${underRepair === 1 ? "" : "s"} under repair`, sub: "In the repair queue",
      cta: "View Repair Queue", href: "/assets",
    },
    {
      tone: "purple" as const, Icon: ShieldAlert,
      title: `${inRecovery} asset${inRecovery === 1 ? "" : "s"} in recovery`, sub: "Awaiting return from employees",
      cta: "View Recovery", href: "/asset-recovery",
    },
  ];

  const tones: Record<string, { border: string; bg: string; icon: string }> = {
    amber:   { border: "border-amber-200",   bg: "bg-amber-50/60",   icon: "text-amber-600" },
    blue:    { border: "border-blue-200",    bg: "bg-blue-50/60",    icon: "text-blue-600" },
    orange:  { border: "border-orange-200",  bg: "bg-orange-50/60",  icon: "text-orange-600" },
    purple:  { border: "border-purple-200",  bg: "bg-purple-50/60",  icon: "text-purple-600" },
    emerald: { border: "border-emerald-200", bg: "bg-emerald-50/60", icon: "text-emerald-600" },
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map((c, i) => {
        const t = tones[c.tone];
        const Icon = c.Icon;
        return (
          <div key={i} className={`rounded-2xl border ${t.border} ${t.bg} p-4 flex flex-col`}>
            <div className="flex items-start gap-2.5">
              <Icon className={`h-5 w-5 ${t.icon} flex-shrink-0 mt-0.5`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-foreground leading-tight">{c.title}</p>
                  {c.badge && (
                    <span className="inline-flex items-center rounded-full bg-red-500/15 text-red-600 border border-red-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                      {c.badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{c.sub}</p>
              </div>
            </div>
            <Link href={c.href} className="mt-3 self-start text-xs font-semibold text-primary hover:underline">
              {c.cta} →
            </Link>
          </div>
        );
      })}
    </div>
  );
}
