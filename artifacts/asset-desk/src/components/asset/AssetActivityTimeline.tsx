import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import TablePagination from "@/components/TablePagination";
import {
  UserPlus, RotateCcw, Lock, Unlock, RefreshCw, Image as ImageIcon,
  Trash2, KeyRound, Power, Activity, Cpu,
} from "lucide-react";

export interface TimelineHistoryRow {
  id: string;
  user_name: string | null;
  event_type: "assigned" | "returned" | "unassigned";
  event_by_name: string | null;
  notes: string | null;
  created_at: string;
}

export interface TimelineCommand {
  id: string;
  command_type: string;
  status: string;
  requested_at: string | null;
  executed_at: string | null;
  completed_at: string | null;
  requested_by_name: string | null;
}

interface TimelineEvent {
  id: string;
  ts: number;
  whenIso: string;
  title: string;
  detail: string;
  Icon: React.ElementType;
  tone: "blue" | "emerald" | "amber" | "red" | "slate" | "violet";
}

const TONE_CLS: Record<TimelineEvent["tone"], string> = {
  blue:    "bg-blue-500/10 text-blue-600",
  emerald: "bg-emerald-500/10 text-emerald-600",
  amber:   "bg-amber-500/10 text-amber-600",
  red:     "bg-red-500/10 text-red-600",
  slate:   "bg-slate-500/10 text-slate-500",
  violet:  "bg-violet-500/10 text-violet-600",
};

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function mapCommand(c: TimelineCommand): Omit<TimelineEvent, "id" | "ts" | "whenIso"> | null {
  const by = c.requested_by_name ? `by ${c.requested_by_name}` : "";
  switch (c.command_type) {
    case "lock_screen":
      return { title: "Device Locked", detail: `Lock requested ${by}`.trim(), Icon: Lock, tone: "red" };
    case "unlock":
      return { title: "Device Unlocked", detail: `Unlock requested ${by}`.trim(), Icon: Unlock, tone: "emerald" };
    case "update_wallpaper":
      return { title: "Wallpaper Applied", detail: `Pushed ${by}`.trim(), Icon: ImageIcon, tone: "violet" };
    case "notify_restart":
    case "schedule_restart":
    case "force_restart":
      return { title: "Restart Requested", detail: `${c.command_type.replace("_", " ")} ${by}`.trim(), Icon: RefreshCw, tone: "amber" };
    case "sync_now":
      return { title: "Sync Requested", detail: `Manual sync ${by}`.trim(), Icon: RefreshCw, tone: "slate" };
    case "collect_system_info":
      return { title: "System Info Collected", detail: `Requested ${by}`.trim(), Icon: Cpu, tone: "slate" };
    case "uninstall_agent":
    case "force_remove_agent":
      return { title: "Agent Removed", detail: `${c.command_type.replace(/_/g, " ")} ${by}`.trim(), Icon: Trash2, tone: "slate" };
    default:
      return { title: c.command_type.replace(/_/g, " "), detail: `Requested ${by}`.trim(), Icon: Power, tone: "slate" };
  }
}

export default function AssetActivityTimeline({
  history, commands, agentInstalledAt, loading,
  onClear,
}: {
  history: TimelineHistoryRow[];
  commands: TimelineCommand[];
  agentInstalledAt?: string | null;
  loading?: boolean;
  onClear?: () => void;
}) {
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const events = useMemo(() => {
    const nextEvents: TimelineEvent[] = [];

    for (const h of history) {
      const assigned = h.event_type === "assigned";
      nextEvents.push({
        id: `h-${h.id}`,
        ts: new Date(h.created_at).getTime(),
        whenIso: h.created_at,
        title: assigned ? "Asset Assigned" : "Asset Returned",
        detail: [
          assigned ? h.user_name : h.user_name ? `from ${h.user_name}` : null,
          h.event_by_name ? `by ${h.event_by_name}` : null,
        ].filter(Boolean).join(" · ") || (assigned ? "Assigned" : "Returned"),
        Icon: assigned ? UserPlus : RotateCcw,
        tone: assigned ? "blue" : "emerald",
      });
    }

    for (const c of commands) {
      const m = mapCommand(c);
      if (!m) continue;
      const when = c.completed_at ?? c.executed_at ?? c.requested_at;
      if (!when) continue;
      nextEvents.push({ id: `c-${c.id}`, ts: new Date(when).getTime(), whenIso: when, ...m });
    }

    if (agentInstalledAt) {
      nextEvents.push({
        id: "agent-installed",
        ts: new Date(agentInstalledAt).getTime(),
        whenIso: agentInstalledAt,
        title: "Agent Installed",
        detail: "Device brought under management",
        Icon: KeyRound,
        tone: "violet",
      });
    }

    nextEvents.sort((a, b) => b.ts - a.ts);
    return nextEvents;
  }, [history, commands, agentInstalledAt]);

  const totalPages = Math.max(1, Math.ceil(events.length / rowsPerPage));
  const visibleEvents = events.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  // Keep the current page valid when refreshed data shrinks or a page-size
  // change makes the old page number out of range.
  useEffect(() => {
    setPage(current => Math.min(current, totalPages));
  }, [totalPages]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          Activity Timeline
          {events.length > 0 && (
            <span className="ml-auto flex items-center gap-2">
              <span className="text-xs font-normal text-muted-foreground">{events.length} events</span>
              {onClear && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-red-600"
                  onClick={onClear}
                  data-testid="button-clear-activity-timeline"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear
                </Button>
              )}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading activity…</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No recorded activity yet.</p>
        ) : (
          <ol className="relative space-y-4">
            <span className="absolute left-[15px] top-1 bottom-1 w-px bg-border" aria-hidden />
            {visibleEvents.map((e) => (
              <li key={e.id} className="relative flex gap-3">
                <span className={cn("relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-background", TONE_CLS[e.tone])}>
                  <e.Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm font-medium text-foreground">{e.title}</p>
                  {e.detail && <p className="text-xs text-muted-foreground truncate" title={e.detail}>{e.detail}</p>}
                  <p className="text-[11px] text-muted-foreground/80">{fmt(e.whenIso)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
      {!loading && events.length > 0 && (
        <TablePagination
          total={events.length}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={setPage}
          onRowsPerPageChange={setRowsPerPage}
          noun="events"
          rowsOptions={[10, 20, 50]}
        />
      )}
    </Card>
  );
}
