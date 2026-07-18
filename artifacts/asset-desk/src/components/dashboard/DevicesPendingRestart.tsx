import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RotateCcw, Bell, CalendarClock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { RestartPendingDevice, RESTART_THRESHOLD_OPTIONS } from "@/lib/restartPending";

const TOP_N = 10;

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

interface Props {
  devices:      RestartPendingDevice[];
  loading:      boolean;
  error:        string | null;
  refresh:      () => Promise<void>;
  thresholdDays: number;
  onThresholdChange: (days: number) => void;
}

export default function DevicesPendingRestart({
  devices, loading, error, refresh, thresholdDays, onThresholdChange,
}: Props) {
  const { toast } = useToast();
  const [showAll, setShowAll] = useState(false);
  // Single in-flight guard: disables every action button while one request is
  // pending so a device can't be double-submitted.
  const [actionBusy, setActionBusy] = useState(false);

  async function requestRestart(
    device: RestartPendingDevice,
    type: "notify_restart" | "schedule_restart",
  ) {
    if (actionBusy) return;
    if (!device.assetUuid) {
      toast({
        title: "Cannot send request",
        description: "This device is not linked to an asset record.",
        variant: "destructive",
      });
      return;
    }
    setActionBusy(true);
    const { data, error: rpcError } = await supabase.rpc("request_device_command", {
      p_asset_id:     device.assetUuid,
      p_command_type: type,
      p_payload:      { reason: "IT has requested this device be restarted." },
    });
    setActionBusy(false);
    if (rpcError || !data?.success) {
      toast({
        title: "Restart request failed",
        description: rpcError?.message ?? data?.error,
        variant: "destructive",
      });
      return;
    }
    toast(
      type === "notify_restart"
        ? {
            title: "Restart reminder sent",
            description: `${device.employeeName} will be asked to restart when convenient.`,
          }
        : {
            title: "Restart scheduled",
            description: `${device.employeeName} is warned now; the device restarts after a 10-minute grace period.`,
          },
    );
    await refresh();
  }

  const visible = showAll ? devices : devices.slice(0, TOP_N);

  return (
    <Card id="devices-pending-restart" className="border-amber-200">
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-700">
          <RotateCcw className="h-4 w-4" />
          Devices Pending Restart
          {!loading && !error && devices.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5">
              {devices.length}
            </span>
          )}
        </CardTitle>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">Uptime over</span>
          <select
            value={thresholdDays}
            onChange={(e) => { onThresholdChange(Number(e.target.value)); setShowAll(false); }}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Restart threshold in days"
          >
            {RESTART_THRESHOLD_OPTIONS.map((d) => (
              <option key={d} value={d}>{d} days</option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="px-4 py-10 text-center">
            <RotateCcw className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3 animate-spin" />
            <p className="text-sm text-muted-foreground">Loading device uptime…</p>
          </div>
        ) : error ? (
          <div className="m-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700">Couldn't load device data</p>
              <p className="text-xs text-red-600/80 mt-0.5">{error}</p>
              <button
                onClick={() => void refresh()}
                className="text-xs font-semibold text-red-600 hover:underline mt-1.5"
              >
                Try again
              </button>
            </div>
          </div>
        ) : devices.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500/60 mb-3" />
            <p className="text-sm text-muted-foreground">All devices are recently restarted.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              No managed laptop has been up for more than {thresholdDays} days.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Employee", "Asset / Laptop", "Department", "Manager", "Last Restart", "Uptime", "Status", ""].map((h, i) => (
                      <th key={i} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((d) => (
                    <tr key={d.assetUuid ?? d.hostname} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 text-foreground font-medium whitespace-nowrap">{d.employeeName}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-mono text-xs text-primary font-semibold">{d.assetTag}</div>
                        <div className="text-xs text-muted-foreground">{d.hostname}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{d.department}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{d.managerName}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{fmtDateTime(d.lastRestart)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                          {d.uptimeDisplay}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${d.deviceStatus === "Online" ? "text-emerald-600" : "text-muted-foreground"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${d.deviceStatus === "Online" ? "bg-emerald-500" : "bg-gray-400"}`} />
                          {d.deviceStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 justify-end">
                          <Button
                            variant="outline" size="sm"
                            className="h-7 gap-1.5 text-xs"
                            disabled={actionBusy || !d.assetUuid}
                            onClick={() => void requestRestart(d, "notify_restart")}
                            title="Send the user a restart reminder"
                          >
                            <Bell className="h-3.5 w-3.5" />Notify
                          </Button>
                          <Button
                            variant="outline" size="sm"
                            className="h-7 gap-1.5 text-xs text-amber-700 border-amber-200 hover:bg-amber-50"
                            disabled={actionBusy || !d.assetUuid}
                            onClick={() => void requestRestart(d, "schedule_restart")}
                            title="Warn the user and restart after a 10-minute grace period"
                          >
                            <CalendarClock className="h-3.5 w-3.5" />Schedule
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {devices.length > TOP_N && (
              <div className="px-4 py-2.5 border-t border-border text-center">
                <button
                  onClick={() => setShowAll((v) => !v)}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  {showAll ? "Show less" : `View all ${devices.length} devices`}
                </button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
