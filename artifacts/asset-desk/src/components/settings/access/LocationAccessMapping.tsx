import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin, Pencil, Loader2, Plus } from "lucide-react";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { LOCATION_OPTIONS } from "@/lib/locationOptions";
import { fetchAllLocationAccess, type UserLocationAccess } from "@/lib/locationAccess";
import { setUserLocations, type UserLocationRow } from "@/lib/accessControl";

interface ProfileLite {
  id:        string;
  fullName:  string;
  role:      string;
  location:  string | null;
}

interface Caps {
  canViewAssets:             boolean;
  canRaiseRequests:          boolean;
  canMarkReceived:           boolean;
  canReleaseAfterItApproval: boolean;
}
const DEFAULT_CAPS: Caps = {
  canViewAssets: true, canRaiseRequests: true, canMarkReceived: false, canReleaseAfterItApproval: false,
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin", it_admin: "IT Admin", hr_admin: "HR Admin",
  it_agent: "IT Agent", end_user: "End User", location_gm: "Location GM",
};

export default function LocationAccessMapping({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<ProfileLite[]>([]);
  const [access, setAccess] = useState<UserLocationAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [picker, setPicker] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: profRows, error: profErr }, accessRows] = await Promise.all([
        supabase.from("profiles").select("id, full_name, role, location").order("full_name"),
        fetchAllLocationAccess(),
      ]);
      if (profErr) throw new Error(profErr.message);
      setProfiles((profRows ?? []).map(r => ({
        id: String(r.id), fullName: String(r.full_name ?? "—"),
        role: String(r.role ?? ""), location: (r.location as string) ?? null,
      })));
      setAccess(accessRows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load location access");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const accessByUser = useMemo(() => {
    const m = new Map<string, UserLocationAccess[]>();
    access.forEach(a => { m.set(a.userId, [...(m.get(a.userId) ?? []), a]); });
    return m;
  }, [access]);

  const mappedUsers = useMemo(
    () => profiles.filter(p => accessByUser.has(p.id)),
    [profiles, accessByUser],
  );

  const profileName = (id: string) => profiles.find(p => p.id === id)?.fullName ?? id;

  return (
    <SettingsCard
      icon={MapPin}
      title="Location Access Mapping"
      description="Map existing users to one or more locations. Editable by Super Admin only. Every change is recorded in the Audit Logs."
      action={
        canEdit ? (
          <div className="flex items-center gap-2">
            <Select value={picker} onValueChange={setPicker}>
              <SelectTrigger className="w-[220px]" data-testid="select-map-user"><SelectValue placeholder="Map a user…" /></SelectTrigger>
              <SelectContent>
                {profiles.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.fullName}{ROLE_LABEL[p.role] ? ` · ${ROLE_LABEL[p.role]}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={!picker} onClick={() => { if (picker) setEditUserId(picker); }} data-testid="button-add-mapping">
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Edit
            </Button>
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : mappedUsers.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground" data-testid="empty-location-mappings">
          No location mappings yet. Use “Map a user…” above to assign locations.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border/70">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border/70 bg-muted/40">
                <th className="text-left font-semibold px-4 py-3">User</th>
                <th className="text-left font-semibold px-4 py-3">Role</th>
                <th className="text-left font-semibold px-4 py-3">Locations</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {mappedUsers.map(u => (
                <tr key={u.id} className="border-b border-card-border/40 last:border-0 hover:bg-muted/20" data-testid={`mapping-row-${u.id}`}>
                  <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{u.fullName}</td>
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {(accessByUser.get(u.id) ?? []).map(a => (
                        <Badge key={a.id} variant="secondary" className="font-normal">{a.location}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setEditUserId(u.id)} data-testid={`button-edit-mapping-${u.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editUserId && (
        <EditMappingDialog
          userId={editUserId}
          userName={profileName(editUserId)}
          existing={accessByUser.get(editUserId) ?? []}
          onClose={() => { setEditUserId(null); setPicker(""); }}
          onSaved={() => { setEditUserId(null); setPicker(""); void load(); }}
        />
      )}
    </SettingsCard>
  );
}

interface EditDialogProps {
  userId:   string;
  userName: string;
  existing: UserLocationAccess[];
  onClose:  () => void;
  onSaved:  () => void;
}

function EditMappingDialog({ userId, userName, existing, onClose, onSaved }: EditDialogProps) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Record<string, Caps>>(() => {
    const m: Record<string, Caps> = {};
    existing.forEach(a => { m[a.location] = {
      canViewAssets: a.canViewAssets, canRaiseRequests: a.canRaiseRequests,
      canMarkReceived: a.canMarkReceived, canReleaseAfterItApproval: a.canReleaseAfterItApproval,
    }; });
    return m;
  });
  const [saving, setSaving] = useState(false);

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
      const rows: UserLocationRow[] = Object.entries(selected).map(([location, caps]) => ({
        location, accessRole: "location_gm",
        canViewAssets: caps.canViewAssets,
        canRaiseRequests: caps.canRaiseRequests,
        canMarkReceived: caps.canMarkReceived,
        canReleaseAfterItApproval: caps.canReleaseAfterItApproval,
      }));
      await setUserLocations(userId, rows);
      toast({ title: "Location access saved", description: `${rows.length} location(s) mapped for ${userName}.` });
      onSaved();
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Location Access — {userName}</DialogTitle>
          <DialogDescription>Select the locations this user can access and the capabilities they have at each.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1 py-1">
          {(LOCATION_OPTIONS as readonly string[]).map(loc => {
            const on = !!selected[loc];
            return (
              <div key={loc} className="rounded-md border border-border/60 p-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={on} onCheckedChange={(c) => toggleLocation(loc, !!c)} data-testid={`map-location-${loc}`} />
                  <span className="text-sm font-medium">{loc}</span>
                </label>
                {on && (
                  <div className="mt-2 ml-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <CapToggle label="View assets" checked={selected[loc].canViewAssets} onChange={(v) => setCap(loc, "canViewAssets", v)} testid={`map-view-${loc}`} />
                    <CapToggle label="Raise requests" checked={selected[loc].canRaiseRequests} onChange={(v) => setCap(loc, "canRaiseRequests", v)} testid={`map-raise-${loc}`} />
                    <CapToggle label="Mark received" checked={selected[loc].canMarkReceived} onChange={(v) => setCap(loc, "canMarkReceived", v)} testid={`map-mark-${loc}`} />
                    <CapToggle label="Release after IT" checked={selected[loc].canReleaseAfterItApproval} onChange={(v) => setCap(loc, "canReleaseAfterItApproval", v)} testid={`map-release-${loc}`} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} data-testid="button-save-mapping">
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : "Save Access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
