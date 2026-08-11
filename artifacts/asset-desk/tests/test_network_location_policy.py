"""Executable policy tests for the server-side location cache design.

These tests model the cache decision independently of Supabase so the refresh
rules remain reviewable without contacting production or an external provider.
The SQL migration is the source of runtime behavior.
"""
import unittest
from datetime import datetime, timedelta, timezone


TTL = timedelta(hours=24)
BACKOFF = timedelta(minutes=15)


class LocationPolicy:
    def __init__(self):
        self.cache = {}
        self.provider_calls = []

    def sync(self, public_ip, now, provider):
        if not public_ip or public_ip.startswith(("10.", "192.168.", "127.")):
            return None
        row = self.cache.get(public_ip)
        if row and row["expires_at"] > now:
            return row["location"]
        if row and row.get("retry_after") and row["retry_after"] > now:
            return None
        self.provider_calls.append(public_ip)
        result = provider(public_ip)
        if result is None:
            old = row or {"location": None}
            old["retry_after"] = now + BACKOFF
            self.cache[public_ip] = old
            return None
        self.cache[public_ip] = {
            "location": result,
            "expires_at": now + TTL,
            "retry_after": None,
        }
        return result


class NetworkLocationPolicyTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 8, 12, tzinfo=timezone.utc)
        self.p = LocationPolicy()
        self.provider = lambda ip: {"source": "network", "public_ip": ip}

    def test_first_ip_calls_provider(self):
        self.assertEqual(self.p.sync("203.0.113.10", self.now, self.provider)["public_ip"], "203.0.113.10")
        self.assertEqual(self.p.provider_calls, ["203.0.113.10"])

    def test_same_fresh_ip_does_not_call_provider(self):
        self.p.sync("203.0.113.10", self.now, self.provider)
        self.p.sync("203.0.113.10", self.now + timedelta(hours=1), self.provider)
        self.assertEqual(self.p.provider_calls, ["203.0.113.10"])

    def test_same_stale_ip_calls_provider(self):
        self.p.sync("203.0.113.10", self.now, self.provider)
        self.p.sync("203.0.113.10", self.now + TTL + timedelta(minutes=1), self.provider)
        self.assertEqual(self.p.provider_calls, ["203.0.113.10", "203.0.113.10"])

    def test_changed_ip_calls_provider(self):
        self.p.sync("203.0.113.10", self.now, self.provider)
        self.p.sync("198.51.100.20", self.now + timedelta(minutes=1), self.provider)
        self.assertEqual(self.p.provider_calls, ["203.0.113.10", "198.51.100.20"])

    def test_shared_ip_reuses_one_lookup(self):
        self.p.sync("203.0.113.10", self.now, self.provider)
        self.p.sync("203.0.113.10", self.now + timedelta(minutes=2), self.provider)
        self.assertEqual(self.p.provider_calls.count("203.0.113.10"), 1)

    def test_failure_preserves_previous_location_and_backoffs(self):
        self.p.sync("203.0.113.10", self.now, self.provider)
        old = self.p.cache["203.0.113.10"]["location"]
        failing = lambda _ip: None
        self.p.sync("203.0.113.10", self.now + TTL + timedelta(minutes=1), failing)
        self.assertEqual(self.p.cache["203.0.113.10"]["location"], old)
        self.p.sync("203.0.113.10", self.now + TTL + timedelta(minutes=2), failing)
        self.assertEqual(self.p.provider_calls.count("203.0.113.10"), 2)

    def test_invalid_private_ip_does_not_call_provider(self):
        self.assertIsNone(self.p.sync("10.0.0.4", self.now, self.provider))
        self.assertEqual(self.p.provider_calls, [])

    def test_provider_malformed_result_is_not_stored(self):
        self.assertIsNone(self.p.sync("203.0.113.10", self.now, lambda _ip: None))
        self.assertIsNone(self.p.cache["203.0.113.10"]["location"])


if __name__ == "__main__":
    unittest.main()