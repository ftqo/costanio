// The live board: every 3D asset, redrawn whenever any of them is re-exported.
//
//     make art-live      # dev server + blend watcher
//     open http://localhost:6790/dev/board-live.html
//
// Save anything in Blender (a tile, a piece, a robber) and this redraws within
// about a second, so art can be judged through the game's 56-degree camera
// rather than the Blender viewport.
//
// Dev-only: Vite serves `frontend/dev/` in dev, and `vite build`'s entry is
// index.html, so none of this ships.
//
// It uses the real `Board3D` because the sand, coastline and harbour signs are
// built at runtime and palette.json overrides authored colours at load.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import { Board3D } from "../src/components/board/Board3D";
import { previewView } from "../src/lib/board3d/previewFixture";
import type { Board, BoardTile, FullView, Resource } from "../src/lib/types";
import { activateLocale, DEFAULT_LOCALE } from "../src/lib/i18n";
import boardData from "./board-shots.board.json";

// The terrain is the engine's own board (`costan-sim -dump-board`); the pieces
// come from the preview route, which places one of every kind legally. Both are
// radius-2 lattices, so the preview's vertices exist on this board.
//
// The fixture is a base game, which has no gold, so one wheat tile (of four) is
// promoted to gold here. An Islands dump would change the radius and break the
// piece placements.
const GOLD_TAKES_FROM: Resource = "wheat";

const board: Board = (() => {
  const dumped = boardData as unknown as Board;
  const at = dumped.tiles.findIndex((t) => t.res === GOLD_TAKES_FROM);
  if (at < 0) return dumped;
  const tiles = dumped.tiles.map((t, i): BoardTile => (i === at ? { ...t, res: "gold" } : t));
  return { ...dumped, tiles };
})();

const view = {
  ...(previewView as unknown as Record<string, unknown>),
  board,
  // Knights, ships and metropolises only draw for a ruleset that has them. The
  // ghost-placement layers also read `config.ruleset` unguarded.
  config: { ruleset: "base+islands+cak" },
} as unknown as FullView;

const noop = () => {};

/**
 * `?pieces=cyclades` draws the buildings and roads from
 * `models/pieces/cyclades.glb` instead of the stock `pieces.glb`, so a culture
 * set can be judged on the board. The watcher re-exports
 * `art/pieces/<set>.blend` on save too.
 */
const pieceSet = (() => {
  const name = new URLSearchParams(window.location.search).get("pieces");
  // The name goes into a URL, so it must not escape the directory.
  return name && /^[a-z0-9_-]+$/.test(name) ? `pieces/${name}.glb` : undefined;
})();

/** How often to ask the watcher whether anything was re-exported. */
const POLL_MS = 500;

function Live() {
  const [status, setStatus] = useState("watching");

  useEffect(() => {
    let stamp: string | null = null;
    let stop = false;
    const tick = async () => {
      try {
        // `no-store` and a cache-buster, since a 304 would hide the change.
        const res = await fetch(`/models/.artversion?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.text();
        if (stamp === null) {
          stamp = body;
          return;
        }
        if (body === stamp || stop) return;
        let reason = "art";
        try {
          reason = JSON.parse(body).reason ?? "art";
        } catch {
          return; // half-written; the next poll gets the whole file
        }
        stamp = body;
        stop = true;
        setStatus(`reloading: ${reason}`);
        // A full reload: the loader caches by unversioned path and the browser
        // holds the old .glb too.
        setTimeout(() => window.location.reload(), 60);
      } catch {
        // The dev server restarting. Keep polling.
      }
    };
    const id = setInterval(tick, POLL_MS);
    void tick();
    return () => clearInterval(id);
  }, []);

  return (
    <div className="fixed inset-0">
      <Board3D
        view={view}
        mode="none"
        onVertex={noop}
        onEdge={noop}
        onHex={noop}
        onInspect={noop}
        className="w-full h-full"
        controls
        pieceSet={pieceSet}
      />
      <div
        style={{
          position: "fixed",
          left: 12,
          bottom: 12,
          padding: "6px 10px",
          borderRadius: 6,
          font: "12px ui-monospace, monospace",
          background: "rgba(8,12,18,0.72)",
          color: status === "watching" ? "#9fb3c8" : "#ffd479",
          pointerEvents: "none",
        }}
      >
        {pieceSet ? `${status} \u00b7 ${pieceSet}` : status}
      </div>
    </div>
  );
}

// The board's chrome has labels, and Lingui throws when no locale is active.
await activateLocale(DEFAULT_LOCALE);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Live />
  </StrictMode>,
);
