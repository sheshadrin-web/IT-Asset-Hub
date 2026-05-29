// Shared device-health / online helpers for managed laptops.
//
// HONESTY: the agent only reports `status`, `last_seen_at`, `is_managed`,
// `uptime_seconds` and friends. It does NOT report live disk-free% or RAM-used%,
// so health is computed ONLY from real signals (agent online + recent check-in).
// Disk/RAM are surfaced as "Not reported" — never faked as healthy.

export const ONLINE_WINDOW_MIN = 15;

export interface DeviceLike {
  status?: string | null;
  is_managed?: boolean | null;
  last_seen_at?: string | null;
  agent_removed_at?: string | null;
  uptime_seconds?: number | null;
}

export function minutesSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 60000;
}

export function isAgentRemoved(d?: DeviceLike | null): boolean {
  return !!d?.agent_removed_at;
}

/** A device is "managed" when an agent row exists, is_managed isn't false, and it hasn't been removed. */
export function isManaged(d?: DeviceLike | null): boolean {
  return !!d && d.is_managed !== false && !isAgentRemoved(d);
}

/** Online = managed AND checked in within the online window. We trust last_seen freshness over a possibly-stale status flag. */
export function isOnline(d?: DeviceLike | null): boolean {
  if (!isManaged(d)) return false;
  const m = minutesSince(d!.last_seen_at);
  return m !== null && m <= ONLINE_WINDOW_MIN;
}

export type HealthLevel = "healthy" | "warning" | "critical" | "unknown";

export interface HealthCheck {
  label: string;
  state: "pass" | "fail" | "unknown";
  detail: string;
}

export interface DeviceHealth {
  level: HealthLevel;
  label: string;
  checks: HealthCheck[];
  /** 0–100 over the *known* checks, or -1 when nothing can be measured. */
  score: number;
}

export function computeDeviceHealth(d?: DeviceLike | null): DeviceHealth {
  if (!d || isAgentRemoved(d)) {
    return {
      level: "unknown",
      label: "Not monitored",
      checks: [
        { label: "Agent", state: "unknown", detail: d ? "Agent removed" : "No agent installed" },
      ],
      score: -1,
    };
  }

  const mins = minutesSince(d.last_seen_at);
  const agentOnline: HealthCheck = {
    label: "Agent online",
    state: isOnline(d) ? "pass" : "fail",
    detail: isOnline(d) ? "Reporting in" : `Status: ${d.status ?? "unknown"}`,
  };
  const recent: HealthCheck = {
    label: `Check-in < ${ONLINE_WINDOW_MIN}m`,
    state: mins === null ? "fail" : mins <= ONLINE_WINDOW_MIN ? "pass" : "fail",
    detail: mins === null ? "Never checked in" : formatRelative(mins),
  };
  // Not collected by the agent — shown honestly as unknown, excluded from scoring.
  const disk: HealthCheck = { label: "Disk space", state: "unknown", detail: "Not reported" };
  const ram: HealthCheck = { label: "Memory usage", state: "unknown", detail: "Not reported" };

  const known = [agentOnline, recent];
  const passes = known.filter((c) => c.state === "pass").length;
  const score = Math.round((passes / known.length) * 100);

  let level: HealthLevel;
  if (passes === known.length) level = "healthy";
  else if (passes === 0) level = "critical";
  else level = "warning";

  const label = level === "healthy" ? "Healthy" : level === "warning" ? "Needs attention" : "Critical";

  return { level, label, checks: [agentOnline, recent, disk, ram], score };
}

function formatRelative(mins: number): string {
  if (mins < 1) return "Just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const h = mins / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const days = h / 24;
  return `${Math.round(days)}d ago`;
}

export function formatRelativeFromIso(iso?: string | null): string {
  const m = minutesSince(iso);
  if (m === null) return "Never";
  return formatRelative(m);
}

export function formatUptime(seconds?: number | null): string {
  if (seconds == null || Number.isNaN(seconds) || seconds <= 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
