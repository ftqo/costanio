// What a flat (phone-sized) board frames against.
//
// The full fit set (`boardFitPoints` over every tile) suits a board that can
// turn: the camera has to hold at every bearing, and the sea ring is where the
// harbours stand. On a phone that made the board small, since Islands maps
// carry a hex of open water around every island. A flat view frames only what
// can be played on: the land, its beach, and each harbour's dock. Open sea is
// still drawn and reachable by pan and pinch.
import * as THREE from "three";
import type { BoardTile } from "@/lib/types";
import { LATTICE_SIZE } from "./coords";
import { isWaterTile } from "./layers/gap";
import { boardFitPoints } from "./scene";

/**
 * How far a harbour's dock reaches from its sea hex's centre, in lattice sides.
 *
 * The dock stands on the sea hex beside its coast (`planPorts`), pier toward
 * the land and sign seaward of the centre. 0.3 keeps the outermost sign inside
 * a 390px canvas with the flat view's 3% margin.
 */
export const DOCK_REACH = 0.3;

/** Just the position of a planned dock; see `planPorts`. */
export interface DockAt {
  position: readonly [number, number, number];
}

/**
 * The flat view's fit set: land corners (beach included) plus a small ring
 * around every dock. A board with no land at all falls back to every tile, so
 * the camera always has something to fit.
 */
export function flatFitPoints(tiles: BoardTile[], ports: readonly DockAt[]): THREE.Vector3[] {
  const land = tiles.filter((t) => !isWaterTile(t.res));
  if (land.length === 0) return boardFitPoints(tiles);
  const pts = boardFitPoints(land);
  const r = DOCK_REACH * LATTICE_SIZE;
  for (const p of ports) {
    const [x, , z] = p.position;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      pts.push(new THREE.Vector3(x + r * Math.cos(a), 0, z + r * Math.sin(a)));
    }
  }
  return pts;
}
