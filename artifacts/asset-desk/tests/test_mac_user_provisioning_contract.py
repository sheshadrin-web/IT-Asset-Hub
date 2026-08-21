"""Static contract checks for the credential boundary.

Database/Edge integration tests require a Supabase test project and are not run
against production from this workspace. These checks ensure future edits do not
silently move plaintext into the command or audit paths.
"""
from pathlib import Path
import unittest


ROOT = Path(__file__).parents[1]
MIGRATION = (ROOT / "supabase/migrations/20260816000000_mac_user_provisioning.sql").read_text()
RESET_MIGRATION = (ROOT / "supabase/migrations/20260819000000_mac_password_reset_and_user_wallpaper.sql").read_text()
CROSS_PLATFORM_MIGRATION = (ROOT / "supabase/migrations/20260821000000_cross_platform_user_provisioning.sql").read_text()
AGENT = (ROOT / "agent/laptop_agent.py").read_text()
AGENT_API = (ROOT / "supabase/functions/agent-api/index.ts").read_text()
REVEAL_API = (ROOT / "supabase/functions/provisioning-credentials/index.ts").read_text()


class MacProvisioningCredentialContractTests(unittest.TestCase):
    def test_command_payload_has_no_password_field(self):
        command_section = MIGRATION.split("INSERT INTO public.device_commands", 1)[1]
        self.assertNotIn("'password'", command_section.split("RETURNING id", 1)[0])
        self.assertIn("'employee_code'", command_section)
        self.assertIn("'display_name'", command_section)
        self.assertIn("'email'", command_section)

    def test_agent_result_is_non_secret(self):
        self.assertIn("Provisioned standard macOS user {username}", AGENT)
        status_fn = AGENT.split("def _post_command_status", 1)[1].split("def _is_root", 1)[0]
        self.assertNotIn("password", status_fn.lower())
        self.assertNotIn("'password': result", status_fn)

    def test_secret_has_dedicated_encrypted_transport(self):
        self.assertIn("/credentials/prepare", AGENT_API)
        self.assertIn("AES-GCM", AGENT_API)
        self.assertIn("ciphertext", AGENT_API)
        self.assertIn("device_user_credentials", MIGRATION)

    def test_reveal_is_one_time_and_expiring(self):
        self.assertIn("credential_status = 'consumed'", MIGRATION)
        self.assertIn("credential_status = 'expired'", MIGRATION)
        self.assertIn("credential_status = 'available'", MIGRATION)
        self.assertIn("expires_at > now()", MIGRATION)
        self.assertIn("reveal_provisioning_credential", REVEAL_API)

    def test_reveal_requires_it_admin_and_never_returns_ciphertext_to_browser(self):
        reveal_fn = MIGRATION.split("CREATE OR REPLACE FUNCTION public.reveal_provisioning_credential", 1)[1]
        self.assertIn("super_admin','it_admin", reveal_fn)
        self.assertIn("consumed_by", reveal_fn)
        self.assertIn("await decryptCredential(result.data.ciphertext)", REVEAL_API)
        self.assertNotIn("ciphertext });", REVEAL_API)

    def test_protected_account_and_standard_role_contract_remain(self):
        self.assertIn("miles-it-support", AGENT)
        self.assertNotIn('"-role", "standard"', AGENT)
        self.assertIn('"-password", password', AGENT)
        self.assertIn("dseditgroup", AGENT)
        self.assertIn("_MAC_REQUIRED_ACCOUNT_FIELDS", AGENT)

    def test_reset_contract_is_encrypted_and_non_destructive(self):
        self.assertIn("'reset_user_password'", RESET_MIGRATION)
        self.assertIn("device_user_password_resets", RESET_MIGRATION)
        self.assertIn("request_user_password_reset", RESET_MIGRATION)
        self.assertIn("reveal_user_password_reset", RESET_MIGRATION)
        self.assertIn("reset_status = 'consumed'", RESET_MIGRATION)
        self.assertIn("protected macOS account cannot be reset", RESET_MIGRATION)
        self.assertIn("p_actor_user_id IS DISTINCT FROM v_uid", RESET_MIGRATION)
        self.assertIn("consumed_by = v_uid", RESET_MIGRATION)
        self.assertNotIn("'password'", RESET_MIGRATION.split("jsonb_build_object", 1)[1].split("RETURNING", 1)[0])

    def test_reset_migration_preserves_lock_unlock_reconciliation(self):
        self.assertEqual(RESET_MIGRATION.count("CREATE OR REPLACE FUNCTION public.agent_update_command"), 1)
        self.assertIn("v_ctype = 'lock_screen' AND p_status = 'completed'", RESET_MIGRATION)
        self.assertIn("v_ctype = 'unlock' AND p_status = 'completed'", RESET_MIGRATION)

    def test_reset_privilege_model_is_restricted(self):
        self.assertIn("REVOKE ALL ON FUNCTION public.request_user_password_reset(uuid, text) FROM PUBLIC, anon", RESET_MIGRATION)
        self.assertIn("GRANT EXECUTE ON FUNCTION public.request_user_password_reset(uuid, text) TO authenticated", RESET_MIGRATION)
        self.assertIn("REVOKE ALL ON FUNCTION public.reveal_user_password_reset(uuid, uuid) FROM PUBLIC, anon", RESET_MIGRATION)
        self.assertIn("GRANT EXECUTE ON FUNCTION public.reveal_user_password_reset(uuid, uuid) TO authenticated", RESET_MIGRATION)
        self.assertIn("REVOKE ALL ON FUNCTION public.agent_reveal_password_reset(text, uuid) FROM PUBLIC, anon, authenticated", RESET_MIGRATION)
        self.assertIn("GRANT EXECUTE ON FUNCTION public.agent_reveal_password_reset(text, uuid) TO service_role", RESET_MIGRATION)
        self.assertIn("REVOKE ALL ON FUNCTION public.agent_confirm_password_reset(text, uuid) FROM PUBLIC, anon, authenticated", RESET_MIGRATION)
        self.assertIn("GRANT EXECUTE ON FUNCTION public.agent_confirm_password_reset(text, uuid) TO service_role", RESET_MIGRATION)
        self.assertIn("REVOKE ALL ON FUNCTION public.agent_report_user_wallpaper(text, text, text, text) FROM PUBLIC, anon, authenticated", RESET_MIGRATION)
        self.assertIn("GRANT EXECUTE ON FUNCTION public.agent_report_user_wallpaper(text, text, text, text) TO service_role", RESET_MIGRATION)

    def test_reset_reveal_uses_authenticated_edge_path(self):
        self.assertIn('body.purpose === "password_reset"', REVEAL_API)
        self.assertIn('userDb.rpc("reveal_user_password_reset"', REVEAL_API)
        self.assertIn("global: { headers: { Authorization: `Bearer ${jwt}` } }", REVEAL_API)
        self.assertIn('rpc("agent_reveal_password_reset"', AGENT_API)
        self.assertIn('rpc("agent_confirm_password_reset"', AGENT_API)
        self.assertIn("public._auth_agent(p_token)", RESET_MIGRATION)

    def test_cross_platform_request_uses_one_command_and_server_identity(self):
        self.assertIn("'provision_user'", CROSS_PLATFORM_MIGRATION)
        self.assertIn("v_platform := 'Windows'", CROSS_PLATFORM_MIGRATION)
        self.assertIn("v_platform := 'Ubuntu/Linux'", CROSS_PLATFORM_MIGRATION)
        self.assertIn("v_platform := 'macOS'", CROSS_PLATFORM_MIGRATION)
        self.assertIn("public._provisioning_username(v_profile.ecode)", CROSS_PLATFORM_MIGRATION)
        self.assertIn("platform", CROSS_PLATFORM_MIGRATION)
        self.assertNotIn("provision_windows_user", CROSS_PLATFORM_MIGRATION)
        self.assertNotIn("provision_linux_user", CROSS_PLATFORM_MIGRATION)
        self.assertIn("REVOKE ALL ON FUNCTION public.request_user_provisioning(uuid) FROM PUBLIC, anon", CROSS_PLATFORM_MIGRATION)

    def test_agent_and_portal_have_platform_dispatch(self):
        self.assertIn("def _win_provision_user", AGENT)
        self.assertIn("def _linux_provision_user", AGENT)
        self.assertIn("if IS_WIN:", AGENT.split("if ctype == \"provision_user\":", 1)[1].split("if ctype == \"reset_user_password\":", 1)[0])
        self.assertIn("if IS_LIN:", AGENT.split("if ctype == \"provision_user\":", 1)[1].split("if ctype == \"reset_user_password\":", 1)[0])
        card = (ROOT / "src/components/asset/MacUserProvisioningCard.tsx").read_text()
        self.assertIn("Ubuntu/Linux", card)
        self.assertIn("Windows", card)
        self.assertIn("supportedPlatform", card)


if __name__ == "__main__":
    unittest.main()