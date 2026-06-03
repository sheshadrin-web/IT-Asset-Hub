import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabaseClient";
import { getAuditLogs, type AuditLogRow } from "@/lib/auditService";
import { cn } from "@/lib/utils";
import { ScrollText, RefreshCw, AlertCircle } from "lucide-react";

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function humanize(value: string | null): string {
  if (!value) return "—";
  return value.replace(/[._]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

const CATEGORY_STYLE: Record<string, string> = {
  integration:      "bg-blue-500/12 text-blue-700",
  user:             "bg-rose-500/12 text-rose-700",
  asset:            "bg-amber-500/12 text-amber-700",
  recovery:         "bg-amber-500/12 text-amber-700",
  automation_rules: "bg-violet-500/12 text-violet-700",
  field_mapping:    "bg-slate-500/12 text-slate-700",
  onboarding:       "bg-emerald-500/12 text-emerald-700",
};

function actionStyle(action: string): string {
  return CATEGORY_STYLE[action.split(".")[0]] ?? "bg-slate-500/12 text-slate-700";
}

export default function AuditLogs() {
  const { session, loading: authLoading } = useAuth();
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session) { setLoading(false); return; }
    setLoading(true);
    try {
      setLogs(await getAuditLogs(100));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [session, authLoading]);

  useEffect(() => { void load(); }, [load]);

  return (
    <SettingsCard
      icon={ScrollText}
      title="Audit Logs"
      description="A chronological record of key actions across the IT Asset Hub — HR syncs, user deactivations, asset recovery, and integration changes."
      action={
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} data-testid="button-refresh-audit">
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} /> Refresh
        </Button>
      }
    >
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3 mb-4" data-testid="error-audit-logs">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : logs.length === 0 && !error ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center" data-testid="empty-audit-logs">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <ScrollText className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No audit events yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">Actions like HR syncs, recovery updates, and integration changes will appear here.</p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map(log => (
                <TableRow key={log.id} data-testid={`audit-row-${log.id}`}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmt(log.created_at)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    <span className="font-medium text-foreground">{log.actor_name ?? "System"}</span>
                  </TableCell>
                  <TableCell>
                    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", actionStyle(log.action))}>
                      {humanize(log.action)}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{humanize(log.entity_type)}</TableCell>
                  <TableCell className="text-sm text-foreground max-w-md">{log.description ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SettingsCard>
  );
}
