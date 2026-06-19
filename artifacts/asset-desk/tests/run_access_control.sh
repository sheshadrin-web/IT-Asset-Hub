#!/usr/bin/env bash
# Runs the Access Control test suite:
#   - ui_access_tab_smoke.mjs   (static, no network)
#   - access_control_rbac.mjs   (live Supabase; needs /tmp/supa.url, /tmp/anon.key, /tmp/service.key)
#
# @supabase/supabase-js is resolved from the workspace .work sandbox. ESM ignores
# NODE_PATH, so we briefly symlink that node_modules next to the tests (matching
# how the other e2e_*.mjs tests obtain the dependency) and remove it afterwards.
set -u
cd "$(dirname "$0")"

SANDBOX="${ACCESS_TEST_NODE_MODULES:-/home/runner/workspace/.work/node_modules}"
LINK_CREATED=0
if [ ! -e node_modules ] && [ -d "$SANDBOX" ]; then
  ln -s "$SANDBOX" node_modules
  LINK_CREATED=1
fi
cleanup() { [ "$LINK_CREATED" -eq 1 ] && rm -f node_modules; }
trap cleanup EXIT

echo "### UI smoke: Access Control tab gating ###"
node ui_access_tab_smoke.mjs
UI_RC=$?

echo
echo "### RBAC: only super-admins can change access settings ###"
node access_control_rbac.mjs
RBAC_RC=$?

echo
echo "### SUMMARY ###"
echo "  ui_access_tab_smoke : $([ $UI_RC -eq 0 ] && echo PASS || echo FAIL)"
echo "  access_control_rbac : $([ $RBAC_RC -eq 0 ] && echo PASS || echo FAIL)"

[ $UI_RC -eq 0 ] && [ $RBAC_RC -eq 0 ]
exit $?
