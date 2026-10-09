import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { BoardTile, Hex } from "@/lib/types";
import { hexesInRadius } from "@/lib/hexgeo";
import { GALLERY } from "@/lib/maps/gallery";
import { hexToWorld, LATTICE_SIZE } from "./coords";
import { DOCK_REACH, flatFitPoints } from "./fit";
import {
  applyViewport,
  boardExtent,
  boardFitPoints,
  fitBounds,
  fitDistance,
  frameTarget,
  makeCamera,
  openingPose,
  orbitDir,
  usableFrame,
} from "./scene";

const key = (h: Hex) => `${h.q},${h.r}`;
const tile = (hex: Hex, res: BoardTile["res"], num = 0): BoardTile => ({ hex, res, num });
const DIRS: Hex[] = [
  { q: 1, r: 0 },
  { q: -1, r: 0 },
  { q: 0, r: 1 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: -1, r: 1 },
];

/**
 * A land-only map framed the way the server frames one: a ring of sea around
 * every coast, plus any water between.
 */
function framed(land: BoardTile[]): BoardTile[] {
  const have = new Set(land.map((t) => key(t.hex)));
  const sea: BoardTile[] = [];
  for (const t of land) {
    for (const d of DIRS) {
      const h = { q: t.hex.q + d.q, r: t.hex.r + d.r };
      if (have.has(key(h))) continue;
      have.add(key(h));
      sea.push(tile(h, "sea"));
    }
  }
  return land.concat(sea);
}

function span(points: THREE.Vector3[]) {
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

describe("flatFitPoints", () => {
  it("frames the land, not the open sea around it", () => {
    const land = hexesInRadius(2).map((hex) => tile(hex, "wood", 5));
    // Two more rings of sea than the coast needs.
    const sea = hexesInRadius(4)
      .filter((h) => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r)) > 2)
      .map((hex) => tile(hex, "sea"));
    const got = span(flatFitPoints(land.concat(sea), []));
    const want = span(boardFitPoints(land));
    expect(got).toEqual(want);
  });

  it("keeps every harbour's dock inside the frame", () => {
    const land = hexesInRadius(2).map((hex) => tile(hex, "wood", 5));
    const dockHex = { q: 3, r: 0 };
    const [x, , z] = hexToWorld(dockHex);
    const got = span(flatFitPoints(land, [{ position: [x, 0, z] }]));
    expect(got.maxX).toBeGreaterThanOrEqual(x + DOCK_REACH * LATTICE_SIZE - 1e-9);
    expect(got.maxX).toBeGreaterThan(span(boardFitPoints(land)).maxX);
  });

  it("falls back to every tile when there is no land to frame", () => {
    const sea = hexesInRadius(2).map((hex) => tile(hex, "sea"));
    expect(span(flatFitPoints(sea, []))).toEqual(span(boardFitPoints(sea)));
  });
});

/**
 * The phone framing end to end: the camera Board3D builds for a 390x844
 * portrait, the HUD bands measured there (top 0.13, bottom 0.23 of the
 * height), the flat opening pose, and the exact fit. Returns the fraction of
 * the width the islands get, which sizes every tap target on them.
 */
describe("the phone opening fit", () => {
  const W = 390;
  const H = 844;
  const insets = { top: 0.13, bottom: 0.23 };

  function landWidthFrac(tiles: BoardTile[], points: THREE.Vector3[], margin?: number) {
    const e = boardExtent(tiles);
    const aspect = W / H;
    const cam = makeCamera(aspect, e, true);
    applyViewport(cam, W, H, insets, e);
    const bounds = fitBounds(usableFrame(insets), true);
    const pose = openingPose(aspect, true);
    const dir = orbitDir(pose.tiltDeg, pose.azimuthRad);
    const target = frameTarget(e);
    const dist = fitDistance(cam, target, dir, points, bounds, margin);
    cam.position.copy(target).addScaledVector(dir, dist);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    const land = boardFitPoints(tiles.filter((t) => t.res !== "sea")).map((p) =>
      p.clone().project(cam),
    );
    const xs = land.map((p) => p.x);
    return (Math.max(...xs) - Math.min(...xs)) / 2;
  }

  it("gives Archipelago's islands nearly the whole width", () => {
    const arch = GALLERY.find((g) => g.id === "archipelago");
    expect(arch).toBeDefined();
    const land = arch!.board.tiles.map((t) => tile(t.hex, "wood", t.num));
    const tiles = framed(land);
    const frac = landWidthFrac(tiles, flatFitPoints(tiles, []), 1);
    // The bounds leave 3% each side, so 0.94 is the ceiling.
    expect(frac).toBeGreaterThan(0.9);
  });

  it("gives a base board nearly the whole width", () => {
    const land = hexesInRadius(2).map((hex) => tile(hex, "wood", 5));
    const frac = landWidthFrac(land, flatFitPoints(land, []), 1);
    expect(frac).toBeGreaterThan(0.9);
  });
});
