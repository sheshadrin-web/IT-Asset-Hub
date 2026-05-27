import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Shield, Copy, RefreshCw, KeyRound, Power, CheckCircle2, AlertCircle,
} from "lucide-react";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

interface ManagedDevice {
  id:                  string;
  status:              "online" | "offline" | "inactive";
  hostname:            string | null;
  serial_number:       string | null;
  processor:           string | null;
  ram:                 string | null;
  storage:             string | null;
  os_name:             string | null;
  os_version:          string | null;
  logged_in_username:  string | null;
  ip_address:          string | null;
  mac_address:         string | null;
  agent_version:       string | null;
  last_seen_at:        string | null;
}
interface AgentToken {
  id:               string;
  token_last_four:  string;
  is_active:        boolean;
  generated_at:     string;
  revoked_at:       string | null;
}

interface Props { assetId: string; }

export default function DeviceAgentCard({ assetId }: Props) {
  const { role } = useAuth();
  const isSuperAdmin = role === "super_admin";
  const { toast } = useToast();

  const [device, setDevice] = useState<ManagedDevice | null>(null);
  const [token,  setToken]  = useState<AgentToken | null>(null);
  const [loading, setLoading] = useState(true);

  const [newToken, setNewToken] = useState<string | null>(null);
  const [showRevoke, setShowRevoke] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    const [d, t] = await Promise.all([
      supabase.from("managed_devices").select("*").eq("laptop_asset_id", assetId).maybeSingle(),
      supabase.from("agent_tokens").select("id, token_last_four, is_active, generated_at, revoked_at")
        .eq("laptop_asset_id", assetId).eq("is_active", true)
        .order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setDevice((d.data as ManagedDevice | null) ?? null);
    setToken((t.data as AgentToken | null) ?? null);
    setLoading(false);
  }, [assetId]);

  useEffect(() => { void load(); }, [load]);

  async function generate() {
    setBusy(true);
    const { data, error } = await supabase.rpc("generate_agent_token", { p_asset_id: assetId });
    setBusy(false);
    if (error || !data?.success) {
      toast({ title: "Failed to generate key", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    setNewToken(data.token as string);
    await load();
  }

  async function revoke() {
    setBusy(true);
    const { data, error } = await supabase.rpc("revoke_agent_token", { p_asset_id: assetId });
    setBusy(false);
    setShowRevoke(false);
    if (error || !data?.success) {
      toast({ title: "Failed to revoke", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Agent key revoked" });
    await load();
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Copy failed — please copy manually", variant: "destructive" });
    }
  }

  const lastSeen = device?.last_seen_at
    ? new Date(device.last_seen_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "—";

  const statusDot = device?.status === "online"
    ? "bg-emerald-500"
    : device?.status === "offline"
    ? "bg-amber-500"
    : "bg-gray-400";
  const statusLabel = device?.status ? device.status.charAt(0).toUpperCase() + device.status.slice(1) : "Not Installed";

  // Install command shown after generating. The agent reads MILES_AGENT_TOKEN env var.
  const installCmd = (tok: string) =>
    `set MILES_AGENT_TOKEN=${tok}\npip install requests\npython laptop_agent.py register`;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          Device Agent
          <span className="ml-auto flex items-center gap-1.5 text-xs font-normal">
            <span className={cn("inline-block h-2 w-2 rounded-full", statusDot)} />
            <span className="text-muted-foreground">{statusLabel}</span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            <Row label="Managed by Agent" value={device ? "Yes" : "No"} />
            <Row label="Last Seen"       value={lastSeen} />
            {device && (
              <>
                <Row label="Hostname"      value={device.hostname ?? "—"} />
                <Row label="Serial Number" value={device.serial_number ?? "—"} />
                <Row label="OS"            value={[device.os_name, device.os_version].filter(Boolean).join(" ") || "—"} />
                <Row label="Processor"     value={device.processor ?? "—"} />
                <Row label="RAM"           value={device.ram ?? "—"} />
                <Row label="Storage"       value={device.storage ?? "—"} />
                <Row label="Signed-in User" value={device.logged_in_username ?? "—"} />
                <Row label="IP Address"    value={device.ip_address ?? "—"} />
                <Row label="MAC Address"   value={device.mac_address ?? "—"} />
                <Row label="Agent Version" value={device.agent_version ?? "—"} />
              </>
            )}

            {token ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-emerald-800">Agent key active</p>
                  <p className="text-[11px] text-emerald-700">
                    Ends in <span className="font-mono">…{token.token_last_four}</span> · Issued {new Date(token.generated_at).toLocaleDateString("en-IN")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-gray-500 shrink-0" />
                <p className="text-xs text-gray-700">No active agent key</p>
              </div>
            )}

            {isSuperAdmin && (
              <div className="flex flex-wrap gap-2 pt-1">
                {!token && (
                  <Button size="sm" variant="outline" className="gap-2" onClick={generate} disabled={busy} data-testid="button-generate-agent-key">
                    <KeyRound className="h-4 w-4" /> Generate Agent Key
                  </Button>
                )}
                {token && (
                  <>
                    <Button size="sm" variant="outline" className="gap-2" onClick={generate} disabled={busy} data-testid="button-regenerate-agent-key">
                      <RefreshCw className="h-4 w-4" /> Regenerate
                    </Button>
                    <Button size="sm" variant="outline" className="gap-2 text-red-600 border-red-300 hover:bg-red-50" onClick={() => setShowRevoke(true)} disabled={busy} data-testid="button-revoke-agent-key">
                      <Power className="h-4 w-4" /> Revoke
                    </Button>
                  </>
                )}
                <Button size="sm" variant="ghost" className="gap-2" onClick={() => void load()}>
                  <RefreshCw className="h-4 w-4" /> Refresh
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      {/* One-time token reveal dialog */}
      <Dialog open={!!newToken} onOpenChange={(v) => !v && setNewToken(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-emerald-600" />
              Agent Key Generated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>Copy this now.</strong> For security, the full key is shown only once.
              After closing this dialog only the last 4 characters will remain visible.
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground">Agent Key</label>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => newToken && copy(newToken, "Agent key")}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
              <textarea
                readOnly
                value={newToken ?? ""}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-none rounded border bg-muted/40 px-3 py-2 text-xs font-mono break-all focus:outline-none focus:ring-1 focus:ring-primary"
                rows={2}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground">Install Command (Windows)</label>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => newToken && copy(installCmd(newToken), "Install command")}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
              <textarea
                readOnly
                value={newToken ? installCmd(newToken) : ""}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-none rounded border bg-muted/40 px-3 py-2 text-xs font-mono break-all focus:outline-none focus:ring-1 focus:ring-primary"
                rows={3}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Run this in an elevated PowerShell on the laptop. See the agent README for the full install steps.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewToken(null)}>I have copied the key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <Dialog open={showRevoke} onOpenChange={setShowRevoke}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Revoke agent key?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            The laptop will stop syncing immediately. You can generate a new key and re-install the agent later.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRevoke(false)}>Cancel</Button>
            <Button variant="destructive" onClick={revoke} disabled={busy}>Revoke Key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}
