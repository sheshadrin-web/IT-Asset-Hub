import { useEffect, useState } from "react";
import { MapPin, Save } from "lucide-react";
import { LOCATION_OPTIONS } from "@/lib/locationOptions";
import {
  fetchLocationAccessForUser, replaceUserLocationAccess, LocationAccessInput,
} from "@/lib/locationAccess";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface Caps {
  canRaiseRequests: boolean;
  canMarkReceived: boolean;
  canReleaseAfterItApproval: boolean;
}
const DEFAULT_CAPS: Caps = { canRaiseRequests: true, canMarkReceived: false, canReleaseAfterItApproval: false };

// Per-user location mapping editor. Writes to user_location_access (admin only;
// RLS enforces). Shown inside the Edit User dialog — most relevant when the user's
// role is Location GM, but mapping can be set ahead of the role change too.
export default function LocationAccessEditor({ userId, role }: { userId: string; role: string }) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Record<string, Caps>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await fetchLocationAccessForUser(userId);
        if (cancelled) return;
        const map: Record<string, Caps> = {};
        rows.forEach(r => { map[r.location] = {
          canRaiseRequests: r.canRaiseRequests,
          canMarkReceived: r.canMarkReceived,
          canReleaseAfterItApproval: r.canReleaseAfterItApproval,
        }; });
        setSelected(map);
      } catch (e) {
        if (!cancelled) toast({ title: "Could not load location access", description: (e as Error).message, variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const toggleLocation = (loc: string, on: boolean) => {
    setSelected(prev => {
      const next = { ...prev };
      if (on) next[loc] = { ...DEFAULT_CAPS };
      else delete next[loc];
      return next;
    });
  };
  const setCap = (loc: string, cap: keyof Caps, val: boolean) => {
    setSelected(prev => ({ ...prev, [loc]: { ...prev[loc], [cap]: val } }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const entries: LocationAccessInput[] = Object.entries(selected).map(([location, caps]) => ({
        location, accessRole: "location_gm", canViewAssets: true,
        canRaiseRequests: caps.canRaiseRequests,
        canMarkReceived: caps.canMarkReceived,
        canReleaseAfterItApproval: caps.canReleaseAfterItApproval,
      }));
      await replaceUserLocationAccess(userId, entries);
      toast({ title: "Location access saved", description: `${entries.length} location(s) mapped.` });
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Location Access</span>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={save} disabled={saving || loading} data-testid="button-save-location-access">
          <Save className="h-3.5 w-3.5 mr-1.5" />{saving ? "Saving…" : "Save Access"}
        </Button>
      </div>
      {role !== "location_gm" && (
        <p className="text-xs text-muted-foreground">
          Location mapping mainly applies to the <strong>Location GM</strong> role. You can still pre-map locations here.
        </p>
      )}
      {loading ? (
        <p className="text-sm text-muted-foreground py-3">Loading…</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {(LOCATION_OPTIONS as readonly string[]).map(loc => {
            const on = !!selected[loc];
            return (
              <div key={loc} className="rounded-md border border-border/60 p-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={on} onCheckedChange={(c) => toggleLocation(loc, !!c)} data-testid={`checkbox-location-${loc}`} />
                  <span className="text-sm font-medium">{loc}</span>
                </label>
                {on && (
                  <div className="mt-2 ml-6 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <CapToggle label="Raise requests" checked={selected[loc].canRaiseRequests} onChange={(v) => setCap(loc, "canRaiseRequests", v)} testid={`switch-raise-${loc}`} />
                    <CapToggle label="Mark received" checked={selected[loc].canMarkReceived} onChange={(v) => setCap(loc, "canMarkReceived", v)} testid={`switch-mark-${loc}`} />
                    <CapToggle label="Release after IT" checked={selected[loc].canReleaseAfterItApproval} onChange={(v) => setCap(loc, "canReleaseAfterItApproval", v)} testid={`switch-release-${loc}`} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CapToggle({ label, checked, onChange, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; testid: string }) {
  return (
    <div className="flex items-center gap-2">
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testid} />
      <Label className="text-xs text-muted-foreground">{label}</Label>
    </div>
  );
}
