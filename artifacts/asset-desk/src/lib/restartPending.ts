// "Devices Pending Restart" dashboard logic.
//
// Reuses the same real signals shown on the asset-detail Device Agent panel
// (managed_devices.uptime_seconds / last_boot_at / last_seen_at) and the same
// online + manager helpers used elsewhere — no duplicated or faked logic. A
// device is "pending restart" only when its agent is active (managed, not
// removed) and it has been up longer than the configurable threshold.

import { Asset, Profile } from "@/data/mockData";
import { formatUptime, isManaged, isOnline } from "@/lib/deviceHealth";
import { managerDisplayName } from "@/lib/reportingManager";

const SECONDS_PER_DAY = 86400;

// Default: surface laptops up for more than 5 days. Adjustable in the UI.
export const RESTART_PENDING_DEFAULT_DAYS = 5;
export const RESTART_THRESHOLD_OPTIONS = [3, 5, 7, 14, 30];

// Matches the asset-detail card: a device up for over a day should reboot to
// apply updates and clear memory leaks.
const RESTART_RECOMMENDED_SECONDS = SECONDS_PER_DAY;

// The subset of managed_devices columns the dashboard reads.
export interface ManagedDeviceRow {
  id:                 string;
  laptop_asset_id:    string | null;
  hostname:           string | null;
  logged_in_username: string | null;
  employee_email:     string | null;
  status:             string | null;
  is_managed:         boolean | null;
  agent_removed_at:   string | null;
  last_seen_at:       string | null;
  uptime_seconds:     number | null;
  last_boot_at:       string | null;
  os_name:            string | null;
}

export interface RestartPendingDevice {
  /** Asset UUID (managed_devices.laptop_asset_id) — used by the restart RPC. */
  assetUuid:          string | null;
  assetTag:           string;
  hostname:           string;
  employeeName:       string;
  signedInUser:       string;
  department:         string;
  managerName:        string;
  lastRestart:        string | null;
  uptimeSeconds:      number;
  uptimeDisplay:      string;
  lastSeen:           string | null;
  deviceStatus:       "Online" | "Offline";
  restartRecommended: boolean;
}

/**
 * Build the sorted (highest uptime first) list of devices whose agent is active
 * and whose uptime exceeds `thresholdDays`. Devices whose linked asset is a
 * known non-laptop are excluded; devices with no resolvable asset are kept so
 * agent-only machines still surface.
 */
export function computeRestartPending(
  devices: ManagedDeviceRow[],
  assets: Asset[],
  users: Profile[],
  thresholdDays: number,
): RestartPendingDevice[] {
  const thresholdSeconds = Math.max(0, thresholdDays) * SECONDS_PER_DAY;
  const assetByUuid = new Map(assets.map((a) => [String(a.id), a]));
  const userByEmail = new Map(users.map((u) => [u.email.trim().toLowerCase(), u]));

  const rows: RestartPendingDevice[] = [];
  for (const d of devices) {
    // Agent must be installed/active (managed and not removed).
    if (!isManaged(d)) continue;

    const uptime = d.uptime_seconds ?? 0;
    if (uptime <= thresholdSeconds) continue;

    const asset = d.laptop_asset_id ? assetByUuid.get(String(d.laptop_asset_id)) : undefined;
    // Only laptops — but skip the filter when the asset (and thus its type) is
    // unknown so we never silently drop a reporting agent.
    if (asset && asset.assetType !== "Laptop") continue;

    const email = (asset?.assignedEmail ?? d.employee_email ?? "").trim().toLowerCase();
    const user = email ? userByEmail.get(email) : undefined;

    rows.push({
      assetUuid:          d.laptop_asset_id ?? null,
      assetTag:           asset?.assetId ?? "—",
      hostname:           d.hostname ?? "—",
      employeeName:       asset?.assignedTo ?? d.logged_in_username ?? "—",
      signedInUser:       d.logged_in_username ?? "—",
      department:         asset?.department ?? user?.department ?? "—",
      managerName:        user ? managerDisplayName(user.reporting_manager, users) : "—",
      lastRestart:        d.last_boot_at ?? null,
      uptimeSeconds:      uptime,
      uptimeDisplay:      formatUptime(uptime),
      lastSeen:           d.last_seen_at ?? null,
      deviceStatus:       isOnline(d) ? "Online" : "Offline",
      restartRecommended: uptime > RESTART_RECOMMENDED_SECONDS,
    });
  }

  rows.sort((a, b) => b.uptimeSeconds - a.uptimeSeconds);
  return rows;
}
