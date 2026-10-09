import type { FullView } from "./types";

export interface GameCaps {
  hasDevCards: boolean;
  hasLargestArmy: boolean;
  hasKnightPieces: boolean;
  hasCommodities: boolean;
  hasImprovements: boolean;
  hasMetropolis: boolean;
  hasBarbarians: boolean;
  hasWalls: boolean;
  hasEventDie: boolean;
  hasShips: boolean;
  hasPirate: boolean;
  hasIslandVP: boolean;
  hasFish: boolean;
  hasOldBoot: boolean;
  hasCaravans: boolean;
  /** The Wagons scenario is on: wagons, gold, cargo and three path barbarians. */
  hasWagons: boolean;
  /**
   * There is a Longest Road award to win. False under Wagons (only Largest Army
   * remains). Its own cap because the player rail, scoreboard and rules panel
   * ask "is this badge in play" without caring which module answers.
   */
  hasLongestRoad: boolean;
  /**
   * Harbormaster is in play: the card, the per-seat harbour-point counter and
   * the +1 on the target.
   *
   * Read from the ruleset: the module publishes its ext from the first frame
   * (`InitExt` seeds every seat at zero) and the card slot must be reserved
   * from the start. Same reasoning as `hasKnights` and `hasFish`.
   */
  hasHarbormaster: boolean;
  /**
   * Rivers is on: watercourses, bridge-only edges, and a coin count per seat.
   * One cap, since none of these is optional within the module.
   */
  hasRivers: boolean;
  /**
   * The Knights module is active at all. Prefer a narrower cap where one fits
   * (hasBarbarians, hasMetropolis, ...); this is for the leftovers that have no
   * subsystem of their own, like the Merchant and the VP progress cards.
   */
  hasKnights: boolean;
  /**
   * The Raiders scenario is active: a castle, a coast the raiders land on, the
   * riders that answer them, and the gold and prisoner counters.
   *
   * Everything else is read off `view.ext.raiders` (coast, riders, deck, open
   * decision) rather than gated on the ruleset string.
   */
  hasRaiders: boolean;
  /**
   * There is a robber to move, block a hex with, or steal from.
   *
   * False in any Raiders game (no robber or pirate; a 7 takes a random card
   * from a chosen player). Check this before offering a robber destination,
   * since `board.robber` still arrives, parked off the board.
   */
  hasRobber: boolean;
  /** Gold: a public per-seat counter Raiders pays out in, and not a resource. */
  hasGold: boolean;
  /** The Explorers standalone: fog, cargo ships, missions and the Council. */
  hasExplorers: boolean;
  /**
   * Cities exist. False in Explorers without Knights, where a settlement
   * upgrades to a harbour settlement instead (engine/explorers `NoCities`).
   */
  hasCities: boolean;
}

export function rulesetCaps(ruleset: string): GameCaps {
  const parts = new Set(ruleset.split("+"));
  const knights = parts.has("cak");
  const islands = parts.has("islands");
  const fishermen = parts.has("fishermen");
  const caravans = parts.has("caravans");
  const harbormaster = parts.has("harbormaster");
  const rivers = parts.has("rivers");
  const raiders = parts.has("raiders");
  const wagons = parts.has("wagons");
  const explorers = parts.has("explorers");
  return {
    // The base development deck is off under Knights (progress decks instead),
    // Raiders (its own four cards, resolved on purchase), and Explorers
    // (`NoDevCards` in engine/explorers/hooks.go). Largest Army goes with it.
    //
    // Wagons replaces the deck's composition (16 Knight, 3 Road Building,
    // 3 Victory Point, plus Swift Journey) rather than removing it, and keeps
    // Largest Army.
    hasDevCards: !knights && !raiders && !explorers,
    hasLargestArmy: !knights && !raiders && !explorers,
    hasKnightPieces: knights,
    hasCommodities: knights,
    hasImprovements: knights,
    hasMetropolis: knights,
    // `barbariansSail` (engine/knights/hooks.go) drops the fleet when Raiders is in
    // the ruleset, since Raiders brings its own barbarians. Same shape as
    // `hasPirate` below.
    hasBarbarians: knights && !raiders,
    hasWalls: knights,
    hasEventDie: knights,
    hasShips: islands,
    // Raiders removes the robber and the pirate together; Islands sea routes
    // stay.
    hasPirate: islands && !raiders,
    hasIslandVP: islands,
    hasFish: fishermen,
    hasOldBoot: fishermen,
    hasCaravans: caravans,
    hasHarbormaster: harbormaster,
    hasRivers: rivers,
    hasWagons: wagons,
    // Explorers computes no route length at all (`NoLongestRoad`).
    hasLongestRoad: !wagons && !explorers,
    hasKnights: knights,
    hasRaiders: raiders,
    // Wagons and Explorers set `NoRobber` too: a 7 moves a barbarian or the
    // pirate ship there, never a robber.
    hasRobber: !raiders && !wagons && !explorers,
    hasGold: raiders,
    hasExplorers: explorers,
    hasCities: !(explorers && !knights),
  };
}

export function gameCaps(view: FullView): GameCaps {
  return rulesetCaps(view.config?.ruleset ?? "base");
}
