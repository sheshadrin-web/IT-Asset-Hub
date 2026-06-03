import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabaseClient";
import { getHrDashboardSummary } from "@/lib/dashboardHrService";
import { getRecoveryAssets } from "@/lib/recoveryService";
import type { HrDashboardSummary, RecoveryRow } from "@/lib/hrSyncTypes";
import RecoveryTable from "@/components/recovery/RecoveryTable";
import {
  Plug, RefreshCw, Users as UsersIcon, UserMinus, ShieldAlert, Clock, ArrowRight, AlertCircle,
} from "lucide-react";

function fmtSync(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "Never"
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Mirrors _hr_can_read() in the migration — only these roles may read HR data.
const HR_READ_ROLES = ["super_admin", "it_admin", "it_agent", "hr_admin"];

export default function HrOverview() {
  const { session, loading: authLoading, currentUser } = useAuth();
  const canRead = HR_READ_ROLES.includes(currentUser?.role ?? "");
  const canAct = currentUser?.role === "super_admin" || currentUser?.role === "it_admin";

  const [summary, setSummary] = useState<HrDashboardSummary | null>(null);
  const [recovery, setRecovery] = useState<RecoveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session) { setLoading(false); return; }
    if (!canRead) { setLoading(false); return; }
    try {
      const [s, r] = await Promise.all([
        getHrDashboardSummary(),
        getRecoveryAssets(null),
      ]);
      setSummary(s);
      // Active recovery only on the dashboard; recovered/lost live on the queues page.
      setRecovery(r.filter(x => x.recovery_status !== "recovered" && x.recovery_status !== "lost").slice(0, 5));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load HR overview");
    } finally {
      setLoading(false);
    }
  }, [session, authLoading, canRead]);

  useEffect(() => { void load(); }, [load]);

  if (!supabaseConfigured) return null;
  if (!canRead) return null;

  const cards = [
    { label: "HR Integrations", value: summary?.integrations_connected ?? 0, icon: Plug, color: "text-violet-600", bg: "bg-violet-500/10", href: "/settings/integrations" },
    { label: "HR-Synced Users", value: summary?.hr_synced_users ?? 0, icon: RefreshCw, color: "text-blue-600", bg: "bg-blue-500/10", href: "/users" },
    { label: "Active Users", value: summary?.active_users ?? 0, icon: UsersIcon, color: "text-emerald-600", bg: "bg-emerald-500/10", href: "/users" },
    { label: "Deactivated Users", value: summary?.deactivated_users ?? 0, icon: UserMinus, color: "text-amber-600", bg: "bg-amber-500/10", href: "/users" },
    { label: "Assets in Recovery", value: summary?.assets_in_recovery ?? 0, icon: ShieldAlert, color: "text-orange-600", bg: "bg-orange-500/10", href: "/asset-recovery" },
    { label: "Recovery Overdue", value: summary?.recovery_overdue ?? 0, icon: Clock, color: "text-red-600", bg: "bg-red-500/10", href: "/asset-recovery" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Plug className="h-4 w-4 text-muted-foreground" />
              HR &amp; Asset Recovery Overview
            </CardTitle>
            <span className="text-[11px] text-muted-foreground">
              Last HR sync: {loading ? "—" : fmtSync(summary?.last_hr_sync)}
              {!loading && (summary?.sync_errors ?? 0) > 0 && (
                <span className="ml-2 text-red-600 font-medium">{summary?.sync_errors} sync error(s)</span>
              )}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3" data-testid="error-hr-overview">
              <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              {cards.map(c => (
                <Link key={c.label} href={c.href}>
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 group" data-testid={`widget-${c.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${c.bg}`}>
                      <c.icon className={`h-4 w-4 ${c.color}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xl font-bold text-foreground leading-none">{loading ? "—" : c.value}</p>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{c.label}</p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/20 group-hover:text-muted-foreground transition-colors ml-auto flex-shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
          ) : (
            <RecoveryTable rows={recovery} canAct={canAct} onChanged={() => void load()} compact />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
