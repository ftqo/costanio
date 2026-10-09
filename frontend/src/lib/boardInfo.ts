// What is standing on a board spot, in words.
//
// The counterpart to lib/locationActions, which answers "what can I do here".
// That is private, your-turn and gated on `view.legal`; this is public, always
// available, and as useful to a spectator as to the owner.
//
// Everything here is public by the rules and already in every viewer's view,
// so this is formatting only, with no redaction decision.
//
// Occupied spots only: an empty buildable spot is shown by the ghost piece
// under the pointer, and "empty" cards everywhere would bury the useful ones.
//
// Roads and ships are not described. A road has no rank or state, so a card
// would fire constantly and say nothing. The useful fact (the length of its
// route) is not in the view, and only the engine knows where a route breaks
// (enemy buildings, Islands road/ship chains); that needs a number from the
// engine, not a client-side walk.
import {
  knightsExt,
  fishExt,
  islandsExt,
  raidersExt,
  wagonsExt,
  explorersExt,
  EXPLORERS_KIND,
  type ExplorersHex,
  type FullView,
  type Harbor,
  type Hex,
  type Vertex,
} from "./types";
import { hexKey, vertexKey } from "./hexgeo";
import { gameCaps } from "./caps";
import { robberOnBoard } from "./robber";
import { lakeNumbers } from "./fish";
import { formatList, formatNumber } from "./intl";
import { msg, t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";

/**
 * The metropolis title, one message per track, in the order the ext arrays use.
 *
 * Descriptors, not strings, since a module constant is evaluated once at import
 * and would freeze the language. Whole titles rather than "{metro} Metropolis":
 * German closes the compound, Romance languages invert it with a preposition,
 * and Russian and Polish need an agreeing adjective.
 */
const METRO_TITLES: MessageDescriptor[] = [
  msg({ id: "board.metropolis.trade", message: "Trade Metropolis" }),
  msg({ id: "board.metropolis.politics", message: "Politics Metropolis" }),
  msg({ id: "board.metropolis.science", message: "Science Metropolis" }),
];

/**
 * Display name per resource id, for the port lines ("2:1 wood"). Lower case,
 * as a standalone label rather than a mid-sentence word.
 */
const RES_NAMES: Record<string, MessageDescriptor> = {
  wood: msg({ message: "wood", context: "resource, standalone label" }),
  brick: msg({ message: "brick", context: "resource, standalone label" }),
  sheep: msg({ message: "sheep", context: "resource, standalone label" }),
  wheat: msg({ message: "wheat", context: "resource, standalone label" }),
  ore: msg({ message: "ore", context: "resource, standalone label" }),
};

/**
 * One hovered thing, described.
 *
 * `owner` is a seat, not a name or colour: the card resolves how a seat is
 * drawn (which changes under colourblind mode).
 *
 * `facts` is a list because one spot can be several things (a walled
 * metropolis on a 2:1 port), and that is one place the player is pointing at.
 */
export interface PieceInfo {
  /** What it fundamentally is: "City", "Knight", "Port", "Robber". */
  title: string;
  /** Seat that owns it, or undefined for the neutral pieces and bare ports. */
  owner?: number;
  /** Everything else worth saying, already phrased. */
  facts: string[];
}

/**
 * A described spot, positioned for the picker. Geometry mirrors PickTarget.
 * No edge kind: roads and ships are not described (see `planInfoTargets`).
 */
export interface InfoTarget {
  kind: "vertex" | "hex";
  /** Stable identity, so a hover that has not moved to a new thing is a no-op. */
  key: string;
  v?: Vertex;
  h?: Hex;
  info: PieceInfo;
}

/** "Trades 2:1 wheat with the bank": the fact a port states, as one message. */
function tradesLine(h: Harbor): string {
  const rate = portLabel(h);
  return t`Trades ${rate} with the bank`;
}

/**
 * A hex named the way a player names it: its terrain and its number ("ore 6").
 * For choices between hexes offered as buttons, where axial coordinates mean
 * nothing to a player.
 */
export function hexLabel(tile: { res: string; num?: number } | undefined): string {
  // The desert has no RES_NAMES entry. The Wagons quarry is often the old
  // desert, so it needs a real name.
  if (tile && (tile.res === "none" || tile.res === "desert"))
    return t({ message: "desert", context: "a hex named by its terrain: the desert" });
  // Fishermen's lake takes the desert's place, and a Wagons trade hex can sit
  // on it; an Islands gold field has no RES_NAMES entry either.
  if (tile?.res === "lake")
    return t({ message: "lake", context: "a hex named by its terrain: the Fishermen lake" });
  if (tile?.res === "gold")
    return t({ message: "gold field", context: "a hex named by its terrain: a gold field" });
  const d = tile ? RES_NAMES[tile.res] : undefined;
  if (!tile || !d) return t({ message: "this hex", context: "a hex with no terrain name" });
  const resource = i18n._(d);
  const num = tile.num ?? 0;
  return num > 0
    ? t({ message: `${resource} ${num}`, context: "a hex named by its terrain and number chip" })
    : resource;
}

export function portLabel(h: Harbor): string {
  const d = RES_NAMES[h.res];
  const ratio = h.ratio;
  if (!d) return t`${ratio}:1 any`;
  const resource = i18n._(d);
  return t`${ratio}:1 ${resource}`;
}

/**
 * The vertices carrying a port, and which port each carries. A harbour is
 * stored as the vertex pair its dock serves; this inverts it for hovering.
 */
function harborsByVertex(view: FullView): Map<string, Harbor> {
  const out = new Map<string, Harbor>();
  for (const h of view.board.harbors ?? []) {
    for (const v of h.verts) out.set(vertexKey(v), h);
  }
  return out;
}

/**
 * Which seat currently holds the merchant, or undefined. The ext gives only
 * the hex; `merchant_vp` is the per-player flag, held by at most one seat.
 */
function merchantOwner(view: FullView): number | undefined {
  const knightsState = knightsExt(view);
  const i = (knightsState?.players ?? []).findIndex((p) => (p?.merchant_vp ?? 0) > 0);
  return i >= 0 ? i : undefined;
}

/** Vertex facts: buildings, metropolises, walls, knights, and the port beneath. */
function vertexTargets(view: FullView): InfoTarget[] {
  const knightsState = knightsExt(view);
  const ports = harborsByVertex(view);
  const harbormaster = gameCaps(view).hasHarbormaster;
  const walled = new Set((knightsState?.walled ?? []).map(vertexKey));

  // Metropolis is stored per player per track; invert it once.
  const metros = new Map<string, MessageDescriptor>();
  (knightsState?.players ?? []).forEach((p) => {
    p?.metropolis?.forEach((has, t) => {
      const at = p.metropolis_at?.[t];
      const title = METRO_TITLES[t];
      if (has && at && title) metros.set(vertexKey(at), title);
    });
  });

  const out: InfoTarget[] = [];
  const claimed = new Set<string>();

  for (const b of view.buildings) {
    const k = vertexKey(b.v);
    claimed.add(k);
    const metro = metros.get(k);
    const facts: string[] = [];
    // A metropolis renames the city rather than being listed under it. It is
    // worth the city's 2 plus its own 2 (docs/rules/knights.md).
    if (metro) facts.push(t`Worth 4 victory points`);
    else facts.push(b.city ? t`Worth 2 victory points` : t`Worth 1 victory point`);
    if (walled.has(k)) facts.push(t`Walled: holds 2 extra cards on a 7`);
    const port = ports.get(k);
    if (port) facts.push(tradesLine(port));
    // A harbour building also counts in the Harbormaster race, worth its own
    // VP value per the spec.
    if (port && harbormaster) {
      facts.push(
        b.city
          ? t`Worth 2 harbour points toward the Harbormaster`
          : t`Worth 1 harbour point toward the Harbormaster`,
      );
    }
    out.push({
      kind: "vertex",
      key: `v:${k}`,
      v: b.v,
      info: {
        title: metro
          ? i18n._(metro)
          : b.city
            ? t({ message: "City", context: "board piece" })
            : t({ message: "Settlement", context: "board piece" }),
        owner: b.owner,
        facts,
      },
    });
  }

  for (const kn of knightsState?.knights ?? []) {
    const k = vertexKey(kn.v);
    claimed.add(k);
    // State what the tier means (its strength, what it adds to barbarian
    // defence, which knights it can displace) rather than its label.
    const level = kn.level;
    const facts = [t`Strength ${level} of 3`];
    facts.push(
      kn.active
        ? t`Active: adds ${level} to the barbarian defense`
        : t`Inactive: adds nothing to the defense and cannot act (activate for 1 wheat)`,
    );
    const below = level - 1;
    facts.push(
      level > 1
        ? t`Can displace enemy knights of strength ${below} or less`
        : t`Too weak to displace any enemy knight`,
    );
    if (kn.active && kn.freshly_activated) facts.push(t`Activated this turn: cannot move yet`);
    const port = ports.get(k);
    if (port) {
      const rate = portLabel(port);
      facts.push(t`Stands on a ${rate} harbour`);
    }
    out.push({
      kind: "vertex",
      key: `v:${k}`,
      v: kn.v,
      info: { title: t({ message: "Knight", context: "board piece" }), owner: kn.owner, facts },
    });
  }

  // Ports with nothing built on them: "what does that dock give me" is asked
  // before building there.
  for (const [k, h] of ports) {
    if (claimed.has(k)) continue;
    const v = (h.verts ?? []).find((x) => vertexKey(x) === k);
    if (!v) continue;
    out.push({
      kind: "vertex",
      key: `v:${k}`,
      v,
      info: {
        title: t({ message: "Harbour", context: "board piece" }),
        facts: harbormaster
          ? [
              tradesLine(h),
              t`Build here to claim it`,
              t`Harbour points toward the Harbormaster: 1 for a settlement here, 2 for a city`,
            ]
          : [tradesLine(h), t`Build here to claim it`],
      },
    });
  }

  return out;
}

/**
 * The fishing grounds (up to six), each with its own number.
 *
 * The number comes off the wire (`grounds[].number`): a cramped coastline
 * yields fewer grounds, dropping the highest first, so no constant fits every
 * board. An older server that sends no grounds leaves them undescribed, and a
 * ground with no `hex` is skipped, as the board draws nothing for it.
 */
function groundTargets(view: FullView): InfoTarget[] {
  if (!gameCaps(view).hasFish) return [];
  return (fishExt(view)?.grounds ?? [])
    .filter((g) => g.hex !== undefined)
    .map((g) => ({
      kind: "hex" as const,
      key: `h:${hexKey(g.hex!)}`,
      h: g.hex!,
      info: {
        title: t({ message: "Fishing ground", context: "board piece" }),
        facts: [
          t`Pays fish on ${formatNumber(g.number)}`,
          // Tiles, not fish: a tile is worth 1 to 3 fish (the distinction
          // FishSpendPanel also makes).
          t`Each neighbouring settlement draws 1 fish tile, each city 2`,
        ],
      },
    }));
}

/**
 * The lakes, and what they pay on.
 *
 * A lake pays on two or four numbers and `BoardTile.num` holds one, so the
 * numbers travel in `ext.fishermen`. The board shows them on a chip
 * (`planLakeChips`); the card also says what a lake pays.
 *
 * Since derivation 13 a table of five or more has a second lake paying on 4
 * and 10 only, so each lake's set is read from `lakes`, falling back to
 * `lake_numbers` for older games where every lake paid on four.
 *
 * Numbers come off the wire, never a constant, so they cannot drift from the
 * engine's `scenarios.LakeNumbers`. No numbers, no card.
 */
function lakeTargets(view: FullView): InfoTarget[] {
  if (!gameCaps(view).hasFish) return [];
  return lakeNumbers(view).map(({ hex, numbers }) => {
    const rolls = formatList(numbers.map((n) => formatNumber(n)));
    return {
      kind: "hex" as const,
      key: `h:${hexKey(hex)}`,
      h: hex,
      info: {
        title: t({ message: "Lake", context: "board piece" }),
        facts: [
          t`Pays fish on ${rolls}`,
          // Tiles, not fish: a tile is worth 1 to 3 fish (the distinction
          // FishSpendPanel also makes).
          t`Each neighbouring settlement draws 1 fish tile, each city 2`,
        ],
      },
    };
  });
}

/**
 * The three Wagons trade hexes, named. There is no trade-hex tile yet, so the
 * board does not show which is the castle, quarry or glassworks, or what each
 * takes. Whole sentences per role, since the set is closed at three and
 * translators need each one.
 */
function tradeHexTargets(view: FullView): InfoTarget[] {
  const w = wagonsExt(view);
  if (!w?.has_trade) return [];
  const byRole: Record<number, () => PieceInfo> = {
    0: () => ({
      title: t({ message: "Castle", context: "Wagons trade hex" }),
      facts: [t`Takes marble and glass`, t`Loads tools or sand`],
    }),
    1: () => ({
      title: t({ message: "Quarry", context: "Wagons trade hex" }),
      facts: [t`Takes tools`, t`Loads marble or sand`],
    }),
    2: () => ({
      title: t({ message: "Glassworks", context: "Wagons trade hex" }),
      facts: [t`Takes sand`, t`Loads glass or tools`],
    }),
  };
  return (w.trade ?? []).flatMap((tr) => {
    const make = byRole[tr.role];
    if (!make) return [];
    const info = make();
    info.facts.push(
      t`Wagons stop at the plaza in the middle to deliver and to load`,
      t`A delivered load is worth 1 victory point`,
    );
    return [{ kind: "hex" as const, key: `h:${hexKey(tr.hex)}`, h: tr.hex, info }];
  });
}

/**
 * Raiders on the coast, and the castle. The figures are small and neutral, and
 * three of them decide whether a hex pays, so the count is stated in words.
 */
function raidersHexTargets(view: FullView): InfoTarget[] {
  const x = raidersExt(view);
  if (!x) return [];
  const out: InfoTarget[] = [];
  const coast = x.coast ?? [];
  const counts = x.raider_count ?? [];
  coast.forEach((h, i) => {
    const n = counts[i] ?? 0;
    if (n <= 0) return;
    out.push({
      kind: "hex",
      key: `h:${hexKey(h)}`,
      h,
      info: {
        title: t({ message: "Raiders", context: "board piece: raiders on a coastal hex" }),
        facts:
          n >= 3
            ? [
                t`Conquered: this hex produces nothing`,
                t`No new road or settlement may touch it`,
                t`Outnumber the raiders with riders on its paths to win it back`,
              ]
            : [
                n === 1
                  ? t`1 raider here. Three conquer the hex`
                  : t`${n} raiders here. Three conquer the hex`,
                t`Outnumber them with riders on its paths to take them prisoner`,
              ],
      },
    });
  });
  if (x.castle) {
    out.push({
      kind: "hex",
      key: `h:${hexKey(x.castle)}`,
      h: x.castle,
      info: {
        title: t({ message: "Castle", context: "Raiders castle hex" }),
        facts: [
          t`Produces nothing`,
          t`A Muster puts a rider on one of its six paths`,
          t`A rider may not end its move beside it`,
        ],
      },
    });
  }
  return out;
}

/**
 * Explorers: the Council, the lairs and the spice farms, and the fog.
 *
 * The Council tile has two quays ending in anchors; the card says what they
 * are for. A lair gives its crew count against the three that take it; a
 * spice farm says how many seats have landed their one crew. Fog is described
 * per hex so a player learns how it lifts.
 */
function explorersHexTargets(view: FullView): InfoTarget[] {
  const x = explorersExt(view);
  if (!x) return [];
  const out: InfoTarget[] = [];
  if (x.council) {
    out.push({
      kind: "hex",
      key: `h:${hexKey(x.council)}`,
      h: x.council,
      info: {
        title: t({ message: "The Council", context: "Explorers board feature" }),
        facts: [
          t`Deliver fish and spices here, from a ship at either anchor (the two intersections flanking its seaward side)`,
          t`Each delivery moves you along that mission's track`,
        ],
      },
    });
  }
  for (const r of x.revealed ?? []) {
    if (r.kind === EXPLORERS_KIND.gold) {
      out.push({ kind: "hex", key: `h:${hexKey(r.h)}`, h: r.h, info: lairInfo(r) });
    } else if (r.kind === EXPLORERS_KIND.spice) {
      out.push({ kind: "hex", key: `h:${hexKey(r.h)}`, h: r.h, info: farmInfo(r) });
    }
  }
  for (const h of x.fog ?? []) {
    out.push({
      kind: "hex",
      key: `h:${hexKey(h)}`,
      h,
      info: {
        title: t({ message: "Unexplored", context: "Explorers face-down hex" }),
        facts: [
          t`A ship that ends a step at one of its intersections reveals it`,
          t`Revealing stops that ship for the turn`,
        ],
      },
    });
  }
  return out;
}

/** Crews standing on one hex, summed over the seats. */
function crewTotal(crews: readonly number[] | undefined): number {
  return (crews ?? []).reduce((a, n) => a + Math.max(0, n), 0);
}

/** A gold field: its lair and the crews storming it, or what it pays once taken. */
function lairInfo(r: ExplorersHex): PieceInfo {
  const n = crewTotal(r.crews);
  if (r.captured) {
    return {
      title: t({ message: "Gold field", context: "Explorers: a gold field whose lair has fallen" }),
      facts: [
        t`Captured: pays 2 gold per adjacent building when its number is rolled`,
        ...(n === 0 ? [] : [n === 1 ? t`1 crew still here` : t`${n} crews still here`]),
      ],
    };
  }
  return {
    title: t({ message: "Pirate lair", context: "Explorers board feature on a gold field" }),
    facts: [
      n === 0
        ? t`No crews here yet. 3 crews capture it`
        : n === 1
          ? t`1 crew here. 3 crews capture it`
          : t`${n} crews here. 3 crews capture it`,
      t`Produces nothing until captured`,
    ],
  };
}

/** A spice farm: how many seats have landed their one crew. */
function farmInfo(r: ExplorersHex): PieceInfo {
  const n = (r.farmers ?? []).filter(Boolean).length;
  return {
    title: t({ message: "Spice farm", context: "Explorers board feature" }),
    facts: [
      n === 0
        ? t`No crew has landed here yet`
        : n === 1
          ? t`1 player has landed a crew here`
          : t`${n} players have landed a crew here`,
      t`Land one crew to take a spice sack and open its paths and corners to you`,
    ],
  };
}

/** Hex facts: the neutral pieces that stand on a tile, and the lakes. */
function hexTargets(view: FullView): InfoTarget[] {
  const out: InfoTarget[] = [];
  const knightsState = knightsExt(view);
  const islands = islandsExt(view);

  // The robber, only while in play. Under Knights it sits out until the
  // barbarians first land.
  //
  // That is decided by the ruleset, not by whether the Knights ext is present: a
  // Knights game in setup has no ext yet. A missing ext means "no attacks yet".
  //
  // `robberOnBoard` covers Fishermen, where the robber is off the board from
  // setup until the first 7 and after each two-fish spend; its coordinate then
  // matches no tile.
  const robberLive =
    (!gameCaps(view).hasBarbarians || (knightsState?.attacks ?? 0) > 0) &&
    robberOnBoard(view.board);
  if (robberLive) {
    out.push({
      kind: "hex",
      key: `h:${hexKey(view.board.robber)}`,
      h: view.board.robber,
      info: {
        title: t({ message: "Robber", context: "board piece" }),
        facts: [t`This hex produces nothing while the robber stands here`],
      },
    });
  }

  if (islands?.pirate) {
    out.push({
      kind: "hex",
      key: `h:${hexKey(islands.pirate)}`,
      h: islands.pirate,
      info: {
        title: t({ message: "Pirate", context: "board piece" }),
        // The freeze covers moving ships to or from these edges as well as
        // building, and whoever moves the pirate steals from a ship owner here.
        // The pirate is neutral, like the robber.
        facts: [
          t`Blocks ship building on this hex's edges`,
          t`No ship may move to or from them either`,
          t`Whoever moves it here steals from a player with a ship beside it`,
        ],
      },
    });
  }

  if (knightsState?.merchant) {
    out.push({
      kind: "hex",
      key: `h:${hexKey(knightsState.merchant)}`,
      h: knightsState.merchant,
      info: {
        title: t({ message: "Merchant", context: "board piece" }),
        owner: merchantOwner(view),
        facts: [t`Trades this hex's resource 2:1`, t`Worth 1 victory point to its holder`],
      },
    });
  }

  // Lakes last: a neutral piece standing on one is what the player means, and
  // the picker breaks ties in favour of the earlier entry.
  out.push(...raidersHexTargets(view));
  out.push(...explorersHexTargets(view));
  out.push(...tradeHexTargets(view));
  out.push(...groundTargets(view));
  out.push(...lakeTargets(view));

  return out;
}

/**
 * Everything on the board worth describing, in draw order.
 *
 * Pieces before bare ports and vertices before hexes, so the more specific
 * description wins a tie (the picker prefers the earlier entry).
 *
 * The same for every viewer, spectators and off-turn players included.
 */
export function planInfoTargets(view: FullView): InfoTarget[] {
  return [...vertexTargets(view), ...hexTargets(view)];
}
