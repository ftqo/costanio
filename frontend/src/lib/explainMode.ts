/**
 * Explain mode: the discoverable way to ask "what is that?" without a hover.
 *
 * Long press (lib/touch) answers the same question faster but is hidden, and
 * it should not be the only route to the rules. Almost every tap on this screen
 * commits (build, play, move the robber), so asking needs a visible state where
 * a tap only explains: a lit toggle in the HUD.
 *
 * Session-scoped, not persisted, so a reload never leaves someone in a game
 * where taps do nothing. It also disarms after one answer (`answerGiven`),
 * since the common case is one question.
 */
import * as React from "react";

let armed = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function setExplaining(on: boolean): void {
  if (armed === on) return;
  armed = on;
  emit();
}

export function toggleExplaining(): void {
  setExplaining(!armed);
}

/**
 * A question was answered, so the mode stands down.
 *
 * Called by whatever surfaced the explanation, since the tapped element does
 * not know an answer appeared. One-shot so the mode does not linger; re-arming
 * is one tap on the orb.
 */
export function answerGiven(): void {
  setExplaining(false);
}

export function subscribeExplaining(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Whether the next tap is a question.
 *
 * Reactive across components that share no tree position: the HUD orb arms
 * it, and a Tip deep in the dock reads it.
 */
export function useExplaining(): boolean {
  return React.useSyncExternalStore(
    subscribeExplaining,
    () => armed,
    () => false,
  );
}
