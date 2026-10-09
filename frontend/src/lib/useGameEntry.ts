// The game screen's entry gate, wired to the real signals. The policy lives in
// gameEntry.ts, pure and tested against a fake clock; this part touches
// promises and timers.
import * as React from "react";
import { preloadBoardModels } from "@/lib/board3d/loader";
import { ensureShots } from "@/lib/board3d/shotCache";
import { SHOP_SET, ICON_SET } from "@/lib/board3d/shotSets";
import { supportsWebGL } from "@/lib/board3d/webgl";
import { canEnterGame, nextEntryCheckMs } from "@/lib/gameEntry";

/**
 * Whether the game screen may be shown yet, and what it is still waiting for.
 *
 * The clock starts when this hook mounts, i.e. whenever a player enters the
 * game (fresh start, refresh, reconnect, direct link, or spectating).
 *
 * A client with no WebGL has no assets to wait for, so they are ready at once
 * and its caller reports `boardReady` too.
 */
export function useGameEntry(opts: {
  viewReady: boolean;
  /** The board has drawn a frame, or there is no board to draw. */
  boardReady: boolean;
  ruleset: string | undefined;
  ownColor: string | null | undefined;
  seatColors: string[];
}): { ready: boolean; assetsReady: boolean } {
  const { viewReady, boardReady, ruleset, ownColor } = opts;
  // Joined so the effect keys on the set of colours, not a new array each
  // render (as usePieceIcons does).
  const seatKey = React.useMemo(
    () =>
      Array.from(new Set(opts.seatColors.filter(Boolean)))
        .sort()
        .join("|"),
    [opts.seatColors],
  );

  const startedAt = React.useRef<number>(0);
  startedAt.current ||= Date.now();

  const [assetsReady, setAssetsReady] = React.useState(() => !supportsWebGL());
  const [, tick] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    if (!supportsWebGL()) return;
    let alive = true;
    // Cleared on every re-run because the inputs arrive late: on a cold entry
    // (refresh, direct link, Discord Activity) `ruleset` is undefined and
    // `seatColors` empty on first render, so the promises below would resolve
    // at once with nothing loaded. When the real inputs land, the flag goes
    // back to false until the real work finishes.
    setAssetsReady(false);
    const colors = seatKey ? seatKey.split("|") : [];
    // Everything the first frame wants, in parallel. Each is a no-op if the
    // lobby already warmed it, the common case, leaving only the dwell floor.
    void Promise.allSettled([
      ruleset ? preloadBoardModels(ruleset) : Promise.resolve(),
      colors.length ? ensureShots(ICON_SET, colors) : Promise.resolve(),
      ownColor ? ensureShots(SHOP_SET, [ownColor]) : Promise.resolve(),
    ]).then(() => {
      if (alive) setAssetsReady(true);
    });
    return () => {
      alive = false;
    };
  }, [ruleset, ownColor, seatKey]);

  const state = {
    viewReady,
    assetsReady,
    boardReady,
    elapsedMs: Date.now() - startedAt.current,
  };
  const ready = canEnterGame(state);

  // One timer aimed at the next deadline (the dwell floor or the ceiling),
  // re-armed on every render while the gate is closed.
  React.useEffect(() => {
    if (ready) return;
    const wait = nextEntryCheckMs({
      viewReady,
      assetsReady,
      boardReady,
      elapsedMs: Date.now() - startedAt.current,
    });
    if (wait == null) return;
    const t = setTimeout(tick, wait);
    return () => clearTimeout(t);
  }, [ready, viewReady, assetsReady, boardReady]);

  return { ready, assetsReady };
}
