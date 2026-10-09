// Synthetic tiles for the composer's tests: a flat ground sheet, a slab, a
// rim, box props, and a town layout small enough to reason about by hand.
// Test-only; nothing ships it.
import { composeTrade, type TradeInput } from "./trade";
import type { Part, Prim, TileModel } from "./model";

// ------------------------------------------------------------- fixtures --

/** A flat grid of triangles over a square, at height y, CCW seen from above (+y normal). */
export function sheet(material: string, y: number, half = 2.7, n = 36, x0 = 0, z0 = 0): Prim {
  const pos: number[] = [];
  const step = (2 * half) / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const ax = x0 - half + i * step,
        az = z0 - half + j * step;
      const bx = ax + step,
        bz = az + step;
      // (a,a) (a,b) (b,a) and (b,a) (a,b) (b,b): counter-clockwise from +y.
      pos.push(ax, y, az, ax, y, bz, bx, y, az, bx, y, az, ax, y, bz, bx, y, bz);
    }
  }
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  return { material, pos: new Float32Array(pos), nrm };
}

/** A closed axis-aligned box, outward normals, standing on y0. */
export function box(
  material: string,
  cx: number,
  cz: number,
  w: number,
  h: number,
  y0: number,
): Prim {
  const x0 = cx - w / 2,
    x1 = cx + w / 2,
    z0 = cz - w / 2,
    z1 = cz + w / 2,
    y1 = y0 + h;
  const quads: [number[], number[], number[], number[], number[]][] = [
    [
      [x0, y1, z0],
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
      [0, 1, 0],
    ],
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
      [0, -1, 0],
    ],
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
      [0, 0, 1],
    ],
    [
      [x1, y0, z0],
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
      [0, 0, -1],
    ],
    [
      [x1, y0, z1],
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
      [1, 0, 0],
    ],
    [
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
      [-1, 0, 0],
    ],
  ];
  const pos: number[] = [],
    nrm: number[] = [];
  for (const [a, b, c, d, n] of quads) {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let k = 0; k < 6; k++) nrm.push(...n);
  }
  return { material, pos: new Float32Array(pos), nrm: new Float32Array(nrm) };
}

export const MATS = [
  "Mat_T_ground",
  "Mat_T_slab",
  "Mat_T_rim",
  "Mat_T_prop",
  "Mat_Town",
  "Mat_Pave",
  "Mat_Bed",
  "Mat_Trade_yard",
  "Mat_T_yard",
  "Mat_Swamp_pool",
  "Mat_Swamp_mud",
  "Mat_Swamp_lily",
  // the paint's stones (paint.ts)
  "Mat_Castle_stone",
  "Mat_Castle_stone_lt",
];
export function materials() {
  return new Map(
    MATS.map((m) => [
      m,
      {
        name: m,
        baseColor: [1, 1, 1, 1] as [number, number, number, number],
        roughness: 1,
        metallic: 0,
        doubleSided: false,
      },
    ]),
  );
}

export function baseTile(props: Part[] = [], groundY = 0.3): TileModel {
  return {
    root: "Hex_Test",
    parts: [
      { name: "Hex_Test", prims: [sheet("Mat_T_slab", 0.22, 2.9, 2)] },
      { name: "Test_ground", prims: [sheet("Mat_T_ground", groundY)] },
      { name: "Test_rim", prims: [sheet("Mat_T_rim", 0.23, 2.9, 4)] },
      ...props,
    ],
    socket: { name: "Token_Test", translation: [0, 0.26, -1.5], rotation: [0, 0, 0, 1] },
    materials: materials(),
  };
}

/**
 * A town layout authored facing W in the FILE frame's +x half: a bed at 0.25
 * over x in [0.4, 2.2], one house on it, and a strip of paving.
 */
export function townLayout(extra: Part[] = []): TileModel {
  return {
    root: "Town_W",
    parts: [
      { name: "Town_W_bed", prims: [sheet("Mat_Bed", 0.25, 0.9, 12, 1.3, 0)] },
      {
        name: "Town_W_house_01",
        prims: [box("Mat_Town", 1.3, 0, 0.4, 0.4, 0.25)],
        origin: [1.3, 0.25, 0],
      },
      { name: "Town_W_paving_01", prims: [sheet("Mat_Pave", 0.254, 0.1, 4, 1.3, 0.6)] },
      ...extra,
    ],
    socket: null,
    materials: materials(),
  };
}

export const I = { rotate: 0, mirror: false };
/**
 * The base ground is flat at 0.30 and a pad flattens to the MEDIAN of the
 * ground under it, so without an offset the town would change nothing; -0.05
 * sets the pads at 0.25, which is what the tests below measure against.
 */
export function trade(over: Partial<TradeInput> = {}): ReturnType<typeof composeTrade> {
  return composeTrade({
    base: baseTile(),
    layout: townLayout(),
    placement: I,
    terrain: "Trade_Test_W",
    dir: "W",
    offset: -0.05,
    ...over,
  });
}
export const part = (m: TileModel, name: string) => m.parts.find((p) => p.name === name);
export const ys = (p: Part | undefined) =>
  p ? p.prims.flatMap((q) => [...q.pos].filter((_, i) => i % 3 === 1)) : [];

/** The base tile with its ground sheet re-heighted by y = f(x, z). */
export function shaped(base: TileModel, f: (x: number, z: number) => number): TileModel {
  const g = base.parts.find((p) => /_ground$/.test(p.name))!;
  for (const p of g.prims)
    for (let i = 0; i < p.pos.length; i += 3) p.pos[i + 1] = f(p.pos[i], p.pos[i + 2]);
  return base;
}

/** A closed axis-aligned bar over [x0, x1] x [z0, z1], from y0 up by h. */
export function bar(
  material: string,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  h: number,
  y0: number,
): Prim {
  const b = box(material, 0, 0, 1, h, y0);
  for (let i = 0; i < b.pos.length; i += 3) {
    b.pos[i] = b.pos[i] < 0 ? x0 : x1;
    b.pos[i + 2] = b.pos[i + 2] < 0 ? z0 : z1;
  }
  return b;
}

/**
 * A swamp pool as the hand-made tile builds one: a flat water sheet at `wl`
 * over a mud bowl 5 cm deep that touches it, so the two are one loose part.
 */
export function pool(name: string, cx: number, cz: number, wl: number, half = 0.3): Part {
  return {
    name,
    prims: [
      sheet("Mat_Swamp_pool", wl, half + 0.02, 4, cx, cz),
      bar("Mat_Swamp_mud", cx - half, cx + half, cz - half, cz + half, 0.05, wl - 0.05),
    ],
  };
}
