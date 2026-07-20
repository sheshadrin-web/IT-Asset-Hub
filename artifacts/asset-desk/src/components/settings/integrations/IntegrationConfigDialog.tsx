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
import {
  type ProviderDef, type SyncFrequency, SYNC_FREQUENCY_OPTIONS,
} from "@/lib/hrIntegrations";
import type { IntegrationRow } from "@/lib/hrSyncTypes";
import { PlugZap, ShieldCheck } from "lucide-react";

export interface IntegrationConfig {
  values: Record<string, string>;
  autoSync: boolean;
  frequency: SyncFrequency;
}

interface Props {
  provider: ProviderDef | null;
  /** The saved integration for this provider, if it already exists. */
  existing?: IntegrationRow | null;
  open: boolean;
  saving?: boolean;
  onClose: () => void;
  onConnect: (cfg: IntegrationConfig) => void;
}

export default function IntegrationConfigDialog({ provider, existing, open, saving, onClose, onConnect }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [autoSync, setAutoSync] = useState(true);
  const [frequency, setFrequency] = useState<SyncFrequency>("daily");

  // Reset the form whenever a different provider's dialog is opened. Secret
  // values are never returned from the backend, so secret fields always start
  // blank; non-secret fields (API base URL, organization_name) are prefilled
  // from the saved row.
  useEffect(() => {
    if (!open || !provider) return;
    const seed: Record<string, string> = {};
    // Prefill URL field
    if (existing?.api_base_url) {
      const urlField = provider.fields.find(f => f.type === "url");
      if (urlField) seed[urlField.key] = existing.api_base_url;
    }
    // Prefill organisation display name (non-secret)
    if (existing?.organization_name) {
      seed["organization_name"] = existing.organization_name;
    }
    setValues(seed);
    setAutoSync(existing?.auto_sync_enabled ?? true);
    setFrequency((existing?.sync_frequency as SyncFrequency) ?? "daily");
  }, [open, provider, existing]);

  if (!provider) return null;

  const credsAlreadySet = !!existing?.credentials_set;

  // For an existing integration whose secrets are already stored, secret fields
  // may be left blank to keep the saved value. Non-secret required fields must
  // always be present.
  const missingRequired = provider.fields
    .filter(f => f.required)
    .some(f => {
      const empty = !values[f.key]?.trim();
      if (!empty) return false;
      if (credsAlreadySet && f.secret) return false; // keep existing secret
      return true;
    });

  const handleConnect = () => {
    if (missingRequired || saving) return;
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
            Enter your {provider.name} credentials. They're stored on the backend and used to
            authenticate the HR sync. Secret values are never displayed again after saving.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {credsAlreadySet && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 flex items-start gap-2" data-testid="banner-creds-set">
              <ShieldCheck className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-emerald-800">
                Credentials are already saved. Leave secret fields blank to keep them, or enter new
                values to replace them.
              </p>
            </div>
          )}

          {provider.fields.map(field => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`cfg-${field.key}`} className="text-sm">
                {field.label}
                {field.required && !(credsAlreadySet && field.secret) && <span className="text-destructive ml-0.5">*</span>}
              </Label>
              <Input
                id={`cfg-${field.key}`}
                type={field.secret ? "password" : field.type === "url" ? "url" : "text"}
                placeholder={credsAlreadySet && field.secret ? "•••••••• (unchanged)" : field.placeholder}
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

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} data-testid="button-cfg-cancel">Cancel</Button>
          <Button onClick={handleConnect} disabled={missingRequired || saving} data-testid="button-cfg-connect">
            {saving ? "Saving…" : "Save & Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
