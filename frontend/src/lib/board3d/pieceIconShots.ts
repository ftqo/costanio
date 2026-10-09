// The board pieces, shot square and small, for use as icons in running text.
//
// The SHOP_SHOTS subjects reframed: a log icon is an ~18 px square on a text
// baseline, so the aspect is 1:1 and the fills are higher than the shop's
// (0.58-0.74). Yaws are inherited unchanged; they suit the models' asymmetries
// (the knight's shield, the wall's gate) regardless of frame.
//
// Rendered rather than shipped because a piece's colour depends on the player,
// and the log shows every seat's pieces, so the hook renders per colour and
// caches. The flat `piece_*` assets cover only the five base pieces; knights,
// walls and metropolises have no flat art.
import type { PieceShot } from "./thumbnail";

/** Icon slots are square, and the framing solve is fed the aspect. */
export const PIECE_ICON_W = 96;
export const PIECE_ICON_H = 96;

/**
 * Fill for a piece with nothing around it. 0.86: filling the frame would clip
 * the contact shadow (the only thing telling a road from a bar at 18 px), and a
 * silhouette touching the edge merges into adjacent text.
 */
const FILL = 0.86;

/**
 * One shot per piece the log can name.
 *
 * Slot ids are namespaced `pieceicon_` so they don't collide with the
 * `piece_*` art slots in lib/assets.ts, which are shipped files a cosmetic pack
 * can replace; these exist only in memory.
 */
export const PIECE_ICON_SHOTS: PieceShot[] = [
  {
    slot: "pieceicon_road",
    parts: [{ file: "pieces.glb", prefix: "Road_A" }],
    yawDeg: 0,
    fill: FILL,
  },
  {
    slot: "pieceicon_settlement",
    parts: [{ file: "pieces.glb", prefix: "Settlement_A" }],
    yawDeg: -5,
    fill: FILL,
  },
  {
    slot: "pieceicon_city",
    parts: [{ file: "pieces.glb", prefix: "City_A" }],
    yawDeg: -30,
    fill: FILL,
  },
  {
    slot: "pieceicon_ship",
    parts: [{ file: "ships.glb", prefix: "Ship_route" }],
    yawDeg: 155,
    fill: FILL,
  },
  {
    // +20°, because the shield hangs off the knight's side: square on it falls
    // into its own shadow, edge on it disappears.
    slot: "pieceicon_knight",
    parts: [{ file: "knights.glb", prefix: "Knight_basic" }],
    yawDeg: 20,
    fill: FILL,
  },
  // The other two tiers, for readouts that count a player's knights per
  // strength (the log says the level in words). The models differ in height
  // and bulk, as on the board. Same yaw as the basic knight; fill is per model
  // so each keeps its contact shadow.
  {
    slot: "pieceicon_knight_strong",
    parts: [{ file: "knights.glb", prefix: "Knight_strong" }],
    yawDeg: 20,
    fill: FILL,
  },
  {
    slot: "pieceicon_knight_mighty",
    parts: [{ file: "knights.glb", prefix: "Knight_mighty" }],
    yawDeg: 20,
    fill: FILL,
  },
  {
    // The city standing in the ring is what the piece is about. Same composite
    // as the shop tile.
    slot: "pieceicon_wall",
    parts: [
      { file: "walls.glb", prefix: "Wall_segment_ring_01" },
      { file: "pieces.glb", prefix: "City_A" },
    ],
    yawDeg: -15,
    fill: 0.9,
  },
  {
    slot: "pieceicon_metro_trade",
    parts: [{ file: "metros.glb", prefix: "Metro_trade" }],
    yawDeg: -15,
    fill: FILL,
  },
  {
    slot: "pieceicon_metro_politics",
    parts: [{ file: "metros.glb", prefix: "Metro_politics" }],
    yawDeg: -15,
    fill: FILL,
  },
  {
    slot: "pieceicon_metro_science",
    parts: [{ file: "metros.glb", prefix: "Metro_science" }],
    yawDeg: -15,
    fill: FILL,
  },
  {
    // The Rivers bridge, square on at the road's yaw: the arch is the
    // difference from a road and only reads in elevation. `bridgeArt.test.ts`
    // makes the same point for the board camera.
    slot: "pieceicon_bridge",
    parts: [{ file: "bridges.glb", prefix: "Bridge_" }],
    yawDeg: 0,
    fill: FILL,
  },
];

/** Slot id for a piece kind, as the log's tokens name them. */
export function pieceIconSlot(piece: string): string {
  return `pieceicon_${piece}`;
}
