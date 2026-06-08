import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsCard } from "@/components/settings/SettingsCard";
import AutomationRules from "@/components/settings/integrations/AutomationRules";
import AuditLogs from "@/components/settings/AuditLogs";
import { useToast } from "@/hooks/use-toast";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { LoadErrorBanner } from "@/components/LoadErrorBanner";
import { cn } from "@/lib/utils";
import {
  Bell, Shield, Monitor, Loader2, Plug, ChevronRight, Users, Workflow,
  ScrollText, ShieldCheck, ArrowRight,
} from "lucide-react";

interface OrgSettings {
  org_name:            string;
  support_email:       string;
  email_notifications: boolean;
  ticket_assignment:   boolean;
  status_updates:      boolean;
  warranty_alerts:     boolean;
  two_factor:          boolean;
  session_timeout:     number;
  timezone:            string;
  date_format:         string;
  agent_active_poll_sec: number;
  agent_idle_poll_sec:   number;
}

const DEFAULTS: OrgSettings = {
  org_name:            "Miles Education Pvt Ltd",
  support_email:       "it.helpdesk@mileseducation.com",
  email_notifications: true,
  ticket_assignment:   true,
  status_updates:      true,
  warranty_alerts:     true,
  two_factor:          false,
  session_timeout:     30,
  timezone:            "Asia/Kolkata",
  date_format:         "DD MMM YYYY",
  agent_active_poll_sec: 5,
  agent_idle_poll_sec:   30,
};

const TIMEZONES = [
  { value: "Asia/Kolkata",        label: "(GMT+05:30) Asia/Kolkata" },
  { value: "UTC",                 label: "(GMT+00:00) UTC" },
  { value: "Asia/Dubai",          label: "(GMT+04:00) Asia/Dubai" },
  { value: "Asia/Singapore",      label: "(GMT+08:00) Asia/Singapore" },
  { value: "Europe/London",       label: "(GMT+00:00) Europe/London" },
  { value: "America/New_York",    label: "(GMT-05:00) America/New_York" },
  { value: "America/Los_Angeles", label: "(GMT-08:00) America/Los_Angeles" },
  { value: "Australia/Sydney",    label: "(GMT+11:00) Australia/Sydney" },
];

const DATE_FORMATS = [
  { value: "DD MMM YYYY", label: "DD MMM YYYY" },
  { value: "DD/MM/YYYY",  label: "DD/MM/YYYY" },
  { value: "MM/DD/YYYY",  label: "MM/DD/YYYY" },
  { value: "YYYY-MM-DD",  label: "YYYY-MM-DD" },
];

const ADMIN_ROLES = ["super_admin", "it_admin", "hr_admin"];

type TabId =
  | "general" | "notifications" | "security" | "integrations"
  | "users" | "automation" | "audit";

const TABS: { id: TabId; label: string; icon: typeof Monitor }[] = [
  { id: "general",       label: "General",       icon: Monitor },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security",      label: "Security",      icon: Shield },
  { id: "integrations",  label: "Integrations",  icon: Plug },
  { id: "users",         label: "Users & Roles", icon: Users },
  { id: "automation",    label: "Automation",    icon: Workflow },
  { id: "audit",         label: "Audit Logs",    icon: ScrollText },
];

export default function Settings() {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === "super_admin";

  const [activeTab, setActiveTab] = useState<TabId>("general");

  const [emailNotifications, setEmailNotifications] = useState(DEFAULTS.email_notifications);
  const [ticketAssignment,   setTicketAssignment]   = useState(DEFAULTS.ticket_assignment);
  const [statusUpdates,      setStatusUpdates]      = useState(DEFAULTS.status_updates);
  const [warrantyAlerts,     setWarrantyAlerts]     = useState(DEFAULTS.warranty_alerts);
  const [twoFactor,          setTwoFactor]          = useState(DEFAULTS.two_factor);
  const [sessionTimeout,     setSessionTimeout]     = useState(String(DEFAULTS.session_timeout));
  const [orgName,            setOrgName]            = useState(DEFAULTS.org_name);
  const [supportEmail,       setSupportEmail]       = useState(DEFAULTS.support_email);
  const [timezone,           setTimezone]           = useState(DEFAULTS.timezone);
  const [dateFormat,         setDateFormat]         = useState(DEFAULTS.date_format);
  const [activePoll,         setActivePoll]         = useState(String(DEFAULTS.agent_active_poll_sec));
  const [idlePoll,           setIdlePoll]           = useState(String(DEFAULTS.agent_idle_poll_sec));

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [saving,  setSaving]  = useState(false);

  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [adminUsers, setAdminUsers] = useState<number | null>(null);

  const applyRow = (row: OrgSettings) => {
    setOrgName(row.org_name);
    setSupportEmail(row.support_email);
    setEmailNotifications(row.email_notifications);
    setTicketAssignment(row.ticket_assignment);
    setStatusUpdates(row.status_updates);
    setWarrantyAlerts(row.warranty_alerts);
    setTwoFactor(row.two_factor);
    setSessionTimeout(String(row.session_timeout));
    setTimezone(row.timezone ?? DEFAULTS.timezone);
    setDateFormat(row.date_format ?? DEFAULTS.date_format);
    setActivePoll(String(row.agent_active_poll_sec ?? DEFAULTS.agent_active_poll_sec));
    setIdlePoll(String(row.agent_idle_poll_sec ?? DEFAULTS.agent_idle_poll_sec));
  };

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("org_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (fetchError) {
      setError(fetchError.message);
    } else if (data) {
      setError(null);
      applyRow(data as OrgSettings);
    }
    setLoading(false);
  }, []);

  const loadCounts = useCallback(async () => {
    if (!supabaseConfigured) return;
    const total = await supabase.from("profiles").select("id", { count: "exact", head: true });
    if (!total.error) setTotalUsers(total.count ?? 0);
    const admins = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .in("role", ADMIN_ROLES);
    if (!admins.error) setAdminUsers(admins.count ?? 0);
  }, []);

  useEffect(() => { load(); loadCounts(); }, [load, loadCounts]);

  const handleSave = async () => {
    if (!isSuperAdmin || saving) return;
    const timeoutNum = parseInt(sessionTimeout, 10);
    if (isNaN(timeoutNum) || timeoutNum < 5 || timeoutNum > 480) {
      toast({ title: "Invalid session timeout", description: "Enter a value between 5 and 480 minutes.", variant: "destructive" });
      return;
    }
    const activeNum = parseInt(activePoll, 10);
    const idleNum   = parseInt(idlePoll, 10);
    if (isNaN(activeNum) || activeNum < 2 || activeNum > 3600) {
      toast({ title: "Invalid active poll interval", description: "Enter a value between 2 and 3600 seconds.", variant: "destructive" });
      return;
    }
    if (isNaN(idleNum) || idleNum < 2 || idleNum > 3600) {
      toast({ title: "Invalid idle poll interval", description: "Enter a value between 2 and 3600 seconds.", variant: "destructive" });
      return;
    }
    if (idleNum < activeNum) {
      toast({ title: "Invalid poll intervals", description: "Idle interval must be greater than or equal to the active interval.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error: saveError } = await supabase.rpc("save_org_settings", {
      p_org_name:            orgName,
      p_support_email:       supportEmail,
      p_email_notifications: emailNotifications,
      p_ticket_assignment:   ticketAssignment,
      p_status_updates:      statusUpdates,
      p_warranty_alerts:     warrantyAlerts,
      p_two_factor:          twoFactor,
      p_session_timeout:     timeoutNum,
      p_timezone:            timezone,
      p_date_format:         dateFormat,
      p_agent_active_poll_sec: activeNum,
      p_agent_idle_poll_sec:   idleNum,
    });
    setSaving(false);
    if (saveError) {
      toast({ title: "Failed to save settings", description: saveError.message, variant: "destructive" });
      return;
    }
    if (data) applyRow(data as OrgSettings);
    toast({ title: "Settings saved", description: "Your changes have been saved and will persist across refreshes." });
  };

  const disabled = !isSuperAdmin || loading || saving;

  const NOTIFICATIONS = [
    { id: "email-notifications", label: "Email Notifications",      description: "Receive email alerts for important events",       value: emailNotifications, onChange: setEmailNotifications },
    { id: "ticket-assignment",  label: "Ticket Assignment Alerts", description: "Notify agents when a ticket is assigned to them", value: ticketAssignment,   onChange: setTicketAssignment },
    { id: "status-updates",     label: "Ticket Status Updates",    description: "Notify users when their ticket status changes",   value: statusUpdates,      onChange: setStatusUpdates },
    { id: "warranty-alerts",    label: "Warranty Expiry Alerts",   description: "Alert 30 days before asset warranty expires",     value: warrantyAlerts,     onChange: setWarrantyAlerts },
  ];

  const notificationToggles = (
    <div className="space-y-4">
      {NOTIFICATIONS.map(setting => (
        <div key={setting.id} className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor={setting.id} className="text-sm font-medium cursor-pointer">{setting.label}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">{setting.description}</p>
          </div>
          <Switch id={setting.id} checked={setting.value} onCheckedChange={setting.onChange} disabled={disabled} data-testid={`switch-${setting.id}`} />
        </div>
      ))}
    </div>
  );

  const securityFields = (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="two-factor" className="text-sm font-medium cursor-pointer">Two-Factor Authentication</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Require 2FA for all admin accounts <span className="italic">(preference stored; enforcement not yet enabled)</span></p>
        </div>
        <Switch id="two-factor" checked={twoFactor} onCheckedChange={setTwoFactor} disabled={disabled} data-testid="switch-two-factor" />
      </div>
      <Separator />
      <div className="space-y-1.5">
        <Label htmlFor="session-timeout">Session Timeout (minutes)</Label>
        <Input id="session-timeout" type="number" value={sessionTimeout} onChange={e => setSessionTimeout(e.target.value)} disabled={disabled} className="w-32" min="5" max="480" data-testid="input-session-timeout" />
        <p className="text-xs text-muted-foreground">Stored preference (5–480 min). Active enforcement not yet wired.</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground leading-tight">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure and manage your IT Asset Hub</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" onClick={() => void load()} disabled={disabled} data-testid="button-cancel-settings">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={disabled} data-testid="button-save-settings">
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : "Save All Changes"}
          </Button>
        </div>
      </div>

      {error && !loading && <LoadErrorBanner message={error} onRetry={load} busy={loading} />}

      {!isSuperAdmin && !loading && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="banner-readonly">
          You can view these settings, but only a Super Admin can change them.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Vertical tab nav */}
        <nav className="rounded-2xl border border-card-border/70 bg-card/85 backdrop-blur-md shadow-[0_2px_8px_-2px_rgba(30,58,138,0.10),0_14px_36px_-18px_rgba(30,58,138,0.20)] p-2 h-fit lg:sticky lg:top-4">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                data-testid={`tab-${tab.id}`}
                className={cn(
                  "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors text-left",
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Tab content */}
        <div className="min-w-0">
          {activeTab === "general" && (
            <div className="grid gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-5">
                <SettingsCard icon={Monitor} title="General Settings" description="Basic application preferences">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="org-name">Organization Name</Label>
                      <Input id="org-name" value={orgName} onChange={e => setOrgName(e.target.value)} disabled={disabled} data-testid="input-org-name" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="support-email">IT Support Email</Label>
                      <Input id="support-email" type="email" value={supportEmail} onChange={e => setSupportEmail(e.target.value)} disabled={disabled} data-testid="input-support-email" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="timezone">Timezone</Label>
                        <Select value={timezone} onValueChange={setTimezone} disabled={disabled}>
                          <SelectTrigger id="timezone" data-testid="select-timezone"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {TIMEZONES.map(tz => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="date-format">Date Format</Label>
                        <Select value={dateFormat} onValueChange={setDateFormat} disabled={disabled}>
                          <SelectTrigger id="date-format" data-testid="select-date-format"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DATE_FORMATS.map(df => <SelectItem key={df.value} value={df.value}>{df.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </SettingsCard>

                <SettingsCard icon={Monitor} title="Device Agent Polling" description="How often installed agents check in for commands. Changes apply to every agent automatically on its next check-in — no reinstall or restart needed.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="active-poll">Active Interval (seconds)</Label>
                      <Input id="active-poll" type="number" value={activePoll} onChange={e => setActivePoll(e.target.value)} disabled={disabled} className="w-32" min="2" max="3600" data-testid="input-active-poll" />
                      <p className="text-xs text-muted-foreground">Fast cadence while commands are flowing. Default 5s.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="idle-poll">Idle Interval (seconds)</Label>
                      <Input id="idle-poll" type="number" value={idlePoll} onChange={e => setIdlePoll(e.target.value)} disabled={disabled} className="w-32" min="2" max="3600" data-testid="input-idle-poll" />
                      <p className="text-xs text-muted-foreground">Slow cadence when idle. Default 30s. Must be ≥ active.</p>
                    </div>
                  </div>
                </SettingsCard>

                <SettingsCard icon={Bell} title="Notifications" description="Control what alerts and emails you receive">
                  {notificationToggles}
                </SettingsCard>
              </div>

              <div className="space-y-5">
                <SettingsCard icon={ShieldCheck} title="Security Snapshot" description="Current protection status">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">2FA Status</span>
                      <Badge variant={twoFactor ? "default" : "secondary"} className={twoFactor ? "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15" : ""} data-testid="badge-2fa-status">
                        {twoFactor ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Session Timeout</span>
                      <span className="text-sm font-semibold text-foreground">{sessionTimeout} minutes</span>
                    </div>
                    <Button variant="outline" className="w-full" onClick={() => setActiveTab("security")} data-testid="button-manage-security">
                      Manage Security <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </SettingsCard>

                <SettingsCard icon={Users} title="Users & Roles" description="Directory overview">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Total Users</span>
                      <span className="text-2xl font-bold text-foreground" data-testid="text-total-users">{totalUsers ?? "—"}</span>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Admin Users</span>
                      <span className="text-2xl font-bold text-foreground" data-testid="text-admin-users">{adminUsers ?? "—"}</span>
                    </div>
                    <Link href="/users">
                      <Button variant="outline" className="w-full" data-testid="button-manage-users">
                        Manage Users &amp; Roles <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    </Link>
                  </div>
                </SettingsCard>
              </div>
            </div>
          )}

          {activeTab === "notifications" && (
            <SettingsCard icon={Bell} title="Notifications" description="Control what alerts and emails you receive">
              {notificationToggles}
            </SettingsCard>
          )}

          {activeTab === "security" && (
            <SettingsCard icon={Shield} title="Security" description="Authentication and access control">
              {securityFields}
            </SettingsCard>
          )}

          {activeTab === "integrations" && (
            <Link href="/settings/integrations" data-testid="link-integrations">
              <div className="group rounded-2xl border border-card-border/70 bg-card/85 backdrop-blur-md shadow-[0_2px_8px_-2px_rgba(30,58,138,0.10),0_14px_36px_-18px_rgba(30,58,138,0.20)] transition-shadow hover:shadow-[0_6px_18px_-4px_rgba(30,58,138,0.18),0_18px_44px_-18px_rgba(30,58,138,0.28)] cursor-pointer px-5 py-4 sm:px-6 flex items-center gap-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Plug className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-foreground">HR Portal Integrations</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Connect Zoho People &amp; Keka to sync your user directory, field mappings, sync logs &amp; automation rules
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          )}

          {activeTab === "users" && (
            <SettingsCard icon={Users} title="Users & Roles" description="Directory overview and management">
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-card-border/70 bg-muted/30 px-5 py-4">
                    <p className="text-sm text-muted-foreground">Total Users</p>
                    <p className="text-3xl font-bold text-foreground mt-1" data-testid="text-total-users-tab">{totalUsers ?? "—"}</p>
                  </div>
                  <div className="rounded-xl border border-card-border/70 bg-muted/30 px-5 py-4">
                    <p className="text-sm text-muted-foreground">Admin Users</p>
                    <p className="text-3xl font-bold text-foreground mt-1" data-testid="text-admin-users-tab">{adminUsers ?? "—"}</p>
                  </div>
                </div>
                <Link href="/users">
                  <Button variant="outline" data-testid="button-manage-users-tab">
                    Manage Users &amp; Roles <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </div>
            </SettingsCard>
          )}

          {activeTab === "automation" && <AutomationRules />}

          {activeTab === "audit" && <AuditLogs />}
        </div>
      </div>
    </div>
  );
}
