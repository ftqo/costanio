import { test, expect } from "vitest";
import {
  playedCardSlot,
  playedCardText,
  slotCardTitle,
  DEV_CARDS,
  RAIDERS_CARDS,
} from "./cardText";
import { slotDef, slotUntitled } from "./assets";
import { PROGRESS_CARDS } from "./progressCards";

// `road_building` is a different card in each vocabulary, so the kind is part
// of the lookup.
test("the two road buildings resolve to different faces", () => {
  expect(playedCardSlot("dev", "road_building")).toBe("devcard_roadbuilding");
  expect(playedCardSlot("progress", "road_building")).toBe("progress_road_building");
});

test("every dev card the log can draw has a face in the pack's vocabulary", () => {
  for (const id of Object.keys(DEV_CARDS)) {
    expect(playedCardSlot("dev", id), id).toMatch(/^devcard_[a-z]+$/);
    expect(playedCardSlot("dev", id), id).not.toBe("devcard_back");
  }
});

test("every progress card derives its face from its wire id", () => {
  for (const id of Object.keys(PROGRESS_CARDS)) {
    expect(playedCardSlot("progress", id), id).toBe(`progress_${id}`);
  }
});

// An unknown id must not resolve to another card's picture; the back is used
// instead.
test("an unknown dev id falls back to the back, never to another card", () => {
  expect(playedCardSlot("dev", "future_card")).toBe("devcard_back");
});

// The log draws the picture and the sentence together.
test("name, effect and face all come from the same lookup", () => {
  const text = playedCardText("progress", "alchemist");
  expect(text.name).toBe("Alchemist");
  expect(text.hint.length).toBeGreaterThan(10);
  expect(playedCardSlot("progress", "alchemist")).toBe("progress_alchemist");
});

// The five scenario faces are untitled masters (manifest `untitled: true`), so
// CardFace draws their name at runtime from `slotCardTitle`.
test("the Raiders cards and Swift Journey have names over their faces", () => {
  expect(slotCardTitle("raiders_muster")).toBe("Muster");
  expect(slotCardTitle("raiders_swift_rider")).toBe("Swift Rider");
  expect(slotCardTitle("raiders_treason")).toBe("Treason");
  expect(slotCardTitle("raiders_intrigue")).toBe("Intrigue");
  expect(slotCardTitle("devcard_swiftjourney")).toBe("Swift Journey");
  expect(slotCardTitle("devcard_back")).toBeNull();
});

test("every scenario card's face is a real slot in the pack, and round-trips", () => {
  for (const id of Object.keys(RAIDERS_CARDS)) {
    const slot = playedCardSlot("raiders", id);
    expect(slotDef(slot), slot).toBeDefined();
    expect(slotUntitled(slot), slot).toBe(true);
    expect(slotCardTitle(slot), slot).toBe(playedCardText("raiders", id).name);
    expect(playedCardText("raiders", id).hint.length, id).toBeGreaterThan(10);
  }
  const swift = playedCardSlot("dev", "swift_journey");
  expect(swift).toBe("devcard_swiftjourney");
  expect(slotDef(swift)).toBeDefined();
  expect(slotUntitled(swift)).toBe(true);
});

// `intrigue` names a card in two decks that can share a ruleset; the kind keeps
// them apart.
test("the two Intrigues are different cards", () => {
  expect(playedCardSlot("raiders", "intrigue")).toBe("raiders_intrigue");
  expect(playedCardSlot("progress", "intrigue")).toBe("progress_intrigue");
  expect(playedCardText("raiders", "intrigue").hint).not.toBe(
    playedCardText("progress", "intrigue").hint,
  );
  expect(playedCardSlot("raiders", "sabotage")).toBe("devcard_back");
});
