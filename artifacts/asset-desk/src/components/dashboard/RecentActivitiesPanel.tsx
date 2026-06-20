import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Monitor, RotateCcw, Lock, Wrench, UserPlus, FileText } from "lucide-react";
import type { AuditLogRow } from "@/lib/auditService";

function iconFor(action: string): { Icon: React.ElementType; color: string; bg: string } {
  const a = action.toLowerCase();
  if (a.includes("lock"))    return { Icon: Lock,     color: "text-red-600",     bg: "bg-red-50" };
  if (a.includes("return"))  return { Icon: RotateCcw, color: "text-blue-600",   bg: "bg-blue-50" };
  if (a.includes("repair"))  return { Icon: Wrench,    color: "text-amber-600",  bg: "bg-amber-50" };
  if (a.includes("assign"))  return { Icon: Monitor,   color: "text-indigo-600", bg: "bg-indigo-50" };
  if (a.includes("user") || a.includes("profile")) return { Icon: UserPlus, color: "text-emerald-600", bg: "bg-emerald-50" };
  return { Icon: FileText, color: "text-muted-foreground", bg: "bg-muted" };
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function RecentActivitiesPanel({ audits, loading }: { audits: AuditLogRow[]; loading: boolean }) {
  const rows = audits.slice(0, 6);
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />Recent Activities
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No recent activity.</p>
        ) : (
          <div className="space-y-3">
            {rows.map(r => {
              const { Icon, color, bg } = iconFor(r.action);
              return (
                <div key={r.id} className="flex items-start gap-3">
                  <div className={`inline-flex rounded-lg p-1.5 ${bg} mt-0.5`}>
                    <Icon className={`h-3.5 w-3.5 ${color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground leading-tight">{r.action}</p>
                    <p className="text-xs text-muted-foreground truncate">{r.description ?? r.actor_name ?? "—"}</p>
                  </div>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">{timeAgo(r.created_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
