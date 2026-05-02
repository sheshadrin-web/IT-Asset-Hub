import { useState } from "react";
import { useParams, Link } from "wouter";
import { ArrowLeft, MessageSquare, AlertTriangle, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { mockTickets, mockUsers, Ticket, TicketStatus, TicketPriority, TicketComment } from "@/data/mockData";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

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

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [allTickets, setAllTickets] = useState(mockTickets);
  const [newComment, setNewComment] = useState("");

  const ticket = allTickets.find((t) => t.ticketId === id);
  const isAdmin = currentUser?.role === "super_admin";
  const isAgent = currentUser?.role === "agent";
  const canManage = isAdmin || isAgent;

  const agents = mockUsers.filter((u) => u.role === "agent" || u.role === "super_admin");

  const updateTicket = (updates: Partial<Ticket>) => {
    setAllTickets((prev) =>
      prev.map((t) =>
        t.ticketId === id ? { ...t, ...updates, updatedDate: new Date().toISOString().split("T")[0] } : t
      )
    );
  };

  const handleAddComment = () => {
    if (!newComment.trim() || !currentUser) return;
    const comment: TicketComment = {
      id: `c${Date.now()}`,
      author: currentUser.name,
      role: currentUser.role,
      text: newComment.trim(),
      date: new Date().toISOString().split("T")[0],
    };
    updateTicket({ comments: [...(ticket?.comments ?? []), comment] });
    setNewComment("");
    toast({ title: "Comment added" });
  };

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Ticket not found.</p>
        <Link href="/tickets">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to Tickets
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/tickets">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-foreground">{ticket.ticketId}</h1>
              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${priorityColors[ticket.priority]}`}>
                {ticket.priority}
              </span>
              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusColors[ticket.status]}`}>
                {ticket.status}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{ticket.category} — {ticket.subcategory}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-foreground leading-relaxed">{ticket.description}</p>
            </CardContent>
          </Card>

          {/* Resolution Note (if present) */}
          {ticket.resolutionNote && (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-emerald-600">Resolution Note</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground leading-relaxed">{ticket.resolutionNote}</p>
              </CardContent>
            </Card>
          )}

          {/* Comments */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Comments ({ticket.comments.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {ticket.comments.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No comments yet.</p>
              )}
              {ticket.comments.map((comment) => {
                const initials = comment.author.split(" ").map((n) => n[0]).join("").toUpperCase();
                return (
                  <div key={comment.id} className="flex gap-3" data-testid={`comment-${comment.id}`}>
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-foreground">{comment.author}</span>
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{comment.role}</span>
                        <span className="text-xs text-muted-foreground">{comment.date}</span>
                      </div>
                      <p className="text-sm text-foreground bg-muted/50 rounded-lg px-3 py-2">{comment.text}</p>
                    </div>
                  </div>
                );
              })}

              {/* Add comment */}
              <div className="border-t border-border pt-4">
                <Textarea
                  placeholder="Add a comment..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  rows={3}
                  data-testid="input-comment"
                />
                <div className="flex justify-end mt-2">
                  <Button
                    onClick={handleAddComment}
                    disabled={!newComment.trim()}
                    className="gap-2"
                    data-testid="button-add-comment"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Add Comment
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {/* Ticket Info */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Ticket Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {[
                { label: "Ticket ID", value: ticket.ticketId },
                { label: "Raised By", value: ticket.raisedBy },
                {
                  label: "Asset",
                  value: ticket.assetId !== "N/A" ? (
                    <Link href={`/assets/${ticket.assetId}`} className="text-primary hover:underline">
                      {ticket.assetId}
                    </Link>
                  ) : "N/A",
                },
                { label: "Created", value: ticket.createdDate },
                { label: "Updated", value: ticket.updatedDate },
              ].map((row) => (
                <div key={row.label} className="flex justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-medium text-foreground text-right">{row.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Manage (agents/admins only) */}
          {canManage && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Manage Ticket</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
                  <Select
                    value={ticket.status}
                    onValueChange={(v) => updateTicket({ status: v as TicketStatus })}
                  >
                    <SelectTrigger className="text-sm" data-testid="select-update-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["Open", "Assigned", "In Progress", "Waiting for User", "Resolved", "Closed", "Rejected"] as TicketStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Priority</label>
                  <Select
                    value={ticket.priority}
                    onValueChange={(v) => updateTicket({ priority: v as TicketPriority })}
                  >
                    <SelectTrigger className="text-sm" data-testid="select-update-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["Low", "Medium", "High", "Critical"] as TicketPriority[]).map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Assigned Agent</label>
                  <Select
                    value={ticket.assignedAgent || "unassigned"}
                    onValueChange={(v) => updateTicket({ assignedAgent: v === "unassigned" ? "" : v })}
                  >
                    <SelectTrigger className="text-sm" data-testid="select-assigned-agent">
                      <SelectValue placeholder="Assign agent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {agents.map((agent) => (
                        <SelectItem key={agent.userId} value={agent.name}>{agent.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {(ticket.status === "Resolved" || ticket.status === "Closed") && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Resolution Note</label>
                    <Textarea
                      value={ticket.resolutionNote}
                      onChange={(e) => updateTicket({ resolutionNote: e.target.value })}
                      rows={3}
                      placeholder="Describe how the issue was resolved..."
                      className="text-sm"
                      data-testid="input-resolution-note"
                    />
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={() => toast({ title: "Ticket updated", description: "Changes saved successfully." })}
                  data-testid="button-save-ticket"
                >
                  Save Changes
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
