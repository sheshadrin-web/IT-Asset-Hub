import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  ArrowLeft, AlertTriangle, Send, UserCheck, CheckCircle,
  RefreshCw, Trash2, Monitor, Smartphone, MessageSquare, ClipboardCheck, Info,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTickets } from "@/context/TicketContext";
import { useAssets } from "@/context/AssetContext";
import { useUsers } from "@/context/UsersContext";
import { useAuth } from "@/context/AuthContext";
import { TicketStatus, TicketPriority, TicketComment, ROLE_LABELS } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

const PRIORITY_COLORS: Record<TicketPriority, string> = {
  Critical: "bg-red-500/15 text-red-500 border-red-500/20",
  High:     "bg-amber-500/15 text-amber-600 border-amber-500/20",
  Medium:   "bg-blue-500/15 text-blue-600 border-blue-500/20",
  Low:      "bg-gray-500/15 text-gray-500 border-gray-500/20",
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

function commentBubbleClass(role: string) {
  if (role === "super_admin" || role === "it_admin") return "bg-purple-50 border border-purple-100";
  if (role === "it_agent") return "bg-blue-50 border border-blue-100";
  return "bg-muted/50 border border-border";
}
function commentAvatarClass(role: string) {
  if (role === "super_admin" || role === "it_admin") return "bg-purple-100 text-purple-700";
  if (role === "it_agent") return "bg-blue-100 text-blue-700";
  return "bg-muted text-muted-foreground";
}
function roleBadgeClass(role: string) {
  if (role === "super_admin" || role === "it_admin") return "bg-purple-100 text-purple-700";
  if (role === "it_agent") return "bg-blue-100 text-blue-700";
  return "bg-muted text-muted-foreground";
}

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { getTicket, updateTicket, addComment, deleteTicket } = useTickets();
  const { getAsset }    = useAssets();
  const { users }       = useUsers();
  const { currentUser } = useAuth();
  const { toast }       = useToast();
  const [, setLocation] = useLocation();

  const [newComment,      setNewComment]      = useState("");
  const [draftStatus,     setDraftStatus]     = useState<TicketStatus | "">("");
  const [draftPriority,   setDraftPriority]   = useState<TicketPriority | "">("");
  const [draftAgent,      setDraftAgent]      = useState("");
  const [draftResolution, setDraftResolution] = useState("");
  const [deleteOpen,      setDeleteOpen]      = useState(false);
  const [rejectOpen,      setRejectOpen]      = useState(false);
  const [saved,           setSaved]           = useState(false);

  const ticket = getTicket(id);
  const isSuperAdmin = currentUser?.role === "super_admin";
  const isAdmin      = currentUser?.role === "super_admin" || currentUser?.role === "it_admin";
  const isAgent      = currentUser?.role === "it_agent";
  const isEndUser    = currentUser?.role === "end_user";
  const canManage    = isAdmin || isAgent;

  const agents = users.filter(u => u.role === "it_agent" || u.role === "super_admin" || u.role === "it_admin");
  const linkedAsset = ticket?.assetId && ticket.assetId !== "N/A" ? getAsset(ticket.assetId) : null;

  const effectiveStatus     = (draftStatus     || ticket?.status)     as TicketStatus;
  const effectivePriority   = (draftPriority   || ticket?.priority)   as TicketPriority;
  const effectiveAgent      = draftAgent !== "" ? draftAgent : (ticket?.assignedAgent ?? "");
  const effectiveResolution = draftResolution !== "" ? draftResolution : (ticket?.resolutionNote ?? "");

  // Agent status options — agents can only progress forward, not close/reject
  const agentStatusOptions: TicketStatus[] = ["Open", "Assigned", "In Progress", "Waiting for User", "Resolved"];
  const adminStatusOptions: TicketStatus[] = ["Open", "Assigned", "In Progress", "Waiting for User", "Resolved", "Closed", "Rejected"];

  const handleSaveChanges = async () => {
    if (!ticket) return;
    try {
      await updateTicket(ticket.ticketId, {
        status:         effectiveStatus,
        priority:       effectivePriority,
        assignedAgent:  effectiveAgent,
        resolutionNote: effectiveResolution,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast({ title: "Ticket updated", description: "Changes saved successfully." });
    } catch (err) {
      toast({ title: "Failed to save", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !currentUser || !ticket) return;
    const comment: TicketComment = {
      id:     `c${Date.now()}`,
      author: currentUser.name,
      role:   currentUser.role,
      text:   newComment.trim(),
      date:   new Date().toISOString().split("T")[0],
    };
    try {
      await addComment(ticket.ticketId, comment);
      setNewComment("");
      toast({ title: "Comment added" });
    } catch (err) {
      toast({ title: "Failed to add comment", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    }
  };

  const handleAssignToSelf = async () => {
    if (!ticket || !currentUser) return;
    try {
      await updateTicket(ticket.ticketId, { assignedAgent: currentUser.name, status: "Assigned" });
      setDraftAgent(currentUser.name);
      setDraftStatus("Assigned");
      toast({ title: "Assigned to you", description: ticket.ticketId });
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    }
  };

  const handleClose = async () => {
    if (!ticket) return;
    await updateTicket(ticket.ticketId, { status: "Closed" });
    setDraftStatus("Closed");
    toast({ title: "Ticket closed" });
  };

  const handleReopen = async () => {
    if (!ticket) return;
    await updateTicket(ticket.ticketId, { status: "Open" });
    setDraftStatus("Open");
    toast({ title: "Ticket reopened" });
  };

  const handleReject = async () => {
    if (!ticket) return;
    try {
      await updateTicket(ticket.ticketId, { status: "Rejected" });
      setDraftStatus("Rejected");
      setRejectOpen(false);
      toast({ title: "Ticket rejected" });
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!ticket) return;
    try {
      await deleteTicket(ticket.ticketId);
      toast({ title: "Ticket deleted" });
      setLocation("/tickets");
    } catch (err) {
      toast({ title: "Failed to delete", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    }
  };

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Ticket not found.</p>
        <Link href="/tickets"><Button variant="outline" className="gap-2"><ArrowLeft className="h-4 w-4" /> Back to Tickets</Button></Link>
      </div>
    );
  }

  const isOwnTicket = ticket.raisedBy === currentUser?.name;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Link href="/tickets"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-foreground">{ticket.ticketId}</h1>
              <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", PRIORITY_COLORS[ticket.priority])}>{ticket.priority}</span>
              <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", STATUS_COLORS[ticket.status])}>{ticket.status}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{ticket.category} — {ticket.subcategory}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isAgent && !ticket.assignedAgent && (
            <Button variant="outline" size="sm" className="gap-2" onClick={handleAssignToSelf} data-testid="button-assign-self">
              <UserCheck className="h-4 w-4" /> Assign to Me
            </Button>
          )}
          {isAdmin && ticket.status !== "Closed" && ticket.status !== "Rejected" && (
            <Button variant="outline" size="sm" className="gap-2 text-gray-600" onClick={handleClose} data-testid="button-close-ticket">
              <CheckCircle className="h-4 w-4" /> Close
            </Button>
          )}
          {isAdmin && (ticket.status === "Closed" || ticket.status === "Rejected") && (
            <Button variant="outline" size="sm" className="gap-2 text-blue-600" onClick={handleReopen} data-testid="button-reopen-ticket">
              <RefreshCw className="h-4 w-4" /> Reopen
            </Button>
          )}
          {isAdmin && ticket.status !== "Rejected" && ticket.status !== "Closed" && (
            <Button variant="outline" size="sm" className="gap-2 text-red-600 border-red-200 hover:bg-red-50" onClick={() => setRejectOpen(true)} data-testid="button-reject-ticket">
              <XCircle className="h-4 w-4" /> Reject
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => setDeleteOpen(true)} data-testid="button-delete-ticket">
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* Description */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Info className="h-4 w-4 text-muted-foreground" /> Description
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{ticket.description}</p>
            </CardContent>
          </Card>

          {/* Resolution note — visible to all, editable by IT */}
          {(ticket.resolutionNote || (canManage && (ticket.status === "Resolved" || ticket.status === "Closed"))) && (
            <Card className={cn("border-2", ticket.resolutionNote ? "border-emerald-300 bg-emerald-500/5" : "border-dashed border-border")}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-emerald-700">
                  <ClipboardCheck className="h-4 w-4" /> Resolution Note
                </CardTitle>
              </CardHeader>
              <CardContent>
                {canManage ? (
                  <Textarea value={effectiveResolution} onChange={e => setDraftResolution(e.target.value)} rows={3} placeholder="Describe how the issue was resolved…" className="text-sm" data-testid="input-resolution-note" />
                ) : (
                  <p className="text-sm text-foreground leading-relaxed">{ticket.resolutionNote || "No resolution note yet."}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Rejection notice for end user */}
          {isEndUser && ticket.status === "Rejected" && (
            <Card className="border-2 border-red-200 bg-red-50">
              <CardContent className="py-4 flex items-center gap-3">
                <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-700">This ticket has been rejected by the IT team. Please raise a new ticket or contact IT directly for more information.</p>
              </CardContent>
            </Card>
          )}

          {/* Comments */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                Comments <span className="text-muted-foreground font-normal">({ticket.comments.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {ticket.comments.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No comments yet — be the first to comment.</p>
              )}
              {ticket.comments.map(comment => {
                const initials = comment.author.split(" ").map(n => n[0]).join("").toUpperCase();
                return (
                  <div key={comment.id} className="flex gap-3" data-testid={`comment-${comment.id}`}>
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarFallback className={cn("text-xs font-semibold", commentAvatarClass(comment.role))}>{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">{comment.author}</span>
                        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", roleBadgeClass(comment.role))}>
                          {ROLE_LABELS[comment.role as keyof typeof ROLE_LABELS] ?? comment.role}
                        </span>
                        <span className="text-xs text-muted-foreground">{comment.date}</span>
                      </div>
                      <p className={cn("text-sm text-foreground rounded-xl px-4 py-3 leading-relaxed", commentBubbleClass(comment.role))}>{comment.text}</p>
                    </div>
                  </div>
                );
              })}

              {/* Comment box — available to all roles */}
              <div className="border-t border-border pt-4 space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className={cn("text-[10px] font-semibold", commentAvatarClass(currentUser?.role ?? ""))}>
                      {currentUser?.name.split(" ").map(n => n[0]).join("") ?? "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium text-foreground">Add a comment</span>
                </div>
                <Textarea placeholder="Write your comment here…" value={newComment} onChange={e => setNewComment(e.target.value)} rows={3} data-testid="input-comment" />
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleAddComment} disabled={!newComment.trim()} className="gap-2" data-testid="button-add-comment">
                    <Send className="h-3.5 w-3.5" /> Post Comment
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Ticket info */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Ticket Info</CardTitle></CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              {[
                { label: "Ticket ID", value: ticket.ticketId },
                { label: "Category",  value: ticket.category },
                { label: "Sub",       value: ticket.subcategory },
                { label: "Created",   value: ticket.createdDate },
                { label: "Updated",   value: ticket.updatedDate },
              ].map(row => (
                <div key={row.label} className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">{row.label}</span>
                  <span className="font-medium text-foreground text-right">{row.value}</span>
                </div>
              ))}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground flex-shrink-0">Asset</span>
                <span className="font-medium text-right">
                  {ticket.assetId !== "N/A"
                    ? <Link href={`/assets/${ticket.assetId}`} className="text-primary hover:underline">{ticket.assetId}</Link>
                    : "N/A"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Raised By */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Raised By</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-muted text-muted-foreground font-semibold text-sm">
                    {ticket.raisedBy.split(" ").map(n => n[0]).join("")}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-semibold text-foreground">{ticket.raisedBy}</p>
                  {ticket.employeeEmail && <p className="text-xs text-muted-foreground">{ticket.employeeEmail}</p>}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Linked asset */}
          {linkedAsset && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Asset Info</CardTitle></CardHeader>
              <CardContent className="space-y-2.5 text-sm">
                <div className="flex items-center gap-2 mb-2">
                  {linkedAsset.assetType === "Laptop" ? <Monitor className="h-4 w-4 text-blue-500" /> : <Smartphone className="h-4 w-4 text-indigo-500" />}
                  <span className="font-semibold text-foreground">{linkedAsset.brand} {linkedAsset.model}</span>
                </div>
                {[
                  { label: "Serial",   value: linkedAsset.serialNumber },
                  { label: "Location", value: linkedAsset.location },
                  { label: "Status",   value: linkedAsset.status },
                ].map(r => (
                  <div key={r.label} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-medium text-foreground text-right">{r.value}</span>
                  </div>
                ))}
                <Link href={`/assets/${linkedAsset.assetId}`} className="text-xs text-primary hover:underline block mt-1">View full asset →</Link>
              </CardContent>
            </Card>
          )}

          {/* Manage panel — IT Agent and IT Admin/Super Admin */}
          {canManage && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Manage Ticket</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
                  <Select
                    value={effectiveStatus}
                    onValueChange={v => setDraftStatus(v as TicketStatus)}
                    disabled={isAgent && ticket.status === "Closed"}
                  >
                    <SelectTrigger className="text-sm" data-testid="select-update-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(isAdmin ? adminStatusOptions : agentStatusOptions).map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Priority</label>
                  <Select value={effectivePriority} onValueChange={v => setDraftPriority(v as TicketPriority)}>
                    <SelectTrigger className="text-sm" data-testid="select-update-priority"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["Low","Medium","High","Critical"] as TicketPriority[]).map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Agent assignment — admins only */}
                {isAdmin && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Assigned Agent</label>
                    <Select value={effectiveAgent || "unassigned"} onValueChange={v => setDraftAgent(v === "unassigned" ? "" : v)}>
                      <SelectTrigger className="text-sm" data-testid="select-assigned-agent"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {agents.map(agent => (
                          <SelectItem key={agent.id} value={agent.full_name}>{agent.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(effectiveStatus === "Resolved" || effectiveStatus === "Closed") && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Resolution Note</label>
                    <Textarea value={effectiveResolution} onChange={e => setDraftResolution(e.target.value)} rows={3} placeholder="Describe how the issue was resolved…" className="text-sm" data-testid="input-resolution-note-sidebar" />
                  </div>
                )}
                <Button
                  className={cn("w-full gap-2", saved && "bg-emerald-600 hover:bg-emerald-600")}
                  onClick={handleSaveChanges}
                  data-testid="button-save-ticket"
                >
                  {saved ? <><CheckCircle className="h-3.5 w-3.5" /> Saved!</> : "Save Changes"}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* End user — read-only status view */}
          {isEndUser && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Ticket Status</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", STATUS_COLORS[ticket.status])}>{ticket.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Priority</span>
                  <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", PRIORITY_COLORS[ticket.priority])}>{ticket.priority}</span>
                </div>
                {ticket.assignedAgent && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Agent</span>
                    <span className="font-medium text-foreground">{ticket.assignedAgent}</span>
                  </div>
                )}
                {ticket.resolutionNote && (
                  <div className="pt-2 border-t border-border">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Resolution</p>
                    <p className="text-sm text-foreground">{ticket.resolutionNote}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Reject confirm */}
      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Ticket</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reject <strong>{ticket.ticketId}</strong>? The user will be notified and cannot edit the ticket.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={handleReject}>Reject Ticket</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ticket</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete <strong>{ticket.ticketId}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
