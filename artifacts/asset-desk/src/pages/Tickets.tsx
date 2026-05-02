import { useState } from "react";
import { Link } from "wouter";
import {
  Plus, Search, MoreHorizontal, Eye, UserCheck, Trash2, X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const { tickets, updateTicket, deleteTicket } = useTickets();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const isEndUser  = currentUser?.role === "end_user";
  const isAdmin    = currentUser?.role === "super_admin";
  const isAgent    = currentUser?.role === "agent";

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

  const handleAssignToSelf = (ticketId: string) => {
    if (!currentUser) return;
    updateTicket(ticketId, { assignedAgent: currentUser.name, status: "Assigned" });
    toast({ title: "Ticket assigned to you", description: ticketId });
  };

  const handleDelete = (ticketId: string) => {
    deleteTicket(ticketId);
    setDeleteTarget(null);
    toast({ title: "Ticket deleted", description: ticketId });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
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

      {/* Status chips */}
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

      {/* Filters */}
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
                      <span className={cn("h-2 w-2 rounded-full", PRIORITY_DOT[p])} />
                      {p}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Ticket ID","Raised By","Asset ID","Category","Priority","Status","Assigned Agent","Created Date","Actions"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-14 text-center text-muted-foreground text-sm">
                      No tickets match your filters.
                    </td>
                  </tr>
                )}
                {filtered.map((ticket) => (
                  <tr
                    key={ticket.ticketId}
                    className="border-b border-border last:border-0 hover:bg-muted/25 transition-colors"
                    data-testid={`row-ticket-${ticket.ticketId}`}
                  >
                    {/* Ticket ID */}
                    <td className="px-4 py-3">
                      <Link
                        href={`/tickets/${ticket.ticketId}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {ticket.ticketId}
                      </Link>
                    </td>
                    {/* Raised By */}
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
                    {/* Asset ID */}
                    <td className="px-4 py-3">
                      {ticket.assetId !== "N/A" ? (
                        <Link
                          href={`/assets/${ticket.assetId}`}
                          className="text-primary hover:underline text-xs font-medium"
                        >
                          {ticket.assetId}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-xs">N/A</span>
                      )}
                    </td>
                    {/* Category */}
                    <td className="px-4 py-3">
                      <div className="text-foreground text-sm leading-tight">{ticket.category}</div>
                      <div className="text-xs text-muted-foreground">{ticket.subcategory}</div>
                    </td>
                    {/* Priority */}
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium", PRIORITY_COLORS[ticket.priority])}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", PRIORITY_DOT[ticket.priority])} />
                        {ticket.priority}
                      </span>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", STATUS_COLORS[ticket.status])}>
                        {ticket.status}
                      </span>
                    </td>
                    {/* Assigned Agent */}
                    <td className="px-4 py-3 text-sm">
                      {ticket.assignedAgent ? (
                        <span className="text-foreground">{ticket.assignedAgent}</span>
                      ) : (
                        <span className="text-muted-foreground/60 text-xs">Unassigned</span>
                      )}
                    </td>
                    {/* Created */}
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{ticket.createdDate}</td>
                    {/* Actions */}
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
                          {isAgent && !ticket.assignedAgent && (
                            <DropdownMenuItem
                              onClick={() => handleAssignToSelf(ticket.ticketId)}
                              className="flex items-center gap-2 cursor-pointer"
                            >
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
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && (
            <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
              Showing {filtered.length} of {base.length} tickets
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ticket</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
