// The shipped art has to come out of the export already square to the board.
//
// Buildings were staged at arbitrary yaws on the showcase board.
// `anchors.AUTHORED_TURN` cancels that at export and PIECE_FACING is zero; this
// measures the shipped glb and holds both.
//
// A building faces the way its door wall faces: the outward normal of the
// `Seat_Detail` slab (the door panel, from edits/0023_open_the_doorways.py).
// Not the bearing of the doorway from the centroid; that differs whenever the
// door is off-centre or the centroid is off the footprint centre (on today's
// square art it reads 110 degrees for the settlement and 106 for the city,
// while both walls face 90).
//
// The metropolises are the reference: modelled square on a staging grid, so
// 90 degrees is a real front.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PIECE_FACING, PIECE_PREFIX } from "./pieceArt";
import { PLAIN_MODELS } from "@/testGlbFixtures";

// The plain copies, not the shipped ones: what ships is meshopt-compressed
// and this file parses the container. See src/testGlbFixtures.ts.
const MODELS = PLAIN_MODELS;

type V2 = [number, number];

/**
 * Every vertex of the nodes named `prefix*` whose material passes `keep`, in
 * the XZ plane, with the node's own transform applied.
 *
 * The transform matters: the export writes its squaring turn as a node rotation
 * (see `recenter` in export_assets.py), so translation alone would measure the
 * raw staged geometry.
 */
function footprint(file: string, prefix: string, keep: (material: string) => boolean): V2[] {
  const buf = readFileSync(join(MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const bin = 20 + jsonLen + 8;

  const out: V2[] = [];
  for (const node of gltf.nodes) {
    if (typeof node.name !== "string" || !node.name.startsWith(prefix)) continue;
    if (node.mesh === undefined) continue;
    const [tx, , tz] = node.translation ?? [0, 0, 0];
    const [sx, , sz] = node.scale ?? [1, 1, 1];
    // Yaw only: nothing in these files is tipped, and a yaw quaternion is
    // (0, sin(a/2), 0, cos(a/2)), so the angle reads straight off it.
    const q = node.rotation ?? [0, 0, 0, 1];
    expect(Math.abs(q[0]) + Math.abs(q[2]), `${node.name} is tipped, not just turned`).toBeLessThan(
      1e-6,
    );
    const a = 2 * Math.atan2(q[1], q[3]);
    const cos = Math.cos(a);
    const sin = Math.sin(a);

    for (const prim of gltf.meshes[node.mesh].primitives) {
      if (!keep(gltf.materials[prim.material].name as string)) continue;
      const acc = gltf.accessors[prim.attributes.POSITION];
      const view = gltf.bufferViews[acc.bufferView];
      const stride = view.byteStride ?? 12;
      const base = bin + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      for (let i = 0; i < acc.count; i++) {
        const o = base + i * stride;
        const x = buf.readFloatLE(o) * sx;
        const z = buf.readFloatLE(o + 8) * sz;
        // Three's Y rotation, matching how the loader will place this node.
        out.push([x * cos + z * sin + tx, -x * sin + z * cos + tz]);
      }
    }
  }
  expect(out.length, `${prefix}: no geometry found in ${file}`).toBeGreaterThan(0);
  return out;
}

/** Centre, principal axes and elongation of a footprint, by second moments. */
function axes(pts: V2[]) {
  let cx = 0;
  let cz = 0;
  for (const [x, z] of pts) {
    cx += x / pts.length;
    cz += z / pts.length;
  }
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (const [x, z] of pts) {
    sxx += (x - cx) ** 2;
    sxz += (x - cx) * (z - cz);
    szz += (z - cz) ** 2;
  }
  const trace = sxx + szz;
  const gap = Math.sqrt(Math.max(0, (trace / 2) ** 2 - (sxx * szz - sxz * sxz)));
  const major = trace / 2 + gap;
  const minor = trace / 2 - gap;
  // Eigenvector for `major`. The degenerate branch is a shape with no
  // preferred direction at all, which every caller below screens out.
  const v: V2 = Math.abs(sxz) > 1e-12 ? [major - szz, sxz] : sxx >= szz ? [1, 0] : [0, 1];
  const len = Math.hypot(v[0], v[1]);
  return {
    centre: [cx, cz] as V2,
    long: [v[0] / len, v[1] / len] as V2,
    across: [-v[1] / len, v[0] / len] as V2,
    elongation: Math.sqrt(major / Math.max(minor, 1e-12)),
  };
}

const deg = (v: V2) => ((Math.atan2(v[1], v[0]) * 180) / Math.PI + 360) % 360;

/** Signed difference between two bearings, folded into (-180, 180]. */
const apart = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/** How far a bearing is from the nearest board axis, in degrees. */
const offAxis = (a: number) => Math.min(...[0, 90, 180, 270, 360].map((k) => Math.abs(a - k)));

const NOT_DOOR = (m: string) => m !== "Seat_Detail";
const DOOR = (m: string) => m === "Seat_Detail";

/**
 * The bearing the doorway faces: the thin axis of the door slab, signed to
 * point out of the building.
 *
 * A door panel is a thin plate in a wall, so its short axis in plan is the
 * wall's normal. The elongation guard fails a nearly square slab rather than
 * measuring a random direction.
 */
function doorFacing(file: string, prefix: string): number {
  const body = axes(footprint(file, prefix, NOT_DOOR));
  const door = axes(footprint(file, prefix, DOOR));
  expect(
    door.elongation,
    `${prefix}: the Seat_Detail slab is too square in plan to read a normal off`,
  ).toBeGreaterThan(3);
  const outward: V2 = [door.centre[0] - body.centre[0], door.centre[1] - body.centre[1]];
  const n = door.across;
  const away: V2 = n[0] * outward[0] + n[1] * outward[1] < 0 ? [-n[0], -n[1]] : n;
  return deg(away);
}

/**
 * Where the board's front is: +z, toward the viewer. Where the chips put their
 * pip row, and where all three metropolis gates and the wall's gatehouse point.
 */
const FRONT = 90;

/** Below this the disagreement is invisible at the distance a board is seen. */
const TOLERANCE = 4;

test("the chips define a single front", () => {
  // If the chips disagreed, FRONT would be meaningless. Measured off the parts:
  // a chip's numeral and pip row sit on opposite sides of centre.
  const z = (suffix: (n: string) => boolean) => {
    const pts = footprintOfNodes("chips.glb", "Chip_06_1", suffix);
    return pts.reduce((s, p) => s + p[1] / pts.length, 0);
  };
  // The numeral reads upright from +z with the pip row below it (further
  // toward +z): the front every building is squared to, as TILE_ROTATION_Y.
  expect(
    z((n) => n.endsWith("_numeral")),
    "numeral sits behind the chip centre",
  ).toBeLessThan(z((n) => n.endsWith("_body")));
  expect(
    z((n) => n.includes("_pip_")),
    "pip row sits in front of the numeral",
  ).toBeGreaterThan(z((n) => n.endsWith("_numeral")));
});

/** As `footprint`, but selecting nodes by name rather than primitives by material. */
function footprintOfNodes(file: string, prefix: string, keepNode: (n: string) => boolean): V2[] {
  const buf = readFileSync(join(MODELS, file));
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const bin = 20 + jsonLen + 8;
  const out: V2[] = [];
  for (const node of gltf.nodes) {
    if (typeof node.name !== "string" || !node.name.startsWith(prefix)) continue;
    if (!keepNode(node.name)) continue;
    const [px, , pz] = node.translation ?? [0, 0, 0];
    const [psx, , psz] = node.scale ?? [1, 1, 1];
    // The node's own mesh, or the unnamed wrapper the compression pass moved it
    // to. A node with a compensating scale can't also parent other nodes, so
    // `Chip_06_1_body` keeps the name and hands its mesh to a child. three.js
    // falls back to the mesh's name for an unnamed node.
    const carriers: [number, number, number, number, number][] = [];
    if (node.mesh !== undefined) carriers.push([px, pz, psx, psz, node.mesh]);
    for (const index of node.children ?? []) {
      const child = gltf.nodes[index];
      if (child.name !== undefined || child.mesh === undefined) continue;
      const [cx, , cz] = child.translation ?? [0, 0, 0];
      const [csx, , csz] = child.scale ?? [1, 1, 1];
      carriers.push([px + psx * cx, pz + psz * cz, psx * csx, psz * csz, child.mesh]);
    }
    for (const [tx, tz, sx, sz, mesh] of carriers) {
      for (const prim of gltf.meshes[mesh].primitives) {
        const acc = gltf.accessors[prim.attributes.POSITION];
        const view = gltf.bufferViews[acc.bufferView];
        const stride = view.byteStride ?? 12;
        const base = bin + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
        for (let i = 0; i < acc.count; i++) {
          const o = base + i * stride;
          out.push([buf.readFloatLE(o) * sx + tx, buf.readFloatLE(o + 8) * sz + tz]);
        }
      }
    }
  }
  expect(out.length, `${prefix}: nothing matched in ${file}`).toBeGreaterThan(0);
  return out;
}

test.each([
  // The two that were staged off-square, at the facing the renderer draws.
  ["settlement", "pieces.glb", PIECE_PREFIX.settlement, PIECE_FACING.settlement],
  ["city", "pieces.glb", PIECE_PREFIX.city, PIECE_FACING.city],
  // The control: always square.
  ["metropolis", "metros.glb", "Metro_trade", 0],
] as const)("the %s doorway faces the board's front", (_kind, file, prefix, facing) => {
  const authored = doorFacing(file, prefix);
  // A Y rotation of `a` sends a point at bearing t to t - a.
  const drawn = (((authored - (facing * 180) / Math.PI) % 360) + 360) % 360;
  expect(
    apart(drawn, FRONT),
    `${prefix}: doorway at ${authored.toFixed(1)}deg exported, ` +
      `${drawn.toFixed(1)}deg drawn, want ${FRONT}deg (anchors.py AUTHORED_TURN)`,
  ).toBeLessThan(TOLERANCE);
});

test.each([
  ["settlement", PIECE_PREFIX.settlement, PIECE_FACING.settlement],
  ["city", PIECE_PREFIX.city, PIECE_FACING.city],
] as const)("the %s footprint is square to the board, not just its door", (_k, prefix, facing) => {
  // The doorway could be right while the body is not, if the slab were moved
  // alone. Buildings are boxy enough to have a real long axis; the
  // metropolises are near round in plan, so they're held by their doorway only.
  const body = axes(footprint("pieces.glb", prefix, NOT_DOOR));
  expect(body.elongation, `${prefix}: footprint has no long axis to check`).toBeGreaterThan(1.15);
  const drawn = (((deg(body.long) - (facing * 180) / Math.PI) % 360) + 360) % 360;
  expect(
    offAxis(drawn),
    `${prefix}: footprint lies along ${drawn.toFixed(1)}deg, which is not a board axis`,
  ).toBeLessThan(TOLERANCE);
});

test("a road comes out lying along +x, which is all edgeRotationY can turn", () => {
  // Not an assertion that the constant is zero, which holds for a road at any
  // angle: the bar itself has to lie on the axis.
  const bar = axes(footprint("pieces.glb", PIECE_PREFIX.road, NOT_DOOR));
  expect(bar.elongation, "the road bar should be long and thin").toBeGreaterThan(4);
  expect(offAxis(deg(bar.long)), "road bar is not on the x axis").toBeLessThan(TOLERANCE);
  expect(PIECE_FACING.road).toBe(0);
});

test("no piece carries a runtime facing correction", () => {
  // The export squares the art (anchors.AUTHORED_TURN), so every entry is zero
  // and the tests above measure the art. A non-zero value means a staging
  // mistake was patched at runtime instead of at export.
  expect(Object.values(PIECE_FACING)).toEqual([0, 0, 0]);
});
