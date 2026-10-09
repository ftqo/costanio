// The Wagons scenario, read from the view.
//
// Nothing here re-derives a rule. The engine publishes the constants in its
// ext (movement track, gold price, drive-off floors) and priced legal sets in
// `legal` (`wagon_steps` is already limited to paths the wagon can pay for,
// movement and toll both), so the client never prices a move itself.
import { t } from "@lingui/core/macro";
import { edgeHexes, hexKey } from "./hexgeo";
import { hexLabel } from "./boardInfo";
import { raidersExt, type Hex } from "./types";
import { wagonsExt, type FullView, type Vertex, type Edge, type WagonsTradeHex } from "./types";

/** The cargoes, by their wire number. 0 is an empty wagon rather than a token. */
export const CARGO = {
  none: 0,
  marble: 1,
  glass: 2,
  sand: 3,
  tools: 4,
} as const;

/** The trade-hex roles, by their wire number. */
export const ROLE = {
  castle: 0,
  quarry: 1,
  glassworks: 2,
} as const;

/** What this seat's wagon is carrying, or 0 for empty. */
export function carrying(view: FullView, seat: number): number {
  const ext = wagonsExt(view);
  if (!ext?.cargo || seat < 0 || seat >= ext.cargo.length) return CARGO.none;
  return ext.cargo[seat];
}

/** This seat's gold. A count, never cards, and never a victory point. */
export function gold(view: FullView, seat: number): number {
  const ext = wagonsExt(view);
  if (!ext?.gold || seat < 0 || seat >= ext.gold.length) return 0;
  return ext.gold[seat];
}

/** This seat's place on the upgrade track, 1 to 5. */
export function level(view: FullView, seat: number): number {
  const ext = wagonsExt(view);
  if (!ext?.level || seat < 0 || seat >= ext.level.length) return 1;
  return ext.level[seat] || 1;
}

/** Cargo tokens this seat has delivered. Each is a victory point, permanently. */
export function delivered(view: FullView, seat: number): number {
  const ext = wagonsExt(view);
  if (!ext?.delivered || seat < 0 || seat >= ext.delivered.length) return 0;
  return ext.delivered[seat];
}

/**
 * What this seat owes the scenario right now, or null. "barbarian" outranks
 * "move": while one is owed, the engine's BlocksTurnActions refuses
 * everything else.
 */
export type WagonRole = "barbarian" | "move" | null;

export function wagonRole(view: FullView, seat: number): WagonRole {
  const ext = wagonsExt(view);
  if (!ext?.has_trade || seat < 0) return null;
  if (ext.barb_seat === seat) return "barbarian";
  if (!ext.started || ext.move_done || ext.turn_seat !== seat) return null;
  return "move";
}

/** The intersections this seat's wagon may drive to, already priced by the server. */
export function wagonSteps(view: FullView): Vertex[] {
  return view.legal?.wagon_steps ?? [];
}

/** Where an owed barbarian may be put down. */
export function barbarianTargets(view: FullView): Edge[] {
  return view.legal?.barbarian_edges ?? [];
}

/**
 * Which barbarian a pending move names, or null when the seat may choose. A
 * drive-off names the barbarian driven off; a 7 or a played Knight lets the
 * player pick any of the three. The command takes an index either way.
 */
export function owedBarbarian(view: FullView): number | null {
  const ext = wagonsExt(view);
  const idx = ext?.barb_index;
  return typeof idx === "number" && idx >= 0 ? idx : null;
}

/** The movement points left in the open action, or the allowance if none is open. */
export function movementLeft(view: FullView, seat: number): number {
  const ext = wagonsExt(view);
  if (!ext) return 0;
  if (ext.move_open) return ext.mp ?? 0;
  // Finished for this turn: showing the next allowance beside a greyed Drive
  // button would suggest movement that cannot be used.
  if (ext.move_done && ext.turn_seat === seat) return 0;
  const track = ext.mp_track ?? [];
  const lvl = level(view, seat);
  return track[lvl - 1] ?? 0;
}

/**
 * The trade hexes that accept what this seat is carrying: where the wagon is
 * heading. An empty wagon may go to any, since every plaza deals a load.
 */
export function destinations(view: FullView, seat: number): WagonsTradeHex[] {
  const ext = wagonsExt(view);
  const trade = ext?.trade ?? [];
  const cargo = carrying(view, seat);
  if (cargo === CARGO.none) return trade;
  return trade.filter((t) => t.accepts.includes(cargo));
}

/**
 * The lowest die that drives a barbarian off at this seat's level, or null
 * when the wagon cannot attempt at all (level 1). Read from the engine's
 * published table.
 */
export function driveOffFloor(view: FullView, seat: number): number | null {
  const floors = wagonsExt(view)?.drive_floors ?? [];
  const floor = floors[level(view, seat) - 1];
  return typeof floor === "number" && floor <= 6 ? floor : null;
}

/** Whether this seat may still buy a resource with gold this turn. */
export function canBuyWithGold(view: FullView, seat: number): boolean {
  const ext = wagonsExt(view);
  if (!ext) return false;
  const price = ext.gold_price ?? 2;
  const cap = ext.buys_a_turn ?? 2;
  return gold(view, seat) >= price && (ext.bought ?? 0) < cap;
}

/** Whether the once-per-turn grain purchase is still available to this seat. */
export function canBoost(view: FullView, seat: number): boolean {
  const ext = wagonsExt(view);
  return !!ext && wagonRole(view, seat) === "move" && !ext.boosted;
}

/** Playable Swift Journeys this seat holds (a card bought this turn is locked). */
export function swiftHeld(view: FullView): number {
  return wagonsExt(view)?.swift ?? 0;
}

/** The server's unconquered hexes that can own this particular path. */
export function barbarianHexChoices(view: FullView, e: Edge): Hex[] {
  const plaza = e.a.side === 2 ? e.a : e.b.side === 2 ? e.b : null;
  const touching = plaza ? [{ q: plaza.q, r: plaza.r }] : edgeHexes(e);
  const keys = new Set(touching.map(hexKey));
  return (raidersExt(view)?.relocation_hexes ?? []).filter((h) => keys.has(hexKey(h)));
}

/**
 * The barbarians this seat may move, each with the wire id the command takes.
 * Alone they are 0..2; alongside Raiders they are figures in the shared raider
 * population with that figure's id, so the `barbarians` index is not sent.
 */
export function movableBarbarians(view: FullView): { id: number; edge: Edge }[] {
  const ext = wagonsExt(view);
  return (ext?.barbarians ?? []).map((edge, i) => ({ id: ext?.barbarian_ids?.[i] ?? i, edge }));
}

/**
 * A barbarian named by the land hexes its path runs between ("between wheat 6
 * and ore 8"), since the pieces are identical and unnumbered on the board.
 */
export function barbarianPlace(view: FullView, e: Edge): string {
  const plaza = e.a.side === 2 ? e.a : e.b.side === 2 ? e.b : null;
  const hexes = plaza ? [{ q: plaza.q, r: plaza.r }] : edgeHexes(e);
  const names = hexes
    .map((h) => (view.board?.tiles ?? []).find((tile) => tile.hex.q === h.q && tile.hex.r === h.r))
    .filter((tile) => tile && tile.res !== "sea")
    .map((tile) => hexLabel(tile));
  if (names.length >= 2) {
    const [a, b] = names;
    return t({
      message: `between ${a} and ${b}`,
      context: "where a Wagons barbarian stands: the path between two hexes",
    });
  }
  if (names.length === 1) {
    const [a] = names;
    return t({
      message: `beside ${a}`,
      context: "where a Wagons barbarian stands: a coastal path beside one hex",
    });
  }
  return t({ message: "on the coast", context: "where a Wagons barbarian stands" });
}

/**
 * The wagon upgrade's price at this seat's level, indexed like a hand: wood
 * (2 from level 3 up), sheep and ore. Null at the top level, where there is no
 * upgrade to price.
 */
export function upgradeCost(view: FullView, seat: number): Record<number, number> | null {
  const ext = wagonsExt(view);
  const lvl = level(view, seat);
  if (!ext || lvl >= (ext.max_level ?? 5)) return null;
  return { 1: lvl >= 3 ? 2 : 1, 3: 1, 5: 1 };
}

/**
 * Whether this seat may upgrade its wagon now: below the top level, not mid
 * drive (the upgrade comes before the wagon moves), and holding the price.
 */
export function canUpgrade(view: FullView, seat: number): boolean {
  const ext = wagonsExt(view);
  const cost = upgradeCost(view, seat);
  const hand = view.players?.[seat]?.hand;
  if (!ext || !cost || ext.move_open) return false;
  return Object.entries(cost).every(([r, n]) => (hand?.[Number(r)] ?? 0) >= n);
}
