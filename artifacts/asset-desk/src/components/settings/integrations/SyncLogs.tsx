import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabaseClient";
import { getSyncLogs } from "@/lib/integrationService";
import type { SyncLogRow, SyncStatus } from "@/lib/hrSyncTypes";
import { FileClock, RefreshCw, AlertCircle } from "lucide-react";

const STATUS_BADGE: Record<SyncStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  running: { label: "Running", variant: "secondary" },
  success: { label: "Success", variant: "default" },
  partial: { label: "Partial", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function SyncLogs() {
  const { session, loading: authLoading } = useAuth();
  const [logs, setLogs] = useState<SyncLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session) { setLoading(false); return; }
    setLoading(true);
    try {
      setLogs(await getSyncLogs(50));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sync logs");
    } finally {
      setLoading(false);
    }
  }, [session, authLoading]);

  useEffect(() => { void load(); }, [load]);

  return (
    <SettingsCard
      icon={FileClock}
      title="Sync Logs"
      description="A record of every HR sync — start time, status, and how many employees were fetched, created, updated, deactivated, and how many assets moved into recovery."
      action={
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} data-testid="button-refresh-logs">
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      }
    >
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3 mb-4" data-testid="error-sync-logs">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : logs.length === 0 && !error ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center" data-testid="empty-sync-logs">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <FileClock className="h-6 w-6 text-muted-foreground/40" />
          </div>
          <p className="text-sm font-medium text-foreground">No sync logs yet</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Once an HR portal is connected and a sync runs, each run will appear here with its results and any errors.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-card-border/70 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Provider</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Fetched</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Updated</TableHead>
                <TableHead className="text-right">Deactivated</TableHead>
                <TableHead className="text-right">Recovered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map(l => {
                const b = STATUS_BADGE[l.sync_status];
                return (
                  <TableRow key={l.id} data-testid={`sync-log-${l.id}`}>
                    <TableCell className="font-medium">{l.provider_name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{fmt(l.started_at)}</TableCell>
                    <TableCell><Badge variant={b.variant} className="text-[10px]">{b.label}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{l.employees_fetched}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.users_created}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.users_updated}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.users_deactivated}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.assets_recovered}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </SettingsCard>
  );
}
