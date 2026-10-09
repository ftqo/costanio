import { test, expect } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SHOP_SHOTS,
  DEV_DECK_SHOT,
  cardStack,
  SLAB_THICKNESS,
  SLAB_PITCH,
  shotDirection,
  frameSubject,
  subjectPoints,
  renderShotBlobs,
  stagePart,
  applyPose,
  disposeStaged,
  THUMB_W,
  THUMB_H,
  type ScenePart,
} from "./thumbnail";
import { seatTint } from "./tint";
import { newGLTFLoader } from "./loader";

const MODELS = join(__dirname, "..", "..", "..", "public", "models");

/**
 * A shipped model, parsed off disk. The ArrayBuffer is rebuilt in this realm:
 * node's Buffer carries one from another realm, and GLTFLoader's GLB path
 * checks `instanceof ArrayBuffer`, so the Buffer's own would parse as JSON.
 */
function loadGlb(file: string): Promise<THREE.Group> {
  const buf = readFileSync(join(MODELS, file));
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new Promise((resolve, reject) =>
    newGLTFLoader().parse(ab, "", (g) => resolve(g.scene), reject),
  );
}

function meshNames(file: string): string[] {
  const buf = readFileSync(join(MODELS, file));
  const jsonLength = buf.readUInt32LE(12);
  const j = JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8"));
  return (j.meshes ?? []).map((m: { name?: string }) => m.name ?? "");
}

test("every shot names parts that exist in the shipped models", () => {
  for (const shot of [...SHOP_SHOTS, DEV_DECK_SHOT]) {
    for (const part of shot.parts) {
      const hit = meshNames(part.file).filter((n) => n.startsWith(part.prefix));
      expect(hit.length, `${shot.slot}: ${part.file} has no ${part.prefix}*`).toBeGreaterThan(0);
    }
  }
});

/**
 * The source of a file under frontend/src, sliced from a required marker. A
 * missing marker throws, since `slice(-1)` would silently scope the guard to
 * the wrong text.
 */
function srcOf(...parts: string[]): string {
  return readFileSync(join(__dirname, "..", "..", ...parts), "utf8");
}
function region(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`marker not found: ${JSON.stringify(from)}`);
  const b = src.indexOf(to, a);
  if (b < 0)
    throw new Error(`marker not found after ${JSON.stringify(from)}: ${JSON.stringify(to)}`);
  return src.slice(a, b);
}

/**
 * Every art slot the game can ask for a card of, read off the places that
 * offer cards rather than off SHOP_SHOTS:
 *
 *   * the location menu (lib/locationActions builds the roster, and
 *     components/game/LocationDial resolves each action to `a.art ?? CARD_ART[a.id]
 *     ?? a.id`), and
 *   * the build shelf in routes/Game.tsx, which is every `<ShopArt slot=...>`
 *     plus the three improvement tracks in IMPROVE_SLOT.
 *
 * An offered card with no shot comes up blank.
 */
function offeredSlots(): Set<string> {
  const dial = srcOf("components", "game", "LocationDial.tsx");
  const actions = srcOf("lib", "locationActions.ts");
  const game = srcOf("routes", "Game.tsx");

  // id -> slot, for the ids whose art is not their own name.
  const cardArt = new Map<string, string>();
  for (const m of region(dial, "const CARD_ART: Record<string, string> = {", "\n};").matchAll(
    /^\s*([a-z_]+):\s*"([a-z_]+)",/gm,
  )) {
    cardArt.set(m[1], m[2]);
  }
  expect(cardArt.size, "CARD_ART in LocationDial.tsx parsed empty").toBeGreaterThan(4);

  const roster = region(actions, "export function actionsAt(", "\nexport function canAffordAction");
  const out = new Set<string>();
  // Each action literal, from its `id:` to the next. An entry with its own
  // `art:` (promotion shows the tier being bought) contributes those slots
  // instead of its id, so there is no `promote_knight` shot.
  const entries = roster.split(/\bid: "/).slice(1);
  for (const entry of entries) {
    const id = entry.slice(0, entry.indexOf('"'));
    const art = entry.match(/\n\s*art:[^\n]*/);
    if (art) {
      for (const q of art[0].matchAll(/"([a-z_]+)"/g)) out.add(q[1]);
    } else {
      out.add(cardArt.get(id) ?? id);
    }
  }
  expect(out.size, "no action ids found in locationActions.ts").toBeGreaterThan(6);

  // The build shelf.
  const shelf = [...game.matchAll(/<ShopArt\s+slot="([a-z_]+)"/g)].map((m) => m[1]);
  expect(shelf.length, "no <ShopArt slot=...> found in Game.tsx").toBeGreaterThan(4);
  for (const s of shelf) out.add(s);
  for (const m of region(game, "const IMPROVE_SLOT = [", "];").matchAll(/"([a-z_]+)"/g))
    out.add(m[1]);

  return out;
}

test("shots cover what a player can be offered, and nothing that cannot be", () => {
  const slots = new Set(SHOP_SHOTS.map((s) => s.slot));
  const offered = offeredSlots();

  // Something is offered and there is no shot for it.
  const unshot = [...offered].filter((s) => !slots.has(s)).sort();
  expect(
    unshot,
    `offered with no SHOP_SHOTS entry: ${unshot.join(", ")}. The shop tile and ` +
      `the location-menu card come up blank.`,
  ).toEqual([]);

  // A shot nothing can offer is a render every player pays for and never sees.
  const unoffered = [...slots].filter((s) => !offered.has(s)).sort();
  expect(unoffered, `SHOP_SHOTS entries nothing offers: ${unoffered.join(", ")}`).toEqual([]);

  // A metropolis is awarded at improvement level 4, never chosen, so it has no
  // tile.
  expect([...slots].some((s) => s.includes("metro"))).toBe(false);
});

test("the size ladder is preserved", () => {
  const fill = Object.fromEntries(SHOP_SHOTS.map((s) => [s.slot, s.fill]));
  expect(fill.build_city).toBeGreaterThan(fill.build_settlement);
  expect(fill.build_wall).toBeGreaterThan(fill.build_city);
  for (const s of SHOP_SHOTS) expect(s.fill).toBeGreaterThan(0.4);
});

test("shotDirection is a unit vector above the horizon", () => {
  const d = shotDirection();
  expect(d.length()).toBeCloseTo(1, 6);
  expect(d.y).toBeGreaterThan(0);
  // 34 degree elevation.
  expect((Math.asin(d.y) * 180) / Math.PI).toBeCloseTo(34, 4);
});

test("frameSubject fills the requested share of the height, centred", () => {
  // A unit-ish block of points standing on the ground.
  const pts: THREE.Vector3[] = [];
  for (const x of [-0.5, 0.5])
    for (const y of [0, 1]) for (const z of [-0.5, 0.5]) pts.push(new THREE.Vector3(x, y, z));
  const dir = shotDirection();
  const aspect = THUMB_W / THUMB_H;
  for (const fill of [0.5, 0.62, 0.8]) {
    const { distance, target } = frameSubject(pts, dir, fill, aspect);
    const cam = new THREE.PerspectiveCamera(25.6, aspect, 0.01, 1000);
    cam.position.copy(target).addScaledVector(dir, distance);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const q of pts) {
      const p = q.clone().project(cam);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const spanY = (maxY - minY) / 2,
      spanX = (maxX - minX) / 2;
    // Whichever axis binds sits exactly on its target…
    expect(Math.max(spanY / fill, spanX / 0.86), `fill ${fill}`).toBeCloseTo(1, 2);
    // …and the subject is centred, not merely contained.
    expect(Math.abs(minX + maxX), `centre x @ ${fill}`).toBeLessThan(0.01);
    expect(Math.abs(minY + maxY), `centre y @ ${fill}`).toBeLessThan(0.01);
    expect(maxX).toBeLessThanOrEqual(1.001);
    expect(maxY).toBeLessThanOrEqual(1.001);
  }
});

test("framing follows the silhouette, not the bounding box", () => {
  // A diagonal road's axis-aligned box is far larger than the bar. Two point
  // sets with the same box, a sparse diagonal bar and a full block, must not
  // frame at the same distance.
  const dir = shotDirection();
  const aspect = THUMB_W / THUMB_H;
  const bar: THREE.Vector3[] = [];
  for (let t = 0; t <= 20; t++) {
    const u = -1 + (2 * t) / 20;
    bar.push(new THREE.Vector3(u, 0, u * 0.9), new THREE.Vector3(u, 0.16, u * 0.9));
  }
  const block: THREE.Vector3[] = [];
  for (const x of [-1, 1])
    for (const y of [0, 0.16]) for (const z of [-0.9, 0.9]) block.push(new THREE.Vector3(x, y, z));
  const boxA = new THREE.Box3().setFromPoints(bar);
  const boxB = new THREE.Box3().setFromPoints(block);
  expect(boxA.min.distanceTo(boxB.min)).toBeLessThan(1e-9); // identical boxes
  const a = frameSubject(bar, dir, 0.62, aspect).distance;
  const b = frameSubject(block, dir, 0.62, aspect).distance;
  // The bar is thinner than its box, so it can be shot from closer.
  expect(a).toBeLessThan(b);
});

test("subjectPoints reads world-space vertices once", () => {
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geom);
  mesh.position.set(5, 0, 0);
  const g = new THREE.Group();
  g.add(mesh);
  const pts = subjectPoints(g);
  expect(pts.length).toBe(geom.getAttribute("position").count);
  const box = new THREE.Box3().setFromPoints(pts);
  // Positioned once, not twice: centred on 5, not on 10.
  expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(5, 6);
});

// ---- Staging a scene out of parts ----------------------------------------
//
// jsdom has no WebGL and cannot fetch a .glb, so a hand-built source with the
// same shape (named meshes, named MeshStandardMaterials) stands in.

const SEAT = "#ff4f64";

/** A stand-in for a cached asset: one named mesh per entry, modelled off-origin. */
function fakeAsset(
  entries: { name: string; material: string; at?: [number, number, number] }[],
): THREE.Group {
  const root = new THREE.Group();
  for (const e of entries) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ name: e.material }),
    );
    mesh.name = e.name;
    if (e.at) mesh.position.set(...e.at);
    root.add(mesh);
  }
  return root;
}

function centreOf(obj: THREE.Object3D): THREE.Vector3 {
  return new THREE.Box3().setFromPoints(subjectPoints(obj)).getCenter(new THREE.Vector3());
}

function materialsOf(obj: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  obj.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.isMesh) out.push(m.material as THREE.MeshStandardMaterial);
  });
  return out;
}

test("a part with no pose lands exactly where its source does", () => {
  // The shop shots declare no pose, so staging must be the identity on
  // position.
  const src = fakeAsset([{ name: "City_A", material: "Seat_Body", at: [5, 0, -2] }]);
  const g = stagePart(src, { file: "pieces.glb", prefix: "City_A" }, SEAT);
  const c = centreOf(g);
  expect(c.x).toBeCloseTo(5, 6);
  expect(c.y).toBeCloseTo(0, 6);
  expect(c.z).toBeCloseTo(-2, 6);
});

test("a part's local transform lands where it should", () => {
  const src = fakeAsset([{ name: "Road_A", material: "Seat_Body", at: [5, 0, 0] }]);
  // Scale, then a quarter turn about Y, then the offset: (5,0,0) -> (10,0,0) ->
  // (0,0,-10) -> (0,2,-10).
  const g = stagePart(
    src,
    { file: "pieces.glb", prefix: "Road_A", scale: 2, turnDeg: 90, at: [0, 2, 0] },
    SEAT,
  );
  const c = centreOf(g);
  expect(c.x).toBeCloseTo(0, 5);
  expect(c.y).toBeCloseTo(2, 5);
  expect(c.z).toBeCloseTo(-10, 5);
  // Measured at its composed size, which is what the framing solve sees.
  const box = new THREE.Box3().setFromPoints(subjectPoints(g));
  expect(box.max.y - box.min.y).toBeCloseTo(2, 5);
});

test("a part takes all three turns, not only yaw", () => {
  const src = fakeAsset([{ name: "Knight_basic", material: "Seat_Body", at: [0, 0, 1] }]);
  // -90 degrees about X carries +z up to +y.
  const g = stagePart(
    src,
    { file: "knights.glb", prefix: "Knight_basic", turnDeg: [-90, 0, 0] },
    SEAT,
  );
  const c = centreOf(g);
  expect(c.y).toBeCloseTo(1, 5);
  expect(c.z).toBeCloseTo(0, 5);
});

test("applyPose leaves untouched what the pose does not mention", () => {
  const obj = new THREE.Object3D();
  applyPose(obj, {});
  expect(obj.position.toArray()).toEqual([0, 0, 0]);
  expect(obj.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  expect(obj.scale.toArray()).toEqual([1, 1, 1]);
});

test("a tint override does not leak into the shared cache", () => {
  const src = fakeAsset([{ name: "Settlement_A", material: "Seat_Body" }]);
  const shared = materialsOf(src)[0];
  const before = shared.color.clone();
  const neutral = "#3355ff";

  const g = stagePart(src, { file: "pieces.glb", prefix: "Settlement_A", tint: neutral }, SEAT);
  const staged = materialsOf(g)[0];

  // The override wins over the viewer's seat…
  expect(staged.color.getHex()).toBe(seatTint(neutral).Seat_Body.getHex());
  expect(staged.color.getHex()).not.toBe(seatTint(SEAT).Seat_Body.getHex());
  // …on a clone, so the cached asset every board draws from is untouched…
  expect(staged).not.toBe(shared);
  expect(shared.color.getHex()).toBe(before.getHex());
  // …and the memoised tint itself is copied out of, never written into.
  expect(seatTint(neutral).Seat_Body.getHex()).not.toBe(seatTint(SEAT).Seat_Body.getHex());
});

test("fading a part clones rather than mutating the shared material", () => {
  // The wall's stone is not a tint slot, so it comes through shared; making it
  // transparent would affect every wall on the live board.
  const src = fakeAsset([{ name: "Wall_segment_ring_01", material: "Mat_Stone" }]);
  const shared = materialsOf(src)[0];

  const g = stagePart(
    src,
    { file: "walls.glb", prefix: "Wall_segment_ring_01", opacity: 0.45 },
    SEAT,
  );
  const staged = materialsOf(g)[0];

  expect(staged).not.toBe(shared);
  expect(staged.transparent).toBe(true);
  expect(staged.opacity).toBeCloseTo(0.45, 6);
  expect(shared.transparent).toBe(false);
  expect(shared.opacity).toBe(1);
  // A proposal casts no shadow; a placement does.
  expect((g.children[0] as THREE.Mesh).castShadow).toBe(false);
  const solid = stagePart(src, { file: "walls.glb", prefix: "Wall_segment_ring_01" }, SEAT);
  expect((solid.children[0] as THREE.Mesh).castShadow).toBe(true);
  expect(materialsOf(solid)[0]).toBe(shared); // untouched, so still shared
});

test("an improvement prop keeps its authored colours in every seat", () => {
  // The improvement props belong to a track, so their Mat_Improve_* materials
  // keep the authored colours. `isTintSlot` is the guard: renaming them to
  // Seat_* would paint a crown in each seat's colour.
  const src = fakeAsset([
    { name: "Improve_Politics_band", material: "Mat_Improve_Politics_body", at: [0, 0, 0] },
    { name: "Improve_Politics_point", material: "Mat_Improve_Politics_detail", at: [0, 0.2, 0] },
  ]);
  const before = materialsOf(src).map((m) => m.color.getHex());
  for (const seat of ["var(--color-red)", "var(--color-blue)"]) {
    const g = stagePart(src, { file: "improvements.glb", prefix: "Improve_Politics" }, seat);
    // Shared, not cloned: nothing was recoloured, so nothing is ours to free.
    expect(materialsOf(g).map((m) => m.color.getHex())).toEqual(before);
    for (const m of materialsOf(g)) expect(m.userData.shotOwnedMaterial).toBeUndefined();
  }
});

test("disposeStaged frees the clones and leaves the cache's materials alone", () => {
  const src = fakeAsset([
    { name: "Wall_segment_ring_01", material: "Mat_Stone" },
    { name: "Wall_segment_ring_01_b", material: "Seat_Body" },
  ]);
  const [stone, seat] = materialsOf(src);
  const freed: string[] = [];
  for (const m of [stone, seat]) {
    const name = m.name;
    m.dispose = () => freed.push(`shared:${name}`);
  }

  const g = stagePart(src, { file: "walls.glb", prefix: "Wall_segment_ring_01" }, SEAT);
  for (const m of materialsOf(g)) {
    if (m === stone || m === seat) continue;
    const name = m.name;
    m.dispose = () => freed.push(`clone:${name}`);
  }

  disposeStaged(g);
  // The seat slot was cloned and is ours to free; the stone came through by
  // reference and belongs to the cache.
  expect(freed).toEqual(["clone:Seat_Body"]);
});

test("the shop shots stage exactly as they did before", () => {
  // Every part declares only file and prefix, except the robber: nobody owns
  // it, and untinted it would render in the viewer's colour.
  for (const shot of SHOP_SHOTS) {
    for (const part of shot.parts) {
      const allowed =
        shot.slot === "scenario_gold"
          ? ["color", "file", "prefix"]
          : shot.slot === "chase_robber"
            ? ["file", "prefix", "tint"]
            : ["file", "prefix"];
      expect(Object.keys(part).sort(), `${shot.slot}`).toEqual(allowed);
    }
  }
  // Staging with only those fields: tint slots recoloured on a clone,
  // everything else shared, world matrix baked once.
  const src = fakeAsset([
    { name: "City_A_walls", material: "Seat_Body", at: [1.5, 0.25, -0.5] },
    { name: "City_A_roof", material: "Seat_Shade", at: [1.5, 0.9, -0.5] },
    { name: "City_A_trim", material: "Mat_Stone", at: [1.5, 0.1, -0.5] },
    { name: "Other_thing", material: "Seat_Body", at: [40, 0, 0] },
  ]);
  const shared = new Map(materialsOf(src).map((m) => [m.name, m]));
  const part: ScenePart = { file: "pieces.glb", prefix: "City_A" };
  const g = stagePart(src, part, SEAT);

  // Only the prefixed meshes, unmoved.
  expect(g.children.map((c) => c.name)).toEqual(["City_A_walls", "City_A_roof", "City_A_trim"]);
  expect(g.position.toArray()).toEqual([0, 0, 0]);
  expect(g.scale.toArray()).toEqual([1, 1, 1]);
  const tint = seatTint(SEAT);
  for (const child of g.children) {
    const mesh = child as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const source = shared.get(mat.name)!;
    if (mat.name === "Mat_Stone") {
      expect(mat).toBe(source); // shared, untouched, not ours to free
    } else {
      expect(mat).not.toBe(source);
      expect(mat.transparent).toBe(false);
      const want = mat.name === "Seat_Body" ? tint.Seat_Body : tint.Seat_Shade;
      expect(mat.color.getHex()).toBe(want.getHex());
    }
    expect(mesh.castShadow).toBe(true);
  }
  const box = new THREE.Box3().setFromPoints(subjectPoints(g));
  expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(1.5, 6);
});

test("every shop shot stages out of the real models and frames as asked", async () => {
  // The whole pipeline short of the GL context, on the shipped art: select,
  // tint, pose, compose, solve.
  const dir = shotDirection();
  const aspect = THUMB_W / THUMB_H;
  for (const shot of SHOP_SHOTS) {
    const group = new THREE.Group();
    for (const part of shot.parts) group.add(stagePart(await loadGlb(part.file), part, SEAT));
    group.rotation.y = (shot.yawDeg * Math.PI) / 180;

    const points = subjectPoints(group);
    expect(points.length, shot.slot).toBeGreaterThan(0);
    const { distance, target } = frameSubject(points, dir, shot.fill, aspect);
    const cam = new THREE.PerspectiveCamera(25.6, aspect, 0.01, 1000);
    cam.position.copy(target).addScaledVector(dir, distance);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const q of points) {
      const p = q.clone().project(cam);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const spanY = (maxY - minY) / 2,
      spanX = (maxX - minX) / 2;
    expect(Math.max(spanY / shot.fill, spanX / 0.86), `${shot.slot} fill`).toBeCloseTo(1, 2);
    expect(Math.abs(minY + maxY), `${shot.slot} centre`).toBeLessThan(0.01);
    disposeStaged(group);
  }
}, 30000);

// ---- The development deck ------------------------------------------------

test("the shop shots are ungraded, and the graded one is not among them", () => {
  // Exposure is for near-white subjects; the piece shots are graded as they
  // are.
  for (const shot of SHOP_SHOTS) expect(shot.exposure, shot.slot).toBeUndefined();
  expect(DEV_DECK_SHOT.exposure).toBeGreaterThan(0);
  expect(DEV_DECK_SHOT.exposure).toBeLessThan(1);
  // Baked, not photographed per player: it must not join the live set.
  expect(SHOP_SHOTS.map((s) => s.slot)).not.toContain(DEV_DECK_SHOT.slot);
  // It fills the slot the shipped asset fills.
  expect(DEV_DECK_SHOT.slot).toBe("devcard_back");
});

test("the deck is pitched wider than a card is thick", () => {
  // Flush faces are coplanar and z-fight; the gap also draws the line between
  // two cards.
  expect(SLAB_PITCH).toBeGreaterThan(SLAB_THICKNESS);
  const parts = cardStack(6);
  for (let i = 1; i < parts.length; i++) {
    const gap = parts[i].at![1] - parts[i - 1].at![1];
    expect(gap).toBeGreaterThan(SLAB_THICKNESS);
  }
});

test("only the top card of the deck carries the printed face", () => {
  const parts = cardStack(5);
  expect(parts.length).toBe(5);
  // `Card_slab` takes body and face; `Card_slab_body` takes the blank alone.
  expect(parts.at(-1)!.prefix).toBe("Card_slab");
  for (const p of parts.slice(0, -1)) expect(p.prefix).toBe("Card_slab_body");
  expect(parts.every((p) => p.file === "cards.glb")).toBe(true);
});

test("the deck's jitter is small and the same every time", () => {
  const a = cardStack(12);
  const b = cardStack(12);
  expect(a).toEqual(b); // no unseeded randomness: a remount re-renders the same deck
  for (const p of a) {
    expect(Math.abs(p.at![0])).toBeLessThanOrEqual(0.01);
    expect(Math.abs(p.at![2])).toBeLessThanOrEqual(0.01);
    expect(Math.abs(p.turnDeg as number)).toBeLessThanOrEqual(1);
  }
  // …and it is jitter, not a constant offset: the cards differ from each other.
  expect(new Set(a.map((p) => p.at![0])).size).toBe(a.length);
});

test("stages the deck from the real model with shared materials", async () => {
  const src = await loadGlb("cards.glb");
  const group = new THREE.Group();
  for (const part of DEV_DECK_SHOT.parts) group.add(stagePart(src, part, SEAT));

  // As tall as the pitch says, and as wide as one card: a stack, not a fan.
  const box = new THREE.Box3().setFromPoints(subjectPoints(group));
  const cards = DEV_DECK_SHOT.parts.length;
  expect(cards).toBeGreaterThan(1);
  const stack = box.max.y - box.min.y;
  // Bottom card's base to the top card's top face, plus the millimetre the
  // printed panel stands proud on the top card.
  expect(stack).toBeGreaterThanOrEqual((cards - 1) * SLAB_PITCH + SLAB_THICKNESS - 1e-6);
  expect(stack).toBeLessThan((cards - 1) * SLAB_PITCH + SLAB_THICKNESS + 0.02);
  expect(box.max.x - box.min.x).toBeLessThan(1.5);

  // The printed panel appears once, on top.
  const faces: THREE.Object3D[] = [];
  group.traverse((n) => {
    if (n.name === "Card_slab_face") faces.push(n);
  });
  expect(faces.length).toBe(1);

  // Nothing is seat-coloured or faded, so staging clones nothing and
  // disposeStaged must leave the cache's materials alone.
  const shared = new Set<THREE.Material>();
  src.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.isMesh) shared.add(m.material as THREE.Material);
  });
  const freed: string[] = [];
  for (const m of shared) m.dispose = () => freed.push(m.name);
  disposeStaged(group);
  expect(freed).toEqual([]);

  // And it frames as asked, out of the real geometry.
  group.rotation.y = (DEV_DECK_SHOT.yawDeg * Math.PI) / 180;
  const points = subjectPoints(group);
  const aspect = THUMB_W / THUMB_H;
  const { distance, target } = frameSubject(points, shotDirection(), DEV_DECK_SHOT.fill, aspect);
  const cam = new THREE.PerspectiveCamera(25.6, aspect, 0.01, 1000);
  cam.position.copy(target).addScaledVector(shotDirection(), distance);
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  let minY = Infinity,
    maxY = -Infinity,
    minX = Infinity,
    maxX = -Infinity;
  for (const q of points) {
    const p = q.clone().project(cam);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
  }
  expect(Math.max((maxY - minY) / 2 / DEV_DECK_SHOT.fill, (maxX - minX) / 2 / 0.86)).toBeCloseTo(
    1,
    2,
  );
});

test("renderShotBlobs yields nothing without WebGL, and does not throw", async () => {
  // jsdom has no WebGL: the shop tiles' fallback path (no art, no error).
  const got = await renderShotBlobs(["#ff4f64"]);
  expect(got.size).toBe(0);
});

test("renderShotBlobs with no colours does no work at all", async () => {
  // The hooks hit this on every mount before a seat colour is known; it must
  // not create a WebGL context.
  const got = await renderShotBlobs([]);
  expect(got.size).toBe(0);
});
