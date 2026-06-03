import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Monitor, Ticket, Users, BarChart2, Settings,
  LogOut, Menu, X, ChevronRight, Bell, Shield, UserCheck, User, Package,
  Edit, Zap, UserCog,
} from "lucide-react";
import milesLogo from "/miles-logo.png";
import { useAuth } from "@/context/AuthContext";
import { useTickets } from "@/context/TicketContext";
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

// Notification read-state is only tracked for recent tickets — this caps how
// many ticket IDs we ever persist to localStorage so it can't grow unbounded.
const RECENT_LIMIT = 200;

const navItems: NavItem[] = [
  { label: "Dashboard",    icon: LayoutDashboard, href: "/",            roles: ["super_admin", "it_admin", "it_agent", "end_user"] },
  { label: "Assets",       icon: Monitor,         href: "/assets",      roles: ["super_admin", "it_admin", "it_agent"] },
  { label: "Tickets",      icon: Ticket,          href: "/tickets",     roles: ["super_admin", "it_admin", "it_agent"] },
  { label: "My Tickets",   icon: Ticket,          href: "/tickets",     roles: ["end_user"] },
  { label: "My Assets",    icon: Package,         href: "/my-assets",   roles: ["end_user"] },
  { label: "Users",        icon: Users,           href: "/users",       roles: ["super_admin", "it_admin", "hr_admin"] },
  { label: "Onboarding",   icon: UserCog,         href: "/hr-queues",   roles: ["super_admin", "it_admin", "it_agent", "hr_admin"] },
  { label: "Reports",      icon: BarChart2,       href: "/reports",     roles: ["super_admin", "it_admin", "it_agent", "hr_admin"] },
  { label: "Settings",     icon: Settings,        href: "/settings",    roles: ["super_admin"] },
];

const roleIconMap: Record<UserRole, React.ElementType> = {
  super_admin: Shield,
  it_admin:    Shield,
  hr_admin:    Shield,
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

function dayLabel(d: string): string {
  if (!d) return "";
  const today     = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 864e5).toISOString().split("T")[0];
  if (d === today)     return "Today";
  if (d === yesterday) return "Yesterday";
  const parsed = new Date(`${d}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? d
    : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen,          setSidebarOpen]          = useState(false);
  const [notifOpen,            setNotifOpen]            = useState(false);
  const [profileSettingsOpen,  setProfileSettingsOpen]  = useState(false);
  const [readIds,              setReadIds]              = useState<Set<string>>(new Set());
  const [location]                                      = useLocation();
  const { currentUser, signOut }                        = useAuth();
  const { tickets, loading: ticketsLoading, refresh: refreshTickets } = useTickets();
  const { toast }                                       = useToast();
  const notifRef                                        = useRef<HTMLDivElement>(null);
  const seededRef                                       = useRef(false);

  // Staff who triage tickets get new-ticket notifications.
  const canSeeNotifs =
    currentUser?.role === "super_admin" ||
    currentUser?.role === "it_admin" ||
    currentUser?.role === "it_agent";
  const notifStorageKey = currentUser ? `miles-notif-read:${currentUser.userId}` : "";

  // Load this user's persisted "read" ticket IDs so notifications survive reloads.
  useEffect(() => {
    seededRef.current = false;
    if (!notifStorageKey) { setReadIds(new Set()); return; }
    try {
      const raw = localStorage.getItem(notifStorageKey);
      if (raw) { setReadIds(new Set(JSON.parse(raw) as string[])); seededRef.current = true; }
      else setReadIds(new Set());
    } catch { setReadIds(new Set()); }
  }, [notifStorageKey]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // First load with no saved history: treat existing tickets as already seen so
  // the admin isn't flooded with a badge for historical tickets. Only tickets
  // that arrive afterwards count as unread. Wait for the initial fetch to settle.
  useEffect(() => {
    if (!notifStorageKey || seededRef.current || !canSeeNotifs || ticketsLoading) return;
    const ids = tickets.slice(0, RECENT_LIMIT).map(t => t.ticketId);
    try { localStorage.setItem(notifStorageKey, JSON.stringify(ids)); } catch { /* ignore */ }
    setReadIds(new Set(ids));
    seededRef.current = true;
  }, [notifStorageKey, canSeeNotifs, ticketsLoading, tickets]);

  const handleNewTicket = useCallback((payload: Record<string, unknown>) => {
    const row = payload.new as Record<string, string> | undefined;
    playBellSound();
    toast({ title: "New ticket raised", description: `${row?.ticket_id ?? "A ticket"} — ${row?.category ?? ""}` });
    refreshTickets();
  }, [toast, refreshTickets]);

  useEffect(() => {
    if (!canSeeNotifs || !supabaseConfigured) return;
    const channel = supabase
      .channel("layout-new-tickets")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tickets" }, handleNewTicket)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [canSeeNotifs, handleNewTicket]);

  if (!currentUser) return null;

  const notifItems = canSeeNotifs
    ? tickets.slice(0, 20).map(t => ({
        key:      t.id ?? t.ticketId,
        ticketId: t.ticketId,
        category: t.category,
        raisedBy: t.raisedBy,
        status:   t.status,
        date:     t.createdDate,
        read:     readIds.has(t.ticketId),
      }))
    : [];
  const unread       = notifItems.filter(n => !n.read).length;
  const visibleItems = navItems.filter(item => item.roles.includes(currentUser.role));
  const initials     = currentUser.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  const roleLabel    = ROLE_LABELS[currentUser.role];

  const activeLabel = visibleItems.find(item => {
    if (item.href === "/") return location === "/";
    return location.startsWith(item.href) && item.href !== "/";
  })?.label ?? "Page";

  const recentTicketIds = new Set(tickets.slice(0, RECENT_LIMIT).map(t => t.ticketId));
  const persistRead = (ids: Set<string>) => {
    // Drop IDs for tickets that have aged out of (or never were in) the recent
    // window so the persisted set stays bounded.
    const bounded = new Set([...ids].filter(id => recentTicketIds.has(id)));
    setReadIds(bounded);
    if (notifStorageKey) {
      try { localStorage.setItem(notifStorageKey, JSON.stringify([...bounded])); } catch { /* ignore */ }
    }
  };
  const markAllRead = () => {
    const ids = new Set(readIds);
    notifItems.forEach(n => ids.add(n.ticketId));
    persistRead(ids);
  };
  const markRead = (ticketId: string) => {
    if (readIds.has(ticketId)) return;
    const ids = new Set(readIds);
    ids.add(ticketId);
    persistRead(ids);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-sidebar transition-transform duration-300 ease-in-out lg:static lg:translate-x-0",
          "bg-[radial-gradient(120%_60%_at_0%_0%,hsl(221_83%_22%/0.55),transparent_55%),radial-gradient(80%_50%_at_100%_100%,hsl(221_83%_30%/0.25),transparent_60%)] bg-sidebar",
          "border-r border-sidebar-border/60 shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.02)]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo area */}
        <div className="relative flex h-16 items-center gap-3 px-4 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/15 via-blue-500/5 to-transparent pointer-events-none" />
          <div className="relative h-10 w-10 rounded-xl overflow-hidden flex-shrink-0 bg-white shadow-[0_4px_12px_-2px_rgba(0,0,0,0.35)] ring-1 ring-white/20 flex items-center justify-center">
            <img src={milesLogo} alt="Miles Education" className="h-full w-full object-contain" />
          </div>
          <div className="relative min-w-0 flex-1">
            <div className="text-[11px] font-bold text-white leading-tight tracking-wide truncate">Miles Education Pvt Ltd</div>
            <div className="text-[10px] text-sidebar-foreground/55 mt-0.5 truncate">IT Asset &amp; Helpdesk Portal</div>
          </div>
          <button
            className="relative ml-auto lg:hidden text-sidebar-foreground/60 hover:text-white transition-colors flex-shrink-0"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Thin accent line under logo */}
        <div className="h-px bg-gradient-to-r from-blue-400/40 via-blue-400/15 to-transparent mx-4" />

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <p className="px-3 mb-2 text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-[0.18em]">Menu</p>
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
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-gradient-to-r from-blue-500/20 via-blue-500/10 to-transparent text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-inset ring-blue-400/20"
                    : "text-sidebar-foreground/75 hover:bg-white/5 hover:text-white"
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-gradient-to-b from-blue-300 to-blue-500 shadow-[0_0_8px_0_rgba(96,165,250,0.5)]" />
                )}
                <Icon className={cn("h-[18px] w-[18px] flex-shrink-0 transition-colors", isActive ? "text-blue-300" : "text-sidebar-foreground/55 group-hover:text-white")} />
                <span className="flex-1 truncate">{item.label}</span>
                {isActive && <ChevronRight className="h-3 w-3 text-blue-300/80" />}
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
        <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border/70 bg-card/70 backdrop-blur-md supports-[backdrop-filter]:bg-card/60 px-4 gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8" onClick={() => setSidebarOpen(true)} data-testid="button-menu">
            <Menu className="h-4 w-4" />
          </Button>

          {/* Breadcrumb-style page label */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-md bg-primary/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              IT Portal
            </span>
            <ChevronRight className="h-3 w-3 text-muted-foreground/40 hidden sm:inline" />
            <p className="text-sm font-semibold text-foreground truncate tracking-tight">{activeLabel}</p>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Notification bell — staff who triage tickets */}
            {canSeeNotifs && (
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
                    {unread > 0 && (
                      <button onClick={markAllRead} className="text-xs text-primary hover:underline font-medium">Mark all read</button>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto">
                    {notifItems.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 gap-2">
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                          <Bell className="h-5 w-5 text-muted-foreground/40" />
                        </div>
                        <p className="text-sm text-muted-foreground">No notifications yet</p>
                        <p className="text-xs text-muted-foreground/60 text-center px-6">New ticket alerts will appear here in real time</p>
                      </div>
                    ) : (
                      notifItems.map(n => (
                        <Link
                          key={n.key}
                          href={`/tickets/${n.ticketId}`}
                          onClick={() => { markRead(n.ticketId); setNotifOpen(false); }}
                          className={cn(
                            "flex items-start gap-3 px-4 py-3 border-b border-border/60 last:border-0 transition-colors cursor-pointer",
                            !n.read ? "bg-blue-50/50 hover:bg-blue-50" : "hover:bg-accent/40"
                          )}
                        >
                          <div className={cn("mt-0.5 h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0", !n.read ? "bg-blue-100" : "bg-muted")}>
                            <Zap className={cn("h-3.5 w-3.5", !n.read ? "text-blue-600" : "text-muted-foreground")} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-xs font-semibold truncate", !n.read ? "text-foreground" : "text-muted-foreground")}>{n.ticketId} — {n.category}</p>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">Raised by {n.raisedBy} · {n.status}</p>
                            <p className="text-[10px] text-muted-foreground/60 mt-1">{dayLabel(n.date)}</p>
                          </div>
                          {!n.read && <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
                        </Link>
                      ))
                    )}
                  </div>

                  {notifItems.length > 0 && (
                    <div className="border-t border-border px-4 py-2.5 bg-muted/20">
                      <Link href="/tickets" onClick={() => setNotifOpen(false)} className="text-xs text-primary hover:underline font-medium">
                        View all tickets →
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}

          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 pt-6 pb-0">{children}</main>
      </div>

      <ProfileSettingsModal open={profileSettingsOpen} onClose={() => setProfileSettingsOpen(false)} />
    </div>
  );
}
