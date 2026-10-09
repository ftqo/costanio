import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import type { BoardTile, FullView, Hex, Vertex } from "@/lib/types";
import { hexVertices } from "@/lib/hexgeo";
import { hexToWorld, vertexToWorld, LATTICE_SCALE, TILE_ROTATION_Y, hexKey } from "../coords";
import { TILES } from "../manifest.generated";
import { newGLTFLoader } from "../loader";
import { COUNCIL_TILE, COUNCIL_QUAY_AXIS, councilYaw, tileArtOverrides } from "./explorers";

// The Council is where two of the three missions are delivered. Its tile is a
// walled town whose two quays run out to the two anchor corners, each ending
// in a stone pier-head with an iron anchor. The art is the only "deliver here"
// marker, so the tests below hold it to the corners.
const view = (explorers: unknown) =>
  ({
    board: { tiles: [], robber: { q: 0, r: 0 }, harbors: [] },
    ext: { explorers },
  }) as unknown as FullView;

test("the code-drawn Council marks are gone: no ring, no discs", async () => {
  const markers = await import("../markers");
  const layer = await import("./explorers");
  expect(Object.keys(markers).filter((k) => /council/i.test(k))).toEqual([]);
  expect("planCouncil" in layer).toBe(false);
  // Outside Explorers nothing is repainted either.
  expect(tileArtOverrides(view(undefined)).files.size).toBe(0);
});

// --- the Council tile ------------------------------------------------------
//
// `tiles/sea_council.glb`: the two quays must meet the two anchor corners a
// ship delivers from, or the town's berths would be where the rules do not
// deliver. The turn is pinned here for every orientation the engine can
// produce, against the art.

const MODELS = join(__dirname, "..", "..", "..", "..", "public", "models");

/** World (x, z) of `[x, z]` in the tile's own frame, under the tile's placement. */
function place(yaw: number, scale: number, [x, z]: readonly [number, number]): [number, number] {
  // THREE's Y rotation: local +x -> (cos a, -sin a), local +z -> (sin a, cos a).
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [scale * (x * c + z * s), scale * (-x * s + z * c)];
}

/** Every opposite pair of corners of `h`, both ways round: all six anchor orders. */
function oppositePairs(h: Hex): [Vertex, Vertex][] {
  const [cx, , cz] = hexToWorld(h);
  const vs = hexVertices(h);
  const out: [Vertex, Vertex][] = [];
  for (const v of vs) {
    const [x, , z] = vertexToWorld(v);
    const opp = vs.find((w) => {
      const [wx, , wz] = vertexToWorld(w);
      return Math.hypot(wx - cx + (x - cx), wz - cz + (z - cz)) < 1e-9;
    });
    expect(opp, `no corner opposite ${JSON.stringify(v)}`).toBeDefined();
    out.push([v, opp!]);
  }
  return out;
}

/** The offset of a vertex from a hex centre, in world (x, z). */
function offset(h: Hex, v: Vertex): [number, number] {
  const [cx, , cz] = hexToWorld(h);
  const [x, , z] = vertexToWorld(v);
  return [x - cx, z - cz];
}

const HEXES: Hex[] = [
  { q: 0, r: 0 },
  { q: 2, r: -1 },
  { q: -3, r: 2 },
  { q: 4, r: 0 },
];

test("the quay axis lands on the anchor pair in every orientation", () => {
  // `councilAndAnchors` picks an opposite corner pair, so it lies on one of
  // three axes and arrives in either order: six cases per hex, on hexes away
  // from the origin too (a yaw from absolute positions would pass only at
  // (0, 0)).
  const yaws = new Set<string>();
  for (const h of HEXES) {
    for (const [a, b] of oppositePairs(h)) {
      const yaw = councilYaw(h, [a, b]);
      expect(yaw, `${hexKey(h)} ${JSON.stringify([a, b])}`).not.toBeNull();
      // The quay axis, both ends, through the tile's placement...
      const plus = place(yaw!, 1, COUNCIL_QUAY_AXIS);
      const minus = place(yaw!, 1, [-COUNCIL_QUAY_AXIS[0], -COUNCIL_QUAY_AXIS[1]]);
      // ...points at the two anchors, one end each (either way round: the tile
      // is symmetric under a half turn about that axis).
      const unit = (v: [number, number]) => {
        const n = Math.hypot(v[0], v[1]);
        return [v[0] / n, v[1] / n];
      };
      const [ua, ub] = [unit(offset(h, a)), unit(offset(h, b))];
      const hits = (u: number[], p: [number, number]) =>
        Math.hypot(u[0] - p[0], u[1] - p[1]) < 1e-9;
      expect(
        (hits(ua, plus) && hits(ub, minus)) || (hits(ua, minus) && hits(ub, plus)),
        `${hexKey(h)} yaw ${yaw} misses ${JSON.stringify([a, b])}`,
      ).toBe(true);
      yaws.add(yaw!.toFixed(9));
    }
  }
  // Three axes, three turns, and the N/S one is the board's own facing.
  expect(yaws.size).toBe(3);
  expect(yaws.has(TILE_ROTATION_Y.toFixed(9))).toBe(true);
  expect([...yaws].map(Number).sort()).toEqual(
    [Math.PI - Math.PI / 3, Math.PI, Math.PI + Math.PI / 3].map((x) => Number(x.toFixed(9))),
  );
});

test("the N/S pair keeps the board's facing: the tile is authored for it", () => {
  const h = { q: 1, r: 1 };
  const north: Vertex = { q: 1, r: 1, side: 0 };
  const south: Vertex = { q: 1, r: 1, side: 1 };
  expect(councilYaw(h, [north, south])).toBeCloseTo(TILE_ROTATION_Y, 12);
  expect(councilYaw(h, [south, north])).toBeCloseTo(TILE_ROTATION_Y, 12);
});

test("anchors that are not an opposite pair of this hex turn nothing", () => {
  const h = { q: 0, r: 0 };
  const vs = hexVertices(h);
  expect(councilYaw(h, undefined)).toBeNull();
  expect(councilYaw(h, [])).toBeNull();
  expect(councilYaw(h, [vs[0]])).toBeNull();
  // Adjacent corners, and an opposite pair of a different hex.
  expect(councilYaw(h, [vs[0], vs[1]])).toBeNull();
  const far = hexVertices({ q: 3, r: 0 });
  expect(councilYaw(h, [far[0], far[3]])).toBeNull();
});

/** World-space vertices of every mesh in a shipped model whose name starts with `prefix`. */
async function pointsOf(file: string, prefix: string): Promise<THREE.Vector3[]> {
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
    if (!mesh.isMesh || !mesh.name.startsWith(prefix)) return;
    const pos = mesh.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
  });
  return out;
}

test("the shipped town's quays really run along the axis the yaw assumes", async () => {
  // The town is rotationally busy (a wall ring with six towers), but only the
  // quays reach the hex's corners: the town stays well inside the hull across
  // x and runs out to the corners along z.
  const file = TILES[COUNCIL_TILE]?.file;
  expect(file).toBe("tiles/sea_council.glb");
  const town = await pointsOf(file, "Council_town");
  expect(town.length).toBeGreaterThan(100);
  const maxAbs = (f: (p: THREE.Vector3) => number) => Math.max(...town.map((p) => Math.abs(f(p))));
  expect(
    maxAbs((p) => p.z),
    "the quays reach the corners along z",
  ).toBeGreaterThan(2.4);
  expect(
    maxAbs((p) => p.x),
    "nothing reaches that far across x",
  ).toBeLessThan(2.0);

  // And through the placement the board uses (LATTICE_SCALE, like every water
  // tile), each quay's far tip lands on its anchor, for every orientation.
  const tips: [number, number][] = [
    [0, Math.max(...town.map((p) => p.z))],
    [0, Math.min(...town.map((p) => p.z))],
  ];
  for (const h of HEXES) {
    for (const [a, b] of oppositePairs(h)) {
      const yaw = councilYaw(h, [a, b])!;
      const landed = tips.map((t) => place(yaw, LATTICE_SCALE, t));
      for (const v of [a, b]) {
        const [ax, az] = offset(h, v);
        const nearest = Math.min(...landed.map(([x, z]) => Math.hypot(x - ax, z - az)));
        // The quay stops just short of the corner (which is in the lattice
        // gutter, a road's width out), so "on the anchor" is within half a unit.
        expect(nearest, `${hexKey(h)} anchor ${JSON.stringify(v)}`).toBeLessThan(0.5);
      }
    }
  }
});

const councilView = (tiles: BoardTile[], council: Hex, anchors: Vertex[]) =>
  ({
    board: { tiles, robber: { q: 0, r: 0 }, harbors: [] },
    ext: { explorers: { council, anchors, revealed: [] } },
  }) as unknown as FullView;

test("the Council hex draws the Council tile, turned, and stays water", () => {
  const council = { q: 2, r: -1 };
  const vs = hexVertices(council);
  const tiles: BoardTile[] = [
    { hex: council, res: "sea", num: 0 },
    { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
  ];
  const art = tileArtOverrides(councilView(tiles, council, [vs[1], vs[4]]));
  expect(art.files.get(hexKey(council))).toBe(TILES[COUNCIL_TILE].file);
  expect(art.yaw.get(hexKey(council))).toBeCloseTo(councilYaw(council, [vs[1], vs[4]])!, 12);
  // Water: drawn a whole lattice cell wide, no gutter, no beach round it.
  expect(art.land.has(hexKey(council))).toBe(false);
  // Nothing else is repainted.
  expect([...art.files.keys()]).toEqual([hexKey(council)]);
});

test("a Council the board does not carry as open water is not repainted", () => {
  const council = { q: 2, r: -1 };
  const vs = hexVertices(council);
  const anchors = [vs[0], vs[3]];
  // Off the board, on a fogged hex, and on land: frames the engine does not
  // produce, each drawn as the tile list says.
  for (const tiles of [
    [] as BoardTile[],
    [{ hex: council, res: "fog", num: 0 }] as BoardTile[],
    [{ hex: council, res: "wood", num: 8 }] as BoardTile[],
  ]) {
    const art = tileArtOverrides(councilView(tiles, council, anchors));
    expect(art.files.size, JSON.stringify(tiles)).toBe(0);
    expect(art.yaw.size).toBe(0);
  }
});

test("an anchor stands on the pier-head at each quay end", async () => {
  // Measured on the shipped tile: two anchors, one per end of the quay axis,
  // each standing on its pier-head (the head's top is the anchor's base), and
  // through the board's placement each lands on one of the engine's anchor
  // corners for every orientation.
  const file = TILES[COUNCIL_TILE].file;
  const anchor = await pointsOf(file, "Council_anchor");
  const head = await pointsOf(file, "Council_pier_top");
  const town = await pointsOf(file, "Council_town");
  expect(anchor.length).toBeGreaterThan(20);
  expect(head.length).toBeGreaterThan(8);
  const ends = (pts: THREE.Vector3[]) =>
    [1, -1].map((sign) => {
      const mine = pts.filter((p) => Math.sign(p.z) === sign);
      expect(mine.length, `nothing at the ${sign > 0 ? "+" : "-"}z end`).toBeGreaterThan(0);
      const cx = mine.reduce((a, p) => a + p.x, 0) / mine.length;
      const cz = mine.reduce((a, p) => a + p.z, 0) / mine.length;
      return {
        c: [cx, cz] as [number, number],
        lo: Math.min(...mine.map((p) => p.y)),
        hi: Math.max(...mine.map((p) => p.y)),
      };
    });
  const anchors = ends(anchor);
  const heads = ends(head);
  for (let i = 0; i < 2; i++) {
    // On the quay axis, at its far end...
    expect(Math.abs(anchors[i].c[0])).toBeLessThan(1e-3);
    expect(Math.abs(anchors[i].c[1])).toBeGreaterThan(2.3);
    // ...standing on its own pier-head, flush (the head's top is its base)...
    expect(
      Math.hypot(anchors[i].c[0] - heads[i].c[0], anchors[i].c[1] - heads[i].c[1]),
    ).toBeLessThan(0.05);
    expect(anchors[i].lo).toBeCloseTo(heads[i].hi, 3);
    // ...and standing above the quay deck it caps, so it reads.
    const deck = Math.max(
      ...town.filter((p) => Math.abs(p.x) < 0.17 && Math.abs(p.z) > 2.3).map((p) => p.y),
    );
    expect(heads[i].hi).toBeGreaterThan(deck);
    expect(anchors[i].hi - anchors[i].lo, "an anchor tall enough to read").toBeGreaterThan(0.6);
  }
  for (const h of HEXES) {
    for (const [a, b] of oppositePairs(h)) {
      const yaw = councilYaw(h, [a, b])!;
      const landed = anchors.map((e) => place(yaw, LATTICE_SCALE, e.c));
      for (const v of [a, b]) {
        const [ax, az] = offset(h, v);
        const nearest = Math.min(...landed.map(([x, z]) => Math.hypot(x - ax, z - az)));
        // The pier-head stays inside the hex border (check-hexes holds every
        // tile's art to the 2.598 apothem), so the anchor stops 0.59 short of
        // the corner, which is in the gutter. The other corner is 5.7 away.
        expect(nearest, `${hexKey(h)} anchor ${JSON.stringify(v)}`).toBeLessThan(0.65);
      }
    }
  }
});
