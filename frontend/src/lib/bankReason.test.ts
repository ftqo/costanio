import { describe, expect, it } from "vitest";
import { maritimeTrade } from "./bank";
import { maritimeBlockedReason } from "./bankReason";

// Hand/bank arrays are indexed 1..5 = wood/brick/sheep/wheat/ore.
const H = (wood = 0, brick = 0, sheep = 0, wheat = 0, ore = 0) => [
  0,
  wood,
  brick,
  sheep,
  wheat,
  ore,
];
const BANK = H(19, 19, 19, 19, 19);
const why = (
  give: number[],
  want: number[],
  ratios = [0, 4, 4, 4, 4, 4],
  hand = H(9, 9, 9, 9, 9),
  bank = BANK,
) => maritimeBlockedReason(maritimeTrade(give, want, ratios, bank, hand)!, hand, bank);

// Three wood staged against one brick with a 2:1 wood harbour.
describe("maritimeBlockedReason", () => {
  it("says nothing when the trade goes through", () => {
    expect(why(H(4), H(0, 1))).toBeUndefined();
  });
  it("names the rate a stake does not divide by", () => {
    expect(why(H(3), H(0, 1), [0, 2, 4, 4, 4, 4])).toBe("Wood goes 2 for 1");
  });
  it("says a stake pays for fewer cards than were asked for", () => {
    expect(why(H(4), H(0, 2))).toBe("Pays for only 1 card");
  });
  it("says a stake pays for more than was asked for", () => {
    expect(why(H(8), H(0, 1))).toBe("Pays for 2 cards: ask for more");
  });
  it("catches the same card on both sides", () => {
    expect(why(H(4), H(1))).toBe("Same card on both sides");
  });
  it("names a give card the hand does not hold", () => {
    expect(why(H(4), H(0, 1), undefined, H(2))).toBe("Not enough Wood in hand");
  });
  it("names a card the bank has run out of", () => {
    expect(why(H(4), H(0, 1), undefined, undefined, H(19, 0))).toBe("The bank is short of Brick");
  });
});
