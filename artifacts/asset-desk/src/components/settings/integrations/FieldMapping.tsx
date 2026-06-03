import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabaseClient";
import { ArrowRight, Save, AlertCircle } from "lucide-react";
import { DEFAULT_FIELD_MAPPING, MILES_FIELDS, type FieldMappingRow } from "@/lib/hrIntegrations";
import type { IntegrationRow } from "@/lib/hrSyncTypes";
import { getIntegrations, getFieldMapping, saveFieldMapping } from "@/lib/integrationService";

export default function FieldMapping() {
  const { toast } = useToast();
  const { session, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<FieldMappingRow[]>(DEFAULT_FIELD_MAPPING);
  const [integration, setIntegration] = useState<IntegrationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session) { setLoading(false); return; }
    setLoading(true);
    try {
      const integrations = await getIntegrations();
      const target = integrations.find(i => i.status === "connected") ?? integrations[0] ?? null;
      setIntegration(target);
      if (target) {
        const saved = await getFieldMapping(target.id);
        if (saved.length > 0) {
          setRows(saved.map(s => ({ hrField: s.source_field, milesField: s.target_field })));
        } else {
          setRows(DEFAULT_FIELD_MAPPING);
        }
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load field mapping");
    } finally {
      setLoading(false);
    }
  }, [session, authLoading]);

  useEffect(() => { void load(); }, [load]);

  const update = (hrField: string, milesField: string) => {
    setRows(rs => rs.map(r => (r.hrField === hrField ? { ...r, milesField } : r)));
  };

  const handleSave = async () => {
    if (!integration) return;
    setSaving(true);
    try {
      await saveFieldMapping(integration.id, rows);
      toast({ title: "Field mapping saved", description: `Applied to ${integration.provider_name} on the next sync.` });
    } catch (e) {
      toast({ variant: "destructive", title: "Could not save mapping", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Field Mapping</CardTitle>
        <CardDescription className="text-xs">
          Map fields from your HR portal to Miles IT Hub user fields. These mappings are used when employees are imported.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3" data-testid="error-field-mapping">
            <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : !integration ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground" data-testid="empty-field-mapping">
            Connect an HR portal first — field mapping is saved per integration.
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Editing mapping for <span className="font-medium text-foreground">{integration.provider_name}</span>.
            </p>
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>HR Portal Field</TableHead>
                    <TableHead className="w-8" />
                    <TableHead>Miles IT Hub Field</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <TableRow key={row.hrField} data-testid={`mapping-row-${row.hrField}`}>
                      <TableCell>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{row.hrField}</code>
                      </TableCell>
                      <TableCell className="text-muted-foreground/50">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </TableCell>
                      <TableCell>
                        <Select value={row.milesField} onValueChange={v => update(row.hrField, v)}>
                          <SelectTrigger className="h-8 max-w-[220px]" data-testid={`select-mapping-${row.hrField}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MILES_FIELDS.map(f => (
                              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving} data-testid="button-save-mapping">
                <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save Mapping"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
