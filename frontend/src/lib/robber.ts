import { hexVertices, vertexKey, vertexHexes, hexKey } from "@/lib/hexgeo";
import type { Hex, Vertex } from "@/lib/types";

/**
 * The highest public score the friendly-robber shield covers, or null when
 * nobody is shielded.
 *
 * Served by the server (engine State.FriendlyRobberProtected) rather than
 * derived from config: it is the ruleset's starting score, 2 in the base game
 * and 3 where setup deals a city (Knights, Wagons, Raiders), and absent in a
 * ruleset with no robber.
 */
export function friendlyShieldMaxVP(view: { friendly_robber_max_vp?: number }): number | null {
  return view.friendly_robber_max_vp ?? null;
}

/**
 * Whether the robber is standing on a tile of this board.
 *
 * The robber can be off the board: Fishermen parks it there until the first 7
 * (and the two-fish spend returns it), and Knights keeps it away until the
 * barbarians first land. The wire encodes that as an off-board coordinate
 * (`board.OffBoard`), so test tile membership rather than comparing against
 * that pair. "Is this hex blocked" checks are correct without this; anything
 * that draws the piece or describes its hex must ask first.
 */
export function robberOnBoard(
  board: { tiles?: readonly { hex: Hex }[]; robber?: Hex } | undefined,
): boolean {
  const r = board?.robber;
  if (!r) return false;
  return (board?.tiles ?? []).some((t) => t.hex.q === r.q && t.hex.r === r.r);
}

interface RobberBuilding {
  v: Vertex;
  owner: number;
}

interface RobberPlayer {
  seat: number;
  hand_count: number;
  // Knights commodities count toward a robbable hand: the engine steals from
  // resources+commodities (DiscardableCount). Absent in the base game.
  commodity_count?: number;
  vp: number; // public VP for opponents (what the robber rule keys off)
}

// robbableCount is the size of a player's stealable hand: resources plus, in
// Knights, commodities. Mirrors the engine's DiscardableCount.
function robbableCount(p: RobberPlayer): number {
  return p.hand_count + (p.commodity_count ?? 0);
}

// robberVictimSeats returns the opponent seats that may be robbed when the
// robber lands on hex h: an opponent (not the viewer) with a building on the hex
// and at least one card. With a shield threshold (friendlyShieldMaxVP), players
// still at their starting public score are excluded, matching the server.
export function robberVictimSeats(
  h: Hex,
  buildings: readonly RobberBuilding[],
  players: readonly RobberPlayer[],
  viewer: number,
  shieldMaxVP: number | null,
): number[] {
  const vkeys = new Set(hexVertices(h).map(vertexKey));
  const bySeat = new Map(players.map((p) => [p.seat, p]));
  const owners = new Set<number>();
  for (const b of buildings) {
    if (!vkeys.has(vertexKey(b.v)) || b.owner === viewer) continue;
    const p = bySeat.get(b.owner);
    if (!p || robbableCount(p) <= 0) continue;
    if (shieldMaxVP !== null && p.vp <= shieldMaxVP) continue;
    owners.add(b.owner);
  }
  return [...owners];
}

// canChaseRobber: this knight may drive the robber away. It is the viewer's,
// active, not freshly activated, and on a vertex touching the robber's hex
// (engine/knights/decide.go eligibility check).
//
// A missing `freshly_activated` (older server) reads as not fresh; the server
// still rejects a fresh knight with ErrKnightState.
export function canChaseRobber(
  k: { v: Vertex; owner: number; active: boolean; freshly_activated?: boolean },
  viewer: number,
  robber: Hex,
): boolean {
  return chaseRobberBlock(k, viewer, robber) === null;
}

/** Which of `canChaseRobber`'s tests failed, or null when the chase is on. */
export type ChaseBlock = "not-yours" | "inactive" | "fresh" | "not-adjacent";

/**
 * `canChaseRobber`, but says which test failed, so the location menu can
 * explain a greyed Chase robber entry. Inactive is reported before adjacency
 * because activating is the step the player can take.
 */
export function chaseRobberBlock(
  k: { v: Vertex; owner: number; active: boolean; freshly_activated?: boolean },
  viewer: number,
  robber: Hex,
): ChaseBlock | null {
  if (k.owner !== viewer) return "not-yours";
  if (!k.active) return "inactive";
  if (k.freshly_activated) return "fresh";
  if (!vertexHexes(k.v).some((h) => hexKey(h) === hexKey(robber))) return "not-adjacent";
  return null;
}

/**
 * The same test against the pirate's sea hex. With Islands in play a knight
 * next to the pirate may chase it like the robber; the engine takes both
 * through `chase_robber` and picks the blocker from the named hex.
 */
export function chasePirateBlock(
  k: { v: Vertex; owner: number; active: boolean; freshly_activated?: boolean },
  viewer: number,
  pirate: Hex,
): ChaseBlock | null {
  return chaseRobberBlock(k, viewer, pirate);
}

/** `chasePirateBlock` as a boolean, matching `canChaseRobber`. */
export function canChasePirate(
  k: { v: Vertex; owner: number; active: boolean; freshly_activated?: boolean },
  viewer: number,
  pirate: Hex,
): boolean {
  return chasePirateBlock(k, viewer, pirate) === null;
}

// robberAteRoll: did the number just rolled belong to the robber's hex? Nothing
// on screen otherwise explains the missing production, so the 3D board pulses
// the robber (Board3DControls). A 7 never matches: no tile carries one, and
// desert and sea carry 0.
export function robberAteRoll(
  tiles: readonly { hex: Hex; num: number }[],
  robber: Hex | undefined,
  total: number,
): boolean {
  return !!robberBlockedTile(tiles, robber, total);
}

// robberBlockedTile: the same test returning the tile, for the event log's
// "The robber blocked <res> on <num>" line, so the board pulse and the log
// line always agree.
export function robberBlockedTile<T extends { hex: Hex; num: number }>(
  tiles: readonly T[],
  robber: Hex | undefined,
  total: number,
): T | null {
  if (!robber) return null;
  const under = tiles.find((t) => hexKey(t.hex) === hexKey(robber));
  return under && under.num === total ? under : null;
}

interface PirateShip {
  owner: number;
  e: { a: Vertex; b: Vertex };
}

// pirateVictimSeats returns the opponent seats the pirate may steal from when it
// lands on sea hex h: an opponent (not the viewer) with a ship on an edge of h
// and at least one card. Friendly-robber protection applies as for the robber.
export function pirateVictimSeats(
  h: Hex,
  ships: readonly PirateShip[],
  players: readonly RobberPlayer[],
  viewer: number,
  shieldMaxVP: number | null,
): number[] {
  const hexVk = new Set(hexVertices(h).map(vertexKey));
  const bySeat = new Map(players.map((p) => [p.seat, p]));
  const owners = new Set<number>();
  for (const sh of ships) {
    if (sh.owner === viewer) continue;
    if (!hexVk.has(vertexKey(sh.e.a)) || !hexVk.has(vertexKey(sh.e.b))) continue;
    const p = bySeat.get(sh.owner);
    if (!p || robbableCount(p) <= 0) continue;
    if (shieldMaxVP !== null && p.vp <= shieldMaxVP) continue;
    owners.add(sh.owner);
  }
  return [...owners];
}

/**
 * Whether an open steal picker has outlived its move: the robber or pirate is
 * no longer owed (e.g. the move timer expired and the server moved it), so a
 * click would send a `move_robber` the server refuses. A knight's chase is not
 * a robber debt and resets through its own mode.
 */
export function victimPromptStale(
  prompt: { chase?: unknown } | null,
  robberPending: boolean,
): boolean {
  return !!prompt && !prompt.chase && !robberPending;
}
