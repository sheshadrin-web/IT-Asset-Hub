import { Link } from "wouter";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import HrPortals from "@/components/settings/integrations/HrPortals";
import FieldMapping from "@/components/settings/integrations/FieldMapping";
import SyncLogs from "@/components/settings/integrations/SyncLogs";
import { ChevronLeft, Plug, Info } from "lucide-react";

type TabKey = "portals" | "mapping" | "logs";

export default function Integrations() {
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === "super_admin";
  const [tab, setTab] = useState<TabKey>("portals");

  if (!isSuperAdmin) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Back to Settings
        </Link>
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="banner-integrations-forbidden">
          Only a Super Admin can configure HR integrations.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="space-y-2">
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-settings">
          <ChevronLeft className="h-4 w-4" /> Back to Settings
        </Link>
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Integrations</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Connect HR portals to keep your user directory in sync and recover assets automatically when employees leave.
        </p>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 flex items-start gap-3" data-testid="banner-integrations-info">
        <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-blue-800">
          Connect a portal, then run a sync to pull employees. New and updated employees are written straight to your
          Users directory, and employees marked as exited are deactivated with their assigned assets moved into Recovery
          Mode automatically. The current build ships with a demo employee feed so you can see the full flow; live
          Zoho People / Keka API calls activate once real API credentials are validated.
        </p>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as TabKey)}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="portals" data-testid="tab-portals">HR Portals</TabsTrigger>
          <TabsTrigger value="mapping" data-testid="tab-mapping">Field Mapping</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">Sync Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="portals" className="mt-4">
          <HrPortals onViewLogs={() => setTab("logs")} />
        </TabsContent>
        <TabsContent value="mapping" className="mt-4">
          <FieldMapping />
        </TabsContent>
        <TabsContent value="logs" className="mt-4">
          <SyncLogs />
        </TabsContent>
      </Tabs>
    </div>
  );
}
