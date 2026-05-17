import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
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
  const [open, setOpen] = useState(false);

  const options = useMemo(
    () => users.filter(u => u.status === "active" && u.email !== excludeEmail),
    [users, excludeEmail],
  );

  const selected = options.find(u => u.email === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between h-auto min-h-[40px] font-normal text-left"
        >
          {selected ? (
            <div className="flex flex-col items-start min-w-0 flex-1 py-0.5">
              <span className="text-sm font-medium leading-none truncate w-full">
                {selected.full_name}
              </span>
              <span className="text-xs text-muted-foreground truncate w-full mt-0.5">
                {selected.ecode ? `${selected.ecode} · ` : ""}{selected.email}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">
              Search by name, E-code, or email…
            </span>
          )}
          <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
            {value && (
              <span
                role="button"
                tabIndex={-1}
                onPointerDown={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange("");
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Remove manager"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
          </div>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="p-0"
        style={{ width: "var(--radix-popover-trigger-width)" }}
        align="start"
        sideOffset={4}
      >
        <Command>
          <CommandInput placeholder="Search by name, E-code, or email…" />
          <CommandList className="max-h-56">
            <CommandEmpty>No matching users found.</CommandEmpty>
            <CommandGroup>
              {options.map(u => (
                <CommandItem
                  key={u.id}
                  value={`${u.full_name} ${u.ecode ?? ""} ${u.email} ${u.department ?? ""}`}
                  onSelect={() => { onChange(u.email); setOpen(false); }}
                  className="flex items-center gap-2 py-2 cursor-pointer"
                >
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-medium leading-none">{u.full_name}</span>
                    <span className="text-xs text-muted-foreground mt-0.5">
                      {u.ecode ? `${u.ecode} · ` : ""}{u.email}
                      {u.department ? ` · ${u.department}` : ""}
                    </span>
                  </div>
                  <Check className={cn(
                    "h-4 w-4 flex-shrink-0",
                    value === u.email ? "opacity-100 text-primary" : "opacity-0",
                  )} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
