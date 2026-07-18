import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabaseClient";
import { getRecoveryAssets } from "@/lib/recoveryService";
import type { RecoveryRow } from "@/lib/hrSyncTypes";
import RecoveryTable from "@/components/recovery/RecoveryTable";
import { ShieldAlert, AlertCircle } from "lucide-react";

// Mirrors _hr_can_read() in the migration — only these roles may read HR data.
const HR_READ_ROLES = ["super_admin", "it_admin", "it_agent", "hr_admin"];

export default function AssetsInRecovery() {
  const { session, loading: authLoading, currentUser } = useAuth();
  const canRead = HR_READ_ROLES.includes(currentUser?.role ?? "");
  const canAct = currentUser?.role === "super_admin" || currentUser?.role === "it_admin";

  const [recovery, setRecovery] = useState<RecoveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session) { setLoading(false); return; }
    if (!canRead) { setLoading(false); return; }
    try {
      const r = await getRecoveryAssets(null);
      // Active recovery only on the dashboard; recovered/lost live on the queues page.
      setRecovery(r.filter(x => x.recovery_status !== "recovered" && x.recovery_status !== "lost").slice(0, 5));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assets in recovery");
    } finally {
      setLoading(false);
    }
  }, [session, authLoading, canRead]);

  useEffect(() => { void load(); }, [load]);

  if (!supabaseConfigured) return null;
  if (!canRead) return null;

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />Assets in Recovery Mode
        </CardTitle>
        <Link href="/asset-recovery" className="text-xs text-primary hover:underline font-medium">Manage all →</Link>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3" data-testid="error-assets-in-recovery">
            <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        ) : (
          <RecoveryTable rows={recovery} canAct={canAct} onChanged={() => void load()} compact />
        )}
      </CardContent>
    </Card>
  );
}
