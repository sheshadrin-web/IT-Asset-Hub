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
type CredentialStatus = "prepared" | "available" | "consumed" | "expired" | "revoked";

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
  credential_status?: CredentialStatus | null;
  credential_expires_at?: string | null;
  wallpaper_status?: "applied" | "pending" | "failed" | null;
  wallpaper_error?: string | null;
  reset_status?: "prepared" | "available" | "consumed" | "expired" | "revoked" | null;
}

interface Props {
  assetId: string;
  assetTag?: string;
  assignedUser?: { id?: string; name?: string; email?: string; ecode?: string };
  device?: {
    status?: string | null;
    is_managed?: boolean | null;
    os_name?: string | null;
  } | null;
  isAdmin: boolean;
}

function platformLabel(device: Props["device"]): string | null {
  const value = String(device?.os_name ?? "").toLowerCase();
  if (value.includes("mac") || value.includes("darwin")) return "macOS";
  if (value.includes("windows") || value.includes("win32")) return "Windows";
  if (value.includes("ubuntu") || value.includes("linux") || value.includes("debian")
    || value.includes("fedora") || value.includes("rhel") || value.includes("red hat")) {
    return "Ubuntu/Linux";
  }
  return null;
}

function formatDate(value?: string | null): string {
  return value
    ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "—";
}

export default function MacUserProvisioningCard({ assetId, assetTag, assignedUser, device, isAdmin }: Props) {
  const { toast } = useToast();
  const [state, setState] = useState<ProvisioningState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealPurpose, setRevealPurpose] = useState<"provisioning" | "password_reset">("provisioning");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");

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
  const platform = state?.platform ?? platformLabel(device);
  const supportedPlatform = !!platform;
  const eligible = !!assignedUser?.ecode
    && !!device
    && device.status === "online"
    && device.is_managed === true
    && supportedPlatform;
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
        : "The device agent will process the request on its next command poll.",
    });
    await load();
  }

  async function revealCredential(purpose: "provisioning" | "password_reset" = "provisioning") {
    setRevealBusy(true);
    const { data, error } = await supabase.functions.invoke("provisioning-credentials", {
      body: { asset_id: assetId, ...(purpose === "password_reset" ? { purpose } : {}) },
    });
    setRevealBusy(false);
    setRevealOpen(false);
    if (error || !data?.success || typeof data.password !== "string") {
      toast({
        title: "Temporary password unavailable",
        description: error?.message ?? data?.error ?? "The credential may have expired or already been consumed.",
        variant: "destructive",
      });
      await load();
      return;
    }
    setRevealPurpose(purpose);
    setRevealedPassword(data.password);
    setPasswordOpen(true);
  }

  function generateSecurePassword() {
    const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!#$%+,-.:=@^_";
    const values = new Uint32Array(28);
    crypto.getRandomValues(values);
    setResetPassword(Array.from(values, value => alphabet[value % alphabet.length]).join(""));
    setResetConfirm("");
  }

  async function requestPasswordReset() {
    if (resetPassword.length < 20 || resetPassword !== resetConfirm) {
      toast({
        title: "Password reset not ready",
        description: resetPassword.length < 20
          ? "Use a temporary password with at least 20 characters."
          : "The confirmation does not match.",
        variant: "destructive",
      });
      return;
    }
    setResetBusy(true);
    const { data, error } = await supabase.functions.invoke("provisioning-credentials", {
      body: { asset_id: assetId, purpose: "password_reset", password: resetPassword },
    });
    setResetBusy(false);
    if (error || !data?.success) {
      toast({
        title: "Password reset failed",
        description: error?.message ?? data?.error ?? "Could not queue the reset.",
        variant: "destructive",
      });
      await load();
      return;
    }
    setResetOpen(false);
    setResetPassword("");
    setResetConfirm("");
    toast({
      title: "Password reset queued",
      description: "The macOS agent will replace the employee password on its next command poll.",
    });
    await load();
  }

  if (!supportedPlatform && !state) return null;

  return (
    <>
      <Card data-testid="card-mac-user-provisioning">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <UserRound className="h-4 w-4 text-muted-foreground" />
            Employee OS Account
            <span className="ml-auto text-[11px] font-medium text-muted-foreground">{platform ?? "Unsupported OS"}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading provisioning state…</p>
           ) : !assignedUser?.name ? (
             <p className="text-xs text-muted-foreground">Assign an active employee before pushing a user to this device.</p>
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
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">OS Username</p>
                  <p className="font-mono font-medium">{state?.os_username ?? assignedUser.ecode?.toLowerCase() ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Account Type</p>
                  <p className="font-medium">Standard User</p>
                </div>
                   {platform === "macOS" && <div className="mt-3 border-t border-emerald-200 pt-2">
                     <p className="text-[11px] uppercase tracking-wide text-emerald-700">OS Password Reset</p>
                     {state?.reset_status === "available" ? (
                       <Button
                         size="sm"
                         variant="outline"
                         className="mt-1 h-8 gap-1.5"
                         onClick={() => { setRevealPurpose("password_reset"); setRevealOpen(true); }}
                         disabled={revealBusy}
                       >
                         <KeyRound className="h-3.5 w-3.5" /> Reveal Reset Password Once
                       </Button>
                     ) : (
                       <p className="mt-1 text-xs font-semibold text-emerald-800">
                         {state?.reset_status === "prepared" ? "Reset queued" :
                           state?.reset_status === "expired" ? "Expired" :
                           state?.reset_status === "consumed" ? "Revealed / Consumed" : "Not requested"}
                       </p>
                     )}
                    </div>}
              </div>

              {status === "provisioned" ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <CheckCircle2 className="h-4 w-4" /> User Provisioned
                  </p>
                  <p className="mt-1 text-[11px]">Provisioned at {formatDate(state?.provisioned_at)}.</p>
                   <div className="mt-3 border-t border-emerald-200 pt-2">
                     <p className="text-[11px] uppercase tracking-wide text-emerald-700">Wallpaper</p>
                     <p className={cn(
                       "mt-1 text-xs font-semibold",
                       state?.wallpaper_status === "applied" ? "text-emerald-800" :
                         state?.wallpaper_status === "failed" ? "text-red-700" : "text-amber-700",
                     )}>
                       {state?.wallpaper_status === "applied" ? "Applied" :
                         state?.wallpaper_status === "failed" ? "Failed" : "Pending"}
                     </p>
                     {state?.wallpaper_error ? (
                       <p className="mt-1 text-[11px] text-muted-foreground">{state.wallpaper_error}</p>
                     ) : null}
                   </div>
                  <div className="mt-3 border-t border-emerald-200 pt-2">
                    <p className="text-[11px] uppercase tracking-wide text-emerald-700">Temporary Login Password</p>
                    {state?.credential_status === "available" ? (
                      <Button
                        size="sm"
                        className="mt-1 h-8 gap-1.5"
                        onClick={() => setRevealOpen(true)}
                        disabled={revealBusy}
                        data-testid="button-reveal-credential"
                      >
                        <KeyRound className="h-3.5 w-3.5" /> Reveal Once
                      </Button>
                    ) : (
                      <p className="mt-1 text-xs font-semibold text-emerald-800">
                        {state?.credential_status === "expired" ? "Expired" : "Revealed / Consumed"}
                      </p>
                    )}
                  </div>
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
                   <p className="mt-1 text-[11px]">Waiting for the {platform ?? "device"} agent.</p>
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
                {status === "provisioned" && platform === "macOS" && (
                 <Button
                   variant="outline"
                   className="w-full gap-2"
                   onClick={() => setResetOpen(true)}
                   disabled={!isAdmin || !eligible || inFlight || resetBusy}
                 >
                   <KeyRound className="h-4 w-4" /> Reset OS Password
                 </Button>
               )}
              {!eligible && status !== "provisioned" && (
                <p className="text-[11px] text-muted-foreground">
                   User Push requires an assigned active employee and an online managed agent running Windows, macOS, or Ubuntu/Linux.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create employee account on this {platform ?? "device"}?</DialogTitle>
            <DialogDescription>
              This is an explicit IT action and does not change acknowledgement status.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <p><span className="text-muted-foreground">Employee:</span> <b>{assignedUser?.name}</b></p>
            <p><span className="text-muted-foreground">Employee Code:</span> <b className="font-mono">{assignedUser?.ecode}</b></p>
            <p><span className="text-muted-foreground">OS Username:</span> <b className="font-mono">{assignedUser?.ecode?.toLowerCase()}</b></p>
            <p><span className="text-muted-foreground">Platform:</span> <b>{platform ?? "Unsupported"}</b></p>
            <p><span className="text-muted-foreground">Account Type:</span> <b>Standard User</b></p>
            <div className="flex items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>The permanent IT administrator <b>miles-it-support</b> will not be modified.</span>
            </div>
          </div>
          <p className="text-xs text-amber-700">
             A strong temporary password will be generated locally by the device agent and made available to an authorized IT administrator exactly once after successful provisioning.
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

      <Dialog open={revealOpen} onOpenChange={setRevealOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reveal {revealPurpose === "password_reset" ? "reset " : ""}temporary password once?</DialogTitle>
            <DialogDescription>
              This temporary password will only be displayed once. Copy it now and provide it securely to the employee.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
            Revealing consumes the credential immediately. It cannot be retrieved again after this action.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevealOpen(false)}>Cancel</Button>
            <Button onClick={() => void revealCredential(revealPurpose)} disabled={revealBusy}>
              {revealBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Reveal Once
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resetOpen}
        onOpenChange={(open) => {
          setResetOpen(open);
          if (!open) {
            setResetPassword("");
            setResetConfirm("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Employee OS Password</DialogTitle>
            <DialogDescription>
              This replaces the current password with a new temporary password. The existing password cannot be retrieved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <p><span className="text-muted-foreground">Employee:</span> <b>{state?.employee_name ?? assignedUser?.name}</b></p>
            <p><span className="text-muted-foreground">Employee Code:</span> <b className="font-mono">{state?.employee_code ?? assignedUser?.ecode}</b></p>
            <p><span className="text-muted-foreground">OS Username:</span> <b className="font-mono">{state?.os_username}</b></p>
            <p><span className="text-muted-foreground">Device:</span> <b>{assetTag ?? device?.os_name ?? "Managed Mac"}</b></p>
          </div>
          <div className="space-y-3">
            <label className="text-xs font-medium">New Temporary Password</label>
            <input
              type="password"
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              autoComplete="new-password"
            />
            <label className="text-xs font-medium">Confirm Temporary Password</label>
            <input
              type="password"
              value={resetConfirm}
              onChange={(event) => setResetConfirm(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              autoComplete="new-password"
            />
            <Button type="button" variant="outline" className="w-full" onClick={generateSecurePassword}>
              Generate Secure Password
            </Button>
            <p className="text-[11px] text-muted-foreground">
              The password is encrypted before it reaches the database and is never written to audit or command records.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button onClick={() => void requestPasswordReset()} disabled={resetBusy}>
              {resetBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={passwordOpen}
        onOpenChange={(open) => {
          setPasswordOpen(open);
          if (!open) {
            setRevealedPassword(null);
            void load();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Temporary Login Password</DialogTitle>
            <DialogDescription>
              Copy this password now and provide it securely to the employee. It will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="select-all rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-center font-mono text-lg font-semibold tracking-wide text-emerald-900">
            {revealedPassword}
          </div>
          <DialogFooter>
            <Button onClick={() => setPasswordOpen(false)}>Done — Password Copied</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}