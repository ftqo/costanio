import * as React from "react";
import { createPortal } from "react-dom";
import { Trans } from "@lingui/react/macro";
import { useGameSocket, shallowEqual } from "@/lib/ws";
import { Spinner } from "@/components/ui/spinner";

// How long the session socket must stay down before the banner shows. A normal
// deploy blip reconnects well within this, so usually nothing is shown.
export const SHOW_AFTER_MS = 1500;

/** A subtle, delayed banner for the session socket. Global: it covers the
 * lobby, waiting room, and live game alike. It stays silent for an intentional
 * teardown (logout), since once `wantOpen` is false the socket isn't trying to
 * reconnect at all, so the login page must say nothing.
 *
 * A slow first connect is shown only at a table (`gameId` set): the lobby
 * renders from HTTP while the `started` frame that moves everyone into the game
 * arrives over the socket. It says "connecting", not "reconnecting". */
export function ConnectionIndicator() {
  // Only the connection's fields, so game frames do not re-render the banner.
  const { status, wantOpen, gameId, everOpen, sessionGone } = useGameSocket(
    (s) => ({
      status: s.status,
      wantOpen: s.wantOpen,
      gameId: s.gameId,
      // Latched by the socket on the transition, not from a render: the store
      // coalesces notifications per frame, so an open-then-close within one
      // frame never renders as "open".
      everOpen: s.everOpen,
      sessionGone: s.sessionGone,
    }),
    shallowEqual,
  );
  const [visible, setVisible] = React.useState(false);

  // At a table, a first connect counts. An expired session stops retrying (see
  // markSessionGone) and heads to sign-in, so it shows nothing.
  const speaks = (everOpen || gameId !== null) && !sessionGone;

  React.useEffect(() => {
    if (status !== "open" && wantOpen && speaks) {
      const t = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [status, wantOpen, speaks]);

  if (!visible || typeof document === "undefined") return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      // Sized by its text, capped at the viewport less 16px a side so long
      // translations wrap instead of bleeding off a phone screen. `min-w-0` on
      // the text lets the flex item shrink below its longest word run.
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[110] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-[14px] border-2 border-border bg-secondary-background px-4 py-2.5 shadow-hard text-[13px] font-extrabold text-foreground pointer-events-none"
    >
      <Spinner size={16} />
      <span className="min-w-0 text-balance">
        {everOpen ? <Trans>Reconnecting…</Trans> : <Trans>Connecting to the table…</Trans>}
      </span>
    </div>,
    document.body,
  );
}
