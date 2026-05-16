import { useState } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, KeyRound, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AssetProvider } from "@/context/AssetContext";
import { TicketProvider } from "@/context/TicketContext";
import { UsersProvider } from "@/context/UsersContext";
import { UserRole } from "@/data/mockData";
import Layout from "@/components/Layout";
import AcknowledgePage from "@/pages/AcknowledgePage";
import Forbidden from "@/pages/Forbidden";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Assets from "@/pages/Assets";
import AddAsset from "@/pages/AddAsset";
import EditAsset from "@/pages/EditAsset";
import AssetDetail from "@/pages/AssetDetail";
import Tickets from "@/pages/Tickets";
import RaiseTicket from "@/pages/RaiseTicket";
import TicketDetail from "@/pages/TicketDetail";
import Users from "@/pages/Users";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import MyAssets from "@/pages/MyAssets";
import ReturnAsset from "@/pages/ReturnAsset";
import BulkImport from "@/pages/BulkImport";
import SupabaseCheck from "@/pages/SupabaseCheck";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

// ── Password reset screen (shown when user clicks a reset-link email) ─────────
function ResetPasswordScreen() {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [done,     setDone]     = useState(false);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch || tooShort || !password) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast({ title: "Failed to set password", description: error.message, variant: "destructive" });
      setSaving(false);
    } else {
      setDone(true);
      await supabase.auth.signOut();
      setTimeout(() => { window.location.replace("/"); }, 2500);
    }
  };

  if (done) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
          <h2 className="text-xl font-semibold text-foreground">Password updated!</h2>
          <p className="text-sm text-muted-foreground">Redirecting to login…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary/10 mb-2">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Set New Password</h1>
          <p className="text-sm text-muted-foreground">Enter and confirm your new password below.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">New Password</Label>
            <div className="relative">
              <Input
                id="new-pw"
                type={showPw ? "text" : "password"}
                placeholder="Min. 8 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={tooShort ? "border-destructive" : ""}
                autoFocus
              />
              <button
                type="button" tabIndex={-1}
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {tooShort && <p className="text-xs text-destructive">Must be at least 8 characters</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-pw">Confirm Password</Label>
            <Input
              id="confirm-pw"
              type={showPw ? "text" : "password"}
              placeholder="Repeat new password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className={mismatch ? "border-destructive" : ""}
            />
            {mismatch && <p className="text-xs text-destructive">Passwords do not match</p>}
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={saving || !password || !confirm || !!mismatch || tooShort}
          >
            {saving ? "Saving…" : "Set Password"}
          </Button>
        </form>
      </div>
    </div>
  );
}

// Intercepts routing when a password-reset link has been opened
function RecoveryGate() {
  const { isRecoveryMode } = useAuth();
  if (isRecoveryMode) return <ResetPasswordScreen />;
  return <Router />;
}

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}

function ConfigError() {
  return (
    <div className="flex h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md text-center space-y-4">
        <div className="text-4xl">⚠️</div>
        <h1 className="text-xl font-bold text-foreground">Supabase Not Configured</h1>
        <p className="text-sm text-muted-foreground">
          The environment variables <code className="bg-muted px-1 rounded">VITE_SUPABASE_URL</code> and{" "}
          <code className="bg-muted px-1 rounded">VITE_SUPABASE_ANON_KEY</code> are missing.
        </p>
        <p className="text-sm text-muted-foreground">
          Add them in Replit Secrets (for development) and in your Render environment variables (for production).
          See <strong>SUPABASE_SETUP.md</strong> for full instructions.
        </p>
      </div>
    </div>
  );
}

function ProtectedRoute({
  component: Component,
  allowedRoles,
}: {
  component: React.ComponentType;
  allowedRoles?: UserRole[];
}) {
  const { currentUser, isAuthenticated, loading, configError } = useAuth();

  if (configError) return <ConfigError />;
  if (loading) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/login" />;

  if (allowedRoles && currentUser && !allowedRoles.includes(currentUser.role)) {
    return <Layout><Forbidden /></Layout>;
  }

  return <Layout><Component /></Layout>;
}

function Router() {
  const { isAuthenticated, loading, configError } = useAuth();

  if (configError) return <ConfigError />;
  if (loading) return <LoadingScreen />;

  return (
    <Switch>
      {/* Diagnostic page — requires login to prevent public exposure of system info */}
      <Route path="/supabase-check">
        <ProtectedRoute component={SupabaseCheck} />
      </Route>

      {/* Public — acknowledgement link (no login required) */}
      <Route path="/ack/:token">
        {() => <AcknowledgePage />}
      </Route>

      {/* Public */}
      <Route path="/login">
        {isAuthenticated ? <Redirect to="/" /> : <Login />}
      </Route>

      {/* Dashboard — all authenticated roles */}
      <Route path="/">
        <ProtectedRoute component={Dashboard} />
      </Route>

      {/* Assets — admins and agents */}
      <Route path="/assets/import">
        <ProtectedRoute component={BulkImport} allowedRoles={["super_admin", "it_admin"]} />
      </Route>
      <Route path="/assets/new">
        <ProtectedRoute component={AddAsset} allowedRoles={["super_admin", "it_admin"]} />
      </Route>
      <Route path="/assets/:id/edit">
        <ProtectedRoute component={EditAsset} allowedRoles={["super_admin", "it_admin", "it_agent"]} />
      </Route>
      <Route path="/assets/:id/return">
        <ProtectedRoute component={ReturnAsset} allowedRoles={["super_admin", "it_admin"]} />
      </Route>
      <Route path="/assets/:id">
        <ProtectedRoute component={AssetDetail} allowedRoles={["super_admin", "it_admin", "it_agent"]} />
      </Route>
      <Route path="/assets">
        <ProtectedRoute component={Assets} allowedRoles={["super_admin", "it_admin", "it_agent"]} />
      </Route>

      {/* Tickets — all roles (filtering inside each page) */}
      <Route path="/tickets/new">
        <ProtectedRoute component={RaiseTicket} />
      </Route>
      <Route path="/tickets/:id">
        <ProtectedRoute component={TicketDetail} />
      </Route>
      <Route path="/tickets">
        <ProtectedRoute component={Tickets} />
      </Route>

      {/* My Assets — end_user only */}
      <Route path="/my-assets">
        <ProtectedRoute component={MyAssets} allowedRoles={["end_user"]} />
      </Route>

      {/* Users — super_admin + it_admin */}
      <Route path="/users">
        <ProtectedRoute component={Users} allowedRoles={["super_admin", "it_admin"]} />
      </Route>

      {/* Reports — admins and agents */}
      <Route path="/reports">
        <ProtectedRoute component={Reports} allowedRoles={["super_admin", "it_admin", "it_agent"]} />
      </Route>

      {/* Settings — super_admin only */}
      <Route path="/settings">
        <ProtectedRoute component={Settings} allowedRoles={["super_admin"]} />
      </Route>

      {/* 404 */}
      <Route>
        {isAuthenticated
          ? <Layout><NotFound /></Layout>
          : <Redirect to="/login" />}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AssetProvider>
            <TicketProvider>
              <UsersProvider>
                <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                  <RecoveryGate />
                </WouterRouter>
                <Toaster />
              </UsersProvider>
            </TicketProvider>
          </AssetProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
