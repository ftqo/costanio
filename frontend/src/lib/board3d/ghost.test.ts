import { test, expect, describe } from "vitest";
import {
  hoverEffectFor,
  ghostCycleIndex,
  ghostFade,
  bulgeScale,
  bulgeEase,
  shrinkEase,
  BULGE_MS,
  BULGE_SCALE,
  GHOST_FADE_MS,
  pieceForMode,
  setupPlacesCity,
  GHOST_CYCLE_MS,
  type HoverEffect,
} from "./ghost";
import type { BoardMode } from "@/lib/boardTargets";
import type { PickTarget } from "./targets";
import type { LocationAction } from "@/lib/locationActions";
import type { FullView } from "@/lib/types";

const vertex = (action: "vertex" | "inspect"): PickTarget => ({
  kind: "vertex",
  action,
  key: `${action}:0,0,0`,
  v: { q: 0, r: 0, side: 0 },
  pos: [0, 0, 0],
});

const edge = (action: "edge" | "inspect"): PickTarget => ({
  kind: "edge",
  action,
  key: `${action}:0,0,0`,
  e: { a: { q: 0, r: 0, side: 0 }, b: { q: 0, r: 0, side: 1 } },
  pos: [0, 0, 0],
});

const hex = (): PickTarget => ({
  kind: "hex",
  action: "hex",
  key: "hex:0,0",
  h: { q: 0, r: 0 },
  pos: [0, 0, 0],
});

const act = (id: string, status: LocationAction["status"] = "ready"): LocationAction => ({
  id,
  label: id,
  seatLabel: id,
  rank: 1,
  status,
});

/**
 * The pieces a hover would ghost, or [] for any other answer.
 *
 * Most of the table below is about which art a preview shows, which reads
 * better as a list. Tests about which of the three answers a spot gives assert
 * on the effect itself.
 */
const ghostsOf = (e: HoverEffect) => (e.kind === "ghost" ? e.pieces : []);

describe("hoverEffectFor: which art a preview shows", () => {
  test("a build mode previews exactly the piece that mode places", () => {
    // Targets are planned per mode, so there is never a choice to cycle here.
    expect(ghostsOf(hoverEffectFor(vertex("vertex"), "settlement", []))).toEqual(["settlement"]);
    expect(ghostsOf(hoverEffectFor(vertex("vertex"), "city", []))).toEqual(["city"]);
    expect(ghostsOf(hoverEffectFor(edge("edge"), "road", []))).toEqual(["road"]);
    expect(ghostsOf(hoverEffectFor(edge("edge"), "ship", []))).toEqual(["ship"]);
  });

  test("modes that place no piece ghost nothing", () => {
    // Swapping two number tokens changes no piece; drawing one would promise a
    // placement that isn't happening.
    expect(ghostsOf(hoverEffectFor(vertex("vertex"), "none", []))).toEqual([]);
    expect(ghostsOf(hoverEffectFor(hex(), "inventor1", []))).toEqual([]);
  });

  test("moving the robber previews the robber on the hex it would land on", () => {
    // This move is about which tile gets shut off, so the robber is shown.
    expect(ghostsOf(hoverEffectFor(hex(), "robber", []))).toEqual(["robber"]);
    expect(ghostsOf(hoverEffectFor(hex(), "pirate", []))).toEqual(["pirate"]);
    expect(ghostsOf(hoverEffectFor(hex(), "chaserobber", []))).toEqual(["robber"]);
  });

  test("an inspect target offers every placeable action, in the menu's order", () => {
    const kinds = ghostsOf(
      hoverEffectFor(edge("inspect"), "none", [act("build_road"), act("build_ship")]),
    );
    expect(kinds).toEqual(["road", "ship"]);
  });

  test("actions that move or change an existing piece are not previewed", () => {
    // The piece is already on the board; a ghost would draw a second one.
    const kinds = ghostsOf(
      hoverEffectFor(vertex("inspect"), "none", [
        act("activate_knight"),
        act("promote_knight"),
        act("move_knight"),
        act("chase_robber"),
      ]),
    );
    expect(kinds).toEqual([]);
  });

  test("a wall previews as the wall ring, not as nothing", () => {
    // A placement: the ring is new art around the city already on the vertex.
    expect(ghostsOf(hoverEffectFor(vertex("inspect"), "none", [act("build_wall")]))).toEqual([
      "wall",
    ]);
  });

  test("a city and its wall cycle as two distinct previews", () => {
    // Both are legal on some vertices at once (upgrade here, or wall the one
    // you have); the cycle has to show each rather than collapse them.
    expect(
      ghostsOf(hoverEffectFor(vertex("inspect"), "none", [act("build_city"), act("build_wall")])),
    ).toEqual(["city", "wall"]);
  });

  test("a placeable action mixed in with unplaceable ones still previews", () => {
    const kinds = ghostsOf(
      hoverEffectFor(vertex("inspect"), "none", [
        act("activate_knight"),
        act("build_city"),
        act("promote_knight"),
      ]),
    );
    expect(kinds).toEqual(["city"]);
  });

  test("a kind offered twice is only cycled once", () => {
    const kinds = ghostsOf(
      hoverEffectFor(vertex("inspect"), "none", [act("build_city"), act("build_city")]),
    );
    expect(kinds).toEqual(["city"]);
  });
});

// Only the four fields setupPlacesCity reads; cast through unknown so the test
// is not hostage to the rest of FullView.
const setupView = (
  ruleset: string,
  phase: FullView["phase"],
  round: number | undefined,
): FullView => ({ phase, setup_round: round, config: { ruleset } }) as unknown as FullView;

describe("pieceForMode: the audit, one row per mode", () => {
  // The whole table, asserted as data. A new BoardMode fails the type check in
  // ghost.ts; a mode that loses its piece fails here.
  const EXPECTED: Record<BoardMode, ReturnType<typeof pieceForMode>> = {
    none: null,
    inspect: null,
    settlement: "settlement",
    city: "city",
    // Picking which city to wall is its own mode, and the ring is what it puts
    // down; the city under it is already standing.
    wall: "wall",
    road: "road",
    ship: "ship",
    // The Rivers bridge, previewed as itself. A road ghost here would show the
    // one piece this edge refuses.
    bridge: "bridge",
    fishbridge: "bridge",
    // The Fishermen 5-fish spend places nothing on this edge: it buys a credit,
    // and the piece goes down later wherever is best by then. A ghost road
    // would be wrong, and under Islands the spot may be a ship edge.
    fishedge: null,
    knight: "knight",
    shipmove: "ship",
    knightmove: "knight",
    relocateknight: "knight",
    deserterplace: "knight",
    diplomatto: "road",
    // A removal: the city is what leaves, so it goes translucent. Like
    // Diplomat it cannot name the piece; it is whichever city the pointer is on.
    barbariandowngrade: "standing",
    // Nothing is placed and nothing is lost, so it names no piece and the hover
    // falls through to the swell. See the forced-picks block below.
    metropolispick: null,
    // Destinations: the hex under the pointer is where the marker is going.
    // The hex it stands on is not a target (Board3D keeps it in `blocked`).
    robber: "robber",
    pirate: "pirate",
    chaserobber: "robber",
    chasepirate: "pirate",
    inventor1: null,
    inventor2: null,
    // Card-dependent; covered on their own below.
    phex: null,
    pvertex: null,
    pedge: null,
    // Raiders. A Muster places a rider and a move names a destination, so both
    // get a ghost.
    riderplace: "rider",
    ridermove: "rider",
    // The three hex picks preview nothing because none places a piece of
    // yours: `raiderhex` names where an enemy figure lands or which is taken
    // prisoner, and the Treason modes move enemy figures as part of an unsent
    // plan. A ghost in the viewer's colour would be misleading.
    raiderhex: null,
    treasonfrom: null,
    treasonto: null,
    // Wagons. A wagon move and an owed barbarian both move a piece already on
    // the board, like the robber; a ghost would be a second copy.
    wagonmove: null,
    wagonbarbarian: null,
    // Explorers. A harbour settlement is the settlement it upgrades (the quay
    // is an add-on beside it). A cargo ship and a sailing step both put a ship
    // on the edge. `shipact` places nothing: the corner is where the ship
    // reaches, and its four jobs land different things in different places.
    harbour: "settlement",
    cargoship: "ship",
    sail: "ship",
    shipact: null,
  };

  for (const [mode, want] of Object.entries(EXPECTED) as [BoardMode, string | null][]) {
    test(`${mode} previews ${want ?? "nothing"}`, () => {
      expect(pieceForMode(mode)).toBe(want);
    });
  }

  test("a destination mode previews the piece that will arrive there", () => {
    // A move mode's targets are where the piece is going; nothing stands there
    // yet, so the ghost is not a duplicate.
    expect(pieceForMode("knightmove")).toBe("knight");
    expect(pieceForMode("shipmove")).toBe("ship");
    expect(pieceForMode("relocateknight")).toBe("knight");
    expect(pieceForMode("diplomatto")).toBe("road");
  });

  test("moving a shared marker previews that marker at its destination", () => {
    // A destination ghost is about the spot, not the piece. There is one robber
    // and one pirate, and the hex each stands on is excluded from the targets,
    // so the preview never doubles the real piece.
    expect(pieceForMode("robber")).toBe("robber");
    expect(pieceForMode("pirate")).toBe("pirate");
    expect(pieceForMode("chaserobber")).toBe("robber");
  });
});

describe("pieceForMode: progress cards", () => {
  test("Medicine's vertex previews a city", () => {
    // `pvertex` is one mode shared by every vertex-targeting card, so it cannot
    // name a piece; the card does (Medicine's upgrade is a city).
    expect(pieceForMode("pvertex", { progressCard: "medicine" })).toBe("city");
    expect(
      ghostsOf(hoverEffectFor(vertex("vertex"), "pvertex", [], { progressCard: "medicine" })),
    ).toEqual(["city"]);
  });

  test("Merchant's hex previews the merchant token", () => {
    expect(pieceForMode("phex", { progressCard: "merchant" })).toBe("merchant");
  });

  test("cards that take a piece name the piece standing there", () => {
    // Intrigue points at the enemy knight it will evict; Diplomat at the road
    // it will lift. The piece is whichever one the pointer is on, so they say
    // "standing" rather than `null`, which distinguishes a removal from a card
    // that previews nothing (like Inventor).
    expect(pieceForMode("pvertex", { progressCard: "intrigue" })).toBe("standing");
    expect(pieceForMode("pedge", { progressCard: "diplomat" })).toBe("standing");
  });

  test("Bishop's hex previews the robber that will land on it", () => {
    // Bishop's target is where the robber is going, the same as the `robber`
    // mode's targets.
    expect(pieceForMode("phex", { progressCard: "bishop" })).toBe("robber");
  });

  test("an unknown or absent card previews nothing rather than guessing", () => {
    expect(pieceForMode("pvertex", { progressCard: "some_new_card" })).toBeNull();
    expect(pieceForMode("pvertex", { progressCard: null })).toBeNull();
    expect(pieceForMode("pvertex")).toBeNull();
  });

  test("the card only speaks inside a progress mode", () => {
    // Medicine in hand must not turn an ordinary settlement build into a city
    // preview; the mode still owns every non-progress spot.
    expect(pieceForMode("settlement", { progressCard: "medicine" })).toBe("settlement");
    expect(pieceForMode("road", { progressCard: "merchant" })).toBe("road");
  });
});

describe("setupPlacesCity", () => {
  test("Knights' second setup placement is a city", () => {
    expect(setupPlacesCity(setupView("base+cak", "setup", 1))).toBe(true);
    expect(
      ghostsOf(hoverEffectFor(vertex("vertex"), "settlement", [], { setupCity: true })),
    ).toEqual(["city"]);
  });

  test("Raiders and Wagons also place a city second (SetupRound2City)", () => {
    // Both modules set the hook; the preview and the prompt promised a
    // settlement and the engine put a city down.
    for (const rs of ["base+raiders", "base+wagons", "base+raiders+wagons", "base+cak+raiders"]) {
      expect(setupPlacesCity(setupView(rs, "setup", 1)), rs).toBe(true);
      expect(setupPlacesCity(setupView(rs, "setup", 0)), rs).toBe(false);
    }
  });

  test("the first Knights placement is still a settlement", () => {
    expect(setupPlacesCity(setupView("base+cak", "setup", 0))).toBe(false);
    // A missing setup_round is round 0, not "unknown": the field is omitted
    // before the first placement advances it.
    expect(setupPlacesCity(setupView("base+cak", "setup", undefined))).toBe(false);
  });

  test("Knights with Explorers places its city first", () => {
    // The combination sheet: the first placement is a city and the second a
    // harbor settlement. Explorers owns the draft, so its own round counts,
    // not the base setup_round.
    const pairing = (round: number) =>
      ({
        phase: "setup",
        config: { ruleset: "cak+explorers" },
        ext: { explorers: { round } },
      }) as unknown as FullView;
    expect(setupPlacesCity(pairing(0))).toBe(true);
    expect(setupPlacesCity(pairing(1))).toBe(false);
    expect(setupPlacesCity(pairing(2))).toBe(false);
  });

  test("the base game (and Islands) place a settlement in both rounds", () => {
    expect(setupPlacesCity(setupView("base", "setup", 1))).toBe(false);
    expect(setupPlacesCity(setupView("base+islands", "setup", 1))).toBe(false);
  });

  test("play-phase settlement building is never a city", () => {
    // setup_round keeps its last value after setup ends; the phase is what
    // stops a normal Knights settlement build previewing as a city.
    expect(setupPlacesCity(setupView("base+cak", "play", 1))).toBe(false);
  });

  test("the setup-city override touches only the settlement mode", () => {
    // A fact about one placement, not a global "cities everywhere".
    expect(ghostsOf(hoverEffectFor(edge("edge"), "road", [], { setupCity: true }))).toEqual([
      "road",
    ]);
    expect(ghostsOf(hoverEffectFor(vertex("vertex"), "knight", [], { setupCity: true }))).toEqual([
      "knight",
    ]);
    // Absent context is the ordinary case and must not change.
    expect(ghostsOf(hoverEffectFor(vertex("vertex"), "settlement", []))).toEqual(["settlement"]);
  });
});

describe("ghostCycleIndex", () => {
  test("holds each entry for the full interval, then advances", () => {
    expect(ghostCycleIndex(0, 2)).toBe(0);
    expect(ghostCycleIndex(GHOST_CYCLE_MS - 1, 2)).toBe(0);
    expect(ghostCycleIndex(GHOST_CYCLE_MS, 2)).toBe(1);
    expect(ghostCycleIndex(GHOST_CYCLE_MS * 2, 2)).toBe(0);
  });

  test("a lone entry never advances, so the caller can skip the timer", () => {
    for (const t of [0, GHOST_CYCLE_MS, GHOST_CYCLE_MS * 99]) {
      expect(ghostCycleIndex(t, 1)).toBe(0);
    }
  });

  test("stays in range for three or more, and never goes negative", () => {
    for (let t = 0; t < GHOST_CYCLE_MS * 7; t += 137) {
      const i = ghostCycleIndex(t, 3);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(3);
    }
    expect(ghostCycleIndex(-500, 3)).toBe(0);
  });
});

describe("a ghost only ever previews something you can actually do", () => {
  test("previews the knight on a vertex too close to a settlement", () => {
    // The distance rule makes a settlement illegal beside another settlement,
    // while a knight is fine there. The roster still lists both so the menu can
    // grey one out, but the board must not ghost a settlement there.
    const kinds = ghostsOf(
      hoverEffectFor(vertex("inspect"), "none", [
        act("build_settlement", "blocked"),
        act("build_knight"),
      ]),
    );
    expect(kinds).toEqual(["knight"]);
  });

  test("an entry you merely cannot afford still previews", () => {
    // Short of resources is not impossible: the spot can take a settlement,
    // and the menu explains the cost. Refusing the ghost would drop the spot
    // back to a bare disc.
    const kinds = ghostsOf(
      hoverEffectFor(vertex("inspect"), "none", [act("build_settlement", "short")]),
    );
    expect(kinds).toEqual(["settlement"]);
  });

  test("a coastal edge drops only the leg that is impossible", () => {
    expect(
      ghostsOf(hoverEffectFor(edge("inspect"), "none", [act("build_road"), act("build_ship")])),
    ).toEqual(["road", "ship"]);
    expect(
      ghostsOf(
        hoverEffectFor(edge("inspect"), "none", [act("build_road"), act("build_ship", "blocked")]),
      ),
    ).toEqual(["road"]);
    expect(
      ghostsOf(
        hoverEffectFor(edge("inspect"), "none", [act("build_road"), act("build_ship", "short")]),
      ),
    ).toEqual(["road", "ship"]);
  });
});

describe("hovering a piece of your own makes the piece answer", () => {
  test("a knight with only verbs on offer swells", () => {
    // Activate, Promote, Move and Chase place nothing and remove nothing, so
    // there is nothing to ghost. The piece answers for itself.
    expect(
      hoverEffectFor(vertex("inspect"), "none", [act("activate_knight")], { standing: "knight" }),
    ).toEqual({ kind: "bulge" });
  });

  test("your settlement swells instead of previewing a city", () => {
    // Pointing at your own settlement is not asking to upgrade it, and the
    // hover must mean the same whether or not you hold the ore. Arming the city
    // in the shelf previews it through the mode path instead.
    expect(
      hoverEffectFor(vertex("inspect"), "none", [act("build_city")], { standing: "settlement" }),
    ).toEqual({ kind: "bulge" });
  });

  test("your city swells rather than previewing the wall it could gain", () => {
    expect(
      hoverEffectFor(vertex("inspect"), "none", [act("build_wall")], { standing: "city" }),
    ).toEqual({ kind: "bulge" });
  });

  test("a ROAD says nothing at all, and a ship with it", () => {
    // The exception, which is why the rule is about pieces rather than spots:
    // a swollen road in a gutter is a couple of pixels. `move_ship` is a real
    // action here, but the swell cannot show it at this size, so the cursor
    // carries it alone.
    expect(
      hoverEffectFor(edge("inspect"), "none", [act("move_ship")], { standing: "ship" }),
    ).toEqual({ kind: "none" });
    expect(hoverEffectFor(edge("inspect"), "none", [], { standing: "road" })).toEqual({
      kind: "none",
    });
  });

  test("armed modes are untouched: the shelf still previews what it will build", () => {
    // The mode path never consults the roster, so selecting City in the shelf
    // and sweeping the board previews cities exactly as before.
    expect(ghostsOf(hoverEffectFor(vertex("vertex"), "city", []))).toEqual(["city"]);
    expect(ghostsOf(hoverEffectFor(edge("edge"), "road", []))).toEqual(["road"]);
  });
});

describe("the forced picks: one loses a piece, one does not", () => {
  test("the barbarian downgrade fades the city being lost", () => {
    // The mode exists because you lost a defence and owe a city, so the
    // question is which city to give up: that city goes translucent where it
    // stands. The settlement replacing it is the consequence, not the subject.
    // A piece standing on the spot must not send the hover to the swell here.
    expect(
      hoverEffectFor(vertex("vertex"), "barbariandowngrade", [], { standing: "city" }),
    ).toEqual({ kind: "ghost", pieces: ["city"], hides: true, leaving: true });
  });

  test("the metropolis pick swells the city", () => {
    // Nothing is placed or lost: the city stays and gains a district. A
    // translucent city over the solid one says nothing.
    expect(hoverEffectFor(vertex("vertex"), "metropolispick", [], { standing: "city" })).toEqual({
      kind: "bulge",
    });
  });
});

describe("a card that takes a piece ghosts that piece", () => {
  test("Diplomat ghosts the road it is about to lift, and hides the real one", () => {
    // Nothing arrives, so the preview is the road itself going translucent
    // where it stands. The renderer hides the solid one and tints the ghost in
    // its owner's colour, since the road is usually not yours. Roads are exempt
    // from the swell, not from having their removal drawn.
    expect(
      hoverEffectFor(edge("edge"), "pedge", [], { progressCard: "diplomat", standing: "road" }),
    ).toEqual({ kind: "ghost", pieces: ["road"], hides: true, leaving: true });
  });

  test("Intrigue ghosts the enemy knight, at its own tier", () => {
    expect(
      hoverEffectFor(vertex("vertex"), "pvertex", [], {
        progressCard: "intrigue",
        standing: "knight_mighty",
      }),
    ).toEqual({ kind: "ghost", pieces: ["knight_mighty"], hides: true, leaving: true });
  });

  test("a removal card pointed at an empty spot draws nothing", () => {
    // There is no piece to take, so nothing to draw leaving.
    expect(hoverEffectFor(edge("edge"), "pedge", [], { progressCard: "diplomat" })).toEqual({
      kind: "none",
    });
  });

  test("a card that places something previews it", () => {
    // Medicine builds a city, so the arrival wins over what is standing there,
    // and the settlement it replaces is hidden while the preview is up.
    expect(
      hoverEffectFor(vertex("vertex"), "pvertex", [], {
        progressCard: "medicine",
        standing: "settlement",
      }),
    ).toEqual({ kind: "ghost", pieces: ["city"], hides: true, leaving: false });
  });

  test("and a card with neither previews nothing rather than guessing", () => {
    expect(
      ghostsOf(hoverEffectFor(vertex("vertex"), "pvertex", [], { progressCard: "some_new_card" })),
    ).toEqual([]);
  });
});

describe("which ghosts are a piece LEAVING", () => {
  // The renderer never slides or lingers one of these: a removal has no
  // destination, the preview is the piece standing there. `hides` cannot
  // answer this because an upgrade hides the piece under it too.
  test("the three removals say so", () => {
    for (const [mode, standing] of [
      ["barbariandowngrade", "city"],
      ["pedge", "road"],
      ["pvertex", "knight"],
    ] as const) {
      const progressCard =
        mode === "pedge" ? "diplomat" : mode === "pvertex" ? "intrigue" : undefined;
      const at = mode === "pedge" ? edge("edge") : vertex("vertex");
      const e = hoverEffectFor(at, mode, [], { standing, progressCard });
      expect(e.kind).toBe("ghost");
      if (e.kind === "ghost") expect(e.leaving).toBe(true);
    }
  });

  test("an arrival does not, whether or not it hides what is under it", () => {
    // The upgrade hides the settlement just as a removal hides the road, and
    // it is the opposite event.
    for (const [mode, standing] of [
      ["city", "settlement"],
      ["settlement", null],
      ["wall", "city"],
      ["knightmove", null],
    ] as const) {
      const e = hoverEffectFor(vertex("vertex"), mode, [], { standing });
      expect(e.kind).toBe("ghost");
      if (e.kind === "ghost") expect(e.leaving).toBe(false);
    }
  });
});

describe("what a ghost hides, and what it stands beside", () => {
  test("a wall leaves the city it rings alone", () => {
    // The one exception, and why `hides` is carried rather than derived from
    // "is a piece here": a wall is an addition. Hiding the city would preview a
    // ring around nothing.
    expect(hoverEffectFor(vertex("vertex"), "wall", [], { standing: "city" })).toEqual({
      kind: "ghost",
      pieces: ["wall"],
      hides: false,
      leaving: false,
    });
  });

  test("a build on an empty spot hides nothing", () => {
    expect(hoverEffectFor(vertex("vertex"), "settlement", [])).toEqual({
      kind: "ghost",
      pieces: ["settlement"],
      hides: false,
      leaving: false,
    });
  });

  test("a destination hides nothing", () => {
    // A knight being moved is not standing on the vertex it is moving TO.
    expect(hoverEffectFor(vertex("vertex"), "knightmove", [])).toEqual({
      kind: "ghost",
      pieces: ["knight"],
      hides: false,
      leaving: false,
    });
  });

  test("an inspect spot's build options hide nothing", () => {
    // This branch is only reached when nothing of yours is standing here, so
    // every option in the cycle is an arrival on an empty spot.
    const e = hoverEffectFor(edge("inspect"), "none", [act("build_road"), act("build_ship")]);
    expect(e).toEqual({ kind: "ghost", pieces: ["road", "ship"], hides: false, leaving: false });
  });
});

describe("ghostFade", () => {
  test("runs from nothing to fully shown across GHOST_FADE_MS", () => {
    expect(ghostFade(0)).toBe(0);
    expect(ghostFade(GHOST_FADE_MS)).toBe(1);
    expect(ghostFade(GHOST_FADE_MS * 2)).toBe(1);
  });

  test("is monotonic, and eased rather than linear", () => {
    // Eased so the piece does not appear to jump: with an instant swap the
    // first frame is the abrupt part, and a linear ramp keeps most of it.
    const half = ghostFade(GHOST_FADE_MS / 2);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    expect(half).not.toBeCloseTo(0.5, 2);
    let prev = -1;
    for (let t = 0; t <= GHOST_FADE_MS; t += 20) {
      const v = ghostFade(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  test("never goes negative on a clock that ran backwards", () => {
    expect(ghostFade(-50)).toBe(0);
  });
});

describe("bulgeScale", () => {
  test("runs from the piece's own size to BULGE_SCALE across BULGE_MS", () => {
    expect(bulgeScale(0)).toBe(1);
    expect(bulgeScale(BULGE_MS)).toBeCloseTo(BULGE_SCALE, 10);
    // Held, not looped: the piece stays swollen while the pointer is on it.
    expect(bulgeScale(BULGE_MS * 5)).toBeCloseTo(BULGE_SCALE, 10);
  });

  test("overshoots and settles back, so it reads as a response", () => {
    let peak = 0;
    for (let t = 0; t <= BULGE_MS; t += 1) peak = Math.max(peak, bulgeScale(t));
    expect(peak).toBeGreaterThan(BULGE_SCALE);
    // Not by much; a piece that visibly bounces reads as a toy.
    expect(peak).toBeLessThan(BULGE_SCALE + (BULGE_SCALE - 1) * 0.4);
  });

  test("stays at the piece's own size on a clock that ran backwards", () => {
    expect(bulgeScale(-50)).toBe(1);
  });
});

describe("bulgeEase and shrinkEase", () => {
  // The ramps interpolate the caller's endpoints, so both curves must land
  // exactly on 0 and 1 or the piece ends a hair off its real size.
  test("both run from 0 to exactly 1", () => {
    expect(bulgeEase(0)).toBe(0);
    expect(bulgeEase(1)).toBe(1);
    expect(shrinkEase(0)).toBe(0);
    expect(shrinkEase(1)).toBe(1);
  });

  test("bulgeEase is what carries the overshoot", () => {
    let peak = 0;
    for (let k = 0; k <= 1; k += 0.01) peak = Math.max(peak, bulgeEase(k));
    expect(peak).toBeGreaterThan(1);
  });

  test("shrinkEase has none: the pointer has already left", () => {
    for (let k = 0; k <= 1; k += 0.01) {
      expect(shrinkEase(k)).toBeLessThanOrEqual(1);
      expect(shrinkEase(k)).toBeGreaterThanOrEqual(0);
    }
    // And it is monotonic, so a piece never grows on its way back down.
    let prev = -1;
    for (let k = 0; k <= 1; k += 0.05) {
      expect(shrinkEase(k)).toBeGreaterThanOrEqual(prev);
      prev = shrinkEase(k);
    }
  });

  test("both clamp a clock that ran past either end", () => {
    expect(bulgeEase(-1)).toBe(0);
    expect(bulgeEase(5)).toBe(1);
    expect(shrinkEase(-1)).toBe(0);
    expect(shrinkEase(5)).toBe(1);
  });
});
