import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabaseClient";
import {
  getOnboardingQueue, getOffboardingQueue, markOnboardingDone,
} from "@/lib/dashboardHrService";
import { getRecoveryAssets } from "@/lib/recoveryService";
import type { HrProfileRow, RecoveryRow, RecoveryStatus } from "@/lib/hrSyncTypes";
import RecoveryTable from "@/components/recovery/RecoveryTable";
import {
  UserPlus, UserMinus, ShieldAlert, RefreshCw, CheckCircle2, AlertCircle, Users as UsersIcon,
} from "lucide-react";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const RECOVERY_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "recovery_pending", label: "Pending" },
  { value: "recovery_in_progress", label: "In Progress" },
  { value: "not_reachable", label: "Not Reachable" },
  { value: "escalated", label: "Escalated" },
  { value: "recovered", label: "Recovered" },
  { value: "lost", label: "Lost" },
];

export default function HrQueues() {
  const { toast } = useToast();
  const { session, loading: authLoading, currentUser } = useAuth();
  const canAct = currentUser?.role === "super_admin" || currentUser?.role === "it_admin";

  const [onboarding, setOnboarding] = useState<HrProfileRow[]>([]);
  const [offboarding, setOffboarding] = useState<HrProfileRow[]>([]);
  const [recovery, setRecovery] = useState<RecoveryRow[]>([]);
  const [recoveryFilter, setRecoveryFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session) { setLoading(false); return; }
    setLoading(true);
    try {
      const status = recoveryFilter === "all" ? null : (recoveryFilter as RecoveryStatus);
      const [on, off, rec] = await Promise.all([
        getOnboardingQueue(),
        getOffboardingQueue(),
        getRecoveryAssets(status),
      ]);
      setOnboarding(on);
      setOffboarding(off);
      setRecovery(rec);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load HR queues");
    } finally {
      setLoading(false);
    }
  }, [session, authLoading, recoveryFilter]);

  useEffect(() => { void load(); }, [load]);

  const handleOnboard = async (p: HrProfileRow) => {
    setBusyId(p.id);
    try {
      await markOnboardingDone(p.id);
      toast({ title: "Marked onboarded", description: `${p.full_name ?? p.work_email ?? "Employee"} removed from the queue.` });
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: "Action failed", description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyId(null);
    }
  };

  if (!supabaseConfigured) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Supabase is not configured in this environment.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <UsersIcon className="h-5 w-5 text-primary" /> Onboarding &amp; Offboarding
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Employees detected by HR sync who need accounts &amp; assets, departures in progress, and assets being recovered.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3" data-testid="error-hr-queues">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <Tabs defaultValue="onboarding">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList>
            <TabsTrigger value="onboarding" data-testid="tab-onboarding">
              <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Onboarding
              {onboarding.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px]">{onboarding.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="offboarding" data-testid="tab-offboarding">
              <UserMinus className="h-3.5 w-3.5 mr-1.5" /> Offboarding
              {offboarding.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px]">{offboarding.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="recovery" data-testid="tab-recovery">
              <ShieldAlert className="h-3.5 w-3.5 mr-1.5" /> Asset Recovery
              {recovery.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px]">{recovery.length}</Badge>}
            </TabsTrigger>
          </TabsList>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} data-testid="button-refresh-queues">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {/* Onboarding */}
        <TabsContent value="onboarding" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">New Joiners</CardTitle>
              <CardDescription className="text-xs">
                Employees newly detected in your HR portal. Create their account and assign assets, then mark them onboarded.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>
              ) : onboarding.length === 0 ? (
                <div className="px-4 py-10 text-center" data-testid="empty-onboarding">
                  <UserPlus className="h-8 w-8 mx-auto text-muted-foreground/25 mb-3" />
                  <p className="text-sm text-muted-foreground">No pending onboarding.</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">New employees from the next HR sync will appear here.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Manager</TableHead>
                        <TableHead>Joining</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {onboarding.map(p => (
                        <TableRow key={p.id} data-testid={`onboarding-row-${p.id}`}>
                          <TableCell>
                            <div className="font-medium text-foreground">{p.full_name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{p.work_email ?? p.employee_code ?? ""}</div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            <div>{p.department ?? "—"}</div>
                            <div className="text-xs">{p.designation ?? ""}</div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.manager_name ?? "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{fmtDate(p.joining_date)}</TableCell>
                          <TableCell className="text-right">
                            {canAct ? (
                              <Button size="sm" disabled={busyId === p.id}
                                onClick={() => handleOnboard(p)} data-testid={`button-onboard-${p.id}`}>
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Onboarded
                              </Button>
                            ) : <span className="text-xs text-muted-foreground">View only</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Offboarding */}
        <TabsContent value="offboarding" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Departures</CardTitle>
              <CardDescription className="text-xs">
                Employees whose HR status indicates they are leaving or have left. Their assigned assets move into recovery.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>
              ) : offboarding.length === 0 ? (
                <div className="px-4 py-10 text-center" data-testid="empty-offboarding">
                  <UserMinus className="h-8 w-8 mx-auto text-muted-foreground/25 mb-3" />
                  <p className="text-sm text-muted-foreground">No offboarding in progress.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Working Day</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {offboarding.map(p => (
                        <TableRow key={p.id} data-testid={`offboarding-row-${p.id}`}>
                          <TableCell>
                            <div className="font-medium text-foreground">{p.full_name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{p.work_email ?? p.employee_code ?? ""}</div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.department ?? "—"}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px] capitalize">{p.employment_status ?? "—"}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{fmtDate(p.last_working_date ?? p.resignation_date)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Asset Recovery */}
        <TabsContent value="recovery" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-sm font-semibold">Asset Recovery</CardTitle>
                <CardDescription className="text-xs">
                  Devices and assets to recover from departing employees. Locate, notify, and update status as you go.
                </CardDescription>
              </div>
              <Select value={recoveryFilter} onValueChange={setRecoveryFilter}>
                <SelectTrigger className="h-9 w-[160px]" data-testid="select-recovery-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECOVERY_FILTERS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>
              ) : (
                <RecoveryTable rows={recovery} canAct={canAct} onChanged={() => void load()} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
