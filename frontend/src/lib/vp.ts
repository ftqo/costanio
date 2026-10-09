import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import type { GameCaps } from "./caps";
import type { PlayerStat, VPBreakdown } from "./types";

/**
 * One way a seat can be holding victory points. The post-game standings table
 * is built entirely out of these, so every point a player scored has a labelled
 * home: the shown sources plus `vpOther` always add up to the reported total.
 */
export interface VPSource {
  key: keyof VPBreakdown;
  /**
   * The source's name: a chip label on the standings and a row of the
   * breakdown tooltip. A descriptor rather than a string because vpSources'
   * result is memoised during render and must follow a language change.
   */
  label: MessageDescriptor;
  /** How the source is earned, shown on hover. */
  rate: MessageDescriptor;
  value: (b: VPBreakdown) => number;
}

const EMPTY: VPBreakdown = {
  settlements: 0,
  cities: 0,
  longest_road: 0,
  largest_army: 0,
  dev_vp: 0,
  island_vp: 0,
  metropolis: 0,
  defender: 0,
  merchant: 0,
  extra_cak: 0,
  caravan: 0,
  harbormaster: 0,
  wealth: 0,
};

/** Sum of every field, applying the 2x on the city count. */
function sumAll(b: VPBreakdown): number {
  return (
    b.settlements +
    2 * b.cities +
    b.longest_road +
    b.largest_army +
    b.dev_vp +
    b.island_vp +
    b.metropolis +
    b.defender +
    b.merchant +
    b.extra_cak +
    b.caravan +
    // `?? 0`: older records lack the key, and `undefined` would make the total
    // NaN and blank the standings.
    (b.harbormaster ?? 0) +
    (b.wealth ?? 0)
  );
}

/**
 * The seat's breakdown, reconstructed from the stat line when the server sent
 * none (older match records). Whatever the visible pieces do not explain is
 * hidden VP cards, as the server derives it too.
 */
export function vpBreakdownOf(r: PlayerStat): VPBreakdown {
  if (r.vp_breakdown) return r.vp_breakdown;
  const b: VPBreakdown = {
    ...EMPTY,
    settlements: r.settlements,
    cities: r.cities,
    longest_road: r.has_longest_road ? 2 : 0,
    largest_army: r.has_largest_army ? 2 : 0,
    island_vp: r.islands?.island_vp ?? 0,
    metropolis: 2 * (r.cak?.metropolis ?? 0),
    defender: r.cak?.defender_vp ?? 0,
    merchant: r.cak?.merchant_vp ?? 0,
    extra_cak: r.cak?.extra_vp ?? 0,
    caravan: r.caravans?.caravan_vp ?? 0,
  };
  b.dev_vp = Math.max(0, r.vp - sumAll(b));
  return b;
}

/** The VP sources this ruleset can produce, in the order they are columned. */
export function vpSources(caps: GameCaps): VPSource[] {
  const src: VPSource[] = [
    {
      key: "settlements",
      label: msg({ message: "Settlements", context: "victory point source" }),
      rate: msg`1 VP each`,
      value: (b) => b.settlements,
    },
  ];
  // Explorers without Knights has no cities at all (caps.hasCities).
  if (caps.hasCities) {
    src.push({
      key: "cities",
      label: msg({ message: "Cities", context: "victory point source" }),
      rate: msg({ message: "2 VP each", context: "how cities score" }),
      // The only field the server stores as a count rather than a VP figure.
      value: (b) => 2 * b.cities,
    });
  }
  // Wagons removes the title (`Hooks.NoLongestRoad`), so the column goes too.
  if (caps.hasLongestRoad) {
    src.push({
      key: "longest_road",
      // Islands calls the title a trade route, since it can run over water.
      // Two whole labels rather than a swapped noun, so translators can make
      // the rest of the phrase agree.
      label: caps.hasShips
        ? msg({ message: "Longest Trade Route", context: "victory point source" })
        : msg({ message: "Longest Road", context: "victory point source" }),
      rate: msg`2 VP for the longest route`,
      value: (b) => b.longest_road,
    });
  }
  if (caps.hasLargestArmy) {
    src.push({
      key: "largest_army",
      label: msg({ message: "Largest Army", context: "victory point source" }),
      rate: msg`2 VP for the most knights played`,
      value: (b) => b.largest_army,
    });
  }
  if (caps.hasDevCards) {
    src.push({
      key: "dev_vp",
      label: msg({ message: "Victory point cards", context: "victory point source" }),
      rate: msg`1 VP each, hidden until the game ends`,
      value: (b) => b.dev_vp,
    });
  }
  if (caps.hasIslandVP) {
    src.push({
      key: "island_vp",
      label: msg({ message: "Island bonus", context: "victory point source" }),
      rate: msg`VP for settling a new island`,
      value: (b) => b.island_vp,
    });
  }
  if (caps.hasMetropolis) {
    src.push({
      key: "metropolis",
      label: msg({ message: "Metropolises", context: "victory point source" }),
      rate: msg({ message: "2 VP each", context: "how metropolises score" }),
      value: (b) => b.metropolis,
    });
  }
  if (caps.hasBarbarians) {
    src.push({
      key: "defender",
      label: msg({ message: "Defender of the Realm", context: "victory point source" }),
      rate: msg`1 VP per barbarian attack repelled as the strongest defender`,
      value: (b) => b.defender,
    });
  }
  if (caps.hasKnights) {
    src.push(
      {
        key: "merchant",
        label: msg({ message: "Merchant", context: "victory point source" }),
        rate: msg`1 VP while you hold the Merchant`,
        value: (b) => b.merchant,
      },
      {
        key: "extra_cak",
        label: msg({ message: "Progress card VP", context: "victory point source" }),
        rate: msg`1 VP each from Constitution and Printer`,
        value: (b) => b.extra_cak,
      },
    );
  }
  if (caps.hasCaravans) {
    src.push({
      key: "caravan",
      label: msg({ message: "Caravan routes", context: "victory point source" }),
      rate: msg`1 VP per interior camel intersection you have built on`,
      value: (b) => b.caravan,
    });
  }
  if (caps.hasHarbormaster) {
    // The card is 2 transferable VP, like the base titles; without its own
    // column the points would land unexplained in `vpOther`.
    src.push({
      key: "harbormaster",
      label: msg({ message: "Harbormaster", context: "victory point source" }),
      rate: msg`2 VP for the most victory points in buildings on harbours`,
      value: (b) => b.harbormaster ?? 0,
    });
  }
  // The scenarios' own points, each with a column so they do not land in
  // "Other" (in Explorers, often half the total).
  if (caps.hasRaiders) {
    src.push(
      {
        key: "prisoners",
        label: msg({ message: "Prisoners", context: "victory point source" }),
        rate: caps.hasKnights
          ? msg`1 VP for every three prisoners`
          : msg`1 VP for every two prisoners`,
        value: (b) => b.prisoners ?? 0,
      },
      {
        key: "conquered",
        label: msg({ message: "Conquered buildings", context: "victory point source" }),
        rate: msg`Points lost while raiders hold a building's hex`,
        value: (b) => b.conquered ?? 0,
      },
    );
  }
  if (caps.hasWagons) {
    src.push(
      {
        key: "delivered",
        label: msg({ message: "Loads delivered", context: "victory point source" }),
        rate: msg`1 VP per load delivered`,
        value: (b) => b.delivered ?? 0,
      },
      {
        key: "wagon_level",
        label: msg({ message: "Wagon at level 5", context: "victory point source" }),
        rate: msg`1 VP for a wagon at level 5`,
        value: (b) => b.wagon_level ?? 0,
      },
    );
  }
  if (caps.hasExplorers) {
    src.push(
      {
        key: "explorer_harbours",
        label: msg({ message: "Harbour settlements", context: "victory point source" }),
        rate: msg`1 VP each on top of the settlement`,
        value: (b) => b.explorer_harbours ?? 0,
      },
      {
        key: "missions",
        label: msg({ message: "Missions", context: "victory point source" }),
        rate: msg`VP for your three mission markers and the bonus tiles`,
        value: (b) => b.missions ?? 0,
      },
    );
  }
  if (caps.hasRivers) {
    // The wealth tiles move with coin counts and can take points away, so the
    // net needs its own row rather than landing in `vpOther`.
    src.push({
      key: "wealth",
      label: msg({ message: "Wealth tiles", context: "victory point source" }),
      rate: msg`+1 for the Wealthiest Settler, -2 for a Poorest Settler`,
      value: (b) => b.wealth ?? 0,
    });
  }
  return src;
}

/**
 * Points the shown sources do not explain. Zero for every shipped ruleset; it
 * makes a future uncolumned VP source visible instead of vanishing.
 */
export function vpOther(r: PlayerStat, sources: VPSource[]): number {
  const b = vpBreakdownOf(r);
  return r.vp - sources.reduce((n, s) => n + s.value(b), 0);
}
