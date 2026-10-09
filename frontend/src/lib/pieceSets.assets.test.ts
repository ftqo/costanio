// The parts of a piece set, checked together: a row in cosmetics/catalog.go,
// an entry in PIECE_SETS, and the model under public/models/pieces/. A missing
// part fails silently (a broken store card, or a fall back to stock pieces).
// Same shape as robbers.assets.test.ts.
//
// A set glb must be a drop-in for the stock one: with different node names
// every call site keeps working while drawing nothing.
import { test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PIECE_SETS, STOCK_PIECES_ID, STOCK_PIECES_FILE } from "./pieceSets";
import { PIECE_PREFIX } from "./board3d/pieceArt";

const PUBLIC = join(__dirname, "..", "..", "public");

test("every piece set has its model", () => {
  const missing: string[] = [];
  for (const [id, s] of Object.entries(PIECE_SETS)) {
    if (!existsSync(join(PUBLIC, "models", s.file))) missing.push(`${id} -> models/${s.file}`);
  }
  expect(missing).toEqual([]);
});

test("the stock set is the file every board already loads", () => {
  expect(PIECE_SETS[STOCK_PIECES_ID].file).toBe(STOCK_PIECES_FILE);
});

/** The node names in a glb, read off the bytes that actually ship. */
function nodeNames(file: string): string[] {
  const buf = readFileSync(join(PUBLIC, "models", file));
  expect(buf.readUInt32LE(0), `${file} is not a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  return (gltf.nodes ?? [])
    .filter((n: { name?: string; mesh?: number }) => n.mesh !== undefined && n.name)
    .map((n: { name: string }) => n.name);
}

// Same node names as the stock set, so one loader, subset and tint path serve
// every set.
test("every set carries the stock node names", () => {
  for (const [id, s] of Object.entries(PIECE_SETS)) {
    const names = nodeNames(s.file);
    for (const prefix of Object.values(PIECE_PREFIX)) {
      expect(
        names.some((n) => n.startsWith(prefix)),
        `${id} (${s.file}) has ${prefix}* nodes`,
      ).toBe(true);
    }
  }
});

// Sets are tinted per seat through the Seat_ material slots; baked colours
// would make every player's buildings identical. Every material must be a
// slot, though not every slot must be present (the classic set is one shade
// and uses only Seat_Body).
const TINT_SLOTS = ["Seat_Body", "Seat_Shade", "Seat_Detail"];

/**
 * The materials the set's own nodes use, in a glb that may hold more:
 * pieces.glb also holds the robber, whose Mat_Robber is correctly untinted.
 */
function setMaterials(file: string): string[] {
  const buf = readFileSync(join(PUBLIC, "models", file));
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const names: string[] = (gltf.materials ?? []).map((m: { name?: string }) => m.name ?? "");
  const meshes = gltf.meshes ?? [];
  const used = new Set<string>();
  for (const node of gltf.nodes ?? []) {
    if (node.mesh === undefined || !node.name) continue;
    if (!Object.values(PIECE_PREFIX).some((p) => node.name.startsWith(p))) continue;
    for (const prim of meshes[node.mesh]?.primitives ?? []) {
      if (prim.material !== undefined) used.add(names[prim.material]);
    }
  }
  return [...used];
}

test("every set tints through the seat materials", () => {
  for (const [id, s] of Object.entries(PIECE_SETS)) {
    const mats = setMaterials(s.file);
    expect(mats, `${id} (${s.file}) paints its buildings with something`).not.toEqual([]);
    for (const mat of mats) {
      expect(TINT_SLOTS, `${id} (${s.file}) paints ${mat} outside the seat slots`).toContain(mat);
    }
    expect(mats, `${id} (${s.file}) ships Seat_Body`).toContain("Seat_Body");
  }
});
