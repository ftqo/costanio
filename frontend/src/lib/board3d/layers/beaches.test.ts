import { test, expect } from "vitest";
import { planBeaches } from "./beaches";
import { hexToWorld, LATTICE_SIZE } from "../coords";
import { APOTHEM, BEACH_ENVELOPE, BEACH_TUCK, TOP_Y, BEACH_FOOT_Y } from "../beachGeometry";
import type { BoardTile } from "@/lib/types";

const sea = (q: number, r: number): BoardTile => ({ hex: { q, r }, res: "sea", num: 0 });
const land = (q: number, r: number): BoardTile => ({ hex: { q, r }, res: "wood", num: 8 });

/** Every vertex of a built ribbon, as [x, y, z]. */
function verts(geo: THREE_BufferGeometry): [number, number, number][] {
  const a = geo.getAttribute("position");
  return Array.from({ length: a.count }, (_, i) => [a.getX(i), a.getY(i), a.getZ(i)]);
}
type THREE_BufferGeometry = ReturnType<NonNullable<ReturnType<typeof planBeaches>>["dry"]["clone"]>;

test("a lone land tile gets a ring of sand all the way round it", () => {
  // No sea tiles: the coast is a property of the land, not of which water is
  // in the tile list. The ring is one mesh, so check that it surrounds the
  // tile at the right radius.
  const built = planBeaches([land(0, 0)]);
  expect(built).not.toBeNull();
  const points = [...verts(built!.dry), ...verts(built!.wet)];
  expect(points.length).toBeGreaterThan(0);

  const radii = points.map((p) => Math.hypot(p[0], p[2]));
  // Nothing further in than the lip's mitre behind the lattice line...
  expect(Math.min(...radii)).toBeGreaterThan(APOTHEM - BEACH_TUCK * 1.16 - 1e-6);
  // ...and nothing further out than the scene reserves, which is measured off
  // the tile's corners (`boardFitPoints` pushes out along each corner's
  // radial). A headland's fan is centred on a corner, so that reach binds:
  // 4.47, and the ring comes in at 3.92. A lone hex is all headlands and the
  // smoothing pulls each in, so nothing nears the bay's mitre.
  expect(Math.max(...radii)).toBeLessThan(LATTICE_SIZE + BEACH_ENVELOPE + 1e-6);
  // Sand on all six sides, or a coastline with a gap in it.
  const bearings = new Set(
    points.map((p) => Math.floor((Math.atan2(p[2], p[0]) + Math.PI) / (Math.PI / 6)) % 12),
  );
  expect(bearings.size).toBe(12);
});

test("the ribbon spans the whole profile, crest to submerged foot", () => {
  const built = planBeaches([land(0, 0)])!;
  const dryYs = verts(built.dry).map((p) => p[1]);
  const wetYs = verts(built.wet).map((p) => p[1]);
  // The dry mesh reaches the land's own height and stops at the wet line.
  expect(Math.max(...dryYs)).toBeCloseTo(TOP_Y, 5);
  // The wet mesh reaches the foot, which is under the water.
  expect(Math.min(...wetYs.filter((y) => y > -0.05))).toBeCloseTo(BEACH_FOOT_Y, 5);
  // They meet: the wet line is in both, so there is no gap between the materials.
  const seam = Math.min(...dryYs.filter((y) => y > -0.05));
  expect(Math.max(...wetYs.filter((y) => y < TOP_Y))).toBeGreaterThanOrEqual(seam - 1e-5);
});

test("it is built where the coast is, and only there", () => {
  const built = planBeaches([sea(0, 0), land(4, 0)])!;
  const [lx, , lz] = hexToWorld({ q: 4, r: 0 });
  for (const p of verts(built.dry)) {
    // Everything within a beach's reach of the island, and nothing near the sea
    // tile three hexes away.
    expect(Math.hypot(p[0] - lx, p[2] - lz)).toBeLessThan(LATTICE_SIZE + BEACH_ENVELOPE + 1e-6);
  }
});

test("no land means no beaches", () => {
  expect(planBeaches([sea(0, 0), sea(1, 0)])).toBeNull();
});

test("the same board builds the same coast, twice", () => {
  // The wander depends only on world position (no seed, no clock), so a
  // rebuilt board keeps its coastline, and replays and screenshots agree.
  const a = planBeaches([land(0, 0), land(1, 0)])!;
  const b = planBeaches([land(1, 0), land(0, 0)])!;
  expect(verts(a.dry)).toEqual(verts(b.dry));
  expect(verts(a.wet)).toEqual(verts(b.wet));
});
