import type { GameEvent } from "./gamestate";
import { playedCardText, type CardKind } from "./cardText";
import { bidVotes, camelOutcomeOf } from "./caravans";
import { PILLAGE_BUYOUT_COINS } from "./rivers";
import type { CamelBid } from "./types";
import { RES, COMMOD, goodCount } from "./cardFace";
import { formatList } from "./intl";
import { msg } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { I18n, MessageDescriptor } from "@lingui/core";

// Resource names by Hand index (0 unused; 1..5 = wood/brick/sheep/wheat/ore).
const RESOURCE_NAMES = ["", "wood", "brick", "sheep", "wheat", "ore"];
// The commodity each improvement track is paid in (engine/knights: commodityForTrack).
const TRACK_COMMODITY = [0, 2, 1];

/**
 * A log line is a list of tokens, not a string.
 *
 * The log shows what changed hands, and four paper cards are easier to see than
 * to read. So the formatter emits cards, dice, pieces and the words between
 * them, and leaves every visual decision (icon size, when repeats collapse to a
 * count, what a piece looks like) to the component that draws them. This also
 * keeps the module pure: no React, no assets, no sizes.
 */
export type LogToken =
  /** Words. `dim` marks an aside (the roll's total, a count), not the sentence. */
  | { k: "t"; s: string; dim?: boolean }
  /** `n` resource cards of Hand index 1..5. `loss` draws them as spent, not gained. */
  | { k: "res"; idx: number; n: number; loss?: boolean }
  /** `n` commodity cards, indexed as the Knights commodities array is (0=cloth). */
  | { k: "com"; idx: number; n: number; loss?: boolean }
  /** One die face. The engine designates d2 as the red die. */
  | { k: "die"; n: number; red?: boolean }
  /** The Knights event die: ship | trade | politics | science. */
  | { k: "edie"; face: string }
  /** A board piece in a seat's colour. */
  | { k: "piece"; piece: PieceKind; seat: number }
  /**
   * A named dev or progress card, drawn as its title and explained on hover.
   * Kept out of the words because the name is what a new reader may not know.
   * The kind travels with the id because `road_building` names a different card
   * in each vocabulary (see lib/cardText).
   */
  | { k: "card"; kind: CardKind; id: string };

/**
 * The board pieces the log can draw. A metropolis is three different buildings
 * (metros.glb ships Metro_trade, Metro_politics and Metro_science), so the
 * track is part of the piece.
 */
export type PieceKind =
  | "road"
  | "ship"
  | "settlement"
  | "city"
  | "metro_trade"
  | "metro_politics"
  | "metro_science"
  | "wall"
  | "knight"
  /**
   * The Rivers bridge: its own piece, with its own supply of three, its own
   * price, and the only piece allowed on edges a road is refused.
   */
  | "bridge";

/**
 * A run of tokens: cards, dice and pieces side by side. The chat feed's whole
 * line (lib/chatTokens); in the log, what one placeholder of a sentence is
 * filled with.
 */
export type LogLine = LogToken[];

/**
 * What one `<n>` tag in a log message stands for.
 *
 * A log line is a sentence with pictures in it, and where they fall is part of
 * the sentence, so messages carry numbered tags as Lingui rich text does. This
 * is the table they resolve against.
 *
 * `fill` is self-closing (`<0/>`) and draws a run of cards, dice, a piece or a
 * named card. `dim` is paired (`<0>7</0>`) and draws its contents as an aside
 * (a roll's total, a count, the number on a blocked hex).
 */
export type LogSlot = { fill: LogToken[] } | { dim: true };

/**
 * One line of the log: a whole sentence, plus the values and pictures it names.
 *
 * The unit of translation is the sentence, since German puts the verb last and
 * Spanish agrees articles with nouns, so fragments cut to English order cannot
 * be translated. `msg` is a descriptor with an explicit id and named ICU
 * parameters (never positional, since word order moves), `values` are what it
 * interpolates, and `slots` resolve its numbered tags.
 */
export interface LogMessage {
  msg: MessageDescriptor;
  /** Named parameters: names, counts, tallies, never a bare noun (see locales/README). */
  values?: Record<string, unknown>;
  /** `<0>`, `<1>`, ... in order. */
  slots?: LogSlot[];
}

/** One sentence, its values and its pictures. */
function say(
  m: MessageDescriptor,
  values?: Record<string, unknown>,
  slots?: LogSlot[],
): LogMessage {
  return { msg: m, values, slots };
}

/** A tag filled with a run of tokens; empties drop out. */
function fill(...parts: (LogToken | LogToken[] | null | false | undefined)[]): LogSlot {
  const out: LogToken[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (Array.isArray(p)) out.push(...p);
    else out.push(p);
  }
  return { fill: out };
}

/** A tag whose contents are an aside. */
const DIM: LogSlot = { dim: true };

/**
 * A list of names in the reader's language, via `Intl.ListFormat` (separator,
 * conjunction and Oxford comma are per language; `en` gets the Oxford comma).
 */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return new Intl.ListFormat(i18n.locale || "en", {
    style: "long",
    type: "conjunction",
  }).format(names);
}

/**
 * Turn one player's raw production into the cards they actually ended up with.
 *
 * A Knights city on commodity terrain yields one resource and one commodity
 * (wood and paper, sheep and cloth, ore and coin). With `minted` set (all
 * current events) the commodity is added to a distribution that paid the
 * single resource; older logs paid two of the resource and converted one.
 * Either way the commodity arrives as a separate `cak_commodity_adjust`
 * (knights/hooks.go OnEvents), emitted after the core computed
 * `resources_distributed` (engine/turn.go), so the distribution alone would
 * say "2 wood" for one wood and one paper.
 *
 * The adjust replaces cards rather than adding them, like the card-flight fold
 * (lib/cardFlightPlan `foldCommodityAdjusts`). A count with no matching
 * production is still shown as a commodity, since the hand has it either way.
 */
function foldCommodityAdjusts(
  got: LogToken[],
  player: number,
  adjusts: readonly GameEvent[] | undefined,
  resIdx: (r: unknown) => number,
): LogToken[] {
  if (!adjusts?.length) return got;
  // Copied, not mutated: the counts below are edited.
  const out: LogToken[] = got.map((tok) => ({ ...tok }));
  const coms = [0, 0, 0];
  let any = false;
  for (const a of adjusts) {
    const ad = (a.data ?? {}) as Record<string, unknown>;
    if (ad.player !== player) continue;
    // `res` is a board.Resource string ("wood".."ore"); the Hand is numeric.
    // `commodity` is an index (0=cloth, 1=paper, 2=coin).
    const idx = resIdx(ad.res);
    const ci = typeof ad.commodity === "number" ? ad.commodity : -1;
    const count = typeof ad.count === "number" ? ad.count : 0;
    // `short` is how many commodities the stack could not pay. The resources
    // still go back in full (`count`), but only `count - short` commodities
    // arrive (an empty cloth stack leaves one wool and nothing else). Absent
    // before the supply was finite, where it reads 0.
    const short = typeof ad.short === "number" ? ad.short : 0;
    if (!idx || ci < 0 || ci > 2 || count <= 0) continue;
    any = true;
    // `minted` (the current engine): the core paid one resource and the
    // commodity came from its own stack, so there is no resource to consume.
    // Only older logs describe a conversion.
    let left = ad.minted === true ? 0 : count;
    for (const tok of out) {
      if (left <= 0) break;
      if (tok.k !== "res" || tok.idx !== idx) continue;
      const take = Math.min(tok.n, left);
      tok.n -= take;
      left -= take;
    }
    coms[ci] += Math.max(0, count - short);
  }
  if (!any) return got;
  const kept = out.filter((tok) => tok.k !== "res" || tok.n > 0);
  for (let i = 0; i <= 2; i++) if (coms[i] > 0) kept.push({ k: "com", idx: i, n: coms[i] });
  return kept;
}

/**
 * Every event type the server can put on the wire, mirroring the `EventType`
 * constants in engine/ (core, islands, knights, scenarios).
 *
 * Lets the formatter table be a total map: a union member without a row fails
 * the build. eventlog.test.ts checks the union against the Go sources.
 */
export type EventType =
  // ---- core (engine/types.go) ----
  | "game_created"
  | "board_generated"
  | "settlement_placed"
  | "setup_city_placed"
  | "road_placed"
  | "setup_advanced"
  | "starting_resources"
  | "turn_started"
  | "dice_rolled"
  | "resources_distributed"
  | "discards_required"
  | "cards_discarded"
  | "robber_moved"
  | "card_stolen"
  | "road_built"
  | "settlement_built"
  | "city_built"
  | "turn_ended"
  | "game_finished"
  | "player_surrendered"
  | "draw_offered"
  | "draw_responded"
  | "draw_cancelled"
  | "game_claimed"
  | "bank_traded"
  | "trade_offered"
  | "trade_responded"
  | "trade_executed"
  | "trade_cancelled"
  | "trade_canceled"
  | "trade_countered"
  | "dev_card_bought"
  | "knight_played"
  | "road_building_played"
  | "year_of_plenty"
  | "monopoly_resolved"
  | "longest_road"
  | "largest_army"
  // ---- Islands (engine/islands) ----
  | "ship_built"
  | "ship_moved"
  | "pirate_moved"
  | "gold_owed"
  | "gold_chosen"
  | "island_chip"
  | "islands_turn_reset"
  // ---- Knights (engine/knights) ----
  | "cak_event_die"
  | "cak_commodity_adjust"
  | "cak_progress_drawn"
  | "cak_progress_discarded"
  | "cak_progress_stolen"
  | "cak_spy_looking"
  | "cak_master_merchant_looking"
  | "cak_improved"
  | "cak_metropolis"
  | "cak_metropolis_pending"
  | "cak_knight_built"
  | "cak_knight_activated"
  | "cak_knight_promoted"
  | "cak_knight_moved"
  | "cak_knight_removed"
  | "cak_knight_displaced"
  | "cak_knight_relocated"
  | "cak_defender_advance"
  | "cak_knights_all_active"
  | "cak_deserter_opened"
  | "cak_deserter_armed"
  | "cak_deserter_cleared"
  | "cak_wall_built"
  | "cak_barbarian_attack"
  | "cak_barbarian_downgraded"
  | "cak_pillage_bought_out"
  | "cak_robber_idle"
  | "cak_progress_played"
  | "cak_merchant_placed"
  | "cak_cards_taken"
  | "cak_cards_given"
  | "cak_resource_levy"
  | "cak_commodity_levy"
  | "cak_commodity_discarded"
  | "cak_commodity_sold"
  | "cak_commodity_stolen"
  | "cak_commodity_taken"
  | "cak_dice_fixed"
  | "cak_tokens_swapped"
  | "cak_harvest"
  | "cak_cheap_city"
  | "cak_cheap_harbour"
  | "cak_laid_city_restored"
  | "cak_free_roads"
  | "cak_road_relocated"
  | "cak_harbor_setup"
  | "cak_harbor_given"
  | "cak_merchant_fleet"
  | "cak_trading_house"
  | "cak_commodity_traded"
  | "cak_commodity_basket_traded"
  | "cak_aqueduct_owed"
  | "cak_aqueduct_taken"
  | "cak_wedding_owed"
  | "cak_dice_unfixed"
  | "cak_knights_refresh"
  // ---- Fishermen + Caravans (engine/scenarios) ----
  | "tab_camel_built"
  | "tab_camel_vote"
  | "tab_camel_bid"
  | "tab_camel_resolved"
  | "tab_camel_placed"
  | "tab_fish_caught"
  | "tab_fish_gained"
  | "tab_fish_spent"
  | "tab_boot_given"
  // ---- Harbormaster (engine/harbormaster) ----
  | "harbormaster_standings"
  // ---- Rivers (engine/rivers) ----
  | "rivers_bridge_built"
  | "rivers_coins_changed"
  | "rivers_coin_bought"
  | "rivers_coins_spent"
  | "rivers_coin_traded"
  | "rivers_wealth_changed"
  | "rivers_turn_reset"
  // ---- Raiders (engine/raiders) ----
  | "raiders_landing"
  | "raiders_landed"
  | "raiders_path_placed"
  | "raiders_card"
  | "raiders_rider_placed"
  | "raiders_rider_moved"
  | "raiders_declined"
  | "raiders_treason"
  | "raiders_intrigue"
  | "raiders_battle"
  | "raiders_sweep"
  | "raiders_seven"
  | "raiders_stolen"
  | "raiders_gold_spent"
  | "raiders_gold_gained"
  | "raiders_gold_moved"
  | "raiders_conquest"
  // ---- Wagons (engine/wagons) ----
  | "wagons_started"
  | "wagons_turn"
  | "wagons_moved"
  | "wagons_halted"
  | "wagons_boosted"
  | "wagons_charged"
  | "wagons_barbarian_owed"
  | "wagons_barbarian_moved"
  | "wagons_loaded"
  | "wagons_delivered"
  | "wagons_upgraded"
  | "wagons_bought"
  | "wagons_sold"
  | "wagons_gold_moved"
  | "wagons_swift_bought"
  | "wagons_swift_played"
  // ---- Explorers (engine/explorers) ----
  | "explorers_harbour_placed"
  | "explorers_settlement_placed"
  | "explorers_start_placed"
  | "explorers_harbour_built"
  | "explorers_ship_built"
  | "explorers_ship_moved"
  | "explorers_ship_sped"
  | "explorers_hex_revealed"
  | "explorers_cargo_bought"
  | "explorers_jettisoned"
  | "explorers_cargo_moved"
  | "explorers_crew_landed"
  | "explorers_crew_taken"
  | "explorers_haul_placed"
  | "explorers_haul_missed"
  | "explorers_haul_loaded"
  | "explorers_delivered"
  | "explorers_founded"
  | "explorers_lair_resolved"
  | "explorers_pirate_owed"
  | "explorers_pirate_moved"
  | "explorers_pirate_chased"
  | "explorers_gold_changed"
  | "explorers_gold_traded"
  | "explorers_movement_began"
  | "explorers_turn_reset";

/**
 * The events of the same commit that a formatter needs but cannot see.
 *
 * `describeEvent` is a pure function of one event, but the engine sometimes
 * splits one visible thing across several events, and the line belongs to the
 * first. The caller (routes/Game's `EventLogFeed`) holds the surrounding log and
 * does the forward scan.
 */
export interface DescribeOpts {
  /**
   * The Knights event-die face rolled with this roll, emitted right after
   * `dice_rolled` (knights/hooks.go's OnDiceRolled). Shown on the roll's line
   * rather than taking a row of its own.
   */
  eventDie?: string;
  /**
   * This roll's `cak_commodity_adjust` events, for the `resources_distributed`
   * they correct. They are emitted after the distribution was persisted, so it
   * alone omits the commodity (current `minted` events) or shows the
   * pre-conversion hand (older logs).
   */
  adjusts?: readonly GameEvent[];
  /**
   * The tile the robber was on when this roll matched its number: `res` as a
   * Hand index (1..5), `num` as the token. A blocked hex otherwise leaves no
   * trace in the log (the board pulses the robber, see lib/robber's
   * `robberAteRoll`). Passed in because the roll event carries only the dice.
   */
  blockedRes?: number;
  blockedNum?: number;
  /**
   * The board's numbered tiles, so a Raiders landing, battle or conquest can
   * name its hex by terrain card and number ("Ore on 8"), never coordinates.
   * Absent (replay player, tests) means the line does not name it. Held by
   * content at the call site, so its identity is a valid cache key.
   */
  tiles?: readonly { hex: { q: number; r: number }; res: string; num: number }[];
}

/**
 * Everything a formatter is allowed to look at, built once per event so the
 * rows stay expressions over data.
 */
interface Ctx {
  /** The event's payload as this viewer received it (already redacted). */
  d: Record<string, unknown>;
  /** Seat display name. */
  name: (s: number) => string;
  /** `d.player`, or -1 when the event names no single player. */
  seat: number;
  /** `name(seat)`, or "" when there is none. */
  who: string;
  /** `name(d.holder)`, for the two awards. */
  holder: string;
  islands: boolean;
  opts: DescribeOpts;
  /** A seat name, or null for NoPlayer (-1) / absent. */
  optName: (s: unknown) => string | null;
  /** The cards in a resource Hand, one token per resource actually present. */
  gain: (hand: unknown, loss?: boolean) => LogToken[];
  /** The cards in a commodity hand ([cloth, paper, coin]). */
  coms: (hand: unknown, loss?: boolean) => LogToken[];
  /** A single board.Resource ("wood".."ore"/"none") as a Hand index; 0 = none. */
  resIdx: (r: unknown) => number;
  /** One card of either kind, as the Knights trade events describe them. */
  resOrCom: (isCom: boolean, res: unknown, com: number, n: number) => LogToken[];
  /** A piece token in the acting seat's colour. */
  piece: (p: PieceKind) => LogToken;
  /** A development card token. */
  dev: (id: string) => LogToken;
  /** A progress card token. */
  prog: (id: string) => LogToken;
  /** A Raiders card token (engine/raiders' own deck). */
  raid: (id: string) => LogToken;
  /**
   * A hex as a player names it: terrain card and number, from `opts.tiles`.
   * Null when the board is not at hand or the hex produces nothing.
   */
  tileAt: (h: unknown) => { card: LogToken; num: number } | null;
}

type Formatter = (c: Ctx) => LogMessage[];

/**
 * A player the viewer is not entitled to name. Two entries (subject and
 * object), since English capitalises the first word and other languages may
 * inflect the two positions differently.
 */
const SOMEONE = msg({ id: "log.someone.subject", message: "Someone" });
const SOMEONE_OBJ = msg({ id: "log.someone.object", message: "someone" });
const someone = () => i18n._(SOMEONE);
const someoneObj = () => i18n._(SOMEONE_OBJ);

/**
 * The Knights improvement tracks, one message each. A closed set of three, so
 * each frame is written as three whole sentences rather than dropping a bare
 * noun in (which locales/README forbids).
 */
const IMPROVED = [
  msg({ id: "log.improved.trade", message: "{player} improved Trade <0/>" }),
  msg({ id: "log.improved.politics", message: "{player} improved Politics <0/>" }),
  msg({ id: "log.improved.science", message: "{player} improved Science <0/>" }),
];
const METRO_BUILT = [
  msg({ id: "log.metro.built.trade", message: "{player} built the Trade metropolis <0/>" }),
  msg({ id: "log.metro.built.politics", message: "{player} built the Politics metropolis <0/>" }),
  msg({ id: "log.metro.built.science", message: "{player} built the Science metropolis <0/>" }),
];
const METRO_TAKEN = [
  msg({
    id: "log.metro.taken.trade",
    message: "{player} built the Trade metropolis (taken from {prev}) <0/>",
  }),
  msg({
    id: "log.metro.taken.politics",
    message: "{player} built the Politics metropolis (taken from {prev}) <0/>",
  }),
  msg({
    id: "log.metro.taken.science",
    message: "{player} built the Science metropolis (taken from {prev}) <0/>",
  }),
];
const METRO_PENDING = [
  msg({
    id: "log.metro.pending.trade",
    message: "{player} earned the Trade metropolis and is choosing a city",
  }),
  msg({
    id: "log.metro.pending.politics",
    message: "{player} earned the Politics metropolis and is choosing a city",
  }),
  msg({
    id: "log.metro.pending.science",
    message: "{player} earned the Science metropolis and is choosing a city",
  }),
];
const DREW_TRACK = [
  msg({ id: "log.progress.drew.trade", message: "{player} drew a Trade card" }),
  msg({ id: "log.progress.drew.politics", message: "{player} drew a Politics card" }),
  msg({ id: "log.progress.drew.science", message: "{player} drew a Science card" }),
];
const DISCARDED_TRACK = [
  msg({ id: "log.progress.discarded.trade", message: "{player} discarded a Trade card" }),
  msg({ id: "log.progress.discarded.politics", message: "{player} discarded a Politics card" }),
  msg({ id: "log.progress.discarded.science", message: "{player} discarded a Science card" }),
];

/**
 * What each fish spend bought, one sentence per spend, keyed by the engine's
 * wire ids (engine/scenarios/fishermen.go's Fish* constants). An unknown id prints
 * nothing rather than a fragment.
 */
const FISH_SPENT: Record<string, MessageDescriptor | undefined> = {
  wagon_boost: msg({
    id: "log.fish.spent.wagonBoost",
    message:
      "{player} spent <0>{count, plural, one {# fish tile} other {# fish tiles}}</0> for 2 extra wagon movement points",
  }),
  rider_hurry: msg({
    id: "log.fish.spent.riderHurry",
    message:
      "{player} spent <0>{count, plural, one {# fish tile} other {# fish tiles}}</0> to hurry a rider on",
  }),
  // Keyed by wire value: the two-fish spend once moved the robber to a named
  // hex and now removes it. Old logs with `move_robber` keep their sentence.
  remove_robber: msg({
    id: "log.fish.spent.removeRobber",
    message:
      "{player} spent <0>{count, plural, one {# fish tile} other {# fish tiles}}</0> to take the robber off the board",
  }),
  move_robber: msg({
    id: "log.fish.spent.moveRobber",
    message:
      "{player} spent <0>{count, plural, one {# fish tile} other {# fish tiles}}</0> to drive the robber away",
  }),
  steal: msg({
    id: "log.fish.spent.steal",
    message:
      "{player} spent <0>{count, plural, one {# fish tile} other {# fish tiles}}</0> to steal a card",
  }),
  take_resource: msg({
    id: "log.fish.spent.takeResource",
    message:
      "{player} spent <0>{count, plural, one {# fish tile} other {# fish tiles}}</0> to take a resource from the bank",
  }),
  // "A road or a ship": the credit buys either and the event does not say
  // which. Under Islands it can lay a ship (scenarios.md,
  // `fishermen.go`).
  free_road: msg({
    id: "log.fish.spent.freeRoad",
    message:
      "{player} spent <0>{count, plural, one {# fish tile} other {# fish tiles}}</0> on a free road or ship",
  }),
  bridge: msg({
    id: "log.fish.spent.bridge",
    message:
      "{player} spent <0>{count, plural, one {# fish tile} other {# fish tiles}}</0> on a bridge",
  }),
  dev_card: msg({
    id: "log.fish.spent.devCard",
    message:
      "{player} spent <0>{count, plural, one {# fish tile} other {# fish tiles}}</0> on a development card",
  }),
  // The same rung in a ruleset with no development deck. The discipline is
  // named by the `cak_progress_drawn` that follows in the same batch.
  progress_card: msg({
    id: "log.fish.spent.progressCard",
    message:
      "{player} spent <0>{count, plural, one {# fish tile} other {# fish tiles}}</0> on a progress card",
  }),
};

/**
 * The three spice villages, indexed by the wire's `village` (engine/explorers'
 * Village: 0 Swift Voyage, 1 Pirate Bonus, 2 Fast Gold).
 *
 * Whole sentences per village, like the improvement tracks: the village is the
 * noun the line is about, and the set is closed at three.
 */
const SPICE_FOUND = [
  msg({
    id: "log.explorers.reveal.spiceSwift",
    message: "{player} found a Swift Voyage spice farm",
  }),
  msg({
    id: "log.explorers.reveal.spicePirate",
    message: "{player} found a Pirate Bonus spice farm",
  }),
  msg({ id: "log.explorers.reveal.spiceGold", message: "{player} found a Fast Gold spice farm" }),
];
const SPICE_CREW = [
  msg({
    id: "log.explorers.crewSwift",
    message: "{player} befriended a Swift Voyage village and took a spice sack aboard",
  }),
  msg({
    id: "log.explorers.crewPirate",
    message: "{player} befriended a Pirate Bonus village and took a spice sack aboard",
  }),
  msg({
    id: "log.explorers.crewGold",
    message: "{player} befriended a Fast Gold village and took a spice sack aboard",
  }),
];

/**
 * Where a gold gain came from, one sentence per source, keyed by the wire's
 * reason (engine/explorers' Gold* constants), like FISH_SPENT.
 *
 * Only the three reasons stamped on `explorers_gold_changed` are written out.
 * The others move gold inside another event and are said on that line (the
 * lair battle's 2 gold each, tribute on `explorers_ship_moved`, the pirate's
 * coin on `explorers_pirate_moved`, the starting 2). An unknown reason falls
 * back to the generic sentences below.
 */
const GOLD_GAINED: Record<string, MessageDescriptor | undefined> = {
  consolation: msg({
    id: "log.explorers.gold.consolation",
    message:
      "{player} produced nothing and took <0>{count, plural, one {# gold} other {# gold}}</0>",
  }),
  gold_field: msg({
    id: "log.explorers.gold.field",
    message: "{player} took <0>{count, plural, one {# gold} other {# gold}}</0> from a gold field",
  }),
  reveal: msg({
    id: "log.explorers.gold.reveal",
    message: "{player} took <0>{count, plural, one {# gold} other {# gold}}</0> for the discovery",
  }),
};
const GOLD_TOOK = msg({
  id: "log.explorers.gold.took",
  message: "{player} took <0>{count, plural, one {# gold} other {# gold}}</0>",
});
const GOLD_PAID = msg({
  id: "log.explorers.gold.paid",
  message: "{player} paid <0>{count, plural, one {# gold} other {# gold}}</0>",
});

/**
 * "P1 lost 2 wheat", for the two monopolies and the two levies: one sentence
 * that differs only in the card token. Where the card is unknown (an old log,
 * an unnamed resource) the count becomes a plural argument.
 */
function lostLine(player: string, tok: LogToken | null, n: number): LogMessage {
  if (tok)
    return say(msg({ id: "log.lost", message: "{player} lost <0/>" }), { player }, [fill(tok)]);
  return say(
    msg({
      id: "log.lostCards",
      message: "{player} lost <0>{count, plural, one {# card} other {# cards}}</0>",
    }),
    { player, count: n },
    [DIM],
  );
}

/** "P1 took 4 ore", the levy's own haul line. */
function levyTook(player: string, tok: LogToken | null, n: number): LogMessage {
  if (tok)
    return say(msg({ id: "log.levy.took", message: "{player} took <0/>" }), { player }, [
      fill(tok),
    ]);
  return say(
    msg({
      id: "log.levy.tookCards",
      message: "{player} took {count, plural, one {# card} other {# cards}}",
    }),
    { player, count: n },
  );
}

/**
 * "P1 traded 2 wood → 1 ore", for every trade with the bank: `bank_traded` and
 * the three Knights variants (single swap, mixed basket, trading house) share
 * one message and one generic form.
 */
function bankTrade(player: string, give: LogToken[], get: LogToken[]): LogMessage[] {
  if (!give.length || !get.length)
    return [
      say(msg({ id: "log.bankTrade", message: "{player} traded with the bank" }), { player }),
    ];
  return [
    say(msg({ id: "log.traded", message: "{player} traded <0/> → <1/>" }), { player }, [
      fill(give),
      fill(get),
    ]),
  ];
}

/** "P1 took 3 cards from P2" / "P1 gave 3 cards to P2", for the four card-moving cards. */
function movedCards(
  dir: "took" | "gave",
  actor: string,
  other: string,
  cards: LogToken[],
  n: number,
): LogMessage[] {
  if (dir === "took") {
    if (cards.length)
      return [
        say(
          msg({ id: "log.tookFrom", message: "{player} took <0/> from {other}" }),
          {
            player: actor,
            other,
          },
          [fill(cards)],
        ),
      ];
    return [
      say(
        msg({
          id: "log.tookCountFrom",
          message:
            "{player} took <0>{count, plural, one {# card} other {# cards}}</0> from {other}",
        }),
        { player: actor, other, count: n },
        [DIM],
      ),
    ];
  }
  if (cards.length)
    return [
      say(
        msg({ id: "log.gaveTo", message: "{player} gave <0/> to {other}" }),
        {
          player: actor,
          other,
        },
        [fill(cards)],
      ),
    ];
  return [
    say(
      msg({
        id: "log.gaveCountTo",
        message: "{player} gave <0>{count, plural, one {# card} other {# cards}}</0> to {other}",
      }),
      { player: actor, other, count: n },
      [DIM],
    ),
  ];
}

/**
 * The four Raiders cards. The card is a token in a `<0/>` slot, as in
 * `log.playedCard`, drawn as its name with its face and rule on hover; no
 * runtime noun sits in the sentence (locales/README), and there is no article
 * (see `log.playedKnight`). One sentence serves all four.
 *
 * An unrecognised card (a newer server) misses this table and the line stays
 * quiet rather than showing a raw wire token.
 */
const RAIDERS_DREW = msg({ id: "log.raiders.drewCard", message: "{player} drew <0/>" });
const RAIDERS_CARD: Record<string, MessageDescriptor> = {
  muster: RAIDERS_DREW,
  swift_rider: RAIDERS_DREW,
  treason: RAIDERS_DREW,
  intrigue: RAIDERS_DREW,
};

/** A per-seat number in a battle result: prisoners taken, or gold. */
interface SeatCount {
  player?: unknown;
  count?: number;
}

/**
 * The same four, for a card that resolved to nothing.
 *
 * `treason` is unreachable: `deck.go` sets `d.Gold` for a Treason with nothing
 * to move, never `d.Void`, since its 2 gold are always paid. Kept because it
 * would be the right reading if that changed, and removing a msgid churns every
 * catalogue.
 */
const RAIDERS_CARD_VOID: Record<string, MessageDescriptor> = {
  // Two cases, one line: no rider left in your supply, or all six of the
  // castle's paths occupied (`deck.go`), the common case late in a game.
  muster: msg({
    id: "log.raiders.void.muster.card",
    message: "{player} drew <0/> with nowhere to put a rider, and discarded it",
  }),
  swift_rider: msg({
    id: "log.raiders.void.swift.card",
    message: "{player} drew <0/> with nowhere to place one",
  }),
  treason: msg({
    id: "log.raiders.void.treason.card",
    message: "{player} drew <0/> with no raider to move",
  }),
  intrigue: msg({
    id: "log.raiders.void.intrigue.card",
    message: "{player} drew <0/> with no raider to take, and drew again",
  }),
};

/**
 * What the log says about each event type, or `null` for the silent ones.
 *
 * A total map, so a new event type fails compilation until someone decides
 * what it says (`null` included); a `switch` with a default would let unwritten
 * lines ship invisible. Same shape as MODE_GHOST in lib/board3d/ghost.ts.
 *
 * Unknown types (an older or newer server) still render nothing rather than a
 * raw `cak_*` string: `describeEvent` looks the type up rather than indexing
 * blindly.
 */
export const EVENT_FORMATTERS: Record<EventType, Formatter | null> = {
  // ---- lifecycle: the board and the roster show these ----
  game_created: null,
  board_generated: null,
  setup_advanced: null,
  // The banner and player rail show whose turn it is; turn boundaries are noise
  // here.
  turn_started: null,
  turn_ended: null,
  // The demand is a prompt with a countdown; the actual discard gets a line
  // (`cards_discarded`) as each player answers.
  discards_required: null,

  // Three tags so the event die can ride on the roll: `<2/>` is empty in games
  // without one, and an empty run draws nothing.
  dice_rolled: ({ d, who, opts }) => {
    const d1 = d.d1 as number;
    const d2 = d.d2 as number;
    const lines = [
      say(
        msg({ id: "log.rolled", message: "{player} rolled <0/> <1>{total}</1> <2/>" }),
        { player: who, total: d1 + d2 },
        [
          fill({ k: "die", n: d1 }, { k: "die", n: d2, red: true }),
          DIM,
          fill(opts.eventDie ? { k: "edie", face: opts.eventDie } : null),
        ],
      ),
    ];
    // The production the robber blocked, on its own row under the roll, drawn as
    // a spent card (`loss`). The number is shown because a player names the
    // tile by it ("the 6-wheat").
    if (opts.blockedRes) {
      lines.push(
        say(
          msg({ id: "log.robberBlocked", message: "The robber blocked <0/> <1>on {num}</1>" }),
          { num: opts.blockedNum },
          [fill({ k: "res", idx: opts.blockedRes, n: 1, loss: true }), DIM],
        ),
      );
    }
    return lines;
  },
  // The two production events have different shapes.
  //
  // `resources_distributed` is one event per roll with a list:
  // `{gains: [{player, gain}]}` (ResDistributedData, engine/events.go).
  // `starting_resources` is one event per player with the hand directly:
  // `{player, gain}` (StartingResData, engine/events.go, emitted from
  // engine/setup.go).
  starting_resources: ({ d, who, gain }) => {
    const got = gain(d.gain);
    // The second settlement grants, the first does not; an empty grant gets no
    // line.
    return got.length
      ? [
          say(
            msg({ id: "log.setupGrant", message: "Setup: {player} received <0/>" }),
            { player: who },
            [fill(got)],
          ),
        ]
      : [];
  },
  // This roll's commodity conversions are folded in (see
  // `foldCommodityAdjusts`), since the event reports what the terrain paid,
  // not what the player kept.
  //
  // A full sentence (player, verb, cards). Quantities live on the cards
  // (`Wood ×2`, see cardFace.goodCount), which has no agreement to get wrong.
  resources_distributed: ({ d, name, gain, resIdx, opts }) => {
    const gains = (d.gains as { player: number; gain: number[] }[] | undefined) ?? [];
    const lines: LogMessage[] = [];
    for (const g of gains) {
      const got = foldCommodityAdjusts(gain(g.gain), g.player, opts.adjusts, resIdx);
      if (got.length)
        lines.push(
          say(
            msg({ id: "log.produced", message: "{player} received <0/>" }),
            { player: name(g.player) },
            [fill(got)],
          ),
        );
    }
    return lines.length
      ? lines
      : [say(msg({ id: "log.nobodyProduced", message: "Nobody produced" }))];
  },
  // Discards show the cards. The per-resource hand is public on the wire
  // (CardsDiscardedData; RedactEvent leaves it), so showing it hides nothing.
  cards_discarded: ({ d, who, gain }) => {
    const lost = gain(d.cards, true);
    if (!lost.length) return [];
    return [
      say(msg({ id: "log.discarded", message: "{player} discarded <0/>" }), { player: who }, [
        fill(lost),
      ]),
    ];
  },
  // A build and its setup-phase twin share a message.
  road_built: ({ who, piece }) => [
    say(msg({ id: "log.roadBuilt", message: "{player} built a road <0/>" }), { player: who }, [
      fill(piece("road")),
    ]),
  ],
  road_placed: ({ who, piece }) => [
    say(msg({ id: "log.roadBuilt", message: "{player} built a road <0/>" }), { player: who }, [
      fill(piece("road")),
    ]),
  ],
  settlement_built: ({ who, piece }) => [
    say(
      msg({ id: "log.settlementBuilt", message: "{player} built a settlement <0/>" }),
      { player: who },
      [fill(piece("settlement"))],
    ),
  ],
  settlement_placed: ({ who, piece }) => [
    say(
      msg({ id: "log.settlementBuilt", message: "{player} built a settlement <0/>" }),
      { player: who },
      [fill(piece("settlement"))],
    ),
  ],
  city_built: ({ who, piece }) => [
    say(
      msg({ id: "log.cityBuilt", message: "{player} upgraded to a city <0/>" }),
      { player: who },
      [fill(piece("city"))],
    ),
  ],
  setup_city_placed: ({ who, piece }) => [
    say(msg({ id: "log.cityPlaced", message: "{player} placed a city <0/>" }), { player: who }, [
      fill(piece("city")),
    ]),
  ],
  // A move to nowhere is the robber leaving the board (the two-fish spend),
  // which the spend's own line already says. The engine's nowhere is a
  // coordinate far outside any board (see lib/robber), so test by distance.
  robber_moved: ({ who, d }) => {
    const h = d.hex as { q?: number; r?: number } | undefined;
    if (h && (Math.abs(h.q ?? 0) > 1000 || Math.abs(h.r ?? 0) > 1000)) return [];
    return [
      say(msg({ id: "log.robberMoved", message: "{player} moved the robber" }), { player: who }),
    ];
  },
  // Shared with the Knights commodity steal below; only the shown card differs.
  card_stolen: ({ d, name, resIdx }) => {
    const thief = typeof d.thief === "number" ? name(d.thief) : someone();
    const victim = typeof d.victim === "number" ? name(d.victim) : someoneObj();
    // `res` is redacted for everyone but the two players involved.
    const i = resIdx(d.res);
    return [
      say(
        msg({ id: "log.stole", message: "{thief} stole from {victim} <0/>" }),
        { thief, victim },
        [fill(i ? { k: "res", idx: i, n: 1 } : null)],
      ),
    ];
  },
  dev_card_bought: ({ who }) => [
    say(msg({ id: "log.devCardBought", message: "{player} bought a development card" }), {
      player: who,
    }),
  ],
  // The card is fixed, so its name is no runtime noun. No article sits outside
  // the message in front of the <0/>, where a translator could not inflect or
  // drop it, matching `log.playedCard`.
  knight_played: ({ who, dev }) => [
    say(msg({ id: "log.playedKnight", message: "{player} played <0/>" }), { player: who }, [
      fill(dev("knight")),
    ]),
  ],
  road_building_played: ({ who, dev }) => [
    say(msg({ id: "log.playedCard", message: "{player} played <0/>" }), { player: who }, [
      fill(dev("road_building")),
    ]),
  ],
  year_of_plenty: ({ d, who, dev, gain }) => [
    say(msg({ id: "log.playedForCards", message: "{player} played <0/> <1/>" }), { player: who }, [
      fill(dev("year_of_plenty")),
      fill(gain(d.gain)),
    ]),
  ],
  // Monopoly touches every hand at once, so it gets a per-player breakdown like
  // production. MonopolyData.Takes lists only players who had the resource.
  monopoly_resolved: ({ d, who, name, resIdx, dev }) => {
    const i = resIdx(d.res);
    const takes = (d.takes as { player: number; count: number }[] | undefined) ?? [];
    const total = takes.reduce((a, x) => a + (x.count || 0), 0);
    if (!total)
      return [
        say(
          msg({
            id: "log.monopoly.none",
            message: "{player} played <0/> on <1/> but nobody had any",
          }),
          { player: who },
          [fill(dev("monopoly")), fill(i ? { k: "res", idx: i, n: 1 } : null)],
        ),
      ];
    const head = i
      ? say(
          msg({ id: "log.monopoly.took", message: "{player} played <0/> and took <1/>" }),
          { player: who },
          [fill(dev("monopoly")), fill({ k: "res", idx: i, n: total })],
        )
      : say(
          msg({
            id: "log.monopoly.tookCards",
            message: "{player} played <0/> and took {count, plural, one {# card} other {# cards}}",
          }),
          { player: who, count: total },
          [fill(dev("monopoly"))],
        );
    return [
      head,
      ...takes.map((x) =>
        lostLine(name(x.player), i ? { k: "res", idx: i, n: x.count, loss: true } : null, x.count),
      ),
    ];
  },
  // Four sentences rather than one with the award name inserted: the name is a
  // noun the frame must agree with ("die längste Handelsroute"), and there are
  // only two.
  longest_road: ({ holder, islands }) => {
    if (islands)
      return [
        holder
          ? say(
              msg({
                id: "log.longestRoute.taken",
                message: "{player} took the Longest Trade Route",
              }),
              {
                player: holder,
              },
            )
          : say(
              msg({ id: "log.longestRoute.open", message: "Longest Trade Route is up for grabs" }),
            ),
      ];
    return [
      holder
        ? say(msg({ id: "log.longestRoad.taken", message: "{player} took the Longest Road" }), {
            player: holder,
          })
        : say(msg({ id: "log.longestRoad.open", message: "Longest Road is up for grabs" })),
    ];
  },
  largest_army: ({ holder }) => [
    say(msg({ id: "log.largestArmy", message: "{player} took the Largest Army" }), {
      player: holder,
    }),
  ],
  // A drawn game reports no winner (-1), so the line must not assume one.
  game_finished: ({ d }) => [
    typeof d.winner === "number" && d.winner < 0
      ? say(msg({ id: "log.gameDrawn", message: "The game ended in a draw" }))
      : say(msg({ id: "log.gameOver", message: "Game over!" })),
  ],
  // Ending a game the table cannot finish: each is a player's decision, and the
  // log is where the others read it.
  player_surrendered: ({ who }) => [
    say(msg({ id: "log.surrendered", message: "{player} surrendered" }), { player: who }),
  ],
  draw_offered: ({ who }) => [
    say(msg({ id: "log.drawOffered", message: "{player} offered a draw" }), { player: who }),
  ],
  draw_responded: ({ d, who }) => [
    d.accept
      ? say(msg({ id: "log.drawAccepted", message: "{player} accepted the draw" }), { player: who })
      : say(msg({ id: "log.drawDeclined", message: "{player} declined the draw" }), {
          player: who,
        }),
  ],
  draw_cancelled: ({ who }) => [
    say(msg({ id: "log.drawWithdrawn", message: "{player} withdrew the draw offer" }), {
      player: who,
    }),
  ],
  game_claimed: ({ d, who, name }) => {
    const winner = typeof d.winner === "number" ? d.winner : -1;
    if (winner < 0)
      return [
        say(
          msg({
            id: "log.claimed.nobody",
            message: "{player} ended the game against the bots, with nobody ahead",
          }),
          { player: who },
        ),
      ];
    return [
      say(
        msg({
          id: "log.claimed.leader",
          message: "{player} ended the game against the bots, in the lead",
        }),
        { player: name(winner) },
      ),
    ];
  },
  // Neither side is dimmed: the arrow shows direction, and `loss` is for cards
  // that leave with nothing shown in return.
  bank_traded: ({ d, who, gain }) => bankTrade(who, gain(d.give), gain(d.get)),
  // A live offer is a panel with buttons and its negotiation is over in
  // seconds; only the outcome is history.
  trade_offered: null,
  trade_responded: null,
  trade_cancelled: null,
  trade_canceled: null, // legacy spelling on old logs; same non-event
  trade_countered: ({ who }) => [
    say(msg({ id: "log.counterOffer", message: "{player} made a counter-offer" }), {
      player: who || someone(),
    }),
  ],
  // Both players and both hands. "with" is written into the sentence so each
  // language can order it.
  trade_executed: ({ d, optName, gain }) => {
    const by = optName(d.by) ?? someone();
    const with_ = optName(d.with) ?? someoneObj();
    const give = gain(d.give);
    const want = gain(d.want);
    if (!give.length && !want.length)
      return [
        say(msg({ id: "log.tradedWith", message: "{player} traded with {other}" }), {
          player: by,
          other: with_,
        }),
      ];
    return [
      say(
        msg({ id: "log.tradedWithFor", message: "{player} traded <0/> → <1/> with {other}" }),
        { player: by, other: with_ },
        [fill(give), fill(want)],
      ),
    ];
  },

  // ---- Islands ----
  island_chip: ({ d, who }) => [
    say(
      msg({
        id: "log.islandChip",
        message: "{player} reached a new island ({vp, plural, one {+# VP} other {+# VP}})",
      }),
      { player: who, vp: d.vp as number },
    ),
  ],
  // The count lets the verb agree: one player must choose, several have to.
  gold_owed: ({ d, name }) => {
    const owed = (d.owed as { player: number }[] | undefined) ?? [];
    const names = owed.map((o) => name(o.player));
    if (!names.length) return [];
    return [
      say(
        msg({
          id: "log.goldOwed",
          message:
            "{count, plural, one {Gold: {names} must choose resources} other {Gold: {names} must choose resources}}",
        }),
        { names: nameList(names), count: names.length },
      ),
    ];
  },
  gold_chosen: ({ d, who, gain }) => {
    const got = gain(d.gain);
    return got.length
      ? [
          say(
            msg({ id: "log.goldTook", message: "{player} took <0/> from gold" }),
            { player: who },
            [fill(got)],
          ),
        ]
      : [say(msg({ id: "log.goldTookAny", message: "{player} took gold" }), { player: who })];
  },
  ship_built: ({ who, piece }) => [
    say(msg({ id: "log.shipBuilt", message: "{player} built a ship <0/>" }), { player: who }, [
      fill(piece("ship")),
    ]),
  ],
  ship_moved: ({ who, piece }) => [
    say(msg({ id: "log.shipMoved", message: "{player} moved a ship <0/>" }), { player: who }, [
      fill(piece("ship")),
    ]),
  ],
  pirate_moved: ({ who }) => [
    say(msg({ id: "log.pirateMoved", message: "{player} moved the pirate" }), { player: who }),
  ],
  islands_turn_reset: null,

  // ---- Knights ----
  // One line for the outcome, then one per consequence, as `monopoly_resolved`
  // does. `tied_defenders` (a tie for strongest defence) gets its own line so
  // the two progress-card draws that follow are explained.
  //
  // The parenthesised tally is written inside each of the three sentences,
  // since "defense 4, 3 cities" holds a counted noun and a number that some
  // languages inflect.
  cak_barbarian_attack: ({ d, name, optName }) => {
    if (d.skipped) return [];
    const tally = { strength: d.strength as number, cities: d.cities as number };
    if (d.win as boolean) {
      const defender = optName(d.defender);
      const tied = (d.tied_defenders as number[] | undefined) ?? [];
      // No sole defender and no tie means no knights out, which the engine only
      // reaches with no cities either (it wins on strength >= cities, 0 >= 0).
      // Nothing defended and nothing was at risk.
      if (!defender && !tied.length)
        return [
          say(
            msg({
              id: "log.barb.nothingToRaid",
              message: "Barbarians attacked and found nothing to raid.",
            }),
          ),
        ];
      return [
        say(
          msg({
            id: "log.barb.repelled",
            message:
              "Barbarians attacked and were repelled (defense {strength}, {cities, plural, one {# city} other {# cities}}).",
          }),
          tally,
        ),
        defender
          ? say(
              msg({
                id: "log.barb.defender",
                message: "{player} was the strongest defender (+1 VP).",
              }),
              { player: defender },
            )
          : say(
              // A joined name list cannot be a grammatical subject (verb
              // agreement with a list varies by language, and some have a
              // dual). After a colon the list is a label, and the sentence
              // has a subject the catalogue can see.
              msg({
                id: "log.barb.tied",
                message: "Tied for strongest defender, each drawing a progress card: {players}",
              }),
              { players: nameList(tied.map(name)) },
            ),
      ];
    }
    const dg = (d.downgraded as { player: number }[] | undefined) ?? [];
    // Players holding more than one sacrificable city choose which one goes;
    // their loss is logged separately, on cak_barbarian_downgraded.
    const pending = (d.pending_downgrade as number[] | undefined) ?? [];
    // A breakthrough with nobody to punish: everyone left holds only
    // settlements or only metropolises, which are immune. Said explicitly so
    // it does not look like a dropped line.
    if (!dg.length && !pending.length)
      return [
        say(
          msg({
            id: "log.barb.brokeThroughUntouched",
            message:
              "Barbarians attacked and broke through (defense {strength}, {cities, plural, one {# city} other {# cities}}), but no city could be taken.",
          }),
          tally,
        ),
      ];
    return [
      say(
        msg({
          id: "log.barb.brokeThrough",
          message:
            "Barbarians attacked and broke through (defense {strength}, {cities, plural, one {# city} other {# cities}}).",
        }),
        tally,
      ),
      ...dg.map((x) =>
        say(msg({ id: "log.barb.lostCity", message: "{player} lost a city to the barbarians." }), {
          player: name(x.player),
        }),
      ),
      ...pending.map((p) =>
        say(msg({ id: "log.barb.mustGiveCity", message: "{player} must give up a city." }), {
          player: name(p),
        }),
      ),
    ];
  },
  // A forfeit: the player owed a sacrifice but had no city to give, so nothing
  // was razed. The line must not claim a city.
  cak_barbarian_downgraded: ({ d, name }) => [
    d.forfeit
      ? say(
          msg({
            id: "log.barb.noCityLeft",
            message: "{player} had no city left to give the barbarians",
          }),
          { player: name(d.player as number) },
        )
      : say(msg({ id: "log.barb.gaveCity", message: "{player} gave a city to the barbarians" }), {
          player: name(d.player as number),
        }),
  ],
  // The other answer to the same debt, with Rivers: coins instead of a city. The
  // preceding `rivers_coins_changed` (reason "pillage") is not logged on its
  // own, since alone it reads as unexplained spending and here it would repeat.
  cak_pillage_bought_out: ({ d, name }) => [
    say(
      msg({
        id: "log.barb.boughtOut",
        message:
          "{player} paid <0>{count, plural, one {# coin} other {# coins}}</0> and kept the city",
      }),
      { player: name(d.player as number), count: PILLAGE_BUYOUT_COINS },
    ),
  ],
  cak_metropolis: ({ d, optName }) => {
    const ti = d.track as number;
    const mholder = optName(d.holder) ?? someone();
    const prev = optName(d.prev);
    const mseat = typeof d.holder === "number" && d.holder >= 0 ? d.holder : -1;
    const metro = (["metro_trade", "metro_politics", "metro_science"] as const)[ti];
    const slots = [fill(mseat >= 0 && metro ? { k: "piece", piece: metro, seat: mseat } : null)];
    if (prev)
      return [
        METRO_TAKEN[ti]
          ? say(METRO_TAKEN[ti], { player: mholder, prev }, slots)
          : say(
              msg({
                id: "log.metro.taken",
                message: "{player} built a metropolis (taken from {prev}) <0/>",
              }),
              { player: mholder, prev },
              slots,
            ),
      ];
    return [
      METRO_BUILT[ti]
        ? say(METRO_BUILT[ti], { player: mholder }, slots)
        : say(
            msg({ id: "log.metro.built", message: "{player} built a metropolis <0/>" }),
            {
              player: mholder,
            },
            slots,
          ),
    ];
  },
  // Earned but not yet placed: the table is waiting on the holder to name the
  // city.
  cak_metropolis_pending: ({ d, optName }) => {
    const ti = d.track as number;
    const holder = optName(d.holder) ?? someone();
    return [
      METRO_PENDING[ti]
        ? say(METRO_PENDING[ti], { player: holder })
        : say(
            msg({
              id: "log.metro.pending",
              message: "{player} earned a metropolis and is choosing a city",
            }),
            { player: holder },
          ),
    ];
  },
  cak_merchant_placed: ({ who }) => [
    say(msg({ id: "log.merchantPlaced", message: "{player} placed the merchant" }), {
      player: who,
    }),
  ],
  cak_wall_built: ({ who, piece }) => [
    say(msg({ id: "log.wallBuilt", message: "{player} built a city wall <0/>" }), { player: who }, [
      fill(piece("wall")),
    ]),
  ],
  // The one line this event exists for: everything else a 7 does is visible,
  // but "the robber did not move" is not. The 7 is on the line directly above,
  // so it is not repeated.
  cak_robber_idle: () => [
    say(
      msg({
        id: "log.robberIdle",
        message: "The robber stays out of play until the barbarians land",
      }),
    ),
  ],
  // The event die rides on its roll's line (see describeEvent's `eventDie`).
  cak_event_die: null,
  cak_knight_built: ({ who, piece }) => [
    // The id says "hired" but the text says "built", like EvKnightBuilt,
    // CmdKnightBuild and the rules. Renaming the id would orphan every
    // catalogue's translation.
    say(msg({ id: "log.knightHired", message: "{player} built a knight <0/>" }), { player: who }, [
      fill(piece("knight")),
    ]),
  ],
  cak_knight_activated: ({ who, piece }) => [
    say(
      msg({ id: "log.knightActivated", message: "{player} activated a knight <0/>" }),
      { player: who },
      [fill(piece("knight"))],
    ),
  ],
  cak_knight_promoted: ({ who, piece }) => [
    say(
      msg({ id: "log.knightPromoted", message: "{player} promoted a knight <0/>" }),
      { player: who },
      [fill(piece("knight"))],
    ),
  ],
  cak_knight_moved: ({ d, who, piece }) => {
    // A "move" to where the knight already stands is the engine's in-place
    // stand-down after a chase (robber, pirate or wagon barbarian), whose own
    // event says what was chased.
    const from = d.from as { q?: number; r?: number; side?: number } | undefined;
    const to = d.to as { q?: number; r?: number; side?: number } | undefined;
    const inPlace = !!from && !!to && from.q === to.q && from.r === to.r && from.side === to.side;
    if (inPlace) {
      return [
        say(
          msg({ id: "log.knightChased", message: "{player} sent a knight to give chase <0/>" }),
          { player: who },
          [fill(piece("knight"))],
        ),
      ];
    }
    return [
      say(
        msg({ id: "log.knightMoved", message: "{player} moved a knight <0/>" }),
        { player: who },
        [fill(piece("knight"))],
      ),
    ];
  },
  // Deserter, the victim's half: their knight leaves the board. The event names
  // the owner; the Deserter play itself is logged as a progress card.
  cak_knight_removed: ({ d, name }) => {
    const owner = typeof d.owner === "number" && d.owner >= 0 ? d.owner : -1;
    if (owner < 0) return [say(msg({ id: "log.knightRemoved", message: "A knight was removed" }))];
    return [
      say(
        msg({ id: "log.knightLost", message: "{player} lost a knight <0/>" }),
        {
          player: name(owner),
        },
        [fill({ k: "piece", piece: "knight", seat: owner })],
      ),
    ];
  },
  cak_knight_displaced: ({ d, optName }) => {
    const mover = optName(d.mover) ?? someone();
    const mseat = typeof d.mover === "number" && d.mover >= 0 ? d.mover : -1;
    return [
      say(
        msg({ id: "log.knightDisplaced", message: "{player} displaced a knight <0/>" }),
        { player: mover },
        [fill(mseat >= 0 ? { k: "piece", piece: "knight", seat: mseat } : null)],
      ),
    ];
  },
  // The displaced knight's owner choosing its new home: a different player's
  // decision, so its own line.
  cak_knight_relocated: ({ who, piece }) => [
    say(
      msg({ id: "log.knightRelocated", message: "{player} relocated the displaced knight <0/>" }),
      { player: who },
      [fill(piece("knight"))],
    ),
  ],
  // Warlord. `count` is how many knights woke up; zero is said too, or it looks
  // like a bug. The count is an ICU plural inside the sentence.
  cak_knights_all_active: ({ d, who, piece }) => {
    const n = typeof d.count === "number" ? d.count : null;
    if (n === null)
      return [
        say(
          msg({ id: "log.knightsAllActive", message: "{player} activated their knights <0/>" }),
          { player: who },
          [fill(piece("knight"))],
        ),
      ];
    return [
      say(
        msg({
          id: "log.knightsActivated",
          message: "{player} activated {count, plural, one {# knight} other {# knights}} <0/>",
        }),
        { player: who, count: n },
        [fill(n > 0 ? piece("knight") : null)],
      ),
    ];
  },
  // The drawer's copy carries the card; everyone else's is redacted to the deck
  // (engine/knights/events.go's EvProgressDrawn redactor, which also makes face-up
  // VP cards public). One line, told to the depth each viewer is entitled to.
  cak_progress_drawn: ({ d, who, prog }) => {
    if (typeof d.card === "string")
      return [
        say(msg({ id: "log.progressDrew", message: "{player} drew <0/>" }), { player: who }, [
          fill(prog(d.card)),
        ]),
      ];
    const m = DREW_TRACK[d.track as number];
    return [
      m
        ? say(m, { player: who })
        : say(msg({ id: "log.progressDrewAny", message: "{player} drew a progress card" }), {
            player: who,
          }),
    ];
  },
  // Over the hand limit: a card leaves your hand, chosen by you or the timer.
  // Face down to everyone else (only the track survives redaction).
  cak_progress_discarded: ({ d, who, prog }) => {
    if (typeof d.card === "string")
      return [
        say(msg({ id: "log.discarded", message: "{player} discarded <0/>" }), { player: who }, [
          fill(prog(d.card)),
        ]),
      ];
    const m = DISCARDED_TRACK[d.track as number];
    return [
      m
        ? say(m, { player: who })
        : say(
            msg({ id: "log.progressDiscardedAny", message: "{player} discarded a progress card" }),
            { player: who },
          ),
    ];
  },
  // Spy. Both parties get the card id (visible to thief and victim); everyone
  // else sees the two names.
  cak_progress_stolen: ({ d, name, prog }) => {
    const thief = typeof d.thief === "number" ? name(d.thief) : someone();
    const victim = typeof d.victim === "number" ? name(d.victim) : someoneObj();
    return [
      say(
        msg({
          id: "log.progressStolen",
          message: "{thief} took a progress card from {victim} <0/>",
        }),
        { thief, victim },
        [fill(typeof d.card === "string" ? prog(d.card) : null)],
      ),
    ];
  },
  cak_progress_played: ({ d, who, prog }) =>
    typeof d.card === "string"
      ? [
          say(msg({ id: "log.playedCard", message: "{player} played <0/>" }), { player: who }, [
            fill(prog(d.card)),
          ]),
        ]
      : [
          say(msg({ id: "log.playedProgressCard", message: "{player} played a progress card" }), {
            player: who,
          }),
        ],
  // A city improvement. Crane makes this the card's only visible effect, so the
  // line shows the discounted price.
  cak_improved: ({ d, who }) => {
    const ti = d.track as number;
    const cost = typeof d.cost === "number" ? d.cost : 0;
    const com = TRACK_COMMODITY[ti];
    const m = IMPROVED[ti];
    if (!m)
      return [
        say(msg({ id: "log.improvedCity", message: "{player} improved a city" }), { player: who }),
      ];
    return [
      say(m, { player: who }, [
        fill(cost > 0 && com !== undefined ? { k: "com", idx: com, n: cost, loss: true } : null),
      ]),
    ];
  },
  // Resource / Trade Monopoly: the levy is the card, so it is rendered like the
  // base monopoly, per-player counts included.
  cak_resource_levy: ({ d, who, name, resIdx }) => {
    const i = resIdx(d.res);
    const takes = (d.takes as { player: number; count: number }[] | undefined) ?? [];
    const total = takes.reduce((a, x) => a + (x.count || 0), 0);
    if (!total)
      return [
        say(
          msg({
            id: "log.levy.none",
            message: "{player} demanded <0/> but no opponent held that card",
          }),
          { player: who },
          [fill(i ? { k: "res", idx: i, n: 1 } : null)],
        ),
      ];
    return [
      levyTook(who, i ? { k: "res", idx: i, n: total } : null, total),
      ...takes.map((x) =>
        lostLine(name(x.player), i ? { k: "res", idx: i, n: x.count, loss: true } : null, x.count),
      ),
    ];
  },
  cak_commodity_levy: ({ d, who, name }) => {
    const ci = typeof d.commodity === "number" ? d.commodity : -1;
    const ok = ci >= 0 && ci <= 2;
    const takes = (d.takes as { player: number; count: number }[] | undefined) ?? [];
    const total = takes.reduce((a, x) => a + (x.count || 0), 0);
    if (!total)
      return [
        say(
          msg({
            id: "log.levy.none",
            message: "{player} demanded <0/> but no opponent held that card",
          }),
          { player: who },
          [fill(ok ? { k: "com", idx: ci, n: 1 } : null)],
        ),
      ];
    return [
      levyTook(who, ok ? { k: "com", idx: ci, n: total } : null, total),
      ...takes.map((x) =>
        lostLine(
          name(x.player),
          ok ? { k: "com", idx: ci, n: x.count, loss: true } : null,
          x.count,
        ),
      ),
    ];
  },
  // The commodity half of a 7-roll discard; public on the wire like
  // `cards_discarded`.
  cak_commodity_discarded: ({ d, who, coms }) => {
    const lost = coms(d.cards, true);
    if (!lost.length) return [];
    return [
      say(msg({ id: "log.discarded", message: "{player} discarded <0/>" }), { player: who }, [
        fill(lost),
      ]),
    ];
  },
  // Bishop (and the robber, under Knights): a random commodity, like
  // `card_stolen`. Only the two parties see which.
  cak_commodity_stolen: ({ d, name }) => {
    const thief = typeof d.thief === "number" ? name(d.thief) : someone();
    const victim = typeof d.victim === "number" ? name(d.victim) : someoneObj();
    const ci = typeof d.com === "number" ? d.com : -1;
    return [
      say(
        msg({ id: "log.stole", message: "{thief} stole from {victim} <0/>" }),
        { thief, victim },
        [fill(ci >= 0 && ci <= 2 ? { k: "com", idx: ci, n: 1 } : null)],
      ),
    ];
  },
  // Master Merchant. Both parties hold the bundle (`cards`); the redactor
  // leaves everyone else a count.
  cak_cards_taken: ({ d, optName, gain }) =>
    movedCards(
      "took",
      optName(d.to) ?? someone(),
      optName(d.from) ?? someoneObj(),
      gain(d.cards),
      typeof d.count === "number" ? d.count : 0,
    ),
  // Wedding: the giver picks, so the line is theirs.
  cak_cards_given: ({ d, optName, gain }) =>
    movedCards(
      "gave",
      optName(d.from) ?? someone(),
      optName(d.to) ?? someoneObj(),
      gain(d.cards),
      typeof d.count === "number" ? d.count : 0,
    ),
  cak_commodity_taken: ({ d, optName, coms }) =>
    movedCards(
      "took",
      optName(d.to) ?? someone(),
      optName(d.from) ?? someoneObj(),
      coms(d.cards),
      typeof d.count === "number" ? d.count : 0,
    ),
  // Commercial Harbor: the taker's resource goes out, the giver's chosen
  // commodity comes back; only the two of them learn which.
  //
  // Four sentences for four states, rather than inserting "a commodity" or
  // "nothing" as nouns.
  cak_harbor_given: ({ d, optName, resIdx }) => {
    const taker = optName(d.taker) ?? someoneObj();
    const giver = optName(d.giver) ?? someone();
    const i = resIdx(d.res);
    const ci = typeof d.com === "number" ? d.com : -1;
    const known = ci >= 0 && ci <= 2;
    const v = { player: giver, other: taker };
    if (known && i)
      return [
        say(msg({ id: "log.harbor.both", message: "{player} gave <0/> to {other} for <1/>" }), v, [
          fill({ k: "com", idx: ci, n: 1 }),
          fill({ k: "res", idx: i, n: 1 }),
        ]),
      ];
    if (known)
      return [
        say(
          msg({
            id: "log.harbor.forNothing",
            message: "{player} gave <0/> to {other} for <1>nothing</1>",
          }),
          v,
          [fill({ k: "com", idx: ci, n: 1 }), DIM],
        ),
      ];
    if (i)
      return [
        say(
          msg({
            id: "log.harbor.hidden",
            message: "{player} gave <0>a commodity</0> to {other} for <1/>",
          }),
          v,
          [DIM, fill({ k: "res", idx: i, n: 1 })],
        ),
      ];
    return [
      say(
        msg({
          id: "log.harbor.hiddenForNothing",
          message: "{player} gave <0>a commodity</0> to {other} for <1>nothing</1>",
        }),
        v,
        [DIM, DIM],
      ),
    ];
  },
  // Merchant Fleet: a 2:1 rate on one named card for the rest of the turn.
  cak_merchant_fleet: ({ d, who, resOrCom }) => {
    const card = resOrCom(d.is_com as boolean, d.res, d.com as number, 1);
    if (!card.length)
      return [
        say(msg({ id: "log.fleetAny", message: "{player} opened a 2:1 trade" }), { player: who }),
      ];
    return [
      say(
        msg({ id: "log.fleet", message: "{player} may trade <0/> 2:1 this turn" }),
        {
          player: who,
        },
        [fill(card)],
      ),
    ];
  },
  // Inventor. No player on the payload; the token swap shows on the board. The
  // numbers do not, so `an`/`bn` ride along for display only (knights/events.go's
  // tokensSwappedData): pre-swap numbers, while Apply still derives the swap
  // from the tiles. Older logs decode them as zero and get the original
  // sentence.
  cak_tokens_swapped: ({ d }) => {
    const an = typeof d.an === "number" ? d.an : 0;
    const bn = typeof d.bn === "number" ? d.bn : 0;
    if (!an || !bn)
      return [say(msg({ id: "log.tokensSwapped", message: "Two number tokens were swapped" }))];
    return [
      say(
        msg({
          id: "log.tokensSwappedNamed",
          message: "Two number tokens were swapped, the {a} and the {b}.",
        }),
        { a: an, b: bn },
      ),
    ];
  },
  // Irrigation / Mining. The yield is the entire card.
  cak_harvest: ({ d, who, resIdx }) => {
    const i = resIdx(d.res);
    const n = typeof d.count === "number" ? d.count : 0;
    if (!i || n <= 0)
      return [
        say(msg({ id: "log.harvestNothing", message: "{player} harvested nothing" }), {
          player: who,
        }),
      ];
    return [
      say(msg({ id: "log.harvest", message: "{player} harvested <0/>" }), { player: who }, [
        fill({ k: "res", idx: i, n }),
      ]),
    ];
  },
  // A city the barbarians laid on its side, standing again. The piece never
  // went back to the supply, so this event stops the upgrade crediting a
  // settlement nobody spent.
  cak_laid_city_restored: ({ who, piece }) => [
    say(
      msg({
        id: "log.laidCityRestored",
        message: "{player} stood their toppled city back up <0/>",
      }),
      { player: who },
      [fill(piece("city"))],
    ),
  ],
  // cak+explorers rule G: the Fast Gold advantage sells a commodity for a coin.
  // A public supply trade, so the commodity is named.
  cak_commodity_sold: ({ d, who }) => {
    const ci = typeof d.commodity === "number" ? d.commodity : -1;
    return [
      say(
        msg({ id: "log.soldForGold", message: "{player} sold <0/> for 1 gold" }),
        { player: who },
        [fill(ci >= 0 && ci <= 2 ? { k: "com", idx: ci, n: 1 } : null)],
      ),
    ];
  },
  // cak+explorers rule H: Medicine's other branch. The harbour settlement
  // arrives as the Explorers placement event beside this; this line says what
  // was paid.
  cak_cheap_harbour: ({ who }) => [
    say(
      msg({
        id: "log.cheapHarbour",
        message: "{player} paid for a harbour settlement (Medicine)",
      }),
      { player: who },
    ),
  ],
  // Medicine's discounted upgrade, worded like the paid build.
  cak_cheap_city: ({ who, piece }) => [
    say(
      msg({ id: "log.cheapCity", message: "{player} upgraded to a city (Medicine) <0/>" }),
      { player: who },
      [fill(piece("city"))],
    ),
  ],
  // Diplomat. Removing an opponent's open road can hand the route to a third
  // player; a following `longest_road` line says who, never why.
  //
  // The possessive is inside the message, so German ("{owner}s Straße") and
  // Spanish ("la carretera de {owner}") each write their own.
  cak_road_relocated: ({ d, who, name, piece }) => {
    const owner = typeof d.owner === "number" && d.owner >= 0 ? d.owner : -1;
    const mine = owner >= 0 && owner === (typeof d.player === "number" ? d.player : -2);
    if (mine)
      return d.to
        ? [
            say(
              msg({ id: "log.roadMoved", message: "{player} moved one of their roads <0/>" }),
              { player: who },
              [fill(piece("road"))],
            ),
          ]
        : [
            say(
              msg({ id: "log.roadRemovedOwn", message: "{player} removed one of their own roads" }),
              { player: who },
            ),
          ];
    if (owner < 0)
      return [
        say(
          msg({
            id: "log.roadRemovedUnknown",
            message: "{player} removed another player's road",
          }),
          { player: who },
        ),
      ];
    return [
      say(msg({ id: "log.roadRemoved", message: "{player} removed {owner}'s road" }), {
        player: who,
        owner: name(owner),
      }),
    ];
  },
  cak_commodity_traded: ({ d, who, resOrCom }) =>
    bankTrade(
      who,
      resOrCom(d.give_is_com as boolean, d.give_res, d.give_com as number, d.give_n as number),
      resOrCom(d.get_is_com as boolean, d.get_res, d.get_com as number, d.count as number),
    ),
  // The basket form: a mixed stake for a mixed ask, settled at once. Each side
  // can mix resources and commodities, so it is two token runs.
  cak_commodity_basket_traded: ({ d, who, gain, coms }) =>
    bankTrade(
      who,
      [...gain(d.spend_res), ...coms(d.spend_com)],
      [...gain(d.get_res), ...coms(d.get_com)],
    ),
  cak_trading_house: ({ d, who, resOrCom }) => {
    // Trade level-3 house: always 2 commodities in for 1 output.
    const giveCom = d.give as number;
    const give: LogToken[] = giveCom >= 0 && giveCom <= 2 ? [{ k: "com", idx: giveCom, n: 2 }] : [];
    return bankTrade(who, give, resOrCom(d.com_out as boolean, d.get_res, d.get_com as number, 1));
  },
  cak_aqueduct_taken: ({ d, who, resIdx }) => {
    // ResNone serializes as "none", meaning the bank was empty (nothing taken).
    const i = resIdx(d.res);
    if (!i)
      return [
        say(
          msg({
            id: "log.aqueductEmpty",
            message: "{player} couldn't take a resource (Aqueduct: bank empty)",
          }),
          { player: who },
        ),
      ];
    return [
      say(
        msg({ id: "log.aqueduct", message: "{player} took <0/> from the bank (Aqueduct)" }),
        { player: who },
        [fill({ k: "res", idx: i, n: 1 })],
      ),
    ];
  },

  // Silent: the conversion is folded into the production line it corrects by
  // `foldCommodityAdjusts` above (and separately by lib/cardFlightPlan); the
  // data arrives via `DescribeOpts.adjusts`.
  cak_commodity_adjust: null,
  // Interaction openers: prompts with countdowns, each followed by the event
  // saying what was done (the steal, the surrendered knight, the returned
  // commodity, the free resource).
  cak_spy_looking: null,
  cak_master_merchant_looking: null,
  cak_deserter_opened: null,
  cak_deserter_armed: null,
  cak_deserter_cleared: null,
  cak_harbor_setup: null,
  cak_aqueduct_owed: null,
  cak_wedding_owed: null,
  cak_defender_advance: null,
  // Alchemist fixes the next roll; the roll line shows the faces.
  cak_dice_fixed: null,
  cak_dice_unfixed: null,
  // A counter, not an action: the roads it grants are logged as they are built.
  cak_free_roads: null,
  // End-of-turn housekeeping on the knights' freshly-activated flags.
  cak_knights_refresh: null,

  // ---- Fishermen + Caravans (engine/scenarios) ----

  // A bookkeeping marker on the same commit as the triggering settlement or
  // city, whose own line is directly above.
  tab_camel_built: null,

  tab_camel_vote: ({ d, optName }) => {
    const who = optName(d.finisher);
    if (!who) return [];
    return [
      say(
        msg({
          id: "log.camel.vote",
          message:
            "{player} built and ended the turn; the table bids for the next camel, starting with them",
        }),
        { player: who },
      ),
    ];
  },

  // What they bid: the round is open, `tab_camel_bid` is public with no
  // redactor, and later bidders are meant to answer knowing the tally.
  //
  // Counted in votes rather than drawn as cards: the two piles depend on the
  // ruleset (wool and grain, or brick and lumber with Knights) and the event
  // does not say which. One card is one vote.
  //
  // "votes: {n}" rather than a plural, for the reason on `tab_camel_resolved`.
  tab_camel_bid: ({ d, who }) => {
    if (!who) return [];
    const votes = bidVotes(d as unknown as CamelBid);
    const path = d.path as { caravan?: unknown } | undefined;
    const caravan = typeof path?.caravan === "number" ? path.caravan : null;
    if (votes <= 0)
      return [
        say(
          msg({ id: "log.camel.bid.none", message: "{player} bid nothing for the camel" }),
          { player: who },
          [DIM],
        ),
      ];
    // A bid may name the placement it wants; seats naming the same path pool
    // their votes, so the named caravan is what the next bidder weighs.
    if (caravan !== null)
      return [
        say(
          msg({
            id: "log.camel.bid.path",
            // Caravans are numbered from 1 for a reader; the wire counts from 0.
            message: "{player} bid for caravan {n}, votes: {count}",
          }),
          { player: who, n: caravan + 1, count: votes },
          [DIM],
        ),
      ];
    return [
      say(
        msg({ id: "log.camel.bid", message: "{player} bid for the camel, votes: {count}" }),
        { player: who, count: votes },
        [DIM],
      ),
    ];
  },

  // The payments, and the only place the outcome is named.
  //
  // `pickPlacer` has four outcomes and "X places the camel" reads as a win in
  // all of them. The engine stamps a `reason` ("majority" | "coalition" |
  // "tie" | "nobody"), so this is a lookup; `camelOutcomeOf` falls back to the
  // old derivation only for logs without the field.
  tab_camel_resolved: ({ d, name, optName }) => {
    const placer = optName(d.placer);
    const paid = Array.isArray(d.paid) ? (d.paid as CamelBid[]) : [];
    const out: LogMessage[] = [];
    for (const p of paid) {
      const votes = bidVotes(p);
      if (votes <= 0) continue;
      // Votes, not cards: the ruleset picks the resource pair and the event
      // does not name it.
      //
      // "votes: {n}" rather than a plural: in a locale with one plural form, a
      // blank translation falls back to the English source under that locale's
      // rules and renders "1 votes" (caught by lib/i18n.test's catalogue pass).
      // A label and value never needs agreement.
      out.push(
        say(msg({ id: "log.camel.paid", message: "{player} paid for the camel, votes: {count}" }), {
          player: name(p.player),
          count: votes,
        }),
      );
    }
    const outcome = camelOutcomeOf(d.reason, typeof d.placer === "number" ? d.placer : -1, paid);
    // No placer: two or more bidders named the same placement with a combined
    // majority, so the camel is placed in the same batch.
    if (outcome === "coalition") {
      out.push(
        say(
          msg({
            id: "log.camel.coalition",
            message: "The bidders who agreed on a placement carried the vote between them",
          }),
        ),
      );
      return out;
    }
    if (!placer) return out;
    if (outcome === "nobody")
      out.push(
        say(
          msg({
            id: "log.camel.nobody",
            message: "Nobody bid, so the camel went to {player}, who ended the turn",
          }),
          { player: placer },
        ),
      );
    else if (outcome === "tie")
      out.push(
        say(
          msg({
            id: "log.camel.tie",
            message: "The vote was tied, so the camel went to {player}, who ended the turn",
          }),
          { player: placer },
        ),
      );
    else
      // The winning total is not repeated; the payments are in the rows above.
      out.push(
        say(msg({ id: "log.camel.won", message: "{player} won the camel vote" }), {
          player: placer,
        }),
      );
    return out;
  },

  // No player on this event, and none invented.
  //
  // `tab_camel_placed` carries only {caravan, e}; the placer was named by
  // `tab_camel_resolved`, usually but not always the row above (the strict
  // `blocks` freezes only the turn advance, so the on-turn seat can keep
  // building during the 15s placement window). "The camel" is still
  // unambiguous: the same `blocks` means at most one vote is ever in flight.
  tab_camel_placed: ({ d }) => {
    const c = typeof d.caravan === "number" ? d.caravan : null;
    if (c === null) return [];
    // Caravans are numbered from 1 for a reader; the wire counts from 0.
    return [
      say(msg({ id: "log.camel.placed", message: "The camel joined caravan {n}" }), { n: c + 1 }),
    ];
  },

  // Fishermen too:
  //
  // A catch names every seat that drew and how many tiles, never their value.
  // The count is public anyway (it follows from the roll, the grounds and the
  // buildings); the value would identify the tiles. So the redacted per-seat
  // `tab_fish_gained` stays silent and this line counts tiles.
  tab_fish_caught: ({ d, name }) => {
    const out: LogMessage[] = [];
    const draws = Array.isArray(d.draws) ? (d.draws as number[]) : [];
    draws.forEach((n, seat) => {
      if (!n) return;
      out.push(
        say(
          msg({
            id: "log.fish.caught",
            message:
              "{player} caught <0>{count, plural, one {# fish tile} other {# fish tiles}}</0>",
          }),
          { player: name(seat), count: n },
          [DIM],
        ),
      );
    });
    // The boot can turn up in the same draw: its holder needs an extra point to
    // win.
    const boot = typeof d.boot_to === "number" && d.boot_to >= 0 ? d.boot_to : null;
    if (boot !== null) {
      out.push(
        say(msg({ id: "log.fish.bootDrawn", message: "{player} landed the old boot" }), {
          player: name(boot),
        }),
      );
    }
    return out;
  },
  tab_fish_gained: null,

  // One whole sentence per spend. FISH_SPENT has seven entries for six live
  // spends: `move_robber` is a legacy wire id for old logs, and `dev_card` /
  // `progress_card` are the same 7-fish rung in two rulesets.
  //
  // The closed set is written out rather than "spent 4 fish to {action}"
  // (locales/README).
  //
  // The number is `tiles`, the tiles that left the spender, not the price or
  // value: the value would identify the tiles, since spendTiles is
  // deterministic and the prices are known (engine/scenarios/fishermen.go,
  // fishSpentData).
  tab_fish_spent: ({ d, who }) => {
    const n = typeof d.tiles === "number" ? d.tiles : 0;
    const m = FISH_SPENT[typeof d.use === "string" ? d.use : ""];
    // No tile count means an older log whose public half was the value; stay
    // quiet rather than say "0 tiles" or reveal the tiles.
    if (!m || !n) return [];
    return [say(m, { player: who, count: n }, [DIM])];
  },

  // `player` is the recipient: bootData names who ends up holding it
  // (fishermen.go's decideGiveBoot emits {player: d.To}); the giver is whoever
  // is on turn.
  tab_boot_given: ({ who }) => [
    say(msg({ id: "log.fish.bootGiven", message: "{player} was handed the old boot" }), {
      player: who,
    }),
  ],

  // `harbormaster_standings` restates the whole standing (holder and every
  // seat's harbour points) whenever either changes, including on ordinary
  // coastal builds. The log speaks only when the title moves
  // (`holder !== prev`), like `longest_road` and `largest_army`; the counts are
  // live on each seat's card.
  //
  // Three sentences, since "took it from nobody", "took it from someone" and
  // the subjectless case differ in any language that inflects around the
  // source.
  //
  // Seats go through `optName`, since NoPlayer is -1 on the wire.
  harbormaster_standings: ({ d, optName }) => {
    const holder = typeof d.holder === "number" ? d.holder : -1;
    const prev = typeof d.prev === "number" ? d.prev : -1;
    if (holder === prev) return [];
    const to = optName(holder);
    const from = optName(prev);
    if (!to)
      return [
        say(
          msg({
            id: "log.harbormaster.open",
            message: "Harbormaster is up for grabs",
          }),
        ),
      ];
    if (!from)
      return [
        say(msg({ id: "log.harbormaster.taken", message: "{player} took the Harbormaster" }), {
          player: to,
        }),
      ];
    return [
      say(
        msg({
          id: "log.harbormaster.takenFrom",
          message: "{player} took the Harbormaster from {from}",
        }),
        { player: to, from },
      ),
    ];
  },
  // ---- Rivers ----
  //
  // Paired events speak once. Buying a coin is two events (cards out, coin in)
  // and so is spending two (resource in, coins out), because Apply moves two
  // pools; the event naming the cards writes the sentence and
  // `rivers_coins_changed` stays quiet. `rivers_coin_traded` carries both
  // seats and the count, with no `rivers_coins_changed` alongside.
  //
  // `rivers_coins_changed` speaks only for the building ledger settling
  // against the board.
  rivers_bridge_built: ({ who, piece }) => [
    say(
      msg({ id: "log.rivers.bridgeBuilt", message: "{player} built a bridge <0/>" }),
      {
        player: who,
      },
      [fill(piece("bridge"))],
    ),
  ],

  rivers_coins_changed: ({ d, who }) => {
    if (d.reason !== "build") return [];
    const delta = typeof d.delta === "number" ? d.delta : 0;
    if (delta === 0) return [];
    // Two sentences, not a signed number: a coin returning to the supply (a
    // ship left the river, the Diplomat removed a road) is its own event.
    if (delta > 0) {
      return [
        say(
          msg({
            id: "log.rivers.coinsEarned",
            message: "{player} earned <0>{count, plural, one {# coin} other {# coins}}</0>",
          }),
          { player: who, count: delta },
          [DIM],
        ),
      ];
    }
    return [
      say(
        msg({
          id: "log.rivers.coinsReturned",
          message:
            "{player} returned <0>{count, plural, one {# coin} other {# coins}}</0> to the supply",
        }),
        { player: who, count: -delta },
        [DIM],
      ),
    ];
  },

  // The cards, drawn as spent: the rate depends on the buyer's harbours, so
  // only the log shows what a seat paid.
  rivers_coin_bought: ({ d, who, resIdx }) => {
    const idx = resIdx(d.res);
    const paid = typeof d.paid === "number" ? d.paid : 0;
    if (!idx || paid <= 0) return [];
    return [
      say(
        msg({ id: "log.rivers.coinBought", message: "{player} traded <0/> for a coin" }),
        { player: who },
        [fill({ k: "res", idx, n: paid, loss: true })],
      ),
    ];
  },

  // No coin count: two is a rule constant on the view (`coin_per_res`), which
  // this module does not see, and a literal could drift from the panel's price.
  rivers_coins_spent: ({ d, who, resIdx }) => {
    const idx = resIdx(d.res);
    if (!idx) return [];
    return [
      say(
        msg({ id: "log.rivers.coinsSpent", message: "{player} bought <0/> with coins" }),
        { player: who },
        [fill({ k: "res", idx, n: 1 })],
      ),
    ];
  },

  rivers_coin_traded: ({ d, name }) => {
    const n = typeof d.coins === "number" ? d.coins : 0;
    if (n <= 0) return [];
    const from = typeof d.from === "number" ? name(d.from) : someone();
    const to = typeof d.to === "number" ? name(d.to) : someoneObj();
    return [
      say(
        msg({
          id: "log.rivers.coinTraded",
          message: "{from} gave {to} <0>{count, plural, one {# coin} other {# coins}}</0>",
        }),
        { from, to, count: n },
        [DIM],
      ),
    ];
  },

  // Both tiles, only when one moved: the engine is silent when neither changed
  // (`wealthEvent`).
  //
  // The Poorest line names every holder: one tile per seat, held by everyone
  // tied for fewest coins (at the start of setup, the whole table).
  rivers_wealth_changed: ({ d, name }) => {
    const out: LogMessage[] = [];
    const top = typeof d.wealthiest === "number" ? d.wealthiest : -1;
    out.push(
      top >= 0
        ? say(
            msg({
              id: "log.rivers.wealthiest",
              message: "{player} holds the Wealthiest Settler",
            }),
            { player: name(top) },
          )
        : // A tie sends the tile back to the supply until a single player leads
          // again, which otherwise looks like a point quietly vanishing.
          say(
            msg({
              id: "log.rivers.wealthiestNobody",
              message: "Nobody holds the Wealthiest Settler: the coin lead is tied",
            }),
          ),
    );
    const poor = Array.isArray(d.poorest) ? (d.poorest as number[]) : [];
    if (poor.length === 1) {
      // One holder: "Tester holds a Poorest Settler tile", not "Tester each
      // hold".
      out.push(
        say(
          msg({
            id: "log.rivers.poorestOne",
            message: "{player} holds a Poorest Settler tile",
          }),
          { player: name(poor[0]) },
        ),
      );
    } else if (poor.length) {
      out.push(
        say(
          msg({
            id: "log.rivers.poorest",
            // "Each hold a tile", not "hold the tile": there is one Poorest
            // Settler per seat (rivers.md) and every seat tied for fewest coins
            // holds one.
            message: "{players} each hold a Poorest Settler tile",
          }),
          { players: nameList(poor.map(name)) },
        ),
      );
    }
    // No "nobody holds a Poorest Settler" line: an empty `poorest` means either
    // nobody is alone at the bottom, or the tile is not in this game (every
    // coin change in a Wagons or Raiders table). The event cannot tell them
    // apart and `Ctx` has no ruleset, so silence until `PoorestInPlay`
    // (rivers/view.go) reaches the log's context.
    return out;
  },

  // ---- Raiders (engine/raiders) ----
  //
  // No line here prints board coordinates; the board shows where, the lines say
  // what and to whom.
  //
  // A raider is a neutral enemy figure on a hex; a rider is a seat's own figure
  // on a path. One letter apart, so every line uses the article and the whole
  // noun.

  // The numbers brought ashore, said once before the landings resolve them one
  // at a time, so a player can check the roll against their coast.
  //
  // Not "built": alongside Knights, the event die's ship face (`landing.go`)
  // and each city improvement (`landing.go`, `decide.go`) also land a raider,
  // so the line covers all three triggers.
  raiders_landing: ({ d, who }) => {
    if (!who) return [];
    const numbers = Array.isArray(d.numbers) ? (d.numbers as number[]) : [];
    if (numbers.length === 0) return [];
    return [
      say(
        msg({
          id: "log.raiders.landing",
          message: "The raiders came for {numbers}, after {player} acted",
        }),
        { player: who, numbers: nameList(numbers.map(String)) },
      ),
    ];
  },

  // One raider off the supply, or a number that named nothing. A roll with no
  // eligible coast places nothing and is not re-rolled, so it gets a line, or
  // three numbers would seem to bring only two raiders.
  raiders_path_placed: () => [
    say(msg({ id: "log.raiders.path", message: "A raider took its place on a path" }), undefined, [
      DIM,
    ]),
  ],
  raiders_landed: ({ d, tileAt }) => {
    if (d.hex) {
      const at = tileAt(d.hex);
      if (at)
        return [
          say(
            msg({
              id: "log.raiders.landedAt",
              message: "A raider came ashore <0/> <1>on {num}</1>",
            }),
            { num: at.num },
            [fill(at.card), DIM],
          ),
        ];
      return [
        say(msg({ id: "log.raiders.landed", message: "A raider came ashore" }), undefined, [DIM]),
      ];
    }
    return [
      say(
        msg({
          id: "log.raiders.landedNowhere",
          message: "That number found no coast to land on, and is not re-rolled",
        }),
        undefined,
        [DIM],
      ),
    ];
  },

  // Cards are revealed and resolved on purchase, so this line is the whole of
  // it.
  raiders_card: ({ d, who, raid }) => {
    if (!who) return [];
    const card = typeof d.card === "string" ? d.card : "";
    const m = (d.void === true ? RAIDERS_CARD_VOID : RAIDERS_CARD)[card];
    if (!m) return [];
    const out = [say(m, { player: who }, [fill(raid(card))])];
    // Treason's gold is paid on the spot, so it is said here.
    const gold = typeof d.gold === "number" ? d.gold : 0;
    if (gold > 0) {
      out.push(
        say(
          msg({ id: "log.raiders.cardGold", message: "{player} took {count} gold for it" }),
          { player: who, count: gold },
          [DIM],
        ),
      );
    }
    return out;
  },

  // Which card placed the rider: a Muster is always the castle, a Swift Rider
  // anywhere.
  raiders_rider_placed: ({ d, who }) => {
    if (!who) return [];
    if (d.card === "swift_rider")
      return [
        say(
          msg({
            id: "log.raiders.riderPlacedSwift",
            message: "{player} put a rider on a path of their choosing",
          }),
          { player: who },
        ),
      ];
    return [
      say(msg({ id: "log.raiders.riderPlaced", message: "{player} put a rider on the castle" }), {
        player: who,
      }),
    ];
  },

  // ---- Explorers (engine/explorers) ----
  //
  // Most of the map starts face down, so a discovery, a lair falling and a
  // spice village changing hands are how most of the table learns what is out
  // there; those rows carry more detail. Routine ones (a ship moving, a crew
  // boarding) stay short, since a Movement phase is a dozen commands.

  // Setup, round 1. No piece token: there is no harbour-settlement model in the
  // icon set, and an ordinary settlement would show the wrong building. The
  // sentence names it.
  explorers_harbour_placed: ({ who }) => [
    say(
      msg({
        id: "log.explorers.harbourPlaced",
        message: "{player} placed a harbour settlement",
      }),
      { player: who },
    ),
  ],
  // Setup, round 2, the setup building that pays. The grant rides on this event
  // (placeData.Gain) rather than its own `starting_resources`, so it is a
  // second line, in the base game's sentence.
  explorers_settlement_placed: ({ d, who, piece, gain }) => {
    // cak+explorers rule C makes the round-2 placement a city, so read the flag.
    const city = d.city === true;
    const lines = [
      city
        ? say(
            // Its own id: `log.cityBuilt` has different English ("upgraded to a
            // city"), and this is a setup placement.
            msg({ id: "log.explorersCityBuilt", message: "{player} built a city <0/>" }),
            { player: who },
            [fill(piece("city"))],
          )
        : say(
            msg({ id: "log.settlementBuilt", message: "{player} built a settlement <0/>" }),
            { player: who },
            [fill(piece("settlement"))],
          ),
    ];
    const got = gain(d.gain);
    if (got.length)
      lines.push(
        say(
          msg({ id: "log.setupGrant", message: "Setup: {player} received <0/>" }),
          { player: who },
          [fill(got)],
        ),
      );
    return lines;
  },
  // Setup, round 3: one road and one ship with a settler aboard, placed by one
  // command. One sentence.
  explorers_start_placed: ({ who, piece }) => [
    say(
      msg({
        id: "log.explorers.startPlaced",
        message: "{player} placed a road and a ship carrying a settler <0/> <1/>",
      }),
      { player: who },
      [fill(piece("road")), fill(piece("ship"))],
    ),
  ],
  explorers_harbour_built: ({ who }) => [
    say(
      msg({
        id: "log.explorers.harbourBuilt",
        message: "{player} upgraded to a harbour settlement",
      }),
      { player: who },
    ),
  ],
  // Recycling has no event of its own: the returned ship rides on `recycled`.
  // Two sentences, because scrapping a ship destroys its cargo.
  explorers_ship_built: ({ d, who, piece }) => {
    const recycled = typeof d.recycled === "number" ? d.recycled : 0;
    if (recycled)
      return [
        say(
          msg({
            id: "log.explorers.shipRecycled",
            message: "{player} scrapped a ship and built a new one <0/>",
          }),
          { player: who },
          [fill(piece("ship"))],
        ),
      ];
    return [
      say(msg({ id: "log.shipBuilt", message: "{player} built a ship <0/>" }), { player: who }, [
        fill(piece("ship")),
      ]),
    ];
  },
  // The commonest event, so the plain case reuses the Islands sentence. Tribute
  // gets its own, since that coin moves inside this event and no
  // `explorers_gold_changed` records it.
  //
  // `stopped` is not said: a discovery that ended the move follows in the same
  // commit and says so.
  explorers_ship_moved: ({ d, who, piece }) => {
    const tribute = typeof d.tribute === "number" ? d.tribute : 0;
    if (tribute > 0)
      return [
        say(
          msg({
            id: "log.explorers.shipMovedTribute",
            message:
              "{player} moved a ship <0/> and paid <1>{count, plural, one {# gold in tribute} other {# gold in tribute}}</1>",
          }),
          { player: who, count: tribute },
          [fill(piece("ship")), DIM],
        ),
      ];
    return [
      say(msg({ id: "log.shipMoved", message: "{player} moved a ship <0/>" }), { player: who }, [
        fill(piece("ship")),
      ]),
    ];
  },
  // 1 wool for +2 movement points, once per ship per turn; the card is drawn as
  // spent.
  explorers_ship_sped: ({ who, piece }) => [
    say(
      msg({
        id: "log.explorers.shipSped",
        message: "{player} spent <0/> to speed up a ship <1/>",
      }),
      { player: who },
      [fill({ k: "res", idx: 3, n: 1, loss: true }), fill(piece("ship"))],
    ),
  ],
  // The one event that adds to the board, and for most seats the only notice
  // that the map grew.
  //
  // Six outcomes, switched on `kind` (0 none, 1 gold field, 2 fish shoal, 3
  // spice farm) and, for 0, on whether the terrain produces, matching how the
  // engine writes the tile (engine/explorers/board.go): a shoal is Sea, a gold
  // field Gold, a farm ResNone, else producing land or open sea.
  //
  // The terrain is drawn as its card (no noun to govern, and it is what the
  // discovery paid). The chit is a dim aside, since players name land by its
  // number ("the 8-ore").
  explorers_hex_revealed: ({ d, who, resIdx }) => {
    const kind = typeof d.kind === "number" ? d.kind : 0;
    const num = typeof d.number === "number" ? d.number : 0;
    if (kind === 1)
      return [
        say(
          msg({
            id: "log.explorers.reveal.lair",
            message: "{player} found a gold field with a pirate lair on it",
          }),
          { player: who },
        ),
      ];
    if (kind === 2) {
      // The shoal's die face drawn as a die: the face the fishing roll needs,
      // as in the fishing rows below.
      const face = typeof d.shoal === "number" ? d.shoal : 0;
      return [
        say(
          msg({ id: "log.explorers.reveal.shoal", message: "{player} found a fish shoal <0/>" }),
          { player: who },
          [fill(face >= 1 && face <= 6 ? { k: "die", n: face } : null)],
        ),
      ];
    }
    if (kind === 3) {
      // Default to 0: `village` is `omitempty` and Swift Voyage is zero, so the
      // commonest village arrives with the field absent.
      const v = typeof d.village === "number" ? d.village : 0;
      const m = SPICE_FOUND[v];
      return [
        m
          ? say(m, { player: who })
          : say(msg({ id: "log.explorers.reveal.spice", message: "{player} found a spice farm" }), {
              player: who,
            }),
      ];
    }
    const i = resIdx(d.res);
    if (!i)
      return [
        say(msg({ id: "log.explorers.reveal.sea", message: "{player} explored open sea" }), {
          player: who,
        }),
      ];
    const card = fill({ k: "res", idx: i, n: 1 });
    // A region's chit stack can run dry, revealing a hex with no number; say
    // nothing rather than "on 0".
    if (!num)
      return [
        say(
          msg({
            id: "log.explorers.reveal.landNoChit",
            message: "{player} explored new land <0/>",
          }),
          { player: who },
          [card],
        ),
      ];
    return [
      say(
        msg({
          id: "log.explorers.reveal.land",
          message: "{player} explored new land <0/> <1>on {num}</1>",
        }),
        { player: who, num },
        [card, DIM],
      ),
    ];
  },
  // Two sentences (settler, crew), not four: whether it went into a hold or a
  // harbour basin shows on the board. The price is drawn as spent cards.
  explorers_cargo_bought: ({ d, who, gain }) => {
    const cargo = (d.cargo ?? {}) as Record<string, number>;
    const cost = fill(gain(d.cost, true));
    if (cargo.settler)
      return [
        say(
          msg({ id: "log.explorers.boughtSettler", message: "{player} bought a settler <0/>" }),
          { player: who },
          [cost],
        ),
      ];
    return [
      say(
        msg({ id: "log.explorers.boughtCrew", message: "{player} bought a crew <0/>" }),
        {
          player: who,
        },
        [cost],
      ),
    ];
  },
  // Only legal when every slot is full, so it is always giving a piece up to
  // make room. Four pieces, four sentences.
  explorers_jettisoned: ({ d, who }) => {
    const cargo = (d.cargo ?? {}) as Record<string, number>;
    const m = cargo.settler
      ? msg({
          id: "log.explorers.jettison.settler",
          message: "{player} returned a settler to the supply to make room",
        })
      : cargo.haul
        ? msg({
            id: "log.explorers.jettison.haul",
            message: "{player} returned a fish haul to the supply to make room",
          })
        : cargo.crew
          ? msg({
              id: "log.explorers.jettison.crew",
              message: "{player} returned a crew to the supply to make room",
            })
          : cargo.spice
            ? msg({
                id: "log.explorers.jettison.spice",
                message: "{player} returned a spice sack to the supply to make room",
              })
            : null;
    // An empty hold cannot be jettisoned, so a miss here means a server with a
    // new cargo type.
    return m ? [say(m, { player: who })] : [];
  },
  // A transfer between a ship and one of its owner's harbour settlements. The
  // direction is what matters (it enables relays), so that is what is said.
  explorers_cargo_moved: ({ d, who, piece }) => [
    // A swap (cargo one way, `back` the other) is neither a load nor an unload.
    d.back && Object.values(d.back as Record<string, number>).some((n) => n > 0)
      ? say(
          msg({
            id: "log.explorers.cargoSwapped",
            message: "{player} swapped cargo between a ship and a harbour settlement <0/>",
          }),
          { player: who },
          [fill(piece("ship"))],
        )
      : d.to_ship
        ? say(
            msg({
              id: "log.explorers.cargoLoaded",
              message: "{player} loaded a ship at a harbour settlement <0/>",
            }),
            { player: who },
            [fill(piece("ship"))],
          )
        : say(
            msg({
              id: "log.explorers.cargoUnloaded",
              message: "{player} unloaded a ship into a harbour settlement <0/>",
            }),
            { player: who },
            [fill(piece("ship"))],
          ),
  ],
  // A lair crew is a third of an assault and comes home; a farm crew is spent
  // and buys a lasting advantage, so the farm case names the village.
  explorers_crew_landed: ({ d, who }) => {
    if (!d.sack)
      return [
        say(
          msg({
            id: "log.explorers.crewLanded",
            message: "{player} landed a crew on a pirate lair",
          }),
          { player: who },
        ),
      ];
    // Zero is Swift Voyage and the field is `omitempty`; see the reveal above.
    const v = typeof d.village === "number" ? d.village : 0;
    const m = SPICE_CREW[v];
    return [
      m
        ? say(m, { player: who })
        : say(
            msg({
              id: "log.explorers.crewFarm",
              message: "{player} befriended a spice village and took a spice sack aboard",
            }),
            { player: who },
          ),
    ];
  },
  explorers_crew_taken: ({ who }) => [
    say(
      msg({
        id: "log.explorers.crewTaken",
        message: "{player} picked a crew up from a captured lair",
      }),
      { player: who },
    ),
  ],
  // The fishing roll, once per Movement phase. Hit and miss both consume the
  // roll and both draw the die, which shows whose shoal it was.
  explorers_haul_placed: ({ d, who }) => [
    say(
      msg({
        id: "log.explorers.haulPlaced",
        message: "{player} fished <0/> and a haul appeared on that shoal",
      }),
      { player: who },
      [fill(typeof d.die === "number" ? { k: "die", n: d.die } : null)],
    ),
  ],
  explorers_haul_missed: ({ d, who }) => [
    say(
      msg({ id: "log.explorers.haulMissed", message: "{player} fished <0/> and caught nothing" }),
      { player: who },
      [fill(typeof d.die === "number" ? { k: "die", n: d.die } : null)],
    ),
  ],
  explorers_haul_loaded: ({ who, piece }) => [
    say(
      msg({
        id: "log.explorers.haulLoaded",
        message: "{player} loaded a fish haul aboard <0/>",
      }),
      { player: who },
      [fill(piece("ship"))],
    ),
  ],
  // One delivery can move two mission markers, so three shapes, three
  // sentences. Both counts are ICU plurals inside the message.
  explorers_delivered: ({ d, who }) => {
    const hauls = typeof d.hauls === "number" ? d.hauls : 0;
    const sacks = typeof d.sacks === "number" ? d.sacks : 0;
    if (hauls > 0 && sacks > 0)
      return [
        say(
          msg({
            id: "log.explorers.deliveredBoth",
            message:
              "{player} delivered <0>{hauls, plural, one {# fish haul} other {# fish hauls}} and {sacks, plural, one {# spice sack} other {# spice sacks}}</0> to the Council",
          }),
          { player: who, hauls, sacks },
          [DIM],
        ),
      ];
    if (hauls > 0)
      return [
        say(
          msg({
            id: "log.explorers.deliveredHauls",
            message:
              "{player} delivered <0>{hauls, plural, one {# fish haul} other {# fish hauls}}</0> to the Council",
          }),
          { player: who, hauls },
          [DIM],
        ),
      ];
    if (sacks > 0)
      return [
        say(
          msg({
            id: "log.explorers.deliveredSacks",
            message:
              "{player} delivered <0>{sacks, plural, one {# spice sack} other {# spice sacks}}</0> to the Council",
          }),
          { player: who, sacks },
          [DIM],
        ),
      ];
    return [];
  },
  explorers_founded: ({ who, piece }) => [
    say(
      msg({
        id: "log.explorers.founded",
        message: "{player} landed a settler and founded a settlement <0/>",
      }),
      { player: who },
      [fill(piece("settlement"))],
    ),
  ],
  // The module's set piece, and the one event that pays players not on turn.
  // The whole battle resolves in one event (so replays need no re-roll), making
  // the log the only place the throw is shown: an outcome line, then one line
  // per consequence, as `cak_barbarian_attack` does.
  //
  // The gold and first step are paid inside this event, so they are said here.
  // Involved seats sit after a colon (see `log.barb.tied`).
  explorers_lair_resolved: ({ d, name, optName }) => {
    const involved = (d.involved as number[] | undefined) ?? [];
    const rolls = (d.rolls as number[] | undefined) ?? [];
    const crews = (d.crews as number[] | undefined) ?? [];
    if (!involved.length) return [];
    const out: LogMessage[] = [
      say(
        msg({
          id: "log.explorers.lair.fell",
          message:
            "A pirate lair fell. Each attacker takes 2 gold and a step up the lairs track: {players}",
        }),
        { players: nameList(involved.map(name)) },
      ),
    ];
    involved.forEach((seat, i) => {
      const roll = rolls[i];
      if (typeof roll !== "number") return;
      out.push(
        say(
          msg({
            id: "log.explorers.lair.roll",
            message:
              "{player} threw <0/> with <1>{count, plural, one {# crew} other {# crews}}</1>",
          }),
          { player: name(seat), count: crews[i] ?? 0 },
          [fill({ k: "die", n: roll }), DIM],
        ),
      );
    });
    const hero = optName(d.hero);
    if (hero)
      out.push(
        say(
          msg({
            id: "log.explorers.lair.hero",
            message: "{player} led the battle, taking one more step and one crew back",
          }),
          { player: hero },
        ),
      );
    // The chit under the token, revealed as the lair falls. Zero means the
    // region's stack ran dry.
    const num = typeof d.number === "number" ? d.number : 0;
    if (num)
      out.push(
        say(
          msg({
            id: "log.explorers.lair.chit",
            message: "The gold field beneath it pays on <0>{num}</0>",
          }),
          { num },
          [DIM],
        ),
      );
    return out;
  },
  // The pirate ship, which replaces the robber. Three placements, three
  // sentences; a displacement is named because it ends that owner's tribute.
  explorers_pirate_moved: ({ d, who, optName, resIdx }) => {
    const displaced = optName(d.displaced);
    const out: LogMessage[] = [
      displaced
        ? say(
            msg({
              id: "log.explorers.pirate.displaced",
              message: "{player} sent {other}'s pirate ship home and placed their own",
            }),
            { player: who, other: displaced },
          )
        : d.from
          ? say(
              msg({
                id: "log.explorers.pirate.moved",
                message: "{player} moved their pirate ship",
              }),
              { player: who },
            )
          : say(
              msg({
                id: "log.explorers.pirate.placed",
                message: "{player} placed their pirate ship",
              }),
              { player: who },
            ),
    ];
    if (d.haul)
      out.push(
        say(
          msg({
            id: "log.explorers.pirate.haul",
            message: "The pirate ship scattered the fish haul on that shoal",
          }),
        ),
      );
    const victim = optName(d.victim);
    if (victim) {
      const gold = typeof d.gold === "number" ? d.gold : 0;
      if (gold > 0)
        // The only way gold is stolen: the victim holds no resource cards.
        // Its own sentence, since `log.stole` draws a card.
        out.push(
          say(
            msg({
              id: "log.explorers.pirate.gold",
              message:
                "{thief} took <0>{count, plural, one {# gold} other {# gold}}</0> from {victim}",
            }),
            { thief: who || someone(), victim, count: gold },
            [DIM],
          ),
        );
      else {
        // `res` is hidden except to the two seats on the Visible list, as in
        // the base game's steal, whose sentence fits exactly.
        const i = resIdx(d.res);
        out.push(
          say(
            msg({ id: "log.stole", message: "{thief} stole from {victim} <0/>" }),
            { thief: who || someone(), victim },
            [fill(i ? { k: "res", idx: i, n: 1 } : null)],
          ),
        );
      }
    }
    return out;
  },
  // Battle-ready ships rolling to drive off an opponent's pirate. The dice are
  // real seeded rolls. The winning faces ride along as an aside: 6, plus the
  // number of each held Pirate Bonus village (5 north, 4 south), so a reader
  // can tell a near miss from a hit. Events older than `hits` carry only
  // `need`, meaning "need or higher".
  explorers_pirate_chased: ({ d, who }) => {
    const rolls = (d.rolls as number[] | undefined) ?? [];
    const low = typeof d.need === "number" ? d.need : 6;
    const hits = Array.isArray(d.hits)
      ? (d.hits as number[])
      : Array.from({ length: Math.max(0, 7 - low) }, (_, i) => low + i);
    const need = formatList(hits.map(String), "disjunction");
    const dice = fill(rolls.map((n): LogToken => ({ k: "die", n })));
    return [
      d.won
        ? say(
            msg({
              id: "log.explorers.chase.won",
              message: "{player} drove the pirate ship off <0/> <1>needed {need}</1>",
            }),
            { player: who, need },
            [dice, DIM],
          )
        : say(
            msg({
              id: "log.explorers.chase.lost",
              message: "{player} failed to drive the pirate ship off <0/> <1>needed {need}</1>",
            }),
            { player: who, need },
            [dice, DIM],
          ),
    ];
  },
  // A batch, one line per gain. A production roll pays every seat that got no
  // resource cards plus a gold field's yield, and the reasons differ within one
  // batch (`gold_field`, `consolation`), so a summary would lose them. Per-seat
  // lines also match `resources_distributed` for the same roll.
  explorers_gold_changed: ({ d, name }) => {
    const gains =
      (d.gains as { player: number; amount: number; reason?: string }[] | undefined) ?? [];
    const batch = typeof d.reason === "string" ? d.reason : "";
    const out: LogMessage[] = [];
    for (const g of gains) {
      const amount = typeof g.amount === "number" ? g.amount : 0;
      if (!amount) continue;
      const player = name(g.player);
      const m = GOLD_GAINED[g.reason || batch];
      if (m) {
        out.push(say(m, { player, count: Math.abs(amount) }, [DIM]));
        continue;
      }
      out.push(say(amount > 0 ? GOLD_TOOK : GOLD_PAID, { player, count: Math.abs(amount) }, [DIM]));
    }
    return out;
  },
  // Gold across the counter, three ways, keyed by a closed reason set. Whole
  // sentences (the direction is the verb). An unknown reason prints nothing, as
  // with FISH_SPENT.
  explorers_gold_traded: ({ d, who, gain }) => {
    const gold = typeof d.gold === "number" ? d.gold : 0;
    const count = Math.abs(gold);
    if (!count) return [];
    switch (typeof d.reason === "string" ? d.reason : "") {
      case "buy":
        return [
          say(
            msg({
              id: "log.explorers.gold.bought",
              message: "{player} spent <0>{count, plural, one {# gold} other {# gold}}</0> on <1/>",
            }),
            { player: who, count },
            [DIM, fill(gain(d.get))],
          ),
        ];
      case "sell":
        return [
          say(
            msg({
              id: "log.explorers.gold.sold",
              message: "{player} sold <0/> for <1>{count, plural, one {# gold} other {# gold}}</1>",
            }),
            { player: who, count },
            [fill(gain(d.give, true)), DIM],
          ),
        ];
      case "bank":
        return [
          say(
            msg({
              id: "log.explorers.gold.banked",
              message:
                "{player} traded <0/> to the bank for <1>{count, plural, one {# gold} other {# gold}}</1>",
            }),
            { player: who, count },
            [fill(gain(d.give, true)), DIM],
          ),
        ];
      default:
        return [];
    }
  },

  // Silent: the activation a 7 owes is a prompt with a countdown, like
  // `discards_required`; `explorers_pirate_moved` says what was done.
  explorers_pirate_owed: null,
  // A phase marker. The HUD shows the phase, and everything done in it gets its
  // own line.
  explorers_movement_began: null,
  // Start-of-turn housekeeping on per-turn counters and movement flags.
  explorers_turn_reset: null,

  // The grain is what matters: three paths are free and five cost one grain
  // per rider.
  raiders_rider_moved: ({ d, who }) => {
    if (!who) return [];
    // A hurry paid in fish was already told by the fish spend's line; "spent a
    // grain" would name a price nobody paid.
    if (d.fish === true)
      return [
        say(msg({ id: "log.raiders.riderMoved", message: "{player} moved a rider" }), {
          player: who,
        }),
      ];
    if (d.hurry === true)
      return [
        say(
          msg({
            id: "log.raiders.riderHurried",
            message: "{player} spent a wheat to hurry a rider on",
          }),
          { player: who },
        ),
      ];
    return [
      say(msg({ id: "log.raiders.riderMoved", message: "{player} moved a rider" }), {
        player: who,
      }),
    ];
  },

  // Only the Swift Rider is optional, so this line can name it outright.
  raiders_declined: ({ who }) => {
    if (!who) return [];
    return [
      say(
        msg({ id: "log.raiders.declined", message: "{player} declined the Swift Rider" }),
        { player: who },
        [DIM],
      ),
    ];
  },

  // ---- Wagons ----
  //
  // Most of this scenario shows on the board, and a line per wagon path would
  // bury the rest. Logged: what the board does not show (gold changing hands,
  // deliveries, levels bought, dice rolled) plus the two barbarian lines, since
  // a barbarian jumping across the board unexplained looks like a bug.
  wagons_started: null,
  wagons_turn: null,
  wagons_halted: null,
  wagons_barbarian_owed: null,
  // Public by rule (docs/rules/wagons.md; rules.go drawSwift), standing in for
  // `dev_card_bought`: drawn from the same deck at the same price, then held and
  // played later. The event type names the card, so the line shows it, face and
  // all. A base card bought alongside stays `dev_card_bought` with the kind
  // stripped.
  wagons_swift_bought: ({ who, dev }) => [
    say(
      msg({ id: "log.wagon.swiftBought.card", message: "{player} bought <0/>" }),
      { player: who },
      [fill(dev("swift_journey"))],
    ),
  ],

  // A move is logged only when it paid a toll: a transfer between players that
  // watching the piece does not show.
  wagons_moved: ({ d, who, name }) => {
    const toll = typeof d.toll === "number" ? d.toll : 0;
    const paid = typeof d.paid === "number" ? d.paid : -1;
    if (toll <= 0 || paid < 0) return [];
    return [
      say(
        msg({
          id: "log.wagon.toll",
          message:
            "{player} paid {owner} <0>{count, plural, one {# gold} other {# gold}}</0> in tolls",
        }),
        { player: who, owner: name(paid), count: toll },
        [DIM],
      ),
    ];
  },

  wagons_boosted: ({ d, who }) =>
    d.free
      ? []
      : [
          say(
            msg({ id: "log.wagon.boost", message: "{player} spent a wheat for extra movement" }),
            {
              player: who,
            },
          ),
        ],

  wagons_charged: ({ d, who }) => {
    const die = typeof d.die === "number" ? d.die : 0;
    if (!die) return [];
    if (d.drove === true) {
      return [
        say(
          msg({
            id: "log.wagon.charge.won",
            message: "{player} rolled {die} and drove a barbarian off",
          }),
          { player: who, die },
        ),
      ];
    }
    return [
      say(
        msg({
          id: "log.wagon.charge.lost",
          message: "{player} rolled {die} and the barbarian held",
        }),
        { player: who, die },
        [DIM],
      ),
    ];
  },

  wagons_barbarian_moved: ({ who }) => [
    say(msg({ id: "log.wagon.barbarian", message: "{player} moved a barbarian" }), { player: who }),
  ],

  // The cargo is public and says where the wagon is heading. A select, so each
  // cargo is its own phrase for translators.
  wagons_loaded: ({ d, who }) => [
    say(
      msg({
        id: "log.wagon.loadedCargo",
        message:
          "{player} loaded {cargo, select, 1 {marble} 2 {glass} 3 {sand} 4 {tools} other {a cargo}}",
      }),
      { player: who, cargo: typeof d.cargo === "number" ? d.cargo : 0 },
    ),
  ],

  wagons_delivered: ({ d, who }) => {
    const gold = typeof d.gold === "number" ? d.gold : 0;
    return [
      say(
        msg({
          id: "log.wagon.deliveredCargo",
          message:
            "{player} delivered {cargo, select, 1 {marble} 2 {glass} 3 {sand} 4 {tools} other {a cargo}} for a point and <0>{count, plural, one {# gold} other {# gold}}</0>",
        }),
        { player: who, cargo: typeof d.cargo === "number" ? d.cargo : 0, count: gold },
      ),
    ];
  },

  wagons_upgraded: ({ d, who }) => {
    const level = typeof d.level === "number" ? d.level : 0;
    if (!level) return [];
    return [
      say(
        msg({
          id: "log.wagon.upgraded",
          message: "{player} upgraded their wagon to level {level}",
        }),
        {
          player: who,
          level,
        },
      ),
    ];
  },

  // Which resource and for how much, like Raiders gold ("bought <card> for 2
  // gold").
  wagons_bought: ({ d, who, resIdx }) => {
    const i = resIdx(d.res);
    const gold = typeof d.gold === "number" ? d.gold : 0;
    return [
      say(
        msg({ id: "log.wagon.boughtRes", message: "{player} bought <0/> for {count} gold" }),
        { player: who, count: gold },
        [fill(i ? { k: "res", idx: i, n: 1 } : null)],
      ),
    ];
  },

  wagons_sold: ({ d, who, resIdx }) => {
    const i = resIdx(d.res);
    const n = typeof d.count === "number" ? d.count : 0;
    const gold = typeof d.gold === "number" ? d.gold : 0;
    return [
      say(
        msg({ id: "log.wagon.soldRes", message: "{player} traded <0/> for {count} gold" }),
        { player: who, count: gold },
        [fill(i && n ? { k: "res", idx: i, n } : null)],
      ),
    ];
  },

  wagons_gold_moved: ({ d, name }) => {
    const gold = typeof d.gold === "number" ? d.gold : 0;
    const from = typeof d.from === "number" ? d.from : -1;
    const to = typeof d.to === "number" ? d.to : -1;
    if (gold <= 0 || from < 0 || to < 0) return [];
    return [
      say(
        msg({
          id: "log.wagon.goldTraded",
          message: "{player} gave {other} <0>{count, plural, one {# gold} other {# gold}}</0>",
        }),
        { player: name(from), other: name(to), count: gold },
        [DIM],
      ),
    ];
  },

  raiders_treason: ({ d, who }) => {
    if (!who) return [];
    const moves = Array.isArray(d.moves) ? d.moves.length : 0;
    if (moves === 0) return [];
    return [
      say(
        msg({
          id: "log.raiders.treason",
          message:
            "{player} played Treason and moved {count, plural, one {one raider} other {# raiders}}",
        }),
        { player: who, count: moves },
      ),
    ];
  },

  raiders_intrigue: ({ who }) => {
    if (!who) return [];
    return [
      say(
        msg({
          id: "log.raiders.intrigue",
          message: "{player} took a raider prisoner with Intrigue",
        }),
        { player: who },
      ),
    ];
  },

  // A change in conquest (engine/raiders/announce.go). Conquest is derived, so
  // otherwise nothing says a hex, and the settlement beside it, stopped
  // counting. The points ride on the building line.
  raiders_conquest: ({ d, name, tileAt }) => {
    const out: LogMessage[] = [];
    const hexLine = (h: unknown, withTile: MessageDescriptor, bare: MessageDescriptor) => {
      const at = tileAt(h);
      out.push(at ? say(withTile, { num: at.num }, [fill(at.card), DIM]) : say(bare));
    };
    const buildingLine = (b: unknown, settlement: MessageDescriptor, city: MessageDescriptor) => {
      const x = b as { player?: unknown; city?: unknown; vp?: unknown } | null;
      if (typeof x?.player !== "number" || x.player < 0) return;
      const isCity = x.city === true;
      const vp = typeof x.vp === "number" ? x.vp : isCity ? 2 : 1;
      out.push(
        say(isCity ? city : settlement, { player: name(x.player), vp }, [
          fill({ k: "piece", piece: isCity ? "city" : "settlement", seat: x.player }),
          DIM,
        ]),
      );
    };
    for (const h of Array.isArray(d.conquered) ? d.conquered : []) {
      hexLine(
        h,
        msg({
          id: "log.raiders.conqueredAt",
          message: "The raiders conquered <0/> <1>on {num}</1>",
        }),
        msg({ id: "log.raiders.conquered", message: "The raiders conquered a hex" }),
      );
    }
    for (const b of Array.isArray(d.lost) ? d.lost : []) {
      buildingLine(
        b,
        msg({
          id: "log.raiders.lostSettlement",
          message: "{player}'s settlement <0/> fell to the raiders <1>(-{vp} VP)</1>",
        }),
        msg({
          id: "log.raiders.lostCity",
          message: "{player}'s city <0/> fell to the raiders <1>(-{vp} VP)</1>",
        }),
      );
    }
    for (const h of Array.isArray(d.liberated) ? d.liberated : []) {
      hexLine(
        h,
        msg({
          id: "log.raiders.liberatedAt",
          message: "The raiders were driven off <0/> <1>on {num}</1>",
        }),
        msg({ id: "log.raiders.liberated", message: "The raiders were driven off a hex" }),
      );
    }
    for (const b of Array.isArray(d.restored) ? d.restored : []) {
      buildingLine(
        b,
        msg({
          id: "log.raiders.restoredSettlement",
          message: "{player}'s settlement <0/> stands again <1>(+{vp} VP)</1>",
        }),
        msg({
          id: "log.raiders.restoredCity",
          message: "{player}'s city <0/> stands again <1>(+{vp} VP)</1>",
        }),
      );
    }
    return out;
  },

  // One battle, resolved in full, over several lines. Any seat can be affected:
  // the sweep is automatic, every seat's riders count, and prisoners or gold can
  // land on a seat that did nothing.
  //
  // The headline is the arithmetic, which is the rule: a hex falls when the
  // riders on its six paths outnumber the raiders on it (out-strength them with
  // Knights, hence the number comes from the event).
  //
  // Worded as a battle won, not a hex taken: the riders drive the raiders off a
  // hex that was the players' all along.
  raiders_battle: ({ d, name, tileAt }) => {
    const raiders = typeof d.raiders === "number" ? d.raiders : 0;
    const strength = typeof d.strength === "number" ? d.strength : 0;
    const at = tileAt(d.hex);
    const out: LogMessage[] = [
      at
        ? say(
            msg({
              id: "log.raiders.battleWonAt",
              message:
                "The riders won a battle, {strength} against {count, plural, one {one raider} other {# raiders}}, <0/> <1>on {num}</1>",
            }),
            { num: at.num, strength, count: raiders },
            [fill(at.card), DIM],
          )
        : say(
            msg({
              id: "log.raiders.battleWon",
              message:
                "The riders won a battle, {strength} against {count, plural, one {one raider} other {# raiders}}",
            }),
            { strength, count: raiders },
          ),
    ];
    for (const p of Array.isArray(d.prisoners) ? (d.prisoners as SeatCount[]) : []) {
      if (!p || typeof p.player !== "number" || !p.count) continue;
      out.push(
        say(
          msg({
            id: "log.raiders.prisoners",
            message: "{player} took {count, plural, one {one prisoner} other {# prisoners}}",
          }),
          { player: name(p.player), count: p.count },
        ),
      );
    }
    for (const g of Array.isArray(d.gold) ? (d.gold as SeatCount[]) : []) {
      if (!g || typeof g.player !== "number" || !g.count) continue;
      out.push(
        say(
          msg({ id: "log.raiders.battleGold", message: "{player} took {count} gold" }),
          { player: name(g.player), count: g.count },
          [DIM],
        ),
      );
    }
    // Losses per seat, not per rider: the die names a direction and takes every
    // involved rider facing it.
    const lost = new Map<number, number>();
    for (const l of Array.isArray(d.lost) ? (d.lost as { player?: unknown }[]) : []) {
      if (typeof l?.player !== "number") continue;
      lost.set(l.player, (lost.get(l.player) ?? 0) + 1);
    }
    for (const [seat, count] of lost) {
      out.push(
        say(
          msg({
            id: "log.raiders.lost",
            message: "{player} lost {count, plural, one {a rider} other {# riders}} to the fight",
          }),
          { player: name(seat), count },
        ),
      );
    }
    return out;
  },

  // The per-turn coin-spend counter resetting; the panel shows it.
  rivers_turn_reset: null,

  // A per-turn bookkeeping marker clearing the per-turn counters (riders moved,
  // gold spent on resources). Battles that follow have their own events.
  raiders_sweep: null,

  // No robber, so a 7 moves and blocks nothing; it opens a choice.
  raiders_seven: ({ who }) => {
    if (!who) return [];
    return [
      say(
        msg({
          id: "log.raiders.seven",
          message: "{player} rolled a 7 and steals a card from a player of their choice",
        }),
        { player: who },
      ),
    ];
  },

  // Redaction blanks `res` for everyone but thief and victim; the line reads
  // the same either way.
  raiders_stolen: ({ d, name, resIdx }) => {
    if (d.nothing === true) {
      const thief = typeof d.thief === "number" ? name(d.thief) : someone();
      return [
        say(
          msg({
            id: "log.raiders.stoleNothing",
            message: "{player} found nobody to steal from",
          }),
          { player: thief },
          [DIM],
        ),
      ];
    }
    const thief = typeof d.thief === "number" ? name(d.thief) : someone();
    const victim = typeof d.victim === "number" ? name(d.victim) : someoneObj();
    const i = resIdx(d.res);
    return [
      say(
        msg({ id: "log.stole", message: "{thief} stole from {victim} <0/>" }),
        { thief, victim },
        [fill(i ? { k: "res", idx: i, n: 1 } : null)],
      ),
    ];
  },

  // Gold is a counter, not a card, so it has no token and skips `gain`.
  raiders_gold_spent: ({ d, who, resIdx }) => {
    if (!who) return [];
    const i = resIdx(d.res);
    const gold = typeof d.gold === "number" ? d.gold : 0;
    return [
      say(
        msg({ id: "log.raiders.goldSpent", message: "{player} bought <0/> for {count} gold" }),
        { player: who, count: gold },
        [fill(i ? { k: "res", idx: i, n: 1 } : null)],
      ),
    ];
  },

  // The maritime sale (strictly dominated, but in the rules). The cards leaving
  // the hand are shown.
  raiders_gold_gained: ({ d, who, gain }) => {
    if (!who) return [];
    const gold = typeof d.gold === "number" ? d.gold : 0;
    return [
      say(
        msg({ id: "log.raiders.goldGained", message: "{player} traded <0/> for {count} gold" }),
        { player: who, count: gold },
        [fill(gain(d.give, true))],
      ),
    ];
  },

  // Gold may be on either side of a player trade, so this rides alongside the
  // trade's own line.
  raiders_gold_moved: ({ d, optName }) => {
    const from = optName(d.from);
    const to = optName(d.to);
    const gold = typeof d.gold === "number" ? d.gold : 0;
    if (!from || !to || gold <= 0) return [];
    return [
      say(
        msg({ id: "log.raiders.goldMoved", message: "{player} gave {other} {count} gold" }),
        { player: from, other: to, count: gold },
        [DIM],
      ),
    ];
  },

  wagons_swift_played: ({ who, dev }) => [
    say(msg({ id: "log.playedCard", message: "{player} played <0/>" }), { player: who }, [
      fill(dev("swift_journey")),
    ]),
  ],
};

/**
 * The seat an event names as its actor, or -1 when it names none.
 *
 * `player` is the engine-wide convention (engine/events.go,
 * engine/knights/events.go). Table events (dice, a barbarian landfall, a knights
 * refresh) carry no seat, and the two awards name a `holder` instead.
 */
export function eventSeat(data: unknown): number {
  const d = data as Record<string, unknown> | undefined;
  return typeof d?.player === "number" ? d.player : -1;
}

/**
 * A single board.Resource as a Hand index (1..5), or 0 for none.
 *
 * A lone resource serializes as a string ("wood".."ore", "none"; see
 * engine/board/resource_json.go), unlike a Hand's numeric entries. Old logs
 * may carry the numeric index. "none" or unknown yields 0, the unused slot.
 *
 * Exported for the feed, which names the resource on a tile the robber
 * blocked.
 */
export function resourceHandIndex(r: unknown): number {
  if (typeof r === "number") return r >= 1 && r <= 5 ? r : 0;
  if (typeof r !== "string") return 0;
  const i = RESOURCE_NAMES.indexOf(r);
  return i > 0 ? i : 0;
}

/**
 * What the log says about an event, as messages.
 *
 * `opts` is the commit context the event does not carry (the Knights event die
 * and this roll's commodity conversions); see `DescribeOpts`, and routes/Game's
 * `EventLogFeed` for the forward scan that fills it.
 */
export function describeEvent(
  e: GameEvent,
  name: (s: number) => string,
  islands: boolean,
  opts: DescribeOpts = {},
): LogMessage[] {
  // Looked up rather than indexed: a newer server may send a type this table
  // lacks, which renders nothing.
  const fmt = (EVENT_FORMATTERS as Record<string, Formatter | null | undefined>)[e.type];
  if (!fmt) return [];

  const d = (e.data ?? {}) as Record<string, unknown>;
  const seat = eventSeat(e.data);
  const resIdx = resourceHandIndex;
  const c: Ctx = {
    d,
    name,
    seat,
    who: seat >= 0 ? name(seat) : "",
    holder: typeof d?.holder === "number" ? name(d.holder) : "",
    islands,
    opts,
    // Seat may be NoPlayer (-1) where there's no sole player (a tie, no defender).
    optName: (s) => (typeof s === "number" && s >= 0 ? name(s) : null),
    gain: (hand, loss) => {
      const arr = Array.isArray(hand) ? (hand as number[]) : undefined;
      const out: LogToken[] = [];
      for (let i = 1; i <= 5; i++) {
        const n = arr?.[i] ?? 0;
        if (n > 0) out.push({ k: "res", idx: i, n, loss });
      }
      return out;
    },
    coms: (hand, loss) => {
      const arr = Array.isArray(hand) ? (hand as number[]) : undefined;
      const out: LogToken[] = [];
      for (let i = 0; i <= 2; i++) {
        const n = arr?.[i] ?? 0;
        if (n > 0) out.push({ k: "com", idx: i, n, loss });
      }
      return out;
    },
    resIdx,
    resOrCom: (isCom, res, com, n) => {
      if (isCom) return com >= 0 && com <= 2 ? [{ k: "com", idx: com, n }] : [];
      const i = resIdx(res);
      return i ? [{ k: "res", idx: i, n }] : [];
    },
    piece: (p) => ({ k: "piece", piece: p, seat }),
    dev: (id) => ({ k: "card", kind: "dev", id }),
    prog: (id) => ({ k: "card", kind: "progress", id }),
    raid: (id) => ({ k: "card", kind: "raiders", id }),
    tileAt: (h) => {
      const hx = h as { q?: unknown; r?: unknown } | null | undefined;
      if (!opts.tiles || typeof hx?.q !== "number" || typeof hx?.r !== "number") return null;
      const t = opts.tiles.find((t) => t.hex.q === hx.q && t.hex.r === hx.r);
      const idx = t ? resIdx(t.res) : 0;
      if (!t || !idx || !t.num) return null;
      return { card: { k: "res", idx, n: 1 }, num: t.num };
    },
  };
  return fmt(c);
}

/**
 * `describeEvent`, memoised per event, with the empty lines already dropped.
 *
 * The feed rebuilds on every new event, and re-describing every line made a
 * game's log quadratic (a profile showed 1346ms across 1215 `LogTokens`
 * renders). Events are immutable, so lines only change if naming changes,
 * which the guard below checks. Keyed on the event object in a `WeakMap`.
 *
 * Returning the same array lets a per-row `React.memo` skip unchanged rows, so
 * appending an event renders one row.
 */
const describedLines = new WeakMap<
  GameEvent,
  {
    name: (s: number) => string;
    islands: boolean;
    eventDie?: string;
    adjusts?: readonly GameEvent[];
    blockedRes?: number;
    blockedNum?: number;
    tiles?: DescribeOpts["tiles"];
    lines: LogMessage[];
  }
>();

/**
 * The adjusts guard, compared by element rather than array identity: the caller
 * rebuilds its forward-scan array each time around the same immutable rows, so
 * an identity check would miss on every Knights production line.
 */
function sameAdjusts(a?: readonly GameEvent[], b?: readonly GameEvent[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((e, i) => e === b[i]);
}

export function describeEventLines(
  e: GameEvent,
  name: (s: number) => string,
  islands: boolean,
  opts: DescribeOpts = {},
): LogMessage[] {
  const hit = describedLines.get(e);
  if (
    hit &&
    hit.name === name &&
    hit.islands === islands &&
    hit.eventDie === opts.eventDie &&
    hit.blockedRes === opts.blockedRes &&
    hit.blockedNum === opts.blockedNum &&
    hit.tiles === opts.tiles &&
    sameAdjusts(hit.adjusts, opts.adjusts)
  ) {
    return hit.lines;
  }
  // Cached as messages, not text: translation happens in LogLine.tsx under
  // `useLingui`, so a language change reuses this cache.
  const lines = describeEvent(e, name, islands, opts);
  describedLines.set(e, {
    name,
    islands,
    eventDie: opts.eventDie,
    adjusts: opts.adjusts,
    blockedRes: opts.blockedRes,
    blockedNum: opts.blockedNum,
    tiles: opts.tiles,
    lines,
  });
  return lines;
}

/** Plain text of a run of tokens, for tests, tooltips and accessible labels. */
export function logLineText(l: LogLine): string {
  const parts: string[] = [];
  for (const tok of l) {
    switch (tok.k) {
      case "t":
        parts.push(tok.s);
        break;
      // A tally as the log draws it: "Wood ×2", never "2 Wood" (a counted noun
      // phrase needs agreement). See cardFace.goodCount and locales/README.
      case "res":
        parts.push(`${tok.loss ? "-" : ""}${goodCount(RES[tok.idx - 1]?.name ?? "?", tok.n)}`);
        break;
      case "com":
        parts.push(`${tok.loss ? "-" : ""}${goodCount(COMMOD[tok.idx]?.name ?? "?", tok.n)}`);
        break;
      case "die":
        parts.push(`[${tok.n}]`);
        break;
      case "edie":
        parts.push(`[${tok.face}]`);
        break;
      // The card's name is the sentence's noun, so it must appear in plain text.
      case "card":
        parts.push(playedCardText(tok.kind, tok.id).name);
        break;
      case "piece":
        break; // decoration: the sentence already names the piece
    }
  }
  return parts.join(" ");
}

/**
 * One piece of a translated line: a word run, an aside, or a run of pictures.
 * Translated here rather than in the component, so the content is testable and
 * the renderer draws parts in order.
 */
export type LogPart = { text: string } | { dim: string } | { run: LogToken[] };

/** `<0/>` and `<0>…</0>`, the two tag shapes a log message may carry. */
const LOG_TAG = /<(\d+)\/>|<(\d+)>([\s\S]*?)<\/\2>/g;

/**
 * A log message, translated and cut into the parts the row draws.
 *
 * `at` is the catalogue, defaulting to the global instance; the renderer passes
 * its provider's, which ties re-renders to language changes.
 *
 * Whitespace around a tag is dropped (the row is a flex line with its own
 * gap), so translations can place tags without worrying about spacing.
 */
export function logParts(m: LogMessage, at: I18n = i18n): LogPart[] {
  // Not inline: `lingui extract` treats every object literal passed to
  // `i18n._` as a descriptor, and a spread crashes it.
  const desc = { ...m.msg, values: { ...m.msg.values, ...m.values } };
  const text = at._(desc);
  const out: LogPart[] = [];
  const word = (s: string) => {
    const v = s.trim();
    if (v) out.push({ text: v });
  };
  let last = 0;
  for (const hit of text.matchAll(LOG_TAG)) {
    const at = hit.index ?? 0;
    word(text.slice(last, at));
    last = at + hit[0].length;
    const slot = m.slots?.[Number(hit[1] ?? hit[2])];
    if (hit[1] !== undefined) {
      // Self-closing: a run of cards, dice or a piece. An empty run draws
      // nothing, so one message serves rolls with and without an event die.
      if (slot && "fill" in slot && slot.fill.length) out.push({ run: slot.fill });
      continue;
    }
    const inner = hit[3].trim();
    if (!inner) continue;
    // Paired: an aside. A tag with no matching slot still renders its text, so
    // a stale tag loses styling, not words.
    if (slot && "dim" in slot) out.push({ dim: inner });
    else word(inner);
  }
  word(text.slice(last));
  return out;
}

/** Plain text of a whole line, in the active language. */
export function logMessageText(m: LogMessage, at: I18n = i18n): string {
  return logParts(m, at)
    .map((p) => ("run" in p ? logLineText(p.run) : "dim" in p ? p.dim : p.text))
    .filter((s) => s)
    .join(" ");
}
