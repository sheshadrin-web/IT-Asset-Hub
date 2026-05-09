import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { Profile, UserRole, UserStatus } from "@/data/mockData";

interface UpdateProfileInput {
  full_name:  string;
  role:       UserRole;
  department: string;
  location:   string;
  status:     UserStatus;
}

interface UsersContextType {
  users:       Profile[];
  loading:     boolean;
  refresh:     () => Promise<void>;
  updateUser:  (id: string, data: UpdateProfileInput) => Promise<void>;
  removeUser:  (id: string) => void;  // optimistic removal after edge fn deletes auth user
}

const UsersContext = createContext<UsersContextType | null>(null);

export function UsersProvider({ children }: { children: ReactNode }) {
  const [users,   setUsers]   = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true });
    if (!error && data) setUsers(data as Profile[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Direct RLS update — safe because our policy allows authenticated users to update profiles.
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

  // Called after Edge Function successfully deletes the auth user (which cascades to profile).
  const removeUser = (id: string) => {
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  return (
    <UsersContext.Provider value={{ users, loading, refresh: fetchUsers, updateUser, removeUser }}>
      {children}
    </UsersContext.Provider>
  );
}

export function useUsers() {
  const ctx = useContext(UsersContext);
  if (!ctx) throw new Error("useUsers must be used inside UsersProvider");
  return ctx;
}
