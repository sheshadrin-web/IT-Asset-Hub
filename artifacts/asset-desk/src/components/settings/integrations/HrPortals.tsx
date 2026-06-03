import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  PROVIDERS, STATUS_META, formatLastSync,
  type ProviderId, type ProviderDef, type IntegrationStatus,
} from "@/lib/hrIntegrations";
import IntegrationConfigDialog, { type IntegrationConfig } from "./IntegrationConfigDialog";
import { Plug, RefreshCw, Settings2, FileClock, Unplug, Plug2 } from "lucide-react";

interface IntegrationState {
  status: IntegrationStatus;
  lastSync: string | null;
  config: IntegrationConfig | null;
}

const INITIAL: Record<ProviderId, IntegrationState> = {
  zoho: { status: "not_connected", lastSync: null, config: null },
  keka: { status: "not_connected", lastSync: null, config: null },
  custom: { status: "not_connected", lastSync: null, config: null },
};

interface Props {
  onViewLogs: () => void;
}

export default function HrPortals({ onViewLogs }: Props) {
  const { toast } = useToast();
  const [state, setState] = useState<Record<ProviderId, IntegrationState>>(INITIAL);
  const [dialogProvider, setDialogProvider] = useState<ProviderDef | null>(null);
  const [busy, setBusy] = useState<ProviderId | null>(null);

  const noneConnected = Object.values(state).every(s => s.status !== "connected");

  const handleConnect = (id: ProviderId, cfg: IntegrationConfig) => {
    setState(s => ({ ...s, [id]: { status: "connected", lastSync: new Date().toISOString(), config: cfg } }));
    setDialogProvider(null);
    toast({ title: "Connection configured (preview)", description: "Saved in this browser for preview only. Encrypted storage and live employee sync are enabled in a later phase." });
  };

  const handleSyncNow = (id: ProviderId) => {
    if (busy) return;
    setBusy(id);
    // Phase 1: there is no backend sync yet, so this only refreshes the
    // "last sync" timestamp locally and tells the admin what will happen.
    window.setTimeout(() => {
      setState(s => ({ ...s, [id]: { ...s[id], lastSync: new Date().toISOString() } }));
      setBusy(null);
      toast({ title: "Sync queued", description: "Manual sync will pull employees once the HR sync backend is connected." });
    }, 600);
  };

  const handleDisconnect = (id: ProviderId) => {
    setState(s => ({ ...s, [id]: { status: "not_connected", lastSync: null, config: null } }));
    toast({ title: "Integration disconnected" });
  };

  return (
    <div className="space-y-4">
      {noneConnected && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 flex items-start gap-3" data-testid="empty-integrations">
          <Plug className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-sm text-muted-foreground">
            Connect your HR portal to automate onboarding, offboarding, and asset recovery.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PROVIDERS.map(provider => {
          const s = state[provider.id];
          const meta = STATUS_META[s.status];
          const connected = s.status === "connected";
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
                      Last sync: <span className="font-medium text-muted-foreground">{formatLastSync(s.lastSync)}</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {connected ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => handleSyncNow(provider.id)} disabled={busy === provider.id} data-testid={`button-sync-${provider.id}`}>
                        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${busy === provider.id ? "animate-spin" : ""}`} /> Sync Now
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDialogProvider(provider)} data-testid={`button-configure-${provider.id}`}>
                        <Settings2 className="h-3.5 w-3.5 mr-1.5" /> Configure
                      </Button>
                      <Button size="sm" variant="ghost" onClick={onViewLogs} data-testid={`button-logs-${provider.id}`}>
                        <FileClock className="h-3.5 w-3.5 mr-1.5" /> Logs
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDisconnect(provider.id)} data-testid={`button-disconnect-${provider.id}`}>
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
        open={dialogProvider !== null}
        initial={dialogProvider ? state[dialogProvider.id].config : null}
        onClose={() => setDialogProvider(null)}
        onConnect={cfg => dialogProvider && handleConnect(dialogProvider.id, cfg)}
      />
    </div>
  );
}
