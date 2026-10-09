import { test, expect } from "vitest";
import {
  FLIGHT_MS,
  FLIGHT_STAGGER_MS,
  FLIGHT_BULK_LIMIT,
  FLIGHT_ARC,
  arcPoint,
  batchDurationMs,
  choreograph,
  collapseFlights,
  endpointKey,
  faceKey,
  flightPose,
  type CardFlight,
  type Endpoint,
  type CardFace,
} from "./cardflight";

const flight = (from: Endpoint, to: Endpoint, face: CardFace, count = 1): CardFlight => ({
  from,
  to,
  face,
  count,
  delayMs: 0,
});
const hex = (q: number, r: number): Endpoint => ({ k: "hex", hex: { q, r } });
const seat = (n: number): Endpoint => ({ k: "seat", seat: n });
const res = (idx: number): CardFace => ({ k: "res", idx });

// ---- flightPose ----

test("flightPose holds the start pose during the stagger", () => {
  for (const ms of [-1000, -FLIGHT_STAGGER_MS, -1, 0]) {
    const p = flightPose(ms);
    expect(p.t).toBe(0);
    expect(p.opacity).toBe(0);
    expect(p.scale).toBeGreaterThan(0);
    expect(p.scale).toBeLessThan(1);
  }
});

test("flightPose is landed at and after the end", () => {
  const end = flightPose(FLIGHT_MS);
  expect(end.t).toBe(1);
  expect(end.opacity).toBe(0);
  // A ticker that runs one frame long must not extrapolate past the target.
  expect(flightPose(FLIGHT_MS + 500)).toEqual(end);
});

test("flightPose t is monotonic and eases out", () => {
  let prev = -1;
  for (let ms = 0; ms <= FLIGHT_MS; ms += 10) {
    const { t } = flightPose(ms);
    expect(t).toBeGreaterThanOrEqual(prev);
    prev = t;
  }
  // Past halfway by the halfway point: thrown, then coasting.
  expect(flightPose(FLIGHT_MS / 2).t).toBeGreaterThan(0.5);
});

test("flightPose fades in at launch and out at landing", () => {
  const mid = flightPose(FLIGHT_MS / 2);
  expect(mid.opacity).toBeCloseTo(1, 5);
  expect(flightPose(20).opacity).toBeGreaterThan(0);
  expect(flightPose(20).opacity).toBeLessThan(1);
  expect(flightPose(FLIGHT_MS - 20).opacity).toBeLessThan(1);
  expect(flightPose(FLIGHT_MS - 20).opacity).toBeGreaterThan(0);
});

test("flightPose peaks in size mid-flight", () => {
  const mid = flightPose(FLIGHT_MS / 2);
  expect(mid.scale).toBeCloseTo(1, 5);
  expect(flightPose(10).scale).toBeLessThan(1);
  expect(flightPose(FLIGHT_MS - 10).scale).toBeLessThan(1);
  // Never inverted, never past full size.
  for (let ms = 0; ms <= FLIGHT_MS; ms += 7) {
    const { scale } = flightPose(ms);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThanOrEqual(1);
  }
});

// ---- arcPoint ----

test("arcPoint hits both endpoints", () => {
  const a = { fx: 0.2, fy: 0.8 };
  const b = { fx: 0.9, fy: 0.1 };
  expect(arcPoint(a, b, 0)).toEqual(a);
  const end = arcPoint(a, b, 1);
  expect(end.fx).toBeCloseTo(b.fx, 10);
  expect(end.fy).toBeCloseTo(b.fy, 10);
});

test("arcPoint bows upward in any direction", () => {
  const cases: [ScreenPair, string][] = [
    [
      [
        { fx: 0.1, fy: 0.5 },
        { fx: 0.9, fy: 0.5 },
      ],
      "left to right",
    ],
    [
      [
        { fx: 0.9, fy: 0.5 },
        { fx: 0.1, fy: 0.5 },
      ],
      "right to left",
    ],
    [
      [
        { fx: 0.5, fy: 0.9 },
        { fx: 0.2, fy: 0.2 },
      ],
      "up and left",
    ],
    [
      [
        { fx: 0.5, fy: 0.2 },
        { fx: 0.2, fy: 0.9 },
      ],
      "down and left",
    ],
  ];
  for (const [[a, b], label] of cases) {
    const mid = arcPoint(a, b, 0.5);
    // A perpendicular offset would flip sign somewhere in this list, which is
    // why the control point is lifted straight up.
    expect(mid.fy, label).toBeLessThan((a.fy + b.fy) / 2);
  }
});

test("arcPoint bow scales with length and FLIGHT_ARC", () => {
  const short = arcPoint({ fx: 0.5, fy: 0.5 }, { fx: 0.55, fy: 0.5 }, 0.5);
  const long = arcPoint({ fx: 0.1, fy: 0.5 }, { fx: 0.9, fy: 0.5 }, 0.5);
  expect(0.5 - short.fy).toBeLessThan(0.5 - long.fy);
  const flat = arcPoint({ fx: 0.1, fy: 0.5 }, { fx: 0.9, fy: 0.5 }, 0.5, 0);
  expect(flat.fy).toBeCloseTo(0.5, 10);
  expect(FLIGHT_ARC).toBeGreaterThan(0);
});

type ScreenPair = [{ fx: number; fy: number }, { fx: number; fy: number }];

// ---- keys ----

test("endpointKey and faceKey are stable and distinguishing", () => {
  const cases: [Endpoint, string][] = [
    [hex(1, -2), "hex:1,-2"],
    [seat(3), "seat:03"],
    [{ k: "bank" }, "bank"],
    [{ k: "deck" }, "deck"],
  ];
  for (const [e, want] of cases) expect(endpointKey(e)).toBe(want);
  // Ten-player games exist: seat 10 must not sort between seats 1 and 2.
  expect([seat(10), seat(2)].map(endpointKey).sort()).toEqual(["seat:02", "seat:10"]);

  const faces: [CardFace, string][] = [
    [res(4), "res:4"],
    [{ k: "com", idx: 1 }, "com:1"],
    [{ k: "dev" }, "dev"],
    [{ k: "progress" }, "progress"],
    [{ k: "hidden" }, "hidden"],
  ];
  for (const [f, want] of faces) expect(faceKey(f)).toBe(want);
});

// ---- choreograph ----

test("choreograph orders by destination, then source, then face", () => {
  const out = choreograph([
    flight(hex(1, 0), seat(2), res(5)),
    flight(hex(0, 0), seat(1), res(1)),
    flight(hex(0, 0), seat(1), res(4)),
  ]);
  expect(out.map((f) => [(f.to as { seat: number }).seat, faceKey(f.face)])).toEqual([
    [1, "res:1"],
    [1, "res:4"],
    [2, "res:5"],
  ]);
  // Every card in a batch leaves on the same frame; the order is paint order.
  expect(out.map((f) => f.delayMs)).toEqual([0, 0, 0]);
  expect(FLIGHT_STAGGER_MS).toBe(0);
});

test("choreograph order is independent of input order", () => {
  const raw = [
    flight(hex(2, -1), seat(0), res(3)),
    flight(hex(0, 0), seat(4), res(1)),
    flight({ k: "bank" }, seat(0), res(2)),
  ];
  const a = choreograph(raw).map((f) => `${endpointKey(f.to)}|${faceKey(f.face)}`);
  const b = choreograph([...raw].reverse()).map((f) => `${endpointKey(f.to)}|${faceKey(f.face)}`);
  expect(b).toEqual(a);
});

test("choreograph leaves a small batch as separate cards", () => {
  const raw = Array.from({ length: FLIGHT_BULK_LIMIT }, (_, i) =>
    flight(hex(0, 0), seat(1), res(1 + (i % 5))),
  );
  const out = choreograph(raw);
  expect(out).toHaveLength(FLIGHT_BULK_LIMIT);
  expect(out.every((f) => f.count === 1)).toBe(true);
});

test("choreograph collapses a large batch into counted cards", () => {
  const raw = Array.from({ length: FLIGHT_BULK_LIMIT + 1 }, () =>
    flight(hex(0, 0), seat(1), res(1)),
  );
  const out = choreograph(raw);
  expect(out).toHaveLength(1);
  expect(out[0].count).toBe(FLIGHT_BULK_LIMIT + 1);
  expect(out.reduce((n, f) => n + f.count, 0)).toBe(raw.length);
});

test("collapsing keeps flights from different hexes apart", () => {
  const out = collapseFlights([
    flight(hex(0, 0), seat(1), res(4)),
    flight(hex(1, 0), seat(1), res(4)),
    flight(hex(1, 0), seat(1), res(4)),
  ]);
  expect(out).toHaveLength(2);
  expect(out.map((f) => f.count).sort()).toEqual([1, 2]);
});

test("collapsing does not mutate its input", () => {
  const raw = [flight(hex(0, 0), seat(1), res(4)), flight(hex(0, 0), seat(1), res(4))];
  collapseFlights(raw);
  expect(raw.map((f) => f.count)).toEqual([1, 1]);
});

test("batchDurationMs covers the last card's whole flight", () => {
  expect(batchDurationMs([])).toBe(0);
  const out = choreograph([flight(hex(0, 0), seat(1), res(1)), flight(hex(0, 0), seat(2), res(1))]);
  // Two cards take as long as one because they leave together. The formula
  // still adds the last delay, in case a batch fans out again.
  expect(batchDurationMs(out)).toBe(FLIGHT_MS);
  expect(batchDurationMs([{ ...out[0], delayMs: 90 }])).toBe(90 + FLIGHT_MS);
});
