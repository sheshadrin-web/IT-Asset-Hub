import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Assets from "@/pages/Assets";
import AssetDetail from "@/pages/AssetDetail";
import Tickets from "@/pages/Tickets";
import RaiseTicket from "@/pages/RaiseTicket";
import TicketDetail from "@/pages/TicketDetail";
import Users from "@/pages/Users";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function ProtectedRoute({
  component: Component,
  roles,
}: {
  component: React.ComponentType;
  roles?: string[];
}) {
  const { currentUser, isAuthenticated } = useAuth();

  if (!isAuthenticated) return <Redirect to="/login" />;
  if (roles && currentUser && !roles.includes(currentUser.role)) {
    return <Redirect to="/tickets" />;
  }

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function Router() {
  const { isAuthenticated, currentUser } = useAuth();

  return (
    <Switch>
      <Route path="/login">
        {isAuthenticated ? (
          <Redirect to={currentUser?.role === "End User" ? "/tickets" : "/"} />
        ) : (
          <Login />
        )}
      </Route>
      <Route path="/">
        <ProtectedRoute component={Dashboard} roles={["Super Admin", "IT Agent"]} />
      </Route>
      <Route path="/assets">
        <ProtectedRoute component={Assets} roles={["Super Admin", "IT Agent"]} />
      </Route>
      <Route path="/assets/:id">
        <ProtectedRoute component={AssetDetail} roles={["Super Admin", "IT Agent"]} />
      </Route>
      <Route path="/tickets">
        <ProtectedRoute component={Tickets} />
      </Route>
      <Route path="/tickets/new">
        <ProtectedRoute component={RaiseTicket} />
      </Route>
      <Route path="/tickets/:id">
        <ProtectedRoute component={TicketDetail} />
      </Route>
      <Route path="/users">
        <ProtectedRoute component={Users} roles={["Super Admin"]} />
      </Route>
      <Route path="/reports">
        <ProtectedRoute component={Reports} roles={["Super Admin"]} />
      </Route>
      <Route path="/settings">
        <ProtectedRoute component={Settings} roles={["Super Admin"]} />
      </Route>
      <Route>
        {isAuthenticated ? (
          <Layout>
            <NotFound />
          </Layout>
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
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
