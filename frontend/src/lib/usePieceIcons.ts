import * as React from "react";
import { pieceIconSlot } from "@/lib/board3d/pieceIconShots";
import { cachedShots, ensureShots, type ShotURLs } from "@/lib/board3d/shotCache";
import { ICON_SET } from "@/lib/board3d/shotSets";

/** Look up one piece in one seat's colour, or null if it isn't rendered. */
export type PieceIcons = (color: string | null | undefined, piece: string) => string | null;

/**
 * Board pieces as icons, in every seat colour asked for. Unlike
 * usePieceThumbnails (always your own colour), the log needs each line's
 * piece in its player's colour.
 *
 * All colours go in one call, so shotCache reads them from disk in parallel
 * and renders the rest in a single WebGL pass. An unresolved colour (or no
 * WebGL) is absent and the caller draws nothing in its place.
 */
export function usePieceIcons(colors: (string | null | undefined)[]): PieceIcons {
  // Sorted and joined so the effect re-runs when the set of colours changes,
  // not when a re-render produces the same colours in a new array.
  const key = React.useMemo(
    () =>
      Array.from(new Set(colors.filter((c): c is string => !!c)))
        .sort()
        .join("|"),
    [colors],
  );

  // Seeded from the shared cache so a remount draws real pieces on its first
  // render instead of blanking.
  const [icons, setIcons] = React.useState<ShotURLs>(() =>
    cachedShots(ICON_SET.id, key ? key.split("|") : []),
  );

  // Re-seed during render when the colour set changes. An already-cached
  // colour has no render to wait for, so an effect would leave the pieces
  // blank, and setting state inside an effect causes cascading renders. This
  // is React's adjust-state-on-change pattern.
  const [lastKey, setLastKey] = React.useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setIcons(cachedShots(ICON_SET.id, key ? key.split("|") : []));
  }

  React.useEffect(() => {
    const wanted = key ? key.split("|") : [];
    if (!wanted.length) return;
    let alive = true;
    void ensureShots(ICON_SET, wanted).then((changed) => {
      if (alive && changed) setIcons(cachedShots(ICON_SET.id, wanted));
    });
    return () => {
      alive = false;
    };
  }, [key]);

  return React.useCallback(
    (color, piece) => (color ? (icons[color]?.[pieceIconSlot(piece)] ?? null) : null),
    [icons],
  );
}
