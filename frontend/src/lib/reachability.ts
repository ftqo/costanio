// Pure gating helpers for the in-game dock. They mirror the engine's rules so
// the UI offers legal actions and withholds illegal ones, testable without
// rendering a component.
import {
  knightsExt,
  explorersExt,
  islandsExt,
  publicVp,
  RES_INDEX,
  type FullView,
  type LegalTargets,
  type Vertex,
} from "./types";
import { progressCardName, progressCardTargetsBoard } from "./progressCards";
import { COST } from "./costs";
import { DEV_CARDS } from "./cardText";
import { devNotHeld, improvementShortText } from "./cardPhrases";
import { resourceShortfall } from "./errorCopy";
import type { ComKey } from "./cardFace";
import { hexKey, vertexHexes, vertexKey } from "./hexgeo";
import { t } from "@lingui/core/macro";
import { wagonMovingClosesBuilding } from "./moduleGates";

// canPlayDev: a player may play a development/progress card in their play phase
// when no forced robber/discard step is pending and they have not played one
// this turn. Rolling is not required. The engine still enforces the
// not-bought-this-turn and one-per-turn rules.
export function canPlayDev(s: {
  myTurn: boolean;
  phase: string;
  robberPending: boolean;
  needDiscard: boolean;
  playedDev: boolean;
}): boolean {
  return s.myTurn && s.phase === "play" && !s.robberPending && !s.needDiscard && !s.playedDev;
}

// Progress cards that may only be played before the roll. Alchemist sets the
// dice, so it is the only one.
export const PLAYABLE_PREROLL: ReadonlySet<string> = new Set(["alchemist"]);

/**
 * Whether a progress card can be played given the roll state.
 *
 * The engine has two exclusive branches (engine/knights/progress_play.go,
 * `decidePlayProgress`):
 *
 *     if d.Card == CardAlchemist { if s.Rolled { return ErrNotBeforeRoll } }
 *     else if !s.Rolled          { return engine.ErrMustRoll }
 */
export function progressPlayableNow(card: string, rolled: boolean): boolean {
  return PLAYABLE_PREROLL.has(card) ? !rolled : rolled;
}

// progressHasBoardTargets: for a board-targeting progress card (the
// `boardTargets` field in lib/progressCards), whether the server offers it at
// least one position in `legal.progress_targets`. The server omits a card with
// none (Medicine when the discounted upgrade is unaffordable). Cards that take
// no board input, or a view with no legal data yet, return true.
export function progressHasBoardTargets(card: string, legal: LegalTargets | undefined): boolean {
  if (!legal || !progressCardTargetsBoard(card)) return true;
  const t = legal.progress_targets?.[card];
  if (!t) return false;
  return (t.hexes?.length ?? 0) > 0 || (t.vertices?.length ?? 0) > 0 || (t.edges?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Why a card is dim, and why a lit one may still do nothing.
// ---------------------------------------------------------------------------
//
// progressPlayableReason is the gate: non-null means the button is disabled and
// this is why ("not rolled", "not your turn", "no target", ...). Its last step
// is progressNoEffectReason: a card playable in every other sense that would do
// nothing. The engine refuses those (ErrCardNoEffect, engine/knights/
// progress_play.go) instead of spending the card, so the dock disables them too;
// see docs/rules/knights.md, "Two things you may not do with a card".
//
// Everything below uses data already on the wire and mirrors a rule the server
// enforces.

/** Seats other than the viewer, as their player rows. */
function opponents(view: FullView) {
  return view.players.filter((p) => p.seat !== view.viewer);
}

/** Seats strictly ahead of the viewer on the number the engine compares. */
export function seatsAheadOfViewer(view: FullView): number[] {
  const me = view.players.find((p) => p.seat === view.viewer);
  if (!me) return [];
  const mine = publicVp(me);
  return opponents(view)
    .filter((p) => publicVp(p) > mine)
    .map((p) => p.seat);
}

/**
 * Seats the Spy may look at: an opponent holding at least one progress card.
 *
 * `progress_count` is public (engine/knights/views.go), and the engine returns
 * ErrBadVictim for a victim with no progress cards
 * (engine/knights/progress_play.go, `case CardSpy`).
 */
export function spyVictimSeats(view: FullView): number[] {
  const x = knightsExt(view);
  return opponents(view)
    .filter((p) => (x?.players?.[p.seat]?.progress_count ?? 0) > 0)
    .map((p) => p.seat);
}

/** Seats the Deserter may target: an opponent who owns a knight, of any level. */
export function deserterVictimSeats(view: FullView): number[] {
  const x = knightsExt(view);
  return opponents(view)
    .filter((p) => x?.knights?.some((k) => k.owner === p.seat) ?? false)
    .map((p) => p.seat);
}

/**
 * The tiers the viewer may place an owed Deserter replacement at: every level
 * from 1 up to the owed ceiling (`deserter_level`) with a free piece. The card
 * reads "one of your knights of the same strength or lower", and
 * `decideDeserterPlace` (engine/knights/decide.go) accepts any of these; an omitted
 * level takes the ceiling. Empty when nothing is owed.
 */
export function deserterTiers(view: FullView): number[] {
  const x = knightsExt(view);
  const ceiling = x && x.deserter_taker === view.viewer ? (x.deserter_level ?? 0) : 0;
  const out: number[] = [];
  for (let lvl = 1; lvl <= ceiling; lvl++) {
    const fielded = x!.knights.filter((k) => k.owner === view.viewer && k.level === lvl).length;
    if (fielded < 2) out.push(lvl); // two pieces per tier (engine knightsPerLevel)
  }
  return out;
}

/**
 * How many opponents a Commercial Harbor play could force.
 *
 * Mirrors `harborTargetCount` (engine/knights/progress_play.go): every other seat
 * holding a commodity, capped by the taker's resource count, since each target
 * costs one resource. A ceiling, not a quota: the taker may skip opponents.
 * The dialog defaults to it, and the dock uses it to spot a card that would do
 * nothing.
 */
export function harborTargetCount(view: FullView): number {
  const x = knightsExt(view);
  const holders = opponents(view).filter(
    (p) => (x?.players?.[p.seat]?.commodity_count ?? 0) > 0,
  ).length;
  return Math.min(holders, viewerResourceCount(view));
}

/** The viewer's total resource cards. Public, and exact for one's own seat. */
function viewerResourceCount(view: FullView): number {
  return view.players.find((p) => p.seat === view.viewer)?.hand_count ?? 0;
}

/**
 * What pressing the Wall shop tile should do.
 *
 * A wall goes on an existing city, and which city matters (a walled city holds
 * two extra cards past the discard limit, and barbarians pillage unwalled cities
 * first). The command carries the vertex (engine/knights/decide.go
 * `decideBuildWall`); omitting it falls back to the first unwalled city in board
 * order, which would read as the game choosing for the player.
 *
 * - none: no legal target. The tile is disabled anyway (Game.tsx `canWall`).
 * - build: exactly one unwalled city. One click, with the vertex named
 *   explicitly rather than left to the server's fallback.
 * - select: two or more. Arm "wall" mode and let the board highlight them, as
 *   the settlement/city/knight tiles do.
 */
export type WallShopIntent =
  | { kind: "none" }
  | { kind: "build"; v: Vertex }
  | { kind: "select"; targets: Vertex[] };

export function wallShopIntent(legal: LegalTargets | undefined): WallShopIntent {
  const targets = legal?.walls ?? [];
  if (targets.length === 0) return { kind: "none" };
  if (targets.length === 1) return { kind: "build", v: targets[0] };
  return { kind: "select", targets };
}

/**
 * The commodity each improvement track spends. Trade→cloth(0), Politics→coin(2),
 * Science→paper(1), matching `commodityForTrack` (engine/knights/knights.go) against the
 * wire order of `KnightsPlayer.commodities` (cloth, paper, coin).
 */
export const TRACK_COMMODITY: readonly number[] = [0, 2, 1];

/** The three commodities as their card keys, in the wire order above. */
const COM_KEY: readonly ComKey[] = ["cloth", "paper", "coin"];

/**
 * What upgrading `track` costs the viewer right now, at the normal price and
 * with the Crane's discount.
 *
 * `cost = level + 1`, and the Crane subtracts one with a floor of zero
 * (engine/knights/decide.go, `decideImprove(..., crane=true)`), so a Crane taking a
 * track to level 1 is free.
 */
export function improvementCost(level: number, crane: boolean): number {
  const cost = level + 1;
  return crane ? Math.max(0, cost - 1) : cost;
}

/**
 * The tracks a Crane play would be accepted on.
 *
 * `legal.improvements` is the engine's structural answer (own a city, below the
 * level cap, a metropolis-free city when the next level would claim one;
 * engine/knights/hooks.go) and excludes the commodity cost. Affordability is applied
 * here at the discounted price, which is why the upgrade tile's own check
 * cannot be reused.
 */
export function craneTracks(view: FullView): number[] {
  const x = knightsExt(view);
  const me = x?.players?.[view.viewer];
  const structural = view.legal?.improvements;
  const out: number[] = [];
  for (let t = 0; t < 3; t++) {
    if (structural && !structural.includes(t)) continue;
    const level = me?.improve?.[t] ?? 0;
    const need = improvementCost(level, true);
    const held = me?.commodities?.[TRACK_COMMODITY[t]] ?? 0;
    if (held < need) continue;
    out.push(t);
  }
  return out;
}

/**
 * Cities the viewer owns, split by whether one already carries a metropolis.
 *
 * The engine needs a city to improve a track at all, and a metropolis-free city
 * for a level that would place one (engine/knights/hooks.go, `metropolisClaim`).
 * `legal.improvements` folds both into one yes/no; these counts say which.
 */
function viewerCities(view: FullView): { cities: number; free: number } {
  const me = knightsExt(view)?.players?.[view.viewer];
  // `metropolis_at` carries a vertex per track whether or not the track has one,
  // so only trust it where `metropolis[t]` is set.
  const metros = new Set(
    (me?.metropolis ?? []).flatMap((has, t) => {
      const at = me?.metropolis_at?.[t];
      return has && at ? [vertexKey(at)] : [];
    }),
  );
  let cities = 0;
  let free = 0;
  for (const b of view.buildings) {
    if (b.owner !== view.viewer || !b.city) continue;
    cities++;
    if (!metros.has(vertexKey(b.v))) free++;
  }
  return { cities, free };
}

/** The 7's move that blocks a card, naming the pirate where it is the choice. */
function robberFirst(view: FullView): string {
  return (view.legal?.pirate_hexes?.length ?? 0) > 0
    ? t`Move the robber or the pirate first.`
    : t`Move the robber first.`;
}

/**
 * Why the viewer cannot buy the next level on `track` right now, or null when
 * nothing on this list is in the way.
 *
 * The structural block matters most: level 4 needs a metropolis-free city, so a
 * player whose only city has one is refused by a rule the tile cannot show.
 *
 * Silent about whose turn it is and whether the dice were rolled: the whole
 * shelf greys out between turns and the turn banner already says so. `crane`
 * prices the question at the card's discount.
 */
export function improvementBlockReason(
  track: number,
  view: FullView,
  crane: boolean,
): string | null {
  const me = knightsExt(view)?.players?.[view.viewer];
  const level = me?.improve?.[track] ?? 0;
  if (level >= 5) return t`Already at the maximum level.`;
  const need = improvementCost(level, crane);
  const held = me?.commodities?.[TRACK_COMMODITY[track]] ?? 0;
  // One message per commodity with the count as an ICU plural, so the noun can
  // agree with it. See lib/cardPhrases.
  if (held < need) return improvementShortText(COM_KEY[TRACK_COMMODITY[track]], need, held);
  // The engine's own answer; which structural rule refused is then read off the
  // board. A view with no `legal` at all (a spectator, or nothing sent yet) is
  // not a refusal, as in craneTracks. A `legal` with no `improvements` is: the
  // server omits an empty list, and empty refuses every track (e.g. after
  // losing your only city to the barbarians).
  const structural = view.legal ? (view.legal.improvements ?? []) : undefined;
  if (!structural || structural.includes(track)) return null;
  const { cities, free } = viewerCities(view);
  if (cities === 0) return t`You need a city before you can improve a track.`;
  // Only a level that places a metropolis (4th and 5th) needs a free city.
  if (free === 0 && level + 1 >= 4)
    return t`This level places a metropolis, and every city you own already has one. Build another city first.`;
  // Refused for a reason not modelled here; say nothing rather than the wrong
  // thing.
  return null;
}

/**
 * Why this progress card cannot be played right now, or null when it can.
 *
 * Ordered as a player experiences the turn: whose turn, what is blocking it,
 * then the card's own requirement.
 */
export function progressPlayableReason(card: string, view: FullView): string | null {
  const name = progressCardName(card);
  if (view.viewer < 0) return t`You're spectating this game.`;
  if (view.cur !== view.viewer) return t`Not your turn.`;
  if (view.phase !== "play") return t`Cards can't be played during setup.`;
  if ((view.pending_discards?.[view.viewer] ?? 0) > 0)
    return t`Discard down to your hand limit first.`;
  if (view.robber_pending) return robberFirst(view);
  if (!progressPlayableNow(card, !!view.rolled)) {
    return PLAYABLE_PREROLL.has(card)
      ? t`${name} has to be played before you roll. It sets the dice.`
      : t`Roll the dice first.`;
  }
  if (!progressHasBoardTargets(card, view.legal))
    return (
      specificTargetReason(card, view) ??
      t`${name}: nothing on the board is a legal target right now.`
    );
  return progressNoEffectReason(card, view);
}

/**
 * Why a card's target list is empty, when the board is not the reason.
 *
 * The server's list for Medicine is also gated on the discounted upgrade cost
 * and the city supply (engine/knights/hooks.go), so "nothing on the board" would be
 * the wrong explanation for a player with settlements but no ore.
 *
 * Like the location menu's reason ladder, this only picks the sentence for a
 * refusal the engine already made, from state the view shows directly.
 */
function specificTargetReason(card: string, view: FullView): string | null {
  if (card !== "medicine") return null;
  const me = view.players.find((p) => p.seat === view.viewer);
  if (!me) return null;
  if ((me.cities_left ?? 1) === 0) return t`You have no city pieces left.`;
  const short = Object.entries(COST.medicineCity).filter(([i, n]) => (me.hand?.[+i] ?? 0) < n);
  if (short.length === 0) return null;
  return t`Medicine upgrades a settlement for 2 ore and 1 wheat, and you cannot cover that yet.`;
}

/**
 * The viewer's held progress cards that the engine would accept right now.
 *
 * Used by the over-limit prompt, which may offer playing a card instead of
 * discarding (docs/rules/knights.md; `decidePlayProgress` skips the over-limit
 * check). Playing still needs your turn, the play phase and the roll (Alchemist
 * inverted), so off-turn the only choice is to discard. Off-turn is common: gate
 * draws and tied-defender draws happen on any player's roll
 * (`playersFromCurrent`, engine/knights/hooks.go).
 */
export function playableProgressCards(view: FullView): string[] {
  const held = knightsExt(view)?.players?.[view.viewer]?.progress ?? [];
  return held.filter((card) => progressPlayableReason(card, view) === null);
}

/** A seat's combined resource and commodity count: both are public. */
function combinedCount(view: FullView, seat: number): number {
  const p = view.players.find((q) => q.seat === seat);
  return (p?.hand_count ?? 0) + (knightsExt(view)?.players?.[seat]?.commodity_count ?? 0);
}

/**
 * Why a playable card would do nothing, or null when it would do something or
 * we cannot tell. Each arm mirrors a refusal in `cardEffects`
 * (engine/knights/progress_play.go): ErrCardNoEffect, or for Master Merchant, Spy,
 * Deserter and Crane the argument error returned when no target exists. Only
 * public information is used; a monopoly on a resource opponents turn out not
 * to hold depends on hidden information and is still accepted.
 */
export function progressNoEffectReason(card: string, view: FullView): string | null {
  const x = knightsExt(view);
  switch (card) {
    case "master_merchant": {
      const ahead = seatsAheadOfViewer(view);
      if (ahead.length === 0) return t`Nobody is ahead of you in public victory points.`;
      return ahead.every((s) => combinedCount(view, s) === 0)
        ? t`Nobody ahead of you is holding a card to take.`
        : null;
    }
    case "wedding": {
      const ahead = seatsAheadOfViewer(view);
      if (ahead.length === 0) return t`Nobody is ahead of you in public victory points.`;
      return ahead.every((s) => combinedCount(view, s) === 0)
        ? t`Nobody ahead of you is holding a card to give.`
        : null;
    }
    case "saboteur": {
      const me = view.players.find((p) => p.seat === view.viewer);
      const mine = me ? publicVp(me) : 0;
      const level = opponents(view).filter((p) => publicVp(p) >= mine);
      if (level.length === 0) return t`Nobody is level with or ahead of you.`;
      return level.every((p) => combinedCount(view, p.seat) < 2)
        ? t`Nobody level with or ahead of you holds enough cards to discard.`
        : null;
    }
    case "spy":
      return spyVictimSeats(view).length === 0
        ? t`No opponent is holding a progress card to take.`
        : null;
    case "deserter":
      return deserterVictimSeats(view).length === 0
        ? t`No opponent has a knight to give up.`
        : null;
    case "commercial_harbor": {
      if (viewerResourceCount(view) === 0) return t`You hold no resources to offer.`;
      return harborTargetCount(view) === 0 ? t`No opponent is holding a commodity.` : null;
    }
    case "crane":
      return craneTracks(view).length === 0
        ? t`No improvement track you could take even at the discounted price.`
        : null;
    case "trade_monopoly":
      return opponents(view).every((p) => (x?.players?.[p.seat]?.commodity_count ?? 0) === 0)
        ? t`No opponent is holding a commodity.`
        : null;
    case "resource_monopoly":
      return opponents(view).every((p) => p.hand_count === 0)
        ? t`No opponent is holding a resource.`
        : null;
    case "warlord": {
      if (!x) return null;
      const mine = x.knights.filter((k) => k.owner === view.viewer);
      // "None of your knights is inactive" would imply they have some.
      if (mine.length === 0) return t`You have no knights on the board.`;
      return mine.some((k) => !k.active) ? null : t`None of your knights is inactive.`;
    }
    case "engineer": {
      // `case CardEngineer` refuses with ErrNeedCity / ErrMaxWalls.
      const cities = view.buildings.filter((b) => b.owner === view.viewer && b.city);
      if (cities.length === 0) return t`You have no city to put a wall on.`;
      if ((x?.players?.[view.viewer]?.walls ?? 0) >= 3)
        return t`All 3 of your city walls are already built.`;
      const walled = new Set((x?.walled ?? []).map(vertexKey));
      return cities.every((b) => walled.has(vertexKey(b.v)))
        ? t`Every one of your cities already has a wall.`
        : null;
    }
    case "smith": {
      // `smithPromotions`' `eligible`, for the board-order play.
      if (!x) return null;
      const mine = x.knights.filter((k) => k.owner === view.viewer);
      if (mine.length === 0) return t`You have no knights on the board.`;
      const politics = x.players?.[view.viewer]?.improve?.[1] ?? 0;
      const fielded = (lvl: number) => mine.filter((k) => k.level === lvl).length;
      const promotable = mine.some(
        (k) =>
          k.level < 3 &&
          !k.promoted_this_turn &&
          (k.level !== 2 || politics >= 3) &&
          fielded(k.level + 1) < 2,
      );
      return promotable ? null : t`None of your knights can be promoted right now.`;
    }
    case "road_building": {
      // `case CardRoadBuilding`: a road or (with Islands) a ship must fit.
      const legal = view.legal;
      if (!legal) return null;
      if ((legal.roads?.length ?? 0) + (legal.ships?.length ?? 0) > 0) return null;
      const sea = !!islandsExt(view);
      const me = view.players.find((p) => p.seat === view.viewer);
      const ships = islandsExt(view)?.ships_left?.[view.viewer] ?? 0;
      if ((me?.roads_left ?? 1) === 0 && ships === 0)
        return sea ? t`You have no road or ship pieces left.` : t`You have no road pieces left.`;
      return sea
        ? t`There is nowhere you could put a free road or ship.`
        : t`There is nowhere you could put a free road.`;
    }
    case "irrigation":
    case "mining": {
      const res = card === "irrigation" ? "wheat" : "ore";
      if ((view.bank?.[RES_INDEX[res]] ?? 1) === 0)
        return card === "irrigation"
          ? t`The supply has no wheat left.`
          : t`The supply has no ore left.`;
      const terrain = new Set(
        view.board.tiles.filter((tile) => tile.res === res).map((tile) => hexKey(tile.hex)),
      );
      const touches = view.buildings.some(
        (b) => b.owner === view.viewer && vertexHexes(b.v).some((h) => terrain.has(hexKey(h))),
      );
      if (touches) return null;
      return card === "irrigation"
        ? t`None of your buildings borders a Field hex.`
        : t`None of your buildings borders a Mountain hex.`;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The base five development cards.
// ---------------------------------------------------------------------------
//
// Same split as the progress cards: a hard gate that disables, and a soft
// warning that does not, because a base card with no effect still spends.

/**
 * The wire ids of the base development cards, in the order the `dev_cards` /
 * `new_dev_cards` hand arrays index them (engine/types.go `DevCard`).
 *
 * The array index is the wire format for the hand; the string id is the wire
 * format for the log (lib/cardText).
 */
export const DEV_CARD_IDS: readonly string[] = [
  "knight",
  "victory_point",
  "road_building",
  "year_of_plenty",
  "monopoly",
];

/** The Victory Point card is held, not played: it scores from the hand. */
export const DEV_HELD_ID = "victory_point";

/**
 * Why this development card cannot be played right now, or null when it can.
 *
 * Ordered as in `progressPlayableReason`. Rolling is not required (see
 * `canPlayDev`); the one-per-turn and bought-this-turn rules are the last two
 * clauses.
 */
export function devPlayableReason(
  card: string,
  view: FullView,
  hand: { ready: number; locked: number },
): string | null {
  const name = devCardName(card);
  if (card === DEV_HELD_ID) return t`${name} is never played. It already counts toward your score.`;
  if (view.viewer < 0) return t`You're spectating this game.`;
  if (view.cur !== view.viewer) return t`Not your turn.`;
  if (view.phase !== "play") return t`Cards can't be played during setup.`;
  if ((view.pending_discards?.[view.viewer] ?? 0) > 0)
    return t`Discard down to your hand limit first.`;
  if (view.robber_pending) return robberFirst(view);
  if (view.played_dev) return t`You've already played a development card this turn.`;
  if (hand.ready === 0 && hand.locked > 0)
    return t`Bought this turn, playable from your next turn.`;
  // One message per card so the article can agree with the card name. See
  // lib/cardPhrases.
  if (hand.ready === 0) return devNotHeld(card);
  return null;
}

/**
 * The card is playable and would achieve nothing. Not a gate: base cards still
 * spend on a play with no effect, unlike the Knights progress cards
 * (see `progressNoEffectReason`).
 *
 * Road Building with no pieces left: the engine accepts the play and sets
 * `FreeRoads`, then rejects every placement with `ErrNoPieces`.
 */
export function devEffectWarning(card: string, view: FullView): string | null {
  switch (card) {
    case "road_building": {
      const me = view.players.find((p) => p.seat === view.viewer);
      const roads = me?.roads_left ?? 0;
      const ships = islandsExt(view)?.ships_left?.[view.viewer] ?? 0;
      return roads === 0 && ships === 0
        ? t`You have no road or ship pieces left, so the free builds would go unused.`
        : null;
    }
    case "monopoly":
      return opponents(view).every((p) => p.hand_count === 0)
        ? t`No opponent is holding a resource, so this would discard the card for nothing.`
        : null;
    default:
      return null;
  }
}

/** Display name for a base development card, from the shared card vocabulary. */
export function devCardName(card: string): string {
  return DEV_CARDS[card]?.name ?? card;
}

/** Effect sentence for a base development card, from the shared card vocabulary. */
export function devCardHint(card: string): string {
  return DEV_CARDS[card]?.hint ?? "";
}

// ---------------------------------------------------------------------------
// The build shelf.
// ---------------------------------------------------------------------------
//
// Why a buildable tile is dark: no pieces, nowhere legal, short a resource, not
// rolled. Without this the cost on a dark tile suggests the price is the
// problem even when it is not, and on a phone there is no hover to ask.
//
// Like `specificTargetReason`, this decides nothing. The gates live in the game
// screen (with the optimistic-spend overlay and free-build state); this only
// picks the sentence. If the two disagree, the tile is right.

/** The resource names `resourceShortfall` keys by, in wire index order. */
const RES_NAME: Record<number, string> = {
  1: "wood",
  2: "brick",
  3: "sheep",
  4: "wheat",
  5: "ore",
};

/** What the shelf sells. `dev` is a card off the deck; the rest are pieces. */
export type Buildable =
  | "road"
  | "settlement"
  | "city"
  | "ship"
  | "dev"
  | "knight"
  | "wall"
  | "bridge"
  /** Explorers: the harbour-settlement upgrade. */
  | "harbour"
  /** Explorers: a cargo ship, launched beside a harbour settlement. */
  | "cargoship";

/**
 * The shortfall between a cost and a hand, as a sentence, or null when covered.
 *
 * Takes the hand the caller computed rather than reading `view`, because the
 * shelf subtracts an optimistic spend overlay the view does not know about yet.
 */
export function costShortfall(cost: Record<number, number>, held: (i: number) => number): string {
  const missing: Record<string, number> = {};
  for (const [i, n] of Object.entries(cost)) {
    const gap = n - held(+i);
    if (gap > 0) missing[RES_NAME[+i] ?? String(i)] = gap;
  }
  return Object.keys(missing).length ? resourceShortfall(missing) : "";
}

/**
 * Why this build is refused, or null when it is not.
 *
 * Ordered as the turn is experienced, matching `progressPlayableReason` and
 * `devPlayableReason`.
 *
 * `pieces` is null for a build with no piece supply (a development card), so
 * "you have no pieces left" cannot be said for it.
 */
export function buildBlockReason(
  what: Buildable,
  view: FullView,
  s: {
    /** The shared preconditions the tile itself was gated on. */
    ready: boolean;
    /** Pieces of this kind in the player's supply, or null when unlimited. */
    pieces: number | null;
    /** The shortfall sentence from `costShortfall`, or "" when affordable. */
    short: string;
    /** How many legal spots the server sent for this build. */
    legal: number;
    /** The deck still has cards. Only meaningful for `dev`. */
    deck?: number;
  },
): string | null {
  if (view.viewer < 0) return t`You're spectating this game.`;
  if (view.cur !== view.viewer) return t`Not your turn.`;
  if (view.phase !== "play") return t`Wait for setup to finish.`;
  if ((view.pending_discards?.[view.viewer] ?? 0) > 0)
    return t`Discard down to your hand limit first.`;
  if (view.robber_pending) return robberFirst(view);
  // Kept separate from `ready`: the most common reason a shelf is dark.
  if (!view.rolled) return t`Roll the dice first.`;
  // Explorers: once the ships sail, building is over for the turn.
  if (explorersExt(view)?.movement)
    return t`Building is over for this turn once the Movement phase starts.`;
  // Wagons: building waits while the wagon is on the move, and reopens when it
  // stops (engine/wagons blocksBuildTrade).
  if (wagonMovingClosesBuilding(view)) return t`You can't build while your wagon is moving.`;
  if (s.pieces === 0) return noPiecesLeft(what);
  if (s.short) return t`You need ${s.short}.`;
  if (what === "dev" && (s.deck ?? 1) === 0) return t`The development deck is empty.`;
  if (s.legal === 0) return nowhereToBuild(what);
  // Refused by something not modelled here; say nothing rather than the wrong
  // rule (as `improvementBlockReason` does).
  if (!s.ready) return null;
  return null;
}

/**
 * "You have no X left", one whole sentence per piece.
 *
 * A switch rather than `You have no ${name} left` so each sentence can have the
 * right article and agreement in translation (see lib/cardPhrases). A function
 * rather than a table because a module-level `t` is evaluated once at import, in
 * whatever language was active then.
 */
function noPiecesLeft(what: Buildable): string | null {
  switch (what) {
    case "road":
      return t`You have no road pieces left. Every road you own is already on the board.`;
    case "settlement":
      return t`You have no settlement pieces left. Upgrade one to a city to get a piece back.`;
    case "city":
      return t`You have no city pieces left.`;
    case "ship":
      return t`You have no ship pieces left. Every ship you own is already on the board.`;
    case "knight":
      return t`You have no knight pieces left.`;
    case "bridge":
      return t`You have built all three of your bridges. There are no more.`;
    case "harbour":
      return t`You have no harbour settlement pieces left.`;
    default:
      return null;
  }
}

/**
 * "There is nowhere to put one", with the rule that says why.
 *
 * These name the rule rather than restating the refusal: the dark tile already
 * shows the refusal. The distance and connectivity rules are the ones that most
 * often surprise players.
 */
function nowhereToBuild(what: Buildable): string | null {
  switch (what) {
    case "road":
      return t`Nowhere to build. A road has to extend your own network, and every spot next to it is taken.`;
    case "settlement":
      return t`Nowhere to build. A settlement needs an empty intersection on your road network, with every neighbouring intersection clear.`;
    case "city":
      return t`You have no settlement to upgrade. A city replaces one you already own.`;
    case "ship":
      return t`Nowhere to sail. A ship has to extend your own network along the coast or open sea.`;
    case "knight":
      return t`Nowhere to place a knight. One goes on an empty intersection of your road network.`;
    case "wall":
      return t`No city to wall. A wall goes on a city you already own, and each one takes only one.`;
    case "bridge":
      // Both rules: a bridge goes only where the river crosses a path, and it
      // must join your own network like a road.
      return t`Nowhere to bridge. A bridge goes only where the river crosses a path, and it has to join up with your own roads.`;
    case "harbour":
      return t`No settlement to upgrade. A harbour settlement replaces one of your own settlements on the coast.`;
    case "cargoship":
      return t`Nowhere to launch. A cargo ship goes on a sea edge beside one of your harbour settlements, with room for it.`;
    default:
      return null;
  }
}
