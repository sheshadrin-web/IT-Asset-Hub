// Miles IT Assets — Agent API (Phase 1)
// Single edge function that routes all agent endpoints. Authenticated via the
// `X-Agent-Token` header. Database mutations happen inside SECURITY DEFINER
// RPCs so the surface here is intentionally thin and easy to port to AWS later.
//
// Routes (all POST except where noted):
//   POST /agent-api/register        { payload }
//   POST /agent-api/sync            { payload }
//   GET  /agent-api/commands
//   POST /agent-api/commands/status { id, status, result?, error? }
//
// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url   = new URL(req.url);
  const path  = url.pathname.replace(/^.*\/agent-api/, "") || "/";
  const token = req.headers.get("x-agent-token") ?? "";
  if (!token) return json({ success: false, error: "missing X-Agent-Token" }, 401);

  try {
    // GET /commands
    if (req.method === "GET" && path === "/commands") {
      const r = await rpc("agent_fetch_commands", { p_token: token });
      return r.ok ? json(r.data) : json({ success: false, error: r.error }, 400);
    }

    // From here on we expect a JSON body
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (req.method === "POST" && path === "/register") {
      const r = await rpc("agent_register", { p_token: token, p_payload: body.payload ?? body });
      return r.ok ? json(r.data) : json({ success: false, error: r.error }, 400);
    }

    if (req.method === "POST" && path === "/sync") {
      const r = await rpc("agent_sync", { p_token: token, p_payload: body.payload ?? body });
      return r.ok ? json(r.data) : json({ success: false, error: r.error }, 400);
    }

    if (req.method === "POST" && path === "/commands/status") {
      const r = await rpc("agent_update_command", {
        p_token: token,
        p_command_id: body.id,
        p_status:     body.status,
        p_result:     body.result ?? null,
        p_error:      body.error  ?? null,
      });
      return r.ok ? json(r.data) : json({ success: false, error: r.error }, 400);
    }

    return json({ success: false, error: `route not found: ${req.method} ${path}` }, 404);
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
});
