import { Link } from "wouter";
import { Wrench, ShieldAlert, Ticket, ArrowRight } from "lucide-react";
import type { Asset } from "@/data/mockData";
import { ACCESSORY_TYPES } from "@/lib/assetEmoji";

// ─── Category definitions ─────────────────────────────────────────────────────
// Each entry declares which assetType strings map to that card.
interface CategoryDef {
  label:     string;
  emoji:     string;
  types:     string[];
  viewLabel: string;
}

const CATEGORIES: CategoryDef[] = [
  { label: "Laptops",              emoji: "💻", types: ["Laptop"],               viewLabel: "View Laptops"      },
  { label: "Mobiles",              emoji: "📱", types: ["Mobile", "Tab", "Tablet"], viewLabel: "View Mobiles"   },
  { label: "SIM Cards",            emoji: "🪪", types: ["Sim Card"],              viewLabel: "View SIM Cards"   },
  { label: "Desktops",             emoji: "🖥️", types: ["Desktop", "CPU"],        viewLabel: "View Desktops"    },
  { label: "Monitors",             emoji: "🖥", types: ["Monitor"],               viewLabel: "View Monitors"    },
  { label: "Headphones / Accessories", emoji: "🎧", types: [...ACCESSORY_TYPES] as string[], viewLabel: "View Accessories" },
];

interface CategoryStats { total: number; assigned: number; available: number }

function computeStats(assets: Asset[], types: string[]): CategoryStats {
  const typeSet = new Set(types);
  const subset  = assets.filter(a => typeSet.has(a.assetType ?? ""));
  return {
    total:     subset.length,
    assigned:  subset.filter(a => a.status === "Assigned").length,
    available: subset.filter(a => a.status === "Available").length,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AdminKpiRow({
  assets,
  openTickets,
}: {
  assets: Asset[];
  openTickets: number;
}) {
  const underRepair = assets.filter(a => a.status === "Under Repair").length;
  const inRecovery  = assets.filter(a => a.status === "Recovery Stage").length;

  const ALERTS = [
    {
      Icon: Wrench,
      iconBg: "bg-orange-100",
      iconColor: "text-orange-600",
      count: underRepair,
      label: "Under Repair",
      sub: "Awaiting repair / parts",
      href: "/assets",
    },
    {
      Icon: ShieldAlert,
      iconBg: "bg-purple-100",
      iconColor: "text-purple-600",
      count: inRecovery,
      label: "In Recovery",
      sub: "Awaiting return from employees",
      href: "/asset-recovery",
    },
    {
      Icon: Ticket,
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
      count: openTickets,
      label: "Open Tickets",
      sub: "Awaiting response",
      href: "/tickets",
    },
  ] as const;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      {/* ── Section header ── */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border/70">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Asset Overview by Category</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Live summary of all asset types</p>
        </div>
        <Link
          href="/assets"
          className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          View all assets <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* ── Body ── */}
      <div className="p-4 flex flex-col lg:flex-row gap-4">
        {/* ── Left: 6 category cards in a 3×2 grid ── */}
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {CATEGORIES.map(cat => {
            const stats = computeStats(assets, cat.types);
            return (
              <Link key={cat.label} href="/assets">
                <div className="group rounded-xl border border-border bg-background p-3.5 flex flex-col gap-2 cursor-pointer hover:border-primary/40 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 h-full">
                  {/* Card header — emoji + label */}
                  <div className="flex items-center gap-2">
                    <span className="text-xl leading-none select-none">{cat.emoji}</span>
                    <span className="text-[13px] font-semibold text-foreground leading-tight">
                      {cat.label}
                    </span>
                  </div>

                  {/* Total count */}
                  <div>
                    <div className="text-3xl font-bold text-foreground leading-none tracking-tight">
                      {stats.total}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 font-medium">Total</div>
                  </div>

                  {/* Assigned / Available badges */}
                  <div className="flex gap-1.5">
                    <div className="flex-1 rounded-lg border border-blue-200 bg-blue-50 px-1.5 py-1.5 text-center">
                      <div className="text-sm font-bold text-blue-700 leading-none">
                        {stats.assigned}
                      </div>
                      <div className="text-[10px] text-blue-600 font-medium mt-0.5">Assigned</div>
                    </div>
                    <div className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 px-1.5 py-1.5 text-center">
                      <div className="text-sm font-bold text-emerald-700 leading-none">
                        {stats.available}
                      </div>
                      <div className="text-[10px] text-emerald-600 font-medium mt-0.5">Available</div>
                    </div>
                  </div>

                  {/* View link */}
                  <div className="text-[11px] font-semibold text-primary group-hover:underline mt-auto pt-0.5">
                    {cat.viewLabel} →
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* ── Right: Quick Alerts panel ── */}
        <div className="w-full lg:w-[200px] lg:shrink-0 rounded-xl border border-border bg-background overflow-hidden flex flex-col">
          <div className="px-3.5 py-2.5 border-b border-border/70">
            <p className="text-xs font-semibold text-foreground">Quick Alerts</p>
          </div>

          <div className="flex-1 divide-y divide-border/60">
            {ALERTS.map(({ Icon, iconBg, iconColor, count, label, sub, href }) => (
              <Link key={label} href={href}>
                <div className="flex items-center gap-3 px-3.5 py-3.5 hover:bg-muted/40 transition-colors cursor-pointer">
                  <div className={`rounded-xl p-2 ${iconBg} shrink-0`}>
                    <Icon className={`h-4 w-4 ${iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xl font-bold text-foreground leading-none">{count}</div>
                    <div className="text-[11px] font-semibold text-foreground mt-0.5 truncate">
                      {label}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                      {sub}
                    </div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                </div>
              </Link>
            ))}
          </div>

          <div className="border-t border-border/70 px-3.5 py-2.5">
            <Link
              href="/tickets"
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
            >
              View All Tickets <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
