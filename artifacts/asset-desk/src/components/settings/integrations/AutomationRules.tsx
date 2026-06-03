import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabaseClient";
import { AUTOMATION_RULES } from "@/lib/hrIntegrations";
import { getAutomationRules, saveAutomationRules, type AutomationRulePayload } from "@/lib/integrationService";
import { Zap, Save, CheckCircle2, AlertCircle } from "lucide-react";

interface RuleState {
  enabled: boolean;
  actions: Record<string, boolean>;
}

function buildInitial(): Record<string, RuleState> {
  const out: Record<string, RuleState> = {};
  for (const rule of AUTOMATION_RULES) {
    out[rule.id] = {
      enabled: true,
      actions: Object.fromEntries(rule.actions.map(a => [a.key, a.enabled])),
    };
  }
  return out;
}

export default function AutomationRules() {
  const { toast } = useToast();
  const { session, loading: authLoading } = useAuth();
  const [state, setState] = useState<Record<string, RuleState>>(buildInitial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session) { setLoading(false); return; }
    setLoading(true);
    try {
      const saved = await getAutomationRules();
      if (saved.length > 0) {
        setState(prev => {
          const next = { ...prev };
          for (const s of saved) {
            if (next[s.rule_key]) {
              next[s.rule_key] = {
                enabled: s.is_enabled,
                actions: { ...next[s.rule_key].actions, ...s.actions },
              };
            }
          }
          return next;
        });
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load automation rules");
    } finally {
      setLoading(false);
    }
  }, [session, authLoading]);

  useEffect(() => { void load(); }, [load]);

  const toggleRule = (id: string, enabled: boolean) =>
    setState(s => ({ ...s, [id]: { ...s[id], enabled } }));

  const toggleAction = (id: string, key: string, enabled: boolean) =>
    setState(s => ({ ...s, [id]: { ...s[id], actions: { ...s[id].actions, [key]: enabled } } }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: AutomationRulePayload[] = AUTOMATION_RULES.map(rule => ({
        rule_key: rule.id,
        rule_name: rule.title,
        is_enabled: state[rule.id].enabled,
        actions: state[rule.id].actions,
      }));
      await saveAutomationRules(payload);
      toast({ title: "Automation rules saved", description: "These take effect on the next HR sync." });
    } catch (e) {
      toast({ variant: "destructive", title: "Could not save rules", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3" data-testid="error-automation-rules">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Choose what happens automatically when an HR sync detects an employee joining or leaving.
        </p>
      </div>

      {AUTOMATION_RULES.map(rule => {
        const rs = state[rule.id];
        return (
          <Card key={rule.id} data-testid={`rule-${rule.id}`}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" /> {rule.title}
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    <span className="font-medium text-foreground">When:</span> {rule.trigger}
                  </CardDescription>
                  <p className="text-xs text-muted-foreground mt-1">{rule.description}</p>
                </div>
                <Switch checked={rs.enabled} onCheckedChange={v => toggleRule(rule.id, v)} data-testid={`switch-rule-${rule.id}`} />
              </div>
            </CardHeader>
            <CardContent>
              <Separator className="mb-3" />
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Actions</p>
              <div className="space-y-2.5">
                {rule.actions.map(action => (
                  <div key={action.key} className="flex items-center justify-between gap-4">
                    <Label
                      htmlFor={`${rule.id}-${action.key}`}
                      className={`text-sm flex items-center gap-2 cursor-pointer ${rs.enabled ? "" : "opacity-50"}`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      {action.label}
                    </Label>
                    <Switch
                      id={`${rule.id}-${action.key}`}
                      checked={rs.actions[action.key]}
                      onCheckedChange={v => toggleAction(rule.id, action.key, v)}
                      disabled={!rs.enabled}
                      data-testid={`switch-action-${rule.id}-${action.key}`}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} data-testid="button-save-rules">
          <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save Rules"}
        </Button>
      </div>
    </div>
  );
}
