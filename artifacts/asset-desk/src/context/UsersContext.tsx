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
  const { isAuthenticated, currentUser } = useAuth();

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
    const isUnassign = newEmail === "";
    const newManager = isUnassign
      ? undefined
      : users.find(u => u.email.trim().toLowerCase() === newEmail.toLowerCase());
    const newManagerName = newManager?.full_name ?? (isUnassign ? null : newEmail);

    // 1. Bulk update the profiles.
    const { error: updErr } = await supabase
      .from("profiles")
      .update({ reporting_manager: newEmail, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (updErr) throw new Error(updErr.message);

    // 2. Build one audit-trail row per affected user, capturing the old manager.
    const batchId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    const affected = users.filter(u => ids.includes(u.id));
    const rows = affected.map(u => {
      const oldEmail = (u.reporting_manager ?? "").trim();
      const oldManager = oldEmail
        ? users.find(m => m.email.trim().toLowerCase() === oldEmail.toLowerCase())
        : undefined;
      return {
        batch_id:          batchId,
        user_id:           u.id,
        user_name:         u.full_name,
        user_email:        u.email,
        event_type:        isUnassign ? "unassigned" : "reassigned",
        old_manager_email: oldEmail || null,
        old_manager_name:  oldManager?.full_name ?? (oldEmail || null),
        new_manager_email: isUnassign ? null : newEmail,
        new_manager_name:  newManagerName,
        affected_count:    ids.length,
        event_by:          currentUser?.userId ?? null,
        event_by_name:     currentUser?.name ?? null,
        notes:             notes ?? null,
      };
    });

    // 3. Record the audit trail. Non-fatal: the reassignment already succeeded,
    //    so surface a warning rather than rolling back if history write fails.
    const { error: histErr } = await supabase.from("reporting_manager_history").insert(rows);
    if (histErr) {
      toast({
        title: "Manager updated, but history was not recorded",
        description: histErr.message,
        variant: "destructive",
      });
    }

    // 4. Update local state.
    setUsers(prev =>
      prev.map(u =>
        ids.includes(u.id)
          ? { ...u, reporting_manager: newEmail, updated_at: new Date().toISOString() }
          : u,
      ),
    );

    return { count: ids.length, batchId };
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
