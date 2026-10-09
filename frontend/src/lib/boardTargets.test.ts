import { describe, expect, it } from "vitest";
import {
  boardModeFor,
  allowedEdgeKeys,
  allowedHexKeys,
  allowedVertexKeys,
  hexClickable,
  inspectableEdgeKeys,
  inspectableVertexKeys,
} from "./boardTargets";
import { edgeKey, hexKey, vertexKey } from "./hexgeo";
import { type Edge, type LegalTargets, type Vertex } from "./types";

const v = (q: number, r: number, side: 0 | 1): Vertex => ({ q, r, side });
const e = (a: Vertex, b: Vertex): Edge => ({ a, b });

describe("allowedHexKeys", () => {
  const robber_hexes = [
    { q: 1, r: -1 },
    { q: 2, r: 0 },
  ];
  const pirate_hexes = [{ q: -1, r: 2 }];
  const chase_robber_hexes = [
    { q: 0, r: 1 },
    { q: 1, r: 0 },
  ];
  const legal: LegalTargets = { robber_hexes, pirate_hexes, chase_robber_hexes };

  it("robber mode offers exactly legal.robber_hexes", () => {
    const got = allowedHexKeys("robber", legal);
    expect(got).not.toBeNull();
    expect([...got!].sort()).toEqual(robber_hexes.map(hexKey).sort());
  });

  it("pirate mode offers exactly legal.pirate_hexes", () => {
    const got = allowedHexKeys("pirate", legal);
    expect([...got!].sort()).toEqual(pirate_hexes.map(hexKey).sort());
  });

  it("chaserobber mode offers exactly legal.chase_robber_hexes", () => {
    const got = allowedHexKeys("chaserobber", legal);
    expect([...got!].sort()).toEqual(chase_robber_hexes.map(hexKey).sort());
  });

  // docs/rules/scenarios.md: two fish remove the robber from the board, with
  // no destination. So there is no `fishrobber` mode; the hex modes are
  // exactly the four that point at a hex.
  it("has no Fishermen hex mode: the 2-fish spend names no destination", () => {
    const hexModes = (["robber", "pirate", "chaserobber", "phex"] as const).filter(
      (m) => allowedHexKeys(m, legal) !== null,
    );
    expect(hexModes).toEqual(["robber", "pirate", "chaserobber", "phex"]);
    expect("fish_robber_hexes" in legal).toBe(false);
  });

  it("returns null (client-filter fallback) when legal absent", () => {
    expect(allowedHexKeys("robber", undefined)).toBeNull();
  });
});

describe("progress-card targets", () => {
  const merchHex = [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
  ];
  const medVerts = [v(2, 0, 0)];
  const dipSource = [e(v(0, 0, 0), v(0, 0, 1))];
  const dipDest = [e(v(1, 0, 0), v(1, 0, 1))];
  const legal: LegalTargets = {
    progress_targets: {
      merchant: { hexes: merchHex },
      inventor: { hexes: merchHex },
      medicine: { vertices: medVerts },
      diplomat: { edges: dipSource, moves: [{ from: dipSource[0], to: dipDest }] },
    },
  };

  it("phex uses the selected card's hexes", () => {
    expect([...allowedHexKeys("phex", legal, "merchant")!].sort()).toEqual(
      merchHex.map(hexKey).sort(),
    );
  });
  it("inventor uses the inventor hex set", () => {
    expect([...allowedHexKeys("inventor1", legal)!].sort()).toEqual(merchHex.map(hexKey).sort());
  });
  it("inventor step 2 excludes the hex step 1 already took", () => {
    // The engine accepts `{a: h, b: h}` and swaps a token with itself, wasting
    // the card, so step 2 omits the hex already chosen.
    const a = merchHex[0];
    const got = [...allowedHexKeys("inventor2", legal, "inventor", a)!];
    expect(got).not.toContain(hexKey(a));
    expect(got.sort()).toEqual(
      merchHex
        .filter((h) => hexKey(h) !== hexKey(a))
        .map(hexKey)
        .sort(),
    );
  });
  it("inventor step 2 with no first hex yet keeps the full set", () => {
    expect([...allowedHexKeys("inventor2", legal, "inventor")!].sort()).toEqual(
      merchHex.map(hexKey).sort(),
    );
  });
  it("step 1 is never narrowed by a leftover first hex", () => {
    expect([...allowedHexKeys("inventor1", legal, "inventor", merchHex[0])!].sort()).toEqual(
      merchHex.map(hexKey).sort(),
    );
  });
  it("pvertex uses the selected card's vertices", () => {
    expect([...allowedVertexKeys("pvertex", legal, undefined, "medicine")!]).toEqual(
      medVerts.map(vertexKey),
    );
  });
  it("pedge offers the Diplomat source roads", () => {
    expect([...allowedEdgeKeys("pedge", legal, undefined, "diplomat")!]).toEqual(
      dipSource.map(edgeKey),
    );
  });
  it("diplomatto offers the per-source relocation destinations", () => {
    expect([...allowedEdgeKeys("diplomatto", legal, dipSource[0])!]).toEqual(dipDest.map(edgeKey));
  });
});

describe("allowedEdgeKeys", () => {
  const ships = [e(v(0, 0, 0), v(0, 0, 1)), e(v(1, 0, 0), v(1, 0, 1))];
  const roads = [e(v(2, 0, 0), v(2, 0, 1))];
  const legal: LegalTargets = {
    roads,
    ships,
    ship_moves: [
      {
        from: e(v(0, 0, 1), v(1, 0, 0)),
        to: [e(v(1, 0, 0), v(1, 0, 1)), e(v(2, 0, 0), v(2, 0, 1))],
      },
    ],
  };

  it("ship mode offers exactly legal.ships", () => {
    const got = allowedEdgeKeys("ship", legal);
    expect(got).not.toBeNull();
    expect([...got!].sort()).toEqual(ships.map(edgeKey).sort());
  });

  it("road mode offers exactly legal.roads", () => {
    const got = allowedEdgeKeys("road", legal);
    expect([...got!].sort()).toEqual(roads.map(edgeKey).sort());
  });

  // docs/rules/scenarios.md: the 5-fish spend names an edge it could legally
  // build on now, and under Islands that may be a ship edge: the credit buys
  // either.
  it("fishedge offers the roads and the ships together", () => {
    const got = allowedEdgeKeys("fishedge", legal);
    expect([...got!].sort()).toEqual([...roads, ...ships].map(edgeKey).sort());
  });

  it("fishedge is exactly the roads where the ruleset has no ships", () => {
    const got = allowedEdgeKeys("fishedge", { roads });
    expect([...got!].sort()).toEqual(roads.map(edgeKey).sort());
  });

  it("shipmove offers the To of the matching source group", () => {
    const from = e(v(0, 0, 1), v(1, 0, 0));
    const got = allowedEdgeKeys("shipmove", legal, from);
    expect([...got!].sort()).toEqual(legal.ship_moves![0].to.map(edgeKey).sort());
  });

  it("shipmove with no source selected offers nothing (empty set, not null)", () => {
    const got = allowedEdgeKeys("shipmove", legal);
    expect(got).not.toBeNull();
    expect(got!.size).toBe(0);
  });

  it("shipmove with an unmatched source offers nothing", () => {
    const got = allowedEdgeKeys("shipmove", legal, e(v(9, 9, 0), v(9, 9, 1)));
    expect(got!.size).toBe(0);
  });

  it("empty legal set renders nothing, not the full grid", () => {
    const got = allowedEdgeKeys("ship", { ships: [] });
    expect(got).not.toBeNull();
    expect(got!.size).toBe(0);
  });

  it("no legal object at all falls back to the full grid (null)", () => {
    expect(allowedEdgeKeys("ship", undefined)).toBeNull();
  });

  it("pedge with no diplomat targets offers an empty set", () => {
    expect(allowedEdgeKeys("pedge", legal, undefined, "diplomat")!.size).toBe(0);
  });
});

describe("allowedVertexKeys", () => {
  const knights = [v(0, 0, 0), v(1, 0, 0)];
  const legal: LegalTargets = {
    settlements: [v(3, 0, 0)],
    knights,
    knight_moves: [{ from: v(0, 0, 0), to: [v(1, 0, 0), v(2, 0, 0)], displace: [v(2, 0, 0)] }],
  };

  it("knight mode offers exactly legal.knights", () => {
    const got = allowedVertexKeys("knight", legal);
    expect([...got!].sort()).toEqual(knights.map(vertexKey).sort());
  });

  it("knightmove offers the targets of the selected source", () => {
    const got = allowedVertexKeys("knightmove", legal, v(0, 0, 0));
    expect([...got!].sort()).toEqual(legal.knight_moves![0].to.map(vertexKey).sort());
    // displacement destination is in the offered set.
    expect(got!.has(vertexKey(v(2, 0, 0)))).toBe(true);
  });

  it("knightmove with no source selected offers nothing", () => {
    const got = allowedVertexKeys("knightmove", legal);
    expect(got!.size).toBe(0);
  });

  it("deserterplace offers exactly legal.deserter_placements", () => {
    const ds = [v(4, 0, 0), v(5, 0, 0)];
    const got = allowedVertexKeys("deserterplace", { deserter_placements: ds });
    expect([...got!].sort()).toEqual(ds.map(vertexKey).sort());
  });

  it("relocateknight offers exactly legal.knight_relocations", () => {
    const kr = [v(6, 0, 0)];
    const got = allowedVertexKeys("relocateknight", { knight_relocations: kr });
    expect([...got!].sort()).toEqual(kr.map(vertexKey).sort());
  });

  it("barbariandowngrade offers exactly legal.barbarian_downgrades", () => {
    const bd = [v(7, 0, 0), v(8, 0, 0)];
    const got = allowedVertexKeys("barbariandowngrade", { barbarian_downgrades: bd });
    expect([...got!].sort()).toEqual(bd.map(vertexKey).sort());
  });

  it("barbariandowngrade with no cities offers an empty set", () => {
    expect(allowedVertexKeys("barbariandowngrade", legal)!.size).toBe(0);
  });

  // Like the sacrifice: your own cities, one of which you must name. A wrong
  // set leaves the prompt with nothing clickable.
  it("metropolispick offers exactly legal.metropolis_cities", () => {
    const mc = [v(9, 0, 0), v(10, 0, 0)];
    const got = allowedVertexKeys("metropolispick", { metropolis_cities: mc });
    expect([...got!].sort()).toEqual(mc.map(vertexKey).sort());
  });

  it("metropolispick with no cities offers an empty set", () => {
    expect(allowedVertexKeys("metropolispick", legal)!.size).toBe(0);
  });

  it("pvertex with no card targets offers an empty set", () => {
    expect(allowedVertexKeys("pvertex", legal, undefined, "medicine")!.size).toBe(0);
  });

  // The viewer's own unwalled cities; the player picks rather than the
  // engine's board-order fallback.
  it("wall mode offers exactly legal.walls", () => {
    const walls = [v(7, 0, 0), v(8, 0, 1)];
    const got = allowedVertexKeys("wall", { ...legal, walls });
    expect([...got!].sort()).toEqual(walls.map(vertexKey).sort());
  });

  it("wall mode with no walls offers an empty set", () => {
    expect(allowedVertexKeys("wall", legal)!.size).toBe(0);
  });

  it("wall mode with no legal data at all falls back to null", () => {
    expect(allowedVertexKeys("wall", undefined)).toBeNull();
  });
});

describe("hexClickable", () => {
  const robber = { q: 1, r: 1 };
  const pirate = { q: -2, r: 0 };
  const land = { hex: { q: 0, r: 0 }, res: "wood" };
  const desert = { hex: { q: 0, r: 1 }, res: "none" };
  const sea = { hex: { q: -1, r: 0 }, res: "sea" };
  const seaPirate = { hex: pirate, res: "sea" };
  const robberTile = { hex: robber, res: "ore" };

  it("robber: land tiles except the current robber hex; never sea", () => {
    expect(hexClickable("robber", land, robber, pirate)).toBe(true);
    expect(hexClickable("robber", desert, robber, pirate)).toBe(true); // desert is valid
    expect(hexClickable("robber", sea, robber, pirate)).toBe(false);
    expect(hexClickable("robber", robberTile, robber, pirate)).toBe(false); // current hex
  });

  it("pirate: sea tiles except the current pirate hex; never land", () => {
    expect(hexClickable("pirate", sea, robber, pirate)).toBe(true);
    expect(hexClickable("pirate", seaPirate, robber, pirate)).toBe(false); // current hex
    expect(hexClickable("pirate", land, robber, pirate)).toBe(false);
  });

  it("phex / inventor keep every tile", () => {
    expect(hexClickable("phex", sea, robber, pirate)).toBe(true);
    expect(hexClickable("inventor1", land, robber, pirate)).toBe(true);
    expect(hexClickable("inventor2", robberTile, robber, pirate)).toBe(true);
  });
});

describe("inspect sets", () => {
  it("edge union covers roads, ships, and ship-move sources", () => {
    const road = e(v(0, 0, 0), v(0, 0, 1));
    const ship = e(v(1, 0, 0), v(1, 0, 1));
    const src = e(v(2, 0, 0), v(2, 0, 1));
    const got = inspectableEdgeKeys({
      roads: [road],
      ships: [ship],
      ship_moves: [{ from: src, to: [] }],
    });
    expect([...got].sort()).toEqual([road, ship, src].map(edgeKey).sort());
  });

  it("vertex union covers settlements/cities/knights/walls plus own knights", () => {
    const s = v(0, 0, 0),
      c = v(1, 0, 0),
      own = v(9, 0, 0);
    const got = inspectableVertexKeys({ settlements: [s], cities: [c] }, [own]);
    expect([...got].sort()).toEqual([s, c, own].map(vertexKey).sort());
  });

  it("absent legal still includes own knights", () => {
    const own = v(9, 0, 0);
    expect([...inspectableVertexKeys(undefined, [own])]).toEqual([vertexKey(own)]);
    expect(inspectableEdgeKeys(undefined).size).toBe(0);
  });
});

describe("boardModeFor", () => {
  // The Deserter taker owes the replacement knight on their own build turn,
  // with `canBuild` true and the armed mode "none". The server sends no other
  // legal set meanwhile, so choosing inspect would leave the board inert.
  it("keeps a forced knight-placement mode even on your own build turn", () => {
    expect(boardModeFor("deserterplace", true)).toBe("deserterplace");
    expect(boardModeFor("relocateknight", true)).toBe("relocateknight");
    // Same shape: the barbarian sacrifice can fall on your own build turn.
    expect(boardModeFor("barbariandowngrade", true)).toBe("barbariandowngrade");
  });

  it("keeps every other resolved mode as-is, buildable or not", () => {
    for (const m of ["settlement", "knight", "knightmove", "pvertex", "robber"] as const) {
      expect(boardModeFor(m, true)).toBe(m);
      expect(boardModeFor(m, false)).toBe(m);
    }
  });

  it("falls back to inspect only when nothing has claimed the board", () => {
    expect(boardModeFor("none", true)).toBe("inspect");
    expect(boardModeFor("none", false)).toBe("none");
  });
});

// ---- Raiders ----
//
// Raiders pieces live on edges and hexes `LegalTargets` has no field for, so
// the pick lists travel in the module's own view. They must work with no
// `legal` at all: a Raiders pending blocks the turn and empties `legal`, which
// is exactly when a landing needs a hex.
describe("the Raiders picks, which come off the module's view and not off legal", () => {
  const hexes = [
    { q: 2, r: 0 },
    { q: 0, r: 2 },
  ];
  const from = e(v(0, 0, 0), v(1, 0, 1));
  const free = e(v(1, 0, 1), v(1, 0, 0));
  const paid = e(v(2, 0, 0), v(2, 0, 1));

  it("offers a landing tie's hexes with no legal set at all", () => {
    const ks = allowedHexKeys("raiderhex", undefined, null, null, {
      pend: { kind: "raiders_landing", seat: 0, hexes },
    });
    expect(ks).toEqual(new Set(hexes.map(hexKey)));
  });

  it("offers Intrigue hexes through the same mode", () => {
    const ks = allowedHexKeys("raiderhex", undefined, null, null, {
      pend: { kind: "raiders_intrigue", seat: 1, hexes: [hexes[0]] },
    });
    expect(ks).toEqual(new Set([hexKey(hexes[0])]));
  });

  // The lists reach only the seat being asked; anyone else gets an empty set
  // (render nothing), not the whole grid.
  it("offers nothing to a viewer the wire sent no list", () => {
    const ks = allowedHexKeys("raiderhex", undefined, null, null, {
      pend: { kind: "raiders_landing", seat: 3 },
    });
    expect(ks).toEqual(new Set());
    expect(allowedHexKeys("raiderhex", undefined, null, null, undefined)).toEqual(new Set());
  });

  it("splits Treason into its two ingredients, from and to", () => {
    const pend = {
      kind: "raiders_treason" as const,
      seat: 0,
      treason_from: [hexes[0]],
      treason_to: [hexes[1]],
    };
    expect(allowedHexKeys("treasonfrom", undefined, null, null, { pend })).toEqual(
      new Set([hexKey(hexes[0])]),
    );
    expect(allowedHexKeys("treasonto", undefined, null, null, { pend })).toEqual(
      new Set([hexKey(hexes[1])]),
    );
  });

  it("offers a rider placement the paths the card allows, and nothing else", () => {
    const ks = allowedEdgeKeys("riderplace", undefined, undefined, null, {
      pend: { kind: "raiders_muster", seat: 0, edges: [from, free] },
    });
    expect(ks).toEqual(new Set([edgeKey(from), edgeKey(free)]));
  });

  // Like `shipmove`: with no rider chosen this is an empty set, not null.
  // Choosing a rider is `inspectableEdgeKeys`' job.
  it("offers a rider's destinations only once a rider is chosen", () => {
    const raiders = { rider_moves: [{ from, to: [free], hurry: [paid] }] };
    expect(allowedEdgeKeys("ridermove", undefined, undefined, null, raiders)).toEqual(new Set());
    expect(allowedEdgeKeys("ridermove", undefined, from, null, raiders)).toEqual(
      new Set([edgeKey(free), edgeKey(paid)]),
    );
  });

  // Hurried destinations are offered alongside free ones; the confirm step
  // states the grain cost.
  it("lights the hurried paths too, and leaves the price to the confirm", () => {
    const raiders = { rider_moves: [{ from, to: [free], hurry: [paid] }] };
    expect(allowedEdgeKeys("ridermove", undefined, from, null, raiders)?.has(edgeKey(paid))).toBe(
      true,
    );
  });

  // ...but only to a player who can pay, or the tap is refused.
  it("leaves the hurried paths dark when the seat cannot pay for them", () => {
    const raiders = { rider_moves: [{ from, to: [free], hurry: [paid] }] };
    expect(allowedEdgeKeys("ridermove", undefined, from, null, raiders, null, false)).toEqual(
      new Set([edgeKey(free)]),
    );
  });

  it("offers nothing for a rider that is not in the offer", () => {
    const raiders = { rider_moves: [{ from, to: [free] }] };
    expect(allowedEdgeKeys("ridermove", undefined, paid, null, raiders)).toEqual(new Set());
  });

  // The first step of a two-step move, like `ship_moves[].from`, and outside
  // the `legal` guard since `rider_moves` is on the module's own view.
  it("makes a movable rider clickable in the inspect flow, with no legal set", () => {
    const ks = inspectableEdgeKeys(undefined, { rider_moves: [{ from, to: [free] }] });
    expect(ks).toEqual(new Set([edgeKey(from)]));
  });

  it("adds the riders to the roads and ships rather than replacing them", () => {
    const legal: LegalTargets = { roads: [free] };
    const ks = inspectableEdgeKeys(legal, { rider_moves: [{ from, to: [] }] });
    expect(ks).toEqual(new Set([edgeKey(from), edgeKey(free)]));
  });

  it("adds nothing at all in a game without the scenario", () => {
    expect(inspectableEdgeKeys({ roads: [free] })).toEqual(new Set([edgeKey(free)]));
  });
});
