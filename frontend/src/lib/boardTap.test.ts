import { describe, expect, it, vi } from "vitest";
import { edgeTap, routeTap, vertexTap, type ArmedEntry, type BoardTapCtx } from "./boardTap";
import { type BoardMode } from "./boardTargets";
import { edgeHexes } from "./hexgeo";
import { type Edge, type FullView, type Vertex } from "./types";

// A touch tap on an armed spot must offer one entry named for the armed action
// and send exactly the armed command, not open the spot's `actionsAt` menu
// (which knows nothing of the armed mode and would send a build).

const V = (q: number, r: number, side: 0 | 1): Vertex => ({ q, r, side });
const E = (a: Vertex, b: Vertex): Edge => ({ a, b });

const spot = V(1, 0, 0);
const from = V(0, 0, 0);
const edge = E(V(0, 0, 0), V(0, 0, 1));
const other = E(V(2, 0, 0), V(2, 0, 1));
const hurried = E(V(3, 0, 0), V(3, 0, 1));

function makeView(partial: Record<string, unknown> = {}): FullView {
  return {
    viewer: 0,
    phase: "main",
    board: { robber: { q: 0, r: 0 }, tiles: [] },
    roads: [],
    buildings: [],
    players: [{ seat: 0, hand: [0, 9, 9, 9, 9, 9], roads_left: 9 }],
    config: { ruleset: "base" },
    legal: {},
    ...partial,
  } as unknown as FullView;
}

function makeCtx(mode: BoardMode, over: Partial<BoardTapCtx> = {}) {
  const send = vi.fn((_type: string, _data?: unknown, _opts?: { keepMode?: boolean }) => "cmd-1");
  const ctx: BoardTapCtx = {
    view: makeView(),
    mode,
    send,
    setMode: vi.fn(),
    knightMoveFrom: null,
    setKnightMoveFrom: vi.fn(),
    shipMoveFrom: null,
    setShipMoveFrom: vi.fn(),
    diplomatFrom: null,
    setDiplomatFrom: vi.fn(),
    resetDiplomat: vi.fn(),
    progressCard: null,
    setProgressCard: vi.fn(),
    deserterLevel: 1,
    setDeserterPick: vi.fn(),
    setupShip: false,
    setSetupShip: vi.fn(),
    explorersShip: null,
    setExplorersShip: vi.fn(),
    explorersJob: null,
    setExplorersJob: vi.fn(),
    explorersRoad: null,
    setExplorersRoad: vi.fn(),
    explorersRecycle: 0,
    fishPending: null,
    setFishPending: vi.fn(),
    setFishRoad: vi.fn(),
    raidersRole: "none",
    setRaidersStood: vi.fn(),
    riderFrom: null,
    setRiderFrom: vi.fn(),
    riderHurryByFish: false,
    wagonBarbMoving: 0,
    setWagonDestination: vi.fn(),
    setWagonBarbPick: vi.fn(),
    ...over,
  };
  return { ctx, send };
}

/**
 * Tap a spot the way a phone does: whatever surface the tap opens is recorded,
 * and the one entry it offers is chosen.
 */
function touchTap(target: { v: Vertex } | { e: Edge }, ctx: BoardTapCtx) {
  const tap = "v" in target ? vertexTap(target.v, ctx) : edgeTap(target.e, ctx);
  const confirms: ArmedEntry[] = [];
  let roster = 0;
  const held: { run?: () => void } = {};
  routeTap(tap, true, {
    confirm: (entry, run) => {
      confirms.push(entry);
      held.run = run;
    },
    roster: () => {
      roster++;
    },
  });
  const sentBeforeChoosing = (ctx.send as ReturnType<typeof vi.fn>).mock.calls.length;
  const choose = () => held.run?.();
  return { confirms, roster, sentBeforeChoosing, choose };
}

type Case = {
  name: string;
  mode: BoardMode;
  at: { v: Vertex } | { e: Edge };
  over?: Partial<BoardTapCtx>;
  label: string;
  sent: [string, unknown, ({ keepMode?: boolean } | undefined)?];
};

const shipActView = makeView({
  config: { ruleset: "explorers" },
  legal: {
    explorer_ships: [
      {
        ship: 3,
        left: 2,
        acts: [
          { job: "found", v: spot },
          { job: "load_haul", v: V(4, 0, 0), h: { q: 4, r: 0 } },
        ],
      },
    ],
  },
});

const riderView = makeView({
  config: { ruleset: "raiders" },
  ext: { raiders: { rider_moves: [{ from: edge, to: [other], hurry: [hurried] }] } },
});

const CASES: Case[] = [
  // --- vertices ---
  {
    name: "Explorers harbour settlement",
    mode: "harbour",
    at: { v: spot },
    label: "Build harbour settlement",
    sent: ["explorers_build_harbour", { v: spot }],
  },
  {
    name: "Explorers ship lands its settler",
    mode: "shipact",
    at: { v: spot },
    over: { view: shipActView, explorersShip: 3, explorersJob: "found" },
    label: "Land the settler here",
    sent: ["explorers_found", { ship_id: 3, v: spot }],
  },
  {
    name: "Explorers ship takes a haul",
    mode: "shipact",
    at: { v: V(4, 0, 0) },
    over: { view: shipActView, explorersShip: 3, explorersJob: "load_haul" },
    label: "Take the fish haul aboard",
    sent: ["explorers_load_haul", { ship_id: 3, h: { q: 4, r: 0 } }],
  },
  {
    name: "armed settlement",
    mode: "settlement",
    at: { v: spot },
    label: "Build settlement",
    sent: ["build_settlement", { v: spot }, { keepMode: true }],
  },
  {
    name: "armed city",
    mode: "city",
    at: { v: spot },
    label: "Upgrade to city",
    sent: ["build_city", { v: spot }, { keepMode: true }],
  },
  {
    name: "armed wall",
    mode: "wall",
    at: { v: spot },
    label: "Build wall",
    sent: ["build_wall", { v: spot }, { keepMode: true }],
  },
  {
    name: "armed knight",
    mode: "knight",
    at: { v: spot },
    label: "Build knight",
    sent: ["build_knight", { v: spot }, { keepMode: true }],
  },
  {
    name: "Knights knight move",
    mode: "knightmove",
    at: { v: spot },
    over: { knightMoveFrom: from },
    label: "Move the knight here",
    sent: ["move_knight", { from, to: spot }],
  },
  {
    name: "a progress card on an intersection",
    mode: "pvertex",
    at: { v: spot },
    over: { progressCard: "engineer" },
    label: "Play Engineer here",
    sent: ["play_progress", { card: "engineer", v: spot }],
  },
  {
    name: "Deserter replacement knight",
    mode: "deserterplace",
    at: { v: spot },
    over: { deserterLevel: 2 },
    label: "Place the knight here",
    sent: ["deserter_place", { v: spot, level: 2 }],
  },
  {
    name: "displaced knight relocation",
    mode: "relocateknight",
    at: { v: spot },
    label: "Place the knight here",
    sent: ["relocate_knight", { to: spot }],
  },
  {
    name: "barbarian downgrade pick",
    mode: "barbariandowngrade",
    at: { v: spot },
    label: "Give up this city",
    sent: ["barbarian_downgrade", { v: spot }],
  },
  {
    name: "metropolis pick",
    mode: "metropolispick",
    at: { v: spot },
    label: "Put the metropolis here",
    sent: ["metropolis_pick", { v: spot }],
  },
  {
    name: "wagon drive",
    mode: "wagonmove",
    at: { v: spot },
    label: "Drive the wagon here",
    sent: ["wagons_move", { to: spot }, { keepMode: true }],
  },
  // --- edges ---
  {
    name: "Explorers cargo ship build",
    mode: "cargoship",
    at: { e: edge },
    over: { explorersRecycle: 1 },
    label: "Build ship",
    sent: ["explorers_build_ship", { e: edge, recycled: 1 }],
  },
  {
    name: "Explorers sail",
    mode: "sail",
    at: { e: edge },
    over: { explorersShip: 2 },
    label: "Sail here",
    sent: ["explorers_move_ship", { ship_id: 2, path: [edge] }, { keepMode: true }],
  },
  {
    name: "Fishermen 5-fish road",
    mode: "fishedge",
    at: { e: edge },
    over: { fishPending: "free_road" },
    label: "Spend fish on a road here",
    sent: ["spend_fish", { use: "free_road", e: edge }],
  },
  {
    name: "Fishermen 6-fish bridge",
    mode: "fishbridge",
    at: { e: edge },
    over: { fishPending: "bridge" },
    label: "Spend fish on a bridge here",
    sent: ["spend_fish", { use: "bridge", e: edge }],
  },
  {
    name: "Raiders rider placement (Muster)",
    mode: "riderplace",
    at: { e: edge },
    over: { raidersRole: "raiders_muster" },
    label: "Place the rider here",
    sent: ["raiders_place_rider", { e: edge }],
  },
  {
    name: "Raiders landing path",
    mode: "riderplace",
    at: { e: edge },
    over: { raidersRole: "raiders_path" },
    label: "Put the raider on this path",
    sent: ["raiders_pick_path", { e: edge }],
  },
  {
    name: "Raiders rider move",
    mode: "ridermove",
    at: { e: other },
    over: { view: riderView, riderFrom: edge },
    label: "Move the rider here",
    sent: ["raiders_move_rider", { from: edge, to: other }],
  },
  {
    name: "Raiders hurried rider move, paid in grain",
    mode: "ridermove",
    at: { e: hurried },
    over: { view: riderView, riderFrom: edge },
    label: "Hurry the rider here",
    sent: ["raiders_move_rider", { from: edge, to: hurried, hurry: true }],
  },
  {
    name: "Raiders hurried rider move, paid in fish",
    mode: "ridermove",
    at: { e: hurried },
    over: { view: riderView, riderFrom: edge, riderHurryByFish: true },
    label: "Hurry the rider here",
    sent: ["spend_fish", { use: "rider_hurry", from: edge, to: hurried }],
  },
  {
    name: "Wagons barbarian move",
    mode: "wagonbarbarian",
    at: { e: edge },
    over: { wagonBarbMoving: 1 },
    label: "Move the barbarian here",
    sent: ["wagons_barbarian", { barb: 1, e: edge, hex: undefined }],
  },
  {
    name: "armed road (and Road Building's free roads)",
    mode: "road",
    at: { e: edge },
    label: "Build road",
    sent: ["build_road", { e: edge }, { keepMode: true }],
  },
  {
    name: "armed ship",
    mode: "ship",
    at: { e: edge },
    label: "Build ship",
    sent: ["build_ship", { e: edge }, { keepMode: true }],
  },
  {
    name: "Rivers bridge",
    mode: "bridge",
    at: { e: edge },
    label: "Build bridge",
    sent: ["build_bridge", { e: edge }, { keepMode: true }],
  },
  {
    name: "Islands ship move",
    mode: "shipmove",
    at: { e: other },
    over: { shipMoveFrom: edge },
    label: "Move the ship here",
    sent: ["move_ship", { from: edge, to: other }],
  },
  {
    name: "Diplomat relocation",
    mode: "diplomatto",
    at: { e: other },
    over: { diplomatFrom: edge },
    label: "Move the road here",
    sent: ["play_progress", { card: "diplomat", e: edge, to: other }],
  },
  {
    name: "Diplomat removal of another player's road",
    mode: "pedge",
    at: { e: other },
    over: { progressCard: "diplomat", view: makeView({ roads: [{ owner: 1, e: other }] }) },
    label: "Remove this road",
    sent: ["play_progress", { card: "diplomat", e: other }],
  },
  {
    name: "a progress card on an edge",
    mode: "pedge",
    at: { e: edge },
    over: { progressCard: "road_building" },
    label: "Play Road Building here",
    sent: ["play_progress", { card: "road_building", e: edge }],
  },
];

describe("a touch tap on an armed spot confirms the ARMED action", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const { ctx, send } = makeCtx(c.mode, c.over);
      const tap = touchTap(c.at, ctx);
      // Exactly one entry, named for the armed action, never the spot's roster.
      expect(tap.roster).toBe(0);
      expect(tap.confirms).toHaveLength(1);
      expect(tap.confirms[0].label).toBe(c.label);
      expect(tap.confirms[0].status ?? "ready").toBe("ready");
      // Nothing leaves on the tap itself: the menu is the commit.
      expect(tap.sentBeforeChoosing).toBe(0);
      tap.choose();
      expect(send).toHaveBeenCalledTimes(1);
      const [type, data, opts] = send.mock.calls[0];
      expect(type).toBe(c.sent[0]);
      expect(data).toEqual(c.sent[1]);
      if (c.sent[2]) expect(opts).toEqual(c.sent[2]);
      else expect(opts?.keepMode).toBeFalsy();
    });
  }
});

describe("a mouse click commits the same command at once", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const { ctx, send } = makeCtx(c.mode, c.over);
      const tap = "v" in c.at ? vertexTap(c.at.v, ctx) : edgeTap(c.at.e, ctx);
      const confirm = vi.fn();
      const roster = vi.fn();
      routeTap(tap, false, { confirm, roster });
      expect(confirm).not.toHaveBeenCalled();
      expect(roster).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0]).toBe(c.sent[0]);
      expect(send.mock.calls[0][1]).toEqual(c.sent[1]);
    });
  }
});

describe("the follow-up state each armed commit clears", () => {
  it("a knight move lets go of its source", () => {
    const { ctx } = makeCtx("knightmove", { knightMoveFrom: from });
    touchTap({ v: spot }, ctx).choose();
    expect(ctx.setKnightMoveFrom).toHaveBeenCalledWith(null);
  });
  it("a ship move lets go of its source", () => {
    const { ctx } = makeCtx("shipmove", { shipMoveFrom: edge });
    touchTap({ e: other }, ctx).choose();
    expect(ctx.setShipMoveFrom).toHaveBeenCalledWith(null);
  });
  it("a rider move lets go of its rider", () => {
    const { ctx } = makeCtx("ridermove", { view: riderView, riderFrom: edge });
    touchTap({ e: other }, ctx).choose();
    expect(ctx.setRiderFrom).toHaveBeenCalledWith(null);
  });
  it("the 5-fish road remembers its edge and command id for the credit", () => {
    const { ctx } = makeCtx("fishedge", {
      fishPending: "free_road",
      view: makeView({ free_roads: 1 }),
    });
    touchTap({ e: edge }, ctx).choose();
    expect(ctx.setFishRoad).toHaveBeenCalledWith({ e: edge, ref: "cmd-1", owed: 1 });
    expect(ctx.setFishPending).toHaveBeenCalledWith(null);
  });
  it("an Explorers ship job lets go of the ship and job", () => {
    const { ctx } = makeCtx("shipact", {
      view: shipActView,
      explorersShip: 3,
      explorersJob: "found",
    });
    touchTap({ v: spot }, ctx).choose();
    expect(ctx.setExplorersShip).toHaveBeenCalledWith(null);
    expect(ctx.setExplorersJob).toHaveBeenCalledWith(null);
  });
  it("a barbarian with two candidate hexes asks which one instead of sending", () => {
    // A real edge of hex (0,0), so it has two hexes either side to own it.
    const path = E(V(0, 0, 0), V(1, -1, 1));
    const hexes = edgeHexes(path);
    expect(hexes).toHaveLength(2);
    const view = makeView({
      config: { ruleset: "wagons+raiders" },
      ext: { raiders: { relocation_hexes: hexes } },
    });
    const { ctx, send } = makeCtx("wagonbarbarian", { view, wagonBarbMoving: 2 });
    touchTap({ e: path }, ctx).choose();
    expect(send).not.toHaveBeenCalled();
    expect(ctx.setWagonDestination).toHaveBeenCalledWith({ barb: 2, e: path, hexes });
  });
});

describe("the Explorers setup draft on a touch screen", () => {
  const setupView = (round: number, legal: Record<string, unknown> = {}) =>
    makeView({
      phase: "setup",
      config: { ruleset: "explorers" },
      ext: { explorers: { round } },
      legal,
    });

  it("round one confirms the harbour settlement", () => {
    const { ctx, send } = makeCtx("harbour", { view: setupView(0) });
    const tap = touchTap({ v: spot }, ctx);
    expect(tap.roster).toBe(0);
    expect(tap.confirms.map((c) => c.label)).toEqual(["Place harbour settlement"]);
    tap.choose();
    expect(send).toHaveBeenCalledWith("explorers_place_harbour", { v: spot });
  });

  it("round two confirms the Explorers settlement", () => {
    const { ctx, send } = makeCtx("settlement", { view: setupView(1) });
    const tap = touchTap({ v: spot }, ctx);
    expect(tap.confirms.map((c) => c.label)).toEqual(["Place settlement"]);
    tap.choose();
    expect(send).toHaveBeenCalledWith("explorers_place_settlement", { v: spot });
  });

  // The 2025 Knights combination sheet swaps the two buildings: "Your first
  // placement is a city instead of a settlement. Your second placement is a
  // harbor settlement." (engine/explorers/decide.go harbourRound).
  const pairingView = (round: number) =>
    makeView({
      phase: "setup",
      config: { ruleset: "cak+explorers" },
      ext: { explorers: { round } },
    });

  it("with Knights, round one confirms the city", () => {
    const { ctx, send } = makeCtx("settlement", { view: pairingView(0) });
    const tap = touchTap({ v: spot }, ctx);
    expect(tap.confirms.map((c) => c.label)).toEqual(["Place city"]);
    tap.choose();
    expect(send).toHaveBeenCalledWith("explorers_place_settlement", { v: spot });
  });

  it("with Knights, round two confirms the harbour settlement", () => {
    const { ctx, send } = makeCtx("harbour", { view: pairingView(1) });
    const tap = touchTap({ v: spot }, ctx);
    expect(tap.confirms.map((c) => c.label)).toEqual(["Place harbour settlement"]);
    tap.choose();
    expect(send).toHaveBeenCalledWith("explorers_place_harbour", { v: spot });
  });

  it("round three confirms road and ship together", () => {
    const view = setupView(2, { roads: [edge], ships: [other] });
    const first = makeCtx("road", { view });
    const pick = touchTap({ e: edge }, first.ctx);
    expect(pick.confirms).toHaveLength(0);
    expect(pick.roster).toBe(0);
    expect(first.ctx.setExplorersRoad).toHaveBeenCalledWith(edge);
    expect(first.send).not.toHaveBeenCalled();

    const second = makeCtx("ship", { view, explorersRoad: edge });
    const tap = touchTap({ e: other }, second.ctx);
    expect(tap.confirms.map((c) => c.label)).toEqual(["Place the road and ship"]);
    tap.choose();
    expect(second.send).toHaveBeenCalledWith("explorers_place_start", { road: edge, ship: other });
  });
});

describe("what still opens the spot's own roster, and what runs without asking", () => {
  it("a base setup settlement hands the spot to actionsAt", () => {
    const { ctx } = makeCtx("settlement", { view: makeView({ phase: "setup" }) });
    const tap = touchTap({ v: spot }, ctx);
    expect(tap.roster).toBe(1);
    expect(tap.confirms).toHaveLength(0);
  });
  it("a base setup road hands the spot to actionsAt", () => {
    const { ctx } = makeCtx("road", { view: makeView({ phase: "setup" }) });
    expect(touchTap({ e: edge }, ctx).roster).toBe(1);
  });
  it("Diplomat pick on an own road arms the relocate", () => {
    const { ctx, send } = makeCtx("pedge", {
      progressCard: "diplomat",
      view: makeView({ roads: [{ owner: 0, e: edge }] }),
    });
    const tap = touchTap({ e: edge }, ctx);
    expect(tap.confirms).toHaveLength(0);
    expect(ctx.setDiplomatFrom).toHaveBeenCalledWith(edge);
    expect(send).not.toHaveBeenCalled();
  });
  it("relocating the Diplomat's road onto itself lets go instead", () => {
    const { ctx, send } = makeCtx("diplomatto", { diplomatFrom: edge });
    const tap = touchTap({ e: edge }, ctx);
    expect(tap.confirms).toHaveLength(0);
    expect(ctx.resetDiplomat).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("a two-step mode with no source chosen yet does nothing", () => {
    for (const mode of ["knightmove", "shipmove", "ridermove", "sail", "diplomatto"] as const) {
      const { ctx } = makeCtx(mode);
      const tap = mode === "knightmove" ? vertexTap(spot, ctx) : edgeTap(edge, ctx);
      expect(tap, mode).toBeNull();
    }
  });
  it("an unarmed board ignores the tap (inspect has its own handler)", () => {
    const { ctx } = makeCtx("inspect");
    expect(vertexTap(spot, ctx)).toBeNull();
    expect(edgeTap(edge, ctx)).toBeNull();
  });
});

describe("an armed plain build offers only the armed piece", () => {
  it("armed with a road, a coastal edge does not also offer the ship", () => {
    // A land hex at (0,0) and sea beside it: the edge takes a road or a ship,
    // and the spot's roster lists both. Armed with a road, only the road.
    const coastal = E(V(0, 0, 0), V(1, -1, 1));
    const view = makeView({
      config: { ruleset: "islands" },
      board: {
        robber: { q: 0, r: 0 },
        tiles: [
          { hex: { q: 0, r: 0 }, terrain: "forest" },
          { hex: { q: 1, r: -1 }, terrain: "sea" },
          { hex: { q: 0, r: -1 }, terrain: "sea" },
        ],
      },
      legal: { roads: [coastal], ships: [coastal] },
    });
    const { ctx, send } = makeCtx("road", { view });
    const tap = touchTap({ e: coastal }, ctx);
    expect(tap.confirms.map((c) => c.label)).toEqual(["Build road"]);
    tap.choose();
    expect(send).toHaveBeenCalledWith("build_road", { e: coastal }, { keepMode: true });
  });
});
