import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { useToast } from "@/hooks/use-toast";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { LoadErrorBanner } from "@/components/LoadErrorBanner";
import { Bell, Shield, Monitor, Loader2, Plug, ChevronRight, Lightbulb } from "lucide-react";

interface OrgSettings {
  org_name:            string;
  support_email:       string;
  email_notifications: boolean;
  ticket_assignment:   boolean;
  status_updates:      boolean;
  warranty_alerts:     boolean;
  two_factor:          boolean;
  session_timeout:     number;
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
};

export default function Settings() {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === "super_admin";

  const [emailNotifications, setEmailNotifications] = useState(DEFAULTS.email_notifications);
  const [ticketAssignment,   setTicketAssignment]   = useState(DEFAULTS.ticket_assignment);
  const [statusUpdates,      setStatusUpdates]      = useState(DEFAULTS.status_updates);
  const [warrantyAlerts,     setWarrantyAlerts]     = useState(DEFAULTS.warranty_alerts);
  const [twoFactor,          setTwoFactor]          = useState(DEFAULTS.two_factor);
  const [sessionTimeout,     setSessionTimeout]     = useState(String(DEFAULTS.session_timeout));
  const [orgName,            setOrgName]            = useState(DEFAULTS.org_name);
  const [supportEmail,       setSupportEmail]       = useState(DEFAULTS.support_email);

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [saving,  setSaving]  = useState(false);

  const applyRow = (row: OrgSettings) => {
    setOrgName(row.org_name);
    setSupportEmail(row.support_email);
    setEmailNotifications(row.email_notifications);
    setTicketAssignment(row.ticket_assignment);
    setStatusUpdates(row.status_updates);
    setWarrantyAlerts(row.warranty_alerts);
    setTwoFactor(row.two_factor);
    setSessionTimeout(String(row.session_timeout));
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

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!isSuperAdmin || saving) return;
    const timeoutNum = parseInt(sessionTimeout, 10);
    if (isNaN(timeoutNum) || timeoutNum < 5 || timeoutNum > 480) {
      toast({ title: "Invalid session timeout", description: "Enter a value between 5 and 480 minutes.", variant: "destructive" });
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

  return (
    <div className="space-y-6 max-w-6xl">
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
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : "Save Changes"}
          </Button>
        </div>
      </div>

      {error && !loading && <LoadErrorBanner message={error} onRetry={load} busy={loading} />}

      {!isSuperAdmin && !loading && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="banner-readonly">
          You can view these settings, but only a Super Admin can change them.
        </div>
      )}

      {/* Integrations entry point */}
      <Link href="/settings/integrations" data-testid="link-integrations">
        <div className="group rounded-2xl border border-card-border/70 bg-card/85 backdrop-blur-md shadow-[0_2px_8px_-2px_rgba(30,58,138,0.10),0_14px_36px_-18px_rgba(30,58,138,0.20)] transition-shadow hover:shadow-[0_6px_18px_-4px_rgba(30,58,138,0.18),0_18px_44px_-18px_rgba(30,58,138,0.28)] cursor-pointer px-5 py-4 sm:px-6 flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Plug className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-foreground">Integrations</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect HR portals (Zoho People, Keka) to sync your user directory &amp; automate asset recovery
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 transition-transform group-hover:translate-x-0.5" />
        </div>
      </Link>

      {/* Two-column premium grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <SettingsCard icon={Monitor} title="General" description="Basic application settings">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="org-name">Organization Name</Label>
                <Input id="org-name" value={orgName} onChange={e => setOrgName(e.target.value)} disabled={disabled} data-testid="input-org-name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="support-email">IT Support Email</Label>
                <Input id="support-email" type="email" value={supportEmail} onChange={e => setSupportEmail(e.target.value)} disabled={disabled} data-testid="input-support-email" />
              </div>
            </div>
          </SettingsCard>

          <SettingsCard icon={Shield} title="Security" description="Authentication and access control">
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
          </SettingsCard>
        </div>

        <div className="space-y-5">
          <SettingsCard icon={Bell} title="Notifications" description="Control what alerts and emails you receive">
            <div className="space-y-4">
              {[
                { id: "email-notifications", label: "Email Notifications",       description: "Receive email alerts for important events",             value: emailNotifications, onChange: setEmailNotifications },
                { id: "ticket-assignment",   label: "Ticket Assignment Alerts",  description: "Notify agents when a ticket is assigned to them",       value: ticketAssignment,   onChange: setTicketAssignment },
                { id: "status-updates",      label: "Ticket Status Updates",     description: "Notify users when their ticket status changes",         value: statusUpdates,      onChange: setStatusUpdates },
                { id: "warranty-alerts",     label: "Warranty Expiry Alerts",    description: "Alert 30 days before asset warranty expires",           value: warrantyAlerts,     onChange: setWarrantyAlerts },
              ].map(setting => (
                <div key={setting.id} className="flex items-center justify-between gap-4">
                  <div>
                    <Label htmlFor={setting.id} className="text-sm font-medium cursor-pointer">{setting.label}</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">{setting.description}</p>
                  </div>
                  <Switch id={setting.id} checked={setting.value} onCheckedChange={setting.onChange} disabled={disabled} data-testid={`switch-${setting.id}`} />
                </div>
              ))}
            </div>
          </SettingsCard>

          <SettingsCard icon={Lightbulb} title="Helpful Tip" iconClassName="bg-amber-500/10 [&>svg]:text-amber-500">
            <p className="text-sm text-muted-foreground leading-relaxed">
              These settings apply across the entire organization and help personalize your IT Asset Hub experience.
              Connect an HR portal under Integrations to keep your user directory and asset recovery fully automated.
            </p>
          </SettingsCard>
        </div>
      </div>
    </div>
  );
}
