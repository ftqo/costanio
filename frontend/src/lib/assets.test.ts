import { test, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SLOTS, ART_SLOT_IDS, slotDef, assetExt, assetURL, type SlotId } from "./assets";

const PUBLIC = join(__dirname, "..", "..", "public");

test("registry has the expected core slots", () => {
  const ids = new Set(SLOTS.map((s) => s.id));
  for (const id of ["icon_wood", "devcard_knight", "sound_dice-0"] as SlotId[]) {
    expect(ids.has(id)).toBe(true);
  }
});

test("the pack carries no board art", () => {
  // The board is drawn from models. A `hex_*`, `piece_*` or robber slot here
  // is flat board art, which the pack must not carry.
  for (const s of SLOTS) {
    expect(s.id, `${s.id} is board art`).not.toMatch(/^(hex_|piece_)/);
    expect(["robber", "pirate", "merchant"]).not.toContain(s.id);
  }
});

test("every slot is registered exactly once", () => {
  const ids = SLOTS.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("ART_SLOT_IDS is every slot that is not a sound", () => {
  expect(ART_SLOT_IDS).toContain("icon_wood");
  expect(ART_SLOT_IDS).not.toContain("sound_music");
});

test("a slot resolves to its manifest extension", () => {
  expect(assetExt("icon_wood")).toBe("webp");
  expect(assetURL("icon_wood")).toBe("/assets/icon_wood.webp");
});

test("card slots resolve and unknown slots return null", () => {
  // Dev-card faces resolve like any other slot.
  expect(slotDef("devcard_knight")?.kind).toBe("card");
  expect(assetURL("devcard_knight")).toBe("/assets/devcard_knight.webp");
  // An unknown slot resolves to null rather than a guessed URL that would 404.
  expect(assetURL("no_such_slot")).toBeNull();
});

test("every resolvable slot points at an existing file", () => {
  for (const s of SLOTS) {
    const url = assetURL(s.id);
    if (!url) continue;
    expect(existsSync(join(PUBLIC, url)), `missing ${url}`).toBe(true);
  }
});
