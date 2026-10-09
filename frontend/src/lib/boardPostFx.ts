// Whether the viewer wants post-processing on the board, and how everything
// else hears about it.
//
// `board3d/boardTheme.ts` owns the values of the looks; this file persists the
// choice and notifies two kinds of consumer:
//
//   React        `useBoardPostFx()`, for the settings switch.
//   not React    `boardPostFx()` and `onBoardPostFxChange()`, for `Board3D` and
//                for `loader.ts`, which dresses the sea at asset-load time from
//                inside a GLTF callback with no component anywhere near it.
//
// Viewer-local, like `colorblind.ts`: never sent to the server, and purely
// visual, so players in one game may differ freely.
//
// Not tied to the light/dark theme: that axis is the site's, this one is the
// player's, and both looks define a day and a night.
//
// Default off; see `DEFAULT_BOARD_POSTFX`.
import * as React from "react";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { DEFAULT_BOARD_POSTFX, boardLook, boardMode, type BoardLook } from "./board3d/boardTheme";

export { DEFAULT_BOARD_POSTFX };

/**
 * Settings copy, as message descriptors (like `CB_MODE_LABELS`) so the module
 * constant follows the current locale via `i18n._(descriptor)`.
 *
 * The hint states the cost too, so a player on a weak machine knows why the
 * board got heavier.
 */
export const BOARD_POSTFX_LABEL: { name: MessageDescriptor; hint: MessageDescriptor } = {
  name: msg`Post-processing`,
  hint: msg`Warmer light, deeper colour, and a glow on everything bright. Costs more on older graphics hardware.`,
};

const KEY = "costan.boardpostfx";
const listeners = new Set<() => void>();

/**
 * Whether post-processing is on. Reads storage on every call so
 * `useSyncExternalStore` can use it as a snapshot; browsers serve the read from
 * memory.
 */
export function boardPostFx(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return DEFAULT_BOARD_POSTFX;
  } catch {
    return DEFAULT_BOARD_POSTFX;
  }
}

export function setBoardPostFx(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore: with storage blocked the change still applies this session */
  }
  listeners.forEach((l) => l());
}

export function subscribeBoardPostFx(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * The look both axes resolve to: the site's mode and the viewer's switch.
 *
 * The one place they are combined. The default for anything that dresses an
 * asset without being told the look, notably `dressOcean`, which `loader.ts`
 * calls from a GLTF callback that knows nothing of the board. Defaulting to
 * the day look there coloured night boards for noon.
 */
export function currentBoardLook(): BoardLook {
  return boardLook(boardMode(), boardPostFx());
}

/**
 * Call `cb` with the new value whenever it changes. Returns an unsubscribe.
 * Same shape as `onBoardModeChange`, so `Board3D` routes both axes into one
 * `applyLook`.
 */
export function onBoardPostFxChange(cb: (on: boolean) => void): () => void {
  return subscribeBoardPostFx(() => cb(boardPostFx()));
}

// Reactive across components that do not share a hook instance (the settings
// panel sets it, the board reads it), as with colorblind mode. The server
// snapshot is the default, since there is no storage during a server render.
export function useBoardPostFx(): boolean {
  return React.useSyncExternalStore(subscribeBoardPostFx, boardPostFx, () => DEFAULT_BOARD_POSTFX);
}
