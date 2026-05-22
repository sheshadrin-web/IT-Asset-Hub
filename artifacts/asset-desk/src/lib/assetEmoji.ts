export const ASSET_TYPE_EMOJI: Record<string, string> = {
  Laptop:  "💻",
  Desktop: "🖥️",
  Mobile:  "📱",
  Tab:     "📲",
  Tablet:  "📲",
  Monitor: "🖥",
  Printer: "🖨️",
  Server:  "🗄️",
};

export function getAssetEmoji(type?: string | null): string {
  if (!type) return "📦";
  return ASSET_TYPE_EMOJI[type] ?? "📦";
}
