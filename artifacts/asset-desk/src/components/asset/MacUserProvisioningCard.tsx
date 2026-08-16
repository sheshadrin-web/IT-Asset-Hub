import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, KeyRound, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ProvisioningStatus = "not_provisioned" | "pending" | "provisioning" | "provisioned" | "failed";

interface ProvisioningState {
  provisioning_status?: ProvisioningStatus;
  employee_code?: string | null;
  employee_name?: string | null;
  employee_email?: string | null;
  os_username?: string | null;
  account_type?: string | null;
  platform?: string | null;
  requested_at?: string | null;
  provisioned_at?: string | null;
  last_error?: string | null;
}

interface Props {
  assetId: string;
  assignedUser?: { id?: string; name?: string; email?: string; ecode?: string };
  device?: {
    status?: string | null;
    is_managed?: boolean | null;
    os_name?: string | null;
  } | null;
  isAdmin: boolean;
}

function isMac(device: Props["device"]): boolean {
  const value = String(device?.os_name ?? "").toLowerCase();
  return value.includes("mac") || value.includes("darwin");
}

function formatDate(value?: string | null): string {
  return value
    ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "—";
}

export default function MacUserProvisioningCard({ assetId, assignedUser, device, isAdmin }: Props) {
  const { toast } = useToast();
  const [state, setState] = useState<ProvisioningState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    if (!supabaseConfigured || !assetId) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.rpc("get_user_provisioning", { p_asset_id: assetId });
    if (!error && data?.success) setState(data as ProvisioningState);
    setLoading(false);
  }, [assetId]);

  useEffect(() => { void load(); }, [load]);

  const status = state?.provisioning_status ?? "not_provisioned";
  const eligible = !!assignedUser?.ecode
    && !!device
    && device.status === "online"
    && device.is_managed === true
    && isMac(device);
  const inFlight = status === "pending" || status === "provisioning";

  useEffect(() => {
    if (!inFlight) return;
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [inFlight, load]);

  async function requestPush() {
    setBusy(true);
    const { data, error } = await supabase.rpc("request_user_provisioning", { p_asset_id: assetId });
    setBusy(false);
    setConfirmOpen(false);
    if (error || !data?.success) {
      toast({
        title: "User Push failed",
        description: error?.message ?? data?.error ?? "Could not queue provisioning.",
        variant: "destructive",
      });
      await load();
      return;
    }
    toast({
      title: data.idempotent ? "User already provisioned" : "User Push queued",
      description: data.idempotent
        ? "The employee account is already recorded as provisioned."
        : "The macOS agent will process the request on its next command poll.",
    });
    await load();
  }

  if (!isMac(device) && !state) return null;

  return (
    <>
      <Card data-testid="card-mac-user-provisioning">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <UserRound className="h-4 w-4 text-muted-foreground" />
            Employee OS Account
            <span className="ml-auto text-[11px] font-medium text-muted-foreground">macOS only</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading provisioning state…</p>
          ) : !assignedUser?.name ? (
            <p className="text-xs text-muted-foreground">Assign an active employee before pushing a user to this Mac.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Assigned Employee</p>
                  <p className="font-medium">{assignedUser.name}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Employee Code</p>
                  <p className="font-mono font-medium">{state?.employee_code ?? assignedUser.ecode ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">macOS Username</p>
                  <p className="font-mono font-medium">{state?.os_username ?? assignedUser.ecode?.toLowerCase() ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Account Type</p>
                  <p className="font-medium">Standard User</p>
                </div>
              </div>

              {status === "provisioned" ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <CheckCircle2 className="h-4 w-4" /> User Provisioned
                  </p>
                  <p className="mt-1 text-[11px]">Provisioned at {formatDate(state?.provisioned_at)}.</p>
                </div>
              ) : status === "failed" ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <CircleAlert className="h-4 w-4" /> User Provisioning Failed
                  </p>
                  <p className="mt-1 break-words text-[11px]">{state?.last_error ?? "The agent reported a failure."}</p>
                </div>
              ) : inFlight ? (
                <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sky-800">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <Loader2 className="h-4 w-4 animate-spin" /> Provisioning employee account…
                  </p>
                  <p className="mt-1 text-[11px]">Waiting for the macOS device agent.</p>
                </div>
              ) : (
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                  <p className="text-xs font-semibold text-foreground">Not Provisioned</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Acknowledgement remains independent from User Push.
                  </p>
                </div>
              )}

              {status !== "provisioned" && (
                <Button
                  className="w-full gap-2"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!isAdmin || !eligible || inFlight || busy}
                  data-testid="button-push-user"
                >
                  <KeyRound className="h-4 w-4" />
                  {status === "failed" ? "Retry User Push" : "Push User to Device"}
                </Button>
              )}
              {!eligible && status !== "provisioned" && (
                <p className="text-[11px] text-muted-foreground">
                  User Push requires an assigned active employee and an online managed macOS agent.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create employee account on this Mac?</DialogTitle>
            <DialogDescription>
              This is an explicit IT action and does not change acknowledgement status.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <p><span className="text-muted-foreground">Employee:</span> <b>{assignedUser?.name}</b></p>
            <p><span className="text-muted-foreground">Employee Code:</span> <b className="font-mono">{assignedUser?.ecode}</b></p>
            <p><span className="text-muted-foreground">macOS Username:</span> <b className="font-mono">{assignedUser?.ecode?.toLowerCase()}</b></p>
            <p><span className="text-muted-foreground">Account Type:</span> <b>Standard User</b></p>
            <div className="flex items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>The permanent IT administrator <b>miles-it-support</b> will not be modified.</span>
            </div>
          </div>
          <p className="text-xs text-amber-700">
            The current agent channel does not yet provide secure one-time password delivery. The agent will fail closed rather than create an account with an unsafe or undisclosed password.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={() => void requestPush()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Push User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}