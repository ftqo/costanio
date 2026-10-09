// The location-first action menu: given a clicked board location and the view,
// return the actions the player may take there. Reads only the engine-computed
// view.legal (plus the Knights view) and never re-derives placement rules. The
// engine re-validates every command, so a wrong result can only under-offer.
import { type Edge, type FullView, type Vertex, knightsExt, islandsExt } from "./types";
import { edgeHexes, edgeKey, hexKey, vertexKey, vertexNeighbors } from "./hexgeo";
import { canChasePirate, canChaseRobber, chasePirateBlock, chaseRobberBlock } from "./robber";
import { COST } from "./costs";
import { gameCaps } from "./caps";
import { bridgeCost, isBridgeSite, seatBridgesLeft } from "./rivers";
import { barbarianPlace, movableBarbarians } from "./wagons";
import { type BoardMode } from "./boardTargets";
import { msg, t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";
import { formatList } from "./intl";

/** A clicked board location to inspect for available actions. */
export type BoardLocation = { kind: "edge"; e: Edge } | { kind: "vertex"; v: Vertex };

/**
 * What the viewer can do with one roster entry right now.
 *
 * - `ready`   in `view.legal` here, and the hand can pay.
 * - `short`   legal here, hand cannot pay. `missing` says which resources.
 * - `blocked` in the roster but not in `view.legal`. `reason` says why.
 *
 * An action absent from the roster is never built, so "not in this game" is the
 * entry not existing.
 */
export type ActionStatus = "ready" | "short" | "blocked";

/** One entry in a location's roster. Exactly one of cmd/mode is set. */
export interface LocationAction {
  id: string;
  /**
   * Position in this location's roster, from 1. Not a sort key: the roster is
   * emitted in rank order, so an entry the hand cannot pay for keeps its place.
   */
  rank: number;
  /** Full label, for the readout and the list rendering. */
  label: string;
  /** Short label for a dial seat, where a circle constrains the width. */
  seatLabel: string;
  status: ActionStatus;
  /** Why the entry is not actionable. Set when status is not "ready". */
  reason?: string;
  /** Resource indices the hand is short of. Set when status is "short". */
  missing?: number[];
  /** Resources the action costs, for CostChips; omitted when free/not shown. */
  cost?: Record<number, number>;
  /** One-shot command sent immediately on selection. */
  cmd?: { type: string; data: unknown };
  /** Multi-step: enter this selection mode, seeded from the clicked location. */
  mode?: BoardMode;
  /**
   * The entry only arms a mode and sends nothing ("Move ship" picks the ship;
   * the destination tap is the commit, with its own confirm). Set explicitly
   * rather than inferred from `mode`. LocationDial skips the touch two-tap for
   * these.
   */
  arms?: boolean;
  /**
   * Asset slot for the card art when the action id is not enough: promotion,
   * whose art depends on the tier bought. Not derived from the label, which is
   * translated.
   */
  art?: string;
}

const has = <T>(arr: T[] | undefined, key: string, keyOf: (x: T) => string) =>
  (arr ?? []).some((x) => keyOf(x) === key);

// The board's sea hexes as keys, cached per tile array. `isBoatEdge` runs once
// per legal edge while the 3D board plans pick targets, and the tiles array is
// replaced wholesale each frame, so this is one scan per frame.
const seaHexCache = new WeakMap<object, Set<string>>();

function seaHexKeys(view: FullView): Set<string> {
  const tiles = view.board?.tiles;
  if (!tiles) return new Set();
  let ks = seaHexCache.get(tiles);
  if (!ks) {
    // Mirrors board.IsSea: a tile must exist and be sea. Lake (Fishermen) is
    // land-side and carries no ships.
    ks = new Set(tiles.filter((t) => t.res === "sea").map((t) => hexKey(t.hex)));
    seaHexCache.set(tiles, ks);
  }
  return ks;
}

/**
 * Whether a boat could ever go on this edge: the game has ships at all, and the
 * edge borders water (board.SeaEdge, mirrored).
 *
 * Not "a ship is legal here for me now". This is the roster gate (what the spot
 * could ever offer), which must hold still for the whole game; terrain never
 * changes.
 *
 * Both halves matter: every board has a sea ring, so without the ruleset check
 * every coastal edge would show a permanently greyed Build ship; without the
 * water check an inland Islands edge would.
 */
export function isBoatEdge(e: Edge, view: FullView): boolean {
  if (!gameCaps(view).hasShips) return false;
  const sea = seaHexKeys(view);
  if (sea.size === 0) return false;
  return edgeHexes(e).some((h) => sea.has(hexKey(h)));
}

/**
 * Resource names for the short-of list. Index matches a Hand's.
 *
 * Descriptors, not strings, so the language is resolved at the call site.
 *
 * The standalone-label (nominative) form, as used by lib/boardInfo's port lines
 * and the manual's cost chips. Sentences that govern the noun's case are
 * written out whole instead (`NEED_ONE_MORE`).
 */
const RES_NAME: (MessageDescriptor | null)[] = [
  null,
  msg({ message: "wood", context: "resource, standalone label" }),
  msg({ message: "brick", context: "resource, standalone label" }),
  msg({ message: "sheep", context: "resource, standalone label" }),
  msg({ message: "wheat", context: "resource, standalone label" }),
  msg({ message: "ore", context: "resource, standalone label" }),
];

/**
 * "You need 1 more ore.", written out per resource.
 *
 * One message per resource, as in lib/cardPhrases: the sentence governs the
 * noun's case, so it must be translated whole.
 */
const NEED_ONE_MORE: (MessageDescriptor | null)[] = [
  null,
  msg({ id: "short.needOneMore.wood", message: "You need 1 more wood." }),
  msg({ id: "short.needOneMore.brick", message: "You need 1 more brick." }),
  msg({ id: "short.needOneMore.sheep", message: "You need 1 more sheep." }),
  msg({ id: "short.needOneMore.wheat", message: "You need 1 more wheat." }),
  msg({ id: "short.needOneMore.ore", message: "You need 1 more ore." }),
];

/**
 * Which resources the hand is short of for `cost`, as Hand indices.
 *
 * Empty for a costless action (a mode entry is not a purchase) and for a road
 * or ship covered by a Road Building grant.
 */
function missingFor(
  cost: Record<number, number> | undefined,
  id: string,
  view: FullView,
): number[] {
  if (!cost) return [];
  if ((view.free_roads ?? 0) > 0 && FREE_ROAD_ACTIONS.has(id)) return [];
  const hand = view.players?.find((p) => p.seat === view.viewer)?.hand;
  // Spectator, or another seat's redacted view: every costed entry reads as
  // short.
  if (!hand) return Object.keys(cost).map(Number);
  return Object.entries(cost)
    .filter(([i, n]) => (hand[+i] ?? 0) < n)
    .map(([i]) => +i);
}

function shortReason(missing: number[]): string {
  if (missing.length === 1) {
    const one = NEED_ONE_MORE[missing[0]];
    if (one) return i18n._(one);
    return t({
      message: "You need 1 more of a resource you do not hold.",
      id: "short.needOneMore",
    });
  }
  // Fallback for a resource index with no name; only ever an item in the list
  // below, hence the standalone-label context.
  const names = missing.map((i) => {
    const d = RES_NAME[i];
    return d
      ? i18n._(d)
      : t({ message: "resource", context: "a resource, unnamed, standalone label" });
  });
  // `formatList` so the conjunction and commas follow the locale. The list
  // follows a colon as a label rather than sitting in the sentence, where case
  // (Russian, Polish, German) or verb number (Spanish) would have to agree with
  // a runtime-assembled phrase.
  const resources = formatList(names);
  return t({ message: `You are short of: ${resources}`, id: "short.shortOf" });
}

/**
 * Why a road is not legal here.
 *
 * Naming a reason is not deciding legality: `view.legal` already did, and the
 * engine re-validates. So a rung may only assert from state the view shows
 * directly; anything else falls through to a general line.
 */
function roadWhy(view: FullView): string {
  const me = view.players?.find((p) => p.seat === view.viewer);
  if (me && me.roads_left === 0) return t`You have no road pieces left.`;
  return t`No road or ship of yours reaches this edge.`;
}

function shipWhy(view: FullView): string {
  const left = islandsExt(view)?.ships_left?.[view.viewer];
  if (left === 0) return t`You have no ship pieces left.`;
  return t`Your ships do not reach this edge yet.`;
}

function bridgeWhy(view: FullView): string {
  if (seatBridgesLeft(view, view.viewer) === 0) return t`You have built all three of your bridges.`;
  return t`Your network does not reach this bridge site yet.`;
}

/** The bits of an entry the roster author writes; status is derived. */
type Draft = Omit<LocationAction, "rank" | "status" | "reason" | "missing"> & {
  /** Whether `view.legal` offers this action at this location right now. */
  legal: boolean;
  /** Sentence for the blocked case. A thunk so ladders only run when needed. */
  why: () => string;
};

/**
 * Turn drafts into a ranked roster, deriving each entry's status.
 *
 * Rank is the array position, so the caller writes the roster in display order
 * and never sorts.
 */
function roster(view: FullView, drafts: Draft[]): LocationAction[] {
  return drafts.map(({ legal, why, ...rest }, i) => {
    const rank = i + 1;
    if (!legal) return { ...rest, rank, status: "blocked", reason: why() };
    const missing = missingFor(rest.cost, rest.id, view);
    if (missing.length > 0)
      return { ...rest, rank, status: "short", missing, reason: shortReason(missing) };
    return { ...rest, rank, status: "ready" };
  });
}

export function actionsAt(loc: BoardLocation, view: FullView): LocationAction[] {
  const legal = view.legal;
  if (!legal) return [];

  // Setup has its own short roster. On touch a finger hides the spot it is
  // about to commit to, so a setup tap goes through the menu as a confirmation.
  //
  // The commands are `place_settlement` / `place_road`, not the build ones:
  // setup placements are free, ignore the road network, and are the only ones
  // the engine accepts in this phase.
  //
  // Usually one entry. An Islands setup edge can take a road or a ship, and
  // then there are two.
  if (view.phase === "setup") {
    if (loc.kind === "vertex") {
      const k = vertexKey(loc.v);
      return roster(view, [
        {
          id: "place_settlement",
          label: t({ message: "Place settlement", context: "board action, setup" }),
          seatLabel: t({ message: "Settlement", context: "board action, short label" }),
          cmd: { type: "place_settlement", data: { v: loc.v } },
          legal: has(legal.settlements, k, vertexKey),
          why: () =>
            t`You cannot start here. A settlement needs every neighbouring intersection clear.`,
        },
      ]);
    }
    const k = edgeKey(loc.e);
    const road = has(legal.roads, k, edgeKey);
    const ship = has(legal.ships, k, edgeKey);
    return roster(view, [
      ...(road
        ? [
            {
              id: "place_road",
              label: t({ message: "Place road", context: "board action, setup" }),
              seatLabel: t({ message: "Road", context: "board action, short label" }),
              cmd: { type: "place_road", data: { e: loc.e, ship: false } },
              legal: true,
              why: () => "",
            } as Draft,
          ]
        : []),
      ...(ship
        ? [
            {
              id: "place_ship",
              label: t({ message: "Place ship", context: "board action, setup" }),
              seatLabel: t({ message: "Ship", context: "board action, short label" }),
              cmd: { type: "place_road", data: { e: loc.e, ship: true } },
              legal: true,
              why: () => "",
            } as Draft,
          ]
        : []),
      // Neither: one blocked entry says so, rather than an empty menu that reads
      // as a dropped press.
      ...(road || ship
        ? []
        : [
            {
              id: "place_road",
              label: t({ message: "Place road", context: "board action, setup" }),
              seatLabel: t({ message: "Road", context: "board action, short label" }),
              legal: false,
              why: () => t`This has to touch the settlement you just placed.`,
            } as Draft,
          ]),
    ]);
  }

  if (loc.kind === "edge") {
    const k = edgeKey(loc.e);
    const mine = view.viewer;
    const ships = islandsExt(view)?.ships ?? [];
    const shipHere = ships.find((s) => edgeKey(s.e) === k);
    const roadHere = (view.roads ?? []).find((r) => edgeKey(r.e) === k);

    // Occupancy picks the roster, as on a vertex. Move ship acts on your ship:
    // `legal.ship_moves` is keyed by `from`, so the clicked edge must be the
    // source.
    if (shipHere)
      return shipHere.owner === mine
        ? roster(view, [
            {
              id: "move_ship",
              label: t({ message: "Move ship", context: "board action" }),
              seatLabel: t({ message: "Move ship", context: "board action, short label" }),
              mode: "shipmove",
              arms: true,
              legal: has(legal.ship_moves, k, (g) => edgeKey(g.from)),
              why: () => t`This ship is not at the open end of a route.`,
            },
          ])
        : [];
    // A standing road is never acted on by clicking it, yours or anyone's.
    if (roadHere) return [];
    // A bridge site takes only a bridge (a road may never cross the channel),
    // so the road is dropped there rather than greyed.
    const site = isBridgeSite(view, loc.e);

    return roster(view, [
      ...(site
        ? []
        : [
            {
              id: "build_road",
              label: t({ message: "Build road", context: "board action" }),
              seatLabel: t({ message: "Road", context: "board action, short label" }),
              cost: COST.road,
              cmd: { type: "build_road", data: { e: loc.e } },
              legal: has(legal.roads, k, edgeKey),
              why: () => roadWhy(view),
            } as Draft,
          ]),
      // Gated on terrain (`isBoatEdge`): an edge touching no water never takes a
      // ship, so it gets no greyed Build ship.
      ...(isBoatEdge(loc.e, view)
        ? [
            {
              id: "build_ship",
              label: t({ message: "Build ship", context: "board action" }),
              seatLabel: t({ message: "Ship", context: "board action, short label" }),
              cost: COST.ship,
              cmd: { type: "build_ship", data: { e: loc.e } },
              legal: has(legal.ships, k, edgeKey),
              why: () => shipWhy(view),
            } as Draft,
          ]
        : []),
      // Only on bridge sites: elsewhere a bridge is impossible, not unavailable.
      // On a site it stands alone, since the engine refuses the road there.
      ...(site
        ? [
            {
              id: "build_bridge",
              label: t({ message: "Build bridge", context: "board action" }),
              seatLabel: t({ message: "Bridge", context: "board action, short label" }),
              cost: bridgeCost(view),
              cmd: { type: "build_bridge", data: { e: loc.e } },
              legal: has(legal.bridges, k, edgeKey),
              why: () => bridgeWhy(view),
            } as Draft,
          ]
        : []),
    ]);
  }

  return vertexRoster(loc.v, view);
}

/**
 * The roster for a vertex, chosen by what is standing on it.
 *
 * Occupancy decides the roster, as on an edge: the cases are disjoint in the
 * rules, so one combined list would grey entries that can never apply.
 */
function vertexRoster(v: Vertex, view: FullView): LocationAction[] {
  const legal = view.legal!;
  const k = vertexKey(v);
  const mine = view.viewer;
  const caps = gameCaps(view);
  const knightsState = knightsExt(view);

  const knight = knightsState?.knights.find((x) => vertexKey(x.v) === k);
  if (knight && knightsState)
    return knight.owner === mine ? knightRoster(v, knight, knightsState, view) : [];

  const building = (view.buildings ?? []).find((b) => vertexKey(b.v) === k);
  if (building) {
    if (building.owner !== mine) return [];
    if (!building.city)
      return roster(view, [
        {
          id: "build_city",
          label: t({ message: "Upgrade to city", context: "board action" }),
          seatLabel: t({ message: "City", context: "board action, short label" }),
          cost: COST.city,
          cmd: { type: "build_city", data: { v } },
          legal: has(legal.cities, k, vertexKey),
          why: () =>
            (view.players?.find((p) => p.seat === mine)?.cities_left ?? 1) === 0
              ? t`You have no city pieces left.`
              : t`You can only upgrade your own settlement.`,
        },
      ]);
    // A city: the wall is the only thing clicking it can add. Metropolis and the
    // barbarian downgrade are forced steps scoped to the whole board.
    if (!caps.hasWalls) return [];
    return roster(view, [
      {
        id: "build_wall",
        label: t({ message: "Build wall", context: "board action" }),
        seatLabel: t({ message: "Wall", context: "board action, short label" }),
        cost: COST.wall,
        cmd: { type: "build_wall", data: { v } },
        legal: has(legal.walls, k, vertexKey),
        why: () =>
          (knightsState?.walled ?? []).some((w) => vertexKey(w) === k)
            ? t`This city already has a wall.`
            : t`You cannot wall this city right now.`,
      },
    ]);
  }

  // Empty. Where the distance rule forbids a settlement it is dropped rather
  // than greyed: buildings never leave a vertex, so it will never become legal.
  //
  // The one place the menu reads a placement rule instead of `view.legal`. A
  // mistake here can only drop an entry the engine would allow, never authorise
  // one (the same trade as `isBoatEdge`).
  const crowded = vertexNeighbors(v).some((n) =>
    (view.buildings ?? []).some((b) => vertexKey(b.v) === vertexKey(n)),
  );
  return roster(view, [
    ...(crowded
      ? []
      : [
          {
            id: "build_settlement",
            label: t({ message: "Build settlement", context: "board action" }),
            seatLabel: t({ message: "Settlement", context: "board action, short label" }),
            cost: COST.settlement,
            cmd: { type: "build_settlement", data: { v } },
            legal: has(legal.settlements, k, vertexKey),
            why: () =>
              (view.players?.find((p) => p.seat === mine)?.settlements_left ?? 1) === 0
                ? t`You have no settlement pieces left.`
                : t`No road of yours reaches this spot.`,
          } as Draft,
        ]),
    ...(caps.hasKnightPieces
      ? [
          {
            id: "build_knight",
            label: t({ message: "Build knight", context: "board action" }),
            seatLabel: t({ message: "Knight", context: "board action, short label" }),
            cost: COST.knight,
            cmd: { type: "build_knight", data: { v } },
            legal: has(legal.knights, k, vertexKey),
            why: () =>
              atLevel(knightsState, mine, 1) >= KNIGHTS_PER_LEVEL
                ? t`Both of your strength 1 knights are already on the board.`
                : t`No road of yours reaches this spot.`,
          } as Draft,
        ]
      : []),
  ]);
}

/**
 * Promotion swaps in a higher-tier piece and only two exist per tier
 * (engine/knights/decide.go's knightsPerLevel), so a player fielding two at the next
 * tier cannot promote however much they can afford.
 */
const KNIGHTS_PER_LEVEL = 2;

const atLevel = (knightsState: ReturnType<typeof knightsExt>, seat: number, lvl: number) =>
  (knightsState?.knights ?? []).filter((x) => x.owner === seat && x.level === lvl).length;

/**
 * Your knight's four verbs, always all four, in this order. Never filtered by
 * state, so a click's meaning does not change with your hand; those that cannot
 * run say why.
 *
 * A fifth (chase pirate) appears only in a game with a pirate: that depends on
 * the ruleset, and a permanently greyed entry would be noise elsewhere.
 */
function knightRoster(
  v: Vertex,
  kn: NonNullable<ReturnType<typeof knightsExt>>["knights"][number],
  knightsState: NonNullable<ReturnType<typeof knightsExt>>,
  view: FullView,
): LocationAction[] {
  const legal = view.legal!;
  const k = vertexKey(v);
  const me = knightsState.players?.[view.viewer];
  const next = kn.level + 1;
  const maxed = kn.level >= 3;
  const promotable =
    !maxed &&
    !(kn.level === 2 && (me?.improve?.[1] ?? 0) < 3) &&
    !kn.promoted_this_turn &&
    atLevel(knightsState, view.viewer, next) < KNIGHTS_PER_LEVEL;
  const pirateHex = islandsExt(view)?.pirate;

  // Wagons barbarians beside this knight, named by where each stands (the
  // pieces carry no number on the board).
  const edgeChases = (legal.knight_edge_chases ?? []).filter((c) => vertexKey(c.v) === k);
  const barbs = movableBarbarians(view);
  return roster(view, [
    ...edgeChases.map((c) => {
      const edge = barbs.find((b) => b.id === c.barb)?.edge;
      const place = edge ? barbarianPlace(view, edge) : "";
      const named = place ? t`Chase the barbarian ${place}` : t`Chase the barbarian`;
      return {
        id: `chase_barbarian_${c.barb}`,
        why: () => t`This knight cannot chase that barbarian.`,
        label: named,
        seatLabel: edgeChases.length > 1 ? named : t`Chase the barbarian`,
        legal: true,
        cmd: { type: "chase_robber", data: { v, barb: c.barb } },
      };
    }),
    {
      id: "activate_knight",
      label: t({ message: "Activate", context: "activate a knight" }),
      seatLabel: t({ message: "Activate", context: "activate a knight, short label" }),
      cost: { 4: 1 },
      cmd: { type: "activate_knight", data: { v } },
      legal: !kn.active,
      why: () => t`This knight is already active.`,
    },
    {
      // Name the target strength so the player sees what the cost buys. At full
      // strength there is no next number.
      id: "promote_knight",
      art: maxed ? "build_knight" : next === 3 ? "build_knight_mighty" : "build_knight_strong",
      label: maxed
        ? t({ message: "Promote", context: "promote a knight" })
        : t`Promote to strength ${next}`,
      seatLabel: maxed
        ? t({ message: "Promote", context: "promote a knight, short label" })
        : t`Strength ${next}`,
      cost: { 3: 1, 5: 1 },
      cmd: { type: "promote_knight", data: { v } },
      legal: promotable,
      why: () => {
        if (maxed) return t`This knight is already at full strength.`;
        if (kn.level === 2 && (me?.improve?.[1] ?? 0) < 3)
          return t`A strength 3 knight needs Politics level 3, the Fortress.`;
        if (kn.promoted_this_turn) return t`This knight has already been promoted this turn.`;
        return t`Both strength ${next} knights are already on the board.`;
      },
    },
    {
      // A mode with no destinations would be a dead end, so ask the engine
      // (`legal.knight_moves`) whether this knight can actually go anywhere,
      // not just whether it is allowed to move.
      id: "move_knight",
      label: t({ message: "Move", context: "move a knight" }),
      seatLabel: t({ message: "Move", context: "move a knight, short label" }),
      mode: "knightmove",
      arms: true,
      legal:
        kn.active && !kn.freshly_activated && has(legal.knight_moves, k, (g) => vertexKey(g.from)),
      why: () => {
        if (!kn.active) return t`Activate this knight first.`;
        if (kn.freshly_activated)
          return t`This knight was activated this turn. It can move next turn.`;
        return t`This knight has nowhere to go.`;
      },
    },
    {
      id: "chase_robber",
      label: t({ message: "Chase robber", context: "board action" }),
      seatLabel: t({ message: "Chase robber", context: "board action, short label" }),
      mode: "chaserobber",
      arms: true,
      legal: canChaseRobber(kn, view.viewer, view.board.robber),
      why: () => {
        switch (chaseRobberBlock(kn, view.viewer, view.board.robber)) {
          case "inactive":
            return t`Activate this knight first.`;
          case "fresh":
            return t`This knight was activated this turn. It can chase next turn.`;
          default:
            return t`The robber is not next to this knight.`;
        }
      },
    },
    // Only in a game with a pirate: a knight next to a sea hex can drive it
    // off as it chases the robber on land. One engine command serves both (the
    // hex decides which), but each has its own mode and hex list so a knight is
    // not offered the other's destinations.
    ...(pirateHex
      ? [
          {
            id: "chase_pirate",
            label: t({ message: "Chase pirate", context: "board action" }),
            seatLabel: t({ message: "Chase pirate", context: "board action, short label" }),
            mode: "chasepirate" as const,
            arms: true,
            legal: canChasePirate(kn, view.viewer, pirateHex),
            why: () => {
              switch (chasePirateBlock(kn, view.viewer, pirateHex)) {
                case "inactive":
                  return t`Activate this knight first.`;
                case "fresh":
                  return t`This knight was activated this turn. It can chase next turn.`;
                default:
                  return t`The pirate is not next to this knight.`;
              }
            },
          },
        ]
      : []),
  ]);
}

/**
 * Actions that Road Building (and the modules' free-build grants) pays for.
 * `view.free_roads` is the engine's counter; Islands ships spend it too (see
 * Game.tsx `canRoad`/`canShip`).
 */
const FREE_ROAD_ACTIONS: ReadonlySet<string> = new Set(["build_road", "build_ship"]);

/**
 * Whether the viewer can pay for `a` right now.
 *
 * Not a legality check: `actionsAt` answered that from `view.legal`, which is
 * positional only (`engine.LegalTargets`; resource and piece gating live on the
 * build buttons). This is that resource gate for the location-first flow,
 * mirroring Game.tsx's `affords`.
 *
 * A costless action (move ship, move knight, chase robber) is always
 * affordable.
 *
 * Game.tsx also subtracts its optimistic `spent` overlay; this cannot, so for
 * one round-trip after a staged purchase it may say yes. The engine rejects that
 * harmlessly.
 */
export function canAffordAction(a: LocationAction, view: FullView): boolean {
  return missingFor(a.cost, a.id, view).length === 0;
}

/**
 * The piece standing at `loc`, and whose it is.
 *
 * Used by the hover preview where the thing acted on is already on the board,
 * so the piece itself goes translucent instead of drawing a ghost.
 *
 * The owner is returned because it is not always the viewer (Diplomat removes
 * an opponent's road, Intrigue moves an opponent's knight), and the preview
 * uses their colour.
 *
 * Returns renderer piece names rather than importing `GhostKind`, so this
 * module does not depend on board3d.
 */
export type PieceAt = {
  kind: "settlement" | "city" | "knight" | "knight_strong" | "knight_mighty" | "road" | "ship";
  owner: number;
};

export function pieceAt(loc: BoardLocation, view: FullView): PieceAt | null {
  if (loc.kind === "edge") {
    const k = edgeKey(loc.e);
    const ship = (islandsExt(view)?.ships ?? []).find((s) => edgeKey(s.e) === k);
    if (ship) return { kind: "ship", owner: ship.owner };
    const road = (view.roads ?? []).find((r) => edgeKey(r.e) === k);
    if (road) return { kind: "road", owner: road.owner };
    return null;
  }
  const k = vertexKey(loc.v);
  const kn = knightsExt(view)?.knights.find((x) => vertexKey(x.v) === k);
  // The knight's tier picks the model; the three levels are separate pieces.
  if (kn) return { kind: KNIGHT_TIER[kn.level] ?? "knight", owner: kn.owner };
  const b = (view.buildings ?? []).find((x) => vertexKey(x.v) === k);
  if (b) return { kind: b.city ? "city" : "settlement", owner: b.owner };
  return null;
}

/** Knight level (1-3) to the piece that stands for it. */
const KNIGHT_TIER: Record<number, "knight" | "knight_strong" | "knight_mighty"> = {
  1: "knight",
  2: "knight_strong",
  3: "knight_mighty",
};
