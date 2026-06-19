import { useEffect, useMemo, useState } from "react";
import { MapPin, Download } from "lucide-react";
import { useAssets } from "@/context/AssetContext";
import { Asset } from "@/data/mockData";
import { LOCATION_OPTIONS } from "@/lib/locationOptions";
import { LOCATION_RESPONSIBLES, responsibleFor } from "@/lib/locationResponsibles";
import { fetchShortageRequests, ShortageRequest } from "@/lib/shortageRequests";
import { fetchReturnRequests, ReturnRequest } from "@/lib/returnRequests";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";

const ALL = "all";

function fmtDate(s?: string): string {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function LocationReportSection() {
  const { assets } = useAssets();
  const [shortages, setShortages] = useState<ShortageRequest[]>([]);
  const [returns,   setReturns]   = useState<ReturnRequest[]>([]);

  const [location,   setLocation]   = useState(ALL);
  const [assetType,  setAssetType]  = useState(ALL);
  const [status,     setStatus]     = useState(ALL);
  const [assignment, setAssignment] = useState(ALL);
  const [responsible, setResponsible] = useState(ALL);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, r] = await Promise.all([fetchShortageRequests(), fetchReturnRequests()]);
        if (!cancelled) { setShortages(s); setReturns(r); }
      } catch { /* request tables are optional for the report; ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const assetTypes = useMemo(() => Array.from(new Set(assets.map(a => a.assetType))).sort(), [assets]);
  const statuses   = useMemo(() => Array.from(new Set(assets.map(a => a.status))).sort(), [assets]);
  const responsibles = useMemo(() => Array.from(new Set(Object.values(LOCATION_RESPONSIBLES).flat())).sort(), []);

  const filtered = useMemo(() => assets.filter(a => {
    if (location !== ALL && (a.location || "") !== location) return false;
    if (assetType !== ALL && a.assetType !== assetType) return false;
    if (status !== ALL && a.status !== status) return false;
    if (assignment === "assigned" && a.status !== "Assigned") return false;
    if (assignment === "available" && a.status !== "Available") return false;
    if (responsible !== ALL && !responsibleFor(a.location).split(", ").includes(responsible)) return false;
    return true;
  }), [assets, location, assetType, status, assignment, responsible]);

  const summary = useMemo(() => {
    const inScope = (loc: string) => location === ALL || loc === location;
    return {
      total:        filtered.length,
      shortageOpen: shortages.filter(s => inScope(s.location) && ["Pending", "Approved", "Partially Approved"].includes(s.status)).length,
      returnPend:   returns.filter(r => inScope(r.location) && r.status !== "Closed").length,
      underRepair:  filtered.filter(a => a.status === "Under Repair" || a.condition === "Under Repair").length,
      damaged:      filtered.filter(a => a.condition === "Damaged").length,
    };
  }, [filtered, shortages, returns, location]);

  const exportCsv = () => {
    const header = ["Asset ID", "Type", "Brand", "Model", "Serial No", "Status", "Condition", "Assigned To", "Location", "Responsible Person", "Last Updated"];
    const rows = filtered.map((a: Asset) => [
      a.assetId, a.assetType, a.brand, a.model, a.serialNumber, a.status,
      a.condition ?? "Good", a.assignedTo ?? a.assignedEmail ?? "",
      a.location || "Unassigned", responsibleFor(a.location),
      fmtDate(a.conditionUpdatedAt ?? a.updatedAt),
    ]);
    const csv = "\ufeff" + [header, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const slug = location === ALL ? "" : `_${location.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    downloadCsv(csv, `location_assets${slug}_report_${new Date().toISOString().split("T")[0]}.csv`);
  };

  const preview = filtered.slice(0, 50);

  return (
    <Card data-testid="section-location-report">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" /> Location-wise Asset Report
          </CardTitle>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv} disabled={filtered.length === 0} data-testid="button-export-location-report">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <FilterSelect label="Location" value={location} onChange={setLocation} options={LOCATION_OPTIONS as readonly string[]} allLabel="All locations" testid="filter-report-location" />
          <FilterSelect label="Asset Type" value={assetType} onChange={setAssetType} options={assetTypes} allLabel="All types" testid="filter-report-type" />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={statuses} allLabel="All statuses" testid="filter-report-status" />
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Assignment</label>
            <Select value={assignment} onValueChange={setAssignment}>
              <SelectTrigger className="h-9" data-testid="filter-report-assignment"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="available">Available</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <FilterSelect label="Responsible" value={responsible} onChange={setResponsible} options={responsibles} allLabel="All people" testid="filter-report-responsible" />
        </div>

        <div className="flex flex-wrap gap-2">
          <SummaryChip label="Assets" value={summary.total} />
          <SummaryChip label="Open shortages" value={summary.shortageOpen} tone="bg-amber-100 text-amber-700" />
          <SummaryChip label="Returns pending" value={summary.returnPend} tone="bg-blue-100 text-blue-700" />
          <SummaryChip label="Under repair" value={summary.underRepair} tone="bg-orange-100 text-orange-700" />
          <SummaryChip label="Damaged" value={summary.damaged} tone="bg-red-100 text-red-700" />
        </div>

        <div className="overflow-x-auto border border-border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset ID</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead>
                <TableHead>Condition</TableHead><TableHead>Location</TableHead><TableHead>Responsible</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No assets match these filters.</TableCell></TableRow>
              ) : preview.map(a => (
                <TableRow key={a.id ?? a.assetId}>
                  <TableCell className="font-medium">{a.assetId}</TableCell>
                  <TableCell>{a.assetType}</TableCell>
                  <TableCell><Badge variant="outline">{a.status}</Badge></TableCell>
                  <TableCell>{a.condition ?? "Good"}</TableCell>
                  <TableCell>{a.location || "Unassigned"}</TableCell>
                  <TableCell>{responsibleFor(a.location)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {filtered.length > preview.length && (
          <p className="text-xs text-muted-foreground">Showing {preview.length} of {filtered.length}. Export CSV for the full list.</p>
        )}
      </CardContent>
    </Card>
  );
}

function FilterSelect({ label, value, onChange, options, allLabel, testid }: {
  label: string; value: string; onChange: (v: string) => void; options: readonly string[]; allLabel: string; testid: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9" data-testid={testid}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${tone ?? "bg-muted text-foreground"}`}>
      <span className="font-bold">{value}</span> {label}
    </span>
  );
}
