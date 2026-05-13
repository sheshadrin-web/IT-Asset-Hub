import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { Ticket, TicketComment, TicketPriority, TicketStatus } from "@/data/mockData";

// ─── DB row → App model ───────────────────────────────────────────────────────
// RLS policies on the "tickets" table control who can read/write rows.
function mapFromDB(row: Record<string, unknown>): Ticket {
  const createdAt = String(row.created_at ?? "");
  const updatedAt = String(row.updated_at ?? "");
  return {
    id:             String(row.id ?? ""),
    ticketId:       String(row.ticket_id ?? ""),
    raisedBy:       String(row.raised_by ?? ""),
    employeeEmail:  row.employee_email ? String(row.employee_email) : undefined,
    // assets(asset_id) join resolves the UUID FK back to the human-readable
    // string ID (e.g. "MILES-LAP-627") so display code needs no changes.
    assetId: (() => {
      const joined = row.assets as Record<string, unknown> | null;
      if (joined?.asset_id) return String(joined.asset_id);
      return "N/A";
    })(),
    category:       String(row.category ?? ""),
    subcategory:    String(row.subcategory ?? ""),
    priority:       (row.priority as TicketPriority) ?? "Medium",
    status:         (row.status as TicketStatus) ?? "Open",
    assignedAgent:  String(row.assigned_agent ?? ""),
    description:    String(row.description ?? ""),
    createdDate:    createdAt ? createdAt.split("T")[0] : new Date().toISOString().split("T")[0],
    updatedDate:    updatedAt ? updatedAt.split("T")[0] : new Date().toISOString().split("T")[0],
    resolutionNote: String(row.resolution_note ?? ""),
    comments:       Array.isArray(row.comments) ? (row.comments as TicketComment[]) : [],
  };
}

function nextTicketId(existing: Ticket[]): string {
  const nums = existing
    .map(t => parseInt(t.ticketId.replace("TKT-", ""), 10))
    .filter(n => !isNaN(n));
  const n = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `TKT-${String(n).padStart(4, "0")}`;
}

// ─── Context shape ────────────────────────────────────────────────────────────
interface AddTicketInput {
  raisedBy:      string;
  employeeEmail?: string;
  assetId:       string;
  category:      string;
  subcategory:   string;
  priority:      TicketPriority;
  description:   string;
}

interface TicketContextType {
  tickets:      Ticket[];
  loading:      boolean;
  getTicket:    (id: string) => Ticket | undefined;
  refresh:      () => Promise<void>;
  addTicket:    (data: AddTicketInput) => Promise<Ticket>;
  updateTicket: (ticketId: string, updates: Partial<Ticket>) => Promise<void>;
  addComment:   (ticketId: string, comment: TicketComment) => Promise<void>;
  deleteTicket: (ticketId: string) => Promise<void>;
  deleteTickets:(ids: string[]) => Promise<void>;
}

const TicketContext = createContext<TicketContextType | null>(null);

export function TicketProvider({ children }: { children: ReactNode }) {
  const [tickets,  setTickets]  = useState<Ticket[]>([]);
  const [loading,  setLoading]  = useState(true);

  const fetchTickets = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("tickets")
      .select("*, assets(asset_id)")
      .order("created_at", { ascending: false });
    if (!error && data) setTickets(data.map(mapFromDB));
    setLoading(false);
  }, []);

  // Re-fetch when auth session changes so end-users (whose RLS view depends on
  // a valid JWT) always see their own tickets after login.
  useEffect(() => { fetchTickets(); }, [fetchTickets]);
  useEffect(() => {
    if (!supabaseConfigured) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) fetchTickets();
    });
    return () => subscription.unsubscribe();
  }, [fetchTickets]);

  const getTicket = (id: string) => tickets.find(t => t.ticketId === id);

  const addTicket = async (data: AddTicketInput): Promise<Ticket> => {
    const ticketId = nextTicketId(tickets);
    const now = new Date().toISOString();
    const row = {
      ticket_id:      ticketId,
      raised_by:      data.raisedBy,
      employee_email: data.employeeEmail ?? null,
      asset_id:       (data.assetId === "N/A" || !data.assetId) ? null : data.assetId,
      category:       data.category,
      subcategory:    data.subcategory,
      priority:       data.priority,
      status:         "Open",
      // assigned_agent and resolution_note: omit from INSERT so the DB default is used.
      // Do NOT send "" — if the live column is UUID type, an empty string causes:
      //   "invalid input syntax for type uuid: """
      description:    data.description,
      created_at:     now,
      updated_at:     now,
    };
    const { data: inserted, error } = await supabase
      .from("tickets")
      .insert(row)
      .select()
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Failed to raise ticket");
    const newTicket = mapFromDB(inserted as Record<string, unknown>);
    setTickets(prev => [newTicket, ...prev]);
    return newTicket;
  };

  const updateTicket = async (ticketId: string, updates: Partial<Ticket>): Promise<void> => {
    const dbUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.status         !== undefined) dbUpdates.status          = updates.status;
    if (updates.priority       !== undefined) dbUpdates.priority        = updates.priority;
    if (updates.assignedAgent  !== undefined) dbUpdates.assigned_agent  = updates.assignedAgent;
    if (updates.resolutionNote !== undefined) dbUpdates.resolution_note = updates.resolutionNote;

    const { error } = await supabase
      .from("tickets")
      .update(dbUpdates)
      .eq("ticket_id", ticketId);
    if (error) throw new Error(error.message);
    const today = new Date().toISOString().split("T")[0];
    setTickets(prev =>
      prev.map(t => t.ticketId === ticketId ? { ...t, ...updates, updatedDate: today } : t)
    );
  };

  const addComment = async (ticketId: string, comment: TicketComment): Promise<void> => {
    const ticket = tickets.find(t => t.ticketId === ticketId);
    if (!ticket) return;
    const updatedComments = [...ticket.comments, comment];
    // Persist comments as JSONB. Requires: ALTER TABLE tickets ADD COLUMN IF NOT EXISTS comments JSONB DEFAULT '[]'::jsonb;
    // If the column doesn't exist the update returns an error which we ignore —
    // the comments still appear in the current session via local state.
    await supabase
      .from("tickets")
      .update({ comments: updatedComments, updated_at: new Date().toISOString() })
      .eq("ticket_id", ticketId);
    const today = new Date().toISOString().split("T")[0];
    setTickets(prev =>
      prev.map(t =>
        t.ticketId === ticketId
          ? { ...t, comments: updatedComments, updatedDate: today }
          : t
      )
    );
  };

  const deleteTicket = async (ticketId: string): Promise<void> => {
    const { error } = await supabase
      .from("tickets")
      .delete()
      .eq("ticket_id", ticketId);
    if (error) throw new Error(error.message);
    setTickets(prev => prev.filter(t => t.ticketId !== ticketId));
  };

  const deleteTickets = async (ids: string[]): Promise<void> => {
    const { error } = await supabase
      .from("tickets")
      .delete()
      .in("ticket_id", ids);
    if (error) throw new Error(error.message);
    setTickets(prev => prev.filter(t => !ids.includes(t.ticketId)));
  };

  return (
    <TicketContext.Provider value={{
      tickets, loading, getTicket, refresh: fetchTickets,
      addTicket, updateTicket, addComment, deleteTicket, deleteTickets,
    }}>
      {children}
    </TicketContext.Provider>
  );
}

export function useTickets() {
  const ctx = useContext(TicketContext);
  if (!ctx) throw new Error("useTickets must be used inside TicketProvider");
  return ctx;
}
