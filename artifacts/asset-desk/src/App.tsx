import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AssetProvider } from "@/context/AssetContext";
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
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function ProtectedRoute({
  component: Component,
  allowedRoles,
}: {
  component: React.ComponentType;
  allowedRoles?: UserRole[];
}) {
  const { currentUser, isAuthenticated } = useAuth();

  if (!isAuthenticated) return <Redirect to="/login" />;

  if (allowedRoles && currentUser && !allowedRoles.includes(currentUser.role)) {
    return (
      <Layout>
        <Forbidden />
      </Layout>
    );
  }

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function Router() {
  const { isAuthenticated, currentUser } = useAuth();
  const homeRedirect = currentUser?.role === "end_user" ? "/tickets" : "/";

  return (
    <Switch>
      {/* Public */}
      <Route path="/login">
        {isAuthenticated ? <Redirect to={homeRedirect} /> : <Login />}
      </Route>

      {/* Dashboard — all roles */}
      <Route path="/">
        <ProtectedRoute component={Dashboard} />
      </Route>

      {/* Assets — super_admin + agent */}
      <Route path="/assets/new">
        <ProtectedRoute component={AddAsset} allowedRoles={["super_admin"]} />
      </Route>
      <Route path="/assets/:id/edit">
        <ProtectedRoute component={EditAsset} allowedRoles={["super_admin", "agent"]} />
      </Route>
      <Route path="/assets/:id">
        <ProtectedRoute component={AssetDetail} allowedRoles={["super_admin", "agent"]} />
      </Route>
      <Route path="/assets">
        <ProtectedRoute component={Assets} allowedRoles={["super_admin", "agent"]} />
      </Route>

      {/* Tickets — all roles */}
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

      {/* Users — super_admin only */}
      <Route path="/users">
        <ProtectedRoute component={Users} allowedRoles={["super_admin"]} />
      </Route>

      {/* Reports — super_admin + agent */}
      <Route path="/reports">
        <ProtectedRoute component={Reports} allowedRoles={["super_admin", "agent"]} />
      </Route>

      {/* Settings — super_admin only */}
      <Route path="/settings">
        <ProtectedRoute component={Settings} allowedRoles={["super_admin"]} />
      </Route>

      {/* 404 */}
      <Route>
        {isAuthenticated ? (
          <Layout><NotFound /></Layout>
        ) : (
          <Redirect to="/login" />
        )}
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
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </AssetProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
