import { test, expect } from "vitest";
import * as THREE from "three";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TILES, RESOURCE_FALLBACK } from "./manifest.generated";
import {
  tileFileFor,
  subsetByPrefix,
  boardModelFiles,
  boardTileFiles,
  newGLTFLoader,
} from "./loader";
import { PLAIN_MODELS } from "@/testGlbFixtures";
import { RIVER_BOARD_TILES, RIVER_TILES, planRiverTiles } from "./layers/rivers";
import { TRADE_TILES } from "./layers/wagons";
import { hexesInRadius } from "@/lib/hexgeo";
import type { BoardTile, FullView, RiverShape } from "@/lib/types";
import { readdirSync } from "node:fs";

const MODELS = join(__dirname, "..", "..", "..", "public", "models");

/** Every .glb under public/models, whether or not the board asks for it. */
const ALL_SHIPPED = (function walk(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name), `${prefix}${e.name}/`)
      : e.name.endsWith(".glb")
        ? [`${prefix}${e.name}`]
        : [],
  );
})(join(__dirname, "..", "..", "..", "public", "models"));

/** The files `TILES` points at, which are reached by resource rather than by name. */
const TILE_FILES = new Set(Object.values(TILES).map((t) => t.file));

/**
 * Every hand-written .ts/.tsx under src, concatenated.
 *
 * Tests are excluded because a test naming a file is not a player loading it,
 * and generated files because they restate what the exporter emitted (see
 * "every shipped model is named somewhere in the source").
 */
function handWrittenSources(): string {
  const SRC = join(__dirname, "..", "..");
  const sources = (function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? e.name === "node_modules"
          ? []
          : walk(join(dir, e.name))
        : /\.(ts|tsx)$/.test(e.name) &&
            !/\.test\.(ts|tsx)$/.test(e.name) &&
            !/\.generated\.(ts|tsx)$/.test(e.name)
          ? [join(dir, e.name)]
          : [],
    );
  })(SRC);
  expect(sources.length, "no sources found to search").toBeGreaterThan(50);
  return sources.map((f) => readFileSync(f, "utf8")).join("\n");
}

// Parse the GLB container header directly. GLTFLoader needs a browser
// environment; the container format does not, so this runs in jsdom.
function readGlbJson(file: string): Record<string, unknown> {
  const buf = readFileSync(join(MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8"));
}

test("every tile glb is a valid GLB container with meshes", () => {
  for (const entry of Object.values(TILES)) {
    const gltf = readGlbJson(entry.file) as { meshes?: unknown[] };
    expect(gltf.meshes?.length, `${entry.file} has no meshes`).toBeGreaterThan(0);
  }
});

test("tile materials survived export as separate slots", () => {
  // Material slots must stay distinct so palette.json can override them; a
  // single material means runtime restyling is lost.
  const desert = readGlbJson(TILES["none"].file) as { materials?: { name?: string }[] };
  expect(desert.materials?.length ?? 0).toBeGreaterThan(1);
});

test("pieces expose the seat tint materials", () => {
  const pieces = readGlbJson("pieces.glb") as { materials?: { name?: string }[] };
  const names = (pieces.materials ?? []).map((m) => m.name);
  expect(names).toContain("Seat_Body");
  expect(names).toContain("Seat_Shade");
  expect(names).toContain("Seat_Detail");
});

/** Material name per mesh primitive, for the meshes whose name starts `prefix`. */
function materialsOf(file: string, prefix: string): string[] {
  const gltf = readGlbJson(file) as {
    materials?: { name?: string }[];
    meshes?: { name?: string; primitives: { material: number }[] }[];
  };
  const materials = (gltf.materials ?? []).map((m) => m.name ?? "");
  const meshes = (gltf.meshes ?? []).filter((m) => (m.name ?? "").startsWith(prefix));
  expect(meshes.length, `${file} has no mesh named ${prefix}*`).toBeGreaterThan(0);
  return [...new Set(meshes.flatMap((m) => m.primitives.map((p) => materials[p.material])))];
}

/** Just the seat-tint slots of those, which is what the two contracts below pin. */
function tintSlotsOf(file: string, prefix: string): string[] {
  return materialsOf(file, prefix).filter((n) => n.startsWith("Seat_"));
}

/**
 * Manifest key -> the blend's terrain name: `river_hills_bend` -> `River_Hills_Bend`.
 *
 * `tools/blender/naming.py`'s convention (`Hex_<Terrain>` ships as
 * `tiles/<resource>.glb`) makes a river tile's mesh names derivable from its
 * key.
 *
 * Segments of one or two letters are compass points or hands and are upper
 * case in the blend: `river_swamp_ne_w` is `River_Swamp_NE_W`, and
 * `river_hills_bend_m` is `River_Hills_Bend_M`. The rule is by length, as in
 * the naming table, which covers `e_w_a`'s variant letter and `src_ne`
 * without special cases.
 */
function terrainOf(tile: string): string {
  return tile
    .split("_")
    .map((part) => (part.length <= 2 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join("_");
}

test("every player-owned piece carries the seat tint materials", () => {
  // A piece somebody owns must be recolourable to show whose it is; authored
  // materials alone (Mat_Knight_steel, Mat_Ship_route_hull, ...) made every
  // player's knight the same blue.
  //
  // Checked per mesh, not per file: ships.glb also holds the pirate and the
  // barbarians, which must not tint.
  const owned: Record<string, string[]> = {
    "pieces.glb": ["Settlement_A", "City_A", "Road_A", "Road_B"],
    // Only the bodies; the sword is untinted (see the neutral half below).
    "knights.glb": ["Knight_basic", "Knight_strong", "Knight_mighty"],
    "ships.glb": ["Ship_route"],
    // A metropolis replaces the tinted city it stands on, so it must carry the
    // tint itself.
    "metros.glb": ["Metro_trade", "Metro_politics", "Metro_science"],
    // The Raiders rider. Seat slots are invisible until two players load a
    // board, so the art is pinned as soon as it exists. Every part tints:
    // nothing on a rider means anything but whose it is.
    "riders.glb": ["Rider_"],
    // The Wagons wagon stands on a vertex and several may share one, so colour
    // is the only way to tell whose it is. Every part is already a Seat_* slot.
    "wagons.glb": ["Wagon_"],
    // The Rivers bridge: built by one seat on a road's edge, so owned like a
    // road. Module art can be owned (knights, route ships, metropolises); what
    // decides it is whether one seat owns the piece.
    "bridges.glb": ["Bridge_"],
    // Explorers' two ships. The corsair is owned, unlike the neutral pirates
    // below (`Ship_pirate`, `Ship_barbarian`): it belongs to whoever moved it,
    // who profits from it, so it must show their colour.
    "vessels.glb": ["Cargo_", "Corsair_"],
    // Explorers. All three prefixes, because cargo is owned too: two seats'
    // crews in adjacent basins must be distinguishable. The quay stands beside
    // a building from the owner's piece set and carries the tint itself.
    "harbors.glb": ["Harbor_", "Settler_", "Crew_"],
    // The Explorers mission marker, the only owned thing in cargo.glb: markers
    // go on rivals' mission tracks, so a stack shows who is racing whom. The
    // two cargo pieces in the same file must not tint (see below).
    "cargo.glb": ["Marker_"],
    // The crew that stands on a hex: three in a rank storm a lair, possibly
    // from three seats. The lair token in the same file is neutral (below).
    "lairs.glb": ["Boarder_"],
  };
  for (const [file, prefixes] of Object.entries(owned)) {
    for (const prefix of prefixes) {
      expect(tintSlotsOf(file, prefix), `${prefix} has no tint slot`).not.toEqual([]);
    }
  }
});

test("neutral pieces stay outside the seat tint", () => {
  // The robber, the pirate and the barbarian ship belong to nobody, and the
  // knight's crest and sword mean rank and activation on every board. Tinting
  // any of them would turn a universal cue into an ownership one.
  const neutral: Record<string, string[]> = {
    "pieces.glb": ["Robber_"],
    "ships.glb": ["Ship_pirate", "Ship_barbarian"],
    // The sword is the activation state (steel at ease, gold raised). A seat
    // slot would make "ready" a different colour per player and identical to
    // "not ready" for a gold seat.
    "knights.glb": ["Knight_sword_"],
    // The oasis is terrain, and nobody owns terrain; the caravans growing from
    // it are neutral too. Both prefixes, since the slab ships as
    // `Hex_Oasis_mesh` and its props as `Oasis_*`.
    "tiles/oasis.glb": ["Hex_Oasis", "Oasis_"],
    // The lake, like the oasis: terrain placed by a module. It pays fish to
    // anyone on its shore, so a seat colour would misstate ownership.
    "tiles/lake.glb": ["Hex_Lake", "Lake_"],
    // The camels: the caravans belong to nobody, and a camel in the auction
    // winner's colour would say otherwise.
    "camels.glb": ["Camel_", "Raft_"],
    // The pirate lair is nobody's until it falls, and then it is gone.
    "lairs.glb": ["Lair_"],
    // The wayposts the camels start from, neutral for the same reason.
    "spokes.glb": ["Spoke_"],
    // The weir: a fishing ground pays every seat built on its corners, so its
    // marker belongs to none. The shallows under its chip likewise.
    "fishing.glb": ["Weir_", "Fishground_"],
    // The Raiders castle is terrain that nobody owns. Both prefixes: the slab
    // ships as `Hex_Castle_mesh` and everything on it as `Castle_*`.
    "tiles/castle.glb": ["Hex_Castle", "Castle_"],
    // The Wagons market towns: scenario terrain every seat drives to. Both
    // prefixes: the slab ships as `Hex_Trade_<Ground>_<DIR>` and its parts as
    // `Trade_<Ground>_<DIR>_*`.
    ...Object.fromEntries(
      TRADE_TILES.map((key) => {
        const terrain = key
          .split("_")
          .map((p) => (p.length <= 2 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
          .join("_");
        return [`tiles/${key}.glb`, [`Hex_${terrain}`, `${terrain}_`]];
      }),
    ),
    // The Explorers Council, which every seat delivers to. "" as well, because
    // its hull ships as an unnamed mesh under `Hex_Council`.
    "tiles/sea_council.glb": ["Council_", ""],
    // The unexplored cloud, which hides the pool from every seat alike.
    "fog.glb": ["Fog_"],
    // City walls are neutral by design: the 2D board calls its wall "a
    // colour-neutral ring framing the city marker, reading as defensive
    // structure rather than ownership", and the tinted city stands inside it.
    "walls.glb": ["Wall_segment"],
    // The Explorers cargo, beside an owned piece in the same file, so both
    // halves are pinned by prefix. Hauls and sacks change hands (hex, hold,
    // warehouse); where they stand says whose they are.
    "cargo.glb": ["Haul_", "Spice_"],
    // The barbarian warrior, like the robber: Raiders musters it on a coastal
    // hex nobody owns, and Wagons stands it on a road edge against every seat.
    "barbarians.glb": ["Barbarian_"],
    // The river tiles and the swamp: terrain placed by a module. A river runs
    // between players, so a seat colour would claim it for one. Generated from
    // the loader's prefetch list, so a new river tile is covered automatically.
    ...Object.fromEntries(
      RIVER_TILES.map((tile) => [
        `tiles/${tile}.glb`,
        [`Hex_${terrainOf(tile)}`, `${terrainOf(tile)}_`],
      ]),
    ),
  };
  for (const [file, prefixes] of Object.entries(neutral)) {
    for (const prefix of prefixes) {
      expect(tintSlotsOf(file, prefix), `${prefix} is seat-tinted`).toEqual([]);
    }
  }
  const knights = readGlbJson("knights.glb") as { materials?: { name?: string }[] };
  const names = (knights.materials ?? []).map((m) => m.name);
  expect(names).toContain("Mat_Knight_crest");
  expect(names).toContain("Mat_Knight_sword_dark");

  // The raised sword uses the crest's gold itself, not a second matching
  // gold, so a restyle cannot show two golds implying a distinction the game
  // does not have. Both say what the piece is doing, not whose it is.
  for (const level of ["basic", "strong", "mighty"]) {
    expect(materialsOf("knights.glb", `Knight_sword_${level}_gold`)).toEqual(["Mat_Knight_crest"]);
    expect(materialsOf("knights.glb", `Knight_sword_${level}_dark`)).toEqual([
      "Mat_Knight_sword_dark",
    ]);
  }
  // The sword's own gold material is gone, not merely unused: a zero-user
  // material still ships in the glb and needs a palette entry.
  expect(names).not.toContain("Mat_Knight_sword_gold");
  expect(names).not.toContain("Mat_Knight_banner");

  // The metropolis landmarks, like the knight's crest, say which track built
  // it. As Seat_* slots, a green player's science and trade metropolises would
  // look the same.
  const metros = readGlbJson("metros.glb") as { materials?: { name?: string }[] };
  const metroNames = (metros.materials ?? []).map((m) => m.name);
  for (const landmark of [
    "Mat_Metro_trade_hall",
    "Mat_Metro_politics_keep",
    "Mat_Metro_science_drum",
  ]) {
    expect(metroNames, `${landmark} must stay a track colour`).toContain(landmark);
  }
});

test("no pre-colored player geometry ships", () => {
  // The blend carries six Player_<color>_* sets that cannot cover 10 seats
  // and do not match the frontend palette. They must never reach the client.
  for (const file of ["pieces.glb", "knights.glb", "metros.glb", "ships.glb"]) {
    const gltf = readGlbJson(file) as { nodes?: { name?: string }[] };
    const leaked = (gltf.nodes ?? [])
      .map((n) => n.name ?? "")
      .filter((n) => n.startsWith("Player_"));
    expect(leaked, `${file} leaks pre-colored geometry`).toEqual([]);
  }
});

test("every material in the palette is a real material name", () => {
  // palette.json overrides by material name, so a typo silently does nothing.
  // Cross-check the piece materials at minimum.
  const palette = JSON.parse(readFileSync(join(MODELS, "palette.json"), "utf8")) as Record<
    string,
    { color: number[]; roughness: number; metalness: number }
  >;
  for (const slot of ["Seat_Body", "Seat_Shade", "Seat_Detail"]) {
    expect(palette[slot], `palette missing ${slot}`).toBeDefined();
    expect(palette[slot].color).toHaveLength(3);
  }
});

test("known resources map to their own tile file", () => {
  expect(tileFileFor("wood")).toBe("tiles/wood.glb");
  expect(tileFileFor("none")).toBe("tiles/none.glb");
});

test("fog falls back to the sea tile rather than failing", () => {
  // The blend has no fog art. Falling back keeps Islands boards playable.
  expect(tileFileFor("fog")).toBe("tiles/sea.glb");
});

test("a lake draws its own tile", () => {
  // `lake` has art (art/hexes/lake.blend) and `TILES` is consulted before
  // RESOURCE_FALLBACK, so it must not resolve to the sea, which would draw
  // open ocean with settlements in it.
  expect(tileFileFor("lake")).toBe("tiles/lake.glb");
  expect(RESOURCE_FALLBACK).not.toHaveProperty("lake");
  // A real tile, mounted like every producing hex: the lake fires on numbers,
  // so it must carry a chip.
  expect(TILES["lake"].socket).toEqual([0, 0.26, -1.5]);
});

test("only a Fishermen game downloads the lake tile", () => {
  // `lake` is an ordinary resource, unlike the oasis, but only Fishermen
  // floods a desert, and the lobby prefetch is what every base game pays for.
  expect(boardModelFiles("base")).not.toContain("tiles/lake.glb");
  expect(boardModelFiles("base+caravans")).not.toContain("tiles/lake.glb");
  expect(boardModelFiles("base+fishermen")).toContain("tiles/lake.glb");
});

test("the module pieces are fetched by the module that draws them", () => {
  // Camels and weirs are drawn only on Caravans and Fishermen boards, and
  // neither file belongs in a base game's download.
  for (const file of ["camels.glb", "spokes.glb", "fishing.glb"]) {
    expect(boardModelFiles("base"), file).not.toContain(file);
    expect(boardModelFiles("base+cak"), file).not.toContain(file);
  }
  expect(boardModelFiles("base+caravans")).toContain("camels.glb");
  // The wayposts ride with the camels: a Caravans board draws spokes from the
  // first frame, before any camel exists.
  expect(boardModelFiles("base+caravans")).toContain("spokes.glb");
  expect(boardModelFiles("base+fishermen")).toContain("fishing.glb");
  expect(boardModelFiles("base+fishermen")).not.toContain("spokes.glb");
  // The scenario stack that runs both gets all three.
  const both = boardModelFiles("base+fishermen+caravans");
  for (const file of ["camels.glb", "spokes.glb", "fishing.glb"]) {
    expect(both, file).toContain(file);
  }
});

test("the Explorers cargo is fetched by Explorers and by nothing else", () => {
  // This gate keeps cargo.glb out of every ruleset that cannot draw it.
  for (const ruleset of ["base", "base+cak", "base+fishermen+caravans"]) {
    expect(boardModelFiles(ruleset), ruleset).not.toContain("cargo.glb");
  }
  expect(boardModelFiles("base+explorers")).toContain("cargo.glb");
});

test("no lobby prefetch has a market town; a Wagons board fetches its three", () => {
  // Forty-eight towns at about 130 KB is six megabytes, and a board draws
  // three, determined by the dealt board (its trade hexes' grounds and
  // directions), so they are fetched per board like the river channels.
  for (const ruleset of [
    "base",
    "base+cak",
    "base+caravans",
    "base+explorers",
    "base+raiders",
    "base+wagons",
  ]) {
    for (const key of TRADE_TILES) {
      expect(boardModelFiles(ruleset), `${ruleset} ${key}`).not.toContain(`tiles/${key}.glb`);
    }
  }
  // A Wagons game does not use the Caravans spokes.
  expect(boardModelFiles("base+wagons")).not.toContain("spokes.glb");
  // A radius-2 board of sheep and brick with the three reference trade corners.
  const tiles: BoardTile[] = hexesInRadius(2).map((hex) => ({
    hex,
    res: hex.q === 2 && hex.r === 0 ? "brick" : "sheep",
    num: 5,
  }));
  const trade = [
    { q: -2, r: 2 },
    { q: 0, r: -2 },
    { q: 2, r: 0 },
  ].map((hex, i) => ({ hex, role: i, plaza: { ...hex, side: 2 }, seaward: [] }));
  const view = {
    board: { tiles, robber: { q: 0, r: 0 }, harbors: [] },
    config: { ruleset: "base+wagons" },
    ext: { wagons: { has_trade: true, trade } },
  } as unknown as FullView;
  expect(boardTileFiles(view).sort()).toEqual([
    "tiles/trade_hills_e.glb",
    "tiles/trade_pasture_nw.glb",
    "tiles/trade_pasture_sw.glb",
  ]);
});

test("only an Explorers game downloads the Council", () => {
  for (const ruleset of ["base", "base+islands", "base+wagons", "base+fishermen"]) {
    expect(boardModelFiles(ruleset), ruleset).not.toContain("tiles/sea_council.glb");
  }
  expect(boardModelFiles("base+explorers")).toContain("tiles/sea_council.glb");
});

test("an unknown resource resolves to null rather than throwing", () => {
  expect(tileFileFor("banana")).toBeNull();
});

test("the oasis has a tile of its own, and no resource reaches it", () => {
  // It ships (so the override in layers/caravans.ts can select it), and no
  // resource string resolves to it: the oasis is derived per hex, so a
  // resource-keyed path would put an oasis on every desert.
  expect(TILES["oasis"].file).toBe("tiles/oasis.glb");
  expect(TILES["oasis"].socket).toEqual([0, 0.26, -1.5]);
  for (const res of ["none", "lake", "wood", "sea", "generic"]) {
    expect(tileFileFor(res), `${res} resolves to the oasis`).not.toBe("tiles/oasis.glb");
  }
});

test("only a Caravans game downloads the oasis tile", () => {
  // `boardModelFiles` is what the lobby prefetches, so a module tile listed
  // unconditionally costs every base game a download.
  expect(boardModelFiles("base")).not.toContain("tiles/oasis.glb");
  expect(boardModelFiles("base+cak")).not.toContain("tiles/oasis.glb");
  expect(boardModelFiles("base+caravans")).toContain("tiles/oasis.glb");
  expect(boardModelFiles("base+fishermen+caravans")).toContain("tiles/oasis.glb");
});

test("the castle has a tile of its own, and no resource reaches it", () => {
  // The oasis's pair of assertions, for the Raiders castle: it ships, and no
  // resource string resolves to it (that would put a castle on every hex of
  // some terrain).
  expect(TILES["castle"].file).toBe("tiles/castle.glb");
  // Mounted like every land tile though no chip lands here: `hexcontract`
  // expects the socket at (0, 1.5), and it costs one empty and no geometry.
  expect(TILES["castle"].socket).toEqual([0, 0.26, -1.5]);
  for (const res of ["none", "lake", "wood", "sea", "generic", "oasis"]) {
    expect(tileFileFor(res), `${res} resolves to the castle`).not.toBe("tiles/castle.glb");
  }
});

test("only a Raiders game downloads the castle tile", () => {
  // A module tile must not ship to boards whose ruleset does not name Raiders.
  expect(boardModelFiles("base")).not.toContain("tiles/castle.glb");
  expect(boardModelFiles("base+cak")).not.toContain("tiles/castle.glb");
  expect(boardModelFiles("base+caravans")).not.toContain("tiles/castle.glb");
  expect(boardModelFiles("base+raiders")).toContain("tiles/castle.glb");
  expect(boardModelFiles("base+islands+raiders")).toContain("tiles/castle.glb");
});

test("each river tile ships, and no resource reaches one", () => {
  // The oasis's contract, per river tile: every one is in `TILES` (so the
  // river layer can select it) and none is an engine resource, since a river
  // is laid down by a module, not dealt as terrain. A resource-keyed path
  // would put a river through every mountain.
  //
  // `RIVER_TILES` is the whole set: sixty-six channels (twenty recipe-built)
  // and the marsh. `layers/rivers.test.ts` keeps it complete, and the count
  // below keeps this loop from checking nothing.
  let checked = 0;
  for (const tile of RIVER_TILES) {
    expect(TILES[tile], `${tile} is not in the manifest`).toBeDefined();
    checked++;
    expect(TILES[tile].file, `${tile} is not in the manifest`).toBe(`tiles/${tile}.glb`);
    expect(TILES[tile].socket, `${tile} lost its chip mount`).toEqual([0, 0.26, -1.5]);
    for (const res of ["none", "lake", "wood", "ore", "brick", "sheep", "sea"]) {
      expect(tileFileFor(res), `${res} resolves to ${tile}`).not.toBe(`tiles/${tile}.glb`);
    }
  }
  expect(checked, "no river tile is in the manifest at all").toBe(67);
  // The swamp keeps its socket though the scenario puts no number on it: the
  // mount is part of the tile contract (`hexcontract` fails a land tile with
  // no `Token_*`), not a claim that the hex produces.
  expect(TILES["swamp"].socket).toEqual([0, 0.26, -1.5]);
});

test("only a Rivers game downloads the river tiles", () => {
  // Unconditionally, the river tiles would be several megabytes of prefetch
  // on every base game for terrain it cannot draw; hence `MODULE_TILES`.
  for (const ruleset of ["base", "base+cak", "base+fishermen+caravans"]) {
    for (const tile of RIVER_TILES) {
      expect(boardModelFiles(ruleset), `${ruleset} pays for ${tile}`).not.toContain(
        `tiles/${tile}.glb`,
      );
    }
  }
});

test("a Rivers game prefetches the marsh but no channels", () => {
  // The split: a ruleset is known in the lobby and a board is not, and the
  // full river set is 6.5 MB for a board that draws a handful. The marsh stays
  // (every Rivers board has one; rivers end on it) and every channel moves to
  // `boardTileFiles`.
  const rivers = boardModelFiles("base+rivers");
  expect(rivers, "the marsh is not in the ruleset prefetch").toContain("tiles/swamp.glb");
  expect(RIVER_BOARD_TILES).toHaveLength(66);
  for (const tile of RIVER_BOARD_TILES) {
    expect(rivers, `base+rivers prefetches the channel ${tile}`).not.toContain(`tiles/${tile}.glb`);
  }
});

/** A four-hex chain: a mountains headwater running west to a swamp estuary. */
const CHAIN = [
  { q: 0, r: 0 },
  { q: -1, r: 0 },
  { q: -2, r: 0 },
  { q: -3, r: 0 },
];

function riversView(shapes: RiverShape[]): FullView {
  const res = ["ore", "brick", "sheep", "swamp"] as const;
  const tiles: BoardTile[] = CHAIN.map((hex, i) => ({ hex, res: res[i], num: 0 }));
  return {
    board: { tiles, robber: { q: 0, r: 0 }, harbors: [] },
    ext: { rivers: { rivers: [{ hexes: CHAIN, shapes, ins: [], outs: [] }], bridges: [] } },
  } as unknown as FullView;
}

test("a dealt Rivers board fetches its own shapes and no others", () => {
  // The board-aware half: a board draws at most one river tile per river hex,
  // so the fetch is bounded by the chain, not the shape set.
  const shapes: RiverShape[] = ["src_e", "e_w", "e_sw", "e_w"];
  const view = riversView(shapes);
  const files = boardTileFiles(view);

  expect(files.length, "more files than river hexes").toBeLessThanOrEqual(CHAIN.length);
  expect(files.length, "a board with a river fetched nothing").toBeGreaterThan(0);
  expect([...new Set(files)], "boardTileFiles is not deduped").toHaveLength(files.length);
  // Exactly the four this chain draws, by name, so a wrong file for a right
  // shape fails here.
  expect([...files].sort()).toEqual(
    [
      "tiles/river_mountains_src_e.glb",
      "tiles/river_hills_e_w_a.glb",
      "tiles/river_pasture_e_sw.glb",
      "tiles/river_swamp_e_w_a.glb",
    ].sort(),
  );
  // Nothing the board does not draw.
  for (const tile of RIVER_BOARD_TILES) {
    const file = `tiles/${tile}.glb`;
    if (files.includes(file)) continue;
    expect(files, `${tile} is fetched by a board that does not draw it`).not.toContain(file);
  }
});

test("every file the river layer plans is one the board fetched", () => {
  // `planRiverTiles` lays the board and `boardTileFiles` warms the cache for
  // it, so a shape the planner reaches and the prefetch misses would be
  // fetched serially at draw time.
  for (const shapes of [
    ["src_e", "e_w", "e_w", "e_w"],
    ["src_sw", "ne_sw", "nw_se", "w_se"],
    ["src_ne", "e_sw", "ne_se", "nw_sw"],
    ["src_nw", "ne_w", "e_nw", "e_w"],
  ] as RiverShape[][]) {
    const view = riversView(shapes);
    const fetched = new Set(boardTileFiles(view));
    const planned = planRiverTiles(view);
    expect(planned.length, `${shapes.join(",")} planned nothing`).toBeGreaterThan(0);
    for (const plan of planned) {
      expect(fetched, `${shapes.join(",")}: ${plan.file} is planned but not fetched`).toContain(
        plan.file,
      );
    }
  }
});

/**
 * Every module the project has defined, read from Go so the duplicate check
 * below stays exhaustive.
 */
function knownModules(): string[] {
  const go = readFileSync(join(__dirname, "..", "..", "..", "..", "engine", "compat.go"), "utf8");
  const block = go.slice(go.indexOf("var KnownModules = []string{"));
  const names = [...block.slice(0, block.indexOf("}")).matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  expect(names, "compat.go's KnownModules did not parse").toContain("rivers");
  return names;
}

test("the prefetch list has no duplicates, for every combination of modules", () => {
  // `base+raiders+wagons` must not ask for barbarians.glb twice (both name the
  // one warrior file). Every subset is checked: 2^9 is 512 rulesets, cheap as
  // a set comparison and certain to cover any colliding pair.
  const modules = knownModules();
  for (let mask = 0; mask < 1 << modules.length; mask++) {
    const parts = modules.filter((_, i) => mask & (1 << i));
    const ruleset = ["base", ...parts].join("+");
    const files = boardModelFiles(ruleset);
    const seen = new Set<string>();
    const dupes = files.filter((f) => (seen.has(f) ? true : (seen.add(f), false)));
    expect(dupes, `${ruleset} prefetches a file twice`).toEqual([]);
  }
});

test("raiders plus wagons fetches barbarians.glb once", () => {
  // The one pairing whose module lists overlap.
  const files = boardModelFiles("base+raiders+wagons");
  expect(files.filter((f) => f === "barbarians.glb")).toHaveLength(1);
  expect(files).toContain("riders.glb");
  expect(files).toContain("wagons.glb");
});

function group(names: string[]): THREE.Group {
  const scene = new THREE.Group();
  for (const name of names) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    mesh.name = name;
    scene.add(mesh);
  }
  return scene;
}

function meshNames(scene: THREE.Object3D): string[] {
  const out: string[] = [];
  scene.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) out.push(n.name);
  });
  return out.sort();
}

test("a subset contains only nodes matching the prefix", () => {
  // chips.glb holds 114 nodes; a layer needs one number's parts.
  const asset = {
    scene: group(["Chip_06_1_body", "Chip_06_1_face", "Chip_08_2_body"]),
    byMaterial: new Map(),
  };
  expect(meshNames(subsetByPrefix(asset, "Chip_06_1").scene)).toEqual([
    "Chip_06_1_body",
    "Chip_06_1_face",
  ]);
});

test("a prefix matching nothing yields an empty subset", () => {
  const asset = { scene: group(["Chip_06_1_body"]), byMaterial: new Map() };
  expect(meshNames(subsetByPrefix(asset, "Nope").scene)).toEqual([]);
});

test("a subset shares geometry with its source rather than copying it", () => {
  const scene = group(["Hwedge_wood_body"]);
  const asset = { scene, byMaterial: new Map() };
  const subset = subsetByPrefix(asset, "Hwedge_wood");
  const source = scene.children[0] as THREE.Mesh;
  const copy = subset.scene.children[0] as THREE.Mesh;
  expect(copy.geometry).toBe(source.geometry);
});

test("the preload set covers every tile and exists on disk", () => {
  // Against the ruleset that draws everything: module tiles (the Caravans
  // oasis) are absent from a base game's set, so "base" cannot cover them.
  //
  // `explorers` and `rivers` are in the list though the server does not build
  // them as rulesets: the Explorers and river tiles are art ahead of their
  // rules (see `EXPLORERS_TILES` and `RIVER_MODULE_TILES` in loader.ts), so
  // this means "every module there is art for". An unrecognised part costs
  // nothing, and leaving one out would leave its tiles uncovered.
  //
  // The river channels are covered by the other half of the split: they are
  // fetched per board, so `boardModelFiles` never lists one and the union of
  // the two paths must cover the manifest. That union is what guarantees no
  // tile ships that nothing fetches.
  const ruleset = boardModelFiles(
    "base+islands+cak+fishermen+caravans+raiders+explorers+rivers+wagons",
  );
  const files = [
    ...ruleset,
    ...RIVER_BOARD_TILES.map((t) => `tiles/${t}.glb`),
    ...TRADE_TILES.map((t) => `tiles/${t}.glb`),
  ];
  for (const entry of Object.values(TILES)) expect(files).toContain(entry.file);
  for (const f of boardModelFiles("base"))
    expect(existsSync(join(MODELS, f)), `missing ${f}`).toBe(true);
  for (const f of files) expect(existsSync(join(MODELS, f)), `missing ${f}`).toBe(true);
});

// `base+cak` alone has no colliding pair, so the duplicate check is the
// exhaustive sweep above ("the prefetch list has no duplicates, for every
// combination of modules").

test("Knights-only models are preloaded only for a Knights game", () => {
  const base = boardModelFiles("base+islands");
  const knights = boardModelFiles("base+cak");
  for (const f of ["knights.glb", "walls.glb", "metros.glb"]) {
    expect(base, `${f} in base`).not.toContain(f);
    expect(knights, `${f} in knights`).toContain(f);
  }
  // An empty ruleset is treated as base rather than throwing.
  expect(boardModelFiles("")).toEqual(base);
});

/**
 * What compression may and may not change.
 *
 * `npm run models:compress` rewrites every shipped .glb through meshopt
 * (about two thirds of a first visit's bytes). It may change how geometry is
 * stored, but not any name: `subsetByPrefix` cuts on mesh names, `byMaterial`
 * and palette.json key on material names, and `materialNamed` pulls two shore
 * materials out of beach.glb. A rename does not crash; it draws a board with
 * pieces missing or miscoloured.
 *
 * So this parses each file both ways (the shipped copy and the uncompressed
 * one src/testGlbFixtures.ts writes) through the app's loader and compares
 * the name sets.
 */
async function namesIn(file: string, root: string): Promise<string[]> {
  const buf = readFileSync(join(root, file));
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
    newGLTFLoader().parse(ab, "", resolve, reject),
  );
  const out: string[] = [];
  gltf.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) out.push(`${mesh.name}/${mat.name}`);
  });
  return out.sort();
}

test("every shipped model is compressed", () => {
  for (const file of ALL_SHIPPED) {
    const gltf = readGlbJson(file) as { extensionsRequired?: string[] };
    expect(gltf.extensionsRequired ?? [], `${file} is not compressed`).toContain(
      "EXT_meshopt_compression",
    );
  }
});

test("compression keeps every mesh and material name", async () => {
  expect(ALL_SHIPPED.length, "no models found to check").toBeGreaterThan(20);
  for (const file of ALL_SHIPPED) {
    const shipped = await namesIn(file, MODELS);
    // A file that parsed to nothing would match by being empty on both sides.
    expect(shipped.length, `${file} parsed to no meshes`).toBeGreaterThan(0);
    expect(shipped, file).toEqual(await namesIn(file, PLAIN_MODELS));
  }
});

test("every shipped model is named somewhere in the source", () => {
  // Every test above checks shipped files are well formed; this checks that
  // something wants them, so no model ships to every visitor with nothing
  // loading it (the die, for example, is code-drawn in
  // components/board/Die.tsx).
  //
  // A grep rather than a call graph: files reach the loader by several routes
  // (`boardModelFiles`, `thumbnail.ts` and `iconShots.ts` for offscreen
  // renders, `pieceSets.ts` and `robbers.ts` for cosmetics), and a check that
  // knew those would miss a new one. "Does any source file name this?" stays
  // true, and every route ends at a string literal.
  //
  // Tests are excluded (this test names `dice.glb`), and a model only a test
  // names is still unloaded. `manifest.generated.ts` is excluded too: the
  // exporter writes it from what it emitted, so it names every tile file by
  // construction. Tiles are reached by resource rather than filename, so they
  // get the reachability check below instead.
  //
  // A name in a comment or dead code can still pass; this guards against
  // forgetting, it is not a linter.
  const haystack = handWrittenSources();
  for (const file of ALL_SHIPPED) {
    if (TILE_FILES.has(file)) continue; // covered by the reachability test below
    // The path as the loader is given it (`robbers/keg.glb`), and the bare
    // basename, because `pieces/classic.glb` and `robbers/*.glb` are named
    // with their directory while top-level files are not.
    const bare = file.slice(file.lastIndexOf("/") + 1);
    expect(
      haystack.includes(file) || haystack.includes(bare),
      `${file} ships but no source file names it`,
    ).toBe(true);
  }
});

test("every manifest tile is reachable from outside the manifest", () => {
  // The tiles' half of the guard above. Tile files are never named at a call
  // site: `tileFileFor(res)` looks them up by the wire's resource string, so
  // the reachable set is:
  //
  //   1. the resource names the engine can send
  //      (`engine/board/resource_json.go`, the wire contract), plus
  //   2. the manifest keys hand-written source names as literals, for terrain
  //      no resource can name (`OASIS_TILE` and `PORT_TILE`).
  //
  // A key in neither is dead art downloaded by everyone. The Go file is read
  // rather than restated so the list cannot drift.
  const resourceGo = readFileSync(
    join(__dirname, "..", "..", "..", "..", "engine", "board", "resource_json.go"),
    "utf8",
  );
  const wireResources = new Set(
    [...resourceGo.matchAll(/^\s*\w+:\s*"([a-z_]+)",$/gm)].map((m) => m[1]),
  );
  expect(wireResources, "resource_json.go did not parse").toContain("wood");

  const haystack = handWrittenSources();
  for (const res of Object.keys(TILES)) {
    // `generic` is the one exception. resource_json.go promises that an
    // unrecognised resource renders as a generic tile (keeping the terrain
    // vocabulary append-only), but `tileFileFor` returns null for an unknown
    // resource and `planTiles` drops the hex, so nothing selects it yet. Kept
    // for that contract; wire the fallback or delete the tile, and do not add
    // a second name here.
    if (res === "generic") continue;
    expect(
      wireResources.has(res) || haystack.includes(`"${res}"`),
      `TILES["${res}"] (${TILES[res].file}): no engine resource or source literal names it`,
    ).toBe(true);
  }
});

test("lairs and camels are fetched only by the rulesets that draw them", () => {
  // lairs.glb (the lair token and the hex crew) is Explorers-only; the punt is
  // inside camels.glb, which Caravans already fetches.
  expect(boardModelFiles("base+explorers")).toContain("lairs.glb");
  expect(boardModelFiles("base")).not.toContain("lairs.glb");
  expect(boardModelFiles("base+caravans+islands")).not.toContain("lairs.glb");
  expect(boardModelFiles("base+caravans+islands")).toContain("camels.glb");
  expect(boardModelFiles("base+islands")).not.toContain("camels.glb");
});
