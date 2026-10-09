// Fireflies over the island, at night.
//
// They live on OVERLAY_LAYER, so they are drawn in the live pass rather than
// the cached board (see `oceanPass.ts`): they move, and the live pass is
// inside the graded target, so they bloom.
//
// Only the post-processed night look has any. Otherwise the group is empty and
// `animated()` returns false so the ticker is not held open.
//
// Everything is seeded from a fixed PRNG, so two players see the same air and
// screenshots are reproducible. Do not use `Math.random()` here.
import * as THREE from "three";
import { OVERLAY_LAYER } from "./scene";
import { TOP_Y } from "./beachGeometry";
import { hexToWorld } from "./coords";
import { HEX_SIZE } from "./manifest.generated";
import { WATER } from "./coastline";
import type { BoardLook, BoardMotes } from "./boardTheme";
import type { BoardTile } from "@/lib/types";

/** mulberry32. Small, fast, and the same sequence in every browser. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A round, soft dot for a mote. 32px is enough: it is a few pixels on screen
 * and the bloom widens it.
 */
export function moteTexture(): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const dx = (i + 0.5) / n - 0.5;
      const dy = (j + 0.5) / n - 0.5;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      // Quartic falloff: a bright core with a wide faint skirt, like a small
      // out-of-focus light.
      const a = (1 - r) * (1 - r) * (1 - r) * (1 - r);
      const at = (j * n + i) * 4;
      data[at] = 255;
      data[at + 1] = 255;
      data[at + 2] = 255;
      data[at + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/**
 * The slab of air the fireflies live in: from a land hex's top face up to just
 * under the mountain peaks.
 *
 * Both ends come from the art. The floor is `TOP_Y`, so no column starts inside
 * its tile. The peaks stand 1.78 above their slab, so 1.5 of air over a 0.25
 * floor tops out at 1.75 and fireflies stay below the highest point.
 */
const MOTE_FLOOR = TOP_Y;
const MOTE_CEILING = 1.5;

/**
 * How far a firefly may drift sideways from where it was placed. Subtracted
 * (at its diagonal, since x and z sway independently) from the placement
 * radius so the sway cannot carry one out over water.
 */
const MOTE_SWAY = 0.35;

/**
 * The radius around a hex centre that a firefly may be placed in: the inradius
 * of the drawn tile (`HEX_SIZE`, not `LATTICE_SIZE`; the difference is the
 * gutter), less the sway. A disc rather than the full hexagon, which is simpler
 * to sample, and the corners are the parts most likely to border the sea.
 */
const MOTE_RADIUS = (HEX_SIZE * Math.sqrt(3)) / 2 - MOTE_SWAY * Math.SQRT2;

/** Tiles fireflies are placed over: everything that is not water. */
function landTiles(tiles: readonly BoardTile[]): BoardTile[] {
  return tiles.filter((t) => !WATER.has(t.res) && t.res !== "border");
}

export interface Atmosphere {
  /** Add this to the scene. Empty for a style with no weather. */
  group: THREE.Group;
  /** Advance the drift. `elapsedMs` is the ticker's shared animated clock. */
  update(elapsedMs: number): void;
  /** Whether anything in here moves, so the caller knows to hold the loop open. */
  animated(): boolean;
  /** Swap in a look, rebuilding only if the weather actually differs. */
  setLook(look: BoardLook): void;
  dispose(): void;
}

export function createAtmosphere(look: BoardLook, tiles: readonly BoardTile[]): Atmosphere {
  const group = new THREE.Group();
  // Everything on the overlay layer; a mesh that missed it would be cached and
  // freeze.
  group.layers.set(OVERLAY_LAYER);

  let moteTex: THREE.DataTexture | null = null;
  let motes: THREE.Points | null = null;
  let moteBase: Float32Array | null = null;
  let moteSpeed: Float32Array | null = null;
  let current = look;
  const land = landTiles(tiles);

  const clear = () => {
    if (motes) {
      motes.geometry.dispose();
      (motes.material as THREE.Material).dispose();
      group.remove(motes);
      motes = null;
      moteBase = null;
      moteSpeed = null;
    }
  };

  const buildMotes = (spec: BoardMotes) => {
    moteTex ??= moteTexture();
    const random = rng(0x407e5);
    const positions = new Float32Array(spec.count * 3);
    moteBase = new Float32Array(spec.count * 3);
    moteSpeed = new Float32Array(spec.count * 2);
    for (let i = 0; i < spec.count; i++) {
      // Over a hex, not the board's bounding disc. Dealt round-robin by tile so
      // every land hex gets within one of the same share and none is over the sea.
      const tile = land[i % land.length];
      const [cx, , cz] = hexToWorld(tile.hex);
      // sqrt spreads them evenly instead of clustering them at the centre.
      const angle = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * MOTE_RADIUS;
      positions[i * 3] = cx + Math.cos(angle) * r;
      positions[i * 3 + 1] = MOTE_FLOOR + random() * MOTE_CEILING;
      positions[i * 3 + 2] = cz + Math.sin(angle) * r;
      moteBase.set(positions.subarray(i * 3, i * 3 + 3), i * 3);
      // Each mote has its own rise rate and sway phase, or the field moves as
      // one sheet.
      moteSpeed[i * 2] = 0.4 + random() * 1.2;
      moteSpeed[i * 2 + 1] = random() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      map: moteTex,
      color: new THREE.Color().setRGB(...spec.color, THREE.LinearSRGBColorSpace),
      size: spec.size,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      // Additive, so a mote over a dark sea adds light, and the sum crosses the
      // bloom threshold where a normal blend would not.
      blending: THREE.AdditiveBlending,
      // Not fogged: fog mixes toward the fog colour, which makes distant
      // additive motes brighter. They are culled by distance in `update`.
      fog: false,
    });
    const points = new THREE.Points(geometry, material);
    points.layers.set(OVERLAY_LAYER);
    points.renderOrder = 20;
    motes = points;
    group.add(points);
  };

  const build = () => {
    // No land, no fireflies; otherwise the modulo by zero yields NaN positions.
    if (current.motes && land.length > 0) buildMotes(current.motes);
  };

  build();

  return {
    group,
    animated() {
      return motes !== null;
    },
    update(elapsedMs: number) {
      const t = elapsedMs / 1000;
      if (motes && moteBase && moteSpeed && current.motes) {
        const spec = current.motes;
        const attr = motes.geometry.getAttribute("position") as THREE.BufferAttribute;
        const array = attr.array as Float32Array;
        for (let i = 0; i < moteSpeed.length / 2; i++) {
          const rise = moteSpeed[i * 2];
          const phase = moteSpeed[i * 2 + 1];
          const y0 = moteBase[i * 3 + 1];
          // Wrapped rather than reset, so a mote at the ceiling reappears at the
          // floor and the field does not empty.
          const climbed = (y0 - MOTE_FLOOR + t * spec.drift * rise) % MOTE_CEILING;
          array[i * 3 + 1] = MOTE_FLOOR + climbed;
          // Slow lateral sway on the mote's own phase, bounded by the amount the
          // placement radius was shortened.
          const sway = Math.sin(t * spec.drift * 0.9 + phase) * MOTE_SWAY;
          array[i * 3] = moteBase[i * 3] + sway;
          array[i * 3 + 2] =
            moteBase[i * 3 + 2] + Math.cos(t * spec.drift * 0.7 + phase) * MOTE_SWAY;
        }
        attr.needsUpdate = true;
      }
    },
    setLook(next: BoardLook) {
      // Compare spec identity: looks are module constants, so looks sharing a
      // motes spec share the object and need no rebuild.
      const same = next.motes === current.motes;
      current = next;
      if (same) return;
      clear();
      build();
    },
    dispose() {
      clear();
      moteTex?.dispose();
      moteTex = null;
    },
  };
}
