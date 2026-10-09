import * as React from "react";
import { cachedShots, ensureShots } from "@/lib/board3d/shotCache";
import { shopSetFor } from "@/lib/board3d/shotSets";
import { STOCK_PIECES_FILE } from "@/lib/pieceSets";

/**
 * Shop-tile art rendered in this player's seat colour, as slot -> object URL.
 *
 * Keyed on the colour and the viewer's piece set, which determine what these
 * look like; the colourblind toggle and a mid-game colour change arrive as a
 * different colour string.
 *
 * Caching is in shotCache, shared with usePieceIcons: read from disk if a
 * previous visit rendered it, otherwise rendered once in a batch. Empty until
 * that resolves, and forever on a client that cannot render, so callers draw
 * nothing in that slot.
 */
export function usePieceThumbnails(
  seatColor: string | null | undefined,
  pieceSetFile: string = STOCK_PIECES_FILE,
): Record<string, string> {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const set = React.useMemo(() => shopSetFor(pieceSetFile), [pieceSetFile]);

  React.useEffect(() => {
    if (!seatColor) return;
    let alive = true;
    void ensureShots(set, [seatColor]).then((changed) => {
      if (alive && changed) bump();
    });
    return () => {
      alive = false;
    };
  }, [seatColor, set]);

  return (seatColor && cachedShots(set.id, [seatColor])[seatColor]) || EMPTY;
}

const EMPTY: Record<string, string> = {};
