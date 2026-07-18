import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { supabaseConfigured } from "@/lib/supabaseClient";
import {
  PROVIDERS, STATUS_META, formatLastSync, type ProviderDef, type ProviderId,
} from "@/lib/hrIntegrations";
import type { IntegrationRow, HrDashboardSummary } from "@/lib/hrSyncTypes";
import {
  getIntegrations, saveIntegration, disconnectIntegration, testIntegration, runSync,
} from "@/lib/integrationService";
import { getHrDashboardSummary } from "@/lib/dashboardHrService";
import IntegrationConfigDialog, { type IntegrationConfig } from "./IntegrationConfigDialog";
import {
  RefreshCw, Settings2, FileClock, Unplug, Plug2, FlaskConical, AlertCircle,
  CheckCircle2, CalendarClock, Activity, ChevronRight,
} from "lucide-react";

interface Props {
  onViewLogs: () => void;
}

/** Longer marketing-style descriptions for the centre detail card. */
const PROVIDER_DESCRIPTION: Record<ProviderId, string> = {
  zoho: "Sync employees from Zoho People and keep your user directory automatically updated.",
  keka: "Sync employees from Keka HR and keep your user directory automatically updated.",
  custom: "Connect any HRMS over a generic REST API to keep your user directory in sync.",
};

const SYNC_INTERVAL_MS: Record<string, number> = {
  hourly: 3_600_000,
  daily: 86_400_000,
  weekly: 604_800_000,
};

function computeNextSync(row: IntegrationRow | undefined): string {
  if (!row || !row.auto_sync_enabled) return "Manual";
  if (!row.last_sync_at) return "Pending first sync";
  const last = new Date(row.last_sync_at);
  if (Number.isNaN(last.getTime())) return "Pending first sync";
  const interval = SYNC_INTERVAL_MS[row.sync_frequency] ?? SYNC_INTERVAL_MS.daily;
  return formatLastSync(new Date(last.getTime() + interval).toISOString());
}

export default function HrPortals({ onViewLogs }: Props) {
  const { toast } = useToast();
  const { session, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [summary, setSummary] = useState<HrDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProviderId>("zoho");
  const [dialogProvider, setDialogProvider] = useState<ProviderDef | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session) { setLoading(false); return; }
    setLoading(true);
    try {
      const [integrations, dash] = await Promise.all([
        getIntegrations(),
        getHrDashboardSummary().catch(() => null),
      ]);
      setRows(integrations);
      setSummary(dash);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, [session, authLoading]);

  useEffect(() => { void load(); }, [load]);

  const byProvider = (id: string) => rows.find(r => r.provider_type === id);

  const handleSave = async (provider: ProviderDef, cfg: IntegrationConfig) => {
    setSaving(true);
    try {
      const urlField = provider.fields.find(f => f.type === "url");
      const apiBaseUrl = (urlField ? cfg.values[urlField.key] : "") || null;
      // Only send fields the admin actually typed; empty => keep existing secret.
      const credentials: Record<string, string> = {};
      for (const [k, v] of Object.entries(cfg.values)) {
        if (v && v.trim()) credentials[k] = v.trim();
      }
      await saveIntegration({
        provider_type: provider.id,
        provider_name: provider.name,
        api_base_url: apiBaseUrl,
        credentials,
        auto_sync: cfg.autoSync,
        frequency: cfg.frequency,
      });
      setDialogProvider(null);
      toast({ title: `${provider.name} connected`, description: "Credentials saved. Run a sync to pull employees." });
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not save integration", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async (row: IntegrationRow) => {
    if (busy) return;
    setBusy(row.id);
    try {
      const res = await runSync(row.id);
      toast({
        title: "Sync complete",
        description: `${res.employees_fetched} employees fetched · ${res.users_created} new · ${res.users_updated} updated · ${res.users_deactivated} deactivated · ${res.assets_recovered} assets to recovery.`,
      });
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: "Sync failed", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async (row: IntegrationRow) => {
    if (busy) return;
    setBusy(row.id);
    try {
      const res = await testIntegration(row.id);
      toast({ variant: res.ok ? "default" : "destructive", title: res.ok ? "Connection OK" : "Connection problem", description: res.message });
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: "Test failed", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async (row: IntegrationRow) => {
    if (busy) return;
    setBusy(row.id);
    try {
      await disconnectIntegration(row.id);
      toast({ title: `${row.provider_name} disconnected`, description: "Stored credentials were cleared." });
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not disconnect", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="py-10 text-center text-sm text-muted-foreground" data-testid="loading-integrations">Loading integrations…</div>;
  }

  const provider = PROVIDERS.find(p => p.id === selected) ?? PROVIDERS[0];
  const activeRow = byProvider(provider.id);
  const activeStatus = activeRow?.status ?? "not_connected";
  const activeMeta = STATUS_META[activeStatus];
  // A provider is "configured" once a record exists and it isn't explicitly
  // disconnected — errored-but-configured integrations keep their full action
  // set (Sync / Test / Disconnect) so admins can recover them.
  const configured = !!activeRow && activeStatus !== "not_connected";
  const rowBusy = activeRow ? busy === activeRow.id : false;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3" data-testid="error-integrations">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[260px_minmax(0,1fr)_300px] xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        {/* ── Left: provider navigation ─────────────────────────────── */}
        <aside
          className="rounded-2xl border border-slate-800/60 bg-slate-900 p-2.5 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.45)]"
          data-testid="panel-provider-nav"
        >
          <p className="px-2.5 pt-1.5 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            HR Providers
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
            {PROVIDERS.map(p => {
              const r = byProvider(p.id);
              const st = r?.status ?? "not_connected";
              const meta = STATUS_META[st];
              const active = p.id === selected;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p.id)}
                  className={cn(
                    "flex min-w-[180px] items-center gap-3 rounded-xl px-3 py-2.5 text-left transition lg:min-w-0",
                    active ? "bg-white shadow-sm" : "hover:bg-white/5",
                  )}
                  data-testid={`provider-nav-${p.id}`}
                >
                  <span className={cn("flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold ring-1", p.accent)}>
                    {p.monogram}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm font-semibold", active ? "text-slate-900" : "text-slate-100")}>
                      {p.name}
                    </span>
                    <span className={cn("mt-0.5 flex items-center gap-1.5 text-[11px]", active ? "text-slate-500" : "text-slate-400")}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} /> {meta.label}
                    </span>
                  </span>
                  {active && <ChevronRight className="hidden h-4 w-4 flex-shrink-0 text-slate-400 lg:block" />}
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Center: selected integration details ──────────────────── */}
        <section
          className="rounded-2xl border border-card-border/70 bg-card/85 p-6 shadow-[0_8px_30px_-15px_rgba(15,23,42,0.25)] backdrop-blur-md"
          data-testid={`panel-details-${provider.id}`}
        >
          <div className="flex items-start gap-4">
            <div className={cn("flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl text-base font-bold ring-1", provider.accent)}>
              {provider.monogram}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold text-foreground">{provider.name}</h3>
                <Badge variant={activeMeta.badge} className="gap-1 text-[11px]">
                  <span className={cn("h-1.5 w-1.5 rounded-full", activeMeta.dot)} /> {activeMeta.label}
                </Badge>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {PROVIDER_DESCRIPTION[provider.id]}
              </p>
            </div>
          </div>

          {configured && activeRow ? (
            <>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <DetailTile icon={Activity} label="Sync Type" value="Full Sync" />
                <DetailTile icon={CheckCircle2} label="Last Sync" value={formatLastSync(activeRow.last_sync_at)} />
                <DetailTile icon={CalendarClock} label="Next Sync" value={computeNextSync(activeRow)} />
                <DetailTile
                  icon={Activity}
                  label="Status"
                  value={activeStatus === "error" ? "Attention" : "Active"}
                  tone={activeStatus === "error" ? "red" : "emerald"}
                />
              </div>

              {activeRow.last_error && (
                <p className="mt-3 text-xs text-red-600">{activeRow.last_error}</p>
              )}

              <div className="mt-6 flex flex-wrap gap-2 border-t border-card-border/70 pt-5">
                <Button size="sm" onClick={() => handleSync(activeRow)} disabled={rowBusy} data-testid={`button-sync-${provider.id}`}>
                  <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", rowBusy && "animate-spin")} /> Sync Now
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDialogProvider(provider)} data-testid={`button-configure-${provider.id}`}>
                  <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Configure
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleTest(activeRow)} disabled={rowBusy} data-testid={`button-test-${provider.id}`}>
                  <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> Test Connection
                </Button>
                <Button size="sm" variant="ghost" onClick={onViewLogs} data-testid={`button-logs-${provider.id}`}>
                  <FileClock className="mr-1.5 h-3.5 w-3.5" /> View Logs
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDisconnect(activeRow)} disabled={rowBusy} data-testid={`button-disconnect-${provider.id}`}>
                  <Unplug className="mr-1.5 h-3.5 w-3.5" /> Disconnect
                </Button>
              </div>
            </>
          ) : (
            <div className="mt-6 border-t border-card-border/70 pt-6">
              <div className="rounded-xl border border-dashed border-card-border/70 bg-muted/30 px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {provider.name} is not connected yet. Add your credentials to start syncing employees.
                </p>
                <Button size="sm" className="mt-4" onClick={() => setDialogProvider(provider)} data-testid={`button-connect-${provider.id}`}>
                  <Plug2 className="mr-1.5 h-3.5 w-3.5" /> Connect
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* ── Right: sync summary ───────────────────────────────────── */}
        <aside
          className="rounded-2xl border border-card-border/70 bg-card/85 p-5 shadow-[0_8px_30px_-15px_rgba(15,23,42,0.25)] backdrop-blur-md"
          data-testid="panel-sync-summary"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Sync Summary</h3>
            <Activity className="h-4 w-4 text-primary" />
          </div>

          <div className="mt-4 space-y-2.5">
            <SummaryRow label="Total Employees" value={summary ? summary.active_users + summary.deactivated_users : "—"} />
            <SummaryRow label="Active Employees" value={summary?.active_users ?? "—"} />
            <SummaryRow label="Users Synced" value={summary?.hr_synced_users ?? "—"} />
            <SummaryRow label="Users Deactivated" value={summary?.deactivated_users ?? "—"} />
            <SummaryRow label="Assets in Recovery" value={summary?.assets_in_recovery ?? "—"} />
            <SummaryRow label="Last Sync" value={summary ? formatLastSync(summary.last_hr_sync) : "—"} />
          </div>

          <Button variant="outline" size="sm" className="mt-5 w-full" onClick={onViewLogs} data-testid="button-summary-logs">
            <FileClock className="mr-1.5 h-3.5 w-3.5" /> View Logs
          </Button>
        </aside>
      </div>

      <IntegrationConfigDialog
        provider={dialogProvider}
        existing={dialogProvider ? byProvider(dialogProvider.id) ?? null : null}
        open={dialogProvider !== null}
        saving={saving}
        onClose={() => setDialogProvider(null)}
        onConnect={cfg => dialogProvider && handleSave(dialogProvider, cfg)}
      />
    </div>
  );
}

function DetailTile({
  icon: Icon, label, value, tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone?: "emerald" | "red";
}) {
  return (
    <div className="rounded-xl border border-card-border/70 bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className={cn(
        "mt-1 truncate text-sm font-semibold",
        tone === "emerald" && "text-emerald-600",
        tone === "red" && "text-red-600",
        !tone && "text-foreground",
      )}>
        {value}
      </p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-card-border/50 pb-2.5 last:border-0 last:pb-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}
