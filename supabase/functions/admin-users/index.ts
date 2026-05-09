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
        const { email, password, full_name, role, department, location } = payload as {
          email: string; password: string; full_name: string;
          role: string; department: string; location: string;
        };

        if (!email || !password || !full_name || !role) {
          return json({ error: "email, password, full_name, and role are required" }, 400);
        }

        // Create auth user — pass profile fields as user_metadata.
        // A SECURITY DEFINER trigger on auth.users reads these and creates the
        // public.profiles row automatically, bypassing RLS and permission checks.
        const { data: authData, error: createErr } = await adminClient.auth.admin.createUser({
          email: email.trim().toLowerCase(),
          password,
          email_confirm: true,
          user_metadata: {
            full_name: full_name.trim(),
            role,
            department: department?.trim() ?? "",
            location:   location?.trim()   ?? "",
          },
        });

        if (createErr || !authData.user) {
          return json({ error: createErr?.message ?? "Failed to create auth user" }, 400);
        }

        const newUserId = authData.user.id;

        // Always attempt profile insert via direct PostgREST REST call.
        // Using service_role key in both apikey + Authorization headers gives
        // full BYPASSRLS access. "resolution=ignore-duplicates" means if the
        // DB trigger already created the profile, this is a no-op.
        const insertRes = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
          method: "POST",
          headers: {
            "apikey":        serviceRoleKey,
            "Authorization": `Bearer ${serviceRoleKey}`,
            "Content-Type":  "application/json",
            "Prefer":        "return=minimal,resolution=ignore-duplicates",
          },
          body: JSON.stringify({
            id:         newUserId,
            email:      email.trim().toLowerCase(),
            full_name:  full_name.trim(),
            role,
            department: department?.trim() ?? "",
            location:   location?.trim()   ?? "",
            status:     "Active",
          }),
        });

        if (!insertRes.ok) {
          const errText = await insertRes.text().catch(() => insertRes.statusText);
          // Profile failed — roll back the auth user so nothing is left dangling
          await adminClient.auth.admin.deleteUser(newUserId);
          return json({ error: `Profile insert failed: ${errText}` }, 500);
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
