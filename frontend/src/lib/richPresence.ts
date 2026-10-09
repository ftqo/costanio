import * as React from "react";
import { plural, t } from "@lingui/core/macro";
import { getActivitySdk, inActivityMode } from "./activity";
import { rulesetLabel } from "./format";

/**
 * Normalized snapshot the Discord Rich Presence card is built from. Small and
 * view-agnostic so both the game view (FullView) and the waiting room (lobby
 * summary) can adapt into it, and the mapping stays a pure function.
 */
export interface PresenceInput {
  gameId: string;
  status: "lobby" | "active" | "finished";
  ruleset: string;
  /** Players currently seated: the party "current" count. */
  seatedPlayers: number;
  /** Configured table size: the party "max" count. */
  maxPlayers: number;
  /** Viewer's own seat, or -1 when spectating. */
  viewerSeat: number;
  /** Seat whose turn it currently is. */
  curSeat: number;
  /** Viewer's own victory points, or null when spectating. */
  viewerVP: number | null;
}

/** The subset of the Embedded App SDK `setActivity` payload we populate. */
export interface RichPresence {
  type: number;
  details: string;
  state: string;
  party?: { id: string; size: [number, number] };
  timestamps?: { start: number };
  assets: { large_image: string; large_text: string };
}

/** Pure mapping: a game snapshot + a stable start epoch -> a presence payload. */
export function buildActivity(input: PresenceInput, startedAt: number): RichPresence {
  // In the player's app language, the only one this client knows, though the
  // card shows on their Discord profile to friends too.
  const ruleset = rulesetLabel(input.ruleset);
  const n = input.maxPlayers;
  const details = t({
    message: `${ruleset} · ${plural(n, { one: "# player", other: "# players" })}`,
    context: "Discord Rich Presence: ruleset and table size",
  });

  const presence: RichPresence = {
    type: 0, // Playing
    details,
    state: stateLine(input),
    party: { id: input.gameId, size: [input.seatedPlayers, input.maxPlayers] },
    assets: { large_image: "logo", large_text: "costan.io" },
  };
  if (input.status === "active") presence.timestamps = { start: startedAt };
  return presence;
}

/**
 * Drives presence updates, deduping unchanged payloads and latching the
 * elapsed-timer start, so the websocket's frame cadence does not trip
 * Discord's rate limit (~5 updates / 20s). Synchronous, with injected sink and
 * clock for tests; `useRichPresence` adds the debounce and the SDK sink.
 */
export class PresenceController {
  private startedAt: number | null = null;
  private lastSent = "";

  constructor(
    private readonly sink: (activity: RichPresence) => void,
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  /** Build and emit presence for `input`, skipping payloads identical to the
   *  last one sent. The elapsed-timer start is latched on the first active
   *  snapshot and held stable thereafter, so the timer never resets. */
  update(input: PresenceInput): void {
    if (input.status === "active" && this.startedAt === null) {
      this.startedAt = this.clock();
    }
    const activity = buildActivity(input, this.startedAt ?? this.clock());
    const key = JSON.stringify(activity);
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.sink(activity);
  }

  /** Forget the last-sent payload so the next `update` always re-emits (used
   *  when leaving and re-entering a game view). Does not emit on its own. */
  clear(): void {
    this.lastSent = "";
  }
}

// Trailing debounce: a burst of frames becomes one setActivity call, staying
// under Discord's ~5 updates / 20s. Only a meaningful snapshot change re-arms
// the timer.
const PRESENCE_DEBOUNCE_MS = 2500;

/**
 * Pushes Rich Presence for the current game snapshot while playing inside the
 * Discord Activity. A no-op everywhere else (browser play, or `input` null).
 * Pass a freshly-derived `PresenceInput` each render; the hook debounces,
 * dedupes (via PresenceController), and clears presence on unmount.
 */
export function useRichPresence(input: PresenceInput | null): void {
  const controllerRef = React.useRef<PresenceController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new PresenceController((activity) => {
      // Best effort: swallow rate-limit / transient RPC errors so presence never
      // disrupts the game.
      getActivitySdk()
        ?.commands.setActivity({ activity })
        .catch(() => {});
    });
  }

  // Read the latest snapshot through a ref so the debounce effect can depend
  // only on a meaningful-change key, not on the per-render object identity.
  const inputRef = React.useRef(input);
  inputRef.current = input;

  const key = input && inActivityMode() ? JSON.stringify(input) : null;

  React.useEffect(() => {
    if (key === null) return;
    const controller = controllerRef.current!;
    const timer = setTimeout(() => {
      if (inputRef.current) controller.update(inputRef.current);
    }, PRESENCE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key]);

  React.useEffect(() => {
    const controller = controllerRef.current!;
    return () => controller.clear();
  }, []);
}

function stateLine(input: PresenceInput): string {
  if (input.status === "lobby") {
    return t({ message: "Waiting for players", context: "Discord Rich Presence status" });
  }
  if (input.status === "finished") {
    return t({ message: "Game over", context: "Discord Rich Presence status" });
  }

  // Whole lines rather than a suffix, so each language places the points
  // where its word order wants them.
  const vp = input.viewerVP;
  const seat = input.curSeat + 1;
  if (input.viewerSeat >= 0 && input.viewerSeat === input.curSeat) {
    return vp === null
      ? t({ message: "Your turn", context: "Discord Rich Presence status" })
      : t({ message: `Your turn · ${vp} VP`, context: "Discord Rich Presence status" });
  }
  return vp === null
    ? t({ message: `Player ${seat}'s turn`, context: "Discord Rich Presence status" })
    : t({ message: `Player ${seat}'s turn · ${vp} VP`, context: "Discord Rich Presence status" });
}
