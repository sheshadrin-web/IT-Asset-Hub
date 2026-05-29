import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Shield, Copy, RefreshCw, KeyRound, Power, CheckCircle2, AlertCircle, Download,
  Lock, Unlock,
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
  is_locked:           boolean | null;
  locked_at:           string | null;
  lock_reason:         string | null;
}
interface AgentToken {
  id:               string;
  token_last_four:  string;
  is_active:        boolean;
  generated_at:     string;
  revoked_at:       string | null;
}
interface DeviceCommand {
  id:                string;
  command_type:      string;
  status:            "pending" | "running" | "completed" | "failed" | "cancelled" | "requires_admin";
  requested_at:      string | null;
  executed_at:       string | null;
  completed_at:      string | null;
  result_message:    string | null;
  error_message:     string | null;
  requested_by_name: string | null;
}

// Maps the raw command status to a human label + colour for the audit log/banner.
const STATUS_META: Record<DeviceCommand["status"], { label: string; cls: string }> = {
  pending:        { label: "Pending",                   cls: "text-slate-600 bg-slate-100" },
  running:        { label: "Executing",                 cls: "text-sky-700 bg-sky-100" },
  completed:      { label: "Success",                   cls: "text-emerald-700 bg-emerald-100" },
  failed:         { label: "Failed",                    cls: "text-red-700 bg-red-100" },
  requires_admin: { label: "Requires Admin Privileges", cls: "text-amber-800 bg-amber-100" },
  cancelled:      { label: "Superseded",                cls: "text-slate-500 bg-slate-100" },
};

const COMMAND_LABEL: Record<string, string> = {
  lock_screen:        "Lock device",
  unlock:             "Unlock device",
  update_wallpaper:   "Update wallpaper",
  sync_now:           "Sync now",
  collect_system_info:"Collect system info",
};

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
  const [commands, setCommands] = useState<DeviceCommand[]>([]);
  const [loading, setLoading] = useState(true);

  const [newToken, setNewToken] = useState<string | null>(null);
  const [showRevoke, setShowRevoke] = useState(false);
  const [showLock, setShowLock] = useState(false);
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

    // Audit log: recent lock/unlock/etc commands with the initiator's name.
    const h = await supabase.rpc("device_command_history", { p_asset_id: assetId, p_limit: 20 });
    setCommands(Array.isArray(h.data) ? (h.data as DeviceCommand[]) : []);
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

  async function lockDevice() {
    setBusy(true);
    const { data, error } = await supabase.rpc("lock_device", { p_asset_id: assetId, p_reason: null });
    setBusy(false);
    setShowLock(false);
    if (error || !data?.success) {
      toast({ title: "Failed to lock device", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Device lock requested", description: "The laptop will lock within a few minutes (next agent sync)." });
    await load();
  }

  async function unlockDevice() {
    setBusy(true);
    const { data, error } = await supabase.rpc("unlock_device", { p_asset_id: assetId });
    setBusy(false);
    if (error || !data?.success) {
      toast({ title: "Failed to unlock device", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Device unlock requested", description: "Access will be restored within a few minutes (next agent sync)." });
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
      // install-service runs under sudo so the agent is registered as a root
      // SYSTEM service — required for the real hard lock (lock the OS account +
      // terminate the session). MILES_AGENT_TOKEN is passed through to sudo.
      `sudo MILES_AGENT_TOKEN="${tok}" ~/.miles-agent/venv/bin/python ~/.miles-agent/laptop_agent.py install-service`,
    ].join(" && \\\n");
    return hostName ? `${install}\nsudo hostnamectl set-hostname "${hostName}"` : install;
  };

  // ── Windows (Command Prompt) — auto-installs Python + Startup-folder service ─
  // Python is often missing on a fresh Windows laptop (running `python` opens the
  // Microsoft Store stub, which fails venv creation). If `python -m venv` fails we
  // silently install the official Python (user scope, no admin) and retry, then
  // hand off auto-start to the agent's Startup-folder launcher (also no admin) —
  // a logon Scheduled Task needs elevation and fails with "Access is denied".
  const PY_URL = "https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe";
  const PY_FALLBACK_CMD = `"%LOCALAPPDATA%\\Programs\\Python\\Python312\\python.exe"`;
  const PY = `"%USERPROFILE%\\.miles-agent\\venv\\Scripts\\python.exe"`;
  const SCRIPT = `"%USERPROFILE%\\.miles-agent\\laptop_agent.py"`;
  const installCmdCmd = (tok: string) =>
    [
      `mkdir "%USERPROFILE%\\.miles-agent" 2>nul`,
      `curl -fsSL "${agentUrl}" -o ${SCRIPT}`,
      `python -m venv "%USERPROFILE%\\.miles-agent\\venv" 2>nul || (echo Installing Python ^(one-time, no admin needed^)... && curl -fsSL "${PY_URL}" -o "%TEMP%\\miles-python-setup.exe" && "%TEMP%\\miles-python-setup.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 && ${PY_FALLBACK_CMD} -m venv "%USERPROFILE%\\.miles-agent\\venv")`,
      `${PY} -m pip install -q --upgrade pip requests`,
      `setx MILES_AGENT_TOKEN "${tok}"`,
      `set MILES_AGENT_TOKEN=${tok}`,
      `${PY} ${SCRIPT} register`,
      `${PY} ${SCRIPT} sync`,
      `${PY} ${SCRIPT} install-service`,
      ...(hostName ? [`powershell -Command "Rename-Computer -NewName '${hostName}' -Force"`] : []),
    ].join("\n");

  // ── Windows (PowerShell) — auto-installs Python + Startup-folder service ─────
  const PYP_FALLBACK = `"$env:LOCALAPPDATA\\Programs\\Python\\Python312\\python.exe"`;
  const PYP = `"$env:USERPROFILE\\.miles-agent\\venv\\Scripts\\python.exe"`;
  const SCRIPTP = `"$env:USERPROFILE\\.miles-agent\\laptop_agent.py"`;
  const installCmdPs = (tok: string) =>
    [
      `New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.miles-agent" | Out-Null`,
      `curl.exe -fsSL "${agentUrl}" -o ${SCRIPTP}`,
      `python -m venv "$env:USERPROFILE\\.miles-agent\\venv" 2>$null`,
      `if ($LASTEXITCODE -ne 0) { Write-Host "Installing Python (one-time, no admin needed)..."; curl.exe -fsSL "${PY_URL}" -o "$env:TEMP\\miles-python-setup.exe"; Start-Process "$env:TEMP\\miles-python-setup.exe" -ArgumentList '/quiet','InstallAllUsers=0','PrependPath=1','Include_launcher=1' -Wait; & ${PYP_FALLBACK} -m venv "$env:USERPROFILE\\.miles-agent\\venv" }`,
      `& ${PYP} -m pip install -q --upgrade pip requests`,
      `setx MILES_AGENT_TOKEN "${tok}" | Out-Null`,
      `$env:MILES_AGENT_TOKEN="${tok}"`,
      `& ${PYP} ${SCRIPTP} register`,
      `& ${PYP} ${SCRIPTP} sync`,
      `& ${PYP} ${SCRIPTP} install-service`,
      ...(hostName ? [`Rename-Computer -NewName "${hostName}" -Force`] : []),
    ].join("\n");

  // Real HARD lock (OS-level account/workstation lock with honest status
  // reporting) only exists in agent v0.4.0+. Older agents either ignore the
  // command or only show a dismissable overlay, so the portal must not imply a
  // true lock. Detect the mismatch and warn IT to update the agent.
  const LOCK_MIN_VERSION = [0, 4, 0];
  const parseVer = (v: string | null | undefined): number[] =>
    (v ?? "").trim().split(".").map((n) => parseInt(n, 10) || 0);
  const lockEnforceable = (() => {
    if (!device?.agent_version) return false; // unknown version → assume too old
    const p = parseVer(device.agent_version);
    for (let i = 0; i < 3; i++) {
      const a = p[i] ?? 0;
      const b = LOCK_MIN_VERSION[i];
      if (a !== b) return a > b;
    }
    return true;
  })();
  const lockUnenforceable = !!device?.is_locked && !lockEnforceable;

  // The most recent lock/unlock command drives the live status banner: a lock
  // request can be Pending → Executing → Success/Failed/Requires Admin. The
  // device only shows as truly "Locked" once the agent confirms success
  // (is_locked, set server-side only on a confirmed lock).
  const latestLockCmd = commands.find(
    (c) => c.command_type === "lock_screen" || c.command_type === "unlock",
  );
  const lockPending =
    latestLockCmd?.command_type === "lock_screen" &&
    (latestLockCmd.status === "pending" || latestLockCmd.status === "running");
  const lockFailed =
    latestLockCmd?.command_type === "lock_screen" &&
    (latestLockCmd.status === "failed" || latestLockCmd.status === "requires_admin") &&
    !device?.is_locked;

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

            {device?.is_locked && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 flex items-center gap-2">
                <Lock className="h-4 w-4 text-red-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-red-800">Device locked (confirmed)</p>
                  <p className="text-[11px] text-red-700">
                    The agent confirmed the OS lock took effect — end-user access is blocked
                    {device.locked_at ? <> since {new Date(device.locked_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</> : null}.
                    {" "}Files are preserved. Unlock below to restore access.
                  </p>
                </div>
              </div>
            )}

            {!device?.is_locked && lockPending && (
              <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-sky-600 shrink-0 animate-spin" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-sky-800">
                    Lock {latestLockCmd?.status === "running" ? "executing" : "pending"}…
                  </p>
                  <p className="text-[11px] text-sky-700">
                    Lock requested — waiting for the device agent to apply it and confirm. The device is
                    <b> not yet locked</b>. This page updates once the agent reports back (next sync).
                  </p>
                </div>
              </div>
            )}

            {lockFailed && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-amber-900">
                    Lock {latestLockCmd?.status === "requires_admin" ? "needs admin privileges" : "failed"} — device NOT locked
                  </p>
                  <p className="text-[11px] text-amber-800">
                    {latestLockCmd?.error_message
                      ? latestLockCmd.error_message
                      : "The agent could not apply the lock."}
                    {" "}You can retry the lock below once the issue is resolved.
                  </p>
                </div>
              </div>
            )}

            {lockUnenforceable && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-amber-900">Lock not enforced — agent too old</p>
                  <p className="text-[11px] text-amber-800">
                    This device runs agent <span className="font-mono">v{device?.agent_version ?? "?"}</span>, which
                    does not support the real hard lock (needs <span className="font-mono">v0.4.0</span>+). The lock is
                    recorded here but the laptop may stay usable. Reinstall the agent on the device to enforce it.
                  </p>
                </div>
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
                {device && (
                  device.is_locked ? (
                    <Button size="sm" variant="outline" className="gap-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50" onClick={unlockDevice} disabled={busy} data-testid="button-unlock-device">
                      <Unlock className="h-4 w-4" /> Unlock Device
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="gap-2 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => setShowLock(true)} disabled={busy} data-testid="button-lock-device">
                      <Lock className="h-4 w-4" /> Lock Device
                    </Button>
                  )
                )}
                <Button size="sm" variant="ghost" className="gap-2" onClick={() => void load()}>
                  <RefreshCw className="h-4 w-4" /> Refresh
                </Button>
              </div>
            )}

            {isSuperAdmin && device && commands.length > 0 && (
              <details className="rounded-md border bg-muted/20 mt-1">
                <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-muted-foreground">
                  Command audit log ({commands.length})
                </summary>
                <div className="px-3 pb-3 space-y-2">
                  {commands.map((c) => {
                    const meta = STATUS_META[c.status] ?? STATUS_META.pending;
                    const when = c.completed_at ?? c.executed_at ?? c.requested_at;
                    return (
                      <div key={c.id} className="rounded border bg-background px-2.5 py-2 text-[11px]">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{COMMAND_LABEL[c.command_type] ?? c.command_type}</span>
                          <span className={cn("rounded px-1.5 py-0.5 font-medium", meta.cls)}>{meta.label}</span>
                          <span className="ml-auto text-muted-foreground">
                            {when ? new Date(when).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}
                          </span>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          Requested by <span className="font-medium text-foreground">{c.requested_by_name ?? "System"}</span>
                        </p>
                        {c.error_message && (
                          <p className="mt-0.5 text-red-700 break-words">Reason: {c.error_message}</p>
                        )}
                        {!c.error_message && c.result_message && (
                          <p className="mt-0.5 text-emerald-700 break-words">{c.result_message}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
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
                Registers, runs a test sync, then installs a <b>root systemd system service</b> (via
                <span className="font-mono"> sudo</span>) so the agent runs with the privileges needed to enforce a
                real <b>hard lock</b> and syncs every 5 minutes — you'll be asked for your password once. To remove:
                <span className="font-mono"> sudo ~/.miles-agent/venv/bin/python ~/.miles-agent/laptop_agent.py uninstall-service</span>
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
                If Python is missing it is installed automatically (one-time, no admin). Then it registers, runs a
                test <span className="font-mono">sync</span>, and adds a <b>Startup-folder</b> launcher so the agent
                auto-starts at logon — <b>no administrator rights needed</b>. Refresh this page after ~10 seconds to
                see the device. To remove later:
                <span className="font-mono"> {`%USERPROFILE%\\.miles-agent\\venv\\Scripts\\python.exe %USERPROFILE%\\.miles-agent\\laptop_agent.py uninstall-service`}</span>.
                {hostName ? <> The optional rename to the asset tag (<span className="font-mono">{hostName}</span>) is
                the only step that needs the terminal run <b>as Administrator</b> plus a <b>reboot</b>.</> : null}
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

      {/* Lock confirmation */}
      <Dialog open={showLock} onOpenChange={setShowLock}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Lock this device?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This sends a <b>hard lock</b> to the device: the OS account/workstation is locked and the active
            session is ended, so the end user can't use it. Their files are <b>not</b> deleted. The portal
            only shows <b>Locked</b> once the agent confirms it actually took effect — until then you'll see
            a Pending/Executing status, or the exact reason if it failed. You can unlock anytime from this page.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLock(false)}>Cancel</Button>
            <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={lockDevice} disabled={busy}>Lock Device</Button>
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
