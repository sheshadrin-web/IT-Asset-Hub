import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // ── Verify caller's JWT ───────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing Authorization header" }, 401);
    }
    const callerToken = authHeader.replace("Bearer ", "").trim();

    const supabaseUrl    = Deno.env.get("SUPABASE_URL")             ?? "";
    const anonKey        = Deno.env.get("SUPABASE_ANON_KEY")        ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!serviceRoleKey) {
      return json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured on Edge Function. Run: supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<key>" }, 500);
    }

    // Caller-scoped client — only used to verify identity and role
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${callerToken}` } },
    });

    const { data: { user: callerUser }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !callerUser) {
      return json({ error: "Unauthorized — invalid or expired token" }, 401);
    }

    const { data: callerProfile, error: profileErr } = await callerClient
      .from("profiles")
      .select("role")
      .eq("id", callerUser.id)
      .single();

    if (profileErr || !callerProfile) {
      return json({ error: "Could not verify caller profile" }, 403);
    }
    if (callerProfile.role !== "super_admin") {
      return json({ error: "Forbidden — only super_admin can perform this action" }, 403);
    }

    // ── Service-role admin client ─────────────────────────────────────────────
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const { action, payload } = body as { action: string; payload: Record<string, unknown> };

    switch (action) {

      case "createUser": {
        const {
          email, password, full_name, role,
          ecode, department, location, reporting_manager,
        } = payload as {
          email: string; password: string; full_name: string; role: string;
          ecode?: string; department?: string; location?: string; reporting_manager?: string;
        };

        if (!email || !password || !full_name || !role) {
          return json({ error: "email, password, full_name, and role are required" }, 400);
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanName  = full_name.trim();

        // ── Check if a profile already exists for this email ──────────────────
        const { data: existingProfile } = await adminClient
          .from("profiles")
          .select("id")
          .eq("email", cleanEmail)
          .maybeSingle();

        let userId: string;
        let isExisting = false;

        if (existingProfile) {
          // Profile already exists — skip auth creation, just upsert profile data
          userId     = existingProfile.id;
          isExisting = true;
        } else {
          // Create the Supabase Auth user
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

            // "User already registered" — auth user exists but profile row is missing.
            // Find the auth user by listing all users and matching email.
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
                return json({ error: `User ${cleanEmail} already registered in Auth but cannot be located.` }, 409);
              }
            } else {
              return json({ error: msg }, 400);
            }
          } else {
            userId = authData.user.id;
          }
        }

        // ── Upsert the profile row (merge-duplicates handles re-runs safely) ──
        const profileBody = {
          id:                userId,
          email:             cleanEmail,
          full_name:         cleanName,
          role,
          ecode:             ecode?.trim()             ?? "",
          department:        department?.trim()        ?? "",
          location:          location?.trim()          ?? "",
          reporting_manager: reporting_manager?.trim() ?? "",
          status:            "active",
        };

        const upsertRes = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
          method: "POST",
          headers: {
            "apikey":        serviceRoleKey,
            "Authorization": `Bearer ${serviceRoleKey}`,
            "Content-Type":  "application/json",
            "Prefer":        "return=minimal,resolution=merge-duplicates",
          },
          body: JSON.stringify(profileBody),
        });

        if (!upsertRes.ok) {
          const errText = await upsertRes.text().catch(() => upsertRes.statusText);
          // Roll back only if we just created the auth user
          if (!isExisting) {
            await adminClient.auth.admin.deleteUser(userId);
          }
          return json({ error: `Profile upsert failed: ${errText}` }, 500);
        }

        return json({
          success: true,
          userId,
          message: isExisting
            ? `User ${cleanEmail} already existed — profile updated.`
            : `User ${cleanEmail} created successfully.`,
        });
      }

      case "updateUserProfile": {
        const { userId, full_name, role, ecode, department, location, reporting_manager, status } = payload as {
          userId: string; full_name: string; role: string; ecode?: string;
          department: string; location: string; reporting_manager?: string; status: string;
        };
        if (!userId) return json({ error: "userId is required" }, 400);

        const { error: updateErr } = await adminClient
          .from("profiles")
          .update({
            full_name,
            role,
            ecode:             ecode             ?? "",
            department,
            location,
            reporting_manager: reporting_manager ?? "",
            status,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);

        if (updateErr) return json({ error: updateErr.message }, 500);
        return json({ success: true, message: "Profile updated" });
      }

      case "deactivateUser": {
        const { userId } = payload as { userId: string };
        if (!userId) return json({ error: "userId is required" }, 400);

        const { error: deactivateErr } = await adminClient
          .from("profiles")
          .update({ status: "inactive", updated_at: new Date().toISOString() })
          .eq("id", userId);

        if (deactivateErr) return json({ error: deactivateErr.message }, 500);
        return json({ success: true, message: "User deactivated" });
      }

      case "deleteUser": {
        const { userId } = payload as { userId: string };
        if (!userId) return json({ error: "userId is required" }, 400);
        if (userId === callerUser.id) {
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
