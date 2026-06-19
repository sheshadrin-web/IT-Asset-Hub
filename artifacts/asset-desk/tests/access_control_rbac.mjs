// Access Control RBAC integration test (live Supabase).
//
// Proves the three Settings → Access Control RPCs are gated by _is_super_admin()
// and audited via _hr_audit():
//   - access_set_role_permission(role_key, permission_key, enabled)
//   - access_set_policy(key, enabled)
//   - access_set_user_locations(user_id, rows jsonb)
//
// Scenarios:
//   A  non-super-admin call to each RPC is REJECTED ("Not authorized")
//   B  super-admin call to each RPC SUCCEEDS
//   C  a successful super-admin mutation writes an audit_logs row
//
// Creds (same convention as the other e2e tests):
//   /tmp/supa.url  /tmp/anon.key  /tmp/service.key
//
// Run: node tests/access_control_rbac.mjs   (see run_access_control.sh)

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = readFileSync("/tmp/supa.url", "utf8").trim();
const anon = readFileSync("/tmp/anon.key", "utf8").trim();
const service = readFileSync("/tmp/service.key", "utf8").trim();

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

const log = (...a) => console.log(...a);
const stamp = Date.now();
const users = {
  super:  { email: `e2e-ac-super-${stamp}@agent.miles.local`,  pass: `Su!${stamp}aA1`, role: "super_admin" },
  normal: { email: `e2e-ac-normal-${stamp}@agent.miles.local`, pass: `No!${stamp}aA1`, role: "it_admin" },
};
const created = [];
const results = {};

async function mkUser(key) {
  const { email, pass, role } = users[key];
  const { data: cu, error: ce } = await admin.auth.admin.createUser({
    email, password: pass, email_confirm: true, user_metadata: { full_name: `E2E AC ${key}` },
  });
  if (ce) throw new Error(`createUser ${key}: ${ce.message}`);
  const uid = cu.user.id;
  created.push(uid);
  // Profile row drives _is_super_admin() / current_user_role().
  const { error: pe } = await admin.from("profiles").upsert(
    { id: uid, full_name: `E2E AC ${key}`, email, role, ecode: "", reporting_manager: "" },
    { onConflict: "id" },
  );
  if (pe) throw new Error(`profile ${key}: ${pe.message}`);
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: se } = await c.auth.signInWithPassword({ email, password: pass });
  if (se) throw new Error(`signin ${key}: ${se.message}`);
  return { client: c, uid };
}

// Snapshot/restore helpers (via service client; bypasses RLS) so the test is non-destructive.
const RP = { role: "location_gm", perm: "view_reports" };
const POLICY = "auto_lock_device_on_hr_exit";
let rpOriginal = null, policyOriginal = null;

async function snapshot() {
  const { data: rp } = await admin.from("access_role_permissions")
    .select("enabled").eq("role_key", RP.role).eq("permission_key", RP.perm).maybeSingle();
  rpOriginal = rp ? rp.enabled : null;
  const { data: po } = await admin.from("access_policies").select("enabled").eq("key", POLICY).maybeSingle();
  policyOriginal = po ? po.enabled : null;
}

async function restore() {
  if (rpOriginal !== null) {
    await admin.from("access_role_permissions").update({ enabled: rpOriginal })
      .eq("role_key", RP.role).eq("permission_key", RP.perm);
  }
  if (policyOriginal !== null) {
    await admin.from("access_policies").update({ enabled: policyOriginal }).eq("key", POLICY);
  }
}

function isAuthzError(error) {
  return !!error && /not authorized/i.test(error.message || "");
}

async function main() {
  log("== Provisioning super-admin + non-super-admin identities ==");
  const sup = await mkUser("super");
  const normal = await mkUser("normal");
  log(`  super uid=${sup.uid.slice(0, 8)}  normal uid=${normal.uid.slice(0, 8)}`);
  await snapshot();

  // ── SCENARIO A: non-super-admin is rejected by all three RPCs ───────────────
  log("\n== A: non-super-admin REJECTED by all three RPCs ==");
  const aRoleperm = await normal.client.rpc("access_set_role_permission",
    { p_role_key: RP.role, p_permission_key: RP.perm, p_enabled: true });
  const aPolicy = await normal.client.rpc("access_set_policy", { p_key: POLICY, p_enabled: true });
  const aLoc = await normal.client.rpc("access_set_user_locations",
    { p_user_id: normal.uid, p_rows: [{ location: "Bangalore" }] });
  log(`  role_permission rejected: ${isAuthzError(aRoleperm.error)} (${aRoleperm.error?.message || "no error!"})`);
  log(`  policy rejected:          ${isAuthzError(aPolicy.error)} (${aPolicy.error?.message || "no error!"})`);
  log(`  user_locations rejected:  ${isAuthzError(aLoc.error)} (${aLoc.error?.message || "no error!"})`);
  results.A_role_permission = isAuthzError(aRoleperm.error) ? "PASS" : "FAIL";
  results.A_policy = isAuthzError(aPolicy.error) ? "PASS" : "FAIL";
  results.A_user_locations = isAuthzError(aLoc.error) ? "PASS" : "FAIL";

  // Confirm the rejected calls did NOT mutate anything.
  const { data: rpAfter } = await admin.from("access_role_permissions")
    .select("enabled").eq("role_key", RP.role).eq("permission_key", RP.perm).maybeSingle();
  const { data: locAfter } = await admin.from("user_location_access")
    .select("id").eq("user_id", normal.uid);
  const noMutation = (rpOriginal === null || (rpAfter && rpAfter.enabled === rpOriginal))
    && (!locAfter || locAfter.length === 0);
  log(`  rejected calls left state unchanged: ${noMutation}`);
  results.A_no_side_effects = noMutation ? "PASS" : "FAIL";

  // ── SCENARIO B + C: super-admin succeeds and an audit row is written ────────
  log("\n== B/C: super-admin SUCCEEDS and writes audit_logs ==");
  const sinceIso = new Date(Date.now() - 5000).toISOString();
  const targetEnabled = rpOriginal === null ? true : !rpOriginal;

  const bRoleperm = await sup.client.rpc("access_set_role_permission",
    { p_role_key: RP.role, p_permission_key: RP.perm, p_enabled: targetEnabled });
  const bPolicy = await sup.client.rpc("access_set_policy",
    { p_key: POLICY, p_enabled: policyOriginal === null ? true : !policyOriginal });
  const bLoc = await sup.client.rpc("access_set_user_locations",
    { p_user_id: normal.uid, p_rows: [] });
  log(`  role_permission ok: ${!bRoleperm.error} (${bRoleperm.error?.message || "ok"})`);
  log(`  policy ok:          ${!bPolicy.error} (${bPolicy.error?.message || "ok"})`);
  log(`  user_locations ok:  ${!bLoc.error} (${bLoc.error?.message || "ok"})`);
  results.B_role_permission = !bRoleperm.error ? "PASS" : "FAIL";
  results.B_policy = !bPolicy.error ? "PASS" : "FAIL";
  results.B_user_locations = !bLoc.error ? "PASS" : "FAIL";

  // Verify the mutation actually landed.
  const { data: rpNow } = await admin.from("access_role_permissions")
    .select("enabled").eq("role_key", RP.role).eq("permission_key", RP.perm).maybeSingle();
  results.B_persisted = rpNow && rpNow.enabled === targetEnabled ? "PASS" : "FAIL";
  log(`  role_permission persisted as ${targetEnabled}: ${results.B_persisted}`);

  // Audit rows written by the super-admin for these actions, after our snapshot time.
  const { data: auditRows, error: auErr } = await admin.from("audit_logs")
    .select("id, action, actor_user_id, created_at")
    .eq("actor_user_id", sup.uid)
    .gte("created_at", sinceIso)
    .in("action", [
      "access_control.role_permission.updated",
      "access_control.policy.updated",
      "access_control.location_access.updated",
    ]);
  if (auErr) log(`  audit query error: ${auErr.message}`);
  const actions = new Set((auditRows || []).map(r => r.action));
  log(`  audit rows by super-admin: ${(auditRows || []).length}  actions=${[...actions].join(", ")}`);
  results.C_audit_role_permission = actions.has("access_control.role_permission.updated") ? "PASS" : "FAIL";
  results.C_audit_policy = actions.has("access_control.policy.updated") ? "PASS" : "FAIL";
  results.C_audit_user_locations = actions.has("access_control.location_access.updated") ? "PASS" : "FAIL";

  await restore();

  log("\n==================== RESULTS ====================");
  let pass = 0, total = 0;
  for (const [k, v] of Object.entries(results)) {
    total++;
    if (v === "PASS") pass++;
    log(`  ${v === "PASS" ? "PASS" : "FAIL"}  ${k}`);
  }
  log(`\n  ${pass}/${total} checks passed`);
  results.__ok = pass === total;
}

async function cleanup() {
  log("\n== Cleanup ==");
  try { await restore(); } catch {}
  for (const uid of created) {
    try { await admin.from("audit_logs").delete().eq("actor_user_id", uid); } catch {}
    try { await admin.from("user_location_access").delete().eq("user_id", uid); } catch {}
    try { await admin.from("profiles").delete().eq("id", uid); } catch {}
    try { await admin.auth.admin.deleteUser(uid); } catch (e) { log("  user del:", e.message); }
  }
  const { data: pleft } = await admin.from("profiles").select("id").in("id", created.length ? created : ["00000000-0000-0000-0000-000000000000"]);
  log(`  residual profiles: ${pleft ? pleft.length : "?"}`);
  log("  cleanup done");
}

main()
  .catch((e) => { console.error("ERROR:", e.message); results.__error = e.message; results.__ok = false; })
  .finally(async () => {
    await cleanup();
    process.exit(results.__ok ? 0 : 1);
  });
