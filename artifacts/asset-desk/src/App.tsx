import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AssetProvider } from "@/context/AssetContext";
import { TicketProvider } from "@/context/TicketContext";
import { UsersProvider } from "@/context/UsersContext";
import { UserRole } from "@/data/mockData";
import Layout from "@/components/Layout";
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
      {/* Public — diagnostic page, no auth required */}
      <Route path="/supabase-check">
        <SupabaseCheck />
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
                  <Router />
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
