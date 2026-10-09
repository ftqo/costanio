// Shop-tile art, rendered on the player's machine.
//
// A shipped raster bakes in one seat colour, and tinting it through an alpha
// mask throws the shading away. Rendering here gives your colour and real
// lighting: the models are already cached (the lobby warms them),
// `tintedAsset` derives a seat's tones, and one small renderer makes an image
// per piece in well under a frame.
//
// Camera and lighting come from an offline Blender study of the same models: a
// long lens at the board's own elevation, so a tile looks like the piece on
// the board.
//
// Neutral subjects (the development deck belongs to nobody) would render
// identically for everyone, so they are composed here but baked to
// `public/assets/` and shipped: see DEV_DECK_SHOT.
import * as THREE from "three";
import { loadAsset } from "./loader";
import { loadPalette, type Palette } from "./palette";
import { resolveCssColorToHex } from "@/lib/colorResolve";
import { seatTint, isTintSlot } from "./tint";
import { gpuFinished, warmPrograms } from "./warmPrograms";

/**
 * Where a part stands relative to the rest of the scene, in the models' own
 * units. Applied before the framing solve, so the composed picture is what gets
 * framed. Scale, then turn, then offset (three's order).
 *
 * All fields optional; a part with none sits where it is in its source file.
 */
export interface PartPose {
  /** Offset from where the part sits in its own file: [x, y, z]. */
  at?: [number, number, number];
  /** Turn in degrees: a number is a yaw about Y, a triple is X, Y, Z. */
  turnDeg?: number | [number, number, number];
  /** Uniform scale. 1 is the model's own size. */
  scale?: number;
}

/**
 * One piece in a scene: everything in `file` whose node name starts `prefix`,
 * placed by its pose and dressed by its opacity and tint.
 */
export interface ScenePart extends PartPose {
  file: string;
  prefix: string;
  /** How solid the part is, 0..1. Under 1 reads as a proposed move (a ghost). */
  opacity?: number;
  /**
   * Draw this part in the given colour instead of the viewer's seat colour: any
   * string `seatTint` accepts. For pieces that are not the viewer's (an
   * opponent's settlement, a neutral piece).
   */
  tint?: string;
  /** Fixed colour for neutral counters, independent of seat tint slots. */
  color?: string;
}

export interface PieceShot {
  /** Asset slot id this fills. */
  slot: string;
  /** The scene, read as a list of "this piece, here, like this". */
  parts: ScenePart[];
  /** Turn the whole staged scene about Y, in degrees, before framing. */
  yawDeg: number;
  /**
   * Share of the frame's height the piece should occupy. Graded rather than one
   * true scale: framed for the tallest piece, a settlement would be illegible
   * at 56px. Grading keeps the ladder (a city bigger than a settlement) while
   * every piece stays recognisable.
   */
  fill: number;
  /**
   * Exposure multiplier for subjects the rig was not tuned for. The rig suits
   * saturated seat colours (0.3-0.5 albedo); card stock (0.91, off-white)
   * clips to a flat slab under it. Per shot, defaulting to 1, so existing shots
   * render unchanged.
   *
   * Applied as tone-mapping exposure, so the whole rig scales together: darker,
   * not differently lit.
   */
  exposure?: number;
}

/** Thickness of the shipped card slab, in the model's own units. */
export const SLAB_THICKNESS = 0.09;

/**
 * How far apart to stack slabs. Greater than the slab thickness: flush faces
 * z-fight, and the sliver of shadow between cards is what shows there are two.
 */
export const SLAB_PITCH = 0.095;

/**
 * A number in -1..1 that depends only on `i` and `salt` (hash of a sine).
 * Deterministic so a re-rendered deck does not reshuffle and flicker.
 */
function wobble(i: number, salt: number): number {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * `count` slabs stacked into a deck, bottom to top.
 *
 * Only the top card carries the printed panel (`Card_slab`); the rest are
 * `Card_slab_body`, since buried panels would add dark seams that read as dirt.
 *
 * A hundredth of a unit of slide and a degree of yaw per card is under a pixel
 * each at tile size, but makes a riffled stack rather than a brick.
 */
export function cardStack(count: number): ScenePart[] {
  const parts: ScenePart[] = [];
  for (let i = 0; i < count; i++) {
    const top = i === count - 1;
    parts.push({
      file: "cards.glb",
      prefix: top ? "Card_slab" : "Card_slab_body",
      at: [wobble(i, 1) * 0.01, i * SLAB_PITCH, wobble(i, 2) * 0.01],
      turnDeg: wobble(i, 3),
    });
  }
  return parts;
}

/**
 * The purchasable actions, and what to photograph for each.
 *
 * Only actions a player can buy, including the three city-improvement tracks
 * (sent as `improve_city {track}`). The metropolis is awarded by the engine at
 * track level 4, never bought, so it has no tile.
 *
 * The improvement props belong to a track, not a player, so they use plain
 * `Mat_Improve_*` materials; `stagePart` only recolours `isTintSlot`
 * materials, so they render in their authored colours in every seat. The
 * per-colour cache stores identical copies of those three, which is cheaper
 * than a second art path for tiles drawn beside player-coloured ones.
 *
 * Each of these is a single piece in place, so none names a pose. A composed
 * scene reads one line per piece:
 *
 *     parts: [
 *       { file: "pieces.glb", prefix: "City_A" },
 *       { file: "pieces.glb", prefix: "Road_A", at: [0.9, 0, 0.4], turnDeg: 30 },
 *       { file: "pieces.glb", prefix: "Settlement_A", at: [-1, 0, 0], opacity: 0.45 },
 *       { file: "knights.glb", prefix: "Knight_basic", at: [1.6, 0, -0.6], tint: NEUTRAL },
 *     ]
 *
 * The framing solve measures all parts together.
 */
export const SHOP_SHOTS: PieceShot[] = [
  {
    slot: "scenario_gold",
    parts: [{ file: "resicons.glb", prefix: "Res_coin_", color: "var(--color-gold)" }],
    yawDeg: 0,
    fill: 0.66,
  },
  {
    slot: "scenario_coins",
    parts: [{ file: "resicons.glb", prefix: "Res_coin_" }],
    yawDeg: 0,
    fill: 0.66,
  },
  {
    slot: "scenario_fish",
    parts: [{ file: "cargo.glb", prefix: "Haul_" }],
    yawDeg: 35,
    fill: 0.66,
  },
  {
    slot: "scenario_wagon",
    parts: [{ file: "wagons.glb", prefix: "Wagon_" }],
    yawDeg: 25,
    fill: 0.66,
  },
  {
    slot: "scenario_rider",
    parts: [{ file: "riders.glb", prefix: "Rider_" }],
    yawDeg: 25,
    fill: 0.66,
  },
  {
    slot: "build_cargoship",
    parts: [{ file: "vessels.glb", prefix: "Cargo_" }],
    yawDeg: 155,
    fill: 0.66,
  },
  {
    slot: "build_harbour",
    parts: [{ file: "harbors.glb", prefix: "Harbor_" }],
    yawDeg: -5,
    fill: 0.66,
  },
  { slot: "build_road", parts: [{ file: "pieces.glb", prefix: "Road_A" }], yawDeg: 0, fill: 0.62 },
  {
    // The export cancels the authored stagger (anchors.AUTHORED_TURN), so each
    // shot carries its whole turn here.
    slot: "build_settlement",
    parts: [{ file: "pieces.glb", prefix: "Settlement_A" }],
    yawDeg: -5,
    fill: 0.6,
  },
  {
    slot: "build_city",
    parts: [{ file: "pieces.glb", prefix: "City_A" }],
    yawDeg: -30,
    fill: 0.72,
  },
  {
    slot: "build_ship",
    parts: [{ file: "ships.glb", prefix: "Ship_route" }],
    yawDeg: 155,
    fill: 0.64,
  },
  {
    // The Rivers bridge, square on: the arch is what distinguishes it from a
    // road and only reads in elevation (see `bridgeArt.test.ts`). The rig's 34
    // degree look-down keeps the opening.
    //
    // The ship's fill rather than the road's: a long piece that stands taller.
    slot: "build_bridge",
    parts: [{ file: "bridges.glb", prefix: "Bridge_" }],
    yawDeg: 0,
    fill: 0.64,
  },
  {
    // +20 degrees: the shield hangs off the knight's side, so square on it falls
    // into shadow and edge on it disappears.
    slot: "build_knight",
    parts: [{ file: "knights.glb", prefix: "Knight_basic" }],
    yawDeg: 20,
    fill: 0.58,
  },
  {
    // The two higher tiers, for the location menu's Promote card, which shows
    // the knight you would get. Graded up by `fill` like the shop ladder.
    slot: "build_knight_strong",
    parts: [{ file: "knights.glb", prefix: "Knight_strong" }],
    yawDeg: 20,
    fill: 0.62,
  },
  {
    slot: "build_knight_mighty",
    parts: [{ file: "knights.glb", prefix: "Knight_mighty" }],
    yawDeg: 20,
    fill: 0.66,
  },
  {
    // Activate shows the gold raised sword, the board's ready state
    // (knightSword.ts).
    slot: "activate_knight",
    parts: [{ file: "knights.glb", prefix: "Knight_sword_basic_gold" }],
    yawDeg: 0,
    fill: 0.7,
  },
  {
    // The subject is the robber, not the knight: with the knight's art it was
    // indistinguishable from Move.
    //
    // Tinted rather than seat-coloured: nobody owns the robber.
    slot: "chase_robber",
    parts: [{ file: "pieces.glb", prefix: "Robber_", tint: "var(--color-ore)" }],
    yawDeg: 0,
    fill: 0.6,
  },
  {
    // The subject is the pirate. Nobody owns it, and the ship's own black
    // distinguishes it, so it takes no tint.
    slot: "chase_pirate",
    parts: [{ file: "ships.glb", prefix: "Ship_pirate" }],
    yawDeg: -20,
    fill: 0.6,
  },
  {
    // The only composite: the ring alone reads as an empty box; a city inside
    // it is legible and shows what the piece does.
    slot: "build_wall",
    parts: [
      { file: "walls.glb", prefix: "Wall_segment_ring_01" },
      { file: "pieces.glb", prefix: "City_A" },
    ],
    // Kept: the ring's towers flank its front at +z, and this lines the city's
    // doorway up with the gate.
    yawDeg: -15,
    fill: 0.74,
  },
  // The three improvement props, in TRACK_ROW order (science, trade,
  // politics).
  //
  // Authored facing -Y in the blend and exported with no turn cancelled (see
  // tools/blender/anchors.py), and the camera sits 38 degrees round, so yaw 0
  // is the three-quarter view and yaw 38 is square on.
  {
    // A shade under square: at exactly 38 the pages mirror each other and read
    // flat; a little turn shows the V of the gutter.
    slot: "improve_science",
    parts: [{ file: "improvements.glb", prefix: "Improve_Science" }],
    yawDeg: 30,
    fill: 0.66,
  },
  {
    // Square on: the beam and pans are the whole silhouette, and any turn
    // stacks one pan behind the other.
    slot: "improve_trade",
    parts: [{ file: "improvements.glb", prefix: "Improve_Trade" }],
    yawDeg: 38,
    fill: 0.64,
  },
  {
    // Plain three-quarter: a crown is nearly symmetric, and the oblique shows
    // the band as a ring.
    slot: "improve_politics",
    parts: [{ file: "improvements.glb", prefix: "Improve_Politics" }],
    yawDeg: 0,
    fill: 0.6,
  },
];

/**
 * How many slabs the development deck is, judged at 56x80. Fewer than about
 * eight reads as one thick card; more than about sixteen merges into a block.
 */
const DECK_CARDS = 12;

/**
 * The development deck, the first baked card face.
 *
 * Not in SHOP_SHOTS: the deck belongs to nobody, so the slab has no seat slots
 * and every player would get the same render. It is baked once and shipped as
 * `assets/devcard_back.webp`; the composition stays here for re-baking.
 *
 * A stack rather than one card (a single slab is just a rounded rectangle),
 * lying flat so the 34 degree camera rakes the striated edge while the top
 * panel says "card".
 *
 * To re-bake after the slab, the rig or this composition changes:
 *
 *   1. `npm run dev`, and open a page whose module script does
 *      `renderShopThumbnails(anyColour, { shots: [DEV_DECK_SHOT], pixelRatio: 2 })`
 *      (any seat colour works; the slab has no seat slots).
 *   2. Draw the returned data URL onto a 256x340 canvas (a 2x downsample, which
 *      gives the anti-aliasing MSAA does not), and `toBlob("image/png")`.
 *   3. `cwebp -lossless -exact in.png -o devcard_back.webp` (lossless for the
 *      hard-edged flat shading, `-exact` so transparent pixels' colour is not
 *      smeared into the silhouette).
 *   4. Drop it in `public/assets/` and check the manifest still says `webp`.
 *
 * A headless browser does it in about 30 seconds, nearly all startup.
 */
export const DEV_DECK_SHOT: PieceShot = {
  slot: "devcard_back",
  parts: cardStack(DECK_CARDS),
  // Long axis toward the camera's azimuth, so the deck's height runs along the
  // tile's long side.
  yawDeg: 38,
  fill: 0.72,
  // One stop down (see PieceShot.exposure). Chosen by eye at 56x80: at 1.0 the
  // deck's edge is a pale block; at 0.42 the stock reads grey.
  exposure: 0.5,
};

/** Card aspect, matching the `card` slot kind (256x340). */
export const THUMB_W = 256;
export const THUMB_H = 340;

/** Long lens: near-orthographic, so a tall piece does not splay at the top. */
const FOV_DEG = 25.6;
/** Three-quarter view, at the board camera's own elevation. */
const AZIMUTH_DEG = 38;
const ELEVATION_DEG = 34;

/** Unit vector from the subject toward the camera. */
export function shotDirection(
  azimuthDeg = AZIMUTH_DEG,
  elevationDeg = ELEVATION_DEG,
): THREE.Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az),
  ).normalize();
}

/** Where the camera ends up: how far back, and what it points at. */
export interface Framing {
  distance: number;
  target: THREE.Vector3;
}

/**
 * Pure: frame `points` so their silhouette fills `fill` of the frame's height
 * (and no more than 0.86 of its width), centred.
 *
 * Uses the vertices, not the bounding box: looking down at 34 degrees, a box's
 * depth inflates its projected height. The diagonal road's box is 2.18 x 1.95
 * for a thin bar, and framing to it filled a fifth of the card instead of six
 * tenths.
 *
 * Distance and centring interact, so a few passes solve both.
 */
export function frameSubject(
  points: THREE.Vector3[],
  dir: THREE.Vector3,
  fill: number,
  aspect: number,
  fovDeg = FOV_DEG,
): Framing {
  const box = new THREE.Box3().setFromPoints(points);
  const target = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  let dist = radius * 4;
  if (!points.length) return { distance: dist, target };

  const cam = new THREE.PerspectiveCamera(fovDeg, aspect, 0.01, 1000);
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  for (let i = 0; i < 40; i++) {
    cam.position.copy(target).addScaledVector(dir, dist);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const p = new THREE.Vector3();
    for (const q of points) {
      p.copy(q).project(cam);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    // NDC spans -1..1, so a full frame is 2 units: half a span is the fraction.
    const spanY = (maxY - minY) / 2;
    const spanX = (maxX - minX) / 2;
    const offX = (minX + maxX) / 2;
    const offY = (minY + maxY) / 2;

    // Slide the look-at target so the silhouette, rather than the bounding box
    // centre, sits in the middle of the frame.
    const halfH = dist * Math.tan((fovDeg * Math.PI) / 180 / 2);
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    up.setFromMatrixColumn(cam.matrixWorld, 1);
    target.addScaledVector(right, offX * halfH * aspect).addScaledVector(up, offY * halfH);

    const scale = Math.max(spanY / fill, spanX / 0.86);
    if (Math.abs(scale - 1) < 0.002 && Math.abs(offX) < 0.002 && Math.abs(offY) < 0.002) break;
    if (scale > 0) dist *= scale;
  }
  return { distance: dist, target };
}

/**
 * Every vertex of the staged subject, in world space. The pieces are low-poly,
 * so this is a few hundred points; the sampling step only guards against an
 * unexpectedly dense mesh.
 */
export function subjectPoints(root: THREE.Object3D): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry?.getAttribute("position");
    if (!pos) return;
    const step = Math.max(1, Math.ceil(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) {
      pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
  });
  return pts;
}

/** Key / fill / rim, sized to the subject rather than to a board. */
function shotLights(radius: number): THREE.Group {
  const g = new THREE.Group();
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position
    .set(-1, 1.7, 1.5)
    .normalize()
    .multiplyScalar(radius * 6);
  // Only the key casts; three shadows on a piece this size is mud.
  key.castShadow = true;
  const reach = radius * 2.2;
  key.shadow.camera.left = -reach;
  key.shadow.camera.right = reach;
  key.shadow.camera.top = reach;
  key.shadow.camera.bottom = -reach;
  key.shadow.camera.near = 0.01;
  key.shadow.camera.far = radius * 14;
  key.shadow.mapSize.set(1024, 1024);
  // Hard-edged pieces on the floor: the default bias leaves a dark seam where
  // a face meets its shadow.
  key.shadow.bias = -0.0012;
  g.add(key);
  // Cool, low, opposite the key: separates the shaded face from the background
  // without flattening the form.
  const fill = new THREE.DirectionalLight(0xd2e0ff, 0.9);
  fill.position
    .set(1.4, 0.5, 1.2)
    .normalize()
    .multiplyScalar(radius * 6);
  g.add(fill);
  // From behind, to keep an edge against a transparent background.
  const rim = new THREE.DirectionalLight(0xfff0dd, 1.2);
  rim.position
    .set(0.4, 1.1, -1.6)
    .normalize()
    .multiplyScalar(radius * 6);
  g.add(rim);
  g.add(new THREE.AmbientLight(0x8f9bb3, 1.1));
  return g;
}

/**
 * An invisible floor that catches the key's shadow. ShadowMaterial renders only
 * the shadow, with alpha, so the card keeps its transparent background and the
 * piece still sits on something rather than reading as a sticker.
 */
function shadowFloor(y: number, radius: number): THREE.Mesh {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 12, radius * 12),
    new THREE.ShadowMaterial({ opacity: 0.32 }),
  );
  floor.rotation.x = -Math.PI / 2;
  // On the subject's base, not y=0: pieces do not all start at the origin
  // (see loader.assetBaseY).
  floor.position.y = y;
  floor.receiveShadow = true;
  return floor;
}

const RAD = Math.PI / 180;

/** Stand `obj` in the scene the way `pose` asks. Scale, then turn, then offset. */
export function applyPose(obj: THREE.Object3D, pose: PartPose): void {
  if (pose.scale !== undefined) obj.scale.setScalar(pose.scale);
  if (pose.turnDeg !== undefined) {
    const t = pose.turnDeg;
    if (typeof t === "number") obj.rotation.set(0, t * RAD, 0);
    else obj.rotation.set(t[0] * RAD, t[1] * RAD, t[2] * RAD);
  }
  if (pose.at) obj.position.set(pose.at[0], pose.at[1], pose.at[2]);
}

/**
 * Marks a material this module cloned and therefore owns.
 *
 * The cache shares one material per slot per file across every board, so:
 * clone before changing anything, and dispose only clones. Fading a shared
 * material would make the piece translucent on the live board too, and
 * disposing one would pull its GPU upload from under every board using it.
 */
const OWNED = "shotOwnedMaterial";

/**
 * One part of a scene, cut from a loaded asset: selected by name, dressed, and
 * posed.
 *
 * One pass rather than `subsetByPrefix` then `tintedAsset`: each bakes the
 * source's world matrix, so chaining them applies it twice, sliding the
 * off-origin pieces away and leaving the subject framed at half size.
 *
 * The pose lives on the returned group, not in the meshes, so the vertices
 * `subjectPoints` reads are the composed ones.
 */
export function stagePart(source: THREE.Object3D, part: ScenePart, seatColor: string): THREE.Group {
  const tint = seatTint(part.tint ?? seatColor) as unknown as Record<
    string,
    THREE.Color | undefined
  >;
  const opacity = part.opacity ?? 1;
  const fade = opacity < 1;
  const group = new THREE.Group();
  source.updateMatrixWorld(true);
  source.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.name.startsWith(part.prefix)) return;
    const original = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      | THREE.MeshStandardMaterial
      | undefined;
    if (!original) return;
    // Clone only the materials this part recolours or fades; the rest are
    // shared with the cache and must not be mutated or disposed.
    let material: THREE.Material = original;
    const recolour = isTintSlot(original.name);
    if (recolour || fade || part.color) {
      const clone = original.clone();
      clone.userData[OWNED] = true;
      if (recolour) {
        const colour = tint[original.name];
        if (colour) clone.color.copy(colour);
      }
      if (part.color) clone.color.set(resolveCssColorToHex(part.color));
      if (fade) {
        clone.transparent = true;
        clone.opacity = opacity;
        // Off, as for ghosts: otherwise the near faces hide the far ones and it
        // reads as a hole.
        clone.depthWrite = false;
      }
      material = clone;
    }
    const copy = new THREE.Mesh(mesh.geometry, material);
    copy.name = mesh.name;
    copy.applyMatrix4(mesh.matrixWorld); // once, and only once
    // A proposed piece casts no shadow; a contact shadow says it is standing
    // there.
    copy.castShadow = !fade;
    group.add(copy);
  });
  applyPose(group, part);
  return group;
}

/**
 * Free the materials staging cloned, and nothing else. Geometry and untinted
 * materials are shared with the cache (see OWNED).
 */
export function disposeStaged(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (mat?.userData?.[OWNED]) mat.dispose();
    }
  });
}

/** Every part of a shot, loaded, staged and turned to the shot's yaw. */
async function stage(shot: PieceShot, seatColor: string, palette: Palette): Promise<THREE.Group> {
  const group = new THREE.Group();
  for (const part of shot.parts) {
    const asset = await loadAsset(part.file, palette);
    group.add(stagePart(asset.scene, part, seatColor));
  }
  group.rotation.y = shot.yawDeg * RAD;
  group.updateMatrixWorld(true);
  return group;
}

export interface ThumbnailOptions {
  /** Device pixel ratio to render at, capped by the caller. */
  pixelRatio?: number;
  /** Which shots to take. Defaults to every purchasable action. */
  shots?: PieceShot[];
  /**
   * Frame size in CSS px. Defaults to the `card` slot's 256x340. The aspect
   * feeds the framing solve; the 96x96 `icon` slots pass their own.
   */
  size?: { w: number; h: number };
}

/**
 * How long the shared renderer outlives its last batch. Batches come in bursts
 * (a table mounting asks for icons, shop tiles and rules props), so a short
 * wait catches the burst; after it the context goes back to the browser.
 */
export const SHOT_RENDERER_IDLE_MS = 10_000;

interface ShotRenderer {
  renderer: THREE.WebGLRenderer;
  /** Frees the last shot's staging, once the next shot has drawn. */
  release: () => void;
}

/**
 * One renderer kept between batches, so a batch reuses the programs the last
 * one linked instead of compiling them again in a fresh context. Freed after
 * SHOT_RENDERER_IDLE_MS without a batch.
 *
 * A batch that starts while it is busy gets a renderer of its own for the
 * batch, as every batch used to: queueing behind the first made the table's
 * second batch finish a third of a second later on a cold start.
 */
let shared: ShotRenderer | null = null;
let sharedBusy = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function makeRenderer(): ShotRenderer | null {
  try {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      // The browser may clear the drawing buffer after a composite unless this
      // is set.
      preserveDrawingBuffer: true,
    });
    // Match the board: neutral rather than ACES, since a filmic roll-off pulls
    // saturation out of flat-shaded art whose colour is the design.
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.setClearAlpha(0);
    renderer.shadowMap.enabled = true;
    // Match the board: PCFSoftShadowMap is deprecated and rewritten to
    // PCFShadowMap anyway.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    return { renderer, release: () => {} };
  } catch {
    return null; // No WebGL: fall back, as the board does.
  }
}

function freeRenderer(r: ShotRenderer): void {
  try {
    r.release();
  } finally {
    // dispose() frees three's resources; forceContextLoss releases the
    // context itself, which browsers cap per page.
    r.renderer.dispose();
    r.renderer.forceContextLoss();
  }
}

function freeShared(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  const s = shared;
  shared = null;
  if (s) freeRenderer(s);
}

/** The shared renderer, made if there is none or its context was lost. */
function takeShared(): ShotRenderer | null {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  if (shared?.renderer.getContext().isContextLost()) freeShared();
  shared ??= makeRenderer();
  return shared;
}

/** Free the shared renderer now. Tests only. */
export function __disposeShotRenderer(): void {
  freeShared();
}

/**
 * Render each shot in every colour asked for, returning colour -> slot -> PNG.
 *
 * Colours are batched so one WebGL context serves them all, and that context
 * is kept for the next batch (see `shared`); contexts are scarce and slow to
 * create, and a ten-player table would otherwise need eleven at the moment the
 * game screen mounts.
 *
 * Blobs rather than data URLs: no base64 round-trip, and it is what the cache
 * stores and an object URL serves.
 *
 * Returns an empty map rather than throwing without WebGL; callers keep their
 * fallbacks.
 */
export async function renderShotBlobs(
  seatColors: string[],
  opts: ThumbnailOptions = {},
): Promise<Map<string, Record<string, Blob>>> {
  const shots = opts.shots ?? SHOP_SHOTS;
  const width = opts.size?.w ?? THUMB_W;
  const height = opts.size?.h ?? THUMB_H;
  const byColor = new Map<string, Record<string, Blob>>();
  if (!seatColors.length) return byColor;
  if (typeof document === "undefined") return byColor;

  const useShared = !sharedBusy;
  const held = useShared ? takeShared() : makeRenderer();
  if (!held) return byColor;
  if (useShared) sharedBusy = true;
  const { renderer } = held;

  try {
    const dpr = Math.min(opts.pixelRatio ?? (globalThis.devicePixelRatio || 1), 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);

    const palette = await loadPalette().catch(() => null);
    if (!palette) return byColor;

    const dir = shotDirection();
    const aspect = width / height;

    for (const seatColor of seatColors) {
      const out: Record<string, Blob> = {};
      for (const shot of shots) {
        let group: THREE.Group;
        try {
          group = await stage(shot, seatColor, palette);
        } catch {
          continue; // A missing model costs this one tile its art, nothing more.
        }
        const points = subjectPoints(group);
        if (!points.length) continue;

        // castShadow is set per mesh while staging (faded parts cast none).
        const scene = new THREE.Scene();
        scene.add(group);
        const box = new THREE.Box3().setFromPoints(points);
        const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
        const lights = shotLights(radius);
        scene.add(lights);
        const floor = shadowFloor(box.min.y, radius);
        scene.add(floor);

        const { distance, target } = frameSubject(points, dir, shot.fill, aspect);
        const cam = new THREE.PerspectiveCamera(FOV_DEG, aspect, distance * 0.01, distance * 10);
        cam.position.copy(target).addScaledVector(dir, distance);
        cam.lookAt(target);

        // Reset every pass so one shot's exposure cannot leak into the next.
        renderer.toneMappingExposure = shot.exposure ?? 1;
        // Linked off the main thread where the driver allows, so a page
        // warming shots stays responsive.
        await warmPrograms(renderer, scene, cam, [scene], [{ target: null }]);
        renderer.render(scene, cam);
        await gpuFinished(renderer.getContext() as WebGL2RenderingContext);
        const blob = await canvasBlob(renderer.domElement);
        if (blob) out[shot.slot] = blob;

        // Freed after the next shot has drawn, in this batch or the next:
        // disposing the last material on a program frees the program, and the
        // next shot would compile it again.
        held.release();
        held.release = () => {
          disposeStaged(group);
          // The floor and the key's shadow map are built per shot and shared
          // with nothing.
          floor.geometry.dispose();
          (floor.material as THREE.Material).dispose();
          lights.traverse((n) => (n as THREE.DirectionalLight).shadow?.dispose());
          scene.clear();
        };
      }
      if (Object.keys(out).length) byColor.set(seatColor, out);
    }
  } catch (err) {
    // State unknown: the next batch starts on a fresh context.
    if (useShared) freeShared();
    throw err;
  } finally {
    if (!useShared) freeRenderer(held);
    else {
      sharedBusy = false;
      if (shared === held) idleTimer = setTimeout(freeShared, SHOT_RENDERER_IDLE_MS);
    }
  }
  return byColor;
}

/**
 * The canvas as a PNG blob, or null if the browser declines (unsupported type,
 * tainted or lost canvas). A null costs one shot its art.
 */
function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/png");
    } catch {
      resolve(null);
    }
  });
}
