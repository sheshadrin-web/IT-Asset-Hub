// Commit 4 — transport + security test for REMOTE INPUT control.
//
// Proves, with GENUINE Supabase auth identities and the real RLS-gated private
// channel (`remote:session:<id>`), that:
//   A  authorized portal -> agent: control(enable) + mouse/keyboard input are
//      delivered to the agent identity over the private channel.
//   A2 release/disconnect: portal control(disable) reaches the agent (the agent
//      gate + banner close on this), and is also the teardown path.
//   B  an intruder cannot even join the channel, so it cannot inject input, and
//      the agent receives nothing from it.
//   C  once the session token EXPIRES, the portal can no longer join to send
//      input — the same RLS gate that stops frames stops input.
//   D  once the session is TERMINATED, the portal can no longer join to send.
//   E  log_remote_input_state RPC: owner/super_admin may flip input_enabled and
//      it writes an audit row; an intruder is rejected.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const url = readFileSync("/tmp/supa.url", "utf8").trim();
const anon = readFileSync("/tmp/anon.key", "utf8").trim();
const service = readFileSync("/tmp/service.key", "utf8").trim();
const ASSET = "98179a98-1d49-4bba-b758-7fb2efd34d34";

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stamp = Date.now();
const users = {
  portal:   { email: `e2e-in-portal-${stamp}@agent.miles.local`,   pass: `Px!${stamp}aA1` },
  agent:    { email: `e2e-in-agent-${stamp}@agent.miles.local`,    pass: `Ag!${stamp}aA1` },
  intruder: { email: `e2e-in-intruder-${stamp}@agent.miles.local`, pass: `In!${stamp}aA1` },
};
const created = [];
let sid = null;
const results = {};

async function mkUser(key) {
  const { email, pass } = users[key];
  const { data: cu, error: ce } = await admin.auth.admin.createUser({
    email, password: pass, email_confirm: true, user_metadata: { full_name: `E2E ${key}` },
  });
  if (ce) throw new Error(`createUser ${key}: ${ce.message}`);
  created.push(cu.user.id);
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: se } = await c.auth.signInWithPassword({ email, password: pass });
  if (se) throw new Error(`signin ${key}: ${se.message}`);
  return { client: c, uid: cu.user.id };
}

// Join a private channel, registering arbitrary broadcast handlers.
function joinWith(client, channelName, handlers = []) {
  return new Promise((resolve) => {
    let settled = false;
    const ch = client.channel(channelName, { config: { broadcast: { self: false }, private: true } });
    for (const { event, cb } of handlers) ch.on("broadcast", { event }, cb);
    ch.subscribe((status, err) => {
      if (settled) return;
      if (status === "SUBSCRIBED") { settled = true; resolve({ ch, status }); }
      else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        settled = true; resolve({ ch, status, err: err?.message || String(err || "") });
      }
    });
    setTimeout(() => { if (!settled) { settled = true; resolve({ ch, status: "NO_STATUS_TIMEOUT" }); } }, 12000);
  });
}

async function main() {
  log("== Provisioning genuine identities ==");
  const portal = await mkUser("portal");
  const agent = await mkUser("agent");
  const intruder = await mkUser("intruder");
  log(`  portal=${portal.uid.slice(0,8)} agent=${agent.uid.slice(0,8)} intruder=${intruder.uid.slice(0,8)}`);

  const { error: pe } = await admin.from("profiles").upsert(
    { id: portal.uid, full_name: "E2E Portal", email: users.portal.email, role: "it_admin", ecode: "", reporting_manager: "" },
    { onConflict: "id" });
  if (pe) throw new Error("profile upsert: " + pe.message);
  // intruder is also an it_admin profile, to prove RPC denies on ownership (not role)
  const { error: ipe } = await admin.from("profiles").upsert(
    { id: intruder.uid, full_name: "E2E Intruder", email: users.intruder.email, role: "it_admin", ecode: "", reporting_manager: "" },
    { onConflict: "id" });
  if (ipe) throw new Error("intruder profile upsert: " + ipe.message);

  sid = crypto.randomUUID();
  const channelName = "remote:session:" + sid;
  const { error: ie } = await admin.from("remote_access_sessions").insert({
    id: sid, asset_id: ASSET, requested_by: portal.uid, mode: "assisted",
    status: "active", token_expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
    channel_name: channelName, agent_realtime_uid: agent.uid,
  });
  if (ie) throw new Error("session insert: " + ie.message);
  log(`  session ${sid.slice(0,8)} active\n`);

  // agent identity = receiver of input/control
  const inputs = [], controls = [];
  const agentJoin = await joinWith(agent.client, channelName, [
    { event: "input",   cb: (m) => inputs.push(m.payload) },
    { event: "control", cb: (m) => controls.push(m.payload) },
  ]);
  const portalJoin = await joinWith(portal.client, channelName, []);
  log(`== A: authorized portal -> agent input ==`);
  log(`  portal join: ${portalJoin.status}   agent join: ${agentJoin.status}`);

  if (portalJoin.status === "SUBSCRIBED" && agentJoin.status === "SUBSCRIBED") {
    await portalJoin.ch.send({ type: "broadcast", event: "control", payload: { enabled: true, by: "E2E Portal", src: "portal" } });
    const seq = [
      { kind: "mouse", action: "move",  x: 0.5, y: 0.5, src: "portal" },
      { kind: "mouse", action: "down",  button: "left", x: 0.5, y: 0.5, src: "portal" },
      { kind: "mouse", action: "up",    button: "left", x: 0.5, y: 0.5, src: "portal" },
      { kind: "mouse", action: "down",  button: "right", x: 0.3, y: 0.3, src: "portal" },
      { kind: "mouse", action: "up",    button: "right", x: 0.3, y: 0.3, src: "portal" },
      { kind: "mouse", action: "wheel", dx: 0, dy: 3, src: "portal" },
      { kind: "key",   action: "type",  text: "Hello", src: "portal" },
      { kind: "key",   action: "down",  key: "Control", src: "portal" },
      { kind: "key",   action: "down",  key: "c", src: "portal" },
      { kind: "key",   action: "up",    key: "c", src: "portal" },
      { kind: "key",   action: "up",    key: "Control", src: "portal" },
    ];
    for (const ev of seq) {
      await portalJoin.ch.send({ type: "broadcast", event: "input", payload: ev });
      await sleep(40);
    }
    for (let i = 0; i < 30 && inputs.length < seq.length; i++) await sleep(100);
    const enabled = controls.some((c) => c.enabled === true && c.src === "portal");
    log(`  agent received: control(enable)=${enabled}  input events=${inputs.length}/${seq.length}`);
    results.A = enabled && inputs.length === seq.length ? "PASS" : "FAIL";

    // A2: release control reaches agent
    controls.length = 0;
    await portalJoin.ch.send({ type: "broadcast", event: "control", payload: { enabled: false, by: "E2E Portal", src: "portal" } });
    await sleep(1200);
    const released = controls.some((c) => c.enabled === false && c.src === "portal");
    log(`  agent received control(disable on release): ${released}`);
    results.A2 = released ? "PASS" : "FAIL";
  } else { results.A = "FAIL (join)"; results.A2 = "FAIL (join)"; }

  // ── E: RPC authz + audit (do before expiry/termination so session is active) ─
  log(`\n== E: log_remote_input_state RPC authz + audit ==`);
  const before = inputs.length; void before;
  const { data: okEnable } = await portal.client.rpc("log_remote_input_state", { p_session_id: sid, p_enabled: true });
  const { data: r1 } = await admin.from("remote_access_sessions").select("input_enabled").eq("id", sid).single();
  const { data: denied } = await intruder.client.rpc("log_remote_input_state", { p_session_id: sid, p_enabled: true });
  const { data: okDisable } = await portal.client.rpc("log_remote_input_state", { p_session_id: sid, p_enabled: false });
  const { data: r2 } = await admin.from("remote_access_sessions").select("input_enabled").eq("id", sid).single();
  const { data: auditRows } = await admin.from("audit_logs")
    .select("action").eq("metadata->>session_id", sid)
    .in("action", ["remote_access.input_enabled", "remote_access.input_disabled"]);
  log(`  owner enable -> ${JSON.stringify(okEnable)}  db.input_enabled=${r1?.input_enabled}`);
  log(`  intruder enable -> ${JSON.stringify(denied)}`);
  log(`  owner disable -> ${JSON.stringify(okDisable)}  db.input_enabled=${r2?.input_enabled}`);
  log(`  audit rows (enabled/disabled): ${auditRows?.length}`);
  results.E = (okEnable?.success === true && r1?.input_enabled === true
            && denied?.success === false
            && okDisable?.success === true && r2?.input_enabled === false
            && (auditRows?.length ?? 0) >= 2) ? "PASS" : "FAIL";

  // ── B: intruder cannot join -> cannot inject input ─────────────────────────
  log(`\n== B: intruder cannot inject input ==`);
  inputs.length = 0;
  const intruderJoin = await joinWith(intruder.client, channelName, []);
  log(`  intruder join: ${intruderJoin.status}  ${intruderJoin.err || ""}`);
  if (intruderJoin.status === "SUBSCRIBED") {
    // shouldn't happen, but if it did, prove the agent still gets nothing useful
    await intruderJoin.ch.send({ type: "broadcast", event: "input", payload: { kind: "mouse", action: "move", x: 0.9, y: 0.9, src: "intruder" } });
  }
  await sleep(2000);
  const fromIntruder = inputs.filter((i) => i.src === "intruder").length;
  log(`  input events agent received from intruder: ${fromIntruder}`);
  results.B = (intruderJoin.status !== "SUBSCRIBED" && fromIntruder === 0) ? "PASS" : "FAIL";

  // ── C: expiry denies portal from sending input ─────────────────────────────
  log(`\n== C: expired session blocks input ==`);
  await admin.from("remote_access_sessions")
    .update({ token_expires_at: new Date(Date.now() - 60000).toISOString() }).eq("id", sid);
  await sleep(1500);
  const expPortal = await joinWith(portal.client, channelName, []);
  log(`  post-expiry portal join: ${expPortal.status}`);
  results.C = expPortal.status !== "SUBSCRIBED" ? "PASS" : "FAIL";
  try { await admin.removeChannel(expPortal.ch); } catch {}

  // ── D: termination denies portal from sending input ────────────────────────
  log(`\n== D: terminated session blocks input ==`);
  await admin.from("remote_access_sessions")
    .update({ token_expires_at: new Date(Date.now() + 10 * 60000).toISOString(), status: "ended" }).eq("id", sid);
  await sleep(1500);
  const endPortal = await joinWith(portal.client, channelName, []);
  log(`  post-termination portal join: ${endPortal.status}`);
  results.D = endPortal.status !== "SUBSCRIBED" ? "PASS" : "FAIL";
  try { await admin.removeChannel(endPortal.ch); } catch {}

  for (const j of [portalJoin, agentJoin, intruderJoin]) { try { await j.ch.unsubscribe(); } catch {} }

  log("\n==================== RESULTS ====================");
  log(`A  authorized input reaches agent       : ${results.A}`);
  log(`A2 release(control disable) reaches agent: ${results.A2}`);
  log(`B  intruder cannot inject input         : ${results.B}`);
  log(`C  expiry blocks input                  : ${results.C}`);
  log(`D  termination blocks input             : ${results.D}`);
  log(`E  RPC authz + audit (owner ok/intruder): ${results.E}`);
  const all = Object.values(results);
  log(`\nOVERALL: ${all.every((r) => r === "PASS") ? "ALL PASS" : "FAILURES -> " + JSON.stringify(results)}`);
}

async function cleanup() {
  log("\n== Cleanup ==");
  try { if (sid) await admin.from("audit_logs").delete().eq("metadata->>session_id", sid); } catch (e) { log("  audit del:", e.message); }
  try { if (sid) await admin.from("remote_access_sessions").delete().eq("id", sid); } catch (e) { log("  session del:", e.message); }
  try { if (created.length) await admin.from("profiles").delete().in("id", created); } catch (e) { log("  profile del:", e.message); }
  for (const uid of created) { try { await admin.auth.admin.deleteUser(uid); } catch (e) { log("  user del:", e.message); } }
  const { data: pleft } = await admin.from("profiles").select("id").in("id", created);
  log(`  residual profiles: ${pleft ? pleft.length : "?"}`);
  log("  cleanup done");
}

main()
  .catch((e) => { console.error("ERROR:", e.message); results.error = e.message; })
  .finally(async () => { await cleanup(); process.exit(0); });
