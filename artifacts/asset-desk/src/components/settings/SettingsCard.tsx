import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingsCardProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  iconClassName?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * Clean premium settings card — icon badge + bold title + helper text header,
 * matching the Settings reference design. Used across the Integrations tab.
 */
export function SettingsCard({
  icon: Icon,
  title,
  description,
  action,
  iconClassName,
  className,
  bodyClassName,
  children,
}: SettingsCardProps) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-card-border/70 bg-card/85 backdrop-blur-md text-card-foreground shadow-[0_2px_8px_-2px_rgba(30,58,138,0.10),0_14px_36px_-18px_rgba(30,58,138,0.20)]",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn("h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0", iconClassName)}>
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground leading-tight">{title}</h2>
            {description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>}
          </div>
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </header>
      <div className={cn("px-5 pb-5 sm:px-6 sm:pb-6", bodyClassName)}>{children}</div>
    </section>
  );
}
