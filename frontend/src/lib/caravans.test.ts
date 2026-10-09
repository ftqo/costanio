import { describe, it, expect } from "vitest";
import {
  bidResources,
  bidVotes,
  camelBids,
  camelOnClock,
  camelOutcomeOf,
  camelPathKey,
  camelPending,
  camelRole,
  camelViewOutcome,
  camelsPlaced,
  seatCamelVp,
} from "./caravans";
import { vertexHexes } from "./hexgeo";
import type { CamelBid, CamelPath, CaravansExt, FullView, Vertex } from "./types";

const v = (q: number, r: number, side: 0 | 1): Vertex => ({ q, r, side });
const path = (caravan: number): CamelPath => ({
  caravan,
  e: { a: v(caravan, 0, 0), b: v(caravan, 0, 1) },
});

const view = (cur: number, ext: CaravansExt, legal?: CamelPath[]) =>
  ({
    cur,
    players: [{}, {}, {}],
    ext: { caravans: ext },
    legal: legal ? { camel_paths: legal } : undefined,
  }) as unknown as FullView;

// docs/rules/scenarios.md: "Bidding is open and sequential: it starts with the
// player who just finished their turn and goes clockwise, each seat answering
// once." Only the seat on the clock may bid; others get NOT_YOUR_TURN.
describe("which of the vote's two questions is being put to this seat", () => {
  const open: CaravansExt = { voting: true, placer: -1, finisher: 1, bidded: [1] };

  it("the seat holding a legal placement list is the one that may bid", () => {
    // `legal.camel_paths` reaches only the seat that may act, which in an open
    // round is the seat on the clock, so the client never walks the table.
    expect(camelRole(view(0, open, [path(0)]), 2)).toBe("bid");
  });

  it("a seat with no legal list is waiting, whether it has answered or not", () => {
    expect(camelRole(view(0, open), 0)).toBe("bid-waiting");
    expect(camelRole(view(0, open), 1)).toBe("bid-waiting");
  });

  it("once the round closes only the winner places", () => {
    const closed: CaravansExt = { voting: true, placer: 2, bidded: [0, 1, 2] };
    expect(camelRole(view(0, closed, [path(0)]), 2)).toBe("place");
    expect(camelRole(view(0, closed), 0)).toBe("place-waiting");
  });

  it("no vote, nothing to answer", () => {
    expect(camelRole(view(0, {}), 0)).toBe("none");
    expect(camelRole(view(0, { voting: true, placer: -1 }), -1)).toBe("bid-waiting");
  });
});

// Display only: who the table is waiting on. The controls are gated by
// `legal.camel_paths`.
describe("whose go it is, for display", () => {
  it("is the first seat clockwise from the finisher that has not answered", () => {
    expect(camelOnClock(view(0, { voting: true, placer: -1, finisher: 1, bidded: [1] }))).toBe(2);
  });
  it("wraps round the table", () => {
    expect(camelOnClock(view(0, { voting: true, placer: -1, finisher: 2, bidded: [2] }))).toBe(0);
  });
  it("is nobody once every seat has answered", () => {
    expect(
      camelOnClock(view(0, { voting: true, placer: -1, finisher: 0, bidded: [0, 1, 2] })),
    ).toBe(-1);
  });
  it("is nobody once the round has closed", () => {
    expect(camelOnClock(view(0, { voting: true, placer: 1, bidded: [0] }))).toBe(-1);
  });
});

describe("who is still to answer", () => {
  it("is in the order they will be ASKED, clockwise from the finisher", () => {
    // Not seat order [0, 2]: the finisher bids first, then clockwise.
    expect(camelPending(view(0, { voting: true, placer: -1, finisher: 2, bidded: [1] }))).toEqual([
      2, 0,
    ]);
  });
  it("counts a zero bid as answered", () => {
    expect(camelPending(view(0, { voting: true, placer: -1, finisher: 0, bidded: [1] }))).toEqual([
      0, 2,
    ]);
  });
  it("is empty once the round has closed", () => {
    expect(camelPending(view(0, { voting: true, placer: 1, bidded: [0] }))).toEqual([]);
  });
});

// "Alongside Knights the bid resources change: the vote is bid in brick and
// lumber instead of wool and grain."
describe("the two bid piles are ruleset-dependent", () => {
  it("reads the pair off the wire", () => {
    expect(bidResources({ bid_resources: [2, 1] })).toEqual([2, 1]);
  });
  // board.Resource marshals as its name; reading names as indices crashed the
  // bid panel (RES.find missed).
  it("reads the resource names the server actually sends", () => {
    expect(bidResources({ bid_resources: ["sheep", "wheat"] })).toEqual([3, 4]);
    expect(bidResources({ bid_resources: ["brick", "wood"] })).toEqual([2, 1]);
  });
  it("falls back rather than passing through a name it does not know", () => {
    expect(bidResources({ bid_resources: ["gold", "wheat"] })).toEqual([3, 4]);
  });
  it("defaults to wool and grain", () => {
    expect(bidResources({})).toEqual([3, 4]);
    expect(bidResources(undefined)).toEqual([3, 4]);
  });
});

describe("one card, one vote", () => {
  it("counts the `cards` pair", () => {
    expect(bidVotes({ player: 0, cards: [2, 3] })).toBe(5);
    expect(bidVotes({ player: 0, cards: [0, 0] })).toBe(0);
  });
  it("still counts a pre-`cards` log's wool and grain", () => {
    expect(bidVotes({ player: 0, wool: 2, grain: 1 })).toBe(3);
  });
  it("a bid with neither is no votes rather than NaN", () => {
    expect(bidVotes({ player: 0 })).toBe(0);
  });
});

describe("the bids already cast are public throughout the round", () => {
  it("are handed back in the order they were cast, unsorted", () => {
    const bids: CamelBid[] = [
      { player: 2, cards: [1, 0] },
      { player: 0, cards: [0, 3] },
    ];
    expect(camelBids({ voting: true, placer: -1, bids })).toBe(bids);
  });
  it("degrade to nothing on a server that sends none", () => {
    expect(camelBids(undefined)).toEqual([]);
  });
});

describe("a placement's identity is the (caravan, edge) pair", () => {
  it("the same edge under two caravans gets two different keys", () => {
    const e = { a: v(0, 0, 0), b: v(0, 0, 1) };
    expect(camelPathKey({ caravan: 0, e })).not.toBe(camelPathKey({ caravan: 1, e }));
  });
  it("the same pair keys the same, whatever the object identity", () => {
    const a: CamelPath = { caravan: 1, e: { a: v(0, 0, 0), b: v(0, 0, 1) } };
    const b: CamelPath = { caravan: 1, e: { a: v(0, 0, 0), b: v(0, 0, 1) } };
    expect(camelPathKey(a)).toBe(camelPathKey(b));
  });
});

describe("the outcome the engine stamped on the event", () => {
  // `reason` is read, not recomputed: each case gives payments the old
  // derivation would read the other way.
  it("a stamped tie stays a tie even when the payments look like a clean win", () => {
    expect(
      camelOutcomeOf("tie", 1, [
        { player: 1, cards: [2, 0] },
        { player: 2, cards: [1, 0] },
      ]),
    ).toBe("tie");
  });
  it("a stamped majority is a win even when the payments look tied", () => {
    expect(
      camelOutcomeOf("majority", 1, [
        { player: 1, cards: [1, 0] },
        { player: 2, cards: [1, 0] },
      ]),
    ).toBe("won");
  });
  // The rule: "if two or more seats holding a combined majority agree on a
  // placement, the camel goes there. This outranks the largest single bidder:
  // at 4 / 3 / 3 the two threes agreeing beat the four." The payments alone
  // cannot show which happened, hence `reason`.
  it("a stamped coalition is its own outcome, not a win for the top bidder", () => {
    expect(
      camelOutcomeOf("coalition", -1, [
        { player: 0, cards: [4, 0] },
        { player: 1, cards: [3, 0] },
        { player: 2, cards: [3, 0] },
      ]),
    ).toBe("coalition");
  });
  it("a stamped nobody is nobody even with payments on the event", () => {
    expect(camelOutcomeOf("nobody", 1, [{ player: 1, cards: [2, 0] }])).toBe("nobody");
  });
  it("derives the outcome when reason is absent", () => {
    expect(
      camelOutcomeOf(undefined, 1, [
        { player: 1, cards: [2, 0] },
        { player: 2, cards: [1, 0] },
      ]),
    ).toBe("won");
    expect(camelOutcomeOf(undefined, 0, [])).toBe("nobody");
  });
});

describe("the outcome the CONTROLS read off the view", () => {
  it("is undefined while nothing has closed", () => {
    expect(camelViewOutcome({ voting: true, placer: -1 })).toBeUndefined();
    expect(camelViewOutcome(undefined)).toBeUndefined();
  });
  // A coalition leaves `placer` at -1 (nobody picks; the camel is placed in the
  // same batch), so keying on `placer` would report no outcome.
  it("names a coalition even though it hands nobody the placement", () => {
    expect(camelViewOutcome({ voting: true, placer: -1, reason: "coalition" })).toBe("coalition");
  });
  it("reads the stamped reason for a round with a placer", () => {
    expect(camelViewOutcome({ voting: true, placer: 1, reason: "tie" })).toBe("tie");
  });
});

describe("outcome derivation without a reason field", () => {
  // Reached only through `camelOutcomeOf` with no stamped reason, since
  // `camelOutcome` is not exported. It cannot produce a coalition, matching
  // logs written before coalitions existed.
  const camelOutcome = (placer: number, paid: readonly CamelBid[]) =>
    camelOutcomeOf(undefined, placer, paid);
  it("a unique top payer who is the placer won it", () => {
    expect(
      camelOutcome(1, [
        { player: 1, cards: [2, 0] },
        { player: 2, cards: [1, 0] },
      ]),
    ).toBe("won");
  });
  it("a tie falls to the finisher, and that is not a win", () => {
    expect(
      camelOutcome(0, [
        { player: 1, cards: [1, 0] },
        { player: 2, cards: [1, 0] },
      ]),
    ).toBe("tie");
  });
  it("a tie in which the finisher is one of the tied seats is still a tie", () => {
    expect(
      camelOutcome(1, [
        { player: 1, cards: [1, 0] },
        { player: 2, cards: [0, 1] },
      ]),
    ).toBe("tie");
  });
  it("nobody paying anything is nobody bidding", () => {
    expect(camelOutcome(0, [])).toBe("nobody");
    // A payment recorded as zero counts as no vote, matching `settle`.
    expect(camelOutcome(0, [{ player: 1, cards: [0, 0] }])).toBe("nobody");
  });
  it("a plurality short of a majority is still a win for its top payer", () => {
    expect(
      camelOutcome(0, [
        { player: 0, cards: [3, 0] },
        { player: 1, cards: [2, 0] },
        { player: 2, cards: [2, 0] },
      ]),
    ).toBe("won");
  });
  it("an old wool/grain log derives the same way", () => {
    expect(
      camelOutcome(1, [
        { player: 1, wool: 2, grain: 0 },
        { player: 2, wool: 1, grain: 0 },
      ]),
    ).toBe("won");
  });
});

describe("the supply readout", () => {
  it("counts placed as supply minus left", () => {
    expect(camelsPlaced({ camel_supply: 22, camels_left: 13 })).toEqual({ placed: 9, supply: 22 });
  });
  it("returns nothing rather than NaN when fields are missing", () => {
    expect(camelsPlaced(undefined)).toEqual({ placed: 0, supply: 0 });
  });
});

// The seat card's camel counter (engine/scenarios VictoryVP): +1 per building of the
// seat on a vertex two or more camels touch, a city the same as a settlement,
// nothing for a building Raiders has made inert.
describe("a seat's points from the camels", () => {
  const a = v(0, 0, 0),
    b = v(0, 0, 1),
    c = v(1, -1, 0);
  const camels: CamelPath[] = [
    { caravan: 0, e: { a, b } },
    { caravan: 0, e: { a: b, b: c } },
  ];
  const at = (
    buildings: { v: Vertex; owner: number; city?: boolean }[],
    extra: Record<string, unknown> = {},
    tiles: { hex: { q: number; r: number }; res: string }[] = [],
  ) =>
    ({
      players: [{}, {}],
      buildings: buildings.map((x) => ({ city: false, ...x })),
      board: { tiles },
      ext: { caravans: { camels }, ...extra },
    }) as unknown as FullView;

  it("counts a building where two camels meet, and not one at a chain's end", () => {
    const view = at([
      { v: b, owner: 1 },
      { v: a, owner: 1 },
    ]);
    expect(seatCamelVp(view, 1)).toBe(1);
    expect(seatCamelVp(view, 0)).toBe(0);
  });

  it("a city between two camels is worth one, like a settlement", () => {
    expect(seatCamelVp(at([{ v: b, owner: 0, city: true }]), 0)).toBe(1);
  });

  it("is zero with no camels on the board", () => {
    const view = { ...at([{ v: b, owner: 0 }]), ext: { caravans: {} } } as unknown as FullView;
    expect(seatCamelVp(view, 0)).toBe(0);
  });

  it("drops a building whose every land hex Raiders has conquered", () => {
    const hexes = vertexHexes(b);
    const tiles = hexes.map((hex) => ({ hex, res: "wood" }));
    const conquered = at([{ v: b, owner: 0 }], { raiders: { conquered: hexes } }, tiles);
    expect(seatCamelVp(conquered, 0)).toBe(0);
    const partly = at([{ v: b, owner: 0 }], { raiders: { conquered: hexes.slice(1) } }, tiles);
    expect(seatCamelVp(partly, 0)).toBe(1);
  });
});
