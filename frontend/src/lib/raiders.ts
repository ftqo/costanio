// Raiders: reading the scenario off the wire, and answering it.
//
// A raider is a neutral enemy figure on a hex. A rider is a seat-tinted
// defender on a path (edge). The words differ by one letter, so neither is
// abbreviated here.
//
// The engine owns every rule. This module works out which of the scenario's six
// questions (if any) is being put to this viewer, and prices the two spends the
// panels show, so the client offers only the control the server will accept.
//
// The seat being asked is `ext.pend.seat`, published to everyone so the table
// can see who it waits on. Never derive it from `view.cur`: a landing
// interrupts the builder's turn, Intrigue is answered by whoever bought the
// card, and the battle sweep hands prisoners to seats not playing.
import type {
  Edge,
  FullView,
  Hand,
  Hex,
  RaidersExt,
  RaidersPend,
  RaidersPendKind,
  Resource,
  RiderMoves,
} from "./types";
import { raidersExt } from "./types";
import { edgeKey, hexKey } from "./hexgeo";
import { rulesetCaps } from "./caps";
import { myFishMix } from "./fish";

/** engine.NoPlayer. */
export const NO_PLAYER = -1;

/**
 * The component limit: six riders per seat, enforced like roads and settlements.
 *
 * A fallback: readers prefer `ext.riders_per_seat`; this covers frames that
 * predate the field.
 */
export const RIDERS_PER_SEAT = 6;

/** Raiders on one hex that saturate it. Conquest is this comparison and nothing else. */
export const CONQUERED = 3;

/** What one resource costs in gold, and how many such buys a turn allows. */
export const GOLD_PER_RESOURCE = 2;
export const GOLD_BUYS_PER_TURN = 2;

/**
 * Prisoners to a victory point: two, or three alongside Knights.
 *
 * A lone prisoner is worth nothing, including when deciding who leads (the old
 * boot under Fishermen, Master Merchant and Wedding under Knights).
 * `prisonerVP` is the only place the division happens.
 */
export const PRISONERS_PER_VP = 2;
export const PRISONERS_PER_VP_KNIGHTS = 3;

/** The maritime rate for one gold without a harbour: 4 identical resources. */
export const GOLD_RATIO = 4;

/** Hand index to the wire's resource name, for the two gold commands. */
const RES_NAME: Record<number, Resource> = {
  1: "wood",
  2: "brick",
  3: "sheep",
  4: "wheat",
  5: "ore",
};

/** The five bankable resources, as Hand indices. Gold is not one of them. */
export const RES_IDX: readonly number[] = [1, 2, 3, 4, 5];

export function resourceName(idx: number): Resource | undefined {
  return RES_NAME[idx];
}

/** The open decision, or undefined. */
export function raidersPend(view: FullView): RaidersPend | undefined {
  return raidersExt(view)?.pend;
}

/**
 * The seat the scenario is waiting on, or NO_PLAYER.
 *
 * Published to everyone, so this is who the table is waiting on.
 */
export function raidersAsking(view: FullView): number {
  const seat = raidersPend(view)?.seat;
  return typeof seat === "number" ? seat : NO_PLAYER;
}

/**
 * What the open decision (if any) is asking of one viewer.
 *
 * - `"none"`: nothing is open.
 * - one of the six pending kinds: this seat is the one being asked.
 * - `"waiting"`: a decision is open for somebody else. Spectators get this too
 *   (`pend.seat` is a real seat, never the spectator sentinel); the server
 *   refuses both alike.
 */
export type RaidersRole = "none" | "waiting" | RaidersPendKind;

export function raidersRole(view: FullView, seat: number): RaidersRole {
  const pend = raidersPend(view);
  if (!pend?.kind) return "none";
  if (seat < 0 || pend.seat !== seat) return "waiting";
  return pend.kind;
}

/**
 * The hexes the open decision offers this seat, in the order the server gave.
 *
 * Never sorted: `pend.hexes` is already ascending (q, r), which is also the
 * order the landing resolves and the sweep checks in.
 */
export function pendHexes(view: FullView): Hex[] {
  return raidersPend(view)?.hexes ?? [];
}

/**
 * The number a landing tie is about: the chip on the hexes it offers, which
 * all carry the same one (the engine narrows to the rolled number first).
 * Null when nothing is offered or the hexes disagree, so a prompt never names
 * a number the board does not show.
 */
export function landingNumber(view: FullView): number | null {
  const hexes = pendHexes(view);
  if (!hexes.length) return null;
  const nums = new Set(
    hexes.map((h) => view.board.tiles.find((t) => t.hex.q === h.q && t.hex.r === h.r)?.num ?? 0),
  );
  if (nums.size !== 1) return null;
  const [n] = nums;
  return n > 0 ? n : null;
}

/** The paths the open decision offers this seat (a Muster or a Swift Rider). */
export function pendEdges(view: FullView): Edge[] {
  return raidersPend(view)?.edges ?? [];
}

/** Treason's two ingredients: where a raider may be taken from, and put. */
export function treasonSources(view: FullView): Hex[] {
  return raidersPend(view)?.treason_from ?? [];
}

export function treasonDestinations(view: FullView): Hex[] {
  return raidersPend(view)?.treason_to ?? [];
}

/**
 * How many raiders Treason actually moves.
 *
 * Usually two; fewer when board and supply cannot furnish two, or there are not
 * two distinct unconquered destinations. The command carries the whole plan and
 * a plan of the wrong length is refused (`BAD_TREASON_PLAN`).
 *
 * Prefers the engine's `pend.treason_count`. The pick lists alone cannot give
 * it (a destination may not be a source, so the chosen sources decide how many
 * destinations remain); the arithmetic below is only for frames that predate
 * the field.
 */
export function treasonMoveCount(view: FullView, knights: boolean): number {
  const wire = raidersPend(view)?.treason_count;
  if (typeof wire === "number") return Math.max(0, wire);
  const x = raidersExt(view);
  const sources = treasonSources(view).length;
  const supply = knights ? 2 : Math.min(2, Math.max(0, x?.supply ?? 0));
  return Math.min(2, Math.min(sources + supply, treasonDestinations(view).length));
}

/**
 * The viewer's own riders that may still move this turn.
 *
 * Viewer-only on the wire: an empty list means no rider of yours may move (all
 * have moved, none is yours, or you are spectating).
 */
export function riderMoves(view: FullView): RiderMoves[] {
  return raidersExt(view)?.rider_moves ?? [];
}

/** The move offer for one rider, by the path it stands on. */
export function riderMoveFrom(view: FullView, from: Edge): RiderMoves | undefined {
  const key = edgeKey(from);
  return riderMoves(view).find((m) => edgeKey(m.from) === key);
}

/**
 * Riders that must leave the castle before the turn can end.
 *
 * After moving, none of your riders may be on a path adjacent to the castle,
 * and ending the turn is refused while one that could leave has not. A rider
 * with nowhere legal to go is not listed (the engine does not mark it), and the
 * rules let it stay.
 *
 * So the list is exactly the moves the player owes; an empty list does not mean
 * the castle is clear.
 */
export function ridersMustLeave(view: FullView): RiderMoves[] {
  return riderMoves(view).filter((m) => m.must_leave === true);
}

/** Whether a destination costs the grain, for one rider's offer. */
export function isHurryTarget(move: RiderMoves, to: Edge): boolean {
  const key = edgeKey(to);
  return (move.hurry ?? []).some((e) => edgeKey(e) === key);
}

/** Every path one rider may end on, free ones and hurried ones together. */
export function riderTargets(move: RiderMoves): Edge[] {
  return [...(move.to ?? []), ...(move.hurry ?? [])];
}

/**
 * How many raiders stand on one hex.
 *
 * `coast` and `raider_count` are parallel arrays (the wire has no hex-keyed
 * map). Zero for a hex off the coast; only coastal hexes are landed on.
 */
export function raidersOn(x: RaidersExt | undefined, hex: Hex): number {
  if (x?.shared_paths)
    return (x.path_figures ?? []).filter((r) => r.alive && hexKey(r.hex) === hexKey(hex)).length;
  const coast = x?.coast ?? [];
  const counts = x?.raider_count ?? [];
  const key = hexKey(hex);
  for (let i = 0; i < coast.length; i++) {
    if (hexKey(coast[i]) === key) return counts[i] ?? 0;
  }
  return 0;
}

/**
 * The saturated hexes as a key set, for the board.
 *
 * From the engine's `conquered` list, so the three-raider rule is not
 * duplicated here.
 */
export function conqueredKeys(x: RaidersExt | undefined): Set<string> {
  return new Set((x?.conquered ?? []).map(hexKey));
}

/** Victory points for a prisoner count. A lone prisoner is worth nothing. */
export function prisonerVP(prisoners: number, knights: boolean): number {
  const per = knights ? PRISONERS_PER_VP_KNIGHTS : PRISONERS_PER_VP;
  return Math.floor(Math.max(0, prisoners) / per);
}

/** Gold held by one seat. Public, and not a resource. */
export function goldOf(x: RaidersExt | undefined, seat: number): number {
  if (seat < 0) return 0;
  return x?.gold?.[seat] ?? 0;
}

/** Prisoners held by one seat. */
export function prisonersOf(x: RaidersExt | undefined, seat: number): number {
  if (seat < 0) return 0;
  return x?.prisoners?.[seat] ?? 0;
}

/** Riders one seat still has to place, and out of how many. */
export function ridersLeft(
  x: RaidersExt | undefined,
  seat: number,
): { left: number; perSeat: number } {
  const perSeat = x?.riders_per_seat ?? RIDERS_PER_SEAT;
  if (seat < 0) return { left: 0, perSeat };
  return { left: x?.riders_left?.[seat] ?? perSeat, perSeat };
}

/** Gold-for-resource purchases the active seat has left this turn. */
export function goldBuysLeft(x: RaidersExt | undefined): number {
  const n = x?.gold_buys_left;
  return typeof n === "number" ? Math.max(0, n) : GOLD_BUYS_PER_TURN;
}

/** How many cards are left of the deck's four kinds, and the total. */
export function deckCounts(x: RaidersExt | undefined): { counts: number[]; total: number } {
  const counts = x?.deck ?? [];
  return { counts, total: counts.reduce((n, c) => n + (c || 0), 0) };
}

/** The server quotes the maritime rate for the resource being sold. */
export function goldSellRatio(view: FullView, res: number): number {
  return view.bank_ratios?.[res] ?? GOLD_RATIO;
}

/** One row of the gold panel's buy half: a resource, and why it can or cannot be had. */
export interface GoldBuyOffer {
  res: number;
  /** The bank's stock. Zero refuses the purchase before the gold is spent. */
  stock: number;
  affordable: boolean;
}

/**
 * Buying a resource from the bank for 2 gold, at most twice a turn.
 *
 * Every resource is listed, including ones this seat cannot buy now (as the
 * fish ladder lists unaffordable rungs); each row says why not.
 */
export function goldBuyOffers(view: FullView, seat: number): GoldBuyOffer[] {
  const x = raidersExt(view);
  const gold = goldOf(x, seat);
  const buys = goldBuysLeft(x);
  return RES_IDX.map((res) => {
    const stock = view.bank?.[res] ?? 0;
    return { res, stock, affordable: gold >= GOLD_PER_RESOURCE && buys > 0 && stock > 0 };
  });
}

/** One row of the gold panel's sell half: what it takes, and whether the hand has it. */
export interface GoldSellOffer {
  res: number;
  /** How many identical cards one gold costs at this resource’s maritime rate. */
  ratio: number;
  held: number;
  affordable: boolean;
}

/** Turn identical resources into gold at their current maritime rate. */
export function goldSellOffers(view: FullView, hand: Hand | undefined): GoldSellOffer[] {
  return RES_IDX.map((res) => {
    const ratio = goldSellRatio(view, res);
    const held = hand?.[res] ?? 0;
    return { res, ratio, held, affordable: held >= ratio };
  });
}

/** Whether this seat could buy a Raiders card right now: 1 ore + 1 wool + 1 grain. */
export function canBuyRaidersCard(hand: Hand | undefined): boolean {
  return (hand?.[3] ?? 0) >= 1 && (hand?.[4] ?? 0) >= 1 && (hand?.[5] ?? 0) >= 1;
}

/**
 * The seats a 7 may take a card from: anyone but the thief who is holding one.
 *
 * Display only. The engine's `stealVictims` also applies the friendly-robber
 * shield using state the client cannot see, and refuses bad victims. Offering a
 * seat the server rejects costs a toast; hiding one it would accept costs the
 * steal, so this is the wider test.
 */
export function stealVictims(
  view: FullView,
  thief: number,
  cardsHeld: (seat: number) => number,
): number[] {
  return view.players.map((p) => p.seat).filter((seat) => seat !== thief && cardsHeld(seat) > 0);
}

/**
 * Whether the 7's steal can be answered yet.
 *
 * The engine refuses the steal until every discard is in. "hidden" while this
 * seat still owes one (its discard panel comes first); "waiting" while somebody
 * else does; "open" once the table is clear.
 */
export function stealGate(view: FullView, seat: number): "hidden" | "waiting" | "open" {
  const pend = view.pending_discards ?? {};
  if ((pend[seat] ?? 0) > 0) return "hidden";
  return Object.values(pend).some((n) => (n ?? 0) > 0) ? "waiting" : "open";
}

/**
 * Whether this seat can pay for a rider's hurry: a wheat, or two fish where
 * Fishermen allows it. Used so the board does not light destinations the
 * player cannot pay for.
 */
export function riderHurryPayable(view: FullView): boolean {
  if ((view.players?.[view.viewer]?.hand?.[4] ?? 0) > 0) return true;
  if (!rulesetCaps(view.config?.ruleset ?? "base").hasFish) return false;
  const mix = myFishMix(view);
  return mix[0] + 2 * mix[1] + 3 * mix[2] >= 2;
}

/** How many raiders on one hex conquer it. */
export const RAIDERS_TO_CONQUER = 3;

/** The coastal raider threat, as the HUD reads it. */
export interface CoastThreat {
  /** Coastal hexes holding raiders but not yet conquered, most raiders first. */
  hexes: { hex: Hex; count: number }[];
  /** Hexes already conquered. */
  conquered: number;
  /** Raiders left in the supply; null alongside Knights, where it is unbounded. */
  supply: number | null;
}

/**
 * The coast threat: which hexes are filling up with raiders, how many have
 * fallen, and how many raiders are still to come. Every number is the
 * engine's (`coast`, `raider_count` or `path_figures`, `conquered`,
 * `supply`); only the order is decided here, fullest first.
 */
export function coastThreat(view: FullView): CoastThreat | null {
  const x = raidersExt(view);
  if (!x?.coast?.length) return null;
  const fallen = conqueredKeys(x);
  const hexes = x.coast
    .map((hex) => ({ hex, count: raidersOn(x, hex) }))
    .filter((h) => h.count > 0 && !fallen.has(hexKey(h.hex)))
    .sort((a, b) => b.count - a.count);
  const knights = rulesetCaps(view.config?.ruleset ?? "base").hasKnightPieces;
  return {
    hexes,
    conquered: fallen.size,
    supply: knights ? null : (x.supply ?? null),
  };
}
