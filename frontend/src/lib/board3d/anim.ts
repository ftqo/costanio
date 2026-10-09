// The board's one animation clock.
//
// Board3D draws on demand: a click, drag, resize or server message calls
// `draw()` and nothing repaints in between, since the board is static most of
// the time.
//
// Several things animate (the ocean swell, a ghost piece cycling options, a
// piece dropping in). Rather than each running its own rAF loop, visibility
// gate, reduced-motion check and `renderer.render()`, they register here: each
// callback mutates what it owns and the ticker draws once per frame after all
// have run. When the last one unregisters the loop stops.
//
// No three.js here, so it tests without a GL context; the clock, gates and
// scheduling are injected.

/** What a subscriber is told each frame. */
export interface TickInfo {
  /**
   * Milliseconds of animated time since the ticker was created; time while the
   * loop was stopped (tab hidden, board off screen) does not count.
   *
   * Shared by every subscriber so things animating together stay in phase. A
   * subscriber that wants its own zero records its first `elapsedMs`.
   */
  elapsedMs: number;
  /** Animated time since this subscriber's previous tick. */
  dtMs: number;
}

export type Tick = (info: TickInfo) => void;

export interface TickOptions {
  /**
   * Roughly how long to leave between calls, in milliseconds. Default 0: every
   * frame.
   *
   * For slow motion like the swell, a third of a 90Hz display's frames looks
   * the same and costs a third as much. A skipped frame forces no redraw, so a
   * board where only throttled things animate draws at the throttled rate.
   *
   * Honoured by counting frames, not comparing the clock. An interval compared
   * against a clock that advances in whole frames beats against it (33.3ms on a
   * 120Hz display is sometimes four frames and sometimes five), which shows as
   * an uneven swell. Rounding to whole frames gives an even cadence at a
   * quantised rate.
   */
  minIntervalMs?: number;
  /**
   * This subscriber moves only the water, so its frame need not redraw the
   * board (the swell is 4 meshes of 243; see `oceanPass.ts`).
   *
   * Default false: anything that moves a piece, chip or the camera needs the
   * board redrawn, and a wrong `true` freezes that motion against a cached board.
   */
  waterOnly?: boolean;
}

export interface Ticker {
  /**
   * Start animating. Returns the unsubscribe; call it when the animation is
   * done or its object goes away.
   *
   * Under `prefers-reduced-motion` the callback is never called, not even at
   * t=0, so subscribers must already be in their still state when they
   * register (the ocean at its t=0 swell, a drop-in piece simply placed).
   */
  add(fn: Tick, opts?: TickOptions): () => void;
  /**
   * Draw one more frame without animating anything, for changes that are not
   * animations (camera drag, a hover). Calling `draw()` from the event handler
   * instead would render twice in a frame while something is animating, since
   * a fast pointer fires several events between rAF callbacks.
   *
   * Not gated by `prefers-reduced-motion`: that is about motion the page
   * invents, not the viewer turning the camera.
   */
  invalidate(): void;
  /**
   * Gate the loop on something outside it, in practice whether the board is on
   * screen. Subscriptions survive; only the loop stops.
   */
  setVisible(visible: boolean): void;
  /**
   * The shared clock, readable outside a tick. An animation started from an
   * event must record its start time in this clock, or it is offset by however
   * long the board has been hidden.
   */
  now(): number;
  /** True while the loop is actually scheduled. For tests and diagnostics. */
  isRunning(): boolean;
  /**
   * Whether the viewer has asked for no motion, read live.
   *
   * `add` returns a no-op under the preference, which suits things that
   * animate themselves but not ones that need frames to finish applying input.
   * The camera checks this and skips damping under the preference rather than
   * subscribing and stopping mid-glide.
   */
  reducedMotion(): boolean;
  /** Drop every subscription and stop. The rig calls this on teardown. */
  dispose(): void;
}

export interface TickerDeps {
  /**
   * Called once per frame, after every due subscriber has run.
   *
   * `full` is false only when the frame was caused solely by water-only
   * subscribers and nothing asked for a repaint, so the board behind the water
   * can come from cache. See `oceanPass.ts`.
   */
  draw: (full: boolean) => void;
  request?: (cb: (ms: number) => void) => number;
  cancel?: (handle: number) => void;
  /** Whether the viewer has asked for no motion. Read on every start. */
  reducedMotion?: () => boolean;
  /** Whether the document is visible. Read on every start. */
  documentVisible?: () => boolean;
  /**
   * Subscribe to changes in the two gates above; return the unsubscribe.
   *
   * Defaults to the document's events. A background tab throttles rAF but does
   * not reliably stop it, so hiding the tab must stop the loop explicitly.
   */
  watchGates?: (onChange: () => void) => () => void;
}

/**
 * The longest gap a single frame may advance the clock by. A throttled tab or
 * a stalled main thread can return a `dt` of seconds, and an animation
 * integrated over it would skip to the end. Clamping trades a moment of slow
 * motion for never skipping.
 */
const MAX_STEP_MS = 100;

/**
 * The display period assumed before one has been observed, in milliseconds,
 * and the range an observation is trusted within. 60Hz is the common case.
 * The clamp exists because the estimate is a divisor: one stalled frame must
 * not make the ticker think the display runs at 3Hz.
 */
const ASSUMED_FRAME_MS = 1000 / 60;
const MIN_FRAME_MS = 1000 / 240;
const MAX_FRAME_MS = 1000 / 20;

interface Sub {
  fn: Tick;
  interval: number;
  /** Whether a tick of this subscriber alone still needs the board redrawn. */
  waterOnly: boolean;
  /** Shared-clock time this subscriber was last called at. */
  last: number;
  /** Frame number this subscriber was last called on. See TickOptions. */
  lastFrame: number;
}

export function createTicker(deps: TickerDeps): Ticker {
  const request = deps.request ?? ((cb) => requestAnimationFrame(cb));
  const cancel = deps.cancel ?? ((h) => cancelAnimationFrame(h));
  const reduced =
    deps.reducedMotion ?? (() => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const docVisible = deps.documentVisible ?? (() => document.visibilityState === "visible");
  const watchGates =
    deps.watchGates ??
    ((onChange) => {
      const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
      document.addEventListener("visibilitychange", onChange);
      motion?.addEventListener?.("change", onChange);
      return () => {
        document.removeEventListener("visibilitychange", onChange);
        motion?.removeEventListener?.("change", onChange);
      };
    });

  const subs = new Set<Sub>();
  let handle = 0;
  let elapsed = 0;
  /** rAF timestamp of the previous frame; -1 when the loop just (re)started. */
  let stamp = -1;
  let visible = true;
  let disposed = false;
  /** Frames since the ticker was created. The clock throttling counts in. */
  let frameNo = 0;
  /** Smoothed display period, so an interval can be rounded to whole frames. */
  let period = ASSUMED_FRAME_MS;
  /** Whether `period` is still the guess. The first real gap replaces it. */
  let timed = false;
  /** Someone asked for a repaint that is not an animation. See `invalidate`. */
  let dirty = false;

  const frame = (ms: number) => {
    handle = request(frame);
    // A restart adds no elapsed time, so the swell does not jump forward by the
    // time spent in the background.
    const dt = stamp >= 0 ? Math.min(ms - stamp, MAX_STEP_MS) : 0;
    stamp = ms;
    elapsed += dt;
    frameNo++;
    if (dt > 0) {
      const seen = Math.min(MAX_FRAME_MS, Math.max(MIN_FRAME_MS, dt));
      // Snapped on the first real gap, smoothed after. Easing in from the 60Hz
      // guess would run a 120Hz display on the wrong divisor for the first second.
      period = timed ? period + (seen - period) * 0.2 : seen;
      timed = true;
    }

    let drew = dirty;
    // `invalidate()` means something other than the water changed, so the
    // frame is full.
    let full = dirty;
    dirty = false;
    // Snapshot: a subscriber may unsubscribe itself from its own tick (as a
    // landed drop does).
    for (const sub of [...subs]) {
      if (!subs.has(sub)) continue;
      // Whole frames, not milliseconds; see TickOptions.
      const every = sub.interval > 0 ? Math.max(1, Math.round(sub.interval / period)) : 1;
      if (frameNo - sub.lastFrame < every) continue;
      const info = { elapsedMs: elapsed, dtMs: elapsed - sub.last };
      sub.last = elapsed;
      sub.lastFrame = frameNo;
      sub.fn(info);
      drew = true;
      if (!sub.waterOnly) full = true;
    }
    if (drew) deps.draw(full);
    // A repaint with nothing subscribed was a one-off; stop again.
    if (!subs.size) sync();
  };

  const sync = () => {
    // `dirty` is outside the reduced-motion gate: the camera being dragged
    // must still redraw.
    const wanted = dirty || (subs.size > 0 && !reduced());
    const want = !disposed && wanted && visible && docVisible();
    if (want && !handle) {
      stamp = -1;
      handle = request(frame);
    } else if (!want && handle) {
      cancel(handle);
      handle = 0;
    }
  };

  const unwatch = watchGates(() => sync());

  return {
    add(fn, opts) {
      if (disposed || reduced()) return () => {};
      const interval = opts?.minIntervalMs ?? 0;
      // Due on the very next frame regardless of interval, so a throttled
      // subscriber draws its first state promptly.
      const sub: Sub = {
        fn,
        interval,
        waterOnly: opts?.waterOnly ?? false,
        last: elapsed - interval,
        lastFrame: -1e9,
      };
      subs.add(sub);
      sync();
      return () => {
        subs.delete(sub);
        sync();
      };
    },
    invalidate() {
      if (disposed) return;
      dirty = true;
      sync();
    },
    setVisible(v) {
      visible = v;
      sync();
    },
    now: () => elapsed,
    isRunning: () => handle !== 0,
    reducedMotion: () => reduced(),
    dispose() {
      disposed = true;
      subs.clear();
      sync();
      unwatch();
    },
  };
}
