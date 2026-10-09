import { test, expect } from "vitest";
import { describeEvent, logMessageText, type LogMessage } from "./eventlog";
import type { GameEvent } from "./gamestate";

const P = (s: number) => `P${s}`;
const ev = (type: string, data: unknown): GameEvent => ({ seq: 0, type, data });
const text = (lines: LogMessage[]): string[] => lines.map((l) => logMessageText(l));
const say = (type: string, data: unknown) => text(describeEvent(ev(type, data), P, false));

// A wagon's load is public and says where it is going next, so name the cargo.
test("a load and a delivery name the cargo", () => {
  expect(say("wagons_loaded", { player: 1, hex: 0, cargo: 3 })).toEqual(["P1 loaded sand"]);
  expect(say("wagons_delivered", { player: 2, hex: 1, cargo: 4, gold: 1 })).toEqual([
    "P2 delivered tools for a point and 1 gold",
  ]);
});

// Gold lines say what changed hands, as the Raiders ones do.
test("a gold purchase and a sale say what changed hands", () => {
  const bought = say("wagons_bought", { player: 0, res: "ore", gold: 2 })[0];
  expect(bought).toBe("P0 bought Ore ×1 for 2 gold");
  const sold = say("wagons_sold", { player: 0, res: "wheat", count: 3, gold: 1 })[0];
  expect(sold).toBe("P0 traded Wheat ×3 for 1 gold");
});

// A Swift Journey is bought from the development deck and held, not resolved.
// The purchase is public, so it gets a line.
test("buying a Swift Journey is said, as a development card purchase is", () => {
  expect(say("wagons_swift_bought", { player: 1 })).toEqual(["P1 bought Swift Journey"]);
  expect(say("wagons_swift_played", { player: 1 })).toEqual(["P1 played Swift Journey"]);
});

// Drawn as a card token, so the line shows the face on hover like a played
// base card.
test("both Swift Journey lines draw the card as a development-card token", () => {
  for (const type of ["wagons_swift_bought", "wagons_swift_played"]) {
    const [line] = describeEvent(ev(type, { player: 1 }), P, false);
    const toks = line.slots?.flatMap((s) => ("fill" in s ? s.fill : [])) ?? [];
    expect(toks, type).toContainEqual({ k: "card", kind: "dev", id: "swift_journey" });
  }
});
