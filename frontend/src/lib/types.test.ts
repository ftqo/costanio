import { test, expect } from "vitest";
import { barbDist, BARB_DIST_DEFAULT, resIndexOf, type FullView } from "./types";

/** A view carrying nothing but the config the barbarian track reads. */
const withCfg = (knights?: Record<string, unknown>) =>
  ({ config: { modules: knights ? { cak: knights } : undefined } }) as unknown as FullView;

test("barbDist falls back to the default outside the engine's range", () => {
  // Mirrors the engine's clamp; both places that draw the track must use the
  // same fallback.
  expect(barbDist(withCfg())).toBe(BARB_DIST_DEFAULT);
  expect(barbDist(withCfg({}))).toBe(BARB_DIST_DEFAULT);
  expect(barbDist(withCfg({ barbarian_distance: 4 }))).toBe(4);
  expect(barbDist(withCfg({ barbarian_distance: 12 }))).toBe(12);
  expect(barbDist(withCfg({ barbarian_distance: 3 }))).toBe(BARB_DIST_DEFAULT);
  expect(barbDist(withCfg({ barbarian_distance: 13 }))).toBe(BARB_DIST_DEFAULT);
  // 0 is a configured value, not an absent one, so it clamps rather than passing.
  expect(barbDist(withCfg({ barbarian_distance: 0 }))).toBe(BARB_DIST_DEFAULT);
});

test("resIndexOf accepts a name or an index", () => {
  // Commercial Harbor's `harbor_give` is a board.Resource, encoded by the
  // server as a name, so it must be mapped to an index before lookup.
  expect(resIndexOf("brick")).toBe(2);
  expect(resIndexOf("ore")).toBe(5);
  expect(resIndexOf(3)).toBe(3);
  expect(resIndexOf("none")).toBe(0);
  expect(resIndexOf(undefined)).toBe(0);
  expect(resIndexOf(9)).toBe(0);
});
