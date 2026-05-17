import { useState, useEffect, useRef, useMemo } from "react";
import { X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Profile } from "@/data/mockData";

interface Props {
  value:         string;
  onChange:      (email: string) => void;
  users:         Profile[];
  excludeEmail?: string;
  disabled?:     boolean;
}

export default function ManagerSearchField({
  value, onChange, users, excludeEmail, disabled,
}: Props) {
  const [query,       setQuery]       = useState("");
  const [open,        setOpen]        = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef                  = useRef<HTMLDivElement>(null);
  const inputRef                      = useRef<HTMLInputElement>(null);

  const selected = users.find(u => u.email === value);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return users
      .filter(u => u.status === "active" && u.email !== excludeEmail)
      .filter(u =>
        !q ||
        u.full_name.toLowerCase().includes(q) ||
        (u.ecode ?? "").toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [users, query, excludeEmail]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (email: string) => {
    onChange(email);
    setQuery("");
    setOpen(false);
    setHighlighted(-1);
  };

  const handleClear = () => {
    onChange("");
    setQuery("");
    setOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted >= 0 && filtered[highlighted]) {
        handleSelect(filtered[highlighted].email);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
    }
  };

  if (disabled) {
    return (
      <div className="px-3 py-2 text-sm rounded-md border bg-muted text-muted-foreground">
        {selected ? selected.full_name : "—"}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {selected && !open ? (
        <div className="flex items-center gap-2 px-3 py-2 border border-input rounded-md bg-background min-h-[40px]">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-none truncate">{selected.full_name}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {selected.ecode ? `${selected.ecode} · ` : ""}{selected.email}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            title="Remove manager"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            placeholder="Search by name, E-code, or email"
            value={query}
            className="pl-9"
            onChange={e => { setQuery(e.target.value); setOpen(true); setHighlighted(-1); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
          />
        </div>
      )}

      {open && (
        <div className="absolute z-[200] top-full mt-1 w-full bg-card border border-border rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              No matching users found
            </div>
          ) : (
            filtered.map((u, i) => (
              <button
                type="button"
                key={u.id}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border/50 last:border-0 transition-colors",
                  i === highlighted ? "bg-primary/10" : "hover:bg-accent/60"
                )}
                onClick={() => handleSelect(u.email)}
              >
                <p className="text-sm font-medium leading-none">{u.full_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {u.ecode ? `${u.ecode} · ` : ""}{u.email}{u.department ? ` · ${u.department}` : ""}
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
