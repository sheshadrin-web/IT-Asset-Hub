import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabaseClient";
import {
  Loader2, AlertTriangle, Power, Maximize2, Minimize2,
  Wifi, Monitor, Gauge, Clock, ArrowDownToLine, MonitorOff, ArrowLeft,
  MousePointerClick, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Commit-3 — Remote Session Viewer (view-only).
 *
 * Renders the agent's live screen frames streamed over a PRIVATE per-session
 * Supabase Realtime channel. The admin authorizes the channel join with their
 * own auth JWT (session owner / super_admin) against the realtime.messages RLS
 * policies — the same gate also requires the session to be active and its token
 * unexpired, so termination/expiry stops the stream on both ends.
 *
 * Commit-4 — adds optional remote INPUT control. The admin explicitly "Takes
 * control" to send mouse + keyboard to the agent over the SAME RLS-gated channel;
 * input therefore stops the instant the session is terminated or its token
 * expires. Control take/release is broadcast to the agent (which surfaces an
 * on-machine banner to the end user) and audited via log_remote_input_state.
 */
type Phase = "issuing" | "joining" | "waiting" | "streaming" | "ended" | "error";

const PING_INTERVAL_MS  = 3000;
const RENEW_INTERVAL_MS  = 5 * 60 * 1000;   // renew session token every 5 min
const STALL_TIMEOUT_MS   = 8000;            // no frames for 8s → back to "waiting"

function fmtDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Stat({ icon: Icon, label, value, tone }: {
  icon: React.ElementType; label: string; value: string; tone?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={cn("h-3.5 w-3.5 shrink-0", tone ?? "text-slate-400")} />
      <span className="text-[11px] text-slate-400">{label}</span>
      <span className="text-xs font-medium text-slate-100 tabular-nums">{value}</span>
    </div>
  );
}

export default function RemoteSessionViewer({ sessionId }: { sessionId: string }) {
  const [, navigate] = useLocation();

  const [phase,       setPhase]       = useState<Phase>("issuing");
  const [error,       setError]       = useState<string | null>(null);
  const [res,         setRes]         = useState<{ w: number; h: number } | null>(null);
  const [fps,         setFps]         = useState(0);
  const [avgFps,      setAvgFps]      = useState(0);
  const [latencyMs,   setLatencyMs]   = useState<number | null>(null);
  const [kbps,        setKbps]        = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [agentName,   setAgentName]   = useState<string | null>(null);
  const [isFs,        setIsFs]        = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [adminName,   setAdminName]   = useState<string>("IT Admin");

  const canvasRef  = useRef<HTMLCanvasElement | null>(null);
  const wrapRef    = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pingTimerRef  = useRef<number | null>(null);
  const renewTimerRef = useRef<number | null>(null);
  const statsTimerRef = useRef<number | null>(null);
  // Live mirrors so the realtime/native input callbacks never read stale state.
  const controllingRef = useRef(false);
  const adminNameRef   = useRef("IT Admin");
  const resRef         = useRef<{ w: number; h: number } | null>(null);
  const lastMoveRef    = useRef(0);

  // Tear down all live streaming resources (timers + channel). Idempotent so it
  // is safe to call from both manual disconnect() and the effect cleanup.
  const teardownStreaming = useCallback(() => {
    if (pingTimerRef.current)  { window.clearInterval(pingTimerRef.current);  pingTimerRef.current  = null; }
    if (renewTimerRef.current) { window.clearInterval(renewTimerRef.current); renewTimerRef.current = null; }
    if (statsTimerRef.current) { window.clearInterval(statsTimerRef.current); statsTimerRef.current = null; }
    if (channelRef.current) { void supabase.removeChannel(channelRef.current); channelRef.current = null; }
  }, []);

  // Rolling metrics (kept in refs so the realtime callbacks never go stale).
  const frameTimes  = useRef<number[]>([]);                 // frame ts in last 1s → FPS
  const bytesWindow = useRef<{ t: number; bytes: number }[]>([]); // bytes in last 1s → bandwidth
  const totalFrames = useRef(0);
  const startedAt   = useRef<number>(Date.now());
  const lastFrameAt = useRef<number>(0);
  const endedRef    = useRef(false);

  const drawFrame = useCallback((b64: string, w: number, h: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0, w, h);
    };
    img.src = `data:image/jpeg;base64,${b64}`;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      // 1. Mint the session token (proves the admin owns/may view this session)
      //    and derive the channel name.
      const { data, error: rpcErr } = await supabase.rpc("issue_remote_session_token", {
        p_session_id: sessionId,
      });
      if (cancelled) return;
      if (rpcErr || !data?.success) {
        setError(rpcErr?.message ?? (data?.error as string) ?? "Failed to issue session token");
        setPhase("error");
        return;
      }

      const channelName = data.channel_name as string;
      setPhase("joining");

      // 2. Join the PRIVATE channel. Realtime authorizes the join via the admin's
      //    own auth JWT against realtime.messages RLS.
      await supabase.realtime.setAuth();
      if (cancelled) return;

      const channel = supabase.channel(channelName, {
        config: { broadcast: { self: false }, private: true },
      });
      channelRef.current = channel;

      channel.on("broadcast", { event: "frame" }, (msg) => {
        const p = (msg.payload ?? {}) as { seq?: number; w?: number; h?: number; data?: string; fmt?: string };
        if (!p.data || !p.w || !p.h) return;
        const now = performance.now();
        lastFrameAt.current = now;
        totalFrames.current += 1;
        frameTimes.current.push(now);
        // base64 → byte length (4 chars encode 3 bytes).
        bytesWindow.current.push({ t: now, bytes: Math.floor((p.data.length * 3) / 4) });
        setRes({ w: p.w, h: p.h });
        resRef.current = { w: p.w, h: p.h };
        setPhase((cur) => (cur === "ended" ? cur : "streaming"));
        drawFrame(p.data, p.w, p.h);
      });

      channel.on("broadcast", { event: "pong" }, (msg) => {
        const p = (msg.payload ?? {}) as { ts?: number; agent?: string; version?: string };
        if (typeof p.ts === "number") setLatencyMs(Math.max(0, Math.round(performance.now() - p.ts)));
        if (p.agent) setAgentName(p.version ? `${p.agent} (v${p.version})` : p.agent);
      });

      channel.on("broadcast", { event: "end" }, () => {
        endedRef.current = true;
        controllingRef.current = false;
        setControlling(false);
        setPhase("ended");
      });

      channel.subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setPhase((cur) => (cur === "streaming" || cur === "ended" ? cur : "waiting"));
          const sendPing = () => void channel.send({
            type: "broadcast", event: "ping",
            payload: { nonce: crypto.randomUUID(), ts: performance.now() },
          });
          sendPing();
          pingTimerRef.current = window.setInterval(sendPing, PING_INTERVAL_MS);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError("Realtime channel error — could not join the private session channel.");
          setPhase("error");
        }
      });

      // 3. Keep the session token fresh so a long viewing session doesn't expire
      //    out from under the RLS gate.
      renewTimerRef.current = window.setInterval(() => {
        void supabase.rpc("renew_remote_session_token", { p_session_id: sessionId });
      }, RENEW_INTERVAL_MS);
    }

    // Stats sampler (1 Hz): FPS, avg FPS, bandwidth, duration, stall detection.
    statsTimerRef.current = window.setInterval(() => {
      const now = performance.now();
      frameTimes.current = frameTimes.current.filter((t) => now - t <= 1000);
      setFps(frameTimes.current.length);

      bytesWindow.current = bytesWindow.current.filter((b) => now - b.t <= 1000);
      const bytes = bytesWindow.current.reduce((s, b) => s + b.bytes, 0);
      setKbps(Math.round((bytes / 1024) * 10) / 10);

      const elapsed = (Date.now() - startedAt.current) / 1000;
      setDurationSec(Math.floor(elapsed));
      setAvgFps(elapsed > 0 ? Math.round((totalFrames.current / elapsed) * 10) / 10 : 0);

      if (lastFrameAt.current && now - lastFrameAt.current > STALL_TIMEOUT_MS && !endedRef.current) {
        setPhase((cur) => (cur === "streaming" ? "waiting" : cur));
      }
    }, 1000);

    void start();

    return () => {
      cancelled = true;
      // If we were controlling, release BEFORE the channel is torn down so the
      // agent reliably drops its input gate + banner and the audit/DB flag is
      // cleared on route change / navigate-away / unmount (not just explicit
      // Disconnect). Best-effort: cleanup can't await.
      if (controllingRef.current) {
        controllingRef.current = false;
        const ch = channelRef.current;
        if (ch) {
          try { void ch.send({ type: "broadcast", event: "control", payload: { enabled: false, by: adminNameRef.current } }); } catch { /* best effort */ }
        }
        try { void supabase.rpc("log_remote_input_state", { p_session_id: sessionId, p_enabled: false }); } catch { /* best effort */ }
      }
      teardownStreaming();
    };
  }, [sessionId, drawFrame, teardownStreaming]);

  // Failsafe for tab close / hard refresh / crash: best-effort tell the agent to
  // drop control on pagehide. (Belt-and-suspenders — the agent also auto-disables
  // input once the session token expires or the 5s authority re-check fails.)
  useEffect(() => {
    const onHide = () => {
      if (!controllingRef.current) return;
      const ch = channelRef.current;
      if (ch) {
        try { void ch.send({ type: "broadcast", event: "control", payload: { enabled: false, by: adminNameRef.current } }); } catch { /* best effort */ }
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  // ── Disconnect: tell the agent to stop, mark the session ended ──────────────
  const disconnect = useCallback(async () => {
    setDisconnecting(true);
    endedRef.current = true;
    const wasControlling = controllingRef.current;
    controllingRef.current = false;
    setControlling(false);
    const ch = channelRef.current;
    if (ch) {
      if (wasControlling) {
        try {
          await ch.send({ type: "broadcast", event: "control", payload: { enabled: false, by: adminNameRef.current } });
        } catch { /* best effort */ }
      }
      try {
        await ch.send({ type: "broadcast", event: "end", payload: { reason: "viewer_disconnect" } });
      } catch { /* best effort */ }
    }
    if (wasControlling) {
      try {
        await supabase.rpc("log_remote_input_state", { p_session_id: sessionId, p_enabled: false });
      } catch { /* best effort */ }
    }
    try {
      await supabase.rpc("update_remote_access_session", { p_session_id: sessionId, p_status: "ended" });
    } catch { /* best effort */ }
    // Stop all residual traffic (ping/renew/stats timers + leave the channel)
    // immediately on manual disconnect rather than waiting for unmount.
    teardownStreaming();
    setPhase("ended");
    setDisconnecting(false);
  }, [sessionId, teardownStreaming]);

  // ── Fullscreen ──────────────────────────────────────────────────────────────
  const toggleFs = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      void el.requestFullscreen?.().catch(() => {});
    } else {
      void document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ── Remote input control (Commit 4) ─────────────────────────────────────────
  // Resolve the admin's display name once so the agent banner can name who is
  // connected.
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const u = data?.user;
      const name =
        (u?.user_metadata?.full_name as string) ||
        (u?.user_metadata?.name as string) ||
        u?.email ||
        "IT Admin";
      setAdminName(name);
      adminNameRef.current = name;
    });
  }, []);

  // Map a viewport mouse event to normalized [0,1] image coordinates, accounting
  // for the canvas's object-contain letterboxing so clicks land where the admin
  // points regardless of aspect-ratio mismatch.
  const toNorm = useCallback((e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    const r = resRef.current;
    if (!canvas || !r) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const scale = Math.min(rect.width / r.w, rect.height / r.h);
    const dispW = r.w * scale, dispH = r.h * scale;
    const offX = (rect.width - dispW) / 2, offY = (rect.height - dispH) / 2;
    const lx = e.clientX - rect.left - offX, ly = e.clientY - rect.top - offY;
    if (lx < 0 || ly < 0 || lx > dispW || ly > dispH) return null;
    return { x: Math.min(1, Math.max(0, lx / dispW)), y: Math.min(1, Math.max(0, ly / dispH)) };
  }, []);

  const sendInput = useCallback((payload: Record<string, unknown>) => {
    const ch = channelRef.current;
    if (ch && controllingRef.current) void ch.send({ type: "broadcast", event: "input", payload });
  }, []);

  const onSurfaceMouseMove = useCallback((e: React.MouseEvent) => {
    if (!controllingRef.current) return;
    const now = performance.now();
    if (now - lastMoveRef.current < 40) return;   // ~25 Hz move throttle
    lastMoveRef.current = now;
    const n = toNorm(e);
    if (n) sendInput({ kind: "mouse", action: "move", x: n.x, y: n.y });
  }, [toNorm, sendInput]);

  const onSurfaceMouseBtn = useCallback((e: React.MouseEvent, down: boolean) => {
    if (!controllingRef.current) return;
    const n = toNorm(e);
    if (!n) return;
    e.preventDefault();
    const button = e.button === 2 ? "right" : e.button === 1 ? "middle" : "left";
    sendInput({ kind: "mouse", action: down ? "down" : "up", button, x: n.x, y: n.y });
  }, [toNorm, sendInput]);

  // Take / release control: flip the local gate, tell the agent (banner + its own
  // gate), and write an input-enabled / input-disabled audit row.
  const setControl = useCallback(async (on: boolean) => {
    if (on && endedRef.current) return;
    controllingRef.current = on;
    setControlling(on);
    if (on) surfaceRef.current?.focus();
    const ch = channelRef.current;
    if (ch) {
      try {
        await ch.send({
          type: "broadcast", event: "control",
          payload: { enabled: on, by: adminNameRef.current, at: Date.now() },
        });
      } catch { /* best effort */ }
    }
    try {
      await supabase.rpc("log_remote_input_state", { p_session_id: sessionId, p_enabled: on });
    } catch { /* best effort */ }
  }, [sessionId]);

  // Keyboard + wheel need preventDefault, so bind them natively (and only while
  // controlling). Printable keys with no Ctrl/Alt/Meta are sent as `type` text;
  // everything else (named keys, modifiers, combos) is sent as key down/up so
  // Ctrl/Alt/Shift combinations reproduce faithfully on the agent.
  useEffect(() => {
    if (!controlling) return;
    const surface = surfaceRef.current;
    const send = (payload: Record<string, unknown>) => {
      const ch = channelRef.current;
      if (ch) void ch.send({ type: "broadcast", event: "input", payload });
    };
    const isTypePath = (e: KeyboardEvent) =>
      e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!controllingRef.current) return;
      e.preventDefault();
      if (isTypePath(e)) send({ kind: "key", action: "type", text: e.key });
      else send({ kind: "key", action: "down", key: e.key });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!controllingRef.current) return;
      e.preventDefault();
      if (!isTypePath(e)) send({ kind: "key", action: "up", key: e.key });
    };
    const onWheel = (e: WheelEvent) => {
      if (!controllingRef.current) return;
      e.preventDefault();
      const notch = (v: number) =>
        v === 0 ? 0 : Math.max(-5, Math.min(5, Math.abs(v) >= 100 ? Math.round(v / 100) : Math.sign(v)));
      const n = toNorm(e);
      send({ kind: "mouse", action: "wheel", dx: notch(e.deltaX), dy: notch(e.deltaY), ...(n ? { x: n.x, y: n.y } : {}) });
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    surface?.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      surface?.removeEventListener("wheel", onWheel);
    };
  }, [controlling, toNorm]);

  const connectionLabel: Record<Phase, string> = {
    issuing:   "Authorizing…",
    joining:   "Joining channel…",
    waiting:   "Waiting for agent…",
    streaming: "Connected",
    ended:     "Session ended",
    error:     "Error",
  };

  const dotTone =
    phase === "streaming" ? "bg-emerald-500"
    : phase === "error" || phase === "ended" ? "bg-red-500"
    : "bg-amber-500";

  return (
    <div ref={wrapRef} className="flex h-screen w-screen flex-col bg-slate-950 text-slate-100">
      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-2">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate("/assets")}
            className="flex items-center gap-1 text-slate-400 hover:text-slate-100 transition-colors"
            title="Back to assets"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn("relative flex h-2.5 w-2.5", phase === "streaming" && "animate-none")}>
              {phase === "waiting" && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75 animate-ping" />
              )}
              <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", dotTone)} />
            </span>
            <span className="text-sm font-semibold truncate">{connectionLabel[phase]}</span>
            {agentName && (
              <span className="text-xs text-slate-400 truncate hidden sm:inline">· {agentName}</span>
            )}
          </div>
        </div>

        {/* Live stats */}
        <div className="hidden md:flex items-center gap-4">
          <Stat icon={Monitor} label="res" value={res ? `${res.w}×${res.h}` : "—"} />
          <Stat icon={Gauge} label="fps" value={`${fps}`} tone={fps > 0 ? "text-emerald-400" : "text-slate-500"} />
          <Stat icon={Gauge} label="avg" value={`${avgFps}`} />
          <Stat icon={Wifi} label="latency" value={latencyMs !== null ? `${latencyMs} ms` : "—"} />
          <Stat icon={ArrowDownToLine} label="bw" value={`${kbps} KB/s`} />
          <Stat icon={Clock} label="time" value={fmtDuration(durationSec)} />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => void setControl(!controlling)}
            disabled={phase !== "streaming" && !controlling}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
              controlling
                ? "bg-amber-500 text-slate-950 hover:bg-amber-400"
                : "bg-slate-700 text-slate-100 hover:bg-slate-600",
            )}
            title={controlling ? "Release mouse & keyboard control" : "Take mouse & keyboard control"}
            data-testid="button-toggle-control"
          >
            {controlling ? <MousePointerClick className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {controlling ? "Controlling" : "Take control"}
          </button>
          <button
            onClick={toggleFs}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
            title={isFs ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFs ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            onClick={() => void disconnect()}
            disabled={disconnecting || phase === "ended"}
            className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
            data-testid="button-viewer-disconnect"
          >
            {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
            Disconnect
          </button>
        </div>
      </div>

      {/* Compact stats for small screens */}
      <div className="md:hidden flex items-center gap-4 overflow-x-auto border-b border-slate-800 bg-slate-900/50 px-4 py-1.5">
        <Stat icon={Monitor} label="res" value={res ? `${res.w}×${res.h}` : "—"} />
        <Stat icon={Gauge} label="fps" value={`${fps}`} />
        <Stat icon={Wifi} label="lat" value={latencyMs !== null ? `${latencyMs}ms` : "—"} />
        <Stat icon={ArrowDownToLine} label="bw" value={`${kbps}KB/s`} />
        <Stat icon={Clock} label="time" value={fmtDuration(durationSec)} />
      </div>

      {/* ── Screen surface ────────────────────────────────────────────────── */}
      <div
        ref={surfaceRef}
        tabIndex={0}
        onMouseMove={onSurfaceMouseMove}
        onMouseDown={(e) => onSurfaceMouseBtn(e, true)}
        onMouseUp={(e) => onSurfaceMouseBtn(e, false)}
        onContextMenu={(e) => { if (controllingRef.current) e.preventDefault(); }}
        className={cn(
          "relative flex-1 overflow-hidden bg-black outline-none",
          controlling && "cursor-crosshair",
        )}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full object-contain"
          style={{ imageRendering: "auto" }}
          data-testid="canvas-remote-screen"
        />

        {/* Overlays */}
        {(phase === "issuing" || phase === "joining" || phase === "waiting") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60">
            <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
            <p className="text-sm text-slate-300">{connectionLabel[phase]}</p>
            {phase === "waiting" && (
              <p className="text-xs text-slate-500">The agent is connecting and will begin streaming shortly.</p>
            )}
          </div>
        )}

        {phase === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
            <AlertTriangle className="h-9 w-9 text-red-500" />
            <p className="text-sm font-medium text-red-300">{error ?? "Something went wrong."}</p>
            <button
              onClick={() => navigate("/assets")}
              className="mt-2 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Back to assets
            </button>
          </div>
        )}

        {phase === "ended" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-6 text-center">
            <MonitorOff className="h-9 w-9 text-slate-400" />
            <p className="text-sm font-medium text-slate-200">The remote session has ended.</p>
            <button
              onClick={() => navigate("/assets")}
              className="mt-2 rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Back to assets
            </button>
          </div>
        )}

        {/* Control-state watermark */}
        <div className={cn(
          "pointer-events-none absolute bottom-3 right-3 flex items-center gap-1 rounded px-2 py-1 text-[10px] uppercase tracking-wide",
          controlling ? "bg-amber-500/90 text-slate-950 font-semibold" : "bg-black/50 text-slate-400",
        )}>
          {controlling ? <MousePointerClick className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {controlling ? `Controlling · ${adminName}` : "View only"}
        </div>
      </div>
    </div>
  );
}
