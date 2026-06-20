import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList } from "lucide-react";
import type { ShortageRequest } from "@/lib/shortageRequests";

const PRIORITY_STYLES: Record<string, string> = {
  Critical: "bg-red-500/15 text-red-600 border-red-500/20",
  High:     "bg-orange-500/15 text-orange-600 border-orange-500/20",
  Medium:   "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Low:      "bg-slate-500/15 text-slate-600 border-slate-500/20",
};

const STATUS_STYLES: Record<string, string> = {
  Pending:   "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Approved:  "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Fulfilled: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Rejected:  "bg-red-500/15 text-red-600 border-red-500/20",
};

function fmtDate(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "—" : t.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ShortageRequestsTable({
  shortages, users, loading,
}: {
  shortages: ShortageRequest[];
  users: { id: string; full_name: string }[];
  loading: boolean;
}) {
  const nameById = new Map(users.map(u => [u.id, u.full_name]));
  const rows = [...shortages]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />Recent Shortage Requests
        </CardTitle>
        <Link href="/locations" className="text-xs text-primary hover:underline font-medium">View all →</Link>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No shortage requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Location", "Asset Type", "Qty", "Requested By", "Priority", "Status", "Date"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{r.location}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r.assetType}</td>
                    <td className="px-4 py-3 text-foreground tabular-nums">{r.quantityRequested}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{nameById.get(r.requestedBy) ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${PRIORITY_STYLES[r.priority] ?? PRIORITY_STYLES.Low}`}>
                        {r.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[r.status] ?? STATUS_STYLES.Pending}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
