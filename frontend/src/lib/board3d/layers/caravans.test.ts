import { test, expect } from "vitest";
import {
  oasisHex,
  oasisHexes,
  tileArtOverrides,
  OASIS_TILE,
  planCamels,
  planSpokes,
} from "./caravans";
import { planTiles, tileScale } from "./tiles";
import { planGapSand } from "./gap";
import { landKeys, solveCoastLoops } from "../coastline";
import { hexKey, hexToWorld, edgeToWorld, edgeRotationY, edgeBearingY } from "../coords";
import { edgeKey, makeEdge, vertexKey } from "@/lib/hexgeo";
import { TILES } from "../manifest.generated";
import { caravansExt, type BoardTile, type FullView, type Hex, type Vertex } from "@/lib/types";

const tiles: BoardTile[] = [
  { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
  { hex: { q: 1, r: 0 }, res: "none", num: 0 },
  { hex: { q: 2, r: 0 }, res: "lake", num: 0 },
  { hex: { q: 3, r: 0 }, res: "none", num: 0 },
];

/** The thinnest FullView these functions actually read. */
function viewWith(ext?: Record<string, unknown>, board = tiles): FullView {
  return {
    board: { tiles: board, robber: { q: 0, r: 0 }, harbors: [] },
    ext,
  } as unknown as FullView;
}

function caravans(oasis?: Hex): Record<string, unknown> {
  return { caravans: { oasis, camels: [], camels_left: 22 } };
}

function fileAt(placed: ReturnType<typeof planTiles>, hex: Hex, board = tiles): string | undefined {
  const i = board.findIndex((t) => hexKey(t.hex) === hexKey(hex));
  return placed[i]?.file;
}

test("the derived oasis hex draws the oasis tile, and only that hex", () => {
  const view = viewWith(caravans({ q: 1, r: 0 }));
  expect(oasisHex(view)?.hex).toEqual({ q: 1, r: 0 });

  const placed = planTiles(tiles, tileArtOverrides(view).files);
  expect(fileAt(placed, { q: 1, r: 0 })).toBe("tiles/oasis.glb");
  // Every other hex keeps its resource's file, including the other desert,
  // which a resource-keyed mapping would get wrong.
  expect(fileAt(placed, { q: 3, r: 0 })).toBe("tiles/none.glb");
  expect(fileAt(placed, { q: 0, r: 0 })).toBe("tiles/wood.glb");
  expect(fileAt(placed, { q: 2, r: 0 })).toBe("tiles/lake.glb");
});

test("every oasis of a larger table draws the oasis tile", () => {
  // Derivation 13: two oases at five and six seats, so both desert hexes are
  // oases.
  const view = viewWith({
    caravans: {
      oasis: { q: 1, r: 0 },
      oases: [
        { q: 1, r: 0 },
        { q: 3, r: 0 },
      ],
      camels: [],
    },
  });
  expect(oasisHexes(view).map((t) => t.hex)).toEqual([
    { q: 1, r: 0 },
    { q: 3, r: 0 },
  ]);
  const placed = planTiles(tiles, tileArtOverrides(view).files);
  expect(fileAt(placed, { q: 1, r: 0 })).toBe("tiles/oasis.glb");
  expect(fileAt(placed, { q: 3, r: 0 })).toBe("tiles/oasis.glb");
  expect(fileAt(placed, { q: 0, r: 0 })).toBe("tiles/wood.glb");
  // An oasis on a terrain no oasis can be is dropped, the rest kept.
  const bad = viewWith({
    caravans: {
      oasis: { q: 1, r: 0 },
      oases: [
        { q: 1, r: 0 },
        { q: 0, r: 0 },
      ],
      camels: [],
    },
  });
  expect(oasisHexes(bad).map((t) => t.hex)).toEqual([{ q: 1, r: 0 }]);
});

test("a flooded oasis is still the oasis, and is still drawn at land size", () => {
  // Fishermen drowns the desert, so the oasis hex reads `lake` and its
  // resource says water. Water tiles are scaled to fill a lattice cell; the
  // oasis is a land model and would cover the gutter the roads live in.
  const view = viewWith(caravans({ q: 2, r: 0 }));
  expect(oasisHex(view)?.res).toBe("lake");
  const placed = planTiles(tiles, tileArtOverrides(view).files);
  expect(fileAt(placed, { q: 2, r: 0 })).toBe("tiles/oasis.glb");
  expect(placed[2].scale).toBe(1);
});

test("no Caravans module means no oasis anywhere", () => {
  const view = viewWith(undefined);
  expect(oasisHex(view)).toBeNull();
  expect(tileArtOverrides(view).files.size).toBe(0);
  for (const p of planTiles(tiles, tileArtOverrides(view).files)) {
    expect(p.file).not.toBe("tiles/oasis.glb");
  }
});

test("an inert Caravans module says so on the wire, and draws no oasis", () => {
  // The module is loaded with its ext present, but derived no oasis, so
  // `ViewExt` omits the key (engine/scenarios: emitted only when HasOasis, as a
  // nullable hex like islands' pirate). That omission is the signal.
  //
  // A desert sits at {0,0}, which is what a bare-hex zero value names, so
  // this fails if the wire goes back to a bare hex.
  const centreDesert: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "none", num: 0 },
    { hex: { q: 1, r: 0 }, res: "wood", num: 8 },
  ];
  const inert = { caravans: { camels: [], camels_left: 22 } };
  const view = viewWith(inert, centreDesert);
  expect(caravansExt(view), "the module is present, it just has no oasis").toBeDefined();
  expect(caravansExt(view)!.oasis).toBeUndefined();
  expect(oasisHex(view)).toBeNull();
  expect(tileArtOverrides(view).files.size).toBe(0);
  for (const p of planTiles(centreDesert, tileArtOverrides(view).files)) {
    expect(p.file).not.toBe("tiles/oasis.glb");
  }
});

test("a malformed frame is refused rather than drawn", () => {
  // Not the liveness signal (absence on the wire is). These guards stop an
  // impossible frame from putting an oasis off the board or on terrain no
  // desert was; a plain tile is the better failure. Separate so deleting
  // either guard is visible.
  expect(oasisHex(viewWith(caravans({ q: 9, r: 9 }))), "off the board").toBeNull();
  expect(oasisHex(viewWith(caravans({ q: 0, r: 0 }))), "on a forest").toBeNull();
});

test("the override names the manifest's own file rather than a literal", () => {
  // A re-export that renames or drops the tile is caught here rather than as
  // a 404 in a Caravans game.
  expect(
    tileArtOverrides(viewWith(caravans({ q: 1, r: 0 }))).files.get(hexKey({ q: 1, r: 0 })),
  ).toBe(TILES[OASIS_TILE].file);
});

// --- the shoreline half -------------------------------------------------
//
// Tile art is chosen per hex (only the module knows which desert became the
// oasis); beach, gap and scale are chosen per resource. Under Fishermen they
// disagree about one hex, because the flooded oasis is `lake` on the wire.
// `TileArt.land` reconciles them.

/** A flooded oasis with a land neighbour and open sea beyond it. */
const flooded: BoardTile[] = [
  { hex: { q: 0, r: 0 }, res: "lake", num: 0 }, // the oasis
  { hex: { q: 1, r: 0 }, res: "wood", num: 8 },
  { hex: { q: -1, r: 0 }, res: "sea", num: 0 },
];
const floodedView = viewWith(caravans({ q: 0, r: 0 }), flooded);
const oasisKey = hexKey({ q: 0, r: 0 });

test("a flooded oasis fills its own lattice gutter with sand", () => {
  // The oasis slab is authored to the land contract (circumradius 3.0, not
  // water's 3.1443), so it does not fill its lattice cell and needs gap sand
  // on all six seams. `lake` is now land by resource as well as by override;
  // the override is pinned separately below.
  const art = tileArtOverrides(floodedView);
  const sand = planGapSand(flooded, art.land);
  const own = sand.filter((p) => {
    const [x, , z] = hexToWorld({ q: 0, r: 0 });
    return Math.abs(p.position[0] - x) < 1e-6 && Math.abs(p.position[2] - z) < 1e-6;
  });
  expect(own, "one half-gap per edge").toHaveLength(6);
  // And the plain sea tile still contributes none: this widens land, not water.
  expect(planGapSand(flooded, art.land)).toHaveLength(12);
});

test("a flooded oasis is coast, not sea: no beach ring around it", () => {
  // A beach strip belongs to the water hex and is sized for a tile that fills
  // its cell. Solved as water, the oasis would get a ring of them and its land
  // neighbour an inland shoreline.
  const art = tileArtOverrides(floodedView);
  expect(landKeys(flooded, art.land).has(oasisKey), "the oasis is on the LAND side").toBe(true);
  // The real sea still gets its coast; the oasis moves to the land side of
  // the solver.
  expect(solveCoastLoops(flooded, art.land).flat().length).toBeGreaterThan(0);
});

test("`land` still does its job for a hex whose resource really is water", () => {
  // The flooded oasis cannot show what `land` does, since `lake` is land
  // on its own (see coastline.ts). So the mechanism is pinned on `fog`, the
  // one water resource a module could repaint: named as land it gets six
  // half-gaps and no beach ring; without it, neither.
  const foggy: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "fog", num: 0 },
    { hex: { q: 1, r: 0 }, res: "wood", num: 8 },
    { hex: { q: -1, r: 0 }, res: "sea", num: 0 },
  ];
  const key = hexKey({ q: 0, r: 0 });
  const asLand = new Set([key]);

  expect(planGapSand(foggy, asLand)).toHaveLength(12);
  expect(landKeys(foggy, asLand).has(key)).toBe(true);

  expect(landKeys(foggy).has(key)).toBe(false);
  expect(planGapSand(foggy)).toHaveLength(6);
});

test("the oasis is drawn at land scale whatever its resource says", () => {
  // The override forces scale 1, so a module repainting a hex with a land
  // model does not get it scaled up to fill a lattice cell. `planTiles` must
  // not rely on the resource for this; `tileScale("fog")` shows the
  // enlargement still applies to something.
  expect(tileScale("fog")).toBeGreaterThan(1);
  const placed = planTiles(flooded, tileArtOverrides(floodedView).files);
  expect(placed[0].file).toBe("tiles/oasis.glb");
  expect(placed[0].scale).toBe(1);
});

// --- the camels ---------------------------------------------------------

const A: Vertex = { q: 0, r: 0, side: 0 };
const B: Vertex = { q: 1, r: -1, side: 1 };
const C: Vertex = { q: 0, r: 1, side: 0 };
const D: Vertex = { q: -1, r: 1, side: 0 };
// A second caravan's edge, on its own side of the board and touching none of
// A..D, so a walk that ran the chains together has nothing to join to.
// `makeEdge` normalises it to (F, E), the reverse of this caravan's direction,
// so the correct bearing and the bare axis are half a turn apart.
const E: Vertex = { q: 4, r: -1, side: 1 };
const F: Vertex = { q: 3, r: 0, side: 0 };
const e1 = makeEdge(A, B);
const e2 = makeEdge(B, C);
const e3 = makeEdge(C, D);
const e4 = makeEdge(E, F);

function withCamels(x: Record<string, unknown>): FullView {
  return viewWith({ caravans: { camels_left: 20, ...x } });
}

test("a camel is drawn on every edge of every chain, and on no other", () => {
  const view = withCamels({
    caravans: [{ caravan: 0, arrow: e1, corner: A }],
    camels: [
      { caravan: 0, e: e1 },
      { caravan: 0, e: e2 },
    ],
    occupied: [e1, e2],
  });
  const camels = planCamels(view);
  expect(camels).toHaveLength(2);
  for (const [i, e] of [e1, e2].entries()) {
    const [x, , z] = edgeToWorld(e);
    expect(camels[i].position[0]).toBeCloseTo(x, 6);
    expect(camels[i].position[2]).toBeCloseTo(z, 6);
    expect(camels[i].key).toBe(`camel:${edgeKey(e)}`);
  }
});

test("a camel faces along its caravan, away from the oasis", () => {
  // The camel has a head (Camel_head spans x 0.149..0.894) and
  // `edgeRotationY` is an axis, not a bearing: it comes from an Edge that
  // `NewEdge` normalised by (q, r, side), unrelated to the caravan's
  // direction.
  //
  // This chain leaves the oasis at A and runs A -> B -> C, so the first camel
  // faces B and the second faces C.
  const view = withCamels({
    caravans: [{ caravan: 0, arrow: e1, corner: A }],
    camels: [
      { caravan: 0, e: e1 },
      { caravan: 0, e: e2 },
    ],
    occupied: [e1, e2],
  });
  const camels = planCamels(view);
  expect(camels[0].rotationY).toBeCloseTo(edgeBearingY(A, B), 9);
  expect(camels[1].rotationY).toBeCloseTo(edgeBearingY(B, C), 9);

  // e2 normalises to (C, B), so the bare axis points back down the caravan:
  // a camel walking backwards.
  expect(Math.abs(camels[1].rotationY! - edgeRotationY(e2))).toBeCloseTo(Math.PI, 9);
});

test("two caravans are walked separately, each from its own corner", () => {
  // The chains arrive concatenated in one flat list, so a walk that did not
  // break on the caravan number would carry the first chain's head into the
  // second.
  //
  // e4 makes that failure visible: it shares no vertex with caravan 0, and
  // `makeEdge` normalises it to (F, E) while the caravan runs E -> F, so a
  // collapsed walk falls back to the axis and is half a turn off. An edge
  // normalised the other way would agree by luck.
  expect(vertexKey(e4.a)).toBe(vertexKey(F));
  const view = withCamels({
    caravans: [
      { caravan: 0, arrow: e1, corner: A },
      { caravan: 1, arrow: e4, corner: E },
    ],
    camels: [
      { caravan: 0, e: e1 },
      { caravan: 1, e: e4 },
    ],
    occupied: [e1, e4],
  });
  const camels = planCamels(view);
  expect(camels.map((c) => c.key)).toEqual([`camel:${edgeKey(e1)}`, `camel:${edgeKey(e4)}`]);
  expect(camels[0].rotationY).toBeCloseTo(edgeBearingY(A, B), 9);
  expect(camels[1].rotationY).toBeCloseTo(edgeBearingY(E, F), 9);
  expect(Math.abs(camels[1].rotationY! - edgeRotationY(e4))).toBeCloseTo(Math.PI, 9);
});

test("a chain with no oasis corner takes its second camel's bearing", () => {
  // A caravan whose oasis corner has no outward land edge is omitted from
  // `caravans`, so the first camel has no corner. The vertex it shares with
  // the next camel is its head, which fixes the tail.
  const view = withCamels({
    camels: [
      { caravan: 0, e: e1 },
      { caravan: 0, e: e2 },
    ],
    occupied: [e1, e2],
  });
  const camels = planCamels(view);
  expect(camels[0].rotationY).toBeCloseTo(edgeBearingY(A, B), 9);
  expect(camels[1].rotationY).toBeCloseTo(edgeBearingY(B, C), 9);
});

test("a lone camel with no corner falls back to the axis", () => {
  // Nothing on this frame says which end is the far one. Lying along the edge
  // is right half the time; an invented direction would look intentional.
  const view = withCamels({ camels: [{ caravan: 0, e: e1 }], occupied: [e1] });
  expect(planCamels(view)[0].rotationY).toBeCloseTo(edgeRotationY(e1), 9);
});

test("a server that sends no chain still draws every camel, off occupied", () => {
  // `camels` is newer than `occupied`; against an older server, degrade to
  // un-oriented camels, never to none.
  const view = withCamels({ occupied: [e1, e2] });
  const camels = planCamels(view);
  expect(camels.map((c) => c.key)).toEqual([`camel:${edgeKey(e1)}`, `camel:${edgeKey(e2)}`]);
  expect(camels[1].rotationY).toBeCloseTo(edgeRotationY(e2), 9);
});

test("a Caravans board with no camels placed yet draws none", () => {
  expect(planCamels(withCamels({}))).toEqual([]);
  expect(planCamels(withCamels({ occupied: [] }))).toEqual([]);
});

test("a board with the module inert draws no camels and no spokes", () => {
  const view = viewWith(undefined);
  expect(planCamels(view)).toEqual([]);
  expect(planSpokes(view)).toEqual([]);
});

// --- the spokes ---------------------------------------------------------

test("a spoke is drawn on the arrow edge, turned along it like a camel", () => {
  const view = withCamels({
    caravans: [{ caravan: 0, arrow: e1, corner: A }],
  });
  const spokes = planSpokes(view);
  expect(spokes).toHaveLength(1);
  const [x, , z] = edgeToWorld(e1);
  expect(spokes[0].position[0]).toBeCloseTo(x, 6);
  expect(spokes[0].position[2]).toBeCloseTo(z, 6);
  expect(spokes[0].rotationY).toBeCloseTo(edgeRotationY(e1), 9);
  expect(spokes[0].key).toBe(`spoke:0:${edgeKey(e1)}`);
});

test("a spoke a camel already stands on is dropped, not drawn under it", () => {
  // Two things on one edge would read as two camels, and once the caravan
  // starts the spoke has nothing left to say.
  const view = withCamels({
    caravans: [
      { caravan: 0, arrow: e1, corner: A },
      { caravan: 1, arrow: e2, corner: B },
    ],
    occupied: [e1],
  });
  const spokes = planSpokes(view);
  expect(spokes).toHaveLength(1);
  expect(spokes[0].key).toBe(`spoke:1:${edgeKey(e2)}`);
  // The camel on the other spoke is still drawn, on the same edge.
  expect(planCamels(view).map((c) => c.key)).toEqual([`camel:${edgeKey(e1)}`]);
});

test("omits a caravan with no outward edge", () => {
  // The wire's contract (engine/scenarios/caravans.go skips a zero Arrow when
  // building `caravans`), asserted from the client. The zero edge is a real
  // edge at {0,0}, so a renderer handed one would draw a spoke at the origin.
  // A short list means fewer caravans.
  const zero = makeEdge({ q: 0, r: 0, side: 0 }, { q: 0, r: 0, side: 1 });
  const two = withCamels({
    caravans: [
      { caravan: 0, arrow: e1, corner: A },
      { caravan: 2, arrow: e2, corner: C },
    ],
  });
  expect(planSpokes(two).map((s) => s.key)).toEqual([
    `spoke:0:${edgeKey(e1)}`,
    `spoke:2:${edgeKey(e2)}`,
  ]);
  // The caravan that is missing is missing by number too, so a consumer that
  // indexed the list by position would be wrong about which caravan it had.
  expect(planSpokes(two).map((s) => s.key)).not.toContain(`spoke:1:${edgeKey(zero)}`);
});

test("camels carry no owner, because a caravan belongs to nobody", () => {
  // The seat that won the auction places the camel but does not own it; every
  // junction is open to whoever builds on it. No placement may name a seat.
  const view = withCamels({ occupied: [e1] });
  for (const c of planCamels(view)) {
    expect(c).not.toHaveProperty("owner");
    expect(c).not.toHaveProperty("tint");
  }
});

test("a spoke and a camel never share an edge", () => {
  // One edge, one marker: the waypost and the camel share a slot (same edge,
  // gutter seat and scale), so the swap reads as a caravan starting. That holds
  // only if the lists stay disjoint throughout a caravan's life.
  //
  // Walked as a sequence because the middle frame (two caravans started, one
  // waiting) is the one a filter checking "any camel exists" instead of "a
  // camel on this edge" fails.
  const arrows = [e1, e2, e3];
  const spokeWire = arrows.map((arrow, caravan) => ({ caravan, arrow, corner: A }));

  for (let taken = 0; taken <= arrows.length; taken++) {
    const view = withCamels({ caravans: spokeWire, occupied: arrows.slice(0, taken) });
    const onSpokes = new Set(planSpokes(view).map((s) => s.position.join()));
    const onCamels = new Set(planCamels(view).map((c) => c.position.join()));

    for (const at of onCamels) {
      expect(onSpokes.has(at), `both a camel and a waypost at ${at}`).toBe(false);
    }
    // Between them they still cover all three: a caravan is never unmarked.
    // A filter dropping every spoke would fail this.
    expect(onSpokes.size + onCamels.size, `${taken} caravans started`).toBe(arrows.length);
    expect(onCamels.size).toBe(taken);
  }
});
