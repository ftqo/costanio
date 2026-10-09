// Geometry sanity checks for a generated board, run by the map builder's
// preview over every board it deals so a broken one is flagged.
//
// These check the shape a generator produced (is the river drawable, is the
// castle on the board, are there three trade hexes, is a chip on a barren
// tile). They are not a copy of `engine/board`'s balance lint
// (`/api/maps/lint`), and they read the ext blobs as sent rather than
// re-deriving them.
//
// They use the renderer's own code where it matters: `planRiverTiles` maps a
// river's shapes to the shipped .glb files, so the river check fails exactly
// when the board would draw a gap.
//
// Strings are English, not message descriptors: they name engine internals for
// someone filing a bug, and the copied report should read the same for
// everyone. The surrounding page is translated. No em dashes.
import { hexKey, edgeHexes, vertexHexes } from "@/lib/hexgeo";
import { DIRS } from "@/lib/board3d/coords";
import { planRiverTiles } from "@/lib/board3d/layers/rivers";
import {
  caravansExt,
  fishExt,
  raidersExt,
  riversExt,
  wagonsExt,
  type BoardTile,
  type Edge,
  type FullView,
  type Hex,
  type Resource,
} from "@/lib/types";
import { parseExpansions } from "@/lib/format";

/**
 * A check's verdict.
 *
 * `info` is a reading, not a judgement: a count worth seeing on a board that is
 * fine, kept apart from `pass` so the panel shows which lines actually matter.
 */
export type CheckStatus = "pass" | "fail" | "info";

export interface CheckResult {
  /** Stable id, for the copied report and for tests. Never shown. */
  id: string;
  /** What is being checked, as a short noun phrase. */
  label: string;
  status: CheckStatus;
  /** The counts, or what went wrong. One line. */
  detail: string;
  /** Hexes to ring red on the board. Empty unless something is wrong. */
  hexes: Hex[];
}

/** Terrains that pay nothing and so must carry no number chip. */
const NON_PRODUCING: ReadonlySet<Resource> = new Set<Resource>([
  "sea",
  "border",
  "none",
  "lake",
  "swamp",
  "fog",
  "land",
]);

/** What the renderer treats as water. Mirrors `coastline.ts`'s WATER. */
const WATER: ReadonlySet<string> = new Set(["sea", "border", "fog"]);

/** The terrains a Caravans oasis may sit on. Mirrors `layers/caravans.ts`. */
const OASIS_TERRAIN: ReadonlySet<string> = new Set(["none", "lake"]);

function neighbours(h: Hex): Hex[] {
  return DIRS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

function tileMap(tiles: readonly BoardTile[]): Map<string, BoardTile> {
  return new Map(tiles.map((t) => [hexKey(t.hex), t]));
}

function pass(id: string, label: string, detail: string): CheckResult {
  return { id, label, status: "pass", detail, hexes: [] };
}
function fail(id: string, label: string, detail: string, hexes: Hex[] = []): CheckResult {
  return { id, label, status: "fail", detail, hexes };
}
function info(id: string, label: string, detail: string): CheckResult {
  return { id, label, status: "info", detail, hexes: [] };
}

/** Dedupe a hex list, keeping first-seen order, so a ring is never drawn twice. */
function uniqueHexes(hexes: readonly Hex[]): Hex[] {
  const seen = new Set<string>();
  const out: Hex[] = [];
  for (const h of hexes) {
    const k = hexKey(h);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}

// ---------------------------------------------------------------- base board

/**
 * A chip on a tile that pays nothing. Rivers repaints a hex to swamp and
 * Fishermen floods the desert to a lake after numbers are dealt, so this can
 * happen.
 */
function checkChipsOnProducingTiles(tiles: readonly BoardTile[]): CheckResult {
  const bad = tiles.filter((t) => t.num > 0 && NON_PRODUCING.has(t.res));
  const numbered = tiles.filter((t) => t.num > 0).length;
  if (bad.length) {
    return fail(
      "chips-on-producing",
      "Chips only on producing tiles",
      `${bad.length} chip(s) on a tile that pays nothing: ${bad.map((t) => `${t.res} ${t.num} at ${hexKey(t.hex)}`).join(", ")}`,
      bad.map((t) => t.hex),
    );
  }
  return pass(
    "chips-on-producing",
    "Chips only on producing tiles",
    `${numbered} numbered tiles, none of them barren`,
  );
}

/**
 * The 6/8 rule. Fair and random modes both promise it, so a violation is a
 * generator bug either way.
 */
function checkRedsApart(tiles: readonly BoardTile[]): CheckResult {
  const byKey = tileMap(tiles);
  const red = (t: BoardTile | undefined) => !!t && (t.num === 6 || t.num === 8);
  const offenders: Hex[] = [];
  for (const t of tiles) {
    if (!red(t)) continue;
    for (const n of neighbours(t.hex)) {
      if (red(byKey.get(hexKey(n)))) {
        offenders.push(t.hex, n);
      }
    }
  }
  const reds = tiles.filter(red).length;
  if (offenders.length) {
    const hexes = uniqueHexes(offenders);
    return fail(
      "reds-apart",
      "No 6 or 8 touching another",
      `${hexes.length} hexes in touching red pairs`,
      hexes,
    );
  }
  return pass("reds-apart", "No 6 or 8 touching another", `${reds} red chips, all apart`);
}

/**
 * The number bag, as a reading plus two hard rules: no 7, and no number dealt
 * more often than a bag of this size holds it.
 *
 * The total varies (18 on a plain four-player board, 17 once Rivers paints a
 * swamp over a numbered hex), so it is not checked. The per-value cap scales
 * too: `numberTokens` (engine/board/generate.go) deals `n * share / 18` per
 * value with leftovers by largest remainder, so a 27-token board (Shores) has
 * three 3s.
 *
 * Largest remainder gives each value the floor of its share or one more, and
 * only if there is a leftover, so that is the bound: exactly the base bag on an
 * 18-token board, one wider elsewhere. A bound, not a reimplementation.
 */
/** The base bag's ratio out of 18; mirrors `tokenShare` in engine/board/generate.go. */
const TOKEN_SHARE: Record<number, number> = {
  2: 1,
  3: 2,
  4: 2,
  5: 2,
  6: 2,
  8: 2,
  9: 2,
  10: 2,
  11: 2,
  12: 1,
};

/**
 * The most times a bag of `n` tokens can hold `num`.
 *
 * `floor(n * share / 18)`, plus one only when the scaled counts leave a
 * remainder for largest-remainder to hand out.
 */
export function bagCap(num: number, n: number): number {
  const share = TOKEN_SHARE[num];
  if (share === undefined) return 0; // a 7, or not a valid number
  const floors = Object.values(TOKEN_SHARE).reduce((sum, sh) => sum + Math.floor((n * sh) / 18), 0);
  return Math.floor((n * share) / 18) + (n > floors ? 1 : 0);
}
function checkNumberSpread(tiles: readonly BoardTile[]): CheckResult {
  const count = new Map<number, number>();
  for (const t of tiles) {
    if (t.num > 0) count.set(t.num, (count.get(t.num) ?? 0) + 1);
  }
  // The bag is sized by how many tokens this board actually carries.
  const dealt = tiles.filter((t) => t.num > 0).length;
  const cap = (num: number) => bagCap(num, dealt);
  const bad: string[] = [];
  const hexes: Hex[] = [];
  for (const [num, n] of [...count].sort((a, b) => a[0] - b[0])) {
    if (num === 7) {
      bad.push("a 7 was dealt");
      hexes.push(...tiles.filter((t) => t.num === 7).map((t) => t.hex));
      continue;
    }
    if (n > cap(num)) {
      bad.push(`${num} appears ${n} times (the bag holds ${cap(num)})`);
      hexes.push(...tiles.filter((t) => t.num === num).map((t) => t.hex));
    }
  }
  const spread = [...count]
    .sort((a, b) => a[0] - b[0])
    .map(([num, n]) => `${num}x${n}`)
    .join(" ");
  if (bad.length) {
    return fail("number-spread", "Number distribution", bad.join("; "), uniqueHexes(hexes));
  }
  return info("number-spread", "Number distribution", spread);
}

/**
 * Harbours. A harbour whose two dock corners share no water hex has nowhere to
 * draw its ship (`planPorts` skips it), and two harbours on the same sea hex
 * draw on top of each other.
 */
function checkHarbours(view: FullView): CheckResult {
  const tiles = view.board?.tiles ?? [];
  const harbours = view.board?.harbors ?? [];
  const byKey = tileMap(tiles);
  const isWater = (h: Hex) => WATER.has(byKey.get(hexKey(h))?.res ?? "sea");

  const bad: string[] = [];
  const hexes: Hex[] = [];
  const seaSeen = new Map<string, number>();
  for (const hb of harbours) {
    const [a, b] = hb.verts;
    if (!a || !b) {
      bad.push("a harbour with fewer than two dock corners");
      continue;
    }
    const shared = vertexHexes(a).filter((h) =>
      vertexHexes(b).some((g) => hexKey(g) === hexKey(h)),
    );
    const sea = shared.filter(isWater);
    if (sea.length === 0) {
      bad.push(`a ${hb.ratio}:1 harbour with no sea hex behind it`);
      hexes.push(...shared);
      continue;
    }
    const k = hexKey(sea[0]);
    seaSeen.set(k, (seaSeen.get(k) ?? 0) + 1);
    if ((seaSeen.get(k) ?? 0) > 1) {
      bad.push(`two harbours on the sea hex ${k}`);
      hexes.push(sea[0]);
    }
  }
  if (bad.length) {
    return fail(
      "harbours",
      "Harbours",
      `${harbours.length} harbours, ${bad.length} bad: ${bad.join("; ")}`,
      uniqueHexes(hexes),
    );
  }
  return pass("harbours", "Harbours", `${harbours.length}, each on its own sea hex`);
}

// -------------------------------------------------------------------- rivers

/**
 * Every river hex draws a real tile, which also means its chip is clear of the
 * water.
 *
 * `planRiverTiles` skips a hex it cannot resolve (an unknown shape, a
 * headwater off the mountains, a file missing from the manifest), leaving a gap
 * in the river; comparing plans to hexes catches that.
 *
 * Every shipped river tile keeps the chip circle dry
 * (`board3d/riverArt.test.ts`, `engine/rivers/chip_test.go`) and river tiles
 * are never rotated, so only an unresolved hex can put a number over water.
 */
function checkRiverTilesDraw(view: FullView): CheckResult {
  const rivers = riversExt(view)?.rivers ?? [];
  const hexes = rivers.flatMap((r) => r.hexes ?? []);
  const drawn = new Set(planRiverTiles(view).map((p) => hexKey(p.hex)));
  const missing = hexes.filter((h) => !drawn.has(hexKey(h)));
  if (missing.length) {
    return fail(
      "river-tiles",
      "Chips clear of river water",
      `${missing.length} of ${hexes.length} river hexes draw no channel, so their chip sits on plain terrain where water should be`,
      uniqueHexes(missing),
    );
  }
  return pass(
    "river-tiles",
    "Chips clear of river water",
    `${hexes.length} river hexes, every one on a shipped channel tile`,
  );
}

/** Rivers: how many, and how long each chain is. Fails on a chain under two
 *  hexes (no seam, so no bridge site), a mouth that is not the last hex, or a
 *  shape count that does not match. */
function checkRiverChains(view: FullView): CheckResult {
  const rivers = riversExt(view)?.rivers ?? [];
  const bad: string[] = [];
  const hexes: Hex[] = [];
  rivers.forEach((r, i) => {
    const n = (r.hexes ?? []).length;
    if (n < 2) {
      bad.push(`river ${i} is ${n} hex(es) long`);
      hexes.push(...(r.hexes ?? []));
    }
    if (r.mouth !== n - 1) {
      bad.push(`river ${i}'s mouth is at index ${r.mouth} of ${n}`);
      hexes.push(...(r.hexes ?? []));
    }
    if ((r.shapes ?? []).length !== n) {
      bad.push(`river ${i} has ${(r.shapes ?? []).length} shapes for ${n} hexes`);
      hexes.push(...(r.hexes ?? []));
    }
  });
  const lengths = rivers.map((r) => (r.hexes ?? []).length).join(", ");
  if (bad.length) {
    return fail("river-chains", "River chains", bad.join("; "), uniqueHexes(hexes));
  }
  return pass(
    "river-chains",
    "River chains",
    `${rivers.length} rivers, lengths ${lengths || "none"}`,
  );
}

/**
 * No two different rivers run alongside each other: they would read as one wide
 * river with an island, and the bridge sites between belong to neither. A river
 * touching itself is fine.
 */
function checkRiversApart(view: FullView): CheckResult {
  const rivers = riversExt(view)?.rivers ?? [];
  const owner = new Map<string, number>();
  rivers.forEach((r, i) => {
    for (const h of r.hexes ?? []) owner.set(hexKey(h), i);
  });
  const offenders: Hex[] = [];
  rivers.forEach((r, i) => {
    for (const h of r.hexes ?? []) {
      for (const n of neighbours(h)) {
        const other = owner.get(hexKey(n));
        if (other !== undefined && other !== i) offenders.push(h, n);
      }
    }
  });
  if (offenders.length) {
    const hexes = uniqueHexes(offenders);
    return fail(
      "rivers-apart",
      "No two rivers adjacent",
      `${hexes.length} hexes where two different rivers touch`,
      hexes,
    );
  }
  return pass("rivers-apart", "No two rivers adjacent", `${rivers.length} rivers, none touching`);
}

/**
 * Bridge sites. Each must have a river hex on at least one side, or the player
 * is told to bridge something that is not there.
 */
function checkBridgeSites(view: FullView): CheckResult {
  const ext = riversExt(view);
  const sites: Edge[] = ext?.sites ?? [];
  const riverHexes = new Set(
    (ext?.rivers ?? []).flatMap((r) => (r.hexes ?? []).map((h) => hexKey(h))),
  );
  const orphans = sites.filter((e) => !edgeHexes(e).some((h) => riverHexes.has(hexKey(h))));
  if (sites.length === 0) {
    return fail("bridge-sites", "Bridge sites", "the board has rivers and no bridge sites at all");
  }
  if (orphans.length) {
    return fail(
      "bridge-sites",
      "Bridge sites",
      `${orphans.length} of ${sites.length} bridge sites have no river hex on either side`,
      uniqueHexes(orphans.flatMap((e) => edgeHexes(e))),
    );
  }
  return pass("bridge-sites", "Bridge sites", `${sites.length}, every one against a river hex`);
}

// -------------------------------------------------------- the other scenarios

/** Raiders: the castle and the coast list the landings sweep. Without either
 *  the game cannot start. */
function checkCastle(view: FullView): CheckResult {
  const ext = raidersExt(view);
  const castle = ext?.castle;
  const tiles = view.board?.tiles ?? [];
  if (!castle) {
    return fail("castle", "Castle", "no castle on the board");
  }
  const on = tiles.some((t) => hexKey(t.hex) === hexKey(castle));
  const paths = ext?.castle_paths ?? [];
  const coast = ext?.coast ?? [];
  const bad: string[] = [];
  if (!on) bad.push(`the castle is at ${hexKey(castle)}, which is not a tile on this board`);
  if (paths.length !== 6) bad.push(`the castle has ${paths.length} paths out of it, not 6`);
  if (coast.length === 0) bad.push("the coast list is empty, so nothing can land");
  if (bad.length) {
    return fail("castle", "Castle", bad.join("; "), [castle]);
  }
  return pass("castle", "Castle", `at ${hexKey(castle)}, 6 paths, ${coast.length} coastal hexes`);
}

/** Wagons: three trade hexes on three distinct producing tiles, each with its
 *  own plaza and a distinct role. */
function checkTradeHexes(view: FullView): CheckResult {
  const trade = wagonsExt(view)?.trade ?? [];
  const byKey = tileMap(view.board?.tiles ?? []);
  const bad: string[] = [];
  const hexes: Hex[] = [];
  if (trade.length !== 3) bad.push(`${trade.length} trade hexes, not 3`);
  const seen = new Set<string>();
  const roles = new Set<number>();
  for (const t of trade) {
    const k = hexKey(t.hex);
    if (seen.has(k)) {
      bad.push(`two trade hexes on ${k}`);
      hexes.push(t.hex);
    }
    seen.add(k);
    roles.add(t.role);
    const tile = byKey.get(k);
    if (!tile) {
      bad.push(`a trade hex at ${k} is not a tile on this board`);
      hexes.push(t.hex);
    } else if (WATER.has(tile.res)) {
      bad.push(`a trade hex sits on ${tile.res} at ${k}`);
      hexes.push(t.hex);
    }
    if (hexKey({ q: t.plaza.q, r: t.plaza.r }) !== k) {
      bad.push(`the plaza of the trade hex at ${k} belongs to ${t.plaza.q},${t.plaza.r}`);
      hexes.push(t.hex);
    }
  }
  if (trade.length === 3 && roles.size !== 3) {
    bad.push(`the three trade hexes carry ${roles.size} distinct roles`);
    hexes.push(...trade.map((t) => t.hex));
  }
  if (bad.length) {
    return fail("trade-hexes", "Trade hexes", bad.join("; "), uniqueHexes(hexes));
  }
  return pass(
    "trade-hexes",
    "Trade hexes",
    `3, at ${trade.map((t) => hexKey(t.hex)).join(" ")}, one of each role`,
  );
}

/** Caravans: the oasis and its spokes. An oasis on a terrain the layer cannot
 *  draw shows as plain desert. */
function checkOasis(view: FullView): CheckResult {
  const ext = caravansExt(view);
  const first = ext?.oasis;
  if (!first) return fail("oasis", "Oasis", "no oasis on the board");
  // Every oasis: two at 5 and 6 seats, three at 7 to 10 (derivation 13).
  const oases = ext?.oases ?? [first];
  const byKey = tileMap(view.board?.tiles ?? []);
  const spokes = ext?.caravans ?? [];
  const bad: string[] = [];
  for (const [i, oasis] of oases.entries()) {
    const tile = byKey.get(hexKey(oasis));
    if (!tile) bad.push(`the oasis is at ${hexKey(oasis)}, which is not a tile on this board`);
    else if (!OASIS_TERRAIN.has(tile.res))
      bad.push(`the oasis sits on ${tile.res}, which the renderer will draw as plain terrain`);
    if (!spokes.some((s) => Math.floor(s.caravan / 3) === i))
      bad.push(`the oasis at ${hexKey(oasis)} has no caravan spokes leaving it`);
  }
  if (bad.length) return fail("oasis", "Oasis", bad.join("; "), oases);
  const where = oases.map((o) => `${hexKey(o)} on ${byKey.get(hexKey(o))?.res}`).join(", ");
  return pass("oasis", "Oasis", `${oases.length} at ${where}, ${spokes.length} spokes`);
}

/** Fishermen: the flooded desert and the coastal grounds. Each ground must name
 *  a water hex, where its chip is drawn. */
function checkLakeAndGrounds(view: FullView): CheckResult {
  const tiles = view.board?.tiles ?? [];
  const ext = fishExt(view);
  const lakes = tiles.filter((t) => t.res === "lake");
  const grounds = ext?.grounds ?? [];
  const byKey = tileMap(tiles);
  const bad: string[] = [];
  const hexes: Hex[] = [];
  if (lakes.length === 0) bad.push("no lake on the board");
  if (grounds.length === 0) bad.push("no fishing grounds on the board");
  for (const g of grounds) {
    if (!g.hex) {
      bad.push("a fishing ground names no hex");
      continue;
    }
    const tile = byKey.get(hexKey(g.hex));
    if (tile && !WATER.has(tile.res)) {
      bad.push(`a fishing ground at ${hexKey(g.hex)} is notched into ${tile.res}, not water`);
      hexes.push(g.hex);
    }
    if ((g.v ?? []).length < 2) {
      bad.push(`a fishing ground at ${hexKey(g.hex)} feeds ${(g.v ?? []).length} corner(s)`);
      hexes.push(g.hex);
    }
  }
  if (bad.length)
    return fail("lake-grounds", "Lake and fishing grounds", bad.join("; "), uniqueHexes(hexes));
  return pass(
    "lake-grounds",
    "Lake and fishing grounds",
    `${lakes.length} lake, ${grounds.length} grounds, ${
      ext?.lakes
        ? ext.lakes.map((l) => l.numbers.join("/")).join(" and ")
        : (ext?.lake_numbers ?? []).join("/")
    } on the lake`,
  );
}

/**
 * Every check that applies to this board, in panel order: the base board, then
 * one block per enabled module. A disabled module adds nothing, not a passing
 * row.
 */
export function runChecks(view: FullView): CheckResult[] {
  const tiles = view.board?.tiles ?? [];
  const exp = parseExpansions(view.config?.ruleset ?? "base");
  const out: CheckResult[] = [
    checkChipsOnProducingTiles(tiles),
    checkRedsApart(tiles),
    checkNumberSpread(tiles),
    checkHarbours(view),
  ];
  if (exp.rivers) {
    out.push(
      checkRiverTilesDraw(view),
      checkRiverChains(view),
      checkRiversApart(view),
      checkBridgeSites(view),
    );
  }
  if (exp.raiders) out.push(checkCastle(view));
  if (exp.wagons) out.push(checkTradeHexes(view));
  if (exp.caravans) out.push(checkOasis(view));
  if (exp.fishermen) out.push(checkLakeAndGrounds(view));
  return out;
}

/** Every hex any failing check pointed at, deduped, for the board's red rings. */
export function failingHexes(results: readonly CheckResult[]): Hex[] {
  return uniqueHexes(results.filter((r) => r.status === "fail").flatMap((r) => r.hexes));
}

/** The clipboard payload behind the Report button: ruleset, seed and only the
 *  failures. */
export function reportJSON(ruleset: string, seed: string, results: readonly CheckResult[]): string {
  return JSON.stringify(
    {
      ruleset,
      seed,
      failures: results
        .filter((r) => r.status === "fail")
        .map((r) => ({ id: r.id, detail: r.detail, hexes: r.hexes })),
    },
    null,
    2,
  );
}
