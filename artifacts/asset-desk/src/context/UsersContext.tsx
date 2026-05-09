import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { Profile, UserRole, UserStatus } from "@/data/mockData";

// RLS policies on the "profiles" table must allow admins to read all profiles.

interface UpdateProfileInput {
  full_name:  string;
  role:       UserRole;
  department: string;
  location:   string;
  status:     UserStatus;
}

interface UsersContextType {
  users:        Profile[];
  loading:      boolean;
  refresh:      () => Promise<void>;
  updateUser:   (id: string, data: UpdateProfileInput) => Promise<void>;
  deleteUser:   (id: string) => Promise<void>;
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

  const updateUser = async (id: string, data: UpdateProfileInput): Promise<void> => {
    const { error } = await supabase
      .from("profiles")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    setUsers(prev =>
      prev.map(u =>
        u.id === id
          ? { ...u, ...data, updated_at: new Date().toISOString() }
          : u
      )
    );
  };

  const deleteUser = async (id: string): Promise<void> => {
    // This deletes the profile row only — the Supabase auth user is NOT deleted.
    // To fully remove a user, an admin must also delete them from Supabase Auth dashboard.
    const { error } = await supabase
      .from("profiles")
      .delete()
      .eq("id", id);
    if (error) throw new Error(error.message);
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  return (
    <UsersContext.Provider value={{ users, loading, refresh: fetchUsers, updateUser, deleteUser }}>
      {children}
    </UsersContext.Provider>
  );
}

export function useUsers() {
  const ctx = useContext(UsersContext);
  if (!ctx) throw new Error("useUsers must be used inside UsersProvider");
  return ctx;
}
