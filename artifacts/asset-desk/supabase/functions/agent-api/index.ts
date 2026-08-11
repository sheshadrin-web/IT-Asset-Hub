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

function isPublicIp(candidate: string): boolean {
  if (!candidate || candidate.length > 64) return false;
  if (candidate.includes(":")) {
    const ip = candidate.toLowerCase();
    if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") ||
        ip.startsWith("fe8") || ip.startsWith("fe9") ||
        ip.startsWith("fea") || ip.startsWith("feb")) return false;
    // Require a syntactically plausible IPv6 address. URL parsing handles
    // compressed forms without accepting arbitrary strings.
    try { new URL(`http://[${candidate}]/`); } catch { return false; }
    return true;
  }
  const octets = candidate.split(".");
  if (octets.length !== 4 || octets.some((o) => !/^\d{1,3}$/.test(o))) return false;
  const nums = octets.map(Number);
  if (nums.some((n) => n > 255)) return false;
  if (nums[0] === 10 || nums[0] === 127 || nums[0] === 0 ||
      (nums[0] === 192 && nums[1] === 168) ||
      (nums[0] === 169 && nums[1] === 254) ||
      (nums[0] === 172 && nums[1] >= 16 && nums[1] <= 31)) return false;
  return true;
}

function requestPublicIp(req: Request): string | null {
  // Supabase's hosted edge proxy supplies the client address through its
  // platform forwarding metadata. The agent payload is never consulted.
  // Prefer the single-address Cloudflare metadata, then the proxy's
  // x-real-ip, and finally the first value in the proxy-normalized chain.
  const candidates = [
    req.headers.get("cf-connecting-ip")?.trim(),
    req.headers.get("x-real-ip")?.trim(),
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  ].filter((value): value is string => !!value);
  return candidates.find(isPublicIp) ?? null;
}

async function addNetworkLocation(req: Request, payload: Record<string, any>) {
  if (payload.location_request !== "network") return payload;
  const publicIp = requestPublicIp(req);
  if (!publicIp) return payload;
  const prepared = await rpc("agent_prepare_network_location", {
    p_token: tokenForRequest(req),
    p_public_ip: publicIp,
  });
  if (prepared.ok && prepared.data?.action === "cache") {
    return { ...payload, location: prepared.data.location };
  }
  if (!prepared.ok || prepared.data?.action !== "lookup") return payload;
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
    if (!response.ok) {
      await recordNetworkLocationFailure(req, publicIp);
      return payload;
    }
    const result = await response.json().catch(() => null);
    const latitude = Number(result?.latitude);
    const longitude = Number(result?.longitude);
    if (
      result?.success !== true ||
      !result?.city || !result?.country ||
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    ) {
      await recordNetworkLocationFailure(req, publicIp);
      return payload;
    }
    const location = {
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
    };
    const stored = await rpc("agent_record_network_location", {
      p_token: tokenForRequest(req),
      p_public_ip: publicIp,
      p_location: location,
      p_provider: "ipwho.is",
      p_success: true,
    });
    return {
      ...payload,
      location: stored.ok && stored.data?.location ? stored.data.location : location,
    };
  } catch {
    // Location is best-effort. Never fail registration/heartbeat on lookup errors.
    await recordNetworkLocationFailure(req, publicIp);
    return payload;
  }
}

function tokenForRequest(req: Request): string {
  return req.headers.get("x-agent-token") ?? "";
}

async function recordNetworkLocationFailure(req: Request, publicIp: string) {
  await rpc("agent_record_network_location", {
    p_token: tokenForRequest(req),
    p_public_ip: publicIp,
    p_location: null,
    p_provider: "ipwho.is",
    p_success: false,
  });
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
