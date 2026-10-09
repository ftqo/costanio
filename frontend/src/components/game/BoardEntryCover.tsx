import * as React from "react";
import { ENTRY_COVER_FADE_MS } from "@/lib/gameEntry";
import { cn } from "@/lib/utils";

/**
 * The loading cover over the board while it builds. It fills the game screen
 * at z-0, over the board and under the HUD (z-10), so the header, menus, chat and panels
 * work while the board loads. It swallows clicks meant for the board until it
 * starts to fade.
 *
 * When `ready` turns true it fades out (instantly with reduced motion) and
 * unmounts. While fading it is already inert and hidden from screen readers.
 */
export function BoardEntryCover({
  ready,
  reduced,
  children,
}: {
  ready: boolean;
  reduced: boolean;
  children: React.ReactNode;
}) {
  const [fadedOut, setFadedOut] = React.useState(false);
  React.useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setFadedOut(true), reduced ? 0 : ENTRY_COVER_FADE_MS);
    return () => clearTimeout(t);
  }, [ready, reduced]);
  if (ready && fadedOut) return null;
  return (
    <div
      data-board-cover=""
      className={cn(
        "absolute inset-0 z-0 bg-background transition-opacity duration-300 motion-reduce:transition-none",
        ready && "pointer-events-none opacity-0",
      )}
      aria-hidden={ready || undefined}
      inert={ready || undefined}
    >
      {children}
    </div>
  );
}
