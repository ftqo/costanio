// Short, player-facing descriptions of what each Knights city-improvement level
// grants, shown in the upgrade tile popover and the StatusPanel track tooltip.
// Indexed [track][level-1]; track order is Trade(0), Politics(1), Science(2).
// Keep in sync with the "City improvements" chapter of routes/HowToPlay.tsx.
import { msg } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";
//
// The draw ranges are the engine's rule: a gate draws when `red <= level + 1`
// (engine/knights/hooks.go), so level 1 draws on 1-2 and level 5 on anything. The
// event die showing the discipline is what opens the gate, so it is named too.
//
// Descriptors rather than strings: a module constant would freeze the language
// active at import. The accessors below resolve against the active catalogue.
//
// "draw" always means taking a card from a progress deck, which each whole
// sentence makes clear without a context tag.
const REWARDS: Record<number, MessageDescriptor[]> = {
  0: [
    // Trade (cloth)
    msg({ message: "On a Trade event, draw a Trade card if the red die shows 1–2" }),
    msg({ message: "On a Trade event, draw on a red die of 1–3" }),
    // "any 1 other commodity or a resource": `knights/decide.go:384` refuses a trade
    // whose output is the commodity given.
    msg({
      message:
        "Merchant Guild: give 2 of a commodity, take any 1 other commodity or a resource, and draw on 1–4",
    }),
    msg({ message: "Metropolis: +2 VP, that city can no longer be pillaged, and draw on 1–5" }),
    msg({ message: "Permanent metropolis (steals it from a level-4 holder); draw on any red die" }),
  ],
  1: [
    // Politics (coin)
    msg({ message: "On a Politics event, draw a Politics card if the red die shows 1–2" }),
    msg({ message: "On a Politics event, draw on a red die of 1–3" }),
    msg({ message: "Fortress: promote your knights to strength 3, the highest, and draw on 1–4" }),
    msg({ message: "Metropolis: +2 VP, that city can no longer be pillaged, and draw on 1–5" }),
    msg({ message: "Permanent metropolis (steals it from a level-4 holder); draw on any red die" }),
  ],
  2: [
    // Science (paper)
    msg({ message: "On a Science event, draw a Science card if the red die shows 1–2" }),
    msg({ message: "On a Science event, draw on a red die of 1–3" }),
    msg({
      message:
        "Aqueduct: on a non-7 roll that gives you nothing, take any 1 resource, and draw on 1–4",
    }),
    msg({ message: "Metropolis: +2 VP, that city can no longer be pillaged, and draw on 1–5" }),
    msg({ message: "Permanent metropolis (steals it from a level-4 holder); draw on any red die" }),
  ],
};

/**
 * The three city-improvement tracks in display order: Science, Trade, Politics.
 *
 * The values are engine track indices (0 Trade, 1 Politics, 2 Science), the
 * order `improve`, `metropolis`, `legal.improvements` and `improve_city
 * {track}` all use, which must not change. Every row of three tracks (seat
 * rail, hotbar upgrade tiles, the Crane picker) maps over this and indexes state
 * by the value.
 */
export const TRACK_ROW: readonly number[] = [2, 0, 1];

/**
 * The track level a given `cak_improved` event took its buyer to, counted from
 * the log: the number of that seat's improvements on that track at or before
 * `seq`. Returns 1 for a payload we cannot read, which is the bottom rung.
 *
 * Counted rather than read off current state, which reflects the whole batch:
 * a player can climb two levels in one command (a Crane buy alongside a normal
 * one). The event's `cost` is no help, since a Crane discounts it.
 */
export function improvedLevel(
  events: readonly { seq: number; type: string; data?: unknown }[],
  seq: number,
  player: number | undefined,
  track: number | undefined,
): number {
  if (player == null || track == null) return 1;
  let n = 0;
  for (const e of events) {
    if (e.seq > seq) break;
    if (e.type !== "cak_improved") continue;
    const d = e.data as { player?: number; track?: number } | undefined;
    if (d?.player === player && d?.track === track) n++;
  }
  return Math.max(1, n);
}

// What the next level up from `level` (0..5) grants, or null when already maxed.
export function nextImprovementReward(track: number, level: number): string | null {
  if (level >= 5) return null;
  const d = REWARDS[track]?.[level];
  return d ? i18n._(d) : null;
}

// What a given level (1..5) already grants, or null outside that range.
export function improvementReward(track: number, level: number): string | null {
  if (level < 1 || level > 5) return null;
  const d = REWARDS[track]?.[level - 1];
  return d ? i18n._(d) : null;
}
