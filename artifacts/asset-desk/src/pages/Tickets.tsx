import { useState } from "react";
import { Link } from "wouter";
import {
  Plus, Search, MoreHorizontal, Eye, UserCheck, Trash2, X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTickets } from "@/context/TicketContext";
import { useAuth } from "@/context/AuthContext";
import { TicketStatus, TicketPriority } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PRIORITY_COLORS: Record<TicketPriority, string> = {
  Critical: "bg-red-500/15 text-red-500 border-red-500/20",
  High:     "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Medium:   "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Low:      "bg-gray-500/15 text-gray-500 border-gray-500/20",
};
const PRIORITY_DOT: Record<TicketPriority, string> = {
  Critical: "bg-red-500",
  High:     "bg-amber-500",
  Medium:   "bg-blue-500",
  Low:      "bg-gray-400",
};
const STATUS_COLORS: Record<TicketStatus, string> = {
  Open:               "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Assigned:           "bg-purple-500/15 text-purple-600 border-purple-500/20",
  "In Progress":      "bg-amber-500/15 text-amber-600 border-amber-500/20",
  "Waiting for User": "bg-orange-500/15 text-orange-600 border-orange-500/20",
  Resolved:           "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Closed:             "bg-gray-500/15 text-gray-500 border-gray-500/20",
  Rejected:           "bg-red-500/15 text-red-500 border-red-500/20",
};

export default function Tickets() {
  const { tickets, updateTicket, deleteTicket, deleteTickets } = useTickets();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [search, setSearch]               = useState("");
  const [statusFilter, setStatusFilter]   = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [deleteTarget, setDeleteTarget]   = useState<string | null>(null);

  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const isEndUser = currentUser?.role === "end_user";
  const isAdmin   = currentUser?.role === "super_admin" || currentUser?.role === "it_admin";
  const isAgent   = currentUser?.role === "it_agent";

  const base = isEndUser
    ? tickets.filter((t) => t.raisedBy === currentUser?.name)
    : tickets;

  const filtered = base.filter((t) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      t.ticketId.toLowerCase().includes(q) ||
      t.raisedBy.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      t.assetId.toLowerCase().includes(q) ||
      t.assignedAgent.toLowerCase().includes(q);
    const matchStatus   = statusFilter   === "all" || t.status   === statusFilter;
    const matchPriority = priorityFilter === "all" || t.priority === priorityFilter;
    return matchSearch && matchStatus && matchPriority;
  });

  const counts = {
    open:       base.filter((t) => t.status === "Open").length,
    inProgress: base.filter((t) => t.status === "In Progress").length,
    resolved:   base.filter((t) => t.status === "Resolved").length,
    closed:     base.filter((t) => t.status === "Closed").length,
  };

  const allFilteredIds  = filtered.map((t) => t.ticketId);
  const allSelected     = allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.has(id));
  const someSelected    = allFilteredIds.some((id) => selected.has(id)) && !allSelected;
  const selectedCount   = [...selected].filter((id) => allFilteredIds.includes(id)).length;

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => { const n = new Set(prev); allFilteredIds.forEach((id) => n.delete(id)); return n; });
    } else {
      setSelected((prev) => new Set([...prev, ...allFilteredIds]));
    }
  };
  const toggleRow = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleAssignToSelf = async (ticketId: string) => {
    if (!currentUser) return;
    try {
      await updateTicket(ticketId, { assignedAgent: currentUser.name, status: "Assigned" });
      toast({ title: "Ticket assigned to you", description: ticketId });
    } catch {
      toast({ title: "Failed to assign", variant: "destructive" });
    }
  };

  const handleDeleteSingle = async (ticketId: string) => {
    try {
      await deleteTicket(ticketId);
      setDeleteTarget(null);
      toast({ title: "Ticket deleted", description: ticketId });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selected].filter((id) => allFilteredIds.includes(id));
    try {
      await deleteTickets(ids);
      setSelected(new Set());
      setBulkDeleteOpen(false);
      toast({ title: `${ids.length} ticket${ids.length !== 1 ? "s" : ""} deleted` });
    } catch {
      toast({ title: "Failed to delete tickets", variant: "destructive" });
    }
  };

  const colSpan = isAdmin ? 10 : 9;

  return (
    <div className="space-y-5 pb-20">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">
            {isEndUser ? "My Tickets" : "Ticket Management"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isEndUser ? `${base.length} tickets raised by you` : `${base.length} total tickets`}
          </p>
        </div>
        <Link href="/tickets/new">
          <Button className="gap-2" data-testid="button-raise-ticket">
            <Plus className="h-4 w-4" /> Raise Ticket
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { label: "Open",        val: counts.open,       color: "bg-blue-50 text-blue-700 border-blue-200" },
          { label: "In Progress", val: counts.inProgress, color: "bg-amber-50 text-amber-700 border-amber-200" },
          { label: "Resolved",    val: counts.resolved,   color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
          { label: "Closed",      val: counts.closed,     color: "bg-gray-50 text-gray-600 border-gray-200" },
        ].map((chip) => (
          <span
            key={chip.label}
            className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity", chip.color)}
            onClick={() => setStatusFilter(statusFilter === chip.label ? "all" : chip.label)}
          >
            <span className="font-bold">{chip.val}</span> {chip.label}
          </span>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ticket ID, user, category, asset…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-tickets"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-52" data-testid="select-ticket-status">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {(["Open","Assigned","In Progress","Waiting for User","Resolved","Closed","Rejected"] as TicketStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-full sm:w-40" data-testid="select-ticket-priority">
                <SelectValue placeholder="All Priorities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                {(["Critical","High","Medium","Low"] as TicketPriority[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    <span className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", PRIORITY_DOT[p])} /> {p}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {isAdmin && (
                    <th className="w-10 px-3 py-3">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Select all"
                        data-testid="checkbox-select-all-tickets"
                        className={someSelected ? "data-[state=unchecked]:bg-primary/20" : ""}
                      />
                    </th>
                  )}
                  {["Ticket ID","Raised By","Asset ID","Category","Priority","Status","Assigned Agent","Created","Actions"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={colSpan} className="px-4 py-14 text-center text-muted-foreground text-sm">
                      No tickets match your filters.
                    </td>
                  </tr>
                )}
                {filtered.map((ticket) => {
                  const isSelected = selected.has(ticket.ticketId);
                  return (
                    <tr
                      key={ticket.ticketId}
                      className={cn(
                        "border-b border-border last:border-0 transition-colors",
                        isSelected ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-muted/25"
                      )}
                      data-testid={`row-ticket-${ticket.ticketId}`}
                    >
                      {isAdmin && (
                        <td className="w-10 px-3 py-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleRow(ticket.ticketId)}
                            aria-label={`Select ${ticket.ticketId}`}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <Link href={`/tickets/${ticket.ticketId}`} className="font-semibold text-primary hover:underline">
                          {ticket.ticketId}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6 flex-shrink-0">
                            <AvatarFallback className="text-[10px] bg-muted text-muted-foreground font-semibold">
                              {ticket.raisedBy.split(" ").map((n) => n[0]).join("")}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm text-foreground">{ticket.raisedBy}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {ticket.assetId !== "N/A" ? (
                          <Link href={`/assets/${ticket.assetId}`} className="text-primary hover:underline text-xs font-medium">
                            {ticket.assetId}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-foreground text-sm leading-tight">{ticket.category}</div>
                        <div className="text-xs text-muted-foreground">{ticket.subcategory}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium", PRIORITY_COLORS[ticket.priority])}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", PRIORITY_DOT[ticket.priority])} />
                          {ticket.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", STATUS_COLORS[ticket.status])}>
                          {ticket.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {ticket.assignedAgent
                          ? <span className="text-foreground">{ticket.assignedAgent}</span>
                          : <span className="text-muted-foreground/60 text-xs">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{ticket.createdDate}</td>
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-actions-${ticket.ticketId}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem asChild>
                              <Link href={`/tickets/${ticket.ticketId}`} className="flex items-center gap-2 cursor-pointer">
                                <Eye className="h-3.5 w-3.5 text-muted-foreground" /> View Details
                              </Link>
                            </DropdownMenuItem>
                            {(isAgent || isAdmin) && !ticket.assignedAgent && (
                              <DropdownMenuItem onClick={() => handleAssignToSelf(ticket.ticketId)} className="flex items-center gap-2 cursor-pointer">
                                <UserCheck className="h-3.5 w-3.5 text-blue-500" /> Assign to Me
                              </DropdownMenuItem>
                            )}
                            {isAdmin && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => setDeleteTarget(ticket.ticketId)}
                                  className="flex items-center gap-2 cursor-pointer text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && (
            <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
              Showing {filtered.length} of {base.length} tickets
              {selectedCount > 0 && (
                <span className="ml-2 text-primary font-medium">· {selectedCount} selected</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-border bg-popover shadow-xl px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Checkbox checked className="pointer-events-none" />
            <span>{selectedCount} ticket{selectedCount !== 1 ? "s" : ""} selected</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <Button size="sm" variant="destructive" className="gap-2" onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete {selectedCount}
          </Button>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ticket</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDeleteSingle(deleteTarget)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} Ticket{selectedCount !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the selected ticket{selectedCount !== 1 ? "s" : ""} from the system. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
