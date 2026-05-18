import { useState, useEffect, useRef, useMemo } from "react";
import { Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Predefined options per device type ──────────────────────────────────────
const ACCESSORIES_BY_TYPE: Record<string, string[]> = {
  Laptop:  ["Charger", "Laptop Bag", "Mouse", "HDMI Cable", "LAN Adapter", "Docking Station", "Others"],
  Desktop: ["Keyboard", "Mouse", "Monitor Cable", "Power Cable", "LAN Adapter", "Headset", "Others"],
  Mobile:  ["Charger", "Cable", "Earphones", "Case", "Others"],
  Tab:     ["Charger", "Cable", "Case", "Stylus", "Others"],
};

const FALLBACK_ACCESSORIES = [
  "Charger", "Laptop Bag", "Mouse", "Keyboard", "HDMI Cable",
  "LAN Adapter", "Docking Station", "Headset", "Monitor Cable",
  "Power Cable", "Cable", "Earphones", "Case", "Stylus", "Others",
];

function getOptions(assetType: string): string[] {
  return ACCESSORIES_BY_TYPE[assetType] ?? FALLBACK_ACCESSORIES;
}

// ── Parse stored string → selected set + othersText ─────────────────────────
function parseAccessories(
  value: string,
  knownItems: string[],
): { selected: Set<string>; othersText: string } {
  const items = value.split(",").map(s => s.trim()).filter(Boolean);
  const selected = new Set<string>();
  const legacyParts: string[] = [];

  for (const item of items) {
    if (item.startsWith("Others:")) {
      selected.add("Others");
      const text = item.slice(7).trim();
      if (text) legacyParts.push(text);
    } else if (knownItems.includes(item)) {
      selected.add(item);
    } else if (item) {
      // Legacy free-text → fold into Others so it isn't lost
      selected.add("Others");
      legacyParts.push(item);
    }
  }

  return { selected, othersText: legacyParts.join(", ") };
}

// ── Build stored string from selected set + othersText ───────────────────────
function buildString(selected: Set<string>, othersText: string): string {
  const parts: string[] = [];
  for (const item of [...selected]) {
    if (item === "Others") {
      if (othersText.trim()) parts.push(`Others: ${othersText.trim()}`);
    } else {
      parts.push(item);
    }
  }
  return parts.join(", ");
}

// ── Component ────────────────────────────────────────────────────────────────
interface Props {
  assetType: string;
  value:     string;
  onChange:  (v: string) => void;
  disabled?: boolean;
}

export default function AccessoriesSelector({
  assetType, value, onChange, disabled,
}: Props) {
  const options    = useMemo(() => getOptions(assetType), [assetType]);
  const knownItems = useMemo(() => options.filter(o => o !== "Others"), [options]);

  const [selected,   setSelected]   = useState<Set<string>>(
    () => parseAccessories(value ?? "", knownItems).selected,
  );
  const [othersText, setOthersText] = useState<string>(
    () => parseAccessories(value ?? "", knownItems).othersText,
  );

  // When value changes externally (form reset), re-sync — but not when we
  // triggered the change ourselves (prevents cursor-position loss in Others).
  const ownChange = useRef(false);
  useEffect(() => {
    if (ownChange.current) { ownChange.current = false; return; }
    const { selected: ps, othersText: po } = parseAccessories(value ?? "", knownItems);
    setSelected(ps);
    setOthersText(po);
  }, [value, knownItems]);

  const emit = (nextSelected: Set<string>, nextOthers: string) => {
    ownChange.current = true;
    onChange(buildString(nextSelected, nextOthers));
  };

  const toggle = (opt: string) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(opt)) {
      next.delete(opt);
      const nextOthers = opt === "Others" ? "" : othersText;
      if (opt === "Others") setOthersText("");
      setSelected(next);
      emit(next, nextOthers);
    } else {
      next.add(opt);
      setSelected(next);
      emit(next, othersText);
    }
  };

  const handleOthersText = (text: string) => {
    setOthersText(text);
    emit(selected, text);
  };

  const activeChips = [...selected].filter(s => s !== "Others");
  const hasOthers   = selected.has("Others");
  const hasAnything = activeChips.length > 0 || (hasOthers && othersText.trim());

  return (
    <div className="space-y-3">
      {/* Pill buttons */}
      <div className="flex flex-wrap gap-2">
        {options.map(opt => {
          const active = selected.has(opt);
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              onClick={() => toggle(opt)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all select-none",
                active
                  ? opt === "Others"
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground hover:bg-primary/5",
                disabled && "opacity-50 cursor-not-allowed pointer-events-none",
              )}
            >
              {active && <Check className="h-3 w-3 flex-shrink-0" />}
              {opt}
            </button>
          );
        })}
      </div>

      {/* Others free-text input */}
      {hasOthers && (
        <Input
          value={othersText}
          onChange={e => handleOthersText(e.target.value)}
          placeholder="Enter other accessory details"
          disabled={disabled}
          className="text-sm"
        />
      )}

      {/* Selected chips summary */}
      {hasAnything && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {activeChips.map(chip => (
            <span
              key={chip}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium px-2.5 py-0.5"
            >
              {chip}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => toggle(chip)}
                  title={`Remove ${chip}`}
                  className="ml-0.5 hover:text-destructive transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
          {hasOthers && othersText.trim() && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-xs font-medium px-2.5 py-0.5">
              {othersText.trim()}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => toggle("Others")}
                  title="Remove Others"
                  className="ml-0.5 hover:text-destructive transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          )}
        </div>
      )}

      {!hasAnything && (
        <p className="text-xs text-muted-foreground italic">No accessories selected</p>
      )}
    </div>
  );
}
