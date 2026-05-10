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

// ─── Core caller ──────────────────────────────────────────────────────────────

async function callEdgeFunction(
  action: string,
  payload: Record<string, unknown>,
): Promise<AdminUsersResult> {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return { success: false, error: "Not authenticated — please log in again." };
  }

  let res: Response;
  try {
    res = await fetch(EDGE_FN_URL, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
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
