import { useState, useEffect } from "react";
import { ArrowRight, Users as UsersIcon, AlertTriangle, UserCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import ManagerSearchField from "@/components/ManagerSearchField";
import { Profile } from "@/data/mockData";
import { useUsers } from "@/context/UsersContext";
import { useToast } from "@/hooks/use-toast";
import { managerDisplayName } from "@/lib/reportingManager";
import { cn } from "@/lib/utils";

interface Props {
  open:          boolean;
  onOpenChange:  (v: boolean) => void;
  /** Employees whose reporting manager will be changed. */
  affectedUsers: Profile[];
  /** Optional manager being transferred away from (manager-transfer mode). */
  fromManager?:  Profile | null;
  /** Title override. */
  title?:        string;
  onDone?:       () => void;
}

export default function TransferReporteesModal({
  open, onOpenChange, affectedUsers, fromManager, title, onDone,
}: Props) {
  const { users, changeReportingManager } = useUsers();
  const { toast } = useToast();
  const [newManagerEmail, setNewManagerEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setNewManagerEmail(""); setSaving(false); }
  }, [open]);

  const count = affectedUsers.length;
  const newManager = users.find(u => u.email === newManagerEmail);

  // Guard: prevent assigning reportees to one of the moved employees, or to the
  // same manager they already report to.
  const affectedIds = new Set(affectedUsers.map(u => u.id));
  const targetIsAffected = !!newManager && affectedIds.has(newManager.id);
  const targetIsSameManager = !!fromManager && newManager?.id === fromManager.id;

  // In selection/bulk mode (no single fromManager), some selected employees may
  // already report to the chosen manager — skip them to avoid no-op history rows.
  const usersToChange = newManager
    ? affectedUsers.filter(u => (u.reporting_manager ?? "") !== newManager.email)
    : affectedUsers;
  const alreadyOnTarget = count - usersToChange.length;
  const allAlreadyOnTarget = !!newManager && usersToChange.length === 0 && count > 0;

  const canSubmit =
    usersToChange.length > 0 &&
    !!newManagerEmail &&
    !targetIsAffected &&
    !targetIsSameManager &&
    !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const result = await changeReportingManager(
        usersToChange.map(u => u.id),
        newManagerEmail,
      );
      toast({
        title: "Reportees transferred",
        description: `${result.count} employee${result.count === 1 ? "" : "s"} now report${result.count === 1 ? "s" : ""} to ${newManager?.full_name ?? newManagerEmail}.`,
      });
      onOpenChange(false);
      onDone?.();
    } catch (err) {
      toast({
        title: "Failed to transfer reportees",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4" /> {title ?? "Transfer Reportees"}
          </DialogTitle>
          <DialogDescription>
            {fromManager
              ? <>Reassign the direct reports of <strong>{fromManager.full_name}</strong> to a new reporting manager.</>
              : <>Set a new reporting manager for the selected employee{count === 1 ? "" : "s"}.</>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* From → To summary */}
          {fromManager && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">From</p>
                <p className="font-medium text-foreground truncate">{fromManager.full_name}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">To</p>
                <p className={cn("font-medium truncate", newManager ? "text-foreground" : "text-muted-foreground")}>
                  {newManager?.full_name ?? "Select a manager"}
                </p>
              </div>
            </div>
          )}

          {/* New manager picker */}
          <div className="space-y-2">
            <label className="text-sm font-medium">New Reporting Manager</label>
            <ManagerSearchField
              value={newManagerEmail}
              onChange={setNewManagerEmail}
              users={users}
              excludeEmail={fromManager?.email}
              disabled={saving}
            />
            {targetIsAffected && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> This person is one of the employees being moved — pick someone else.
              </p>
            )}
            {targetIsSameManager && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> They already report to this manager.
              </p>
            )}
            {allAlreadyOnTarget && !targetIsSameManager && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Everyone selected already reports to this manager.
              </p>
            )}
            {!allAlreadyOnTarget && alreadyOnTarget > 0 && !targetIsAffected && (
              <p className="text-xs text-amber-600 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> {alreadyOnTarget} already report{alreadyOnTarget === 1 ? "s" : ""} to this manager and will be skipped.
              </p>
            )}
          </div>

          {/* Affected employees preview */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {count} employee{count === 1 ? "" : "s"} affected
            </p>
            {count === 0 ? (
              <p className="text-sm text-muted-foreground">No employees to transfer.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {affectedUsers.map(u => (
                  <div key={u.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <UserCircle className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{u.full_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {u.ecode ? `${u.ecode} · ` : ""}{u.department || u.email}
                      </p>
                    </div>
                    <span className="text-[11px] text-muted-foreground flex-shrink-0">
                      was: {managerDisplayName(u.reporting_manager, users)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} className="gap-2" data-testid="button-confirm-transfer">
            {saving ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                Transferring…
              </span>
            ) : (<><ArrowRight className="h-4 w-4" /> Transfer {usersToChange.length > 0 ? usersToChange.length : ""} {usersToChange.length === 1 ? "Report" : "Reports"}</>)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
