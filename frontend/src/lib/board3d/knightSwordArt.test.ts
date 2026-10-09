// The sword has to end up in the hand, and that is a measurement.
//
// The six sword objects are authored at their grips as children of the
// knight, so the offset that puts one in a hand is a node translation in
// `knights.glb`, not a renderer constant. Everything below measures that file;
// a sword that misses the hand reads as a knight beside a floating blade.
//
// Read straight out of the GLB rather than through the loader, like
// pieceFacing.test.ts, because the loader needs WebGL. Node transforms are
// applied because the export writes placement as a node transform rather
// than baking it in, so accessor bounds alone would miss a moved node.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KNIGHT_PREFIX, KNIGHT_SWORD_PREFIX, SWORD_STATE } from "./layers/knights";
import { KNIGHT_GRIP, KNIGHT_ART_HEIGHT, SWORD_REST_TILT } from "./knightSword";
import { MODULE_SCALE } from "./pieceArt";
import { SURFACE } from "./seating";
import { PLAIN_MODELS } from "@/testGlbFixtures";

// The plain copies: the shipped ones are meshopt-encoded and this parses the
// container. See src/testGlbFixtures.ts.
const MODELS = PLAIN_MODELS;

interface ArtNode {
  name: string;
  /** The node's own translation, x/y/z. */
  at: [number, number, number];
  /** Bounds of the node's geometry, with its translation and scale applied. */
  lo: [number, number, number];
  hi: [number, number, number];
}

/**
 * The nodes named `prefix*` in a GLB, with each node's own transform applied.
 *
 * A yaw does not touch y, and nothing here is tipped (asserted, since a tipped
 * node would make every number wrong). That also lets the dark and gold
 * swords be compared by bounding box: both poses are baked into geometry, so
 * their nodes carry only a translation.
 */
function nodesUnder(file: string, prefix: string): ArtNode[] {
  const buf = readFileSync(join(MODELS, file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));

  const out: ArtNode[] = [];
  for (const node of gltf.nodes) {
    if (typeof node.name !== "string" || !node.name.startsWith(prefix)) continue;
    if (node.mesh === undefined) continue;
    const q = node.rotation ?? [0, 0, 0, 1];
    expect(Math.abs(q[0]) + Math.abs(q[2]), `${node.name} is tipped, not just turned`).toBeLessThan(
      1e-6,
    );
    const t = (node.translation ?? [0, 0, 0]) as [number, number, number];
    const s = (node.scale ?? [1, 1, 1]) as [number, number, number];
    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const prim of gltf.meshes[node.mesh].primitives) {
      // POSITION accessors are required to carry bounds, so no vertex walk.
      const acc = gltf.accessors[prim.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], acc.min[i] * s[i] + t[i], acc.max[i] * s[i] + t[i]);
        hi[i] = Math.max(hi[i], acc.min[i] * s[i] + t[i], acc.max[i] * s[i] + t[i]);
      }
    }
    out.push({ name: node.name, at: t, lo, hi });
  }
  expect(out.length, `${prefix}: no geometry found in ${file}`).toBeGreaterThan(0);
  return out;
}

/** The combined bounds of every node under a prefix. */
function span(file: string, prefix: string): { lo: number[]; hi: number[] } {
  const found = nodesUnder(file, prefix);
  return {
    lo: [0, 1, 2].map((i) => Math.min(...found.map((n) => n.lo[i]))),
    hi: [0, 1, 2].map((i) => Math.max(...found.map((n) => n.hi[i]))),
  };
}

/** The single node under a prefix, which is what each of the six swords is. */
function only(file: string, prefix: string): ArtNode {
  const found = nodesUnder(file, prefix);
  expect(
    found.map((n) => n.name),
    `${prefix} is not exactly one node`,
  ).toHaveLength(1);
  return found[0];
}

/** How Board3D seats a piece: `seatY`, spelled out. See seating.ts. */
const seatY = (surface: number, baseY: number, scale: number) => surface - scale * baseY;

const KNIGHTS = "knights.glb";
const S = MODULE_SCALE.knight;

const LEVELS = KNIGHT_PREFIX.map((body, level) => ({ level, body }));

/** The gold (raised) and dark (at ease) sword of one level. */
const swordsOf = (level: number) => ({
  gold: only(KNIGHTS, `${KNIGHT_SWORD_PREFIX[level]}${SWORD_STATE.ready}`),
  dark: only(KNIGHTS, `${KNIGHT_SWORD_PREFIX[level]}${SWORD_STATE.atEase}`),
});

test("every knight is anchored with its base on y = 0", () => {
  // `Board3D` gives a sword the knight's seat, so the knight's base must be
  // the art's zero or every grip below is measured from the wrong place.
  for (const prefix of KNIGHT_PREFIX) {
    expect(span(KNIGHTS, prefix).lo[1], `${prefix} is not anchored at y = 0`).toBeCloseTo(0, 5);
  }
});

test("the three knight heights match the promotion growth", () => {
  // `KNIGHT_GROW_START` is a ratio of two of these, so a body height change
  // changes how far a promotion grows.
  const heights = KNIGHT_PREFIX.map((p) => span(KNIGHTS, p).hi[1]);
  heights.forEach((h, level) => expect(h).toBeCloseTo(KNIGHT_ART_HEIGHT[level], 5));
  // Three different heights, in order, or a promotion shows no size change.
  expect(heights[0]).toBeLessThan(heights[1]);
  expect(heights[1]).toBeLessThan(heights[2]);
});

test.each(LEVELS)("$body ships both of its swords", ({ level }) => {
  for (const state of Object.values(SWORD_STATE)) {
    const prefix = `${KNIGHT_SWORD_PREFIX[level]}${state}`;
    expect(only(KNIGHTS, prefix).name).toBe(prefix);
  }
});

test.each(LEVELS)("$body's sword hangs from the grip it is drawn at", ({ level }) => {
  // The grip is the node's own translation, shared by both states: one sword
  // in two poses, turned about the point the hand closes on.
  const [gx, gy] = KNIGHT_GRIP[level];
  for (const state of Object.values(SWORD_STATE)) {
    const sword = only(KNIGHTS, `${KNIGHT_SWORD_PREFIX[level]}${state}`);
    expect(sword.at[0], `${sword.name} x`).toBeCloseTo(gx, 5);
    expect(sword.at[1], `${sword.name} y`).toBeCloseTo(gy, 5);
    // Out to the side, not fore or aft; `swordPivot` returns no z because of
    // this.
    expect(sword.at[2], `${sword.name} z`).toBeCloseTo(0, 5);
  }
});

test.each(LEVELS)("$body's grip is in its hand", ({ level, body }) => {
  const knight = span(KNIGHTS, body);
  const [gx, gy] = KNIGHT_GRIP[level];

  // Inside the knight's silhouette. The arm is part of the body mesh and
  // cannot be measured alone, so this stands in: a grip outside the knight's
  // bounding box is a sword held by nothing.
  expect(gx).toBeGreaterThanOrEqual(knight.lo[0]);
  expect(gy).toBeGreaterThan(knight.lo[1]);
  expect(gy).toBeLessThan(knight.hi[1]);

  // At the outer edge, away from the shield. A grip near the middle would be
  // inside the chest; this fails if a re-authored arm stops reaching.
  expect(gx - knight.lo[0]).toBeLessThan(0.04);
  expect(gx).toBeLessThan(0);
  // The shield (`Seat_Detail`, the one flat panel) is on +x on all three
  // bodies, so the sword is on -x and the raise sweeps away from it.
  expect(knight.hi[0]).toBeGreaterThan(0);

  // At shoulder height: 64-67% of the body, within 0.013 of the torso/head
  // seam on all three levels. The upper bound caps the design:
  // `grip = clearance + reach * |cos(tilt)|`, so the highest hand sets how near
  // vertical a blade this long can rest. Above the shoulder would be an arm
  // raised over the head; 124 degrees of lean is the result.
  const height = knight.hi[1] - knight.lo[1];
  expect(gy / height).toBeGreaterThan(0.55);
  expect(gy / height).toBeLessThan(0.7);
});

test.each(LEVELS)("$body's blade is as long as the knight is tall", ({ level, body }) => {
  // The size check. The reach (grip to point) is what the bounding box sees:
  // the blade plus the guard and half the handle. So the band is the blade
  // fraction (1.00) plus that hardware, 0.11-0.13 of a body height. A
  // half-height blade (0.61-0.63) or a dagger (0.46) fails.
  //
  // The upper bound says the sword is a body long and no longer: beyond it the
  // reach exceeds the grip height by enough that no pose keeps the resting
  // point near the piece.
  const height = span(KNIGHTS, body).hi[1];
  const { gold } = swordsOf(level);
  const reach = gold.hi[1] - KNIGHT_GRIP[level][1];
  expect(reach / height, `level ${level} reach`).toBeGreaterThan(1.1);
  expect(reach / height, `level ${level} reach`).toBeLessThan(1.14);
});

test.each(LEVELS)("$body's crossguard reads from every bearing", ({ level, body }) => {
  // At forty units away the crossguard is what says "sword", so it has two
  // jobs, each asserted here.
  //
  // Big enough to see: a quarter of the knight's width, measured against the
  // piece so it survives rescaling.
  const knight = span(KNIGHTS, body);
  const { gold } = swordsOf(level);
  const [gx] = KNIGHT_GRIP[level];
  const guard = gold.hi[0] - gold.lo[0];
  expect(guard).toBeGreaterThan(0.25 * (knight.hi[0] - knight.lo[0]));

  // Square in plan rather than a bar. The sword's plane is fixed
  // (SWORD_FLIP_AXIS_Y) while the board orbits, so a bar guard would be
  // edge-on from some bearings; square, it projects its full width from every
  // bearing the controls allow.
  expect(gold.hi[2] - gold.lo[2]).toBeCloseTo(guard, 4);
  // Centred on the grip, so it is a crossguard rather than a hook.
  expect((gold.hi[0] + gold.lo[0]) / 2).toBeCloseTo(gx, 4);
  expect((gold.hi[2] + gold.lo[2]) / 2).toBeCloseTo(0, 4);
});

test.each(LEVELS)("$body's sword is seated in the hand on the board", ({ level, body }) => {
  // As Board3D does it: the sword takes the knight's seat with a base of 0, so
  // the node offset lands it in the hand. Seating it by its own base, as every
  // other piece is, would stand each sword on the ground.
  const knight = span(KNIGHTS, body);
  const at = seatY(SURFACE.gutter, 0, S);
  const [, gy] = KNIGHT_GRIP[level];
  const gripY = at + S * gy;

  expect(at).toBeCloseTo(SURFACE.gutter, 5);
  expect(gripY).toBeGreaterThan(SURFACE.gutter);
  expect(gripY).toBeLessThan(SURFACE.gutter + knight.hi[1] * S);
  // The naive seating would not: the gold sword's own base is above the
  // knight's, so seating by it lifts the sword clear of the hand.
  const { gold } = swordsOf(level);
  expect(gold.lo[1]).toBeGreaterThan(0);
  expect(seatY(SURFACE.gutter, gold.lo[1], S) + S * gy).toBeLessThan(gripY);
});

test.each(LEVELS)("$body's resting sword points down and outward", ({ level }) => {
  const [, gy] = KNIGHT_GRIP[level];
  const { gold, dark } = swordsOf(level);

  // Down: the dark sword reaches below its grip, the gold one above it.
  expect(dark.lo[1]).toBeLessThan(gy);
  expect(gold.hi[1]).toBeGreaterThan(gy);
  // Outward: away from the body, which is -x, so the raise sweeps into open air.
  expect(dark.lo[0]).toBeLessThan(dark.at[0]);

  // Resting on the ground, in a narrow band just above it. The grip is
  // derived from this (`edit_geometry.sword_grip_z`), so the clearance is an
  // input and both bounds are real.
  //
  // The floor is 0.015: the point rests over the neighbouring tile, not the
  // gutter, and a tile's top face is 0.03 world units above the gutter sand
  // (0.015 in art space, since a knight is drawn at 2x).
  //
  // The ceiling is 0.03. A higher point does not pull it in (outward swing is
  // `reach * sin(tilt) + |grip|`), it only raises the hand, which is already at
  // the shoulder.
  expect(dark.lo[1]).toBeGreaterThan(0.015);
  expect(dark.lo[1]).toBeLessThan(0.03);
});

test.each(LEVELS)("$body's dark sword is its gold one at SWORD_REST_TILT", ({ level }) => {
  // The raise turns the gold sword from SWORD_REST_TILT back to zero, so on
  // its first frame it must stand exactly where the dark sword was, or
  // activation jumps.
  //
  // Checked on the point, not the box: the bounding box of rotated geometry is
  // not the rotation of its bounding box, so comparing boxes fails by several
  // centimetres on correct art. The point is uniquely the highest vertex of
  // the gold sword and the lowest, outermost of the dark one, so it can be
  // turned and compared exactly.
  const { gold, dark } = swordsOf(level);
  const [gx, gy] = KNIGHT_GRIP[level];
  const reach = gold.hi[1] - gy;

  // Turned about world +Z, which is what SWORD_FLIP_AXIS_Y selects: a point at
  // (0, reach) above the grip lands at (-reach sin, reach cos).
  expect(dark.lo[0] - gx).toBeCloseTo(-reach * Math.sin(SWORD_REST_TILT), 5);
  expect(dark.lo[1] - gy).toBeCloseTo(reach * Math.cos(SWORD_REST_TILT), 5);
  // The turn is about a vertical plane's normal, so depth cannot change. Equal
  // depth says these are the same blade.
  expect(dark.hi[2] - dark.lo[2]).toBeCloseTo(gold.hi[2] - gold.lo[2], 5);
  expect(dark.at).toEqual(gold.at);
});

test("a mightier knight carries a bigger sword", () => {
  // Rank shows in the weapon as well as the crest: the raised sword is where
  // the eye goes, and three identical blades would flatten the levels.
  const reach = KNIGHT_SWORD_PREFIX.map(
    (_p, level) => swordsOf(level).gold.hi[1] - KNIGHT_GRIP[level][1],
  );
  expect(reach[0]).toBeLessThan(reach[1]);
  expect(reach[1]).toBeLessThan(reach[2]);
});

test("a raised sword stands clear above the knight without becoming a pike", () => {
  // A raised sword must change the silhouette, not just the colour: the point
  // rises three quarters of a body above the helmet, so the outline shows
  // which knights are ready.
  //
  // The raised height is `grip + reach`, both pinned above, so this checks the
  // pair: a length change that forgot to move the hand, or the reverse.
  //
  // The upper bound is a real constraint: `Board3D` sets its camera ceiling
  // from what is on the board, and an active mighty knight is the tallest
  // thing at 3.01 world units against terrain at 2.29.
  for (const { level, body } of LEVELS) {
    const knight = span(KNIGHTS, body);
    const { gold } = swordsOf(level);
    expect(gold.hi[1], `level ${level} too low`).toBeGreaterThan(knight.hi[1] * 1.7);
    expect(gold.hi[1], `level ${level} too tall`).toBeLessThan(knight.hi[1] * 1.9);
  }
});

test("a resting sword does not reach out past the piece's own neighbourhood", () => {
  // A blade a body long, laid out and down, swings its point over the next
  // tile rather than the gutter (1.59 / 2.00 / 2.28), so this is a budget on
  // how far it may intrude.
  //
  // Derived in world units (see the edit script's table). The lean runs along
  // the knight's local -x and knights have no yaw, so it is world -x on every
  // vertex, 30 degrees off one of the vertex's three gutters on both parities.
  //
  //  - Roads: clear on every board. A road bar is 0.24 wide and its nearest end
  //    is 0.50 out, where the blade is already 0.25 off the gutter's centre
  //    line and diverging faster than the road widens.
  //  - Neighbouring pieces: clear. The next vertex is 3.144 away along a gutter
  //    and the mighty knight's point stops 1.63 from it, against a plinth
  //    radius of 0.61. Two neighbours lean the same way, so their points stay
  //    3.14 apart.
  //  - Terrain: not clear, by choice. The point lands about 0.97 inside the
  //    neighbouring tile at 0.04 above the gutter, so the last third of the
  //    blade passes through small-prop height. The edit script's docstring
  //    covers the trade.
  //
  // 2.35 is the mighty knight plus a little, so any further lean or length has
  // to come back through this test.
  for (const { level } of LEVELS) {
    const { dark } = swordsOf(level);
    const out = Math.abs(dark.lo[0] - dark.at[0]) + Math.abs(dark.at[0]);
    expect(out * S, `level ${level} reaches too far out`).toBeLessThan(2.35);
  }
});
