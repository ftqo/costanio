// The sword's two animations, and the diff that arms one of them.
//
// Pure units, no GL context, like flip and knightMotion. Most properties are
// about the ends of an animation: a pose that is not exactly the identity when
// it finishes leaves a permanent offset, and one that is not the identity at
// rest renders wrong under `prefers-reduced-motion`, where the ticker never
// calls back.
import { describe, test, expect } from "vitest";
import {
  KNIGHT_ART_HEIGHT,
  KNIGHT_GRIP,
  KNIGHT_GROW_MS,
  KNIGHT_GROW_OVERSHOOT,
  KNIGHT_GROW_RISE_MS,
  KNIGHT_GROW_START,
  knightGrowPose,
  newlyStoodDown,
  promoted,
  SWORD_FLIP_AXIS_Y,
  SWORD_GUARD_AT_EASE,
  SWORD_GUARD_READY,
  SWORD_LOWER_BOUNCE,
  SWORD_LOWER_FALL_MS,
  SWORD_LOWER_MS,
  SWORD_RAISE_MS,
  SWORD_REST_TILT,
  swordGuardTilt,
  swordLowerPose,
  swordPivot,
  swordRaisePose,
} from "./knightSword";
import { HOP_TOTAL_MS } from "./knightMotion";
import { DROP_BULK_LIMIT } from "./drop";

describe("swordRaisePose", () => {
  test("starts where the resting sword stood", () => {
    // The gold sword is built upright, so the raise's first frame must put it
    // exactly where the dark one was, or it jumps on activation.
    expect(swordRaisePose(0)).toEqual({ tilt: SWORD_REST_TILT, done: false });
    expect(swordRaisePose(-1000).tilt).toBe(SWORD_REST_TILT);
  });

  test("is not done on the frame it is armed", () => {
    // A carrier stops on the frame a pose reports `done`, so a raise armed on
    // its start frame would never turn.
    expect(swordRaisePose(0).done).toBe(false);
  });

  test("ends upright, exactly, and stays there", () => {
    // Exact zero: `poseInstanceAt` skips its rotation on a zero tilt, so the
    // sword returns to its built matrix rather than a rounded copy.
    for (const t of [SWORD_RAISE_MS, SWORD_RAISE_MS + 1, 60_000]) {
      expect(swordRaisePose(t)).toEqual({ tilt: 0, done: true });
    }
  });

  test("sweeps monotonically up, never past vertical", () => {
    let last = Infinity;
    for (let t = 0; t <= SWORD_RAISE_MS; t += 5) {
      const { tilt } = swordRaisePose(t);
      expect(tilt).toBeLessThanOrEqual(SWORD_REST_TILT + 1e-12);
      expect(tilt).toBeGreaterThanOrEqual(0);
      expect(tilt).toBeLessThanOrEqual(last + 1e-12);
      last = tilt;
    }
  });

  test("is eased at both ends rather than linear", () => {
    // Smoothstep, as in flip.ts: an arm lifting a weight eases at both ends.
    const at = (f: number) => swordRaisePose(SWORD_RAISE_MS * f).tilt;
    const linear = (f: number) => SWORD_REST_TILT * (1 - f);
    expect(at(0.1)).toBeGreaterThan(linear(0.1));
    expect(at(0.9)).toBeLessThan(linear(0.9));
    expect(at(0.5)).toBeCloseTo(linear(0.5), 9);
  });

  test("outlasts the hop it rides", () => {
    // The hop is coming to attention and the raise follows it; ending them
    // together made the sword look thrown up by the landing.
    expect(SWORD_RAISE_MS).toBeGreaterThan(HOP_TOTAL_MS);
  });

  test("rests leaning, not dead vertical", () => {
    // 180 degrees would drive the blade through the plinth; the hand is inside
    // its radius on every level.
    expect(SWORD_REST_TILT).toBeGreaterThan(Math.PI / 2);
    expect(SWORD_REST_TILT).toBeLessThan(Math.PI);
  });

  test("sweeps outward, which is what the axis choice buys", () => {
    // The axis is world +Z and the sword hangs on -x, so a positive tilt moves
    // the point away from the body. Every angle of the raise is positive, so
    // the sweep stays in open air.
    expect(SWORD_FLIP_AXIS_Y).toBeCloseTo(Math.PI / 2, 12);
    const outward = (tilt: number) => -Math.sin(tilt);
    for (let t = 1; t < SWORD_RAISE_MS; t += 20) {
      expect(outward(swordRaisePose(t).tilt)).toBeLessThanOrEqual(0);
    }
  });
});

describe("swordGuardTilt", () => {
  test("is exactly the identity when nothing is hovered", () => {
    // An unhovered knight keeps its built matrix in both states, which also
    // makes reduced motion correct.
    //
    // `Math.abs` because a negative angle times zero is -0, and
    // `poseInstanceAt`'s `if (pose.tilt)` treats -0 as zero too.
    expect(Math.abs(swordGuardTilt(true, 0))).toBe(0);
    expect(Math.abs(swordGuardTilt(false, 0))).toBe(0);
  });

  test("lifts a resting blade and dips a raised one", () => {
    // Signs, not sizes. Positive moves the point outward and down (see
    // SWORD_FLIP_AXIS_Y), so at ease must be negative: the point is on the
    // ground and can only go up.
    expect(swordGuardTilt(false, 1)).toBeLessThan(0);
    expect(swordGuardTilt(true, 1)).toBeGreaterThan(0);
  });

  test("neither state reaches the other's pose", () => {
    // The angle means activation, so a hover must never stand a dark sword up
    // or lay a gold one down.
    const atEase = SWORD_REST_TILT + swordGuardTilt(false, 1);
    expect(atEase).toBeGreaterThan(Math.PI / 3);
    const ready = swordGuardTilt(true, 1);
    // And well short of the barbarian fall, which it must not resemble.
    expect(ready).toBeLessThan(SWORD_REST_TILT / 4);
  });

  test("tracks the ramp linearly, overshoot and all", () => {
    // `k` comes straight off the swell's scale, which overshoots on the way up
    // (bulgeEase) and not on the way back. Unclamped, it keeps blade and fist
    // in step.
    expect(swordGuardTilt(false, 0.5)).toBeCloseTo(SWORD_GUARD_AT_EASE / 2, 12);
    expect(swordGuardTilt(true, 1.2)).toBeCloseTo(SWORD_GUARD_READY * 1.2, 12);
  });

  test("the resting blade moves further than the raised one", () => {
    // Asymmetric on purpose: a blade lying 124 degrees over needs real travel
    // to read, while a vertical one has a ceiling before it looks like it is
    // coming down.
    expect(Math.abs(SWORD_GUARD_AT_EASE)).toBeGreaterThan(Math.abs(SWORD_GUARD_READY));
  });
});

describe("swordLowerPose", () => {
  test("starts where the raised sword was standing", () => {
    // The dark sword is built leaning, so the first frame turns it back to
    // where the gold one was: the raise's start, negated.
    expect(swordLowerPose(0)).toEqual({ tilt: -SWORD_REST_TILT, done: false });
    expect(swordLowerPose(-1000).tilt).toBe(-SWORD_REST_TILT);
  });

  test("is not done on the frame it is armed", () => {
    expect(swordLowerPose(0).done).toBe(false);
  });

  test("ends at rest, exactly, and stays there", () => {
    for (const t of [SWORD_LOWER_MS, SWORD_LOWER_MS + 1, 60_000]) {
      expect(swordLowerPose(t)).toEqual({ tilt: 0, done: true });
    }
  });

  test("accelerates rather than easing in", () => {
    // Unlike the raise, nothing holds this sword, so it is not eased at both
    // ends.
    const at = (f: number) => swordLowerPose(SWORD_LOWER_FALL_MS * f).tilt;
    const linear = (f: number) => -SWORD_REST_TILT * (1 - f);
    expect(at(0.25)).toBeLessThan(linear(0.25));
    expect(at(0.5)).toBeLessThan(linear(0.5));
  });

  test("falls monotonically to rest and never past it", () => {
    let last = -Infinity;
    for (let t = 0; t <= SWORD_LOWER_FALL_MS; t += 5) {
      const { tilt } = swordLowerPose(t);
      expect(tilt).toBeLessThanOrEqual(1e-12);
      expect(tilt).toBeGreaterThanOrEqual(-SWORD_REST_TILT - 1e-12);
      expect(tilt).toBeGreaterThanOrEqual(last - 1e-12);
      last = tilt;
    }
  });

  test("the seam with the bounce is continuous", () => {
    // The fall arrives at rest and the recoil leaves from rest, so there is no
    // jump between them.
    expect(swordLowerPose(SWORD_LOWER_FALL_MS - 0.001).tilt).toBeCloseTo(0, 4);
    expect(swordLowerPose(SWORD_LOWER_FALL_MS).tilt).toBeCloseTo(0, 12);
  });

  test("bounces back UP off the ground, once, and by a little", () => {
    // Up, because the point has just met a tile face; down would go through
    // the ground. One peak, not a wobble: away from rest for the first half of
    // the settle and back for the second, a single half sine.
    let peak = 0;
    let turns = 0;
    let was = 0;
    let rising = false;
    for (let t = SWORD_LOWER_FALL_MS + 1; t <= SWORD_LOWER_MS; t += 1) {
      const { tilt } = swordLowerPose(t);
      expect(tilt).toBeLessThanOrEqual(1e-12);
      peak = Math.min(peak, tilt);
      if (tilt > was && !rising) {
        rising = true;
        turns += 1;
      }
      was = tilt;
    }
    expect(peak).toBeCloseTo(-SWORD_LOWER_BOUNCE, 3);
    expect(turns).toBe(1);
    // Small: the recoil makes the fall read as a landing rather than a stop.
    expect(SWORD_LOWER_BOUNCE).toBeLessThan(SWORD_REST_TILT / 10);
  });

  test("takes about as long as the raise", () => {
    // Same band as the raise (420), the chip's turn (460) and the robber's
    // pulse (420). The shape carries the meaning.
    expect(SWORD_LOWER_MS).toBeGreaterThan(SWORD_RAISE_MS / 2);
    expect(SWORD_LOWER_MS).toBeLessThan(SWORD_RAISE_MS * 2);
  });
});

describe("newlyStoodDown", () => {
  const set = (...keys: string[]) => new Set(keys);

  test("finds the knights that lost their activation in place", () => {
    expect(newlyStoodDown(set("a", "b"), set("b"), set("a", "b"))).toEqual(["a"]);
  });

  test("ignores a knight that was never active", () => {
    expect(newlyStoodDown(set(), set(), set("a"))).toEqual([]);
  });

  test("ignores a knight that is still active", () => {
    expect(newlyStoodDown(set("a"), set("a"), set("a"))).toEqual([]);
  });

  test("a knight that left the board did not stand down", () => {
    // Moving a knight deactivates it and changes its key (the vertex is in
    // it), so the old key has no piece; lowering a sword there would be wrong.
    expect(newlyStoodDown(set("a"), set(), set())).toEqual([]);
  });

  test("a board nobody has seen yet lowers nothing", () => {
    // `newlyPlaced`'s refusal: a rejoin, a spectator, a replay scrubbed
    // forward. Every knight on it is simply at ease.
    expect(newlyStoodDown(null, set(), set("a"))).toEqual([]);
  });

  test("has no bulk limit", () => {
    // Unlike every other diff here: a landfall on a ten-player table stands two
    // dozen knights down at once, and that is worth showing.
    const many = Array.from({ length: 24 }, (_v, i) => `k${i}`);
    expect(newlyStoodDown(set(...many), set(), set(...many))).toHaveLength(24);
  });
});

describe("swordPivot", () => {
  test("scales the measured grip into world units", () => {
    KNIGHT_GRIP.forEach((grip, level) => {
      expect(swordPivot(level, 2)).toEqual({ x: grip[0] * 2, y: grip[1] * 2 });
    });
  });

  test("is offset from the placement", () => {
    // A zero x would put the axis through the knight's vertex and orbit the
    // sword around the piece.
    for (let level = 0; level < KNIGHT_GRIP.length; level++) {
      expect(swordPivot(level, 2).x).toBeLessThan(0);
      expect(swordPivot(level, 2).y).toBeGreaterThan(0);
    }
  });

  test("clamps a level out of range rather than losing the pivot", () => {
    // Clamped like `planKnights`: a knight that exists is drawn as something,
    // and its sword turns about a real point, not the board origin.
    expect(swordPivot(-1, 2)).toEqual(swordPivot(0, 2));
    expect(swordPivot(99, 2)).toEqual(swordPivot(KNIGHT_GRIP.length - 1, 2));
  });

  test("a taller knight holds its sword higher and further out", () => {
    const grips = KNIGHT_GRIP.map((_g, level) => swordPivot(level, 2));
    expect(grips[0].y).toBeLessThan(grips[1].y);
    expect(grips[1].y).toBeLessThan(grips[2].y);
    expect(grips[0].x).toBeGreaterThan(grips[1].x);
    expect(grips[1].x).toBeGreaterThan(grips[2].x);
  });
});

describe("knightGrowPose", () => {
  test("starts at the size of the model it replaced", () => {
    expect(knightGrowPose(0)).toEqual({ scale: KNIGHT_GROW_START, done: false });
    expect(knightGrowPose(-500).scale).toBe(KNIGHT_GROW_START);
  });

  test("the start is derived from the art, not chosen", () => {
    expect(KNIGHT_GROW_START).toBeCloseTo(KNIGHT_ART_HEIGHT[0] / KNIGHT_ART_HEIGHT[1], 12);
    // The other step is close enough that one constant serves both; this fails
    // if the art drifts apart.
    const other = KNIGHT_ART_HEIGHT[1] / KNIGHT_ART_HEIGHT[2];
    expect(Math.abs(other - KNIGHT_GROW_START)).toBeLessThan(0.05);
  });

  test("ends at exactly 1 and stays there", () => {
    for (const t of [KNIGHT_GROW_MS, KNIGHT_GROW_MS + 1, 60_000]) {
      expect(knightGrowPose(t)).toEqual({ scale: 1, done: true });
    }
  });

  test("overshoots once, at the seam, and never after", () => {
    expect(knightGrowPose(KNIGHT_GROW_RISE_MS).scale).toBeCloseTo(1 + KNIGHT_GROW_OVERSHOOT, 9);
    let peak = 0;
    let peakAt = -1;
    for (let t = 0; t <= KNIGHT_GROW_MS; t++) {
      const { scale } = knightGrowPose(t);
      if (scale > peak) {
        peak = scale;
        peakAt = t;
      }
    }
    expect(peak).toBeCloseTo(1 + KNIGHT_GROW_OVERSHOOT, 9);
    expect(peakAt).toBe(KNIGHT_GROW_RISE_MS);
  });

  test("never shrinks below where it started and never inverts", () => {
    for (let t = 0; t <= KNIGHT_GROW_MS; t += 3) {
      const { scale } = knightGrowPose(t);
      expect(scale).toBeGreaterThanOrEqual(KNIGHT_GROW_START);
      expect(scale).toBeLessThanOrEqual(1 + KNIGHT_GROW_OVERSHOOT + 1e-12);
    }
  });

  test("grows monotonically to the peak, then settles monotonically back", () => {
    let last = 0;
    for (let t = 0; t <= KNIGHT_GROW_RISE_MS; t += 3) {
      const { scale } = knightGrowPose(t);
      expect(scale).toBeGreaterThanOrEqual(last - 1e-12);
      last = scale;
    }
    last = Infinity;
    for (let t = KNIGHT_GROW_RISE_MS; t < KNIGHT_GROW_MS; t += 3) {
      const { scale } = knightGrowPose(t);
      expect(scale).toBeLessThanOrEqual(last + 1e-12);
      last = scale;
    }
  });

  test("is continuous across the seam", () => {
    // Two curves joined at KNIGHT_GROW_RISE_MS; a step there would look like a
    // second model swap.
    const before = knightGrowPose(KNIGHT_GROW_RISE_MS - 1).scale;
    const after = knightGrowPose(KNIGHT_GROW_RISE_MS + 1).scale;
    expect(Math.abs(after - before)).toBeLessThan(0.01);
  });

  test("eases OUT of the start rather than into it", () => {
    // Fast off the mark: the model swap is instant and the growth has to catch
    // up. An ease-in leaves the new art visibly undersized for a beat.
    const quarter = knightGrowPose(KNIGHT_GROW_RISE_MS * 0.25).scale;
    const linear = KNIGHT_GROW_START + (1 + KNIGHT_GROW_OVERSHOOT - KNIGHT_GROW_START) * 0.25;
    expect(quarter).toBeGreaterThan(linear);
  });
});

describe("promoted", () => {
  const map = (entries: [string, number][]) => new Map(entries);

  test("finds a level that went up", () => {
    expect(promoted(map([["k", 0]]), map([["k", 1]]))).toEqual(["k"]);
    expect(promoted(map([["k", 0]]), map([["k", 2]]))).toEqual(["k"]);
  });

  test("ignores a level that did not change", () => {
    expect(promoted(map([["k", 1]]), map([["k", 1]]))).toEqual([]);
  });

  test("ignores a level that went down", () => {
    // Nothing in the rules demotes a knight, and shrinking would not be this
    // animation reversed.
    expect(promoted(map([["k", 2]]), map([["k", 0]]))).toEqual([]);
  });

  test("ignores a knight that was not there before", () => {
    // That is an arrival, owned by drop.ts; growing it too would put two
    // animations on one instance.
    expect(promoted(map([]), map([["k", 1]]))).toEqual([]);
    expect(promoted(map([["a", 0]]), map([["b", 2]]))).toEqual([]);
  });

  test("ignores removals", () => {
    expect(promoted(map([["k", 0]]), map([]))).toEqual([]);
  });

  test("a board nobody has seen yet grows nothing", () => {
    // A rejoin, a spectator, a replay scrubbed forward: every knight is simply
    // the size it is.
    expect(promoted(null, map([["k", 2]]))).toEqual([]);
  });

  test("a bulk arrival grows nothing", () => {
    const prev = map(Array.from({ length: 20 }, (_v, i) => [`k${i}`, 0] as [string, number]));
    const next = map(Array.from({ length: 20 }, (_v, i) => [`k${i}`, 1] as [string, number]));
    expect(promoted(prev, next)).toEqual([]);
    // A plausible single commit still animates. The limit is DROP_BULK_LIMIT's.
    const some = map([...next].slice(0, DROP_BULK_LIMIT));
    expect(promoted(prev, some)).toHaveLength(DROP_BULK_LIMIT);
  });
});
