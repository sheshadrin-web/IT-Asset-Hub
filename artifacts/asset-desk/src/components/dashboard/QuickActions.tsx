import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Upload, UserPlus, RotateCcw, FileText, Ticket } from "lucide-react";

const ACTIONS = [
  { label: "Add Asset",      Icon: Plus,     href: "/assets",         color: "text-blue-600",    bg: "bg-blue-50" },
  { label: "Bulk Import",    Icon: Upload,   href: "/assets",         color: "text-indigo-600",  bg: "bg-indigo-50" },
  { label: "Add User",       Icon: UserPlus, href: "/users",          color: "text-emerald-600", bg: "bg-emerald-50" },
  { label: "Asset Recovery", Icon: RotateCcw,href: "/asset-recovery", color: "text-purple-600",  bg: "bg-purple-50" },
  { label: "View Reports",   Icon: FileText, href: "/reports",        color: "text-amber-600",   bg: "bg-amber-50" },
  { label: "Tickets",        Icon: Ticket,   href: "/tickets",        color: "text-blue-600",    bg: "bg-blue-50" },
];

export default function QuickActions() {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2.5">
          {ACTIONS.map(({ label, Icon, href, color, bg }) => (
            <Link
              key={label}
              href={href}
              className="flex flex-col items-center gap-2 rounded-xl border border-border px-2 py-3 text-center hover:border-primary/40 hover:shadow-sm transition-all"
            >
              <div className={`inline-flex rounded-lg p-2 ${bg}`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <span className="text-[11px] font-medium text-foreground leading-tight">{label}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
