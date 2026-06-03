import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabaseClient";
import { getRecoveryAssets } from "@/lib/recoveryService";
import type { RecoveryRow, RecoveryStatus } from "@/lib/hrSyncTypes";
import RecoveryTable from "@/components/recovery/RecoveryTable";
import { ShieldAlert, RefreshCw, AlertCircle } from "lucide-react";

const RECOVERY_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "recovery_pending", label: "Pending" },
  { value: "recovery_in_progress", label: "In Progress" },
  { value: "not_reachable", label: "Not Reachable" },
  { value: "escalated", label: "Escalated" },
  { value: "recovered", label: "Recovered" },
  { value: "lost", label: "Lost" },
];

export default function AssetRecovery() {
  const { session, loading: authLoading, currentUser } = useAuth();
  const canAct = currentUser?.role === "super_admin" || currentUser?.role === "it_admin";

  const [recovery, setRecovery] = useState<RecoveryRow[]>([]);
  const [recoveryFilter, setRecoveryFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session) { setLoading(false); return; }
    setLoading(true);
    try {
      const status = recoveryFilter === "all" ? null : (recoveryFilter as RecoveryStatus);
      const rec = await getRecoveryAssets(status);
      setRecovery(rec);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load asset recovery");
    } finally {
      setLoading(false);
    }
  }, [session, authLoading, recoveryFilter]);

  useEffect(() => { void load(); }, [load]);

  if (!supabaseConfigured) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Supabase is not configured in this environment.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" /> Asset Recovery
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Devices and assets to recover from employees who exited in the HR portal. Locate, notify, and update status as you go.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3" data-testid="error-asset-recovery">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-sm font-semibold">Assets in Recovery Mode</CardTitle>
            <CardDescription className="text-xs">
              Each row is an asset whose assigned employee was deactivated by HR sync.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={recoveryFilter} onValueChange={setRecoveryFilter}>
              <SelectTrigger className="h-9 w-[160px]" data-testid="select-recovery-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RECOVERY_FILTERS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} data-testid="button-refresh-recovery">
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <RecoveryTable rows={recovery} canAct={canAct} onChanged={() => void load()} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
