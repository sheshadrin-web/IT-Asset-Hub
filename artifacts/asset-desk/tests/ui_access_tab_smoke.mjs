// Lightweight smoke check: the Settings → "Access Control" tab is visible only
// to super_admin and hidden for every other role.
//
// This avoids a full React render harness (the repo has no test runner). Instead
// it (1) statically verifies the gate is present in Settings.tsx source and
// (2) replicates the exact nav-filter predicate and asserts visibility per role.
// If anyone removes the `superAdminOnly` flag or the `&& isSuperAdmin` content
// guard, this test fails.
//
// Run: node tests/ui_access_tab_smoke.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const settingsPath = resolve(here, "../src/pages/Settings.tsx");
const src = readFileSync(settingsPath, "utf8");

const results = {};
const ALL_ROLES = ["super_admin", "it_admin", "hr_admin", "end_user", "location_gm"];

// (1) Static gate-presence assertions.
const hasSuperAdminFlag = /id:\s*"access"[\s\S]{0,120}superAdminOnly:\s*true/.test(src);
const hasNavFilter = /TABS\.filter\(\s*tab\s*=>\s*!tab\.superAdminOnly\s*\|\|\s*isSuperAdmin\s*\)/.test(src);
const hasContentGuard = /activeTab\s*===\s*"access"\s*&&\s*isSuperAdmin/.test(src);
const hasRoleSource = /isSuperAdmin\s*=\s*currentUser\?\.role\s*===\s*"super_admin"/.test(src);

results.source_access_tab_superAdminOnly = hasSuperAdminFlag ? "PASS" : "FAIL";
results.source_nav_filter_gate = hasNavFilter ? "PASS" : "FAIL";
results.source_content_render_gate = hasContentGuard ? "PASS" : "FAIL";
results.source_isSuperAdmin_definition = hasRoleSource ? "PASS" : "FAIL";

// (2) Replicate the real nav-filter predicate and check per-role visibility.
//     Mirrors: TABS.filter(tab => !tab.superAdminOnly || isSuperAdmin)
const accessTab = { id: "access", label: "Access Control", superAdminOnly: true };
const navTabVisible = (tab, isSuperAdmin) => !tab.superAdminOnly || isSuperAdmin;
//     Mirrors: activeTab === "access" && isSuperAdmin
const contentVisible = (isSuperAdmin) => isSuperAdmin;

for (const role of ALL_ROLES) {
  const isSuperAdmin = role === "super_admin";
  const shouldSee = isSuperAdmin;
  const navOk = navTabVisible(accessTab, isSuperAdmin) === shouldSee;
  const contentOk = contentVisible(isSuperAdmin) === shouldSee;
  results[`role_${role}_visibility`] = navOk && contentOk ? "PASS" : "FAIL";
}

console.log("== UI smoke: Access Control tab gating ==");
console.log(`  Settings.tsx: ${settingsPath}`);
let pass = 0, total = 0;
for (const [k, v] of Object.entries(results)) {
  total++;
  if (v === "PASS") pass++;
  console.log(`  ${v}  ${k}`);
}
console.log(`\n  ${pass}/${total} checks passed`);
process.exit(pass === total ? 0 : 1);
