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

const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Separate anon-key client used purely to exchange an admin-generated magiclink
// token for a real user session (verifyOtp is a public auth call).
const anonAuth = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Mint a GENUINE, short-lived Supabase auth session for a CONTROLLED per-asset
// agent identity. We never touch a JWT secret and never enable anonymous sign-in.
// (DB-side HMAC minting is impossible on this project: the in-use signing key is
// asymmetric ES256 and no HS256 secret is exposed to the database.) The identity
// is a normal — but profile-less and powerless — auth user created by the service
// role. On each mint we set a fresh random password and sign in with it to obtain
// a real session (no email is ever sent). We deliberately do NOT use magiclink +
// verifyOtp: that exchange proved unreliable on this project's GoTrue config
// ("Email link is invalid or has expired" even for freshly-generated tokens),
// which silently broke the agent's channel join. The returned token is what the
// device agent presents to join the PRIVATE Realtime channel; RLS binds it to one
// session via agent_realtime_uid.
async function mintAgentRealtimeSession(assetId: string) {
  const email = `remote-agent.${assetId}@agent.miles.local`;
  // Keep under bcrypt's 72-byte limit; one UUID is ample entropy for a
  // single-use, immediately-consumed password.
  const password = `Ag3nt!${crypto.randomUUID()}`;
  let userId: string | null = null;

  // Ensure the controlled per-asset identity exists, then (re)set its password
  // to the freshly generated value for this mint.
  const created = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { remote_agent: true, asset_id: assetId },
  });
  if (created.error) {
    // Already registered → resolve its id and rotate the password for this mint.
    if (created.error.code !== "email_exists") {
      throw new Error(`agent identity: ${created.error.message}`);
    }
    const link = await db.auth.admin.generateLink({ type: "magiclink", email });
    userId = link.data?.user?.id ?? null;
    if (!userId) {
      throw new Error(`agent identity: ${link.error?.message ?? "could not resolve user"}`);
    }
    const upd = await db.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (upd.error) throw new Error(`agent identity: ${upd.error.message}`);
  } else {
    userId = created.data.user?.id ?? null;
  }

  // Sign in with the just-set password to obtain a GENUINE short-lived session.
  const signin = await anonAuth.auth.signInWithPassword({ email, password });
  if (signin.error || !signin.data?.session) {
    throw new Error(`verify: ${signin.error?.message ?? "no session"}`);
  }
  return {
    user_id:       userId ?? signin.data.user?.id ?? null,
    access_token:  signin.data.session.access_token,
    refresh_token: signin.data.session.refresh_token,
    expires_at:    signin.data.session.expires_at,
  };
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
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
      const r = await rpc("agent_register", { p_token: token, p_payload: body.payload ?? body });
      return r.ok ? json(r.data) : json({ success: false, error: r.error }, 400);
    }

    if (req.method === "POST" && path === "/sync") {
      const r = await rpc("agent_sync", { p_token: token, p_payload: body.payload ?? body });
      return r.ok ? json(r.data) : json({ success: false, error: r.error }, 400);
    }

    if (req.method === "GET" && path === "/wallpaper/active") {
      const r = await rpc("agent_get_active_wallpaper", { p_token: token });
      return r.ok ? json(r.data) : json({ success: false, error: r.error }, 400);
    }

    // GET /remote-access — pending Assisted Access sessions for this device
    if (req.method === "GET" && path === "/remote-access") {
      const r = await rpc("agent_get_pending_remote_access", { p_token: token });
      return r.ok ? json(r.data) : json({ success: false, error: r.error }, 400);
    }

    // GET /remote-access/session?session_id=... — the agent polls this after the
    // end user approves. Returns { ready:false } until the portal has issued a
    // session token, then { ready:true, session_token, channel_name, ... } plus
    // the public Realtime connection params so the agent can join the per-session
    // broadcast channel WITHOUT hardcoding any key. The anon key returned here is
    // the same public key already shipped in the browser bundle.
    if (req.method === "GET" && path === "/remote-access/session") {
      const sessionId = url.searchParams.get("session_id") ?? "";
      const r = await rpc("agent_get_remote_session_token", {
        p_token:      token,
        p_session_id: sessionId,
      });
      if (!r.ok) return json({ success: false, error: r.error }, 400);
      const data = (r.data ?? {}) as Record<string, unknown>;
      if (data.ready === true) {
        // https://<ref>.supabase.co -> wss://<ref>.supabase.co/realtime/v1/websocket
        data.realtime_url = SUPABASE_URL.replace(/^http/, "ws") + "/realtime/v1/websocket";
        data.anon_key     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      }
      return json(data);
    }

    // POST /remote-access/claim — { session_id, instance_id }. Single-agent lock:
    // the first instance to claim wins; another instance with the same token is
    // rejected so one (possibly shared) token can't drive two agents.
    if (req.method === "POST" && path === "/remote-access/claim") {
      const r = await rpc("agent_claim_remote_session", {
        p_token:       token,
        p_session_id:  body.session_id,
        p_instance_id: body.instance_id,
      });
      return r.ok ? json(r.data) : json({ success: false, error: r.error }, 400);
    }

    // POST /remote-access/realtime-token — { session_id }. The agent calls this
    // (after claiming) to obtain a GENUINE Supabase auth token bound to the
    // session, so it can join the PRIVATE per-session channel. We re-check the
    // session is active & belongs to this device, then mint + bind the identity.
    if (req.method === "POST" && path === "/remote-access/realtime-token") {
      const sessionId = body.session_id;
      if (!sessionId) return json({ success: false, error: "missing session_id" }, 400);

      const tok = await rpc("agent_get_remote_session_token", {
        p_token: token, p_session_id: sessionId,
      });
      if (!tok.ok) return json({ success: false, error: tok.error }, 400);
      const sess = (tok.data ?? {}) as Record<string, unknown>;
      if (sess.ready !== true) {
        return json({ success: true, ready: false, status: sess.status ?? null, error: sess.error ?? null });
      }

      const assetId = String(sess.asset_id);
      let minted;
      try {
        minted = await mintAgentRealtimeSession(assetId);
      } catch (e) {
        return json({ success: false, error: (e as Error).message }, 500);
      }
      if (!minted.user_id) return json({ success: false, error: "could not resolve agent identity" }, 500);

      const bind = await rpc("agent_bind_realtime_uid", {
        p_token: token, p_session_id: sessionId, p_uid: minted.user_id,
      });
      if (!bind.ok) return json({ success: false, error: bind.error }, 400);

      return json({
        success:       true,
        ready:         true,
        access_token:  minted.access_token,
        refresh_token: minted.refresh_token,
        expires_at:    minted.expires_at,
        realtime_url:  SUPABASE_URL.replace(/^http/, "ws") + "/realtime/v1/websocket",
        auth_url:      SUPABASE_URL + "/auth/v1",
        anon_key:      ANON_KEY,
        channel_name:  sess.channel_name,
        asset_id:      assetId,
      });
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

    // POST /remote-access/respond — { session_id, response: "approved"|"denied" }
    if (req.method === "POST" && path === "/remote-access/respond") {
      const r = await rpc("agent_respond_remote_access", {
        p_token:      token,
        p_session_id: body.session_id,
        p_response:   body.response,
      });
      return r.ok ? json(r.data) : json({ success: false, error: r.error }, 400);
    }

    return json({ success: false, error: `route not found: ${req.method} ${path}` }, 404);
  } catch (err) {
    return json({ success: false, error: (err as Error).message }, 500);
  }
});
