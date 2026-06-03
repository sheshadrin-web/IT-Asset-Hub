import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { supabaseConfigured } from "@/lib/supabaseClient";
import { getManagerHierarchyOverview } from "@/lib/dashboardHrService";
import type { ManagerHierarchyOverview } from "@/lib/hrSyncTypes";
import {
  Network, UserCog, UserX, Users as UsersIcon, GitBranch, ArrowRight, AlertCircle,
} from "lucide-react";

// Mirrors _hr_can_read() in the migration — only these roles may read HR data.
const HR_READ_ROLES = ["super_admin", "it_admin", "it_agent", "hr_admin"];

export default function ManagerHierarchy() {
  const { session, loading: authLoading, currentUser } = useAuth();
  const canRead = HR_READ_ROLES.includes(currentUser?.role ?? "");

  const [overview, setOverview] = useState<ManagerHierarchyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (authLoading) return;
    if (!session) { setLoading(false); return; }
    if (!canRead) { setLoading(false); return; }
    try {
      setOverview(await getManagerHierarchyOverview());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load manager hierarchy");
    } finally {
      setLoading(false);
    }
  }, [session, authLoading, canRead]);

  useEffect(() => { void load(); }, [load]);

  if (!supabaseConfigured) return null;
  if (!canRead) return null;

  const cards = [
    { label: "Total Managers", value: overview?.total_managers ?? 0, icon: UserCog, color: "text-violet-600", bg: "bg-violet-500/10", href: "/users" },
    { label: "Employees Without Manager", value: overview?.employees_without_manager ?? 0, icon: UserX, color: "text-amber-600", bg: "bg-amber-500/10", href: "/users" },
    { label: "Managers With Direct Reports", value: overview?.managers_with_direct_reports ?? 0, icon: UsersIcon, color: "text-blue-600", bg: "bg-blue-500/10", href: "/users" },
    { label: "Largest Team Size", value: overview?.largest_team_size ?? 0, icon: GitBranch, color: "text-emerald-600", bg: "bg-emerald-500/10", href: "/users" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Network className="h-4 w-4 text-muted-foreground" />
          Manager Hierarchy Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3" data-testid="error-manager-hierarchy">
            <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {cards.map(c => (
              <Link key={c.label} href={c.href}>
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 group" data-testid={`widget-${c.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                  <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${c.bg}`}>
                    <c.icon className={`h-4 w-4 ${c.color}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xl font-bold text-foreground leading-none">{loading ? "—" : c.value}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{c.label}</p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/20 group-hover:text-muted-foreground transition-colors ml-auto flex-shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
