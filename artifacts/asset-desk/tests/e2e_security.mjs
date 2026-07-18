import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const url = readFileSync("/tmp/supa.url", "utf8").trim();
const anon = readFileSync("/tmp/anon.key", "utf8").trim();
const service = readFileSync("/tmp/service.key", "utf8").trim();
const ASSET = "98179a98-1d49-4bba-b758-7fb2efd34d34";

const jpeg = readFileSync("/home/runner/workspace/.work/first_frame.jpg");
const b64 = jpeg.toString("base64");
const W = 1280, H = 719;

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

const stamp = Date.now();
const users = {
  portal:   { email: `e2e-portal-${stamp}@agent.miles.local`,   pass: `Px!${stamp}aA1` },
  agent:    { email: `e2e-agent-${stamp}@agent.miles.local`,    pass: `Ag!${stamp}aA1` },
  intruder: { email: `e2e-intruder-${stamp}@agent.miles.local`, pass: `In!${stamp}aA1` },
};
const created = [];
let sid = null;

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mkUser(key) {
  const { email, pass } = users[key];
  const { data: cu, error: ce } = await admin.auth.admin.createUser({
    email, password: pass, email_confirm: true, user_metadata: { full_name: `E2E ${key}` },
  });
  if (ce) throw new Error(`createUser ${key}: ${ce.message}`);
  const uid = cu.user.id;
  created.push(uid);
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: si, error: se } = await c.auth.signInWithPassword({ email, password: pass });
  if (se) throw new Error(`signin ${key}: ${se.message}`);
  return { client: c, uid, token: si.session.access_token };
}

function joinPrivate(client, channelName, onFrame) {
  return new Promise((resolve) => {
    let settled = false;
    const ch = client.channel(channelName, { config: { broadcast: { self: false }, private: true } });
    if (onFrame) ch.on("broadcast", { event: "frame" }, onFrame);
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

const results = {};

async function main() {
  log("== Provisioning genuine identities ==");
  const portal = await mkUser("portal");
  const agent = await mkUser("agent");
  const intruder = await mkUser("intruder");
  log(`  portal uid=${portal.uid.slice(0, 8)}  agent uid=${agent.uid.slice(0, 8)}  intruder uid=${intruder.uid.slice(0, 8)}`);

  // Portal user must own a profile (requested_by -> profiles.id).
  const { error: pe } = await admin.from("profiles").upsert(
    { id: portal.uid, full_name: "E2E Portal", email: users.portal.email, role: "it_admin", ecode: "", reporting_manager: "" },
    { onConflict: "id" }
  );
  if (pe) throw new Error("profile upsert: " + pe.message);

  sid = crypto.randomUUID();
  const channelName = "remote:session:" + sid;
  const { error: ie } = await admin.from("remote_access_sessions").insert({
    id: sid, asset_id: ASSET, requested_by: portal.uid, mode: "assisted",
    status: "active", token_expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
    channel_name: channelName, agent_realtime_uid: agent.uid,
  });
  if (ie) throw new Error("session insert: " + ie.message);
  log(`  session ${sid.slice(0, 8)} active, channel ${channelName}\n`);

  // ── SCENARIO A: authorized portal receives REAL agent frames (burst) ───────
  log("== A: authorized portal receives real agent frames ==");
  let received = null;
  const lat = [];
  const portalJoin = await joinPrivate(portal.client, channelName, (msg) => {
    const p = msg.payload;
    lat.push({ seq: p.seq, ms: Date.now() - p.ts });
    if (!received) received = p;
  });
  log(`  portal join status: ${portalJoin.status}`);
  const agentJoin = await joinPrivate(agent.client, channelName, null);
  log(`  agent join status:  ${agentJoin.status}`);
  let latency = null, avgLat = null;
  if (portalJoin.status === "SUBSCRIBED" && agentJoin.status === "SUBSCRIBED") {
    const NF = 12;
    for (let s = 1; s <= NF; s++) {
      await agentJoin.ch.send({ type: "broadcast", event: "frame",
        payload: { seq: s, ts: Date.now(), w: W, h: H, fmt: "jpeg", data: b64 } });
      await sleep(167); // ~6 fps
    }
    for (let i = 0; i < 30 && lat.length < NF; i++) await sleep(100);
    if (received) {
      const got = Buffer.from(received.data, "base64");
      writeFileSync("/home/runner/workspace/.work/received_frame.jpg", got);
      const intact = got.equals(jpeg);
      latency = lat[0].ms;
      const steady = lat.slice(1).map((x) => x.ms);            // drop cold first-frame
      avgLat = steady.length ? Math.round(steady.reduce((a, b) => a + b, 0) / steady.length) : latency;
      const mn = Math.min(...steady), mx = Math.max(...steady);
      log(`  frames received: ${lat.length}/${NF}  ${received.w}x${received.h} ${got.length}B  byte-identical=${intact}`);
      log(`  latency: first(cold)=${latency}ms  steady avg=${avgLat}ms min=${mn}ms max=${mx}ms`);
      results.A = intact && received.w === W && lat.length >= NF - 1 ? "PASS" : "FAIL";
    } else { results.A = "FAIL (no frame)"; }
  } else { results.A = "FAIL (join)"; }

  // ── SCENARIO B: unauthorized viewer is denied ──────────────────────────────
  log("\n== B: unauthorized viewer denied ==");
  let intruderFrames = 0;
  const intruderJoin = await joinPrivate(intruder.client, channelName, () => { intruderFrames++; });
  log(`  intruder join status: ${intruderJoin.status}  ${intruderJoin.err || ""}`);
  // agent broadcasts again; confirm intruder gets nothing
  if (agentJoin.status === "SUBSCRIBED") {
    await agentJoin.ch.send({ type: "broadcast", event: "frame",
      payload: { seq: 2, ts: Date.now(), w: W, h: H, fmt: "jpeg", data: b64 } });
  }
  await sleep(2500);
  log(`  frames intruder received: ${intruderFrames}`);
  results.B = (intruderJoin.status !== "SUBSCRIBED" && intruderFrames === 0) ? "PASS" : "FAIL";

  // ── SCENARIO C: expiry stops access immediately ────────────────────────────
  log("\n== C: expired session denies join ==");
  await admin.from("remote_access_sessions")
    .update({ token_expires_at: new Date(Date.now() - 60000).toISOString() }).eq("id", sid);
  await sleep(1500);
  const expiredPortal = await joinPrivate(portal.client, channelName, null);
  const expiredAgent = await joinPrivate(agent.client, channelName, null);
  log(`  post-expiry portal join: ${expiredPortal.status}   agent join: ${expiredAgent.status}`);
  results.C = (expiredPortal.status !== "SUBSCRIBED" && expiredAgent.status !== "SUBSCRIBED") ? "PASS" : "FAIL";
  await admin.removeChannel(expiredPortal.ch); await admin.removeChannel(expiredAgent.ch);

  // ── SCENARIO D: termination stops access immediately ───────────────────────
  log("\n== D: terminated session denies join ==");
  await admin.from("remote_access_sessions")
    .update({ token_expires_at: new Date(Date.now() + 10 * 60000).toISOString(), status: "ended" }).eq("id", sid);
  await sleep(1500);
  const endedPortal = await joinPrivate(portal.client, channelName, null);
  log(`  post-termination portal join: ${endedPortal.status}`);
  results.D = endedPortal.status !== "SUBSCRIBED" ? "PASS" : "FAIL";
  await admin.removeChannel(endedPortal.ch);

  // teardown live channels
  for (const j of [portalJoin, agentJoin, intruderJoin]) { try { await j.ch.unsubscribe(); } catch {} }

  log("\n==================== RESULTS ====================");
  log(`A authorized frame reaches portal : ${results.A}`);
  log(`B unauthorized viewer denied       : ${results.B}`);
  log(`C expiry denies (portal & agent)   : ${results.C}`);
  log(`D termination denies               : ${results.D}`);
  if (latency != null) log(`measured frame latency             : ${latency}ms`);
}

async function cleanup() {
  log("\n== Cleanup ==");
  try { if (sid) await admin.from("remote_access_sessions").delete().eq("id", sid); } catch (e) { log("  session del:", e.message); }
  try { if (created.length) await admin.from("profiles").delete().in("id", created); } catch (e) { log("  profile del:", e.message); }
  for (const uid of created) { try { await admin.auth.admin.deleteUser(uid); } catch (e) { log("  user del:", e.message); } }
  // verify nothing left
  if (sid) {
    const { data } = await admin.from("remote_access_sessions").select("id").eq("id", sid);
    log(`  residual sessions: ${data ? data.length : "?"}`);
  }
  const { data: pleft } = await admin.from("profiles").select("id").in("id", created);
  log(`  residual profiles: ${pleft ? pleft.length : "?"}`);
  log("  cleanup done");
}

main()
  .catch((e) => { console.error("ERROR:", e.message); results.error = e.message; })
  .finally(async () => { await cleanup(); process.exit(0); });
