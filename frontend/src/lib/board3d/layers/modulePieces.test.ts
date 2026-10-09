// Placement rules for the expansion pieces.
//
// These read the same `ext` slices as the 2D board, so they mostly check that
// the 3D board agrees with the wire, and that pieces with no square on the
// board get a sensible position.
import { test, expect } from "vitest";
import type { FullView, Vertex, Edge, Hex } from "@/lib/types";
import { planShips, planPirate } from "./islands";
import {
  planKnights,
  planWalls,
  planMetros,
  metroDraws,
  planMerchant,
  KNIGHT_PREFIX,
  METRO_PREFIX,
} from "./knights";
import { vertexToWorld, edgeToWorld, hexToWorld } from "../coords";
import type { BoardTile } from "@/lib/types";

const v = (q: number, r: number, side: 0 | 1): Vertex => ({ q, r, side });
const e = (a: Vertex, b: Vertex): Edge => ({ a, b });
const hex = (q: number, r: number): Hex => ({ q, r });

/**
 * A view carrying an `ext` and, optionally, a configured barbarian distance.
 *
 * `barbDist` reads `config.modules.cak` without guarding the config, and
 * `planBarbarians` asks it for the track length. Omit `dist` for the default
 * 7.
 */
function withExt(
  ext: Record<string, unknown>,
  dist?: number,
  boardTiles: BoardTile[] = [],
): FullView {
  return {
    ext,
    board: { tiles: boardTiles, harbors: [], robber: hex(0, 0), radius: 2 },
    config: { modules: dist === undefined ? {} : { cak: { barbarian_distance: dist } } },
  } as unknown as FullView;
}

const tiles: BoardTile[] = [];
for (let q = -2; q <= 2; q++) {
  for (let r = -2; r <= 2; r++) {
    if (Math.abs(q + r) <= 2)
      tiles.push({ hex: hex(q, r), res: "wood", num: 5 } as unknown as BoardTile);
  }
}

test("a ship sits on its edge, aligned to it, like a road that floats", () => {
  const edge = e(v(0, 0, 0), v(0, 0, 1));
  const [ship] = planShips(withExt({ islands: { ships: [{ e: edge, owner: 3 }] } }));
  expect(ship.owner).toBe(3);
  expect(ship.position).toEqual(edgeToWorld(edge));

  // Turning the local +x axis by rotationY must land it along the edge.
  const [ax, , az] = vertexToWorld(edge.a);
  const [bx, , bz] = vertexToWorld(edge.b);
  const a = ship.rotationY ?? 0;
  const along = [Math.cos(a), -Math.sin(a)];
  const len = Math.hypot(bx - ax, bz - az);
  expect(along[0]).toBeCloseTo((bx - ax) / len, 6);
  expect(along[1]).toBeCloseTo((bz - az) / len, 6);
});

test("no islands ext means no ships and no pirate, not a crash", () => {
  expect(planShips(withExt({}))).toEqual([]);
  expect(planPirate(withExt({}))).toEqual([]);
});

test("the pirate stands on a whole hex", () => {
  const out = planPirate(withExt({ islands: { ships: [], pirate: hex(1, -1) } }));
  expect(out).toEqual([{ position: hexToWorld(hex(1, -1)) }]);
});

test("a knight stands on its vertex, at a level that indexes the art", () => {
  const knights = [
    { v: v(0, 0, 0), owner: 1, level: 1, active: false, freshly_activated: false },
    { v: v(1, 0, 1), owner: 2, level: 3, active: true, freshly_activated: false },
  ];
  const out = planKnights(withExt({ cak: { knights, players: [] } }));
  expect(out[0].position).toEqual(vertexToWorld(knights[0].v));
  // Level is 1-based on the wire and an index here.
  expect(out[0].level).toBe(0);
  expect(out[1].level).toBe(2);
  expect(KNIGHT_PREFIX[out[1].level]).toBe("Knight_mighty");
  expect(out[1].active).toBe(true);
});

test("an out-of-range knight level is clamped, not dropped", () => {
  // A knight that exists should be drawn as something rather than vanish
  // because a level arrived that this build does not have art for.
  const out = planKnights(
    withExt({
      cak: { players: [], knights: [{ v: v(0, 0, 0), owner: 0, level: 9, active: false }] },
    }),
  );
  expect(out).toHaveLength(1);
  expect(KNIGHT_PREFIX[out[0].level]).toBe("Knight_mighty");
});

test("walls ring the city vertices that carry one", () => {
  const out = planWalls(
    withExt({ cak: { players: [], knights: [], walled: [v(0, 0, 0), v(1, 1, 1)] } }),
  );
  expect(out.map((p) => p.position)).toEqual([
    vertexToWorld(v(0, 0, 0)),
    vertexToWorld(v(1, 1, 1)),
  ]);
});

test("a metropolis is drawn only for a track its holder has actually won", () => {
  // metropolis_at carries a vertex per track whether or not it has been won,
  // so the flag is what makes a metropolis real.
  const at: [Vertex, Vertex, Vertex] = [v(0, 0, 0), v(1, 0, 0), v(0, 1, 0)];
  const players = [{ metropolis: [true, false, false], metropolis_at: at }];
  const out = planMetros(withExt({ cak: { players, knights: [] } }));
  expect(out).toHaveLength(1);
  expect(out[0].track).toBe(0);
  expect(out[0].owner).toBe(0);
  expect(out[0].position).toEqual(vertexToWorld(at[0]));
});

test("two players' metropolises are never merged into one draw", () => {
  // Grouping by track and dropping `owner` renders every metropolis in one
  // colour. A draw carries the tint, so one draw can only be one seat.
  const at = [v(0, 0, 0), v(1, 0, 0), v(2, 0, 0)];
  const players = [
    { metropolis: [true, false, false], metropolis_at: at },
    { metropolis: [false, true, false], metropolis_at: at },
  ];
  const draws = metroDraws(planMetros(withExt({ cak: { players, knights: [] } })));
  expect(draws).toHaveLength(2);
  expect(new Set(draws.map((d) => d.seat))).toEqual(new Set([0, 1]));
  for (const d of draws) {
    expect(new Set(d.at.map((m) => m.owner)), "a draw spans two seats").toEqual(new Set([d.seat]));
  }
});

test("one seat holding two tracks still gets one draw per track", () => {
  // Track picks the model, so merging a player's trade and science
  // metropolises into one draw would render one as the wrong building.
  const at = [v(0, 0, 0), v(1, 0, 0), v(2, 0, 0)];
  const players = [{ metropolis: [true, false, true], metropolis_at: at }];
  const draws = metroDraws(planMetros(withExt({ cak: { players, knights: [] } })));
  expect(draws).toHaveLength(2);
  expect(draws.map((d) => d.track).sort()).toEqual([0, 2]);
  expect(new Set(draws.map((d) => d.seat))).toEqual(new Set([0]));
});

test("draws come out in a stable order", () => {
  // The board is replanned on every update; an unstable order would reshuffle
  // the instanced meshes and break the drop animation's identity.
  const at = [v(0, 0, 0), v(1, 0, 0), v(2, 0, 0)];
  const players = [
    { metropolis: [false, false, true], metropolis_at: at },
    { metropolis: [true, true, false], metropolis_at: at },
  ];
  const metros = planMetros(withExt({ cak: { players, knights: [] } }));
  const once = metroDraws(metros).map((d) => `${d.seat}:${d.track}`);
  const twice = metroDraws([...metros].reverse()).map((d) => `${d.seat}:${d.track}`);
  expect(once).toEqual(twice);
  expect(once).toEqual(["0:2", "1:0", "1:1"]);
});

test("the metropolis tracks are ordered trade, politics, science", () => {
  // KnightsPlayer.improve and .metropolis are [Trade, Politics, Science]; any
  // other order swaps two of the three.
  expect(METRO_PREFIX[0]).toContain("trade");
  expect(METRO_PREFIX[1]).toContain("politics");
  expect(METRO_PREFIX[2]).toContain("science");

  const at: [Vertex, Vertex, Vertex] = [v(0, 0, 0), v(1, 0, 0), v(0, 1, 0)];
  const players = [{ metropolis: [false, false, true], metropolis_at: at }];
  const [science] = planMetros(withExt({ cak: { players, knights: [] } }));
  expect(METRO_PREFIX[science.track]).toBe("Metro_science_metropolis");
  expect(science.position).toEqual(vertexToWorld(at[2]));
});

test("the merchant sits on a hex", () => {
  expect(
    planMerchant(withExt({ cak: { players: [], knights: [], merchant: hex(2, -1) } })),
  ).toEqual([{ position: hexToWorld(hex(2, -1)) }]);
  expect(planMerchant(withExt({ cak: { players: [], knights: [] } }))).toEqual([]);
});

test("no Knights ext means no knights pieces at all", () => {
  const empty = withExt({});
  expect(planKnights(empty)).toEqual([]);
  expect(planWalls(empty)).toEqual([]);
  expect(planMetros(empty)).toEqual([]);
  expect(planMerchant(empty)).toEqual([]);
});
