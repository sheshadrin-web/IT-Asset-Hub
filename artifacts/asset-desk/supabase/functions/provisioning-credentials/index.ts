// One-time IT-only credential reveal endpoint.
// Plaintext exists only in this request response and the authorized browser
// memory. It is never written to logs, command rows, or audit rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  "Access-Control-Allow-Origin": "*",
  // supabase-js sends x-client-info with browser function invocations. If it
  // is omitted, the browser rejects the preflight before the request reaches
  // the authenticated reveal handler.
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

function decode(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function credentialKey(): Promise<CryptoKey> {
  const material = Deno.env.get("PROVISIONING_CREDENTIAL_KEY");
  if (!material) throw new Error("credential encryption key is not configured");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
}

async function decryptCredential(ciphertext: string): Promise<string> {
  const [ivText, encryptedText] = ciphertext.split(".");
  if (!ivText || !encryptedText) throw new Error("invalid credential envelope");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(ivText) },
    await credentialKey(),
    decode(encryptedText),
  );
  return new TextDecoder().decode(plaintext);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "method not allowed" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return json({ success: false, error: "authentication required" }, 401);

  try {
    const { data: userData, error: userError } = await db.auth.getUser(jwt);
    if (userError || !userData.user) return json({ success: false, error: "authentication required" }, 401);
    const body = await req.json().catch(() => ({}));
    const userDb = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    if (body.purpose === "password_reset") {
      if (typeof body.password !== "string" || body.password.length < 20) {
        return json({ success: false, error: "invalid temporary password" }, 400);
      }
      const ciphertext = await encryptCredential(body.password);
      const prepared = await userDb.rpc("request_user_password_reset", {
        p_asset_id: body.asset_id,
        p_ciphertext: ciphertext,
      });
      if (prepared.error || !prepared.data?.success) {
        return json({ success: false, error: prepared.error?.message ?? "password reset unavailable" }, 403);
      }
      return json(prepared.data);
    }
    const result = body.purpose === "password_reset"
      ? await userDb.rpc("reveal_user_password_reset", {
        p_actor_user_id: userData.user.id,
        p_asset_id: body.asset_id,
      })
      : await db.rpc("reveal_provisioning_credential", {
      p_actor_user_id: userData.user.id,
      p_asset_id: body.asset_id,
    });
    if (result.error || !result.data?.success) {
      return json({ success: false, error: result.error?.message ?? "credential unavailable" }, 403);
    }
    const password = await decryptCredential(result.data.ciphertext);
    return json({ success: true, password });
  } catch {
    return json({ success: false, error: "credential unavailable" }, 500);
  }
});