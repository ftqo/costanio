// Caravans: reading an open camel vote off the wire, and answering it.
//
// The engine is the authority for every rule here. This module decides which
// of the vote's two questions (if either) is being put to this viewer now, so
// the client offers only the control the server will accept.
//
// The round is open and sequential: every bid is public as soon as it lands,
// so later bidders answer knowing the tally, which is what makes the coalition
// rule an agreement. Only the seat on the clock may bid; others get
// NOT_YOUR_TURN. Which seat that is comes off the wire: the engine publishes
// `legal.camel_paths` only to the seat that may act (the bidder on the clock
// while open, the placer once closed), and `camelRole` reads it.
//
// `camelOnClock` derives the same seat clockwise from `finisher` and `bidded`
// for display only. It never gates a control, since it copies an engine rule.
import type { CamelBid, CamelPath, CaravansExt, FullView, Vertex } from "./types";
import { caravansExt, raidersExt, RES_INDEX } from "./types";
import { hexKey, vertexHexes, vertexKey } from "./hexgeo";
import { conqueredKeys } from "./raiders";

/** engine.NoPlayer. */
export const NO_PLAYER = -1;

/**
 * The two resources a camel vote is bid in, as Hand indices: wool and grain,
 * the default and what a server without `bid_resources` means. Do not assume
 * it: alongside Knights the vote is bid in brick and lumber.
 */
export const DEFAULT_BID_RESOURCES: readonly [number, number] = [3, 4];

/**
 * One wire resource as a Hand index, or undefined when it names none we bid in.
 *
 * The server sends names: `board.Resource` marshals as a string ("sheep",
 * "wheat"; see engine/board/resource_json.go), so `bid_resources` is
 * `["sheep","wheat"]`. Passing them through as indices crashed the bid panel.
 * A bare number is still accepted, for a fixture or an older server.
 */
function bidIndex(r: number | string | undefined): number | undefined {
  if (typeof r === "number") return r >= 1 && r <= 5 ? r : undefined;
  if (typeof r === "string" && r in RES_INDEX) return RES_INDEX[r as keyof typeof RES_INDEX];
  return undefined;
}

/** The pair this ruleset bids in, off the wire, falling back to wool and grain. */
export function bidResources(x: CaravansExt | undefined): [number, number] {
  const r = x?.bid_resources;
  if (r && r.length >= 2) {
    const a = bidIndex(r[0]);
    const b = bidIndex(r[1]);
    if (a !== undefined && b !== undefined) return [a, b];
  }
  return [DEFAULT_BID_RESOURCES[0], DEFAULT_BID_RESOURCES[1]];
}

/**
 * The votes one bid bought: one card, one vote. Reads `cards`, falling back to
 * the `{wool, grain}` fields of logs written before bid resources became
 * ruleset-dependent.
 */
export function bidVotes(b: CamelBid): number {
  if (Array.isArray(b.cards)) return b.cards.reduce((n, c) => n + (c || 0), 0);
  return (b.wool || 0) + (b.grain || 0);
}

/**
 * The seat whose go it is in an open round, or NO_PLAYER when none.
 *
 * Display only, so the table knows who it is waiting on. Never gate a control
 * on it: that is the seat's own `legal.camel_paths` (see `camelRole`).
 *
 * The engine's order: from the finisher (whose turn ended and opened the
 * vote), clockwise, one answer each. The seat on the clock is the first,
 * walking from the finisher, not in `bidded`.
 */
export function camelOnClock(view: FullView): number {
  const x = caravansExt(view);
  if (!x?.voting || (x.placer ?? NO_PLAYER) !== NO_PLAYER) return NO_PLAYER;
  const n = view.players?.length ?? 0;
  if (n <= 0) return NO_PLAYER;
  const answered = new Set(x.bidded ?? []);
  const from = x.finisher ?? 0;
  for (let i = 0; i < n; i++) {
    const seat = (from + i) % n;
    if (!answered.has(seat)) return seat;
  }
  return NO_PLAYER;
}

/**
 * What the open vote (if any) is asking of one viewer.
 *
 * - `none`: no vote is open, or the viewer is a spectator with nothing to do.
 * - `bid`: bidding is open and this seat is on the clock.
 * - `bid-waiting`: bidding is open and this seat may not bid now, because it
 *   has already answered or its go has not come round. The engine refuses
 *   both and the prompt is the same.
 * - `place`: the round closed and this seat won it.
 * - `place-waiting`: the round closed and someone else is placing.
 *
 * `bid` is decided by `legal.camel_paths` (published via the module's
 * `PendingTargets` hook only to the seat that may act), not by counting round
 * the table. A spectator (`seat < 0`) has no legal list.
 */
export type CamelRole = "none" | "bid" | "bid-waiting" | "place" | "place-waiting";

export function camelRole(view: FullView, seat: number): CamelRole {
  const x = caravansExt(view);
  if (!x?.voting) return "none";
  const placer = x.placer ?? NO_PLAYER;
  if (placer === NO_PLAYER) {
    if (seat < 0) return "bid-waiting";
    return camelPaths(view).length > 0 ? "bid" : "bid-waiting";
  }
  return placer === seat ? "place" : "place-waiting";
}

/**
 * The seats still to answer an open bidding round, in the order they will be
 * asked: clockwise from the finisher. The head of the list is on the clock.
 *
 * Counted from `bidded` rather than `bids`, so a seat that bid nothing has
 * still answered.
 */
export function camelPending(view: FullView): number[] {
  const x = caravansExt(view);
  if (!x?.voting || (x.placer ?? NO_PLAYER) !== NO_PLAYER) return [];
  const answered = new Set(x.bidded ?? []);
  const n = view.players?.length ?? 0;
  const from = x.finisher ?? 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const seat = (from + i) % n;
    if (!answered.has(seat)) out.push(seat);
  }
  return out;
}

/**
 * The bids already cast, in the order cast. Public throughout the round, so
 * the bid panel shows them. Never sorted: the order is the round.
 */
export function camelBids(x: CaravansExt | undefined): CamelBid[] {
  return x?.bids ?? [];
}

/**
 * The placements open to this seat, in the server's order.
 *
 * Two seats can have some at different moments: the placer once the round has
 * closed, and the seat on the clock while open (a bid may name the placement
 * it wants, which is how a coalition agrees). Both come from
 * `legal.camel_paths`.
 *
 * Not sorted: `legalPaths` groups them by caravan and orders each along the
 * chain the board draws, which a sort by caravan could scramble.
 */
export function camelPaths(view: FullView): CamelPath[] {
  return view.legal?.camel_paths ?? [];
}

/** A key for a placement: the (caravan, edge) pair, never the edge alone. */
export function camelPathKey(p: CamelPath): string {
  const { a, b } = p.e;
  return `${p.caravan}:${a.q},${a.r},${a.side}|${b.q},${b.r},${b.side}`;
}

/** How many camels of the supply are on the board, for "9 of 22 placed". */
export function camelsPlaced(x: CaravansExt | undefined): { placed: number; supply: number } {
  const supply = x?.camel_supply ?? 0;
  const left = x?.camels_left ?? supply;
  return { placed: Math.max(0, supply - left), supply };
}

/**
 * The votes each revealed payment bought, and who took the camel. One vote per
 * card paid, via `bidVotes` so pre-`cards` logs count the same.
 */
export function camelVotes(paid: readonly CamelBid[]): {
  best: number;
  leaders: number[];
} {
  let best = 0;
  let leaders: number[] = [];
  for (const p of paid) {
    const v = bidVotes(p);
    if (v <= 0) continue;
    if (v > best) {
      best = v;
      leaders = [p.player];
    } else if (v === best) {
      leaders.push(p.player);
    }
  }
  return { best, leaders };
}

/** Which of `pickPlacer`'s four outcomes a resolved round was. */
export type CamelOutcome = "won" | "coalition" | "tie" | "nobody";

/**
 * The outcome the engine stamped on the event.
 *
 * `tab_camel_resolved` carries a `reason` of "majority" | "coalition" | "tie" |
 * "nobody", written where `pickPlacer` (engine/scenarios/caravans.go) applies the
 * voting rule. Read it; do not recompute it.
 *
 * "coalition" has no placer: two or more bidders naming the same path with a
 * combined majority have agreed, and the camel is placed in the same batch.
 * It needs no legacy fallback, since logs without `reason` predate the rule.
 */
export function camelOutcomeOf(
  reason: unknown,
  placer: number,
  paid: readonly CamelBid[],
): CamelOutcome {
  if (reason === "majority") return "won";
  if (reason === "coalition") return "coalition";
  if (reason === "tie") return "tie";
  if (reason === "nobody") return "nobody";
  return camelOutcome(placer, paid);
}

/**
 * The outcome of the closed round the view is showing, for the controls: the
 * `camelOutcomeOf` answer read off the view, since `placer` alone cannot tell
 * a win from a tie or an empty round.
 *
 * Undefined while no round has closed. A coalition leaves `placer` at -1 and
 * normally never reaches a panel; this names it correctly if one does.
 */
export function camelViewOutcome(x: CaravansExt | undefined): CamelOutcome | undefined {
  if (!x) return undefined;
  if (x.reason === "coalition") return "coalition";
  if ((x.placer ?? NO_PLAYER) === NO_PLAYER) return undefined;
  return camelOutcomeOf(x.reason, x.placer ?? NO_PLAYER, x.bids ?? []);
}

/**
 * Legacy fallback only: derives the outcome from the payment list, for event
 * logs recorded before the engine stamped `reason`. A TypeScript copy of the
 * old `pickPlacer` (unique top payer or the finisher); it predates coalitions
 * and cannot produce one, which matches those logs.
 *
 * The engine fold never reads `reason`, so replay is unaffected; without this
 * an old log's prose would call a tie a win.
 *
 * Not exported, so `camelOutcomeOf` is its only caller.
 */
function camelOutcome(placer: number, paid: readonly CamelBid[]): CamelOutcome {
  const { best, leaders } = camelVotes(paid);
  if (best === 0) return "nobody";
  if (leaders.length === 1 && leaders[0] === placer) return "won";
  return "tie";
}

/**
 * A seat's points from the caravans, as the engine scores them: one per
 * settlement or city standing between two camels, i.e. on a vertex of degree
 * two or more in the camel network (engine/scenarios `VictoryVP` / `camelDegree`).
 * Any two camels count, since merged caravans are one caravan. A city counts
 * one, like a settlement.
 *
 * Derived because the live view has no per-seat breakdown, from public inputs.
 * It is the seat card's readout only; the score already includes it.
 *
 * Under Raiders a building whose every land hex is conquered scores nothing
 * (engine `BuildingVPSuppressed`, engine/raiders `buildingInert`).
 */
export function seatCamelVp(view: FullView, seat: number): number {
  const x = caravansExt(view);
  const camels = x?.camels ?? [];
  if (!camels.length) return 0;
  const deg = new Map<string, number>();
  for (const c of camels)
    for (const v of [c.e.a, c.e.b]) deg.set(vertexKey(v), (deg.get(vertexKey(v)) ?? 0) + 1);
  const conquered = conqueredKeys(raidersExt(view));
  const land = new Set(
    (view.board?.tiles ?? []).filter((t) => t.res !== "sea").map((t) => hexKey(t.hex)),
  );
  const inert = (b: { v: Vertex }) => {
    if (!conquered.size) return false;
    let touches = false;
    for (const h of vertexHexes(b.v)) {
      if (!land.has(hexKey(h))) continue;
      touches = true;
      if (!conquered.has(hexKey(h))) return false;
    }
    return touches;
  };
  let vp = 0;
  for (const b of view.buildings ?? []) {
    if (b.owner !== seat) continue;
    if ((deg.get(vertexKey(b.v)) ?? 0) < 2) continue;
    if (inert(b)) continue;
    vp++;
  }
  return vp;
}

/**
 * The other caravan this placement continues, when it continues a merge.
 *
 * Two caravans whose heads meet "merge as soon as the next camel is placed".
 * The engine offers that camel once, on the lower-numbered caravan (engine/scenarios
 * `caravanFrontEdges`), so the row names one caravan. This finds the other:
 * the path end holding a camel of its own caravan where a camel of a different
 * caravan also stands.
 */
export function camelPathMergesWith(ext: CaravansExt | undefined, p: CamelPath): number | null {
  const camels = ext?.camels ?? [];
  for (const end of [p.e.a, p.e.b]) {
    const k = vertexKey(end);
    const here = camels.filter((c) => vertexKey(c.e.a) === k || vertexKey(c.e.b) === k);
    if (!here.some((c) => c.caravan === p.caravan)) continue;
    const other = here.find((c) => c.caravan !== p.caravan);
    if (other) return other.caravan;
  }
  return null;
}
