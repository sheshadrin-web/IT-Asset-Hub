import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, XCircle, AlertCircle, RefreshCw, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";

interface CheckRow {
  label: string;
  status: "ok" | "error" | "warn" | "info";
  value: string;
}

function StatusIcon({ status }: { status: CheckRow["status"] }) {
  if (status === "ok")    return <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />;
  if (status === "error") return <XCircle      className="h-4 w-4 text-red-500 flex-shrink-0" />;
  if (status === "warn")  return <AlertCircle  className="h-4 w-4 text-amber-500 flex-shrink-0" />;
  return                         <AlertCircle  className="h-4 w-4 text-blue-400 flex-shrink-0" />;
}

function Row({ row }: { row: CheckRow }) {
  const bg = {
    ok:    "bg-emerald-50 border-emerald-200",
    error: "bg-red-50 border-red-200",
    warn:  "bg-amber-50 border-amber-200",
    info:  "bg-blue-50 border-blue-200",
  }[row.status];

  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${bg}`}>
      <StatusIcon status={row.status} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground">{row.label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 break-all">{row.value}</p>
      </div>
    </div>
  );
}

export default function SupabaseCheck() {
  const [rows,    setRows]    = useState<CheckRow[]>([]);
  const [loading, setLoading] = useState(true);

  const runChecks = async () => {
    setLoading(true);
    const checks: CheckRow[] = [];

    // 1. Env vars
    const urlPresent  = !!import.meta.env.VITE_SUPABASE_URL;
    const anonPresent = !!import.meta.env.VITE_SUPABASE_ANON_KEY;

    checks.push({
      label: "VITE_SUPABASE_URL",
      status: urlPresent ? "ok" : "error",
      value: urlPresent
        ? import.meta.env.VITE_SUPABASE_URL as string
        : "NOT SET — add this to Replit Secrets and Render Environment",
    });

    checks.push({
      label: "VITE_SUPABASE_ANON_KEY",
      status: anonPresent ? "ok" : "error",
      value: anonPresent
        ? "Present (value hidden for security)"
        : "NOT SET — add this to Replit Secrets and Render Environment",
    });

    // 2. Client initialised
    checks.push({
      label: "Supabase client initialised",
      status: supabaseConfigured ? "ok" : "error",
      value: supabaseConfigured
        ? "Client created with provided URL and anon key"
        : "Client running in placeholder mode — env vars missing",
    });

    if (!supabaseConfigured) {
      setRows(checks);
      setLoading(false);
      return;
    }

    // 3. Session
    let session: Session | null = null;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        checks.push({ label: "Session check", status: "error", value: error.message });
      } else {
        session = data.session;
        checks.push({
          label: "Current session",
          status: session ? "ok" : "info",
          value: session ? "Active session found" : "No active session (not logged in)",
        });
      }
    } catch (e) {
      checks.push({ label: "Session check", status: "error", value: String(e) });
    }

    // 4. Authenticated user
    if (session?.user) {
      checks.push({
        label: "Authenticated user email",
        status: "ok",
        value: session.user.email ?? "(no email)",
      });
      checks.push({
        label: "Auth user ID",
        status: "info",
        value: session.user.id,
      });

      // 5. Profile lookup
      try {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("id, full_name, email, role, department, location, status")
          .eq("id", session.user.id)
          .single();

        if (profileError) {
          checks.push({
            label: "public.profiles row",
            status: "error",
            value: `Error: ${profileError.message} (code: ${profileError.code}) — check RLS policies and that the row exists`,
          });
        } else if (!profile) {
          checks.push({
            label: "public.profiles row",
            status: "error",
            value: "No profile row found for this user ID — run the INSERT from SUPABASE_SETUP.md",
          });
        } else {
          const p = profile as Record<string, string>;
          checks.push({ label: "public.profiles row", status: "ok",  value: "Found" });
          checks.push({ label: "Profile — name",       status: "info", value: p.full_name });
          checks.push({ label: "Profile — email",      status: "info", value: p.email });
          checks.push({ label: "Profile — role",       status: "ok",  value: p.role });
          checks.push({ label: "Profile — status",     status: p.status?.toLowerCase() === "inactive" ? "warn" : "ok", value: p.status });
          checks.push({ label: "Profile — department", status: "info", value: p.department });
          checks.push({ label: "Profile — location",   status: "info", value: p.location });
        }
      } catch (e) {
        checks.push({ label: "public.profiles row", status: "error", value: String(e) });
      }
    } else {
      checks.push({
        label: "Profile check",
        status: "info",
        value: "Not checked — no active session. Log in first, then revisit /supabase-check.",
      });
    }

    setRows(checks);
    setLoading(false);
  };

  useEffect(() => { runChecks(); }, []);

  const allOk = rows.every((r) => r.status === "ok" || r.status === "info");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-100 p-6">
      <div className="max-w-2xl mx-auto space-y-5">

        <div className="flex items-center gap-3">
          <Link href="/login">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
              <ArrowLeft className="h-4 w-4" /> Back to login
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold">Supabase Diagnostics</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  IT Asset Desk — internal setup check. This page is for admin debugging only.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={runChecks}
                disabled={loading}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-10 gap-3 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" /> Running checks…
              </div>
            ) : (
              <div className="space-y-2.5">
                {rows.map((row, i) => <Row key={i} row={row} />)}

                <div className={`mt-4 rounded-lg border px-4 py-3 text-sm font-medium ${allOk ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
                  {allOk
                    ? "All checks passed. Supabase connection is healthy."
                    : "One or more checks need attention. See items marked above."}
                </div>

                <p className="text-xs text-muted-foreground pt-1">
                  The anon key value is never displayed here. No secret values are exposed on this page.
                  Remove or restrict this route before a public production launch if required.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
