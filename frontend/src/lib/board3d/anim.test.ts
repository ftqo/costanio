import { describe, expect, it } from "vitest";
import { createTicker, type Ticker } from "./anim";

/** A hand-cranked requestAnimationFrame, so the loop can be stepped exactly. */
function harness(opts: { reduced?: boolean; visible?: boolean } = {}) {
  let next = 1;
  const pending = new Map<number, (ms: number) => void>();
  let draws = 0;
  /** Whether each draw was told to redraw the board, newest last. */
  const fulls: boolean[] = [];
  let gateChanged: (() => void) | null = null;
  const state = { reduced: !!opts.reduced, visible: opts.visible ?? true };

  const ticker: Ticker = createTicker({
    draw: (full: boolean) => {
      draws++;
      fulls.push(full);
    },
    request: (cb) => {
      const h = next++;
      pending.set(h, cb);
      return h;
    },
    cancel: (h) => void pending.delete(h),
    reducedMotion: () => state.reduced,
    documentVisible: () => state.visible,
    watchGates: (onChange) => {
      gateChanged = onChange;
      return () => (gateChanged = null);
    },
  });

  /** Run every scheduled callback once, at `ms`. */
  const step = (ms: number) => {
    for (const [h, cb] of [...pending]) {
      pending.delete(h);
      cb(ms);
    }
  };

  return {
    ticker,
    step,
    draws: () => draws,
    fulls: () => fulls,
    scheduled: () => pending.size,
    set: (k: "reduced" | "visible", v: boolean) => {
      state[k] = v;
      gateChanged?.();
    },
  };
}

describe("createTicker", () => {
  it("reports reduced motion live", () => {
    // `add` under the preference returns a no-op, which suits self-animating
    // things but not something that needs frames to finish applying input, so
    // the camera reads this instead.
    const h = harness({ reduced: true });
    expect(h.ticker.reducedMotion()).toBe(true);
    h.set("reduced", false);
    expect(h.ticker.reducedMotion()).toBe(false);
  });

  it("runs only while something is registered", () => {
    const h = harness();
    expect(h.ticker.isRunning()).toBe(false);
    const off = h.ticker.add(() => {});
    expect(h.ticker.isRunning()).toBe(true);
    off();
    expect(h.ticker.isRunning()).toBe(false);
    expect(h.scheduled()).toBe(0);
  });

  it("draws once per frame for any number of subscribers", () => {
    const h = harness();
    h.ticker.add(() => {});
    h.ticker.add(() => {});
    h.ticker.add(() => {});
    h.step(0);
    h.step(16);
    expect(h.draws()).toBe(2);
  });

  it("skips frames where nothing moved", () => {
    const h = harness();
    h.ticker.add(() => {}, { minIntervalMs: 100 });
    h.step(0);
    h.step(16);
    h.step(32);
    // Only the first frame is due: elapsed has not advanced 100ms yet.
    expect(h.draws()).toBe(1);
  });

  it("does not count time while stopped", () => {
    const h = harness();
    const seen: number[] = [];
    h.ticker.add((t) => seen.push(t.elapsedMs));
    h.step(0);
    h.step(20);
    h.set("visible", false);
    h.set("visible", true);
    // The tab was away for a minute of wall time; the clock must not move.
    h.step(60_020);
    h.step(60_040);
    expect(seen).toEqual([0, 20, 20, 40]);
  });

  it("clamps a stalled frame's delta", () => {
    const h = harness();
    const seen: number[] = [];
    h.ticker.add((t) => seen.push(t.dtMs));
    h.step(0);
    h.step(5000);
    expect(seen).toEqual([0, 100]);
  });

  it("never ticks under prefers-reduced-motion", () => {
    const h = harness({ reduced: true });
    let ticks = 0;
    h.ticker.add(() => void ticks++);
    h.step(0);
    h.step(16);
    expect(ticks).toBe(0);
    expect(h.ticker.isRunning()).toBe(false);
  });

  it("pauses while the board is out of view", () => {
    const h = harness();
    h.ticker.add(() => {});
    h.ticker.setVisible(false);
    expect(h.ticker.isRunning()).toBe(false);
    h.ticker.setVisible(true);
    expect(h.ticker.isRunning()).toBe(true);
  });

  it("stops with the tab", () => {
    const h = harness();
    h.ticker.add(() => {});
    h.set("visible", false);
    expect(h.ticker.isRunning()).toBe(false);
    h.set("visible", true);
    expect(h.ticker.isRunning()).toBe(true);
  });

  it("lets a subscriber unregister during its tick", () => {
    const h = harness();
    let ticks = 0;
    const off = h.ticker.add(() => {
      ticks++;
      off();
    });
    h.step(0);
    h.step(16);
    expect(ticks).toBe(1);
    expect(h.ticker.isRunning()).toBe(false);
  });

  it("throttles by whole frames", () => {
    // Comparing 1000/30 against a clock that advances in whole 120Hz frames
    // gives alternating four- and five-frame gaps, which shows as an uneven
    // swell.
    const h = harness();
    const at: number[] = [];
    h.ticker.add((t) => at.push(t.elapsedMs), { minIntervalMs: 1000 / 30 });
    const hz = 1000 / 120;
    for (let i = 0; i < 60; i++) h.step(i * hz);
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    // Every gap the same, and near the interval that was asked for.
    expect(new Set(gaps.map((g) => g.toFixed(4))).size).toBe(1);
    expect(gaps[0]).toBeCloseTo(4 * hz, 6);
  });

  it("keeps an even cadence at 60Hz", () => {
    const h = harness();
    const at: number[] = [];
    h.ticker.add((t) => at.push(t.elapsedMs), { minIntervalMs: 1000 / 30 });
    const hz = 1000 / 60;
    for (let i = 0; i < 40; i++) h.step(i * hz);
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    expect(new Set(gaps.map((g) => g.toFixed(4))).size).toBe(1);
    expect(gaps[0]).toBeCloseTo(2 * hz, 6);
  });

  it("draws one frame on invalidate", () => {
    // A camera drag is not an animation but changes the picture. Drawing
    // straight from the event handler would render twice in an animating frame.
    const h = harness();
    expect(h.ticker.isRunning()).toBe(false);
    h.ticker.invalidate();
    expect(h.ticker.isRunning()).toBe(true);
    h.step(0);
    expect(h.draws()).toBe(1);
    // One frame, then back to drawing on demand with no timer running.
    h.step(16);
    expect(h.draws()).toBe(1);
    expect(h.ticker.isRunning()).toBe(false);
  });

  it("collapses repeated invalidations into one frame", () => {
    const h = harness();
    h.ticker.add(() => {});
    for (let i = 0; i < 5; i++) h.ticker.invalidate();
    h.step(0);
    expect(h.draws()).toBe(1);
  });

  it("repaints on invalidate under reduced motion", () => {
    // Reduced motion covers motion the page invents, not the viewer turning
    // the camera.
    const h = harness({ reduced: true });
    h.ticker.invalidate();
    h.step(0);
    expect(h.draws()).toBe(1);
  });

  it("drops everything on dispose", () => {
    const h = harness();
    h.ticker.add(() => {});
    h.ticker.dispose();
    expect(h.ticker.isRunning()).toBe(false);
    expect(h.ticker.add(() => {})).toBeTypeOf("function");
    expect(h.ticker.isRunning()).toBe(false);
  });
});

describe("water-only frames", () => {
  it("a water-only subscriber keeps the cached board", () => {
    // The swell moves 4 meshes of 243, so a frame it causes alone must not
    // redraw the other 239.
    const h = harness();
    h.ticker.add(() => {}, { waterOnly: true });
    h.step(16);
    expect(h.draws()).toBe(1);
    expect(h.fulls()).toEqual([false]);
  });

  it("another subscriber on the same frame forces a redraw", () => {
    // When a falling piece and the swell tick together the frame must be full,
    // or the piece hangs over a stale cached board.
    const h = harness();
    h.ticker.add(() => {}, { waterOnly: true });
    h.ticker.add(() => {});
    h.step(16);
    expect(h.fulls()).toEqual([true]);
  });

  it("subscribers need a redraw by default", () => {
    // Default: a subscriber that does not say gets the full frame.
    const h = harness();
    h.ticker.add(() => {});
    h.step(16);
    expect(h.fulls()).toEqual([true]);
  });

  it("an invalidate forces a redraw beside the swell", () => {
    // `invalidate` means something other than the water changed (a hover, a
    // camera drag, a new board).
    const h = harness();
    h.ticker.add(() => {}, { waterOnly: true });
    h.ticker.invalidate();
    h.step(16);
    expect(h.fulls()).toEqual([true]);
  });

  it("a throttled swell that skips draws nothing", () => {
    // A frame with no due subscriber and no invalidate draws nothing.
    const h = harness();
    h.ticker.add(() => {}, { waterOnly: true, minIntervalMs: 100 });
    h.step(16);
    const after = h.draws();
    h.step(24);
    expect(h.draws()).toBe(after);
  });
});
