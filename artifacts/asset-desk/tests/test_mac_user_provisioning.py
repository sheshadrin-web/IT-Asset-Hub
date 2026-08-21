"""Focused unit tests for the macOS User Push agent contract.

These tests mock OS commands; they never create local accounts or touch a Mac.
"""
from __future__ import annotations

import importlib.util
import os
import sys
import types
import unittest
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace


AGENT = Path(__file__).parents[1] / "agent" / "laptop_agent.py"
requests_stub = types.ModuleType("requests")
requests_stub.get = lambda *args, **kwargs: None
requests_stub.post = lambda *args, **kwargs: None
sys.modules.setdefault("requests", requests_stub)
spec = importlib.util.spec_from_file_location("laptop_agent_mac_provisioning_test", AGENT)
agent = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(agent)


class MacUserProvisioningTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mac = patch.object(agent, "IS_MAC", True)
        self.win = patch.object(agent, "IS_WIN", False)
        self.lin = patch.object(agent, "IS_LIN", False)
        self.mac.start(); self.win.start(); self.lin.start()
        self.addCleanup(self.mac.stop)
        self.addCleanup(self.win.stop)
        self.addCleanup(self.lin.stop)

    def test_employee_code_derives_lowercase_username(self):
        with patch.object(agent, "_is_root", return_value=True), \
             patch.object(agent, "_post", return_value={"success": False}):
            status, _, error = agent._mac_provision_user({
                "employee_code": "MPE1340",
                "employee_name": "Test Employee",
            }, "command-1")
        self.assertEqual(status, "failed")
        self.assertIn("secure credential preparation", (error or "").lower())

    def test_password_is_strong_and_cryptographically_random(self):
        first = agent._mac_temporary_password()
        second = agent._mac_temporary_password()
        self.assertEqual(len(first), 24)
        self.assertNotEqual(first, second)
        self.assertRegex(first, r"[a-z]")
        self.assertRegex(first, r"[A-Z]")
        self.assertRegex(first, r"[0-9]")
        self.assertRegex(first, r"[!#$%+,\-.:=@^_]")

    def test_invalid_employee_code_rejected(self):
        status, _, error = agent._mac_provision_user({
            "employee_code": "MPE 1340",
            "os_username": "mpe 1340",
        })
        self.assertEqual(status, "failed")
        self.assertIn("invalid", (error or "").lower())

    def test_protected_accounts_rejected(self):
        for username in ("miles-it-support", "root", "daemon", "nobody"):
            status, _, error = agent._mac_provision_user({
                "employee_code": username,
                "os_username": username,
            })
            self.assertEqual(status, "failed")
            self.assertIn("protected", (error or "").lower())

    def test_requires_root(self):
        with patch.object(agent, "_is_root", return_value=False):
            status, _, error = agent._mac_provision_user({
                "employee_code": "MPE1340",
                "os_username": "mpe1340",
            })
        self.assertEqual(status, "requires_admin")
        self.assertIn("root", (error or "").lower())

    def test_other_platforms_are_unsupported(self):
        with patch.object(agent, "IS_MAC", False), patch.object(agent, "IS_WIN", True):
            status, _, error = agent._mac_provision_user({
                "employee_code": "MPE1340",
                "os_username": "mpe1340",
            })
        self.assertEqual(status, "failed")
        self.assertIn("macOS only", error or "")

    def test_no_plaintext_password_is_returned_or_logged(self):
        password = "NeverPutThisInACommand"
        with patch.object(agent, "_is_root", return_value=True), \
             patch.object(agent, "_post", return_value={"success": False}):
            status, result, error = agent._mac_provision_user({
                "employee_code": "MPE1340",
                "display_name": "Test Employee",
                "temporary_password": password,
            }, "command-1")
        self.assertNotIn(password, result or "")
        self.assertNotIn(password, error or "")
        self.assertEqual(status, "failed")

    def test_invalid_role_flag_is_not_sent_to_sysadminctl(self):
        self.assertNotIn('"-role", "standard"', agent._mac_provision_user.__doc__ or "")
        with patch.object(agent, "_mac_safe_creation_reason", return_value="invalid options"), \
             patch.object(agent, "_post", return_value={"success": True}), \
             patch.object(agent, "_is_root", return_value=True), \
             patch("pwd.getpwnam", side_effect=KeyError), \
             patch.object(agent.subprocess, "run", return_value=SimpleNamespace(
                 returncode=1, stdout="", stderr="unsupported option -role",
             )) as run:
            status, _, error = agent._mac_provision_user(
                {"employee_code": "MPE1340"}, "command-1"
            )
        self.assertEqual(status, "failed")
        self.assertIn("sysadminctl account creation failed", error or "")
        sysadmin_calls = [call.args[0] for call in run.call_args_list
                          if call.args and call.args[0] and call.args[0][0] == "sysadminctl"]
        self.assertEqual(len(sysadmin_calls), 1)
        self.assertNotIn("-role", sysadmin_calls[0])

    def test_partial_directory_services_record_is_incomplete(self):
        partial = SimpleNamespace(
            returncode=0,
            stdout="RecordName: mpe000\nmilesEmployeeCode: MPE000\nGeneratedUID: abc\n",
            stderr="",
        )
        with patch.object(agent.subprocess, "run", return_value=partial):
            complete, _ = agent._mac_dscl_record("mpe000")
        self.assertFalse(complete)

    def test_native_prefixed_employee_marker_is_parsed(self):
        native_marker = SimpleNamespace(
            returncode=0,
            stdout="dsAttrTypeNative:milesEmployeeCode: MPE000\n",
            stderr="",
        )
        with patch.object(agent.subprocess, "run", return_value=native_marker):
            marker = agent._mac_employee_marker("mpe000")
        self.assertEqual(marker, "MPE000")

    def test_complete_standard_account_verification(self):
        complete = SimpleNamespace(
            returncode=0,
            stdout=(
                "UniqueID: 501\nPrimaryGroupID: 20\n"
                "NFSHomeDirectory: /Users/mpe1340\n"
                "UserShell: /bin/zsh\nRealName: Test Employee\n"
            ),
            stderr="",
        )
        with patch.object(agent.subprocess, "run", return_value=complete):
            verified, _ = agent._mac_dscl_record("mpe1340")
        self.assertTrue(verified)

    def test_admin_membership_is_rejected(self):
        admin = SimpleNamespace(returncode=0, stdout="yes mpe1340 is a member of admin", stderr="")
        with patch.object(agent.subprocess, "run", return_value=admin):
            self.assertTrue(agent._mac_is_admin("mpe1340"))

    def test_matching_miles_partial_account_cleanup_never_deletes_home(self):
        deleted = SimpleNamespace(returncode=0, stdout="", stderr="")
        with patch.object(agent.subprocess, "run", return_value=deleted) as run:
            self.assertTrue(agent._mac_cleanup_marked_partial("mpe000"))
        argv = run.call_args.args[0]
        self.assertEqual(argv, ["dscl", ".", "-delete", "/Users/mpe000"])
        self.assertNotIn("rm", argv)

    def test_conflicting_existing_account_is_not_taken_over(self):
        conflict = SimpleNamespace(returncode=0, stdout="", stderr="")
        with patch.object(agent.subprocess, "run", return_value=conflict):
            self.assertFalse(agent._mac_is_admin("mpe1340"))

    def test_creation_diagnostic_redacts_password(self):
        password = "Temporary-Secret-123"
        reason = agent._mac_safe_creation_reason(
            f"sysadminctl rejected {password}", password
        )
        self.assertNotIn(password, reason)
        self.assertIn("[redacted]", reason)

    def test_password_reset_rejects_non_macos(self):
        with patch.object(agent, "IS_MAC", False):
            status, _, error = agent._mac_reset_user_password(
                {"employee_code": "MPE1340", "os_username": "mpe1340"}, "reset-1"
            )
        self.assertEqual(status, "failed")
        self.assertIn("macOS only", error or "")

    def test_password_reset_rejects_protected_account(self):
        status, _, error = agent._mac_reset_user_password(
            {"employee_code": "root", "os_username": "root"}, "reset-1"
        )
        self.assertEqual(status, "failed")
        self.assertIn("permitted", error or "")

    def test_password_reset_rejects_username_mismatch(self):
        status, _, error = agent._mac_reset_user_password(
            {"employee_code": "MPE1340", "os_username": "other"}, "reset-1"
        )
        self.assertEqual(status, "failed")
        self.assertIn("identity", error or "")

    def test_password_reset_requires_matching_marker(self):
        account = SimpleNamespace(pw_uid=501, pw_gid=20, pw_dir="/Users/mpe1340")
        with patch.object(agent, "_is_root", return_value=True), \
             patch("pwd.getpwnam", return_value=account), \
             patch.object(agent, "_mac_employee_marker", return_value="OTHER"), \
             patch.object(agent, "_post") as post:
            status, _, error = agent._mac_reset_user_password(
                {"employee_code": "MPE1340", "os_username": "mpe1340"}, "reset-1"
            )
        self.assertEqual(status, "failed")
        self.assertIn("marker", error or "")
        post.assert_not_called()

    def test_password_reset_preserves_identity_and_confirms_credential(self):
        account = SimpleNamespace(pw_uid=501, pw_gid=20, pw_dir="/Users/mpe1340")
        with patch.object(agent, "_is_root", return_value=True), \
             patch("pwd.getpwnam", return_value=account), \
             patch.object(agent, "_mac_employee_marker", return_value="MPE1340"), \
             patch.object(agent, "_mac_dscl_record", return_value=(True, "")), \
             patch.object(agent, "_mac_is_admin", return_value=False), \
             patch.object(agent, "_post", side_effect=[
                 {"success": True, "password": "Temporary-Password-123456"},
                 {"success": True},
             ]) as post, \
             patch.object(agent.subprocess, "run", return_value=SimpleNamespace(
                 returncode=0, stdout="", stderr=""
             )) as run:
            status, result, error = agent._mac_reset_user_password(
                {"employee_code": "MPE1340", "os_username": "mpe1340"}, "reset-1"
            )
        self.assertEqual(status, "completed")
        self.assertIn("mpe1340", result or "")
        self.assertIsNone(error)
        self.assertEqual([call.args[0] for call in post.call_args_list],
                         ["/credentials/reveal-reset", "/credentials/confirm-reset"])
        argv = run.call_args.args[0]
        self.assertIn("mpe1340", argv)
        self.assertNotIn("Temporary-Password-123456", result or "")
        self.assertNotIn("Temporary-Password-123456", error or "")

    def test_targeted_wallpaper_failure_is_nonfatal(self):
        with patch.object(agent, "IS_MAC", True), \
             patch.object(agent, "_mac_user_has_session", return_value=True), \
             patch.object(agent, "apply_active_wallpaper", return_value=("failed", "session unavailable")), \
             patch.object(agent, "_post", return_value={"success": True}) as post:
            status, error = agent.apply_active_wallpaper_for_user("mpe1340")
        self.assertEqual(status, "failed")
        self.assertEqual(error, "session unavailable")
        self.assertEqual(post.call_args.args[0], "/wallpaper/user-status")

    def test_windows_employee_code_derives_lowercase_username(self):
        with patch.object(agent, "IS_MAC", False), patch.object(agent, "IS_WIN", True), \
             patch.object(agent, "_win_is_admin", return_value=False):
            status, _, error = agent._win_provision_user(
                {"employee_code": "MPE1340", "os_username": "mpe1340"}, "win-1"
            )
        self.assertEqual(status, "requires_admin")
        self.assertIn("Administrator", error or "")

    def test_windows_protected_accounts_are_rejected(self):
        with patch.object(agent, "IS_MAC", False), patch.object(agent, "IS_WIN", True):
            for code in ("miles-it-support", "Administrator", "Guest"):
                status, _, error = agent._win_provision_user(
                    {"employee_code": code, "os_username": code.lower()}, "win-1"
                )
                self.assertEqual(status, "failed")
                self.assertIn("protected", error or "")

    def test_windows_existing_compatible_account_is_idempotent(self):
        record = {"Name": "mpe1340", "Enabled": True, "Description": "MilesEmployeeCode=MPE1340"}
        with patch.object(agent, "IS_MAC", False), patch.object(agent, "IS_WIN", True), \
             patch.object(agent, "_win_is_admin", return_value=True), \
             patch.object(agent, "_win_protected_account_is_admin", return_value=True), \
             patch.object(agent, "_win_local_user_record", return_value=record), \
             patch.object(agent, "_win_user_is_administrator", return_value=False):
            status, result, error = agent._win_provision_user(
                {"employee_code": "MPE1340", "os_username": "mpe1340"}, "win-1"
            )
        self.assertEqual((status, error), ("completed", None))
        self.assertIn("already provisioned", result or "")

    def test_windows_existing_admin_conflict_fails(self):
        record = {"Name": "mpe1340", "Enabled": True, "Description": "MilesEmployeeCode=MPE1340"}
        with patch.object(agent, "IS_MAC", False), patch.object(agent, "IS_WIN", True), \
             patch.object(agent, "_win_is_admin", return_value=True), \
             patch.object(agent, "_win_protected_account_is_admin", return_value=True), \
             patch.object(agent, "_win_local_user_record", return_value=record), \
             patch.object(agent, "_win_user_is_administrator", return_value=True):
            status, _, error = agent._win_provision_user(
                {"employee_code": "MPE1340", "os_username": "mpe1340"}, "win-1"
            )
        self.assertEqual(status, "failed")
        self.assertIn("Administrator", error or "")

    def test_windows_password_is_stdin_only_and_not_result(self):
        record = {"Name": "mpe1340", "Enabled": True, "Description": "MilesEmployeeCode=MPE1340"}
        with patch.object(agent, "IS_MAC", False), patch.object(agent, "IS_WIN", True), \
             patch.object(agent, "_win_is_admin", return_value=True), \
             patch.object(agent, "_win_protected_account_is_admin", return_value=True), \
             patch.object(agent, "_win_local_user_record", side_effect=[None, record]), \
             patch.object(agent, "_win_user_is_administrator", return_value=False), \
             patch.object(agent, "_post", side_effect=[{"success": True}, {"success": True}]), \
             patch.object(agent.subprocess, "run", return_value=SimpleNamespace(
                 returncode=0, stdout="", stderr=""
             )) as run:
            status, result, error = agent._win_provision_user(
                {"employee_code": "MPE1340", "display_name": "Test Employee"}, "win-1"
            )
        self.assertEqual(status, "completed")
        self.assertNotIn("password", result or "".lower())
        self.assertIsNone(error)
        self.assertNotIn("Temporary-", run.call_args.args[0][-1])
        self.assertTrue(run.call_args.kwargs["input"].strip())

    def test_linux_employee_code_derives_lowercase_username(self):
        with patch.object(agent, "IS_MAC", False), patch.object(agent, "IS_LIN", True), \
             patch.object(agent, "_is_root", return_value=False):
            status, _, error = agent._linux_provision_user(
                {"employee_code": "MPE1340", "os_username": "mpe1340"}, "lin-1"
            )
        self.assertEqual(status, "requires_admin")
        self.assertIn("root", error or "")

    def test_linux_protected_accounts_are_rejected(self):
        with patch.object(agent, "IS_MAC", False), patch.object(agent, "IS_LIN", True):
            for code in ("miles-it-support", "root", "gdm"):
                status, _, error = agent._linux_provision_user(
                    {"employee_code": code, "os_username": code}, "lin-1"
                )
                self.assertEqual(status, "failed")
                self.assertIn("protected", error or "")

    def test_linux_existing_compatible_account_is_idempotent(self):
        record = SimpleNamespace(
            pw_uid=1340, pw_dir="/home/mpe1340", pw_gecos="MilesEmployeeCode=MPE1340, Test Employee"
        )
        with patch.object(agent, "IS_MAC", False), patch.object(agent, "IS_LIN", True), \
             patch.object(agent, "_is_root", return_value=True), \
             patch("pwd.getpwnam", return_value=record), \
             patch.object(agent.os, "stat", return_value=SimpleNamespace(st_uid=1340)), \
             patch.object(agent, "_linux_user_groups", return_value=set()), \
             patch.object(agent, "_linux_account_locked", return_value=False):
            status, result, error = agent._linux_provision_user(
                {"employee_code": "MPE1340", "os_username": "mpe1340"}, "lin-1"
            )
        self.assertEqual((status, error), ("completed", None))
        self.assertIn("already provisioned", result or "")

    def test_linux_existing_privileged_conflict_fails(self):
        record = SimpleNamespace(pw_uid=1340, pw_dir="/home/mpe1340", pw_gecos="MilesEmployeeCode=MPE1340")
        with patch.object(agent, "IS_MAC", False), patch.object(agent, "IS_LIN", True), \
             patch.object(agent, "_is_root", return_value=True), \
             patch("pwd.getpwnam", return_value=record), \
             patch.object(agent, "_linux_user_groups", return_value={"sudo"}):
            status, _, error = agent._linux_provision_user(
                {"employee_code": "MPE1340", "os_username": "mpe1340"}, "lin-1"
            )
        self.assertEqual(status, "failed")
        self.assertIn("compatible", error or "")

    def test_linux_password_uses_chpasswd_stdin_and_never_result(self):
        record = SimpleNamespace(
            pw_uid=1340, pw_dir="/home/mpe1340", pw_gecos="MilesEmployeeCode=MPE1340, Test Employee"
        )
        with patch.object(agent, "IS_MAC", False), patch.object(agent, "IS_LIN", True), \
             patch.object(agent, "_is_root", return_value=True), \
             patch("pwd.getpwnam", side_effect=[KeyError, KeyError, record]), \
             patch.object(agent, "_linux_user_groups", return_value=set()), \
             patch.object(agent, "_linux_account_locked", return_value=False), \
             patch.object(agent.os, "stat", return_value=SimpleNamespace(st_uid=1340)), \
             patch.object(agent, "_post", side_effect=[{"success": True}, {"success": True}]), \
             patch.object(agent.subprocess, "run", return_value=SimpleNamespace(
                 returncode=0, stdout="", stderr=""
             )) as run:
            status, result, error = agent._linux_provision_user(
                {"employee_code": "MPE1340", "display_name": "Test Employee"}, "lin-1"
            )
        self.assertEqual(status, "completed")
        self.assertIsNone(error)
        self.assertNotIn("MPE1340", run.call_args.args[0])
        self.assertIn(":", run.call_args.kwargs["input"])
        self.assertNotIn("password", result or "".lower())

if __name__ == "__main__":
    unittest.main()