import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Shield, Copy, RefreshCw, KeyRound, Power, CheckCircle2, AlertCircle, Download,
  Lock, Unlock, Trash2, Ban, ShieldOff, Zap,
  FileText, X,
} from "lucide-react";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import WallpaperManager from "./WallpaperManager";

interface ManagedDevice {
  id:                  string;
  status:              "online" | "offline" | "inactive";
  is_managed:          boolean | null;
  agent_removed_at:    string | null;
  agent_removed_reason: string | null;
  agent_remove_requested_at: string | null;
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
  uptime_seconds:      number | null;
  last_boot_at:        string | null;
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
  command_payload:   { reason?: string | null; asset_tag?: string | null } | null;
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
  notify_restart:     "Notify user to restart",
  schedule_restart:   "Schedule restart",
  force_restart:      "Force restart",
  uninstall_agent:    "Remove agent (uninstall)",
  force_remove_agent: "Force remove from portal",
};

// Human-readable uptime, e.g. "3d 4h" or "5h 12m" or "8m".
function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// A device that has not rebooted in over a day should be restarted to apply
// updates and clear memory leaks.
const RESTART_REQUIRED_SECONDS = 86400;

interface Props { assetId: string; assetTag?: string | null; }

// Placeholder shown in the always-available reference commands. The real,
// ready-to-paste command (with the key embedded) is only shown once in the
// one-time key dialog, since the plaintext key is never stored after generation.
const REF_TOKEN = "YOUR-AGENT-KEY";

export default function DeviceAgentCard({ assetId, assetTag }: Props) {
  const { role, session, loading: authLoading } = useAuth();
  const isSuperAdmin = role === "super_admin";
  const isAdmin      = isSuperAdmin || role === "it_admin";
  const { toast } = useToast();

  const [device, setDevice] = useState<ManagedDevice | null>(null);
  const [token,  setToken]  = useState<AgentToken | null>(null);
  const [commands, setCommands] = useState<DeviceCommand[]>([]);
  const [loading, setLoading] = useState(true);

  const [newToken, setNewToken] = useState<string | null>(null);
  const [showRevoke, setShowRevoke] = useState(false);
  const [showLock, setShowLock] = useState(false);
  const [showForceRestart, setShowForceRestart] = useState(false);
  const [showRemoveAgent,  setShowRemoveAgent]  = useState(false);
  const [showForceRemove,  setShowForceRemove]  = useState(false);
  const [removeReason, setRemoveReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Locally-remembered "cleared" agent error. We store the dismissed command's
  // id (per asset) in localStorage so the banner stays hidden across refreshes,
  // without ever touching the DB — the command stays in the audit log untouched.
  // A *different* (newer) error has a different id, so it surfaces again.
  const errorDismissKey = `agentErrorDismissed:${assetId}`;
  const [dismissedErrorId, setDismissedErrorId] = useState<string | null>(() => {
    try { return localStorage.getItem(`agentErrorDismissed:${assetId}`); }
    catch { return null; }
  });
  // Reload the dismissed-error id when the card is reused for a different asset
  // (assetId can change without a remount), so one device's dismissal never
  // leaks into another's view.
  useEffect(() => {
    try { setDismissedErrorId(localStorage.getItem(errorDismissKey)); }
    catch { setDismissedErrorId(null); }
  }, [errorDismissKey]);

  // Controlled audit-log disclosure so "View Logs" can open + scroll to it.
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const auditLogRef = useRef<HTMLDetailsElement>(null);

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

  async function clearLockPending() {
    setBusy(true);
    const { data, error } = await supabase.rpc("clear_device_lock_pending", { p_asset_id: assetId });
    setBusy(false);
    if (error || !data?.success) {
      toast({
        title: "Could not clear pending lock",
        description: error?.message ?? data?.error ?? "The command may already be executing.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: "Pending lock cleared",
      description: "The unstarted lock request was cancelled. The device remains unlocked.",
    });
    await load();
  }

  // Restart actions. None of these restart silently: notify only messages the
  // user; schedule/force always warn the user first and wait a 10-minute grace
  // period (enforced agent-side) so work can be saved.
  async function requestRestart(type: "notify_restart" | "schedule_restart" | "force_restart") {
    setBusy(true);
    const reason = "IT has requested this device be restarted.";
    const { data, error } = await supabase.rpc("request_device_command", {
      p_asset_id: assetId,
      p_command_type: type,
      p_payload: { reason },
    });
    setBusy(false);
    setShowForceRestart(false);
    if (error || !data?.success) {
      toast({ title: "Restart request failed", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    const labels: Record<typeof type, { title: string; description: string }> = {
      notify_restart: {
        title: "Restart reminder sent",
        description: "The user will see a message asking them to restart when convenient.",
      },
      schedule_restart: {
        title: "Restart scheduled",
        description: "The user is warned now and the device restarts after a 10-minute grace period.",
      },
      force_restart: {
        title: "Forced restart requested",
        description: "The user is warned now; apps are closed and the device restarts after a 10-minute grace period.",
      },
    };
    toast(labels[type]);
    await load();
  }

  // Graceful remove: queue an uninstall the laptop performs, then confirms.
  // Keeps the token active until the agent reports back. Asset, assignment and
  // history are always preserved — this only ends the management connection.
  async function removeAgent() {
    setBusy(true);
    const { data, error } = await supabase.rpc("remove_agent", {
      p_asset_id: assetId,
      p_reason: removeReason.trim() || null,
    });
    setBusy(false);
    setShowRemoveAgent(false);
    if (error || !data?.success) {
      toast({ title: "Failed to remove agent", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    setRemoveReason("");
    toast({
      title: "Agent removal requested",
      description: "The laptop will uninstall the agent on its next sync. The device shows as removed only once it confirms.",
    });
    await load();
  }

  // Force remove (laptop not responding): immediate, server-side. Revokes the
  // token, ends management, clears the queue. Keeps logs/asset/user/history.
  async function forceRemoveAgent() {
    setBusy(true);
    const { data, error } = await supabase.rpc("force_remove_agent", {
      p_asset_id: assetId,
      p_reason: removeReason.trim() || null,
    });
    setBusy(false);
    setShowForceRemove(false);
    if (error || !data?.success) {
      toast({ title: "Failed to force remove", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    setRemoveReason("");
    toast({
      title: "Agent force-removed from portal",
      description: "The token is revoked and management has ended. Asset, assignment and history are preserved. Clean the laptop with the uninstall command.",
    });
    await load();
  }

  async function clearRemoval() {
    setBusy(true);
    const { data, error } = await supabase.rpc("clear_agent_removal", { p_asset_id: assetId });
    setBusy(false);
    if (error || !data?.success) {
      toast({ title: "Failed to clear notice", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    toast({
      title: "Removal notice cleared",
      description: "The device is now ready to re-enrol. Generate a key and re-install to bring it back under management.",
    });
    await load();
  }

  // Build a plain-text uninstall cheat-sheet (all OSes) for IT to run on the
  // laptop directly — used by the "Download Uninstall Command" button.
  function downloadUninstall() {
    const text = [
      "Miles Device Agent — manual uninstall",
      "Removing the agent only ends management. It does NOT delete user files or data.",
      "",
      "── macOS / Linux (Terminal) ──",
      "sudo ~/.miles-agent/venv/bin/python ~/.miles-agent/laptop_agent.py uninstall-service",
      "rm -rf ~/.miles-agent",
      "",
      "── Windows — normal removal (Command Prompt / PowerShell) ──",
      `%USERPROFILE%\\.miles-agent\\venv\\Scripts\\python.exe %USERPROFILE%\\.miles-agent\\laptop_agent.py unregister`,
      "",
      "The 'unregister' command stops the background service, deletes the agent files,",
      "and removes the saved key in one step.",
      "",
      "── Windows — force cleanup (use if a console/cmd window keeps appearing) ──",
      "Open PowerShell and paste all four lines. This kills any running agent and",
      "removes its auto-start and files so no window can come back:",
      "",
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'MilesAgent\\\\|laptop_agent\\.py|\\.miles-agent' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      "Remove-Item \"$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\MilesAgent.vbs\" -Force -ErrorAction SilentlyContinue",
      "Remove-Item \"$env:LOCALAPPDATA\\MilesAgent\" -Recurse -Force -ErrorAction SilentlyContinue",
      "Remove-Item \"$env:USERPROFILE\\.miles-agent\" -Recurse -Force -ErrorAction SilentlyContinue",
      assetTag ? `\nDevice: ${assetTag}` : "",
    ].join("\n");
    try {
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `miles-agent-uninstall${assetTag ? `-${assetTag}` : ""}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Uninstall command downloaded" });
    } catch {
      toast({ title: "Download failed — copy the commands manually", variant: "destructive" });
    }
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
  // Agent removed = the management connection has been ended (graceful confirm
  // or force remove). The asset/assignment/history stay; only management stops.
  const agentRemoved = !!device?.agent_removed_at;
  // Removal queued but the laptop has not yet confirmed the uninstall.
  const removalPending = !agentRemoved && !!device?.agent_remove_requested_at;

  const statusDot = agentRemoved
    ? "bg-gray-400"
    : device?.status === "online"
    ? "bg-emerald-500"
    : device?.status === "offline"
    ? "bg-amber-500"
    : "bg-gray-400";
  const statusLabel = agentRemoved
    ? "Agent Removed"
    : removalPending
    ? "Removal Pending"
    : device?.status ? device.status.charAt(0).toUpperCase() + device.status.slice(1) : "Not Installed";

  // Agent source is public and intentionally hosted outside the authenticated
  // portal. Keep this URL aligned with DEFAULT_AGENT_URL in laptop_agent.py.
  const agentUrl = "https://it.assets.mileseducation.org/agent/laptop_agent.py";

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
      // install-service runs under sudo so the agent is registered as a root
      // system LaunchDaemon — required for the real login-window hard lock
      // (disable the account + show the IT banner). MILES_AGENT_TOKEN and the
      // SUDO_USER are passed through so the daemon authenticates and can target
      // the human console user. Without sudo the lock reports "requires_admin".
      `sudo MILES_AGENT_TOKEN="${tok}" ~/.miles-agent/venv/bin/python ~/.miles-agent/laptop_agent.py install-service`,
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
  // (always present — it's required to run the agent). The explicit User-Agent
  // is required because the production edge rejects urllib's default
  // `Python-urllib/...` User-Agent with HTTP 403. The venv step self-heals if
  // the `python3-venv` package is missing (PEP-668 / Debian split package).
  const installCmdLinux = (tok: string) => {
    const install = [
      `mkdir -p ~/.miles-agent`,
      `python3 -c "import urllib.request,os; r=urllib.request.Request('${agentUrl}', headers={'User-Agent':'miles-agent-bootstrap/Linux'}); d=os.path.expanduser('~/.miles-agent/laptop_agent.py'); open(d,'wb').write(urllib.request.urlopen(r, timeout=30).read())"`,
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

  // ── Windows installer (bootstrap) ──────────────────────────────────────────
  // Both the Command Prompt and PowerShell commands run the same robust
  // installer script (public/agent/install.ps1). It validates every step,
  // auto-ELEVATES (UAC) so the agent installs as a SYSTEM task that can enforce
  // device lock, auto-installs Python if missing, registers + syncs + installs
  // the background service, renames the PC (skipping if the name already matches),
  // and writes a full log to %ProgramData%\MilesAgent\install.log — instead
  // of a brittle one-liner where one failed step cascades into confusing
  // "path not found" errors. Config is passed via env vars the script reads.
  const installPsUrl = "https://it.assets.mileseducation.org/agent/install.ps1";

  // Command Prompt: launch PowerShell to fetch and run the installer.
  const installCmdCmd = (tok: string) =>
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "` +
    `$env:MILES_AGENT_TOKEN='${tok}'; ` +
    `$env:MILES_AGENT_URL='${agentUrl}'; ` +
    (hostName ? `$env:MILES_ASSET_HOSTNAME='${hostName}'; ` : ``) +
    `irm '${installPsUrl}' | iex"`;

  // PowerShell: set the same env vars, then fetch and run the installer.
  const installCmdPs = (tok: string) =>
    [
      `$env:MILES_AGENT_TOKEN="${tok}"`,
      `$env:MILES_AGENT_URL="${agentUrl}"`,
      ...(hostName ? [`$env:MILES_ASSET_HOSTNAME="${hostName}"`] : []),
      `irm "${installPsUrl}" | iex`,
    ].join("\n");

  // Repair an existing managed installation without generating/revoking a key,
  // re-registering the asset, or changing inventory data. The commands read the
  // token already persisted by the privileged service and only replace the
  // agent source + restart the existing root/SYSTEM service.
  const repairCmdLinux = [
    `sudo bash -c '`,
    `set -eu`,
    `ENV_FILE=/etc/miles-agent/agent.env`,
    `TOKEN_FILE=/etc/miles-agent/agent.token`,
    `TOKEN="$(sed -n "s/^MILES_AGENT_TOKEN=//p" "$ENV_FILE" 2>/dev/null || true)"`,
    `if [ -z "$TOKEN" ] && [ -r "$TOKEN_FILE" ]; then TOKEN="$(cat "$TOKEN_FILE")"; fi`,
    `test -n "$TOKEN"`,
    `API_BASE="$(sed -n "s/^MILES_AGENT_API_BASE=//p" "$ENV_FILE" 2>/dev/null || true)"`,
    `mkdir -p /opt/miles-agent`,
    `python3 -c "import urllib.request; r=urllib.request.Request('${agentUrl}', headers={'User-Agent':'miles-agent-bootstrap/Linux'}); open('/opt/miles-agent/laptop_agent.py','wb').write(urllib.request.urlopen(r, timeout=30).read())"`,
    `PY="$(sed -n "s/^ExecStart=\\([^ ]*\\).*/\\1/p" /etc/systemd/system/miles-agent.service 2>/dev/null | head -n1)"`,
    `test -x "$PY"`,
    `MILES_AGENT_TOKEN="$TOKEN" MILES_AGENT_API_BASE="$API_BASE" "$PY" /opt/miles-agent/laptop_agent.py install-service`,
    `'`,
  ].join("\n");

  const repairCmdWindows = [
    `$ErrorActionPreference = "Stop"`,
    `$d = Join-Path $env:ProgramData "MilesAgent"`,
    `$tokenFile = Join-Path $d "agent.token"`,
    `$token = if (Test-Path $tokenFile) { (Get-Content $tokenFile -Raw).Trim() } else { [Environment]::GetEnvironmentVariable("MILES_AGENT_TOKEN", "Machine") }`,
    `if ([string]::IsNullOrWhiteSpace($token)) { throw "Existing Windows agent key was not found. Generate a key only if this installation has no local key." }`,
    `$py = Join-Path $d "venv\\Scripts\\python.exe"`,
    `$script = Join-Path $d "laptop_agent.py"`,
    `if (-not (Test-Path $py)) { throw "Existing MilesAgent Python service was not found under $d." }`,
    `Invoke-WebRequest -Uri "${agentUrl}" -OutFile $script -UseBasicParsing`,
    `$env:MILES_AGENT_TOKEN = $token`,
    `& $py $script install-service`,
    `if ($LASTEXITCODE -ne 0) { throw "MilesAgent SYSTEM service repair failed with exit code $LASTEXITCODE." }`,
  ].join("\n");

  // Real HARD lock (OS-level account/workstation lock with honest status
  // reporting) needs a recent agent. Older agents either ignore the command,
  // show a dismissable overlay, or lock the screen only once (the user types
  // their password and is back in while the portal still shows Locked).
  //   * Windows/Linux: v0.9.7+ (discovers the real interactive account on
  //     Windows and uses authoritative CLASS=user sessions on Ubuntu).
  //   * macOS: v0.5.0+ — the TRUE login-window lock (disable the account + IT
  //     banner, run as a root LaunchDaemon) only exists from 0.5.0. Earlier mac
  //     agents could not truly lock, so they must be reinstalled.
  // Detect the mismatch and warn IT to update the agent.
  const isMac = /mac|os\s*x|darwin/i.test(device?.os_name ?? "");
  const LOCK_MIN_VERSION = isMac ? [0, 5, 0] : [0, 9, 7];
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

  // Derive "Locked By" and "Last Confirmation" from the command history.
  // The most recently completed lock_screen command tells us who initiated
  // the lock and when the agent confirmed it. Falls back to managed_devices
  // timestamps when no matching command is found (e.g. commands truncated).
  const latestLockSuccess = commands.find(
    (c) => c.command_type === "lock_screen" && c.status === "completed",
  );
  const lockedByName: string | null = latestLockSuccess?.requested_by_name ?? null;
  const lastConfirmedAt: string | null = (() => {
    const ts = latestLockSuccess?.completed_at ?? device?.locked_at ?? null;
    if (!ts) return null;
    return new Date(ts).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  })();
  const lockPending =
    latestLockCmd?.command_type === "lock_screen" &&
    (latestLockCmd.status === "pending" || latestLockCmd.status === "running");
  const lockFailed =
    latestLockCmd?.command_type === "lock_screen" &&
    (latestLockCmd.status === "failed" || latestLockCmd.status === "requires_admin") &&
    !device?.is_locked;

  // Unlock honesty: the device only shows as unlocked once the agent confirms.
  // Until then (or if it failed) surface the exact agent status/reason so IT is
  // never told the device unlocked when it did not. Only relevant while the
  // device is still locked and the most recent action was an unlock.
  const unlockInFlight =
    !!device?.is_locked &&
    latestLockCmd?.command_type === "unlock" &&
    (latestLockCmd.status === "pending" || latestLockCmd.status === "running");
  const unlockFailed =
    !!device?.is_locked &&
    latestLockCmd?.command_type === "unlock" &&
    (latestLockCmd.status === "failed" || latestLockCmd.status === "requires_admin");

  // Restart-required = the device has been up for more than a day.
  const restartRequired =
    device?.uptime_seconds != null && device.uptime_seconds > RESTART_REQUIRED_SECONDS;
  const lastBoot = device?.last_boot_at
    ? new Date(device.last_boot_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "—";

  // Surface ONLY an active, unresolved agent error. `commands` is newest-first.
  // An error is "active" only if NO later command of the SAME command_type has
  // succeeded — a later success (completed) auto-resolves it. A later pending /
  // running retry does NOT resolve it; the error stays until the retry succeeds.
  // We show the most recent such failure. Dismissed errors are hidden too.
  const succeededTypes = new Set<string>();
  let activeErrorCmd: DeviceCommand | undefined;
  for (const c of commands) {
    if (c.status === "completed") {
      succeededTypes.add(c.command_type); // newer success for this type
      continue;
    }
    if (
      (c.status === "failed" || c.status === "requires_admin") &&
      !succeededTypes.has(c.command_type)
    ) {
      activeErrorCmd = c;
      break;
    }
  }
  const latestErrorCmd =
    activeErrorCmd && activeErrorCmd.id !== dismissedErrorId ? activeErrorCmd : undefined;

  function clearAgentError() {
    if (!activeErrorCmd) return;
    setDismissedErrorId(activeErrorCmd.id);
    try { localStorage.setItem(errorDismissKey, activeErrorCmd.id); } catch { /* ignore */ }
  }

  function viewAgentLogs() {
    setAuditLogOpen(true);
    // Let the disclosure render open, then bring it into view.
    requestAnimationFrame(() => auditLogRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

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
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Agent Information</p>
            <Row label="Managed by Agent" value={!device || agentRemoved ? "No" : "Yes"} />
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
                <Row label="Uptime"        value={formatUptime(device.uptime_seconds)} />
                <Row label="Last Restart"  value={lastBoot} />
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
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2">
                <Lock className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-xs font-medium text-red-800">Device locked (confirmed by agent)</p>
                  <p className="text-[11px] text-red-700">
                    End-user access is blocked. Files are preserved.
                    {" "}Unlock below to restore access.
                  </p>
                  {device.lock_reason ? (
                    <p className="text-[11px] text-red-700">
                      <span className="font-medium">Lock Reason:</span> {device.lock_reason}
                    </p>
                  ) : null}
                  {lockedByName ? (
                    <p className="text-[11px] text-red-700">
                      <span className="font-medium">Locked By:</span> {lockedByName}
                    </p>
                  ) : null}
                  {lastConfirmedAt ? (
                    <p className="text-[11px] text-red-700">
                      <span className="font-medium">Last Confirmed:</span> {lastConfirmedAt}
                    </p>
                  ) : null}
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
                  {isAdmin && latestLockCmd?.status === "pending" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 h-7 gap-1.5 text-[11px] text-sky-800 border-sky-300 hover:bg-sky-100"
                      onClick={() => void clearLockPending()}
                      disabled={busy}
                      data-testid="button-clear-lock-pending"
                    >
                      <X className="h-3.5 w-3.5" /> Clear Pending
                    </Button>
                  )}
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
                    {latestLockCmd?.status === "requires_admin"
                      ? " The agent is not running with admin rights. Reinstall it on the device using the sudo install command below, then retry the lock."
                      : " You can retry the lock below once the issue is resolved."}
                  </p>
                </div>
              </div>
            )}

            {unlockInFlight && (
              <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-sky-600 shrink-0 animate-spin" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-sky-800">
                    Unlock {latestLockCmd?.status === "running" ? "executing" : "pending"}…
                  </p>
                  <p className="text-[11px] text-sky-700">
                    Unlock requested — waiting for the device agent to apply it and confirm. The device is
                    <b> still locked</b> until the agent reports back (next sync).
                  </p>
                </div>
              </div>
            )}

            {unlockFailed && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-red-900">
                    Unlock {latestLockCmd?.status === "requires_admin" ? "needs admin privileges" : "failed"} — device is STILL locked
                  </p>
                  <p className="text-[11px] text-red-800">
                    {latestLockCmd?.error_message
                      ? latestLockCmd.error_message
                      : "The agent could not confirm the unlock."}
                    {latestLockCmd?.status === "requires_admin"
                      ? " The agent is not running with admin rights. Reinstall it on the device using the sudo install command below, then retry the unlock."
                      : " Retry Unlock below once the device is back online; access is restored only after the agent confirms."}
                  </p>
                </div>
              </div>
            )}

            {removalPending && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-start gap-2">
                <RefreshCw className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-amber-900">Agent removal pending</p>
                  <p className="text-[11px] text-amber-800">
                    An uninstall was queued — waiting for the laptop to remove the agent and confirm (next sync).
                    The device shows as <b>Agent Removed</b> only once it reports back. If the laptop is offline or
                    unresponsive, use <b>Force Remove Agent from Portal</b>.
                  </p>
                </div>
              </div>
            )}

            {agentRemoved && (
              <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 flex items-start gap-2">
                <Trash2 className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-800">Agent removed</p>
                  <p className="text-[11px] text-slate-700">
                    Management ended
                    {device?.agent_removed_at ? <> on {new Date(device.agent_removed_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</> : null}.
                    {device?.agent_removed_reason ? <> Reason: {device.agent_removed_reason}.</> : null}
                    {" "}The asset record, assigned user, and full history are <b>preserved</b>. Generate a new key
                    and re-install to bring this device back under management. See who/when in the audit log below.
                  </p>
                  {isSuperAdmin && (
                    <div className="mt-2">
                      <Button
                        size="sm" variant="outline"
                        className="h-7 gap-1.5 text-[11px]"
                        onClick={clearRemoval}
                        disabled={busy}
                        data-testid="button-clear-agent-removal"
                      >
                        <X className="h-3.5 w-3.5" /> Clear Notice
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {lockUnenforceable && !agentRemoved && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-amber-900">Lock not enforced — agent too old</p>
                  <p className="text-[11px] text-amber-800">
                    This device runs agent <span className="font-mono">v{device?.agent_version ?? "?"}</span>, which
                    does not support the real hard lock (needs <span className="font-mono">v{LOCK_MIN_VERSION.join(".")}</span>+). The lock is
                    recorded here but the laptop may stay usable. Reinstall the agent on the device to enforce it.
                  </p>
                </div>
              </div>
            )}

            {latestErrorCmd && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-red-800">
                    Latest agent error — {COMMAND_LABEL[latestErrorCmd.command_type] ?? latestErrorCmd.command_type}
                  </p>
                  <p className="text-[11px] text-red-700 break-words">
                    {latestErrorCmd.error_message?.trim() ||
                      (latestErrorCmd.status === "requires_admin"
                        ? "The agent needs administrator privileges to finish this action."
                        : "The agent reported a failure without a detailed message. Check the command audit log.")}
                  </p>
                  <p className="text-[10px] text-red-600/80 mt-0.5">
                    {(() => {
                      const w = latestErrorCmd.completed_at ?? latestErrorCmd.executed_at ?? latestErrorCmd.requested_at;
                      return w ? new Date(w).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "";
                    })()}
                  </p>
                  {isSuperAdmin && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm" variant="outline"
                        className="h-7 gap-1.5 text-[11px] text-red-700 border-red-300 hover:bg-red-100"
                        onClick={clearAgentError}
                        data-testid="button-clear-agent-error"
                      >
                        <X className="h-3.5 w-3.5" /> Clear Error
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        className="h-7 gap-1.5 text-[11px]"
                        onClick={viewAgentLogs}
                        data-testid="button-view-agent-logs"
                      >
                        <FileText className="h-3.5 w-3.5" /> View Logs
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {restartRequired && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-start gap-2">
                <RefreshCw className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-amber-900">Restart recommended</p>
                  <p className="text-[11px] text-amber-800">
                    This device has been running for <b>{formatUptime(device?.uptime_seconds)}</b> without a
                    restart. Restarting applies pending updates and clears memory.
                    {isSuperAdmin ? " Use the restart controls below." : ""}
                  </p>
                </div>
              </div>
            )}

            {isSuperAdmin && (
              <div className="pt-1 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Quick Actions</p>
                  <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => void load()}>
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                  </Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {/* Agent key */}
                  {!token ? (
                    <Button size="sm" variant="outline" className="gap-2 justify-start" onClick={generate} disabled={busy} data-testid="button-generate-agent-key">
                      <KeyRound className="h-4 w-4" /> Generate Key
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="gap-2 justify-start" onClick={generate} disabled={busy} data-testid="button-regenerate-agent-key">
                      <RefreshCw className="h-4 w-4" /> Regenerate Key
                    </Button>
                  )}

                  {/* Revoke agent key */}
                  {token && (
                    <Button size="sm" variant="outline" className="gap-2 justify-start text-red-600 border-red-300 hover:bg-red-50" onClick={() => setShowRevoke(true)} disabled={busy} data-testid="button-revoke-agent-key">
                      <Power className="h-4 w-4" /> Revoke
                    </Button>
                  )}

                  {/* Lock / Unlock toggle */}
                  {device?.is_managed && (
                    device.is_locked ? (
                      <Button size="sm" variant="outline" className="gap-2 justify-start text-emerald-700 border-emerald-300 hover:bg-emerald-50" onClick={unlockDevice} disabled={busy || removalPending} data-testid="button-unlock-device">
                        <Unlock className="h-4 w-4" /> Unlock
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="gap-2 justify-start text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => setShowLock(true)} disabled={busy || removalPending} data-testid="button-lock-device">
                        <Lock className="h-4 w-4" /> Lock
                      </Button>
                    )
                  )}

                  {/* Restart (force, with grace period) */}
                  {device?.is_managed && (
                    <Button size="sm" variant="outline" className="gap-2 justify-start text-red-600 border-red-300 hover:bg-red-50" onClick={() => setShowForceRestart(true)} disabled={busy || removalPending} data-testid="button-force-restart">
                      <Power className="h-4 w-4" /> Restart
                    </Button>
                  )}

                  {/* Schedule restart */}
                  {device?.is_managed && (
                    <Button size="sm" variant="outline" className="gap-2 justify-start" onClick={() => void requestRestart("schedule_restart")} disabled={busy || removalPending} data-testid="button-schedule-restart">
                      <RefreshCw className="h-4 w-4" /> Schedule Restart
                    </Button>
                  )}

                  {/* Wallpaper actions intentionally live only in the Company
                      Wallpaper section below — kept out of Quick Actions to avoid
                      duplicate buttons. */}

                  {/* Notify restart */}
                  {device?.is_managed && (
                    <Button size="sm" variant="outline" className="gap-2 justify-start" onClick={() => void requestRestart("notify_restart")} disabled={busy || removalPending} data-testid="button-notify-restart">
                      <Zap className="h-4 w-4" /> Notify Restart
                    </Button>
                  )}

                  {/* Remove agent (graceful) */}
                  {device?.is_managed && (
                    <Button size="sm" variant="outline" className="gap-2 justify-start text-red-600 border-red-300 hover:bg-red-50" onClick={() => { setRemoveReason(""); setShowRemoveAgent(true); }} disabled={busy || removalPending} data-testid="button-remove-agent">
                      <Trash2 className="h-4 w-4" /> Remove Agent
                    </Button>
                  )}

                  {/* Remote wipe — NOT supported (agent is read/control only, no wipe). */}
                  <Button
                    size="sm" variant="outline"
                    className="gap-2 justify-start opacity-60 cursor-not-allowed"
                    disabled
                    title="Remote wipe is not available — the agent intentionally supports no destructive wipe/reset."
                    data-testid="button-remote-wipe"
                  >
                    <ShieldOff className="h-4 w-4" /> Remote Wipe
                  </Button>
                </div>

                {/* Secondary / advanced controls */}
                <details className="rounded-md border bg-muted/20">
                  <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-muted-foreground">
                    More controls
                  </summary>
                  <div className="flex flex-wrap gap-2 px-3 pb-3">
                    {device?.is_managed && (
                      <Button size="sm" variant="outline" className="gap-2 text-red-700 border-red-400 hover:bg-red-50" onClick={() => { setRemoveReason(""); setShowForceRemove(true); }} disabled={busy} data-testid="button-force-remove-agent">
                        <Ban className="h-4 w-4" /> Force Remove Agent from Portal
                      </Button>
                    )}
                    {device && (
                      <Button size="sm" variant="outline" className="gap-2" onClick={downloadUninstall} data-testid="button-download-uninstall">
                        <Download className="h-4 w-4" /> Download Uninstall Command
                      </Button>
                    )}
                  </div>
                </details>
              </div>
            )}

            {isSuperAdmin && device && commands.length > 0 && (
              <details
                ref={auditLogRef}
                className="rounded-md border bg-muted/20 mt-1"
                open={auditLogOpen}
                onToggle={(e) => setAuditLogOpen((e.currentTarget as HTMLDetailsElement).open)}
              >
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
                        {c.command_payload?.reason && (
                          <p className="mt-0.5 text-muted-foreground break-words">Reason given: {c.command_payload.reason}</p>
                        )}
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
               {device && !isMac && (
                 <details className="mt-3 rounded-md border border-amber-300 bg-amber-50/40">
                   <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-amber-900">
                     Repair current Windows / Ubuntu installation (no new key)
                   </summary>
                   <div className="space-y-3 px-3 pb-3">
                     <p className="text-[11px] text-amber-900">
                       Run as Administrator on Windows or with <b>sudo</b> on Ubuntu. This reuses the
                       key already stored on the laptop, updates only the agent, and restarts the existing
                       privileged service. It does not regenerate a key, revoke the device, or change asset data.
                     </p>
                     {/ubuntu|linux/i.test(device.os_name ?? "") && (
                       <CmdBlock
                         label="Ubuntu / Linux repair"
                         value={repairCmdLinux}
                         rows={12}
                         testid="button-copy-repair-linux"
                         onCopy={() => copy(repairCmdLinux, "Ubuntu repair command")}
                       />
                     )}
                     {/windows/i.test(device.os_name ?? "") && (
                       <CmdBlock
                         label="Windows PowerShell repair (Administrator)"
                         value={repairCmdWindows}
                         rows={10}
                         testid="button-copy-repair-windows"
                         onCopy={() => copy(repairCmdWindows, "Windows repair command")}
                       />
                     )}
                   </div>
                 </details>
               )}
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
                The installer <b>auto-elevates</b> — approve the Windows security (UAC) prompt. Administrator rights are
                required so the agent runs as <b>SYSTEM</b> and can actually enforce a device lock (a normal-user agent
                cannot block Windows sign-in). It installs Python if missing (one-time), registers, runs a test
                <span className="font-mono"> sync</span>, and adds a <b>SYSTEM scheduled task</b> that starts at boot.
                Refresh this page after ~10 seconds to see the device. To remove later (run as Administrator):
                <span className="font-mono"> {`%ProgramData%\\MilesAgent\\venv\\Scripts\\python.exe %ProgramData%\\MilesAgent\\laptop_agent.py uninstall-service`}</span>.
                {hostName ? <> The PC is also renamed to the asset tag (<span className="font-mono">{hostName}</span>),
                which takes effect after the next <b>reboot</b>.</> : null}
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

      <Dialog open={showForceRestart} onOpenChange={setShowForceRestart}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Force restart this device?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            The user is <b>warned immediately</b> and the device restarts after a <b>10-minute grace
            period</b>, closing any open apps. <b>Unsaved work may be lost.</b> Prefer <b>Schedule
            Restart</b> or <b>Notify Restart</b> when the user is mid-task. This never restarts silently.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForceRestart(false)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => void requestRestart("force_restart")} disabled={busy}>Force Restart</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove agent (graceful) */}
      <Dialog open={showRemoveAgent} onOpenChange={setShowRemoveAgent}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Remove agent from this device?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This queues a clean uninstall the laptop performs on its next sync: it stops the background
            service, removes startup, deletes the agent files and the saved key. The portal marks the
            device <b>Agent Removed</b> only once the laptop confirms.
          </p>
          <p className="text-sm text-muted-foreground">
            The <b>asset record, assigned user, sync logs and full history are preserved</b> — only the
            management connection ends. Use this when the laptop is online and reachable.
          </p>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Reason (saved to the audit log)</label>
            <textarea
              value={removeReason}
              onChange={(e) => setRemoveReason(e.target.value)}
              rows={2}
              placeholder="e.g. Employee offboarded / device returned to IT"
              className="mt-1 w-full resize-none rounded border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="input-remove-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRemoveAgent(false)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={removeAgent} disabled={busy} data-testid="button-confirm-remove-agent">Remove Agent</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force remove from portal (laptop unresponsive) */}
      <Dialog open={showForceRemove} onOpenChange={setShowForceRemove}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Force remove agent from the portal?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Use this only when the laptop is <b>lost, broken or not responding</b>. It immediately revokes
            the agent key, ends management, releases any lock, and clears the pending command queue —
            <b> without waiting for the laptop</b>.
          </p>
          <p className="text-sm text-muted-foreground">
            The <b>asset record, assigned user, sync logs and history are kept</b>. If the laptop ever comes
            back online, clean it with the <b>Download Uninstall Command</b> file.
          </p>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Reason (saved to the audit log)</label>
            <textarea
              value={removeReason}
              onChange={(e) => setRemoveReason(e.target.value)}
              rows={2}
              placeholder="e.g. Laptop lost / unresponsive / hardware failure"
              className="mt-1 w-full resize-none rounded border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="input-force-remove-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForceRemove(false)}>Cancel</Button>
            <Button className="bg-red-700 hover:bg-red-800 text-white" onClick={forceRemoveAgent} disabled={busy} data-testid="button-confirm-force-remove">Force Remove</Button>
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
