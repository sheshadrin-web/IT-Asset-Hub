import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabaseClient";
import {
  PROVIDERS, STATUS_META, formatLastSync, type ProviderDef,
} from "@/lib/hrIntegrations";
import type { IntegrationRow } from "@/lib/hrSyncTypes";
import {
  getIntegrations, saveIntegration, disconnectIntegration, testIntegration, runSync,
} from "@/lib/integrationService";
import IntegrationConfigDialog, { type IntegrationConfig } from "./IntegrationConfigDialog";
import { Plug, RefreshCw, Settings2, FileClock, Unplug, Plug2, FlaskConical, AlertCircle } from "lucide-react";

interface Props {
  onViewLogs: () => void;
}

export default function HrPortals({ onViewLogs }: Props) {
  const { toast } = useToast();
  const { session, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogProvider, setDialogProvider] = useState<ProviderDef | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session) { setLoading(false); return; }
    setLoading(true);
    try {
      setRows(await getIntegrations());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, [session, authLoading]);

  useEffect(() => { void load(); }, [load]);

  const byProvider = (id: string) => rows.find(r => r.provider_type === id);
  const noneConnected = !rows.some(r => r.status === "connected");

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
        description: `${res.employees_fetched} employees fetched · ${res.users_created} new · ${res.users_updated} updated · ${res.offboarding_detected} offboarding.`,
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

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3" data-testid="error-integrations">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {noneConnected && !error && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 flex items-start gap-3" data-testid="empty-integrations">
          <Plug className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-sm text-muted-foreground">
            Connect your HR portal to automate onboarding, offboarding, and asset recovery.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PROVIDERS.map(provider => {
          const row = byProvider(provider.id);
          const status = row?.status ?? "not_connected";
          const meta = STATUS_META[status];
          const connected = status === "connected";
          const rowBusy = row ? busy === row.id : false;
          return (
            <Card key={provider.id} className="overflow-hidden" data-testid={`card-integration-${provider.id}`}>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <div className={`h-11 w-11 rounded-xl flex items-center justify-center text-sm font-bold ring-1 ${provider.accent}`}>
                    {provider.monogram}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground truncate">{provider.name}</h3>
                      <Badge variant={meta.badge} className="text-[10px] gap-1 flex-shrink-0">
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} /> {meta.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{provider.tagline}</p>
                    <p className="text-[11px] text-muted-foreground/70 mt-1">
                      Last sync: <span className="font-medium text-muted-foreground">{formatLastSync(row?.last_sync_at ?? null)}</span>
                    </p>
                    {row?.last_error && (
                      <p className="text-[11px] text-red-600 mt-1">{row.last_error}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {connected && row ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => handleSync(row)} disabled={rowBusy} data-testid={`button-sync-${provider.id}`}>
                        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${rowBusy ? "animate-spin" : ""}`} /> Sync Now
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleTest(row)} disabled={rowBusy} data-testid={`button-test-${provider.id}`}>
                        <FlaskConical className="h-3.5 w-3.5 mr-1.5" /> Test
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDialogProvider(provider)} data-testid={`button-configure-${provider.id}`}>
                        <Settings2 className="h-3.5 w-3.5 mr-1.5" /> Configure
                      </Button>
                      <Button size="sm" variant="ghost" onClick={onViewLogs} data-testid={`button-logs-${provider.id}`}>
                        <FileClock className="h-3.5 w-3.5 mr-1.5" /> Logs
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDisconnect(row)} disabled={rowBusy} data-testid={`button-disconnect-${provider.id}`}>
                        <Unplug className="h-3.5 w-3.5 mr-1.5" /> Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => setDialogProvider(provider)} data-testid={`button-connect-${provider.id}`}>
                      <Plug2 className="h-3.5 w-3.5 mr-1.5" /> Connect
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
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
