import { describe, expect, it } from "vitest";
import { actionsAt, canAffordAction, isBoatEdge, pieceAt } from "./locationActions";
import { edgeHexes } from "./hexgeo";
import { type Edge, type FullView, type Vertex } from "./types";

const v = (q: number, r: number, side: 0 | 1): Vertex => ({ q, r, side });
const e = (a: Vertex, b: Vertex): Edge => ({ a, b });

// Minimal FullView with just the fields actionsAt reads.
function view(partial: Partial<FullView>): FullView {
  return {
    viewer: 0,
    board: { robber: { q: 0, r: 0 } },
    roads: [],
    buildings: [],
    players: [{ seat: 0, hand: [0, 9, 9, 9, 9, 9], roads_left: 9 }],
    config: { ruleset: "base" },
    ...partial,
  } as unknown as FullView;
}

const ids = (r: { id: string }[]) => r.map((a) => a.id);
const ranks = (r: { rank: number }[]) => r.map((a) => a.rank);

const spot = v(1, 0, 0);

// A three-hex neighbourhood: land at (0,0) and (0,1), sea at (1,-1).
//   coastal = the edge shared by (0,0) and the sea hex
//   inland  = the edge shared by (0,0) and (0,1)
// Derived from geometry rather than asserted by hand, so it stays coastal if
// the grid changes.
const coastal = e(v(0, 0, 0), v(1, -1, 1));
const inland = e(v(0, 0, 1), v(0, 1, 0));
const tiles = [
  { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
  { hex: { q: 0, r: 1 }, res: "ore", num: 5 },
  { hex: { q: 1, r: -1 }, res: "sea", num: 0 },
];

function boardView(ruleset: string, partial: Partial<FullView> = {}): FullView {
  return view({
    config: { ruleset },
    board: { radius: 2, tiles, robber: { q: 0, r: 0 }, harbors: [] },
    ...partial,
  } as unknown as Partial<FullView>);
}

describe("the fixture is what it claims", () => {
  it("coastal touches the sea hex, inland does not", () => {
    expect(edgeHexes(coastal)).toEqual(
      expect.arrayContaining([
        { q: 0, r: 0 },
        { q: 1, r: -1 },
      ]),
    );
    expect(edgeHexes(inland)).toEqual(
      expect.arrayContaining([
        { q: 0, r: 0 },
        { q: 0, r: 1 },
      ]),
    );
  });

  it("isBoatEdge is about the water and the ruleset, not about your ships", () => {
    expect(isBoatEdge(coastal, boardView("base+islands"))).toBe(true);
    expect(isBoatEdge(inland, boardView("base+islands"))).toBe(false);
    // Every board has a sea ring; without ships in the game it is not a boat
    // edge.
    expect(isBoatEdge(coastal, boardView("base"))).toBe(false);
    expect(isBoatEdge(coastal, boardView("base+cak"))).toBe(false);
  });
});

describe("the roster is fixed, the status moves", () => {
  it("does not change its ids or ranks when only the hand changes", () => {
    // The dial relies on a click always doing the same thing, regardless of
    // what you hold.
    const legal = { roads: [coastal], ships: [coastal] };
    const rich = boardView("base+islands", {
      legal,
      players: [{ seat: 0, hand: [0, 9, 9, 9, 9, 9], roads_left: 9 }],
    } as unknown as Partial<FullView>);
    const broke = boardView("base+islands", {
      legal,
      players: [{ seat: 0, hand: [0, 0, 0, 0, 0, 0], roads_left: 9 }],
    } as unknown as Partial<FullView>);

    const a = actionsAt({ kind: "edge", e: coastal }, rich);
    const b = actionsAt({ kind: "edge", e: coastal }, broke);
    expect(ids(a)).toEqual(ids(b));
    expect(ranks(a)).toEqual(ranks(b));
    expect(a.map((x) => x.status)).toEqual(["ready", "ready"]);
    expect(b.map((x) => x.status)).toEqual(["short", "short"]);
  });

  it("returns nothing at all for a spectator, who has no legal set", () => {
    expect(actionsAt({ kind: "vertex", v: spot }, view({}))).toEqual([]);
  });
});

describe("edge rosters", () => {
  it("offers only Build road on an inland edge, in any ruleset", () => {
    // Gated on terrain, not ruleset: no greyed Build ship inland.
    for (const ruleset of ["base", "base+islands"]) {
      const w = boardView(ruleset, { legal: { roads: [inland] } });
      expect(ids(actionsAt({ kind: "edge", e: inland }, w))).toEqual(["build_road"]);
    }
  });

  it("offers road then ship on a coastal edge in an Islands game", () => {
    const w = boardView("base+islands", {
      legal: { roads: [coastal], ships: [coastal] },
    });
    const got = actionsAt({ kind: "edge", e: coastal }, w);
    expect(ids(got)).toEqual(["build_road", "build_ship"]);
    expect(ranks(got)).toEqual([1, 2]);
  });

  it("keeps a blocked Build ship on a coastal edge", () => {
    const w = boardView("base+islands", { legal: { roads: [coastal], ships: [] } });
    const got = actionsAt({ kind: "edge", e: coastal }, w);
    expect(ids(got)).toEqual(["build_road", "build_ship"]);
    expect(got[1].status).toBe("blocked");
    expect(got[1].reason).toBe("Your ships do not reach this edge yet.");
  });

  it("offers only Move ship on an edge carrying your own ship", () => {
    // Move ship acts on your ship: legal.ship_moves is keyed by `from`, so the
    // clicked edge is the source.
    const w = boardView("base+islands", {
      legal: { roads: [coastal], ships: [coastal], ship_moves: [{ from: coastal, to: [inland] }] },
      ext: { islands: { ships: [{ e: coastal, owner: 0 }], ships_left: [9] } },
    });
    const got = actionsAt({ kind: "edge", e: coastal }, w);
    expect(ids(got)).toEqual(["move_ship"]);
    expect(got[0].status).toBe("ready");
    expect(got[0].mode).toBe("shipmove");
    // It only arms the move, which spares it the touch two-tap (the
    // destination tap confirms).
    expect(got[0].arms).toBe(true);
  });

  it("marks only the entries that arm a mode, never a commit", () => {
    const own = boardView("base+islands", {
      legal: { ship_moves: [{ from: coastal, to: [inland] }] },
      ext: { islands: { ships: [{ e: coastal, owner: 0 }], ships_left: [9] } },
    });
    expect(actionsAt({ kind: "edge", e: coastal }, own)[0].arms).toBe(true);
    const build = boardView("base+islands", { legal: { roads: [coastal], ships: [coastal] } });
    for (const a of actionsAt({ kind: "edge", e: coastal }, build)) expect(a.arms).toBeUndefined();
  });

  it("blocks Move ship on your ship that has nowhere to go", () => {
    const w = boardView("base+islands", {
      legal: { ship_moves: [] },
      ext: { islands: { ships: [{ e: coastal, owner: 0 }], ships_left: [9] } },
    });
    const got = actionsAt({ kind: "edge", e: coastal }, w);
    expect(ids(got)).toEqual(["move_ship"]);
    expect(got[0].status).toBe("blocked");
    expect(got[0].reason).toBe("This ship is not at the open end of a route.");
  });

  it("offers nothing on an opponent's ship or on any standing road", () => {
    const theirs = boardView("base+islands", {
      legal: { roads: [coastal] },
      ext: { islands: { ships: [{ e: coastal, owner: 1 }], ships_left: [9, 9] } },
    });
    expect(actionsAt({ kind: "edge", e: coastal }, theirs)).toEqual([]);

    const built = boardView("base+islands", {
      legal: { roads: [coastal] },
      roads: [{ e: coastal, owner: 0 }],
    });
    expect(actionsAt({ kind: "edge", e: coastal }, built)).toEqual([]);
  });

  it("says which piece supply ran out rather than guessing at connectivity", () => {
    const w = boardView("base", {
      legal: { roads: [] },
      players: [{ seat: 0, hand: [0, 9, 9, 9, 9, 9], roads_left: 0 }],
    } as unknown as Partial<FullView>);
    expect(actionsAt({ kind: "edge", e: inland }, w)[0].reason).toBe(
      "You have no road pieces left.",
    );
  });
});

describe("vertex rosters", () => {
  it("offers settlement then knight on an empty vertex under Knights", () => {
    const w = boardView("base+cak", {
      legal: { settlements: [spot], knights: [spot] },
    });
    const got = actionsAt({ kind: "vertex", v: spot }, w);
    expect(ids(got)).toEqual(["build_settlement", "build_knight"]);
    expect(ranks(got)).toEqual([1, 2]);
  });

  it("offers only settlement on an empty vertex in the base game", () => {
    const w = boardView("base", { legal: { settlements: [spot] } });
    expect(ids(actionsAt({ kind: "vertex", v: spot }, w))).toEqual(["build_settlement"]);
  });

  it("offers only Upgrade to city on your settlement", () => {
    const w = boardView("base+cak", {
      legal: { cities: [spot] },
      buildings: [{ v: spot, owner: 0, city: false }],
    });
    expect(ids(actionsAt({ kind: "vertex", v: spot }, w))).toEqual(["build_city"]);
  });

  it("offers only Build wall on your city", () => {
    const knightsView = boardView("base+cak", {
      legal: { walls: [spot] },
      buildings: [{ v: spot, owner: 0, city: true }],
    });
    expect(ids(actionsAt({ kind: "vertex", v: spot }, knightsView))).toEqual(["build_wall"]);

    const base = boardView("base", {
      legal: {},
      buildings: [{ v: spot, owner: 0, city: true }],
    });
    expect(actionsAt({ kind: "vertex", v: spot }, base)).toEqual([]);
  });

  it("offers nothing on an opponent's building", () => {
    const w = boardView("base+cak", {
      legal: { settlements: [spot] },
      buildings: [{ v: spot, owner: 1, city: false }],
    });
    expect(actionsAt({ kind: "vertex", v: spot }, w)).toEqual([]);
  });
});

describe("the knight roster is always four", () => {
  const knightView = (
    knight: Record<string, unknown>,
    extra: Partial<FullView> = {},
    knightsPlayer: Record<string, unknown> = { improve: [0, 0, 0] },
  ) =>
    boardView("base+cak", {
      legal: { knight_moves: [], ...(extra.legal ?? {}) },
      ext: {
        cak: {
          knights: [{ v: spot, owner: 0, level: 1, active: false, ...knight }],
          players: [knightsPlayer],
        },
      },
      ...extra,
    });

  it("offers the server's adjacent path-barbarian chase with its stable id", () => {
    const w = knightView(
      { active: true },
      { legal: { knight_edge_chases: [{ v: spot, barb: 7 }] } },
    );
    const action = actionsAt({ kind: "vertex", v: spot }, w).find(
      (a) => a.id === "chase_barbarian_7",
    );
    expect(action?.cmd).toEqual({ type: "chase_robber", data: { v: spot, barb: 7 } });
  });

  it("lists activate, promote, move, chase in rank order whatever the state", () => {
    for (const k of [
      { active: false, level: 1 },
      { active: true, level: 2, freshly_activated: true },
      { active: true, level: 3 },
    ]) {
      const got = actionsAt({ kind: "vertex", v: spot }, knightView(k));
      expect(ids(got)).toEqual([
        "activate_knight",
        "promote_knight",
        "move_knight",
        "chase_robber",
      ]);
      expect(ranks(got)).toEqual([1, 2, 3, 4]);
      // Move and Chase arm a mode; Activate and Promote are commands.
      expect(got.map((a) => a.arms === true)).toEqual([false, false, true, true]);
    }
  });

  it("blocks Activate on a knight that is already active", () => {
    const got = actionsAt({ kind: "vertex", v: spot }, knightView({ active: true }));
    expect(got[0].status).toBe("blocked");
    expect(got[0].reason).toBe("This knight is already active.");
  });

  it("names the next strength for Promote", () => {
    expect(actionsAt({ kind: "vertex", v: spot }, knightView({ level: 1 }))[1].label).toBe(
      "Promote to strength 2",
    );
    const maxed = actionsAt({ kind: "vertex", v: spot }, knightView({ level: 3 }))[1];
    expect(maxed.label).toBe("Promote");
    expect(maxed.reason).toBe("This knight is already at full strength.");
  });

  // The flag is per knight, so other knights keep Promote.
  it("blocks Promote on the knight that was already promoted this turn", () => {
    const w = knightView({ level: 1, promoted_this_turn: true });
    expect(actionsAt({ kind: "vertex", v: spot }, w)[1].reason).toBe(
      "This knight has already been promoted this turn.",
    );
  });

  it("blocks Promote to strength 3 without Politics level 3", () => {
    const w = knightView({ level: 2 }, {}, { improve: [0, 2, 0] });
    expect(actionsAt({ kind: "vertex", v: spot }, w)[1].reason).toBe(
      "A strength 3 knight needs Politics level 3, the Fortress.",
    );
  });

  it("blocks Move until the knight is activated, then until next turn", () => {
    const inactive = actionsAt({ kind: "vertex", v: spot }, knightView({ active: false }))[2];
    expect(inactive.reason).toBe("Activate this knight first.");

    const fresh = actionsAt(
      { kind: "vertex", v: spot },
      knightView({ active: true, freshly_activated: true }),
    )[2];
    expect(fresh.reason).toBe("This knight was activated this turn. It can move next turn.");
  });

  it("blocks Chase robber when the robber is not next to this knight", () => {
    const got = actionsAt(
      { kind: "vertex", v: spot },
      knightView({ active: true, freshly_activated: false }),
    );
    expect(got[3].status).toBe("blocked");
    expect(got[3].reason).toBe("The robber is not next to this knight.");
  });
});

describe("affordability", () => {
  const legalRoad = { legal: { roads: [inland] } } as Partial<FullView>;

  it("marks an entry short and says which resource is missing", () => {
    const w = boardView("base", {
      ...legalRoad,
      players: [{ seat: 0, hand: [0, 1, 0, 0, 0, 0], roads_left: 9 }],
    } as unknown as Partial<FullView>);
    const got = actionsAt({ kind: "edge", e: inland }, w)[0];
    expect(got.status).toBe("short");
    expect(got.missing).toEqual([2]);
    expect(got.reason).toBe("You need 1 more brick.");
  });

  it("treats a road under a Road Building grant as ready with an empty hand", () => {
    const w = boardView("base", {
      ...legalRoad,
      free_roads: 2,
      players: [{ seat: 0, hand: [0, 0, 0, 0, 0, 0], roads_left: 9 }],
    } as unknown as Partial<FullView>);
    expect(actionsAt({ kind: "edge", e: inland }, w)[0].status).toBe("ready");
  });

  it("canAffordAction says yes to a costless mode entry", () => {
    const w = boardView("base+islands", {
      ext: { islands: { ships: [{ e: coastal, owner: 0 }], ships_left: [9] } },
      legal: { ship_moves: [{ from: coastal, to: [inland] }] },
    });
    const move = actionsAt({ kind: "edge", e: coastal }, w)[0];
    expect(canAffordAction(move, w)).toBe(true);
  });
});

describe("pieceAt names the piece at a spot, and whose it is", () => {
  it("finds your knight, settlement, city, road and ship", () => {
    const kn = boardView("base+cak", {
      ext: { cak: { knights: [{ v: spot, owner: 0, level: 1, active: false }] } },
    });
    expect(pieceKindAt({ kind: "vertex", v: spot }, kn)).toBe("knight");

    // The three tiers are different models; previewing the wrong one shows the
    // wrong piece.
    const strong = boardView("base+cak", {
      ext: { cak: { knights: [{ v: spot, owner: 0, level: 2, active: true }] } },
    });
    expect(pieceKindAt({ kind: "vertex", v: spot }, strong)).toBe("knight_strong");

    const mighty = boardView("base+cak", {
      ext: { cak: { knights: [{ v: spot, owner: 0, level: 3, active: true }] } },
    });
    expect(pieceKindAt({ kind: "vertex", v: spot }, mighty)).toBe("knight_mighty");

    const settle = boardView("base", {
      buildings: [{ v: spot, owner: 0, city: false }],
    });
    expect(pieceKindAt({ kind: "vertex", v: spot }, settle)).toBe("settlement");

    const city = boardView("base", {
      buildings: [{ v: spot, owner: 0, city: true }],
    });
    expect(pieceKindAt({ kind: "vertex", v: spot }, city)).toBe("city");

    const road = boardView("base", {
      roads: [{ e: inland, owner: 0 }],
    });
    expect(pieceKindAt({ kind: "edge", e: inland }, road)).toBe("road");

    const ship = boardView("base+islands", {
      ext: { islands: { ships: [{ e: coastal, owner: 0 }], ships_left: [9] } },
    });
    expect(pieceKindAt({ kind: "edge", e: coastal }, ship)).toBe("ship");
  });

  it("says nothing for an empty spot", () => {
    expect(pieceAt({ kind: "vertex", v: spot }, boardView("base"))).toBeNull();
  });

  it("reports an opponent's piece, and whose it is", () => {
    // Diplomat and Intrigue fade someone else's piece, so the owner comes back
    // and the preview uses their colour.
    const theirs = boardView("base", {
      roads: [{ e: inland, owner: 2 }],
    });
    expect(pieceAt({ kind: "edge", e: inland }, theirs)).toEqual({ kind: "road", owner: 2 });
  });
});

describe("a spot that can never take a settlement does not offer one", () => {
  const near = v(1, -1, 1); // a neighbour of `spot`, per vertexNeighbors

  it("drops Build settlement beside another building, rather than greying it", () => {
    // The distance rule is permanent (buildings never leave a vertex), so the
    // entry is dropped rather than greyed.
    const w = boardView("base+cak", {
      legal: { knights: [spot] },
      buildings: [{ v: near, owner: 1, city: false }],
    });
    expect(ids(actionsAt({ kind: "vertex", v: spot }, w))).toEqual(["build_knight"]);
  });

  it("still offers it when the neighbour is empty, blocked or not", () => {
    // Not yet connected to your roads is temporary, so it stays and greys.
    const w = boardView("base", { legal: { settlements: [] } });
    const got = actionsAt({ kind: "vertex", v: spot }, w);
    expect(ids(got)).toEqual(["build_settlement"]);
    expect(got[0].status).toBe("blocked");
    expect(got[0].reason).toBe("No road of yours reaches this spot.");
  });
});

// pieceKindAt keeps the cases above terse.
function pieceKindAt(loc: Parameters<typeof pieceAt>[0], w: FullView) {
  return pieceAt(loc, w)?.kind ?? null;
}

describe("a bridge site offers the bridge alone", () => {
  // A road may never cross the channel, so no greyed "Build road" on a bridge
  // site.
  const rivers = (sites: Edge[]) =>
    boardView("base+rivers", {
      ext: { rivers: { sites, bridges: [], bridges_left: [3], bridge_cost: [0, 1, 2, 0, 0, 0] } },
      legal: { roads: [inland], bridges: [] },
    });
  it("drops the road on a site and keeps it everywhere else", () => {
    expect(ids(actionsAt({ kind: "edge", e: inland }, rivers([inland])))).toEqual(["build_bridge"]);
    expect(ids(actionsAt({ kind: "edge", e: inland }, rivers([coastal])))).toEqual(["build_road"]);
  });
});
