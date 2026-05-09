import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // ── Read and verify caller's JWT ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing Authorization header" }, 401);
    }
    const callerToken = authHeader.replace("Bearer ", "").trim();

    // Supabase env vars — injected automatically in Edge Function runtime
    const supabaseUrl       = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey           = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!serviceRoleKey) {
      return json({ error: "SUPABASE_SERVICE_ROLE_KEY not set on Edge Function" }, 500);
    }

    // Client scoped to the caller's JWT — used to verify identity and role
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${callerToken}` } },
    });

    // Verify caller is authenticated and is super_admin
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

    // ── Service-role client — elevated permissions ────────────────────────────
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Parse request body ────────────────────────────────────────────────────
    const body = await req.json();
    const { action, payload } = body as { action: string; payload: Record<string, unknown> };

    // ── Route action ─────────────────────────────────────────────────────────
    switch (action) {
      case "createUser": {
        const { email, password, full_name, role, department, location } = payload as {
          email: string; password: string; full_name: string;
          role: string; department: string; location: string;
        };

        if (!email || !password || !full_name || !role) {
          return json({ error: "email, password, full_name, and role are required" }, 400);
        }

        // Create Supabase Auth user
        const { data: authData, error: createErr } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true, // skip email confirmation
        });

        if (createErr || !authData.user) {
          return json({ error: createErr?.message ?? "Failed to create auth user" }, 400);
        }

        const newUserId = authData.user.id;

        // Insert profile row
        const { error: profileInsertErr } = await adminClient.from("profiles").insert({
          id:         newUserId,
          email:      email.toLowerCase().trim(),
          full_name:  full_name.trim(),
          role,
          department: department?.trim() ?? "",
          location:   location?.trim() ?? "",
          status:     "Active",
        });

        if (profileInsertErr) {
          // Rollback — delete the auth user we just created
          await adminClient.auth.admin.deleteUser(newUserId);
          return json({ error: `Profile insert failed: ${profileInsertErr.message}` }, 500);
        }

        return json({ success: true, userId: newUserId, message: `User ${email} created successfully` });
      }

      case "updateUserProfile": {
        const { userId, full_name, role, department, location, status } = payload as {
          userId: string; full_name: string; role: string;
          department: string; location: string; status: string;
        };

        if (!userId) return json({ error: "userId is required" }, 400);

        const { error: updateErr } = await adminClient
          .from("profiles")
          .update({ full_name, role, department, location, status, updated_at: new Date().toISOString() })
          .eq("id", userId);

        if (updateErr) return json({ error: updateErr.message }, 500);
        return json({ success: true, message: "Profile updated" });
      }

      case "deactivateUser": {
        const { userId } = payload as { userId: string };
        if (!userId) return json({ error: "userId is required" }, 400);

        const { error: deactivateErr } = await adminClient
          .from("profiles")
          .update({ status: "Inactive", updated_at: new Date().toISOString() })
          .eq("id", userId);

        if (deactivateErr) return json({ error: deactivateErr.message }, 500);
        return json({ success: true, message: "User deactivated" });
      }

      case "deleteUser": {
        const { userId } = payload as { userId: string };
        if (!userId) return json({ error: "userId is required" }, 400);

        // Prevent self-deletion
        if (userId === callerUser.id) {
          return json({ error: "You cannot delete your own account" }, 400);
        }

        // Delete from Supabase Auth — cascades to profiles via FK
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
