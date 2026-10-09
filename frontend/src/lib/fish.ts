// Fishermen: what a fish spend costs, and which tiles leave your hand to pay
// for it.
//
// Prices and the tile-selection rule mirror engine/scenarios/fishermen.go
// (`fishCosts`, `spendTiles`) so the panel can show the cost before the player
// commits. The engine still validates every spend; this is only the preview.
import type { KnightsExt, Edge, FullView, Hex } from "./types";
import { knightsExt, fishExt, wagonsExt } from "./types";
import { edgeKey, hexKey } from "./hexgeo";
import type { GameCaps } from "./caps";
import { friendlyShieldMaxVP, robberOnBoard } from "./robber";

/**
 * The things fish buy, in ascending price.
 *
 * `remove_robber` takes the robber off the board entirely and names no hex.
 * (It replaced `move_robber`; the wire value changed with the rule, so the old
 * one is refused.)
 *
 * `dev_card` and `progress_card` share the 7-fish rung: one exists where there
 * is a development deck, the other where there is not. See `fishOffers`.
 */
export type FishSpend =
  | "wagon_boost"
  | "remove_robber"
  | "steal"
  | "take_resource"
  | "free_road"
  | "bridge"
  | "dev_card"
  | "progress_card";

export const FISH_SPENDS: readonly FishSpend[] = [
  "wagon_boost",
  "remove_robber",
  "steal",
  "take_resource",
  "free_road",
  "bridge",
  "dev_card",
  "progress_card",
];

/** Price in fish, mirroring engine/scenarios/fishermen.go's `fishCosts`. */
export const FISH_COSTS: Record<FishSpend, number> = {
  wagon_boost: 2,
  remove_robber: 2,
  steal: 3,
  take_resource: 4,
  free_road: 5,
  // Alongside Rivers only (engine/scenarios `FishBridge`, `FishBridgeCost`).
  bridge: 6,
  dev_card: 7,
  progress_card: 7,
};

/**
 * The most fish tiles one seat may hold (engine/scenarios/fishermen.go).
 *
 * A count of tiles, not fish: seven 3-fish tiles is legal, eight 1-fish tiles
 * is not. A seat at the cap draws nothing on a catch; instead the engine may
 * swap one of its 1-fish tiles for a fresh draw, once per turn.
 */
export const FISH_TILE_CAP = 7;

/** A holding of fish tiles: how many 1-, 2- and 3-fish tiles are held. */
export type FishMix = readonly [number, number, number];

export const NO_FISH: FishMix = [0, 0, 0];

/** The fish value of a holding. */
export function fishTotal(mix: FishMix | undefined): number {
  if (!mix) return 0;
  return mix[0] + 2 * mix[1] + 3 * mix[2];
}

/** How many tiles a holding is made of. */
export function tileCount(mix: FishMix): number {
  return mix[0] + mix[1] + mix[2];
}

/**
 * Which tiles pay for `cost`, or null when the holding cannot cover it.
 *
 * Port of `spendTiles` in engine/scenarios/fishermen.go, brute force included: every
 * combination reaching the price is considered, and the winner wastes the
 * fewest fish, then uses the fewest tiles.
 *
 * There is no change: paying 2 with a single 3-fish tile destroys the spare
 * fish, so the panel has to show tiles, not just the price.
 */
export function spendTiles(mix: FishMix, cost: number): FishMix | null {
  let best: FishMix | null = null;
  let bestWaste = Infinity;
  let bestCount = Infinity;
  for (let c = 0; c <= mix[2]; c++) {
    for (let b = 0; b <= mix[1]; b++) {
      for (let a = 0; a <= mix[0]; a++) {
        const sum = a + 2 * b + 3 * c;
        if (sum < cost) continue;
        const waste = sum - cost;
        const count = a + b + c;
        if (waste < bestWaste || (waste === bestWaste && count < bestCount)) {
          bestWaste = waste;
          bestCount = count;
          best = [a, b, c];
        }
      }
    }
  }
  return best;
}

/**
 * Whether the Knights module currently has the robber out of play.
 *
 * A state, not a ruleset ban: under Knights the robber (and the 2-fish spend
 * that removes it) returns once the first barbarian attack lands
 * (`attacks === 0` is the lock).
 *
 * A robber that is merely off the board (where a Fishermen game starts it, and
 * where this spend leaves it) is just as unremovable; `fishOffers` checks both.
 */
export function robberSuppressed(view: FullView, caps: GameCaps): boolean {
  // Raiders is a ruleset ban: no robber or pirate all game, and the engine
  // refuses the spend before taking a tile, so the row is hidden.
  if (!caps.hasRobber) return true;
  if (!caps.hasKnights) return false;
  const x: KnightsExt | undefined = knightsExt(view);
  return (x?.attacks ?? 0) === 0;
}

/** One row of the spend panel: the price, the tiles it takes, and why not. */
export interface FishOffer {
  spend: FishSpend;
  cost: number;
  /** The tiles that would actually be handed in, or null when unaffordable. */
  pay: FishMix | null;
  /** Fish destroyed as overpayment. Nonzero is the thing the panel must say. */
  waste: number;
  affordable: boolean;
}

/**
 * The spends this game offers this seat right now, with the true cost of each.
 *
 * Spends the engine refuses outright (`SPEND_UNAVAILABLE`, no tile taken) are
 * left out rather than shown disabled:
 *
 *  - `dev_card` where there is no development deck (Knights), and
 *    `progress_card` where there is one. Exactly one is ever offered.
 *  - `remove_robber` with no robber on the board: Knights before the first
 *    barbarian attack (`robberSuppressed`), or any Fishermen game before the
 *    first 7 and after each such spend. These states end, so this is read per
 *    render.
 *
 * `free_road` is also dropped when this seat has no legal edge: the engine
 * checks the named edge against legal roads (and, under Islands, ships) and
 * answers ErrBadPlacement.
 *
 * `canBuild` makes that safe: `legal.roads` is only sent on the seat's own
 * turn, so its absence often means "not your turn". Pass the screen's build
 * gate (my turn, rolled, no interrupt owing); off turn the whole ladder shows,
 * and the panel cannot be opened anyway.
 *
 * Unaffordable spends are listed: the price is worth knowing.
 */
export function fishOffers(
  view: FullView,
  caps: GameCaps,
  mix: FishMix,
  canBuild: boolean,
): FishOffer[] {
  const noRobber = robberSuppressed(view, caps) || !robberOnBoard(view.board);
  // The credit buys a road or, under Islands, a ship; dead only if neither fits.
  const roadSpendOff =
    canBuild && (view.legal?.roads?.length ?? 0) === 0 && (view.legal?.ships?.length ?? 0) === 0;
  const out: FishOffer[] = [];
  for (const spend of FISH_SPENDS) {
    // The 7-fish rung: `dev_card` under Raiders too (the spend draws and
    // resolves one of its four cards), and `progress_card` only under Knights.
    if (spend === "dev_card" && !caps.hasDevCards && !caps.hasRaiders) continue;
    if (spend === "progress_card" && (caps.hasDevCards || caps.hasRaiders)) continue;
    if (spend === "remove_robber" && noRobber) continue;
    if (spend === "wagon_boost") {
      const wagon = wagonsExt(view);
      if (!wagon?.started || !wagon.has_trade || wagon.boosted || wagon.move_done) continue;
    }
    if (spend === "free_road" && roadSpendOff) continue;
    // The 6-fish bridge only with Rivers, and dropped while this seat has no
    // bridge site (the engine refuses an edge outside `legal.bridges` before
    // taking a tile).
    if (
      spend === "bridge" &&
      (!caps.hasRivers || (canBuild && (view.legal?.bridges?.length ?? 0) === 0))
    )
      continue;
    const cost = FISH_COSTS[spend];
    const pay = spendTiles(mix, cost);
    out.push({
      spend,
      cost,
      pay,
      waste: pay ? fishTotal(pay) - cost : 0,
      affordable: pay !== null,
    });
  }
  return out;
}

/**
 * The cheapest and dearest price the panel will actually offer, for the shelf
 * tile. Not the constant 2-7 of `FISH_COSTS`: `fishOffers` may drop the robber
 * removal, the free road, and one of the 7-fish cards. Null when nothing is on
 * offer.
 */
export function fishPriceRange(offers: readonly FishOffer[]): { min: number; max: number } | null {
  if (offers.length === 0) return null;
  const costs = offers.map((o) => o.cost);
  return { min: Math.min(...costs), max: Math.max(...costs) };
}

/**
 * A 5-fish spend that has left the client and is waiting to become a road.
 *
 * The engine validates the named edge and grants a road credit (`free_roads`
 * goes up, as with Road Building) but does not place the road. So the edge is
 * remembered with the credit count at spend time, and the build for that edge
 * is sent when the credit lands.
 */
export interface FishRoadPending {
  e: Edge;
  /** The command id of the spend, so its refusal can drop this. */
  ref: string;
  /** `free_roads` at the time of the spend: the credit is the count going past it. */
  owed: number;
}

/**
 * What to do with a pending 5-fish road now that the view moved.
 *
 *   "wait"  the credit has not arrived yet (and the spend was not refused);
 *   "build" the credit landed and the edge is a legal road: send `build_road`;
 *   "ship"  the same, for an edge that is a legal ship under Islands (the credit
 *           buys either piece, and the command must match);
 *   "drop"  forget it: the seat is no longer acting, the spend was refused (its
 *           id left the in-flight registry with no credit), or the edge is no
 *           longer legal, in which case the armed road mode lets the player
 *           pick again.
 *
 * Comparing against the count the spend saw, not zero, stops a Road Building
 * credit already in hand from placing the fish road early.
 */
export function fishRoadNext(
  pending: FishRoadPending,
  view: Pick<FullView, "free_roads" | "legal">,
  acting: boolean,
  spendInFlight: boolean,
): "wait" | "build" | "ship" | "drop" {
  if (!acting) return "drop";
  const owed = view.free_roads ?? 0;
  if (owed <= pending.owed) return spendInFlight ? "wait" : "drop";
  const k = edgeKey(pending.e);
  if ((view.legal?.roads ?? []).some((r) => edgeKey(r) === k)) return "build";
  if ((view.legal?.ships ?? []).some((r) => edgeKey(r) === k)) return "ship";
  return "drop";
}

/** The viewer's own fish tile mix, or an empty holding when the server withholds it. */
export function myFishMix(view: FullView): FishMix {
  return fishExt(view)?.mix ?? NO_FISH;
}

/**
 * How many fish tiles a seat holds, which the table can count. Their value is
 * private: see FishExt.tiles.
 */
export function seatFishTiles(view: FullView, seat: number): number {
  return fishExt(view)?.tiles?.[seat] ?? 0;
}

/**
 * A seat's tiles in a revealed replay of a finished game, or null in every live
 * view (including a spectator's, and the viewer's own seat, which reads
 * `myFishMix`).
 */
export function revealedFishMix(view: FullView, seat: number): FishMix | null {
  return fishExt(view)?.mixes?.[seat] ?? null;
}

/** One lake and the numbers it pays fish on, ascending. */
export interface LakeNumbers {
  hex: Hex;
  numbers: number[];
}

/**
 * Every lake on the board and what it pays on, in board order.
 *
 * Since derivation 13 a table of five or more has extra lakes paying on 4 and
 * 10 rather than 2, 3, 11 and 12, so each lake's set comes from `lakes`. Older
 * games send only `lake_numbers`, used as the fallback only when `lakes` is
 * absent (a lake missing from the list pays on nothing).
 *
 * Read from the wire rather than a copy of `scenarios.LakeNumbers`. A lake with no
 * numbers is left out, so an older server's board draws no chip rather than a
 * wrong one.
 */
export function lakeNumbers(view: FullView): LakeNumbers[] {
  const fx = fishExt(view);
  if (!fx) return [];
  const own = fx.lakes ? new Map(fx.lakes.map((l) => [hexKey(l.hex), l.numbers])) : null;
  const out: LakeNumbers[] = [];
  for (const tile of view.board?.tiles ?? []) {
    if (tile.res !== "lake") continue;
    const numbers = own ? (own.get(hexKey(tile.hex)) ?? []) : (fx.lake_numbers ?? []);
    if (numbers.length > 0) out.push({ hex: tile.hex, numbers });
  }
  return out;
}

/** The seat holding the old boot, or -1 when nobody does. */
export function bootHolder(view: FullView): number {
  const h = fishExt(view)?.boot_holder ?? -1;
  return h < 0 ? -1 : h;
}

/**
 * The seats the 3-fish steal may name as its victim.
 *
 * Two checks. The hand: `DiscardableCount` is module-aware, so a Knights seat
 * holding only commodities is a legal target. The friendly-robber shield: a
 * seat still at its starting public score cannot be stolen from by any effect,
 * the fish steal included.
 *
 * `vpOf` is the public score (as in `bootTargets`), since that is what the
 * engine compares; a hidden VP card must not move the shield.
 */
export function fishStealVictims(
  view: FullView,
  actorSeat: number,
  cardsHeld: (seat: number) => number,
  vpOf: (seat: number) => number,
): number[] {
  const shield = friendlyShieldMaxVP(view);
  return (view.players ?? [])
    .map((p) => p.seat)
    .filter((seat) => seat !== actorSeat && cardsHeld(seat) > 0)
    .filter((seat) => shield === null || vpOf(seat) > shield);
}

/**
 * The seats the boot may be passed to, by public victory points.
 *
 * The engine compares `PublicVPWithModules`, so the set is "at least as well as
 * me in public"; using a private total would offer seats the server refuses.
 */
export function bootTargets(
  view: FullView,
  holder: number,
  vpOf: (seat: number) => number,
): number[] {
  if (holder < 0) return [];
  const mine = vpOf(holder);
  const out: number[] = [];
  for (let seat = 0; seat < (view.players?.length ?? 0); seat++) {
    if (seat === holder) continue;
    if (vpOf(seat) >= mine) out.push(seat);
  }
  return out;
}
