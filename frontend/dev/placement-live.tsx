// A bench for placement feedback: where a piece can go, and what happens when
// the clock runs out.
//
//     make placement-live
//     open http://localhost:6792/dev/placement-live.html
//
// Legal spots rest invisible (lib/board3d/markers `MARKER_OPACITY`) and light
// up under the pointer, which suits modes the player arms from the build shelf
// but not the forced ones (setup, a seven, a knight owed a spot). Compared
// here:
//
//   Pips: whether the candidate set is visible unpointed, and how loudly. The
//   only option that works on touch.
//
//   Slide: whether the preview travels from the last spot to this one rather
//   than vanishing and reappearing.
//
//   Carry: for the robber, the real piece follows the pointer and the hex it
//   leaves keeps a ghost.
//
//   Timeout: when the clock runs out, send the spot the pointer rests on
//   (via `onHoverSpot`) as if clicked, instead of passing.
//
// Dev-only, like board-live.html: it ships nothing.
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import { Board3D } from "../src/components/board/Board3D";
import type { BoardSpot, BuildMode } from "../src/components/board/props";
import { previewView } from "../src/lib/board3d/previewFixture";
import {
  edgeKey,
  enumerateGrid,
  hexKey,
  makeEdge,
  vertexKey,
  vertexNeighbors,
} from "../src/lib/hexgeo";
import { knightsExt } from "../src/lib/types";
import type { Board, Edge, FullView, Hex, Vertex } from "../src/lib/types";
import { activateLocale, DEFAULT_LOCALE } from "../src/lib/i18n";
import boardData from "./board-shots.board.json";

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

// The engine's board (`make board-fixture`) with the preview fixture's pieces
// on it, composed as in board-live. The pieces matter: the distance rule
// against existing buildings is what makes setup's second round hard to read.
const board = boardData as unknown as Board;
const base = {
  ...(previewView as unknown as Record<string, unknown>),
  board,
  // Seat 0's network, extended by three inland roads the fixture lists as
  // legal for it. Without them seat 0 has no free knight spot.
  roads: [
    ...((previewView as unknown as FullView).roads ?? []),
    ...((previewView as unknown as FullView).legal?.roads ?? [])
      .slice(0, 3)
      .map((e) => ({ e, owner: 0 })),
  ],
  // Knights and ships draw only for a ruleset that has them, and the placement
  // layers read `config.ruleset` unguarded.
  config: { ruleset: "base+islands+cak" },
} as unknown as FullView;

const GRID = enumerateGrid(board.tiles);

/**
 * More buildings for seat 0: two settlements to upgrade, two cities to wall.
 *
 * Taken from the fixture's `legal.settlements` (two untouched tiles on the far
 * side) rather than seat 0's road ends, which are the knight spots. They are
 * not connected to seat 0's roads; nothing here checks connectivity.
 */
function extraBuildings(view: FullView): { v: Vertex; owner: number; city: boolean }[] {
  const taken = new Set((view.buildings ?? []).map((b) => vertexKey(b.v)));
  const out: { v: Vertex; owner: number; city: boolean }[] = [];
  for (const v of view.legal?.settlements ?? []) {
    // Two of each, so there is a choice.
    if (out.length >= 4) break;
    const k = vertexKey(v);
    if (taken.has(k)) continue;
    if (vertexNeighbors(v).some((n) => taken.has(vertexKey(n)))) continue;
    taken.add(k);
    // The first two stay settlements for the city scenario; the next two are
    // cities for the wall scenario.
    out.push({ v, owner: 0, city: out.length >= 2 });
  }
  return out;
}

/** The vertices a building of any owner is standing on. */
function occupied(view: FullView): Set<string> {
  return new Set((view.buildings ?? []).map((b) => vertexKey(b.v)));
}

/**
 * Setup's legal settlements: any vertex on the board with no building on it and
 * none on any of its three neighbours.
 *
 * The engine's distance rule, computed locally (no server here). The exact set
 * matters because its size is much of what is being judged.
 */
function setupSettlements(view: FullView): Vertex[] {
  const taken = occupied(view);
  return GRID.vertices.filter((v) => {
    if (taken.has(vertexKey(v))) return false;
    return vertexNeighbors(v).every((n) => !taken.has(vertexKey(n)));
  });
}

/** The edges running out of `v` that are on this board at all. */
function roadsFrom(v: Vertex): Edge[] {
  const onBoard = new Set(GRID.edges.map(edgeKey));
  return vertexNeighbors(v)
    .map((n) => makeEdge(v, n))
    .filter((e) => onBoard.has(edgeKey(e)));
}

/**
 * Where seat 0 may put a new knight: a vertex its own roads reach, with nothing
 * standing on it.
 *
 * A small set scattered along one network, the hardest case for
 * hover-to-discover.
 */
function knightSpots(view: FullView): Vertex[] {
  const mine = (view.roads ?? []).filter((r) => r.owner === 0);
  const taken = occupied(view);
  const knights = new Set((knightsExt(view)?.knights ?? []).map((k) => vertexKey(k.v)));
  const out = new Map<string, Vertex>();
  for (const r of mine) {
    for (const v of [r.e.a, r.e.b]) {
      const k = vertexKey(v);
      if (taken.has(k) || knights.has(k)) continue;
      out.set(k, v);
    }
  }
  return [...out.values()];
}

/** Seat 0's own settlements: exactly what a city upgrade may be spent on. */
function cityTargets(view: FullView): Vertex[] {
  return (view.buildings ?? []).filter((b) => b.owner === 0 && !b.city).map((b) => b.v);
}

/**
 * Every road with a free end: exactly what the Diplomat may lift.
 *
 * Open-ended means one of its two corners has no other road and no building:
 * the end of a spur. Any owner's road qualifies.
 */
function openEndedRoads(view: FullView): Edge[] {
  const built = occupied(view);
  const roads = view.roads ?? [];
  const touching = new Map<string, number>();
  for (const r of roads) {
    for (const v of [r.e.a, r.e.b]) {
      const k = vertexKey(v);
      touching.set(k, (touching.get(k) ?? 0) + 1);
    }
  }
  return roads
    .filter((r) =>
      [r.e.a, r.e.b].some((v) => {
        const k = vertexKey(v);
        return (touching.get(k) ?? 0) === 1 && !built.has(k);
      }),
    )
    .map((r) => r.e);
}

/**
 * Seat 0's own cities that have no wall yet.
 *
 * A wall goes around a city that stays put, which is why `ghost.ts` carries
 * `hides` on the effect: this preview does not replace the piece under it.
 */
function wallTargets(view: FullView): Vertex[] {
  const walled = new Set((knightsExt(view)?.walled ?? []).map(vertexKey));
  return (view.buildings ?? [])
    .filter((b) => b.owner === 0 && b.city && !walled.has(vertexKey(b.v)))
    .map((b) => b.v);
}

/** Land hexes the robber is not already on: exactly the engine's destinations. */
function robberHexes(view: FullView): Hex[] {
  const here = view.board.robber ? hexKey(view.board.robber) : "";
  return board.tiles
    .filter((t) => LAND.has(hexKey(t.hex)) && hexKey(t.hex) !== here)
    .map((t) => t.hex);
}

/**
 * The board the page starts every scenario from.
 *
 * `base` is the fixture; this is the fixture with the extra settlements the
 * city scenario needs, and it is what every `Reset board` goes back to.
 */
const START: FullView = {
  ...base,
  buildings: [...(base.buildings ?? []), ...extraBuildings(base)],
};

// ---------------------------------------------------------------------------
// The scenarios
// ---------------------------------------------------------------------------

type Scenario = "setup" | "city" | "wall" | "robber" | "knight" | "remove";

const SCENARIO_LABEL: Record<Scenario, string> = {
  setup: "Initial",
  city: "City",
  wall: "Wall",
  robber: "Robber",
  knight: "Knight",
  remove: "Remove",
};

/**
 * A treatment, as the props that make it.
 *
 * Data rather than branches, so each row visibly differs from its neighbour in
 * as few things as possible.
 */
interface Style {
  id: string;
  name: string;
  /** One-line description shown in the panel. */
  note: string;
  resting?: number;
  slide?: boolean;
  carry?: boolean;
  mark?: "pedestal" | "swarm";
}

/**
 * The resting brightness for the pip treatments. Other lit marks pass none and
 * get `restingForCount`, as in the game.
 */
const REST = 0.42;

/**
 * Setup gets a quieter mark: loudness should fall with the size of the set,
 * and sixty setup corners only need to read as a texture.
 */
const REST_CROWDED = 0.24;

const SETUP_STYLES: Style[] = [
  {
    id: "pedestal",
    name: "Pedestals + slide",
    note: "Shipped. Brightness comes from the board, scaled by the size of the set.",
    slide: true,
    mark: "pedestal",
  },
  {
    id: "today",
    name: "Today",
    note: "Nothing until you point at it, then a ghost fades in. Sweep to find the set.",
  },
  {
    id: "pips",
    name: "Pips + slide",
    note: "Flat gold discs, the 2D board's mark. Sixty of them, seen at 56 degrees.",
    resting: REST_CROWDED,
    slide: true,
  },
  {
    id: "swarm",
    name: "Swarms + slide",
    note: "No pedestal at all at a corner. Just motes, bigger, orbiting the spot.",
    resting: REST_CROWDED,
    slide: true,
    mark: "swarm",
  },
];

const ROBBER_STYLES: Style[] = [
  {
    id: "carryped",
    name: "Carry + pedestals",
    note: "Shipped. A translucent robber in your skin follows the pointer; the real one stays. Click to place it.",
    carry: true,
    mark: "pedestal",
  },
  {
    id: "ghost",
    name: "Today",
    note: "The same translucent robber, but it blinks from hex to hex instead of travelling.",
    resting: REST,
    mark: "pedestal",
  },
  {
    id: "carry",
    name: "Carry, unmarked",
    note: "The travelling preview with no marks under it.",
    carry: true,
  },
];

const KNIGHT_STYLES: Style[] = [
  {
    id: "pedslide",
    name: "Pedestals + slide",
    note: "Shipped. Two lit corners; the knight preview travels between them.",
    slide: true,
    mark: "pedestal",
  },
  {
    id: "today",
    name: "Today",
    note: "Two invisible corners on your own network.",
  },
  {
    id: "swarmslide",
    name: "Swarms + slide",
    note: "Motion instead of a shape: motes orbiting each corner, no pedestal under them.",
    resting: REST,
    slide: true,
    mark: "swarm",
  },
];

/**
 * The city upgrade: the spot is occupied, so the mark sits under a settlement
 * and the preview replaces it with a translucent city (ghost.ts's `hides`).
 * Walls, metropolises and knight promotions are similar.
 */
const CITY_STYLES: Style[] = [
  {
    id: "pedslide",
    name: "Pedestals + slide",
    note: "A lit spot under each of your settlements, and the city preview travels between them.",
    slide: true,
    mark: "pedestal",
  },
  {
    id: "today",
    name: "Today",
    note: "Nothing until you point. The settlement vanishes and a ghost city fades in.",
  },
  {
    id: "swarmslide",
    name: "Swarms + slide",
    note: "Motes around the piece instead of a pool under it.",
    resting: REST,
    slide: true,
    mark: "swarm",
  },
];

/**
 * The wall: the city stays and a ring appears at its foot, exactly where the
 * pedestal's pool is, so it needs its own scenario.
 */
const WALL_STYLES: Style[] = [
  {
    id: "pedslide",
    name: "Pedestals + slide",
    note: "A lit spot under each of your unwalled cities.",
    slide: true,
    mark: "pedestal",
  },
  {
    id: "today",
    name: "Today",
    note: "Nothing until you point. The city stays put and a ghost wall appears round it.",
  },
  {
    id: "swarmslide",
    name: "Swarms + slide",
    note: "Motes around the city instead of a pool at its foot, which the ring already occupies.",
    resting: REST,
    slide: true,
    mark: "swarm",
  },
];

/**
 * The Diplomat: pick a road to remove, possibly someone else's.
 *
 * `ghost.ts` previews it as `"standing"` (the piece goes translucent). The open
 * question is the mark, since gold elsewhere means "offered to you", and the
 * mark must fit on an edge a road already fills.
 *
 * No slide: a removal's preview is the piece where it stands, so there is
 * nowhere to slide to. See `HoverEffect.leaving`.
 */
const REMOVE_STYLES: Style[] = [
  {
    id: "pedestal",
    name: "Pedestals",
    note: "Lit spots on every open-ended road. No slide: a removal has nowhere to travel to.",
    mark: "pedestal",
  },
  {
    id: "today",
    name: "Today",
    note: "Nothing until you point at it, then the road you would remove goes translucent.",
  },
  {
    id: "swarm",
    name: "Swarms",
    note: "Motes above each removable road, leaving the gutter itself clear.",
    resting: REST,
    mark: "swarm",
  },
];

const STYLES: Record<Scenario, Style[]> = {
  setup: SETUP_STYLES,
  city: CITY_STYLES,
  wall: WALL_STYLES,
  robber: ROBBER_STYLES,
  knight: KNIGHT_STYLES,
  remove: REMOVE_STYLES,
};

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** One line of what the client would have sent. */
interface Sent {
  at: number;
  text: string;
  /** Whether the clock sent it rather than the player. */
  auto: boolean;
}

function Bench() {
  const [scenario, setScenario] = useState<Scenario>("setup");
  // The first treatment of each scenario is what the game ships.
  const [styleId, setStyleId] = useState(STYLES.setup[0].id);
  /**
   * Setup alternates settlement and road; the road's legal set appears off the
   * settlement just placed.
   */
  const [needRoad, setNeedRoad] = useState<Vertex | null>(null);
  const [view, setView] = useState<FullView>(START);
  const [seconds, setSeconds] = useState(0);
  const [left, setLeft] = useState(0);
  const [log, setLog] = useState<Sent[]>([]);

  const styles = STYLES[scenario];
  const style = styles.find((s) => s.id === styleId) ?? styles[0];

  /**
   * The spot the pointer is on. A ref, because only the timeout reads it, and
   * state would re-render the board on every hover and stutter the slide.
   */
  const hovered = useRef<BoardSpot | null>(null);

  const say = useCallback((text: string, auto: boolean) => {
    setLog((l) => [{ at: Date.now(), text, auto }, ...l].slice(0, 12));
  }, []);

  // --- What each scenario offers -----------------------------------------

  const mode: BuildMode =
    scenario === "robber"
      ? "robber"
      : scenario === "knight"
        ? "knight"
        : scenario === "city"
          ? "city"
          : scenario === "wall"
            ? "wall"
            : scenario === "remove"
              ? "pedge"
              : needRoad
                ? "road"
                : "settlement";

  const shown = useMemo(() => {
    const legal =
      scenario === "robber"
        ? { ...view.legal, robber_hexes: robberHexes(view) }
        : scenario === "knight"
          ? { ...view.legal, knights: knightSpots(view) }
          : scenario === "city"
            ? { ...view.legal, cities: cityTargets(view) }
            : scenario === "wall"
              ? { ...view.legal, walls: wallTargets(view) }
              : scenario === "remove"
                ? {
                    ...view.legal,
                    progress_targets: { diplomat: { edges: openEndedRoads(view) } },
                  }
                : needRoad
                  ? { ...view.legal, roads: roadsFrom(needRoad) }
                  : { ...view.legal, settlements: setupSettlements(view) };
    return { ...view, legal } as FullView;
  }, [view, scenario, needRoad]);

  // --- Committing ---------------------------------------------------------

  /**
   * Put the piece down, from a click or from the clock.
   *
   * One path for both, so a timeout's move is indistinguishable from a click
   * downstream.
   */
  const commit = useCallback(
    (spot: BoardSpot | null, auto: boolean) => {
      if (!spot) {
        if (auto) say("timed out with the pointer nowhere: nothing to send", true);
        return;
      }
      const how = auto ? " (clock)" : "";
      if (spot.kind === "hex") {
        setView((v) => ({ ...v, board: { ...v.board, robber: spot.h } }) as FullView);
        say(`move_robber ${hexKey(spot.h)}${how}`, auto);
      } else if (spot.kind === "vertex" && scenario === "wall") {
        setView((v) => {
          const knightsState = knightsExt(v);
          return {
            ...v,
            ext: {
              ...v.ext,
              cak: { ...knightsState, walled: [...(knightsState?.walled ?? []), spot.v] },
            },
          } as FullView;
        });
        say(`build_wall ${vertexKey(spot.v)}${how}`, auto);
      } else if (spot.kind === "vertex" && scenario === "city") {
        setView(
          (v) =>
            ({
              ...v,
              buildings: (v.buildings ?? []).map((b) =>
                vertexKey(b.v) === vertexKey(spot.v) ? { ...b, city: true } : b,
              ),
            }) as FullView,
        );
        say(`build_city ${vertexKey(spot.v)}${how}`, auto);
      } else if (spot.kind === "vertex" && scenario === "knight") {
        setView((v) => {
          const knightsState = knightsExt(v);
          return {
            ...v,
            ext: {
              ...v.ext,
              cak: {
                ...knightsState,
                knights: [
                  ...(knightsState?.knights ?? []),
                  { v: spot.v, owner: 0, level: 1, active: false, freshly_activated: true },
                ],
              },
            },
          } as FullView;
        });
        say(`build_knight ${vertexKey(spot.v)}${how}`, auto);
      } else if (spot.kind === "vertex") {
        setView(
          (v) =>
            ({
              ...v,
              buildings: [...(v.buildings ?? []), { v: spot.v, owner: 0, city: false }],
            }) as FullView,
        );
        setNeedRoad(spot.v);
        say(`place_settlement ${vertexKey(spot.v)}${how}`, auto);
      } else if (scenario === "remove") {
        setView(
          (v) =>
            ({
              ...v,
              roads: (v.roads ?? []).filter((r) => edgeKey(r.e) !== edgeKey(spot.e)),
            }) as FullView,
        );
        say(`play_diplomat ${edgeKey(spot.e)}${how}`, auto);
      } else {
        setView(
          (v) => ({ ...v, roads: [...(v.roads ?? []), { e: spot.e, owner: 0 }] }) as FullView,
        );
        setNeedRoad(null);
        say(`place_road ${edgeKey(spot.e)}${how}`, auto);
      }
      // The hovered spot is occupied now, so the next timeout must not send it.
      hovered.current = null;
    },
    [say, scenario],
  );

  // --- The clock ----------------------------------------------------------

  // Restarted on every commit and scenario change: one clock per decision.
  useEffect(() => {
    if (!seconds) return;
    setLeft(seconds * 1000);
    const started = performance.now();
    const id = window.setInterval(() => {
      const remaining = seconds * 1000 - (performance.now() - started);
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) {
        window.clearInterval(id);
        // Click for the player on the spot they were resting on.
        commit(hovered.current, true);
      }
    }, 50);
    return () => window.clearInterval(id);
    // `log.length`: each new entry starts the next decision.
  }, [seconds, scenario, log.length, commit]);

  const onSpot = useCallback((s: BoardSpot | null) => {
    hovered.current = s;
  }, []);

  const reset = () => {
    setView(START);
    setNeedRoad(null);
    setLog([]);
  };

  return (
    <div className="fixed inset-0 flex">
      <Board3D
        view={shown}
        mode={mode}
        className="absolute inset-0 h-full w-full"
        // Orbit, zoom and pan, plus the reset button.
        controls
        // The carried preview's skin (the viewer's equipped robber in game),
        // fixed here so it differs from the stock piece on the board.
        viewerRobber="robber.brigand"
        restingMarkers={style.resting}
        markerStyle={style.mark ?? "pip"}
        // The card decides what a `pedge` spot previews, so the board has to be
        // told which one is being played. See lib/progressCards.
        progressCard={scenario === "remove" ? "diplomat" : null}
        slideGhost={style.slide}
        carryOnHover={style.carry}
        onHoverSpot={onSpot}
        onVertex={(v) => commit({ kind: "vertex", v }, false)}
        onEdge={(e) => commit({ kind: "edge", e }, false)}
        onHex={(h) => commit({ kind: "hex", h }, false)}
      />
      <Panel
        scenario={scenario}
        onScenario={(s) => {
          setScenario(s);
          setStyleId(STYLES[s][0].id);
          setNeedRoad(null);
        }}
        styles={styles}
        style={style}
        onStyle={setStyleId}
        seconds={seconds}
        onSeconds={setSeconds}
        left={left}
        log={log}
        prompt={
          scenario === "robber"
            ? "Move the robber."
            : scenario === "knight"
              ? "Place a knight on your network."
              : scenario === "city"
                ? "Upgrade one of your settlements."
                : scenario === "wall"
                  ? "Wall one of your cities."
                  : scenario === "remove"
                    ? "Diplomat: remove an open-ended road."
                    : needRoad
                      ? "Place a road from that settlement."
                      : "Place a settlement."
        }
        onReset={reset}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function Panel(props: {
  scenario: Scenario;
  onScenario: (s: Scenario) => void;
  styles: Style[];
  style: Style;
  onStyle: (id: string) => void;
  seconds: number;
  onSeconds: (n: number) => void;
  left: number;
  log: Sent[];
  prompt: string;
  onReset: () => void;
}) {
  const pct = props.seconds ? (props.left / (props.seconds * 1000)) * 100 : 0;
  return (
    <div className="pointer-events-none absolute inset-0 p-3 text-[12px] text-white">
      <div className="pointer-events-auto w-[300px] rounded-xl bg-black/75 p-3 backdrop-blur-sm">
        <Row label="Scenario">
          {(["setup", "city", "wall", "robber", "knight", "remove"] as Scenario[]).map((s) => (
            <Chip key={s} on={props.scenario === s} onClick={() => props.onScenario(s)}>
              {SCENARIO_LABEL[s]}
            </Chip>
          ))}
        </Row>
        <Row label="Treatment">
          {props.styles.map((s) => (
            <Chip key={s.id} on={props.style.id === s.id} onClick={() => props.onStyle(s.id)}>
              {s.name}
            </Chip>
          ))}
        </Row>
        <p className="mt-1 mb-2 leading-snug text-white/70">{props.style.note}</p>
        <Row label="Clock">
          {[0, 8, 4].map((n) => (
            <Chip key={n} on={props.seconds === n} onClick={() => props.onSeconds(n)}>
              {n === 0 ? "Off" : `${n}s`}
            </Chip>
          ))}
          <Chip on={false} onClick={props.onReset}>
            Reset board
          </Chip>
        </Row>
        {props.seconds > 0 && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
            {/* The bar warns the player a decision is about to be made for
                them. */}
            <div
              className="h-full rounded-full bg-yellow-300 transition-none"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <p className="mt-2 font-bold uppercase tracking-wide">{props.prompt}</p>
        <div className="mt-2 max-h-[220px] overflow-y-auto font-mono text-[11px] leading-relaxed">
          {props.log.length === 0 && <span className="text-white/40">nothing sent yet</span>}
          {props.log.map((l) => (
            <div key={l.at} className={l.auto ? "text-yellow-300" : "text-white/80"}>
              {l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1">
      <span className="mr-1 w-[62px] shrink-0 text-white/50">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 ${on ? "bg-yellow-300 text-black" : "bg-white/15 text-white/80 hover:bg-white/25"}`}
    >
      {children}
    </button>
  );
}

// The Reset View button's label goes through Lingui, which throws with no
// active locale.
await activateLocale(DEFAULT_LOCALE);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Bench />
  </StrictMode>,
);
