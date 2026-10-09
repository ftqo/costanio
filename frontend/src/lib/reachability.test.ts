import { test, expect, describe } from "vitest";
import {
  canPlayDev,
  craneTracks,
  deserterVictimSeats,
  deserterTiers,
  improvementBlockReason,
  harborTargetCount,
  improvementCost,
  wallShopIntent,
  progressNoEffectReason,
  progressHasBoardTargets,
  progressPlayableNow,
  progressPlayableReason,
  playableProgressCards,
  seatsAheadOfViewer,
  spyVictimSeats,
  devPlayableReason,
  devEffectWarning,
  devCardName,
  devCardHint,
  DEV_CARD_IDS,
  DEV_HELD_ID,
} from "./reachability";
import type { KnightsExt, KnightsPlayer, FullView, PlayerView, Vertex } from "./types";

// canPlayDev: true only on my play phase with no forced robber/discard and no
// dev already played this turn. Does not require `rolled`.
const base = {
  myTurn: true,
  phase: "play",
  robberPending: false,
  needDiscard: false,
  playedDev: false,
};

test("canPlayDev: my play phase, nothing blocking → true (even pre-roll)", () => {
  expect(canPlayDev(base)).toBe(true);
});

test("canPlayDev: not my turn → false", () => {
  expect(canPlayDev({ ...base, myTurn: false })).toBe(false);
});

test("canPlayDev: setup phase → false", () => {
  expect(canPlayDev({ ...base, phase: "setup" })).toBe(false);
});

test("canPlayDev: robber pending → false", () => {
  expect(canPlayDev({ ...base, robberPending: true })).toBe(false);
});

test("canPlayDev: must discard → false", () => {
  expect(canPlayDev({ ...base, needDiscard: true })).toBe(false);
});

test("canPlayDev: already played a dev this turn → false", () => {
  expect(canPlayDev({ ...base, playedDev: true })).toBe(false);
});

// progressPlayableNow mirrors two exclusive engine branches
// (engine/knights/progress_play.go): Alchemist is refused after the roll
// (ErrNotBeforeRoll), everything else before it (ErrMustRoll).
describe("progressPlayableNow", () => {
  test("alchemist is playable pre-roll, not post-roll", () => {
    expect(progressPlayableNow("alchemist", false)).toBe(true);
    // Alchemist is legal only before the roll.
    expect(progressPlayableNow("alchemist", true)).toBe(false);
  });

  test("a post-roll card is not playable pre-roll", () => {
    expect(progressPlayableNow("crane", false)).toBe(false);
    expect(progressPlayableNow("diplomat", false)).toBe(false);
  });

  test("every non-Alchemist card is playable post-roll", () => {
    expect(progressPlayableNow("crane", true)).toBe(true);
    expect(progressPlayableNow("diplomat", true)).toBe(true);
    expect(progressPlayableNow("spy", true)).toBe(true);
  });
});

// progressHasBoardTargets: a card that starts with a board pick is playable
// only when the server offers a position. Medicine drops out of
// progress_targets when its discounted upgrade is unaffordable.
test("progressHasBoardTargets: no offered vertices → not playable", () => {
  expect(progressHasBoardTargets("medicine", { progress_targets: {} })).toBe(false);
  expect(progressHasBoardTargets("medicine", { progress_targets: { medicine: {} } })).toBe(false);
  expect(
    progressHasBoardTargets("medicine", { progress_targets: { medicine: { vertices: [] } } }),
  ).toBe(false);
});

test("progressHasBoardTargets: offered vertices → playable", () => {
  expect(
    progressHasBoardTargets("medicine", {
      progress_targets: { medicine: { vertices: [{ q: 0, r: 0, side: 0 }] } },
    }),
  ).toBe(true);
});

test("progressHasBoardTargets: hex and edge cards use their own sets", () => {
  const legal = {
    progress_targets: {
      merchant: { hexes: [{ q: 1, r: 0 }] },
      diplomat: { edges: [] },
    },
  };
  expect(progressHasBoardTargets("merchant", legal)).toBe(true);
  expect(progressHasBoardTargets("bishop", legal)).toBe(false);
  expect(progressHasBoardTargets("diplomat", legal)).toBe(false);
});

test("progressHasBoardTargets: ignores non-board cards and missing data", () => {
  expect(progressHasBoardTargets("wedding", { progress_targets: {} })).toBe(true);
  expect(progressHasBoardTargets("medicine", undefined)).toBe(true);
});

// ---------------------------------------------------------------------------
// View fixtures
// ---------------------------------------------------------------------------

function player(seat: number, o: Partial<PlayerView> = {}): PlayerView {
  return {
    seat,
    hand_count: 0,
    roads_left: 15,
    settlements_left: 5,
    cities_left: 4,
    dev_count: 0,
    knights_played: 0,
    vp: 2,
    public_vp: 2,
    ...o,
  };
}

function knightsPlayer(o: Partial<KnightsPlayer> = {}): KnightsPlayer {
  return {
    commodity_count: 0,
    improve: [0, 0, 0],
    progress_count: 0,
    metropolis: [false, false, false],
    metropolis_at: [
      { q: 0, r: 0, side: 0 },
      { q: 0, r: 0, side: 0 },
      { q: 0, r: 0, side: 0 },
    ],
    walls: 0,
    defender_vp: 0,
    merchant_vp: 0,
    extra_vp: 0,
    ...o,
  };
}

function knightsState(o: Partial<KnightsExt> = {}): KnightsExt {
  return {
    players: [knightsPlayer(), knightsPlayer(), knightsPlayer()],
    knights: [],
    commodity_supply: [12, 12, 12],
    barbarians: 0,
    attacks: 0,
    decks: [10, 10, 10],
    deserter_victim: -1,
    deserter_taker: -1,
    reloc_player: -1,
    ...o,
  };
}

/** A three-seat Knights view, viewer at seat 0, mid-turn and rolled. */
function view(o: Partial<FullView> = {}, x: Partial<KnightsExt> = {}): FullView {
  return {
    seq: 1,
    viewer: 0,
    cur: 0,
    phase: "play",
    rolled: true,
    config: { players: 3, ruleset: "base+cak", target_vp: 13 },
    board: { radius: 2, robber: { q: 0, r: 0 }, harbors: [], tiles: [] },
    bank: [0, 19, 19, 19, 19, 19],
    players: [player(0), player(1), player(2)],
    buildings: [],
    roads: [],
    dev_deck_count: 25,
    longest_road: -1,
    largest_army: -1,
    winner: -1,
    ext: { cak: knightsState(x) },
    ...o,
  } as FullView;
}

// ---------------------------------------------------------------------------

describe("seatsAheadOfViewer", () => {
  test("compares public_vp, not the viewer's hidden-VP-inflated vp", () => {
    // Seat 0 holds two hidden VP cards (its `vp` reads 5, public standing 3).
    // Seat 1 is one point ahead publicly and is a legal Master Merchant victim.
    const v = view({
      players: [
        player(0, { vp: 5, public_vp: 3 }),
        player(1, { vp: 4, public_vp: 4 }),
        player(2, { vp: 3, public_vp: 3 }),
      ],
    });
    expect(seatsAheadOfViewer(v)).toEqual([1]);
  });

  test("nobody ahead → empty", () => {
    expect(seatsAheadOfViewer(view())).toEqual([]);
  });

  test("falls back to vp when the server predates public_vp", () => {
    const v = view({
      players: [
        player(0, { vp: 3, public_vp: undefined }),
        player(1, { vp: 4, public_vp: undefined }),
      ],
    });
    expect(seatsAheadOfViewer(v)).toEqual([1]);
  });
});

describe("spyVictimSeats", () => {
  test("only opponents actually holding a progress card", () => {
    const v = view(
      {},
      {
        players: [
          knightsPlayer({ progress_count: 2 }),
          knightsPlayer({ progress_count: 0 }),
          knightsPlayer({ progress_count: 1 }),
        ],
      },
    );
    // The engine returns ErrBadVictim for an empty progress hand. The viewer is
    // never listed.
    expect(spyVictimSeats(v)).toEqual([2]);
  });

  test("nobody holding anything → empty", () => {
    expect(spyVictimSeats(view())).toEqual([]);
  });
});

describe("deserterVictimSeats", () => {
  test("only opponents who own a knight", () => {
    const v = view(
      {},
      {
        knights: [
          {
            v: { q: 0, r: 0, side: 0 },
            owner: 2,
            level: 1,
            active: false,
            freshly_activated: false,
            promoted_this_turn: false,
          },
          {
            v: { q: 1, r: 0, side: 0 },
            owner: 0,
            level: 3,
            active: true,
            freshly_activated: false,
            promoted_this_turn: false,
          },
        ],
      },
    );
    expect(deserterVictimSeats(v)).toEqual([2]);
  });

  test("no knights on the board → empty", () => {
    expect(deserterVictimSeats(view())).toEqual([]);
  });
});

describe("harborTargetCount", () => {
  test("every commodity holder, capped by the taker's resource count", () => {
    const holders = {
      players: [
        knightsPlayer(),
        knightsPlayer({ commodity_count: 1 }),
        knightsPlayer({ commodity_count: 3 }),
      ],
    };
    // Two holders, four resources: both are forced.
    expect(
      harborTargetCount(
        view({ players: [player(0, { hand_count: 4 }), player(1), player(2)] }, holders),
      ),
    ).toBe(2);
    // Two holders, one resource: one is forced, and Confirm must send exactly
    // one give or it is ErrBadCommand.
    expect(
      harborTargetCount(
        view({ players: [player(0, { hand_count: 1 }), player(1), player(2)] }, holders),
      ),
    ).toBe(1);
    // No resources: nothing is forced at all.
    expect(
      harborTargetCount(
        view({ players: [player(0, { hand_count: 0 }), player(1), player(2)] }, holders),
      ),
    ).toBe(0);
  });

  test("no commodity holders → zero however rich the taker is", () => {
    expect(
      harborTargetCount(view({ players: [player(0, { hand_count: 9 }), player(1), player(2)] })),
    ).toBe(0);
  });
});

describe("improvementCost", () => {
  test("normal price is level + 1; the Crane knocks one off, floored at zero", () => {
    expect(improvementCost(0, false)).toBe(1);
    expect(improvementCost(0, true)).toBe(0); // a Crane to level 1 is free
    expect(improvementCost(3, false)).toBe(4);
    expect(improvementCost(3, true)).toBe(3);
  });
});

describe("wallShopIntent", () => {
  const city = (q: number, r: number, side: 0 | 1) => ({ q, r, side });

  // The Wall tile must name the city: the engine's empty-payload fallback walls
  // the first unwalled city in board order, and which city is walled matters.
  test("no legal target: nothing to do", () => {
    expect(wallShopIntent({ walls: [] })).toEqual({ kind: "none" });
    expect(wallShopIntent({})).toEqual({ kind: "none" });
    expect(wallShopIntent(undefined)).toEqual({ kind: "none" });
  });

  test("exactly one: build it on that vertex, one click, no picker", () => {
    const only = city(2, 0, 0);
    expect(wallShopIntent({ walls: [only] })).toEqual({ kind: "build", v: only });
  });

  test("two or more: the player picks, so arm the selection mode", () => {
    const a = city(2, 0, 0);
    const b = city(3, -1, 1);
    expect(wallShopIntent({ walls: [a, b] })).toEqual({ kind: "select", targets: [a, b] });
  });

  test("a one-target build names the vertex", () => {
    // Even a single candidate is named, so client and engine agree on the city.
    const got = wallShopIntent({ walls: [city(1, 1, 1)] });
    expect(got.kind).toBe("build");
    expect(got.kind === "build" && got.v).toEqual(city(1, 1, 1));
  });
});

describe("craneTracks", () => {
  const structural = { legal: { improvements: [0, 1, 2] } };

  test("keeps only legal tracks affordable at the discount", () => {
    const v = view(
      { ...structural, players: [player(0), player(1), player(2)] },
      {
        players: [
          // Trade at level 0: discounted price 0, always affordable.
          // Politics at level 2: discounted price 2, holds 1 coin: no.
          // Science at level 1: discounted price 1, holds 1 paper: yes.
          knightsPlayer({ improve: [0, 2, 1], commodities: [0, 1, 1] }),
          knightsPlayer(),
          knightsPlayer(),
        ],
      },
    );
    expect(craneTracks(v)).toEqual([0, 2]);
  });

  test("a track the engine excludes structurally is dropped whatever you hold", () => {
    const v = view(
      { legal: { improvements: [1] } },
      {
        players: [
          knightsPlayer({ improve: [0, 0, 0], commodities: [9, 9, 9] }),
          knightsPlayer(),
          knightsPlayer(),
        ],
      },
    );
    expect(craneTracks(v)).toEqual([1]);
  });

  test("no structural list yet → affordability alone decides", () => {
    const v = view(
      {},
      {
        players: [
          knightsPlayer({ improve: [4, 4, 4], commodities: [4, 0, 0] }),
          knightsPlayer(),
          knightsPlayer(),
        ],
      },
    );
    // Discounted price at level 4 is 4; only cloth (index 0, Trade) is covered.
    expect(craneTracks(v)).toEqual([0]);
  });
});

// The popover sentence for a dark upgrade tile. The engine sends one boolean
// per track, so "no city" and "every city already holds a metropolis" both
// arrive as false.
describe("improvementBlockReason", () => {
  const home: Vertex = { q: 0, r: 0, side: 0 };
  const away: Vertex = { q: 1, r: 0, side: 1 };
  const cityAt = (v: Vertex) => ({ v, owner: 0, city: true });
  const metroOnHome: Partial<KnightsPlayer> = {
    metropolis: [true, false, false],
    metropolis_at: [home, home, home],
  };

  test("nothing in the way → null, so the tile keeps its reward line", () => {
    const v = view(
      { legal: { improvements: [0, 1, 2] }, buildings: [cityAt(home)] },
      { players: [knightsPlayer({ commodities: [9, 9, 9] }), knightsPlayer(), knightsPlayer()] },
    );
    expect(improvementBlockReason(0, v, false)).toBeNull();
  });

  test("a maxed track says so before anything else", () => {
    const v = view(
      { legal: { improvements: [] }, buildings: [] },
      { players: [knightsPlayer({ improve: [5, 0, 0] }), knightsPlayer(), knightsPlayer()] },
    );
    expect(improvementBlockReason(0, v, false)).toMatch(/maximum level/i);
  });

  test("short of the price names the commodity", () => {
    // Trade at level 2 costs 3 cloth; this seat holds 1.
    const v = view(
      { legal: { improvements: [0] }, buildings: [cityAt(home)] },
      {
        players: [
          knightsPlayer({ improve: [2, 0, 0], commodities: [1, 0, 0] }),
          knightsPlayer(),
          knightsPlayer(),
        ],
      },
    );
    expect(improvementBlockReason(0, v, false)).toMatch(/cloth/i);
  });

  test("the Crane's discount can make a track affordable", () => {
    const v = view(
      { legal: { improvements: [0] }, buildings: [cityAt(home)] },
      {
        players: [
          knightsPlayer({ improve: [2, 0, 0], commodities: [2, 0, 0] }),
          knightsPlayer(),
          knightsPlayer(),
        ],
      },
    );
    expect(improvementBlockReason(0, v, false)).toMatch(/cloth/i);
    expect(improvementBlockReason(0, v, true)).toBeNull();
  });

  test("no city at all is the block, and it is not the metropolis one", () => {
    // The engine refuses every track to a seat with no city (engine/knights/hooks.go).
    const v = view(
      { legal: { improvements: [] }, buildings: [] },
      { players: [knightsPlayer({ commodities: [9, 9, 9] }), knightsPlayer(), knightsPlayer()] },
    );
    const why = improvementBlockReason(1, v, false);
    expect(why).toMatch(/need a city/i);
    expect(why).not.toMatch(/metropolis/i);
  });

  test("an omitted list is the server's empty one, not a missing answer", () => {
    // Go omits an empty `improvements` (omitempty), so a seat that just lost its
    // only city gets a `legal` without the key. The tiles must still say why.
    const v = view(
      { legal: { roads: [] }, buildings: [] },
      { players: [knightsPlayer({ commodities: [9, 9, 9] }), knightsPlayer(), knightsPlayer()] },
    );
    expect(improvementBlockReason(2, v, false)).toMatch(/need a city/i);
  });

  test("a level with no metropolis needs no free city", () => {
    // The only city holds the Trade metropolis; Politics at level 1 -> 2 places
    // nothing, so the metropolis sentence would be false there.
    const v = view(
      { legal: { improvements: [] }, buildings: [cityAt(home)] },
      {
        players: [
          knightsPlayer({ improve: [4, 1, 0], commodities: [9, 9, 9], ...metroOnHome }),
          knightsPlayer(),
          knightsPlayer(),
        ],
      },
    );
    expect(improvementBlockReason(1, v, false)).toBeNull();
  });

  test("every city already carrying a metropolis is named as the block", () => {
    // One city, and this seat's Trade metropolis is on it, so the Politics
    // level that would place another has nowhere to put it.
    const v = view(
      { legal: { improvements: [] }, buildings: [cityAt(home)] },
      {
        players: [
          knightsPlayer({ improve: [4, 3, 0], commodities: [9, 9, 9], ...metroOnHome }),
          knightsPlayer(),
          knightsPlayer(),
        ],
      },
    );
    expect(improvementBlockReason(1, v, false)).toMatch(/already has one/i);
  });

  test("does not blame a free city for an unrelated refusal", () => {
    const v = view(
      { legal: { improvements: [] }, buildings: [cityAt(home), cityAt(away)] },
      {
        players: [
          knightsPlayer({ improve: [4, 3, 0], commodities: [9, 9, 9], ...metroOnHome }),
          knightsPlayer(),
          knightsPlayer(),
        ],
      },
    );
    expect(improvementBlockReason(1, v, false)).toBeNull();
  });

  test("a settlement is not a city", () => {
    const v = view(
      { legal: { improvements: [] }, buildings: [{ v: home, owner: 0, city: false }] },
      { players: [knightsPlayer({ commodities: [9, 9, 9] }), knightsPlayer(), knightsPlayer()] },
    );
    expect(improvementBlockReason(0, v, false)).toMatch(/need a city/i);
  });

  test("someone else's city is not yours", () => {
    const v = view(
      { legal: { improvements: [] }, buildings: [{ v: home, owner: 1, city: true }] },
      { players: [knightsPlayer({ commodities: [9, 9, 9] }), knightsPlayer(), knightsPlayer()] },
    );
    expect(improvementBlockReason(0, v, false)).toMatch(/need a city/i);
  });

  test("no structural list blames nobody", () => {
    const v = view(
      { buildings: [] },
      { players: [knightsPlayer({ commodities: [9, 9, 9] }), knightsPlayer(), knightsPlayer()] },
    );
    expect(improvementBlockReason(0, v, false)).toBeNull();
  });
});

describe("progressPlayableReason", () => {
  test("playable → null", () => {
    expect(progressPlayableReason("merchant_fleet", view())).toBeNull();
  });

  test("names the three cases that used to be indistinguishable", () => {
    expect(progressPlayableReason("merchant_fleet", view({ cur: 1 }))).toMatch(/not your turn/i);
    expect(progressPlayableReason("merchant_fleet", view({ rolled: false }))).toMatch(
      /roll the dice/i,
    );
    // With the means to play it, an empty list really is about the board.
    const canPay = view({
      legal: { progress_targets: {} },
      players: [{ ...player(0), hand: [0, 0, 0, 0, 9, 9] }, player(1), player(2)],
    } as unknown as Partial<FullView>);
    expect(progressPlayableReason("medicine", canPay)).toMatch(
      /nothing on the board is a legal target/i,
    );
  });

  describe("Medicine's empty target list has three different causes", () => {
    // Medicine's targets are also gated on the discounted cost and city supply
    // (engine/knights/hooks.go), so a player with settlements but no ore must not
    // be told the board is the problem.
    const noTargets = { legal: { progress_targets: {} } };
    const rich = (over: Record<number, number>) => [
      { ...player(0), hand: [0, 0, 0, 0, over[4] ?? 0, over[5] ?? 0] },
      player(1),
      player(2),
    ];

    test("short of the resources, it says so", () => {
      const w = view({
        ...noTargets,
        players: rich({ 4: 1, 5: 1 }),
        buildings: [{ v: { q: 0, r: 0, side: 0 }, owner: 0, city: false }],
      } as unknown as Partial<FullView>);
      expect(progressPlayableReason("medicine", w)).toMatch(/ore/i);
      expect(progressPlayableReason("medicine", w)).not.toMatch(
        /nothing on the board is a legal target/i,
      );
    });

    test("out of city pieces, it says that instead", () => {
      const w = view({
        ...noTargets,
        players: [{ ...player(0), hand: [0, 0, 0, 0, 9, 9], cities_left: 0 }, player(1), player(2)],
        buildings: [{ v: { q: 0, r: 0, side: 0 }, owner: 0, city: false }],
      } as unknown as Partial<FullView>);
      expect(progressPlayableReason("medicine", w)).toMatch(/city pieces/i);
    });

    test("with the means but no settlement, blames the board", () => {
      const w = view({
        ...noTargets,
        players: rich({ 4: 9, 5: 9 }),
        buildings: [],
      } as unknown as Partial<FullView>);
      expect(progressPlayableReason("medicine", w)).toMatch(
        /nothing on the board is a legal target/i,
      );
    });
  });

  test("Alchemist's reason is the opposite of every other card's", () => {
    expect(progressPlayableReason("alchemist", view({ rolled: false }))).toBeNull();
    expect(progressPlayableReason("alchemist", view({ rolled: true }))).toMatch(/before you roll/i);
  });

  test("forced steps outrank the card's own requirement", () => {
    expect(progressPlayableReason("merchant_fleet", view({ robber_pending: true }))).toMatch(
      /robber/i,
    );
    expect(progressPlayableReason("merchant_fleet", view({ pending_discards: { 0: 3 } }))).toMatch(
      /discard/i,
    );
    expect(progressPlayableReason("merchant_fleet", view({ phase: "setup" }))).toMatch(/setup/i);
    expect(progressPlayableReason("merchant_fleet", view({ viewer: -1 }))).toMatch(/spectating/i);
  });
});

describe("playableProgressCards", () => {
  // `decidePlayProgress` requires your turn, the play phase and the roll, and
  // the 4-card limit is usually exceeded by a gate draw on someone else's roll
  // (playersFromCurrent, engine/knights/hooks.go). Offering "play one instead" then
  // would be refused and hide the discard picker.
  const overLimit = { players: [knightsPlayer(), knightsPlayer(), knightsPlayer()] };
  const holding = (cards: string[], o: Partial<FullView> = {}) =>
    view(o, {
      ...overLimit,
      players: [
        knightsPlayer({ progress: cards, progress_count: cards.length }),
        knightsPlayer(),
        knightsPlayer(),
      ],
    });

  test("on my turn after the roll, a plain card is playable", () => {
    expect(playableProgressCards(holding(["merchant_fleet"]))).toEqual(["merchant_fleet"]);
  });

  test("off-turn nothing is playable, however full the hand", () => {
    // Five cards, none of them a legal play.
    const hand = ["merchant_fleet", "spy", "bishop", "warlord", "smith"];
    expect(playableProgressCards(holding(hand, { cur: 1 }))).toEqual([]);
  });

  test("pre-roll on my own turn, only Alchemist survives", () => {
    const hand = ["merchant_fleet", "alchemist"];
    expect(playableProgressCards(holding(hand, { rolled: false }))).toEqual(["alchemist"]);
  });

  test("a forced step outranks the play, so the offer disappears", () => {
    expect(playableProgressCards(holding(["merchant_fleet"], { robber_pending: true }))).toEqual(
      [],
    );
    expect(
      playableProgressCards(holding(["merchant_fleet"], { pending_discards: { 0: 3 } })),
    ).toEqual([]);
  });

  test("an empty or absent progress hand is not a crash", () => {
    expect(playableProgressCards(holding([]))).toEqual([]);
    expect(playableProgressCards(view())).toEqual([]);
  });
});

describe("progressNoEffectReason", () => {
  // The engine refuses a progress card that public information proves would do
  // nothing (ErrCardNoEffect, engine/knights/progress_play.go), so these are gates.
  test("it is the last step of progressPlayableReason", () => {
    expect(progressPlayableReason("master_merchant", view())).toMatch(/nobody is ahead/i);
    expect(
      playableProgressCards(
        view(
          {},
          { players: [knightsPlayer({ progress: ["wedding"] }), knightsPlayer(), knightsPlayer()] },
        ),
      ),
    ).toEqual([]);
  });

  test("Master Merchant with nobody ahead, or nobody ahead holding a card", () => {
    expect(progressNoEffectReason("master_merchant", view())).toMatch(/nobody is ahead/i);
    const aheadEmpty = view({ players: [player(0), player(1, { public_vp: 9 }), player(2)] });
    expect(progressNoEffectReason("master_merchant", aheadEmpty)).toMatch(/holding a card/i);
    const ahead = view({
      players: [player(0), player(1, { public_vp: 9, hand_count: 1 }), player(2)],
    });
    expect(progressNoEffectReason("master_merchant", ahead)).toBeNull();
  });

  test("Spy with no holder", () => {
    expect(progressNoEffectReason("spy", view())).toMatch(
      /no opponent is holding a progress card/i,
    );
    const holder = view(
      {},
      { players: [knightsPlayer(), knightsPlayer({ progress_count: 1 }), knightsPlayer()] },
    );
    expect(progressNoEffectReason("spy", holder)).toBeNull();
  });

  test("Commercial Harbor: no resources vs no commodity holders", () => {
    const holders = {
      players: [knightsPlayer(), knightsPlayer({ commodity_count: 2 }), knightsPlayer()],
    };
    const broke = view({ players: [player(0, { hand_count: 0 }), player(1), player(2)] }, holders);
    expect(progressNoEffectReason("commercial_harbor", broke)).toMatch(/no resources/i);

    const noHolders = view({ players: [player(0, { hand_count: 5 }), player(1), player(2)] });
    expect(progressNoEffectReason("commercial_harbor", noHolders)).toMatch(/no opponent/i);

    const fine = view({ players: [player(0, { hand_count: 5 }), player(1), player(2)] }, holders);
    expect(progressNoEffectReason("commercial_harbor", fine)).toBeNull();
  });

  test("Deserter with no opponent knight", () => {
    expect(progressNoEffectReason("deserter", view())).toMatch(/no opponent has a knight/i);
  });

  test("Crane with no affordable track", () => {
    const v = view(
      { legal: { improvements: [0, 1, 2] } },
      {
        players: [
          knightsPlayer({ improve: [3, 3, 3], commodities: [0, 0, 0] }),
          knightsPlayer(),
          knightsPlayer(),
        ],
      },
    );
    expect(progressNoEffectReason("crane", v)).toMatch(/discounted price/i);
  });

  test("Saboteur uses >= and needs a hand", () => {
    const level = view({
      players: [player(0), player(1, { hand_count: 4 }), player(2)],
    });
    // Everyone level: Saboteur still hits, Wedding does not.
    expect(progressNoEffectReason("saboteur", level)).toBeNull();
    expect(progressNoEffectReason("wedding", level)).toMatch(/nobody is ahead/i);
    // Level, but nobody holds two cards: nothing to halve.
    expect(progressNoEffectReason("saboteur", view())).toMatch(/enough cards/i);
    const behind = view({
      players: [
        player(0, { public_vp: 9 }),
        player(1, { public_vp: 1, hand_count: 5 }),
        player(2, { public_vp: 1 }),
      ],
    });
    expect(progressNoEffectReason("saboteur", behind)).toMatch(/level with or ahead/i);
  });

  test("Wedding with somebody ahead counts their commodities too", () => {
    const ahead = view({ players: [player(0), player(1, { public_vp: 9 }), player(2)] });
    expect(progressNoEffectReason("wedding", ahead)).toMatch(/holding a card/i);
    const withCloth = view(
      { players: [player(0), player(1, { public_vp: 9 }), player(2)] },
      { players: [knightsPlayer(), knightsPlayer({ commodity_count: 1 }), knightsPlayer()] },
    );
    expect(progressNoEffectReason("wedding", withCloth)).toBeNull();
  });

  test("monopolies are refused only when no opponent holds a card of that kind", () => {
    expect(progressNoEffectReason("trade_monopoly", view())).toMatch(/no opponent/i);
    expect(progressNoEffectReason("resource_monopoly", view())).toMatch(/no opponent/i);
    const rich = view({ players: [player(0), player(1, { hand_count: 3 }), player(2)] });
    expect(progressNoEffectReason("resource_monopoly", rich)).toBeNull();
  });

  test("Warlord needs an inactive knight of yours", () => {
    const k = (owner: number, active: boolean) => ({
      v: { q: 0, r: 0, side: 0 },
      owner,
      level: 1,
      active,
      freshly_activated: false,
      promoted_this_turn: false,
    });
    // No knights at all is said as that, not "none of them is inactive".
    expect(progressNoEffectReason("warlord", view())).toMatch(/no knights/i);
    expect(
      progressNoEffectReason("warlord", view({}, { knights: [k(0, true), k(1, false)] })),
    ).toMatch(/inactive/i);
    expect(progressNoEffectReason("warlord", view({}, { knights: [k(0, false)] }))).toBeNull();
  });

  test("Irrigation and Mining need a bordering hex and a supply", () => {
    const field = { hex: { q: 0, r: 0 }, res: "wheat", num: 6 };
    const mine = { v: { q: 0, r: 0, side: 0 }, owner: 0, city: false };
    const board = { radius: 2, robber: { q: 5, r: 5 }, harbors: [], tiles: [field] };
    const onField = view({ board, buildings: [mine] } as unknown as Partial<FullView>);
    expect(progressNoEffectReason("irrigation", onField)).toBeNull();
    expect(progressNoEffectReason("mining", onField)).toMatch(/mountain/i);
    const noField = view({ board, buildings: [] } as unknown as Partial<FullView>);
    expect(progressNoEffectReason("irrigation", noField)).toMatch(/field/i);
    const dry = view({
      board,
      buildings: [mine],
      bank: [0, 19, 19, 19, 0, 19],
    } as unknown as Partial<FullView>);
    expect(progressNoEffectReason("irrigation", dry)).toMatch(/no wheat left/i);
  });

  test("Engineer needs a city without a wall and a wall in supply", () => {
    const home = { q: 0, r: 0, side: 0 };
    const city = { v: home, owner: 0, city: true };
    expect(progressNoEffectReason("engineer", view({ buildings: [] }))).toMatch(/no city/i);
    expect(progressNoEffectReason("engineer", view({ buildings: [city] }))).toBeNull();
    expect(
      progressNoEffectReason("engineer", view({ buildings: [city] }, { walled: [home] })),
    ).toMatch(/already has a wall/i);
    const spent = { players: [knightsPlayer({ walls: 3 }), knightsPlayer(), knightsPlayer()] };
    expect(progressNoEffectReason("engineer", view({ buildings: [city] }, spent))).toMatch(
      /all 3/i,
    );
  });

  test("Smith needs a knight that can go up", () => {
    const k = (level: number, o: Record<string, unknown> = {}) => ({
      v: { q: 0, r: 0, side: 0 },
      owner: 0,
      level,
      active: false,
      freshly_activated: false,
      promoted_this_turn: false,
      ...o,
    });
    expect(progressNoEffectReason("smith", view())).toMatch(/no knights/i);
    expect(progressNoEffectReason("smith", view({}, { knights: [k(1)] }))).toBeNull();
    expect(progressNoEffectReason("smith", view({}, { knights: [k(3)] }))).toMatch(/promoted/i);
    expect(progressNoEffectReason("smith", view({}, { knights: [k(2)] }))).toMatch(/promoted/i);
    const fort = {
      players: [knightsPlayer({ improve: [0, 3, 0] }), knightsPlayer(), knightsPlayer()],
    };
    expect(progressNoEffectReason("smith", view({}, { ...fort, knights: [k(2)] }))).toBeNull();
    expect(progressNoEffectReason("smith", view({}, { knights: [k(1), k(2), k(2)] }))).toMatch(
      /promoted/i,
    );
    expect(
      progressNoEffectReason("smith", view({}, { knights: [k(1, { promoted_this_turn: true })] })),
    ).toMatch(/promoted/i);
  });

  test("Road Building needs somewhere to build", () => {
    const e = { a: { q: 0, r: 0, side: 0 }, b: { q: 1, r: -1, side: 1 } };
    expect(progressNoEffectReason("road_building", view())).toBeNull(); // no legal data yet
    expect(progressNoEffectReason("road_building", view({ legal: { roads: [e] } }))).toBeNull();
    expect(progressNoEffectReason("road_building", view({ legal: { roads: [] } }))).toMatch(
      /nowhere/i,
    );
    const noPieces = view({
      legal: { roads: [] },
      players: [player(0, { roads_left: 0 }), player(1), player(2)],
    });
    expect(progressNoEffectReason("road_building", noPieces)).toMatch(/no road pieces/i);
  });

  test("a card with no such failure mode never refuses", () => {
    expect(progressNoEffectReason("medicine", view())).toBeNull();
    expect(progressNoEffectReason("merchant_fleet", view())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The base five development cards
// ---------------------------------------------------------------------------

/** A base-game view (no Knights ext), viewer at seat 0, mid-turn and rolled. */
function baseView(o: Partial<FullView> = {}): FullView {
  return {
    ...view(),
    config: { players: 3, ruleset: "base", target_vp: 10 },
    ext: {},
    ...o,
  } as FullView;
}

const one = { ready: 1, locked: 0 };

describe("DEV_CARD_IDS", () => {
  test("indexes the hand array in the engine's DevCard order", () => {
    // The tile row maps `dev_cards[i]` through this table; reordering would
    // mislabel and play the wrong card.
    expect(DEV_CARD_IDS).toEqual([
      "knight",
      "victory_point",
      "road_building",
      "year_of_plenty",
      "monopoly",
    ]);
    expect(DEV_HELD_ID).toBe("victory_point");
  });

  test("every id resolves to the shared card vocabulary, not a fallback", () => {
    for (const id of DEV_CARD_IDS) {
      expect(devCardName(id)).not.toBe(id);
      expect(devCardHint(id).length).toBeGreaterThan(0);
    }
  });
});

describe("devPlayableReason", () => {
  test("nothing blocking → null", () => {
    expect(devPlayableReason("knight", baseView(), one)).toBeNull();
  });

  test("does not require the roll", () => {
    expect(devPlayableReason("knight", baseView({ rolled: false }), one)).toBeNull();
  });

  test("the Victory Point card is never played, and says why", () => {
    expect(devPlayableReason("victory_point", baseView(), one)).toMatch(/already counts/i);
  });

  test("bought this turn is its own sentence, not a silent dim tile", () => {
    expect(devPlayableReason("knight", baseView(), { ready: 0, locked: 1 })).toMatch(
      /bought this turn/i,
    );
  });

  test("each blocker gets its own reason, in turn order", () => {
    expect(devPlayableReason("knight", baseView({ viewer: -1 }), one)).toMatch(/spectating/i);
    expect(devPlayableReason("knight", baseView({ cur: 1 }), one)).toMatch(/not your turn/i);
    expect(devPlayableReason("knight", baseView({ phase: "setup" }), one)).toMatch(/setup/i);
    expect(devPlayableReason("knight", baseView({ pending_discards: { 0: 4 } }), one)).toMatch(
      /discard/i,
    );
    expect(devPlayableReason("knight", baseView({ robber_pending: true }), one)).toMatch(/robber/i);
    expect(devPlayableReason("knight", baseView({ played_dev: true }), one)).toMatch(
      /already played/i,
    );
  });

  test("a hand-limit block outranks the one-per-turn block", () => {
    // Ordered as the turn is experienced: the forced step comes first.
    expect(
      devPlayableReason("knight", baseView({ played_dev: true, pending_discards: { 0: 4 } }), one),
    ).toMatch(/discard/i);
  });
});

describe("devEffectWarning", () => {
  test("Road Building with no pieces left warns but does not gate", () => {
    const stuck = baseView({
      players: [player(0, { roads_left: 0 }), player(1), player(2)],
    });
    expect(devEffectWarning("road_building", stuck)).toMatch(/no road or ship pieces/i);
    // Still playable: a base card with no effect is spent if the player insists.
    expect(devPlayableReason("road_building", stuck, one)).toBeNull();
  });

  test("Road Building is fine with roads in the box", () => {
    expect(devEffectWarning("road_building", baseView())).toBeNull();
  });

  test("Monopoly warns when every opponent is empty-handed", () => {
    expect(devEffectWarning("monopoly", baseView())).toMatch(/no opponent/i);
    const rich = baseView({ players: [player(0), player(1, { hand_count: 2 }), player(2)] });
    expect(devEffectWarning("monopoly", rich)).toBeNull();
  });

  test("cards with no such failure mode never warn", () => {
    expect(devEffectWarning("knight", baseView())).toBeNull();
    expect(devEffectWarning("year_of_plenty", baseView())).toBeNull();
    expect(devEffectWarning("victory_point", baseView())).toBeNull();
  });
});

describe("deserterTiers", () => {
  // "The same strength or lower": every tier up to the owed ceiling where the
  // taker has a free piece (two per tier), as decideDeserterPlace accepts.
  const k = (level: number) => ({
    v: { q: 0, r: 0, side: 0 },
    owner: 0,
    level,
    active: false,
    freshly_activated: false,
    promoted_this_turn: false,
  });
  test("nothing owed, nothing offered", () => {
    expect(deserterTiers(view())).toEqual([]);
  });
  test("a mighty ceiling offers all three tiers", () => {
    expect(deserterTiers(view({}, { deserter_taker: 0, deserter_level: 3 }))).toEqual([1, 2, 3]);
  });
  test("a full tier is not offered", () => {
    const v = view({}, { deserter_taker: 0, deserter_level: 3, knights: [k(2), k(2)] });
    expect(deserterTiers(v)).toEqual([1, 3]);
  });
  test("another seat's debt is not ours", () => {
    expect(deserterTiers(view({}, { deserter_taker: 1, deserter_level: 3 }))).toEqual([]);
  });
});
