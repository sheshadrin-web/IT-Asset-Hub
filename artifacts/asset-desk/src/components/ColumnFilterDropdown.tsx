import { useState, useRef, useEffect } from "react";
import { ListFilter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  label:     string;
  allValues: string[];
  selected:  Set<string>;
  onApply:   (vals: Set<string>) => void;
  align?:    "left" | "right";
}

export default function ColumnFilterDropdown({ label, allValues, selected, onApply, align = "left" }: Props) {
  const [open, setOpen]   = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));
  const ref = useRef<HTMLDivElement>(null);

  const isActive = selected.size > 0 && selected.size < allValues.length;

  useEffect(() => {
    if (open) { setDraft(new Set(selected)); setSearch(""); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const searchLow   = search.toLowerCase();
  const visible     = allValues.filter(v => v.toLowerCase().includes(searchLow));
  const allChecked  = visible.length > 0 && visible.every(v => draft.has(v));
  const someChecked = visible.some(v => draft.has(v)) && !allChecked;

  const toggleAll = () => {
    const next = new Set(draft);
    if (allChecked) visible.forEach(v => next.delete(v));
    else            visible.forEach(v => next.add(v));
    setDraft(next);
  };

  const toggle = (val: string) => {
    const next = new Set(draft);
    next.has(val) ? next.delete(val) : next.add(val);
    setDraft(next);
  };

  const handleApply = () => {
    const effective = (draft.size === 0 || draft.size === allValues.length)
      ? new Set<string>()
      : new Set(draft);
    onApply(effective);
    setOpen(false);
  };

  const handleClear = () => {
    setDraft(new Set());
    onApply(new Set());
    setOpen(false);
  };

  return (
    <div className="relative inline-flex items-center gap-1 select-none" ref={ref}>
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
        {label}
      </span>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          "relative flex-shrink-0 rounded p-0.5 transition-colors",
          isActive
            ? "text-primary hover:text-primary/80"
            : "text-muted-foreground/40 hover:text-muted-foreground"
        )}
        title={`Filter by ${label}`}
      >
        <ListFilter className="h-3 w-3" />
        {isActive && (
          <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-primary border border-white" />
        )}
      </button>

      {open && (
        <div className={cn(
          "absolute top-full z-50 mt-1 w-60 rounded-lg border border-border bg-white shadow-xl",
          align === "right" ? "right-0" : "left-0"
        )}>
          <div className="p-2 border-b border-border">
            <Input
              placeholder={`Search ${label}…`}
              className="h-7 text-xs"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="px-3 py-2 border-b border-border">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={allChecked}
                onCheckedChange={toggleAll}
                className={someChecked ? "data-[state=unchecked]:bg-primary/20" : ""}
              />
              <span className="text-xs font-medium text-foreground">
                Select All ({visible.length})
              </span>
            </label>
          </div>

          <div className="max-h-48 overflow-y-auto p-2 space-y-0.5">
            {visible.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">No matching values</p>
            ) : (
              visible.map(val => (
                <label
                  key={val}
                  className="flex items-center gap-2 cursor-pointer rounded px-2 py-1 hover:bg-muted/50"
                >
                  <Checkbox checked={draft.has(val)} onCheckedChange={() => toggle(val)} />
                  <span className="text-xs truncate">{val || "—"}</span>
                </label>
              ))
            )}
          </div>

          <div className="flex items-center justify-between gap-2 p-2 border-t border-border">
            <Button
              variant="ghost" size="sm"
              className="h-7 text-xs px-2 text-muted-foreground"
              onClick={handleClear}
            >
              Clear
            </Button>
            <Button size="sm" className="h-7 text-xs px-4" onClick={handleApply}>
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
