import { describe, it, expect } from "vitest";
import type { FullView, LegalTargets, Vertex } from "./types";
import {
  pirateOwed,
  pirateVictimsAt,
  battleReady,
  canAfford,
  canFish,
  cargoDestination,
  cargoSwaps,
  EXPLORERS_COSTS,
  goldOf,
  holdCount,
  inMovement,
  isExplorers,
  missionVP,
  offeredJobs,
  pirateTollActive,
  setupRound,
  setupStep,
  shipOffers,
  shipsOf,
  supplies,
} from "./explorers";

// A minimal fixture: every function under test reads only the module's ext,
// and a full board would hide which fields each depends on.
function view(ext?: Record<string, unknown>, over?: Partial<FullView>): FullView {
  return {
    seq: 1,
    viewer: 0,
    config: { players: 3, ruleset: "explorers" },
    phase: "play",
    cur: 0,
    board: { radius: 5, tiles: [], robber: { q: 0, r: 0 }, harbors: [] },
    bank: [0, 19, 19, 19, 19, 19],
    players: [{ seat: 0, hand: [0, 2, 2, 2, 2, 2] }],
    buildings: [],
    roads: [],
    dev_deck_count: 0,
    longest_road: 0,
    ext: ext ? { explorers: ext } : undefined,
    ...over,
  } as unknown as FullView;
}

const V = (q: number, r: number, side: 0 | 1 = 0) => ({ q, r, side });
const E = (a: ReturnType<typeof V>, b: ReturnType<typeof V>) => ({ a, b });

describe("isExplorers", () => {
  it("reads the full ruleset name for a standalone", () => {
    expect(isExplorers(view())).toBe(true);
    expect(isExplorers(view(undefined, { config: { players: 3, ruleset: "base" } } as never))).toBe(
      false,
    );
    // The server refuses "base+explorers", but a client seeing it should still
    // treat it as Explorers.
    expect(
      isExplorers(view(undefined, { config: { players: 3, ruleset: "base+explorers" } } as never)),
    ).toBe(true);
  });
});

describe("everything degrades on a view with no ext", () => {
  // An older server or a base-game view must not throw: these run on every
  // render of the game screen.
  const bare = view();
  it("returns empty rather than throwing", () => {
    expect(shipsOf(bare, 0)).toEqual([]);
    expect(goldOf(bare, 0)).toBe(0);
    expect(missionVP(bare, 0)).toBe(0);
    expect(supplies(bare, 0)).toBeUndefined();
    expect(battleReady(bare, 0)).toEqual([]);
    expect(pirateTollActive(bare, 0)).toBe(false);
    expect(cargoDestination(bare, 0, false)).toBeNull();
    expect(canFish(bare)).toEqual({ open: false, why: "" });
    expect(inMovement(bare)).toBe(false);
    expect(shipOffers(bare, 0)).toEqual([]);
  });
});

describe("canFish", () => {
  const shoal = (q: number, r: number) => ({ h: { q, r }, region: 0, kind: 2 });
  it("is closed once the die has been rolled this phase", () => {
    expect(canFish(view({ fish_rolled: true, hauls_left: 6, revealed: [shoal(1, 1)] }))).toEqual({
      open: false,
      why: "rolled",
    });
  });
  it("is closed while no shoal has been explored", () => {
    expect(canFish(view({ hauls_left: 6, revealed: [] })).open).toBe(false);
  });
  it("is closed on a shoal with a catch or the pirate", () => {
    expect(
      canFish(view({ hauls_left: 6, revealed: [shoal(1, 1)], hauls: [{ q: 1, r: 1 }] })).open,
    ).toBe(false);
    expect(
      canFish(view({ hauls_left: 6, revealed: [shoal(1, 1)], pirate: { q: 1, r: 1 } })).open,
    ).toBe(false);
  });
  it("is closed when the supply is empty, and open otherwise", () => {
    expect(canFish(view({ hauls_left: 0, revealed: [shoal(1, 1)] })).open).toBe(false);
    expect(canFish(view({ hauls_left: 6, revealed: [shoal(1, 1)] })).open).toBe(true);
  });
});

describe("battleReady", () => {
  // Battle-ready: has not moved this turn and stands at a corner of an
  // opponent's pirate hex. Your own pirate is never a target.
  const ship = (id: number, moved: boolean) => ({
    id,
    owner: 0,
    e: E(V(0, 0, 0), V(1, -1, 1)),
    hold: {},
    left: 4,
    moved,
  });
  it("takes only the ships that have not moved", () => {
    const v = view({
      pirate: { q: 0, r: 0 },
      pirate_owner: 1,
      ships: [ship(1, false), ship(2, true)],
    });
    expect(battleReady(v, 0).map((s) => s.id)).toEqual([1]);
  });
  it("does not offer a second roll to a ship that already chased this turn", () => {
    // engine battleReady excludes a ship that has Fought; the view says so.
    const v = view({
      pirate: { q: 0, r: 0 },
      pirate_owner: 1,
      ships: [ship(1, false), { ...ship(2, false), fought: true }],
    });
    expect(battleReady(v, 0).map((s) => s.id)).toEqual([1]);
  });
  it("never offers a chase at your own pirate ship", () => {
    const v = view({ pirate: { q: 0, r: 0 }, pirate_owner: 0, ships: [ship(1, false)] });
    expect(battleReady(v, 0)).toEqual([]);
  });
});

describe("cargoDestination", () => {
  const harbour = { v: V(0, 0, 0), owner: 0, basin: {} };
  it("prefers a ship that is standing at one of your harbour settlements", () => {
    const v = view({
      harbours: [harbour],
      ships: [{ id: 7, owner: 0, e: E(V(0, 0, 0), V(1, -1, 1)), hold: {}, left: 4 }],
    });
    expect(cargoDestination(v, 0, false)).toEqual({ settler: false, at_ship: true, ship_id: 7 });
  });
  it("falls back to the basin when no ship is docked", () => {
    const v = view({ harbours: [harbour], ships: [] });
    expect(cargoDestination(v, 0, true)).toEqual({ settler: true, at_ship: false, v: V(0, 0, 0) });
  });
  it("is null when every slot is full", () => {
    const v = view({
      harbours: [{ ...harbour, basin: { crew: 2 } }],
      ships: [{ id: 7, owner: 0, e: E(V(0, 0, 0), V(1, -1, 1)), hold: { settler: 1 }, left: 4 }],
    });
    expect(cargoDestination(v, 0, false)).toBeNull();
  });
  it("knows a settler needs both slots and a crew needs one", () => {
    const v = view({ harbours: [{ ...harbour, basin: { crew: 1 } }], ships: [] });
    expect(cargoDestination(v, 0, false)).not.toBeNull();
    expect(cargoDestination(v, 0, true)).toBeNull();
  });
});

describe("holdCount and the prices", () => {
  it("counts everything aboard", () => {
    expect(holdCount({ id: 1, owner: 0, e: E(V(0, 0), V(1, -1, 1)), hold: {}, left: 0 })).toBe(0);
    expect(
      holdCount({
        id: 1,
        owner: 0,
        e: E(V(0, 0), V(1, -1, 1)),
        hold: { crew: 1, spice: 1 },
        left: 0,
      }),
    ).toBe(2);
  });
  it("prices a harbour settlement at two grain and two ore", () => {
    expect(canAfford([0, 0, 0, 0, 2, 2], EXPLORERS_COSTS.harbour)).toBe(true);
    expect(canAfford([0, 0, 0, 0, 2, 1], EXPLORERS_COSTS.harbour)).toBe(false);
  });
});

describe("offeredJobs", () => {
  it("keeps a fixed order", () => {
    const acts = [
      { job: "take_crew" as const, v: V(0, 0) },
      { job: "found" as const, v: V(0, 0) },
      { job: "land_crew" as const, v: V(0, 0) },
    ];
    expect(offeredJobs(acts)).toEqual(["found", "land_crew", "take_crew"]);
  });
  it("dedupes: two corners of one job are one button", () => {
    expect(
      offeredJobs([
        { job: "found", v: V(0, 0) },
        { job: "found", v: V(1, 1) },
      ]),
    ).toEqual(["found"]);
  });
});

describe("shipOffers", () => {
  it("gives a ship with no offer a row", () => {
    const v = view({ ships: [{ id: 3, owner: 0, e: E(V(0, 0), V(1, -1, 1)), hold: {}, left: 0 }] });
    const legal: LegalTargets = { explorer_ships: [] };
    expect(shipOffers(v, 0, legal)).toEqual([
      { ship: expect.objectContaining({ id: 3 }), moves: 0, acts: [], left: 0 },
    ]);
  });
});

describe("setupRound", () => {
  it("is null in play, and the module's own round during the draft", () => {
    expect(setupRound(view({ round: 2 }))).toBeNull();
    expect(setupRound(view({ round: 0 }, { phase: "setup" }))).toBe(0);
    expect(setupRound(view({ round: 1 }, { phase: "setup" }))).toBe(1);
    expect(setupRound(view({ round: 2 }, { phase: "setup" }))).toBe(2);
  });
});

describe("setupStep", () => {
  it("places the harbour settlement first, then the settlement", () => {
    expect(setupStep(view({ round: 0 }, { phase: "setup" }))).toBe("harbour");
    expect(setupStep(view({ round: 1 }, { phase: "setup" }))).toBe("settlement");
    expect(setupStep(view({ round: 2 }, { phase: "setup" }))).toBe("start");
    expect(setupStep(view({ round: 0 }))).toBeNull();
  });
  it("with Knights places the city first and the harbour settlement second", () => {
    const k = { phase: "setup", config: { ruleset: "cak+explorers" } } as Partial<FullView>;
    expect(setupStep(view({ round: 0 }, k))).toBe("city");
    expect(setupStep(view({ round: 1 }, k))).toBe("harbour");
    expect(setupStep(view({ round: 2 }, k))).toBe("start");
  });
});

describe("missionVP", () => {
  it("takes the server's number, tiles and all", () => {
    const v = view({ seats: [{ track: [1, 1, 1], mission_vp: 6 } as never] });
    expect(missionVP(v, 0)).toBe(6);
  });
  it("falls back to the track alone against a server that predates the field", () => {
    const v = view({ seats: [{ track: [7, 3, 0] } as never] });
    expect(missionVP(v, 0)).toBe(3 + 2 + 0);
  });
});

describe("the Explorers pirate ship after a 7", () => {
  // A player who rolled a 7 must be prompted to move the pirate.
  const ship = (owner: number, a: Vertex, b: Vertex) => ({ id: owner + 1, owner, e: { a, b } });
  const view = (over: Record<string, unknown> = {}) =>
    ({
      phase: "play",
      pending_discards: {},
      ext: {
        explorers: {
          pirate_by: 1,
          ships: [
            ship(0, { q: 0, r: 0, side: 0 }, { q: 0, r: -1, side: 1 }),
            ship(2, { q: 0, r: 0, side: 1 }, { q: 0, r: 1, side: 0 }),
            ship(1, { q: 0, r: 0, side: 0 }, { q: 0, r: -1, side: 1 }),
          ],
        },
      },
      ...over,
    }) as unknown as FullView;
  it("is owed by the roller once the discards are in", () => {
    expect(pirateOwed(view(), 1)).toBe(true);
    expect(pirateOwed(view(), 0)).toBe(false);
    expect(pirateOwed(view({ pending_discards: { 2: 4 } }), 1)).toBe(false);
  });
  it("robs every other owner with a ship on an edge of the hex", () => {
    expect(pirateVictimsAt(view(), { q: 0, r: 0 }, 1)).toEqual([0, 2]);
    expect(pirateVictimsAt(view(), { q: 5, r: 5 }, 1)).toEqual([]);
  });
  it("does not rob a ship that only reaches one of the hex's corners", () => {
    // (0,0,N) to (1,-2,S) runs between hexes (0,-1) and (1,-1): one end at a
    // corner of (0,0), but not one of its edges.
    const beside = view({
      ext: {
        explorers: {
          pirate_by: 1,
          ships: [ship(0, { q: 0, r: 0, side: 0 }, { q: 1, r: -2, side: 1 })],
        },
      },
    });
    expect(pirateVictimsAt(beside, { q: 0, r: 0 }, 1)).toEqual([]);
    expect(pirateVictimsAt(beside, { q: 0, r: -1 }, 1)).toEqual([0]);
  });
});

describe("cargoSwaps", () => {
  it("offers the whole exchange when neither side has room for anything", () => {
    // A settler aboard, two crews ashore: no one-way transfer fits either way.
    expect(cargoSwaps({ settler: 1 }, { crew: 2 })).toEqual([
      { give: null, take: null, cargo: { crew: 2 }, back: { settler: 1 } },
    ]);
  });

  it("offers a one-for-one swap where that is the whole job", () => {
    expect(cargoSwaps({ crew: 1 }, { settler: 1 })).toEqual([
      { give: "crew", take: "settler", cargo: { settler: 1 }, back: { crew: 1 } },
    ]);
  });

  it("offers nothing a plain load or unload already does", () => {
    expect(cargoSwaps({ crew: 1 }, { spice: 1 })).toEqual([]);
    expect(cargoSwaps({}, { crew: 2 })).toEqual([]);
    expect(cargoSwaps({ crew: 2 }, { crew: 2 })).toEqual([]);
  });

  it("never offers an exchange that would overfill a side", () => {
    // Two small pieces aboard, a haul ashore: one small for the haul leaves
    // three slots aboard, so only the whole exchange is legal.
    expect(cargoSwaps({ crew: 1, spice: 1 }, { haul: 1 })).toEqual([
      { give: null, take: null, cargo: { haul: 1 }, back: { crew: 1, spice: 1 } },
    ]);
  });
});
