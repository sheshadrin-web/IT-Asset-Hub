import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabaseClient";
import { fetchShortageRequests, type ShortageRequest } from "@/lib/shortageRequests";
import { fetchReturnRequests, type ReturnRequest } from "@/lib/returnRequests";
import { getAuditLogs, type AuditLogRow } from "@/lib/auditService";

// Mirrors _hr_can_read() — only these roles may read shortage / return / audit feeds.
const READ_ROLES = ["super_admin", "it_admin", "it_agent", "hr_admin"];

export interface DashboardFeeds {
  shortages: ShortageRequest[];
  returns:   ReturnRequest[];
  audits:    AuditLogRow[];
  loading:   boolean;
  error:     string | null;
  refresh:   () => void;
}

/**
 * Loads the admin dashboard's async feeds (shortage requests, return requests,
 * recent audit activity) in one shot. Each source fails soft so one broken feed
 * never blanks the whole dashboard.
 */
export function useDashboardFeeds(enabled: boolean): DashboardFeeds {
  const { session, loading: authLoading, currentUser } = useAuth();
  const canRead = READ_ROLES.includes(currentUser?.role ?? "");

  const [shortages, setShortages] = useState<ShortageRequest[]>([]);
  const [returns, setReturns]     = useState<ReturnRequest[]>([]);
  const [audits, setAudits]       = useState<AuditLogRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session || !canRead) { setLoading(false); return; }
    setLoading(true);
    try {
      const [s, r, a] = await Promise.allSettled([
        fetchShortageRequests(),
        fetchReturnRequests(),
        getAuditLogs(15),
      ]);
      setShortages(s.status === "fulfilled" ? s.value : []);
      setReturns(r.status === "fulfilled" ? r.value : []);
      setAudits(a.status === "fulfilled" ? a.value : []);
      const failed = [s, r, a].filter(x => x.status === "rejected").length;
      setError(failed > 0 ? "Some dashboard data could not be loaded." : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, [enabled, authLoading, session, canRead]);

  useEffect(() => { void load(); }, [load]);

  return { shortages, returns, audits, loading, error, refresh: () => void load() };
}
