// The ghost markers that show where the player may act.
//
// One marker per `planPickTargets` entry, so what is drawn and what is
// clickable cannot disagree. Yellow like the 2D board's pips, and drawn with
// depth testing off so a marker on a settlement or behind a hill still shows.
import * as THREE from "three";
import { LATTICE_SIZE } from "./coords";
import type { PickTarget } from "./targets";
import type { Placement } from "./instancing";

/**
 * `--color-yellow`, the 2D board's pip fill. Kept in step by hand. Exported
 * because the hover ghost must be the same colour.
 */
export const MARKER_COLOR = 0xffd23f;
/**
 * `--color-ink`, the 2D pip's stroke. Vertices and edge midpoints sit on sand,
 * where yellow alone barely shows; the dark ring separates the pip.
 */
const OUTLINE_COLOR = 0x1c2b4a;

/** How far past the fill the outline reaches, as a fraction of the radius. */
const OUTLINE_SCALE = 1.3;
/** The spot under the cursor. Brighter and near-opaque rather than a new hue. */
const HOVER_COLOR = 0xfff3c4;

/**
 * Resting opacity per kind: none. A legal spot shows only under the pointer.
 *
 * This works because picking snaps to the nearest legal target, so sweeping
 * the pointer reveals each candidate. The `resting` override on the materials
 * below covers modes the game forces on the player (setup, a seven, a knight
 * owed a spot) and coarse pointers, where there is no hover to sweep with.
 */
const MARKER_OPACITY = { vertex: 0, edge: 0, hex: 0 } as const;

/**
 * Marker radii, in world units. Inside the snap radii (see picking.ts) and
 * clear of neighbouring markers.
 */
export const MARKER_RADIUS = {
  vertex: LATTICE_SIZE * 0.16,
  edge: LATTICE_SIZE * 0.13,
  hex: LATTICE_SIZE * 0.85,
} as const;

export type MarkerKind = keyof typeof MARKER_RADIUS;

/**
 * A flat disc lying in the board plane. Hex markers get six sides and a
 * 30-degree twist to match the pointy-top lattice of `cornerToWorld`.
 */
export function markerGeometry(kind: MarkerKind): THREE.BufferGeometry {
  const r = MARKER_RADIUS[kind];
  const g =
    kind === "hex" ? new THREE.CircleGeometry(r, 6, Math.PI / 6) : new THREE.CircleGeometry(r, 24);
  // CircleGeometry is authored in XY; the board is XZ.
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * Unlit and always-on-top.
 *
 * `MeshBasicMaterial` so shadow can't make a marker look like a different
 * state. `depthTest: false` plus a high render order keeps it visible through
 * pieces and terrain.
 *
 * `resting` overrides the per-kind resting alpha. The hovered alpha moves with
 * it, staying one step above rest.
 */
export function markerMaterial(
  kind: MarkerKind,
  hovered = false,
  resting?: number,
): THREE.MeshBasicMaterial {
  const rest = resting ?? MARKER_OPACITY[kind];
  return new THREE.MeshBasicMaterial({
    color: hovered ? HOVER_COLOR : MARKER_COLOR,
    transparent: true,
    opacity: hovered ? Math.min(0.95, rest + 0.4) : rest,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** A ring just outside the fill, in the same plane. */
export function markerOutlineGeometry(kind: MarkerKind): THREE.BufferGeometry {
  const r = MARKER_RADIUS[kind];
  const g =
    kind === "hex"
      ? // The hex's outline goes inside its radius, so it doesn't lap onto its
        // neighbour.
        new THREE.RingGeometry(r * 0.9, r, 6, 1, Math.PI / 6)
      : new THREE.RingGeometry(r, r * OUTLINE_SCALE, 24);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * The ring, on the same hover and `resting` terms as the fill: fill and ring
 * appear together or not at all. The ring's alpha is higher than the fill's so
 * the pip still separates from the sand (see OUTLINE_COLOR).
 */
export function markerOutlineMaterial(hovered = false, resting?: number): THREE.MeshBasicMaterial {
  const rest = resting === undefined ? 0 : Math.min(0.8, resting + 0.25);
  return new THREE.MeshBasicMaterial({
    color: OUTLINE_COLOR,
    transparent: true,
    opacity: hovered ? 0.8 : rest,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Draw order for markers, above everything the board draws. Outline at this
 * order, fill one above so a neighbour's ring never paints over it, hover
 * above both.
 */
export const MARKER_RENDER_ORDER = 10;

/** `--color-red`, the fault ring below. Kept in step with index.css by hand. */
export const FAULT_COLOR = 0xff4f64;

/**
 * A fault ring, for the map builder's preview: it marks hexes a geometry check
 * failed on. It is driven by the caller's hex list rather than `view.legal`,
 * nothing under it is clickable, and it is red because gold means "you can act
 * here". Same shape as the hex marker's outline, drawn opaque.
 */
export function faultRingGeometry(): THREE.BufferGeometry {
  const r = MARKER_RADIUS.hex;
  // Thicker than the marker's ring (0.9 to 1.0 of the radius), since it is
  // read from wherever the camera is.
  const g = new THREE.RingGeometry(r * 0.82, r, 6, 1, Math.PI / 6);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function faultRingMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: FAULT_COLOR,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Marker placements grouped by the geometry they need.
 *
 * One InstancedMesh per kind, so a board offering fifty settlement spots and
 * six robber hexes costs two draw calls.
 */
export function markerPlacements(targets: readonly PickTarget[]): Map<MarkerKind, Placement[]> {
  const out = new Map<MarkerKind, Placement[]>();
  for (const t of targets) {
    const list = out.get(t.kind) ?? [];
    list.push({ position: t.pos });
    out.set(t.kind, list);
  }
  return out;
}
