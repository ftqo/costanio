import { describe, expect, test } from "vitest";
import { selectSeat } from "./SeatRail";
import { previewView } from "@/lib/board3d/previewFixture";
import { seatCounterCount } from "@/lib/seatPanels";
import type { FullView } from "@/lib/types";

// Which purse the seat card's gold counter shows, from the ruleset and the ext.
// Under Wagons + Rivers the wagon's gold is the Rivers coin purse, so it must
// not show twice.
const at = (ruleset: string, ext: Record<string, unknown>): FullView => ({
  ...previewView,
  config: { ...previewView.config, ruleset },
  ext,
});

const noCaps = {
  hasKnightPieces: false,
  hasDevCards: true,
  hasLargestArmy: true,
  hasRaiders: false,
  hasWagons: false,
  hasExplorers: false,
  hasFish: false,
  hasHarbormaster: false,
  hasRivers: false,
  hasCaravans: false,
};

describe("which purse the seat's gold counter is", () => {
  test("Wagons + Rivers: one purse, the coin counter, and no gold counter", () => {
    const v = at("base+rivers+wagons", {
      rivers: { coins: [4, 0, 0, 0] },
      wagons: { started: true, shared_currency: true, gold: [4, 0, 0, 0] },
    });
    const s = selectSeat(v, 0);
    expect(s.gold).toBe(-1);
    expect(s.rivers).toBe(true);
    expect(s.coins).toBe(4);
  });
  test("Wagons + Rivers before the wagons start: still one purse", () => {
    // The row is sized from the ruleset on the first frame, so the slot must
    // not appear and then vanish when shared_currency lands.
    const v = at("base+rivers+wagons", { rivers: { coins: [0, 0, 0, 0] }, wagons: {} });
    expect(selectSeat(v, 0).gold).toBe(-1);
  });
  test("the rail sizes Wagons + Rivers for one purse, not two", () => {
    const wagons = { ...noCaps, hasWagons: true };
    const rivers = { ...noCaps, hasRivers: true };
    const both = { ...noCaps, hasWagons: true, hasRivers: true };
    // Wagons alone: gold, level, deliveries. Rivers alone: coins. Together the
    // gold is the coins, so one fewer than the sum.
    expect(seatCounterCount(both)).toBe(
      seatCounterCount(wagons) + seatCounterCount(rivers) - seatCounterCount(noCaps) - 1,
    );
  });
  test("Wagons alone: gold", () => {
    const v = at("base+wagons", { wagons: { started: true, gold: [4, 0, 0, 0] } });
    expect(selectSeat(v, 0).gold).toBe(4);
  });
  test("Raiders: its own gold wins the slot, beside the coins", () => {
    const v = at("base+raiders+rivers+wagons", {
      raiders: { gold: [2, 0, 0, 0] },
      rivers: { coins: [4, 0, 0, 0] },
      wagons: { started: true, shared_currency: true, gold: [4, 0, 0, 0] },
    });
    expect(selectSeat(v, 0).gold).toBe(2);
    expect(selectSeat(v, 0).coins).toBe(4);
  });
});
