// The Rivers layer: which tile a river hex draws, and where a bridge stands.
//
// There is a file per shape, so no tile is turned (turning a tile would turn
// its chip socket away from the chip, which `layers/chips.ts` does not turn;
// see the header of `rivers.ts`). This checks that the correspondence the
// shape ids are named for matches this renderer (`the six lattice
// directions...`), that every river tile is laid down unturned, and that shape
// and terrain pick the file between them. That each shape's water clears the
// chip's disc is measured off the shipped .glb files in `riverArt.test.ts`.
import { test, expect } from "vitest";
import {
  planRiverTiles,
  planBridges,
  CHANNEL_SHAPES,
  CHANNEL_TILES,
  EW_VARIANT_TILES,
  RIVER_BOARD_TILES,
  RIVER_FAMILIES,
  RIVER_TILES,
  RIVER_TILE_NAMES,
  SOURCE_SHAPES,
  SOURCE_TILES,
  SWAMP_TILE,
  riverTileKey,
} from "./rivers";
import { CHIP_OFFSET_Z, planChips } from "./chips";
import { tileArtOverrides } from "./caravans";
import { planTiles, tileScale } from "./tiles";
import { isWaterTile, planGapSand } from "./gap";
import { landKeys } from "../coastline";
import { boardModelFiles, tileFileFor } from "../loader";
import { bridgeSiteKeys } from "@/lib/rivers";
import { hexEdges, edgeKey, hexKey } from "@/lib/hexgeo";
import { DIRS, edgeToWorld, hexToWorld, TILE_ROTATION_Y } from "../coords";
import { TILES } from "../manifest.generated";
import type { BoardTile, Edge, FullView, Hex, RiverShape } from "@/lib/types";

/**
 * A world direction as the tile art measures a bearing: a direction at angle `t`
 * is the vector (cos t, -sin t), so bearings count anticlockwise on screen from
 * +x. Reported in degrees, folded into [0, 360).
 */
function bearing(dx: number, dz: number): number {
  const deg = (Math.atan2(-dz, dx) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * `engine/rivers/chip_test.go`'s direction table, transcribed.
 *
 * Keyed on the axial step, not an index, because the two sides index the
 * directions differently: Go's `board.hexDirs` runs {+1,0} {+1,-1} {0,-1}
 * {-1,0} {-1,+1} {0,+1}, anticlockwise on screen, while this renderer's `DIRS`
 * runs {+1,0} {0,+1} {-1,+1} {-1,0} {0,-1} {+1,-1}, clockwise. Index 1 is
 * north-east there and south-east here.
 *
 * `mouth` is how far a mouth on that edge sits from the chip mount; see the
 * second test below.
 */
const LATTICE = [
  { q: 1, r: 0, compass: "east", short: "e", bearing: 0, mouth: 3.0 },
  { q: 1, r: -1, compass: "north-east", short: "ne", bearing: 60, mouth: 3.968626 },
  { q: 0, r: -1, compass: "north-west", short: "nw", bearing: 120, mouth: 3.968626 },
  { q: -1, r: 0, compass: "west", short: "w", bearing: 180, mouth: 3.0 },
  { q: -1, r: 1, compass: "south-west", short: "sw", bearing: 240, mouth: 1.5 },
  { q: 0, r: 1, compass: "south-east", short: "se", bearing: 300, mouth: 1.5 },
] as const;

test("the six lattice directions are the bearings the engine names", () => {
  // The frontend half of engine/rivers/chip_test.go's TestDirectionTable. Go
  // has no world coordinates, so it asserts only the axial steps; this side
  // turns them into world positions with the renderer's `hexToWorld` and
  // checks the bearings. Together they pin the shape ids end to end.
  const origin: Hex = { q: 0, r: 0 };
  const [ox, , oz] = hexToWorld(origin);
  for (const l of LATTICE) {
    const [nx, , nz] = hexToWorld({ q: origin.q + l.q, r: origin.r + l.r });
    expect(bearing(nx - ox, nz - oz), `${l.compass}`).toBeCloseTo(l.bearing, 9);
  }
  // The six steps are the six neighbours, so the table cannot drift into
  // directions the lattice does not have.
  expect(new Set(LATTICE.map((l) => `${l.q},${l.r}`))).toEqual(
    new Set(DIRS.map((d) => `${d.q},${d.r}`)),
  );
  // The shape ids are these six, sorted by the engine's direction index and
  // joined with an underscore. Checked against the shape list, so a renamed id
  // has to come through here.
  const shorts: string[] = LATTICE.map((l) => l.short);
  for (const shape of CHANNEL_SHAPES) {
    const [a, b] = shape.split("_");
    expect(shorts.indexOf(a), `${shape}: ${a} is not a compass point`).toBeGreaterThanOrEqual(0);
    expect(shorts.indexOf(b), `${shape}: ${b} is not a compass point`).toBeGreaterThanOrEqual(0);
    expect(shorts.indexOf(a), `${shape} is not in direction order`).toBeLessThan(shorts.indexOf(b));
  }
  for (const shape of SOURCE_SHAPES) {
    expect(shorts).toContain(shape.slice("src_".length));
  }
});

test("the edges beside the chip at bearing 270 clear it", () => {
  // The south-west and south-east edges are nearest the chip, and their
  // mouths still sit 1.500 from the mount, against a keep-clear of 1.05 plus
  // half the 0.42 channel. That is the tightest clearance on the board, and
  // why channels may use those edges.
  //
  // Read off `planChips` rather than `CHIP_OFFSET_Z`, so the claim is about
  // where a chip is actually put.
  const hex: Hex = { q: 2, r: -1 };
  const [cx, , cz] = hexToWorld(hex);
  const [chip] = planChips([{ hex, res: "ore", num: 5 }]);
  expect(chip, "a numbered ore hex takes a chip").toBeDefined();
  expect(bearing(chip.position[0] - cx, chip.position[2] - cz)).toBeCloseTo(270, 9);
  expect(chip.position[2] - cz).toBeCloseTo(CHIP_OFFSET_Z, 12);

  // The two edges nearest that bearing.
  const near = LATTICE.map((l) => ({
    ...l,
    off: Math.min(Math.abs(l.bearing - 270), 360 - Math.abs(l.bearing - 270)),
  })).sort((a, b) => a.off - b.off);
  expect(
    near
      .slice(0, 2)
      .map((l) => l.compass)
      .sort(),
  ).toEqual(["south-east", "south-west"]);
  // The two tightest mouths on the board, at 1.500. `hexcontract.KEEP_CLEAR_RADIUS`
  // is 1.05 and the water is 0.42 wide, so a mouth needs 1.26 and has 1.50: a
  // margin of 0.24, or room for water up to 0.90 wide.
  const CHIP_KEEP_CLEAR = 1.05;
  const HALF_CHANNEL = 0.21;
  for (const l of near.slice(0, 2)) {
    expect(l.mouth, `${l.compass}`).toBeCloseTo(1.5, 6);
    expect(l.mouth, `a mouth on the ${l.compass} edge crowds the chip`).toBeGreaterThan(
      CHIP_KEEP_CLEAR + HALF_CHANNEL,
    );
  }
  // Every other mouth is at least twice as far out, so these two are the
  // binding case.
  for (const l of near.slice(2)) expect(l.mouth).toBeGreaterThan(2.9);
});

// --- what each hex draws -------------------------------------------------

/**
 * A four-hex chain running due east along r = 0: a headwater at `q = 0`, two
 * hexes of straight channel, and the swamp estuary at `q = 3`.
 *
 * Source to sea, as the engine derives it. The source's `in` and `out` are the
 * same edge (its seam with the second hex), because a headwater has one mouth;
 * every other hex has two, opposite on this line.
 */
const CHAIN: Hex[] = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 2, r: 0 },
  { q: 3, r: 0 },
];

/**
 * The two seams of hex `i` on that chain: west, then east.
 *
 * Found by world position, because a wire `Edge` is an unordered pair of
 * vertices, and deriving a direction here would restate the axial-to-world
 * correspondence a second time.
 */
function seams(i: number): { west: Edge; east: Edge } {
  return { west: edgeAt(CHAIN[i], 180), east: edgeAt(CHAIN[i], 0) };
}

/** The edge of `h` whose midpoint sits at `want` degrees from its centre. */
function edgeAt(h: Hex, want: number): Edge {
  const [cx, , cz] = hexToWorld(h);
  const found = hexEdges(h).find((e) => {
    const [mx, , mz] = edgeToWorld(e);
    const off = Math.abs(bearing(mx - cx, mz - cz) - want);
    return Math.min(off, 360 - off) < 1e-6;
  });
  expect(found, `${hexKey(h)} has no edge at ${want} degrees`).toBeDefined();
  return found!;
}

const CHAIN_TILES: BoardTile[] = [
  { hex: CHAIN[0], res: "ore", num: 5 },
  { hex: CHAIN[1], res: "brick", num: 9 },
  { hex: CHAIN[2], res: "sheep", num: 4 },
  { hex: CHAIN[3], res: "swamp", num: 0 },
];

const DEFAULT_SHAPES: RiverShape[] = ["src_e", "e_w", "e_w", "e_w"];

function riverView(
  over: Record<string, unknown> = {},
  tiles = CHAIN_TILES,
  shapes: RiverShape[] = DEFAULT_SHAPES,
  variants: number[] = [0, 0, 0, 0],
): FullView {
  // The source's two channel edges are one edge: its seam with hex 1.
  const ins = CHAIN.map((_, i) => (i === 0 ? seams(0).east : seams(i).west));
  const outs = CHAIN.map((_, i) => seams(i).east);
  return {
    board: { tiles, robber: { q: 0, r: 0 }, harbors: [] },
    ext: {
      rivers: {
        rivers: [
          {
            hexes: CHAIN,
            mouth: 3,
            in: ins,
            out: outs,
            shapes,
            // The n-1 seams plus the estuary's outlet, which on this chain is
            // exactly `out` in order.
            sites: outs,
            variants,
          },
        ],
        sites: outs,
        bridges: [],
        coins: [0, 0],
        ...over,
      },
    },
  } as unknown as FullView;
}

function fileFor(view: FullView, h: Hex): string | undefined {
  return planRiverTiles(view).find((t) => hexKey(t.hex) === hexKey(h))?.file;
}

test("each terrain draws its own family, and the estuary draws the swamp", () => {
  // The engine guarantees the set: the source ends as mountains, everything
  // between as mountain, hill or pasture, and the estuary as swamp.
  //
  // Canonical files written as literals rather than read off the tables under
  // test, since what matters is which file the board asks the loader for.
  // Every file is exported, so there is no fallback.
  const view = riverView();
  expect(fileFor(view, CHAIN[0])).toBe("tiles/river_mountains_src_e.glb");
  expect(fileFor(view, CHAIN[1])).toBe("tiles/river_hills_e_w_a.glb");
  expect(fileFor(view, CHAIN[2])).toBe("tiles/river_pasture_e_w_a.glb");
  expect(fileFor(view, CHAIN[3])).toBe("tiles/river_swamp_e_w_a.glb");
});

test("a bent hex draws the bend from its own terrain family", () => {
  // A hill that bends is still a hill: shape and family are independent
  // lookups.
  const bent: RiverShape[] = ["src_e", "ne_w", "e_w", "e_w"];
  expect(fileFor(riverView({}, CHAIN_TILES, bent), CHAIN[1])).toBe("tiles/river_hills_ne_w.glb");
  // `e_sw` is the shape the reference 3-hex river's estuary draws.
  const bentMouth: RiverShape[] = ["src_e", "e_w", "e_w", "e_sw"];
  expect(fileFor(riverView({}, CHAIN_TILES, bentMouth), CHAIN[3])).toBe(
    "tiles/river_swamp_e_sw.glb",
  );
});

test("no river tile is ever turned", () => {
  // Every river hex, every shape, one rotation: the board's own facing, so
  // the tile's chip socket faces the viewer and the number sits on it.
  for (const shapes of [
    DEFAULT_SHAPES,
    ["src_sw", "ne_sw", "nw_se", "w_se"],
    ["src_ne", "e_sw", "ne_se", "nw_sw"],
  ] as RiverShape[][]) {
    for (const plan of planRiverTiles(riverView({}, CHAIN_TILES, shapes))) {
      expect(plan.rotationY, `${hexKey(plan.hex)} (${plan.file})`).toBe(TILE_ROTATION_Y);
    }
  }
});

test("a mirrored bend draws the mirrored file", () => {
  // The four mirror pairs are one reflection apart on the same terrains, so
  // the failure that matters is picking the wrong one of a pair: the tile
  // looks normal and the channel leaves on the wrong two edges.
  for (const [original, mirror] of [
    ["ne_w", "e_nw"],
    ["e_sw", "w_se"],
    ["ne_se", "nw_sw"],
  ] as const) {
    const one = fileFor(riverView({}, CHAIN_TILES, ["src_e", original, "e_w", "e_w"]), CHAIN[1]);
    const other = fileFor(riverView({}, CHAIN_TILES, ["src_e", mirror, "e_w", "e_w"]), CHAIN[1]);
    expect(one, `${original} draws nothing`).toBeDefined();
    expect(other, `${mirror} draws nothing`).toBeDefined();
    expect(other, `${mirror} draws the same file as ${original}`).not.toBe(one);
  }
});

test("the two east-west meanders are two different files", () => {
  // A run of straights must not show the same tile twice in a row. Both
  // meanders exist for every family, so the drawn file is pinned as well as
  // the key.
  for (const family of RIVER_FAMILIES) {
    const [a, b] = EW_VARIANT_TILES[family];
    expect(a).not.toBe(b);
    expect(riverTileKey("e_w", family, 0)).toBe(a);
    expect(riverTileKey("e_w", family, 1)).toBe(b);
    expect(TILES[a]?.file, `${family} meander a`).toBeDefined();
    expect(TILES[b]?.file, `${family} meander b`).toBeDefined();
    expect(TILES[a].file).not.toBe(TILES[b].file);
  }
  // Through the renderer too: hex 1 is hills, and meander `b` there must reach
  // the `_b` file.
  const drawn = (v: number) =>
    fileFor(riverView({}, CHAIN_TILES, DEFAULT_SHAPES, [0, v, 0, 0]), CHAIN[1]);
  expect(drawn(0)).toBe("tiles/river_hills_e_w_a.glb");
  expect(drawn(1)).toBe("tiles/river_hills_e_w_b.glb");
  // An out-of-range variant comes from a server this build does not
  // understand; it draws meander `a`, since a tile is better than a hole.
  expect(riverTileKey("e_w", "hills", 7)).toBe(EW_VARIANT_TILES.hills[0]);
});

test("the two reference rivers draw, hex for hex", () => {
  // The renderer's half of `engine/rivers`' reference-layout test. The
  // reference setup is a 3-hex and a 4-hex river, both running west from a
  // headwater in the mountains and ending in a swampland estuary that turns
  // 120 degrees into the sea: north-west on the long one, south-west on the
  // short one (`e_sw`).
  const layouts = [
    {
      name: "the 4-hex river",
      hexes: CHAIN,
      // Source at the east end, so the chain reads downstream to the west. The
      // fixture runs west to east, so the shapes are read in reverse and the
      // source sits at index 0.
      shapes: ["src_e", "e_w", "e_w", "e_nw"] as RiverShape[],
      want: [
        "tiles/river_mountains_src_e.glb",
        "tiles/river_hills_e_w_a.glb",
        "tiles/river_pasture_e_w_a.glb",
        "tiles/river_swamp_e_nw.glb",
      ],
    },
    {
      name: "the 3-hex river",
      hexes: CHAIN,
      shapes: ["src_e", "e_w", "e_sw", "e_w"] as RiverShape[],
      want: [
        "tiles/river_mountains_src_e.glb",
        "tiles/river_hills_e_w_a.glb",
        // The estuary bend of the reference 3-hex river, on the hex the
        // fixture puts pasture under; the swamp is one further along.
        "tiles/river_pasture_e_sw.glb",
        "tiles/river_swamp_e_w_a.glb",
      ],
    },
  ];
  for (const layout of layouts) {
    const view = riverView({}, CHAIN_TILES, layout.shapes);
    for (let i = 0; i < layout.hexes.length; i++) {
      expect(fileFor(view, layout.hexes[i]), `${layout.name} hex ${i}`).toBe(layout.want[i]);
    }
    for (const plan of planRiverTiles(view)) expect(plan.rotationY).toBe(TILE_ROTATION_Y);
  }
});

test("an unknown shape draws plain terrain", () => {
  // The engine sends "" for a mouth pair no tile has. Unreachable on a board
  // it derived, but reachable through POST /api/replay/frames, which folds an
  // authored map. A gap reads as missing art; a guess would read as wrong art
  // and an unexplained bridge site.
  expect(
    fileFor(riverView({}, CHAIN_TILES, ["src_e", "", "e_w", "e_w"]), CHAIN[1]),
  ).toBeUndefined();
  // Including a shape id from an older build.
  expect(
    fileFor(riverView({}, CHAIN_TILES, ["src_e", "bend" as RiverShape, "e_w", "e_w"]), CHAIN[1]),
  ).toBeUndefined();
  // A server that predates the field draws no river tiles rather than
  // throwing.
  const old = riverView();
  delete (old.ext!.rivers as { rivers: { shapes?: unknown }[] }).rivers[0].shapes;
  expect(planRiverTiles(old)).toEqual([]);
});

test("a headwater on anything but mountains draws its plain terrain", () => {
  // Source tiles exist only on mountains, since the engine paints every source
  // hex to mountains. A `src_*` on hills is a frame this build does not
  // understand, and a mountain headwater on a brick hex would contradict its
  // chip.
  const tiles = CHAIN_TILES.map((t, i) => (i === 0 ? { ...t, res: "brick" as const } : t));
  expect(fileFor(riverView({}, tiles), CHAIN[0])).toBeUndefined();
});

test("a terrain no channel is authored on draws itself, unturned", () => {
  // A gold hex on a chain means a changed repaint rule or a frame this build
  // does not understand; a mountain drawn on it would contradict the gold the
  // hex still produces.
  const tiles = CHAIN_TILES.map((t, i) => (i === 1 ? { ...t, res: "gold" as const } : t));
  const view = riverView({}, tiles);
  expect(fileFor(view, CHAIN[1])).toBeUndefined();
  const placed = planTiles(tiles, tileArtOverrides(view).files, tileArtOverrides(view).yaw);
  expect(placed[1].file).toBe("tiles/gold.glb");
  expect(placed[1].rotationY).toBe(TILE_ROTATION_Y);
});

test("no Rivers module means no river tiles and no yaw anywhere", () => {
  const bare = {
    board: { tiles: CHAIN_TILES, robber: CHAIN[0], harbors: [] },
  } as unknown as FullView;
  expect(planRiverTiles(bare)).toEqual([]);
  const art = tileArtOverrides(bare);
  expect(art.files.size).toBe(0);
  expect(art.yaw.size).toBe(0);
  for (const p of planTiles(CHAIN_TILES, art.files, art.yaw)) {
    expect(p.rotationY).toBe(TILE_ROTATION_Y);
  }
});

test("the overrides merge the oasis and the rivers without either losing", () => {
  // Two modules answer "what does this hex draw" and cannot collide (the river
  // derivation may not route through the desert, which the oasis is made of).
  // The merge adds; the second must not overwrite the first.
  const tiles: BoardTile[] = [...CHAIN_TILES, { hex: { q: 5, r: 0 }, res: "none", num: 0 }];
  const view = riverView({}, tiles);
  (view.ext as Record<string, unknown>).caravans = { oasis: { q: 5, r: 0 }, camels: [] };
  const art = tileArtOverrides(view);
  expect(art.files.get(hexKey({ q: 5, r: 0 }))).toBe("tiles/oasis.glb");
  expect(art.files.get(hexKey(CHAIN[0]))).toBe("tiles/river_mountains_src_e.glb");
  // The oasis is turned like any other tile; only the rivers name a yaw.
  expect(art.yaw.has(hexKey({ q: 5, r: 0 }))).toBe(false);
  expect(art.yaw.has(hexKey(CHAIN[0]))).toBe(true);
  // A river hex is not forced into `land`: it has a land resource, so
  // beach and gutter sand reach it anyway. Only the flooded oasis needs that.
  expect(art.land.has(hexKey(CHAIN[0]))).toBe(false);
  // ...which must not cost it its size: if `planTiles` read `land` as the
  // complete list of land overrides, every river tile would draw at sea scale
  // (4.8% too wide, rim over the gutter). Tested through the set Board3D
  // passes.
  const placed = planTiles(tiles, art.files, art.yaw, art.land);
  const river = placed.find((p) => p.file === "tiles/river_mountains_src_e.glb");
  expect(river?.scale, "a river tile drawn at sea scale buries its gutter").toBe(1);
  const oasis = placed.find((p) => p.file === "tiles/oasis.glb");
  expect(oasis?.scale, "the oasis is still forced to land scale").toBe(1);
});

test("a hex draws one river tile, and a source draws one headwater", () => {
  // Nothing here stacks tiles: `planRiverTiles` visits each hex of each chain
  // once, `tileArtOverrides` keys a Map by `hexKey` so a hex has one file, and
  // `planTiles` lays one slab per board tile. So a headwater cannot be a source
  // tile over its own mountains, or two channels over each other. (The
  // headwater tile's own `_water` mesh has three rivulets; `riverArt.test.ts`
  // measures them.)
  const view = riverView();
  const plans = planRiverTiles(view);
  expect(plans).toHaveLength(CHAIN.length);
  expect(new Set(plans.map((p) => hexKey(p.hex))).size, "a hex is planned twice").toBe(
    CHAIN.length,
  );

  const art = tileArtOverrides(view);
  const placed = planTiles(CHAIN_TILES, art.files, art.yaw, art.land);
  expect(placed).toHaveLength(CHAIN_TILES.length);
  const atSource = placed.filter((p) => p.position.join() === hexToWorld(CHAIN[0]).join());
  expect(atSource, "the source hex is drawn more than once").toHaveLength(1);
  expect(atSource[0].file).toBe("tiles/river_mountains_src_e.glb");
  expect(atSource[0].file).not.toBe(tileFileFor("ore"));
  expect(atSource[0].rotationY).toBe(TILE_ROTATION_Y);
});

test("planTiles draws a river hex at its yaw and land scale", () => {
  const view = riverView();
  const art = tileArtOverrides(view);
  // All four arguments, as Board3D passes them; omitting `land` hides the
  // sea-scale bug.
  const placed = planTiles(CHAIN_TILES, art.files, art.yaw, art.land);
  for (let i = 0; i < CHAIN.length; i++) {
    expect(placed[i].scale, "a river tile is a land slab").toBe(1);
    expect(placed[i].rotationY).toBe(art.yaw.get(hexKey(CHAIN[i])));
  }
});

// --- the bridges ---------------------------------------------------------

test("a bridge stands on its edge, in its owner's colour, keyed like a road", () => {
  const site = seams(1).east;
  const view = riverView({ bridges: [{ player: 2, e: site }] });
  const [placed] = planBridges(view);
  expect(placed.owner).toBe(2);
  expect(placed.position).toEqual(edgeToWorld(site));
  // The key is the road's shape, so `drop.ts` can tell a newly built bridge
  // from a standing one without knowing what a bridge is.
  expect(placed.key).toBe(`bridge:2:${edgeKey(site)}`);
});

test("a bridge lies along its edge, whichever way the edge was written down", () => {
  // `edgeRotationY` is an axis, not a bearing, which is fine here because the
  // piece is mirror-symmetric (`bridgeArt.test.ts`), so either endpoint order
  // draws the same bridge.
  const site = seams(1).east;
  const flipped: Edge = { a: site.b, b: site.a };
  const one = planBridges(riverView({ bridges: [{ player: 0, e: site }] }))[0];
  const other = planBridges(riverView({ bridges: [{ player: 0, e: flipped }] }))[0];
  const half = Math.abs(one.rotationY! - other.rotationY!);
  expect(half === 0 || Math.abs(half - Math.PI) < 1e-9).toBe(true);
  expect(one.position).toEqual(other.position);
});

test("no bridges, or no module, draws nothing", () => {
  expect(planBridges(riverView())).toEqual([]);
  expect(planBridges({ board: { tiles: [] } } as unknown as FullView)).toEqual([]);
});

test("the flat site list is what an edge is tested against", () => {
  // Published beside the per-river chains because it answers a different
  // question: the set a road renderer asks "may anything but a bridge go here".
  //
  // Four sites on a four-hex river, not five: the watercourse runs source to
  // sea, so it has three seams and one coastal outlet (3 + 4 = 7 over the two
  // reference rivers).
  const view = riverView();
  const keys = bridgeSiteKeys(view);
  expect(keys.size).toBe(4);
  expect(keys.has(edgeKey(seams(1).east))).toBe(true);
  expect(keys.has(edgeKey(seams(0).west))).toBe(false);
  expect(bridgeSiteKeys({ board: { tiles: [] } } as unknown as FullView).size).toBe(0);
});

// --- the file table -------------------------------------------------------

test("every family has nine shapes, both meanders and six sources", () => {
  // One file per (terrain, shape): a family missing one of the nine would draw
  // another shape's channel wherever it was asked for.
  const seen = new Set<string>();
  for (const family of RIVER_FAMILIES) {
    for (const shape of CHANNEL_SHAPES) {
      const tile = CHANNEL_TILES[shape][family];
      expect(tile, `${family} is missing ${shape}`).toBeTruthy();
      expect(seen.has(tile), `${tile} is named twice`).toBe(false);
      seen.add(tile);
    }
    // `e_w`'s row above is meander `a`; the second one is its own file.
    for (const tile of EW_VARIANT_TILES[family]) seen.add(tile);
  }
  // 9 x 4 canonical, plus the 4 second meanders.
  expect(seen.size).toBe(RIVER_FAMILIES.length * CHANNEL_SHAPES.length + RIVER_FAMILIES.length);
  // The sources are mountains only, one per direction.
  for (const shape of SOURCE_SHAPES) {
    const tile = SOURCE_TILES[shape];
    expect(tile).toBe(`river_mountains_${shape}`);
    expect(seen.has(tile), `${tile} is named twice`).toBe(false);
    seen.add(tile);
  }
  // Plus the plain marsh. `RIVER_TILES` is exactly the channels and the marsh.
  seen.add(SWAMP_TILE);
  expect(new Set(RIVER_TILES)).toEqual(seen);
  expect(RIVER_TILES).toHaveLength(seen.size);
  // The spelled-out copy exists so `loader.test.ts`'s reachability check sees
  // a literal for every exported tile; this keeps it in step.
  expect(new Set(RIVER_TILE_NAMES), "RIVER_TILE_NAMES has drifted").toEqual(seen);
  expect(RIVER_TILE_NAMES).toHaveLength(seen.size);
});

// There is no renderer fallback, so a tile missing from the manifest fails here
// rather than drawing the wrong channel.
test("every canonical river file is in the manifest", () => {
  const missing = RIVER_TILES.filter((tile) => !TILES[tile]);
  expect(missing, "river tiles missing from the manifest").toEqual([]);
  // Said the other way round too, so an emptied `RIVER_TILES` cannot make the
  // line above vacuously true.
  expect(RIVER_TILES).toHaveLength(67);
  for (const tile of RIVER_TILES) {
    expect(TILES[tile], `${tile} is not in the manifest`).toBeDefined();
  }
  expect(TILES[SWAMP_TILE]).toBeDefined();
});

test("every shape resolves to its own file on every family", () => {
  // No board can ask for a river hex and get nothing back, and what comes back
  // is the shape's own file.
  for (const family of RIVER_FAMILIES) {
    for (const shape of CHANNEL_SHAPES) {
      const res = {
        mountains: "ore",
        hills: "brick",
        pasture: "sheep",
        swamp: "swamp",
        forest: "wood",
        fields: "wheat",
      }[family] as BoardTile["res"];
      const tiles = CHAIN_TILES.map((t, i) => (i === 1 ? { ...t, res } : t));
      const view = riverView({}, tiles, ["src_e", shape, "e_w", "e_w"]);
      expect(fileFor(view, CHAIN[1]), `${family} ${shape}`).toBe(
        TILES[CHANNEL_TILES[shape][family]].file,
      );
    }
  }
  for (const shape of SOURCE_SHAPES) {
    const view = riverView({}, CHAIN_TILES, [shape, "e_w", "e_w", "e_w"]);
    expect(fileFor(view, CHAIN[0]), `mountains ${shape}`).toBe(TILES[SOURCE_TILES[shape]].file);
  }
});

// --- the swamp is land, everywhere it matters -----------------------------

test("a swamp is drawn as land by default", () => {
  // The swamp is real generated terrain, unlike the Caravans oasis: the engine
  // lays it down and `resource_json.go` names it `swamp`, so the manifest
  // reaches its tile by resource and it is land everywhere. Both failures are
  // silent: a missing manifest entry draws nothing, and a stray entry in
  // `WATER` would scale the tile over the gutter and solve its coast as water.
  expect(tileFileFor("swamp")).toBe("tiles/swamp.glb");
  expect(isWaterTile("swamp")).toBe(false);
  expect(tileScale("swamp")).toBe(1);
  // Six half-gaps of sand like every land hex, and a beach ring where it
  // meets the sea. `planGapSand` skips water unless overridden, and nothing
  // overrides this.
  const only: BoardTile[] = [{ hex: { q: 0, r: 0 }, res: "swamp", num: 0 }];
  expect(planGapSand(only)).toHaveLength(6);
  expect([...landKeys(only)]).toEqual([hexKey({ q: 0, r: 0 })]);
});

// --- what a Rivers game downloads ----------------------------------------

test("the river art is fetched for a Rivers game and for nobody else", () => {
  // Listed unconditionally the river tiles would be several megabytes on
  // every base game, for terrain no board carries; hence `RIVER_MODULE_TILES`
  // and `RIVERS_MODELS` (see loader.ts).
  //
  // A Rivers game does not fetch them all either: the ruleset prefetch runs in
  // the lobby, before the board exists, so it keeps only the marsh, and the
  // channels come from `boardTileFiles(view)` at board load. Asserted here: no
  // river file reaches a base game, and every river file is in the union of
  // the two paths. `loader.test.ts` checks the split.
  const base = boardModelFiles("base");
  const rivers = boardModelFiles("base+rivers");
  expect(base).not.toContain("bridges.glb");
  expect(rivers).toContain("bridges.glb");
  let checked = 0;
  for (const tile of RIVER_TILES) {
    const entry = TILES[tile];
    expect(entry, `${tile} is not in the manifest`).toBeDefined();
    checked++;
    expect(base, `${tile} in a base game`).not.toContain(entry.file);
    const perBoard = RIVER_BOARD_TILES.includes(tile);
    if (perBoard) {
      expect(rivers, `${tile} is prefetched per ruleset, not per board`).not.toContain(entry.file);
    } else {
      expect(rivers, `${tile} in a Rivers game`).toContain(entry.file);
    }
  }
  // The channels plus the marsh, so this cannot pass vacuously if
  // `RIVER_TILES` stopped naming real files.
  expect(checked).toBe(67);
  expect(RIVER_BOARD_TILES).toHaveLength(66);
});
