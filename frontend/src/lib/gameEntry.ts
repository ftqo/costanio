// Holding the game screen back until it is worth showing.
//
// Entering a table finishes three things in any order: the server's first
// state frame, the board's models parsing, and piece art for every colour at
// the table. Rendering on the first one shows the board assembling itself.
//
// So the screen waits for the actual signals, with a floor so it cannot flash
// and a ceiling so it cannot hang. This applies to every entry: a new game, a
// refresh, a reconnect, a direct link mid-game, a spectator.

/**
 * The shortest the screen may be shown once something is displayed.
 *
 * A gate that resolves in 30ms would flash a loading card for two frames. Only
 * applies when the screen is actually up.
 */
export const ENTRY_MIN_DWELL_MS = 400;

/**
 * The longest the screen may hold the player back, whatever is still pending.
 *
 * Everything behind the gate degrades on its own (the board draws what it has,
 * shop tiles fall back, icons are omitted), so a stuck model fetch costs a
 * rough first second, not an unenterable game.
 */
export const ENTRY_MAX_WAIT_MS = 5000;

export interface EntryState {
  /** The server's first state frame has arrived. */
  viewReady: boolean;
  /** Models parsed and piece art resolved for the colours at this table. */
  assetsReady: boolean;
  /**
   * The board has drawn a frame.
   *
   * `assetsReady` only means the .glb bytes are parsed; the expensive work
   * (renderer creation, instanced meshes, per-material shader compiles on first
   * draw, geometry upload, the first shadow pass) comes after. "Has drawn"
   * rather than "has been built", since three.js compiles lazily on first draw.
   */
  boardReady: boolean;
  /** Milliseconds since the game screen mounted. */
  elapsedMs: number;
}

/**
 * Whether the game screen may be shown yet.
 *
 * Pure so the policy is testable without a browser, GPU or clock; the hook
 * owns the timers.
 */
export function canEnterGame({
  viewReady,
  assetsReady,
  boardReady,
  elapsedMs,
}: EntryState): boolean {
  // Without a view there is nothing to draw, ceiling or not. This is the
  // "Connecting to game…" state, which has its own error and stall escapes.
  if (!viewReady) return false;
  if (elapsedMs >= ENTRY_MAX_WAIT_MS) return true;
  return assetsReady && boardReady && elapsedMs >= ENTRY_MIN_DWELL_MS;
}

/**
 * When to next re-evaluate, in ms, or null if the answer cannot change on its
 * own.
 *
 * Driven by two deadlines rather than polling: the dwell floor and the
 * ceiling.
 */
export function nextEntryCheckMs(state: EntryState): number | null {
  if (canEnterGame(state)) return null;
  if (!state.viewReady) {
    // Waiting on the network; the socket wakes us.
    return null;
  }
  if (state.assetsReady && state.boardReady) {
    return Math.max(0, ENTRY_MIN_DWELL_MS - state.elapsedMs);
  }
  return Math.max(0, ENTRY_MAX_WAIT_MS - state.elapsedMs);
}

/**
 * How long the board cover takes to fade out once the gate opens. Matches the
 * cover's `duration-300` class.
 */
export const ENTRY_COVER_FADE_MS = 300;
