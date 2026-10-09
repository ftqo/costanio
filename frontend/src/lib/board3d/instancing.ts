// Asset + placements -> one InstancedMesh per material.
//
// Instancing collapses each source mesh to a single draw however many times it
// appears; a 10-player board's ocean is several hundred positions of one tile.
// Parts of an asset that are placed together and share a material are merged
// further into one geometry and one call (see `loader.ts`'s `byMaterial`), so
// the draw count does not depend on how finely the art is authored.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Vec3 } from "./coords";
import type { LoadedAsset } from "./loader";
import { OCEAN_HULL_MATERIAL, OCEAN_WATER_MATERIAL } from "./ocean";

export interface Placement {
  position: Vec3;
  rotationY?: number;
  /** Uniform scale about the placement's own origin. Defaults to 1. */
  scale?: number;
  /**
   * Identity of the thing being placed, stable across rebuilds.
   *
   * The board is replanned wholesale on every update, so an instance index
   * means nothing across updates. A key lets a caller ask "is this piece new?"
   * and find its instance again. Only animating families carry one. See drop.ts.
   */
  key?: string;
  /**
   * The world height the art stands on, filled in by `seat`.
   *
   * Not used for placement (`position.y` encodes it), but an animation that
   * scales a piece must scale about the ground rather than the placement
   * origin, or the piece lifts off the board.
   */
  groundY?: number;
  /**
   * Per-instance colour, by the name of the material it applies to.
   *
   * Lets every seat's placements share one InstancedMesh and one draw call,
   * instead of one cloned material per seat (see tintedAsset.ts).
   *
   * Keyed by material name because one placement feeds several draws (a
   * settlement feeds `Seat_Body` and `Seat_Shade`) with a different tone in
   * each. `SeatTint` has this shape.
   *
   * Only meaningful on a material whose own colour is white, since the shader
   * multiplies the two; `tintableAsset` guarantees that. Tinting any other
   * material darkens the piece.
   */
  tint?: Readonly<Record<string, THREE.Color | undefined>>;
}

/** No tint: the multiplicative identity, so an untinted instance is unchanged. */
const NO_TINT = new THREE.Color(1, 1, 1);

/** The instance transform for one placement, before the mesh's own transform. */
function placementMatrix(p: Placement, into: THREE.Matrix4): THREE.Matrix4 {
  const s = p.scale ?? 1;
  return into.compose(
    new THREE.Vector3(p.position[0], p.position[1], p.position[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.rotationY ?? 0, 0)),
    new THREE.Vector3(s, s, s),
  );
}

/**
 * What an InstancedMesh has to remember to be re-posed after it is built.
 *
 * `local` is the source mesh's own transform inside its glTF, baked into every
 * instance matrix at build time (see instanceAsset) and needed again to
 * rebuild one. Stored on the mesh because the caller does not track which
 * mesh came from where.
 *
 * Only attached when the placements carry keys, so scenery retains nothing.
 */
export interface Animatable {
  placements: readonly Placement[];
  local: THREE.Matrix4;
  /** Instance index for each key, for a caller holding a key and no index. */
  index: ReadonlyMap<string, number>;
}

/** The animation state of an InstancedMesh, or undefined if it has none. */
export function animatable(mesh: THREE.InstancedMesh): Animatable | undefined {
  return (mesh.userData as { animatable?: Animatable }).animatable;
}

function attachAnimatable(
  inst: THREE.InstancedMesh,
  placements: readonly Placement[],
  local: THREE.Matrix4,
): void {
  const index = new Map<string, number>();
  placements.forEach((p, i) => {
    if (p.key !== undefined) index.set(p.key, i);
  });
  if (!index.size) return;
  (inst.userData as { animatable?: Animatable }).animatable = { placements, local, index };
}

/**
 * How far one instance has been moved off the placement it was built at.
 *
 * Every field defaults to "as built", so the empty pose reproduces the built
 * matrix exactly. The ticker poses one frame past the end of an animation, so
 * any drift would be a permanent offset.
 */
export interface InstancePose {
  /** World units above the resting position. */
  lift?: number;
  /**
   * World-space displacement in the horizontal plane.
   *
   * Applied outside the pivot pair below, so it is pure translation and
   * independent of both scales.
   */
  offsetX?: number;
  offsetZ?: number;
  /**
   * Vertical scale about the ground the piece stands on. The horizontals take
   * `1/sqrt` of it to keep the volume; a building that only flattens looks
   * like it is sinking.
   */
  squashY?: number;
  /**
   * Uniform scale about the same ground pivot. Volume is not conserved: a
   * pulse is meant to get bigger.
   */
  scale?: number;
  /**
   * Rotation about a horizontal axis, in radians.
   *
   * Used by a number chip answering a roll (see flip.ts). Kept apart from the
   * placement's `rotationY`, which is the fixed facing.
   */
  tilt?: number;
  /**
   * Which horizontal axis, as an azimuth within the ground plane: the axis is
   * `(cos tiltAxisY, 0, sin tiltAxisY)`, so `0` turns about world +X.
   *
   * A parameter because the camera orbits; the caller passes the axis that
   * makes the turn a flip toward the viewer. See `flipAxisY`.
   */
  tiltAxisY?: number;
  /**
   * How far above the ground pivot the turn runs, in world units.
   *
   * The ground pivot suits a squash; a chip rotated about its base would swing
   * around the tile. A chip passes its own half-thickness.
   */
  tiltPivotY?: number;
  /**
   * And how far to the side of it, in world units, in the placement's ground
   * plane.
   *
   * Zero for anything that turns about its own middle (chip, robber). A
   * knight's sword is placed at the knight's vertex, shared with the body so
   * drop and hop treat them as one piece, but turns about the hand, a third of
   * a hex to the side.
   *
   * World-space and applied after the placement's scale, so an offset measured
   * off the art must be multiplied by the drawn scale. See `swordPivot`.
   */
  tiltPivotX?: number;
  tiltPivotZ?: number;
  /**
   * Rotation about the vertical axis, in radians, through the piece's own
   * footprint.
   *
   * `tilt` cannot express this: its axis is always in the ground plane. Used by
   * a robber lying on its side, which spins on the spot instead of
   * somersaulting.
   *
   * Applied outside the tilt, so it turns the piece as it lies; the other order
   * would sweep a cone. Skipped when zero, so an unspun piece keeps its exact
   * built matrix.
   */
  spinY?: number;
}

/**
 * Re-pose one instance relative to where it was built.
 *
 * The caller is responsible for `instanceMatrix.needsUpdate`; a batch of
 * instances on one mesh should be written before the flag is set once.
 */
export function poseInstanceAt(mesh: THREE.InstancedMesh, index: number, pose: InstancePose): void {
  const state = animatable(mesh);
  if (!state) return;
  const p = state.placements[index];
  if (!p) return;
  const lift = pose.lift ?? 0;
  const squashY = pose.squashY ?? 1;
  const grow = pose.scale ?? 1;
  const pivot = p.groundY ?? p.position[1];
  const wide = grow / Math.sqrt(squashY);
  // The pivot is the piece's footprint at ground height on all three axes.
  // The scale runs in world space, so pivoting only Y would scale the
  // horizontal bulge about the board's origin and slide pieces sideways.
  const [px, , pz] = p.position;
  // Read right to left: the art's own transform, the placement, then the
  // scaling about the piece's own base, then the turn about its middle, then
  // the lift and the carry.
  const m = new THREE.Matrix4().makeTranslation(
    px + (pose.offsetX ?? 0),
    lift + pivot,
    pz + (pose.offsetZ ?? 0),
  );
  // Each turn is skipped when zero, so the empty pose keeps the built matrix
  // bit for bit. The spin is applied outside the tilt (see `spinY`), so a piece
  // lying on its side spins flat.
  if (pose.spinY) {
    m.multiply(new THREE.Matrix4().makeRotationY(pose.spinY));
  }
  if (pose.tilt) {
    const axis = new THREE.Vector3(Math.cos(pose.tiltAxisY ?? 0), 0, Math.sin(pose.tiltAxisY ?? 0));
    const hx = pose.tiltPivotX ?? 0;
    const hy = pose.tiltPivotY ?? 0;
    const hz = pose.tiltPivotZ ?? 0;
    m.multiply(new THREE.Matrix4().makeTranslation(hx, hy, hz))
      .multiply(new THREE.Matrix4().makeRotationAxis(axis, pose.tilt))
      .multiply(new THREE.Matrix4().makeTranslation(-hx, -hy, -hz));
  }
  m.multiply(new THREE.Matrix4().makeScale(wide, squashY * grow, wide))
    .multiply(new THREE.Matrix4().makeTranslation(-px, -pivot, -pz))
    .multiply(placementMatrix(p, new THREE.Matrix4()))
    .multiply(state.local);
  mesh.setMatrixAt(index, m);
}

/**
 * Lift and squash, the drop's two axes: `poseInstanceAt` with nothing else on.
 *
 * Board3D now composes a full `InstancePose` per instance per frame (a knight
 * hops while its sword turns); this names what a falling piece does, pinned in
 * `poseInstance.test.ts`.
 */
export function poseInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  lift: number,
  squashY: number,
): void {
  poseInstanceAt(mesh, index, { lift, squashY });
}

/**
 * Marks an InstancedMesh whose geometry this module created, rather than
 * borrowed from the glTF cache.
 *
 * A loaded asset's geometry is shared with the cache and every board built
 * from it, so disposeInstances must not free it. Generated pieces (beach
 * strips and corners, gap sand) are built per rebuild and must be freed, or
 * they leak with every server message.
 */
const OWNS_GEOMETRY = "__costanOwnsGeometry";

/** One InstancedMesh for a geometry the renderer built rather than loaded. */
export function instanceGeometry(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: Placement[],
  name = "",
): THREE.InstancedMesh[] {
  if (!placements.length) return [];
  const inst = new THREE.InstancedMesh(geometry, material, placements.length);
  inst.name = name;
  // Generated here, so this build is the only owner and disposeInstances frees
  // it. instanceAsset's geometry comes from the shared cache and must not be.
  inst.userData[OWNS_GEOMETRY] = true;
  const m = new THREE.Matrix4();
  for (let i = 0; i < placements.length; i++) {
    inst.setMatrixAt(i, placementMatrix(placements[i], m));
  }
  inst.instanceMatrix.needsUpdate = true;
  attachAnimatable(inst, placements, new THREE.Matrix4());
  return [inst];
}

export function instanceAsset(asset: LoadedAsset, placements: Placement[]): THREE.InstancedMesh[] {
  if (!placements.length) return [];

  // Local transforms are baked in: a prop at y=1 inside its tile stays at y=1
  // once instanced.
  asset.scene.updateMatrixWorld(true);

  const out: THREE.InstancedMesh[] = [];
  const placement = new THREE.Matrix4();
  const composed = new THREE.Matrix4();

  const emit = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    local: THREE.Matrix4,
    name: string,
    owns: boolean,
  ) => {
    const inst = new THREE.InstancedMesh(geometry, material, placements.length);
    inst.name = name;
    if (owns) inst.userData[OWNS_GEOMETRY] = true;
    // Only when a placement asks for one: an instanceColor buffer costs a
    // vertex attribute and a second shader program for the material (three
    // keys the program on `USE_INSTANCING_COLOR`).
    const tinting = placements.some((p) => p.tint?.[material.name]);
    for (let i = 0; i < placements.length; i++) {
      placementMatrix(placements[i], placement);
      composed.multiplyMatrices(placement, local);
      inst.setMatrixAt(i, composed);
      if (tinting) inst.setColorAt(i, placements[i].tint?.[material.name] ?? NO_TINT);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    attachAnimatable(inst, placements, local.clone());
    out.push(inst);
  };

  // Material names this build will tint. A tinted material keeps its own
  // draw: the seat colour applies to the whole draw (see Placement.tint), so an
  // untinted part merged beside it would take the seat colour too.
  const tinted = new Set<string>();
  for (const p of placements) {
    for (const name of Object.keys(p.tint ?? {})) tinted.add(name);
  }

  for (const parts of groupByDraw(asset.scene, tinted)) {
    const materials = new Set(parts.map(materialOf));
    if (parts.length === 1) {
      emit(parts[0].geometry, materialOf(parts[0]), parts[0].matrixWorld, parts[0].name, false);
      continue;
    }
    // More than one material in the group means they differ only by colour,
    // so the colour moves into the vertices and the group draws once.
    const recolour = materials.size > 1;
    const merged = mergeParts(parts, recolour);
    if (!merged) {
      // Attributes that do not line up (one part has UVs, another does not).
      // Rare; fall back to one draw per part.
      for (const p of parts) emit(p.geometry, materialOf(p), p.matrixWorld, p.name, false);
      continue;
    }
    const material = recolour ? vertexColoured(materialOf(parts[0])) : materialOf(parts[0]);
    // The parts' transforms are baked into the merged vertices, so the
    // instance carries only the placement. `poseInstanceAt` multiplies by
    // `state.local` innermost, so it must be the identity here.
    emit(merged, material, IDENTITY, parts[0].name, true);
  }

  return out;
}

/**
 * The one material a colour-merged group draws with: the group's own, cloned
 * once, forced to white and told to read the vertex colours.
 *
 * White because the shader multiplies (as with `tintableAsset`).
 *
 * Cached by source material so rebuilds reuse the same object: two materials
 * with the same settings are still two `material.id`s and two uniform uploads
 * per frame.
 */
const vertexColourCache = new WeakMap<THREE.Material, THREE.Material>();

function vertexColoured(source: THREE.Material): THREE.Material {
  const hit = vertexColourCache.get(source);
  if (hit) return hit;
  const material = source.clone() as THREE.MeshStandardMaterial;
  material.vertexColors = true;
  material.color?.setRGB(1, 1, 1);
  vertexColourCache.set(source, material);
  return material;
}

const IDENTITY = new THREE.Matrix4();

function materialOf(mesh: THREE.Mesh): THREE.Material {
  return Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
}

/**
 * Whether a material has to keep a draw, and an identity, of its own.
 *
 * A custom shader: the sea is a standard material with the swell injected via
 * `onBeforeCompile` and is otherwise configured like scenery. A signature
 * built from parameters cannot see the injected GLSL, so the water would merge
 * with land and draw with the wrong shader (see applyOceanWave's
 * `customProgramCacheKey`).
 *
 * A name that is looked up later: merging renames materials, and the sea's
 * are found by name after the build (`seaCastsShadow` keeps them out of the
 * shadow pass, `applyOceanLook` repaints them on a theme change).
 */
function keepsItsOwnDraw(m: THREE.Material): boolean {
  // An own `onBeforeCompile`: every material inherits a no-op from the
  // prototype.
  if (Object.hasOwn(m, "onBeforeCompile")) return true;
  return m.name === OCEAN_WATER_MATERIAL || m.name === OCEAN_HULL_MATERIAL;
}

/**
 * Everything about a material that forces a draw of its own, except colour.
 *
 * The art is authored one material per painted part, and those are mostly
 * identical but for base colour (on the full board, 262 materials make 45
 * signatures, the largest covering 49).
 *
 * Textures are keyed by identity: a vertex colour multiplies the map, and
 * parts sampling different images cannot share a draw anyway.
 *
 * Conservative: any property left out is one two merged parts could disagree
 * on, which would shade a tile wrongly without any error.
 */
function drawSignature(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial;
  return JSON.stringify([
    // three's own answer to "can these two share a compiled program". The
    // default is not empty (it stringifies `onBeforeCompile`), so group on the
    // value rather than test it for truth.
    m.customProgramCacheKey?.() ?? "",
    m.type,
    s.map?.uuid ?? null,
    s.normalMap?.uuid ?? null,
    s.roughnessMap?.uuid ?? null,
    s.metalnessMap?.uuid ?? null,
    s.emissiveMap?.uuid ?? null,
    s.aoMap?.uuid ?? null,
    s.alphaMap?.uuid ?? null,
    s.lightMap?.uuid ?? null,
    s.bumpMap?.uuid ?? null,
    s.displacementMap?.uuid ?? null,
    s.envMap?.uuid ?? null,
    s.roughness,
    s.metalness,
    s.emissive?.getHex() ?? null,
    s.emissiveIntensity,
    s.envMapIntensity,
    s.flatShading,
    s.wireframe,
    m.transparent,
    m.opacity,
    m.side,
    m.blending,
    m.alphaTest,
    m.depthTest,
    m.depthWrite,
    s.fog,
    m.toneMapped,
    m.vertexColors,
    m.colorWrite,
    m.premultipliedAlpha,
    m.dithering,
    m.stencilWrite,
    // The flat sea ring overlaps the hex field and relies on these to win the
    // depth fight; ignoring them would z-fight.
    m.polygonOffset,
    m.polygonOffsetFactor,
    m.polygonOffsetUnits,
  ]);
}

/**
 * The asset's meshes, gathered into one bucket per draw.
 *
 * A draw call is per material, and the art is authored finely: profiling put
 * 57% of render time in per-draw uniform uploads (508 calls for 2321
 * instances). Parts that agree on everything but colour become one geometry
 * with colours in a vertex attribute, so the bucket key is a signature rather
 * than a material object.
 *
 * `tinted` names the materials this build paints per instance. Those are
 * bucketed by object, because the seat colour applies to the whole draw.
 *
 * Insertion-ordered, so parts keep the asset's declared draw order.
 */
function groupByDraw(scene: THREE.Object3D, tinted: ReadonlySet<string>): THREE.Mesh[][] {
  const groups = new Map<string, THREE.Mesh[]>();
  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = materialOf(mesh);
    const key =
      tinted.has(material.name) || keepsItsOwnDraw(material)
        ? `alone:${material.uuid}`
        : drawSignature(material);
    const list = groups.get(key);
    if (list) list.push(mesh);
    else groups.set(key, [mesh]);
  });
  return [...groups.values()];
}

/**
 * One geometry from many, each part baked at its own transform.
 *
 * The parts are cloned first because the source geometry belongs to the
 * loader's cache and is shared with every board. Only the merged result is
 * kept, marked `OWNS_GEOMETRY`.
 *
 * Returns null when the parts cannot be merged (`mergeGeometries` returns null
 * after logging): the attribute sets must match, and mixed UV'd and un-UV'd
 * parts do not.
 */
function mergeParts(parts: THREE.Mesh[], recolour: boolean): THREE.BufferGeometry | null {
  const baked = parts.map((p) => {
    const g = p.geometry.clone();
    g.applyMatrix4(p.matrixWorld);
    if (recolour) bakeColour(g, materialOf(p));
    return g;
  });
  let merged: THREE.BufferGeometry | null;
  try {
    merged = mergeGeometries(baked, false);
  } catch {
    merged = null;
  }
  for (const g of baked) g.dispose();
  return merged;
}

/**
 * Write a material's base colour onto every vertex of a geometry.
 *
 * The shader does `vColor.rgb *= color` with the material at white, so the
 * pixels match what the per-part material produced.
 *
 * Linear, not sRGB: `THREE.Color` components and vertex colour attributes are
 * both in three's working space, so they copy across untouched.
 *
 * An existing `color` attribute is left alone. Such a part never reaches here
 * anyway, since `drawSignature` keys on `vertexColors`.
 */
function bakeColour(geometry: THREE.BufferGeometry, material: THREE.Material): void {
  if (geometry.getAttribute("color")) return;
  const count = geometry.getAttribute("position")?.count ?? 0;
  if (!count) return;
  const { r, g, b } = (material as THREE.MeshStandardMaterial).color ?? NO_TINT;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colours[i * 3] = r;
    colours[i * 3 + 1] = g;
    colours[i * 3 + 2] = b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
}

/**
 * Geometry and materials are shared with the source asset, which is cached and
 * reused across boards, so only the instance buffers are released here.
 */
export function disposeInstances(meshes: THREE.InstancedMesh[]): void {
  for (const m of meshes) {
    m.dispose();
    // Only geometry this module generated (see OWNS_GEOMETRY); a loaded
    // asset's geometry is shared with the cache.
    if (m.userData[OWNS_GEOMETRY]) m.geometry.dispose();
    m.removeFromParent();
  }
}
