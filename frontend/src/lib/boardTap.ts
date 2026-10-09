// What a tap on a board vertex or edge does, given the mode the player armed.
//
// On a touch screen a tap opens a menu and the menu commits (see `placeOrAsk`
// in routes/Game), because the finger hides the target. An armed mode (moving
// a ship, sailing an Explorers hull, moving a rider) is screen state, not view
// state, so `actionsAt`'s per-spot roster cannot describe it. Each armed
// branch therefore returns the one menu entry, labelled with the armed action,
// and the closure that runs it; touch offers that entry and a mouse runs it
// immediately. Only unarmed setup placements use `actionsAt`, whose roster
// fits them (an Islands setup edge takes a road or a ship).
//
// Pure apart from the callbacks, so a test can tap with a fake screen and read
// back which command was sent.
import { t } from "@lingui/core/macro";
import { edgeKey, vertexKey } from "./hexgeo";
import { type Edge, type ExplorerShipAct, type FullView, type Hex, type Vertex } from "./types";
import { type BoardMode } from "./boardTargets";
import { actionsAt, type BoardLocation, type LocationAction } from "./locationActions";
import { isExplorers, setupStep as explorersSetupStep } from "./explorers";
import { isHurryTarget, riderMoveFrom, type RaidersRole } from "./raiders";
import { barbarianHexChoices } from "./wagons";
import { type FishRoadPending, type FishSpend } from "./fish";
import { progressCardName } from "./progressCards";

/**
 * The one entry an armed tap offers. A `LocationAction` without the fields the
 * roster owns: `rank` is always 1 (it is the only entry), and there is no
 * `cmd`/`mode` because the tap carries its own closure. `status` defaults to
 * ready, since the board only offers a spot its target set lit.
 */
export type ArmedEntry = Omit<LocationAction, "rank" | "cmd" | "mode" | "status"> & {
  status?: LocationAction["status"];
};

export type BoardTap =
  /** A commit for the armed mode: confirm it by name on touch, run it on a mouse. */
  | { kind: "armed"; entry: ArmedEntry; run: () => void }
  /** An unarmed setup placement: touch opens the spot's `actionsAt` roster. */
  | { kind: "roster"; run: () => void }
  /**
   * A choice within a step (the first of two picks). Runs on every pointer;
   * the second pick is what asks.
   */
  | { kind: "pick"; run: () => void };

/** Everything a tap reads from, and writes back to, the game screen. */
export interface BoardTapCtx {
  view: FullView;
  /** The effective board mode (`effMode`). */
  mode: BoardMode;
  send: (type: string, data?: unknown, opts?: { keepMode?: boolean }) => string | null;
  setMode: (m: BoardMode) => void;

  knightMoveFrom: Vertex | null;
  setKnightMoveFrom: (v: Vertex | null) => void;
  shipMoveFrom: Edge | null;
  setShipMoveFrom: (e: Edge | null) => void;
  diplomatFrom: Edge | null;
  setDiplomatFrom: (e: Edge | null) => void;
  resetDiplomat: () => void;
  progressCard: string | null;
  setProgressCard: (c: string | null) => void;
  deserterLevel: number;
  setDeserterPick: (n: number | null) => void;

  setupShip: boolean;
  setSetupShip: (b: boolean) => void;

  explorersShip: number | null;
  setExplorersShip: (n: number | null) => void;
  explorersJob: ExplorerShipAct["job"] | null;
  setExplorersJob: (j: ExplorerShipAct["job"] | null) => void;
  explorersRoad: Edge | null;
  setExplorersRoad: (e: Edge | null) => void;
  /** The cargo ship build's `recycled` field, as the screen holds it. */
  explorersRecycle: number;

  fishPending: FishSpend | null;
  setFishPending: (f: FishSpend | null) => void;
  setFishRoad: (p: FishRoadPending | null) => void;

  raidersRole: RaidersRole;
  setRaidersStood: (s: string | null) => void;
  riderFrom: Edge | null;
  setRiderFrom: (e: Edge | null) => void;
  riderHurryByFish: boolean;

  wagonBarbMoving: number;
  setWagonDestination: (d: { barb: number; e: Edge; hexes: Hex[] }) => void;
  setWagonBarbPick: (n: number | null) => void;
}

/**
 * Hand a tap to the right surface. `touch` means the pointer cannot hover; on
 * a mouse every kind runs immediately.
 */
export function routeTap(
  tap: BoardTap | null,
  touch: boolean,
  to: { confirm: (entry: ArmedEntry, run: () => void) => void; roster: (run: () => void) => void },
): void {
  if (!tap) return;
  if (!touch || tap.kind === "pick") tap.run();
  else if (tap.kind === "roster") to.roster(tap.run);
  else to.confirm(tap.entry, tap.run);
}

const armed = (entry: ArmedEntry, run: () => void): BoardTap => ({ kind: "armed", entry, run });

/**
 * A plain build's entry, read off the spot's roster so cost chips, the free
 * road waiver and a short hand match the inspect menu. Only the armed piece's
 * entry is kept (armed with a road, a coastal edge offers the road, not the
 * ship). The fallback has the same words, for spots the roster lacks.
 */
function buildEntry(loc: BoardLocation, view: FullView, fallback: ArmedEntry): ArmedEntry {
  const a = actionsAt(loc, view).find((x) => x.id === fallback.id);
  if (!a) return fallback;
  return {
    id: a.id,
    label: a.label,
    seatLabel: a.seatLabel,
    // Keep "short", as the inspect menu would. Drop "blocked": the board lit
    // this spot from the same legal set, so any disagreement is for the engine
    // to settle.
    ...(a.status === "short" ? { status: a.status, reason: a.reason, missing: a.missing } : {}),
    cost: a.cost,
    art: a.art,
  };
}

const JOB_ENTRY: Record<ExplorerShipAct["job"], () => string> = {
  found: () => t({ message: "Land the settler here", context: "board action" }),
  load_haul: () => t({ message: "Take the fish haul aboard", context: "board action" }),
  land_crew: () => t({ message: "Put a crew ashore here", context: "board action" }),
  take_crew: () => t({ message: "Pick the crew up here", context: "board action" }),
};

const S = {
  settlement: () => t({ message: "Settlement", context: "board action, short label" }),
  city: () => t({ message: "City", context: "board action, short label" }),
  knight: () => t({ message: "Knight", context: "board action, short label" }),
  road: () => t({ message: "Road", context: "board action, short label" }),
  ship: () => t({ message: "Ship", context: "board action, short label" }),
  bridge: () => t({ message: "Bridge", context: "board action, short label" }),
  rider: () => t({ message: "Rider", context: "board action, short label" }),
  raiders: () => t({ message: "Raiders", context: "board action, short label" }),
  wagon: () => t({ message: "Wagon", context: "board action, short label" }),
  barbarian: () => t({ message: "Barbarian", context: "board action, short label" }),
};

/** A progress card played on a spot: the same sentence a hex target uses. */
function playEntry(card: string): ArmedEntry {
  return {
    id: `play_${card}`,
    label: t`Play ${progressCardName(card)} here`,
    seatLabel: progressCardName(card),
  };
}

export function vertexTap(v: Vertex, c: BoardTapCtx): BoardTap | null {
  const { view, mode, send } = c;
  const loc: BoardLocation = { kind: "vertex", v };
  // Explorers has its own setup draft: harbour settlement, then settlement,
  // then road plus ship (with Knights, a city then the harbour settlement; see
  // `setupStep`). The engine refuses the base place_settlement meanwhile
  // (Hooks.OwnsSetup), so the setup roster cannot be used.
  if (view.phase === "setup" && isExplorers(view)) {
    const step = explorersSetupStep(view);
    if (step === "harbour")
      return armed(
        {
          id: "explorers_place_harbour",
          art: "build_harbour",
          label: t({ message: "Place harbour settlement", context: "board action, setup" }),
          seatLabel: S.settlement(),
        },
        () => send("explorers_place_harbour", { v }),
      );
    if (step === "settlement" || step === "city")
      return armed(
        step === "city"
          ? {
              id: "place_city",
              label: t({ message: "Place city", context: "board action, setup" }),
              seatLabel: S.city(),
            }
          : {
              id: "place_settlement",
              label: t({ message: "Place settlement", context: "board action, setup" }),
              seatLabel: S.settlement(),
            },
        () => send("explorers_place_settlement", { v }),
      );
    return null;
  }
  if (view.phase === "setup") return { kind: "roster", run: () => send("place_settlement", { v }) };
  switch (mode) {
    case "harbour":
      return armed(
        {
          id: "build_harbour",
          label: t({ message: "Build harbour settlement", context: "board action" }),
          seatLabel: S.settlement(),
        },
        () => send("explorers_build_harbour", { v }),
      );
    case "shipact": {
      const ship = c.explorersShip;
      const job = c.explorersJob;
      if (ship === null || job === null) return null;
      return armed(
        {
          id: `explorers_${job}`,
          art: "build_cargoship",
          label: JOB_ENTRY[job](),
          seatLabel: S.ship(),
        },
        () => {
          const act = (view.legal?.explorer_ships ?? [])
            .find((g) => g.ship === ship)
            ?.acts?.find((a) => a.job === job && vertexKey(a.v) === vertexKey(v));
          if (!act) return;
          send(
            `explorers_${act.job}`,
            act.h ? { ship_id: ship, h: act.h } : { ship_id: ship, v: act.v },
          );
          c.setExplorersShip(null);
          c.setExplorersJob(null);
        },
      );
    }
    case "settlement":
      return armed(
        buildEntry(loc, view, {
          id: "build_settlement",
          label: t({ message: "Build settlement", context: "board action" }),
          seatLabel: S.settlement(),
        }),
        () => send("build_settlement", { v }, { keepMode: true }),
      );
    case "city":
      return armed(
        buildEntry(loc, view, {
          id: "build_city",
          label: t({ message: "Upgrade to city", context: "board action" }),
          seatLabel: S.city(),
        }),
        () => send("build_city", { v }, { keepMode: true }),
      );
    // Name the city explicitly; an empty payload falls back to the engine's
    // board-order choice (see `wallShopIntent`).
    case "wall":
      return armed(
        buildEntry(loc, view, {
          id: "build_wall",
          label: t({ message: "Build wall", context: "board action" }),
          seatLabel: t({ message: "Wall", context: "board action, short label" }),
        }),
        () => send("build_wall", { v }, { keepMode: true }),
      );
    case "knight":
      return armed(
        buildEntry(loc, view, {
          id: "build_knight",
          label: t({ message: "Build knight", context: "board action" }),
          seatLabel: S.knight(),
        }),
        () => send("build_knight", { v }, { keepMode: true }),
      );
    case "knightmove": {
      const from = c.knightMoveFrom;
      if (!from) return null;
      return armed(
        {
          id: "move_knight",
          label: t({ message: "Move the knight here", context: "board action" }),
          seatLabel: S.knight(),
        },
        () => {
          send("move_knight", { from, to: v });
          c.setKnightMoveFrom(null);
        },
      );
    }
    case "pvertex": {
      const card = c.progressCard;
      if (!card) return null;
      return armed(playEntry(card), () => {
        send("play_progress", { card, v });
        c.setProgressCard(null);
      });
    }
    case "deserterplace": {
      const level = c.deserterLevel;
      return armed(
        {
          id: "deserter_place",
          art: "build_knight",
          label: t({ message: "Place the knight here", context: "board action" }),
          seatLabel: S.knight(),
        },
        () => {
          send("deserter_place", { v, level });
          c.setDeserterPick(null);
        },
      );
    }
    case "relocateknight":
      return armed(
        {
          id: "relocate_knight",
          art: "build_knight",
          label: t({ message: "Place the knight here", context: "board action" }),
          seatLabel: S.knight(),
        },
        () => send("relocate_knight", { to: v }),
      );
    case "barbariandowngrade":
      return armed(
        {
          id: "barbarian_downgrade",
          art: "build_city",
          label: t({ message: "Give up this city", context: "board action" }),
          seatLabel: S.city(),
        },
        () => send("barbarian_downgrade", { v }),
      );
    case "metropolispick":
      return armed(
        {
          id: "metropolis_pick",
          art: "build_city",
          label: t({ message: "Put the metropolis here", context: "board action" }),
          seatLabel: S.city(),
        },
        () => send("metropolis_pick", { v }),
      );
    // A wagon step. `keepMode` since a turn is several paths; the engine ends
    // the phase when the wagon enters a plaza.
    case "wagonmove":
      return armed(
        {
          id: "wagons_move",
          art: "scenario_wagon",
          label: t({ message: "Drive the wagon here", context: "board action" }),
          seatLabel: S.wagon(),
        },
        () => send("wagons_move", { to: v }, { keepMode: true }),
      );
    default:
      return null;
  }
}

export function edgeTap(e: Edge, c: BoardTapCtx): BoardTap | null {
  const { view, mode, send } = c;
  const loc: BoardLocation = { kind: "edge", e };
  // Explorers' third setup round places a road and a settler-loaded ship in
  // one command: the first edge is held and the second sends it. Land edges
  // take the road and water edges the ship (published as separate lists), so
  // the tapped edge says which half it is.
  if (view.phase === "setup" && isExplorers(view)) {
    const roads = new Set((view.legal?.roads ?? []).map(edgeKey));
    const ships = new Set((view.legal?.ships ?? []).map(edgeKey));
    if (roads.has(edgeKey(e))) return { kind: "pick", run: () => c.setExplorersRoad(e) };
    const road = c.explorersRoad;
    if (ships.has(edgeKey(e)) && road)
      return armed(
        {
          id: "place_ship",
          art: "build_cargoship",
          label: t({ message: "Place the road and ship", context: "board action, setup" }),
          seatLabel: S.ship(),
        },
        () => {
          send("explorers_place_start", { road, ship: e });
          c.setExplorersRoad(null);
        },
      );
    return null;
  }
  if (view.phase === "setup") {
    const ship = c.setupShip;
    return {
      kind: "roster",
      run: () => {
        send("place_road", { e, ship });
        c.setSetupShip(false);
      },
    };
  }
  // A 5-fish spend waiting for its edge. The engine grants a road credit
  // (FreeRoads, like Road Building), so the edge is remembered and its build
  // is sent when the credit lands (the fishRoad effect in routes/Game). The
  // edge must still be legal, so the fish cannot buy a road with nowhere to go.
  if (c.fishPending === "free_road" && mode === "fishedge")
    return armed(
      {
        id: "fish_road",
        art: "build_road",
        label: t({ message: "Spend fish on a road here", context: "board action" }),
        seatLabel: S.road(),
      },
      () => {
        const ref = send("spend_fish", { use: "free_road", e });
        c.setFishPending(null);
        if (ref) c.setFishRoad({ e, ref, owed: view.free_roads ?? 0 });
      },
    );
  // Alongside Rivers, the 6-fish rung builds the bridge itself (no credit to
  // spend afterwards, unlike the road rung), on a site the seat could bridge.
  if (c.fishPending === "bridge" && mode === "fishbridge")
    return armed(
      {
        id: "fish_bridge",
        art: "build_bridge",
        label: t({ message: "Spend fish on a bridge here", context: "board action" }),
        seatLabel: S.bridge(),
      },
      () => {
        send("spend_fish", { use: "bridge", e });
        c.setFishPending(null);
      },
    );
  switch (mode) {
    case "cargoship": {
      const recycled = c.explorersRecycle;
      return armed(
        {
          id: "build_cargoship",
          label: t({ message: "Build ship", context: "board action" }),
          seatLabel: S.ship(),
        },
        () => send("explorers_build_ship", { e, recycled }),
      );
    }
    // The ship stays chosen across single-step moves; the screen releases it
    // when it has nowhere left to go.
    case "sail": {
      const ship = c.explorersShip;
      if (ship === null) return null;
      return armed(
        {
          id: "explorers_move_ship",
          art: "build_cargoship",
          label: t({ message: "Sail here", context: "board action" }),
          seatLabel: S.ship(),
        },
        () => send("explorers_move_ship", { ship_id: ship, path: [e] }, { keepMode: true }),
      );
    }
    // A Muster or Swift Rider, against the paths the card allows, or a landing
    // raider's path. One branch: only the server's published list differs.
    case "riderplace": {
      const path = c.raidersRole === "raiders_path";
      return armed(
        path
          ? {
              id: "raiders_pick_path",
              label: t({ message: "Put the raider on this path", context: "board action" }),
              seatLabel: S.raiders(),
            }
          : {
              id: "raiders_place_rider",
              art: "scenario_rider",
              label: t({ message: "Place the rider here", context: "board action" }),
              seatLabel: S.rider(),
            },
        () => {
          send(path ? "raiders_pick_path" : "raiders_place_rider", { e });
          c.setRaidersStood(null);
        },
      );
    }
    // The second half of a rider move. Hurried destinations are lit alongside
    // free ones, and the tapped one decides whether grain is spent; the engine
    // takes the grain on `hurry: true` whatever the distance.
    case "ridermove": {
      const from = c.riderFrom;
      if (!from) return null;
      const move = riderMoveFrom(view, from);
      const hurry = !!move && isHurryTarget(move, e);
      // A hurry paid in fish is a fish spend, and the engine moves the rider
      // inside it; a hurry paid in grain is the rider move with the flag.
      const byFish = hurry && c.riderHurryByFish;
      return armed(
        {
          id: "raiders_move_rider",
          art: "scenario_rider",
          label: hurry
            ? t({ message: "Hurry the rider here", context: "board action" })
            : t({ message: "Move the rider here", context: "board action" }),
          seatLabel: S.rider(),
        },
        () => {
          if (byFish) send("spend_fish", { use: "rider_hurry", from, to: e });
          else send("raiders_move_rider", hurry ? { from, to: e, hurry: true } : { from, to: e });
          c.setRiderFrom(null);
        },
      );
    }
    // A 7 or a played Knight lets the player pick which of the three; a
    // drive-off names its own. The wire carries it in `barb_index`.
    case "wagonbarbarian": {
      const barb = c.wagonBarbMoving;
      return armed(
        {
          id: "wagons_barbarian",
          label: t({ message: "Move the barbarian here", context: "board action" }),
          seatLabel: S.barbarian(),
        },
        () => {
          const hexes = barbarianHexChoices(view, e);
          if (hexes.length > 1) c.setWagonDestination({ barb, e, hexes });
          else send("wagons_barbarian", { barb, e, hex: hexes[0] });
          c.setWagonBarbPick(null);
        },
      );
    }
    case "road":
      return armed(
        buildEntry(loc, view, {
          id: "build_road",
          label: t({ message: "Build road", context: "board action" }),
          seatLabel: S.road(),
        }),
        () => send("build_road", { e }, { keepMode: true }),
      );
    case "ship":
      return armed(
        buildEntry(loc, view, {
          id: "build_ship",
          label: t({ message: "Build ship", context: "board action" }),
          seatLabel: S.ship(),
        }),
        () => send("build_ship", { e }, { keepMode: true }),
      );
    // Rivers. `keepMode` like road and ship; the mode drops itself when the
    // third bridge is gone.
    case "bridge":
      return armed(
        buildEntry(loc, view, {
          id: "build_bridge",
          label: t({ message: "Build bridge", context: "board action" }),
          seatLabel: S.bridge(),
        }),
        () => send("build_bridge", { e }, { keepMode: true }),
      );
    case "shipmove": {
      const from = c.shipMoveFrom;
      if (!from) return null;
      return armed(
        {
          id: "move_ship",
          label: t({ message: "Move the ship here", context: "board action" }),
          seatLabel: S.ship(),
        },
        () => {
          send("move_ship", { from, to: e });
          c.setShipMoveFrom(null);
        },
      );
    }
    case "diplomatto": {
      const from = c.diplomatFrom;
      if (!from) return null;
      // Relocating onto the source is no move at all: let go instead.
      if (edgeKey(e) === edgeKey(from)) return { kind: "pick", run: c.resetDiplomat };
      return armed(
        {
          id: "play_diplomat",
          art: "build_road",
          label: t({ message: "Move the road here", context: "board action" }),
          seatLabel: progressCardName("diplomat"),
        },
        () => {
          send("play_progress", { card: "diplomat", e: from, to: e });
          c.resetDiplomat();
        },
      );
    }
    case "pedge": {
      const card = c.progressCard;
      if (!card) return null;
      if (card === "diplomat") {
        // First Diplomat pick: own open road -> offer remove/relocate; any
        // other road -> remove. The engine re-checks open-ness and rejects an
        // illegal target cleanly.
        //
        // The own-road branch arms the relocate step; the second pick asks.
        const mine = view.roads.some((r) => r.owner === view.viewer && edgeKey(r.e) === edgeKey(e));
        if (mine)
          return {
            kind: "pick",
            run: () => {
              c.setDiplomatFrom(e);
              c.setMode("none");
            },
          };
        return armed(
          {
            id: "play_diplomat",
            art: "build_road",
            label: t({ message: "Remove this road", context: "board action" }),
            seatLabel: progressCardName("diplomat"),
          },
          () => {
            send("play_progress", { card: "diplomat", e });
            c.setProgressCard(null);
          },
        );
      }
      return armed(playEntry(card), () => {
        send("play_progress", { card, e });
        c.setProgressCard(null);
      });
    }
    default:
      return null;
  }
}
