import { expect, test } from "vitest";
import * as THREE from "three";
import { createAtmosphere, moteTexture } from "./atmosphere";
import { boardLook } from "./boardTheme";
import { hexToWorld } from "./coords";
import { HEX_SIZE } from "./manifest.generated";
import { OVERLAY_LAYER } from "./scene";
import type { BoardTile } from "@/lib/types";

/**
 * A one-ring island: seven land hexes with water all round. Most of these
 * tests check nothing is placed over the water.
 */
const LAND: BoardTile[] = [
  { hex: { q: 0, r: 0 }, res: "wheat", num: 6 },
  { hex: { q: 1, r: 0 }, res: "wood", num: 5 },
  { hex: { q: 0, r: 1 }, res: "brick", num: 8 },
  { hex: { q: -1, r: 1 }, res: "ore", num: 3 },
  { hex: { q: -1, r: 0 }, res: "sheep", num: 9 },
  { hex: { q: 0, r: -1 }, res: "none", num: 0 },
  { hex: { q: 1, r: -1 }, res: "gold", num: 4 },
  // A lake is land (a land slab with a pond inset, grass, reeds and trees), so
  // fireflies go over it. See coastline.ts's WATER.
  { hex: { q: -2, r: 1 }, res: "lake", num: 0 },
];
const SEA: BoardTile[] = [
  { hex: { q: 2, r: 0 }, res: "sea", num: 0 },
  { hex: { q: 2, r: -1 }, res: "sea", num: 0 },
  { hex: { q: 0, r: 2 }, res: "fog", num: 0 },
];
const tiles: BoardTile[] = [...LAND, ...SEA];

test("mote texture has a bright core and soft falloff", () => {
  // Quartic falloff. A linear one gives a dot with a visible edge.
  const tex = moteTexture();
  const data = tex.image.data as Uint8Array;
  const n = tex.image.width;
  const alphaAt = (i: number, j: number) => data[(j * n + i) * 4 + 3];
  expect(alphaAt(n / 2, n / 2)).toBeGreaterThan(200);
  expect(alphaAt(n / 2, Math.floor(n * 0.75))).toBeLessThan(60);
  expect(alphaAt(0, 0)).toBe(0);
});

test("builds nothing without post-processing", () => {
  // And no animation loop held open; an empty group that subscribed would
  // keep an idle board rendering.
  const air = createAtmosphere(boardLook("light", false), tiles);
  expect(air.group.children).toHaveLength(0);
  expect(air.animated()).toBe(false);
  air.dispose();
});

test("builds nothing for the day look", () => {
  // No dust by day; the point field is fireflies only.
  const air = createAtmosphere(boardLook("light", true), tiles);
  expect(air.group.children).toHaveLength(0);
  expect(air.animated()).toBe(false);
  air.dispose();
});

test("fireflies are small and stay below the peaks", () => {
  // Bounds come from the art: a sheep on the pasture tile is 0.44 tall, a
  // mountain's peaks stand 1.78 over the slab, and the field runs from a land
  // hex's top face (0.25) to 1.75. What must hold is the relation: an insect is
  // a fraction of a sheep and flies below the skyline.
  const look = boardLook("dark", true);
  expect(look.motes!.size).toBeGreaterThan(0.44 / 10);
  expect(look.motes!.size).toBeLessThan(0.44);
  const air = createAtmosphere(look, tiles);
  const position = (air.group.children[0] as THREE.Points).geometry.getAttribute("position");
  air.update(600_000);
  const xyz = position.array as Float32Array;
  for (let i = 0; i < position.count; i++) {
    expect(xyz[i * 3 + 1]).toBeGreaterThanOrEqual(0.25);
    expect(xyz[i * 3 + 1]).toBeLessThan(1.75);
  }
  air.dispose();
});

test("builds the look's mote count on the overlay layer", () => {
  // OVERLAY_LAYER is drawn by the live pass; a mesh not on it would be baked
  // into the cached board and freeze.
  const look = boardLook("dark", true);
  const air = createAtmosphere(look, tiles);
  const points = air.group.children[0] as THREE.Points;
  expect(points.geometry.getAttribute("position").count).toBe(look.motes!.count);
  const overlay = new THREE.Layers();
  overlay.set(OVERLAY_LAYER);
  expect(points.layers.test(overlay)).toBe(true);
  expect(air.animated()).toBe(true);
  air.dispose();
});

test("fireflies stay over land hexes while drifting", () => {
  // Fireflies are placed per land hex, never over open water. Checked after a
  // long drift too: the placement radius is shortened by the sway's diagonal
  // so the sway cannot carry one off its hex.
  const air = createAtmosphere(boardLook("dark", true), tiles);
  const position = (air.group.children[0] as THREE.Points).geometry.getAttribute("position");
  const inradius = (HEX_SIZE * Math.sqrt(3)) / 2;
  const centres = LAND.map((t) => hexToWorld(t.hex));
  const overLand = () => {
    const xyz = position.array as Float32Array;
    for (let i = 0; i < position.count; i++) {
      const nearest = Math.min(
        ...centres.map(([cx, , cz]) => Math.hypot(xyz[i * 3] - cx, xyz[i * 3 + 2] - cz)),
      );
      expect(nearest).toBeLessThanOrEqual(inradius);
    }
  };
  overLand();
  air.update(600_000);
  overLand();
  air.dispose();
});

test("fireflies are spread evenly across land hexes", () => {
  // Dealt round-robin by tile, not area, so every land hex gets within one of
  // the same share.
  const look = boardLook("dark", true);
  const air = createAtmosphere(look, tiles);
  const position = (air.group.children[0] as THREE.Points).geometry.getAttribute("position");
  const xyz = position.array as Float32Array;
  const per = new Map<number, number>();
  for (let i = 0; i < position.count; i++) {
    let best = 0;
    let bestD = Infinity;
    LAND.forEach((t, j) => {
      const [cx, , cz] = hexToWorld(t.hex);
      const d = Math.hypot(xyz[i * 3] - cx, xyz[i * 3 + 2] - cz);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    per.set(best, (per.get(best) ?? 0) + 1);
  }
  expect(per.size).toBe(LAND.length);
  const share = look.motes!.count / LAND.length;
  for (const n of per.values()) {
    expect(Math.abs(n - share)).toBeLessThanOrEqual(1);
  }
  air.dispose();
});

test("the field is seeded", () => {
  // Seeded, so two players see the same air and screenshots are reproducible.
  const look = boardLook("dark", true);
  const a = createAtmosphere(look, tiles);
  const b = createAtmosphere(look, tiles);
  const posOf = (air: ReturnType<typeof createAtmosphere>) =>
    Array.from(
      (air.group.children[0] as THREE.Points).geometry.getAttribute("position")
        .array as Float32Array,
    );
  expect(posOf(a)).toEqual(posOf(b));
  a.dispose();
  b.dispose();
});

test("motes drift and wrap vertically", () => {
  // Advancing the clock a lot catches a missing wrap: every mote must stay
  // inside its slab of air, which starts at a land hex's top face.
  const air = createAtmosphere(boardLook("dark", true), tiles);
  const points = air.group.children[0] as THREE.Points;
  const position = points.geometry.getAttribute("position");
  const before = (position.array as Float32Array).slice();
  air.update(600_000);
  const after = position.array as Float32Array;
  expect(Array.from(after)).not.toEqual(Array.from(before));
  for (let i = 0; i < position.count; i++) {
    const y = after[i * 3 + 1];
    expect(y).toBeGreaterThanOrEqual(0.25);
    expect(y).toBeLessThan(0.25 + 2.6);
  }
  air.dispose();
});

test("re-applying the same look does not rebuild the field", () => {
  // Toggling back and forth should not rebuild an identical field.
  const air = createAtmosphere(boardLook("dark", true), tiles);
  const first = air.group.children[0];
  air.setLook(boardLook("dark", true));
  expect(air.group.children[0]).toBe(first);
  air.dispose();
});

test("toggling post-processing clears and rebuilds the field", () => {
  const air = createAtmosphere(boardLook("dark", true), tiles);
  expect(air.group.children).toHaveLength(1);
  air.setLook(boardLook("dark", false));
  expect(air.group.children).toHaveLength(0);
  expect(air.animated()).toBe(false);
  air.setLook(boardLook("dark", true));
  expect(air.group.children).toHaveLength(1);
  air.dispose();
});
