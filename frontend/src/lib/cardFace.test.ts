import { describe, expect, it } from "vitest";
import { RES, COMMOD, resIconSlot, comIconSlot, handChips } from "./cardFace";

// Resource -> icon slot is shared by every card drawing (hand shelf, bank strip,
// event log, trade offers). RES is indexed 1..5 with 0 unused, like engine.Hand,
// so an off-by-one would be silent.
describe("icon slots", () => {
  it("maps each resource index to its own art", () => {
    expect(RES.map((r) => [r.name, resIconSlot(r.idx)])).toEqual([
      ["Wood", "icon_wood"],
      ["Brick", "icon_brick"],
      ["Sheep", "icon_sheep"],
      ["Wheat", "icon_wheat"],
      ["Ore", "icon_ore"],
    ]);
  });

  it("maps each commodity index to its own art", () => {
    expect(COMMOD.map((c) => [c.name, comIconSlot(c.idx)])).toEqual([
      ["Cloth", "icon_cloth"],
      ["Paper", "icon_paper"],
      ["Coin", "icon_coin"],
    ]);
  });

  // Slot 0 of a Hand is the engine's "no resource", so its art is "" (ResIcon
  // draws nothing), not wood's.
  it("has no art for the unused slot or an out-of-range index", () => {
    expect(resIconSlot(0)).toBe("");
    expect(resIconSlot(6)).toBe("");
    expect(resIconSlot(-1)).toBe("");
    expect(comIconSlot(3)).toBe("");
  });
});

describe("handChips", () => {
  it("reads a Hand by its 1..5 resource indices", () => {
    // 3 wheat and 1 wood, in a Hand whose slot 0 is the unused one.
    const chips = handChips([0, 1, 0, 0, 3, 0]);
    expect(chips).toEqual([
      { key: "r1", slot: "icon_wood", name: "Wood", n: 1 },
      { key: "r4", slot: "icon_wheat", name: "Wheat", n: 3 },
    ]);
  });

  // A hand of only ore must come back as ore, not wheat.
  it("does not shift the hand by the unused slot", () => {
    expect(handChips([0, 0, 0, 0, 0, 2])).toEqual([
      { key: "r5", slot: "icon_ore", name: "Ore", n: 2 },
    ]);
  });

  it("puts commodities after resources, indexed from 0", () => {
    expect(handChips([0, 0, 0, 0, 0, 1], [0, 2, 0])).toEqual([
      { key: "r5", slot: "icon_ore", name: "Ore", n: 1 },
      { key: "c1", slot: "icon_paper", name: "Paper", n: 2 },
    ]);
  });

  it("keeps resource and commodity keys distinct", () => {
    const chips = handChips([0, 1, 1, 1, 1, 1], [1, 1, 1]);
    expect(new Set(chips.map((c) => c.key)).size).toBe(chips.length);
  });

  it("is empty for an empty, commodity-free or missing hand", () => {
    expect(handChips([0, 0, 0, 0, 0, 0], [0, 0, 0])).toEqual([]);
    expect(handChips([0, 0, 0, 0, 0, 0])).toEqual([]);
    expect(handChips(undefined)).toEqual([]);
  });
});
