import { test, expect } from "vitest";
import { planTiles, planOcean, tileScale, TILE_ROTATION_Y } from "./tiles";
import { hexToWorld, hexKey, LATTICE_SIZE } from "../coords";
import { boardExtent, nearOceanRadius, oceanBackdropRadius } from "../scene";
import { LATTICE_APOTHEM, TILE_APOTHEM } from "../gapGeometry";
import type { BoardTile } from "@/lib/types";

const board: BoardTile[] = [
  { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
  { hex: { q: 1, r: 0 }, res: "sea", num: 0 },
  { hex: { q: 0, r: 1 }, res: "lake", num: 0 },
];

test("each tile is placed at its own hex center", () => {
  const out = planTiles(board);
  expect(out).toHaveLength(3);
  const [x, , z] = hexToWorld({ q: 0, r: 0 });
  expect(out[0].position[0]).toBeCloseTo(x, 5);
  expect(out[0].position[2]).toBeCloseTo(z, 5);
});

test("water fills its cell exactly out to where the land's sand stops", () => {
  // A land tile's sand ring runs from its rim to the lattice midline, and the
  // water reaches the same midline from the other side. Any mismatch shows on
  // every coastal edge as a blue hairline or two coplanar surfaces fighting.
  expect(TILE_APOTHEM * tileScale("sea")).toBeCloseTo(LATTICE_APOTHEM, 6);
  expect(TILE_APOTHEM * tileScale("fog")).toBeCloseTo(LATTICE_APOTHEM, 6);
  expect(tileScale("wood"), "land keeps its authored size").toBe(1);
});

test("a lake is land: authored size, and its own tile", () => {
  // A lake is land: art/hexes/lake.blend is a land slab (circumradius 3.0,
  // which `make check-hexes` lists unflagged in the `wat` column) with the
  // water inset, matching the engine (`board.Land` is true for a lake). Roads
  // and settlements are built round its shore, in the gutter that water scale
  // would cover.
  expect(tileScale("lake"), "a lake keeps its authored size").toBe(1);

  const [lakeX, , lakeZ] = hexToWorld({ q: 0, r: 1 });
  const placed = planTiles(board).find(
    (p) => Math.abs(p.position[0] - lakeX) < 1e-6 && Math.abs(p.position[2] - lakeZ) < 1e-6,
  );
  expect(placed).toBeDefined();
  expect(placed!.file).toBe("tiles/lake.glb");
  expect(placed!.scale).toBe(1);
});

test("tiles with no art and no fallback are skipped rather than crashing", () => {
  // Out of contract on purpose: a resource this client has never heard of
  // should blank one tile, not the board.
  const unknown = { hex: { q: 0, r: 0 }, res: "banana", num: 0 } as unknown as BoardTile;
  expect(planTiles([unknown])).toEqual([]);
});

test("the ocean backdrop never double-draws a real tile position", () => {
  for (const pos of planOcean(board)) {
    const match = board.find(
      (t) =>
        Math.abs(hexToWorld(t.hex)[0] - pos[0]) < 1e-6 &&
        Math.abs(hexToWorld(t.hex)[2] - pos[2]) < 1e-6,
    );
    expect(match, `ocean overlaps real tile ${match ? hexKey(match.hex) : ""}`).toBeUndefined();
  }
});

test("the ocean extends beyond the board", () => {
  expect(planOcean(board).length).toBeGreaterThan(board.length);
});

// --- where the backdrop stops --------------------------------------------
//
// The backdrop is a disc. A hexagon of rings would overlap the flat water ring
// by a band that grows with the board (a hexagon's corners stand 15% further
// out than its edges), and the two coplanar waters would z-fight.

/** A board the size of the largest themed presets. */
const huge: BoardTile[] = [];
for (let q = -13; q <= 13; q++) {
  for (let r = -13; r <= 13; r++) {
    if (Math.abs(q + r) > 13) continue;
    huge.push({ hex: { q, r }, res: "wood", num: 0 });
  }
}

test("the backdrop's own outer edge is round, at every board size", () => {
  for (const [name, tiles] of [
    ["small", board],
    ["huge", huge],
  ] as const) {
    const radii = planOcean(tiles).map((p) => Math.hypot(p[0], p[2]));
    const reach = Math.max(...radii);
    const backdrop = oceanBackdropRadius(boardExtent(tiles));
    // Nothing past the disc; a hexagon's corners reach 2/sqrt(3) past its
    // edges.
    expect(reach, `${name} reach`).toBeLessThanOrEqual(backdrop + 1e-9);
    // ...and round: the field reaches nearly the same distance in every
    // direction. One cell of slack, the most a lattice cut to a circle can fall
    // short by (a cell, plus the half-row the direction may fall between). A
    // hexagon of rings would be short by 15% of its radius along its flats,
    // nearly five cells on this board.
    const placed = planOcean(tiles);
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      const along = Math.max(...placed.map((p) => p[0] * Math.cos(a) + p[2] * Math.sin(a)));
      expect(along, `${name} @ ${i}`).toBeGreaterThan(backdrop - 2 * LATTICE_SIZE);
    }
  }
});

test("the backdrop covers everywhere the flat ring begins", () => {
  // Every point out to `nearOceanRadius` must sit inside some sea hex, or the
  // join with the flat ring is a scalloped hole in the water.
  const tiles = huge;
  const near = nearOceanRadius(boardExtent(tiles));
  const centres = planOcean(tiles).map((p) => [p[0], p[2]] as const);
  for (let i = 0; i < 60; i++) {
    const a = (i * Math.PI) / 30;
    const x = near * Math.cos(a);
    const z = near * Math.sin(a);
    const nearest = Math.min(...centres.map(([cx, cz]) => Math.hypot(cx - x, cz - z)));
    // Inside a cell means within its inradius of the centre, worst case.
    expect(nearest, `join @ ${i}`).toBeLessThan(LATTICE_SIZE);
  }
});

test("the round backdrop skips the hexagon's hidden corners", () => {
  // A hexagon's corners would sit under the flat ring, out of sight. A
  // hexagon is 2/sqrt(3) ~ 1.21 times the area of its inscribed circle, so
  // that is most of a fifth of the backdrop.
  const disc = planOcean(huge).length;
  const rings = Math.ceil(oceanBackdropRadius(boardExtent(huge)) / (LATTICE_SIZE * 1.5));
  const hexagon = 3 * rings * (rings + 1) + 1;
  expect(disc).toBeLessThan(hexagon * 0.86);
});

test("every tile, water included, is laid down at the same half turn", () => {
  // The sea's relief is carved into the tile, so sea tiles read as one ocean
  // only while they all face the same way. The dock is the only water the
  // board turns, and its water is turned back to this.
  const placed = planTiles(board);
  expect(placed).toHaveLength(3);
  for (const p of placed) expect(p.rotationY).toBe(TILE_ROTATION_Y);
});

test("`land` forces land scale; otherwise the resource decides", () => {
  // The coastline's rule (`landKeys`) must be this file's too: the gutter sand
  // draws half a gutter round every hex that rule calls land, and a tile drawn
  // a whole cell wide buries that sand under its rim.
  //
  // Three overrides, three answers. A land slab over a land resource (every
  // Rivers channel) needs no `land` entry and keeps its size; the same slab
  // over water (the flooded oasis, the fog slab) is forced in and keeps its
  // size; a water hull over water (Explorers' shoal) fills its cell. Reading
  // `land` as the complete list would draw the river tiles 4.8% too wide.
  const tiles: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "ore", num: 5 },
    { hex: { q: 1, r: 0 }, res: "sea", num: 0 },
    { hex: { q: 2, r: 0 }, res: "sea", num: 0 },
  ];
  const files = new Map([
    [hexKey({ q: 0, r: 0 }), "tiles/river_mountains_e_w_a.glb"],
    [hexKey({ q: 1, r: 0 }), "tiles/oasis.glb"],
    [hexKey({ q: 2, r: 0 }), "tiles/sea_shoal.glb"],
  ]);
  const land = new Set([hexKey({ q: 1, r: 0 })]);
  const [river, oasis, shoal] = planTiles(tiles, files, undefined, land);
  expect(river.scale, "a river tile is land by resource and needs no forcing").toBe(1);
  expect(oasis.scale, "a land slab over water is forced to land scale").toBe(1);
  expect(shoal.scale, "a water hull over water fills its cell").toBe(tileScale("sea"));
  // With no set at all the resource alone decides: the same answer for the
  // river and the shoal, and the wrong one for the oasis, which is why the
  // oasis is in `land`.
  const bare = planTiles(tiles, files);
  expect(bare.map((p) => p.scale)).toEqual([1, tileScale("sea"), tileScale("sea")]);
});
