// A camel on a pure sea path rides its punt, and a route ship on the same path
// makes room for it along the path's own line (Caravans with Islands).
import { test, expect } from "vitest";
import {
  planCamels,
  planRafts,
  isSeaPath,
  shipShiftsOnCamelPaths,
  RAFT_SHIFT,
  SHIP_SHIFT,
  SEA_CAMEL_Y,
  RAFT_WATERLINE,
} from "./caravans";
import { planShips } from "./islands";
import { edgeToWorld, edgeRotationY, edgeBearingY, vertexToWorld } from "../coords";
import { SURFACE } from "../seating";
import { edgeKey, hexEdges } from "@/lib/hexgeo";
import type { BoardTile, Edge, FullView, Hex, Vertex } from "@/lib/types";

const A: Hex = { q: 0, r: 0 };
const B: Hex = { q: 1, r: 0 };
const L: Hex = { q: 0, r: 1 };

/** The edge two hexes share. */
function shared(h: Hex, k: Hex): Edge {
  const ks = new Set(hexEdges(k).map(edgeKey));
  const e = hexEdges(h).find((x) => ks.has(edgeKey(x)));
  if (!e) throw new Error("not neighbours");
  return e;
}

const SEA = shared(A, B);
const COAST = shared(A, L);

function view(opts: { camel: Edge; tail?: Vertex; ships?: Edge[]; tiles?: BoardTile[] }): FullView {
  const tiles = opts.tiles ?? [
    { hex: A, res: "sea", num: 0 },
    { hex: B, res: "sea", num: 0 },
    { hex: L, res: "wood", num: 6 },
  ];
  return {
    board: { tiles, robber: { q: 5, r: 5 }, harbors: [] },
    ext: {
      caravans: {
        camels: [{ caravan: 0, e: opts.camel }],
        caravans: opts.tail ? [{ caravan: 0, corner: opts.tail, arrow: opts.camel }] : [],
        occupied: [opts.camel],
      },
      islands: {
        ships: (opts.ships ?? []).map((e) => ({ e, owner: 1 })),
        ships_left: [],
        moved_ship: false,
      },
    },
  } as unknown as FullView;
}

const tail = SEA.a;
const head = SEA.b;

/** Unit vector from the path's tail end to its head end, in the world (x, z). */
function along(): [number, number] {
  const [ax, , az] = vertexToWorld(tail);
  const [bx, , bz] = vertexToWorld(head);
  const n = Math.hypot(bx - ax, bz - az);
  return [(bx - ax) / n, (bz - az) / n];
}

test("a sea path is one with water on both sides; a coast is not", () => {
  const v = view({ camel: SEA });
  expect(isSeaPath(v, SEA)).toBe(true);
  expect(isSeaPath(v, COAST)).toBe(false);
});

test("a lone camel on a sea path floats mid-path on its punt", () => {
  const v = view({ camel: SEA, tail });
  const [c] = planCamels(v);
  const [mx, , mz] = edgeToWorld(SEA);
  expect(c.onSea).toBe(true);
  expect(c.position[0]).toBeCloseTo(mx, 9);
  expect(c.position[2]).toBeCloseTo(mz, 9);
  // Its frame floats the punt's waterline on the mean sea.
  expect(c.position[1]).toBeCloseTo(SURFACE.sea - RAFT_WATERLINE, 12);
  expect(c.position[1]).toBe(SEA_CAMEL_Y);
  const rafts = planRafts(v);
  expect(rafts).toHaveLength(1);
  expect(rafts[0].position).toEqual(c.position);
  expect(rafts[0].rotationY).toBe(c.rotationY);
  expect(rafts[0].key).not.toBe(c.key);
});

test("a shared path shifts the camel 0.78 and the ship 0.8 apart", () => {
  const v = view({ camel: SEA, tail, ships: [SEA] });
  const [c] = planCamels(v);
  const [ship] = planShips(v);
  const [mx, , mz] = edgeToWorld(SEA);
  const [ux, uz] = along();
  // The camel faces its head (the chain's bearing)...
  expect(c.rotationY).toBeCloseTo(edgeBearingY(tail, head), 12);
  // ...and moves toward it, on the path's own line.
  expect(c.position[0] - mx).toBeCloseTo(ux * RAFT_SHIFT, 9);
  expect(c.position[2] - mz).toBeCloseTo(uz * RAFT_SHIFT, 9);
  // The ship moves the other way, on the same line, and keeps its axis.
  expect(ship.position[0] - mx).toBeCloseTo(-ux * SHIP_SHIFT, 9);
  expect(ship.position[2] - mz).toBeCloseTo(-uz * SHIP_SHIFT, 9);
  expect(ship.rotationY).toBe(edgeRotationY(SEA));
  // The punt goes with the camel.
  expect(planRafts(v)[0].position).toEqual(c.position);
  expect(RAFT_SHIFT).toBe(0.78);
  expect(SHIP_SHIFT).toBe(0.8);
});

test("the shift stays along the path", () => {
  const v = view({ camel: SEA, tail, ships: [SEA] });
  const [mx, , mz] = edgeToWorld(SEA);
  const [ux, uz] = along();
  for (const p of [planCamels(v)[0].position, planShips(v)[0].position, planRafts(v)[0].position]) {
    const dx = p[0] - mx;
    const dz = p[2] - mz;
    // The component across the path is zero.
    expect(Math.abs(dx * -uz + dz * ux)).toBeLessThan(1e-9);
  }
});

test("the shift follows the caravan's direction, whichever end is its head", () => {
  const forward = planCamels(view({ camel: SEA, tail: SEA.a, ships: [SEA] }))[0];
  const back = planCamels(view({ camel: SEA, tail: SEA.b, ships: [SEA] }))[0];
  const [mx, , mz] = edgeToWorld(SEA);
  expect(forward.position[0] - mx).toBeCloseTo(-(back.position[0] - mx), 9);
  expect(forward.position[2] - mz).toBeCloseTo(-(back.position[2] - mz), 9);
  const s = shipShiftsOnCamelPaths(view({ camel: SEA, tail: SEA.b, ships: [SEA] }));
  expect(s.size).toBe(1);
  const [dx, dz] = s.get(edgeKey(SEA))!;
  // The ship goes toward the tail: straight against the camel's move.
  const cx = back.position[0] - mx;
  const cz = back.position[2] - mz;
  expect((dx * cx + dz * cz) / (Math.hypot(dx, dz) * Math.hypot(cx, cz))).toBeCloseTo(-1, 9);
  expect(Math.hypot(dx, dz)).toBeCloseTo(SHIP_SHIFT, 9);
});

test("a ship elsewhere or a camel on land shifts nothing", () => {
  const v = view({ camel: COAST, tail: COAST.a, ships: [SEA] });
  const [c] = planCamels(v);
  expect(c.onSea).toBeUndefined();
  expect(c.position).toEqual(edgeToWorld(COAST));
  expect(planRafts(v)).toEqual([]);
  expect(planShips(v)[0].position).toEqual(edgeToWorld(SEA));
  expect(shipShiftsOnCamelPaths(v).size).toBe(0);
  // A ship beside a lone sea camel on another sea path stays at its midpoint.
  const w = view({ camel: SEA, tail, ships: [COAST] });
  expect(planShips(w)[0].position).toEqual(edgeToWorld(COAST));
  expect(planCamels(w)[0].position[0]).toBeCloseTo(edgeToWorld(SEA)[0], 9);
});

test("a hex off the board counts as open sea", () => {
  const v = view({ camel: SEA, tail, tiles: [{ hex: A, res: "sea", num: 0 }] });
  expect(isSeaPath(v, SEA)).toBe(true);
  expect(planRafts(v)).toHaveLength(1);
});
