// Photograph the knights and their swords through the game's own renderer, at
// the 56-degree game camera and true scale against a hex. Also covers the
// animated poses (the hover guard and the barbarian fall), which exist only in
// TypeScript; `tools/blender/render_knight_sword.py` covers the still ones.
//
// Dev-only, like board-shots: it ships nothing.
//
//     cd frontend && npx vite
//     open http://localhost:5173/dev/knight-shots.html
//     open http://localhost:5173/dev/knight-shots.html?mode=barbariandowngrade
//
// Six knights on the lattice: three levels, at ease and activated, all on real
// vertices of the same engine-dumped board board-shots uses. Point at one.
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import { Board3D, type Board3DControls } from "../src/components/board/Board3D";
import type { Board, FullView, Vertex } from "../src/lib/types";
import type { BoardMode } from "../src/lib/boardTargets";
import boardData from "./board-shots.board.json";

const board = boardData as unknown as Board;

/**
 * Six vertices across the middle of the board, in two rows.
 *
 * Front row at ease, back row activated, so one frame shows both states at all
 * three levels.
 */
const AT_EASE: Vertex[] = [
  { q: -1, r: 0, side: 1 },
  { q: 0, r: 0, side: 1 },
  { q: 1, r: 0, side: 1 },
];
const READY: Vertex[] = [
  { q: -1, r: -1, side: 0 },
  { q: 0, r: -1, side: 0 },
  { q: 1, r: -1, side: 0 },
];

/**
 * Two cities of the viewer's, for the hover cases that are about buildings.
 *
 * For `?mode=barbariandowngrade` (the city fades) and `?mode=metropolispick`
 * (the city swells).
 */
const CITIES: Vertex[] = [
  { q: -1, r: 1, side: 0 },
  { q: 1, r: 1, side: 0 },
];

// All the viewer's own, so all six are inspectable and therefore hoverable
// (`inspectableVertexKeys` includes your own knights).
const knightsAt = (ready: boolean) => [
  ...AT_EASE.map((v, i) => ({
    v,
    owner: 0,
    level: i + 1,
    active: false,
    freshly_activated: false,
  })),
  ...READY.map((v, i) => ({ v, owner: 0, level: i + 1, active: ready, freshly_activated: false })),
];

// `as unknown as FullView`: the page fills only what the board reads.
//
// `legal.knights` matters: the hover swell needs a pick target, so without it
// the guard pose is unreachable here.
const viewWith = (ready: boolean) =>
  ({
    // Bumped with the state so the board commits a new view and runs the
    // stand-down diff.
    seq: ready ? 0 : 1,
    viewer: 0,
    phase: "play",
    cur: 0,
    // One legal list per mode: `allowedVertexKeys` reads a different field for
    // each.
    legal: {
      knights: [...AT_EASE, ...READY],
      cities: CITIES,
      barbarian_downgrades: CITIES,
      metropolis_cities: CITIES,
    },
    players: [0, 1, 2, 3].map((seat) => ({ seat, hand: [0, 0, 0, 0, 0, 0] })),
    config: { ruleset: "base+cak" },
    board,
    buildings: CITIES.map((v) => ({ v, owner: 0, city: true })),
    roads: [],
    ext: {
      cak: {
        players: [],
        knights: knightsAt(ready),
        commodity_supply: [0, 0, 0],
        barbarians: ready ? 6 : 7,
        attacks: ready ? 0 : 1,
        decks: [0, 0, 0],
      },
    },
  }) as unknown as FullView;

const noop = () => {};

function ready() {
  document.body.dataset.boardReady = "1";
}

/**
 * The board mode to serve, from `?mode=`. Defaults to `inspect`, the build-turn
 * flow that reaches the swell; the others show each branch of `hoverEffectFor`.
 */
const MODE = (new URLSearchParams(window.location.search).get("mode") ?? "inspect") as BoardMode;

/**
 * The board, plus one action: land the barbarians. It arms the board through
 * its handle, then hands it the view with the activations gone, in the order
 * the game does. `window.knightLandfall` is the driver's hook and
 * `knightLandfallAt` the clock its frame labels are measured from.
 */
function Page() {
  const [up, setUp] = useState(true);
  const controls = useRef<Board3DControls | null>(null);
  (window as unknown as Record<string, unknown>).knightLandfall = () => {
    (window as unknown as Record<string, unknown>).knightLandfallAt = performance.now();
    controls.current?.standDownKnights();
    setUp(false);
  };
  return (
    <div className="fixed inset-0">
      <Board3D
        view={viewWith(up)}
        mode={MODE}
        onVertex={noop}
        onKnight={noop}
        onEdge={noop}
        onHex={noop}
        onInspect={noop}
        className="w-full h-full"
        controls
        controlsRef={controls}
        onReady={ready}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
