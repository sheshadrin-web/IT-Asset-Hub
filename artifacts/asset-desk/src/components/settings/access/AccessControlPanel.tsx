import { useState } from "react";
import { ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import RolesMatrix from "./RolesMatrix";
import LocationAccessMapping from "./LocationAccessMapping";
import LocationGmPermissions from "./LocationGmPermissions";
import PolicySettings from "./PolicySettings";

type SubTab = "roles" | "locations" | "lgm" | "policies";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "roles",     label: "Roles & Permissions" },
  { id: "locations", label: "Location Access" },
  { id: "lgm",       label: "Location GM Permissions" },
  { id: "policies",  label: "Policy Settings" },
];

export default function AccessControlPanel({ canEdit }: { canEdit: boolean }) {
  const [sub, setSub] = useState<SubTab>("roles");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="tablist">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={sub === t.id}
            onClick={() => setSub(t.id)}
            data-testid={`access-subtab-${t.id}`}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              sub === t.id ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === "roles"     && <RolesMatrix canEdit={canEdit} />}
      {sub === "locations" && <LocationAccessMapping canEdit={canEdit} />}
      {sub === "lgm"       && <LocationGmPermissions canEdit={canEdit} />}
      {sub === "policies"  && <PolicySettings canEdit={canEdit} />}

      <div className="rounded-xl border border-card-border/60 bg-muted/30 px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
        <ScrollText className="h-3.5 w-3.5 flex-shrink-0" />
        Every Access Control change is written to the Audit Logs tab.
      </div>
    </div>
  );
}
