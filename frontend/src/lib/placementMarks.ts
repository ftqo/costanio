// Whether the board marks the spots it is offering, and how everything else
// hears about it.
//
// Modelled on `boardPostFx.ts`: viewer-local, never sent to the server, and it
// never changes the set of legal spots, only whether the board shows them
// unprompted.
//
//   React        `usePlacementMarks()`, for the settings switch and for
//                `routes/Game.tsx`, which turns it into `markerStyle`.
//
// On by default: in forced modes (setup, a seven, a knight owed a spot) the
// marks are what tell a player there are candidates to find. Off is for
// players who find the lit spots noisy.
//
// Hover is not affected: pointing at a spot always previews the piece there.
import * as React from "react";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

/**
 * On unless the viewer has said otherwise (see the note at the top).
 */
export const DEFAULT_PLACEMENT_MARKS = true;

/**
 * Settings copy.
 *
 * Message descriptors rather than strings (as `BOARD_POSTFX_LABEL`), resolved
 * with `i18n._` at render.
 *
 * The hint says what remains when it is off: hovering still works, and what is
 * legal is unchanged.
 */
export const PLACEMENT_MARKS_LABEL: { name: MessageDescriptor; hint: MessageDescriptor } = {
  name: msg`Highlight legal spots`,
  hint: msg`Lights the spots a piece may go while you are placing one. With it off, point at a spot to preview it instead.`,
};

const KEY = "costan.placementmarks";
const listeners = new Set<() => void>();

/**
 * Whether the board marks legal spots at rest.
 *
 * Reads storage on every call rather than caching, so `useSyncExternalStore`
 * can use it as a snapshot.
 */
export function placementMarks(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return DEFAULT_PLACEMENT_MARKS;
  } catch {
    return DEFAULT_PLACEMENT_MARKS;
  }
}

export function setPlacementMarks(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore: a viewer with storage blocked still gets the change this session */
  }
  listeners.forEach((l) => l());
}

export function subscribePlacementMarks(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Reactive across components that do not share a hook instance (the header's
// settings panel sets it, the game route reads it). The server snapshot is the
// default, since there is no storage during a server render.
export function usePlacementMarks(): boolean {
  return React.useSyncExternalStore(
    subscribePlacementMarks,
    placementMarks,
    () => DEFAULT_PLACEMENT_MARKS,
  );
}
