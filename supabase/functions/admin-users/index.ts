import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── JWT helper ────────────────────────────────────────────────────────────────
// Supabase Edge Functions verify the JWT signature automatically when deployed
// with --verify-jwt (the default). We decode the payload here to extract the
// sub (user UUID) without making an extra network call to Supabase Auth.
// This bypasses callerClient.auth.getUser() which can fail under rate-limits
// or when called 300+ times in rapid succession during bulk imports.
function decodeJWTPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return {};
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // ── Extract and validate the caller's JWT ─────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing Authorization header" }, 401);
    }
    const callerToken = authHeader.replace("Bearer ", "").trim();

    const supabaseUrl    = Deno.env.get("SUPABASE_URL")             ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey        = Deno.env.get("SUPABASE_ANON_KEY")        ?? "";

    if (!serviceRoleKey) {
      return json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured. Run: supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<key>" }, 500);
    }

    // ── Decode JWT to get the caller's user ID ───────────────────────────────
    // Supabase proxy already verified the signature (--verify-jwt default).
    // We decode the payload to extract `sub` (UUID) and `exp` (expiry).
    const payload = decodeJWTPayload(callerToken);
    const callerUserId = payload.sub as string | undefined;
    const exp          = payload.exp as number | undefined;

    if (!callerUserId) {
      return json({ error: "Unauthorized — could not decode token identity" }, 401);
    }
    // Check expiry (belt-and-suspenders; Supabase proxy does this too)
    if (exp && exp < Math.floor(Date.now() / 1000)) {
      return json({ error: "Unauthorized — token has expired, please refresh the page and log in again" }, 401);
    }

    // ── Service-role admin client ─────────────────────────────────────────────
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Verify the caller is super_admin ──────────────────────────────────────
    // Use adminClient (service role) so RLS never blocks this check.
    const { data: callerProfile, error: profileErr } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", callerUserId)
      .single();

    if (profileErr || !callerProfile) {
      // Fallback: verify via Supabase Auth REST endpoint if profile lookup fails
      const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          "Authorization": `Bearer ${callerToken}`,
          "apikey": anonKey,
        },
      });
      if (!verifyRes.ok) {
        return json({ error: "Unauthorized — could not verify caller identity" }, 401);
      }
      return json({ error: "Forbidden — caller profile not found" }, 403);
    }

    if (callerProfile.role !== "super_admin") {
      return json({ error: "Forbidden — only super_admin can perform this action" }, 403);
    }

    // ── Parse request body ────────────────────────────────────────────────────
    const body = await req.json();
    const { action, payload: p } = body as { action: string; payload: Record<string, unknown> };

    switch (action) {

      case "createUser": {
        const {
          email, password, full_name, role,
          ecode, department, location, reporting_manager,
        } = p as {
          email: string; password: string; full_name: string; role: string;
          ecode?: string; department?: string; location?: string; reporting_manager?: string;
        };

        if (!email || !password || !full_name || !role) {
          return json({ error: "email, password, full_name, and role are required" }, 400);
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanName  = full_name.trim();

        // Check if profile already exists (handles re-imports safely)
        const { data: existingProfile } = await adminClient
          .from("profiles")
          .select("id")
          .eq("email", cleanEmail)
          .maybeSingle();

        let userId: string;
        let isExisting = false;

        if (existingProfile) {
          userId     = existingProfile.id;
          isExisting = true;
        } else {
          const { data: authData, error: createErr } = await adminClient.auth.admin.createUser({
            email:         cleanEmail,
            password,
            email_confirm: true,
            user_metadata: {
              full_name:         cleanName,
              role,
              ecode:             ecode?.trim()             ?? "",
              department:        department?.trim()        ?? "",
              location:          location?.trim()          ?? "",
              reporting_manager: reporting_manager?.trim() ?? "",
            },
          });

          if (createErr || !authData?.user) {
            const msg = createErr?.message ?? "Failed to create auth user";
            // User already registered in Auth but no profile row — find them
            if (
              msg.toLowerCase().includes("already registered") ||
              msg.toLowerCase().includes("already been registered") ||
              msg.toLowerCase().includes("already exists")
            ) {
              const { data: listData } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 50000 });
              const found = listData?.users?.find(u => u.email?.toLowerCase() === cleanEmail);
              if (found) {
                userId     = found.id;
                isExisting = true;
              } else {
                return json({ error: `User ${cleanEmail} is already registered in Auth but cannot be located.` }, 409);
              }
            } else {
              return json({ error: msg }, 400);
            }
          } else {
            userId = authData.user.id;
          }
        }

        // Upsert the profile row (merge-duplicates = safe re-run)
        const upsertRes = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
          method: "POST",
          headers: {
            "apikey":        serviceRoleKey,
            "Authorization": `Bearer ${serviceRoleKey}`,
            "Content-Type":  "application/json",
            "Prefer":        "return=minimal,resolution=merge-duplicates",
          },
          body: JSON.stringify({
            id:                userId,
            email:             cleanEmail,
            full_name:         cleanName,
            role,
            ecode:             ecode?.trim()             ?? "",
            department:        department?.trim()        ?? "",
            location:          location?.trim()          ?? "",
            reporting_manager: reporting_manager?.trim() ?? "",
            status:            "active",
          }),
        });

        if (!upsertRes.ok) {
          const errText = await upsertRes.text().catch(() => upsertRes.statusText);
          if (!isExisting) await adminClient.auth.admin.deleteUser(userId);
          return json({ error: `Profile upsert failed: ${errText}` }, 500);
        }

        return json({
          success: true, userId,
          message: isExisting
            ? `User ${cleanEmail} already existed — profile refreshed.`
            : `User ${cleanEmail} created successfully.`,
        });
      }

      case "updateUserProfile": {
        const { userId, full_name, role, ecode, department, location, reporting_manager, status } = p as {
          userId: string; full_name: string; role: string; ecode?: string;
          department: string; location: string; reporting_manager?: string; status: string;
        };
        if (!userId) return json({ error: "userId is required" }, 400);
        const { error: updateErr } = await adminClient
          .from("profiles")
          .update({ full_name, role, ecode: ecode ?? "", department, location, reporting_manager: reporting_manager ?? "", status, updated_at: new Date().toISOString() })
          .eq("id", userId);
        if (updateErr) return json({ error: updateErr.message }, 500);
        return json({ success: true, message: "Profile updated" });
      }

      case "deactivateUser": {
        const { userId } = p as { userId: string };
        if (!userId) return json({ error: "userId is required" }, 400);
        const { error: deactivateErr } = await adminClient
          .from("profiles")
          .update({ status: "inactive", updated_at: new Date().toISOString() })
          .eq("id", userId);
        if (deactivateErr) return json({ error: deactivateErr.message }, 500);
        return json({ success: true, message: "User deactivated" });
      }

      case "deleteUser": {
        const { userId } = p as { userId: string };
        if (!userId) return json({ error: "userId is required" }, 400);
        if (userId === callerUserId) {
          return json({ error: "You cannot delete your own account" }, 400);
        }
        const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
        if (deleteErr) return json({ error: deleteErr.message }, 500);
        return json({ success: true, message: "User deleted from Auth and profiles" });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected server error";
    console.error("[admin-users]", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
