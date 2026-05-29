import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Shield, Copy, RefreshCw, KeyRound, Power, CheckCircle2, AlertCircle, Download,
} from "lucide-react";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import WallpaperManager from "./WallpaperManager";

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

interface Props { assetId: string; assetTag?: string | null; }

// Placeholder shown in the always-available reference commands. The real,
// ready-to-paste command (with the key embedded) is only shown once in the
// one-time key dialog, since the plaintext key is never stored after generation.
const REF_TOKEN = "YOUR-AGENT-KEY";

export default function DeviceAgentCard({ assetId, assetTag }: Props) {
  const { role, session, loading: authLoading } = useAuth();
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
    // Reads are RLS-protected (authenticated role). Wait for the Supabase
    // session to attach before querying, otherwise the request goes out as
    // `anon`, RLS returns nothing, and the card wrongly shows "Not Installed".
    if (authLoading || !session) { return; }
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
  }, [assetId, session, authLoading]);

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

  // Install commands shown after generating. They download the Python agent from
  // this portal, create an isolated venv (avoids macOS/Ubuntu PEP-668 "externally
  // managed environment" errors), install `requests`, register + test-sync, then
  // install a background service. Each step is chained so it stops cleanly on the
  // first failure rather than cascading errors. The agent reads MILES_AGENT_TOKEN.
  const agentUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${import.meta.env.BASE_URL}agent/laptop_agent.py`
      : "/agent/laptop_agent.py";

  // Asset tag (e.g. MILES-LAP-579) baked into the install command so the machine's
  // system hostname is renamed to it. Hostnames allow letters/digits/hyphens, so
  // normalise anything else to a hyphen, drop edge hyphens, and cap at the 63-char
  // hostname limit (scutil/hostnamectl reject longer names).
  const hostName = (assetTag ?? "").trim()
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");

  // ── macOS (Terminal) — launchd background service ──────────────────────────
  // The rename is appended as its own line (not part of the && chain) so a failed
  // sudo / cancelled password prompt never masks a successful agent install.
  const installCmdMac = (tok: string) => {
    const install = [
      `mkdir -p ~/.miles-agent`,
      `curl -fsSL "${agentUrl}" -o ~/.miles-agent/laptop_agent.py`,
      `python3 -m venv ~/.miles-agent/venv`,
      `~/.miles-agent/venv/bin/python -m pip install -q --upgrade pip requests`,
      `export MILES_AGENT_TOKEN="${tok}"`,
      `~/.miles-agent/venv/bin/python ~/.miles-agent/laptop_agent.py register`,
      `~/.miles-agent/venv/bin/python ~/.miles-agent/laptop_agent.py sync`,
      `~/.miles-agent/venv/bin/python ~/.miles-agent/laptop_agent.py install-service`,
    ].join(" && \\\n");
    if (!hostName) return install;
    const rename = [
      `sudo scutil --set ComputerName "${hostName}"`,
      `sudo scutil --set LocalHostName "${hostName}"`,
      `sudo scutil --set HostName "${hostName}"`,
      `sudo dscacheutil -flushcache`,
    ].join(" && \\\n");
    return `${install}\n${rename}`;
  };

  // ── Ubuntu / Linux (Terminal) — systemd --user service ─────────────────────
  // Clean Ubuntu has no `curl`, so the download is done with python3 itself
  // (always present — it's required to run the agent). The venv step self-heals
  // if the `python3-venv` package is missing (PEP-668 / Debian split package).
  const installCmdLinux = (tok: string) => {
    const install = [
      `mkdir -p ~/.miles-agent`,
      `python3 -c "import urllib.request,os; urllib.request.urlretrieve('${agentUrl}', os.path.expanduser('~/.miles-agent/laptop_agent.py'))"`,
      `(python3 -m venv ~/.miles-agent/venv || { sudo apt-get update && sudo apt-get install -y python3-venv && python3 -m venv ~/.miles-agent/venv; })`,
      `~/.miles-agent/venv/bin/python -m pip install -q --upgrade pip requests`,
      `export MILES_AGENT_TOKEN="${tok}"`,
      `~/.miles-agent/venv/bin/python ~/.miles-agent/laptop_agent.py register`,
      `~/.miles-agent/venv/bin/python ~/.miles-agent/laptop_agent.py sync`,
      `~/.miles-agent/venv/bin/python ~/.miles-agent/laptop_agent.py install-service`,
    ].join(" && \\\n");
    return hostName ? `${install}\nsudo hostnamectl set-hostname "${hostName}"` : install;
  };

  // ── Windows (Command Prompt) — logon Scheduled Task ────────────────────────
  const PY = `"%USERPROFILE%\\.miles-agent\\venv\\Scripts\\python.exe"`;
  const SCRIPT = `"%USERPROFILE%\\.miles-agent\\laptop_agent.py"`;
  const installCmdCmd = (tok: string) =>
    [
      `mkdir "%USERPROFILE%\\.miles-agent" 2>nul`,
      `curl -fsSL "${agentUrl}" -o ${SCRIPT}`,
      `python -m venv "%USERPROFILE%\\.miles-agent\\venv"`,
      `${PY} -m pip install -q --upgrade pip requests`,
      `setx MILES_AGENT_TOKEN "${tok}"`,
      `set MILES_AGENT_TOKEN=${tok}`,
      `${PY} ${SCRIPT} register`,
      `${PY} ${SCRIPT} sync`,
      `schtasks /Create /SC ONLOGON /TN MilesAgent /TR "\\"%USERPROFILE%\\.miles-agent\\venv\\Scripts\\pythonw.exe\\" \\"%USERPROFILE%\\.miles-agent\\laptop_agent.py\\" run" /F`,
      ...(hostName ? [`powershell -Command "Rename-Computer -NewName '${hostName}' -Force"`] : []),
    ].join("\n");

  // ── Windows (PowerShell) — logon Scheduled Task ────────────────────────────
  // Uses the native ScheduledTasks cmdlets (New-ScheduledTaskAction / Register-
  // ScheduledTask) which take the executable and arguments separately, avoiding
  // the fragile backslash-quote escaping that schtasks /TR requires.
  const PYP = `"$env:USERPROFILE\\.miles-agent\\venv\\Scripts\\python.exe"`;
  const SCRIPTP = `"$env:USERPROFILE\\.miles-agent\\laptop_agent.py"`;
  const installCmdPs = (tok: string) =>
    [
      `New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.miles-agent" | Out-Null`,
      `curl.exe -fsSL "${agentUrl}" -o ${SCRIPTP}`,
      `python -m venv "$env:USERPROFILE\\.miles-agent\\venv"`,
      `& ${PYP} -m pip install -q --upgrade pip requests`,
      `setx MILES_AGENT_TOKEN "${tok}" | Out-Null`,
      `$env:MILES_AGENT_TOKEN="${tok}"`,
      `& ${PYP} ${SCRIPTP} register`,
      `& ${PYP} ${SCRIPTP} sync`,
      `$act = New-ScheduledTaskAction -Execute "$env:USERPROFILE\\.miles-agent\\venv\\Scripts\\pythonw.exe" -Argument "\`"$env:USERPROFILE\\.miles-agent\\laptop_agent.py\`" run"`,
      `Register-ScheduledTask -TaskName MilesAgent -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Action $act -Force | Out-Null`,
      ...(hostName ? [`Rename-Computer -NewName "${hostName}" -Force`] : []),
    ].join("\n");

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
                <Row label="Hostname"      value={assetTag ?? device.hostname ?? "—"} />
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

            <WallpaperManager
              assetId={assetId}
              managedDeviceId={device?.id ?? null}
              agentInstalled={!!device}
            />

            <div className="border-t pt-3 mt-2">
              <p className="text-[11px] font-medium text-muted-foreground mb-2">Agent Setup</p>
              <p className="text-[11px] text-muted-foreground mb-2">
                Click <b>Generate Agent Key</b> above, then copy the one-line install command for the
                target OS. It downloads the agent and starts it automatically — no manual download needed.
                The ready-to-paste command (with your key embedded) is shown once in the key dialog; the
                reference commands and files below are always available.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Button asChild size="sm" variant="outline" className="gap-2">
                  <a href={`${import.meta.env.BASE_URL}agent/laptop_agent.py`} download="laptop_agent.py">
                    <Download className="h-4 w-4" /> Python script
                  </a>
                </Button>
                <Button asChild size="sm" variant="ghost" className="gap-2">
                  <a href={`${import.meta.env.BASE_URL}agent/miles-device-agent-guide.pdf`} target="_blank" rel="noopener">
                    <Download className="h-4 w-4" /> Setup guide (PDF)
                  </a>
                </Button>
              </div>

              <details className="mt-3 rounded-md border bg-muted/20">
                <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-muted-foreground">
                  One-line install commands (reference)
                </summary>
                <div className="space-y-3 px-3 pb-3">
                  <p className="text-[11px] text-muted-foreground">
                    Replace <span className="font-mono">{REF_TOKEN}</span> with the key from{" "}
                    <b>Generate</b>/<b>Regenerate</b> above. The command with your key already embedded is
                    shown once in the key dialog.
                  </p>
                  <CmdBlock
                    label="macOS (Terminal)"
                    value={installCmdMac(REF_TOKEN)}
                    rows={8}
                    testid="button-copy-install-mac-ref"
                    onCopy={() => copy(installCmdMac(REF_TOKEN), "macOS install command")}
                  />
                  <CmdBlock
                    label="Ubuntu / Linux (Terminal)"
                    value={installCmdLinux(REF_TOKEN)}
                    rows={7}
                    testid="button-copy-install-linux-ref"
                    onCopy={() => copy(installCmdLinux(REF_TOKEN), "Linux install command")}
                  />
                  <CmdBlock
                    label="Windows (Command Prompt)"
                    value={installCmdCmd(REF_TOKEN)}
                    rows={5}
                    testid="button-copy-install-cmd-ref"
                    onCopy={() => copy(installCmdCmd(REF_TOKEN), "CMD install command")}
                  />
                  <CmdBlock
                    label="Windows (PowerShell)"
                    value={installCmdPs(REF_TOKEN)}
                    rows={5}
                    testid="button-copy-install-ps-ref"
                    onCopy={() => copy(installCmdPs(REF_TOKEN), "PowerShell install command")}
                  />
                </div>
              </details>
            </div>
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

            <div className="rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 text-[11px] text-sky-900">
              <p className="font-semibold mb-1">Before you paste:</p>
              <ol className="list-decimal ml-4 space-y-0.5">
                <li>Open the terminal for your OS — <b>macOS:</b> Terminal (Applications → Utilities) · <b>Linux:</b> any terminal · <b>Windows:</b> Command Prompt or PowerShell.</li>
                <li>Requires <b>Python 3</b> (pre-installed on most Macs; on Ubuntu run <span className="font-mono">sudo apt install -y python3-venv</span> first if prompted).</li>
                <li>Copy the command for your OS, paste the <b>whole block</b>, and press Enter. It downloads the agent, sets it up, registers, and starts the background service automatically — no manual download needed.</li>
              </ol>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Install Command — macOS (Terminal)
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => newToken && copy(installCmdMac(newToken), "macOS install command")}
                  data-testid="button-copy-install-mac"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
              <textarea
                readOnly
                value={newToken ? installCmdMac(newToken) : ""}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-none rounded border bg-muted/40 px-3 py-2 text-xs font-mono break-all focus:outline-none focus:ring-1 focus:ring-primary"
                rows={8}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Registers, runs a test sync, then installs a <b>launchd</b> background service so the agent
                auto-starts on login and syncs every 5 minutes. It also renames the Mac's computer/host name to
                the asset tag{hostName ? <> (<span className="font-mono">{hostName}</span>)</> : null} — macOS will
                ask for your Mac password once for this step. To remove later:
                <span className="font-mono"> ~/.miles-agent/venv/bin/python ~/.miles-agent/laptop_agent.py uninstall-service</span>
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Install Command — Ubuntu / Linux (Terminal)
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => newToken && copy(installCmdLinux(newToken), "Linux install command")}
                  data-testid="button-copy-install-linux"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
              <textarea
                readOnly
                value={newToken ? installCmdLinux(newToken) : ""}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-none rounded border bg-muted/40 px-3 py-2 text-xs font-mono break-all focus:outline-none focus:ring-1 focus:ring-primary"
                rows={7}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Registers, runs a test sync, then installs a <b>systemd --user</b> service so the agent
                auto-starts on login and syncs every 5 minutes. For headless servers, run once:
                <span className="font-mono"> sudo loginctl enable-linger $USER</span>. To remove:
                <span className="font-mono"> ~/.miles-agent/venv/bin/python ~/.miles-agent/laptop_agent.py uninstall-service</span>
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Install Command — Command Prompt (cmd.exe)
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => newToken && copy(installCmdCmd(newToken), "CMD install command")}
                  data-testid="button-copy-install-cmd"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
              <textarea
                readOnly
                value={newToken ? installCmdCmd(newToken) : ""}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-none rounded border bg-muted/40 px-3 py-2 text-xs font-mono break-all focus:outline-none focus:ring-1 focus:ring-primary"
                rows={5}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Install Command — PowerShell
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => newToken && copy(installCmdPs(newToken), "PowerShell install command")}
                  data-testid="button-copy-install-ps"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
              <textarea
                readOnly
                value={newToken ? installCmdPs(newToken) : ""}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-none rounded border bg-muted/40 px-3 py-2 text-xs font-mono break-all focus:outline-none focus:ring-1 focus:ring-primary"
                rows={5}
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Sets the token, registers, runs a test <span className="font-mono">sync</span>, then creates a
                logon <b>Scheduled Task</b> (<span className="font-mono">MilesAgent</span>) so it keeps syncing.
                Refresh this page after ~10 seconds to see the device.
                {hostName ? <> It also renames the PC to the asset tag (<span className="font-mono">{hostName}</span>) —
                run the terminal <b>as Administrator</b> and <b>reboot</b> for the new name to take full effect.</> : null}
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

function CmdBlock({
  label, value, onCopy, rows, testid,
}: {
  label: string; value: string; onCopy: () => void; rows: number; testid: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onCopy} data-testid={testid}>
          <Copy className="h-3.5 w-3.5" /> Copy
        </Button>
      </div>
      <textarea
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full resize-none rounded border bg-muted/40 px-3 py-2 text-xs font-mono break-all focus:outline-none focus:ring-1 focus:ring-primary"
        rows={rows}
      />
    </div>
  );
}
