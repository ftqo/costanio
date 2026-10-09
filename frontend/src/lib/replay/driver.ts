// The replay transport, as a pure reducer.
//
// No React, canvas or timers: playback position and state are a value and a
// function over it, so the homepage loop and the /replay scrubber share one
// system and differ only in bounds and controls.
//
// Pacing (`holdMs`) lives here too, since how long a frame is held is part of
// the transport.

export interface Bounds {
  /** First playable index (inclusive). */
  first: number;
  /** Last playable index (inclusive). */
  last: number;
  /** Return to `first` after `last` instead of stopping. */
  loop?: boolean;
}

export interface DriverState {
  index: number;
  playing: boolean;
  /** Multiplier on the hold time; 2 means twice as fast. */
  speed: number;
}

export type Action =
  | { t: "play" }
  | { t: "pause" }
  | { t: "toggle" }
  | { t: "step"; by: number }
  | { t: "seek"; to: number }
  | { t: "speed"; to: number }
  | { t: "tick" };

export function clamp(b: Bounds, i: number): number {
  return Math.min(b.last, Math.max(b.first, i));
}

export function initial(b: Bounds, opts: { playing?: boolean; speed?: number } = {}): DriverState {
  return { index: b.first, playing: opts.playing ?? false, speed: opts.speed ?? 1 };
}

export function reduce(s: DriverState, a: Action, b: Bounds): DriverState {
  switch (a.t) {
    case "play":
      // Play at the end restarts, as video players do.
      return s.index >= b.last && !b.loop
        ? { ...s, index: b.first, playing: true }
        : { ...s, playing: true };
    case "pause":
      return { ...s, playing: false };
    case "toggle":
      return reduce(s, { t: s.playing ? "pause" : "play" }, b);
    case "step":
      // Stepping stops playback so the chosen frame stays put.
      return { ...s, index: clamp(b, s.index + a.by), playing: false };
    case "seek":
      return { ...s, index: clamp(b, a.to), playing: false };
    case "speed":
      return { ...s, speed: a.to };
    case "tick": {
      if (!s.playing) return s;
      if (s.index < b.last) return { ...s, index: s.index + 1 };
      return b.loop ? { ...s, index: b.first } : { ...s, playing: false };
    }
  }
}

/**
 * How long the frame at `eventType` is held, before the speed multiplier.
 *
 * A uniform hold makes a replay a slideshow: most of a log is bookkeeping the
 * board does not draw (turn boundaries, distribution, trade churn). Events that
 * move something get the airtime and the rest flash past.
 *
 * These are hold times, not animation lengths; the board owns its durations.
 */
const HOLD_MS: Record<string, number> = {
  // things you watch
  settlement_built: 900,
  settlement_placed: 900,
  city_built: 1000,
  road_built: 650,
  road_placed: 650,
  ship_built: 650,
  dice_rolled: 1100,
  robber_moved: 1000,
  knight_built: 800,
  knight_activated: 600,
  wall_built: 700,
  metropolis_built: 1100,
  game_finished: 2500,

  // things you notice
  card_stolen: 450,
  trade_offered: 400,
  trade_accepted: 450,
  monopoly_resolved: 700,
  year_of_plenty_resolved: 550,

  // bookkeeping: keep it moving
  turn_started: 160,
  turn_ended: 120,
  resources_distributed: 260,
  cards_discarded: 260,
};

/** Default hold for an event with no entry above. */
export const DEFAULT_HOLD_MS = 320;

export function holdMs(eventType: string | undefined, speed: number): number {
  // Not `eventType && HOLD_MS[...]`: an empty type name would yield "" rather
  // than the default.
  const base = eventType === undefined ? undefined : HOLD_MS[eventType];
  return Math.max(16, (base ?? DEFAULT_HOLD_MS) / (speed || 1));
}
