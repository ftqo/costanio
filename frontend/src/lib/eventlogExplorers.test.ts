import { test, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  describeEvent,
  logMessageText,
  EVENT_FORMATTERS,
  type LogMessage,
  type LogToken,
} from "./eventlog";
import type { GameEvent } from "./gamestate";

/**
 * The Explorers half of the event log: 26 events, mostly about a board that is
 * largely face down. As in eventlog.test.ts, assertions pin the rendered
 * sentence via the screen's path (look up the id in the active `en` catalogue,
 * substitute, resolve tags).
 */
const P = (s: number) => `P${s}`;
const ev = (type: string, data: unknown): GameEvent => ({ seq: 0, type, data });

const text = (lines: LogMessage[]): string[] => lines.map((l) => logMessageText(l));
const one = (lines: LogMessage[]): string => text(lines).join(" | ");
const toks = (line: LogMessage): LogToken[] =>
  (line.slots ?? []).flatMap((s) => ("fill" in s ? s.fill : []));

const say = (type: string, data: unknown) => one(describeEvent(ev(type, data), P, false));
const lines = (type: string, data: unknown) => text(describeEvent(ev(type, data), P, false));

/* ---------------------------------------------------------------- *
 * Totality
 * ---------------------------------------------------------------- */

// A module-scoped check on top of the full-tree scan in eventlog.test.ts: every
// event `engine/explorers` declares must have a row.
test("every Explorers event the engine can emit has a row", () => {
  const abs = join(__dirname, "../../..", "engine/explorers");
  const wire = new Set<string>();
  for (const f of readdirSync(abs)) {
    if (!f.endsWith(".go") || f.endsWith("_test.go")) continue;
    const src = readFileSync(join(abs, f), "utf-8");
    for (const m of src.matchAll(/EventType\s*=\s*"([a-z0-9_]+)"/g)) wire.add(m[1]);
  }
  // Sanity: the scan found the module, not an empty directory.
  expect(wire.size).toBeGreaterThan(20);
  expect(wire.has("explorers_hex_revealed")).toBe(true);

  const table = new Set(Object.keys(EVENT_FORMATTERS));
  expect(
    [...wire].filter((t) => !table.has(t)).sort(),
    "Explorers event types with no row in EVENT_FORMATTERS",
  ).toEqual([]);
  // Nothing invented. `explorers_ship_recycled` is declared in Go but never
  // emitted (recycling rides on `explorers_ship_built`'s `recycled`).
  const ours = [...table].filter((t) => t.startsWith("explorers_"));
  expect(ours.filter((t) => !wire.has(t)).sort(), "rows with no Explorers event type").toEqual([]);
  expect(ours.length).toBe(wire.size);
});

test("the three silent rows are silent, and say nothing about the module", () => {
  // Each explained at its row: an activation prompt whose outcome is its own
  // event, a phase marker the HUD shows, and start-of-turn housekeeping.
  for (const t of ["explorers_pirate_owed", "explorers_movement_began", "explorers_turn_reset"]) {
    expect(EVENT_FORMATTERS[t as keyof typeof EVENT_FORMATTERS], t).toBeNull();
    expect(describeEvent(ev(t, { player: 0 }), P, false), t).toEqual([]);
  }
});

/* ---------------------------------------------------------------- *
 * Setup and building
 * ---------------------------------------------------------------- */

test("the two setup buildings are told apart", () => {
  // A harbour settlement is worth 2 VP and is the only shipyard, so it gets its
  // own line.
  expect(say("explorers_harbour_placed", { player: 0, v: {} })).toBe(
    "P0 placed a harbour settlement",
  );
  expect(say("explorers_settlement_placed", { player: 1, v: {} })).toBe("P1 built a settlement");
});

test("the round-two settlement's grant rides on the same event", () => {
  // No separate `starting_resources`: the hand is on placeData.Gain.
  expect(
    lines("explorers_settlement_placed", { player: 0, v: {}, gain: [0, 1, 0, 0, 1, 0] }),
  ).toEqual(["P0 built a settlement", "Setup: P0 received Wood ×1 Wheat ×1"]);
});

test("setup round three places a road and a loaded ship in one sentence", () => {
  const l = describeEvent(ev("explorers_start_placed", { player: 2, ship_id: 1 }), P, false);
  expect(one(l)).toBe("P2 placed a road and a ship carrying a settler");
  expect(toks(l[0])).toEqual([
    { k: "piece", piece: "road", seat: 2 },
    { k: "piece", piece: "ship", seat: 2 },
  ]);
});

test("a settlement upgrades to a harbour settlement, never to a city", () => {
  expect(say("explorers_harbour_built", { player: 0, v: {} })).toBe(
    "P0 upgraded to a harbour settlement",
  );
});

test("a recycled ship is not the same line as a fourth hull", () => {
  // Recycling destroys the scrapped ship's cargo, so it needs its own sentence.
  expect(say("explorers_ship_built", { player: 0, ship_id: 4, e: {} })).toBe("P0 built a ship");
  expect(say("explorers_ship_built", { player: 0, ship_id: 4, e: {}, recycled: 2 })).toBe(
    "P0 scrapped a ship and built a new one",
  );
});

/* ---------------------------------------------------------------- *
 * Movement
 * ---------------------------------------------------------------- */

test("a plain move says one short sentence, and a tribute says what it cost", () => {
  // The commonest event (three ships, up to eight points each), so the plain
  // case borrows the Islands sentence. Tribute moves gold inside this event, so
  // only this line records it.
  expect(say("explorers_ship_moved", { player: 1, ship_id: 1, steps: 4 })).toBe("P1 moved a ship");
  expect(say("explorers_ship_moved", { player: 1, ship_id: 1, steps: 2, tribute: 1 })).toBe(
    "P1 moved a ship and paid 1 gold in tribute",
  );
});

test("a move ending in a discovery does not say it stopped", () => {
  // `stopped` is on the payload but unsaid: the reveal that ended the move is
  // the next event in the same commit.
  expect(say("explorers_ship_moved", { player: 0, ship_id: 1, steps: 1, stopped: true })).toBe(
    "P0 moved a ship",
  );
});

test("speeding a ship shows the wool leaving the hand", () => {
  const l = describeEvent(ev("explorers_ship_sped", { player: 0, ship_id: 1 }), P, false);
  expect(one(l)).toBe("P0 spent -Sheep ×1 to speed up a ship");
  expect(toks(l[0])).toContainEqual({ k: "res", idx: 3, n: 1, loss: true });
});

/* ---------------------------------------------------------------- *
 * The reveal
 * ---------------------------------------------------------------- */

// Most of the board is face down, so for every seat but the explorer this line
// is the only notice the map grew. Each of the six outcomes has its own
// sentence.
test("producing land is drawn as its card, with the chit as an aside", () => {
  const l = describeEvent(
    ev("explorers_hex_revealed", {
      player: 0,
      h: {},
      res: "ore",
      number: 8,
      region: 1,
      gain: [0, 0, 0, 0, 0, 1],
    }),
    P,
    false,
  );
  expect(one(l)).toBe("P0 explored new land Ore ×1 on 8");
  // The card comes from `res`, not `gain`: an empty bank pays nothing, and the
  // terrain is still the news.
  expect(toks(l[0])).toEqual([{ k: "res", idx: 5, n: 1 }]);
});

test("land revealed after the region's chit stack ran dry says no number", () => {
  // A dry stack is real: it is sized to the region's producing land plus gold
  // fields, and `drawChit` returns 0 past the end.
  expect(
    say("explorers_hex_revealed", { player: 0, h: {}, res: "wood", number: 0, region: 0 }),
  ).toBe("P0 explored new land Wood ×1");
});

test("open sea is its own result, not land with nothing on it", () => {
  expect(say("explorers_hex_revealed", { player: 3, h: {}, res: "sea", region: 0 })).toBe(
    "P3 explored open sea",
  );
});

test("a shoal shows the die face it answers to", () => {
  // Drawn as a die: it is the face the fishing roll needs, as in the fishing
  // rows.
  const l = describeEvent(
    ev("explorers_hex_revealed", { player: 1, h: {}, res: "sea", kind: 2, shoal: 5, region: 1 }),
    P,
    false,
  );
  expect(one(l)).toBe("P1 found a fish shoal [5]");
  expect(toks(l[0])).toEqual([{ k: "die", n: 5 }]);
});

test("a gold field is announced with the lair still on it", () => {
  expect(say("explorers_hex_revealed", { player: 2, h: {}, res: "gold", kind: 1, region: 0 })).toBe(
    "P2 found a gold field with a pirate lair on it",
  );
});

test("each spice village is a whole sentence, never a noun in a frame", () => {
  // 0 Swift Voyage, 1 Pirate Bonus, 2 Fast Gold (engine/explorers' Village).
  // Whole sentences, since the village is the noun the line is about.
  const found = (village: number) =>
    say("explorers_hex_revealed", { player: 0, h: {}, kind: 3, village, region: 0 });
  expect(found(0)).toBe("P0 found a Swift Voyage spice farm");
  expect(found(1)).toBe("P0 found a Pirate Bonus spice farm");
  expect(found(2)).toBe("P0 found a Fast Gold spice farm");
  // Zero is Swift Voyage and `village` is omitempty, so an absent field means
  // the first village.
  expect(say("explorers_hex_revealed", { player: 0, h: {}, kind: 3, region: 0 })).toBe(
    "P0 found a Swift Voyage spice farm",
  );
});

/* ---------------------------------------------------------------- *
 * Cargo
 * ---------------------------------------------------------------- */

test("buying cargo names the piece and shows the price leaving the hand", () => {
  const settler = describeEvent(
    ev("explorers_cargo_bought", {
      player: 0,
      v: {},
      at_ship: false,
      cargo: { settler: 1 },
      cost: [0, 1, 1, 1, 1, 0],
    }),
    P,
    false,
  );
  expect(one(settler)).toBe("P0 bought a settler -Wood ×1 -Brick ×1 -Sheep ×1 -Wheat ×1");
  expect(
    say("explorers_cargo_bought", {
      player: 1,
      ship_id: 2,
      at_ship: true,
      cargo: { crew: 1 },
      cost: [0, 0, 0, 1, 0, 1],
    }),
  ).toBe("P1 bought a crew -Sheep ×1 -Ore ×1");
});

test("a jettison names which piece was given up", () => {
  // Only legal when every slot is full, so always a piece given up for room.
  const j = (cargo: unknown) => say("explorers_jettisoned", { player: 0, at_ship: true, cargo });
  expect(j({ settler: 1 })).toBe("P0 returned a settler to the supply to make room");
  expect(j({ haul: 1 })).toBe("P0 returned a fish haul to the supply to make room");
  expect(j({ crew: 1 })).toBe("P0 returned a crew to the supply to make room");
  expect(j({ spice: 1 })).toBe("P0 returned a spice sack to the supply to make room");
  // A cargo type from a newer server prints nothing; the engine refuses an
  // empty jettison.
  expect(describeEvent(ev("explorers_jettisoned", { player: 0, cargo: {} }), P, false)).toEqual([]);
});

test("a harbour transfer says which way it went", () => {
  expect(say("explorers_cargo_moved", { player: 0, ship_id: 1, v: {}, to_ship: true })).toBe(
    "P0 loaded a ship at a harbour settlement",
  );
  expect(say("explorers_cargo_moved", { player: 0, ship_id: 1, v: {}, to_ship: false })).toBe(
    "P0 unloaded a ship into a harbour settlement",
  );
});

/* ---------------------------------------------------------------- *
 * Missions
 * ---------------------------------------------------------------- */

test("a crew landing tells a lair assault from a spice village apart", () => {
  // A lair crew is a third of an assault and comes home; a farm crew is spent
  // and buys a lasting advantage, so the farm case names the village.
  expect(say("explorers_crew_landed", { player: 0, ship_id: 1, h: {} })).toBe(
    "P0 landed a crew on a pirate lair",
  );
  expect(
    say("explorers_crew_landed", { player: 0, ship_id: 1, h: {}, sack: true, village: 1 }),
  ).toBe("P0 befriended a Pirate Bonus village and took a spice sack aboard");
});

test("a crew comes back off a captured lair", () => {
  expect(say("explorers_crew_taken", { player: 2, ship_id: 1, h: {} })).toBe(
    "P2 picked a crew up from a captured lair",
  );
});

test("the fishing roll shows its die whether it hit or missed", () => {
  // Both consume the phase's one roll, and the face shows whose shoal it was.
  expect(say("explorers_haul_placed", { player: 0, h: {}, die: 3 })).toBe(
    "P0 fished [3] and a haul appeared on that shoal",
  );
  expect(say("explorers_haul_missed", { player: 0, die: 6 })).toBe(
    "P0 fished [6] and caught nothing",
  );
});

test("a delivery counts hauls and sacks, together or apart", () => {
  // One delivery can move two mission markers: three shapes, three sentences.
  expect(say("explorers_delivered", { player: 0, ship_id: 1, hauls: 1 })).toBe(
    "P0 delivered 1 fish haul to the Council",
  );
  expect(say("explorers_delivered", { player: 0, ship_id: 1, sacks: 2 })).toBe(
    "P0 delivered 2 spice sacks to the Council",
  );
  expect(say("explorers_delivered", { player: 0, ship_id: 1, hauls: 1, sacks: 2 })).toBe(
    "P0 delivered 1 fish haul and 2 spice sacks to the Council",
  );
  expect(describeEvent(ev("explorers_delivered", { player: 0, ship_id: 1 }), P, false)).toEqual([]);
});

test("founding a settlement spends the settler and the ship", () => {
  expect(say("explorers_founded", { player: 1, ship_id: 3, v: {} })).toBe(
    "P1 landed a settler and founded a settlement",
  );
});

/* ---------------------------------------------------------------- *
 * The lair battle
 * ---------------------------------------------------------------- */

// The one event that pays players not on turn. The battle resolves in one event
// (so replays need no re-roll), so the log is the only place the throw shows.
test("a lair battle is an outcome line, then one line per consequence", () => {
  const l = lines("explorers_lair_resolved", {
    h: {},
    involved: [2, 0],
    rolls: [4, 6],
    crews: [2, 1],
    hero: 0,
    number: 9,
  });
  expect(l).toEqual([
    "A pirate lair fell. Each attacker takes 2 gold and a step up the lairs track: P2 and P0",
    "P2 threw [4] with 2 crews",
    "P0 threw [6] with 1 crew",
    "P0 led the battle, taking one more step and one crew back",
    "The gold field beneath it pays on 9",
  ]);
});

test("a lair captured with the chit stack dry says no number", () => {
  const l = lines("explorers_lair_resolved", {
    h: {},
    involved: [1],
    rolls: [5],
    crews: [3],
    hero: 1,
    number: 0,
  });
  expect(l).toEqual([
    "A pirate lair fell. Each attacker takes 2 gold and a step up the lairs track: P1",
    "P1 threw [5] with 3 crews",
    "P1 led the battle, taking one more step and one crew back",
  ]);
});

/* ---------------------------------------------------------------- *
 * The pirate ship
 * ---------------------------------------------------------------- */

test("the three pirate placements are three different sentences", () => {
  // Placing, moving your own, and sending an opponent's home differ; the
  // displacement ends that player's tribute.
  expect(say("explorers_pirate_moved", { player: 0, h: {} })).toBe("P0 placed their pirate ship");
  expect(say("explorers_pirate_moved", { player: 0, h: {}, from: {} })).toBe(
    "P0 moved their pirate ship",
  );
  expect(say("explorers_pirate_moved", { player: 0, h: {}, from: {}, displaced: 3 })).toBe(
    "P0 sent P3's pirate ship home and placed their own",
  );
});

test("the pirate's steal borrows the base game's sentence, and its redaction", () => {
  // `res` travels on a Visible list, as in the base steal, so only the two
  // seats see the card.
  expect(say("explorers_pirate_moved", { player: 0, h: {}, victim: 2, res: "brick" })).toBe(
    "P0 placed their pirate ship | P0 stole from P2 Brick ×1",
  );
  expect(say("explorers_pirate_moved", { player: 0, h: {}, victim: 2 })).toBe(
    "P0 placed their pirate ship | P0 stole from P2",
  );
});

test("the one route by which gold is ever stolen has its own line", () => {
  // The victim holds no resource cards. Gold is not a card and `log.stole`
  // draws one, so it gets its own sentence.
  expect(say("explorers_pirate_moved", { player: 1, h: {}, victim: 0, gold: 1 })).toBe(
    "P1 placed their pirate ship | P1 took 1 gold from P0",
  );
});

test("a pirate landing on a shoal scatters the haul, on its own line", () => {
  expect(say("explorers_pirate_moved", { player: 0, h: {}, haul: true })).toBe(
    "P0 placed their pirate ship | The pirate ship scattered the fish haul on that shoal",
  );
});

test("a chase shows every die it threw and the number it needed", () => {
  // Rolling stops at the first success, so there are never more rolls than
  // nominated ships. The target is shown so a reader who cannot see the
  // chaser's Pirate Bonus villages can tell a near miss from a hit.
  const won = describeEvent(
    ev("explorers_pirate_chased", { player: 0, ships: [1, 2], rolls: [3, 6], need: 6, won: true }),
    P,
    false,
  );
  expect(one(won)).toBe("P0 drove the pirate ship off [3] [6] needed 6");
  expect(toks(won[0])).toEqual([
    { k: "die", n: 3 },
    { k: "die", n: 6 },
  ]);
  expect(
    say("explorers_pirate_chased", { player: 0, ships: [1], rolls: [2], need: 5, won: false }),
  ).toBe("P0 failed to drive the pirate ship off [2] needed 5 or 6");
});

test("a chase names the exact faces that win, not a threshold", () => {
  // The south Pirate Bonus village shows a 4: alone it chases on a 4 or a 6,
  // and a 5 is a miss.
  expect(
    say("explorers_pirate_chased", {
      player: 0,
      ships: [1],
      rolls: [5],
      need: 4,
      hits: [4, 6],
      won: false,
    }),
  ).toBe("P0 failed to drive the pirate ship off [5] needed 4 or 6");
  expect(
    say("explorers_pirate_chased", {
      player: 0,
      ships: [1],
      rolls: [5],
      need: 4,
      hits: [4, 5, 6],
      won: true,
    }),
  ).toBe("P0 drove the pirate ship off [5] needed 4, 5, or 6");
});

/* ---------------------------------------------------------------- *
 * Gold
 * ---------------------------------------------------------------- */

// One line per gain, not a summary: reasons differ within one batch and the
// reason is the interesting half of a gold line.
test("gold from one roll is one line per seat", () => {
  expect(
    lines("explorers_gold_changed", {
      gains: [
        { player: 0, amount: 4, reason: "gold_field" },
        { player: 1, amount: 1, reason: "consolation" },
        { player: 2, amount: 1, reason: "consolation" },
      ],
    }),
  ).toEqual([
    "P0 took 4 gold from a gold field",
    "P1 produced nothing and took 1 gold",
    "P2 produced nothing and took 1 gold",
  ]);
});

test("a batch reason covers entries that carry none", () => {
  // The discovery batch stamps its reason once, on the event.
  expect(
    lines("explorers_gold_changed", { gains: [{ player: 3, amount: 2 }], reason: "reveal" }),
  ).toEqual(["P3 took 2 gold for the discovery"]);
});

test("a reason this build does not know still says gold moved", () => {
  // Unlike a fish spend, silence would hide a currency changing hands. The two
  // generic sentences differ by direction.
  expect(
    lines("explorers_gold_changed", { gains: [{ player: 0, amount: 2, reason: "lair" }] }),
  ).toEqual(["P0 took 2 gold"]);
  expect(
    lines("explorers_gold_changed", { gains: [{ player: 0, amount: -1, reason: "tribute" }] }),
  ).toEqual(["P0 paid 1 gold"]);
  // A zero entry is not a line.
  expect(
    describeEvent(ev("explorers_gold_changed", { gains: [{ player: 0, amount: 0 }] }), P, false),
  ).toEqual([]);
});

test("the three gold trades are three sentences, and an unknown one is none", () => {
  expect(
    say("explorers_gold_traded", { player: 0, get: [0, 0, 0, 0, 1, 0], gold: -2, reason: "buy" }),
  ).toBe("P0 spent 2 gold on Wheat ×1");
  expect(
    say("explorers_gold_traded", { player: 0, give: [0, 0, 0, 0, 0, 1], gold: 1, reason: "sell" }),
  ).toBe("P0 sold -Ore ×1 for 1 gold");
  expect(
    say("explorers_gold_traded", { player: 0, give: [0, 3, 0, 0, 0, 0], gold: 1, reason: "bank" }),
  ).toBe("P0 traded -Wood ×3 to the bank for 1 gold");
  expect(
    describeEvent(ev("explorers_gold_traded", { player: 0, gold: 1, reason: "wat" }), P, false),
  ).toEqual([]);
});

/* ---------------------------------------------------------------- *
 * The de-branding backstop
 * ---------------------------------------------------------------- */

test("no Explorers line ever leaks a wire identifier", () => {
  // Render nothing rather than 'Explorers hex revealed'. Driven off the table
  // so later rows are covered.
  for (const t of Object.keys(EVENT_FORMATTERS).filter((k) => k.startsWith("explorers_"))) {
    const out = describeEvent(ev(t, { player: 0 }), P, false);
    for (const s of text(out)) {
      expect(s.toLowerCase(), t).not.toContain("explorers_");
      expect(s, t).not.toContain("_");
    }
  }
});
