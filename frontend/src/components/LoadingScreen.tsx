import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { BrandPill } from "@/components/BrandPill";
import { cn } from "@/lib/utils";

/**
 * Full-viewport loading screen shared by every "waiting to enter a table"
 * surface (web lobby, Discord Activity entry, the game's board-entry gate), so
 * they read as one continuous wait.
 *
 * A panel (one piece) with the wordmark pill and an indeterminate bar, announced
 * via role=status / aria-busy.
 *
 * `children` sits between the wordmark and the message (the game entry puts
 * the seat roster there). `actions` replaces the slider once a wait has failed,
 * and the card stops reporting itself as busy.
 */
export function LoadingScreen({
  message,
  children,
  actions,
  className,
}: {
  /** Defaults to "Loading table…", resolved in the player's language below. */
  message?: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** Extra classes for the card (e.g. a wider box when `children` need room). */
  className?: string;
}) {
  const { t } = useLingui();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={!actions}
      className="min-h-full bg-background text-on-background flex items-center justify-center p-6"
    >
      <div
        data-pb-panel=""
        className={cn(
          // The region's one piece (pb-site.css draws the keyline and edge).
          "w-[min(88vw,400px)] rounded-card-lg border-2 border-transparent bg-secondary-background p-8 text-center",
          className,
        )}
      >
        <div className="flex justify-center">
          <BrandPill className="bg-elev2 text-foreground border-2 border-transparent rounded-full px-4 py-1.5 text-[16px] tracking-[1px]" />
        </div>
        {children && <div className="mt-6">{children}</div>}
        <div className="mt-4 mb-6 text-[14px] font-bold text-muted">
          {message ?? t`Loading table…`}
        </div>
        {actions ?? (
          // Indeterminate bar: one green fill whose width animates between a
          // sliver and full (see index.css) in a flat well. No thumb, so it
          // never reads as a slider.
          <div className="relative h-3 w-full rounded-full border-2 border-transparent bg-elev2 overflow-hidden">
            <div className="animate-loading-shuttle absolute inset-y-0 left-0 rounded-full bg-btn-primary" />
          </div>
        )}
      </div>
    </div>
  );
}
