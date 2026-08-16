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
        with patch.object(agent, "_is_root", return_value=True):
            status, _, error = agent._mac_provision_user({
                "employee_code": "MPE1340",
                "os_username": "mpe1340",
                "employee_name": "Test Employee",
            })
        self.assertEqual(status, "failed")
        self.assertIn("secure one-time credential", (error or "").lower())

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
        with patch.object(agent, "_is_root", return_value=True):
            status, result, error = agent._mac_provision_user({
                "employee_code": "MPE1340",
                "os_username": "mpe1340",
                "temporary_password": password,
            })
        self.assertNotIn(password, result or "")
        self.assertNotIn(password, error or "")
        self.assertEqual(status, "failed")


if __name__ == "__main__":
    unittest.main()