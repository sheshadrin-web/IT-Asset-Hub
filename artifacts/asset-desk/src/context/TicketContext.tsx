import { createContext, useContext, useState, ReactNode } from "react";
import {
  Ticket, TicketComment, TicketPriority, TicketStatus, mockTickets,
} from "@/data/mockData";

interface AddTicketInput {
  raisedBy: string;
  assetId: string;
  category: string;
  subcategory: string;
  priority: TicketPriority;
  description: string;
}

interface TicketContextType {
  tickets: Ticket[];
  getTicket: (id: string) => Ticket | undefined;
  addTicket: (data: AddTicketInput) => Ticket;
  updateTicket: (ticketId: string, updates: Partial<Ticket>) => void;
  addComment: (ticketId: string, comment: TicketComment) => void;
  deleteTicket: (ticketId: string) => void;
  deleteTickets: (ids: string[]) => void;
}

const TicketContext = createContext<TicketContextType | null>(null);

export function TicketProvider({ children }: { children: ReactNode }) {
  const [tickets, setTickets] = useState<Ticket[]>(mockTickets);

  const getTicket = (id: string) => tickets.find((t) => t.ticketId === id);

  const addTicket = (data: AddTicketInput): Ticket => {
    const ids = tickets.map((t) => parseInt(t.ticketId.replace("TKT-", ""), 10));
    const nextNum = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    const today = new Date().toISOString().split("T")[0];
    const newTicket: Ticket = {
      ...data,
      ticketId:       `TKT-${String(nextNum).padStart(3, "0")}`,
      status:         "Open",
      assignedAgent:  "",
      resolutionNote: "",
      createdDate:    today,
      updatedDate:    today,
      comments:       [],
    };
    setTickets((prev) => [newTicket, ...prev]);
    return newTicket;
  };

  const updateTicket = (ticketId: string, updates: Partial<Ticket>) => {
    const today = new Date().toISOString().split("T")[0];
    setTickets((prev) =>
      prev.map((t) =>
        t.ticketId === ticketId ? { ...t, ...updates, updatedDate: today } : t
      )
    );
  };

  const addComment = (ticketId: string, comment: TicketComment) => {
    const today = new Date().toISOString().split("T")[0];
    setTickets((prev) =>
      prev.map((t) =>
        t.ticketId === ticketId
          ? { ...t, comments: [...t.comments, comment], updatedDate: today }
          : t
      )
    );
  };

  const deleteTicket = (ticketId: string) => {
    setTickets((prev) => prev.filter((t) => t.ticketId !== ticketId));
  };

  const deleteTickets = (ids: string[]) => {
    setTickets((prev) => prev.filter((t) => !ids.includes(t.ticketId)));
  };

  return (
    <TicketContext.Provider
      value={{ tickets, getTicket, addTicket, updateTicket, addComment, deleteTicket, deleteTickets }}
    >
      {children}
    </TicketContext.Provider>
  );
}

export function useTickets() {
  const ctx = useContext(TicketContext);
  if (!ctx) throw new Error("useTickets must be used inside TicketProvider");
  return ctx;
}
