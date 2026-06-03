import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  type ProviderDef, type SyncFrequency, SYNC_FREQUENCY_OPTIONS,
} from "@/lib/hrIntegrations";
import { PlugZap, FlaskConical } from "lucide-react";

export interface IntegrationConfig {
  values: Record<string, string>;
  autoSync: boolean;
  frequency: SyncFrequency;
}

interface Props {
  provider: ProviderDef | null;
  open: boolean;
  initial?: IntegrationConfig | null;
  onClose: () => void;
  onConnect: (cfg: IntegrationConfig) => void;
}

const EMPTY: IntegrationConfig = { values: {}, autoSync: true, frequency: "daily" };

export default function IntegrationConfigDialog({ provider, open, initial, onClose, onConnect }: Props) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [autoSync, setAutoSync] = useState(true);
  const [frequency, setFrequency] = useState<SyncFrequency>("daily");

  // Reset the form whenever a different provider's dialog is opened.
  useEffect(() => {
    if (!open) return;
    const base = initial ?? EMPTY;
    setValues({ ...base.values });
    setAutoSync(base.autoSync);
    setFrequency(base.frequency);
  }, [open, provider, initial]);

  if (!provider) return null;

  const missingRequired = provider.fields
    .filter(f => f.required)
    .some(f => !values[f.key]?.trim());

  const handleTest = () => {
    toast({
      title: "Test connection",
      description:
        "This is a configuration preview — live connection testing will run once the HR sync backend is enabled.",
    });
  };

  const handleConnect = () => {
    if (missingRequired) return;
    onConnect({ values, autoSync, frequency });
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlugZap className="h-4 w-4 text-primary" /> Configure {provider.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Enter your {provider.name} credentials. In this preview they're held only in your browser and aren't sent
            anywhere — encrypted backend storage and live sync arrive in a later phase.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {provider.fields.map(field => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`cfg-${field.key}`} className="text-sm">
                {field.label}
                {field.required && <span className="text-destructive ml-0.5">*</span>}
              </Label>
              <Input
                id={`cfg-${field.key}`}
                type={field.secret ? "password" : field.type === "url" ? "url" : "text"}
                placeholder={field.placeholder}
                autoComplete="off"
                value={values[field.key] ?? ""}
                onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                data-testid={`input-cfg-${field.key}`}
              />
              {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
            </div>
          ))}

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <div>
              <Label htmlFor="cfg-auto-sync" className="text-sm font-medium cursor-pointer">Enable Auto Sync</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Automatically pull employee changes on a schedule.</p>
            </div>
            <Switch id="cfg-auto-sync" checked={autoSync} onCheckedChange={setAutoSync} data-testid="switch-cfg-auto-sync" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Sync Frequency</Label>
            <Select value={frequency} onValueChange={v => setFrequency(v as SyncFrequency)} disabled={!autoSync}>
              <SelectTrigger data-testid="select-cfg-frequency"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SYNC_FREQUENCY_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Preview only — these values aren't persisted and will reset on refresh.
        </p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={handleTest} data-testid="button-cfg-test">
            <FlaskConical className="h-4 w-4 mr-2" /> Test Connection
          </Button>
          <Button onClick={handleConnect} disabled={missingRequired} data-testid="button-cfg-connect">
            Save &amp; Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
