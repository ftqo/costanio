// The review page for recipe-built tiles (`make compose-review`): the game's
// Board3D on the committed base board, with chosen hexes repainted as composed
// tiles, and a small console API the shot driver poses the camera through.
//
// Dev-only, like `board-shots.tsx`: it ships nothing.
//
//     ?tiles={"0,0":"trade_hills_w","2,-2":"hills"}   hex key -> manifest key
//
// A composed tile is loaded the way the game loads any tile, by the manifest
// key on the hex (`tileFileFor`), so the shot is of the shipping file.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../src/index.css";
import { Board3D } from "../src/components/board/Board3D";
import { activateLocale } from "../src/lib/i18n";
import { setBoardPostFx } from "../src/lib/boardPostFx";
import { hexToWorld } from "../src/lib/board3d/coords";
import { orbitDir } from "../src/lib/board3d/scene";
import type { Board, BoardTile, FullView } from "../src/lib/types";
import boardData from "./board-shots.board.json";

const params = new URLSearchParams(window.location.search);
const repaint = new Map<string, string>(
  Object.entries(JSON.parse(params.get("tiles") ?? "{}") as Record<string, string>).filter(
    ([k, v]) => /^-?\d+,-?\d+$/.test(k) && /^[a-z0-9_]+$/.test(v),
  ),
);
const robberParam = params.get("robber");
setBoardPostFx(false);

const base = boardData as unknown as Board;
const board: Board = {
  ...base,
  // Out of the way of every hex a sheet photographs, unless told otherwise.
  robber: robberParam
    ? { q: +robberParam.split(",")[0], r: +robberParam.split(",")[1] }
    : { q: 1, r: -1 },
  tiles: base.tiles.map((t: BoardTile) => {
    const res = repaint.get(`${t.hex.q},${t.hex.r}`);
    // A repainted hex keeps its number, or gets one, to judge it against.
    return res ? { ...t, res, num: t.num || 6 } : t;
  }),
};

const view = {
  seq: 0,
  viewer: 0,
  phase: "play",
  cur: 0,
  legal: {},
  players: [0, 1, 2, 3].map((seat) => ({ seat, hand: [0, 0, 0, 0, 0, 0] })),
  config: { ruleset: "base" },
  board,
  buildings: [],
  roads: [],
  ext: {},
} as unknown as FullView;

interface Rig {
  renderer: { domElement: HTMLCanvasElement; shadowMap: { needsUpdate: boolean } };
  camera: import("three").PerspectiveCamera;
  orbit?: {
    target: import("three").Vector3;
    enableDamping: boolean;
    minDistance: number;
    maxDistance: number;
    maxPolarAngle: number;
    update: () => unknown;
  };
  draw: (full?: boolean) => void;
}
const rig = () => (window as unknown as { __board3d: Rig }).__board3d;

function aim(pos: [number, number, number], target: [number, number, number], fov: number) {
  const r = rig();
  const cam = r.camera;
  if (r.orbit) {
    r.orbit.enableDamping = false;
    r.orbit.minDistance = 0;
    r.orbit.maxDistance = 1e6;
    r.orbit.maxPolarAngle = Math.PI / 2;
    r.orbit.target.set(...target);
    r.orbit.update = () => false;
  }
  cam.position.set(...pos);
  cam.fov = fov;
  const dist = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
  cam.near = Math.max(0.05, dist * 0.05);
  cam.far = Math.max(cam.far, dist * 20);
  cam.lookAt(...target);
  cam.updateProjectionMatrix();
}

const api = {
  hexToWorld: (q: number, r: number) => hexToWorld({ q, r }),
  /** Orbit pose round a target: distance, elevation and azimuth in degrees. */
  pose(target: [number, number, number], dist: number, elev: number, az: number, fov: number) {
    const d = orbitDir(elev, (az * Math.PI) / 180).multiplyScalar(dist);
    aim([target[0] + d.x, target[1] + d.y, target[2] + d.z], target, fov);
  },
  setCamera: aim,
  project(p: [number, number, number]) {
    const r = rig();
    const v = r.camera.position
      .clone()
      .set(...p)
      .project(r.camera);
    const c = r.renderer.domElement.getBoundingClientRect();
    return [c.left + ((v.x + 1) / 2) * c.width, c.top + ((1 - v.y) / 2) * c.height];
  },
  draw() {
    const r = rig();
    r.renderer.shadowMap.needsUpdate = true;
    r.draw(true);
  },
};
(window as unknown as { COMPOSE: typeof api }).COMPOSE = api;

await activateLocale("en");
const noop = () => {};
createRoot(document.getElementById("root")!).render(
  <StrictMode>
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
        onReady={() => {
          document.body.dataset.boardReady = "1";
        }}
      />
    </div>
  </StrictMode>,
);
