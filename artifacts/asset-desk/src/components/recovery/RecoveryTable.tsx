import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { RecoveryRow, RecoveryStatus } from "@/lib/hrSyncTypes";
import { RECOVERY_STATUS_META } from "@/lib/hrSyncTypes";
import {
  locateRecovery, markRecovered, notifyRecovery, updateRecoveryStatus,
} from "@/lib/recoveryService";
import { MapPin, Mail, CheckCircle2, ShieldX } from "lucide-react";

const STATUS_OPTIONS: RecoveryStatus[] = [
  "recovery_pending", "recovery_in_progress", "not_reachable", "escalated", "recovered", "lost",
];

function fmt(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

interface Props {
  rows: RecoveryRow[];
  canAct: boolean;
  onChanged: () => void;
  /** Compact mode hides the device-detail columns (used on the dashboard). */
  compact?: boolean;
}

export default function RecoveryTable({ rows, canAct, onChanged, compact }: Props) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusyId(id);
    try {
      await fn();
      toast({ title: ok });
      onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: "Action failed", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyId(null);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="px-4 py-10 text-center" data-testid="empty-recovery">
        <ShieldX className="h-8 w-8 mx-auto text-muted-foreground/25 mb-3" />
        <p className="text-sm text-muted-foreground">No assets in recovery.</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Offboarding detected by an HR sync will list assets here.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Device / Asset</TableHead>
            <TableHead>Status</TableHead>
            {!compact && <TableHead>Last Seen</TableHead>}
            {!compact && <TableHead>Last Known IP</TableHead>}
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => {
            const meta = RECOVERY_STATUS_META[r.recovery_status];
            const busy = busyId === r.id;
            const done = r.recovery_status === "recovered";
            return (
              <TableRow key={r.id} data-testid={`recovery-row-${r.id}`}>
                <TableCell>
                  <div className="font-medium text-foreground">{r.employee_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.employee_code ?? ""}{r.department ? ` · ${r.department}` : ""}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-medium text-foreground">
                    {r.asset_model ?? r.hostname ?? "Unregistered device"}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {r.asset_tag ?? r.signed_in_user ?? "—"}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={meta.badge} className="text-[10px] gap-1">
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} /> {meta.label}
                  </Badge>
                </TableCell>
                {!compact && <TableCell className="text-xs text-muted-foreground">{fmt(r.last_seen_at)}</TableCell>}
                {!compact && (
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="font-mono">{r.last_known_ip ?? "—"}</div>
                    {r.last_known_location && <div className="text-[11px]">{r.last_known_location}</div>}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  {canAct ? (
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      <Button size="sm" variant="outline" disabled={busy || done}
                        onClick={() => run(r.id, () => locateRecovery(r.id), "Device located")}
                        data-testid={`button-locate-${r.id}`}>
                        <MapPin className="h-3.5 w-3.5 mr-1" /> Locate
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy || done}
                        onClick={() => run(r.id, async () => {
                          const res = await notifyRecovery(r.id, "manager");
                          toast({ title: "Manager notified", description: res.message });
                        }, "Notification queued")}
                        data-testid={`button-notify-${r.id}`}>
                        <Mail className="h-3.5 w-3.5 mr-1" /> Notify
                      </Button>
                      <Select
                        value={r.recovery_status}
                        onValueChange={v => run(r.id, () => updateRecoveryStatus(r.id, v as RecoveryStatus), "Status updated")}
                        disabled={busy}>
                        <SelectTrigger className="h-8 w-[140px]" data-testid={`select-status-${r.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map(s => (
                            <SelectItem key={s} value={s}>{RECOVERY_STATUS_META[s].label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!done && (
                        <Button size="sm" disabled={busy}
                          onClick={() => run(r.id, () => markRecovered(r.id), "Marked recovered")}
                          data-testid={`button-recovered-${r.id}`}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Recovered
                        </Button>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">View only</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
