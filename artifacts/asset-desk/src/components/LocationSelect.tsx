import { useState, useEffect, useRef } from "react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { LOCATION_OPTIONS } from "@/lib/locationOptions";

interface Props {
  value:        string;
  onChange:     (v: string) => void;
  disabled?:    boolean;
  placeholder?: string;
}

function isKnownLocation(v: string): boolean {
  return (LOCATION_OPTIONS as readonly string[]).includes(v);
}

export default function LocationSelect({
  value,
  onChange,
  disabled,
  placeholder = "Select location",
}: Props) {
  // ── Local state ───────────────────────────────────────────────────────────
  // isOthersMode: true when user explicitly chose "Others".
  // We CANNOT derive this purely from `value` because selecting Others sets
  // value="" (empty) and value="" would re-derive to "not Others".
  const [isOthersMode, setIsOthersMode] = useState<boolean>(
    () => Boolean(value) && !isKnownLocation(value),
  );
  const [othersText, setOthersText] = useState<string>(
    () => (!isKnownLocation(value) && value) ? value : "",
  );

  // Compute what the <Select> should display
  const selectValue = isOthersMode
    ? "others"
    : (value && isKnownLocation(value) ? value : "__none__");

  // Suppress re-sync when a change originated here
  const ownChange = useRef(false);

  useEffect(() => {
    if (ownChange.current) { ownChange.current = false; return; }
    // External reset (e.g. form.reset())
    if (!value) {
      setIsOthersMode(false);
      setOthersText("");
    } else if (isKnownLocation(value)) {
      setIsOthersMode(false);
      setOthersText("");
    } else {
      // Pre-existing custom value — show Others mode with the text pre-filled
      setIsOthersMode(true);
      setOthersText(value);
    }
  }, [value]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSelect = (v: string) => {
    ownChange.current = true;
    if (v === "others") {
      setIsOthersMode(true);
      setOthersText("");
      onChange("");            // clear until user types something
    } else if (v === "__none__") {
      setIsOthersMode(false);
      setOthersText("");
      onChange("");
    } else {
      setIsOthersMode(false);
      setOthersText("");
      onChange(v);             // save the chosen location directly
    }
  };

  const handleOthersText = (text: string) => {
    setOthersText(text);
    ownChange.current = true;
    onChange(text);            // raw text saved (e.g. "Jaipur")
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      <Select value={selectValue} onValueChange={handleSelect} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{placeholder}</SelectItem>
          {LOCATION_OPTIONS.map(loc => (
            <SelectItem key={loc} value={loc}>{loc}</SelectItem>
          ))}
          <SelectItem value="others">Others</SelectItem>
        </SelectContent>
      </Select>

      {isOthersMode && (
        <Input
          value={othersText}
          onChange={e => handleOthersText(e.target.value)}
          placeholder="Enter other location"
          disabled={disabled}
          className="text-sm"
          autoFocus
        />
      )}
    </div>
  );
}
