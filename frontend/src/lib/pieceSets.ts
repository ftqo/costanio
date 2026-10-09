// The piece sets this client knows how to draw, keyed by catalog id.
//
// A set is the settlement, city and road models. As with robber skins (see
// robbers.ts), three things must agree: this table, the row in
// cosmetics/catalog.go, and the model under public/models/pieces/.
// `pieceSets.assets.test.ts` checks them together.
//
// Every set glb is a drop-in for the stock one (same node names
// `Settlement_A_*`, `City_A_*`, `Road_*`, and the same three `Seat_`
// materials), so one loader handles all and sets tint per seat.
export interface PieceSet {
  file: string;
  label: string;
}

/**
 * The set every player already has, as an id.
 *
 * Synthetic: it is not sold, so there is no catalog row. The store still needs
 * an id to key and preview the card by, and equipping it sends "" (unequip).
 */
export const STOCK_PIECES_ID = "pieces.stock";

/** The file the stock buildings ship in, alongside the robber and the chips. */
export const STOCK_PIECES_FILE = "pieces.glb";

export const PIECE_SETS: Record<string, PieceSet> = {
  [STOCK_PIECES_ID]: { file: STOCK_PIECES_FILE, label: "Default" },
  "pieces.cyclades": { file: "pieces/cyclades.glb", label: "Cyclades Set" },
  "pieces.classic": { file: "pieces/classic.glb", label: "Classic Set" },
};

/**
 * The file to draw a piece set from.
 *
 * Unrecognised ids get the stock art, since a bundle can be older than the
 * catalog: a set that fails to resolve costs the decoration, never the pieces.
 */
export function pieceSetAssetFile(id: string): string {
  return PIECE_SETS[id]?.file ?? STOCK_PIECES_FILE;
}

/**
 * Whether this client can actually show a set.
 *
 * The pieces slot has carried reserved ids with no art since cosmetics shipped;
 * the store filters on this so it never offers a set that would draw nothing.
 */
export function isDrawablePieceSet(id: string): boolean {
  return id in PIECE_SETS;
}
