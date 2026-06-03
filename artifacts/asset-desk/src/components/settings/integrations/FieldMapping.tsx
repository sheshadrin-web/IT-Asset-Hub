import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Save } from "lucide-react";
import { DEFAULT_FIELD_MAPPING, MILES_FIELDS, type FieldMappingRow } from "@/lib/hrIntegrations";

export default function FieldMapping() {
  const { toast } = useToast();
  const [rows, setRows] = useState<FieldMappingRow[]>(DEFAULT_FIELD_MAPPING);

  const update = (hrField: string, milesField: string) => {
    setRows(rs => rs.map(r => (r.hrField === hrField ? { ...r, milesField } : r)));
  };

  const handleSave = () => {
    toast({ title: "Field mapping updated (preview)", description: "This mapping will be applied during HR sync once the backend is enabled. Not persisted yet." });
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
          <Button onClick={handleSave} data-testid="button-save-mapping">
            <Save className="h-4 w-4 mr-2" /> Save Mapping
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
