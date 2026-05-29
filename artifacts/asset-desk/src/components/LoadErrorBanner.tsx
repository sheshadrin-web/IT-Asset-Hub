import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LoadErrorBannerProps {
  message: string;
  onRetry: () => void;
  busy?: boolean;
}

/**
 * Persistent, dismissable-by-retry banner shown when a data load fails.
 * Surfaces the real error instead of silently rendering an empty list.
 */
export function LoadErrorBanner({ message, onRetry, busy }: LoadErrorBannerProps) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
      role="alert"
      data-testid="banner-load-error"
    >
      <AlertTriangle className="h-5 w-5 flex-shrink-0 text-destructive mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-destructive">Couldn't load data</p>
        <p className="text-xs text-destructive/80 break-words">{message}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
        onClick={onRetry}
        disabled={busy}
        data-testid="button-retry-load"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Retry
      </Button>
    </div>
  );
}
