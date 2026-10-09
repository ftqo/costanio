import { test, expect } from "vitest";
import { planPieces } from "./pieces";
import { vertexToWorld, edgeToWorld } from "../coords";

const view = {
  buildings: [
    { v: { q: 0, r: 0, side: 0 as const }, owner: 0, city: false },
    { v: { q: 1, r: 0, side: 1 as const }, owner: 2, city: true },
  ],
  roads: [
    { e: { a: { q: 0, r: 0, side: 0 as const }, b: { q: 0, r: 0, side: 1 as const } }, owner: 1 },
  ],
};

test("settlements and cities are distinguished by the city flag", () => {
  const out = planPieces(view);
  expect(out.find((p) => p.kind === "settlement")?.owner).toBe(0);
  expect(out.find((p) => p.kind === "city")?.owner).toBe(2);
});

test("buildings sit on their vertex", () => {
  const p = planPieces(view).find((p) => p.kind === "settlement")!;
  const [x, , z] = vertexToWorld({ q: 0, r: 0, side: 0 });
  expect(p.position[0]).toBeCloseTo(x, 5);
  expect(p.position[2]).toBeCloseTo(z, 5);
});

test("roads sit on their edge midpoint and carry a rotation", () => {
  const p = planPieces(view).find((p) => p.kind === "road")!;
  const [x, , z] = edgeToWorld(view.roads[0].e);
  expect(p.position[0]).toBeCloseTo(x, 5);
  expect(p.position[2]).toBeCloseTo(z, 5);
  expect(Number.isFinite(p.rotationY)).toBe(true);
});

test("an empty board plans no pieces", () => {
  expect(planPieces({ buildings: [], roads: [] })).toEqual([]);
});
