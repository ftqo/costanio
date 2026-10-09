import * as React from "react";
import { usePieceIcons } from "@/lib/usePieceIcons";
import type { PieceKind } from "@/lib/eventlog";

/**
 * What can be drawn, a superset of what the log can name.
 *
 * `PieceKind` has one knight (a promotion's tier is in the words). A supply
 * readout counts pieces per tier, so the other two knight models get icon slots
 * (see board3d/pieceIconShots). Kept separate so `PieceKind`'s exhaustive maps
 * don't need entries no log line can produce.
 */
export type ArtPiece = PieceKind | "knight_strong" | "knight_mighty";

/**
 * A piece as the player sees it: the game's own model, in their colour.
 *
 * Nothing is drawn before the render lands, or for a model that won't load;
 * callers size the box, so the blank holds its place. The gap is short:
 * `useGameEntry` holds the game screen until `ICON_SET` and `SHOP_SET` resolve
 * for the table's colours.
 *
 * The hook is called here so a stat row stays one component per icon. Renders
 * are cached by colour, so repeated requests for a seat cost one render.
 */
export function PieceArt({ piece, color }: { piece: ArtPiece; color: string }) {
  const colors = React.useMemo(() => [color], [color]);
  const src = usePieceIcons(colors)(color, piece);
  if (!src) return null;
  return <img src={src} alt="" draggable={false} className="h-full w-full object-contain" />;
}
