import { test, expect, describe } from "vitest";
import {
  MARKER_RADIUS,
  markerGeometry,
  markerMaterial,
  markerOutlineGeometry,
  markerOutlineMaterial,
  markerPlacements,
} from "./markers";
import { SNAP_RADIUS } from "./picking";
import type { PickTarget } from "./targets";

const vertex = (key: string, x: number, z: number): PickTarget => ({
  kind: "vertex",
  action: "vertex",
  key,
  v: { q: 0, r: 0, side: 0 },
  pos: [x, 0.24, z],
});

describe("markerPlacements", () => {
  test("groups by kind, one draw call each", () => {
    const targets: PickTarget[] = [
      vertex("a", 0, 0),
      vertex("b", 1, 1),
      { kind: "hex", action: "hex", key: "h", h: { q: 0, r: 0 }, pos: [2, 0.27, 2] },
    ];
    const groups = markerPlacements(targets);
    expect([...groups.keys()].sort()).toEqual(["hex", "vertex"]);
    expect(groups.get("vertex")).toHaveLength(2);
    expect(groups.get("hex")).toHaveLength(1);
  });

  test("a placement is drawn exactly where its target is", () => {
    const t = vertex("a", 3, -4);
    expect(markerPlacements([t]).get("vertex")?.[0].position).toEqual(t.pos);
  });

  test("no targets, no markers", () => {
    expect(markerPlacements([]).size).toBe(0);
  });
});

describe("markerGeometry", () => {
  test("lies flat in the board plane", () => {
    for (const kind of ["vertex", "edge", "hex"] as const) {
      const g = markerGeometry(kind);
      g.computeBoundingBox();
      const box = g.boundingBox!;
      expect(box.max.y - box.min.y).toBeCloseTo(0, 9);
      expect(box.max.x - box.min.x).toBeGreaterThan(0);
      expect(box.max.z - box.min.z).toBeGreaterThan(0);
    }
  });

  test("a hex marker is a pointy-top hexagon, matching the lattice", () => {
    const g = markerGeometry("hex");
    g.computeBoundingBox();
    const box = g.boundingBox!;
    // Pointy-top: corners due north and south, flats to east and west, so the
    // z extent is a full circumradius and the x extent is the apothem.
    const r = MARKER_RADIUS.hex;
    expect(box.max.z).toBeCloseTo(r, 6);
    expect(box.max.x).toBeCloseTo((r * Math.sqrt(3)) / 2, 6);
  });

  test("every marker, outline included, fits inside its pick radius", () => {
    // A marker bigger than its snap radius would invite clicks that miss.
    for (const kind of ["vertex", "edge", "hex"] as const) {
      const g = markerOutlineGeometry(kind);
      g.computeBoundingSphere();
      expect(g.boundingSphere!.radius).toBeLessThanOrEqual(SNAP_RADIUS[kind] + 1e-9);
      expect(MARKER_RADIUS[kind]).toBeLessThanOrEqual(SNAP_RADIUS[kind]);
    }
  });

  test("the outline rings the fill rather than covering it", () => {
    for (const kind of ["vertex", "edge"] as const) {
      const ring = markerOutlineGeometry(kind);
      ring.computeBoundingBox();
      // Strictly outside the fill it surrounds.
      expect(ring.boundingBox!.max.x).toBeGreaterThan(MARKER_RADIUS[kind]);
    }
  });

  test("vertex and edge markers cannot overlap their neighbours", () => {
    // Adjacent vertex and edge midpoints are half a hex side apart, and both
    // markers have to fit between them.
    expect(MARKER_RADIUS.vertex + MARKER_RADIUS.edge).toBeLessThan(SNAP_RADIUS.vertex);
  });
});

describe("markerMaterial", () => {
  test("draws over the board rather than inside it", () => {
    const m = markerMaterial("vertex");
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
    expect(m.transparent).toBe(true);
  });

  test("hover is the same spot, louder", () => {
    const rest = markerMaterial("vertex");
    const hot = markerMaterial("vertex", true);
    expect(hot.opacity).toBeGreaterThan(rest.opacity);
  });

  test("every kind rests invisible and shows under the pointer", () => {
    for (const kind of ["vertex", "edge", "hex"] as const) {
      expect(markerMaterial(kind).opacity).toBe(0);
      // Hover is the only state that draws, so it must show through terrain
      // (depthTest off).
      expect(markerMaterial(kind, true).opacity).toBeGreaterThan(0);
      expect(markerMaterial(kind, true).depthTest).toBe(false);
    }
  });

  test("the outline rests invisible with the fill", () => {
    // Fill and ring are one mark: zeroing only the fill left a dark ring on
    // every legal spot at rest.
    expect(markerOutlineMaterial().opacity).toBe(0);
    expect(markerOutlineMaterial(true).opacity).toBeGreaterThan(0);
    expect(markerOutlineMaterial().opacity).toBe(markerMaterial("vertex").opacity);
  });

  test("the outline is drawn on the same terms as the fill", () => {
    const o = markerOutlineMaterial();
    expect(o.depthTest).toBe(false);
    expect(o.depthWrite).toBe(false);
    // Darker than the fill, or it would not separate a pip from the sand.
    expect(o.color.getHex()).toBeLessThan(markerMaterial("vertex").color.getHex());
  });
});
