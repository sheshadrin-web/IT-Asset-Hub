import { SettingsCard } from "@/components/settings/SettingsCard";
import { cn } from "@/lib/utils";
import {
  UserPlus, RefreshCw, UserX, ShieldAlert, BellRing, Workflow, ArrowRight, type LucideIcon,
} from "lucide-react";

interface Rule {
  icon: LucideIcon;
  trigger: string;
  action: string;
  description: string;
  tone: string;
}

const RULES: Rule[] = [
  {
    icon: UserPlus,
    trigger: "HR employee added",
    action: "Create user in Users directory",
    description: "A new active user is created automatically using the details pulled from the HR portal.",
    tone: "bg-emerald-500/10 text-emerald-600",
  },
  {
    icon: RefreshCw,
    trigger: "HR employee updated",
    action: "Update the matched user",
    description: "Matched by employee ID first, then email — existing users are updated, never duplicated.",
    tone: "bg-blue-500/10 text-blue-600",
  },
  {
    icon: UserX,
    trigger: "HR employee exited",
    action: "Deactivate the user",
    description: "Resigned, terminated, relieved or LWD employees are set to inactive and lose access.",
    tone: "bg-amber-500/10 text-amber-600",
  },
  {
    icon: ShieldAlert,
    trigger: "HR employee exited",
    action: "Move assigned assets to Recovery Mode",
    description: "Every asset assigned to the exited employee is flagged for recovery automatically.",
    tone: "bg-rose-500/10 text-rose-600",
  },
  {
    icon: BellRing,
    trigger: "Recovery overdue",
    action: "Notify admin",
    description: "Assets that stay unrecovered past the threshold are surfaced for IT follow-up.",
    tone: "bg-violet-500/10 text-violet-600",
  },
];

export default function AutomationRules() {
  return (
    <SettingsCard
      icon={Workflow}
      title="HR Sync Automation Rules"
      description="These rules run automatically on every HR sync — keeping your Users directory and asset recovery in lockstep with the HR portal. There are no manual onboarding or offboarding queues."
    >
      <ul className="space-y-3" data-testid="list-automation-rules">
        {RULES.map((r, i) => (
          <li
            key={i}
            className="flex items-start gap-4 rounded-xl border border-card-border/70 bg-background/40 px-4 py-3.5"
            data-testid={`automation-rule-${i}`}
          >
            <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0", r.tone)}>
              <r.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-foreground">{r.trigger}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />
                <span className="text-sm font-medium text-foreground">{r.action}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{r.description}</p>
            </div>
            <span className="ml-auto self-center flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-500/10 rounded-full px-2 py-0.5">
              Automatic
            </span>
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
