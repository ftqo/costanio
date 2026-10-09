import { test, expect } from "vitest";
import { LATTICE_SIZE } from "./coords";
import {
  boardExtent,
  framingDistance,
  frameTarget,
  halfSpans,
  oceanFog,
  oceanRadius,
  __resetOceanRadiusCache,
  CAMERA_FOV_DEG,
  MIN_CAMERA_ELEVATION_DEG,
  PAN_MARGIN,
  OCEAN_NEAR_BAND,
  type BoardExtent,
} from "./scene";
import type { BoardTile } from "@/lib/types";

// The sweep as it was before poses were pruned, kept as the oracle: every ray
// of every pose. `oceanRadius` must return exactly this.
const OCEAN_MIN_RINGS = 6;
const OCEAN_REACH = 1.15;

function referenceOceanRadius(extent: BoardExtent, aspect: number): number {
  const back = framingDistance(aspect, extent);
  const centre = frameTarget(extent);
  const half = halfSpans(extent);
  const halfV = Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  const halfH = halfV * aspect;
  let need = 0;
  for (let s = 0; s < 5; s++) {
    const standoff = back * Math.pow(0.5, s);
    const fogFar = oceanFog(extent, standoff).far;
    for (const px of [-1, 0, 1]) {
      for (const pz of [-1, 0, 1]) {
        const pivotX = centre.x + px * half.x * (1 + PAN_MARGIN);
        const pivotZ = centre.z + pz * half.z * (1 + PAN_MARGIN);
        for (let deg = MIN_CAMERA_ELEVATION_DEG; deg <= 90; deg += 2.5) {
          const e = (deg * Math.PI) / 180;
          for (let a = 0; a < 8; a++) {
            const az = (a * 2 * Math.PI) / 8;
            const ux = Math.sin(az) * Math.cos(e);
            const uy = Math.sin(e);
            const uz = Math.cos(az) * Math.cos(e);
            const camX = pivotX + ux * standoff;
            const camY = uy * standoff;
            const camZ = pivotZ + uz * standoff;
            const fx = -ux;
            const fy = -uy;
            const fz = -uz;
            let rx = -fz;
            let rz = fx;
            const rl = Math.hypot(rx, rz);
            if (rl < 1e-9) {
              rx = 1;
              rz = 0;
            } else {
              rx /= rl;
              rz /= rl;
            }
            const cux = -rz * fy;
            const cuy = rz * fx - rx * fz;
            const cuz = rx * fy;
            for (let i = 0; i <= 4; i++) {
              const x = -1 + i / 2;
              for (let j = 0; j <= 12; j++) {
                const y = -1 + j / 6;
                let dx = fx + x * halfH * rx + y * halfV * cux;
                let dy = fy + y * halfV * cuy;
                let dz = fz + x * halfH * rz + y * halfV * cuz;
                const dl = Math.hypot(dx, dy, dz);
                dx /= dl;
                dy /= dl;
                dz /= dl;
                if (dy >= -1e-6) continue;
                const t = -camY / dy;
                if (!(t > 0) || t >= fogFar) continue;
                need = Math.max(need, Math.hypot(camX + dx * t, camZ + dz * t));
              }
            }
          }
        }
      }
    }
  }
  return Math.max(
    LATTICE_SIZE * OCEAN_MIN_RINGS,
    extent.radius + OCEAN_NEAR_BAND + LATTICE_SIZE,
    need * OCEAN_REACH,
  );
}

/** A hex disc of `rings` about (q0, r0), or a lopsided strip when `strip`. */
function board(rings: number, q0: number, r0: number, strip = false): BoardTile[] {
  const out: BoardTile[] = [];
  for (let q = -rings; q <= rings; q++) {
    for (let r = -rings; r <= rings; r++) {
      if (Math.abs(q + r) > rings) continue;
      if (strip && r > 0) continue;
      out.push({ hex: { q: q + q0, r: r + r0 }, res: "sea", num: 0 });
    }
  }
  return out;
}

const BOARDS: BoardExtent[] = [
  boardExtent([]),
  boardExtent(board(0, 0, 0)),
  boardExtent(board(2, 0, 0)),
  boardExtent(board(3, 0, 0)),
  boardExtent(board(4, 1, -1)),
  boardExtent(board(5, 0, 0, true)),
  boardExtent(board(6, -2, 3)),
  boardExtent(board(8, 0, 0, true)),
];
const ASPECTS = [0.3, 0.43, 0.75, 1, 1.33, 1.6, 16 / 9, 2.4, 3.56, 4];

test("the pruned ocean sweep returns exactly what the full sweep does", () => {
  __resetOceanRadiusCache();
  for (const e of BOARDS) {
    for (const a of ASPECTS) {
      expect(oceanRadius(e, a), `${JSON.stringify(e)} @ ${a}`).toBe(referenceOceanRadius(e, a));
    }
  }
});
