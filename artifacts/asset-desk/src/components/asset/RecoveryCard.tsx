import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabaseClient";
import type { RecoveryRow, RecoveryStatus } from "@/lib/hrSyncTypes";
import { RECOVERY_STATUS_META } from "@/lib/hrSyncTypes";
import {
  getAssetRecovery, locateRecovery, markRecovered, notifyRecovery, updateRecoveryStatus,
} from "@/lib/recoveryService";
import { ShieldAlert, MapPin, Mail, CheckCircle2 } from "lucide-react";

const STATUS_OPTIONS: RecoveryStatus[] = [
  "recovery_pending", "recovery_in_progress", "not_reachable", "escalated", "recovered", "lost",
];

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

interface Props {
  assetId: string;
}

export default function RecoveryCard({ assetId }: Props) {
  const { toast } = useToast();
  const { session, loading: authLoading, currentUser } = useAuth();
  const canAct = currentUser?.role === "super_admin" || currentUser?.role === "it_admin";

  const [row, setRow] = useState<RecoveryRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session) { setLoading(false); return; }
    try {
      // null (no active recovery) is a normal result; only real RPC/network
      // failures throw and should be surfaced honestly.
      setRow(await getAssetRecovery(assetId));
      setError(null);
    } catch (e) {
      setRow(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [assetId, session, authLoading]);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: ok });
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: "Action failed", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  // A genuine failure to load recovery state — surface it instead of hiding it.
  if (error && !row) {
    return (
      <Card className="border-destructive/40" data-testid="card-recovery-error">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" /> Asset Recovery
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">Couldn't load recovery status: {error}</p>
          <Button size="sm" variant="outline" onClick={() => { setLoading(true); void load(); }} data-testid="button-recovery-card-retry">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // No recovery in progress for this asset → render nothing.
  if (!row) return null;

  const meta = RECOVERY_STATUS_META[row.recovery_status];
  const done = row.recovery_status === "recovered";

  return (
    <Card className="border-orange-200" data-testid="card-recovery">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-orange-500" /> Asset Recovery
        </CardTitle>
        <Badge variant={meta.badge} className="text-[10px] gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} /> {meta.label}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2.5 text-sm">
        {row.recovery_reason && (
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Reason</span><span className="font-medium text-right">{row.recovery_reason}</span></div>
        )}
        <div className="flex justify-between gap-3"><span className="text-muted-foreground">From employee</span><span className="font-medium text-right">{row.employee_name ?? "—"}</span></div>
        <div className="flex justify-between gap-3"><span className="text-muted-foreground">Last working day</span><span className="font-medium text-right">{fmt(row.last_working_date)}</span></div>
        <div className="flex justify-between gap-3"><span className="text-muted-foreground">Device last seen</span><span className="font-medium text-right">{fmt(row.last_seen_at)}</span></div>
        <div className="flex justify-between gap-3"><span className="text-muted-foreground">Last known IP</span><span className="font-mono text-xs text-right">{row.last_known_ip ?? "—"}</span></div>
        {row.last_known_location && (
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Location</span><span className="font-medium text-right">{row.last_known_location}</span></div>
        )}

        {canAct && (
          <div className="pt-2 space-y-2 border-t border-border">
            <Select value={row.recovery_status} disabled={busy}
              onValueChange={v => run(() => updateRecoveryStatus(row.id, v as RecoveryStatus), "Status updated")}>
              <SelectTrigger className="h-9" data-testid="select-recovery-card-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{RECOVERY_STATUS_META[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" disabled={busy || done}
                onClick={() => run(() => locateRecovery(row.id), "Device located")} data-testid="button-recovery-card-locate">
                <MapPin className="h-3.5 w-3.5 mr-1" /> Locate
              </Button>
              <Button size="sm" variant="outline" disabled={busy || done}
                onClick={() => run(async () => {
                  const res = await notifyRecovery(row.id, "manager");
                  toast({ title: "Manager notified", description: res.message });
                }, "Notification queued")} data-testid="button-recovery-card-notify">
                <Mail className="h-3.5 w-3.5 mr-1" /> Notify
              </Button>
            </div>
            {!done && (
              <Button size="sm" className="w-full" disabled={busy}
                onClick={() => run(() => markRecovered(row.id), "Marked recovered")} data-testid="button-recovery-card-recovered">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Recovered
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
