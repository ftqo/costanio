// A scenario card turned over at the table: Raiders' four (Muster, Swift Rider,
// Treason, Intrigue) and Wagons' Swift Journey. This module decides which
// events turn a card over, for whom, from where to where, and how far through
// its motion it is. CardRevealLayer handles the screen; this knows no DOM.
//
// What may be shown is decided by the server. Every reveal is read off an event
// payload the viewer was sent:
//
// - `raiders_card` is public (engine/raiders/events.go: "nothing in this
//   scenario is ever held in hand") and names its card. A payload with no
//   recognisable `card` reveals nothing.
// - `wagons_swift_bought` and `wagons_swift_played` are public by rule
//   (docs/rules/wagons.md); the event type names the card.
// - `dev_card_bought` is never read. A base development card stays hidden until
//   played; even the buyer's own face flies as a back (lib/cardFlightPlan).
//
// Nothing here guesses a card: a guessed card is a leaked card.
import type { GameEvent } from "./gamestate";
import { RAIDERS_CARDS, type CardKind } from "./cardText";
import { FLIGHT_MS } from "./board3d/cardflight";

/** Where the card comes from, or goes, before it is resolved to a rectangle. */
export type RevealEnd =
  /** The shelf tile the buyer pressed (the Muster tile, the development card tile). */
  | "shop"
  /** A seat's panel on the rail. For the viewer's own seat, that is their own panel. */
  | "seat"
  /** The viewer's hand: where a held card lives, and where it is played from. */
  | "hand"
  /** The prompt the game raises for the step the card starts. Buyer only. */
  | "prompt"
  /** The event log, where the line naming the card now carries its face. */
  | "log";

export interface Reveal {
  /** Stable per event and card: `${seq}:${index within the event}`. */
  key: string;
  kind: CardKind;
  id: string;
  /** The seat that drew, bought or played it. */
  seat: number;
  /** The viewer is that seat. */
  mine: boolean;
  act: "drew" | "bought" | "played";
  from: RevealEnd;
  to: RevealEnd;
  /** Revealed and discarded with no effect (engine `Void`): nothing follows it. */
  void: boolean;
}

const seatOf = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

/**
 * The reveals one batch of fresh events implies, in log order.
 *
 * `viewer` is the viewer's seat, or a negative number for a spectator, who is
 * shown every reveal as an opponent would be.
 */
export function revealsIn(evs: readonly GameEvent[], viewer: number): Reveal[] {
  const out: Reveal[] = [];
  for (const ev of evs) {
    const d = (ev.data ?? {}) as Record<string, unknown>;
    const seat = seatOf(d.player);
    if (seat == null) continue;
    const mine = viewer >= 0 && seat === viewer;
    const key = `${ev.seq}:0`;
    switch (ev.type) {
      case "raiders_card": {
        const id = typeof d.card === "string" ? d.card : "";
        // Only a card this client can name; a newer server's card is not shown
        // as a blank (the log is silent on it too).
        if (!Object.hasOwn(RAIDERS_CARDS, id)) continue;
        const isVoid = d.void === true;
        out.push({
          key,
          kind: "raiders",
          id,
          seat,
          mine,
          act: "drew",
          // A granted card (the Fishermen seven-fish grant) was not bought, so
          // it leaves the seat.
          from: mine && d.free !== true ? "shop" : "seat",
          // The buyer's card joins the prompt for the step it starts; a void
          // card starts nothing, so it goes to the log.
          to: mine && !isVoid ? "prompt" : "log",
          void: isVoid,
        });
        continue;
      }
      case "wagons_swift_bought":
        out.push({
          key,
          kind: "dev",
          id: "swift_journey",
          seat,
          mine,
          act: "bought",
          from: mine && d.free !== true ? "shop" : "seat",
          // Into the hand it is held in: the viewer's own, or the buyer's seat.
          to: mine ? "hand" : "seat",
          void: false,
        });
        continue;
      case "wagons_swift_played":
        out.push({
          key,
          kind: "dev",
          id: "swift_journey",
          seat,
          mine,
          act: "played",
          from: mine ? "hand" : "seat",
          to: "log",
          void: false,
        });
        continue;
      default:
        continue;
    }
  }
  return out;
}

// ---- the motion ----

/**
 * The card's journey to where the table is looking: the same 520ms eased arc as
 * the resource flights (lib/board3d/cardflight), so it reads as the same
 * gesture.
 */
export const REVEAL_TRAVEL_MS = FLIGHT_MS;
/** Face down until here: it leaves as the back of a card. */
export const REVEAL_FLIP_START_MS = 220;
/** Face up from here. */
export const REVEAL_FLIP_END_MS = 420;
/**
 * How long it is held face up after arriving: long enough to read who drew it
 * and the rule. Nothing ends it early or waits on it; the prompt stays live.
 */
export const REVEAL_HOLD_MS = 1500;
/** The trip from the hold to its resting place: the prompt, the log, the hand. */
export const REVEAL_EXIT_MS = 300;

/** Reduced motion: the face fades in where it is held, and out again. */
export const REVEAL_FADE_MS = 150;

/** An opponent's card is the same object, a little smaller. */
export const REVEAL_OPPONENT_SCALE = 0.8;

export function revealDurationMs(reduced: boolean): number {
  return reduced
    ? REVEAL_FADE_MS + REVEAL_HOLD_MS + REVEAL_FADE_MS
    : REVEAL_TRAVEL_MS + REVEAL_HOLD_MS + REVEAL_EXIT_MS;
}

export type RevealPhase = "travel" | "hold" | "exit" | "done";

/** Where the card is, `elapsedMs` into its own reveal. */
export interface RevealPose {
  phase: RevealPhase;
  /**
   * 0 at the source, 1 at the hold (travel); 0 at the hold, 1 at the resting
   * place (exit). Eased. Always 1 during the hold.
   */
  t: number;
  /** Degrees about the vertical axis: 180 is the back, 0 the face. */
  rotY: number;
  /** Of the held size. */
  scale: number;
  opacity: number;
  /** The caption (who, and the rule) is on screen. */
  caption: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (r: number) => 1 - (1 - r) ** 3;

/** The size the card leaves its tile at, of the held size. */
const LAUNCH_SCALE = 0.4;
/**
 * The end size, relative to the held size, when the caller does not measure
 * the resting place. Every resting place (prompt thumbnail, seat panel, log)
 * is smaller than the held card.
 */
export const REVEAL_REST_SCALE = 0.22;

export function revealPose(
  elapsedMs: number,
  opts: { reduced: boolean; to: RevealEnd; rest?: number },
): RevealPose {
  const rest = opts.rest ?? REVEAL_REST_SCALE;
  if (opts.reduced) {
    // No flight or turn: the face appears where it is held, then goes. A
    // docked card appears in the prompt on its own.
    const inEnd = REVEAL_FADE_MS;
    const outStart = inEnd + REVEAL_HOLD_MS;
    const end = outStart + REVEAL_FADE_MS;
    if (elapsedMs >= end)
      return { phase: "done", t: 1, rotY: 0, scale: 1, opacity: 0, caption: false };
    if (elapsedMs < inEnd) {
      return {
        phase: "travel",
        t: 1,
        rotY: 0,
        scale: 1,
        opacity: clamp01(elapsedMs / REVEAL_FADE_MS),
        caption: true,
      };
    }
    if (elapsedMs < outStart)
      return { phase: "hold", t: 1, rotY: 0, scale: 1, opacity: 1, caption: true };
    return {
      phase: "exit",
      t: 0,
      rotY: 0,
      scale: 1,
      opacity: 1 - clamp01((elapsedMs - outStart) / REVEAL_FADE_MS),
      caption: true,
    };
  }

  const holdStart = REVEAL_TRAVEL_MS;
  const exitStart = holdStart + REVEAL_HOLD_MS;
  const end = exitStart + REVEAL_EXIT_MS;
  if (elapsedMs >= end) {
    return { phase: "done", t: 1, rotY: 0, scale: rest, opacity: 0, caption: false };
  }
  if (elapsedMs < holdStart) {
    const raw = clamp01(elapsedMs / REVEAL_TRAVEL_MS);
    const turn = clamp01(
      (elapsedMs - REVEAL_FLIP_START_MS) / (REVEAL_FLIP_END_MS - REVEAL_FLIP_START_MS),
    );
    return {
      phase: "travel",
      t: easeOut(raw),
      rotY: 180 * (1 - turn),
      scale: LAUNCH_SCALE + (1 - LAUNCH_SCALE) * easeOut(raw),
      // A quick fade in, so it does not pop over the tile.
      opacity: clamp01(elapsedMs / 60),
      caption: false,
    };
  }
  if (elapsedMs < exitStart) {
    return { phase: "hold", t: 1, rotY: 0, scale: 1, opacity: 1, caption: true };
  }
  const raw = clamp01((elapsedMs - exitStart) / REVEAL_EXIT_MS);
  const t = easeOut(raw);
  // Into the prompt or a hand, the target takes over; toward the log it fades,
  // since the log line is the record.
  const fades = opts.to === "log";
  return {
    phase: "exit",
    t,
    rotY: 0,
    scale: 1 + (rest - 1) * t,
    opacity: fades ? 1 - 0.85 * t : raw < 0.9 ? 1 : 1 - (raw - 0.9) / 0.1,
    caption: false,
  };
}

// ---- the queue ----

/** A reveal with the moment it starts, in the clock the layer reads. */
export interface Scheduled {
  reveal: Reveal;
  startAt: number;
}

/**
 * Add a batch's reveals to what is already playing, one after another: a void
 * Intrigue and its redraw arrive together, and two faces turning in one spot
 * are unreadable. Each starts when the previous ends, or now.
 */
export function schedule(
  queue: readonly Scheduled[],
  fresh: readonly Reveal[],
  now: number,
  reduced: boolean,
): Scheduled[] {
  const dur = revealDurationMs(reduced);
  const live = queue.filter((s) => s.startAt + dur > now);
  let at = live.length ? Math.max(now, live[live.length - 1].startAt + dur) : now;
  const out = [...live];
  for (const r of fresh) {
    if (out.some((s) => s.reveal.key === r.key)) continue;
    out.push({ reveal: r, startAt: at });
    at += dur;
  }
  return out;
}

/**
 * Whether the viewer's own card is still on its way to the prompt. The prompt's
 * thumbnail stays empty until it lands, so the card reads as shrinking into it.
 */
export function dockPending(queue: readonly Scheduled[], now: number, reduced: boolean): boolean {
  const landAt = reduced
    ? REVEAL_FADE_MS + REVEAL_HOLD_MS
    : REVEAL_TRAVEL_MS + REVEAL_HOLD_MS + REVEAL_EXIT_MS;
  return queue.some((s) => s.reveal.mine && s.reveal.to === "prompt" && now < s.startAt + landAt);
}

// ---- the tab ----

/**
 * The card a seat drew most recently, for the "last drawn" tab on its seat
 * panel, or null.
 *
 * Read off the log, so it survives reloads. Lasts until that seat's next turn
 * begins. Only draws count (a Raiders card, or a Swift Journey bought), not
 * plays. Walks back from the newest event to the seat's own `turn_started`.
 */
export function lastDrawn(
  events: readonly GameEvent[],
  seat: number,
): { kind: CardKind; id: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const d = (ev.data ?? {}) as Record<string, unknown>;
    if (seatOf(d.player) !== seat) continue;
    if (ev.type === "turn_started") return null;
    if (ev.type === "raiders_card") {
      const id = typeof d.card === "string" ? d.card : "";
      if (Object.hasOwn(RAIDERS_CARDS, id)) return { kind: "raiders", id };
      continue;
    }
    if (ev.type === "wagons_swift_bought") return { kind: "dev", id: "swift_journey" };
  }
  return null;
}
