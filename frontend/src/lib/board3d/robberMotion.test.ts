import { describe, expect, it } from "vitest";
import { LATTICE_SIZE, type Vec3 } from "./coords";
import { travelMs, tripMs, tripPose, ROBBER_TRAVEL, type Trip } from "./markerMotion";
import {
  robberPose,
  robberPulseScale,
  stillMoving,
  ROBBER_PULSE_MS,
  ROBBER_RESTING,
  ROBBER_STILL,
} from "./robberMotion";
import { ROBBER_FLIP } from "./flip";
import { planPeek, stillPeek, PEEK_TILT, PEEK_TIP_MS } from "./robberPeek";

/** Adjacent hex centres, which is the shortest move the game can produce. */
const HEX_STEP = Math.sqrt(3) * LATTICE_SIZE;

const at = (x: number, y: number, z: number): Vec3 => [x, y, z];

const travelOf = (t: Trip) => travelMs(ROBBER_TRAVEL, t.from, t.to);
const wholeOf = (t: Trip) => tripMs(ROBBER_TRAVEL, t.from, t.to);

describe("robberPulseScale", () => {
  it("is exactly the piece's own size outside the pulse", () => {
    expect(robberPulseScale(0)).toBe(1);
    expect(robberPulseScale(-100)).toBe(1);
    expect(robberPulseScale(ROBBER_PULSE_MS)).toBe(1);
    expect(robberPulseScale(ROBBER_PULSE_MS * 10)).toBe(1);
  });

  it("grows, then recoils", () => {
    const half = ROBBER_PULSE_MS / 2;
    const grown = Math.max(...samples(0, half).map((s) => s.v));
    const recoiled = Math.min(...samples(half, ROBBER_PULSE_MS).map((s) => s.v));
    expect(grown).toBeGreaterThan(1);
    expect(recoiled).toBeLessThan(1);
  });

  it("decays rather than looping, so the recoil is smaller than the swell", () => {
    const half = ROBBER_PULSE_MS / 2;
    const grown = Math.max(...samples(0, half).map((s) => s.v)) - 1;
    const recoiled = 1 - Math.min(...samples(half, ROBBER_PULSE_MS).map((s) => s.v));
    expect(grown).toBeGreaterThan(recoiled);
  });

  it("never turns the robber inside out", () => {
    for (const { v } of samples(-50, ROBBER_PULSE_MS + 50)) expect(v).toBeGreaterThan(0.5);
  });

  function samples(from: number, to: number) {
    const out: { t: number; v: number }[] = [];
    for (let t = from; t <= to; t += 5) out.push({ t, v: robberPulseScale(t) });
    return out;
  }
});

describe("stillMoving", () => {
  const trip: Trip = { from: at(0, 0.5, 0), to: at(HEX_STEP, 0.5, 0), start: 1000 };
  const anim = { trip, pulse: 1000, flip: null };

  it("keeps both halves, with their original starts", () => {
    const kept = stillMoving(anim, 1100);
    expect(kept.trip).toBe(trip);
    expect(kept.pulse).toBe(1000);
  });

  it("drops each half independently as it expires", () => {
    // The pulse is shorter here, so there is a window where the robber is
    // still carried but no longer pulsing.
    const mid = 1000 + ROBBER_PULSE_MS;
    expect(stillMoving(anim, mid)).toEqual({
      trip,
      pulse: null,
      flip: null,
      peek: null,
      dead: false,
      drop: null,
    });
    expect(stillMoving(anim, 1000 + wholeOf(trip))).toEqual({
      trip: null,
      pulse: null,
      flip: null,
      peek: null,
      dead: false,
      drop: null,
    });
  });
});

describe("robberPose", () => {
  const trip: Trip = { from: at(0, 0.5, 0), to: at(HEX_STEP, 0.5, 0), start: 0 };

  it("stands still and reports itself finished when nothing is running", () => {
    expect(robberPose(ROBBER_STILL, 5000)).toEqual(ROBBER_RESTING);
  });

  it("carries and pulses at the same time", () => {
    // A knight pushes the robber while the player is still clicking its old
    // hex; both motions land in one pose.
    const pose = robberPose({ trip, pulse: 0, flip: null }, travelOf(trip) / 4);
    expect(Math.abs(pose.offsetX)).toBeGreaterThan(0);
    expect(pose.lift).toBeGreaterThan(0);
    expect(pose.scale).toBeGreaterThan(1);
    expect(pose.done).toBe(false);
  });

  it("carries exactly what the shared travel says it does", () => {
    // The robber's arc is markerMotion's at ROBBER_TRAVEL's numbers; this
    // module only folds the pulse in.
    const t = travelOf(trip) / 3;
    const { offsetX, offsetZ, lift, squashY, scale, tilt, done } = robberPose(
      { trip, pulse: null, flip: null },
      t,
    );
    expect({ offsetX, offsetZ, lift, squashY }).toEqual(tripPose(ROBBER_TRAVEL, trip, t));
    expect(scale).toBe(1);
    // Named rather than discarded: a carry is not a seven, and must not tilt
    // the piece.
    expect(tilt).toBe(0);
    expect(done).toBe(false);
  });

  it("is done only once both halves are", () => {
    const long = wholeOf(trip);
    expect(robberPose({ trip, pulse: null, flip: null }, long - 1).done).toBe(false);
    expect(robberPose({ trip, pulse: null, flip: null }, long).done).toBe(true);
    // The pulse outlives the carry here; the ticker must not stop.
    expect(robberPose({ trip, pulse: long - 10, flip: null }, long).done).toBe(false);
    expect(robberPose({ trip: null, pulse: 0, flip: null }, ROBBER_PULSE_MS).done).toBe(true);
  });

  it("counts a trip that has not set off yet as running", () => {
    // The first tick can land slightly before the trip's stamped start; that
    // must not count as done.
    expect(robberPose({ trip: { ...trip, start: 100 }, pulse: null, flip: null }, 50).done).toBe(
      false,
    );
  });
});

describe("the seven flip", () => {
  // No chip carries a seven, so the robber answers it with the chips' turn.
  // See flip.ts.

  it("is not turning at all when nothing raised it", () => {
    const pose = robberPose({ ...ROBBER_STILL }, 1000);
    expect(pose.tilt).toBe(0);
    expect(pose.lift).toBe(0);
    expect(pose.done).toBe(true);
  });

  it("turns, and lifts clear of the tile, partway through", () => {
    const pose = robberPose({ trip: null, pulse: null, flip: 1000 }, 1000 + ROBBER_FLIP.ms / 2);
    expect(pose.tilt).toBeGreaterThan(0);
    expect(pose.tilt).toBeLessThan(Math.PI * 2);
    expect(pose.lift).toBeCloseTo(ROBBER_FLIP.lift, 5);
    expect(pose.done).toBe(false);
  });

  it("is back exactly where it stood when the turn is over", () => {
    // The ticker poses one frame past the end, so anything left here is a
    // permanent tilt.
    const pose = robberPose({ trip: null, pulse: null, flip: 1000 }, 1000 + ROBBER_FLIP.ms);
    expect(pose.tilt).toBe(0);
    expect(pose.lift).toBe(0);
    expect(pose.done).toBe(true);
  });

  it("is dropped once it has finished, and kept while it runs", () => {
    const anim = { trip: null, pulse: null, flip: 1000 };
    expect(stillMoving(anim, 1000 + ROBBER_FLIP.ms / 2).flip).toBe(1000);
    expect(stillMoving(anim, 1000 + ROBBER_FLIP.ms).flip).toBeNull();
  });

  it("carries the trip's lift and the pulse's scale at the same time", () => {
    // All three can overlap: a seven turns the robber, then the player moves it
    // before the turn finishes.
    const trip: Trip = { from: at(0, 0.5, 0), to: at(HEX_STEP, 0.5, 0), start: 1000 };
    const both = robberPose({ trip, pulse: 1000, flip: 1000 }, 1000 + 100);
    const flipOnly = robberPose({ trip: null, pulse: null, flip: 1000 }, 1000 + 100);
    const tripOnly = robberPose({ trip, pulse: null, flip: null }, 1000 + 100);
    expect(both.tilt).toBe(flipOnly.tilt);
    // The two lifts add: a robber carried while turning does both.
    expect(both.lift).toBeCloseTo(tripOnly.lift + flipOnly.lift, 6);
    expect(both.scale).toBeGreaterThan(1);
    expect(both.offsetX).toBe(tripOnly.offsetX);
  });

  it("keeps the whole turn alive even after the pulse and trip have ended", () => {
    // The flip outlasts the pulse (520 against 420), so stopping with the pulse
    // would freeze the robber mid-somersault.
    const pose = robberPose({ trip: null, pulse: 1000, flip: 1000 }, 1000 + ROBBER_PULSE_MS + 10);
    expect(pose.done).toBe(false);
    expect(pose.tilt).toBeGreaterThan(0);
  });
});

describe("a clock that restarted", () => {
  it("does not leave the pulse running forever", () => {
    // A rebuilt rig's ticker clock restarts at zero, so a pulse stamped by the
    // old one starts "in the future". Unguarded, it would never report done and
    // would hold the ticker for the session. (Same guard as `stillFlipping`.)
    const stale = { trip: null, pulse: 120000, flip: null };
    expect(robberPose(stale, 0).done).toBe(true);
    expect(stillMoving(stale, 0).pulse).toBeNull();
    // And the ordinary case: a pulse that has just begun.
    expect(robberPose({ trip: null, pulse: 1000, flip: null }, 1000).done).toBe(false);
  });
});

describe("the hover tip", () => {
  const peek = planPeek(null, true, 0.3, 1000)!;

  it("holds the ticker only while it is moving", () => {
    // Not done while it turns, or the carrier stops it halfway; done once it
    // arrives, or a long hover redraws the scene every frame.
    expect(robberPose({ ...ROBBER_STILL, peek }, 1000).done).toBe(false);
    expect(robberPose({ ...ROBBER_STILL, peek }, 1000 + PEEK_TIP_MS / 2).done).toBe(false);
    expect(robberPose({ ...ROBBER_STILL, peek }, 1000 + PEEK_TIP_MS).done).toBe(true);
    // And the piece is still over at that point.
    expect(robberPose({ ...ROBBER_STILL, peek }, 1000 + PEEK_TIP_MS).peek).toBeCloseTo(
      PEEK_TILT,
      10,
    );
  });

  it("yields the piece to a seven's turn, and takes it back after", () => {
    // One instance matrix carries one pivot: the somersault wants the middle,
    // the tip the feet. The somersault wins while it runs; the tip's leg keeps
    // running underneath.
    const both = { ...ROBBER_STILL, peek, flip: 1000 };
    expect(robberPose(both, 1000 + ROBBER_FLIP.ms / 2).turning).toBe(true);
    const after = robberPose(both, 1000 + ROBBER_FLIP.ms);
    expect(after.turning).toBe(false);
    expect(after.peek).toBeCloseTo(PEEK_TILT, 10);
  });

  it("survives a rebuild untouched", () => {
    // A road going down elsewhere replans the board; that isn't the pointer
    // leaving the robber.
    const anim = { trip: null, pulse: null, flip: null, peek };
    expect(stillMoving(anim, 1000 + PEEK_TIP_MS * 100).peek).toBe(peek);
  });
});

describe("playing dead", () => {
  it("survives a rebuild", () => {
    // `stillMoving` drops each motion as it expires. Playing dead is a latch
    // with no clock, so it carries through untouched or the piece stands up on
    // any rebuild.
    const anim = { ...ROBBER_STILL, dead: true };
    expect(stillMoving(anim, 0).dead).toBe(true);
    expect(stillMoving(anim, 10_000_000).dead).toBe(true);
  });

  it("lies at exactly the height a hover leaves it at", () => {
    // Dead uses the hover angle, so settling and dropping the flag doesn't
    // lift the piece.
    const peek = stillPeek(true, 0);
    const t = 1_000_000;
    const alive = robberPose({ ...ROBBER_STILL, peek }, t);
    const dead = robberPose({ ...ROBBER_STILL, peek, dead: true }, t);
    expect(dead.peek).toBeCloseTo(alive.peek, 6);
    expect(dead.peek).toBeCloseTo(PEEK_TILT, 6);
  });
});
