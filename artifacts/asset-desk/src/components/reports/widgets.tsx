import { useId } from "react";
import {
  ResponsiveContainer, AreaChart, Area,
} from "recharts";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── Reusable analytics widgets for the Reports dashboard ─────────────────────

/** Tiny inline area chart used inside KPI cards. */
export function Sparkline({
  data, color, height = 44,
}: { data: number[]; color: string; height?: number }) {
  const rawId = useId();
  const gid = `spark-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  if (!data || data.length < 2) return <div style={{ height }} />;
  const series = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.32} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone" dataKey="v" stroke={color} strokeWidth={2}
          fill={`url(#${gid})`} dot={false} isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface TrendChip {
  value: string;
  direction: "up" | "down" | "flat";
}

function TrendBadge({ chip }: { chip: TrendChip }) {
  const Icon = chip.direction === "up" ? ArrowUpRight : chip.direction === "down" ? ArrowDownRight : Minus;
  const cls =
    chip.direction === "up"
      ? "text-emerald-600 bg-emerald-500/10"
      : chip.direction === "down"
      ? "text-red-600 bg-red-500/10"
      : "text-muted-foreground bg-muted";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", cls)}>
      <Icon className="h-3 w-3" />{chip.value}
    </span>
  );
}

/** Executive KPI card: icon, value, trend chip, and a sparkline or progress bar. */
export function KpiCard({
  icon: Icon, label, value, accent, chip, spark, progress, footer,
  "data-testid": testId,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  accent: string;
  chip?: TrendChip;
  spark?: number[];
  progress?: number;
  footer?: React.ReactNode;
  "data-testid"?: string;
}) {
  return (
    <Card className="premium-lift rounded-[20px] overflow-hidden" data-testid={testId}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <span
            className="inline-flex rounded-2xl p-2.5"
            style={{ backgroundColor: `${accent}1a`, color: accent }}
          >
            <Icon className="h-5 w-5" />
          </span>
          {chip && <TrendBadge chip={chip} />}
        </div>
        <div className="mt-4 text-3xl font-bold tracking-tight text-foreground">{value}</div>
        <div className="text-sm text-muted-foreground mt-0.5">{label}</div>

        {spark && spark.length > 1 ? (
          <div className="mt-3 -mx-1">
            <Sparkline data={spark} color={accent} />
          </div>
        ) : typeof progress === "number" ? (
          <div className="mt-4">
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%`, backgroundColor: accent }}
              />
            </div>
          </div>
        ) : null}

        {footer && <div className="mt-3 text-xs text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}

/** Card shell for charts with a title row + optional action slot. */
export function ChartContainer({
  title, subtitle, icon: Icon, accent = "hsl(var(--primary))", action, children, className,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  accent?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("rounded-[20px]", className)}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <span className="inline-flex rounded-xl p-2" style={{ backgroundColor: `${accent}1a`, color: accent }}>
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      <CardContent className="px-5 pb-5 pt-1">{children}</CardContent>
    </Card>
  );
}

/** Compact metric tile used in the ticket-analytics strip. */
export function MetricTile({
  icon: Icon, label, value, accent, hint,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  accent: string;
  hint?: string;
}) {
  return (
    <div className="glass-surface premium-lift rounded-2xl p-4 border border-card-border/70">
      <span className="inline-flex rounded-xl p-2" style={{ backgroundColor: `${accent}1a`, color: accent }}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="mt-3 text-2xl font-bold text-foreground leading-none">{value}</div>
      <div className="text-xs text-muted-foreground mt-1.5">{label}</div>
      {hint && <div className="text-[11px] text-muted-foreground/70 mt-0.5">{hint}</div>}
    </div>
  );
}

/** Horizontal progress indicator for asset-health breakdowns. */
export function HealthBar({
  label, value, total, color,
}: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">
          <span className="font-semibold text-foreground">{value}</span> · {pct}%
        </span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

/** Insight row used in the Smart Insights / AI panel. */
export function InsightCard({
  icon: Icon, tone, title, text,
}: {
  icon: React.ElementType;
  tone: "blue" | "green" | "amber" | "purple" | "red";
  title: string;
  text: string;
}) {
  const tones: Record<string, string> = {
    blue: "#2563EB",
    green: "#22C55E",
    amber: "#F59E0B",
    purple: "#8B5CF6",
    red: "#EF4444",
  };
  const c = tones[tone];
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-card-border/70 bg-card/60 p-3.5 premium-lift">
      <span className="inline-flex rounded-xl p-2 flex-shrink-0" style={{ backgroundColor: `${c}1a`, color: c }}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground leading-tight">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{text}</p>
      </div>
    </div>
  );
}

/** Leaderboard card for the reporting-structure section. */
export function LeaderboardCard({
  rank, name, subtitle, teamSize, directReports, activityScore,
}: {
  rank: number;
  name: string;
  subtitle: string;
  teamSize: number;
  directReports: number;
  activityScore: number;
}) {
  const rankColor =
    rank === 1 ? "#F59E0B" : rank === 2 ? "#94A3B8" : rank === 3 ? "#B45309" : "#CBD5E1";
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="rounded-2xl border border-card-border/70 bg-card/60 p-4 premium-lift">
      <div className="flex items-center gap-3">
        <span
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
          style={{ backgroundColor: rankColor }}
        >
          {rank}
        </span>
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{name}</p>
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-muted/60 py-2">
          <p className="text-sm font-bold text-foreground leading-none">{teamSize}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">Team</p>
        </div>
        <div className="rounded-xl bg-muted/60 py-2">
          <p className="text-sm font-bold text-foreground leading-none">{directReports}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">Reports</p>
        </div>
        <div className="rounded-xl bg-muted/60 py-2">
          <p className="text-sm font-bold leading-none" style={{ color: activityScore >= 60 ? "#22C55E" : activityScore >= 30 ? "#F59E0B" : "#EF4444" }}>
            {activityScore}%
          </p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">Active</p>
        </div>
      </div>
    </div>
  );
}
