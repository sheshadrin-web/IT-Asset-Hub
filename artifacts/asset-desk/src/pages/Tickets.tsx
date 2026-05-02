import { useState } from "react";
import { Link } from "wouter";
import {
  Plus,
  Search,
  MoreHorizontal,
  Eye,
  Edit2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { mockTickets, Ticket, TicketStatus, TicketPriority } from "@/data/mockData";
import { useAuth } from "@/context/AuthContext";

const priorityColors: Record<TicketPriority, string> = {
  Critical: "bg-red-500/15 text-red-500 border-red-500/20",
  High: "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Medium: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Low: "bg-gray-500/15 text-gray-500 border-gray-500/20",
};

const statusColors: Record<TicketStatus, string> = {
  Open: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Assigned: "bg-purple-500/15 text-purple-600 border-purple-500/20",
  "In Progress": "bg-amber-500/15 text-amber-600 border-amber-500/20",
  "Waiting for User": "bg-orange-500/15 text-orange-600 border-orange-500/20",
  Resolved: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Closed: "bg-gray-500/15 text-gray-500 border-gray-500/20",
  Rejected: "bg-red-500/15 text-red-500 border-red-500/20",
};

export default function Tickets() {
  const { currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const isEndUser = currentUser?.role === "end_user";

  let baseTickets = mockTickets;
  if (isEndUser) {
    baseTickets = mockTickets.filter((t) => t.raisedBy === currentUser?.name);
  }

  const filtered = baseTickets.filter((t) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      t.ticketId.toLowerCase().includes(q) ||
      t.raisedBy.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      t.assetId.toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || t.status === statusFilter;
    const matchesPriority = priorityFilter === "all" || t.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Ticket Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isEndUser ? "Your tickets" : `${baseTickets.length} total tickets`}
          </p>
        </div>
        <Link href="/tickets/new">
          <Button data-testid="button-raise-ticket" className="gap-2">
            <Plus className="h-4 w-4" />
            Raise Ticket
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID, user, category, asset..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-tickets"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-48" data-testid="select-ticket-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Open">Open</SelectItem>
                <SelectItem value="Assigned">Assigned</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Waiting for User">Waiting for User</SelectItem>
                <SelectItem value="Resolved">Resolved</SelectItem>
                <SelectItem value="Closed">Closed</SelectItem>
                <SelectItem value="Rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-full sm:w-40" data-testid="select-ticket-priority">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="Critical">Critical</SelectItem>
                <SelectItem value="High">High</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="Low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ticket ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Raised By</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Asset ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Priority</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agent</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Created</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                      No tickets found.
                    </td>
                  </tr>
                )}
                {filtered.map((ticket) => (
                  <tr
                    key={ticket.ticketId}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    data-testid={`row-ticket-${ticket.ticketId}`}
                  >
                    <td className="px-4 py-3">
                      <Link href={`/tickets/${ticket.ticketId}`} className="font-semibold text-primary hover:underline">
                        {ticket.ticketId}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-foreground">{ticket.raisedBy}</td>
                    <td className="px-4 py-3">
                      <div className="text-foreground">{ticket.category}</div>
                      <div className="text-xs text-muted-foreground">{ticket.subcategory}</div>
                    </td>
                    <td className="px-4 py-3">
                      {ticket.assetId !== "N/A" ? (
                        <Link href={`/assets/${ticket.assetId}`} className="text-primary hover:underline text-xs">
                          {ticket.assetId}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-xs">N/A</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${priorityColors[ticket.priority]}`}>
                        {ticket.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusColors[ticket.status]}`}>
                        {ticket.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-sm">
                      {ticket.assignedAgent || <span className="text-muted-foreground/50">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{ticket.createdDate}</td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-actions-${ticket.ticketId}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/tickets/${ticket.ticketId}`} className="flex items-center gap-2 cursor-pointer">
                              <Eye className="h-3.5 w-3.5" /> View Details
                            </Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
