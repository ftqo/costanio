import { test, expect } from "vitest";
import {
  attributeAny,
  attributeGain,
  planBatch,
  producing,
  producingHexes,
  type FlightCtx,
  type HexSource,
} from "./cardFlightPlan";
import { FLIGHT_STAGGER_MS, FLIGHT_BULK_LIMIT, endpointKey, faceKey } from "./board3d/cardflight";
import type { BoardTile, BuildingView, Hand, Vertex } from "./types";
import type { GameEvent } from "./gamestate";

// Vertex (0,0,side 0) touches hexes (0,0), (0,-1) and (1,-1); see vertexHexes.
const V: Vertex = { q: 0, r: 0, side: 0 };
const tiles: BoardTile[] = [
  { hex: { q: 0, r: 0 }, res: "wheat", num: 8 },
  { hex: { q: 0, r: -1 }, res: "ore", num: 8 },
  { hex: { q: 1, r: -1 }, res: "wood", num: 5 },
];
const settlement: BuildingView[] = [{ v: V, owner: 1, city: false }];
const city: BuildingView[] = [{ v: V, owner: 1, city: true }];

const board = (over: Partial<{ tiles: BoardTile[]; robber: { q: number; r: number } }> = {}) => ({
  tiles: over.tiles ?? tiles,
  robber: over.robber ?? { q: 9, r: 9 },
});
const hand = (o: Partial<Record<number, number>>): Hand =>
  [0, o[1] ?? 0, o[2] ?? 0, o[3] ?? 0, o[4] ?? 0, o[5] ?? 0] as Hand;

const ctx = (over: Partial<FlightCtx> = {}): FlightCtx => ({
  board: board(),
  buildings: settlement,
  ...over,
});

const ev = (type: string, data: unknown, seq = 1): GameEvent => ({ seq, type, data });

/** A flight rendered as "face from -> to", which is what the cases assert on. */
const shape = (f: { face: unknown; from: unknown; to: unknown }) =>
  `${faceKey(f.face as any)} ${endpointKey(f.from as any)}->${endpointKey(f.to as any)}`;
const shapes = (fs: readonly { face: unknown; from: unknown; to: unknown }[]) =>
  fs.map(shape).sort();

// ---- producingHexes ----

test("producingHexes mirrors distribute's walk", () => {
  const cases: {
    name: string;
    buildings: BuildingView[];
    tiles?: BoardTile[];
    robber?: { q: number; r: number };
    roll: number;
    seat: number;
    want: [string, number][];
  }[] = [
    {
      name: "a settlement takes one from each hex that rolled",
      buildings: settlement,
      roll: 8,
      seat: 1,
      want: [
        ["0,-1", 1],
        ["0,0", 1],
      ],
    },
    {
      name: "a city takes two",
      buildings: city,
      roll: 8,
      seat: 1,
      want: [
        ["0,-1", 2],
        ["0,0", 2],
      ],
    },
    {
      name: "the robber's hex pays nobody",
      buildings: settlement,
      robber: { q: 0, r: 0 },
      roll: 8,
      seat: 1,
      want: [["0,-1", 1]],
    },
    {
      name: "non-producing terrain pays nothing",
      buildings: settlement,
      tiles: [
        { hex: { q: 0, r: 0 }, res: "gold", num: 8 },
        { hex: { q: 0, r: -1 }, res: "none", num: 8 },
      ],
      roll: 8,
      seat: 1,
      want: [],
    },
    {
      name: "another seat's building is not yours",
      buildings: settlement,
      roll: 8,
      seat: 2,
      want: [],
    },
    {
      name: "a number nobody rolled pays nothing",
      buildings: settlement,
      roll: 3,
      seat: 1,
      want: [],
    },
    {
      name: "two buildings on the same hex both pay",
      buildings: [
        { v: V, owner: 1, city: false },
        { v: { q: 0, r: 0, side: 1 }, owner: 1, city: false },
      ],
      roll: 8,
      seat: 1,
      want: [
        ["0,-1", 1],
        ["0,0", 2],
      ],
    },
  ];
  for (const c of cases) {
    const got = producingHexes(
      board({ tiles: c.tiles, robber: c.robber }),
      c.buildings,
      c.roll,
      c.seat,
    );
    expect(
      got.map((s) => [`${s.hex.q},${s.hex.r}`, s.n]),
      c.name,
    ).toEqual(c.want);
  }
});

test("producingHexes accepts a terrain filter", () => {
  const goldTiles: BoardTile[] = [
    { hex: { q: 0, r: 0 }, res: "gold", num: 8 },
    { hex: { q: 0, r: -1 }, res: "ore", num: 8 },
  ];
  const got = producingHexes(board({ tiles: goldTiles }), city, 8, 1, (r) => r === "gold");
  expect(got).toEqual([{ hex: { q: 0, r: 0 }, res: "gold", n: 2 }]);
  expect(producing("gold")).toBe(false);
  expect(producing("wheat")).toBe(true);
});

test("producingHexes gives the same order however the buildings arrive", () => {
  const a = producingHexes(board(), settlement, 8, 1).map((s) => `${s.hex.q},${s.hex.r}`);
  const b = producingHexes(board({ tiles: [...tiles].reverse() }), settlement, 8, 1).map(
    (s) => `${s.hex.q},${s.hex.r}`,
  );
  expect(b).toEqual(a);
});

// ---- attribution ----

test("attributeGain reconciles derived sources with the gain", () => {
  const src: HexSource[] = [
    { hex: { q: 0, r: 0 }, res: "wheat", n: 2 },
    { hex: { q: 1, r: 0 }, res: "wheat", n: 1 },
  ];
  const cases: { name: string; gain: Hand; sources: HexSource[]; want: string[] }[] = [
    {
      name: "exact match keeps every hex",
      gain: hand({ 4: 3 }),
      sources: src,
      want: ["hex:0,0", "hex:0,0", "hex:1,0"],
    },
    {
      name: "the shortage clamp truncates the derived sources",
      gain: hand({ 4: 1 }),
      sources: src,
      want: ["hex:0,0"],
    },
    {
      name: "a gain with no source at all falls back to the bank",
      gain: hand({ 1: 2 }),
      sources: src,
      want: ["bank", "bank"],
    },
    {
      name: "a partial source flies the remainder from the bank",
      gain: hand({ 4: 4 }),
      sources: src,
      want: ["bank", "hex:0,0", "hex:0,0", "hex:1,0"],
    },
    { name: "nothing gained is nothing shown", gain: hand({}), sources: src, want: [] },
    {
      name: "a missing gain is not a crash",
      gain: undefined as unknown as Hand,
      sources: src,
      want: [],
    },
  ];
  for (const c of cases) {
    const got = attributeGain(c.gain, c.sources).map((a) => endpointKey(a.from));
    expect(got.sort(), c.name).toEqual([...c.want].sort());
  }
});

test("attributeGain never invents or loses a card", () => {
  const got = attributeGain(hand({ 1: 2, 4: 1 }), [{ hex: { q: 0, r: 0 }, res: "wood", n: 5 }]);
  expect(got).toHaveLength(3);
  expect(got.filter((a) => a.idx === 1)).toHaveLength(2);
  expect(got.filter((a) => a.idx === 4)).toHaveLength(1);
});

test("attributeAny fills slots in source order regardless of resource", () => {
  const src: HexSource[] = [{ hex: { q: 2, r: 2 }, res: "gold", n: 2 }];
  const got = attributeAny(hand({ 1: 1, 5: 2 }), src);
  expect(got.map((a) => endpointKey(a.from))).toEqual(["hex:2,2", "hex:2,2", "bank"]);
  expect(got.map((a) => a.idx)).toEqual([1, 5, 5]);
  // With no derived sources (a rule the walk does not model) the card count is
  // still right.
  expect(attributeAny(hand({ 3: 2 }), []).map((a) => endpointKey(a.from))).toEqual([
    "bank",
    "bank",
  ]);
});

// ---- planBatch, one case per event ----

test("planBatch: production flies out of the hexes that rolled", () => {
  const out = planBatch(
    [
      ev("dice_rolled", { player: 1, d1: 4, d2: 4 }),
      ev("resources_distributed", { gains: [{ player: 1, gain: hand({ 4: 1, 5: 1 }) }] }, 2),
    ],
    ctx(),
  );
  expect(shapes(out)).toEqual(["res:4 hex:0,0->seat:01", "res:5 hex:0,-1->seat:01"]);
});

test("planBatch: production with no roll in sight still shows the cards", () => {
  // A reconcile can split the roll from its distribution; fall back to the bank.
  const out = planBatch(
    [ev("resources_distributed", { gains: [{ player: 2, gain: hand({ 1: 2 }) }] })],
    ctx(),
  );
  expect(shapes(out)).toEqual(["res:1 bank->seat:02", "res:1 bank->seat:02"]);
});

test("planBatch: the setup grant comes off the settlement just placed", () => {
  const out = planBatch(
    [
      ev("settlement_placed", { player: 1, v: V }),
      ev("starting_resources", { player: 1, gain: hand({ 4: 1, 5: 1, 1: 1 }) }, 2),
    ],
    ctx({ buildings: [] }),
  );
  // Its three hexes are wheat (0,0), ore (0,-1) and wood (1,-1), one each, with
  // no roll and no shortage rule.
  expect(shapes(out)).toEqual([
    "res:1 hex:1,-1->seat:01",
    "res:4 hex:0,0->seat:01",
    "res:5 hex:0,-1->seat:01",
  ]);
});

test("planBatch: gold picks leave the gold hex whatever was chosen", () => {
  const goldTiles: BoardTile[] = [{ hex: { q: 0, r: 0 }, res: "gold", num: 8 }];
  const out = planBatch(
    [
      ev("dice_rolled", { player: 1, d1: 4, d2: 4 }),
      ev("gold_chosen", { player: 1, gain: hand({ 5: 2 }) }, 2),
    ],
    ctx({ board: board({ tiles: goldTiles }), buildings: city }),
  );
  expect(shapes(out)).toEqual(["res:5 hex:0,0->seat:01", "res:5 hex:0,0->seat:01"]);
});

test("planBatch: a gold pick that derives no hex still shows the cards", () => {
  const out = planBatch([ev("gold_chosen", { player: 3, gain: hand({ 2: 1 }) })], ctx());
  expect(shapes(out)).toEqual(["res:2 bank->seat:03"]);
});

test("planBatch: one case per remaining event type", () => {
  const cases: { name: string; evs: GameEvent[]; want: string[] }[] = [
    {
      name: "year of plenty comes out of the bank",
      evs: [ev("year_of_plenty", { player: 0, gain: hand({ 1: 1, 5: 1 }) })],
      want: ["res:1 bank->seat:00", "res:5 bank->seat:00"],
    },
    {
      name: "a discard goes back to the bank",
      evs: [ev("cards_discarded", { player: 2, cards: hand({ 3: 2 }) })],
      want: ["res:3 seat:02->bank", "res:3 seat:02->bank"],
    },
    {
      name: "a bank trade is two flights in opposite directions",
      evs: [ev("bank_traded", { player: 1, give: hand({ 5: 4 }), get: hand({ 1: 1 }) })],
      want: [
        "res:1 bank->seat:01",
        "res:5 seat:01->bank",
        "res:5 seat:01->bank",
        "res:5 seat:01->bank",
        "res:5 seat:01->bank",
      ],
    },
    {
      name: "a player trade crosses both ways",
      evs: [ev("trade_executed", { by: 0, with: 3, give: hand({ 1: 1 }), want: hand({ 5: 1 }) })],
      want: ["res:1 seat:00->seat:03", "res:5 seat:03->seat:00"],
    },
    {
      name: "a steal the viewer may see carries the card",
      evs: [ev("card_stolen", { thief: 1, victim: 2, res: "ore" })],
      want: ["res:5 seat:02->seat:01"],
    },
    {
      name: "a steal redacted to its parties is a card back, not a bank card",
      evs: [ev("card_stolen", { thief: 1, victim: 2 })],
      want: ["hidden seat:02->seat:01"],
    },
    {
      name: "monopoly drags one pile off each victim",
      evs: [
        ev("monopoly_resolved", {
          player: 0,
          res: "sheep",
          takes: [
            { player: 1, count: 2 },
            { player: 2, count: 1 },
          ],
        }),
      ],
      want: ["res:3 seat:01->seat:00", "res:3 seat:01->seat:00", "res:3 seat:02->seat:00"],
    },
    {
      name: "buying a dev card pays the bank and draws a back",
      evs: [ev("dev_card_bought", { player: 1 })],
      want: [
        "dev deck->seat:01",
        "res:3 seat:01->bank",
        "res:4 seat:01->bank",
        "res:5 seat:01->bank",
      ],
    },
    {
      // Wagons: same deck and price, its own event. The cost flies to the bank;
      // the public card is shown face up by the reveal layer, so no back flies.
      name: "a Swift Journey pays the bank, and its card is left to the reveal",
      evs: [ev("wagons_swift_bought", { player: 1 })],
      want: ["res:3 seat:01->bank", "res:4 seat:01->bank", "res:5 seat:01->bank"],
    },
    {
      name: "a free dev card draw costs nothing",
      evs: [ev("dev_card_bought", { player: 1, free: true })],
      want: ["dev deck->seat:01"],
    },
    {
      name: "a built road pays its cost",
      evs: [ev("road_built", { player: 4 })],
      want: ["res:1 seat:04->bank", "res:2 seat:04->bank"],
    },
    {
      name: "a free road (road building, setup) does not",
      evs: [ev("road_built", { player: 4, free: true })],
      want: [],
    },
    // The `free` builds (Engineer's wall, the Deserter's replacement knight)
    // are granted outright, so no price flies. Same guard as road/ship.
    {
      name: "hiring a knight pays sheep and ore",
      evs: [ev("cak_knight_built", { player: 2, v: {} })],
      want: ["res:3 seat:02->bank", "res:5 seat:02->bank"],
    },
    {
      name: "the Deserter's replacement knight is free",
      evs: [ev("cak_knight_built", { player: 2, v: {}, free: true, level: 2 })],
      want: [],
    },
    {
      name: "a bought city wall pays 2 brick",
      evs: [ev("cak_wall_built", { player: 3 })],
      want: ["res:2 seat:03->bank", "res:2 seat:03->bank"],
    },
    {
      name: "Engineer's wall is free",
      evs: [ev("cak_wall_built", { player: 3, free: true })],
      want: [],
    },
    {
      // Medicine: 1 wheat + 2 ore rather than 2 + 3.
      name: "Medicine's city pays its own discounted price",
      evs: [ev("cak_cheap_city", { player: 1, v: {} })],
      want: ["res:4 seat:01->bank", "res:5 seat:01->bank", "res:5 seat:01->bank"],
    },
    {
      name: "the harvest progress card comes out of the bank",
      evs: [ev("cak_harvest", { player: 1, res: "wheat", count: 2 })],
      want: ["res:4 bank->seat:01", "res:4 bank->seat:01"],
    },
    {
      name: "an aqueduct take on an empty bank moves nothing",
      evs: [ev("cak_aqueduct_taken", { player: 1, res: "none" })],
      want: [],
    },
    {
      name: "an aqueduct take is one card from the bank",
      evs: [ev("cak_aqueduct_taken", { player: 1, res: "brick" })],
      want: ["res:2 bank->seat:01"],
    },
    {
      name: "cards taken with the bundle visible show their faces",
      evs: [ev("cak_cards_taken", { from: 2, to: 1, cards: hand({ 1: 1, 4: 1 }) })],
      want: ["res:1 seat:02->seat:01", "res:4 seat:02->seat:01"],
    },
    {
      name: "cards taken redacted to a count show that many backs",
      evs: [ev("cak_cards_taken", { from: 2, to: 1, count: 3 })],
      want: ["hidden seat:02->seat:01", "hidden seat:02->seat:01", "hidden seat:02->seat:01"],
    },
    {
      name: "a resource levy is a monopoly by another name",
      evs: [ev("cak_resource_levy", { player: 0, res: "wood", takes: [{ player: 2, count: 2 }] })],
      want: ["res:1 seat:02->seat:00", "res:1 seat:02->seat:00"],
    },
    {
      name: "a commodity levy moves commodities",
      evs: [
        ev("cak_commodity_levy", { player: 0, commodity: 2, takes: [{ player: 1, count: 1 }] }),
      ],
      want: ["com:2 seat:01->seat:00"],
    },
    {
      name: "a commodity steal redacted to its parties is a back",
      evs: [ev("cak_commodity_stolen", { thief: 0, victim: 1 })],
      want: ["hidden seat:01->seat:00"],
    },
    {
      name: "a commodity discard goes to the bank",
      evs: [ev("cak_commodity_discarded", { player: 1, cards: [1, 0, 1] })],
      want: ["com:0 seat:01->bank", "com:2 seat:01->bank"],
    },
    {
      name: "a maritime commodity trade is give-then-get",
      evs: [
        ev("cak_commodity_traded", {
          player: 1,
          give_is_com: true,
          give_com: 1,
          give_n: 2,
          get_is_com: false,
          get_res: "ore",
          count: 1,
        }),
      ],
      want: ["com:1 seat:01->bank", "com:1 seat:01->bank", "res:5 bank->seat:01"],
    },
    {
      name: "a basket trade flies the whole stake and the whole ask",
      evs: [
        ev("cak_commodity_basket_traded", {
          player: 1,
          spend_res: [0, 4, 0, 0, 2, 0],
          spend_com: [0, 0, 0],
          get_res: [0, 0, 0, 0, 0, 0],
          get_com: [0, 0, 2],
        }),
      ],
      want: [
        "res:1 seat:01->bank",
        "res:1 seat:01->bank",
        "res:1 seat:01->bank",
        "res:1 seat:01->bank",
        "res:4 seat:01->bank",
        "res:4 seat:01->bank",
        "com:2 bank->seat:01",
        "com:2 bank->seat:01",
      ],
    },
    {
      name: "the trading house always spends two of one commodity",
      evs: [ev("cak_trading_house", { player: 2, give: 0, com_out: false, get_res: "wheat" })],
      want: ["com:0 seat:02->bank", "com:0 seat:02->bank", "res:4 bank->seat:02"],
    },
    {
      name: "the commercial harbor swaps a resource for a hidden commodity",
      evs: [ev("cak_harbor_given", { taker: 0, giver: 3, res: "sheep" })],
      want: ["hidden seat:03->seat:00", "res:3 seat:00->seat:03"],
    },
    {
      name: "an event that moves no cards plans nothing",
      evs: [ev("turn_started", { player: 1 })],
      want: [],
    },
    { name: "an unknown event type plans nothing", evs: [ev("tab_fish_caught", {})], want: [] },
    { name: "an empty batch plans nothing", evs: [], want: [] },
  ];
  for (const c of cases) {
    expect(shapes(planBatch(c.evs, ctx())), c.name).toEqual([...c.want].sort());
  }
});

// ---- batch behaviour ----

test("planBatch folds a commodity conversion into the production it consumed", () => {
  // A Knights city on forest produces wood and converts one to paper; without
  // the fold the player sees both cards for one tile.
  const forest: BoardTile[] = [{ hex: { q: 0, r: 0 }, res: "wood", num: 8 }];
  const out = planBatch(
    [
      ev("dice_rolled", { player: 1, d1: 4, d2: 4 }),
      ev("resources_distributed", { gains: [{ player: 1, gain: hand({ 1: 2 }) }] }, 2),
      ev("cak_commodity_adjust", { player: 1, res: "wood", commodity: 1, count: 1 }, 3),
    ],
    ctx({ board: board({ tiles: forest }), buildings: city }),
  );
  expect(out).toHaveLength(2);
  // Both leave the forest, where the commodity was made.
  expect(shapes(out)).toEqual(["com:1 hex:0,0->seat:01", "res:1 hex:0,0->seat:01"]);
});

// A conversion the finite stack cannot pay is reported with `short`; those
// cards vanish rather than flip, since the resource went back to the bank.
test("planBatch drops the cards a shortage withheld instead of flipping them", () => {
  const forest: BoardTile[] = [{ hex: { q: 0, r: 0 }, res: "wood", num: 8 }];
  const out = planBatch(
    [
      ev("dice_rolled", { player: 1, d1: 4, d2: 4 }),
      ev("resources_distributed", { gains: [{ player: 1, gain: hand({ 1: 2 }) }] }, 2),
      ev("cak_commodity_adjust", { player: 1, res: "wood", commodity: 1, count: 1, short: 1 }, 3),
    ],
    ctx({ board: board({ tiles: forest }), buildings: city }),
  );
  // One wood kept, the other taken back with nothing in its place.
  expect(shapes(out)).toEqual(["res:1 hex:0,0->seat:01"]);
});

test("planBatch flips the paid part of a partly withheld conversion", () => {
  const forest: BoardTile[] = [{ hex: { q: 0, r: 0 }, res: "wood", num: 8 }];
  const out = planBatch(
    [
      ev("dice_rolled", { player: 1, d1: 4, d2: 4 }),
      ev("resources_distributed", { gains: [{ player: 1, gain: hand({ 1: 4 }) }] }, 2),
      ev("cak_commodity_adjust", { player: 1, res: "wood", commodity: 1, count: 2, short: 1 }, 3),
    ],
    ctx({ board: board({ tiles: forest }), buildings: city }),
  );
  // Four wood produced, two converted, one conversion unpaid: three cards, one
  // paper and two wood. Asserted on faces only; which source each flight uses
  // is the planner's business.
  const faces = out
    .map((f) => (f.face.k === "res" || f.face.k === "com" ? `${f.face.k}:${f.face.idx}` : f.face.k))
    .sort();
  expect(faces).toEqual(["com:1", "res:1", "res:1"]);
});

test("planBatch adds a minted commodity from the same hex", () => {
  // The engine pays one wood through the core and the paper on top (`minted`):
  // two cards, both from the forest, nothing flipped.
  const forest: BoardTile[] = [{ hex: { q: 0, r: 0 }, res: "wood", num: 8 }];
  const out = planBatch(
    [
      ev("dice_rolled", { player: 1, d1: 4, d2: 4 }),
      ev("resources_distributed", { gains: [{ player: 1, gain: hand({ 1: 1 }) }] }, 2),
      ev(
        "cak_commodity_adjust",
        { player: 1, res: "wood", commodity: 1, count: 1, minted: true },
        3,
      ),
    ],
    ctx({ board: board({ tiles: forest }), buildings: city }),
  );
  expect(shapes(out)).toEqual(["com:1 hex:0,0->seat:01", "res:1 hex:0,0->seat:01"]);
});

test("planBatch pays a minted commodity from the supply", () => {
  const out = planBatch(
    [
      ev("dice_rolled", { player: 1, d1: 4, d2: 4 }),
      ev("cak_commodity_adjust", { player: 1, res: "wood", commodity: 1, count: 1, minted: true }),
    ],
    ctx(),
  );
  expect(shapes(out)).toEqual(["com:1 bank->seat:01"]);
});

test("planBatch shows nothing for a minted commodity the stack could not pay", () => {
  const forest: BoardTile[] = [{ hex: { q: 0, r: 0 }, res: "wood", num: 8 }];
  const out = planBatch(
    [
      ev("dice_rolled", { player: 1, d1: 4, d2: 4 }),
      ev("resources_distributed", { gains: [{ player: 1, gain: hand({ 1: 1 }) }] }, 2),
      ev(
        "cak_commodity_adjust",
        { player: 1, res: "wood", commodity: 1, count: 1, short: 1, minted: true },
        3,
      ),
    ],
    ctx({ board: board({ tiles: forest }), buildings: city }),
  );
  expect(shapes(out)).toEqual(["res:1 hex:0,0->seat:01"]);
});

test("planBatch uses the bank for a conversion with no production", () => {
  const out = planBatch(
    [
      ev("dice_rolled", { player: 1, d1: 4, d2: 4 }),
      ev("cak_commodity_adjust", { player: 1, res: "wood", commodity: 1, count: 1 }),
    ],
    ctx(),
  );
  expect(shapes(out)).toEqual(["com:1 bank->seat:01"]);
});

test("planBatch stamps the stagger in its own order", () => {
  const out = planBatch(
    [
      ev("dice_rolled", { player: 1, d1: 4, d2: 4 }),
      ev(
        "resources_distributed",
        {
          gains: [
            { player: 2, gain: hand({ 4: 1 }) },
            { player: 1, gain: hand({ 4: 1, 5: 1 }) },
          ],
        },
        2,
      ),
    ],
    ctx({
      buildings: [
        { v: V, owner: 1, city: false },
        { v: V, owner: 2, city: false },
      ],
    }),
  );
  // One frame for the whole payout: the batch is one event and leaves as one.
  expect(out.map((f) => f.delayMs)).toEqual([0, 0, 0]);
  expect(FLIGHT_STAGGER_MS).toBe(0);
  // Seat 1's whole take comes first, so it reads as one player's gain.
  expect(out.map((f) => (f.to as { seat: number }).seat)).toEqual([1, 1, 2]);
});

test("planBatch refuses a batch carrying more than one roll", () => {
  // Two rolls in one commit is a catch-up (a reconcile, or a spectator joining
  // mid-game), as `newlyPlaced` treats pieces.
  const out = planBatch(
    [
      ev("dice_rolled", { player: 1, d1: 4, d2: 4 }),
      ev("resources_distributed", { gains: [{ player: 1, gain: hand({ 4: 1 }) }] }, 2),
      ev("dice_rolled", { player: 2, d1: 3, d2: 5 }, 3),
      ev("resources_distributed", { gains: [{ player: 1, gain: hand({ 4: 1 }) }] }, 4),
    ],
    ctx(),
  );
  expect(out).toEqual([]);
});

test("planBatch collapses an oversized batch rather than dropping cards", () => {
  const evs = [ev("year_of_plenty", { player: 1, gain: hand({ 1: FLIGHT_BULK_LIMIT + 3 }) })];
  const out = planBatch(evs, ctx());
  expect(out).toHaveLength(1);
  expect(out[0].count).toBe(FLIGHT_BULK_LIMIT + 3);
});

test("planBatch survives malformed payloads without throwing", () => {
  const junk: GameEvent[] = [
    ev("resources_distributed", null),
    ev("resources_distributed", { gains: [{ player: -1, gain: null }] }, 2),
    ev("card_stolen", { thief: "x", victim: 2 }, 3),
    ev("monopoly_resolved", { player: 0, res: "ore", takes: null }, 4),
    ev("bank_traded", { player: 1 }, 5),
    ev("cak_trading_house", {}, 6),
  ];
  expect(() => planBatch(junk, ctx())).not.toThrow();
  expect(planBatch(junk, ctx())).toEqual([]);
});
