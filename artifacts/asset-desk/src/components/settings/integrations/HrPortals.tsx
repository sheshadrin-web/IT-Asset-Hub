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
  CheckCircle2, CalendarClock, Activity, ChevronRight, Plus, Building2,
} from "lucide-react";

interface Props {
  onViewLogs: () => void;
}

const PROVIDER_DESCRIPTION: Record<ProviderId, string> = {
  zoho: "Sync employees from Zoho People and keep your user directory automatically updated. Connect multiple Zoho organisations to cover all your business units.",
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
  // Dialog state — provider + which existing row is being edited (null = add new)
  const [dialogProvider, setDialogProvider] = useState<ProviderDef | null>(null);
  const [dialogExisting, setDialogExisting] = useState<IntegrationRow | null>(null);
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

  /** All rows for a given provider id. */
  const rowsByProvider = (id: string) => rows.filter(r => r.provider_type === id);
  /** First row for a provider (single-instance providers). */
  const byProvider = (id: string) => rows.find(r => r.provider_type === id);

  const openAdd = (provider: ProviderDef) => {
    setDialogProvider(provider);
    setDialogExisting(null);
  };

  const openEdit = (provider: ProviderDef, existing: IntegrationRow) => {
    setDialogProvider(provider);
    setDialogExisting(existing);
  };

  const handleSave = async (provider: ProviderDef, cfg: IntegrationConfig) => {
    setSaving(true);
    try {
      const urlField = provider.fields.find(f => f.type === "url");
      const apiBaseUrl = (urlField ? cfg.values[urlField.key] : "") || null;
      const credentials: Record<string, string> = {};
      for (const [k, v] of Object.entries(cfg.values)) {
        // organization_name is not a credential — handled separately
        if (k === "organization_name") continue;
        if (v && v.trim()) credentials[k] = v.trim();
      }
      await saveIntegration({
        provider_type: provider.id,
        provider_name: provider.name,
        organization_name: cfg.values["organization_name"]?.trim() ?? "",
        api_base_url: apiBaseUrl,
        credentials,
        auto_sync: cfg.autoSync,
        frequency: cfg.frequency,
        existing_id: dialogExisting?.id,
      });
      setDialogProvider(null);
      setDialogExisting(null);
      const orgLabel = cfg.values["organization_name"]?.trim();
      toast({
        title: `${provider.name}${orgLabel ? ` — ${orgLabel}` : ""} connected`,
        description: "Credentials saved. Run a sync to pull employees.",
      });
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
      toast({ title: `${row.provider_name}${row.organization_name ? ` — ${row.organization_name}` : ""} disconnected`, description: "Stored credentials were cleared." });
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
              const providerRows = rowsByProvider(p.id);
              // For multi-instance: show count; for single: show status dot
              const connectedCount = providerRows.filter(r => r.status === "connected").length;
              const hasError      = providerRows.some(r => r.status === "error");
              const singleRow     = !p.multi_instance ? byProvider(p.id) : undefined;
              const st = p.multi_instance
                ? (hasError ? "error" : connectedCount > 0 ? "connected" : "not_connected")
                : (singleRow?.status ?? "not_connected");
              const meta   = STATUS_META[st];
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
                      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                      {p.multi_instance
                        ? connectedCount > 0
                          ? `${connectedCount} org${connectedCount !== 1 ? "s" : ""} connected`
                          : "Not connected"
                        : meta.label}
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
          {/* Provider header */}
          <div className="flex items-start gap-4">
            <div className={cn("flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl text-base font-bold ring-1", provider.accent)}>
              {provider.monogram}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-bold text-foreground">{provider.name}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {PROVIDER_DESCRIPTION[provider.id]}
              </p>
            </div>
          </div>

          {provider.multi_instance
            ? /* ── Multi-instance (Zoho): list of organisations ── */
              <MultiOrgPanel
                provider={provider}
                orgRows={rowsByProvider(provider.id)}
                busy={busy}
                onAdd={() => openAdd(provider)}
                onSync={handleSync}
                onConfigure={row => openEdit(provider, row)}
                onTest={handleTest}
                onDisconnect={handleDisconnect}
                onViewLogs={onViewLogs}
              />
            : /* ── Single-instance (Keka, Custom) ── */
              <SingleOrgPanel
                provider={provider}
                row={byProvider(provider.id)}
                busy={busy}
                onAdd={() => openAdd(provider)}
                onSync={handleSync}
                onConfigure={() => openAdd(provider)}
                onTest={handleTest}
                onDisconnect={handleDisconnect}
                onViewLogs={onViewLogs}
              />
          }
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
        existing={dialogExisting}
        open={dialogProvider !== null}
        saving={saving}
        onClose={() => { setDialogProvider(null); setDialogExisting(null); }}
        onConnect={cfg => dialogProvider && handleSave(dialogProvider, cfg)}
      />
    </div>
  );
}

// ── Multi-org panel (Zoho) ────────────────────────────────────────────────────

interface MultiOrgPanelProps {
  provider: ProviderDef;
  orgRows: IntegrationRow[];
  busy: string | null;
  onAdd: () => void;
  onSync: (row: IntegrationRow) => void;
  onConfigure: (row: IntegrationRow) => void;
  onTest: (row: IntegrationRow) => void;
  onDisconnect: (row: IntegrationRow) => void;
  onViewLogs: () => void;
}

function MultiOrgPanel({
  provider, orgRows, busy, onAdd, onSync, onConfigure, onTest, onDisconnect, onViewLogs,
}: MultiOrgPanelProps) {
  if (orgRows.length === 0) {
    return (
      <div className="mt-6 border-t border-card-border/70 pt-6">
        <div className="rounded-xl border border-dashed border-card-border/70 bg-muted/30 px-4 py-8 text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">No organisations connected</p>
          <p className="text-xs text-muted-foreground mb-4">
            Connect your first Zoho People organisation to start syncing employees.
          </p>
          <Button size="sm" onClick={onAdd} data-testid={`button-connect-${provider.id}`}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Connect Organisation
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 border-t border-card-border/70 pt-5 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold text-foreground">
          Connected Organisations
          <span className="ml-2 text-xs font-normal text-muted-foreground">({orgRows.length})</span>
        </p>
        <Button size="sm" variant="outline" onClick={onAdd} data-testid={`button-add-org-${provider.id}`}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Organisation
        </Button>
      </div>

      {orgRows.map(row => {
        const meta    = STATUS_META[row.status];
        const rowBusy = busy === row.id;
        const orgName = row.organization_name || row.provider_name;
        return (
          <div
            key={row.id}
            className="rounded-xl border border-border bg-background p-4 space-y-3"
            data-testid={`org-row-${row.id}`}
          >
            {/* Org header */}
            <div className="flex items-center gap-3">
              <div className={cn("flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold ring-1", provider.accent)}>
                {orgName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">{orgName}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <Badge variant={meta.badge} className="gap-1 text-[10px] px-1.5 py-0">
                    <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} /> {meta.label}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    Last sync: {formatLastSync(row.last_sync_at)}
                  </span>
                </div>
              </div>
              <span className="text-[11px] text-muted-foreground hidden sm:block">
                Next: {computeNextSync(row)}
              </span>
            </div>

            {row.last_error && (
              <p className="text-xs text-red-600 rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                {row.last_error}
              </p>
            )}

            {/* Sync metrics row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <DetailTile icon={Activity}      label="Sync Type"  value="Full Sync" />
              <DetailTile icon={CheckCircle2}  label="Last Sync"  value={formatLastSync(row.last_sync_at)} />
              <DetailTile icon={CalendarClock} label="Next Sync"  value={computeNextSync(row)} />
              <DetailTile
                icon={Activity}
                label="Status"
                value={row.status === "error" ? "Attention" : "Active"}
                tone={row.status === "error" ? "red" : "emerald"}
              />
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 pt-1 border-t border-border/60">
              <Button size="sm" onClick={() => onSync(row)} disabled={rowBusy} data-testid={`button-sync-${row.id}`}>
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", rowBusy && "animate-spin")} /> Sync Now
              </Button>
              <Button size="sm" variant="outline" onClick={() => onConfigure(row)} data-testid={`button-configure-${row.id}`}>
                <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Configure
              </Button>
              <Button size="sm" variant="outline" onClick={() => onTest(row)} disabled={rowBusy} data-testid={`button-test-${row.id}`}>
                <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> Test
              </Button>
              <Button size="sm" variant="ghost" onClick={onViewLogs} data-testid={`button-logs-${row.id}`}>
                <FileClock className="mr-1.5 h-3.5 w-3.5" /> Logs
              </Button>
              <Button
                size="sm" variant="ghost"
                className="text-destructive hover:text-destructive ml-auto"
                onClick={() => onDisconnect(row)} disabled={rowBusy}
                data-testid={`button-disconnect-${row.id}`}
              >
                <Unplug className="mr-1.5 h-3.5 w-3.5" /> Disconnect
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Single-instance panel (Keka, Custom) ─────────────────────────────────────

interface SingleOrgPanelProps {
  provider: ProviderDef;
  row: IntegrationRow | undefined;
  busy: string | null;
  onAdd: () => void;
  onSync: (row: IntegrationRow) => void;
  onConfigure: () => void;
  onTest: (row: IntegrationRow) => void;
  onDisconnect: (row: IntegrationRow) => void;
  onViewLogs: () => void;
}

function SingleOrgPanel({
  provider, row, busy, onAdd, onSync, onConfigure, onTest, onDisconnect, onViewLogs,
}: SingleOrgPanelProps) {
  const configured  = !!row && row.status !== "not_connected";
  const activeStatus = row?.status ?? "not_connected";
  const activeMeta   = STATUS_META[activeStatus];
  const rowBusy      = row ? busy === row.id : false;

  if (!configured || !row) {
    return (
      <div className="mt-6 border-t border-card-border/70 pt-6">
        <div className="rounded-xl border border-dashed border-card-border/70 bg-muted/30 px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            {provider.name} is not connected yet. Add your credentials to start syncing employees.
          </p>
          <Button size="sm" className="mt-4" onClick={onAdd} data-testid={`button-connect-${provider.id}`}>
            <Plug2 className="mr-1.5 h-3.5 w-3.5" /> Connect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 mb-2">
        <Badge variant={activeMeta.badge} className="gap-1 text-[11px]">
          <span className={cn("h-1.5 w-1.5 rounded-full", activeMeta.dot)} /> {activeMeta.label}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DetailTile icon={Activity}      label="Sync Type" value="Full Sync" />
        <DetailTile icon={CheckCircle2}  label="Last Sync" value={formatLastSync(row.last_sync_at)} />
        <DetailTile icon={CalendarClock} label="Next Sync" value={computeNextSync(row)} />
        <DetailTile
          icon={Activity}
          label="Status"
          value={activeStatus === "error" ? "Attention" : "Active"}
          tone={activeStatus === "error" ? "red" : "emerald"}
        />
      </div>

      {row.last_error && (
        <p className="mt-3 text-xs text-red-600">{row.last_error}</p>
      )}

      <div className="mt-6 flex flex-wrap gap-2 border-t border-card-border/70 pt-5">
        <Button size="sm" onClick={() => onSync(row)} disabled={rowBusy} data-testid={`button-sync-${provider.id}`}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", rowBusy && "animate-spin")} /> Sync Now
        </Button>
        <Button size="sm" variant="outline" onClick={onConfigure} data-testid={`button-configure-${provider.id}`}>
          <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Configure
        </Button>
        <Button size="sm" variant="outline" onClick={() => onTest(row)} disabled={rowBusy} data-testid={`button-test-${provider.id}`}>
          <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> Test Connection
        </Button>
        <Button size="sm" variant="ghost" onClick={onViewLogs} data-testid={`button-logs-${provider.id}`}>
          <FileClock className="mr-1.5 h-3.5 w-3.5" /> View Logs
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
          onClick={() => onDisconnect(row)} disabled={rowBusy}
          data-testid={`button-disconnect-${provider.id}`}
        >
          <Unplug className="mr-1.5 h-3.5 w-3.5" /> Disconnect
        </Button>
      </div>
    </>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

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
