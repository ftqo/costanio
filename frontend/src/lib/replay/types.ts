// The shape a replay arrives in, shared by every consumer.
//
// A frame is one event plus the authoritative board after it was applied. The
// view is folded in Go (the `replay` package, via `/api/games/{id}/frames`,
// `/api/replay/frames` or `cmd/costan-replay`), never here: `lib/foldEvent.ts`
// folds geometry only. A replay consumer only selects a view.
import type { FullView } from "@/lib/types";

export interface ReplayFrame {
  seq: number;
  type: string;
  event: { seq: number; type: string; data: unknown } | null;
  view: FullView;
}

export interface ReplayMeta {
  game_id: string;
  players: number;
  ruleset: string;
  /**
   * The committed seed, absent on a log without one. A player's own download
   * has it; a spectator's does not (stripped by the server's RedactEvent). Both
   * replay, since the board arrives whole in its event and the seed is only the
   * audit trail (docs/dice.md).
   */
  /* A decimal string from the server (a uint64 does not survive JSON.parse as
   * a number); a number only in older files such as the committed attract
   * loop. Printed, never computed with. */
  seed?: string | number;
  /** engine.NoPlayer (-1) for a draw, and for a log that stops early. */
  winner: number;
  scores: number[];
  events: number;
}

export interface ReplaySource {
  meta: ReplayMeta;
  frames: ReplayFrame[];
}
