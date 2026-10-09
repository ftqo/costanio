import { test, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TILES, CHIPS, TINT_SLOTS, HEX_SIZE, RESOURCE_FALLBACK } from "./manifest.generated";

const MODELS = join(__dirname, "..", "..", "..", "public", "models");

// Every resource the engine can put on a board needs art or a documented
// fallback. Mirrors engine/board/resource_json.go:12-21.
const ENGINE_RESOURCES = [
  "none",
  "wood",
  "brick",
  "sheep",
  "wheat",
  "ore",
  "gold",
  "sea",
  "lake",
  "fog",
];

test("every engine resource resolves to a tile or a fallback", () => {
  for (const res of ENGINE_RESOURCES) {
    const direct = TILES[res];
    const fallback = RESOURCE_FALLBACK[res] ? TILES[RESOURCE_FALLBACK[res]] : undefined;
    expect(direct ?? fallback, `resource ${res} has no tile and no fallback`).toBeDefined();
  }
});

test("every tile file referenced by the manifest exists on disk", () => {
  for (const entry of Object.values(TILES)) {
    expect(existsSync(join(MODELS, entry.file)), `missing ${entry.file}`).toBe(true);
  }
});

test("land tiles expose a chip socket", () => {
  // Sea variants carry no number chip; everything else must. The list is the
  // `sea_*` family exactly, and `tools/blender/hexcontract.py` is the primary
  // gate on it: a water tile there fails if it carries a socket at all.
  const noSocket = ["sea", "sea_port", "sea_shoal", "sea_council"];
  for (const [res, entry] of Object.entries(TILES)) {
    if (noSocket.includes(res)) continue;
    expect(entry.socket, `tile ${res} has no chip socket`).not.toBeNull();
  }
});

test("chip sockets sit at the authored mount height", () => {
  // z=0.26 in the blend becomes y=0.26 after the Z-up -> Y-up conversion.
  // A socket that lands on the wrong axis puts every number chip inside or
  // beside its tile instead of on top of it.
  for (const [res, entry] of Object.entries(TILES)) {
    if (!entry.socket) continue;
    expect(entry.socket[1], `tile ${res} socket is not at chip height`).toBeCloseTo(0.26, 4);
  }
});

test("chips cover 2-12 except 7", () => {
  const numbers = CHIPS.map((c) => c.number).sort((a, b) => a - b);
  expect(numbers).toEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
});

test("chip variant counts are counted from the blend, not assumed", () => {
  // 2 and 12 have a single variant; every other number has two. Assuming two
  // everywhere would request a Chip_02_2 that does not exist.
  const byNumber = new Map(CHIPS.map((c) => [c.number, c.variants]));
  expect(byNumber.get(2)).toBe(1);
  expect(byNumber.get(12)).toBe(1);
  for (const n of [3, 4, 5, 6, 8, 9, 10, 11]) {
    expect(byNumber.get(n), `number ${n}`).toBe(2);
  }
});

test("the three seat tint slots are present", () => {
  expect([...TINT_SLOTS].sort()).toEqual(["Seat_Body", "Seat_Detail", "Seat_Shade"]);
});

test("hex size matches the geometry the coords module assumes", () => {
  expect(HEX_SIZE).toBe(3.0);
});
