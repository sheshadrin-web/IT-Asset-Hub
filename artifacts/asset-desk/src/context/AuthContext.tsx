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
  currentUser:     CurrentUser | null;
  role:            UserRole | null;
  loading:         boolean;     // true only while restoring session on app start
  configError:     boolean;
  signIn:          (email: string, password: string) => Promise<{ error: string | null }>;
  signOut:         () => Promise<void>;
  refreshProfile:  () => Promise<void>;
  isAuthenticated: boolean;
  hasRole:         (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function normaliseProfile(raw: Record<string, unknown>): Profile {
  // Normalise status: accept 'active', 'Active', 'inactive', 'Inactive'
  const statusRaw = String(raw.status ?? "").toLowerCase();
  raw.status = statusRaw === "inactive" ? "Inactive" : "Active";

  // Normalise role: already stored as snake_case in DB, validate it
  const validRoles: UserRole[] = ["super_admin", "it_admin", "it_agent", "end_user"];
  if (!validRoles.includes(raw.role as UserRole)) {
    console.warn("[AuthContext] Unknown role in profile:", raw.role);
  }

  return raw as unknown as Profile;
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session,      setSession]      = useState<Session | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [profile,      setProfile]      = useState<Profile | null>(null);
  const [loading,      setLoading]      = useState(true); // initial session restore only
  const [configError,  setConfigError]  = useState(false);

  // ── Fetch profile from public.profiles by Supabase auth user ID ─────────────
  const fetchProfile = useCallback(async (userId: string): Promise<{
    profile: Profile | null;
    errorMessage: string | null;
  }> => {
    console.log("[AuthContext] fetchProfile → userId:", userId);

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("[AuthContext] fetchProfile DB error:", error.message, "code:", error.code, "hint:", error.hint);
      // Specific error codes
      if (error.code === "42P17") {
        return {
          profile: null,
          errorMessage:
            "Database policy error (infinite recursion in RLS). " +
            "Please fix your Supabase RLS policies — see SUPABASE_SETUP.md section 4.",
        };
      }
      if (error.code === "PGRST116") {
        return { profile: null, errorMessage: null }; // no row found
      }
      return {
        profile: null,
        errorMessage: `Profile fetch error: ${error.message} (${error.code})`,
      };
    }

    if (!data) {
      console.warn("[AuthContext] fetchProfile: no row returned");
      return { profile: null, errorMessage: null };
    }

    const p = normaliseProfile(data as Record<string, unknown>);
    console.log("[AuthContext] fetchProfile result:", { role: p.role, status: p.status });
    return { profile: p, errorMessage: null };
  }, []);

  // ── On mount: restore session ────────────────────────────────────────────────
  useEffect(() => {
    if (!supabaseConfigured) {
      console.warn("[AuthContext] Supabase not configured — env vars missing");
      setConfigError(true);
      setLoading(false);
      return;
    }

    // Restore existing session on page load
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      console.log("[AuthContext] getSession →", s ? "session found" : "no session");
      if (s) {
        setSession(s);
        setSupabaseUser(s.user);
        const { profile: p } = await fetchProfile(s.user.id);
        if (p && p.status === "Active") setProfile(p);
      }
      setLoading(false);
    });

    // Auth state changes (token refresh, sign-out from another tab, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        console.log("[AuthContext] onAuthStateChange event:", event);
        if (s) {
          setSession(s);
          setSupabaseUser(s.user);
          // Profile is managed explicitly by signIn/signOut; don't overwrite here
          // unless it's a token refresh
          if (event === "TOKEN_REFRESHED") {
            const { profile: p } = await fetchProfile(s.user.id);
            if (p) setProfile(p);
          }
        } else {
          setSession(null);
          setSupabaseUser(null);
          setProfile(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // ── Sign in ─────────────────────────────────────────────────────────────────
  // IMPORTANT: Do NOT call setLoading(true) here.
  // The global `loading` flag is only for the initial session restore on app start.
  // Toggling it during signIn would unmount the Login component (via Router) and
  // swallow any error messages returned to the form.
  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    if (!supabaseConfigured) {
      return { error: "Supabase URL or anon key is missing. Check Replit Secrets." };
    }

    console.log("[AuthContext] signIn → email:", email);
    console.log("[AuthContext] signIn → calling supabase.auth.signInWithPassword...");

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError || !authData.user) {
      console.error("[AuthContext] signInWithPassword error:", authError?.message, "code:", authError?.code);
      const msg = authError?.message ?? "Sign-in failed";
      if (
        authError?.code === "invalid_credentials" ||
        authError?.code === "invalid_grant" ||
        msg.toLowerCase().includes("invalid")
      ) {
        return {
          error: "Invalid email or password. Please check your Supabase Auth user and password.",
        };
      }
      return { error: `Sign-in error: ${msg}` };
    }

    console.log("[AuthContext] signInWithPassword success → user:", authData.user.email);
    console.log("[AuthContext] fetchProfile started for:", authData.user.id);

    const { profile: p, errorMessage: profileErr } = await fetchProfile(authData.user.id);

    if (profileErr) {
      console.error("[AuthContext] profile fetch returned error:", profileErr);
      await supabase.auth.signOut();
      return { error: profileErr };
    }

    if (!p) {
      console.warn("[AuthContext] No profile row found for user:", authData.user.email);
      await supabase.auth.signOut();
      return {
        error:
          "Login successful, but your profile is not configured in public.profiles. " +
          "Please contact IT Admin.",
      };
    }

    console.log("[AuthContext] profile found:", { role: p.role, status: p.status });

    // Validate role
    const validRoles: UserRole[] = ["super_admin", "it_admin", "it_agent", "end_user"];
    if (!validRoles.includes(p.role)) {
      console.error("[AuthContext] Invalid role in profile:", p.role);
      await supabase.auth.signOut();
      return {
        error: `Login successful, but user role "${p.role}" is not configured correctly. Please contact IT Admin.`,
      };
    }

    // Check status (already normalised to "Active" / "Inactive")
    if (p.status !== "Active") {
      console.warn("[AuthContext] Profile status is not Active:", p.status);
      await supabase.auth.signOut();
      return {
        error: "Login successful, but your account status is not Active. Please contact IT Admin.",
      };
    }

    // All checks passed — commit state
    console.log("[AuthContext] signIn complete → role:", p.role, "→ redirecting to /");
    setSession(authData.session);
    setSupabaseUser(authData.user);
    setProfile(p);
    return { error: null };
  };

  // ── Sign out ─────────────────────────────────────────────────────────────────
  const signOut = async () => {
    console.log("[AuthContext] signOut called");
    await supabase.auth.signOut();
    setSession(null);
    setSupabaseUser(null);
    setProfile(null);
  };

  // ── Refresh profile ──────────────────────────────────────────────────────────
  const refreshProfile = async () => {
    if (!supabaseUser) return;
    const { profile: p } = await fetchProfile(supabaseUser.id);
    if (p) setProfile(p);
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  const currentUser: CurrentUser | null = profile ? profileToCurrentUser(profile) : null;
  const role = profile?.role ?? null;
  const isAuthenticated = !!session && !!profile;

  const hasRole = (...roles: UserRole[]): boolean => {
    if (!role) return false;
    return roles.includes(role);
  };

  return (
    <AuthContext.Provider value={{
      session, supabaseUser, profile, currentUser, role,
      loading, configError,
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
