import { test, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  describeEvent,
  describeEventLines,
  logMessageText,
  EVENT_FORMATTERS,
  type LogMessage,
  type LogToken,
} from "./eventlog";
import type { GameEvent } from "./gamestate";
import { activateLocale } from "./i18n";

const P = (s: number) => `P${s}`;
const ev = (type: string, data: unknown): GameEvent => ({ seq: 0, type, data });

/**
 * The lines a formatter produced, as the rendered English sentence: the same
 * path the screen takes (look the message up in the active `en` catalogue,
 * activated by testSetup, substitute values, resolve tags). Counting tokens
 * would pass for a message that says nothing.
 */
const text = (lines: LogMessage[]): string[] => lines.map((l) => logMessageText(l));
const one = (lines: LogMessage[]): string => text(lines).join(" | ");

/** Every picture a line places, in the order its tags do. */
const toks = (line: LogMessage): LogToken[] =>
  (line.slots ?? []).flatMap((s) => ("fill" in s ? s.fill : []));

test("dice roll shows both faces and the total", () => {
  // The engine sends d1 and d2 separately; the faces are shown, not just the sum.
  const lines = describeEvent(ev("dice_rolled", { player: 1, d1: 3, d2: 4 }), P, false);
  expect(one(lines)).toBe("P1 rolled [3] [4] 7");
  expect(toks(lines[0])).toEqual([
    { k: "die", n: 3 },
    { k: "die", n: 4, red: true },
  ]);
});

test("the Knights event die rides on the roll it belongs to", () => {
  // Its own event on the wire, emitted with the roll (knights/hooks.go), shown on
  // the roll's line.
  const lines = describeEvent(ev("dice_rolled", { player: 0, d1: 1, d2: 2 }), P, false, {
    eventDie: "politics",
  });
  expect(toks(lines[0])).toContainEqual({ k: "edie", face: "politics" });
  // The event itself still renders nothing on its own.
  expect(describeEvent(ev("cak_event_die", { face: "politics", red: 2 }), P, false)).toEqual([]);
});

// A blocked tile pays nobody and otherwise leaves no trace. The caller supplies
// the tile (it holds the board and surrounding log); the line is asserted here.
test("the roll says which tile the robber blocked", () => {
  const lines = describeEvent(ev("dice_rolled", { player: 1, d1: 2, d2: 4 }), P, false, {
    blockedRes: 1, // wood
    blockedNum: 6,
  });
  expect(text(lines)).toEqual(["P1 rolled [2] [4] 6", "The robber blocked -Wood ×1 on 6"]);
  // Drawn as a spent card: one the terrain would have paid and the robber kept.
  expect(toks(lines[1])).toContainEqual({ k: "res", idx: 1, n: 1, loss: true });
});

test("an unblocked roll says nothing extra", () => {
  expect(describeEvent(ev("dice_rolled", { player: 1, d1: 2, d2: 4 }), P, false)).toHaveLength(1);
});

// The memo guard must include the blocked tile: a backfill may only learn the
// robber's position from a `robber_moved` further back, and stale lines would
// otherwise be served.
test("the blocked tile is part of the memo guard", () => {
  const e = ev("dice_rolled", { player: 0, d1: 3, d2: 3 });
  expect(describeEventLines(e, P, false)).toHaveLength(1);
  expect(describeEventLines(e, P, false, { blockedRes: 4, blockedNum: 6 })).toHaveLength(2);
  expect(describeEventLines(e, P, false)).toHaveLength(1);
});

test("resources_distributed lists each player's gains as cards", () => {
  const lines = describeEvent(
    ev("resources_distributed", { gains: [{ player: 0, gain: [0, 2, 0, 0, 1, 0] }] }),
    P,
    false,
  );
  expect(one(lines)).toBe("P0 received Wood ×2 Wheat ×1");
  expect(toks(lines[0])).toEqual([
    { k: "res", idx: 1, n: 2, loss: undefined },
    { k: "res", idx: 4, n: 1, loss: undefined },
  ]);
});

test("a commodity conversion rewrites the production it belongs to", () => {
  // A Knights city on commodity terrain pays 2 wood and converts one to paper,
  // reported as a separate event after `resources_distributed` was computed
  // from the raw hand. The distribution alone says "2 wood" for 1 wood and 1
  // paper.
  //
  // `res` is a board.Resource string, unlike the numeric Hand; `commodity` is
  // an index (0=cloth, 1=paper, 2=coin).
  const adjust = ev("cak_commodity_adjust", {
    player: 0,
    res: "wood",
    commodity: 1,
    count: 1,
  });
  const lines = describeEvent(
    ev("resources_distributed", { gains: [{ player: 0, gain: [0, 2, 0, 0, 0, 0] }] }),
    P,
    false,
    { adjusts: [adjust] },
  );
  expect(one(lines)).toBe("P0 received Wood ×1 Paper ×1");
  // The conversion still says nothing on its own row.
  expect(describeEvent(adjust, P, false)).toEqual([]);
});

test("a minted commodity is added beside the resource", () => {
  // The current engine pays one wood through the core and the paper separately
  // (`minted`), so the paper is an extra card. Consuming a wood for it would
  // show only "Paper ×1".
  const lines = describeEvent(
    ev("resources_distributed", { gains: [{ player: 0, gain: [0, 1, 0, 0, 0, 0] }] }),
    P,
    false,
    {
      adjusts: [
        ev("cak_commodity_adjust", {
          player: 0,
          res: "wood",
          commodity: 1,
          count: 1,
          minted: true,
        }),
      ],
    },
  );
  expect(one(lines)).toBe("P0 received Wood ×1 Paper ×1");
});

test("conversions land on the player they belong to, and only there", () => {
  // Sheep->cloth for one seat, ore->coin for another, in the same roll. Other
  // seats' cards and unnamed resources must not move.
  const lines = text(
    describeEvent(
      ev("resources_distributed", {
        gains: [
          { player: 0, gain: [0, 0, 0, 2, 1, 0] },
          { player: 1, gain: [0, 0, 0, 0, 0, 2] },
        ],
      }),
      P,
      false,
      {
        adjusts: [
          ev("cak_commodity_adjust", { player: 0, res: "sheep", commodity: 0, count: 1 }),
          ev("cak_commodity_adjust", { player: 1, res: "ore", commodity: 2, count: 2 }),
        ],
      },
    ),
  );
  expect(lines).toEqual(["P0 received Sheep ×1 Wheat ×1 Cloth ×1", "P1 received Coin ×2"]);
});

// A conversion can be partly or wholly unpaid (`short`). The resource still
// goes back, so an empty cloth stack leaves one wool, not a cloth and not two
// wool.
test("a withheld conversion hides commodity and resource", () => {
  const lines = text(
    describeEvent(
      ev("resources_distributed", { gains: [{ player: 0, gain: [0, 0, 0, 2, 0, 0] }] }),
      P,
      false,
      {
        adjusts: [
          ev("cak_commodity_adjust", {
            player: 0,
            res: "sheep",
            commodity: 0,
            count: 1,
            short: 1,
          }),
        ],
      },
    ),
  );
  expect(lines).toEqual(["P0 received Sheep ×1"]);
});

test("a partly withheld conversion shows the part that was paid", () => {
  // Two cities on the same pasture, one cloth left on the stack.
  const lines = text(
    describeEvent(
      ev("resources_distributed", { gains: [{ player: 0, gain: [0, 0, 0, 4, 0, 0] }] }),
      P,
      false,
      {
        adjusts: [
          ev("cak_commodity_adjust", {
            player: 0,
            res: "sheep",
            commodity: 0,
            count: 2,
            short: 1,
          }),
        ],
      },
    ),
  );
  expect(lines).toEqual(["P0 received Sheep ×2 Cloth ×1"]);
});

test("a roll with no conversions is untouched", () => {
  expect(
    text(
      describeEvent(
        ev("resources_distributed", { gains: [{ player: 0, gain: [0, 2, 0, 0, 0, 0] }] }),
        P,
        false,
        { adjusts: [] },
      ),
    ),
  ).toEqual(["P0 received Wood ×2"]);
});

test("starting_resources reads its own shape, not the distribution's", () => {
  // The setup grant is one event per player with `{player, gain}`, not the
  // `{gains: [...]}` list; reading the wrong field silently drops every grant.
  expect(
    one(describeEvent(ev("starting_resources", { player: 2, gain: [0, 1, 0, 1, 0, 1] }), P, false)),
  ).toBe("Setup: P2 received Wood ×1 Sheep ×1 Ore ×1");
});

test("an empty setup grant says nothing", () => {
  // The first settlement grants nothing, which is not worth a line.
  expect(
    describeEvent(ev("starting_resources", { player: 0, gain: [0, 0, 0, 0, 0, 0] }), P, false),
  ).toEqual([]);
});

test("a roll that produced nothing says so, but a setup grant does not", () => {
  // A silent roll is information (blocked or unsettled hexes produced
  // nothing); a silent setup grant is not.
  expect(text(describeEvent(ev("resources_distributed", { gains: [] }), P, false))).toEqual([
    "Nobody produced",
  ]);
});

test("a discard shows the cards, not a count", () => {
  // CardsDiscardedData carries the per-resource hand and RedactEvent leaves it,
  // so the cards are public anyway.
  const lines = describeEvent(
    ev("cards_discarded", { player: 1, cards: [0, 2, 0, 1, 0, 1] }),
    P,
    false,
  );
  expect(one(lines)).toBe("P1 discarded -Wood ×2 -Sheep ×1 -Ore ×1");
  expect(toks(lines[0])).toEqual([
    { k: "res", idx: 1, n: 2, loss: true },
    { k: "res", idx: 3, n: 1, loss: true },
    { k: "res", idx: 5, n: 1, loss: true },
  ]);
});

test("longest road uses the base label, trade route under islands", () => {
  expect(one(describeEvent(ev("longest_road", { holder: 2 }), P, false))).toBe(
    "P2 took the Longest Road",
  );
  expect(one(describeEvent(ev("longest_road", { holder: 2 }), P, true))).toBe(
    "P2 took the Longest Trade Route",
  );
});

test("metropolis names the track and draws that track's own building", () => {
  const lines = describeEvent(
    ev("cak_metropolis", { track: 1, holder: 0, prev: -1, v: 0 }),
    P,
    false,
  );
  expect(one(lines)).toBe("P0 built the Politics metropolis");
  // metros.glb ships three different buildings, so the track is part of the piece.
  expect(toks(lines[0])).toContainEqual({ k: "piece", piece: "metro_politics", seat: 0 });
});

test("turn boundaries render nothing", () => {
  expect(describeEvent(ev("turn_started", { player: 0 }), P, false)).toEqual([]);
});

test("aqueduct take shows the card; empty bank reads as nothing taken", () => {
  // board.Resource serializes as a string ("ore", "none"), not a Hand index;
  // see engine/board/resource_json.go.
  expect(one(describeEvent(ev("cak_aqueduct_taken", { player: 2, res: "ore" }), P, false))).toBe(
    "P2 took Ore ×1 from the bank (Aqueduct)",
  );
  expect(one(describeEvent(ev("cak_aqueduct_taken", { player: 2, res: "none" }), P, false))).toBe(
    "P2 couldn't take a resource (Aqueduct: bank empty)",
  );
});

/** The barbarian attack, as prose lines. */
const barb = (data: Record<string, unknown>): string[] =>
  text(describeEvent(ev("cak_barbarian_attack", data), P, false));

test("a repelled attack leads with the outcome and credits the sole defender", () => {
  // One line for the result, one per consequence, as monopoly_resolved does.
  expect(barb({ strength: 5, cities: 3, win: true, defender: 1 })).toEqual([
    "Barbarians attacked and were repelled (defense 5, 3 cities).",
    "P1 was the strongest defender (+1 VP).",
  ]);
});

test("a tie for strongest defender is finally reported", () => {
  // `tied_defenders` explains the two progress-card draws that follow.
  expect(barb({ strength: 4, cities: 4, win: true, defender: -1, tied_defenders: [1, 2] })).toEqual(
    [
      "Barbarians attacked and were repelled (defense 4, 4 cities).",
      "Tied for strongest defender, each drawing a progress card: P1 and P2",
    ],
  );
  // Three or more is a list.
  expect(
    barb({ strength: 6, cities: 6, win: true, defender: -1, tied_defenders: [0, 1, 2] })[1],
  ).toBe("Tied for strongest defender, each drawing a progress card: P0, P1, and P2");
});

test("a win with nobody defending and nothing standing says exactly that", () => {
  // The engine only reaches win-with-no-defender at zero cities (0 >= 0).
  expect(barb({ strength: 0, cities: 0, win: true, defender: -1 })).toEqual([
    "Barbarians attacked and found nothing to raid.",
  ]);
});

test("a barbarian breakthrough names losses and pending choices", () => {
  // `downgraded` is the no-choice case (one sacrificable city), resolved by the
  // attack; `pending_downgrade` lists players who pick, whose loss comes later.
  expect(
    barb({
      strength: 2,
      cities: 5,
      win: false,
      defender: -1,
      downgraded: [{ player: 1 }],
      pending_downgrade: [0, 2],
    }),
  ).toEqual([
    "Barbarians attacked and broke through (defense 2, 5 cities).",
    "P1 lost a city to the barbarians.",
    "P0 must give up a city.",
    "P2 must give up a city.",
  ]);
});

test("a breakthrough with nothing takeable is one line", () => {
  // Everyone left holds only settlements or only metropolises, which are immune.
  expect(barb({ strength: 1, cities: 4, win: false, defender: -1 })).toEqual([
    "Barbarians attacked and broke through (defense 1, 4 cities), but no city could be taken.",
  ]);
});

test("a single city is a city, not 1 cities", () => {
  expect(barb({ strength: 1, cities: 1, win: true, defender: 0 })[0]).toBe(
    "Barbarians attacked and were repelled (defense 1, 1 city).",
  );
});

test("the configured skip of the first attack stays silent", () => {
  expect(describeEvent(ev("cak_barbarian_attack", { skipped: true }), P, false)).toEqual([]);
});

test("a chosen city sacrifice reads as its own line", () => {
  expect(
    one(
      describeEvent(
        ev("cak_barbarian_downgraded", { player: 2, v: { q: 0, r: 0, side: 0 } }),
        P,
        false,
      ),
    ),
  ).toBe("P2 gave a city to the barbarians");
});

// The other answer to the same debt, with Rivers alongside Knights. It must read
// as a city kept, or a reader cannot tell whether the city fell.
test("buying a pillage off reads as the city being kept, with the price", () => {
  const got = one(describeEvent(ev("cak_pillage_bought_out", { player: 2 }), P, false));
  expect(got).toBe("P2 paid 5 coins and kept the city");
  expect(got).not.toMatch(/gave a city|had no city/);
});

// A player owed a sacrifice with no city left. A zero vertex is also what an
// absent field decodes to, so the line must not claim a city was taken.
test("a forfeit says nothing was taken, rather than claiming a city", () => {
  const got = one(
    describeEvent(ev("cak_barbarian_downgraded", { player: 2, forfeit: true }), P, false),
  );
  expect(got).toBe("P2 had no city left to give the barbarians");
  expect(got).not.toMatch(/gave a city/);
});

// An earned-but-unplaced metropolis is a pause the table waits on.
test("an unplaced metropolis says who is choosing", () => {
  expect(
    one(describeEvent(ev("cak_metropolis_pending", { track: 1, holder: 2, prev: -1 }), P, false)),
  ).toBe("P2 earned the Politics metropolis and is choosing a city");
});

test("bank_traded shows the cards given and received", () => {
  const lines = describeEvent(
    ev("bank_traded", { player: 0, give: [0, 0, 0, 0, 4, 0], get: [0, 0, 0, 0, 0, 1] }),
    P,
    false,
  );
  expect(one(lines)).toBe("P0 traded Wheat ×4 → Ore ×1");
  expect(toks(lines[0])).toEqual([
    { k: "res", idx: 4, n: 4, loss: undefined },
    { k: "res", idx: 5, n: 1, loss: undefined },
  ]);
});

test("bank_traded falls back to generic if a side is empty", () => {
  expect(
    one(
      describeEvent(
        ev("bank_traded", { player: 0, give: [0, 0, 0, 0, 0, 0], get: [0, 0, 0, 0, 0, 1] }),
        P,
        false,
      ),
    ),
  ).toBe("P0 traded with the bank");
});

test("a player trade names both players and both hands", () => {
  // TradeExecutedData carries both players and both hands.
  expect(
    one(
      describeEvent(
        ev("trade_executed", {
          by: 0,
          with: 2,
          give: [0, 1, 0, 0, 0, 0],
          want: [0, 0, 0, 0, 0, 2],
        }),
        P,
        false,
      ),
    ),
  ).toBe("P0 traded Wood ×1 → Ore ×2 with P2");
});

test("cak_commodity_traded handles resource->commodity", () => {
  // give 2 ore (resource string), get 1 coin (commodity idx 2). Resource fields
  // are strings on the wire; commodity fields are indices.
  expect(
    one(
      describeEvent(
        ev("cak_commodity_traded", {
          player: 1,
          give_res: "ore",
          give_com: 0,
          give_is_com: false,
          give_n: 2,
          get_res: "none",
          get_com: 2,
          get_is_com: true,
          count: 1,
        }),
        P,
        false,
      ),
    ),
  ).toBe("P1 traded Ore ×2 → Coin ×1");
});

test("cak_commodity_basket_traded reads as one mixed trade", () => {
  // 4 wood at 4:1 and 2 wheat at 2:1 for 2 coin. Hands stay numeric arrays;
  // only scalar resource fields are strings.
  expect(
    one(
      describeEvent(
        ev("cak_commodity_basket_traded", {
          player: 1,
          spend_res: [0, 4, 0, 0, 2, 0],
          spend_com: [0, 0, 0],
          get_res: [0, 0, 0, 0, 0, 0],
          get_com: [0, 0, 2],
        }),
        P,
        false,
      ),
    ),
  ).toBe("P1 traded Wood ×4 Wheat ×2 → Coin ×2");
});

test("cak_trading_house swaps 2 commodities for 1 output", () => {
  // give cloth (com idx 0), get 1 brick (resource string)
  expect(
    one(
      describeEvent(
        ev("cak_trading_house", {
          player: 2,
          give: 0,
          get_res: "brick",
          get_com: 0,
          com_out: false,
        }),
        P,
        false,
      ),
    ),
  ).toBe("P2 traded Cloth ×2 → Brick ×1");
});

test("base dev cards render prose; Year of Plenty shows its gain", () => {
  expect(one(describeEvent(ev("road_building_played", { player: 0 }), P, false))).toBe(
    "P0 played Road Building",
  );
  expect(
    one(describeEvent(ev("year_of_plenty", { player: 0, gain: [0, 0, 2, 0, 0, 0] }), P, false)),
  ).toBe("P0 played Year of Plenty Brick ×2");
});

test("played cards render as card tokens", () => {
  // The name becomes its own token (LogLine hangs the explanation off it) while
  // the flattened text, the transcript and accessible label, is unchanged.
  const dev = describeEvent(ev("road_building_played", { player: 0 }), P, false)[0];
  expect(toks(dev)).toContainEqual({ k: "card", kind: "dev", id: "road_building" });

  const prog = describeEvent(ev("cak_progress_played", { player: 1, card: "deserter" }), P, false);
  expect(toks(prog[0])).toContainEqual({ k: "card", kind: "progress", id: "deserter" });
  expect(one(prog)).toBe("P1 played Deserter");

  // An event without a card id still says something true, with no nameless
  // token.
  expect(one(describeEvent(ev("cak_progress_played", { player: 1 }), P, false))).toBe(
    "P1 played a progress card",
  );
});

test("monopoly shows the haul and itemizes what each player lost", () => {
  const lines = describeEvent(
    ev("monopoly_resolved", {
      player: 0,
      res: "wheat",
      takes: [
        { player: 1, count: 3 },
        { player: 2, count: 1 },
      ],
    }),
    P,
    false,
  );
  // The verb states the loss rather than relying on faded cards.
  expect(text(lines)).toEqual([
    "P0 played Monopoly and took Wheat ×4",
    "P1 lost -Wheat ×3",
    "P2 lost -Wheat ×1",
  ]);
});

test("monopoly that catches nobody says so rather than implying a haul", () => {
  expect(
    one(describeEvent(ev("monopoly_resolved", { player: 0, res: "ore", takes: [] }), P, false)),
  ).toBe("P0 played Monopoly on Ore ×1 but nobody had any");
  // Takes is omitted entirely when empty (Go marshals a nil slice as null).
  expect(one(describeEvent(ev("monopoly_resolved", { player: 0, res: "ore" }), P, false))).toBe(
    "P0 played Monopoly on Ore ×1 but nobody had any",
  );
});

test("setup city placement renders prose", () => {
  expect(one(describeEvent(ev("setup_city_placed", { player: 1 }), P, false))).toBe(
    "P1 placed a city",
  );
});

test("built pieces carry the builder's own piece", () => {
  // The log shows every player's pieces, so the seat rides on the token.
  expect(toks(describeEvent(ev("settlement_built", { player: 3 }), P, false)[0])).toContainEqual({
    k: "piece",
    piece: "settlement",
    seat: 3,
  });
  expect(toks(describeEvent(ev("cak_knight_built", { player: 1 }), P, false)[0])).toContainEqual({
    k: "piece",
    piece: "knight",
    seat: 1,
  });
});

test("merchant placement renders prose, not a leak", () => {
  expect(one(describeEvent(ev("cak_merchant_placed", { player: 0, hex: 3 }), P, false))).toBe(
    "P0 placed the merchant",
  );
});

test("every deliberately-silent event stays silent, and leaks no identifier", () => {
  // Render nothing rather than `cak_knights_refresh` spelled out as words.
  // Driven off the table, so it covers every `null` row.
  const silent = Object.entries(EVENT_FORMATTERS)
    .filter(([, f]) => f === null)
    .map(([k]) => k);
  expect(silent.length).toBeGreaterThan(10);
  for (const t of [...silent, "some_future_event"]) {
    const out = describeEvent(ev(t, { player: 0 }), P, false);
    expect(out, t).toEqual([]);
    const s = one(out).toLowerCase();
    expect(s).toBe("");
    expect(s).not.toContain("cak");
    expect(s).not.toContain("tab");
  }
});

// A 7 that moved nothing has no other trace; this pins the wording (the engine
// emits it on a 7 with no landfall yet). The 7 itself is on the line above.
//
// The two-fish spend records the robber's removal as a move to its off-board
// coordinate, which must not read as "moved the robber".
test("the robber leaving the board is not a second robber move", () => {
  expect(
    describeEvent(
      ev("robber_moved", { player: 1, hex: { q: -1073741824, r: -1073741824 } }),
      P,
      false,
    ),
  ).toEqual([]);
  expect(one(describeEvent(ev("robber_moved", { player: 1, hex: { q: 0, r: 1 } }), P, false))).toBe(
    "P1 moved the robber",
  );
});

test("an idle 7 explains why the robber did not move", () => {
  const got = one(describeEvent(ev("cak_robber_idle", {}), P, false));
  expect(got).toBe("The robber stays out of play until the barbarians land");
  expect(got).not.toMatch(/7/);
});

// ---- totality ----
//
// `Record<EventType, Formatter | null>` cannot omit a union member. What a type
// cannot check is whether the union matches the server, so this reads the
// engine's event-type constants and compares the sets.
test("the formatter table is total over the engine's event types", () => {
  // Every module directory: a module missing here is unchecked in both
  // directions. eventlogExplorers.test.ts scans `engine/explorers` again on its
  // own.
  const dirs = [
    "engine",
    "engine/islands",
    "engine/knights",
    "engine/scenarios",
    "engine/harbormaster",
    "engine/rivers",
    "engine/raiders",
    "engine/wagons",
    "engine/explorers",
  ];
  const wire = new Set<string>();
  for (const dir of dirs) {
    const abs = join(__dirname, "../../..", dir);
    for (const f of readdirSync(abs)) {
      if (!f.endsWith(".go") || f.endsWith("_test.go")) continue;
      const src = readFileSync(join(abs, f), "utf-8");
      for (const m of src.matchAll(/EventType\s*=\s*"([a-z0-9_]+)"/g)) wire.add(m[1]);
    }
  }
  // Sanity: the scan found the events, not an empty directory.
  expect(wire.size).toBeGreaterThan(80);
  expect(wire.has("dice_rolled")).toBe(true);

  const table = new Set(Object.keys(EVENT_FORMATTERS));
  const missing = [...wire].filter((t) => !table.has(t)).sort();
  expect(missing, "engine event types with no row in EVENT_FORMATTERS").toEqual([]);
  // Nothing invented: every row is a real event, except `trade_canceled`, a
  // legacy spelling the engine declares under an unexported name.
  const extra = [...table].filter((t) => !wire.has(t)).sort();
  expect(extra, "rows in EVENT_FORMATTERS with no engine event type").toEqual([]);
});

// ---- lines for visible game actions ----
//
// Each is a visible action (a card leaving a hand, a knight leaving the board,
// the Longest Road changing hands) that needs its own line.

test("Bishop's commodity steal mirrors the resource steal", () => {
  // Both parties get `com`; everyone else's copy is redacted to the two names.
  expect(
    one(describeEvent(ev("cak_commodity_stolen", { thief: 0, victim: 2, com: 1 }), P, false)),
  ).toBe("P0 stole from P2 Paper ×1");
  expect(one(describeEvent(ev("cak_commodity_stolen", { thief: 0, victim: 2 }), P, false))).toBe(
    "P0 stole from P2",
  );
});

test("Spy's steal is told to the victim too, and named only to the parties", () => {
  // The redactor strips `card` for non-parties (engine/knights/events.go) and keeps
  // it for thief and victim.
  expect(
    one(
      describeEvent(ev("cak_progress_stolen", { thief: 1, victim: 0, card: "bishop" }), P, false),
    ),
  ).toBe("P1 took a progress card from P0 Bishop");
  expect(one(describeEvent(ev("cak_progress_stolen", { thief: 1, victim: 0 }), P, false))).toBe(
    "P1 took a progress card from P0",
  );
});

test("a Deserter's knight does not vanish in silence", () => {
  // The payload names the owner, not an actor; there is no `player`.
  const lines = describeEvent(ev("cak_knight_removed", { owner: 2, v: {} }), P, false);
  expect(one(lines)).toBe("P2 lost a knight");
  expect(toks(lines[0])).toContainEqual({ k: "piece", piece: "knight", seat: 2 });
});

test("Diplomat names whose road was removed", () => {
  expect(
    one(describeEvent(ev("cak_road_relocated", { player: 0, owner: 2, from: {} }), P, false)),
  ).toBe("P0 removed P2's road");
  expect(
    one(
      describeEvent(ev("cak_road_relocated", { player: 0, owner: 0, from: {}, to: {} }), P, false),
    ),
  ).toBe("P0 moved one of their roads");
  expect(
    one(describeEvent(ev("cak_road_relocated", { player: 0, owner: 0, from: {} }), P, false)),
  ).toBe("P0 removed one of their own roads");
});

test("Inventor's token swap names the two numbers, and no player", () => {
  // tokensSwappedData has no `player` (the swap is the event). `an` and `bn` are
  // display-only: `an` is the number leaving hex `a`.
  expect(
    one(describeEvent(ev("cak_tokens_swapped", { a: {}, b: {}, an: 5, bn: 9 }), P, false)),
  ).toBe("Two number tokens were swapped, the 5 and the 9.");
});

test("a swap logged before the numbers existed keeps its old sentence", () => {
  // `an`/`bn` exist for the log only; Apply derives the swap from the board, so
  // older logs decode them as zero and keep the original sentence.
  expect(one(describeEvent(ev("cak_tokens_swapped", { a: {}, b: {} }), P, false))).toBe(
    "Two number tokens were swapped",
  );
  expect(
    one(describeEvent(ev("cak_tokens_swapped", { a: {}, b: {}, an: 0, bn: 0 }), P, false)),
  ).toBe("Two number tokens were swapped");
});

test("a harvest shows the yield", () => {
  expect(
    one(describeEvent(ev("cak_harvest", { player: 1, res: "wheat", count: 2 }), P, false)),
  ).toBe("P1 harvested Wheat ×2");
  expect(
    one(describeEvent(ev("cak_harvest", { player: 1, res: "none", count: 0 }), P, false)),
  ).toBe("P1 harvested nothing");
});

test("Medicine's city reads like a city", () => {
  const lines = describeEvent(ev("cak_cheap_city", { player: 3, v: {} }), P, false);
  expect(one(lines)).toBe("P3 upgraded to a city (Medicine)");
  expect(toks(lines[0])).toContainEqual({ k: "piece", piece: "city", seat: 3 });
});

test("a city improvement shows its price", () => {
  // Track 0 (Trade) is paid in cloth, track 1 (Politics) in coin, track 2
  // (Science) in paper: engine/knights's commodityForTrack.
  expect(one(describeEvent(ev("cak_improved", { player: 0, track: 0, cost: 2 }), P, false))).toBe(
    "P0 improved Trade -Cloth ×2",
  );
  expect(one(describeEvent(ev("cak_improved", { player: 0, track: 1, cost: 3 }), P, false))).toBe(
    "P0 improved Politics -Coin ×3",
  );
  expect(one(describeEvent(ev("cak_improved", { player: 0, track: 2, cost: 0 }), P, false))).toBe(
    "P0 improved Science",
  );
});

test("Warlord counts the knights it woke, zero included", () => {
  expect(one(describeEvent(ev("cak_knights_all_active", { player: 1, count: 3 }), P, false))).toBe(
    "P1 activated 3 knights",
  );
  expect(one(describeEvent(ev("cak_knights_all_active", { player: 1, count: 1 }), P, false))).toBe(
    "P1 activated 1 knight",
  );
  // Zero is said too, or Warlord doing nothing looks like a bug.
  const none = describeEvent(ev("cak_knights_all_active", { player: 1, count: 0 }), P, false);
  expect(one(none)).toBe("P1 activated 0 knights");
  expect(toks(none[0]).some((tok) => tok.k === "piece")).toBe(false);
  // An old log without the count still says something.
  expect(one(describeEvent(ev("cak_knights_all_active", { player: 1 }), P, false))).toBe(
    "P1 activated their knights",
  );
});

test("the levies are the whole visible effect of the two monopoly cards", () => {
  // Nothing else marks that every opponent just paid. Rendered like the base
  // monopoly.
  const res = describeEvent(
    ev("cak_resource_levy", {
      player: 0,
      res: "ore",
      takes: [
        { player: 1, count: 2 },
        { player: 2, count: 1 },
      ],
    }),
    P,
    false,
  );
  expect(text(res)).toEqual(["P0 took Ore ×3", "P1 lost -Ore ×2", "P2 lost -Ore ×1"]);
  const com = describeEvent(
    ev("cak_commodity_levy", { player: 0, commodity: 2, takes: [{ player: 3, count: 4 }] }),
    P,
    false,
  );
  expect(text(com)).toEqual(["P0 took Coin ×4", "P3 lost -Coin ×4"]);
  expect(
    one(describeEvent(ev("cak_resource_levy", { player: 0, res: "ore", takes: [] }), P, false)),
  ).toBe("P0 demanded Ore ×1 but no opponent held that card");
});

test("taken and given cards are named for the parties, counted for others", () => {
  // Master Merchant / Wedding: both parties hold `cards`, everyone else a
  // `count`.
  expect(
    one(
      describeEvent(ev("cak_cards_taken", { from: 2, to: 0, cards: [0, 1, 0, 0, 1, 0] }), P, false),
    ),
  ).toBe("P0 took Wood ×1 Wheat ×1 from P2");
  expect(one(describeEvent(ev("cak_cards_taken", { from: 2, to: 0, count: 2 }), P, false))).toBe(
    "P0 took 2 cards from P2",
  );
  expect(
    one(
      describeEvent(ev("cak_cards_given", { from: 2, to: 0, cards: [0, 0, 0, 1, 0, 0] }), P, false),
    ),
  ).toBe("P2 gave Sheep ×1 to P0");
  expect(one(describeEvent(ev("cak_cards_given", { from: 2, to: 0, count: 1 }), P, false))).toBe(
    "P2 gave 1 card to P0",
  );
  expect(
    one(describeEvent(ev("cak_commodity_taken", { from: 1, to: 0, cards: [2, 0, 0] }), P, false)),
  ).toBe("P0 took Cloth ×2 from P1");
});

test("Commercial Harbor names the commodity only to the two parties", () => {
  expect(
    one(
      describeEvent(ev("cak_harbor_given", { taker: 0, giver: 1, res: "brick", com: 0 }), P, false),
    ),
  ).toBe("P1 gave Cloth ×1 to P0 for Brick ×1");
  expect(
    one(describeEvent(ev("cak_harbor_given", { taker: 0, giver: 1, res: "brick" }), P, false)),
  ).toBe("P1 gave a commodity to P0 for Brick ×1");
});

test("a progress draw names the card for the drawer only", () => {
  // The drawer's copy carries `card` and `track`, so the drawer sees the card.
  expect(
    one(describeEvent(ev("cak_progress_drawn", { player: 1, card: "crane", track: 2 }), P, false)),
  ).toBe("P1 drew Crane");
  expect(one(describeEvent(ev("cak_progress_drawn", { player: 1, track: 0 }), P, false))).toBe(
    "P1 drew a Trade card",
  );
});

test("an over-limit progress discard is visible to its owner", () => {
  expect(
    one(
      describeEvent(ev("cak_progress_discarded", { player: 1, card: "spy", track: 1 }), P, false),
    ),
  ).toBe("P1 discarded Spy");
  expect(one(describeEvent(ev("cak_progress_discarded", { player: 1, track: 1 }), P, false))).toBe(
    "P1 discarded a Politics card",
  );
});

test("Merchant Fleet says which card it discounts", () => {
  expect(
    one(
      describeEvent(ev("cak_merchant_fleet", { player: 0, res: "wood", is_com: false }), P, false),
    ),
  ).toBe("P0 may trade Wood ×1 2:1 this turn");
  expect(
    one(describeEvent(ev("cak_merchant_fleet", { player: 0, com: 2, is_com: true }), P, false)),
  ).toBe("P0 may trade Coin ×1 2:1 this turn");
});

test("a commodity discard shows the cards, like the resource discard does", () => {
  expect(
    one(describeEvent(ev("cak_commodity_discarded", { player: 2, cards: [1, 0, 2] }), P, false)),
  ).toBe("P2 discarded -Cloth ×1 -Coin ×2");
});

test("a relocated knight gets its own line, by its own owner", () => {
  const lines = describeEvent(ev("cak_knight_relocated", { player: 3, v: {} }), P, false);
  expect(one(lines)).toBe("P3 relocated the displaced knight");
  expect(toks(lines[0])).toContainEqual({ k: "piece", piece: "knight", seat: 3 });
});

test("an event's lines are cached by identity", () => {
  // `LogRow` is memoised so appending an event does not re-render the whole
  // log; this is the invariant it rests on: same event, same naming, same array
  // back. A fresh array of equal lines would re-render every row.
  const e = ev("dice_rolled", { player: 1, a: 3, b: 4 });
  const first = describeEventLines(e, P, false);
  expect(describeEventLines(e, P, false)).toBe(first);
  expect(describeEventLines(e, P, false)).toBe(first);

  // A formatter with nothing to say returns no line, so "no lines" means "no
  // row".
  expect(first.every((l) => logMessageText(l) !== "")).toBe(true);

  // A different event object is a different row even with identical contents:
  // the log is append-only.
  expect(describeEventLines(ev("dice_rolled", { player: 1, a: 3, b: 4 }), P, false)).not.toBe(
    first,
  );
});

test("re-describing happens when the NAMING changes, not just the event", () => {
  // The cache is keyed on an immutable log row, so lines only change with the
  // naming: the seat-name resolver, the Islands wording, or the Knights event
  // die on a roll's line.
  const e = ev("dice_rolled", { player: 1, a: 3, b: 4 });
  const base = describeEventLines(e, P, false);
  const other = (s: number) => `Player ${s}`;

  expect(describeEventLines(e, other, false)).not.toBe(base);
  expect(describeEventLines(e, P, true)).not.toBe(base);
  expect(describeEventLines(e, P, false, { eventDie: "barbarian" })).not.toBe(base);

  // The same arguments again hit the cache.
  const die = describeEventLines(e, P, false, { eventDie: "barbarian" });
  expect(describeEventLines(e, P, false, { eventDie: "barbarian" })).toBe(die);
});

// ---- ending a game the table cannot finish ----
//
// These four events are how a stuck game ends; the log is where the other
// players read what happened.

test("a surrender names the player who conceded", () => {
  expect(one(describeEvent(ev("player_surrendered", { player: 1 }), P, false))).toBe(
    "P1 surrendered",
  );
});

test("a draw offer and both answers to it are all in the log", () => {
  expect(one(describeEvent(ev("draw_offered", { player: 2 }), P, false))).toBe("P2 offered a draw");
  expect(one(describeEvent(ev("draw_responded", { player: 0, accept: true }), P, false))).toBe(
    "P0 accepted the draw",
  );
  expect(one(describeEvent(ev("draw_responded", { player: 0, accept: false }), P, false))).toBe(
    "P0 declined the draw",
  );
});

test("a claim against bots says whether it was won or drawn", () => {
  expect(one(describeEvent(ev("game_claimed", { player: 1, winner: 1 }), P, false))).toBe(
    "P1 ended the game against the bots, in the lead",
  );
  expect(one(describeEvent(ev("game_claimed", { player: 1, winner: -1 }), P, false))).toBe(
    "P1 ended the game against the bots, with nobody ahead",
  );
});

// A finished game with no winner is a draw, not a game that ended normally.
test("the closing line tells a draw from a win", () => {
  expect(one(describeEvent(ev("game_finished", { winner: 2, vp: 10 }), P, false))).toBe(
    "Game over!",
  );
  expect(one(describeEvent(ev("game_finished", { winner: -1, vp: 0 }), P, false))).toBe(
    "The game ended in a draw",
  );
});

// An offer withdrawn (by its owner, or by the server on expiry) leaves a prompt
// that vanished; the log says why.
test("a withdrawn draw offer says so", () => {
  expect(one(describeEvent(ev("draw_cancelled", { player: 2 }), P, false))).toBe(
    "P2 withdrew the draw offer",
  );
});

// ---- translation reorders the line ----
//
// Runs against the real `de` catalogue rather than a fixture, so it fails if
// message ids drift from the catalogue or the renderer stops honouring word
// order.
test("a translated line uses its own word order", async () => {
  await activateLocale("de");
  try {
    // German puts the participle at the end, past the dice and the total.
    const roll = describeEvent(ev("dice_rolled", { player: 1, d1: 3, d2: 4 }), P, false);
    expect(one(roll)).toBe("P1 hat [3] [4] 7 gewürfelt");

    // The pictures stay in the line where the German put them.
    expect(toks(roll[0])).toEqual([
      { k: "die", n: 3 },
      { k: "die", n: 4, red: true },
    ]);

    // A second shape, with the cards mid-sentence.
    expect(
      one(describeEvent(ev("cards_discarded", { player: 1, cards: [0, 2, 0, 0, 0, 0] }), P, false)),
    ).toBe("P1 hat -Holz ×2 abgeworfen");

    // The Longest Road is a whole sentence per award and ruleset, so the article
    // agrees with the noun.
    expect(one(describeEvent(ev("longest_road", { holder: 2 }), P, true))).toBe(
      "P2 hat die Längste Handelsroute übernommen",
    );
  } finally {
    await activateLocale("en");
  }
});

// ---- Fishermen -------------------------------------------------------------

test("a catch names every seat that drew, and how many TILES", () => {
  // Tiles, never value. The count is public anyway (roll, grounds, buildings);
  // a value would identify the tiles. See engine/scenarios/fishermen.go,
  // FishExt.Tiles.
  const lines = describeEvent(
    ev("tab_fish_caught", { draws: [3, 0, 1], total: 4, boot_to: -1 }),
    P,
    false,
  );
  expect(text(lines)).toEqual(["P0 caught 3 fish tiles", "P2 caught 1 fish tile"]);
});

test("a catch omits per-seat values", () => {
  // The old field is neither read as a count nor printed as a value.
  const lines = describeEvent(
    ev("tab_fish_caught", { values: [3, 0, 1], total: 3, boot_to: -1 }),
    P,
    false,
  );
  expect(text(lines)).toEqual([]);
});

test("the boot turning up in a catch gets its own line", () => {
  const lines = describeEvent(
    ev("tab_fish_caught", { draws: [2, 0, 0], total: 2, boot_to: 1 }),
    P,
    false,
  );
  expect(text(lines)).toEqual(["P0 caught 2 fish tiles", "P1 landed the old boot"]);
});

test("the private half of a catch stays out of the log", () => {
  // `tab_fish_gained` carries one seat's tiles and is redacted to a bare
  // {player} for everyone else; the catch line already said the public part.
  //
  // Asserted on the formatter table, not describeEvent's output: an unformatted
  // type also returns nothing, so removing the explicit null would still pass.
  expect(EVENT_FORMATTERS.tab_fish_gained).toBeNull();
  expect("tab_fish_gained" in EVENT_FORMATTERS).toBe(true);
  expect(describeEvent(ev("tab_fish_gained", { player: 0, gain: [1, 1, 0] }), P, false)).toEqual(
    [],
  );
});

test("a spend says what it bought and how many tiles it took", () => {
  // The number is `tiles`, the tiles that left the spender, not the price or
  // value: spendTiles is deterministic and the prices are known, so a value
  // would identify the tiles.
  const lines = describeEvent(
    ev("tab_fish_spent", { player: 1, use: "move_robber", tiles: 2 }),
    P,
    false,
  );
  expect(one(lines)).toBe("P1 spent 2 fish tiles to drive the robber away");
});

test("a spend omits its value", () => {
  // An old log's public half was the value, which identifies the tiles; the
  // line goes quiet rather than print it or "0 fish tiles".
  const lines = describeEvent(
    ev("tab_fish_spent", { player: 1, use: "move_robber", value: 3 }),
    P,
    false,
  );
  expect(lines).toEqual([]);
});

test("each of the five spends has its own sentence", () => {
  const said = ["steal", "take_resource", "free_road", "dev_card"].map((use) =>
    one(describeEvent(ev("tab_fish_spent", { player: 0, use, tiles: 2 }), P, false)),
  );
  expect(said).toEqual([
    "P0 spent 2 fish tiles to steal a card",
    "P0 spent 2 fish tiles to take a resource from the bank",
    // "or ship": under Islands the rung lays a hull, and the event does not
    // say which.
    "P0 spent 2 fish tiles on a free road or ship",
    "P0 spent 2 fish tiles on a development card",
  ]);
});

test("an unknown spend prints nothing", () => {
  expect(
    describeEvent(ev("tab_fish_spent", { player: 0, use: "teleport", value: 9 }), P, false),
  ).toEqual([]);
});

test("the boot line names the recipient", () => {
  // `tab_boot_given` carries {player: recipient}, not the giver (fishermen.go's
  // decideGiveBoot emits {player: d.To}).
  const lines = describeEvent(ev("tab_boot_given", { player: 2 }), P, false);
  expect(one(lines)).toBe("P2 was handed the old boot");
});

// ---- Rivers ----

test("a bridge is its own piece in the log, not a road with a caption", () => {
  const lines = describeEvent(
    ev("rivers_bridge_built", { player: 1, e: {}, free: false }),
    P,
    false,
  );
  expect(one(lines)).toBe("P1 built a bridge");
  expect(toks(lines[0])).toEqual([{ k: "piece", piece: "bridge", seat: 1 }]);
});

test("a bridge bought with fish is still a bridge built", () => {
  // `free` means fish paid (Fishermen's six-fish spend); for the log it is
  // still a bridge built.
  expect(one(describeEvent(ev("rivers_bridge_built", { player: 0, free: true }), P, false))).toBe(
    "P0 built a bridge",
  );
});

test("the building ledger says which way the coins went", () => {
  // Two sentences, not a signed number: a coin coming back (a ship left the
  // river, the Diplomat removed a road) is its own event.
  const earned = ev("rivers_coins_changed", { player: 2, delta: 3, reason: "build" });
  expect(one(describeEvent(earned, P, false))).toBe("P2 earned 3 coins");
  const one_ = ev("rivers_coins_changed", { player: 2, delta: 1, reason: "build" });
  expect(one(describeEvent(one_, P, false))).toBe("P2 earned 1 coin");
  const back = ev("rivers_coins_changed", { player: 0, delta: -1, reason: "build" });
  expect(one(describeEvent(back, P, false))).toBe("P0 returned 1 coin to the supply");
});

test("a paired coin event speaks once, from the half that names the cards", () => {
  // Buying and spending coins are two events each (Apply moves two pools), so
  // the coins_changed half is silent for every reason but `build`.
  for (const reason of ["bought", "spent", "trade"]) {
    expect(
      describeEvent(ev("rivers_coins_changed", { player: 0, delta: 1, reason }), P, false),
      reason,
    ).toEqual([]);
  }
  expect(
    describeEvent(ev("rivers_coins_changed", { player: 0, delta: 0, reason: "build" }), P, false),
  ).toEqual([]);
});

test("a coin purchase shows its cost", () => {
  // Four, three or two of a resource depending on the buyer's harbours, which
  // others cannot derive. Drawn as spent cards.
  const lines = describeEvent(
    ev("rivers_coin_bought", { player: 1, res: "ore", paid: 3 }),
    P,
    false,
  );
  expect(one(lines)).toBe("P1 traded -Ore ×3 for a coin");
  expect(toks(lines[0])).toEqual([{ k: "res", idx: 5, n: 3, loss: true }]);
});

test("a coin spend names the card that arrived and not the price", () => {
  // The price (two) is a rule constant on the view, not in this module.
  const lines = describeEvent(ev("rivers_coins_spent", { player: 0, res: "wheat" }), P, false);
  expect(one(lines)).toBe("P0 bought Wheat ×1 with coins");
  expect(toks(lines[0])).toEqual([{ k: "res", idx: 4, n: 1 }]);
});

test("coins moving in a trade name both seats", () => {
  expect(one(describeEvent(ev("rivers_coin_traded", { from: 0, to: 2, coins: 4 }), P, false))).toBe(
    "P0 gave P2 4 coins",
  );
  expect(describeEvent(ev("rivers_coin_traded", { from: 0, to: 2, coins: 0 }), P, false)).toEqual(
    [],
  );
});

test("a tie for the coin lead is announced", () => {
  // The Wealthiest Settler tile goes to the strict leader, so a tie removes it;
  // without a line a victory point vanishes unexplained.
  const tied = describeEvent(
    ev("rivers_wealth_changed", { wealthiest: -1, poorest: [] }),
    P,
    false,
  );
  expect(one(tied)).toBe("Nobody holds the Wealthiest Settler: the coin lead is tied");
});

test("the Poorest Settler line names every holder", () => {
  const lines = describeEvent(
    ev("rivers_wealth_changed", { wealthiest: 1, poorest: [0, 2, 3] }),
    P,
    false,
  );
  expect(text(lines)).toEqual([
    "P1 holds the Wealthiest Settler",
    // Each holds a tile: there is one per seat.
    "P0, P2, and P3 each hold a Poorest Settler tile",
  ]);
});

test("a single Poorest Settler holder is not told they 'each' hold one", () => {
  const lines = describeEvent(
    ev("rivers_wealth_changed", { wealthiest: 1, poorest: [2] }),
    P,
    false,
  );
  expect(text(lines)).toEqual([
    "P1 holds the Wealthiest Settler",
    "P2 holds a Poorest Settler tile",
  ]);
});

test("a table playing without the Poorest tile gets no line about it", () => {
  // With Wagons or Raiders the tile is out of the game, so the engine derives
  // an empty holder list.
  const lines = describeEvent(
    ev("rivers_wealth_changed", { wealthiest: 0, poorest: [] }),
    P,
    false,
  );
  expect(text(lines)).toEqual(["P0 holds the Wealthiest Settler"]);
});

test("a knight standing down to chase does not read as a move", () => {
  // The engine logs a chase as a knight "moving" to the vertex it is on.
  const v = { q: 1, r: 0, side: 1 };
  expect(one(describeEvent(ev("cak_knight_moved", { player: 2, from: v, to: v }), P, false))).toBe(
    "P2 sent a knight to give chase",
  );
  expect(
    one(
      describeEvent(
        ev("cak_knight_moved", { player: 2, from: v, to: { q: 1, r: 1, side: 0 } }),
        P,
        false,
      ),
    ),
  ).toBe("P2 moved a knight");
});
