import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import {
  barbarianEdges,
  isPlaza,
  planPathBarbarians,
  planWagons,
  BUILDING_HALF_EXTENT,
  WAGON_TAIL,
  plazaToWorld,
  tradeHexes,
  tradeSeawardDir,
  tradeTileFiles,
  tradeTileOverrides,
  TRADE_TILES,
  TRADE_GROUNDS,
  TRADE_DIRECTIONS,
  tradeTileKey,
} from "./wagons";
import { DIRS, hexKey, hexToWorld, neighbor, vertexToWorld, TILE_ROTATION_Y } from "../coords";
import { MODULE_SCALE } from "../pieceArt";
import { TILES } from "../manifest.generated";
import { newGLTFLoader } from "../loader";
import { hexesInRadius } from "@/lib/hexgeo";
import type { BoardTile, FullView, Hex, WagonsExt } from "@/lib/types";

function viewWith(ext: Partial<WagonsExt>, tiles: BoardTile[] = []): FullView {
  return { board: { tiles }, ext: { wagons: ext } } as unknown as FullView;
}

const TRADE = [
  {
    hex: { q: -2, r: 2 },
    role: 0,
    plaza: { q: -2, r: 2, side: 2 },
    accepts: [1, 2],
    ships: [4, 3],
    left: 12,
  },
  {
    hex: { q: 0, r: -2 },
    role: 1,
    plaza: { q: 0, r: -2, side: 2 },
    accepts: [4],
    ships: [1, 3],
    left: 12,
  },
  {
    hex: { q: 2, r: 0 },
    role: 2,
    plaza: { q: 2, r: 0, side: 2 },
    accepts: [3],
    ships: [2, 4],
    left: 12,
  },
];

const BARBS = [
  { a: { q: -1, r: 1, side: 1 }, b: { q: -1, r: 2, side: 0 } },
  { a: { q: -1, r: 0, side: 0 }, b: { q: 0, r: -2, side: 1 } },
  { a: { q: 1, r: 0, side: 0 }, b: { q: 2, r: -1, side: 1 } },
];

describe("the plaza", () => {
  // A plaza's `side` is outside the board's two corner sides, which makes it
  // unbuildable without any build rule knowing about plazas. vertexToWorld
  // reads `side` as north or south and would put the marker a lattice radius
  // away from its hex.
  test("is not one of the board's two corner sides", () => {
    expect(isPlaza({ q: 0, r: 0, side: 2 })).toBe(true);
    expect(isPlaza({ q: 0, r: 0, side: 0 })).toBe(false);
    expect(isPlaza({ q: 0, r: 0, side: 1 })).toBe(false);
  });

  test("sits at the centre of its trade hex, not at a corner of it", () => {
    const plaza = { q: 2, r: 0, side: 2 };
    expect(plazaToWorld(plaza)).toEqual(hexToWorld({ q: 2, r: 0 }));
    // A different place from either corner of the same hex, which is what
    // vertexToWorld would give.
    expect(plazaToWorld(plaza)).not.toEqual(vertexToWorld({ q: 2, r: 0, side: 0 }));
    expect(plazaToWorld(plaza)).not.toEqual(vertexToWorld({ q: 2, r: 0, side: 1 }));
  });
});

describe("an inert module draws nothing", () => {
  // A board with no cape triple carries no scenario. `has_trade` says so on
  // the wire because, as with the Caravans oasis, {q:0,r:0} is a real hex at
  // the board centre and cannot mean "none".
  test("no trade hexes means no barbarians and no tiles", () => {
    const v = viewWith({ has_trade: false, trade: TRADE, barbarians: BARBS }, board(2));
    expect(tradeHexes(v)).toEqual([]);
    expect(planPathBarbarians(v)).toEqual([]);
    expect(tradeTileOverrides(v).files.size).toBe(0);
  });

  test("the wagons wait for the scenario to start", () => {
    const wagons = [{ player: 0, v: { q: 0, r: 0, side: 1 } }];
    expect(planWagons(viewWith({ has_trade: true, started: false, wagons }))).toEqual([]);
    expect(planWagons(viewWith({ has_trade: true, started: true, wagons }))).toHaveLength(1);
  });
});

describe("wagons sharing a junction", () => {
  const at = { q: 0, r: 0, side: 1 };
  const plan = (n: number) =>
    planWagons(
      viewWith({
        has_trade: true,
        started: true,
        wagons: Array.from({ length: n }, (_, i) => ({ player: i, v: at })),
      }),
    );

  // "Wagons never block anything and are never blocked": any number may stand
  // on one intersection, so this is the ordinary case.
  test("a lone wagon stands on the vertex itself", () => {
    const [w] = plan(1);
    expect(w.position).toEqual(vertexToWorld(at));
    expect(w.rotationY).toBe(0);
  });

  // A wagon starts on its owner's round-2 city and stops on buildings all
  // game; at radius 0 it would be drawn inside the building.
  test("a wagon on a building's corner stands beside it, not inside it", () => {
    const v = {
      ext: { wagons: { has_trade: true, started: true, wagons: [{ player: 0, v: at }] } },
      buildings: [{ v: at, owner: 0, city: true }],
    } as unknown as FullView;
    const [w] = planWagons(v);
    const [cx, , cz] = vertexToWorld(at);
    const off = Math.hypot(w.position[0] - cx, w.position[2] - cz);
    expect(off).toBeGreaterThan(0.2);
    // Two wagons plus the building are three slots, none shared.
    const two = planWagons({
      ...v,
      ext: {
        wagons: {
          has_trade: true,
          started: true,
          wagons: [
            { player: 0, v: at },
            { player: 1, v: at },
          ],
        },
      },
    });
    for (const p of two)
      expect(Math.hypot(p.position[0] - cx, p.position[2] - cz)).toBeGreaterThan(0.2);
    expect(new Set(two.map((p) => p.position.join(","))).size).toBe(2);
  });

  // The ring's radii are wagon-to-wagon clearances. Treating a building as one
  // more wagon left a lone wagon on its owner's city 0.36 out with its tail
  // 0.41 behind, almost entirely inside the city.
  test("a wagon on a settlement or city is drawn clear of the building", () => {
    const [cx, , cz] = vertexToWorld(at);
    for (const city of [false, true]) {
      const [hx, hz] = BUILDING_HALF_EXTENT[city ? "city" : "settlement"];
      for (const n of [1, 2, 3]) {
        const placed = planWagons({
          ext: {
            wagons: {
              has_trade: true,
              started: true,
              wagons: Array.from({ length: n }, (_, i) => ({ player: i, v: at })),
            },
          },
          buildings: [{ v: at, owner: 0, city }],
        } as unknown as FullView);
        for (const w of placed) {
          // The wagon faces outward along its bearing, so its tail is the
          // point nearest the building.
          const tx = w.position[0] - cx - WAGON_TAIL * Math.cos(w.rotationY ?? 0);
          const tz = w.position[2] - cz - WAGON_TAIL * Math.sin(w.rotationY ?? 0);
          expect(
            Math.abs(tx) > hx || Math.abs(tz) > hz,
            `${city ? "city" : "settlement"}, ${n} wagon(s): tail at ${tx.toFixed(2)},${tz.toFixed(2)}`,
          ).toBe(true);
        }
      }
    }
  });

  test("several are ringed, and none of them shares a position", () => {
    for (const n of [2, 3, 4]) {
      const ring = plan(n);
      expect(ring).toHaveLength(n);
      const spots = new Set(ring.map((w) => w.position.join(",")));
      expect(spots.size, `${n} wagons`).toBe(n);
      // Each is yawed outward along its own radius, which is what the
      // four-wagon clearance in wagonArt.test.ts measures.
      expect(new Set(ring.map((w) => w.rotationY)).size).toBe(n);
    }
  });

  test("the ring grows with the piece, because its radii are authored units", () => {
    // The radii in `wagons.ts` are in the wagon's authored units
    // (`wagonArt.test.ts` re-derives all three), so they must be multiplied by
    // `MODULE_SCALE.wagon` (1.5), as `gen/wagons.py` says. Four wagons at an
    // unscaled 0.47 overlap by a third of a wagon.
    const [x, , z] = vertexToWorld(at);
    for (const [n, authored] of [
      [2, 0.22],
      [3, 0.38],
      [4, 0.47],
    ] as const) {
      for (const w of plan(n)) {
        const r = Math.hypot(w.position[0] - x, w.position[2] - z);
        expect(r, `${n} wagons`).toBeCloseTo(authored * MODULE_SCALE.wagon, 6);
      }
    }
  });

  // A key that changed with position would make every move look like one
  // wagon vanishing and another appearing to the drop animation.
  test("a wagon's key is its seat, so it survives moving", () => {
    const before = planWagons(
      viewWith({ has_trade: true, started: true, wagons: [{ player: 2, v: at }] }),
    );
    const after = planWagons(
      viewWith({
        has_trade: true,
        started: true,
        wagons: [{ player: 2, v: { q: 1, r: 0, side: 0 } }],
      }),
    );
    expect(before[0].key).toBe(after[0].key);
    expect(before[0].position).not.toEqual(after[0].position);
  });

  test("the ring is ordered by seat, so it does not reshuffle between frames", () => {
    const a = plan(3).map((w) => w.owner);
    const b = planWagons(
      viewWith({
        has_trade: true,
        started: true,
        // The same three seats, sent in the other order.
        wagons: [2, 1, 0].map((i) => ({ player: i, v: at })),
      }),
    ).map((w) => w.owner);
    expect(a).toEqual(b);
  });
});

describe("the barbarians", () => {
  test("one per path, keyed by index because they move", () => {
    const plan = planPathBarbarians(viewWith({ has_trade: true, barbarians: BARBS }));
    expect(plan).toHaveLength(3);
    expect(plan.map((b) => b.key)).toEqual([
      "wagon-barbarian:0",
      "wagon-barbarian:1",
      "wagon-barbarian:2",
    ]);
  });

  // A zero edge is a barbarian the derivation could not place (only on a
  // board with no legal path left). Drawing it would stand a figure at the
  // origin.
  test("a barbarian that was never placed is not drawn at the origin", () => {
    const zero = { a: { q: 0, r: 0, side: 0 }, b: { q: 0, r: 0, side: 0 } };
    const plan = planPathBarbarians(viewWith({ has_trade: true, barbarians: [zero, BARBS[1]] }));
    expect(plan).toHaveLength(1);
    expect(plan[0].key).toBe("wagon-barbarian:1");
  });

  test("their edges are published as a set, for a road renderer to read", () => {
    const set = barbarianEdges(viewWith({ has_trade: true, barbarians: BARBS }));
    expect(set.size).toBe(3);
  });
});

describe("the trade-hex tile", () => {
  // Forty-eight files, one per ground and seaward direction, drawn at the
  // board's own facing: the number chip does not turn with a tile, so the
  // direction is in the file, and the hex keeps its resource, so the ground is
  // too.

  /** The compass name of a world direction, worked out from the angle alone. */
  function compass(x: number, z: number): string {
    // Bearing clockwise from north, north being -z (the back of the board).
    const deg = ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
    const names: Record<number, string> = {
      30: "ne",
      90: "e",
      150: "se",
      210: "sw",
      270: "w",
      330: "nw",
    };
    const hit = Object.keys(names).find((k) => Math.abs(Number(k) - deg) < 1e-6);
    expect(hit, `bearing ${deg} is not an edge normal`).toBeDefined();
    return names[Number(hit)];
  }

  /** A cape at `h`: land all round within radius 3, minus the three neighbours round `dir`. */
  function cape(h: Hex, dir: number): BoardTile[] {
    const sea = new Set([dir + 5, dir, dir + 1].map((i) => hexKey(neighbor(h, i))));
    return hexesInRadius(3)
      .map((x) => ({ q: x.q + h.q, r: x.r + h.r }))
      .filter((x) => !sea.has(hexKey(x)))
      .map((x) => ({ hex: x, res: "sheep", num: 5 }));
  }

  const tradeAt = (hex: Hex) => ({ ...TRADE[0], hex, plaza: { ...hex, side: 2 } });

  test("the file names the seaward direction on all six bearings", () => {
    for (const h of [
      { q: 0, r: 0 },
      { q: 3, r: -2 },
    ]) {
      for (let dir = 0; dir < 6; dir++) {
        const tiles = cape(h, dir);
        const land = new Set(tiles.map((t) => hexKey(t.hex)));
        expect(tradeSeawardDir(h, land), `${hexKey(h)} dir ${dir}`).toBe(dir);
        const art = tradeTileOverrides(viewWith({ has_trade: true, trade: [tradeAt(h)] }, tiles));
        const [x, , z] = hexToWorld(DIRS[dir]);
        const want = `tiles/trade_pasture_${compass(x, z)}.glb`;
        expect(art.files.get(hexKey(h)), `${hexKey(h)} dir ${dir}`).toBe(want);
        expect(art.land.has(hexKey(h))).toBe(true);
        // Never turned: the chip would be left under a house.
        expect(art.yaw.size).toBe(0);
      }
    }
  });

  test("the reference board's corners get towns facing outward", () => {
    // Trade sits on the corners of a radius-2 board with no sea tiles, as a
    // base-shaped board sends: off the list is sea.
    const art = tradeTileOverrides(viewWith({ has_trade: true, trade: TRADE }, board(2)));
    expect(art.files.get("-2,2")).toBe("tiles/trade_pasture_sw.glb");
    expect(art.files.get("0,-2")).toBe("tiles/trade_pasture_nw.glb");
    expect(art.files.get("2,0")).toBe("tiles/trade_pasture_e.glb");
    expect(tradeTileFiles(viewWith({ has_trade: true, trade: TRADE }, board(2))).sort()).toEqual([
      "tiles/trade_pasture_e.glb",
      "tiles/trade_pasture_nw.glb",
      "tiles/trade_pasture_sw.glb",
    ]);
  });

  test("the town is composed on the ground the hex keeps", () => {
    // A trade hex keeps its resource (docs/rules/wagons.md), so a brick trade
    // hex is still hills with a kiln on it, and an ore one still a mountain.
    const cases: [BoardTile["res"], string][] = [
      ["brick", "hills"],
      ["wood", "forest"],
      ["sheep", "pasture"],
      ["wheat", "fields"],
      ["ore", "mountains"],
      ["none", "desert"],
      ["swamp", "swamp"],
      ["lake", "lake"],
    ];
    for (const [res, ground] of cases) {
      const tiles = board(2).map((t): BoardTile => (hexKey(t.hex) === "2,0" ? { ...t, res } : t));
      const art = tradeTileOverrides(viewWith({ has_trade: true, trade: TRADE }, tiles));
      expect(art.files.get("2,0"), res).toBe(`tiles/trade_${ground}_e.glb`);
    }
    // A ground no town is composed for draws its own tile rather than a guess.
    const gold = board(2).map(
      (t): BoardTile => (hexKey(t.hex) === "2,0" ? { ...t, res: "gold" } : t),
    );
    expect(
      tradeTileOverrides(viewWith({ has_trade: true, trade: TRADE }, gold)).files.has("2,0"),
    ).toBe(false);
  });

  test("the spelled-out tile list is exactly the derivation", () => {
    const derived = Object.values(TRADE_GROUNDS).flatMap((g) =>
      [0, 1, 2, 3, 4, 5].map((d) => tradeTileKey(g, d)),
    );
    expect([...TRADE_TILES].sort()).toEqual(derived.sort());
    expect(TRADE_TILES).toHaveLength(48);
  });

  test("a trade hex the board does not draw as land keeps its own tile", () => {
    const tiles = board(2).map(
      (t): BoardTile => (hexKey(t.hex) === "2,0" ? { ...t, res: "sea" } : t),
    );
    const art = tradeTileOverrides(viewWith({ has_trade: true, trade: TRADE }, tiles));
    expect(art.files.has("2,0")).toBe(false);
    expect(art.files.size).toBe(2);
    // And an island with no water round it at all has no seaward half to face.
    expect(tradeSeawardDir({ q: 0, r: 0 }, new Set(board(2).map((t) => hexKey(t.hex))))).toBeNull();
  });

  test("every town keeps the standard land chip mount", () => {
    expect(TRADE_TILES).toHaveLength(48);
    for (const key of TRADE_TILES) {
      expect(TILES[key]?.file, key).toBe(`tiles/${key}.glb`);
      expect(TILES[key].socket, key).toEqual([0, 0.26, -1.5]);
    }
  });

  test("each town stands on the side its file name says", async () => {
    // At TILE_ROTATION_Y the hall and houses of trade_<ground>_<dir> lie on
    // the <dir> side of the hex centre, on every ground. A misnamed file, a
    // layout turned the wrong way, or an off-by-one DIRS-to-name table fails
    // here.
    for (const key of TRADE_TILES) {
      const dir = TRADE_DIRECTIONS.indexOf(key.split("_")[2] as (typeof TRADE_DIRECTIONS)[number]);
      const pts = await pointsOf(TILES[key].file, (n) => /_town_(hall|house_\d+)(_\d+)?$/.test(n));
      expect(pts.length, key).toBeGreaterThan(20);
      const c = Math.cos(TILE_ROTATION_Y);
      const sn = Math.sin(TILE_ROTATION_Y);
      let sx = 0;
      let sz = 0;
      for (const p of pts) {
        sx += p.x * c + p.z * sn;
        sz += -p.x * sn + p.z * c;
      }
      const [dx, , dz] = hexToWorld(DIRS[dir]);
      const n = Math.hypot(sx, sz) * Math.hypot(dx, dz);
      // Within 60 degrees of the direction it is named for.
      expect((sx * dx + sz * dz) / n, key).toBeGreaterThan(0.5);
    }
  });
});

/** Every hex out to `radius`, all land. */
function board(radius: number): BoardTile[] {
  return hexesInRadius(radius).map((hex) => ({ hex, res: "sheep", num: 5 }));
}

const MODELS = join(__dirname, "..", "..", "..", "..", "public", "models");

/** World-space vertices of the meshes in a shipped model whose name passes `keep`. */
async function pointsOf(file: string, keep: (name: string) => boolean): Promise<THREE.Vector3[]> {
  const buf = readFileSync(join(MODELS, file));
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) =>
    newGLTFLoader().parse(ab, "", resolve, reject),
  );
  gltf.scene.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  gltf.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !keep(mesh.name)) return;
    const pos = mesh.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
  });
  return out;
}
