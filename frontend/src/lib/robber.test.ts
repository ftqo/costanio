import { test, expect, describe, it } from "vitest";
import {
  robberVictimSeats,
  pirateVictimSeats,
  friendlyShieldMaxVP,
  canChaseRobber,
  chaseRobberBlock,
  robberAteRoll,
  robberBlockedTile,
  victimPromptStale,
} from "./robber";
import { hexVertices, vertexHexes } from "./hexgeo";
import type { Hex, Vertex } from "./types";

const HEX: Hex = { q: 0, r: 0 };
const V = hexVertices(HEX); // six corners of HEX

// Four seats around HEX: viewer (0), a protected opponent at the starting score
// (1, vp 2), an unprotected opponent (2, vp 3), and a card-less opponent (3).
const buildings = [
  { v: V[0], owner: 1 },
  { v: V[1], owner: 2 },
  { v: V[2], owner: 3 },
  { v: V[3], owner: 0 }, // viewer's own building, never a victim
];
const players = [
  { seat: 0, hand_count: 5, vp: 6 },
  { seat: 1, hand_count: 3, vp: 2 },
  { seat: 2, hand_count: 3, vp: 3 },
  { seat: 3, hand_count: 0, vp: 4 },
];

test("robberVictimSeats: toggle off includes all card holders", () => {
  const got = robberVictimSeats(HEX, buildings, players, 0, null).sort();
  expect(got).toEqual([1, 2]); // 0 is viewer, 3 has no cards
});

test("robberVictimSeats: friendly robber excludes vp<=2", () => {
  const got = robberVictimSeats(HEX, buildings, players, 0, 2);
  expect(got).toEqual([2]); // seat 1 (vp 2) is shielded; seat 2 (vp 3) is fair game
});

test("robberVictimSeats: vp boundary: exactly 2 is protected, 3 is not", () => {
  const ps = [
    { seat: 0, hand_count: 5, vp: 6 },
    { seat: 1, hand_count: 3, vp: 2 },
    { seat: 2, hand_count: 3, vp: 3 },
  ];
  expect(robberVictimSeats(HEX, buildings, ps, 0, 2)).toEqual([2]);
});

test("robberVictimSeats: shield uses the served starting score", () => {
  // A ruleset that deals a city at setup starts every seat on 3, so the
  // shield must follow the server's number, not a fixed 2.
  const ps = [
    { seat: 0, hand_count: 5, vp: 6 },
    { seat: 1, hand_count: 3, vp: 3 },
    { seat: 2, hand_count: 3, vp: 4 },
  ];
  expect(robberVictimSeats(HEX, buildings, ps, 0, 3)).toEqual([2]);
  expect(pirateVictimSeats(HEX, ships, ps, 0, 3)).toEqual([2]);
});

test("friendlyShieldMaxVP reads the view, not the config switch", () => {
  // The switch can be on where the shield does not apply (a ruleset with no
  // robber); the server then sends no threshold and nobody is shielded.
  expect(friendlyShieldMaxVP({ friendly_robber_max_vp: 3 })).toBe(3);
  expect(friendlyShieldMaxVP({})).toBeNull();
});

test("robberVictimSeats: buildings off the chosen hex are ignored", () => {
  const farHex: Hex = { q: 5, r: -2 };
  expect(robberVictimSeats(farHex, buildings, players, 0, null)).toEqual([]);
});

test("robberVictimSeats: commodity-only hand is a victim", () => {
  // Seat 3 has no resources but 2 commodities; the engine steals from the
  // combined pool, so the picker must offer it.
  const ps = [
    { seat: 0, hand_count: 5, vp: 6 },
    { seat: 1, hand_count: 0, vp: 4, commodity_count: 0 }, // truly empty
    { seat: 2, hand_count: 0, vp: 5 },
    { seat: 3, hand_count: 0, vp: 4, commodity_count: 2 }, // commodities only
  ];
  expect(robberVictimSeats(HEX, buildings, ps, 0, null).sort()).toEqual([3]);
});

// A ship borders HEX when both its edge endpoints are corners of HEX. Pair up
// consecutive corners as ship edges for each owner.
const ships = [
  { owner: 1, e: { a: V[0], b: V[1] } },
  { owner: 2, e: { a: V[2], b: V[3] } },
  { owner: 3, e: { a: V[4], b: V[5] } },
  { owner: 0, e: { a: V[1], b: V[2] } }, // viewer's own ship, never a victim
];

test("pirateVictimSeats: toggle off includes all card holders", () => {
  const got = pirateVictimSeats(HEX, ships, players, 0, null).sort();
  expect(got).toEqual([1, 2]); // 0 is viewer, 3 has no cards
});

test("pirateVictimSeats: friendly robber excludes vp<=2", () => {
  const got = pirateVictimSeats(HEX, ships, players, 0, 2);
  expect(got).toEqual([2]); // seat 1 (vp 2) is shielded
});

test("pirateVictimSeats: a ship not bordering the hex is ignored", () => {
  const farHex: Hex = { q: 0, r: 0 };
  const offHexShips = [{ owner: 2, e: { a: V[0], b: { q: 9, r: 9, side: 1 as const } } }];
  expect(pirateVictimSeats(farHex, offHexShips, players, 0, null)).toEqual([]);
});

// canChaseRobber: the robber sits on HEX; V[0] is one of its corners (adjacent),
// and a far-away vertex is not. The eligible knight is the viewer's (seat 0),
// active, not freshly activated, and adjacent.
const ROBBER: Hex = { q: 0, r: 0 };
const ADJ: Vertex = hexVertices(ROBBER)[0]; // corner of ROBBER → adjacent
const FAR: Vertex = { q: 9, r: 9, side: 0 }; // touches no hex near ROBBER

test("canChaseRobber: adjacent active knight → true", () => {
  expect(canChaseRobber({ v: ADJ, owner: 0, active: true }, 0, ROBBER)).toBe(true);
});

test("canChaseRobber: another player's knight → false", () => {
  expect(canChaseRobber({ v: ADJ, owner: 1, active: true }, 0, ROBBER)).toBe(false);
});

test("canChaseRobber: inactive knight → false", () => {
  expect(canChaseRobber({ v: ADJ, owner: 0, active: false }, 0, ROBBER)).toBe(false);
});

test("canChaseRobber: freshly activated knight → false", () => {
  expect(
    canChaseRobber({ v: ADJ, owner: 0, active: true, freshly_activated: true }, 0, ROBBER),
  ).toBe(false);
});

test("canChaseRobber: a knight not adjacent to the robber → false", () => {
  expect(canChaseRobber({ v: FAR, owner: 0, active: true }, 0, ROBBER)).toBe(false);
});

test("canChaseRobber: absent freshly_activated → true", () => {
  // No `freshly_activated` key at all (older server view).
  expect(canChaseRobber({ v: ADJ, owner: 0, active: true }, 0, ROBBER)).toBe(true);
});

// robberAteRoll: the hex the robber is on carries an 8, its neighbour a 6, and
// the desert it started on carries nothing.
const TILES = [
  { hex: { q: 0, r: 0 }, num: 8 },
  { hex: { q: 1, r: 0 }, num: 6 },
  { hex: { q: 0, r: 1 }, num: 0 }, // desert
];

test.each([
  ["the robber's own number came up", { q: 0, r: 0 }, 8, true],
  ["a different hex's number came up", { q: 0, r: 0 }, 6, false],
  ["the robber is on a hex that never produces", { q: 0, r: 1 }, 8, false],
  ["a 7: nothing produces and the robber is not why", { q: 0, r: 0 }, 7, false],
  ["the robber is off the tile list entirely", { q: 9, r: 9 }, 8, false],
])("robberAteRoll: %s", (_name, robber, total, want) => {
  expect(robberAteRoll(TILES, robber, total)).toBe(want);
});

test("robberAteRoll: a board with no robber ate nothing", () => {
  expect(robberAteRoll(TILES, undefined, 8)).toBe(false);
});

test("robberAteRoll: an unnumbered hex is never eaten, whatever comes up", () => {
  // The desert's num is 0, as is a sea tile's, and the robber starts on the
  // desert, so this is the common case.
  for (let total = 2; total <= 12; total++) {
    expect(robberAteRoll(TILES, { q: 0, r: 1 }, total)).toBe(false);
  }
});

describe("chaseRobberBlock", () => {
  const at = (q: number, r: number, side: 0 | 1) => ({ q, r, side });
  // A vertex and one of the hexes it actually touches, derived rather than
  // asserted, so the fixture cannot drift if the grid changes.
  const kv = at(1, 0, 0);
  const touching = vertexHexes(kv)[0];
  const far = { q: 9, r: 9 };
  const kn = (o: Partial<{ active: boolean; freshly_activated: boolean }>) => ({
    v: kv,
    owner: 0,
    active: true,
    freshly_activated: false,
    ...o,
  });

  it("returns null when the knight may chase", () => {
    expect(chaseRobberBlock(kn({}), 0, touching)).toBeNull();
  });

  it("reports an inactive knight before anything else", () => {
    expect(chaseRobberBlock(kn({ active: false }), 0, far)).toBe("inactive");
  });

  it("reports a knight activated this turn", () => {
    expect(chaseRobberBlock(kn({ freshly_activated: true }), 0, touching)).toBe("fresh");
  });

  it("reports a robber that is not adjacent", () => {
    expect(chaseRobberBlock(kn({}), 0, far)).toBe("not-adjacent");
  });

  it("agrees with canChaseRobber on every case", () => {
    for (const k of [kn({}), kn({ active: false }), kn({ freshly_activated: true })])
      for (const robber of [touching, far])
        expect(chaseRobberBlock(k, 0, robber) === null).toBe(canChaseRobber(k, 0, robber));
  });
});

// robberBlockedTile returns the tile for the log line that names what was
// blocked; it shares robberAteRoll's test so the two never disagree.
test("robberBlockedTile matches robberAteRoll", () => {
  expect(robberBlockedTile(TILES, { q: 0, r: 0 }, 8)).toEqual(TILES[0]);
  expect(robberBlockedTile(TILES, { q: 0, r: 0 }, 6)).toBeNull();
  expect(robberBlockedTile(TILES, { q: 0, r: 1 }, 8)).toBeNull();
  expect(robberBlockedTile(TILES, undefined, 8)).toBeNull();
  for (const total of [2, 6, 7, 8, 12]) {
    const hex = { q: 0, r: 0 };
    expect(!!robberBlockedTile(TILES, hex, total)).toBe(robberAteRoll(TILES, hex, total));
  }
});

describe("victimPromptStale", () => {
  it("closes a robber or pirate picker once the move is no longer owed", () => {
    expect(victimPromptStale({}, false)).toBe(true);
    expect(victimPromptStale({ chase: undefined }, false)).toBe(true);
  });
  it("keeps the picker while the move is still owed", () => {
    expect(victimPromptStale({}, true)).toBe(false);
  });
  it("ignores a knight's chase", () => {
    expect(victimPromptStale({ chase: { q: 0, r: 0, side: 0 } }, false)).toBe(false);
  });
  it("has nothing to close when no picker is open", () => {
    expect(victimPromptStale(null, false)).toBe(false);
  });
});
