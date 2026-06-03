import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import { LoadErrorBanner } from "@/components/LoadErrorBanner";
import { Bell, Shield, Monitor, Loader2, Plug, ChevronRight } from "lucide-react";

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
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configure application preferences</p>
      </div>

      {error && !loading && <LoadErrorBanner message={error} onRetry={load} busy={loading} />}

      {!isSuperAdmin && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="banner-readonly">
          You can view these settings, but only a Super Admin can change them.
        </div>
      )}

      <Link href="/settings/integrations" data-testid="link-integrations">
        <Card className="cursor-pointer transition-colors hover:bg-accent/40">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Plug className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Integrations</p>
              <p className="text-xs text-muted-foreground mt-0.5">Connect HR portals (Zoho People, Keka) to automate onboarding, offboarding &amp; asset recovery</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </CardContent>
        </Card>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2"><Monitor className="h-4 w-4" /> General</CardTitle>
          <CardDescription className="text-xs">Basic application settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Organization Name</Label>
            <Input id="org-name" value={orgName} onChange={e => setOrgName(e.target.value)} disabled={disabled} data-testid="input-org-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="support-email">IT Support Email</Label>
            <Input id="support-email" type="email" value={supportEmail} onChange={e => setSupportEmail(e.target.value)} disabled={disabled} data-testid="input-support-email" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2"><Bell className="h-4 w-4" /> Notifications</CardTitle>
          <CardDescription className="text-xs">Control what alerts and emails you receive</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2"><Shield className="h-4 w-4" /> Security</CardTitle>
          <CardDescription className="text-xs">Authentication and access control</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={disabled} data-testid="button-save-settings">
          {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
