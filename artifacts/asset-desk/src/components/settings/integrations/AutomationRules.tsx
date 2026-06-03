import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { AUTOMATION_RULES } from "@/lib/hrIntegrations";
import { Zap, Save, CheckCircle2 } from "lucide-react";

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
  const [state, setState] = useState<Record<string, RuleState>>(buildInitial);

  const toggleRule = (id: string, enabled: boolean) =>
    setState(s => ({ ...s, [id]: { ...s[id], enabled } }));

  const toggleAction = (id: string, key: string, enabled: boolean) =>
    setState(s => ({ ...s, [id]: { ...s[id], actions: { ...s[id].actions, [key]: enabled } } }));

  const handleSave = () => {
    toast({ title: "Automation rules updated (preview)", description: "Rules take effect during HR sync once the backend is enabled. Not persisted yet." });
  };

  return (
    <div className="space-y-4">
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
        <Button onClick={handleSave} data-testid="button-save-rules">
          <Save className="h-4 w-4 mr-2" /> Save Rules
        </Button>
      </div>
    </div>
  );
}
