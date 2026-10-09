import { msg } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";
import type { Board, GameConfig, Resource } from "./types";
import { GALLERY, type GalleryMap } from "./maps/gallery";
import type { ExpansionModule } from "./expansionCompat";

interface Tag {
  label: string;
  bg: string;
}

// Chip colours are theme tokens via var(), so they follow dark mode.
//
// Labels are message descriptors, not strings: a resolved string in a module
// constant would freeze the language active at import. Call `i18n._` at the use
// site.
//
// Written in normal case, not the uppercase they render in: `text-transform`
// can be switched off by the CJK override in index.css, and kana have no upper
// case.
const MODULE_TAGS: Record<string, { label: MessageDescriptor; bg: string }> = {
  islands: { label: msg`Islands`, bg: "var(--color-blue)" },
  cak: { label: msg`Knights`, bg: "var(--color-purple)" },
  fishermen: { label: msg`Fishermen`, bg: "var(--color-fishermen)" },
  caravans: { label: msg`Caravans`, bg: "var(--color-caravans)" },
  harbormaster: { label: msg`Harbormaster`, bg: "var(--color-harbormaster)" },
  rivers: { label: msg`Rivers`, bg: "var(--color-rivers)" },
  raiders: { label: msg`Raiders`, bg: "var(--color-raiders)" },
  wagons: { label: msg`Wagons`, bg: "var(--color-slate)" },
  explorers: { label: msg`Explorers`, bg: "var(--color-explorers)" },
};

// The base chips carry translator context, since a lone word is ambiguous.
const BASE_TAG = msg({ message: "Base", context: "ruleset with no expansions" });
const BASE_GAME_LABEL = msg({ message: "Base Game", context: "ruleset with no expansions" });

/** "base+islands+cak" -> chips. Base alone -> [Base]. */
export function rulesetTags(ruleset: string): Tag[] {
  const parts = (ruleset || "base").split("+").filter((p) => p && p !== "base");
  if (parts.length === 0) return [{ label: i18n._(BASE_TAG), bg: "var(--color-green)" }];
  return parts.map((p) => {
    const tag = MODULE_TAGS[p];
    // An unknown module key is a wire value from a newer server; show it raw
    // rather than inventing a translation for it.
    return tag ? { label: i18n._(tag.label), bg: tag.bg } : { label: p, bg: "var(--color-muted)" };
  });
}

/** Display label for a single ruleset module key, e.g. "islands" -> "Islands". */
export function moduleLabel(module: string): string {
  const tag = MODULE_TAGS[module];
  if (!tag) return module.charAt(0).toUpperCase() + module.slice(1);
  return i18n._(tag.label);
}

/** Chip/badge color for a ruleset module key, e.g. "cak" -> "var(--color-purple)". */
export function moduleColor(module: string): string {
  return MODULE_TAGS[module]?.bg ?? "var(--color-muted)";
}

// Ruleset module keys offered as lobby browse filters, in display order. These
// are wire keys (knights is "cak"), matched directly against `game.ruleset`.
export const FILTER_MODULES = [
  "cak",
  "islands",
  "fishermen",
  "caravans",
  "harbormaster",
  "rivers",
  "raiders",
  "wagons",
  "explorers",
] as const;

export function rulesetLabel(ruleset: string): string {
  const parts = (ruleset || "base").split("+").filter((p) => p && p !== "base");
  if (parts.length === 0) return i18n._(BASE_GAME_LABEL);
  return parts.map((p) => (MODULE_TAGS[p] ? i18n._(MODULE_TAGS[p].label) : p)).join(" + ");
}

export interface Expansions {
  islands: boolean;
  knights: boolean;
  fishermen: boolean;
  caravans: boolean;
  harbormaster: boolean;
  rivers: boolean;
  raiders: boolean;
  wagons: boolean;
  explorers: boolean;
}

/**
 * Expansions that are a whole ruleset rather than a layer on the base game.
 *
 * Only `explorers`. Its ruleset string is its own name, never `base+explorers`:
 * `engine.modulesFor` refuses a Standalone combined with anything, "base"
 * included. The compatibility table already greys every other switch while it
 * is on.
 */
export const STANDALONE_EXPANSIONS: ReadonlySet<keyof Expansions> = new Set<keyof Expansions>([
  "explorers",
]);
/**
 * Modules whose board is not a terrain layout, so a config naming one must
 * carry no map. Mirrors `engine.AuthoredMapRefuser`. Explorers is the only one
 * (its board is a partition plus a hidden pool order).
 *
 * Kept separate from STANDALONE_EXPANSIONS: "is its own ruleset" and "deals its
 * own map" are different claims that happen to share a member.
 */
export const OWN_MAP_MODULES: ReadonlySet<ExpansionModule> = new Set<ExpansionModule>([
  "explorers",
]);

/** Whether this ruleset deals its own map. See OWN_MAP_MODULES. */
export function dealsItsOwnMap(ruleset: string): boolean {
  return (ruleset || "").split("+").some((m) => OWN_MAP_MODULES.has(m as ExpansionModule));
}

/**
 * The modules a standalone will nonetheless sit beside, by module name.
 *
 * Mirrors `StandaloneCompanions` in engine/explorers: Explorers takes Knights
 * and nothing else. `base` is never one, so the string is `cak+explorers`.
 */
export const STANDALONE_COMPANIONS: Partial<Record<keyof Expansions, readonly ExpansionModule[]>> =
  {
    explorers: ["cak"],
  };
/**
 * The wire-level module name behind each picker key (knights is `cak`).
 * Exported because the compatibility tables (expansionCompat.ts) are keyed by
 * module name.
 */
export const EXPANSION_MODULE: Record<keyof Expansions, ExpansionModule> = {
  islands: "islands",
  knights: "cak",
  fishermen: "fishermen",
  caravans: "caravans",
  harbormaster: "harbormaster",
  rivers: "rivers",
  raiders: "raiders",
  wagons: "wagons",
  explorers: "explorers",
};

const EXP_ORDER: [keyof Expansions, string][] = (
  [
    "islands",
    "knights",
    "fishermen",
    "caravans",
    "harbormaster",
    "rivers",
    "raiders",
    "wagons",
    "explorers",
  ] as (keyof Expansions)[]
).map((k) => [k, EXPANSION_MODULE[k]]);

// Every pair composes. Fishermen turns each desert into a lake and Caravans
// wants a desert or lake for its oasis, so Caravans' FinishBoard hook
// guarantees one either way; CanonicalRuleset settles the islands+caravans
// order. Under Knights two fish spends are refused (dev cards are disabled, the
// robber is suppressed until the first barbarian attack), which is a visible
// but unavailable option, so the pair stays on offer.
/**
 * Expansions still in beta: offered and playable, but with far fewer games
 * played and rules copy and art still settling. Knights and Islands are the
 * established pair.
 *
 * A property of the expansion, not a server flag: it describes how much play
 * the module has had.
 */
export const BETA_EXPANSIONS: ReadonlySet<keyof Expansions> = new Set<keyof Expansions>([
  "fishermen",
  "caravans",
  "harbormaster",
  "rivers",
  "raiders",
  "wagons",
  "explorers",
]);

// Expansions in the lobby picker, in display order. Descriptors, not strings,
// for the same reason as MODULE_TAGS.
export const VISIBLE_EXPANSIONS: [keyof Expansions, MessageDescriptor][] = [
  ["knights", MODULE_TAGS.cak.label],
  ["islands", MODULE_TAGS.islands.label],
  ["fishermen", MODULE_TAGS.fishermen.label],
  ["caravans", MODULE_TAGS.caravans.label],
  ["harbormaster", MODULE_TAGS.harbormaster.label],
  ["rivers", MODULE_TAGS.rivers.label],
  ["raiders", MODULE_TAGS.raiders.label],
  ["wagons", MODULE_TAGS.wagons.label],
  ["explorers", MODULE_TAGS.explorers.label],
];

/**
 * Which shelf an expansion sits on in the picker.
 *
 * "core" is the two heavyweight expansions that reshape a game; "scenario" is
 * the lighter modules that add one system. Independent of BETA_EXPANSIONS: a
 * scenario can leave beta and stay a scenario.
 *
 * A map rather than two lists, so VISIBLE_EXPANSIONS stays the one place that
 * sets the order.
 */
export type ExpansionGroup = "core" | "scenario";

export const EXPANSION_GROUP: Record<keyof Expansions, ExpansionGroup> = {
  knights: "core",
  islands: "core",
  fishermen: "scenario",
  caravans: "scenario",
  harbormaster: "scenario",
  rivers: "scenario",
  raiders: "scenario",
  wagons: "scenario",
  // A self-contained twist chosen instead of the standard game, so a scenario,
  // though the largest. A one-item shelf would be a heading for one row.
  explorers: "scenario",
};

/** VISIBLE_EXPANSIONS split by shelf, each keeping the order it has there. */
export function groupedExpansions(): [ExpansionGroup, [keyof Expansions, MessageDescriptor][]][] {
  const groups: ExpansionGroup[] = ["core", "scenario"];
  return groups.map((g) => [g, VISIBLE_EXPANSIONS.filter(([k]) => EXPANSION_GROUP[k] === g)]);
}

/**
 * "Base + Knights + Islands + Fishermen + Caravans": what a table can be made
 * of, for the landing page's summary.
 *
 * Derived from VISIBLE_EXPANSIONS so it cannot drift from the lobby. Built from
 * msgids that are already translated (the picker's expansion names, the "Base"
 * chip) rather than one long sentence that would ship untranslated.
 */
export function offeredRulesetLabel(allowScenarios = true): string {
  return [
    i18n._(BASE_TAG),
    ...VISIBLE_EXPANSIONS.filter(([key]) => allowScenarios || !BETA_EXPANSIONS.has(key)).map(
      ([, label]) => i18n._(label),
    ),
  ].join(" + ");
}

/**
 * Islands owns gold tiles: the engine rejects a board with terrain whose module
 * is off, so turning Islands off on an islands map would send a config the
 * server refuses. Demote the gold to plain land in the same patch so the host
 * keeps the map. Null when the board has no gold to rewrite.
 */
export function boardWithoutIslandsTerrain(board?: Board): Board | null {
  if (!board?.tiles.some((t) => t.res === "gold")) return null;
  return {
    ...board,
    tiles: board.tiles.map((t) => (t.res === "gold" ? { ...t, res: "land" } : t)),
  };
}

// The server canonicalises a ruleset string to "base" + module names sorted
// lexicographically (the order decides which module's DefaultConfig claims
// TargetVP). Sorting here too means an optimistic lobby edit matches the echo
// instead of flickering.
export function assembleRuleset(exp: Expansions): string {
  // A standalone ruleset is its own name, with no "base", plus any companion
  // it takes. See STANDALONE_EXPANSIONS and STANDALONE_COMPANIONS.
  for (const k of STANDALONE_EXPANSIONS) {
    if (!exp[k]) continue;
    const names = [EXPANSION_MODULE[k]];
    for (const c of STANDALONE_COMPANIONS[k] ?? []) {
      const key = EXP_ORDER.find(([, name]) => name === c)?.[0];
      if (key && exp[key]) names.push(c);
    }
    return names.sort().join("+");
  }
  const mods = EXP_ORDER.filter(([k]) => exp[k])
    .map(([, name]) => name)
    .sort();
  return ["base", ...mods].join("+");
}

export function parseExpansions(ruleset: string): Expansions {
  const parts = new Set((ruleset || "base").split("+"));
  return {
    islands: parts.has("islands"),
    knights: parts.has("cak"),
    fishermen: parts.has("fishermen"),
    caravans: parts.has("caravans"),
    harbormaster: parts.has("harbormaster"),
    rivers: parts.has("rivers"),
    raiders: parts.has("raiders"),
    wagons: parts.has("wagons"),
    explorers: parts.has("explorers"),
  };
}

/** Mirrors the engine's default target; explicit host choices use retargetVP. */
export function recommendedVP(players: number, ruleset: string): number {
  const parts = new Set((ruleset || "base").split("+"));
  if (parts.has("explorers")) return parts.has("cak") ? 22 : 17;
  let target = parts.has("cak") ? 13 : parts.has("raiders") ? 12 : 10;
  if (parts.has("wagons")) {
    target = parts.has("cak") ? 15 : parts.has("raiders") ? 14 : 13;
  }
  if (parts.has("caravans")) target += parts.has("islands") ? 4 : 2;
  if (parts.has("harbormaster")) target += 1;
  return Math.min(target, maxVP(ruleset, players));
}

/**
 * The VP target after a ruleset change, for the expansion switches and for
 * picking a map (which decides Islands for itself).
 *
 * A target still on the old ruleset's default was never chosen, so it follows
 * the ruleset (Caravans on: 10 to 12; off: back to 10). A target the host set is
 * kept, clamped only if the new ceiling cannot hold it (Knights off drops the
 * ceiling from 20 to 13).
 */
export function retargetVP(
  current: number | undefined,
  players: number,
  prevRuleset: string,
  nextRuleset: string,
): number {
  const prevDefault = recommendedVP(players, prevRuleset);
  const nextDefault = recommendedVP(players, nextRuleset);
  // Absent counts as untouched (an old config, or a create path that left it
  // out), so it lands on the new default.
  if ((current ?? prevDefault) === prevDefault) return nextDefault;
  return Math.min(current!, maxVP(nextRuleset, players));
}

// maxVP mirrors the backend engine.MaxVPWithoutCards ceiling: the highest winnable
// target. Base buildings + both titles = 13; Knights adds 3 metropolises + merchant.
// Backend is the source of truth; this only bounds the lobby input.
export function maxVP(ruleset: string, players: number): number {
  void players; // accepted for call-site symmetry; the ceiling is ruleset-only
  const parts = (ruleset || "base").split("+");
  // Explorers: nine buildings (a harbour settlement returns its settlement
  // piece, so five settlements and four harbour settlements stand at once),
  // nine mission spaces and three bonus tiles. Mirrors
  // engine/explorers.MaxVPWithoutCards.
  if (parts.includes("explorers")) return parts.includes("cak") ? 32 : 25;
  let max = 13;
  if (parts.includes("cak")) max += 7;
  if (parts.includes("caravans")) max += parts.includes("islands") ? 4 : 2;
  // The Harbormaster card is 2 transferable VP reachable without development
  // cards, like the two base titles. Mirrors engine/harbormaster.
  if (parts.includes("harbormaster")) max += 2;
  // Wagons: minus Longest Road (removed), plus one for reaching level 5 and
  // twelve for delivered cargo. Mirrors engine/wagons.MaxVPWithoutCards.
  if (parts.includes("wagons")) max += -2 + 1 + 12;
  return max;
}

/**
 * Recommended barbarian-fleet distance (ship advances before an attack) for a
 * player count: the standard 7 for 3-4 players, more for larger tables, where
 * each player gets fewer turns before the fleet lands. Clamped to the engine's
 * [4, 12] band.
 */
export function recommendedBarbarianDistance(players: number): number {
  const d = players >= 9 ? 12 : players >= 7 ? 11 : players >= 5 ? 9 : 7;
  return Math.max(4, Math.min(12, d));
}

/**
 * Recommended discard-at threshold (hold more than this and a rolled 7 makes
 * you discard half): the usual 7 up to 6 players, raised for 7-10 player tables
 * whose scaled banks produce larger hands. Same breakpoints as recommendedVP;
 * the engine accepts any limit >= 0.
 */
export function recommendedDiscardLimit(players: number): number {
  return players >= 9 ? 9 : players >= 7 ? 8 : 7;
}

// Hex neighbours (axial), for counting separate landmasses on a land-only board.
const HEX_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
];

// Number of connected landmasses (playable tiles joined by hex adjacency). >1
// means water genuinely separates land, so Frame will fill the gaps with sea.
function landmassCount(board: Board): number {
  const land = new Set(
    board.tiles
      .filter((t) => t.res !== "sea" && t.res !== "lake" && t.res !== "fog" && t.res !== "border")
      .map((t) => `${t.hex.q},${t.hex.r}`),
  );
  const seen = new Set<string>();
  let comps = 0;
  for (const start of land) {
    if (seen.has(start)) continue;
    comps++;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const [q, r] = stack.pop()!.split(",").map(Number);
      for (const [dq, dr] of HEX_DIRS) {
        const k = `${q + dq},${r + dr}`;
        if (land.has(k) && !seen.has(k)) {
          seen.add(k);
          stack.push(k);
        }
      }
    }
  }
  return comps;
}

/**
 * Whether a board can host the Islands expansion, which needs open sea.
 * Procedural boards (no board) always pass; the engine carves sea. A fixed board
 * passes if it has sea or gold, or if its land is in more than one landmass
 * (the Go `Frame` transform fills the channels with sea; gallery and builder
 * boards are authored as land only).
 */
export function mapSupportsIslands(board?: Board): boolean {
  if (!board) return true;
  if (board.tiles.some((t) => t.res === "sea" || t.res === "gold")) return true;
  return landmassCount(board) > 1;
}

/**
 * Whether a board is only playable with Islands: its land sits in more than one
 * piece, and without ships every piece but one is unreachable (the engine's own
 * map lint calls this out as `disconnected`). Procedural boards have no fixed
 * land, so they're never stranded. Used to steer the host to another map when
 * Islands is switched off rather than starting a game on dead land.
 */
export function mapNeedsShips(board?: Board): boolean {
  return !!board && landmassCount(board) > 1;
}

/**
 * The gallery map worth nudging the host toward, or null when the current board
 * is already a sensible pick. Islands rulesets recommend island maps, otherwise
 * Small/Medium/Large. Among those it picks the best `recommendedPlayers` fit
 * (ties favour the larger board). Themed and custom maps are exempted by the
 * caller, which only passes the current board for standard/island selections.
 */
export function recommendedMap(
  players: number,
  ruleset: string,
  current?: Board,
): GalleryMap | null {
  const islands = (ruleset || "").includes("islands");
  const kind = islands ? "islands" : "standard";
  const candidates = GALLERY.filter((m) => m.kind === kind);
  if (candidates.length === 0) return null;
  const missRange = ({ min, max }: { min: number; max: number }): number =>
    players < min ? min - players : players > max ? players - max : 0;
  const best = candidates.reduce((a, b) => {
    const ma = missRange(mapPlayers(a)),
      mb = missRange(mapPlayers(b));
    if (mb !== ma) return mb < ma ? b : a;
    return mapPlayers(b).max > mapPlayers(a).max ? b : a;
  });
  // The current board has no authored range; use the tile-count formula.
  if (
    current &&
    mapSupportsIslands(current) === islands &&
    missRange(recommendedPlayers(current)) === 0
  )
    return null;
  return best;
}

// Water and impassable foreign-land tiles don't host settlements, so they don't
// count toward how many players a map can comfortably seat.
const NON_LAND: Set<Resource> = new Set(["sea", "lake", "fog", "border"]);

/**
 * Recommended player range for a custom map, derived from its buildable
 * (non-water) tile count. Anchored on the classic board: 19 land tiles → 3–4
 * players (~5 land per seat). Clamped to the engine's 2–10 supported range.
 */
export function recommendedPlayers(board: Board): { min: number; max: number } {
  const land = board.tiles.filter((t) => !NON_LAND.has(t.res)).length;
  const clamp = (n: number) => Math.max(2, Math.min(10, n));
  const max = clamp(Math.round(land / 4.5));
  const min = clamp(Math.min(max, Math.round(land / 6.5)));
  return { min, max };
}

/**
 * How many seats the server lets this board hold: `board.MaxPlayersFor`,
 * round(land / 4.5) with a floor of 2. No board (procedural, or a scenario that
 * deals its own) means no limit. Separate from `recommendedPlayers().max`,
 * which is a label clamped to 10; this is the refusal line.
 */
export function boardSeats(board?: Board): number {
  if (!board) return Infinity;
  const land = board.tiles.filter((t) => !NON_LAND.has(t.res)).length;
  return Math.max(2, Math.round(land / 4.5));
}

/**
 * What a max-players change should send, given the map it would land on. The
 * server refuses a count the board cannot seat (board.ValidateSeats) with only a
 * generic error, so:
 *
 * - it fits: send it (`kind: "ok"`);
 * - it does not, on a standard or island gallery map: switch to the smallest
 *   map of the same kind that seats the table (`kind: "switch"`);
 * - it does not, on a themed or custom map: keep the map, stop at what it seats
 *   (`kind: "capped"`) and say why.
 */
export type PlayersChange =
  | { kind: "ok"; players: number }
  | { kind: "switch"; players: number; map: GalleryMap }
  | { kind: "capped"; players: number; seats: number };

export function playersChange(
  wanted: number,
  ruleset: string,
  board: Board | undefined,
  current: GalleryMap | undefined,
): PlayersChange {
  const seats = boardSeats(board);
  if (wanted <= seats) return { kind: "ok", players: wanted };
  if (current && current.kind !== "themed") {
    const fits = GALLERY.filter(
      (m) => m.kind === current.kind && boardSeats(m.board) >= wanted,
    ).sort((a, b) => boardSeats(a.board) - boardSeats(b.board));
    // Prefer the recommended map when it seats the table, so switch and hint
    // agree; otherwise the smallest that does.
    const rec = recommendedMap(wanted, ruleset);
    const map = rec && rec.kind === current.kind && boardSeats(rec.board) >= wanted ? rec : fits[0];
    if (map) return { kind: "switch", players: wanted, map };
  }
  return { kind: "capped", players: Math.max(MIN_PLAYERS, seats), seats };
}

/**
 * The "best with" range to advertise for a gallery map: its authored range when
 * one is set (curated presets decide their own label), otherwise the tile-count
 * formula. Use this, not recommendedPlayers, anywhere a gallery map's range is
 * shown or compared, so display and auto-recommendation agree.
 */
export function mapPlayers(map: GalleryMap): { min: number; max: number } {
  return map.players ?? recommendedPlayers(map.board);
}

/**
 * Whether the configured board suits the Islands expansion, which needs open
 * sea. Procedural boards get sea carved by the engine. Curated presets
 * (Beginner/Expanded/Grand) are solid land and the engine refuses Islands on
 * them. A custom map without sea is also refused (Islands declares
 * `RequiredTerrain = [Sea]`); the outer ring is not flooded. Returns null when
 * the board is a good Islands map.
 *
 * The message describes the map's shape rather than naming the preset id,
 * since no screen shows preset names.
 */
export function islandsMapWarning(
  cfg: GameConfig,
): { severity: "block" | "soft"; text: string } | null {
  if (!cfg.ruleset?.includes("islands")) return null;
  if (cfg.preset) {
    return {
      severity: "block",
      text: i18n._(
        msg`That map is one solid landmass with no sea, and Islands needs open water. The game won't start. Pick an Islands map such as Shores or Archipelago, or a map with water on it.`,
      ),
    };
  }
  if (cfg.board && !mapSupportsIslands(cfg.board)) {
    // A solid-land board with one landmass: `Frame` leaves it unchanged, so
    // there is no water and the engine refuses to start. Split landmasses are
    // fine; Frame fills the channels with sea.
    return {
      severity: "block",
      text: i18n._(
        msg`This custom map is one solid landmass with no sea, and Islands needs open water. The game won't start. Paint Water to split the land into islands in the map builder.`,
      ),
    };
  }
  return null;
}

/**
 * The fewest harbours an authored map may carry under Harbormaster. Mirrors
 * engine/harbormaster MinHarbours: one harbour holds one building, worth at
 * most 2 harbour points, so the card's threshold of 3 is out of reach below two.
 */
export const HARBORMASTER_MIN_HARBOURS = 2;

/**
 * Harbormaster on a map the server refuses: an authored map with some
 * harbours, but fewer than the card needs. A map with none is fine, because the
 * engine places a full set at start. The server answers the same fact with
 * HARBORMASTER_NEEDS_HARBOURS; this says it before anyone presses Start.
 */
export function harbormasterMapWarning(
  cfg: GameConfig,
): { severity: "block"; text: string } | null {
  if (!cfg.ruleset?.split("+").includes("harbormaster")) return null;
  const n = cfg.board?.harbors?.length ?? 0;
  if (n === 0 || n >= HARBORMASTER_MIN_HARBOURS) return null;
  return {
    severity: "block",
    text: i18n._(
      msg`This map has only one harbour, and Harbormaster needs at least 2 harbours for its card to be won. The game won't start. Pick another map, or turn Harbormaster off.`,
    ),
  };
}

/**
 * The seat counts a table may be configured for, low to high. The single source
 * for the picker, the lobby slider and the URL param guard. Mirrors
 * validateConfig.
 */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const PLAYER_COUNTS: number[] = Array.from(
  { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
  (_, i) => MIN_PLAYERS + i,
);

// New tables open on a standard map sized for the seat count
// (`recommendedMap`). The server refuses a board too small for the table
// (board.ValidateSeats), so Small is only the fallback.
const FALLBACK_MAP = GALLERY.find((m) => m.id === "small");

/**
 * The config a brand-new table is created with.
 *
 * `over` is applied before the derived fields, so a caller that sets its own
 * ruleset or seat count (the map builder) gets that ruleset's VP target. Pass
 * `target_vp` explicitly to override it.
 */
export function defaultConfig(over: Partial<GameConfig> = {}): GameConfig {
  const players = over.players ?? 4;
  const ruleset = over.ruleset || "base";
  return {
    discard_limit: 7,
    turn_timer_sec: 60,
    dice_mode: "random",
    board_mode: "fair",
    turn_order: "random",
    friendly_robber: false,
    // Off for a host-made table, and set explicitly so the settings panel reads
    // as answered. Ranked queues set it on (ranked.ConfigFor) and do not come
    // through here.
    memory_mode: false,
    board: (recommendedMap(players, ruleset) ?? FALLBACK_MAP)?.board,
    ...over,
    players,
    ruleset,
    // Derived from the ruleset that won, so module defaults (Caravans' 12,
    // Knights' 13) apply.
    target_vp: over.target_vp ?? recommendedVP(players, ruleset),
  };
}
