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

export const FIELD_EMOJI: Record<string, string> = {
  "Asset ID":         "🆔",
  "Type":             "🏷️",
  "Brand":            "🏭",
  "Model":            "📦",
  "Serial Number":    "🔢",
  "Product Number":   "🔖",
  "Processor":        "🧠",
  "CPU":              "🧠",
  "RAM":              "🧮",
  "Storage":          "💽",
  "Operating System": "🪟",
  "IMEI 1":           "📡",
  "IMEI 2":           "📡",
  "SIM Number":       "📶",
  "Phone Number":     "☎️",
  "Monitor Brand":    "🖥",
  "Monitor Model":    "🖥",
  "Monitor Size":     "📏",
  "Keyboard":         "⌨️",
  "Mouse":            "🖱️",
  "Purchase Date":    "📅",
  "Location":         "📍",
  "Vendor":           "🏢",
  "Invoice No.":      "🧾",
  "Accessories":      "🧰",
  "Others":           "✨",
  "Remarks":          "📝",
  "Warranty":         "🛡️",
  "Purchased":        "🛒",
  "Expires":          "⏳",
};

export function getFieldEmoji(label?: string | null): string {
  if (!label) return "•";
  return FIELD_EMOJI[label] ?? "•";
}
