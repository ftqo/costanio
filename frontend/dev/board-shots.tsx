// Photograph a whole board through the game's own renderer (`Board3D`), which
// is the only thing that draws the gutter sand, coastline and harbour signs and
// applies `palette.json`.
//
// Dev-only: Vite serves `frontend/dev/` in dev, and `vite build`'s entry is
// index.html, so it ships nothing.
//
//     make board-shot            # serve, shoot two bearings, write JPEGs
//     cd frontend && npx vite    # or drive it by hand:
//     open http://localhost:5173/dev/board-shots.html
//
// `board-shots.board.json` is dumped from the engine by
// `costan-sim -dump-board`, so it matches what the game generates.
//
// Query params, all for the shot driver:
//
//   ?board=/some.board.json   another dump to photograph (default: the static
//                             import below).
//   ?ruleset=base+raiders     what the view claims to be playing. Module layers
//                             draw nothing unless `parseExpansions` names them.
//   ?view=/some.view.json     a whole dumped frame view (cmd/costan-replay)
//                             rather than a board. It wins when set, since some
//                             modules' pieces exist only in the view's `ext`.
//   ?look=dark|post|postdark  which of the four looks to shoot: the `dark` class
//                             on the document (see `boardMode`) and a stored
//                             setting (see `boardPostFx`), both of which
//                             Board3D subscribes to.
//
// A named board fixture may also have a `<name>.ext.json` beside it holding
// module state (`view.ext.<module>`).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Without the stylesheet the canvas lays out at zero height.
import "../src/index.css";
import { Board3D } from "../src/components/board/Board3D";
import { activateLocale } from "../src/lib/i18n";
import { setBoardPostFx } from "../src/lib/boardPostFx";
import type { Board, FullView } from "../src/lib/types";
import boardData from "./board-shots.board.json";

const params = new URLSearchParams(window.location.search);

// Sanitised like `?pieces=` in `board-live.tsx`.
const fixture = (() => {
  const name = params.get("board");
  return name && /^(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+\.json$/.test(name) ? name : null;
})();

// A fixture is one of three shapes:
//
//   - a bare board, as `costan-sim -dump-board` writes it;
//   - an envelope, `{board, ruleset?, config?, ext?}`, for modules whose board
//     layers live in the ext blob rather than the tiles (fishing grounds, oasis,
//     rivers, the Raiders castle, Explorers' fog and fields);
//   - a whole dumped frame view, via `?view=`, from `cmd/costan-replay`, used
//     unchanged.
//
// Envelope writers use either `ruleset` or `config.ruleset`, so both are read.
const viewFixture = (() => {
  const name = params.get("view");
  return name && /^(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+\.json$/.test(name) ? name : null;
})();
const dumped = viewFixture ? ((await (await fetch(viewFixture)).json()) as FullView) : null;

const loaded = fixture ? await (await fetch(fixture)).json() : boardData;
const envelope = loaded !== null && typeof loaded === "object" && "board" in loaded;
const board = (dumped?.board ??
  (envelope ? (loaded as { board: unknown }).board : loaded)) as unknown as Board;
const fixtureRuleset = envelope
  ? ((loaded as { ruleset?: string; config?: { ruleset?: string } }).ruleset ??
    (loaded as { config?: { ruleset?: string } }).config?.ruleset ??
    "base")
  : "base";

/**
 * The module state that goes with a fixture, if there is any.
 *
 * Read from the envelope's `ext`, or from a `<board>.ext.json` beside a bare
 * `<board>.board.json` (`-dump-board` writes only `s.Board`). A missing sidecar
 * means no module state.
 *
 * The Raiders ext is staged: castle, coastline and supply are derived from the
 * board by the engine's rules, but raider counts and riders are pushed past the
 * opening position so the saturated-hex muster and riders are in the shot.
 */
const fixtureExt = await (async () => {
  if (envelope) return (loaded as { ext?: Record<string, unknown> }).ext ?? {};
  if (!fixture) return {};
  const at = fixture.replace(/\.board\.json$/, ".ext.json");
  if (at === fixture) return {};
  try {
    const res = await fetch(at);
    return res.ok ? ((await res.json()) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
})();

// Set before the first render, so the board is built in its look rather than
// rebuilding the sky and lights mid-shot.
const look = params.get("look") ?? "";
if (look === "dark" || look === "postdark") document.documentElement.classList.add("dark");
setBoardPostFx(look === "post" || look === "postdark");

// A bare board: terrain, number chips, harbours, coast, and no player pieces,
// so the shot is of the tile art. A module's own figures come from the
// fixture's `ext`.
//
// `as unknown as FullView`: the page fills only the fields the board reads.
const view = {
  seq: 0,
  viewer: 0,
  phase: "play",
  cur: 0,
  legal: {},
  players: [0, 1, 2, 3].map((seat) => ({ seat, hand: [0, 0, 0, 0, 0, 0] })),
  // Required: the ghost-placement layers read `config.ruleset` unguarded.
  config: { ruleset: fixtureRuleset },
  board,
  buildings: [],
  roads: [],
  ext: fixtureExt,
} as unknown as FullView;

// A dumped view is used as is, never merged.
const shot = dumped ?? view;

const noop = () => {};

/**
 * Tell the screenshot driver the board has finished loading.
 *
 * `onReady` fires once the renderer has its assets and has drawn; the driver
 * polls for this flag rather than sleeping.
 */
function ready() {
  document.body.dataset.boardReady = "1";
}

// `Board3D` translates its HUD chrome and Lingui throws with no catalogue
// loaded, which would surface as a ready timeout in the driver.
await activateLocale("en");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="fixed inset-0">
      <Board3D
        view={shot}
        mode="none"
        onVertex={noop}
        onEdge={noop}
        onHex={noop}
        onInspect={noop}
        className="w-full h-full"
        controls
        onReady={ready}
      />
    </div>
  </StrictMode>,
);
