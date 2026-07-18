import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal, Loader2 } from "lucide-react";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { fetchPolicies, setPolicy, type AccessPolicy } from "@/lib/accessControl";

export default function PolicySettings({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [policies, setPolicies] = useState<AccessPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPolicies(await fetchPolicies());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load policies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (key: string, next: boolean) => {
    setBusy(key);
    setPolicies(prev => prev.map(p => p.key === key ? { ...p, enabled: next } : p));
    try {
      await setPolicy(key, next);
    } catch (e) {
      setPolicies(prev => prev.map(p => p.key === key ? { ...p, enabled: !next } : p));
      toast({ title: "Failed to save", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsCard
      icon={SlidersHorizontal}
      title="Policy Settings"
      description="Organisation-wide access policies. Configuration only — stored and audited, not yet enforced."
    >
      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : (
        <div className="space-y-4">
          {policies.map(policy => (
            <div key={policy.key} className="flex items-center justify-between gap-4">
              <Label htmlFor={`policy-${policy.key}`} className="text-sm font-medium cursor-pointer">{policy.label}</Label>
              <Switch
                id={`policy-${policy.key}`}
                checked={policy.enabled}
                disabled={!canEdit || busy === policy.key}
                onCheckedChange={(v) => toggle(policy.key, v)}
                data-testid={`policy-toggle-${policy.key}`}
              />
            </div>
          ))}
        </div>
      )}
      {busy && <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</p>}
    </SettingsCard>
  );
}
