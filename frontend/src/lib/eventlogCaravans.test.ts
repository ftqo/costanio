import { test, expect, describe } from "vitest";
import { describeEvent, logMessageText, EVENT_FORMATTERS, type LogMessage } from "./eventlog";
import type { GameEvent } from "./gamestate";

const P = (s: number) => `P${s}`;
const ev = (type: string, data: unknown): GameEvent => ({ seq: 0, type, data });
const text = (lines: LogMessage[]): string[] => lines.map((l) => logMessageText(l));
const say = (type: string, data: unknown) => text(describeEvent(ev(type, data), P, false));

describe("the vote opens", () => {
  test("names the seat whose turn ended", () => {
    // docs/rules/scenarios.md: "Bidding is open and sequential: it starts with
    // the player who just finished their turn and goes clockwise." The finisher
    // starts the round and is where a tie or empty round falls.
    expect(say("tab_camel_vote", { finisher: 2 })).toEqual([
      "P2 built and ended the turn; the table bids for the next camel, starting with them",
    ]);
  });
});

// `tab_camel_bid` is public with no redactor: bidding is sequential and later
// bidders answer knowing the tally.
describe("a bid shows what was bid", () => {
  test("counts the votes, in votes rather than in cards", () => {
    // Votes, not card icons: `cards` is against a ruleset-dependent resource
    // pair the event does not name (wool and grain, or brick and lumber with
    // Knights). One card is one vote.
    expect(say("tab_camel_bid", { player: 1, cards: [3, 2] })).toEqual([
      "P1 bid for the camel, votes: 5",
    ]);
  });

  test("bidding nothing is an answer and gets its own sentence", () => {
    expect(say("tab_camel_bid", { player: 1, cards: [0, 0] })).toEqual([
      "P1 bid nothing for the camel",
    ]);
  });

  // "a bid may name the placement it wants, and seats naming the same placement
  // pool their votes": the coalition mechanism.
  test("names the caravan a bid asked for, 1-based to a reader", () => {
    expect(say("tab_camel_bid", { player: 1, cards: [2, 0], path: { caravan: 1, e: {} } })).toEqual(
      ["P1 bid for caravan 2, votes: 2"],
    );
  });

  test("a pre-`cards` log still counts, off its wool and grain", () => {
    expect(say("tab_camel_bid", { player: 1, wool: 3, grain: 2 })).toEqual([
      "P1 bid for the camel, votes: 5",
    ]);
  });

  test("uses the singular at one vote", () => {
    // A plural form renders "1 votes" in a single-plural-form locale whose
    // translation is blank (the English source falls back under that locale's
    // rules, so n=1 takes `other`). A label and value never needs agreement.
    expect(say("tab_camel_bid", { player: 1, cards: [1, 0] })).toEqual([
      "P1 bid for the camel, votes: 1",
    ]);
  });
});

describe("resolution separates pickPlacer's four outcomes", () => {
  // "X places the camel" reads as a win in all four.
  test("a majority is a win, and every payment is spelled out in votes", () => {
    // The payments are tied (3 votes each): the legacy derivation says "tie" but
    // the engine stamped "majority". A payload both agree on would not catch a
    // `camelOutcomeOf` that ignored `reason`.
    //
    // `paid` carries `cards: [a, b]` against an unnamed, ruleset-chosen pair,
    // hence votes rather than sheep and wheat.
    const lines = say("tab_camel_resolved", {
      placer: 1,
      reason: "majority",
      paid: [
        { player: 1, cards: [2, 1] },
        { player: 2, cards: [1, 2] },
      ],
    });
    expect(lines).toEqual([
      "P1 paid for the camel, votes: 3",
      "P2 paid for the camel, votes: 3",
      "P1 won the camel vote",
    ]);
  });

  test("a pre-`cards` log's payments still count", () => {
    const lines = say("tab_camel_resolved", {
      placer: 1,
      reason: "majority",
      paid: [{ player: 1, wool: 2, grain: 1 }],
    });
    expect(lines[0]).toBe("P1 paid for the camel, votes: 3");
  });

  test("a tie falls to the finisher and is not called a win", () => {
    const lines = say("tab_camel_resolved", {
      placer: 0,
      reason: "tie",
      paid: [
        { player: 1, cards: [1, 0] },
        { player: 2, cards: [0, 1] },
      ],
    });
    expect(lines[lines.length - 1]).toBe(
      "The vote was tied, so the camel went to P0, who ended the turn",
    );
    // `/won the camel vote/`, matching its sibling below: a tie rendered as a
    // win would read "won the camel vote".
    expect(lines.join(" ")).not.toMatch(/won the camel vote/);
  });

  // "if two or more seats holding a combined majority agree on a placement, the
  // camel goes there. This outranks the largest single bidder: at 4 / 3 / 3 the
  // two threes agreeing beat the four." Placed in the same batch with no
  // placer, and the payments alone cannot distinguish it from a win.
  test("a coalition is its own sentence and names no placer", () => {
    const lines = say("tab_camel_resolved", {
      placer: -1,
      reason: "coalition",
      paid: [
        { player: 0, cards: [4, 0] },
        { player: 1, cards: [3, 0] },
        { player: 2, cards: [3, 0] },
      ],
    });
    expect(lines[lines.length - 1]).toBe(
      "The bidders who agreed on a placement carried the vote between them",
    );
    expect(lines.join(" ")).not.toMatch(/won the camel vote/);
  });

  test("nobody bidding is its own sentence", () => {
    expect(say("tab_camel_resolved", { placer: 2, reason: "nobody", paid: [] })).toEqual([
      "Nobody bid, so the camel went to P2, who ended the turn",
    ]);
  });

  test("a stamped `nobody` is read, not re-derived from the payments", () => {
    // Synthetic: `reason: "nobody"` beside a payment the legacy derivation reads
    // as a tie. An empty `paid` would pass even if `reason` were ignored.
    const lines = say("tab_camel_resolved", {
      placer: 2,
      reason: "nobody",
      paid: [{ player: 1, cards: [1, 0] }],
    });
    expect(lines[lines.length - 1]).toBe("Nobody bid, so the camel went to P2, who ended the turn");
  });

  test("an omitted `paid` (the engine drops the key when empty) reads the same", () => {
    expect(say("tab_camel_resolved", { placer: 2, reason: "nobody" })).toEqual([
      "Nobody bid, so the camel went to P2, who ended the turn",
    ]);
  });

  test("the stamped reason wins over what the payments look like", () => {
    // Payments the old derivation reads as a clean win for P1; the engine says
    // tie.
    const lines = say("tab_camel_resolved", {
      placer: 1,
      reason: "tie",
      paid: [
        { player: 1, cards: [2, 0] },
        { player: 2, cards: [1, 0] },
      ],
    });
    expect(lines[lines.length - 1]).toBe(
      "The vote was tied, so the camel went to P1, who ended the turn",
    );
  });

  test("a log without a reason field renders by derivation", () => {
    // Replay is unaffected (the fold never reads it); only the prose needs it.
    expect(
      say("tab_camel_resolved", {
        placer: 0,
        paid: [
          { player: 1, wool: 1, grain: 0 },
          { player: 2, wool: 1, grain: 0 },
        ],
      })[2],
    ).toBe("The vote was tied, so the camel went to P0, who ended the turn");
  });
});

describe("the placement", () => {
  test("names the caravan and does not invent a player", () => {
    // `tab_camel_placed` carries only {caravan, e}; the placer was named by
    // `tab_camel_resolved`, usually the row above (the strict `blocks` freezes
    // only the turn advance). At most one vote is ever in flight, so "the
    // camel" is unambiguous.
    const lines = say("tab_camel_placed", { caravan: 1, e: {} });
    expect(lines).toEqual(["The camel joined caravan 2"]); // 0-based on the wire, 1-based to a reader
    expect(lines.join(" ")).not.toMatch(/P[0-9]/);
  });

  test("the caravan a player reads is one more than the caravan on the wire", () => {
    expect(say("tab_camel_placed", { caravan: 0, e: {} })).toEqual(["The camel joined caravan 1"]);
  });
});

describe("the marker stays silent", () => {
  test("tab_camel_built has no line", () => {
    expect(EVENT_FORMATTERS.tab_camel_built).toBeNull();
  });
});

describe("a fish spend names only the purchase", () => {
  test("the private half on the spender's own copy stays out of the line", () => {
    // The spender's copy is unredacted, so `discard` (which tiles left) and
    // `value` (their worth) appear in one transcript only. Printing either would
    // make the row differ by seat; the formatter reports the public `tiles`.
    const lines = say("tab_fish_spent", {
      player: 1,
      use: "remove_robber",
      tiles: 2,
      value: 3,
      discard: [1, 1, 0],
    });
    expect(lines).toEqual(["P1 spent 2 fish tiles to take the robber off the board"]);
    // Two 1-fish tiles worth 3: only the count may appear.
    expect(lines.join(" ")).not.toMatch(/\b3\b/);
  });

  // The 2-fish spend once moved the robber to a named hex and now removes it; an
  // old log keeps the sentence for what happened then.
  test("an old log's `move_robber` still says what that spend did", () => {
    expect(say("tab_fish_spent", { player: 1, use: "move_robber", tiles: 1, value: 2 })).toEqual([
      "P1 spent 1 fish tile to drive the robber away",
    ]);
  });

  // Older still, before the tile count was public: its only public number was
  // the value, which identifies the tiles, so the line goes quiet.
  test("a log with no tile count stays silent", () => {
    expect(say("tab_fish_spent", { player: 1, use: "move_robber", value: 2 })).toEqual([]);
  });

  // The 7-fish rung is "a free development card, or, in a ruleset with no
  // development deck, one progress card of the discipline you name". The
  // discipline is said by the `cak_progress_drawn` that follows.
  test("the progress-card rung has its own sentence", () => {
    expect(say("tab_fish_spent", { player: 0, use: "progress_card", tiles: 3, value: 7 })).toEqual([
      "P0 spent 3 fish tiles on a progress card",
    ]);
  });
});
