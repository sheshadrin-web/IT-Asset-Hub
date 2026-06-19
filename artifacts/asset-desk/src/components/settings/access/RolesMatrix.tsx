import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  ACCESS_ROLES, fetchPermissions, fetchRolePermissions, setRolePermission,
  type AccessPermission,
} from "@/lib/accessControl";

const cellKey = (roleKey: string, permKey: string) => `${roleKey}::${permKey}`;

export default function RolesMatrix({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [permissions, setPermissions] = useState<AccessPermission[]>([]);
  const [matrix, setMatrix] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [perms, rolePerms] = await Promise.all([fetchPermissions(), fetchRolePermissions()]);
      setPermissions(perms.filter(p => p.category === "general"));
      const m: Record<string, boolean> = {};
      rolePerms.forEach(rp => { m[cellKey(rp.roleKey, rp.permissionKey)] = rp.enabled; });
      setMatrix(m);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load permissions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (roleKey: string, permKey: string, next: boolean) => {
    const k = cellKey(roleKey, permKey);
    setBusyCell(k);
    setMatrix(prev => ({ ...prev, [k]: next }));
    try {
      await setRolePermission(roleKey, permKey, next);
    } catch (e) {
      setMatrix(prev => ({ ...prev, [k]: !next }));
      toast({ title: "Failed to save", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyCell(null);
    }
  };

  return (
    <SettingsCard
      icon={ShieldCheck}
      title="Roles & Permissions"
      description="Configure what each role can access. This is a configuration matrix only — it is stored and audited but does not yet enforce access."
    >
      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border/70">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border/70 bg-muted/40">
                <th className="text-left font-semibold px-4 py-3 whitespace-nowrap">Permission</th>
                {ACCESS_ROLES.map(r => (
                  <th key={r.key} className="font-semibold px-3 py-3 text-center whitespace-nowrap">{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissions.map(perm => (
                <tr key={perm.key} className="border-b border-card-border/40 last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{perm.label}</td>
                  {ACCESS_ROLES.map(role => {
                    const k = cellKey(role.key, perm.key);
                    const isSuper = role.key === "super_admin";
                    const checked = isSuper ? true : !!matrix[k];
                    return (
                      <td key={role.key} className="px-3 py-2.5 text-center">
                        <Switch
                          checked={checked}
                          disabled={!canEdit || isSuper || busyCell === k}
                          onCheckedChange={(v) => toggle(role.key, perm.key, v)}
                          data-testid={`matrix-${role.key}-${perm.key}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
        {busyCell && <Loader2 className="h-3 w-3 animate-spin" />}
        Super Admin always has full access and cannot be modified. Changes save automatically.
      </p>
    </SettingsCard>
  );
}
