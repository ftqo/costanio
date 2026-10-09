import { describe, it, expect } from "vitest";
import { selectSeat, selectRailShape, seatTracks } from "./SeatRail";
import { selectDiscard, selectBank, selectStatus } from "./TableStatus";
import { selectRail } from "./BarbarianRail";
import { COMMOD, COMMOD_ROW } from "@/lib/cardFace";
import { TRACK_ROW } from "@/lib/improvements";
import type { State } from "@/lib/ws";
import type { FullView } from "@/lib/types";

/**
 * `s.Ext["cak"]` is created lazily by the Knights module's first event (the
 * event die on the first roll), and `game/views.go` builds `ext` from `s.Ext`,
 * so a live Knights game has no `ext.cak` through board generation, both setup
 * rounds and the first pre-roll turn.
 *
 * Whether a game is Knights is a ruleset question, answered from
 * `config.ruleset` on the first frame. These assert that a Knights view with
 * no module state still reads as Knights, rather than snapshotting markup.
 */

/** A Knights view exactly as it arrives before the first roll: no `ext` at all. */
const setupView = (ruleset = "base+cak"): FullView =>
  ({
    viewer: 0,
    cur: 0,
    config: { ruleset, discard_limit: 7 },
    bank: [0, 19, 19, 19, 19, 19],
    buildings: [],
    players: [
      { seat: 0, vp: 2, hand_count: 3, dev_count: 0, knights_played: 0, discard_at: 7 },
      { seat: 1, vp: 2, hand_count: 3, dev_count: 0, knights_played: 0, discard_at: 7 },
    ],
  }) as unknown as FullView;

const state = (v: FullView): State => ({ full: v }) as unknown as State;

describe("Knights HUD is keyed on the ruleset, not on ext.cak", () => {
  it("a Knights view with no ext.cak still reads as a Knights seat", () => {
    const v = setupView();
    expect(v.ext).toBeUndefined(); // no module state yet

    const s = selectSeat(v, 0);
    expect(s.knights).toBe(true);
    // Three tracks at level 0, none a metropolis: the seat's real position,
    // not "this game has no tracks".
    expect(s.tracks).toBe("0:false|0:false|0:false");
  });

  it("the rail reserves the improvement row from the first frame", () => {
    expect(selectRailShape(state(setupView())).tracks).toBe(true);
  });

  it("the status panel draws BARBARIANS and YOU from the first frame", () => {
    const st = selectStatus(state(setupView()));
    expect(st.show).toBe(true);
    expect(st.knights).toBe(true);
    expect(st.hasMine).toBe(true);
    expect(st.barbarians).toBe(0);
  });

  it("the fleet rail draws its whole track from the first frame", () => {
    // `dist` is 0 only in a base game (barbDist clamps to [4,12]), so a Knights
    // game must have a real track before anyone has rolled.
    const r = selectRail(state(setupView()));
    expect(r.dist).toBe(7);
    expect(r.at).toBe(0);
  });

  it("the discard breakdown knows walls exist from the first frame", () => {
    expect(selectDiscard(state(setupView())).knights).toBe(true);
  });

  it("the bank panel reserves the commodity row from the first frame", () => {
    // Gating this on `ext.cak` would draw a five-count bank through setup and
    // then add a second row on the first roll.
    expect(selectBank(state(setupView())).commodities).toBe(true);
  });

  it("still reads as a base game when the ruleset says so", () => {
    const v = setupView("base");
    expect(selectSeat(v, 0).knights).toBe(false);
    expect(selectSeat(v, 0).tracks).toBe("");
    expect(selectRailShape(state(v)).tracks).toBe(false);
    expect(selectStatus(state(v)).knights).toBe(false);
    expect(selectRail(state(v)).dist).toBe(0);
    expect(selectBank(state(v)).commodities).toBe(false);
    expect(selectDiscard(state(v)).knights).toBe(false);
  });

  it("show_improvements still suppresses the track row in a Knights game", () => {
    const v = setupView();
    v.config.show_improvements = false;
    expect(selectRailShape(state(v)).tracks).toBe(false);
  });
});

/**
 * The Harbormaster slice. The module does publish its ext from the first frame
 * (`InitExt` seeds every seat at zero), but the slot and counter are still read
 * off the ruleset, since they are a property of the game; and -1 on the wire
 * means "nobody holds it", not a seat.
 */
describe("the harbormaster slice", () => {
  const withHarbor = (
    over: Record<string, unknown> = {},
    ruleset = "base+harbormaster",
  ): FullView => {
    const v = setupView(ruleset);
    v.ext = { harbormaster: { holder: -1, points: [0, 0], threshold: 3, ...over } };
    return v;
  };

  it("reserves the Harbormaster threshold from the first frame", () => {
    const s = selectSeat(withHarbor(), 0);
    expect(s.harbormaster).toBe(true);
    expect(s.harbourThreshold).toBe(3);
    expect(s.harbourPoints).toBe(0);
    expect(s.hasHarbormaster).toBe(false);
  });

  it("uses the ruleset, not a missing ext", () => {
    // Can't happen today but must survive if it ever does: no `ext` at all. The
    // flag stays true off the ruleset and the numbers read as the position.
    const v = setupView("base+harbormaster");
    expect(v.ext).toBeUndefined();
    const s = selectSeat(v, 0);
    expect(s.harbormaster).toBe(true);
    expect(s.harbourPoints).toBe(0);
    expect(s.hasHarbormaster).toBe(false);
    expect(s.harbourThreshold).toBe(0);
  });

  it("gives each seat its own count and the card to exactly one of them", () => {
    const v = withHarbor({ holder: 1, points: [2, 4] });
    expect(selectSeat(v, 0).harbourPoints).toBe(2);
    expect(selectSeat(v, 1).harbourPoints).toBe(4);
    expect(selectSeat(v, 0).hasHarbormaster).toBe(false);
    expect(selectSeat(v, 1).hasHarbormaster).toBe(true);
  });

  it("never reads the unheld sentinel as seat 0", () => {
    // -1 is engine.NoPlayer. An absent holder must not default to 0 and hand
    // the card to the first seat in games predating the field.
    expect(selectSeat(withHarbor({ holder: -1 }), 0).hasHarbormaster).toBe(false);
    const missing = setupView("base+harbormaster");
    missing.ext = { harbormaster: { points: [0, 0], threshold: 3 } };
    expect(selectSeat(missing, 0).hasHarbormaster).toBe(false);
  });

  it("still reads as no Harbormaster when the ruleset says so", () => {
    const s = selectSeat(setupView("base"), 0);
    expect(s.harbormaster).toBe(false);
    expect(s.harbourThreshold).toBe(0);
  });
});

/**
 * Memory mode, at the two selectors that answer for it. The bank readout and
 * the rail's shape are decided in different files and must agree with each
 * other and the card, or the countdown strip gets clipped.
 */
describe("memory mode at the HUD's selectors", () => {
  it("removes the bank readout whatever the bank setting", () => {
    const v = setupView();
    expect(selectBank(state(v)).show).toBe(true);
    v.config.memory_mode = true;
    expect(selectBank(state(v)).show).toBe(false);
    // `show_bank: true` can't override it: the mode is stricter and wins.
    v.config.show_bank = true;
    expect(selectBank(state(v)).show).toBe(false);
  });

  it("tells the rail, so the panel height matches the card", () => {
    const v = setupView();
    expect(selectRailShape(state(v)).memory).toBe(false);
    v.config.memory_mode = true;
    expect(selectRailShape(state(v)).memory).toBe(true);
  });

  it("leaves the improvement tracks to their own setting", () => {
    // The one readout memory mode leaves alone: improvement levels are face up
    // at a real table.
    const v = setupView();
    v.config.memory_mode = true;
    expect(selectRailShape(state(v)).tracks).toBe(true);
    v.config.show_improvements = false;
    expect(selectRailShape(state(v)).tracks).toBe(false);
  });

  it("is off for a game recorded before the setting existed", () => {
    // No key on the config at all, as in every existing game.
    const v = setupView();
    expect(v.config.memory_mode).toBeUndefined();
    expect(selectRailShape(state(v)).memory).toBe(false);
    expect(selectBank(state(v)).show).toBe(true);
  });
});

/**
 * The pieces box counts what is left in hand. For knights and walls that is a
 * client-side subtraction: the view carries what is on the board
 * (`ext.cak.knights`, each with an owner and level, and walls built), while
 * the per-player supply (two knight pieces per strength, three walls) is a
 * constant in `engine/knights`.
 *
 * So these guard both halves: other seats' knights must not count against
 * yours, and a promotion moves a piece up a tier rather than adding one.
 */
describe("the pieces left in hand", () => {
  const withKnights = (knights: { owner: number; level: number }[], walls = 0): FullView => {
    const v = setupView();
    v.ext = {
      cak: {
        barbarians: 0,
        attacks: 0,
        knights: knights.map((k) => ({ ...k, active: false })),
        players: [{ walls }, { walls: 0 }],
      },
    };
    return v;
  };

  it("starts a Knights seat with the full supply of both", () => {
    const st = selectStatus(state(setupView()));
    expect([st.knights1, st.knights2, st.knights3]).toEqual([2, 2, 2]);
    expect(st.wallsLeft).toBe(3);
  });

  it("only counts the viewer's own knights against the viewer's supply", () => {
    // Four knights on the board, three of them somebody else's.
    const st = selectStatus(
      state(
        withKnights([
          { owner: 0, level: 1 },
          { owner: 1, level: 1 },
          { owner: 1, level: 2 },
          { owner: 1, level: 3 },
        ]),
      ),
    );
    expect([st.knights1, st.knights2, st.knights3]).toEqual([1, 2, 2]);
  });

  it("counts a promotion as a tier change, not a new piece", () => {
    // Two basics out, then one promoted: the strong piece is spent and a basic
    // piece is back in hand.
    const before = selectStatus(
      state(
        withKnights([
          { owner: 0, level: 1 },
          { owner: 0, level: 1 },
        ]),
      ),
    );
    expect([before.knights1, before.knights2, before.knights3]).toEqual([0, 2, 2]);
    const after = selectStatus(
      state(
        withKnights([
          { owner: 0, level: 1 },
          { owner: 0, level: 2 },
        ]),
      ),
    );
    expect([after.knights1, after.knights2, after.knights3]).toEqual([1, 1, 2]);
  });

  it("counts walls down from the three a player owns", () => {
    expect(selectStatus(state(withKnights([], 2))).wallsLeft).toBe(1);
    expect(selectStatus(state(withKnights([], 3))).wallsLeft).toBe(0);
  });

  it("has no ships to count in a game with no ships", () => {
    // -1 means "this ruleset has none", as `barbarians` is -1 in a base game.
    // Zero is real: an Islands player who has built all fifteen.
    expect(selectStatus(state(setupView())).ships).toBe(-1);
    expect(selectStatus(state(setupView("base"))).ships).toBe(-1);
    const islands = setupView("base+islands");
    islands.ext = { islands: { ships_left: [11, 15] } };
    expect(selectStatus(state(islands)).ships).toBe(11);
  });
});

/**
 * Skip First Invasion, as the HUD reads it: the option is in
 * `config.modules.cak` and the landfall count is `ext.cak.attacks`, so the flag
 * is the AND of both. Forgetting the second half would keep the notice up
 * after the free raid is spent.
 */
describe("the free first invasion", () => {
  const withSkip = (skip: boolean, attacks?: number): FullView => {
    const v = setupView();
    v.config.modules = { cak: { skip_first_barbarian_attack: skip } };
    if (attacks !== undefined) {
      v.ext = { cak: { barbarians: 3, attacks, knights: [], players: [] } };
    }
    return v;
  };

  it("is flagged before the first landfall, in both readouts", () => {
    // No ext at all: the module's state doesn't exist until the first roll,
    // which is before any attack.
    expect(selectStatus(state(withSkip(true))).firstIgnored).toBe(true);
    expect(selectRail(state(withSkip(true))).firstIgnored).toBe(true);
    // And with a live ext still on zero attacks.
    expect(selectStatus(state(withSkip(true, 0))).firstIgnored).toBe(true);
    expect(selectRail(state(withSkip(true, 0))).firstIgnored).toBe(true);
  });

  it("is spent the moment one landfall has resolved", () => {
    expect(selectStatus(state(withSkip(true, 1))).firstIgnored).toBe(false);
    expect(selectRail(state(withSkip(true, 1))).firstIgnored).toBe(false);
    expect(selectStatus(state(withSkip(true, 4))).firstIgnored).toBe(false);
  });

  it("is never set when the table did not ask for the option", () => {
    expect(selectStatus(state(withSkip(false, 0))).firstIgnored).toBe(false);
    expect(selectRail(state(withSkip(false, 0))).firstIgnored).toBe(false);
    // Nothing configured at all is the common case.
    expect(selectStatus(state(setupView())).firstIgnored).toBe(false);
  });

  it("is never set in a base game, whatever the config says", () => {
    const v = withSkip(true);
    v.config.ruleset = "base";
    expect(selectStatus(state(v)).firstIgnored).toBe(false);
    expect(selectRail(state(v)).firstIgnored).toBe(false);
  });
});

describe("commodity row order", () => {
  // The engine's array. `ext.cak.commodities`, `improve` costs, `harbor_give`,
  // `play_progress {com}` and the discard payload are indexed by it, so
  // reordering it is a wire break.
  it("keeps COMMOD in engine order with matching indices", () => {
    expect(COMMOD.map((c) => c.name)).toEqual(["Cloth", "Paper", "Coin"]);
    expect(COMMOD.map((c) => c.idx)).toEqual([0, 1, 2]);
  });

  it("draws the row as paper, cloth, coin", () => {
    expect(COMMOD_ROW.map((c) => c.name)).toEqual(["Paper", "Cloth", "Coin"]);
  });

  it("carries the engine index on each card, so lookups follow the card", () => {
    // Each row entry's `idx` is the engine index of its commodity. Call sites
    // read state and send commands with `c.idx`, so display order can't make a
    // click buy the wrong thing.
    expect(COMMOD_ROW.map((c) => c.idx)).toEqual([1, 0, 2]);
    for (const c of COMMOD_ROW) expect(COMMOD[c.idx]).toBe(c);
  });

  it("is a permutation of COMMOD's own objects", () => {
    expect(COMMOD_ROW).toHaveLength(COMMOD.length);
    expect([...COMMOD_ROW].sort((a, b) => a.idx - b.idx)).toEqual(COMMOD);
  });
});

describe("improvement track row order", () => {
  // Engine track indices: 0 Trade, 1 Politics, 2 Science. `improve`,
  // `metropolis`, `legal.improvements` and `improve_city {track}` all use them.
  it("draws the row as science, trade, politics", () => {
    expect(TRACK_ROW).toEqual([2, 0, 1]);
    expect(seatTracks("0:false|0:false|0:false").map((t) => t.name)).toEqual([
      "Science",
      "Trade",
      "Politics",
    ]);
  });

  it("carries the engine track index on each column", () => {
    expect(seatTracks("0:false|0:false|0:false").map((t) => t.track)).toEqual([2, 0, 1]);
  });

  it("keeps each column's level, metropolis and commodity with its own track", () => {
    // Trade(0) level 4 holding the metropolis; Politics(1) level 1; Science(2)
    // level 5. A positional reorder would put the underline and levels on the
    // wrong bars.
    const row = seatTracks("4:true|1:false|5:false");
    expect(row.map((t) => [t.name, t.level, t.metropolis])).toEqual([
      ["Science", 5, false],
      ["Trade", 4, true],
      ["Politics", 1, false],
    ]);
    // Trade→cloth, Politics→coin, Science→paper, still per column.
    expect(row.map((t) => t.commodity)).toEqual(["paper", "cloth", "coin"]);
    // The colour is the commodity's mark token, not a positional one or the
    // card face (the pastel faces measured 1.12-1.47:1 as bare pips).
    expect(row.map((t) => t.pipColor)).toEqual([COMMOD[1].ink, COMMOD[0].ink, COMMOD[2].ink]);
    // Next cost is level+1 for that track, not for the column.
    expect(row.map((t) => t.nextCost)).toEqual([6, 5, 2]);
  });

  it("tolerates a slice with no track string at all", () => {
    // A base-game seat serialises ""; the card isn't drawn then, but the unpack
    // must not invent levels.
    expect(seatTracks("").map((t) => [t.name, t.level])).toEqual([
      ["Science", 0],
      ["Trade", 0],
      ["Politics", 0],
    ]);
  });

  it("the commodity row and the track row agree on their commodities", () => {
    // The two rows a player reads side by side: the hotbar's commodity cards and
    // the tracks they feed. Both are paper, cloth, coin.
    expect(seatTracks("0:false|0:false|0:false").map((t) => t.commodity)).toEqual(
      COMMOD_ROW.map((c) => c.key),
    );
  });
});

describe("the gold counter follows the ruleset", () => {
  // Explorers' gold is public, like Raiders' and Wagons', so it is on the seat
  // card.
  it("shows Explorers gold before module state arrives", () => {
    const v = setupView("explorers");
    expect(selectSeat(v, 0).gold).toBe(0);
    const withGold = {
      ...v,
      ext: { explorers: { seats: [{ gold: 7 }, { gold: 2 }] } },
    } as unknown as FullView;
    expect(selectSeat(withGold, 1).gold).toBe(2);
  });
  it("a base seat has no gold slot", () => {
    expect(selectSeat(setupView("base"), 0).gold).toBe(-1);
  });
});
