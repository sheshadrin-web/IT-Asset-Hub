import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Loader2, CheckCircle2, AlertTriangle, Wifi, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Commit-2 transport spike (UI half).
 *
 * Proves the bidirectional remote-desktop transport works end to end BEFORE any
 * screen capture or input is built:
 *   1. Issues a per-session token + channel via `issue_remote_session_token`.
 *   2. Joins the per-session Supabase Realtime broadcast channel.
 *   3. Sends `ping` and waits for the agent's `pong`, measuring round-trip time.
 *
 * No screen pixels, no mouse/keyboard — just connectivity. Fully self-contained:
 * it mounts only for an approved/active session and tears its channel down on
 * unmount, so it never touches the Agent Key or More Controls flows.
 */
type Phase = "issuing" | "joining" | "waiting" | "ok" | "error";

const PING_INTERVAL_MS = 3000;

export default function RemoteTransportTest({ sessionId }: { sessionId: string }) {
  const [phase,     setPhase]     = useState<Phase>("issuing");
  const [error,     setError]     = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [pongCount, setPongCount] = useState(0);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pingTimer  = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      // 1. Mint the session token + derive the channel name.
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

      // 2. Join the per-session broadcast channel (self:false so we never hear
      //    our own ping echoed back).
      const channel = supabase.channel(channelName, {
        config: { broadcast: { self: false } },
      });
      channelRef.current = channel;

      channel.on("broadcast", { event: "pong" }, (msg) => {
        const p = (msg.payload ?? {}) as { nonce?: string; ts?: number; agent?: string };
        if (typeof p.ts === "number") {
          setLatencyMs(Math.max(0, Math.round(performance.now() - p.ts)));
        }
        if (p.agent) setAgentName(p.agent);
        setPongCount((c) => c + 1);
        setPhase("ok");
      });

      // 3. Once subscribed, ping immediately and keep pinging (the agent may
      //    join a few seconds later — each ping it answers refreshes latency).
      channel.subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setPhase((cur) => (cur === "ok" ? cur : "waiting"));
          const sendPing = () => {
            void channel.send({
              type: "broadcast",
              event: "ping",
              payload: { nonce: crypto.randomUUID(), ts: performance.now() },
            });
          };
          sendPing();
          pingTimer.current = window.setInterval(sendPing, PING_INTERVAL_MS);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError("Realtime channel error — could not join.");
          setPhase("error");
        }
      });
    }

    void start();

    return () => {
      cancelled = true;
      if (pingTimer.current) window.clearInterval(pingTimer.current);
      if (channelRef.current) void supabase.removeChannel(channelRef.current);
    };
  }, [sessionId]);

  const steps: { key: Phase; label: string; done: boolean; active: boolean }[] = [
    {
      key: "issuing",
      label: "Session token issued",
      done: phase !== "issuing" && phase !== "error",
      active: phase === "issuing",
    },
    {
      key: "joining",
      label: "Realtime channel joined",
      done: phase === "waiting" || phase === "ok",
      active: phase === "joining",
    },
    {
      key: "waiting",
      label:
        phase === "ok"
          ? `Agent responded${agentName ? ` — ${agentName}` : ""}`
          : "Waiting for agent to respond…",
      done: phase === "ok",
      active: phase === "waiting",
    },
  ];

  return (
    <div className="rounded-md border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
        <Radio className="h-3.5 w-3.5" />
        Transport check
      </div>

      {phase === "error" ? (
        <div className="flex items-start gap-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : (
        <ul className="space-y-1">
          {steps.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-xs">
              {s.done ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              ) : s.active ? (
                <Loader2 className="h-3.5 w-3.5 text-indigo-600 animate-spin shrink-0" />
              ) : (
                <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/30" />
              )}
              <span className={cn(s.done ? "text-foreground" : "text-muted-foreground")}>
                {s.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {phase === "ok" && (
        <div className="flex items-center gap-3 pt-0.5 text-[11px] text-emerald-700">
          <span className="flex items-center gap-1 font-medium">
            <Wifi className="h-3.5 w-3.5" />
            Round-trip OK
          </span>
          {latencyMs !== null && <span>~{latencyMs} ms</span>}
          <span className="text-muted-foreground">{pongCount} pong{pongCount === 1 ? "" : "s"}</span>
        </div>
      )}
    </div>
  );
}
