import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Bell, Shield, Database, Monitor, Mail } from "lucide-react";

export default function Settings() {
  const { toast } = useToast();

  const [emailNotifications, setEmailNotifications] = useState(true);
  const [ticketAssignment, setTicketAssignment] = useState(true);
  const [statusUpdates, setStatusUpdates] = useState(true);
  const [warrantyAlerts, setWarrantyAlerts] = useState(true);
  const [twoFactor, setTwoFactor] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState("30");
  const [orgName, setOrgName] = useState("Asset Desk Demo");
  const [supportEmail, setSupportEmail] = useState("it-support@assetdesk.demo");

  const handleSave = () => {
    toast({ title: "Settings saved", description: "Your configuration has been updated." });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configure application preferences</p>
      </div>

      {/* General */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Monitor className="h-4 w-4" /> General
          </CardTitle>
          <CardDescription className="text-xs">Basic application settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Organization Name</Label>
            <Input
              id="org-name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              data-testid="input-org-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="support-email">IT Support Email</Label>
            <Input
              id="support-email"
              type="email"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              data-testid="input-support-email"
            />
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Bell className="h-4 w-4" /> Notifications
          </CardTitle>
          <CardDescription className="text-xs">Control what alerts and emails you receive</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { id: "email-notifications", label: "Email Notifications", description: "Receive email alerts for important events", value: emailNotifications, onChange: setEmailNotifications },
            { id: "ticket-assignment", label: "Ticket Assignment Alerts", description: "Notify agents when a ticket is assigned to them", value: ticketAssignment, onChange: setTicketAssignment },
            { id: "status-updates", label: "Ticket Status Updates", description: "Notify users when their ticket status changes", value: statusUpdates, onChange: setStatusUpdates },
            { id: "warranty-alerts", label: "Warranty Expiry Alerts", description: "Alert 30 days before asset warranty expires", value: warrantyAlerts, onChange: setWarrantyAlerts },
          ].map((setting) => (
            <div key={setting.id} className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor={setting.id} className="text-sm font-medium cursor-pointer">{setting.label}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{setting.description}</p>
              </div>
              <Switch
                id={setting.id}
                checked={setting.value}
                onCheckedChange={setting.onChange}
                data-testid={`switch-${setting.id}`}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4" /> Security
          </CardTitle>
          <CardDescription className="text-xs">Authentication and access control</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="two-factor" className="text-sm font-medium cursor-pointer">Two-Factor Authentication</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Require 2FA for all admin accounts</p>
            </div>
            <Switch
              id="two-factor"
              checked={twoFactor}
              onCheckedChange={setTwoFactor}
              data-testid="switch-two-factor"
            />
          </div>
          <Separator />
          <div className="space-y-1.5">
            <Label htmlFor="session-timeout">Session Timeout (minutes)</Label>
            <Input
              id="session-timeout"
              type="number"
              value={sessionTimeout}
              onChange={(e) => setSessionTimeout(e.target.value)}
              className="w-32"
              min="5"
              max="480"
              data-testid="input-session-timeout"
            />
            <p className="text-xs text-muted-foreground">Users will be logged out after this period of inactivity</p>
          </div>
        </CardContent>
      </Card>

      {/* Data */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Database className="h-4 w-4" /> Data Management
          </CardTitle>
          <CardDescription className="text-xs">Backup and export options</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: "Export Assets (CSV)", description: "Download all asset records" },
            { label: "Export Tickets (CSV)", description: "Download all ticket records" },
            { label: "Export Users (CSV)", description: "Download all user records" },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toast({ title: "Export started", description: `${item.label} export is being prepared.` })}
                data-testid={`button-export-${item.label.split(" ")[1].toLowerCase()}`}
              >
                Export
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} data-testid="button-save-settings">
          Save Settings
        </Button>
      </div>
    </div>
  );
}
