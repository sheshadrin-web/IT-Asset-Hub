import { useCallback, useEffect, useState } from "react";
import { MapPinned, Loader2 } from "lucide-react";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  fetchPermissions, fetchRolePermissions, setRolePermission,
  type AccessPermission,
} from "@/lib/accessControl";

const ROLE_KEY = "location_gm";

export default function LocationGmPermissions({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [permissions, setPermissions] = useState<AccessPermission[]>([]);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [perms, rolePerms] = await Promise.all([fetchPermissions(), fetchRolePermissions()]);
      setPermissions(perms.filter(p => p.category === "location_gm"));
      const m: Record<string, boolean> = {};
      rolePerms.filter(rp => rp.roleKey === ROLE_KEY).forEach(rp => { m[rp.permissionKey] = rp.enabled; });
      setEnabled(m);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Location GM permissions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (permKey: string, next: boolean) => {
    setBusy(permKey);
    setEnabled(prev => ({ ...prev, [permKey]: next }));
    try {
      await setRolePermission(ROLE_KEY, permKey, next);
    } catch (e) {
      setEnabled(prev => ({ ...prev, [permKey]: !next }));
      toast({ title: "Failed to save", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsCard
      icon={MapPinned}
      title="Location GM Permissions"
      description="Default capabilities for the Location GM role. Configuration only — stored and audited, not yet enforced."
    >
      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : (
        <div className="space-y-4">
          {permissions.map(perm => (
            <div key={perm.key} className="flex items-center justify-between gap-4">
              <Label htmlFor={`lgm-${perm.key}`} className="text-sm font-medium cursor-pointer">{perm.label}</Label>
              <Switch
                id={`lgm-${perm.key}`}
                checked={!!enabled[perm.key]}
                disabled={!canEdit || busy === perm.key}
                onCheckedChange={(v) => toggle(perm.key, v)}
                data-testid={`lgm-toggle-${perm.key}`}
              />
            </div>
          ))}
        </div>
      )}
      {busy && <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</p>}
    </SettingsCard>
  );
}
