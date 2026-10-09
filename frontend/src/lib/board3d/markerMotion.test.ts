import { describe, expect, it } from "vitest";
import { LATTICE_SIZE, type Vec3 } from "./coords";
import {
  arcHeight,
  markerPose,
  planTrip,
  stillTrip,
  travelMs,
  tripMs,
  tripPointAt,
  tripPose,
  tripRunning,
  AT_REST,
  MARKER_RESTING,
  MERCHANT_TRAVEL,
  ROBBER_TRAVEL,
  type TravelSpec,
  type Trip,
} from "./markerMotion";

/** Adjacent hex centres, which is the shortest move the game can produce. */
const HEX_STEP = Math.sqrt(3) * LATTICE_SIZE;

const at = (x: number, y: number, z: number): Vec3 => [x, y, z];

/** A one-hex hop between two tiles of the same height, starting at t = 0. */
const hop: Trip = { from: at(0, 0.5, 0), to: at(HEX_STEP, 0.5, 0), start: 0 };

/** The same hop, but onto a tile that seats the piece lower (no number chip). */
const downhill: Trip = { from: at(0, 0.9, 0), to: at(HEX_STEP, 0.5, 0), start: 0 };

/** Both markers, run through the same properties. */
const SPECS: [string, TravelSpec][] = [
  ["robber", ROBBER_TRAVEL],
  ["merchant", MERCHANT_TRAVEL],
];

describe.each(SPECS)("%s travel", (_name, spec) => {
  const travelOf = (t: Trip) => travelMs(spec, t.from, t.to);

  describe("travelMs", () => {
    it("is monotone non-decreasing in distance", () => {
      let last = 0;
      for (let d = 0; d < 40; d += 0.5) {
        const ms = travelMs(spec, at(0, 0, 0), at(d, 0, 0));
        expect(ms).toBeGreaterThanOrEqual(last);
        last = ms;
      }
    });

    it("floors at the minimum for a move that barely moves", () => {
      expect(travelMs(spec, at(1, 0, 2), at(1, 0, 2))).toBe(spec.minMs);
    });

    it("ceilings for a carry right across a 10-player board", () => {
      // Nine hexes across, the width of a 10-player board's outer rings.
      // Anything longer gets the same duration.
      expect(travelMs(spec, at(0, 0, 0), at(9 * HEX_STEP, 0, 0))).toBe(spec.maxMs);
    });

    it("puts an adjacent hop strictly between the two", () => {
      const ms = travelOf(hop);
      expect(ms).toBeGreaterThan(spec.minMs);
      expect(ms).toBeLessThan(spec.maxMs);
    });

    it("ignores the height difference between the two seats", () => {
      // The two ends can differ by a chip's height; duration uses horizontal
      // distance only.
      expect(travelOf(downhill)).toBe(travelOf(hop));
    });
  });

  describe("arcHeight", () => {
    it("floors, so even a nudge is carried rather than slid", () => {
      expect(arcHeight(spec, at(0, 0, 0), at(0.2, 0, 0))).toBe(spec.arcMin);
    });

    it("ceilings, so a long carry stays inside the frame and the shadow", () => {
      expect(arcHeight(spec, at(0, 0, 0), at(9 * HEX_STEP, 0, 0))).toBe(spec.arcMax);
    });

    it("puts an adjacent hop strictly between the two", () => {
      const h = arcHeight(spec, hop.from, hop.to);
      expect(h).toBeGreaterThan(spec.arcMin);
      expect(h).toBeLessThan(spec.arcMax);
    });
  });

  describe("tripPose", () => {
    it("starts at the origin and ends at the destination", () => {
      expect(tripPose(spec, hop, 0)).toEqual({
        offsetX: hop.from[0] - hop.to[0],
        lift: 0,
        offsetZ: 0,
        squashY: 1,
      });
      expect(tripPose(spec, hop, tripMs(spec, hop.from, hop.to))).toEqual(AT_REST);
    });

    it("holds at the origin before it sets off", () => {
      expect(tripPose(spec, hop, -500).offsetX).toBe(hop.from[0] - hop.to[0]);
    });

    it("does not extrapolate past the end", () => {
      expect(tripPose(spec, hop, tripMs(spec, hop.from, hop.to) * 10)).toEqual(AT_REST);
    });

    it("lands on exactly the placement it was built at, to the bit", () => {
      // The finished pose must be exactly the identity, or a marker that moves
      // all game would accumulate rounding error.
      const end = tripPose(spec, hop, tripMs(spec, hop.from, hop.to));
      expect(end.offsetX).toBe(0);
      expect(end.offsetZ).toBe(0);
      expect(end.lift).toBe(0);
      expect(end.squashY).toBe(1);
    });

    it("closes the horizontal gap monotonically, in both axes", () => {
      const diagonal: Trip = { from: at(-4, 0.5, 3), to: at(2, 0.5, -5), start: 0 };
      let lastX = Infinity;
      let lastZ = Infinity;
      for (let t = 0; t <= travelOf(diagonal); t += 5) {
        const p = tripPose(spec, diagonal, t);
        expect(Math.abs(p.offsetX)).toBeLessThanOrEqual(lastX + 1e-9);
        expect(Math.abs(p.offsetZ)).toBeLessThanOrEqual(lastZ + 1e-9);
        lastX = Math.abs(p.offsetX);
        lastZ = Math.abs(p.offsetZ);
      }
      expect(lastX).toBeCloseTo(0, 6);
      expect(lastZ).toBeCloseTo(0, 6);
    });

    it("eases in and out: the ends of the carry are slower than the middle", () => {
      // Unlike drop.ts's accelerating fall: a carried marker starts and
      // finishes at rest.
      const total = travelOf(hop);
      const x = (f: number) => tripPose(spec, hop, total * f).offsetX;
      const first = Math.abs(x(0) - x(0.1));
      const middle = Math.abs(x(0.45) - x(0.55));
      const last = Math.abs(x(0.9) - x(0.999));
      expect(first).toBeLessThan(middle);
      expect(last).toBeLessThan(middle);
    });

    it("arcs: off the board in the middle, level at both ends", () => {
      const total = travelOf(hop);
      expect(tripPose(spec, hop, 0).lift).toBeCloseTo(0, 9);
      expect(tripPose(spec, hop, total).lift).toBeCloseTo(0, 9);
      for (let f = 0.02; f < 1; f += 0.02) {
        expect(tripPose(spec, hop, total * f).lift).toBeGreaterThan(0);
      }
    });

    it("peaks at the midpoint, where the eye can follow it", () => {
      const total = travelOf(hop);
      const apex = tripPose(spec, hop, total / 2).lift;
      expect(apex).toBeCloseTo(arcHeight(spec, hop.from, hop.to), 9);
      for (const f of [0.1, 0.3, 0.49, 0.51, 0.7, 0.9]) {
        expect(tripPose(spec, hop, total * f).lift).toBeLessThan(apex);
      }
    });

    it("carries the height difference between the two seats as well", () => {
      // Moving onto the desert changes the seat height; interpolating only x
      // and z would make it pop vertically on landing.
      const drop = downhill.from[1] - downhill.to[1];
      expect(tripPose(spec, downhill, 0).lift).toBeCloseTo(drop, 9);
      expect(tripPose(spec, downhill, travelOf(downhill)).lift).toBeCloseTo(0, 9);
    });

    it("squashes only on landing, and never stretches", () => {
      const total = travelOf(hop);
      for (let t = 0; t < total; t += 5) expect(tripPose(spec, hop, t).squashY).toBe(1);
      const mid = tripPose(spec, hop, total + spec.settleMs / 2).squashY;
      expect(mid).toBeGreaterThan(0.5);
      expect(mid).toBeLessThan(1);
      for (let t = total; t <= total + spec.settleMs; t += 5) {
        expect(tripPose(spec, hop, t).squashY).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("tripPointAt", () => {
    it("is the origin at the start and the destination at the end", () => {
      expect(tripPointAt(spec, hop, 0)).toEqual(hop.from);
      const landed = tripPointAt(spec, hop, tripMs(spec, hop.from, hop.to));
      expect(landed[0]).toBeCloseTo(hop.to[0], 9);
      expect(landed[2]).toBeCloseTo(hop.to[2], 9);
    });

    it("is somewhere between the two in the middle", () => {
      const [x, , z] = tripPointAt(spec, hop, travelOf(hop) / 2);
      expect(x).toBeGreaterThan(hop.from[0]);
      expect(x).toBeLessThan(hop.to[0]);
      expect(z).toBeCloseTo(0, 9);
    });
  });

  describe("planTrip", () => {
    const a = at(0, 0.5, 0);
    const b = at(HEX_STEP, 0.5, 0);
    const c = at(0, 0.5, HEX_STEP);

    it("does not animate on the first board it sees", () => {
      // A state load (spectator, rejoin, replay scrub, first merchant): the
      // piece is where it is.
      expect(planTrip(spec, null, b, null, 1000)).toBeNull();
    });

    it("hands an unrelated rebuild its trip back, start time and all", () => {
      // The board is replanned on every view change. Returning the original
      // start lets the arc continue instead of restarting.
      const inFlight: Trip = { from: a, to: b, start: 1000 };
      expect(planTrip(spec, b, b, inFlight, 1000 + travelOf(inFlight) / 2)).toBe(inFlight);
    });

    it("starts a trip from where the marker was standing", () => {
      expect(planTrip(spec, a, b, null, 500)).toEqual({ from: a, to: b, start: 500 });
    });

    it("aims at the placement it was handed, untouched", () => {
      // `to` must be exactly the position the placement layer computed.
      expect(planTrip(spec, a, b, null, 500)!.to).toBe(b);
    });

    it("redirects from the marker's current position, not the hex it left", () => {
      // A knight right after a 7, or a second merchant card, arrives while the
      // first carry is still in the air; restarting from the old hex would snap
      // it backwards.
      const inFlight: Trip = { from: a, to: b, start: 1000 };
      const now = 1000 + travelOf(inFlight) / 2;
      const trip = planTrip(spec, b, c, inFlight, now)!;
      expect(trip.to).toEqual(c);
      expect(trip.start).toBe(now);
      expect(trip.from[0]).toBeGreaterThan(a[0]);
      expect(trip.from[0]).toBeLessThan(b[0]);
      // And from where it visibly is, in the air.
      expect(trip.from[1]).toBeGreaterThan(a[1]);
    });

    it("treats float drift in the same seat as no move at all", () => {
      const jittered = at(a[0] + 1e-9, a[1], a[2] - 1e-9);
      expect(planTrip(spec, a, jittered, null, 500)).toBeNull();
    });
  });

  describe("stillTrip", () => {
    const trip: Trip = { from: at(0, 0.5, 0), to: at(HEX_STEP, 0.5, 0), start: 1000 };

    it("keeps a running trip, with its original start", () => {
      expect(stillTrip(spec, trip, 1100)).toBe(trip);
    });

    it("drops one that has finished", () => {
      expect(stillTrip(spec, trip, 1000 + tripMs(spec, trip.from, trip.to))).toBeNull();
      expect(stillTrip(spec, null, 1100)).toBeNull();
    });

    it("preserves the arc across a rebuild", () => {
      // A rebuilt board shows the same pose the old one would have.
      const now = 1000 + travelOf(trip) / 3;
      expect(tripPose(spec, stillTrip(spec, trip, now)!, now)).toEqual(tripPose(spec, trip, now));
    });
  });

  describe("markerPose", () => {
    const trip: Trip = { from: at(0, 0.5, 0), to: at(HEX_STEP, 0.5, 0), start: 0 };

    it("stands still and reports itself finished when there is no trip", () => {
      expect(markerPose(spec, null, 5000)).toEqual(MARKER_RESTING);
    });

    it("is carrying while the trip runs and done exactly when it ends", () => {
      const total = tripMs(spec, trip.from, trip.to);
      const mid = markerPose(spec, trip, travelOf(trip) / 4);
      expect(Math.abs(mid.offsetX)).toBeGreaterThan(0);
      expect(mid.lift).toBeGreaterThan(0);
      expect(mid.done).toBe(false);
      expect(markerPose(spec, trip, total - 1).done).toBe(false);
      expect(markerPose(spec, trip, total)).toEqual(MARKER_RESTING);
    });

    it("counts a trip that has not set off yet as running", () => {
      // The first tick can land slightly before the trip's stamped start; that
      // must not count as done.
      expect(markerPose(spec, { ...trip, start: 100 }, 50).done).toBe(false);
      expect(tripRunning(spec, { ...trip, start: 100 }, 50)).toBe(true);
    });
  });
});

describe("robber and merchant motion", () => {
  it("times every move identically", () => {
    for (let d = 0; d <= 12 * HEX_STEP; d += HEX_STEP / 4) {
      const from = at(0, 0.25, 0);
      const to = at(d, 0.25, 0);
      expect(travelMs(MERCHANT_TRAVEL, from, to)).toBe(travelMs(ROBBER_TRAVEL, from, to));
      expect(tripMs(MERCHANT_TRAVEL, from, to)).toBe(tripMs(ROBBER_TRAVEL, from, to));
    }
  });

  it("arcs an adjacent hop to the same height", () => {
    const from = at(0, 0.25, 0);
    const to = at(HEX_STEP, 0.25, 0);
    expect(arcHeight(MERCHANT_TRAVEL, from, to)).toBe(arcHeight(ROBBER_TRAVEL, from, to));
  });

  it("scales only the arc bounds, and only down", () => {
    // 1.63 world units of merchant against 2.25 of robber. The bounds are where
    // the arc scales with the piece rather than the distance.
    const ratio = 1.63 / 2.25;
    expect(MERCHANT_TRAVEL.arcMin / ROBBER_TRAVEL.arcMin).toBeCloseTo(ratio, 2);
    expect(MERCHANT_TRAVEL.arcMax / ROBBER_TRAVEL.arcMax).toBeCloseTo(ratio, 2);
  });

  it("lands with the same squash", () => {
    expect(MERCHANT_TRAVEL.settleMs).toBe(ROBBER_TRAVEL.settleMs);
    expect(MERCHANT_TRAVEL.settleSquash).toBe(ROBBER_TRAVEL.settleSquash);
  });
});
