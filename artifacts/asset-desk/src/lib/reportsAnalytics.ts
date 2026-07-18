import { Asset, Ticket, Profile } from "@/data/mockData";

// ── Real analytics derived from live asset / ticket / user data ──────────────
// Everything here is computed from actual records (purchase dates, ticket
// timestamps, user creation dates, statuses). No synthetic figures.

const DAY = 1000 * 60 * 60 * 24;

/** Service-level target used for SLA compliance + resolution scoring (days). */
export const SLA_TARGET_DAYS = 3;

export function parseDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export interface MonthBucket {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

/** Trailing `n` calendar-month buckets ending with the current month. */
export function lastNMonths(n: number, ref = new Date()): MonthBucket[] {
  const out: MonthBucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const first = new Date(ref.getFullYear(), ref.getMonth() - i, 1, 0, 0, 0, 0);
    const end = new Date(ref.getFullYear(), ref.getMonth() - i + 1, 0, 23, 59, 59, 999);
    out.push({
      key: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, "0")}`,
      label: first.toLocaleDateString("en-US", { month: "short" }),
      start: first,
      end,
    });
  }
  return out;
}

export interface GrowthPoint {
  label: string;
  total: number;
  added: number;
}

/** Cumulative asset count over time (by purchase date) + per-month additions. */
export function assetGrowthSeries(assets: Asset[], months = 12): GrowthPoint[] {
  const buckets = lastNMonths(months);
  const dated = assets
    .map((a) => parseDate(a.purchaseDate))
    .filter((d): d is Date => d !== null);
  const undated = assets.length - dated.length; // treat as pre-existing baseline
  return buckets.map((b) => {
    const added = dated.filter((d) => d >= b.start && d <= b.end).length;
    const total = undated + dated.filter((d) => d <= b.end).length;
    return { label: b.label, total, added };
  });
}

/** Cumulative registered-user count over time (by created_at). */
export function userGrowthSeries(users: Profile[], months = 12): { label: string; total: number }[] {
  const buckets = lastNMonths(months);
  const dated = users
    .map((u) => parseDate(u.created_at))
    .filter((d): d is Date => d !== null);
  const undated = users.length - dated.length;
  return buckets.map((b) => ({
    label: b.label,
    total: undated + dated.filter((d) => d <= b.end).length,
  }));
}

/** Tickets created and resolved per month. */
export function ticketTrendSeries(tickets: Ticket[], months = 12): { label: string; created: number; resolved: number }[] {
  const buckets = lastNMonths(months);
  return buckets.map((b) => {
    const created = tickets.filter((t) => {
      const d = parseDate(t.createdDate);
      return d && d >= b.start && d <= b.end;
    }).length;
    const resolved = tickets.filter((t) => {
      const d = parseDate(t.updatedDate);
      return (t.status === "Resolved" || t.status === "Closed") && d && d >= b.start && d <= b.end;
    }).length;
    return { label: b.label, created, resolved };
  });
}

/** Asset utilisation (% assigned) trend over time. */
export function utilizationSeries(assets: Asset[], months = 12): { label: string; pct: number }[] {
  const buckets = lastNMonths(months);
  const items = assets.map((a) => ({
    created: parseDate(a.purchaseDate),
    assigned: parseDate(a.assignedAt),
  }));
  return buckets.map((b) => {
    const existing = items.filter((i) => !i.created || i.created <= b.end);
    const total = existing.length;
    const assigned = existing.filter((i) => i.assigned && i.assigned <= b.end).length;
    return { label: b.label, pct: total > 0 ? Math.round((assigned / total) * 100) : 0 };
  });
}

export interface TicketMetrics {
  open: number;
  assigned: number;
  inProgress: number;
  waiting: number;
  resolved: number;
  closed: number;
  total: number;
  avgResolutionDays: number | null;
  slaCompliancePct: number | null;
}

export function ticketMetrics(tickets: Ticket[]): TicketMetrics {
  const count = (s: Ticket["status"]) => tickets.filter((t) => t.status === s).length;
  const done = tickets.filter((t) => t.status === "Resolved" || t.status === "Closed");
  const durations = done
    .map((t) => {
      const c = parseDate(t.createdDate);
      const u = parseDate(t.updatedDate);
      return c && u && u >= c ? (u.getTime() - c.getTime()) / DAY : null;
    })
    .filter((x): x is number => x !== null);
  const avgResolutionDays = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : null;
  const withinSla = durations.filter((d) => d <= SLA_TARGET_DAYS).length;
  const slaCompliancePct = durations.length ? Math.round((withinSla / durations.length) * 100) : null;
  return {
    open: count("Open"),
    assigned: count("Assigned"),
    inProgress: count("In Progress"),
    waiting: count("Waiting for User"),
    resolved: count("Resolved"),
    closed: count("Closed"),
    total: tickets.length,
    avgResolutionDays,
    slaCompliancePct,
  };
}

export interface AssetHealth {
  total: number;
  assigned: number;
  available: number;
  maintenance: number;
  retired: number;
}

export function assetHealth(assets: Asset[]): AssetHealth {
  const count = (s: Asset["status"]) => assets.filter((a) => a.status === s).length;
  return {
    total: assets.length,
    assigned: count("Assigned"),
    available: count("Available"),
    maintenance: count("Under Repair"),
    retired: count("Retired"),
  };
}

export function utilizationPct(assets: Asset[]): number {
  const total = assets.length;
  return total ? Math.round((assets.filter((a) => a.status === "Assigned").length / total) * 100) : 0;
}

export function assetTypeCounts(assets: Asset[]): { type: string; count: number }[] {
  const m = new Map<string, number>();
  assets.forEach((a) => m.set(a.assetType, (m.get(a.assetType) ?? 0) + 1));
  return [...m.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

export function departmentUsage(assets: Asset[], topN = 6): { name: string; count: number }[] {
  const m = new Map<string, number>();
  assets.forEach((a) => {
    const d = (a.department || "Unassigned").trim() || "Unassigned";
    m.set(d, (m.get(d) ?? 0) + 1);
  });
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

/** Net new count in the latest month vs. the previous month, for trend chips. */
export function latestDelta(series: { added?: number; total?: number }[]): number {
  if (series.length < 2) return 0;
  const last = series[series.length - 1];
  if (typeof last.added === "number") return last.added;
  const prev = series[series.length - 2];
  return (last.total ?? 0) - (prev.total ?? 0);
}
