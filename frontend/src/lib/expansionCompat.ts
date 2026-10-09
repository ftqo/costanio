/**
 * Which expansions can share a board, and what a player is told when two cannot.
 *
 * A mirror of `engine/compat.go`. The Go test writes the matrix to
 * `engine/testdata/expansion_compat.json`, and `expansionCompat.test.ts` fails
 * when this table drifts from it. The wording is the same, as message
 * descriptors.
 *
 * Mirrored rather than fetched because the lobby greys a switch out before
 * anything is sent, and there is no rulesets endpoint.
 *
 * The backend refuses the same pairs itself; this table only explains and
 * disables. No em dashes in player-facing text.
 */

import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

/**
 * Every expansion name the rules specs describe, as it appears in a ruleset
 * string. All nine have registered engine modules, and the table covers all of
 * them.
 */
export const EXPANSION_MODULES = [
  "cak",
  "caravans",
  "explorers",
  "fishermen",
  "harbormaster",
  "islands",
  "raiders",
  "rivers",
  "wagons",
] as const;

export type ExpansionModule = (typeof EXPANSION_MODULES)[number];

/** A sorted module set: the first two names, any additional names, and its reason. */
export interface CompatPair {
  a: ExpansionModule;
  b: ExpansionModule;
  also?: readonly ExpansionModule[];
  reason: MessageDescriptor;
}

/**
 * Pairings that cannot be played together. Sorted by (a, b) like the Go table,
 * so the golden-file comparison is element-wise.
 *
 * Explorers is in seven of the eight: it is a standalone ruleset with its own
 * board, pieces and turn structure. Each partner gets its own sentence saying
 * what breaks, since that is what a host reads on a greyed switch.
 *
 * Knights is not one: `cak+explorers` is implemented under its own combination
 * rules; see "Knights in an Explorers game" in docs/rules/explorers.md.
 *
 * Change engine/compat.go first; this file is checked against it.
 */
export const EXPANSION_CONFLICTS: readonly CompatPair[] = [
  // Knights is not here: Explorers takes it under its own combination rules.
  {
    a: "caravans",
    b: "explorers",
    reason: msg({
      id: "expansionConflict.caravans.explorers",
      message:
        "Explorers has no longest route for a caravan to double, so caravan scoring has nothing to measure.",
    }),
  },
  {
    a: "explorers",
    b: "fishermen",
    reason: msg({
      id: "expansionConflict.explorers.fishermen",
      message:
        "Fishermen and Explorers can only be combined by rewriting three of the five fish spends, which Costanio has not built.",
    }),
  },
  {
    a: "explorers",
    b: "harbormaster",
    reason: msg({
      id: "expansionConflict.explorers.harbormaster",
      message: "Explorers has no harbours, so there would be nothing to score.",
    }),
  },
  {
    a: "explorers",
    b: "islands",
    reason: msg({
      id: "expansionConflict.explorers.islands",
      message:
        "Explorers and Islands both use ships and a pirate, and their rules for both are different.",
    }),
  },
  {
    a: "explorers",
    b: "raiders",
    reason: msg({
      id: "expansionConflict.explorers.raiders",
      message:
        "Raiders needs a fixed coastline to land on and a castle to defend, and most of an Explorers map is face down when the game starts.",
    }),
  },
  {
    a: "explorers",
    b: "rivers",
    reason: msg({
      id: "expansionConflict.explorers.rivers",
      message: "Explorers deals its map face down, so a river cannot be laid across it.",
    }),
  },
  {
    a: "explorers",
    b: "wagons",
    reason: msg({
      id: "expansionConflict.explorers.wagons",
      message: "Explorers is not a land connected map, so a wagon has no route to travel.",
    }),
  },
  {
    a: "islands",
    b: "wagons",
    reason: msg({
      id: "expansionConflict.islands.wagons",
      message:
        "Wagons cannot cross water, and an island board has no single landmass for the trade route to circle.",
    }),
  },
];

/**
 * Pairings that are playable but lose something. A warning never disables
 * anything: it is a note beside a switch, for when one module turns off
 * something the other one charges for.
 */
export const EXPANSION_WARNINGS: readonly CompatPair[] = [
  {
    a: "caravans",
    b: "wagons",
    reason: msg({
      id: "expansionWarning.caravans.wagons",
      message:
        "Wagons removes the Longest Road award, so the camels' road bonus does nothing (their settlement points still score).",
    }),
  },
];

/** Look one pair up in a table, in either order. */
function lookup(table: readonly CompatPair[], a: string, b: string): MessageDescriptor | null {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return table.find((p) => p.a === lo && p.b === hi && !p.also?.length)?.reason ?? null;
}

/** The refusal between two modules, if there is one. Argument order does not matter. */
export function conflictBetween(a: string, b: string): MessageDescriptor | null {
  return lookup(EXPANSION_CONFLICTS, a, b);
}

/** The degraded-pairing note between two modules, if there is one. */
export function warningBetween(a: string, b: string): MessageDescriptor | null {
  return lookup(EXPANSION_WARNINGS, a, b);
}

/** A pairing found in a selection: which two modules, and why it matters. */
export interface SelectionPair {
  a: string;
  b: string;
  also?: readonly string[];
  reason: MessageDescriptor;
}

/**
 * Every pairing from `table` that both of a selection's modules are in.
 *
 * The table is a parameter so tests can exercise the full matrix or inject a
 * synthetic one, which keeps the disabled-toggle path covered.
 */
export function pairsIn(
  table: readonly CompatPair[],
  selected: readonly string[],
): SelectionPair[] {
  const chosen = new Set(selected);
  return table
    .filter((entry) => compatModules(entry).every((name) => chosen.has(name)))
    .map((entry) => ({
      a: entry.a,
      b: entry.b,
      ...(entry.also?.length ? { also: entry.also } : {}),
      reason: entry.reason,
    }))
    .sort((x, y) => compatModules(x).join("+").localeCompare(compatModules(y).join("+")));
}

/** Every refused pairing inside a selection of modules, sorted. */
export function selectionConflicts(
  selected: readonly string[],
  table: readonly CompatPair[] = EXPANSION_CONFLICTS,
): SelectionPair[] {
  return pairsIn(table, selected);
}

/** Every degraded pairing inside a selection of modules, sorted. */
export function selectionWarnings(
  selected: readonly string[],
  table: readonly CompatPair[] = EXPANSION_WARNINGS,
): SelectionPair[] {
  return pairsIn(table, selected);
}

/**
 * What the picker should do with one toggle, given what is already selected.
 *
 * `blockedBy` is the module already on that refuses this one. Only set for a
 * toggle that is off: greying out the switch that would fix a bad selection
 * would leave the host stuck. Turning something off is always allowed.
 */
export interface ToggleCompat {
  blockedBy: SelectionPair | null;
}

export function toggleCompat(
  selected: readonly string[],
  key: string,
  on: boolean,
  table: readonly CompatPair[] = EXPANSION_CONFLICTS,
): ToggleCompat {
  if (on) return { blockedBy: null };
  const [first] = selectionConflicts([...selected, key], table).filter((p) =>
    compatModules(p).includes(key),
  );
  return { blockedBy: first ?? null };
}

/** All names required by one compatibility entry, in table order. */
export function compatModules(entry: { a: string; b: string; also?: readonly string[] }): string[] {
  return [entry.a, entry.b, ...(entry.also ?? [])];
}
