import { test, expect, describe } from "vitest";
import type { FullView } from "@/lib/types";
import { planPickTargets, planInfoPicks, MARKER_Y, MODE_SHAPE, type TargetShape } from "./targets";
import type { BoardMode } from "@/lib/boardTargets";
import { vertexToWorld, edgeToWorld, hexToWorld } from "./coords";
import { vertexKey, edgeKey, makeEdge } from "@/lib/hexgeo";
import { applyPatch } from "@/lib/viewPatch";

const V = (q: number, r: number, side: 0 | 1) => ({ q, r, side });
// Via makeEdge, so endpoints are in the canonical order edgeKey and the grid
// use; a hand-ordered pair matches nothing.
const E = makeEdge;

/** Two real edges of hex (0,0). A pair of arbitrary vertices is not an edge. */
const EDGE_A = E(V(0, 0, 0), V(1, -1, 1));
const EDGE_B = E(V(0, 0, 1), V(0, 1, 0));

/**
 * A hand by resource index (1 wood, 2 brick, 3 sheep, 4 wheat, 5 ore).
 * `hand()` is broke. The default fixture is rich, so only resource tests need
 * to set one.
 */
type Hand6 = [number, number, number, number, number, number];
const hand = (over: Record<number, number> = {}): Hand6 =>
  [0, 1, 2, 3, 4, 5].map((i) => over[i] ?? 0) as Hand6;
const RICH = hand({ 1: 9, 2: 9, 3: 9, 4: 9, 5: 9 });

/** The viewer seated with `h` in hand. The other PlayerView fields are not read here. */
const seated = (h: Hand6) => [{ seat: 0, hand: h }] as unknown as FullView["players"];

function view(over: Partial<FullView> = {}): FullView {
  return {
    viewer: 0,
    phase: "play",
    players: seated(RICH),
    board: {
      radius: 1,
      robber: { q: 0, r: 0 },
      harbors: [],
      tiles: [
        { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
        { hex: { q: 1, r: 0 }, res: "brick", num: 5 },
        { hex: { q: 0, r: 1 }, res: "sea", num: 0 },
      ],
    },
    buildings: [],
    roads: [],
    ...over,
  } as unknown as FullView;
}

describe("membership follows view.legal, never the grid", () => {
  test("settlement mode offers exactly the legal settlement vertices", () => {
    const legal = { settlements: [V(0, 0, 0), V(1, 0, 1)] };
    const got = planPickTargets({ view: view({ legal }), mode: "settlement" });
    expect(got.map((t) => t.kind)).toEqual(["vertex", "vertex"]);
    expect(got.map((t) => (t.kind === "vertex" ? vertexKey(t.v) : ""))).toEqual(
      legal.settlements.map(vertexKey),
    );
    expect(got.every((t) => t.action === "vertex")).toBe(true);
  });

  test("road mode offers exactly the legal edges", () => {
    const roads = [EDGE_A];
    const got = planPickTargets({ view: view({ legal: { roads } }), mode: "road" });
    expect(got).toHaveLength(1);
    expect(got[0].kind === "edge" && edgeKey(got[0].e)).toBe(edgeKey(roads[0]));
  });

  test("no legal data means no targets, not the whole grid", () => {
    // E.g. the turn moved on and the server stopped sending `legal`.
    expect(planPickTargets({ view: view(), mode: "settlement" })).toEqual([]);
    expect(planPickTargets({ view: view(), mode: "road" })).toEqual([]);
  });

  test("an empty legal list means no targets", () => {
    expect(
      planPickTargets({ view: view({ legal: { settlements: [] } }), mode: "settlement" }),
    ).toEqual([]);
  });

  test("mode none offers nothing", () => {
    const legal = { settlements: [V(0, 0, 0)], roads: [EDGE_A] };
    expect(planPickTargets({ view: view({ legal }), mode: "none" })).toEqual([]);
  });

  test("wall mode offers exactly the legal wall vertices, and only those", () => {
    // Wall targets are your own cities, so only this mode highlights them.
    const legal = { walls: [V(0, 0, 0), V(1, 0, 1)], cities: [V(1, -1, 1)] };
    const got = planPickTargets({ view: view({ legal }), mode: "wall" });
    expect(got.map((t) => (t.kind === "vertex" ? vertexKey(t.v) : ""))).toEqual(
      legal.walls.map(vertexKey),
    );
    expect(got.every((t) => t.action === "vertex")).toBe(true);
  });

  test("wall mode with no wallable city offers nothing", () => {
    expect(planPickTargets({ view: view({ legal: { walls: [] } }), mode: "wall" })).toEqual([]);
  });

  test("a mode only ever offers its own kind", () => {
    const legal = { settlements: [V(0, 0, 0)], roads: [EDGE_A] };
    expect(
      planPickTargets({ view: view({ legal }), mode: "road" }).every((t) => t.kind === "edge"),
    ).toBe(true);
    expect(
      planPickTargets({ view: view({ legal }), mode: "settlement" }).every(
        (t) => t.kind === "vertex",
      ),
    ).toBe(true);
  });
});

describe("hexes", () => {
  test("robber mode takes the engine's hex list when it has one", () => {
    const legal = { robber_hexes: [{ q: 1, r: 0 }] };
    const got = planPickTargets({ view: view({ legal }), mode: "robber" });
    expect(got).toHaveLength(1);
    expect(got[0].kind === "hex" && got[0].h).toEqual({ q: 1, r: 0 });
  });

  // Hex targets come only from the engine's list, and a hovered target keeps
  // a ghost alive. A hex left on the list after the robber landed on it showed
  // a translucent robber on the real one until the server replied. The client
  // patch (`viewPatch.pruneLegal`) prunes it; this checks both halves agree.
  test("a hex the robber has just been moved to stops being a target", () => {
    const to = { q: 1, r: 0 };
    const before = view({ legal: { robber_hexes: [to, { q: 0, r: 1 }] } });
    expect(planPickTargets({ view: before, mode: "robber" })).toHaveLength(2);

    const after = applyPatch(before, { kind: "robber", hex: to });
    expect(after.board?.robber).toEqual(to);
    const got = planPickTargets({ view: after, mode: "robber" });
    expect(got.map((t) => (t.kind === "hex" ? t.h : null))).toEqual([{ q: 0, r: 1 }]);
  });

  test("falls back to the client filter without legal data", () => {
    // `legal` present but silent about hexes means none are offered. Only a
    // view with no legal block at all falls back.
    expect(planPickTargets({ view: view({ legal: {} }), mode: "robber" })).toEqual([]);
    const got = planPickTargets({ view: view(), mode: "robber" });
    // (0,0) holds the robber and (0,1) is sea, so only (1,0) is left.
    expect(got.map((t) => (t.kind === "hex" ? t.h : null))).toEqual([{ q: 1, r: 0 }]);
  });

  // The Fishermen 5-fish spend (docs/rules/scenarios.md) names an edge it could
  // legally build on now, and under Islands that may be a ship edge: the credit
  // buys either piece. Plain `road` mode would offer only `legal.roads`.
  describe("fishedge", () => {
    test("offers the road edges and the ship edges together", () => {
      const roads = [EDGE_A];
      const ships = [EDGE_B];
      const got = planPickTargets({
        view: view({ legal: { roads, ships } }),
        mode: "fishedge",
      });
      expect(got).toHaveLength(2);
      expect(got.every((t) => t.kind === "edge")).toBe(true);
    });

    test("offers nothing without a legal block", () => {
      expect(planPickTargets({ view: view({ legal: {} }), mode: "fishedge" })).toEqual([]);
    });
  });
});

describe("MODE_SHAPE: the audit, one row per mode", () => {
  // The `Record` makes a missing mode a build error; this catches a row that
  // is present but points at the wrong geometry (as ghost.test.ts does).
  const EXPECTED: Record<BoardMode, TargetShape> = {
    road: "edge",
    ship: "edge",
    // A bridge site: an edge to point at, and one a road may not have.
    bridge: "edge",
    fishbridge: "edge",
    // The Fishermen 5-fish spend's justifying edge: roads plus, under Islands,
    // ships.
    fishedge: "edge",
    shipmove: "edge",
    pedge: "edge",
    diplomatto: "edge",
    // Wagons: where an owed barbarian may be put down.
    wagonbarbarian: "edge",
    settlement: "vertex",
    city: "vertex",
    wall: "vertex",
    knight: "vertex",
    knightmove: "vertex",
    // Wagons: where this seat's wagon may drive to. Includes plazas, which are
    // not buildable vertices, hence the set comes from the engine.
    wagonmove: "vertex",
    pvertex: "vertex",
    deserterplace: "vertex",
    relocateknight: "vertex",
    barbariandowngrade: "vertex",
    metropolispick: "vertex",
    robber: "hex",
    phex: "hex",
    pirate: "hex",
    inventor1: "hex",
    inventor2: "hex",
    chaserobber: "hex",
    chasepirate: "hex",
    // Raiders. Both rider modes are edges: a rider stands on a path, never a
    // vertex; with Knights, a knight becomes an edge piece in Raiders.
    riderplace: "edge",
    ridermove: "edge",
    raiderhex: "hex",
    treasonfrom: "hex",
    treasonto: "hex",
    // Explorers: two edge modes (build a ship, sail one step) and two vertex
    // ones (take a harbour settlement, work a corner).
    cargoship: "edge",
    sail: "edge",
    harbour: "vertex",
    shipact: "vertex",
    none: null,
    // Inspect walks the legal lists in its own pass (see "inspect mode" below).
    inspect: null,
  };

  for (const [mode, want] of Object.entries(EXPECTED) as [BoardMode, TargetShape][]) {
    test(`${mode} points at ${want ?? "no key set"}`, () => {
      expect(MODE_SHAPE[mode]).toBe(want);
    });
  }
});

describe("move modes scope to the selected source", () => {
  const moves = {
    ship_moves: [{ from: EDGE_A, to: [EDGE_B] }],
  };

  test("no source selected means no destinations", () => {
    expect(planPickTargets({ view: view({ legal: moves }), mode: "shipmove" })).toEqual([]);
  });

  test("with a source, only that source's destinations", () => {
    const got = planPickTargets({
      view: view({ legal: moves }),
      mode: "shipmove",
      moveFromEdge: moves.ship_moves[0].from,
    });
    expect(got).toHaveLength(1);
    expect(got[0].kind === "edge" && edgeKey(got[0].e)).toBe(edgeKey(moves.ship_moves[0].to[0]));
  });
});

describe("inspect mode", () => {
  test("offers every location with any legal action, of both kinds", () => {
    const legal = {
      settlements: [V(0, 0, 0)],
      cities: [V(1, 0, 1)],
      roads: [EDGE_A],
    };
    const got = planPickTargets({ view: view({ legal }), mode: "inspect" });
    expect(got.every((t) => t.action === "inspect")).toBe(true);
    expect(got.filter((t) => t.kind === "vertex")).toHaveLength(2);
    expect(got.filter((t) => t.kind === "edge")).toHaveLength(1);
  });

  test("a vertex that is both a settlement and a city spot is offered once", () => {
    const legal = { settlements: [V(0, 0, 0)], cities: [V(0, 0, 0)] };
    expect(planPickTargets({ view: view({ legal }), mode: "inspect" })).toHaveLength(1);
  });
});

describe("inspect mode offers what is legal, whether or not you can pay", () => {
  // Legality decides membership; the menu decides each entry's status, so a
  // spot you cannot afford can still say "you need 1 more wheat".
  const spots = { settlements: [V(0, 0, 0)], cities: [V(1, 0, 1)], roads: [EDGE_A] };

  test("a settlement spot one resource short is still offered", () => {
    // Settlement is wood+brick+sheep+wheat; this hand is missing the wheat.
    const v = view({
      legal: { settlements: spots.settlements },
      players: seated(hand({ 1: 1, 2: 1, 3: 1 })),
    });
    const got = planPickTargets({ view: v, mode: "inspect" });
    expect(got).toHaveLength(1);
    expect(got[0].kind === "vertex" && vertexKey(got[0].v)).toBe(vertexKey(V(0, 0, 0)));
  });

  test("an empty hand is offered every legal spot", () => {
    const broke = view({ legal: spots, players: seated(hand()) });
    expect(planPickTargets({ view: broke, mode: "inspect" })).toHaveLength(3);
    // The same board with resources offers the same three.
    expect(planPickTargets({ view: view({ legal: spots }), mode: "inspect" })).toHaveLength(3);
  });

  test("a spectator, who has no legal set, is still offered nothing", () => {
    // Not an affordability question: without `legal` there are no spots.
    const v = view({ legal: undefined, viewer: -1, players: [] });
    expect(planPickTargets({ view: v, mode: "inspect" })).toEqual([]);
  });
});

describe("free builds are still offered to an empty hand", () => {
  test("setup placement is free: a build mode is never cost-filtered", () => {
    // Setup drives the board straight to "settlement"/"road" (Game.tsx
    // `setupMode`) and those placements are free; a cost filter on every mode
    // would make the game unstartable.
    const broke = {
      players: seated(hand()),
      phase: "setup",
    } as Partial<FullView>;
    const settle = view({ ...broke, legal: { settlements: [V(0, 0, 0)] } });
    expect(planPickTargets({ view: settle, mode: "settlement" })).toHaveLength(1);
    const road = view({ ...broke, legal: { roads: [EDGE_A] } });
    expect(planPickTargets({ view: road, mode: "road" })).toHaveLength(1);
    const ship = view({ ...broke, legal: { ships: [EDGE_B] } });
    expect(planPickTargets({ view: ship, mode: "ship" })).toHaveLength(1);
  });

  test("offers legal road and ship spots to an empty hand", () => {
    // A Road Building grant changes each entry's status, not which spots exist
    // (tested in locationActions).
    const broke = { players: seated(hand()) } as Partial<FullView>;
    const legal = { roads: [EDGE_A], ships: [EDGE_B] };
    expect(planPickTargets({ view: view({ ...broke, legal }), mode: "inspect" })).toHaveLength(2);
    const granted = view({ ...broke, legal, free_roads: 2 });
    const got = planPickTargets({ view: granted, mode: "inspect" });
    expect(got.map((t) => t.kind === "edge" && edgeKey(t.e)).sort()).toEqual(
      [edgeKey(EDGE_A), edgeKey(EDGE_B)].sort(),
    );
  });

  test("a costless action keeps its spot: an own knight that can move", () => {
    // Moving a knight is not a purchase. A level-3 active knight has nothing
    // to buy but can still move, so an empty hand must not hide it.
    const v = view({
      players: seated(hand()),
      legal: {},
      ext: { cak: { knights: [{ v: V(0, 0, 0), owner: 0, level: 3, active: true }] } },
    });
    const got = planPickTargets({ view: v, mode: "inspect" });
    expect(got).toHaveLength(1);
    expect(got[0].kind === "vertex" && vertexKey(got[0].v)).toBe(vertexKey(V(0, 0, 0)));
  });

  test("a knight whose every verb is out of reach is still pointable", () => {
    // Inactive and level 1, and both activate (wheat) and promote (sheep+ore)
    // are unaffordable. Its menu is where "you need 1 wheat" is said.
    const kn = { v: V(0, 0, 0), owner: 0, level: 1, active: false };
    const v = view({ players: seated(hand()), legal: {}, ext: { cak: { knights: [kn] } } });
    expect(planPickTargets({ view: v, mode: "inspect" })).toHaveLength(1);
  });

  test("keeps own knights pointable regardless of hand", () => {
    // `knights: true` makes your pieces tappable in any mode, regardless of
    // cost.
    const v = view({
      players: seated(hand()),
      ext: { cak: { knights: [{ v: V(0, 0, 0), owner: 0, level: 1, active: false }] } },
    });
    const got = planPickTargets({ view: v, mode: "none", knights: true });
    expect(got.map((t) => t.action)).toEqual(["knight"]);
  });
});

describe("own pieces", () => {
  const shipsOn = (legal: unknown) =>
    view({
      legal,
      ext: {
        islands: {
          ships: [
            { e: EDGE_A, owner: 0 },
            { e: EDGE_B, owner: 1 },
          ],
        },
      },
    } as unknown as Partial<FullView>);
  const withShips = shipsOn({ ship_moves: [{ from: EDGE_A, to: [EDGE_B] }] });

  test("own ships are pointable when the caller handles them", () => {
    const got = planPickTargets({ view: withShips, mode: "none", ships: true });
    expect(got).toHaveLength(1);
    expect(got[0].action).toBe("ship");
  });

  test("and not otherwise", () => {
    expect(planPickTargets({ view: withShips, mode: "none" })).toEqual([]);
  });

  // A hover promising a move that does not exist reads as a dropped click.
  test("a ship with no legal move is not pointable", () => {
    expect(
      planPickTargets({ view: shipsOn({ ship_moves: [] }), mode: "none", ships: true }),
    ).toEqual([]);
  });

  test("nor is one whose move list is empty", () => {
    const pinned = shipsOn({ ship_moves: [{ from: EDGE_A, to: [] }] });
    expect(planPickTargets({ view: pinned, mode: "none", ships: true })).toEqual([]);
  });

  test("own knights likewise", () => {
    const v = view({
      ext: {
        cak: {
          knights: [
            { v: V(0, 0, 0), owner: 0, level: 1, active: true },
            { v: V(1, 0, 1), owner: 2, level: 1, active: false },
          ],
        },
      },
    });
    const got = planPickTargets({ view: v, mode: "none", knights: true });
    expect(got).toHaveLength(1);
    expect(got[0].action).toBe("knight");
    expect(got[0].kind === "vertex" && vertexKey(got[0].v)).toBe(vertexKey(V(0, 0, 0)));
  });

  test("a placement marker outranks the piece sitting under it", () => {
    // Draw order is the tie-break in `nearestTarget`; the marker is what the
    // player sees.
    const v = view({
      legal: { cities: [V(0, 0, 0)] },
      ext: { cak: { knights: [{ v: V(0, 0, 0), owner: 0, level: 1, active: false }] } },
    });
    const got = planPickTargets({ view: v, mode: "city", knights: true });
    expect(got.map((t) => t.action)).toEqual(["vertex", "knight"]);
  });
});

describe("positions", () => {
  test("each target sits where its lattice feature is, at its marker height", () => {
    const legal = {
      settlements: [V(0, 0, 0)],
      roads: [EDGE_A],
      robber_hexes: [{ q: 1, r: 0 }],
    };
    const [vt] = planPickTargets({ view: view({ legal }), mode: "settlement" });
    const [et] = planPickTargets({ view: view({ legal }), mode: "road" });
    const [ht] = planPickTargets({ view: view({ legal }), mode: "robber" });

    const [vx, , vz] = vertexToWorld(V(0, 0, 0));
    expect(vt.pos).toEqual([vx, MARKER_Y.gutter, vz]);
    const [ex, , ez] = edgeToWorld(legal.roads[0]);
    expect(et.pos).toEqual([ex, MARKER_Y.gutter, ez]);
    const [hx, , hz] = hexToWorld({ q: 1, r: 0 });
    expect(ht.pos).toEqual([hx, MARKER_Y.land, hz]);
  });

  test("markers float above the surface they sit on, never inside it", () => {
    expect(MARKER_Y.gutter).toBeGreaterThan(0.22);
    expect(MARKER_Y.land).toBeGreaterThan(0.25);
  });
});

describe("planInfoPicks places the descriptions where the art stands", () => {
  const HOME = V(0, 0, 0);

  test("a building's description sits at its own vertex, in the gutter", () => {
    const got = planInfoPicks(view({ buildings: [{ v: HOME, owner: 0, city: true }] }));
    const here = got.find((t) => t.info.title === "City");
    const [x, , z] = vertexToWorld(HOME);
    expect(here?.pos).toEqual([x, MARKER_Y.gutter, z]);
  });

  // Roads are not described at all (see lib/boardInfo).
  test("a road gets no description to place", () => {
    const got = planInfoPicks(view({ roads: [{ e: EDGE_A, owner: 1 }] }));
    expect(got.map((t) => t.info.title)).not.toContain("Road");
  });

  test("the robber's description sits on its tile's face", () => {
    const got = planInfoPicks(view());
    const here = got.find((t) => t.info.title === "Robber");
    const [x, , z] = hexToWorld({ q: 0, r: 0 });
    expect(here?.pos).toEqual([x, MARKER_Y.land, z]);
  });

  // Unlike the ACTION targets, which are empty for anyone who cannot act.
  test("describes the board off-turn and for spectators alike", () => {
    const b = { buildings: [{ v: HOME, owner: 1, city: false }] };
    expect(planPickTargets({ view: view(b), mode: "none" })).toHaveLength(0);
    expect(planInfoPicks(view({ ...b, viewer: -1, legal: undefined })).length).toBeGreaterThan(0);
  });
});

describe("metropolispick plans the cities it asks you to choose between", () => {
  test("a metropolis pick offers every eligible city", () => {
    // The engine only asks when more than one city qualifies, so without the
    // mode the game would wait on a step nobody could take.
    const v = view({ legal: { metropolis_cities: [V(0, 0, 0), V(1, 0, 1)] } });
    const got = planPickTargets({ view: v, mode: "metropolispick" });
    expect(got.map((t) => t.kind === "vertex" && vertexKey(t.v)).sort()).toEqual(
      [vertexKey(V(0, 0, 0)), vertexKey(V(1, 0, 1))].sort(),
    );
  });
});

test("shared raiders can be placed on trade-hex interior spokes", () => {
  const spoke = { a: { q: 0, r: 0, side: 0 }, b: { q: 0, r: 0, side: 2 } };
  const v = view({ ext: { raiders: { pend: { kind: "raiders_path", seat: 0, edges: [spoke] } } } });
  const picks = planPickTargets({ view: v, mode: "riderplace" });
  expect(picks.some((p) => p.kind === "edge" && edgeKey(p.e) === edgeKey(spoke))).toBe(true);
  const centre = vertexToWorld(spoke.b);
  expect(centre).toEqual(hexToWorld({ q: 0, r: 0 }));
});

describe("a wagon may be driven into a plaza", () => {
  // The plaza is a vertex with side 2 at its trade hex's centre. It is not a
  // board corner, so it is not in the enumerated grid and must come from
  // `wagon_steps`.
  test("the plaza in wagon_steps becomes a target at its hex's centre", () => {
    const plaza = { q: 1, r: 0, side: 2 as const };
    const corner = V(0, 0, 0);
    const got = planPickTargets({
      view: view({ legal: { wagon_steps: [corner, plaza] } }),
      mode: "wagonmove",
    });
    const keys = got.map((t) => t.key);
    expect(keys).toContain(`vertex:${vertexKey(plaza)}`);
    expect(keys).toContain(`vertex:${vertexKey(corner)}`);
    const p = got.find((t) => t.key === `vertex:${vertexKey(plaza)}`)!;
    const [hx, , hz] = hexToWorld({ q: 1, r: 0 });
    expect(p.pos[0]).toBeCloseTo(hx);
    expect(p.pos[2]).toBeCloseTo(hz);
  });
});

describe("Explorers ship modes reach the board", () => {
  // `sail` and `shipact` resolve targets from the ship the fleet panel chose
  // (and `shipact` from its job), so both must reach the board.
  const legal = {
    explorer_ships: [
      {
        ship: 3,
        from: EDGE_A,
        moves: [EDGE_B],
        acts: [{ job: "land_settler", v: V(0, 0, 0) }],
        left: 4,
      },
    ],
  } as unknown as FullView["legal"];
  test("sail lights the chosen ship's moves", () => {
    const got = planPickTargets({ view: view({ legal }), mode: "sail", moveFromShip: 3 });
    expect(got.map((t) => t.key)).toEqual([`edge:${edgeKey(EDGE_B)}`]);
    expect(planPickTargets({ view: view({ legal }), mode: "sail" })).toEqual([]);
  });
  test("shipact lights the armed job's corners", () => {
    const got = planPickTargets({
      view: view({ legal }),
      mode: "shipact",
      moveFromShip: 3,
      shipJob: "land_settler",
    });
    expect(got.map((t) => t.key)).toEqual([`vertex:${vertexKey(V(0, 0, 0))}`]);
  });
});
