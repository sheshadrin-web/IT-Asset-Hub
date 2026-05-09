import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Monitor, Ticket, Users, BarChart2, Settings,
  LogOut, Menu, X, ChevronRight, Bell, Shield, UserCheck, User, Plus, Package,
  ChevronDown,
} from "lucide-react";
import milesLogo from "/miles-logo.png";
import { useAuth } from "@/context/AuthContext";
import { UserRole, ROLE_LABELS } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon:  React.ElementType;
  href:  string;
  roles: UserRole[];
}

const navItems: NavItem[] = [
  { label: "Dashboard",    icon: LayoutDashboard, href: "/",            roles: ["super_admin", "it_admin", "it_agent", "end_user"] },
  { label: "Assets",       icon: Monitor,         href: "/assets",      roles: ["super_admin", "it_admin", "it_agent"] },
  { label: "Tickets",      icon: Ticket,          href: "/tickets",     roles: ["super_admin", "it_admin", "it_agent"] },
  { label: "My Tickets",   icon: Ticket,          href: "/tickets",     roles: ["end_user"] },
  { label: "Raise Ticket", icon: Plus,            href: "/tickets/new", roles: ["end_user"] },
  { label: "My Assets",    icon: Package,         href: "/my-assets",   roles: ["end_user"] },
  { label: "Users",        icon: Users,           href: "/users",       roles: ["super_admin", "it_admin"] },
  { label: "Reports",      icon: BarChart2,       href: "/reports",     roles: ["super_admin", "it_admin", "it_agent"] },
  { label: "Settings",     icon: Settings,        href: "/settings",    roles: ["super_admin"] },
];

const roleColors: Record<UserRole, string> = {
  super_admin: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  it_admin:    "bg-blue-500/20   text-blue-300   border-blue-500/30",
  it_agent:    "bg-cyan-500/20   text-cyan-300   border-cyan-500/30",
  end_user:    "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};
const roleIconMap: Record<UserRole, React.ElementType> = {
  super_admin: Shield,
  it_admin:    Shield,
  it_agent:    UserCheck,
  end_user:    User,
};

// Badge colours for the header dropdown (light bg)
const roleBadgeColors: Record<UserRole, string> = {
  super_admin: "bg-purple-100 text-purple-700 border-purple-200",
  it_admin:    "bg-blue-100 text-blue-700 border-blue-200",
  it_agent:    "bg-cyan-100 text-cyan-700 border-cyan-200",
  end_user:    "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [profileOpen,  setProfileOpen]  = useState(false);
  const [location]                      = useLocation();
  const { currentUser, signOut }        = useAuth();
  const profileRef                      = useRef<HTMLDivElement>(null);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!currentUser) return null;

  const visibleItems = navItems.filter(item => item.roles.includes(currentUser.role));
  const initials     = currentUser.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  const RoleIcon     = roleIconMap[currentUser.role];
  const roleLabel    = ROLE_LABELS[currentUser.role];

  const activeLabel = visibleItems.find(item => {
    if (item.href === "/") return location === "/";
    return location.startsWith(item.href) && item.href !== "/";
  })?.label ?? "Page";

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ───────────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-sidebar transition-transform duration-300 ease-in-out lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
          <img
            src={milesLogo}
            alt="Miles Education"
            className="h-8 w-auto flex-shrink-0 object-contain"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-sidebar-foreground/60 truncate">IT Helpdesk Portal</div>
          </div>
          <button
            className="ml-auto lg:hidden text-sidebar-foreground hover:text-white flex-shrink-0"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
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
        </nav>

        {/* Logout */}
        <div className="border-t border-sidebar-border p-3">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
            onClick={() => signOut()}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />Sign Out
          </Button>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
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

          <div className="flex items-center gap-2">
            {/* Notification bell */}
            <Button variant="ghost" size="icon" className="relative" data-testid="button-notifications">
              <Bell className="h-4 w-4" />
            </Button>

            {/* Profile dropdown */}
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen(v => !v)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent transition-colors focus:outline-none"
                data-testid="button-profile"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-white text-xs font-semibold">{initials}</AvatarFallback>
                </Avatar>
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", profileOpen && "rotate-180")} />
              </button>

              {profileOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-border bg-card shadow-lg z-50 overflow-hidden">
                  {/* Profile card */}
                  <div className="px-4 py-4 border-b border-border">
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar className="h-10 w-10 flex-shrink-0">
                        <AvatarFallback className="bg-primary text-white text-sm font-bold">{initials}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{currentUser.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{currentUser.email}</p>
                      </div>
                    </div>
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
                      roleBadgeColors[currentUser.role]
                    )}>
                      <RoleIcon className="h-3 w-3" />
                      {roleLabel}
                    </span>
                  </div>
                  {/* Sign out */}
                  <button
                    onClick={() => { setProfileOpen(false); signOut(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-destructive hover:bg-destructive/5 transition-colors"
                    data-testid="button-profile-signout"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
