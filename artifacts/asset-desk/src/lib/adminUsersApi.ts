import { supabase } from "./supabaseClient";

// The Edge Function is deployed at:
//   https://<project-ref>.supabase.co/functions/v1/admin-users
// It accepts { action, payload } JSON and requires an Authorization Bearer token.

const EDGE_FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateUserPayload {
  email:             string;
  password:          string;
  full_name:         string;
  role:              string;
  ecode:             string;
  department:        string;
  location:          string;
  reporting_manager: string;
}

export interface UpdateUserPayload {
  userId:            string;
  full_name:         string;
  role:              string;
  ecode:             string;
  department:        string;
  location:          string;
  reporting_manager: string;
  status:            string;
}

export interface AdminUsersResult {
  success:  boolean;
  error:    string | null;
  userId?:  string;
  message?: string;
  notDeployed?: boolean; // true when the Edge Function 404s
}

// ─── Token helper ─────────────────────────────────────────────────────────────
// supabase.auth.getSession() in Supabase v2 does NOT auto-refresh the access
// token — it just returns whatever is stored in localStorage. If the 1-hour
// JWT has expired the Edge Function rejects it with 401 "invalid or expired token".
//
// This helper fetches the current session and, if the access token has expired
// or will expire within the next 60 seconds, calls refreshSession() to get a
// fresh JWT before returning it.

async function getFreshAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const nowSeconds   = Math.floor(Date.now() / 1000);
  const expiresAt    = session.expires_at ?? 0;          // unix seconds
  const secsLeft     = expiresAt - nowSeconds;

  if (secsLeft > 60) {
    // Token is still valid for more than 60 seconds — use it directly.
    return session.access_token;
  }

  // Token has expired or is about to — force a refresh.
  const { data: refreshed, error } = await supabase.auth.refreshSession();
  if (error || !refreshed.session) return null;
  return refreshed.session.access_token;
}

// ─── Core caller ──────────────────────────────────────────────────────────────

async function callEdgeFunction(
  action: string,
  payload: Record<string, unknown>,
): Promise<AdminUsersResult> {
  const accessToken = await getFreshAccessToken();

  if (!accessToken) {
    return { success: false, error: "Not authenticated — please log in again." };
  }

  let res: Response;
  try {
    res = await fetch(EDGE_FN_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ action, payload }),
    });
  } catch {
    return {
      success: false,
      error: "Network error — could not reach the Edge Function. Check your internet connection.",
    };
  }

  if (res.status === 404) {
    return {
      success:     false,
      error:       "The admin-users Edge Function is not deployed yet.",
      notDeployed: true,
    };
  }

  let body: Record<string, unknown> = {};
  try { body = await res.json(); } catch { /* non-JSON body */ }

  if (!res.ok) {
    return {
      success: false,
      error: (body.error as string) ?? `HTTP ${res.status}: ${res.statusText}`,
    };
  }

  return {
    success: true,
    error:   null,
    userId:  body.userId as string | undefined,
    message: body.message as string | undefined,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const adminUsersApi = {
  createUser:    (payload: CreateUserPayload)  => callEdgeFunction("createUser",        { ...payload }),
  updateProfile: (payload: UpdateUserPayload)  => callEdgeFunction("updateUserProfile", { ...payload }),
  deactivateUser:(userId: string)              => callEdgeFunction("deactivateUser",    { userId }),
  deleteUser:    (userId: string)              => callEdgeFunction("deleteUser",         { userId }),
};
