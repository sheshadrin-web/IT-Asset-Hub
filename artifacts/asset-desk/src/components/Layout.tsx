import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Monitor, Ticket, Users, BarChart2, Settings,
  LogOut, Menu, X, ChevronRight, Bell, Shield, UserCheck, User, Package,
  Edit, Zap,
} from "lucide-react";
import milesLogo from "/miles-logo.png";
import { useAuth } from "@/context/AuthContext";
import { UserRole, ROLE_LABELS } from "@/data/mockData";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import ProfileSettingsModal from "@/components/ProfileSettingsModal";

interface NavItem {
  label: string;
  icon:  React.ElementType;
  href:  string;
  roles: UserRole[];
}

interface Notif {
  id:       string;
  title:    string;
  body:     string;
  time:     Date;
  read:     boolean;
}

const navItems: NavItem[] = [
  { label: "Dashboard",    icon: LayoutDashboard, href: "/",            roles: ["super_admin", "it_admin", "it_agent", "end_user"] },
  { label: "Assets",       icon: Monitor,         href: "/assets",      roles: ["super_admin", "it_admin", "it_agent"] },
  { label: "Tickets",      icon: Ticket,          href: "/tickets",     roles: ["super_admin", "it_admin", "it_agent"] },
  { label: "My Tickets",   icon: Ticket,          href: "/tickets",     roles: ["end_user"] },
  { label: "My Assets",    icon: Package,         href: "/my-assets",   roles: ["end_user"] },
  { label: "Users",        icon: Users,           href: "/users",       roles: ["super_admin", "it_admin"] },
  { label: "Reports",      icon: BarChart2,       href: "/reports",     roles: ["super_admin", "it_admin", "it_agent"] },
  { label: "Settings",     icon: Settings,        href: "/settings",    roles: ["super_admin"] },
];

const roleIconMap: Record<UserRole, React.ElementType> = {
  super_admin: Shield,
  it_admin:    Shield,
  it_agent:    UserCheck,
  end_user:    User,
};

function playBellSound() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.95, now + 1.2);
      gain.gain.setValueAtTime(i === 0 ? 0.45 : 0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
      osc.start(now);
      osc.stop(now + 1.8);
    });
  } catch { /* AudioContext blocked in some environments */ }
}

function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)  return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen,          setSidebarOpen]          = useState(false);
  const [notifOpen,            setNotifOpen]            = useState(false);
  const [profileSettingsOpen,  setProfileSettingsOpen]  = useState(false);
  const [notifs,               setNotifs]               = useState<Notif[]>([]);
  const [location]                                      = useLocation();
  const { currentUser, signOut }                        = useAuth();
  const { toast }                                       = useToast();
  const notifRef                                        = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const isAdmin = currentUser?.role === "super_admin" || currentUser?.role === "it_admin";

  const handleNewTicket = useCallback((payload: Record<string, unknown>) => {
    const row = payload.new as Record<string, string> | undefined;
    playBellSound();
    const n: Notif = {
      id:    crypto.randomUUID(),
      title: "New ticket raised",
      body:  `${row?.ticket_id ?? "A ticket"} — ${row?.category ?? ""}`,
      time:  new Date(),
      read:  false,
    };
    setNotifs(prev => [n, ...prev].slice(0, 20));
    toast({ title: n.title, description: n.body });
  }, [toast]);

  useEffect(() => {
    if (!isAdmin || !supabaseConfigured) return;
    const channel = supabase
      .channel("layout-new-tickets")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tickets" }, handleNewTicket)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isAdmin, handleNewTicket]);

  if (!currentUser) return null;

  const unread       = notifs.filter(n => !n.read).length;
  const visibleItems = navItems.filter(item => item.roles.includes(currentUser.role));
  const initials     = currentUser.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  const roleLabel    = ROLE_LABELS[currentUser.role];

  const activeLabel = visibleItems.find(item => {
    if (item.href === "/") return location === "/";
    return location.startsWith(item.href) && item.href !== "/";
  })?.label ?? "Page";

  const markAllRead = () => setNotifs(prev => prev.map(n => ({ ...n, read: true })));

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-sidebar transition-transform duration-300 ease-in-out lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo area */}
        <div className="relative flex h-16 items-center gap-3 px-4 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-900/40 to-transparent pointer-events-none" />
          <div className="relative h-10 w-10 rounded-xl overflow-hidden flex-shrink-0 bg-white shadow-md flex items-center justify-center">
            <img src={milesLogo} alt="Miles Education" className="h-full w-full object-contain" />
          </div>
          <div className="relative min-w-0 flex-1">
            <div className="text-[11px] font-bold text-white leading-tight tracking-wide truncate">Miles Education Pvt Ltd</div>
            <div className="text-[10px] text-sidebar-foreground/50 mt-0.5 truncate">IT Asset &amp; Helpdesk Portal</div>
          </div>
          <button
            className="relative ml-auto lg:hidden text-sidebar-foreground/60 hover:text-white transition-colors flex-shrink-0"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Thin accent line under logo */}
        <div className="h-px bg-gradient-to-r from-blue-500/50 via-blue-400/20 to-transparent mx-4" />

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          <p className="px-3 mb-2 text-[10px] font-semibold text-sidebar-foreground/35 uppercase tracking-widest">Menu</p>
          {visibleItems.map((item, idx) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? location === "/"
                : location === item.href || (item.href !== "/" && location.startsWith(item.href) && item.href.length > 1);
            return (
              <Link
                key={`${item.href}-${idx}`}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-white/10 text-white border-l-2 border-blue-400 pl-[10px] shadow-sm"
                    : "text-sidebar-foreground/70 hover:bg-white/5 hover:text-white border-l-2 border-transparent pl-[10px]"
                )}
              >
                <Icon className={cn("h-4 w-4 flex-shrink-0 transition-colors", isActive ? "text-blue-300" : "text-sidebar-foreground/50 group-hover:text-white")} />
                <span className="flex-1 truncate">{item.label}</span>
                {isActive && <ChevronRight className="h-3 w-3 text-blue-300/70" />}
              </Link>
            );
          })}
        </nav>

        {/* Bottom user strip */}
        <div className="border-t border-sidebar-border/40 px-3 py-3 space-y-1">
          <div
            className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/5 transition-colors cursor-pointer"
            onClick={() => setProfileSettingsOpen(true)}
          >
            <Avatar className="h-8 w-8 flex-shrink-0">
              {currentUser.avatarUrl && <AvatarImage src={currentUser.avatarUrl} alt={currentUser.name} className="object-cover" />}
              <AvatarFallback className="bg-primary text-white text-[11px] font-bold">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-white truncate">{currentUser.name}</p>
              <p className="text-[10px] text-sidebar-foreground/40 truncate">{roleLabel}</p>
            </div>
            <Edit className="h-3.5 w-3.5 text-sidebar-foreground/30 flex-shrink-0" />
          </div>
          <button
            onClick={signOut}
            data-testid="button-profile-signout"
            className="w-full flex items-center gap-2.5 rounded-lg px-2 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5 flex-shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Top header */}
        <header className="flex h-14 items-center border-b border-border bg-card/80 backdrop-blur px-4 gap-3 shadow-sm">
          <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8" onClick={() => setSidebarOpen(true)} data-testid="button-menu">
            <Menu className="h-4 w-4" />
          </Button>

          {/* Breadcrumb-style page label */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-xs text-muted-foreground hidden sm:inline">IT Portal</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground/40 hidden sm:inline" />
            <p className="text-sm font-semibold text-foreground truncate">{activeLabel}</p>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Notification bell — admins only */}
            <div className="relative" ref={notifRef}>
              <Button
                variant="ghost" size="icon"
                className={cn("relative h-8 w-8 rounded-lg transition-colors", notifOpen && "bg-accent")}
                data-testid="button-notifications"
                onClick={() => setNotifOpen(v => !v)}
              >
                <Bell className={cn("h-4 w-4 transition-colors", unread > 0 ? "text-blue-500" : "text-muted-foreground")} />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white shadow">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Button>

              {/* Notification dropdown */}
              {notifOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                      <Bell className="h-3.5 w-3.5 text-blue-500" />
                      <p className="text-sm font-semibold text-foreground">Notifications</p>
                      {unread > 0 && (
                        <span className="rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5">{unread}</span>
                      )}
                    </div>
                    {notifs.length > 0 && (
                      <button onClick={markAllRead} className="text-xs text-primary hover:underline font-medium">Mark all read</button>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto">
                    {notifs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 gap-2">
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                          <Bell className="h-5 w-5 text-muted-foreground/40" />
                        </div>
                        <p className="text-sm text-muted-foreground">No notifications yet</p>
                        <p className="text-xs text-muted-foreground/60 text-center px-6">New ticket alerts will appear here in real time</p>
                      </div>
                    ) : (
                      notifs.map(n => (
                        <div
                          key={n.id}
                          className={cn(
                            "flex items-start gap-3 px-4 py-3 border-b border-border/60 last:border-0 transition-colors",
                            !n.read ? "bg-blue-50/50" : "hover:bg-accent/40"
                          )}
                        >
                          <div className={cn("mt-0.5 h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0", !n.read ? "bg-blue-100" : "bg-muted")}>
                            <Zap className={cn("h-3.5 w-3.5", !n.read ? "text-blue-600" : "text-muted-foreground")} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-xs font-semibold truncate", !n.read ? "text-foreground" : "text-muted-foreground")}>{n.title}</p>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{n.body}</p>
                            <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(n.time)}</p>
                          </div>
                          {!n.read && <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
                        </div>
                      ))
                    )}
                  </div>

                  {notifs.length > 0 && (
                    <div className="border-t border-border px-4 py-2.5 bg-muted/20">
                      <Link href="/tickets" onClick={() => setNotifOpen(false)} className="text-xs text-primary hover:underline font-medium">
                        View all tickets →
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 pt-6 pb-4 bg-muted/20">{children}</main>
      </div>

      <ProfileSettingsModal open={profileSettingsOpen} onClose={() => setProfileSettingsOpen(false)} />
    </div>
  );
}
