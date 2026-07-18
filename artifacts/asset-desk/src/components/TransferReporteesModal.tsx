import { useState, useEffect, useMemo } from "react";
import { ArrowRight, Users as UsersIcon, AlertTriangle, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  // Reset state and pre-select every affected employee whenever the modal opens
  // or the affected list changes.
  useEffect(() => {
    if (open) {
      setNewManagerEmail("");
      setSaving(false);
      setSearch("");
      setConfirming(false);
      setSelectedIds(new Set(affectedUsers.map(u => u.id)));
    }
  }, [open, affectedUsers]);

  const newManager = users.find(u => u.email === newManagerEmail);
  const affectedIds = useMemo(() => new Set(affectedUsers.map(u => u.id)), [affectedUsers]);
  const targetIsAffected = !!newManager && affectedIds.has(newManager.id);
  const targetIsSameManager = !!fromManager && newManager?.id === fromManager.id;
  const targetIsInactive = !!newManager && newManager.status === "inactive";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return affectedUsers;
    return affectedUsers.filter(u =>
      u.full_name.toLowerCase().includes(q) ||
      (u.ecode ?? "").toLowerCase().includes(q) ||
      (u.department ?? "").toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q),
    );
  }, [affectedUsers, search]);

  // Chosen employees, minus any that already report to the selected manager.
  const chosen = affectedUsers.filter(u => selectedIds.has(u.id));
  const usersToChange = newManager
    ? chosen.filter(u => (u.reporting_manager ?? "") !== newManager.email)
    : chosen;
  const alreadyOnTarget = chosen.length - usersToChange.length;
  const allChosenAlreadyOnTarget = !!newManager && chosen.length > 0 && usersToChange.length === 0;

  const allFilteredSelected = filtered.length > 0 && filtered.every(u => selectedIds.has(u.id));

  const toggle = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleSelectAll = () =>
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach(u => next.delete(u.id));
      else filtered.forEach(u => next.add(u.id));
      return next;
    });

  const canProceed =
    usersToChange.length > 0 &&
    !!newManagerEmail &&
    !targetIsAffected &&
    !targetIsSameManager &&
    !targetIsInactive &&
    !saving;

  const fromLabel = fromManager
    ? fromManager.full_name
    : "their current managers";
  const toLabel = newManager?.full_name ?? newManagerEmail;

  const handleConfirm = async () => {
    if (!canProceed) return;
    setSaving(true);
    try {
      const result = await changeReportingManager(
        usersToChange.map(u => u.id),
        newManagerEmail,
      );
      toast({
        title: "Reportees transferred",
        description: `Successfully transferred ${result.count} employee${result.count === 1 ? "" : "s"} from ${fromLabel} to ${toLabel}.`,
      });
      onOpenChange(false);
      onDone?.();
    } catch (err) {
      toast({
        title: "Failed to transfer reportees",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setConfirming(false);
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
              : <>Set a new reporting manager for the selected employee{affectedUsers.length === 1 ? "" : "s"}.</>}
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          /* ── Confirmation step ─────────────────────────────────────────── */
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3.5">
              <ArrowRight className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                Transfer <strong>{usersToChange.length}</strong> employee{usersToChange.length === 1 ? "" : "s"} from{" "}
                <strong>{fromLabel}</strong> to <strong>{toLabel}</strong>?
                {alreadyOnTarget > 0 && (
                  <span className="block text-xs text-muted-foreground mt-1">
                    {alreadyOnTarget} already report{alreadyOnTarget === 1 ? "s" : ""} to this manager and will be skipped.
                  </span>
                )}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={saving}>Cancel</Button>
              <Button onClick={handleConfirm} disabled={saving} className="gap-2" data-testid="button-confirm-transfer">
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Transferring…
                  </span>
                ) : (<><ArrowRight className="h-4 w-4" /> Confirm Transfer</>)}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          /* ── Selection step ────────────────────────────────────────────── */
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
              {targetIsInactive && (
                <p className="text-xs text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> This manager is inactive — pick an active user.
                </p>
              )}
              {allChosenAlreadyOnTarget && !targetIsSameManager && (
                <p className="text-xs text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> Everyone selected already reports to this manager.
                </p>
              )}
              {!allChosenAlreadyOnTarget && alreadyOnTarget > 0 && !targetIsAffected && (
                <p className="text-xs text-amber-600 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> {alreadyOnTarget} already report{alreadyOnTarget === 1 ? "s" : ""} to this manager and will be skipped.
                </p>
              )}
            </div>

            {/* Reportee multi-select */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {selectedIds.size} of {affectedUsers.length} selected
                </p>
                {filtered.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-xs font-medium text-primary hover:underline"
                    data-testid="button-select-all-reportees"
                  >
                    {allFilteredSelected ? "Deselect all" : "Select all"}
                  </button>
                )}
              </div>

              {affectedUsers.length > 6 && (
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name, E-code, or department…"
                    className="pl-8 h-9 text-sm"
                  />
                </div>
              )}

              {affectedUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No employees to transfer.</p>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground py-3 text-center">No employees match your search.</p>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {filtered.map(u => {
                    const checked = selectedIds.has(u.id);
                    return (
                      <label
                        key={u.id}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border cursor-pointer accent-primary flex-shrink-0"
                          checked={checked}
                          onChange={() => toggle(u.id)}
                          data-testid={`checkbox-reportee-${u.id}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{u.full_name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {u.ecode ? `${u.ecode} · ` : ""}{u.department || u.email}
                          </p>
                        </div>
                        <span className="text-[11px] text-muted-foreground flex-shrink-0">
                          was: {managerDisplayName(u.reporting_manager, users)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
              <Button onClick={() => setConfirming(true)} disabled={!canProceed} className="gap-2" data-testid="button-review-transfer">
                <ArrowRight className="h-4 w-4" /> Transfer {usersToChange.length > 0 ? usersToChange.length : ""} {usersToChange.length === 1 ? "Report" : "Reports"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
