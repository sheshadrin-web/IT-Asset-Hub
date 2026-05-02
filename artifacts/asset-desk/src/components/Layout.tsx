import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Monitor,
  Ticket,
  Users,
  BarChart2,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Bell,
  Shield,
  UserCheck,
  User,
  Plus,
  Package,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { UserRole, ROLE_LABELS } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon: React.ElementType;
  href: string;
  roles: UserRole[];
}

const navItems: NavItem[] = [
  { label: "Dashboard",    icon: LayoutDashboard, href: "/",           roles: ["super_admin", "agent", "end_user"] },
  { label: "Assets",       icon: Monitor,         href: "/assets",     roles: ["super_admin", "agent"] },
  { label: "Tickets",      icon: Ticket,          href: "/tickets",    roles: ["super_admin", "agent"] },
  { label: "My Tickets",   icon: Ticket,          href: "/tickets",    roles: ["end_user"] },
  { label: "Raise Ticket", icon: Plus,            href: "/tickets/new",roles: ["end_user"] },
  { label: "My Assets",    icon: Package,         href: "/my-assets",  roles: ["end_user"] },
  { label: "Users",        icon: Users,           href: "/users",      roles: ["super_admin"] },
  { label: "Reports",      icon: BarChart2,       href: "/reports",    roles: ["super_admin", "agent"] },
  { label: "Settings",     icon: Settings,        href: "/settings",   roles: ["super_admin"] },
];

const roleColors: Record<UserRole, string> = {
  super_admin: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  agent:       "bg-blue-500/20 text-blue-300 border-blue-500/30",
  end_user:    "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

const roleIcons: Record<UserRole, React.ElementType> = {
  super_admin: Shield,
  agent:       UserCheck,
  end_user:    User,
};

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [location] = useLocation();
  const { currentUser, logout } = useAuth();

  if (!currentUser) return null;

  const visibleItems = navItems.filter((item) =>
    item.roles.includes(currentUser.role)
  );

  const initials = currentUser.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  const RoleIcon = roleIcons[currentUser.role];
  const roleLabel = ROLE_LABELS[currentUser.role];

  const activeLabel = visibleItems.find((item) => {
    if (item.href === "/") return location === "/";
    return location.startsWith(item.href) && item.href !== "/";
  })?.label ?? "Page";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-sidebar transition-transform duration-300 ease-in-out lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Monitor className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-white leading-none">Asset Desk</div>
            <div className="text-xs text-sidebar-foreground/60 mt-0.5">Demo</div>
          </div>
          <button
            className="ml-auto lg:hidden text-sidebar-foreground hover:text-white"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* User profile */}
        <div className="border-b border-sidebar-border px-4 py-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/30 text-primary-foreground text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">{currentUser.name}</p>
              <p className="text-xs text-sidebar-foreground/70 truncate">{currentUser.email}</p>
            </div>
          </div>
          <div className="mt-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
                roleColors[currentUser.role]
              )}
            >
              <RoleIcon className="h-3 w-3" />
              {roleLabel}
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {visibleItems.map((item, idx) => {
              const Icon = item.icon;
              const isActive =
                item.href === "/"
                  ? location === "/"
                  : location === item.href || (item.href !== "/" && location.startsWith(item.href) && item.href.length > 1);
              return (
                <li key={`${item.href}-${idx}`}>
                  <Link
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-sidebar-primary text-white"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {item.label}
                    {isActive && <ChevronRight className="ml-auto h-3 w-3" />}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Role-based section label */}
          {currentUser.role === "end_user" && (
            <div className="mt-4 px-3">
              <p className="text-xs font-medium text-sidebar-foreground/40 uppercase tracking-wider">
                End User Portal
              </p>
            </div>
          )}
        </nav>

        {/* Logout */}
        <div className="border-t border-sidebar-border p-3">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
            onClick={logout}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-16 items-center border-b border-border bg-card px-4 gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            data-testid="button-menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{activeLabel}</p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="relative" data-testid="button-notifications">
              <Bell className="h-4 w-4" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive" />
            </Button>
            <Avatar className="h-8 w-8 cursor-pointer">
              <AvatarFallback className="bg-primary text-white text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
