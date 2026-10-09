// Cards travel.
//
// After a roll, each produced card flies from the hex that produced it to
// where it lands, showing which hex paid whom and how much while the player is
// looking at the board.
//
// This module is only the choreography: what a flight is, where a card is
// partway through one, and the order a batch leaves in. What the game did is
// derived in lib/cardFlightPlan, and the on-screen overlay is
// components/game/CardFlightLayer. Keeping it separate makes it testable with
// no DOM, camera or websocket, as drop.ts does for pieces.
import type { Hex } from "@/lib/types";
import { hexKey } from "@/lib/hexgeo";

/**
 * What is drawn on the card in flight.
 *
 * `hidden` is the correct face for a steal seen from outside: the engine
 * redacts the resource for everyone but thief and victim (game/views.go), so
 * spectators see a card back.
 */
export type CardFace =
  | { k: "res"; idx: number }
  | { k: "com"; idx: number }
  | { k: "dev" }
  | { k: "progress" }
  | { k: "hidden" };

/**
 * One end of a flight.
 *
 * A hex is a world position re-projected every frame; the rest are DOM anchors
 * resolved against the current HUD. One union because a trade is seat to seat,
 * production is hex to seat, and a bank trade is both in one batch.
 */
export type Endpoint =
  | { k: "hex"; hex: Hex }
  | { k: "seat"; seat: number }
  | { k: "bank" }
  | { k: "deck" };

export interface CardFlight {
  face: CardFace;
  /**
   * How many cards this flight stands for. 1 normally, so eight cards fly as
   * eight; only above FLIGHT_BULK_LIMIT does a flight carry a count.
   */
  count: number;
  from: Endpoint;
  to: Endpoint;
  /** Milliseconds after the batch starts that this card launches. */
  delayMs: number;
}

/**
 * How long one card is in the air: long enough to follow from a hex to a seat
 * across the viewport, short enough that a production round ends before the
 * player has read their hand. Slower than the piece drop (260ms + settle)
 * because both ends of a flight carry meaning.
 */
export const FLIGHT_MS = 520;

/**
 * The gap between two cards in the same batch leaving. Zero: a batch moves as
 * one, and three cards leaving together reads as "you got three".
 *
 * Unlike a dropped piece, which stays where it lands, a card can only be
 * counted while in the air, and the order (`choreograph` sorts by destination)
 * carries no meaning. A stagger also delayed the batch: a four-card payout ran
 * 210ms past the flight.
 *
 * Kept as a constant because `choreograph` still stamps a delay on every
 * flight, in case a batch needs to fan out again.
 */
export const FLIGHT_STAGGER_MS = 0;

/**
 * Above this many cards in one batch, flights collapse to counted cards.
 *
 * Nothing is dropped, only regrouped. A ten-player production round can move
 * thirty cards, which as separate flights reads as a slot machine. Twelve is
 * above a normal four-player roll and below where cards stop being countable
 * by eye.
 */
export const FLIGHT_BULK_LIMIT = 12;

/**
 * How far the flight bows, as a fraction of its length.
 *
 * The control point is lifted toward the top of the screen rather than along
 * the perpendicular, which flips side as travel passes vertical and would make
 * two cards from the same hex curve opposite ways.
 */
export const FLIGHT_ARC = 0.14;

/** How long the card takes to swell to full size after launch. */
const FLIGHT_GROW_MS = 90;

/** How long it spends shrinking into its destination. */
const FLIGHT_LAND_MS = 130;

/** The size it launches at, as a fraction of full. */
const FLIGHT_LAUNCH_SCALE = 0.55;

/** The size it arrives at. Below 1, so it reads as going into the hand. */
const FLIGHT_LAND_SCALE = 0.7;

/** Fade in, so a card does not pop into existence over the tile. */
const FLIGHT_FADE_IN_MS = 60;

/** Fade out, so it is absorbed rather than deleted. */
const FLIGHT_FADE_OUT_MS = 110;

/** A position on the canvas, in fractions of its box. See board3d/project. */
export interface ScreenPoint {
  fx: number;
  fy: number;
}

/** Where a card is partway through its flight. */
export interface FlightPose {
  /** 0 at the source, 1 at the destination, eased. */
  t: number;
  scale: number;
  opacity: number;
}

const PRE_LAUNCH: FlightPose = { t: 0, scale: FLIGHT_LAUNCH_SCALE, opacity: 0 };
const LANDED: FlightPose = { t: 1, scale: FLIGHT_LAND_SCALE, opacity: 0 };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * A card's pose `elapsedMs` into its own flight.
 *
 * Ease-out, unlike drop.ts's free fall: a thrown card gets its speed at the
 * start and coasts in, spending most of its time near the destination.
 *
 * Negative time is the not-yet-launched state, and past the end it is arrived,
 * so an extra tick returns the endpoint rather than extrapolating.
 */
export function flightPose(elapsedMs: number): FlightPose {
  if (elapsedMs <= 0) return PRE_LAUNCH;
  if (elapsedMs >= FLIGHT_MS) return LANDED;
  const raw = elapsedMs / FLIGHT_MS;
  const left = FLIGHT_MS - elapsedMs;
  // Two independent ramps taken at their minimum rather than multiplied; on a
  // short flight multiplying would keep the card from reaching full size.
  const grow =
    FLIGHT_LAUNCH_SCALE + (1 - FLIGHT_LAUNCH_SCALE) * clamp01(elapsedMs / FLIGHT_GROW_MS);
  const land = FLIGHT_LAND_SCALE + (1 - FLIGHT_LAND_SCALE) * clamp01(left / FLIGHT_LAND_MS);
  return {
    t: 1 - (1 - raw) ** 3,
    scale: Math.min(grow, land),
    opacity: Math.min(clamp01(elapsedMs / FLIGHT_FADE_IN_MS), clamp01(left / FLIGHT_FADE_OUT_MS)),
  };
}

/**
 * The point `t` of the way along a lobbed flight: a quadratic bezier whose
 * control point is the midpoint raised by `arc` of the flight's length. Length
 * is in canvas fractions, so a wide canvas bows slightly flatter than a tall
 * one, which suits the space available.
 */
export function arcPoint(
  from: ScreenPoint,
  to: ScreenPoint,
  t: number,
  arc = FLIGHT_ARC,
): ScreenPoint {
  const len = Math.hypot(to.fx - from.fx, to.fy - from.fy);
  const cx = (from.fx + to.fx) / 2;
  const cy = (from.fy + to.fy) / 2 - arc * len;
  const u = 1 - t;
  return {
    fx: u * u * from.fx + 2 * u * t * cx + t * t * to.fx,
    fy: u * u * from.fy + 2 * u * t * cy + t * t * to.fy,
  };
}

/** Stable identity for an endpoint, used for ordering and for grouping. */
export function endpointKey(e: Endpoint): string {
  switch (e.k) {
    case "hex":
      return `hex:${hexKey(e.hex)}`;
    // Zero-padded so seat 10 sorts after seat 2, keeping turn order.
    case "seat":
      return `seat:${String(e.seat).padStart(2, "0")}`;
    default:
      return e.k;
  }
}

/** Stable identity for a card face, used for ordering and for grouping. */
export function faceKey(f: CardFace): string {
  return f.k === "res" || f.k === "com" ? `${f.k}:${f.idx}` : f.k;
}

/**
 * One flight per (source, destination, face), counts summed. Only used above
 * FLIGHT_BULK_LIMIT. Grouping on all three keeps where each pile came from: two
 * wheat hexes paying one player stay two cards.
 */
export function collapseFlights(flights: readonly CardFlight[]): CardFlight[] {
  const byGroup = new Map<string, CardFlight>();
  for (const f of flights) {
    const k = `${endpointKey(f.from)}|${endpointKey(f.to)}|${faceKey(f.face)}`;
    const cur = byGroup.get(k);
    if (cur) cur.count += f.count;
    else byGroup.set(k, { ...f });
  }
  return [...byGroup.values()];
}

/**
 * Put a batch in flight order and stamp each card's launch offset.
 *
 * Sorted by destination, then source, then face, never emission order (as in
 * `dropStarts`), so a re-render cannot reshuffle cards already in the air, and
 * each player's take is grouped together.
 */
export function choreograph(flights: readonly CardFlight[]): CardFlight[] {
  const src = flights.length > FLIGHT_BULK_LIMIT ? collapseFlights(flights) : flights;
  return [...src]
    .map((f) => ({ f, k: `${endpointKey(f.to)}|${endpointKey(f.from)}|${faceKey(f.face)}` }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map(({ f }, i) => ({ ...f, delayMs: i * FLIGHT_STAGGER_MS }));
}

/** When the last card of a batch has landed, in milliseconds from its start. */
export function batchDurationMs(flights: readonly CardFlight[]): number {
  let last = 0;
  for (const f of flights) last = Math.max(last, f.delayMs);
  return flights.length ? last + FLIGHT_MS : 0;
}
