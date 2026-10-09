// Build cards follow the viewer's piece set, but only for the pieces a set
// covers, and the stock player keeps the original cache entry.
import { test, expect } from "vitest";
import { SHOP_SET, shopSetFor } from "./shotSets";
import { STOCK_PIECES_FILE } from "@/lib/pieceSets";
import { PIECE_PREFIX } from "./pieceArt";

const SET_FILE = "pieces/cyclades.glb";

// The same object, so the cache key, disk entry and lobby warm-up are unchanged.
test("the stock piece set uses the stock shot set", () => {
  expect(shopSetFor(STOCK_PIECES_FILE)).toBe(SHOP_SET);
});

test("a set's renders cannot collide with the stock ones on disk", () => {
  expect(shopSetFor(SET_FILE).id).not.toBe(SHOP_SET.id);
  expect(shopSetFor(SET_FILE).id).toContain(SET_FILE);
});

test("only the pieces a set owns are redirected", () => {
  const setPrefixes = new Set<string>(Object.values(PIECE_PREFIX));
  const shots = shopSetFor(SET_FILE).shots;

  let redirected = 0;
  for (const shot of shots) {
    for (const part of shot.parts) {
      if (part.file === SET_FILE) {
        expect(setPrefixes.has(part.prefix), `${shot.slot} redirects ${part.prefix}`).toBe(true);
        redirected++;
      }
    }
  }
  // Road, settlement and city at least, so the test cannot pass vacuously.
  expect(redirected).toBeGreaterThanOrEqual(3);
});

// The robber belongs to nobody but lives in the same file as the buildings.
test("the robber keeps the stock art", () => {
  for (const shot of shopSetFor(SET_FILE).shots) {
    for (const part of shot.parts) {
      if (part.prefix.startsWith("Robber_")) expect(part.file).toBe(STOCK_PIECES_FILE);
    }
  }
});

// The framing was tuned by eye per card and is independent of the art file.
test("a set changes the art and nothing else about the shot", () => {
  const stock = SHOP_SET.shots;
  const set = shopSetFor(SET_FILE).shots;
  expect(set.map((s) => s.slot)).toEqual(stock.map((s) => s.slot));
  for (let i = 0; i < stock.length; i++) {
    expect(set[i].yawDeg, stock[i].slot).toBe(stock[i].yawDeg);
    expect(set[i].fill, stock[i].slot).toBe(stock[i].fill);
    expect(set[i].parts.map((p) => p.prefix)).toEqual(stock[i].parts.map((p) => p.prefix));
  }
});
