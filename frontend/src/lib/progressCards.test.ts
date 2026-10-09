import { test, expect, describe } from "vitest";
import {
  PROGRESS_CARDS,
  PROGRESS_DECKS,
  PROGRESS_DECK_LOOK,
  progressCardDeck,
  progressCardHint,
  progressCardName,
  progressCardPrompt,
  progressCardTargetsBoard,
  progressDeckLook,
  progressGhost,
  progressInput,
  type ProgressCardId,
  type ProgressDeck,
} from "./progressCards";

/**
 * The engine's deck split, transcribed from engine/knights/progress.go
 * (`deckComposition`), to catch the UI table drifting. Written out rather than
 * derived from PROGRESS_CARDS, which is what is under test.
 */
const ENGINE_DECKS: Record<ProgressDeck, readonly string[]> = {
  trade: [
    "commercial_harbor",
    "master_merchant",
    "merchant",
    "merchant_fleet",
    "resource_monopoly",
    "trade_monopoly",
  ],
  politics: [
    "bishop",
    "constitution",
    "deserter",
    "diplomat",
    "intrigue",
    "saboteur",
    "spy",
    "warlord",
    "wedding",
  ],
  science: [
    "alchemist",
    "crane",
    "engineer",
    "inventor",
    "irrigation",
    "medicine",
    "mining",
    "printer",
    "road_building",
    "smith",
  ],
};

const ALL_IDS = Object.keys(PROGRESS_CARDS) as ProgressCardId[];

describe("the table is total, and total against the engine", () => {
  // TypeScript enforces the fields; this enforces the key set against the Go
  // file, which TypeScript cannot see.
  test("every engine progress card has an entry, and there are no extras", () => {
    const fromEngine = PROGRESS_DECKS.flatMap((d) => ENGINE_DECKS[d]).sort();
    expect([...ALL_IDS].sort()).toEqual(fromEngine);
  });

  test.each(PROGRESS_DECKS)("every %s card is filed under that deck", (deck) => {
    for (const id of ENGINE_DECKS[deck]) {
      expect(progressCardDeck(id), id).toBe(deck);
    }
  });

  test("every deck has a mark to draw with", () => {
    for (const deck of PROGRESS_DECKS) {
      const look = PROGRESS_DECK_LOOK[deck];
      expect(look.label, deck).toBeTruthy();
      expect(look.color, deck).toMatch(/^var\(--color-/);
    }
    // Three decks, three distinct colours.
    const colors = PROGRESS_DECKS.map((d) => PROGRESS_DECK_LOOK[d].color);
    expect(new Set(colors).size).toBe(3);
  });
});

describe("every card is described", () => {
  test.each(ALL_IDS)("%s has a name and a real effect sentence", (id) => {
    const info = PROGRESS_CARDS[id];
    expect(info.name).toBeTruthy();
    // A name, not the wire id leaking through.
    expect(info.name).not.toContain("_");
    expect(info.hint.trim().length).toBeGreaterThan(10);
    expect(info.hint.trim().endsWith(".")).toBe(true);
    expect(progressCardName(id)).toBe(info.name);
    expect(progressCardHint(id)).toBe(info.hint);
    expect(progressDeckLook(id)).toEqual(PROGRESS_DECK_LOOK[info.deck]);
  });
});

describe("input kinds", () => {
  // Matches what routes/Game.tsx's playProgress does with each kind: "noarg"
  // fires immediately, board kinds arm a picking mode, the rest open an overlay.
  const CASES: [ProgressCardId, ReturnType<typeof progressInput>][] = [
    ["resource_monopoly", "res"],
    ["trade_monopoly", "com"],
    ["merchant_fleet", "resorcom"],
    ["crane", "track"],
    ["spy", "victim"],
    ["alchemist", "dice"],
    ["merchant", "hex"],
    ["bishop", "hex"],
    ["medicine", "vertex"],
    ["intrigue", "vertex"],
    ["diplomat", "edge"],
    ["master_merchant", "complex"],
    ["deserter", "complex"],
    ["inventor", "complex"],
    ["commercial_harbor", "complex"],
    ["road_building", "noarg"],
    ["smith", "noarg"],
    ["warlord", "noarg"],
    ["wedding", "noarg"],
    ["saboteur", "noarg"],
    ["engineer", "noarg"],
    ["irrigation", "noarg"],
    ["mining", "noarg"],
    ["constitution", "vp"],
    ["printer", "vp"],
  ];

  test.each(CASES)("%s plays as %s", (card, kind) => {
    expect(progressInput(card)).toBe(kind);
  });

  test("the case table covers every card", () => {
    expect(CASES.map(([c]) => c).sort()).toEqual([...ALL_IDS].sort());
  });

  // Constitution and Printer score on draw (`vpCard`, engine/knights/progress.go)
  // and never enter a hand.
  test.each(["constitution", "printer"] as const)("%s is never playable", (card) => {
    expect(progressInput(card)).toBe("vp");
    expect(progressCardTargetsBoard(card)).toBe(false);
    expect(progressGhost(card)).toBeNull();
  });
});

describe("board targets, prompts and ghosts agree with each other", () => {
  // The board-targeting set.
  const TARGETING = ["merchant", "bishop", "medicine", "intrigue", "diplomat", "inventor"];

  test("exactly the target-published cards say so", () => {
    expect(ALL_IDS.filter(progressCardTargetsBoard).sort()).toEqual([...TARGETING].sort());
  });

  test("a card with a written prompt is one that points at the board", () => {
    for (const id of ALL_IDS) {
      if (PROGRESS_CARDS[id].prompt !== null) expect(progressCardTargetsBoard(id), id).toBe(true);
    }
  });

  test("a card with a ghost is one that points at the board", () => {
    for (const id of ALL_IDS) {
      if (PROGRESS_CARDS[id].ghost !== null) expect(progressCardTargetsBoard(id), id).toBe(true);
    }
  });

  // The preview table, in the three states a card can be in.
  //
  // Bishop previews the robber at its destination. Diplomat and Intrigue are
  // "standing": they preview the piece under the pointer, on its way off the
  // board. Everything else is null.
  test("each card previews a destination piece, the piece it takes, or nothing", () => {
    const PREVIEWS: Partial<Record<(typeof ALL_IDS)[number], string>> = {
      medicine: "city",
      merchant: "merchant",
      bishop: "robber",
      diplomat: "standing",
      intrigue: "standing",
    };
    for (const id of ALL_IDS) {
      expect(progressGhost(id), id).toBe(PREVIEWS[id] ?? null);
    }
  });

  test("exactly two cards take a piece", () => {
    // "standing" (preview whatever the pointer is on) only fits a card that
    // removes something; a new user of it has to be justified here.
    const removals = ALL_IDS.filter((id) => PROGRESS_CARDS[id].ghost === "standing");
    expect(removals).toEqual(["diplomat", "intrigue"]);
    // And both target the board.
    for (const id of removals) expect(progressCardTargetsBoard(id), id).toBe(true);
  });

  test("a prompt names the card and then the target", () => {
    expect(progressCardPrompt("medicine")).toBe(
      "Medicine: tap one of your settlements to upgrade it for 2 ore and 1 wheat",
    );
    expect(progressCardPrompt("bishop")).toBe("Bishop: tap a hex to move the robber to");
  });

  test("a card with no written prompt gets a default one", () => {
    expect(progressCardPrompt("inventor")).toBe("Inventor: tap a spot on the board");
  });
});

describe("hints state the rule the engine actually implements", () => {
  // Each checked against the named engine site rather than the card's text.
  test("Wedding: the giver chooses, not the taker (CmdGiveCards)", () => {
    const hint = PROGRESS_CARDS.wedding.hint;
    expect(hint).toContain("of their own choosing");
    expect(hint).not.toContain("of your choice");
  });

  test("Trade Monopoly takes one each, not all (progress_play.go Count: 1)", () => {
    const hint = PROGRESS_CARDS.trade_monopoly.hint;
    expect(hint).toContain("take 1 of it");
    expect(hint).not.toContain("all of it");
  });

  test("Master Merchant takes exactly two, not 'up to' two", () => {
    const hint = PROGRESS_CARDS.master_merchant.hint;
    expect(hint).not.toContain("up to");
    expect(hint).toContain("fewer than 2");
  });

  test("Warlord says the activation is free and that the knights cannot act", () => {
    const hint = PROGRESS_CARDS.warlord.hint;
    expect(hint).toContain("free");
    expect(hint).toMatch(/freshly activated/i);
    expect(hint).toMatch(/none of them can act/i);
  });

  test("Deserter offers the same strength or lower, and admits the forfeit", () => {
    // Tiers are numbered ("Strength {level} of 3"), not named. The tier is the
    // taker's choice (decideDeserterPlace).
    const hint = PROGRESS_CARDS.deserter.hint;
    expect(hint).toMatch(/same strength or lower/i);
    expect(hint).not.toMatch(/basic|mighty/i);
    expect(hint).toMatch(/you place none/i);
  });

  test("Bishop steals commodities too", () => {
    expect(PROGRESS_CARDS.bishop.hint).toMatch(/commodity/i);
  });

  test("Merchant names the 2:1, not only the victory point", () => {
    const hint = PROGRESS_CARDS.merchant.hint;
    expect(hint).toContain("2:1");
    expect(hint).toContain("1 VP");
  });

  test("Intrigue says any strength, and that a cornered knight is removed", () => {
    const hint = PROGRESS_CARDS.intrigue.hint;
    expect(hint).toMatch(/any strength/i);
    expect(hint).toMatch(/removed/i);
  });

  test("Spy drops the impossible victory-point caveat", () => {
    // VP cards resolve on draw and can never be in a hand to steal.
    expect(PROGRESS_CARDS.spy.hint).not.toMatch(/victory-point card/i);
  });
});

describe("unknown ids degrade rather than leak", () => {
  test("an unknown card id still reads as a card", () => {
    expect(progressCardName("future_card")).toBe("Future Card");
    expect(progressCardHint("future_card")).toBeUndefined();
    expect(progressCardDeck("future_card")).toBeUndefined();
    expect(progressDeckLook("future_card")).toBeUndefined();
    expect(progressCardPrompt("future_card")).toBe("Future Card: tap a spot on the board");
  });

  test("and is assumed to need a flow of its own rather than firing blind", () => {
    // Guessing "noarg" would send a refused command; guessing board targets
    // would grey it out forever.
    expect(progressInput("future_card")).toBe("complex");
    expect(progressCardTargetsBoard("future_card")).toBe(false);
    expect(progressGhost("future_card")).toBeNull();
  });

  test("a prototype-polluting id is not mistaken for a card", () => {
    expect(progressCardHint("toString")).toBeUndefined();
    expect(progressInput("constructor")).toBe("complex");
  });
});
