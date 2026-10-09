// Painting the town into the ground (paint.ts), on the shipped lattices: the
// pasture's regular 21 cm sheet and the lake's coarse, uneven one. Checks the
// outline (a plaza that is a lattice hexagon of whole triangles, a spoke that
// is a band of whole lattice rows even when authored off the grid, one patch
// each with no holes or specks) and the height rules: no point moves more
// than EVEN_CAP, and none is raised inside the chip's disc.
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { HeightField } from "./fields";
import { CHIP_KEEP, chipDist } from "./heroes";
import { readModel } from "./io";
import {
  clonePart,
  partsWithRole,
  rotatePrimsY,
  type Part,
  type Prim,
  type TileModel,
} from "./model";
import {
  EVEN_CAP,
  EVEN_CHIP,
  GroundMesh,
  KERB_CHIP,
  compactTris,
  hash01,
  kerbStones,
  paintGround,
  planPaint,
  trisUnder,
  type PaintLabel,
  type PaintPlan,
} from "./paint";

const REPO = path.resolve(__dirname, "../../../../..");
const tile = (f: string) => readModel(path.join(REPO, "frontend/public/models/tiles", f));
const layout = (f: string) => readModel(path.join(REPO, "art/trade/parts", f));

let pasture: Prim[], lake: Prim[];
let townTile: TileModel, townW: TileModel, lakeW: TileModel;
beforeAll(async () => {
  pasture = partsWithRole(await tile("sheep.glb"), "ground").flatMap((p) => p.prims);
  lake = partsWithRole(await tile("lake.glb"), "ground").flatMap((p) => p.prims);
  [townTile, townW, lakeW] = await Promise.all([
    layout("town_tile.glb"),
    layout("town_w.glb"),
    layout("laketown_w.glb"),
  ]);
});
const named = (m: TileModel, name: string) => clonePart(m.parts.find((p) => p.name === name)!);

/** Painted triangles of one label, as [a, b, c] plan corners. */
function paintedTris(plan: PaintPlan, label: PaintLabel): [number, number][][] {
  const out: [number, number][][] = [];
  for (const [t, l] of plan.labels) {
    if (l !== label) continue;
    out.push(plan.mesh.tris[t].keys.map((k) => plan.mesh.verts.get(k)!));
  }
  return out;
}

/** The outline of a set of triangles: edges used once, as [a, b]. */
function outline(tris: [number, number][][]): [number, number][][] {
  const n = new Map<string, { e: [number, number][]; c: number }>();
  for (const t of tris)
    for (let k = 0; k < 3; k++) {
      const a = t[k],
        b = t[(k + 1) % 3];
      const ka = a.map((v) => v.toFixed(4)).join(","),
        kb = b.map((v) => v.toFixed(4)).join(",");
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = n.get(key);
      if (e) e.c++;
      else n.set(key, { e: [a, b], c: 1 });
    }
  return [...n.values()].filter((e) => e.c === 1).map((e) => e.e);
}

/** Bearing of an edge, mod 180, in degrees. */
const bearing = ([a, b]: [number, number][]) =>
  ((((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) % 180) + 180) % 180;

/** Connected patches (by shared edges) of the planned triangles of one label. */
function patches(plan: PaintPlan, label: PaintLabel): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const [t, l] of plan.labels) {
    if (l !== label || seen.has(t)) continue;
    const q = [t];
    seen.add(t);
    for (let k = 0; k < q.length; k++)
      for (const n of plan.mesh.nb[q[k]])
        if (!seen.has(n) && plan.labels.get(n) === label) {
          seen.add(n);
          q.push(n);
        }
    out.push(q.length);
  }
  return out;
}

describe("the lattice", () => {
  test("every shipped land sheet runs on three bearings, 60 degrees apart", () => {
    for (const g of [pasture, lake]) {
      const dirs = new GroundMesh(g).directions().map((d) => bearing([[0, 0], d]));
      expect(dirs.sort((a, b) => a - b).map((d) => Math.round(d))).toEqual([30, 90, 150]);
    }
  });
});

describe("the plaza", () => {
  test("is a lattice hexagon of whole triangles, inside the plaza it replaces", () => {
    const plaza = named(townTile, "Town_Tile_plaza");
    const plan = planPaint({ ground: pasture, sources: [{ part: plaza, label: "plaza" }] });
    const tris = paintedTris(plan, "plaza");
    // Side three rows: 6 n^2 triangles.
    expect(tris).toHaveLength(54);
    expect(patches(plan, "plaza")).toEqual([54]);
    // Its outline is on the lattice's own bearings, and on six lines only.
    const edge = outline(tris);
    const lines = new Set<string>();
    for (const e of edge) {
      const b = bearing(e);
      expect([30, 90, 150].some((d) => Math.abs(b - d) < 0.5)).toBe(true);
      const n = [-Math.sin((b * Math.PI) / 180), Math.cos((b * Math.PI) / 180)];
      lines.add(`${Math.round(b)}:${(e[0][0] * n[0] + e[0][1] * n[1]).toFixed(2)}`);
    }
    expect(lines.size).toBe(6);
    // Every corner inside the authored plaza's circle.
    for (const t of tris) for (const [x, z] of t) expect(Math.hypot(x, z)).toBeLessThan(0.7);
  });
});

describe("a spoke", () => {
  test("is a band of two whole lattice rows along its own lattice line", () => {
    const spoke = named(townW, "Town_W_paving_02");
    const plan = planPaint({ ground: pasture, sources: [{ part: spoke, label: "spoke" }] });
    const tris = paintedTris(plan, "spoke");
    expect(patches(plan, "spoke")).toEqual([tris.length]);
    // Its long sides are straight lattice lines 2 rows (0.371) apart.
    const edge = outline(tris);
    const along = edge.filter(
      (e) => Math.abs(bearing(e) - 150) < 0.5 || Math.abs(bearing(e) - 30) < 0.5,
    );
    const b = bearing(along[0]);
    const n = [-Math.sin((b * Math.PI) / 180), Math.cos((b * Math.PI) / 180)];
    const offs = [
      ...new Set(
        along
          .filter((e) => Math.abs(bearing(e) - b) < 0.5)
          .map((e) => (e[0][0] * n[0] + e[0][1] * n[1]).toFixed(3)),
      ),
    ];
    expect(offs).toHaveLength(2);
    expect(Math.abs(Number(offs[0]) - Number(offs[1]))).toBeCloseTo(0.3712, 2);
  });

  test("authored off the grid, it is snapped onto it: the same straight band", () => {
    const spoke = named(townW, "Town_W_paving_02");
    const on = planPaint({
      ground: pasture,
      sources: [{ part: clonePart(spoke), label: "spoke" }],
    });
    // Turned 9 degrees about its own middle: no longer on any lattice line.
    const turned = clonePart(spoke);
    rotatePrimsY(turned.prims, 9, -1.33, -0.77);
    const off = planPaint({ ground: pasture, sources: [{ part: turned, label: "spoke" }] });
    const sides = (plan: PaintPlan) =>
      new Set(outline(paintedTris(plan, "spoke")).map((e) => Math.round(bearing(e))));
    expect([...sides(off)].every((b) => [30, 90, 150].includes(b))).toBe(true);
    expect(patches(off, "spoke")).toHaveLength(1);
    // And it is the band the unturned spoke paints, give or take its ends.
    const a = new Set(on.labels.keys()),
      b = new Set(off.labels.keys());
    const shared = [...a].filter((t) => b.has(t)).length;
    expect(shared / a.size).toBeGreaterThan(0.8);
  });

  test("on the lake's coarse sheet, one row wide and one patch", () => {
    const spoke = named(lakeW, "LakeTown_W_paving_02");
    const plan = planPaint({ ground: lake, sources: [{ part: spoke, label: "spoke" }] });
    const tris = paintedTris(plan, "spoke");
    expect(tris.length).toBeGreaterThan(4);
    expect(patches(plan, "spoke")).toEqual([tris.length]);
    for (const e of outline(tris)) {
      const b = bearing(e);
      expect([30, 90, 150].some((d) => Math.abs(b - d) < 3)).toBe(true);
    }
  });
});

describe("the gap fill", () => {
  /** A flat yard floor over [x0, x1] x [z0, z1], as two triangles. */
  const rect = (x0: number, x1: number, z0: number, z1: number): number[] => [
    x0,
    0.25,
    z0,
    x0,
    0.25,
    z1,
    x1,
    0.25,
    z0,
    x1,
    0.25,
    z0,
    x0,
    0.25,
    z1,
    x1,
    0.25,
    z1,
  ];
  test("fills enclosed pockets and skips specks", () => {
    // A yard floor with a hole in it round one triangle's centre: four
    // rectangles round [hx - 0.03, hx + 0.03] x [hz - 0.03, hz + 0.03].
    const mesh = new GroundMesh(pasture);
    const near = mesh.tris.reduce((b, t) =>
      Math.hypot(t.cx - 1.3, t.cz - 0.9) < Math.hypot(b.cx - 1.3, b.cz - 0.9) ? t : b,
    );
    const [hx, hz] = [near.cx, near.cz];
    const ring: Part = {
      name: "Town_W_yardfloor",
      prims: [
        {
          material: "Mat_T_yard",
          pos: new Float32Array([
            ...rect(1.0, 1.6, 0.6, hz - 0.03),
            ...rect(1.0, 1.6, hz + 0.03, 1.2),
            ...rect(1.0, hx - 0.03, hz - 0.03, hz + 0.03),
            ...rect(hx + 0.03, 1.6, hz - 0.03, hz + 0.03),
          ]),
          nrm: new Float32Array(72),
        },
      ],
    };
    const raw = new Set(compactTris(mesh, ring));
    const inHole = mesh.tris
      .map((t, i) => [t, i] as const)
      .filter(([t]) => Math.abs(t.cx - hx) < 0.03 && Math.abs(t.cz - hz) < 0.03)
      .map(([, i]) => i);
    expect(inHole.length).toBeGreaterThan(0);
    for (const t of inHole) expect(raw.has(t)).toBe(false);
    const plan = planPaint({ ground: pasture, sources: [{ part: ring, label: "yard" }] });
    for (const t of inHole) expect(plan.labels.get(t)).toBe("yard");
    expect(patches(plan, "yard")).toHaveLength(1);
    // A yard floor so small it covers one triangle's centre is a speck.
    const speck: Part = {
      name: "Town_W_yardfloor",
      prims: [
        {
          material: "Mat_T_yard",
          pos: new Float32Array(rect(hx - 0.03, hx + 0.03, hz - 0.03, hz + 0.03)),
          nrm: new Float32Array(18),
        },
      ],
    };
    expect(compactTris(mesh, speck).length).toBeGreaterThan(0);
    const tiny = planPaint({ ground: pasture, sources: [{ part: speck, label: "yard" }] });
    expect(tiny.labels.size).toBe(0);
  });
});

describe("evening and the chip", () => {
  test("moves no point beyond EVEN_CAP or upward inside the chip disc", () => {
    // A ground with a 6 cm step through the plaza and a chip-side spoke.
    const g = pasture.map((p) => {
      const pos = new Float32Array(p.pos);
      for (let i = 0; i < pos.length; i += 3) pos[i + 1] = 0.3 + (pos[i] > 0.02 ? 0.06 : 0);
      return { ...p, pos };
    });
    const sources = [
      { part: named(townTile, "Town_Tile_plaza"), label: "plaza" as const },
      { part: named(townW, "Town_W_paving_01"), label: "spoke" as const },
    ];
    const plan = planPaint({ ground: g, sources });
    const { ground } = paintGround({ ground: g, plan, salt: 1 });
    const before = new HeightField(g),
      after = new HeightField(ground);
    let moved = 0,
      inDisc = 0;
    for (const v of plan.mesh.verts.values()) {
      const [x, z] = v;
      // A hair inside each face, so a point on the step reads one side only.
      for (const [dx, dz] of [
        [0.01, 0.002],
        [-0.01, -0.002],
      ]) {
        const b = before.sample(x + dx, z + dz),
          a = after.sample(x + dx, z + dz);
        if (!a || !b) continue;
        expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(2 * EVEN_CAP + 1e-4);
        if (a.y !== b.y) moved++;
        if (chipDist(x, z) < EVEN_CHIP - 0.02 && chipDist(x, z) < CHIP_KEEP) {
          inDisc++;
          expect(a.y).toBeLessThanOrEqual(b.y + 1e-6);
        }
      }
    }
    expect(moved).toBeGreaterThan(0);
    expect(inDisc).toBeGreaterThan(0);
    // Per vertex, exactly: never beyond the cap, never up in the disc.
    const y0 = new Map<string, number>(),
      y1 = new Map<string, number>();
    for (const [src, map] of [
      [g, y0],
      [ground, y1],
    ] as const)
      for (const p of src)
        for (let i = 0; i < p.pos.length; i += 3)
          map.set(`${p.pos[i].toFixed(4)},${p.pos[i + 2].toFixed(4)}`, p.pos[i + 1]);
    for (const [k, a] of y1) {
      const b = y0.get(k)!;
      expect(Math.abs(a - b)).toBeLessThanOrEqual(EVEN_CAP + 1e-6);
      const [x, z] = k.split(",").map(Number);
      if (chipDist(x, z) < EVEN_CHIP) expect(a).toBeLessThanOrEqual(b + 1e-6);
    }
  });
});

describe("water's banks", () => {
  test("leaves points marked still unevened", () => {
    // The same stepped ground as above; everything west of x -0.2 is a bank.
    const g = pasture.map((p) => {
      const pos = new Float32Array(p.pos);
      for (let i = 0; i < pos.length; i += 3) pos[i + 1] = 0.3 + (pos[i] > 0.02 ? 0.06 : 0);
      return { ...p, pos };
    });
    const plan = planPaint({
      ground: g,
      sources: [{ part: named(townTile, "Town_Tile_plaza"), label: "plaza" }],
    });
    const still = (x: number) => x < 0.1;
    const free = paintGround({ ground: g, plan, salt: 1 });
    const held = paintGround({ ground: g, plan, salt: 1, still: (x) => still(x) });
    const ys = (ps: Prim[]) => {
      const m = new Map<string, number>();
      for (const p of ps)
        for (let i = 0; i < p.pos.length; i += 3)
          m.set(`${p.pos[i].toFixed(4)},${p.pos[i + 2].toFixed(4)}`, p.pos[i + 1]);
      return m;
    };
    const y0 = ys(g),
      y1 = ys(free.ground),
      y2 = ys(held.ground);
    let pulled = 0;
    for (const [k, y] of y2) {
      const x = Number(k.split(",")[0]);
      if (!still(x)) continue;
      expect(y).toBe(y0.get(k));
      if (y1.get(k) !== y0.get(k)) pulled++;
    }
    // (and without the guard those points would have moved)
    expect(pulled).toBeGreaterThan(0);
  });
});

describe("kerb stones", () => {
  const setup = () => {
    const sources = [
      { part: named(townTile, "Town_Tile_plaza"), label: "plaza" as const },
      { part: named(townW, "Town_W_paving_02"), label: "spoke" as const },
      { part: named(townW, "Town_W_paving_03"), label: "spoke" as const },
    ];
    const plan = planPaint({ ground: pasture, sources });
    const paint = paintGround({ ground: pasture, plan, salt: 7 });
    return { plan, paint, G: new HeightField(paint.ground) };
  };

  test("are deterministic, small, clear and set into the ground", () => {
    const { paint, G } = setup();
    // Something standing at the plaza's west corner.
    const blocked = (x: number, z: number) => Math.hypot(x + 0.55, z) < 0.3;
    const name = (i: number) => `Trade_Test_W_town_kerb_${String(i + 1).padStart(2, "0")}`;
    const a = kerbStones(paint, G, blocked, 7, name),
      b = kerbStones(paint, G, blocked, 7, name);
    expect(a.length).toBeGreaterThan(3);
    expect(JSON.stringify(a.map((p) => p.prims.map((q) => [...q.pos])))).toBe(
      JSON.stringify(b.map((p) => p.prims.map((q) => [...q.pos]))),
    );
    for (const s of a) {
      expect(s.prims.reduce((n, q) => n + q.pos.length / 9, 0)).toBe(10);
      let lo = Infinity;
      const xs: number[] = [],
        zs: number[] = [];
      for (const q of s.prims)
        for (let i = 0; i < q.pos.length; i += 3) {
          lo = Math.min(lo, q.pos[i + 1]);
          xs.push(q.pos[i]);
          zs.push(q.pos[i + 2]);
        }
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
        cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      expect(chipDist(cx, cz)).toBeGreaterThan(KERB_CHIP - 0.08);
      expect(blocked(cx, cz)).toBe(false);
      // Its foot is in the ground everywhere under it: nothing hovers.
      for (const q of s.prims)
        for (let i = 0; i < q.pos.length; i += 3)
          if (q.pos[i + 1] < lo + 1e-6)
            expect(q.pos[i + 1]).toBeLessThan(G.y(q.pos[i], q.pos[i + 2], 9));
      // Outward faces: every normal points away from the stone's middle.
      for (const q of s.prims)
        for (let i = 0; i < q.pos.length; i += 9) {
          const fx = (q.pos[i] + q.pos[i + 3] + q.pos[i + 6]) / 3 - cx,
            fz = (q.pos[i + 2] + q.pos[i + 5] + q.pos[i + 8]) / 3 - cz;
          const up = q.nrm[i + 1];
          expect(q.nrm[i] * fx + q.nrm[i + 2] * fz + Math.max(0, up)).toBeGreaterThan(-1e-6);
        }
    }
    // A different tile's salt sets them differently.
    const c = kerbStones(paint, G, blocked, 8, name);
    expect(JSON.stringify(c.map((p) => p.prims.map((q) => [...q.pos])))).not.toBe(
      JSON.stringify(a.map((p) => p.prims.map((q) => [...q.pos]))),
    );
  });

  test("removes paint colour under a prop's foot", () => {
    const { plan, paint } = setup();
    const t = [...plan.labels.keys()][5];
    const c = plan.mesh.tris[t];
    const bare = trisUnder(plan, [[c.cx, c.cz]]);
    expect([...bare]).toEqual([t]);
    const again = paintGround({ ground: pasture, plan, salt: 7, bare });
    expect(again.labels.has(t)).toBe(false);
    // Same heights to the bit, one triangle fewer painted.
    const sum = (r: typeof paint) =>
      r.ground.reduce((s, p) => s + p.pos.reduce((a, v, i) => (i % 3 === 1 ? a + v : a), 0), 0);
    expect(sum(again)).toBeCloseTo(sum(paint), 6);
    const n = (r: typeof paint) => r.painted.plaza + r.painted.spoke + r.painted.yard;
    expect(n(again)).toBe(n(paint) - 1);
  });
});

describe("the stones' pattern", () => {
  test("is a pure function of place and salt", () => {
    expect(hash01(0.3, -1.2, 5)).toBe(hash01(0.3, -1.2, 5));
    expect(hash01(0.3, -1.2, 5)).not.toBe(hash01(0.3, -1.2, 6));
    const xs = Array.from({ length: 2000 }, (_, i) => hash01(i * 0.107, i * 0.061, 3));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});
