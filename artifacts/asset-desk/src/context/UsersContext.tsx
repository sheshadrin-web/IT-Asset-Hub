import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { Profile, UserRole, UserStatus } from "@/data/mockData";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";

interface UpdateProfileInput {
  full_name:         string;
  role:              UserRole;
  ecode:             string;
  department:        string;
  location:          string;
  reporting_manager: string;
  status:            UserStatus;
}

export interface ManagerHistoryEntry {
  id:                string;
  batch_id:          string;
  user_id:           string | null;
  user_name:         string | null;
  user_email:        string | null;
  event_type:        "reassigned" | "unassigned";
  old_manager_email: string | null;
  old_manager_name:  string | null;
  new_manager_email: string | null;
  new_manager_name:  string | null;
  affected_count:    number;
  event_by:          string | null;
  event_by_name:     string | null;
  notes:             string | null;
  created_at:        string;
}

export interface ChangeManagerResult {
  count:    number;
  batchId:  string;
}

interface UsersContextType {
  users:      Profile[];
  loading:    boolean;
  error:      string | null;
  refresh:    () => Promise<void>;
  updateUser: (id: string, data: UpdateProfileInput) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  /**
   * Reassign (or unassign) the reporting manager for a set of users and record
   * an audit-trail row per affected user. Pass `newManagerEmail = null` (or "")
   * to move the users to an Unassigned Manager state.
   */
  changeReportingManager: (
    userIds: string[],
    newManagerEmail: string | null,
    notes?: string,
  ) => Promise<ChangeManagerResult>;
  /** Per-user reporting-manager change history, newest first. */
  fetchManagerHistory: (userId: string) => Promise<ManagerHistoryEntry[]>;
}

const UsersContext = createContext<UsersContextType | null>(null);

export function UsersProvider({ children }: { children: ReactNode }) {
  const [users,   setUsers]   = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const { isAuthenticated } = useAuth();

  const fetchUsers = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true });
    if (fetchError) {
      // Surface the failure instead of silently showing an empty user list.
      setError(fetchError.message);
      toast({ title: "Failed to load users", description: fetchError.message, variant: "destructive" });
    } else if (data) {
      setError(null);
      setUsers(data as Profile[]);
    }
    setLoading(false);
  }, []);

  // Only fetch when authenticated — public pages (e.g. the acknowledgement link)
  // must not trigger a profiles read. `isAuthenticated` flips true once session
  // and profile resolve, then flips false on sign-out: one fetch, no race.
  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (!isAuthenticated) { setLoading(false); return; }
    fetchUsers();
  }, [isAuthenticated, fetchUsers]);

  const updateUser = async (id: string, data: UpdateProfileInput): Promise<void> => {
    const { error } = await supabase
      .from("profiles")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    setUsers(prev =>
      prev.map(u => u.id === id ? { ...u, ...data, updated_at: new Date().toISOString() } : u)
    );
  };

  const changeReportingManager = async (
    userIds: string[],
    newManagerEmail: string | null,
    notes?: string,
  ): Promise<ChangeManagerResult> => {
    const ids = userIds.filter(Boolean);
    if (ids.length === 0) return { count: 0, batchId: "" };

    const newEmail = (newManagerEmail ?? "").trim();

    // Reassignment + audit/history write happen atomically inside a single
    // Postgres transaction (the change_reporting_manager RPC). The transfer can
    // never succeed without its audit trail — if either step fails, both roll
    // back and the error surfaces here.
    const { data, error } = await supabase.rpc("change_reporting_manager", {
      p_user_ids:          ids,
      p_new_manager_email: newEmail,
      p_notes:             notes ?? null,
    });
    if (error) throw new Error(error.message);

    const result = (data ?? {}) as { count?: number; batch_id?: string | null };
    const count = result.count ?? ids.length;
    const batchId = result.batch_id ?? "";

    // Reflect the change in local state.
    setUsers(prev =>
      prev.map(u =>
        ids.includes(u.id)
          ? { ...u, reporting_manager: newEmail, updated_at: new Date().toISOString() }
          : u,
      ),
    );

    return { count, batchId };
  };

  const fetchManagerHistory = async (userId: string): Promise<ManagerHistoryEntry[]> => {
    const { data, error } = await supabase
      .from("reporting_manager_history")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ManagerHistoryEntry[];
  };

  // Deletes the profile row. The auth user stays in Supabase Auth but can no
  // longer log in (no profile = access denied). To fully purge the auth account
  // as well, go to Supabase Dashboard → Authentication → Users and delete there.
  const deleteUser = async (id: string): Promise<void> => {
    const { error } = await supabase
      .from("profiles")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  return (
    <UsersContext.Provider value={{ users, loading, error, refresh: fetchUsers, updateUser, deleteUser, changeReportingManager, fetchManagerHistory }}>
      {children}
    </UsersContext.Provider>
  );
}

export function useUsers() {
  const ctx = useContext(UsersContext);
  if (!ctx) throw new Error("useUsers must be used inside UsersProvider");
  return ctx;
}
