"""Focused Linux lock regressions for the root/system-agent path.

These tests mock loginctl and account commands; they never lock the test host,
touch GDM, or contact Supabase.
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


AGENT = Path(__file__).parents[1] / "agent" / "laptop_agent.py"
SPEC = importlib.util.spec_from_file_location("laptop_agent_linux_lock_test", AGENT)
assert SPEC and SPEC.loader
if "requests" not in sys.modules:
    # The lock tests never exercise HTTP. Keep them runnable in the minimal
    # verification shell where the agent's runtime dependency is not installed.
    sys.modules["requests"] = types.ModuleType("requests")
agent = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(agent)


class FakeRun:
    def __init__(self, sessions, *, terminate_ok=True, kill_ok=True):
        self.sessions = {sid: dict(data) for sid, data in sessions.items()}
        self.terminate_ok = terminate_ok
        self.kill_ok = kill_ok
        self.calls: list[list[str]] = []

    def __call__(self, cmd, **kwargs):
        cmd = list(cmd)
        self.calls.append(cmd)
        if cmd[:3] == ["loginctl", "list-sessions", "--no-legend"]:
            rows = "\n".join(
                f"{sid} {data['uid']} {data['user']} {data.get('seat', '-')}"
                for sid, data in self.sessions.items()
            )
            return subprocess.CompletedProcess(cmd, 0, rows + ("\n" if rows else ""), "")
        if cmd[:2] == ["loginctl", "show-session"]:
            sid = cmd[2]
            data = self.sessions.get(sid)
            if data is None:
                return subprocess.CompletedProcess(cmd, 1, "", "gone")
            props = [
                f"User={data['uid']}",
                f"Name={data['user']}",
                f"Class={data['class']}",
                f"Type={data.get('type', '')}",
                f"Seat={data.get('seat', '')}",
            ]
            return subprocess.CompletedProcess(cmd, 0, "\n".join(props), "")
        if cmd[:2] == ["loginctl", "terminate-session"]:
            if self.terminate_ok:
                self.sessions.pop(cmd[2], None)
                return subprocess.CompletedProcess(cmd, 0, "", "")
            return subprocess.CompletedProcess(cmd, 1, "", "failed")
        if cmd[:2] == ["loginctl", "kill-user"]:
            if self.kill_ok:
                for sid in list(self.sessions):
                    if self.sessions[sid]["user"] == cmd[2] and self.sessions[sid]["class"] == "user":
                        self.sessions.pop(sid)
                return subprocess.CompletedProcess(cmd, 0, "", "")
            return subprocess.CompletedProcess(cmd, 1, "", "failed")
        if cmd[:2] in (["usermod", "--lock"], ["passwd", "-l"]):
            return subprocess.CompletedProcess(cmd, 0, "", "")
        if cmd[:2] == ["passwd", "-S"]:
            return subprocess.CompletedProcess(cmd, 0, f"{cmd[2]} L 01/01/2026 0 99999 7 -\n", "")
        if cmd[:2] == ["usermod", "--unlock"] or cmd[:2] == ["passwd", "-u"]:
            return subprocess.CompletedProcess(cmd, 0, "", "")
        if cmd[:1] == ["who"]:
            return subprocess.CompletedProcess(cmd, 0, "", "")
        raise AssertionError(f"unexpected command: {cmd}")


def session(sid, user="sheshadri-n", cls="user", typ="wayland", seat="seat0"):
    return sid, {"uid": "1000", "user": user, "class": cls, "type": typ, "seat": seat}


class LinuxLockTests(unittest.TestCase):
    def setUp(self):
        self.flags = patch.object(agent, "IS_LIN", True), patch.object(agent, "IS_WIN", False), patch.object(agent, "IS_MAC", False)
        for flag in self.flags:
            flag.start()
        self.root = patch.object(agent, "_is_root", return_value=True)
        self.root.start()
        self.state = patch.object(agent, "_write_lock_state")
        self.state.start()

    def tearDown(self):
        patch.stopall()

    def test_real_wayland_user_session_ignores_manager(self):
        fake = FakeRun(dict([
            session("2"),
            session("3", cls="manager", typ="", seat=""),
        ]))
        with patch.object(agent.subprocess, "run", side_effect=fake):
            self.assertEqual(agent._linux_console_user(), "sheshadri-n")
            status, _, error = agent._apply_hard_lock()
        self.assertEqual((status, error), ("completed", None))
        self.assertIn(["loginctl", "terminate-session", "2"], fake.calls)
        self.assertNotIn(["loginctl", "terminate-session", "3"], fake.calls)
        self.assertNotIn("pkill", " ".join(" ".join(c) for c in fake.calls))
        self.assertNotIn("gdm", " ".join(" ".join(c) for c in fake.calls).lower())
        self.assertTrue(any(c[:2] == ["loginctl", "show-session"] for c in fake.calls))

    def test_multiple_employee_sessions_are_all_terminated(self):
        fake = FakeRun(dict([session("2"), session("4", typ="x11"), session("3", cls="manager", typ="", seat="")]))
        with patch.object(agent.subprocess, "run", side_effect=fake):
            result = agent._apply_hard_lock()
        self.assertEqual(result[0], "completed")
        self.assertIn(["loginctl", "terminate-session", "2"], fake.calls)
        self.assertIn(["loginctl", "terminate-session", "4"], fake.calls)
        self.assertNotIn(["loginctl", "terminate-session", "3"], fake.calls)

    def test_termination_failure_rolls_back(self):
        fake = FakeRun(dict([session("2"), session("3", cls="manager", typ="", seat="")]), terminate_ok=False, kill_ok=False)
        unlock_calls = []
        with patch.object(agent.subprocess, "run", side_effect=fake), \
             patch.object(agent, "_linux_unlock_account", return_value=(True, "usermod --unlock")) as unlock:
            result = agent._apply_hard_lock()
            unlock_calls.append(unlock.call_count)
        self.assertEqual(result[0], "failed")
        self.assertEqual(unlock_calls, [1])
        self.assertIn(["loginctl", "kill-user", "sheshadri-n"], fake.calls)

    def test_no_graphical_session_is_not_confused_with_manager(self):
        fake = FakeRun(dict([session("3", cls="manager", typ="", seat="")]))
        with patch.object(agent.subprocess, "run", side_effect=fake):
            self.assertIsNone(agent._linux_console_user())

    def test_session_state_unavailable_fails_safe(self):
        fake = FakeRun({}, terminate_ok=True)
        fake.sessions = {}
        with patch.object(agent.subprocess, "run", side_effect=OSError("loginctl unavailable")):
            self.assertIsNone(agent._linux_console_user())
            self.assertTrue(agent._linux_user_has_session("sheshadri-n"))

    def test_unlock_targets_saved_employee_only(self):
        fake = FakeRun({})
        with patch.object(agent.subprocess, "run", side_effect=fake), \
             patch.object(agent, "_read_lock_state", return_value={"user": "sheshadri-n"}), \
             patch.object(agent, "_linux_account_locked", side_effect=[False]):
            result = agent._release_lock()
        self.assertEqual(result[0], "completed")
        self.assertIn(["usermod", "--unlock", "sheshadri-n"], fake.calls)


if __name__ == "__main__":
    unittest.main()