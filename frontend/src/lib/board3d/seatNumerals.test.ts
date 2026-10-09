import { test, expect } from "vitest";
import * as THREE from "three";
import { buildSeatNumerals, disposeSeatNumerals, NUMERAL_SIZE } from "./seatNumerals";
import type { Placement } from "./instancing";

const at = (x: number, z: number): Placement => ({ position: [x, 0, z] });

test("one numeral per placement, none for an empty list", () => {
  expect(buildSeatNumerals(1, [], 1)).toEqual([]);
  expect(buildSeatNumerals(1, [at(0, 0), at(1, 1), at(2, 2)], 1)).toHaveLength(3);
});

test("a numeral sits above the piece it labels, over its footprint", () => {
  const [s] = buildSeatNumerals(4, [at(2, -3)], 1.5);
  // Same spot on the board as the building...
  expect(s.position.x).toBe(2);
  expect(s.position.z).toBe(-3);
  // ...and clear of its top, or it would be buried in a city's towers.
  expect(s.position.y).toBeGreaterThan(1.5);
});

test("a taller piece pushes its numeral higher by the same amount", () => {
  const [low] = buildSeatNumerals(1, [at(0, 0)], 1);
  const [high] = buildSeatNumerals(1, [at(0, 0)], 3);
  expect(high.position.y - low.position.y).toBeCloseTo(2, 6);
});

test("numerals are drawn as overlay, above the pieces they label", () => {
  const [s] = buildSeatNumerals(7, [at(0, 0)], 1);
  const m = s.material;
  // This mark is for the player who cannot resolve the piece under it.
  expect(m.depthTest).toBe(false);
  expect(m.depthWrite).toBe(false);
  expect(m.transparent).toBe(true);
  expect(s.renderOrder).toBeGreaterThan(0);
  // Sized in world units, and never culled by the board's extent.
  expect(s.scale.x).toBeCloseTo(NUMERAL_SIZE, 6);
  expect(s.frustumCulled).toBe(false);
});

test("all of a seat's numerals share one material", () => {
  // The dark outline keeps one texture legible on every seat colour, and a
  // shared material keeps draw calls down.
  const sprites = buildSeatNumerals(2, [at(0, 0), at(1, 0), at(2, 0)], 1);
  const mats = new Set(sprites.map((s) => s.material));
  expect(mats.size).toBe(1);
});

test("different seats get different materials", () => {
  const a = buildSeatNumerals(1, [at(0, 0)], 1);
  const b = buildSeatNumerals(2, [at(0, 0)], 1);
  expect(a[0].material).not.toBe(b[0].material);
});

test("disposal frees each shared material exactly once", () => {
  const sprites = buildSeatNumerals(3, [at(0, 0), at(1, 0)], 1);
  const mat = sprites[0].material;
  let disposed = 0;
  mat.addEventListener("dispose", () => {
    disposed++;
  });
  disposeSeatNumerals(sprites);
  // Two sprites, one material: disposing it twice is a double free.
  expect(disposed).toBe(1);
});

test("disposal detaches sprites from the scene", () => {
  const scene = new THREE.Scene();
  const sprites = buildSeatNumerals(5, [at(0, 0), at(1, 1)], 1);
  for (const s of sprites) scene.add(s);
  expect(scene.children).toHaveLength(2);
  disposeSeatNumerals(sprites);
  expect(scene.children).toHaveLength(0);
});
