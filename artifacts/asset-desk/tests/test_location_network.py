"""Focused tests for Phase 1 network-location agent payload behavior.

These tests load the agent with mocked requests and do not contact Supabase or
any geolocation provider.
"""
import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import patch


ROOT = pathlib.Path(__file__).resolve().parents[1]
AGENT = ROOT / "agent" / "laptop_agent.py"

if "requests" not in sys.modules:
    requests = types.ModuleType("requests")
    requests.get = lambda *a, **k: None
    requests.post = lambda *a, **k: None
    sys.modules["requests"] = requests


def load_agent():
    spec = importlib.util.spec_from_file_location("location_test_agent", AGENT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class LocationPayloadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.agent = load_agent()

    def test_location_request_is_only_added_when_requested(self):
        with patch.object(self.agent, "_collect_linux", return_value={
            "serial_number": "", "brand": "", "model": "", "processor": "",
            "ram": "", "storage": "", "os_name": "Linux", "os_version": "test",
        }), patch.object(self.agent, "_uptime_seconds", return_value=None), \
             patch.object(self.agent, "_boot_time_iso", return_value=None):
            normal = self.agent.collect_system_info(False)
            heavy = self.agent.collect_system_info(True)
        self.assertNotIn("location_request", normal)
        self.assertEqual(heavy["location_request"], "network")

    def test_command_sync_does_not_request_location(self):
        with patch.object(self.agent, "collect_system_info") as collect, \
             patch.object(self.agent, "_post", return_value={"success": True}):
            self.agent.execute_command({"type": "sync_now"})
        collect.assert_called_once_with(False)


if __name__ == "__main__":
    unittest.main()