import { test, expect, describe } from "vitest";
import { describeEvent, logMessageText, EVENT_FORMATTERS, type LogMessage } from "./eventlog";
import type { GameEvent } from "./gamestate";

const P = (s: number) => `P${s}`;
const ev = (type: string, data: unknown): GameEvent => ({ seq: 0, type, data });
const text = (lines: LogMessage[]): string[] => lines.map((l) => logMessageText(l));
const say = (type: string, data: unknown) => text(describeEvent(ev(type, data), P, false));

// The board the feed hands the log, so a line can name a hex as a player does
// ("the 8-ore"), like the robber line.
const TILES = [
  { hex: { q: 2, r: 0 }, res: "ore" as const, num: 8 },
  { hex: { q: -2, r: 1 }, res: "wheat" as const, num: 5 },
];
const sayOn = (type: string, data: unknown) =>
  text(describeEvent(ev(type, data), P, false, { tiles: TILES }));

const hex = (q: number, r: number) => ({ q, r });
const edge = () => ({ a: { q: 0, r: 0, side: 0 }, b: { q: 1, r: 0, side: 1 } });

describe("a landing", () => {
  // The roll is stated once, before the landings resolve. It does not say
  // "built": alongside Knights the event die's ship face and each city
  // improvement also land a raider.
  test("names the numbers brought ashore, not a build", () => {
    expect(say("raiders_landing", { player: 1, numbers: [4, 9, 11] })).toEqual([
      "The raiders came for 4, 9, and 11, after P1 acted",
    ]);
  });

  test("says nothing when the roll is missing", () => {
    expect(say("raiders_landing", { player: 1, numbers: [] })).toEqual([]);
    expect(say("raiders_landing", { numbers: [4] })).toEqual([]);
  });

  test("a raider that lands names the hex the way a player does", () => {
    // By terrain and number, never coordinates, as the robber's line does.
    expect(sayOn("raiders_landed", { hex: hex(2, 0), rest: [9] })).toEqual([
      "A raider came ashore Ore ×1 on 8",
    ]);
  });

  test("without the board it still says a raider landed", () => {
    expect(say("raiders_landed", { hex: hex(2, 0), rest: [9] })).toEqual(["A raider came ashore"]);
  });

  // A number naming no eligible hex places nothing and is not re-rolled, so it
  // gets its own line.
  test("a number that names no coast gets a line of its own", () => {
    expect(say("raiders_landed", { rest: [11] })).toEqual([
      "That number found no coast to land on, and is not re-rolled",
    ]);
  });
});

describe("a card is revealed and resolved the moment it is bought", () => {
  test("names each of the four", () => {
    expect(say("raiders_card", { player: 0, card: "muster" })).toEqual(["P0 drew Muster"]);
    expect(say("raiders_card", { player: 0, card: "swift_rider" })).toEqual([
      "P0 drew Swift Rider",
    ]);
    expect(say("raiders_card", { player: 2, card: "intrigue" })).toEqual(["P2 drew Intrigue"]);
  });

  // A card token, drawn like a played development card: face and rule on hover.
  test("the card is a named-card token of the Raiders deck", () => {
    for (const card of ["muster", "swift_rider", "treason", "intrigue"]) {
      for (const extra of [{}, { void: true }]) {
        const [line] = describeEvent(ev("raiders_card", { player: 0, card, ...extra }), P, false);
        const toks = line.slots?.flatMap((s) => ("fill" in s ? s.fill : [])) ?? [];
        expect(toks, card).toContainEqual({ k: "card", kind: "raiders", id: card });
      }
    }
  });

  // Treason's gold is paid on the spot, by this event rather than the plan.
  test("Treason's two gold ride with the card, not with the plan", () => {
    expect(say("raiders_card", { player: 1, card: "treason", gold: 2 })).toEqual([
      "P1 drew Treason",
      "P1 took 2 gold for it",
    ]);
  });

  // A Muster with no rider and no free castle path is discarded with no effect
  // and no redraw (only Intrigue redraws).
  test("a card that did nothing says what it could not do", () => {
    expect(say("raiders_card", { player: 0, card: "muster", void: true })).toEqual([
      // "nowhere to put a rider" covers both cases: no rider left, or all six
      // castle paths occupied (`deck.go:79`).
      "P0 drew Muster with nowhere to put a rider, and discarded it",
    ]);
    expect(say("raiders_card", { player: 0, card: "intrigue", void: true })).toEqual([
      "P0 drew Intrigue with no raider to take, and drew again",
    ]);
  });

  // An unknown card means a newer server; render nothing rather than the raw
  // wire token.
  test("an unknown card renders nothing rather than its wire name", () => {
    expect(say("raiders_card", { player: 0, card: "sabotage" })).toEqual([]);
  });
});

describe("riders", () => {
  // A Muster always goes to the castle, a Swift Rider anywhere, so the line
  // says where.
  test("a placement says where the card allowed", () => {
    expect(say("raiders_rider_placed", { player: 0, e: edge(), card: "muster" })).toEqual([
      "P0 put a rider on the castle",
    ]);
    expect(say("raiders_rider_placed", { player: 0, e: edge(), card: "swift_rider" })).toEqual([
      "P0 put a rider on a path of their choosing",
    ]);
  });

  // Three paths are free and five cost one grain per rider, so a hurried move
  // is a spend.
  test("a hurried move names the grain it cost", () => {
    expect(say("raiders_rider_moved", { player: 1, from: edge(), to: edge() })).toEqual([
      "P1 moved a rider",
    ]);
    expect(
      say("raiders_rider_moved", { player: 1, from: edge(), to: edge(), hurry: true }),
    ).toEqual(["P1 spent a wheat to hurry a rider on"]);
  });

  // Swift Rider is the only optional card, so the line can name it.
  test("a decline names the one card that may be declined", () => {
    expect(say("raiders_declined", { player: 2, card: "swift_rider" })).toEqual([
      "P2 declined the Swift Rider",
    ]);
  });
});

describe("Treason and Intrigue", () => {
  test("Treason counts the raiders it moved", () => {
    expect(
      say("raiders_treason", {
        player: 0,
        moves: [{ from: hex(2, 0), to: hex(0, 2) }, { to: hex(-2, 0) }],
      }),
    ).toEqual(["P0 played Treason and moved 2 raiders"]);
  });

  test("one raider is one raider, not '1 raiders'", () => {
    expect(say("raiders_treason", { player: 0, moves: [{ to: hex(-2, 0) }] })).toEqual([
      "P0 played Treason and moved one raider",
    ]);
  });

  test("Intrigue takes a prisoner, and says so in those words", () => {
    expect(say("raiders_intrigue", { player: 1, hex: hex(2, 0) })).toEqual([
      "P1 took a raider prisoner with Intrigue",
    ]);
  });
});

describe("a battle", () => {
  // The headline is the rule: a hex falls when the riders on its six paths
  // outnumber its raiders. Strength comes from the event, since alongside
  // Knights it sums knight levels.
  test("says what beat what, then who got what", () => {
    expect(
      say("raiders_battle", {
        hex: hex(2, 0),
        raiders: 3,
        strength: 4,
        involved: [{ player: 0, e: edge() }],
        prisoners: [
          { player: 0, count: 2 },
          { player: 1, count: 1 },
        ],
        gold: [{ player: 2, count: 3 }],
        die: 4,
        dir: 0,
      }),
    ).toEqual([
      "The riders won a battle, 4 against 3 raiders",
      "P0 took 2 prisoners",
      "P1 took one prisoner",
      "P2 took 3 gold",
    ]);
  });

  // The die names a direction and takes every involved rider that way, so
  // losses are counted per seat.
  test("counts losses per seat rather than listing them per rider", () => {
    expect(
      say("raiders_battle", {
        hex: hex(2, 0),
        raiders: 1,
        strength: 3,
        involved: [],
        die: 2,
        dir: 1,
        lost: [
          { player: 0, e: edge() },
          { player: 0, e: edge() },
          { player: 1, e: edge() },
        ],
      }),
    ).toEqual([
      "The riders won a battle, 3 against one raider",
      "P0 lost 2 riders to the fight",
      "P1 lost a rider to the fight",
    ]);
  });
});

describe("the 7, which moves nothing", () => {
  test("opens the choice rather than announcing a move", () => {
    expect(say("raiders_seven", { player: 0 })).toEqual([
      "P0 rolled a 7 and steals a card from a player of their choice",
    ]);
  });

  // Redaction blanks `res` for all but the two parties; the sentence is the
  // same, only the picture changes.
  test("names the card only for the two players owed it", () => {
    const seen = say("raiders_stolen", { thief: 0, victim: 1, res: "ore" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("P0 stole from P1");
    const redacted = say("raiders_stolen", { thief: 0, victim: 1 });
    expect(redacted[0]).toContain("P0 stole from P1");
  });

  test("a 7 that found nobody holding a card says so", () => {
    expect(say("raiders_stolen", { thief: 0, victim: -1, nothing: true })).toEqual([
      "P0 found nobody to steal from",
    ]);
  });
});

describe("gold, which is a counter and not a card", () => {
  test("a purchase names the resource and the price", () => {
    expect(say("raiders_gold_spent", { player: 0, res: "brick", gold: 2 })).toEqual([
      "P0 bought Brick ×1 for 2 gold",
    ]);
  });

  test("a sale names the cards that left the hand", () => {
    const line = say("raiders_gold_gained", { player: 1, give: [0, 0, 0, 0, 4, 0], gold: 1 });
    expect(line).toHaveLength(1);
    expect(line[0]).toContain("P1 traded");
    expect(line[0]).toContain("1 gold");
  });

  // Gold may be on either side of a player trade, so this line accompanies the
  // trade's own.
  test("a transfer names both seats", () => {
    expect(say("raiders_gold_moved", { from: 0, to: 2, gold: 3 })).toEqual(["P0 gave P2 3 gold"]);
  });

  test("a transfer of nothing, or by nobody, says nothing", () => {
    expect(say("raiders_gold_moved", { from: 0, to: 2, gold: 0 })).toEqual([]);
    expect(say("raiders_gold_moved", { from: -1, to: 2, gold: 3 })).toEqual([]);
  });
});

describe("the sweep marker stays silent", () => {
  // Emitted at every turn end to clear per-turn counters, so it has an explicit
  // null rather than a line every turn.
  test("has an explicit null formatter", () => {
    expect(EVENT_FORMATTERS.raiders_sweep).toBeNull();
    expect(say("raiders_sweep", { player: 0 })).toEqual([]);
  });
});

describe("a battle names its hex", () => {
  // A won battle drives the raiders off; the riders do not take the hex.
  test("with the board, the battle line names where it was fought", () => {
    expect(
      sayOn("raiders_battle", {
        hex: hex(2, 0),
        raiders: 2,
        strength: 3,
        involved: [],
        die: 1,
        dir: 0,
      }),
    ).toEqual(["The riders won a battle, 3 against 2 raiders, Ore ×1 on 8"]);
  });
});

describe("conquest is announced", () => {
  test("a conquered hex, and the building it cost, with the points", () => {
    expect(
      sayOn("raiders_conquest", {
        conquered: [hex(2, 0)],
        lost: [
          { player: 1, v: { q: 2, r: 0, side: 0 }, city: true, vp: 2 },
          { player: 3, v: { q: 2, r: 0, side: 1 }, vp: 1 },
        ],
      }),
    ).toEqual([
      "The raiders conquered Ore ×1 on 8",
      "P1's city fell to the raiders (-2 VP)",
      "P3's settlement fell to the raiders (-1 VP)",
    ]);
  });

  test("a liberated hex, and the building that stands again", () => {
    expect(
      sayOn("raiders_conquest", {
        liberated: [hex(-2, 1)],
        restored: [{ player: 0, v: { q: -2, r: 1, side: 0 }, vp: 1 }],
      }),
    ).toEqual([
      "The raiders were driven off Wheat ×1 on 5",
      "P0's settlement stands again (+1 VP)",
    ]);
  });

  test("without the board, the hex lines still say what happened", () => {
    expect(say("raiders_conquest", { conquered: [hex(2, 0)], liberated: [hex(-2, 1)] })).toEqual([
      "The raiders conquered a hex",
      "The raiders were driven off a hex",
    ]);
  });

  test("an empty announcement says nothing", () => {
    expect(say("raiders_conquest", {})).toEqual([]);
  });
});
