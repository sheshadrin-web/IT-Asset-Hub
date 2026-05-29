import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  User, Activity, Clock, Wifi, ShieldCheck, BadgeCheck,
  AlertTriangle, MinusCircle,
} from "lucide-react";
import {
  computeDeviceHealth, formatUptime, formatRelativeFromIso, isOnline,
  type DeviceLike, type HealthLevel,
} from "@/lib/deviceHealth";

export interface KpiAsset {
  assetType: string;
  assignedTo?: string;
  department?: string;
  acknowledged?: boolean;
  status: string;
  warrantyEndDate?: string;
}

type Tone = "good" | "warn" | "bad" | "muted";

const TONE_RING: Record<Tone, string> = {
  good: "bg-emerald-500/10 text-emerald-600",
  warn: "bg-amber-500/10 text-amber-600",
  bad:  "bg-red-500/10 text-red-600",
  muted:"bg-muted text-muted-foreground",
};

function KpiCard({
  Icon, label, value, sub, tone = "muted", badge,
}: {
  Icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  badge?: { text: string; tone: Tone };
}) {
  return (
    <Card className="p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", TONE_RING[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        {badge && (
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", TONE_RING[badge.tone])}>
            {badge.text}
          </span>
        )}
      </div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-lg font-bold text-foreground leading-tight truncate" title={value}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground truncate" title={sub}>{sub}</p>}
      </div>
    </Card>
  );
}

function warrantyInfo(end?: string): { value: string; sub: string; tone: Tone; ok: boolean } {
  if (!end) return { value: "Not set", sub: "No warranty date", tone: "muted", ok: false };
  const t = new Date(end).getTime();
  if (Number.isNaN(t)) return { value: "Not set", sub: "No warranty date", tone: "muted", ok: false };
  const days = Math.ceil((t - Date.now()) / 86_400_000);
  const until = new Date(end).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  if (days < 0) return { value: "Expired", sub: `${Math.abs(days)}d ago · ${until}`, tone: "bad", ok: false };
  if (days <= 30) return { value: `${days}d left`, sub: `Expiring soon · ${until}`, tone: "warn", ok: true };
  return { value: `${days}d left`, sub: `Until ${until}`, tone: "good", ok: true };
}

const HEALTH_TONE: Record<HealthLevel, Tone> = {
  healthy: "good", warning: "warn", critical: "bad", unknown: "muted",
};
const HEALTH_ICON: Record<HealthLevel, React.ElementType> = {
  healthy: ShieldCheck, warning: AlertTriangle, critical: AlertTriangle, unknown: MinusCircle,
};

export default function AssetKpiCards({
  asset, device,
}: {
  asset: KpiAsset;
  device: (DeviceLike & Record<string, unknown>) | null;
}) {
  const isLaptop = asset.assetType === "Laptop";

  // ── Assigned user ──
  const assigned = asset.status === "Assigned" && asset.assignedTo;
  const userCard = (
    <KpiCard
      Icon={User}
      label="Assigned User"
      value={assigned ? asset.assignedTo! : "Unassigned"}
      sub={assigned ? (asset.department ?? "—") : asset.status}
      tone={assigned ? "good" : "muted"}
      badge={assigned ? { text: asset.acknowledged ? "Acknowledged" : "Pending ack", tone: asset.acknowledged ? "good" : "warn" } : undefined}
    />
  );

  // ── Warranty ──
  const w = warrantyInfo(asset.warrantyEndDate);
  const warrantyCard = (
    <KpiCard Icon={BadgeCheck} label="Warranty" value={w.value} sub={w.sub} tone={w.tone} />
  );

  // ── Compliance (derived from real checks only) ──
  const checks: { label: string; ok: boolean }[] = [];
  if (asset.status === "Assigned") checks.push({ label: "Assignment acknowledged", ok: !!asset.acknowledged });
  checks.push({ label: "Warranty valid", ok: w.ok });
  if (isLaptop) {
    checks.push({ label: "Agent managed & online", ok: isOnline(device) });
  }
  const passed = checks.filter((c) => c.ok).length;
  const allOk = passed === checks.length;
  const complianceCard = (
    <KpiCard
      Icon={allOk ? ShieldCheck : AlertTriangle}
      label="Compliance"
      value={allOk ? "Compliant" : "Issues"}
      sub={`${passed}/${checks.length} checks passed`}
      tone={allOk ? "good" : passed === 0 ? "bad" : "warn"}
      badge={{ text: `${passed}/${checks.length}`, tone: allOk ? "good" : "warn" }}
    />
  );

  if (!isLaptop) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {userCard}{warrantyCard}{complianceCard}
      </div>
    );
  }

  // ── Laptop-only device KPIs ──
  const health = computeDeviceHealth(device);
  const online = isOnline(device);
  const uptime = formatUptime(device?.uptime_seconds as number | null | undefined);
  const lastSeen = formatRelativeFromIso((device?.last_seen_at as string | null | undefined) ?? null);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {userCard}
      <KpiCard
        Icon={HEALTH_ICON[health.level]}
        label="Device Health"
        value={health.label}
        sub={health.score >= 0 ? `${health.score}% of monitored checks` : "No agent data"}
        tone={HEALTH_TONE[health.level]}
        badge={{ text: online ? "Online" : "Offline", tone: online ? "good" : "muted" }}
      />
      <KpiCard
        Icon={Activity}
        label="Uptime"
        value={uptime}
        sub={uptime === "—" ? "Not reported" : "Since last restart"}
        tone="muted"
      />
      <KpiCard
        Icon={online ? Wifi : Clock}
        label="Last Seen"
        value={lastSeen}
        sub={online ? "Online now" : device ? "No recent check-in" : "No agent installed"}
        tone={online ? "good" : "muted"}
      />
      {warrantyCard}
      {complianceCard}
    </div>
  );
}
