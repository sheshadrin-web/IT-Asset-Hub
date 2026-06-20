import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, FileWarning, Wrench, PackageCheck, ClipboardCheck } from "lucide-react";

interface Row {
  label: string;
  sub:   string;
  value: number;
  href:  string;
  Icon:  React.ElementType;
  color: string;
  bg:    string;
}

export default function PendingActionsPanel({
  shortagesPending, underRepair, returnsActive, pendingAck, loading,
}: {
  shortagesPending: number;
  underRepair:      number;
  returnsActive:    number;
  pendingAck:       number;
  loading:          boolean;
}) {
  const rows: Row[] = [
    { label: "Pending Shortage Requests", sub: "Needs your approval",     value: shortagesPending, href: "/locations",       Icon: FileWarning,    color: "text-amber-600",  bg: "bg-amber-50" },
    { label: "Assets Under Repair",       sub: "Awaiting dispatch / parts", value: underRepair,    href: "/assets",          Icon: Wrench,         color: "text-orange-600", bg: "bg-orange-50" },
    { label: "Pending Returns",           sub: "Awaiting return to IT",    value: returnsActive,    href: "/asset-recovery",  Icon: PackageCheck,   color: "text-blue-600",   bg: "bg-blue-50" },
    { label: "Pending Approvals",         sub: "Asset / user requests",    value: pendingAck,       href: "/assets",          Icon: ClipboardCheck, color: "text-purple-600", bg: "bg-purple-50" },
  ];

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />Pending Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(({ label, sub, value, href, Icon, color, bg }) => (
          <Link
            key={label}
            href={href}
            className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 hover:border-primary/40 hover:shadow-sm transition-all"
          >
            <div className={`inline-flex rounded-lg p-2 ${bg}`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground leading-tight">{label}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </div>
            <span className="text-lg font-bold text-foreground tabular-nums">{loading ? "…" : value}</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
