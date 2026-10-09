/**
 * Explorers, as the game screen reads it.
 *
 * Pure derivations over the view and the server's legal sets: what a seat may
 * do now, what it costs, and which of the module's two turn stages it is in.
 *
 * Nothing here decides legality; it mirrors what the server published so the
 * screen does not offer a refused action. Rules not in the legal sets (a price,
 * a per-turn counter) are read off the module's view, not re-derived.
 */

import type {
  ExplorerShipAct,
  ExplorersShip,
  FullView,
  Hand,
  Hex,
  LegalTargets,
  Vertex,
} from "./types";
import { vertexHexes } from "./hexgeo";
import { explorersExt, explorersSeat, EXPLORERS_KIND, EXPLORERS_TRACK_VP } from "./types";

/** Resource indices, matching board.Resource. Index 0 is unused. */
const WOOD = 1;
const BRICK = 2;
const SHEEP = 3;
const WHEAT = 4;
const ORE = 5;

/** The whole price list. There are no cities and no development cards. */
export const EXPLORERS_COSTS = {
  road: { [WOOD]: 1, [BRICK]: 1 },
  settlement: { [WOOD]: 1, [BRICK]: 1, [SHEEP]: 1, [WHEAT]: 1 },
  harbour: { [WHEAT]: 2, [ORE]: 2 },
  ship: { [WOOD]: 1, [SHEEP]: 1 },
  settler: { [WOOD]: 1, [BRICK]: 1, [SHEEP]: 1, [WHEAT]: 1 },
  crew: { [SHEEP]: 1, [ORE]: 1 },
} as const satisfies Record<string, Record<number, number>>;

/** Two gold buy one resource, twice a turn. */
export const GOLD_PER_RESOURCE = 2;
export const GOLD_BUYS_PER_TURN = 2;
/** Whether this game is an Explorers game at all. */
export function isExplorers(view: FullView | undefined): boolean {
  return !!view && (view.config.ruleset || "base").split("+").includes("explorers");
}

/** Whether the active turn has walked through the one-way Movement door. */
export function inMovement(view: FullView | undefined): boolean {
  return !!explorersExt(view!)?.movement;
}

/** Can this hand pay that price? */
export function canAfford(hand: Hand | undefined, cost: Record<number, number>): boolean {
  if (!hand) return false;
  return Object.entries(cost).every(([res, n]) => (hand[Number(res)] ?? 0) >= n);
}

/** This seat's gold, or zero off an Explorers board. */
export function goldOf(view: FullView, seat: number): number {
  return explorersSeat(view, seat)?.gold ?? 0;
}

/** This seat's ships, in id order. */
export function shipsOf(view: FullView, seat: number): ExplorersShip[] {
  return (explorersExt(view)?.ships ?? []).filter((s) => s.owner === seat);
}

/**
 * What the seat's three mission markers are worth, tiles included.
 *
 * The engine's `mission_vp`, recomputed only for servers that predate it. The
 * tiles depend on who is farthest along, and ties go to the marker at the
 * bottom of a stack (arrival order is not in the view), so the fallback can
 * get ties wrong.
 */
export function missionVP(view: FullView, seat: number): number {
  const s = explorersSeat(view, seat);
  if (!s) return 0;
  if (typeof s.mission_vp === "number") return s.mission_vp;
  return (s.track ?? []).reduce((sum, pos) => sum + (EXPLORERS_TRACK_VP[pos] ?? 0), 0);
}

/** A ship's hold, as a flat count of what is aboard. */
export function holdCount(ship: ExplorersShip): number {
  const h = ship.hold ?? {};
  return (h.settler ?? 0) + (h.haul ?? 0) + (h.crew ?? 0) + (h.spice ?? 0);
}

/** The jobs the server says a ship may do from where it stands. */
export interface ShipOffer {
  ship: ExplorersShip;
  /** Sea edges one movement point away with room to stop. */
  moves: number;
  /** The named jobs it may do from where it stands. */
  acts: ExplorerShipAct[];
  /** Movement points left this turn. */
  left: number;
}

/** The distinct jobs in an offer, in a fixed order so the buttons never move. */
const JOB_ORDER: ExplorerShipAct["job"][] = ["found", "load_haul", "land_crew", "take_crew"];

export function offeredJobs(acts: ExplorerShipAct[]): ExplorerShipAct["job"][] {
  return JOB_ORDER.filter((j) => acts.some((a) => a.job === j));
}

/**
 * One row per ship of the seat's, with the server's offer attached.
 *
 * A ship with no offer still gets a row; a missing row would read as a lost
 * ship.
 */
export function shipOffers(view: FullView, seat: number, legal?: LegalTargets): ShipOffer[] {
  const offers = legal?.explorer_ships ?? [];
  return shipsOf(view, seat).map((ship) => {
    const o = offers.find((g) => g.ship === ship.id);
    return {
      ship,
      moves: o?.moves?.length ?? 0,
      acts: o?.acts ?? [],
      left: o?.left ?? ship.left ?? 0,
    };
  });
}

/**
 * Whether the fishing die is worth rolling: the seat has not used it this
 * Movement phase, and some revealed shoal could still take a haul.
 *
 * The roll is free. Greyed rather than hidden when nothing can come of it, so
 * the player knows the die exists before any shoal is found.
 */
export function canFish(view: FullView): {
  open: boolean;
  why: "rolled" | "nowhere" | "supply" | "";
} {
  const x = explorersExt(view);
  if (!x) return { open: false, why: "" };
  if (x.fish_rolled) return { open: false, why: "rolled" };
  // "supply" (no hauls left) and "nowhere" (no free shoal) need different
  // sentences.
  if ((x.hauls_left ?? 0) === 0) return { open: false, why: "supply" };
  const haulAt = new Set((x.hauls ?? []).map((h) => `${h.q},${h.r}`));
  const pirate = x.pirate ? `${x.pirate.q},${x.pirate.r}` : null;
  const open = (x.revealed ?? []).some((r) => {
    if (r.kind !== EXPLORERS_KIND.shoal) return false;
    const k = `${r.h.q},${r.h.r}`;
    return !haulAt.has(k) && k !== pirate;
  });
  return { open, why: open ? "" : "nowhere" };
}

/**
 * The seat's battle-ready ships: ones that have not moved this turn and stand at
 * a corner of an opponent's pirate ship.
 *
 * Derived here because the view carries everything needed, and the chase
 * command takes ships in an order the player picks, so the panel needs the
 * list. The engine re-checks every id.
 */
export function battleReady(view: FullView, seat: number): ExplorersShip[] {
  const x = explorersExt(view);
  if (!x?.pirate || x.pirate_owner === seat || x.pirate_owner === undefined) return [];
  const corners = hexCorners(x.pirate);
  return shipsOf(view, seat).filter(
    (s) => !s.moved && !s.fought && (corners.has(vertKey(s.e.a)) || corners.has(vertKey(s.e.b))),
  );
}

function vertKey(v: { q: number; r: number; side: number }): string {
  return `${v.q},${v.r},${v.side}`;
}

/** The six corners of a hex, as keys. Mirrors board.Hex.Vertices. */
function hexCorners(h: { q: number; r: number }): Set<string> {
  const { q, r } = h;
  return new Set(
    [
      [q, r, 0],
      [q + 1, r - 1, 1],
      [q, r + 1, 0],
      [q, r, 1],
      [q - 1, r + 1, 0],
      [q, r - 1, 1],
    ].map(([a, b, c]) => `${a},${b},${c}`),
  );
}

/**
 * Whether an opponent's pirate ship is standing where it costs this seat gold to
 * sail: the toll is one gold per ship per turn for using that hex's edges.
 */
export function pirateTollActive(view: FullView, seat: number): boolean {
  const x = explorersExt(view);
  return !!x?.pirate && x.pirate_owner !== undefined && x.pirate_owner !== seat;
}

/** Which of the module's three setup rounds is running, or null in play. */
export function setupRound(view: FullView): 0 | 1 | 2 | null {
  if (view.phase !== "setup") return null;
  const r = explorersExt(view)?.round ?? 0;
  return r === 1 ? 1 : r === 2 ? 2 : 0;
}

/**
 * Which piece the setup draft places right now, or null in play.
 *
 * Plain Explorers places a harbour settlement, then a settlement. With Knights
 * the combination rules swap them: a city first, then a harbour settlement. The
 * city still goes through `explorers_place_settlement`; the engine converts.
 * Mirrors `harbourRound` in engine/explorers/decide.go, and reads the ruleset
 * (as `WithKnights` does) since Knights state does not exist during setup.
 */
export function setupStep(view: FullView): "harbour" | "settlement" | "city" | "start" | null {
  const round = setupRound(view);
  if (round === null) return null;
  if (round === 2) return "start";
  const knights = (view.config.ruleset || "").split("+").includes("cak");
  if (knights) return round === 0 ? "city" : "harbour";
  return round === 0 ? "harbour" : "settlement";
}

/** What is left in the seat's own supply, or undefined off an Explorers board. */
export interface ExplorersSupplies {
  ships: number;
  settlers: number;
  crews: number;
  harbours: number;
}

export function supplies(view: FullView, seat: number): ExplorersSupplies | undefined {
  const s = explorersSeat(view, seat);
  if (!s) return undefined;
  return {
    ships: s.ships_left,
    settlers: s.settlers_left,
    crews: s.crews_left,
    harbours: s.harbours_left,
  };
}

/**
 * Where a bought settler or crew would go: an empty slot in one of the seat's
 * harbour settlements, or in one of its ships that is standing at one.
 *
 * A ship first, since cargo aboard can sail this turn. Mirrors the module's
 * CargoRoom; the engine re-checks.
 *
 * Null when every basin and docked hold is full, the case the jettison command
 * exists for.
 */
export function cargoDestination(
  view: FullView,
  seat: number,
  settler: boolean,
): Record<string, unknown> | null {
  const x = explorersExt(view);
  if (!x) return null;
  const mine = (x.harbours ?? []).filter((h) => h.owner === seat);
  const at = new Set(mine.map((h) => `${h.v.q},${h.v.r},${h.v.side}`));
  const slots = settler ? 2 : 1;
  for (const ship of shipsOf(view, seat)) {
    const docked =
      at.has(`${ship.e.a.q},${ship.e.a.r},${ship.e.a.side}`) ||
      at.has(`${ship.e.b.q},${ship.e.b.r},${ship.e.b.side}`);
    if (docked && cargoSlots(ship.hold) + slots <= 2) {
      return { settler, at_ship: true, ship_id: ship.id };
    }
  }
  for (const h of mine) {
    if (cargoSlots(h.basin) + slots <= 2) return { settler, at_ship: false, v: h.v };
  }
  return null;
}

/** A hold's capacity, counting a large piece as both slots. */
export function cargoSlots(
  c: { settler?: number; haul?: number; crew?: number; spice?: number } = {},
): number {
  return 2 * ((c.settler ?? 0) + (c.haul ?? 0)) + (c.crew ?? 0) + (c.spice ?? 0);
}

/** Visible storage choices. Buying cargo must let the player choose its destination. */
export function cargoBays(view: FullView, seat: number) {
  const harbours = (explorersExt(view)?.harbours ?? []).filter((h) => h.owner === seat);
  return [
    ...shipsOf(view, seat).map((ship, i) => ({
      key: `ship-${ship.id}`,
      ship: ship.id,
      // The seat's own numbering, as the fleet panel shows it; `ship` is the
      // table-wide id for the command.
      n: i + 1,
      harbour: 0,
      cargo: ship.hold,
      docked: !!dockedHarbour(view, seat, ship),
      payload: { at_ship: true, ship_id: ship.id },
    })),
    ...harbours.map((h, i) => ({
      key: `harbour-${i}`,
      ship: 0,
      n: 0,
      harbour: i + 1,
      cargo: h.basin,
      docked: true,
      payload: { at_ship: false, v: h.v },
    })),
  ];
}

export function dockedHarbour(view: FullView, seat: number, ship: ExplorersShip) {
  const harbours = (explorersExt(view)?.harbours ?? []).filter((h) => h.owner === seat);
  return [ship.e.a, ship.e.b].flatMap((v) =>
    harbours.filter((h) => h.v.q === v.q && h.v.r === v.r && h.v.side === v.side),
  )[0];
}

export const CARGO_PIECES = ["settler", "crew", "haul", "spice"] as const;

export function cargoTransfers(
  from: Parameters<typeof cargoSlots>[0],
  to: Parameters<typeof cargoSlots>[0],
) {
  return CARGO_PIECES.filter(
    (piece) =>
      (from?.[piece] ?? 0) > 0 &&
      cargoSlots(to) + (piece === "settler" || piece === "haul" ? 2 : 1) <= 2,
  );
}

type CargoCount = Parameters<typeof cargoSlots>[0];

/** A legal hold or basin: one large piece at most, two slots at most. */
function cargoFits(c: CargoCount = {}): boolean {
  return (c.settler ?? 0) + (c.haul ?? 0) <= 1 && cargoSlots(c) <= 2;
}

function cargoMinus(a: CargoCount = {}, b: CargoCount = {}): CargoCount {
  const out: CargoCount = {};
  for (const p of CARGO_PIECES) out[p] = (a[p] ?? 0) - (b[p] ?? 0);
  return out;
}

function cargoPlus(a: CargoCount = {}, b: CargoCount = {}): CargoCount {
  const out: CargoCount = {};
  for (const p of CARGO_PIECES) out[p] = (a[p] ?? 0) + (b[p] ?? 0);
  return out;
}

/**
 * The swaps between a docked ship's hold and the harbour settlement's basin:
 * `cargo` goes aboard and `back` goes ashore in one transfer (an
 * `explorers_load` carrying `back`). Mirrors `decideTransfer` in
 * engine/explorers/decide.go.
 *
 * Offered only where the two one-way transfers cannot do it, i.e. the far side
 * has no room until the other piece leaves (a settler aboard, two crews in the
 * basin). One-for-one swaps come first; the whole exchange only when none
 * applies.
 */
export function cargoSwaps(
  hold: CargoCount = {},
  basin: CargoCount = {},
): {
  give: (typeof CARGO_PIECES)[number] | null;
  take: (typeof CARGO_PIECES)[number] | null;
  cargo: CargoCount;
  back: CargoCount;
}[] {
  const out: ReturnType<typeof cargoSwaps> = [];
  const legal = (cargo: CargoCount, back: CargoCount) =>
    cargoFits(cargoPlus(cargoMinus(hold, back), cargo)) &&
    cargoFits(cargoPlus(cargoMinus(basin, cargo), back));
  const loads = cargoTransfers(basin, hold);
  const unloads = cargoTransfers(hold, basin);
  for (const give of CARGO_PIECES) {
    if ((hold[give] ?? 0) === 0) continue;
    for (const take of CARGO_PIECES) {
      if (take === give || (basin[take] ?? 0) === 0) continue;
      if (unloads.includes(give) || loads.includes(take)) continue;
      const cargo = { [take]: 1 };
      const back = { [give]: 1 };
      if (legal(cargo, back)) out.push({ give, take, cargo, back });
    }
  }
  const whole = cargoSlots(hold) > 0 && cargoSlots(basin) > 0;
  const same = CARGO_PIECES.every((p) => (hold[p] ?? 0) === (basin[p] ?? 0));
  if (whole && !same && out.length === 0 && loads.length === 0 && unloads.length === 0) {
    const cargo: CargoCount = {};
    const back: CargoCount = {};
    for (const p of CARGO_PIECES) {
      if (basin[p]) cargo[p] = basin[p];
      if (hold[p]) back[p] = hold[p];
    }
    out.push({ give: null, take: null, cargo, back });
  }
  return out;
}

/**
 * This seat owes the pirate ship's move after its 7 (`pirate_by`), with the
 * table's discards already settled, which is when the engine takes the move.
 * The screen must prompt for it: until the pirate moves, the player cannot
 * build.
 */
export function pirateOwed(view: FullView, seat: number): boolean {
  const x = explorersExt(view);
  if (!x || seat < 0 || (x.pirate_by ?? -1) !== seat) return false;
  return Object.keys(view.pending_discards ?? {}).length === 0;
}

/**
 * The seats the pirate would rob from hex `h`: every other owner of a ship on
 * one of its edges (both ends at its corners). A ship with one end at a corner
 * is beside the hex, which is the battle-readiness test, not robbery. Mirrors
 * `pirateVictims` in engine/explorers/rules.go; the engine requires the move to
 * name a victim exactly when there is one.
 */
export function pirateVictimsAt(view: FullView, h: Hex, mover: number): number[] {
  const at = (v: Vertex) => vertexHexes(v).some((c) => c.q === h.q && c.r === h.r);
  const out = new Set<number>();
  for (const sh of explorersExt(view)?.ships ?? []) {
    if (sh.owner !== mover && at(sh.e.a) && at(sh.e.b)) out.add(sh.owner);
  }
  return [...out].sort((a, b) => a - b);
}
