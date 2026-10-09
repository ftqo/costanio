import { describe, expect, it } from "vitest";
import { hexLabel, planInfoTargets, portLabel, type InfoTarget } from "./boardInfo";
import { hexKey, vertexKey } from "./hexgeo";
import type { Edge, FullView, Vertex } from "./types";

const v = (q: number, r: number, side: 0 | 1): Vertex => ({ q, r, side });
const e = (a: Vertex, b: Vertex): Edge => ({ a, b });

// The robber's hex, and a tile for it to stand on: the robber is described only
// when on the board (`robberOnBoard`), which the wire signals by coordinate.
const ROBBER_HEX = { q: 9, r: 9 };
const ROBBER_TILE = { hex: ROBBER_HEX, res: "ore", num: 5 };

// Minimal FullView with just the fields planInfoTargets reads, cast through
// unknown (as in locationActions.test).
function view(partial: Partial<FullView>): FullView {
  return {
    viewer: 0,
    buildings: [],
    roads: [],
    board: { robber: ROBBER_HEX, harbors: [], tiles: [ROBBER_TILE] },
    ...partial,
  } as unknown as FullView;
}

const home = v(1, 0, 0);
const other = v(2, 0, 0);
const lane = e(v(0, 0, 0), v(0, 0, 1));

/** The described thing at a vertex, or undefined. */
function atVertex(targets: InfoTarget[], want: Vertex) {
  return targets.find((t) => t.kind === "vertex" && t.v && vertexKey(t.v) === vertexKey(want))
    ?.info;
}

describe("planInfoTargets: base game", () => {
  it("names a settlement and its owner", () => {
    const got = atVertex(
      planInfoTargets(view({ buildings: [{ v: home, owner: 2, city: false }] })),
      home,
    );
    expect(got?.title).toBe("Settlement");
    expect(got?.owner).toBe(2);
    expect(got?.facts).toContain("Worth 1 victory point");
  });

  it("names a city", () => {
    const got = atVertex(
      planInfoTargets(view({ buildings: [{ v: home, owner: 0, city: true }] })),
      home,
    );
    expect(got?.title).toBe("City");
    expect(got?.facts).toContain("Worth 2 victory points");
  });

  // A road has no rank or state; its colour says all there is. See the module
  // note.
  it("says nothing about a road", () => {
    const got = planInfoTargets(view({ roads: [{ e: lane, owner: 3 }] }));
    expect(got.map((t) => t.info.title)).not.toContain("Road");
  });

  it("describes the robber, and gives it no owner", () => {
    const got = planInfoTargets(view({})).find((t) => t.info.title === "Robber");
    expect(got).toBeDefined();
    expect(got?.info.owner).toBeUndefined();
  });

  // docs/rules/scenarios.md: "The robber starts beside the board and enters
  // play on the first 7", and the two-fish spend puts it back. The wire says so
  // with a hex outside every tile.
  it("says nothing about a robber that is not on the board", () => {
    const beside = view({
      board: { robber: { q: -9999, r: -9999 }, harbors: [], tiles: [ROBBER_TILE] } as never,
    });
    expect(planInfoTargets(beside).find((t) => t.info.title === "Robber")).toBeUndefined();
  });

  // An opponent's piece is as readable as your own, and a spectator (viewer -1)
  // sees what the players see.
  it("describes the board identically for a spectator", () => {
    const board = { buildings: [{ v: home, owner: 1, city: true }] };
    const seated = planInfoTargets(view({ ...board, viewer: 0 }));
    const watching = planInfoTargets(view({ ...board, viewer: -1 }));
    expect(watching).toEqual(seated);
  });

  // Empty buildable spots are the ghost's job, not this one.
  it("says nothing about a bare intersection", () => {
    expect(
      atVertex(planInfoTargets(view({ legal: { settlements: [other] } })), other),
    ).toBeUndefined();
  });
});

describe("planInfoTargets: ports", () => {
  const harbor = { verts: [home, other], ratio: 2, res: "wheat" as const };

  // Harbormaster scores buildings on harbours; the port says so, only in a game
  // where it applies.
  it("says what a harbour building is worth in the Harbormaster race", () => {
    const board = { robber: ROBBER_HEX, harbors: [harbor], tiles: [ROBBER_TILE] } as never;
    const hm = { ruleset: "base+harbormaster" } as never;
    const got = planInfoTargets(
      view({ config: hm, board, buildings: [{ v: home, owner: 0, city: true }] }),
    );
    expect(atVertex(got, home)?.facts).toContain("Worth 2 harbour points toward the Harbormaster");
    expect(atVertex(got, other)?.facts).toContain(
      "Harbour points toward the Harbormaster: 1 for a settlement here, 2 for a city",
    );
    const plain = planInfoTargets(
      view({
        config: { ruleset: "base" } as never,
        board,
        buildings: [{ v: home, owner: 0, city: true }],
      }),
    );
    expect((atVertex(plain, home)?.facts ?? []).join(" ")).not.toContain("harbour point");
    expect((atVertex(plain, other)?.facts ?? []).join(" ")).not.toContain("Harbour point");
  });

  it("labels the trade a port grants", () => {
    expect(portLabel(harbor)).toBe("2:1 wheat");
    expect(portLabel({ verts: [], ratio: 3, res: "none" })).toBe("3:1 any");
  });

  it("describes an unclaimed port on both its vertices", () => {
    const got = planInfoTargets(
      view({ board: { robber: ROBBER_HEX, harbors: [harbor], tiles: [ROBBER_TILE] } as never }),
    );
    expect(atVertex(got, home)?.title).toBe("Harbour");
    expect(atVertex(got, other)?.title).toBe("Harbour");
  });

  // A settlement on a port is one thing the player is pointing at.
  it("folds a port into the building standing on it", () => {
    const got = planInfoTargets(
      view({
        buildings: [{ v: home, owner: 0, city: false }],
        board: { robber: ROBBER_HEX, harbors: [harbor], tiles: [ROBBER_TILE] } as never,
      }),
    );
    const here = atVertex(got, home);
    expect(here?.title).toBe("Settlement");
    expect(here?.facts).toContain("Trades 2:1 wheat with the bank");
    expect(
      got.filter((t) => t.kind === "vertex" && t.v && vertexKey(t.v) === vertexKey(home)),
    ).toHaveLength(1);
  });
});

describe("planInfoTargets: Knights", () => {
  // Whether the Knights robber rule applies comes from `config`; the ext only
  // supplies the count.
  const knightsView = (partial: Record<string, unknown>) =>
    ({
      config: { ruleset: "base+cak" },
      ext: { cak: { knights: [], players: [], attacks: 1, walled: [], ...partial } },
    }) as unknown as Partial<FullView>;

  it("gives a knight its strength and its state", () => {
    const got = atVertex(
      planInfoTargets(
        view(
          knightsView({
            knights: [{ v: home, owner: 1, level: 2, active: true, freshly_activated: false }],
          }),
        ),
      ),
      home,
    );
    expect(got?.title).toBe("Knight");
    expect(got?.owner).toBe(1);
    expect(got?.facts[0]).toBe("Strength 2 of 3");
    expect(got?.facts).toContain("Active: adds 2 to the barbarian defense");
  });

  it("says an inactive knight cannot act", () => {
    const got = atVertex(
      planInfoTargets(
        view(
          knightsView({
            knights: [{ v: home, owner: 1, level: 1, active: false, freshly_activated: false }],
          }),
        ),
      ),
      home,
    );
    expect(got?.facts).toContain(
      "Inactive: adds nothing to the defense and cannot act (activate for 1 wheat)",
    );
  });

  it("flags a knight that was activated this turn", () => {
    const got = atVertex(
      planInfoTargets(
        view(
          knightsView({
            knights: [{ v: home, owner: 0, level: 1, active: true, freshly_activated: true }],
          }),
        ),
      ),
      home,
    );
    expect(got?.facts).toContain("Activated this turn: cannot move yet");
  });

  it("renames a city that carries a metropolis, and notes a wall", () => {
    const got = atVertex(
      planInfoTargets(
        view({
          buildings: [{ v: home, owner: 0, city: true }],
          ...knightsView({
            walled: [home],
            players: [{ metropolis: [false, true, false], metropolis_at: [home, home, home] }],
          }),
        }),
      ),
      home,
    );
    expect(got?.title).toBe("Politics Metropolis");
    // The city's 2 and the metropolis's own 2.
    expect(got?.facts).toContain("Worth 4 victory points");
    expect(got?.facts).toContain("Walled: holds 2 extra cards on a 7");
  });

  // The robber sits out until the barbarians land.
  it("hides the robber while it is still out of play", () => {
    const before = planInfoTargets(view(knightsView({ attacks: 0 })));
    expect(before.find((t) => t.info.title === "Robber")).toBeUndefined();
    const after = planInfoTargets(view(knightsView({ attacks: 1 })));
    expect(after.find((t) => t.info.title === "Robber")).toBeDefined();
  });

  // A Knights view in setup has no ext; that must not read as "base game".
  it("hides the robber in a Knights game whose ext has not arrived", () => {
    const got = planInfoTargets(view({ config: { ruleset: "base+cak" } } as never));
    expect(got.find((t) => t.info.title === "Robber")).toBeUndefined();
  });

  it("still shows the robber in a base game, which has no ext at all", () => {
    const got = planInfoTargets(view({ config: { ruleset: "base" } } as never));
    expect(got.find((t) => t.info.title === "Robber")).toBeDefined();
  });

  it("credits the merchant to whoever is holding it", () => {
    const got = planInfoTargets(
      view(
        knightsView({
          merchant: { q: 1, r: 1 },
          players: [{ merchant_vp: 0 }, { merchant_vp: 1 }],
        }),
      ),
    ).find((t) => t.info.title === "Merchant");
    expect(got?.info.owner).toBe(1);
  });
});

// The coastal fishing grounds: what each number pays, and to whom.
describe("planInfoTargets: the fishing grounds", () => {
  const seaA = { q: 3, r: -3 };
  const seaB = { q: -3, r: 3 };

  /** A Fishermen view carrying grounds exactly as the wire sends them. */
  function ground(grounds?: { v: unknown[]; number: number; hex?: unknown }[]) {
    return view({
      config: { ruleset: "base+fishermen" },
      ext: { fishermen: { grounds } },
      board: { robber: { q: 9, r: 9 }, harbors: [], tiles: [] },
    } as unknown as Partial<FullView>);
  }

  const cards = (targets: InfoTarget[]) => targets.filter((t) => t.info.title === "Fishing ground");

  it("says what a ground pays, at the ground", () => {
    const got = planInfoTargets(ground([{ v: [], number: 8, hex: seaA }]));
    expect(cards(got)).toHaveLength(1);
    expect(cards(got)[0].info.facts).toContain("Pays fish on 8");
    // Tiles, not fish: a tile is worth 1 to 3 fish.
    expect(cards(got)[0].info.facts).toContain(
      "Each neighbouring settlement draws 1 fish tile, each city 2",
    );
    expect(cards(got)[0].h).toEqual(seaA);
  });

  // Each ground carries its own number, and a cramped coastline drops the
  // highest first, so no hardcoded list could be right.
  it("reads each ground's own number off the wire", () => {
    const got = cards(
      planInfoTargets(
        ground([
          { v: [], number: 4, hex: seaA },
          { v: [], number: 10, hex: seaB },
        ]),
      ),
    );
    expect(got).toHaveLength(2);
    expect(got.map((t) => t.info.facts[0]).sort()).toEqual(["Pays fish on 10", "Pays fish on 4"]);
  });

  // As for the lake: an older server means saying less.
  it("stays quiet when the server sends no grounds, or one with no hex", () => {
    expect(cards(planInfoTargets(ground(undefined)))).toHaveLength(0);
    expect(cards(planInfoTargets(ground([])))).toHaveLength(0);
    expect(cards(planInfoTargets(ground([{ v: [], number: 6 }])))).toHaveLength(0);
  });

  it("says nothing when Fishermen is not in the ruleset", () => {
    const got = planInfoTargets(
      view({
        config: { ruleset: "base" },
        ext: { fishermen: { grounds: [{ v: [], number: 8, hex: seaA }] } },
        board: { robber: { q: 9, r: 9 }, harbors: [], tiles: [] },
      } as unknown as Partial<FullView>),
    );
    expect(cards(got)).toHaveLength(0);
  });
});

// A lake's numbers do not fit `BoardTile.num`, so the hover states them.
describe("planInfoTargets: the lake", () => {
  const lakeAt = { q: 2, r: -1 };

  /** A Fishermen view with one lake on the board and the wire's numbers. */
  function fish(lake_numbers?: number[], tiles?: { hex: { q: number; r: number }; res: string }[]) {
    return view({
      config: { ruleset: "base+fishermen" },
      ext: { fishermen: { lake_numbers } },
      board: {
        robber: { q: 9, r: 9 },
        harbors: [],
        tiles: tiles ?? [{ hex: lakeAt, res: "lake" }],
      },
    } as unknown as Partial<FullView>);
  }

  const lakeCard = (targets: InfoTarget[]) => targets.find((t) => t.info.title === "Lake")?.info;

  it("says what a lake pays, at the lake", () => {
    const got = planInfoTargets(fish([2, 3, 11, 12]));
    const card = lakeCard(got);
    expect(card?.facts).toContain("Pays fish on 2, 3, 11, and 12");
    expect(card?.facts).toContain("Each neighbouring settlement draws 1 fish tile, each city 2");
    // Anchored on the lake hex itself.
    expect(got.find((t) => t.info.title === "Lake")?.h).toEqual(lakeAt);
  });

  // The card follows the wire's `lake_numbers`; a hardcoded [2, 3, 11, 12]
  // would pass the test above and fail this one.
  it("reads the numbers off the wire, not out of a constant", () => {
    expect(lakeCard(planInfoTargets(fish([4, 5])))?.facts).toContain("Pays fish on 4 and 5");
    expect(lakeCard(planInfoTargets(fish([7])))?.facts).toContain("Pays fish on 7");
  });

  // Derivation 13: from five seats the second lake pays on 4 and 10 only, so
  // each card reads its own set from `lakes`.
  it("gives each lake its own numbers when the wire names them per lake", () => {
    const other = { q: -2, r: 1 };
    const got = planInfoTargets(
      view({
        config: { ruleset: "base+fishermen" },
        ext: {
          fishermen: {
            lake_numbers: [2, 3, 11, 12],
            lakes: [
              { hex: lakeAt, numbers: [4, 10] },
              { hex: other, numbers: [2, 3, 11, 12] },
            ],
          },
        },
        board: {
          robber: { q: 9, r: 9 },
          harbors: [],
          tiles: [
            { hex: lakeAt, res: "lake" },
            { hex: other, res: "lake" },
          ],
        },
      } as unknown as Partial<FullView>),
    );
    const at = (h: { q: number; r: number }) =>
      got.find((t) => t.info.title === "Lake" && t.h?.q === h.q && t.h?.r === h.r)?.info;
    expect(at(lakeAt)?.facts).toContain("Pays fish on 4 and 10");
    expect(at(other)?.facts).toContain("Pays fish on 2, 3, 11, and 12");
  });

  it("describes every lake on a board that has several", () => {
    const got = planInfoTargets(
      fish(
        [2, 3, 11, 12],
        [
          { hex: lakeAt, res: "lake" },
          { hex: { q: -2, r: 1 }, res: "lake" },
          { hex: { q: 0, r: 0 }, res: "wood" },
        ],
      ),
    );
    expect(got.filter((t) => t.info.title === "Lake")).toHaveLength(2);
  });

  it("says nothing about a hex that is not a lake", () => {
    const got = planInfoTargets(fish([2, 3, 11, 12], [{ hex: { q: 0, r: 0 }, res: "wheat" }]));
    expect(lakeCard(got)).toBeUndefined();
  });

  // No Fishermen, no lakes.
  it("says nothing when Fishermen is not in the ruleset", () => {
    const got = planInfoTargets(
      view({
        config: { ruleset: "base" },
        ext: { fishermen: { lake_numbers: [2, 3, 11, 12] } },
        board: { robber: { q: 9, r: 9 }, harbors: [], tiles: [{ hex: lakeAt, res: "lake" }] },
      } as unknown as Partial<FullView>),
    );
    expect(lakeCard(got)).toBeUndefined();
  });

  // An older server sends no numbers; say nothing rather than guess.
  it("stays quiet when the server sends no numbers", () => {
    expect(lakeCard(planInfoTargets(fish(undefined)))).toBeUndefined();
    expect(lakeCard(planInfoTargets(fish([])))).toBeUndefined();
  });

  // A neutral piece on a lake is what the player means; the picker breaks a
  // hex tie in favour of the earlier entry.
  it("lets a piece standing on the hex win the tie", () => {
    const got = planInfoTargets(
      view({
        config: { ruleset: "base+fishermen" },
        ext: { fishermen: { lake_numbers: [2, 3, 11, 12] } },
        board: { robber: lakeAt, harbors: [], tiles: [{ hex: lakeAt, res: "lake" }] },
      } as unknown as Partial<FullView>),
    );
    const first = got.filter((t) => t.key === `h:${hexKey(lakeAt)}`)[0];
    expect(first?.info.title).toBe("Robber");
  });
});

describe("hexLabel", () => {
  // Axial coordinates mean nothing to a player; name a hex by what is printed
  // on it.
  it("names a hex by its terrain and number", () => {
    expect(hexLabel({ res: "ore", num: 6 })).toBe("ore 6");
    expect(hexLabel({ res: "wood" })).toBe("wood");
    expect(hexLabel(undefined)).toBe("this hex");
  });

  // A Wagons trade hex can sit on the desert or the Fishermen lake.
  it("names the hexes with no resource by what they are", () => {
    expect(hexLabel({ res: "none", num: 0 })).toBe("desert");
    expect(hexLabel({ res: "lake", num: 0 })).toBe("lake");
    expect(hexLabel({ res: "gold", num: 9 })).toBe("gold field");
  });
});

describe("scenario hexes describe themselves", () => {
  const hexInfo = (v: unknown) =>
    planInfoTargets(v as Parameters<typeof planInfoTargets>[0]).filter((x) => x.kind === "hex");
  const board = { radius: 2, tiles: [], harbors: [], robber: { q: 99, r: 99 } };

  // There is no trade-hex tile yet, so the card names each role and what it
  // takes.
  it("names each Wagons trade hex and what it takes", () => {
    const trade = [0, 1, 2].map((role) => ({
      hex: { q: role, r: -role },
      role,
      plaza: { q: role, r: -role, side: 2 },
      accepts: [],
      ships: [],
      left: 12,
    }));
    const got = hexInfo({
      config: { ruleset: "base+wagons" },
      board,
      buildings: [],
      ext: { wagons: { has_trade: true, trade } },
    });
    expect(got.map((x) => x.info.title)).toEqual(["Castle", "Quarry", "Glassworks"]);
    expect(got[1].info.facts).toContain("Takes tools");
  });

  // Three small neutral figures decide whether a hex pays.
  it("counts the raiders on a coastal hex and says when it is conquered", () => {
    const got = hexInfo({
      config: { ruleset: "base+raiders" },
      board,
      buildings: [],
      ext: {
        raiders: {
          coast: [
            { q: 2, r: 0 },
            { q: -2, r: 0 },
            { q: 0, r: 2 },
          ],
          raider_count: [2, 3, 0],
        },
      },
    });
    expect(got).toHaveLength(2);
    expect(got[0].info.facts[0]).toBe("2 raiders here. Three conquer the hex");
    expect(got[1].info.facts[0]).toBe("Conquered: this hex produces nothing");
  });
});

describe("the Explorers Council describes itself", () => {
  // What the Council's anchors are for, and what a lair or a farm counts.
  it("names the Council hex and the fog", () => {
    const got = planInfoTargets({
      config: { ruleset: "explorers" },
      board: { radius: 5, tiles: [], harbors: [], robber: { q: 99, r: 99 } },
      buildings: [],
      ext: { explorers: { council: { q: -1, r: 0 }, fog: [{ q: 2, r: 0 }] } },
    } as unknown as Parameters<typeof planInfoTargets>[0]).filter((x) => x.kind === "hex");
    expect(got.map((x) => x.info.title)).toEqual(["The Council", "Unexplored"]);
  });

  const explorers = (revealed: unknown[]) =>
    planInfoTargets({
      config: { ruleset: "explorers" },
      board: { radius: 5, tiles: [], harbors: [], robber: { q: 99, r: 99 } },
      buildings: [],
      ext: { explorers: { revealed } },
    } as unknown as Parameters<typeof planInfoTargets>[0]).filter((x) => x.kind === "hex");
  const gold = (crews: number[] | undefined, captured = false) => ({
    h: { q: 1, r: -1 },
    region: 0,
    kind: 1,
    crews,
    captured,
  });

  it("a lair counts its crews against the three that capture it", () => {
    const facts = (crews?: number[]) => explorers([gold(crews)])[0].info.facts[0];
    expect(explorers([gold([0, 0])])[0].info.title).toBe("Pirate lair");
    expect(facts(undefined)).toBe("No crews here yet. 3 crews capture it");
    expect(facts([0, 1])).toBe("1 crew here. 3 crews capture it");
    expect(facts([1, 1])).toBe("2 crews here. 3 crews capture it");
    expect(facts([2, 0, 1])).toBe("3 crews here. 3 crews capture it");
    expect(explorers([gold([1])])[0].info.facts[1]).toBe("Produces nothing until captured");
    expect(explorers([gold([1])])[0].key).toBe("h:1,-1");
  });

  it("a captured field says what it pays, and who is still standing on it", () => {
    const got = explorers([gold([0, 2], true)])[0].info;
    expect(got.title).toBe("Gold field");
    expect(got.facts).toEqual([
      "Captured: pays 2 gold per adjacent building when its number is rolled",
      "2 crews still here",
    ]);
    expect(explorers([gold(undefined, true)])[0].info.facts).toHaveLength(1);
  });

  it("a spice farm counts the seats that have landed their one crew", () => {
    const farm = (farmers?: boolean[]) =>
      explorers([{ h: { q: 0, r: 2 }, region: 0, kind: 3, farmers }])[0].info;
    expect(farm(undefined).title).toBe("Spice farm");
    expect(farm(undefined).facts[0]).toBe("No crew has landed here yet");
    expect(farm([false, true]).facts[0]).toBe("1 player has landed a crew here");
    expect(farm([true, true, false, true]).facts[0]).toBe("3 players have landed a crew here");
    // A shoal is described nowhere here.
    expect(explorers([{ h: { q: 0, r: 3 }, region: 0, kind: 2 }])).toEqual([]);
  });
});
