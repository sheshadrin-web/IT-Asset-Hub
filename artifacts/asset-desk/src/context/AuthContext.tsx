import {
  createContext, useContext, useState, useEffect, useCallback, ReactNode,
} from "react";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import {
  Profile, CurrentUser, UserRole, profileToCurrentUser,
} from "@/data/mockData";

// ─── Context shape ────────────────────────────────────────────────────────────
interface AuthContextType {
  session:         Session | null;
  supabaseUser:    SupabaseUser | null;
  profile:         Profile | null;
  currentUser:     CurrentUser | null;   // backward-compat derived from profile
  role:            UserRole | null;
  loading:         boolean;
  configError:     boolean;             // true if env vars are missing
  signIn:          (email: string, password: string) => Promise<{ error: string | null }>;
  signOut:         () => Promise<void>;
  refreshProfile:  () => Promise<void>;
  isAuthenticated: boolean;
  hasRole:         (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session,      setSession]      = useState<Session | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [profile,      setProfile]      = useState<Profile | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [configError,  setConfigError]  = useState(false);

  // ── Fetch profile by auth user id ──────────────────────────────────────────
  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (error) {
      console.error("[AuthContext] fetchProfile error:", error.message, error.code);
      return null;
    }
    if (!data) return null;
    // Normalise status to title-case so DB rows with 'active'/'inactive' work
    const raw = data as Record<string, unknown>;
    const statusRaw = String(raw.status ?? "").toLowerCase();
    raw.status = statusRaw === "inactive" ? "Inactive" : "Active";
    return raw as unknown as Profile;
  }, []);

  // ── On mount: check env vars + restore session ────────────────────────────
  useEffect(() => {
    if (!supabaseConfigured) {
      setConfigError(true);
      setLoading(false);
      return;
    }

    // Restore existing session
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (s) {
        setSession(s);
        setSupabaseUser(s.user);
        const p = await fetchProfile(s.user.id);
        if (p && p.status === "Active") setProfile(p);
      }
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, s) => {
        if (s) {
          setSession(s);
          setSupabaseUser(s.user);
          // Profile is already set by signIn; only refresh on token refresh
        } else {
          setSession(null);
          setSupabaseUser(null);
          setProfile(null);
        }
      }
    );
    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // ── Sign in ────────────────────────────────────────────────────────────────
  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    if (!supabaseConfigured) {
      return { error: "Supabase is not configured. Please contact your IT Admin." };
    }
    setLoading(true);

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError || !authData.user) {
      console.error("[AuthContext] signIn error:", authError?.message, authError?.code);
      setLoading(false);
      const code = authError?.code ?? "";
      if (code === "invalid_credentials" || code === "invalid_grant") {
        return { error: "Invalid email or password. Please check your Supabase Auth user and password." };
      }
      return { error: "Invalid email or password. Please check your Supabase Auth user and password." };
    }

    // Fetch profile
    const p = await fetchProfile(authData.user.id);

    if (!p) {
      console.warn("[AuthContext] No profile found for user:", authData.user.email);
      await supabase.auth.signOut();
      setLoading(false);
      return { error: "Login successful, but your profile is not configured in public.profiles. Please contact IT Admin." };
    }

    if (p.status === "Inactive") {
      console.warn("[AuthContext] Inactive profile for user:", authData.user.email);
      await supabase.auth.signOut();
      setLoading(false);
      return { error: "Your account is inactive. Please contact IT Admin." };
    }

    setSession(authData.session);
    setSupabaseUser(authData.user);
    setProfile(p);
    setLoading(false);
    return { error: null };
  };

  // ── Sign out ───────────────────────────────────────────────────────────────
  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setSupabaseUser(null);
    setProfile(null);
  };

  // ── Refresh profile ────────────────────────────────────────────────────────
  const refreshProfile = async () => {
    if (!supabaseUser) return;
    const p = await fetchProfile(supabaseUser.id);
    if (p) setProfile(p);
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const currentUser: CurrentUser | null = profile ? profileToCurrentUser(profile) : null;
  const role = profile?.role ?? null;
  const isAuthenticated = !!session && !!profile;

  const hasRole = (...roles: UserRole[]): boolean => {
    if (!role) return false;
    return roles.includes(role);
  };

  return (
    <AuthContext.Provider value={{
      session, supabaseUser, profile, currentUser, role, loading, configError,
      signIn, signOut, refreshProfile,
      isAuthenticated, hasRole,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
