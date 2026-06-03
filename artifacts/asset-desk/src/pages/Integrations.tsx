import { Link } from "wouter";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import HrPortals from "@/components/settings/integrations/HrPortals";
import FieldMapping from "@/components/settings/integrations/FieldMapping";
import SyncLogs from "@/components/settings/integrations/SyncLogs";
import AutomationRules from "@/components/settings/integrations/AutomationRules";
import { ChevronLeft, Plug } from "lucide-react";

type TabKey = "portals" | "mapping" | "automation" | "logs";

const TABS: { key: TabKey; label: string }[] = [
  { key: "portals", label: "HR Portals" },
  { key: "mapping", label: "Field Mapping" },
  { key: "automation", label: "Automation" },
  { key: "logs", label: "Sync Logs" },
];

const TAB_TRIGGER =
  "relative rounded-none border-b-2 border-transparent bg-transparent px-1 pb-3 pt-0 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent";

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
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="banner-integrations-forbidden">
          Only a Super Admin can configure HR integrations.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="space-y-3">
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-settings">
          <ChevronLeft className="h-4 w-4" /> Back to Settings
        </Link>
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Plug className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground leading-tight">Integrations</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Connect HR portals to keep your user directory in sync and recover assets automatically when employees leave.
            </p>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as TabKey)}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-6 rounded-none border-b border-border bg-transparent p-0">
          {TABS.map(t => (
            <TabsTrigger key={t.key} value={t.key} className={TAB_TRIGGER} data-testid={`tab-${t.key}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="portals" className="mt-6">
          <HrPortals onViewLogs={() => setTab("logs")} />
        </TabsContent>
        <TabsContent value="mapping" className="mt-6">
          <FieldMapping />
        </TabsContent>
        <TabsContent value="automation" className="mt-6">
          <AutomationRules />
        </TabsContent>
        <TabsContent value="logs" className="mt-6">
          <SyncLogs />
        </TabsContent>
      </Tabs>
    </div>
  );
}
