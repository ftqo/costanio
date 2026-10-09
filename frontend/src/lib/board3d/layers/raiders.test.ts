import { test, expect } from "vitest";
import {
  MUSTER_BEARINGS,
  MUSTER_RADIUS,
  MUSTER_SHIFT,
  RAIDER_PREFIX,
  RIDER_PREFIX,
  castleChipHidden,
  hiddenChips,
  hiddenChipsKey,
  castleHex,
  castleTileArt,
  planRaiders,
  planRiders,
  seatRaiders,
  MUSTER_SCALE,
} from "./raiders";
import { SURFACE } from "../seating";
import { planTiles, tileScale } from "./tiles";
import { CHIP_OFFSET_Z } from "./chips";
import { hexKey, hexToWorld, edgeToWorld, edgeRotationY } from "../coords";
import { edgeKey } from "@/lib/hexgeo";
import { TILES } from "../manifest.generated";
import { CASTLE_TILE } from "../loader";
import type { BoardTile, Edge, FullView, Hex } from "@/lib/types";

const tiles: BoardTile[] = [
  { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
  { hex: { q: 1, r: 0 }, res: "ore", num: 5 },
  { hex: { q: 2, r: 0 }, res: "sheep", num: 11 },
  { hex: { q: 3, r: 0 }, res: "sea", num: 0 },
];

const edge = (q: number, r: number): Edge => ({
  a: { q, r, side: 0 },
  b: { q: q + 1, r, side: 1 },
});

/** The thinnest FullView these functions actually read. */
function viewWith(ext?: Record<string, unknown>, board = tiles): FullView {
  return {
    board: { tiles: board, robber: { q: 0, r: 0 }, harbors: [] },
    ext,
  } as unknown as FullView;
}

function raiders(fields: Record<string, unknown>): Record<string, unknown> {
  return { raiders: fields };
}

function fileAt(placed: ReturnType<typeof planTiles>, hex: Hex, board = tiles): string | undefined {
  const i = board.findIndex((t) => hexKey(t.hex) === hexKey(hex));
  return placed[i]?.file;
}

// --- the castle -----------------------------------------------------------

test("the derived castle hex draws the castle tile, and only that hex", () => {
  const v = viewWith(raiders({ castle: { q: 1, r: 0 } }));
  expect(castleHex(v)?.hex).toEqual({ q: 1, r: 0 });
  const art = castleTileArt(v);
  const placed = planTiles(tiles, art.files);
  expect(fileAt(placed, { q: 1, r: 0 })).toBe(TILES[CASTLE_TILE].file);
  expect(fileAt(placed, { q: 0, r: 0 })).not.toBe(TILES[CASTLE_TILE].file);
  expect(art.files.size).toBe(1);
});

// The castle is a derived hex, not a terrain: the engine takes the
// centre-most ordinary interior hex and leaves the tile alone, so there is no
// terrain whitelist; a castle on ore is as valid as one on wood.
test("the castle takes whatever ordinary terrain it landed on", () => {
  for (const h of [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 2, r: 0 },
  ]) {
    const art = castleTileArt(viewWith(raiders({ castle: h })));
    expect(fileAt(planTiles(tiles, art.files), h), hexKey(h)).toBe(TILES[CASTLE_TILE].file);
  }
});

test("no Raiders module means no castle anywhere", () => {
  expect(castleHex(viewWith())).toBeNull();
  expect(castleTileArt(viewWith()).files.size).toBe(0);
});

// Liveness comes from the wire: an inert module omits `castle` rather than
// sending a zeroed hex, because {q:0,r:0} is a real hex at the board centre,
// where a live castle usually sits.
test("an inert module draws nothing, though the board centre is a legal site", () => {
  const v = viewWith(raiders({ coast: [{ q: 2, r: 0 }], raider_count: [1], supply: 9 }));
  expect(castleHex(v)).toBeNull();
  expect(castleTileArt(v).files.size).toBe(0);
  expect(castleChipHidden(v).size).toBe(0);
});

test("rejects a hex that is not on the board", () => {
  const v = viewWith(raiders({ castle: { q: 9, r: 9 } }));
  expect(castleHex(v)).toBeNull();
  expect(castleTileArt(v).files.size).toBe(0);
});

test("the override names the manifest's file, not a string literal", () => {
  const art = castleTileArt(viewWith(raiders({ castle: { q: 1, r: 0 } })));
  expect([...art.files.values()]).toEqual([TILES[CASTLE_TILE].file]);
});

// The engine does not rewrite the board: the chip layout is what the fairness
// audit reproduces from the seed. So the tile under the castle still carries
// an 11, and the client must not draw it.
test("the castle hides its tile's number chip, which is still on the wire", () => {
  const v = viewWith(raiders({ castle: { q: 2, r: 0 } }));
  expect(castleHex(v)?.num).toBe(11);
  expect([...castleChipHidden(v)]).toEqual([hexKey({ q: 2, r: 0 })]);
});

// Art is per hex and beach/gutter/scale per resource, so a substitution that
// forgot `land` would draw a land model with a coast solved as water.
test("the castle counts as land, so it is drawn at land size", () => {
  const art = castleTileArt(viewWith(raiders({ castle: { q: 1, r: 0 } })));
  expect(art.land.has(hexKey({ q: 1, r: 0 }))).toBe(true);
  const placed = planTiles(tiles, art.files);
  const i = tiles.findIndex((t) => hexKey(t.hex) === hexKey({ q: 1, r: 0 }));
  expect(placed[i].scale).toBe(1);
  // The counterfactual: something drawn at water's size is enlarged to fill
  // its lattice cell.
  expect(tileScale("sea")).toBeGreaterThan(1);
});

// --- the riders -----------------------------------------------------------

test("every rider is drawn on its own path, carrying its seat and no colour", () => {
  const v = viewWith(
    raiders({
      riders: [
        { player: 0, e: edge(0, 0) },
        { player: 3, e: edge(1, 0) },
      ],
    }),
  );
  const placed = planRiders(v);
  expect(placed).toHaveLength(2);
  expect(placed[0].position).toEqual(edgeToWorld(edge(0, 0)));
  expect(placed[0].rotationY).toBe(edgeRotationY(edge(0, 0)));
  expect(placed[0].owner).toBe(0);
  expect(placed[1].owner).toBe(3);
  // The seat rides on the placement and the colour is resolved at draw time,
  // so one instanced mesh serves ten seats.
  for (const p of placed) expect(p).not.toHaveProperty("tint");
});

test("a rider's key is its path, so it survives a rebuild in place", () => {
  const v = viewWith(raiders({ riders: [{ player: 1, e: edge(2, 0) }] }));
  expect(planRiders(v)[0].key).toBe(`rider:${edgeKey(edge(2, 0))}`);
});

test("no riders on the wire draws none", () => {
  expect(planRiders(viewWith())).toEqual([]);
  expect(planRiders(viewWith(raiders({ castle: { q: 0, r: 0 } })))).toEqual([]);
});

// --- the raiders ----------------------------------------------------------

test("a hex draws one figure per raider standing on it, up to three", () => {
  const v = viewWith(
    raiders({
      coast: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 2, r: 0 },
      ],
      raider_count: [0, 1, 3],
    }),
  );
  const placed = planRaiders(v);
  expect(placed).toHaveLength(4);
  const keys = placed.map((p) => p.key);
  // Keyed by hex and slot: the second raider on a hex is a new instance, not
  // the first one moving.
  expect(keys).toEqual([
    `raider:${hexKey({ q: 1, r: 0 })}:0`,
    `raider:${hexKey({ q: 2, r: 0 })}:0`,
    `raider:${hexKey({ q: 2, r: 0 })}:1`,
    `raider:${hexKey({ q: 2, r: 0 })}:2`,
  ]);
});

// Raiders are neutral: the art has no seat material and nothing here reads an
// owner. Riders, one letter away, are seat-tinted and stand on the same hex's
// paths.
test("raiders carry no owner and no tint", () => {
  const v = viewWith(raiders({ coast: [{ q: 1, r: 0 }], raider_count: [3] }));
  for (const p of planRaiders(v)) {
    expect(p).not.toHaveProperty("owner");
    expect(p).not.toHaveProperty("tint");
  }
});

// The muster was laid out against the number chip in the tile's authored
// frame, and the board turns every tile by TILE_ROTATION_Y on top of the
// Blender-to-glTF axis swap. Missing either turn puts the figures on the chip.
test("the muster is turned into world space, so it stays clear of the chip", () => {
  const hex = { q: 1, r: 0 };
  const v = viewWith(raiders({ coast: [hex], raider_count: [3] }));
  const [cx, , cz] = hexToWorld(hex);
  const chipZ = cz + CHIP_OFFSET_Z;
  for (const p of planRaiders(v)) {
    // Every figure ends up on the far side of the tile from the chip, which
    // MUSTER_SHIFT's negative authored y gives once both turns are applied.
    expect(p.position[2]).toBeLessThan(cz);
    expect(chipZ - p.position[2]).toBeGreaterThan(1.0);
  }
  // The group is centred on the shifted point rather than on the hex.
  const meanX = planRaiders(v).reduce((n, p) => n + p.position[0], 0) / 3;
  expect(meanX).toBeCloseTo(cx - MUSTER_SHIFT[0], 6);
});

test("the three figures sit on the muster circle, at the muster bearings", () => {
  const hex = { q: 2, r: 0 };
  const v = viewWith(raiders({ coast: [hex], raider_count: [3] }));
  const [cx, , cz] = hexToWorld(hex);
  const placed = planRaiders(v);
  placed.forEach((p, k) => {
    const b = (MUSTER_BEARINGS[k] * Math.PI) / 180;
    // The authored point, turned the same two turns the layer applies.
    const bx = MUSTER_SHIFT[0] + MUSTER_RADIUS * Math.cos(b);
    const by = MUSTER_SHIFT[1] + MUSTER_RADIUS * Math.sin(b);
    expect(p.position[0]).toBeCloseTo(cx - bx, 6);
    expect(p.position[2]).toBeCloseTo(cz + by, 6);
    // A half turn on the heading too, or every figure faces exactly backwards.
    expect(p.rotationY).toBeCloseTo(b + Math.PI, 6);
  });
});

test("a coast with nothing on it draws nothing", () => {
  expect(planRaiders(viewWith())).toEqual([]);
  const empty = viewWith(raiders({ coast: [{ q: 1, r: 0 }], raider_count: [0], supply: 12 }));
  expect(planRaiders(empty)).toEqual([]);
});

// A count the wire should never produce is refused: a fourth figure would
// have no bearing and would be drawn at the third's.
test("a count above three is clamped to the three the layout has room for", () => {
  const v = viewWith(raiders({ coast: [{ q: 1, r: 0 }], raider_count: [7] }));
  expect(planRaiders(v)).toHaveLength(MUSTER_BEARINGS.length);
});

// --- the node prefixes ----------------------------------------------------

test("the two prefixes are different files and different pieces", () => {
  // `Barbarian_` is the art's name (the file predates the module and is shared
  // with a future Wagons); the rules name is raider. Pinned so renaming one
  // does not silently change the other.
  expect(RIDER_PREFIX).toBe("Rider_");
  expect(RAIDER_PREFIX).toBe("Barbarian_");
  expect(RIDER_PREFIX).not.toBe(RAIDER_PREFIX);
});

// A conquered hex produces nothing, and the rule turns its chip face down, so
// the board must not draw its number.
test("a conquered hex's chip is hidden along with the castle's", () => {
  const v = viewWith(
    raiders({
      castle: { q: 2, r: 0 },
      conquered: [
        { q: -1, r: 2 },
        { q: 0, r: -2 },
      ],
    }),
  );
  expect([...hiddenChips(v)].sort()).toEqual(
    [hexKey({ q: 2, r: 0 }), hexKey({ q: -1, r: 2 }), hexKey({ q: 0, r: -2 })].sort(),
  );
  // The key moves when conquest does, so the static board is rebuilt.
  const won = viewWith(raiders({ castle: { q: 2, r: 0 }, conquered: [{ q: 0, r: -2 }] }));
  expect(hiddenChipsKey(won)).not.toBe(hiddenChipsKey(v));
  expect(castleChipHidden(v).size).toBe(1);
});

test("a full muster's third figure stands taller, and only a full muster's", () => {
  // Three raiders is a conquered hex, which a player must read across the
  // table; three equal figures read as scenery.
  const v = {
    board: { tiles, robber: { q: 9, r: 9 }, harbors: [] },
    ext: {
      raiders: {
        coast: [
          { q: 1, r: 0 },
          { q: 2, r: 0 },
        ],
        raider_count: [2, 3],
      },
    },
  } as unknown as FullView;
  const placed = planRaiders(v);
  expect(placed.map((p) => p.scale)).toEqual([1, 1, 1, 1, MUSTER_SCALE[2]]);
  expect(MUSTER_SCALE[2]).toBeGreaterThan(1);
  // Seated at its own size: the base multiplies in, and a bigger figure is
  // lowered more so every foot lands on the same ground.
  const seated = seatRaiders(placed, 0.1, 1.7);
  expect(seated[0].scale).toBeCloseTo(1.7, 9);
  expect(seated[4].scale).toBeCloseTo(1.7 * MUSTER_SCALE[2], 9);
  for (const p of seated) {
    expect(p.position[1] + 0.1 * p.scale!).toBeCloseTo(SURFACE.land, 9);
  }
});
