import { Link } from "wouter";
import { Package, Monitor, CheckCircle, Wrench, ShieldAlert, Ticket } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Asset } from "@/data/mockData";

export default function AdminKpiRow({ assets, openTickets }: { assets: Asset[]; openTickets: number }) {
  const total     = assets.length;
  const assigned  = assets.filter(a => a.status === "Assigned").length;
  const available = assets.filter(a => a.status === "Available").length;
  const repair    = assets.filter(a => a.status === "Under Repair").length;
  const recovery  = assets.filter(a => a.status === "Recovery Stage").length;
  const pct = (n: number) => (total ? `${((n / total) * 100).toFixed(1)}% of total` : "—");

  const cards = [
    { label: "Total Assets",     value: total,      sub: "All locations",      Icon: Package,     color: "text-blue-600",    bg: "bg-blue-50",    href: "/assets" },
    { label: "Assigned Assets",  value: assigned,   sub: pct(assigned),        Icon: Monitor,     color: "text-indigo-600",  bg: "bg-indigo-50",  href: "/assets" },
    { label: "Available Assets", value: available,  sub: pct(available),       Icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50", href: "/assets" },
    { label: "Under Repair",     value: repair,     sub: pct(repair),          Icon: Wrench,      color: "text-amber-600",   bg: "bg-amber-50",   href: "/assets" },
    { label: "In Recovery",      value: recovery,   sub: pct(recovery),        Icon: ShieldAlert, color: "text-purple-600",  bg: "bg-purple-50",  href: "/asset-recovery" },
    { label: "Open Tickets",     value: openTickets, sub: "Awaiting response", Icon: Ticket,      color: "text-blue-600",    bg: "bg-blue-50",    href: "/tickets" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map(({ label, value, sub, Icon, color, bg, href }) => (
        <Link key={label} href={href}>
          <Card className="cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2.5">
                <div className={`inline-flex rounded-xl p-2.5 ${bg}`}>
                  <Icon className={`h-4 w-4 ${color}`} />
                </div>
                <span className="text-[11px] font-semibold text-muted-foreground text-right">{sub}</span>
              </div>
              <div className="text-2xl font-bold text-foreground leading-none">{value}</div>
              <div className="text-xs text-muted-foreground mt-1.5 font-medium">{label}</div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
