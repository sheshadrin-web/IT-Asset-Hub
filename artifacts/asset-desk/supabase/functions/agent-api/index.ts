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

function requestPublicIp(req: Request): string | null {
  // Supabase's proxy supplies the client address in one of these headers.
  // Take only the first forwarded value and never trust a payload-supplied IP.
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded
    || req.headers.get("cf-connecting-ip")?.trim()
    || req.headers.get("x-real-ip")?.trim();
  if (!candidate || candidate.length > 64) return null;
  // The provider must never be asked to resolve private/link-local addresses.
  if (
    candidate === "127.0.0.1" ||
    candidate === "::1" ||
    /^10\./.test(candidate) ||
    /^192\.168\./.test(candidate) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(candidate) ||
    /^169\.254\./.test(candidate) ||
    candidate.startsWith("fc") ||
    candidate.startsWith("fd")
  ) return null;
  return candidate;
}

async function addNetworkLocation(req: Request, payload: Record<string, any>) {
  if (payload.location_request !== "network") return payload;
  const publicIp = requestPublicIp(req);
  if (!publicIp) return payload;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let response: Response;
    try {
      response = await fetch(`https://ipwho.is/${encodeURIComponent(publicIp)}`, {
        signal: controller.signal,
        headers: { "Accept": "application/json" },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) return payload;
    const result = await response.json().catch(() => null);
    const latitude = Number(result?.latitude);
    const longitude = Number(result?.longitude);
    if (
      result?.success !== true ||
      !result?.city || !result?.country ||
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    ) return payload;
    return {
      ...payload,
      location: {
        source: "network",
        city: String(result.city).slice(0, 160),
        region: result.region ? String(result.region).slice(0, 160) : null,
        postal_code: result.postal ? String(result.postal).slice(0, 40) : null,
        country: String(result.country).slice(0, 160),
        public_ip: publicIp,
        latitude,
        longitude,
        accuracy_m: 50000,
        captured_at: new Date().toISOString(),
      },
    };
  } catch {
    // Location is best-effort. Never fail registration/heartbeat on lookup errors.
    return payload;
  }
}

Deno.serve(async (req) => {
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
      const payload = await addNetworkLocation(req, body.payload ?? body);
      const r = await rpc("agent_register", { p_token: token, p_payload: payload });
      return r.ok ? json(r.data) : json({ success: false, error: r.error }, 400);
    }

    if (req.method === "POST" && path === "/sync") {
      const payload = await addNetworkLocation(req, body.payload ?? body);
      const r = await rpc("agent_sync", { p_token: token, p_payload: payload });
      return r.ok ? json(r.data) : json({ success: false, error: r.error }, 400);
    }

    if (req.method === "GET" && path === "/wallpaper/active") {
      const r = await rpc("agent_get_active_wallpaper", { p_token: token });
      return r.ok ? json(r.data) : json({ success: false, error: r.error }, 400);
    }

    if (req.method === "POST" && path === "/wallpaper/status") {
      const r = await rpc("agent_report_wallpaper", {
        p_token:        token,
        p_wallpaper_id: body.wallpaper_id ?? null,
        p_status:       body.status,
        p_error:        body.error ?? null,
      });
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
