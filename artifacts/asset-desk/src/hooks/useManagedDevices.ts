import { useState, useEffect, useCallback } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import type { ManagedDeviceRow } from "@/lib/restartPending";

const DEVICE_COLUMNS =
  "id, laptop_asset_id, hostname, logged_in_username, employee_email, status, " +
  "is_managed, agent_removed_at, last_seen_at, uptime_seconds, last_boot_at, os_name";

/**
 * Loads the managed-device rows (agent heartbeats) for dashboard-style views.
 * Reads are RLS-protected, so we wait for the Supabase session to attach before
 * querying — otherwise the request goes out as `anon` and returns nothing. Pass
 * `enabled = false` to skip the fetch entirely (e.g. for end users).
 */
export function useManagedDevices(enabled: boolean) {
  const { session, loading: authLoading } = useAuth();
  const [devices, setDevices] = useState<ManagedDeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured || !enabled) { setLoading(false); return; }
    if (authLoading) return;
    // Auth has resolved but there's no session (e.g. signed out): stop the
    // spinner instead of waiting forever for a query we won't run.
    if (!session) { setLoading(false); return; }
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("managed_devices")
      .select(DEVICE_COLUMNS)
      .order("uptime_seconds", { ascending: false, nullsFirst: false });
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setError(null);
      setDevices((data ?? []) as unknown as ManagedDeviceRow[]);
    }
    setLoading(false);
  }, [enabled, session, authLoading]);

  useEffect(() => { void load(); }, [load]);

  return { devices, loading, error, refresh: load };
}
