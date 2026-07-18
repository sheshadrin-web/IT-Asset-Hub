import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabaseClient";
import { getHrDashboardSummary } from "@/lib/dashboardHrService";
import type { HrDashboardSummary } from "@/lib/hrSyncTypes";
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

  const [summary, setSummary] = useState<HrDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session) { setLoading(false); return; }
    if (!canRead) { setLoading(false); return; }
    try {
      setSummary(await getHrDashboardSummary());
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
    { label: "HR Integrations", value: summary?.integrations_connected ?? 0, icon: Plug, color: "text-violet-600", bg: "bg-violet-500/10", ring: "ring-violet-500/15", href: "/settings/integrations" },
    { label: "HR-Synced Users", value: summary?.hr_synced_users ?? 0, icon: RefreshCw, color: "text-blue-600", bg: "bg-blue-500/10", ring: "ring-blue-500/15", href: "/users" },
    { label: "Active Users", value: summary?.active_users ?? 0, icon: UsersIcon, color: "text-emerald-600", bg: "bg-emerald-500/10", ring: "ring-emerald-500/15", href: "/users" },
    { label: "Deactivated Users", value: summary?.deactivated_users ?? 0, icon: UserMinus, color: "text-amber-600", bg: "bg-amber-500/10", ring: "ring-amber-500/15", href: "/users" },
    { label: "Assets in Recovery", value: summary?.assets_in_recovery ?? 0, icon: ShieldAlert, color: "text-orange-600", bg: "bg-orange-500/10", ring: "ring-orange-500/15", href: "/asset-recovery" },
    { label: "Recovery Overdue", value: summary?.recovery_overdue ?? 0, icon: Clock, color: "text-red-600", bg: "bg-red-500/10", ring: "ring-red-500/15", href: "/asset-recovery" },
  ];

  return (
    <Card className="overflow-hidden border-border/70">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center shadow-sm shadow-orange-500/25">
              <Plug className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground leading-tight">HR &amp; Asset Recovery Overview</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Sync health, accounts & recovery status</p>
            </div>
          </div>
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
                <div
                  className="group relative overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-card to-muted/40 p-2.5 cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 hover:border-border"
                  data-testid={`widget-${c.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                >
                  <div className="flex items-center justify-between">
                    <div className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ring-1 ring-inset ${c.bg} ${c.ring}`}>
                      <c.icon className={`h-3.5 w-3.5 ${c.color}`} />
                    </div>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/20 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                  </div>
                  <p className="mt-2 text-lg font-bold text-foreground leading-none tracking-tight">{loading ? "—" : c.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{c.label}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
