// ─── Asset type emoji & categories ────────────────────────────────────────────
// Single source of truth for asset type emojis and category groupings.
// Used in selectors, filters, table cells, detail headers, etc.

export const ASSET_TYPE_EMOJI: Record<string, string> = {
  // Main Devices
  Laptop:           "💻",
  Desktop:          "🖥️",
  Monitor:          "🖥",
  Mobile:           "📱",
  Tab:              "📲",
  Tablet:           "📲",
  Camera:           "📷",
  CPU:              "🧠",
  "Generic Asset":  "📦",
  // Accessories
  Keyboard:         "⌨️",
  Mouse:            "🖱️",
  Headset:          "🎧",
  "Hard Disk":      "💾",
  Speaker:          "🔊",
  "Docking Station":"🧰",
  // Fixed Assets
  Printer:          "🖨️",
  Router:           "📡",
  Server:           "🗄️",
  CCTV:             "📹",
  "Smart TV":       "📺",
  Projector:        "🎥",
  "Network Device": "📶",
  Firewall:         "🔒",
};

export function getAssetEmoji(type?: string | null): string {
  if (!type) return "📦";
  return ASSET_TYPE_EMOJI[type] ?? "📦";
}

// ─── Category groupings ───────────────────────────────────────────────────────
export const MAIN_DEVICE_TYPES = [
  "Laptop", "Desktop", "Monitor", "Mobile", "Tab", "Camera", "CPU", "Generic Asset",
] as const;

export const ACCESSORY_TYPES = [
  "Keyboard", "Mouse", "Headset", "Hard Disk", "Speaker", "Docking Station",
] as const;

export const FIXED_ASSET_TYPES = [
  "Printer", "Router", "Server", "CCTV", "Smart TV", "Projector", "Network Device", "Firewall",
] as const;

export const ALL_ASSET_TYPES = [
  ...MAIN_DEVICE_TYPES, ...ACCESSORY_TYPES, ...FIXED_ASSET_TYPES,
] as const;

export type AssetTypeName = typeof ALL_ASSET_TYPES[number];

export const ASSET_TYPE_CATEGORIES: { label: string; types: readonly string[] }[] = [
  { label: "Main Devices", types: MAIN_DEVICE_TYPES },
  { label: "Accessories",  types: ACCESSORY_TYPES   },
  { label: "Fixed Assets", types: FIXED_ASSET_TYPES },
];

// Field label emojis (kept for backwards-compat; currently unused in UI).
export const FIELD_EMOJI: Record<string, string> = {};
export function getFieldEmoji(label?: string | null): string {
  if (!label) return "•";
  return FIELD_EMOJI[label] ?? "•";
}
