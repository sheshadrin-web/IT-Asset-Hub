import { useState, useEffect, useRef, useMemo } from "react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { LOCATION_OPTIONS } from "@/lib/locationOptions";

interface Props {
  value:       string;
  onChange:    (v: string) => void;
  disabled?:   boolean;
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
  // Derive what the Select should show
  const selectValue = useMemo(() => {
    if (!value) return "__none__";
    if (isKnownLocation(value)) return value;
    return "others";
  }, [value]);

  // Local text for the "Others" free-input — seeded from the current value
  // if it isn't a known location (handles pre-existing custom values).
  const [othersText, setOthersText] = useState<string>(
    () => (!isKnownLocation(value) && value) ? value : "",
  );

  // Re-sync local text when the form resets externally, but not on our own changes.
  const ownChange = useRef(false);
  useEffect(() => {
    if (ownChange.current) { ownChange.current = false; return; }
    if (!value) {
      setOthersText("");
    } else if (!isKnownLocation(value)) {
      setOthersText(value);
    } else {
      setOthersText("");
    }
  }, [value]);

  const handleSelect = (v: string) => {
    ownChange.current = true;
    if (v === "others") {
      setOthersText("");
      onChange("");           // clear until user types
    } else if (v === "__none__") {
      setOthersText("");
      onChange("");
    } else {
      setOthersText("");
      onChange(v);
    }
  };

  const handleOthersText = (text: string) => {
    setOthersText(text);
    ownChange.current = true;
    onChange(text);           // save raw text directly (e.g. "Jaipur")
  };

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

      {selectValue === "others" && (
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
