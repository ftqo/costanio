// The composer's data model: a tile as plain arrays, in the file frame.
//
// Build-time only: nothing in the app imports this directory. It is the core
// of `scripts/compose-tiles.ts`, which writes ordinary `.glb` tiles from
// hand-authored components (see art/README.md, "Recipe-built tiles"). It lives
// under `src/` so vitest can test it, and imports only its own files so Node
// can run it directly (type stripping, no bundler).
//
// The file frame is the glTF's: y up, metres, the chip socket at
// (0, 0.26, -1.5) on every land tile. The board then turns the tile by
// `TILE_ROTATION_Y`, so a world direction d is the file direction -d (see
// `recipe.ts`).

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/**
 * One material's triangles, non-indexed: `pos` and `nrm` hold three vertices
 * per triangle, xyz each, already baked through every node transform.
 */
export interface Prim {
  material: string;
  pos: Float32Array;
  nrm: Float32Array;
}

/** A named mesh: what one glTF node carried. */
export interface Part {
  name: string;
  prims: Prim[];
  /** The node's own origin, baked into the file frame: a rigid part's seat. */
  origin?: Vec3;
}

/** The chip socket: an empty the manifest reads the mount from. */
export interface Socket {
  name: string;
  translation: Vec3;
  rotation: Quat;
}

/** The authored look of one material, copied through untouched. */
export interface MaterialDef {
  name: string;
  baseColor: [number, number, number, number];
  roughness: number;
  metallic: number;
  doubleSided: boolean;
}

/**
 * A whole tile. `root` is the hex node's name (`Hex_Hills`), and the slab is
 * the part named after it; every other part is a child of it in the file.
 */
export interface TileModel {
  root: string;
  parts: Part[];
  socket: Socket | null;
  materials: Map<string, MaterialDef>;
}

/** `Hex_Hills` -> `Hills`: the prefix every other part of the tile carries. */
export function terrainOf(model: TileModel): string {
  return model.root.replace(/^Hex_/, "");
}

export type Role = "slab" | "ground" | "rim" | "prop";

/**
 * What a part is, read from its name as the exporter writes it: the slab is
 * the hex's own mesh, the ground sheet is `<Terrain>_ground`, the border is
 * `<Terrain>_rim`, and everything else stands on the ground.
 */
export function roleOf(model: TileModel, part: Part): Role {
  const t = terrainOf(model);
  if (part.name === model.root || part.name === "") return "slab";
  if (part.name === `${t}_ground`) return "ground";
  if (part.name === `${t}_rim`) return "rim";
  return "prop";
}

export function partsWithRole(model: TileModel, role: Role): Part[] {
  return model.parts.filter((p) => roleOf(model, p) === role);
}

export function clonePrim(p: Prim): Prim {
  return { material: p.material, pos: new Float32Array(p.pos), nrm: new Float32Array(p.nrm) };
}

export function clonePart(p: Part, name = p.name): Part {
  return { name, prims: p.prims.map(clonePrim), origin: p.origin ? [...p.origin] : undefined };
}

/** Axis-aligned bounds of some prims, as [minX, minY, minZ, maxX, maxY, maxZ]. */
export type Box = [number, number, number, number, number, number];

export function emptyBox(): Box {
  return [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
}

export function boxOfPrims(prims: Prim[], into: Box = emptyBox()): Box {
  for (const p of prims) {
    const a = p.pos;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i] < into[0]) into[0] = a[i];
      if (a[i + 1] < into[1]) into[1] = a[i + 1];
      if (a[i + 2] < into[2]) into[2] = a[i + 2];
      if (a[i] > into[3]) into[3] = a[i];
      if (a[i + 1] > into[4]) into[4] = a[i + 1];
      if (a[i + 2] > into[5]) into[5] = a[i + 2];
    }
  }
  return into;
}

/** Do two boxes overlap in plan (xz), after growing `a` by `pad`? */
export function boxesOverlapXZ(a: Box, b: Box, pad = 0): boolean {
  return a[0] - pad <= b[3] && a[3] + pad >= b[0] && a[2] - pad <= b[5] && a[5] + pad >= b[2];
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Face normal of triangle `t` (0-based) in a non-indexed position array. */
export function faceNormal(pos: Float32Array, t: number): Vec3 {
  const i = t * 9;
  const ux = pos[i + 3] - pos[i],
    uy = pos[i + 4] - pos[i + 1],
    uz = pos[i + 5] - pos[i + 2];
  const vx = pos[i + 6] - pos[i],
    vy = pos[i + 7] - pos[i + 1],
    vz = pos[i + 8] - pos[i + 2];
  const nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/**
 * Rotate prims about the y axis by `deg`, in place, three.js's convention
 * (`Matrix4.makeRotationY`): x' = x cos + z sin, z' = -x sin + z cos.
 */
export function rotatePrimsY(prims: Prim[], deg: number, cx = 0, cz = 0): void {
  if (!deg) return;
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  for (const p of prims) {
    for (const arr of [p.pos, p.nrm]) {
      const pivot = arr === p.pos;
      for (let i = 0; i < arr.length; i += 3) {
        const x = arr[i] - (pivot ? cx : 0),
          z = arr[i + 2] - (pivot ? cz : 0);
        arr[i] = x * c + z * s + (pivot ? cx : 0);
        arr[i + 2] = -x * s + z * c + (pivot ? cz : 0);
      }
    }
  }
}

/**
 * Reflect prims through the plane x = 0, in place. A reflection turns every
 * triangle inside out, so the winding is reversed too (the second and third
 * vertex swap); otherwise back-face culling hides the mirrored half.
 */
export function mirrorPrimsX(prims: Prim[]): void {
  for (const p of prims) {
    for (const arr of [p.pos, p.nrm]) {
      for (let i = 0; i < arr.length; i += 3) arr[i] = -arr[i];
      for (let i = 0; i < arr.length; i += 9) {
        for (let k = 0; k < 3; k++) {
          const t = arr[i + 3 + k];
          arr[i + 3 + k] = arr[i + 6 + k];
          arr[i + 6 + k] = t;
        }
      }
    }
  }
}

export function translatePrims(prims: Prim[], dx: number, dy: number, dz: number): void {
  for (const p of prims) {
    for (let i = 0; i < p.pos.length; i += 3) {
      p.pos[i] += dx;
      p.pos[i + 1] += dy;
      p.pos[i + 2] += dz;
    }
  }
}
