import * as React from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { HexCluster } from "@/components/board/HexCluster";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { modeClassic } from "@/lib/board";
import type { FullView } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * What the dock says under "Your game": whether the table is waiting on you.
 *
 * The turn clock runs while the player is elsewhere on the site, so the dock
 * names whose turn it is, falling back to "Still in progress" when it cannot
 * tell.
 */
export function dockStatus(
  view: Pick<FullView, "viewer" | "cur" | "phase" | "seat_names" | "pending_discards"> | undefined,
): { kind: "yours" | "discard" | "theirs"; name?: string } | null {
  if (!view || view.phase === "finished" || view.viewer < 0) return null;
  if ((view.pending_discards?.[view.viewer] ?? 0) > 0) return { kind: "discard" };
  if (view.cur === view.viewer) return { kind: "yours" };
  const name = view.seat_names?.[view.cur];
  return name ? { kind: "theirs", name } : null;
}

/** How often the dock re-reads the table while you are away from it. */
const DOCK_POLL_MS = 20_000;

/** Floating "return to game" dock for a game you're already seated in. */
export function GameDock({
  variant = "loud",
  title,
  subtitle,
  gameId,
}: {
  variant?: "loud" | "quiet";
  /** Defaults to "Your game", resolved in the player's language below. */
  title?: string;
  /** Defaults to "Still in progress", likewise. */
  subtitle?: string;
  gameId?: string;
}) {
  const { t } = useLingui();
  const loud = variant === "loud";
  // The table's live state via GET /api/games/:id, with a cursor past the end
  // so no log comes back. Best-effort; a failure keeps the default caption.
  const [status, setStatus] = React.useState<ReturnType<typeof dockStatus>>(null);
  React.useEffect(() => {
    if (!gameId || subtitle) return;
    let live = true;
    const read = () => {
      void api
        .getGame(gameId, Number.MAX_SAFE_INTEGER)
        .then((d) => live && setStatus(dockStatus(d.view)))
        .catch(() => live && setStatus(null));
    };
    read();
    const id = setInterval(read, DOCK_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [gameId, subtitle]);
  const curName = status?.name ?? "";
  // A state that asks something of you. Loud docks only: a quiet dock never
  // shouts.
  const urgent = loud && !subtitle && (status?.kind === "yours" || status?.kind === "discard");
  const caption =
    subtitle ??
    (status?.kind === "yours"
      ? t`It's your turn`
      : status?.kind === "discard"
        ? t`You have cards to discard`
        : status?.kind === "theirs"
          ? t`${curName}'s turn`
          : t`Still in progress`);
  // The dock floats over the bottom-right of the page. While it is up,
  // `--game-dock-h` tells the footer to leave room for it (see SiteFooter).
  const box = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    const set = () =>
      root.style.setProperty("--game-dock-h", `${(box.current?.offsetHeight ?? 0) + 32}px`);
    set();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(set) : null;
    if (box.current) ro?.observe(box.current);
    return () => {
      ro?.disconnect();
      root.style.removeProperty("--game-dock-h");
    };
  }, []);
  return (
    <div
      ref={box}
      // Pinned bottom-right, it grows leftward, so cap it at the viewport less
      // the two 24px margins. The text column takes `min-w-0` and wraps, so
      // long translations grow the dock downward instead of off screen.
      data-urgent={urgent ? "true" : undefined}
      className={cn(
        // A piece floating over the page. The loud variant carries the green
        // Rejoin; a turn that waits on you (yours, or cards to discard) fills
        // the dock with the selected yellow, so it reads from across the page.
        "fixed z-40 right-6 bottom-6 max-w-[calc(100vw-3rem)] border border-rim rounded-card shadow-hard px-3.5 py-2.5 flex items-center gap-3",
        urgent ? "bg-selected text-selected-ink" : "bg-secondary-background",
      )}
    >
      <div className="w-[46px] h-11 shrink-0 overflow-hidden">
        <HexCluster cells={modeClassic} hexW={31} hexH={36} boxW={102} boxH={97} scale={0.45} />
      </div>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold">{title ?? t`Your game`}</div>
        <div
          className={cn(
            "text-[12px]",
            // Your move is the one caption that asks something of you.
            urgent ? "font-bold text-selected-ink" : "text-muted",
          )}
        >
          {/* A caption, not an instruction: the button beside it is the verb. */}
          {caption}
        </div>
      </div>
      {/* `wrap`: the dock has a width cap and "Rejoin" is long in some
          languages (German "Platz zurücknehmen"). */}
      <Button asChild variant={loud ? "primary" : "secondary"} size="sm" wrap>
        <Link to="/game" search={{ g: gameId }}>
          <Trans>Rejoin</Trans>
        </Link>
      </Button>
    </div>
  );
}
