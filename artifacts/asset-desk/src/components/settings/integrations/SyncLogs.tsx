import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FileClock } from "lucide-react";

export default function SyncLogs() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Sync Logs</CardTitle>
        <CardDescription className="text-xs">
          A record of every HR sync — start/finish time, status, and how many employees were fetched, created, updated, or detected as offboarding.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center" data-testid="empty-sync-logs">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <FileClock className="h-6 w-6 text-muted-foreground/40" />
          </div>
          <p className="text-sm font-medium text-foreground">No sync logs yet</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Once an HR portal is connected and a sync runs, each run will appear here with its results and any errors.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
