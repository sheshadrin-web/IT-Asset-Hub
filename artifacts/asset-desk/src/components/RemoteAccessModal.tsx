import { useState, useEffect, useCallback, useRef } from "react";
import {
  MonitorPlay, WifiOff, Clock, CheckCircle2, XCircle,
  AlertTriangle, Loader2, Users, Monitor, RefreshCw,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type AccessMode = "assisted" | "unattended";

type SessionStatus =
  | "requested" | "approved" | "denied"
  | "active" | "ended" | "failed";

interface RemoteSession {
  id:                string;
  mode:              AccessMode;
  status:            SessionStatus;
  started_at:        string | null;
  ended_at:          string | null;
  created_at:        string;
  requested_by_name: string | null;
}

interface Props {
  open:         boolean;
  onClose:      () => void;
  assetId:      string;
  agentKeyId:   string;
  isSuperAdmin: boolean;
  assetTag?:    string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_META: Record<SessionStatus, { label: string; cls: string; icon: React.ElementType }> = {
  requested: { label: "Waiting for approval", cls: "text-amber-700  bg-amber-50  border-amber-200",    icon: Clock        },
  approved:  { label: "Approved",             cls: "text-sky-700    bg-sky-50    border-sky-200",      icon: CheckCircle2 },
  denied:    { label: "Denied by user",       cls: "text-red-700    bg-red-50    border-red-200",      icon: XCircle      },
  active:    { label: "Session Active",       cls: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: MonitorPlay  },
  ended:     { label: "Ended",               cls: "text-slate-600  bg-slate-50  border-slate-200",    icon: WifiOff      },
  failed:    { label: "Failed",              cls: "text-red-700    bg-red-50    border-red-200",      icon: XCircle      },
};

// Statuses where we should keep polling for an update from the agent
const PENDING_STATUSES: SessionStatus[] = ["requested", "approved"];

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function SessionBadge({ status }: { status: SessionStatus }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border",
      m.cls,
    )}>
      <Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5000;

export default function RemoteAccessModal({
  open, onClose, assetId, agentKeyId, isSuperAdmin, assetTag,
}: Props) {
  const { toast } = useToast();

  // ── UI state ─────────────────────────────────────────────────────────────
  const [step,          setStep]          = useState<"choose" | "confirm_unattended" | "busy" | "session">("choose");
  const [mode,          setMode]          = useState<AccessMode>("assisted");
  const [activeSession, setActiveSession] = useState<RemoteSession | null>(null);
  const [isPolling,     setIsPolling]     = useState(false);

  // ── Session history ───────────────────────────────────────────────────────
  const [sessions,        setSessions]        = useState<RemoteSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load recent history ───────────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    const { data, error } = await supabase.rpc("get_remote_access_sessions", {
      p_asset_id: assetId, p_limit: 5,
    });
    setSessionsLoading(false);
    if (!error && Array.isArray(data)) {
      setSessions(data as RemoteSession[]);
    }
  }, [assetId]);

  // ── Poll active session status from DB ────────────────────────────────────
  const pollSessionStatus = useCallback(async (sessionId: string) => {
    const { data, error } = await supabase
      .from("remote_access_sessions")
      .select("id, mode, status, started_at, ended_at, created_at")
      .eq("id", sessionId)
      .single();

    if (error || !data) return;

    const updated = data as RemoteSession;
    setActiveSession(prev => prev ? { ...prev, ...updated } : prev);

    // If no longer pending, stop polling and refresh history
    if (!PENDING_STATUSES.includes(updated.status as SessionStatus)) {
      stopPolling();
      void loadSessions();

      if (updated.status === "denied") {
        toast({ title: "Remote access denied", description: "The end user declined the request.", variant: "destructive" });
      } else if (updated.status === "active") {
        toast({ title: "Remote access approved", description: "The session is now active." });
      }
    }
  }, [loadSessions, toast]);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setIsPolling(false);
  }

  function startPolling(sessionId: string) {
    stopPolling();
    setIsPolling(true);
    pollRef.current = setInterval(() => {
      void pollSessionStatus(sessionId);
    }, POLL_INTERVAL_MS);
  }

  // ── Reset on open / stop polling on close ────────────────────────────────
  useEffect(() => {
    if (open) {
      setStep("choose");
      setMode("assisted");
      setActiveSession(null);
      stopPolling();
      void loadSessions();
    } else {
      stopPolling();
    }
    return () => stopPolling();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Start polling when an assisted session is waiting ────────────────────
  useEffect(() => {
    if (
      step === "session" &&
      activeSession &&
      PENDING_STATUSES.includes(activeSession.status)
    ) {
      startPolling(activeSession.id);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activeSession?.id, activeSession?.status]);

  // ── Request session ───────────────────────────────────────────────────────
  async function startSession(selectedMode: AccessMode) {
    setStep("busy");
    const { data, error } = await supabase.rpc("request_remote_access", {
      p_asset_id:     assetId,
      p_agent_key_id: agentKeyId,
      p_mode:         selectedMode,
    });
    if (error || !data?.success) {
      toast({
        title: "Failed to start session",
        description: error?.message ?? (data?.error as string) ?? "Unknown error",
        variant: "destructive",
      });
      setStep("choose");
      return;
    }

    const sessionId = data.session_id as string;

    // For unattended (portal-only phase): mark active immediately
    if (selectedMode === "unattended") {
      await supabase.rpc("update_remote_access_session", {
        p_session_id: sessionId,
        p_status:     "active",
      });
    }

    const newSession: RemoteSession = {
      id:                sessionId,
      mode:              selectedMode,
      status:            selectedMode === "unattended" ? "active" : "requested",
      started_at:        selectedMode === "unattended" ? new Date().toISOString() : null,
      ended_at:          null,
      created_at:        new Date().toISOString(),
      requested_by_name: null,
    };
    setActiveSession(newSession);
    setStep("session");
    await loadSessions();
  }

  // ── End session ───────────────────────────────────────────────────────────
  async function endSession() {
    if (!activeSession) return;
    stopPolling();
    setStep("busy");
    const { data, error } = await supabase.rpc("update_remote_access_session", {
      p_session_id: activeSession.id,
      p_status:     "ended",
    });
    if (error || !data?.success) {
      toast({
        title: "Failed to end session",
        description: error?.message ?? (data?.error as string),
        variant: "destructive",
      });
      setStep("session");
      return;
    }
    toast({ title: "Remote access session ended" });
    setActiveSession(null);
    await loadSessions();
    setStep("choose");
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { stopPolling(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <MonitorPlay className="h-4 w-4 text-muted-foreground" />
            Remote Access
            {assetTag && (
              <span className="text-muted-foreground font-normal text-sm">— {assetTag}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* ── Choose mode ──────────────────────────────────────────────────── */}
        {step === "choose" && (
          <div className="space-y-4 py-1">
            <p className="text-xs text-muted-foreground">
              Select a remote access mode. The device agent must be online for the session to connect.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {/* Assisted */}
              <button
                type="button"
                onClick={() => setMode("assisted")}
                className={cn(
                  "rounded-lg border p-4 text-left transition-colors hover:border-primary/60 hover:bg-accent",
                  mode === "assisted" ? "border-primary bg-accent ring-1 ring-primary" : "border-border",
                )}
              >
                <Users className="h-5 w-5 mb-2 text-sky-600" />
                <p className="text-sm font-medium">Assisted Access</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Sends a request to the device. End user must approve before the session starts.
                </p>
              </button>

              {/* Unattended */}
              <button
                type="button"
                disabled={!isSuperAdmin}
                onClick={() => isSuperAdmin && setMode("unattended")}
                className={cn(
                  "rounded-lg border p-4 text-left transition-colors",
                  isSuperAdmin ? "hover:border-primary/60 hover:bg-accent cursor-pointer" : "opacity-50 cursor-not-allowed",
                  mode === "unattended" && isSuperAdmin ? "border-primary bg-accent ring-1 ring-primary" : "border-border",
                )}
              >
                <Monitor className="h-5 w-5 mb-2 text-violet-600" />
                <p className="text-sm font-medium">Unattended Access</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {isSuperAdmin
                    ? "Starts session directly without user approval. Requires super admin."
                    : "Only super_admin can use Unattended Access."}
                </p>
              </button>
            </div>

            {mode === "assisted" && (
              <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-800">
                <p className="font-medium mb-0.5">Message shown to end user:</p>
                <p className="italic text-sky-700">"IT Admin is requesting remote access to this system."</p>
                <p className="mt-1 text-[11px] text-sky-600">
                  User can Allow or Deny. The portal will update automatically once they respond.
                </p>
              </div>
            )}

            {mode === "unattended" && isSuperAdmin && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                <p>
                  Unattended access connects directly without notifying the user.
                  Only use this when unattended access is enabled for this device.
                </p>
              </div>
            )}

            <DialogFooter className="pt-1 gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              {mode === "assisted" ? (
                <Button type="button" onClick={() => void startSession("assisted")} className="gap-2" data-testid="button-request-assisted-access">
                  <Users className="h-4 w-4" /> Request Assisted Access
                </Button>
              ) : (
                <Button type="button" variant="destructive" onClick={() => setStep("confirm_unattended")} disabled={!isSuperAdmin} className="gap-2" data-testid="button-confirm-unattended-access">
                  <Monitor className="h-4 w-4" /> Start Unattended Access
                </Button>
              )}
            </DialogFooter>
          </div>
        )}

        {/* ── Confirm unattended ───────────────────────────────────────────── */}
        {step === "confirm_unattended" && (
          <div className="space-y-4 py-1">
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 flex gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1 text-sm text-red-800">
                <p className="font-semibold">Confirm Unattended Access</p>
                <p>
                  You are about to start a remote session on <strong>{assetTag ?? "this device"}</strong> without
                  notifying the end user. The session will be recorded in the audit log.
                </p>
                <p className="text-[11px] text-red-700">
                  Note: The live remote desktop engine is not yet active (Phase 2).
                  This records the session for tracking purposes.
                </p>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setStep("choose")}>Back</Button>
              <Button type="button" variant="destructive" onClick={() => void startSession("unattended")} data-testid="button-start-unattended-confirmed">
                Confirm &amp; Connect
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── Busy / loading ───────────────────────────────────────────────── */}
        {step === "busy" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Starting session…</p>
          </div>
        )}

        {/* ── Active / requested session ───────────────────────────────────── */}
        {step === "session" && activeSession && (
          <div className="space-y-4 py-1">
            <div className={cn(
              "rounded-md border px-4 py-3 space-y-2",
              STATUS_META[activeSession.status].cls,
            )}>
              <div className="flex items-center justify-between">
                <SessionBadge status={activeSession.status} />
                <span className="text-[11px] opacity-70">{fmt(activeSession.created_at)}</span>
              </div>

              {activeSession.status === "requested" && (
                <>
                  <p className="text-xs">
                    A request has been sent to the device. The end user will see an approval prompt
                    on their screen. This panel updates automatically every 5 seconds.
                  </p>
                  {/* Polling indicator */}
                  <div className="flex items-center gap-1.5 text-[11px] opacity-70">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-600" />
                    </span>
                    Checking for response…
                  </div>
                </>
              )}

              {activeSession.status === "approved" && (
                <p className="text-xs">Approved by the end user. Connecting…</p>
              )}

              {activeSession.status === "denied" && (
                <p className="text-xs font-medium">The end user declined the remote access request.</p>
              )}

              {activeSession.mode === "unattended" && activeSession.status === "active" && (
                <p className="text-xs">
                  Unattended session recorded. The remote desktop engine will connect here in Phase 2.
                  Click <strong>End Session</strong> when finished.
                </p>
              )}

              {activeSession.status === "ended" && (
                <p className="text-xs">Session ended.</p>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => { stopPolling(); onClose(); }}>Close</Button>
              {(activeSession.status === "requested" || activeSession.status === "approved" || activeSession.status === "active") && (
                <Button type="button" variant="destructive" onClick={() => void endSession()} data-testid="button-end-remote-session">
                  End Session
                </Button>
              )}
              {(activeSession.status === "denied" || activeSession.status === "ended" || activeSession.status === "failed") && (
                <Button type="button" onClick={() => { setActiveSession(null); setStep("choose"); }}>
                  Start New Session
                </Button>
              )}
            </DialogFooter>
          </div>
        )}

        {/* ── Session history ──────────────────────────────────────────────── */}
        {step !== "busy" && (
          <div className="border-t pt-3 mt-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Recent Sessions
              </p>
              <Button
                size="sm" variant="ghost" className="h-6 w-6 p-0"
                onClick={() => void loadSessions()} disabled={sessionsLoading} title="Refresh"
              >
                <RefreshCw className={cn("h-3 w-3", sessionsLoading && "animate-spin")} />
              </Button>
            </div>
            {sessionsLoading ? (
              <p className="text-[11px] text-muted-foreground">Loading…</p>
            ) : sessions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No sessions yet for this device.</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {sessions.map(s => (
                  <div key={s.id} className="flex items-center justify-between text-[11px] gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn(
                        "capitalize font-medium shrink-0",
                        s.mode === "assisted" ? "text-sky-700" : "text-violet-700",
                      )}>
                        {s.mode}
                      </span>
                      <SessionBadge status={s.status} />
                    </div>
                    <span className="text-muted-foreground shrink-0">{fmt(s.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
