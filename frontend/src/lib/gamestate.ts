// Pure helpers for the live game store, kept out of ws.ts so buffer caps,
// seq-gap detection and send throttling are testable without a socket, DOM or
// real timers.

export interface GameEvent {
  seq: number;
  type: string;
  data: unknown;
}
export interface ChatMsg {
  id?: number; // chat row id; present on live frames + seed, used for reporting
  scope: string;
  from: string;
  user_id: number;
  msg: string;
}

// Chat keeps a window of the last 50 lines (all the server returns).
//
// The event log is kept whole, from `game_created` on: the client seeds the
// redacted log over HTTP once and then appends. Growth is bounded by
// COSTAN_GAME_EVENT_CAP, at which the server ends the game.
export const CHAT_CAP = 50;

// Minimum gap between outgoing chat messages. The backend enforces 1/sec; the
// frontend mirrors it so a too-fast message is blocked with its text kept.
export const CHAT_RATE_MS = 1000;

/**
 * seatCountdownMs returns the remaining budget (ms) to show next to a seat's
 * roster tile, or null when no countdown should render there; either timers
 * are disabled (turn_timer_sec === 0) or that seat is not currently on the
 * clock. Several seats can be on the clock at once (e.g. discard-on-7).
 */
export function seatCountdownMs(
  view: { config: { turn_timer_sec: number }; seat_deadlines?: Record<number, number> },
  seat: number,
): number | null {
  if (!view.config || view.config.turn_timer_sec <= 0) return null;
  const ms = view.seat_deadlines?.[seat];
  return ms == null ? null : ms;
}

/**
 * seatBudgetMs returns the full budget (ms) of a seat's current decision, the
 * mark its timer bar fills to, or null when none is stamped (see seat_budgets).
 * It is constant for the decision, so the bar scales smoothly.
 */
export function seatBudgetMs(
  view: { seat_budgets?: Record<number, number> },
  seat: number,
): number | null {
  const ms = view.seat_budgets?.[seat];
  return ms == null ? null : ms;
}

/**
 * timerBarPct returns the timer bar's fill percentage (0..100) for `remainingMs`
 * of a decision whose full budget is `budgetMs`, clamped to [0, 100]. With no
 * known budget (older server, or no stamped budget) it shows a full bar rather
 * than guessing from the remaining stream.
 */
export function timerBarPct(remainingMs: number, budgetMs: number | null): number {
  if (budgetMs == null || budgetMs <= 0) return 100;
  return Math.max(0, Math.min(100, (remainingMs / budgetMs) * 100));
}

/** Append `item`, keeping at most `cap` items. Never mutates `list`. */
export function appendCapped<T>(list: T[], item: T, cap: number): T[] {
  const start = list.length >= cap ? list.length - cap + 1 : 0;
  const next = list.slice(start);
  next.push(item);
  return next;
}

/** Trim `list` to its last `cap` items (used when seeding from the HTTP fetch). */
export function capTail<T>(list: T[], cap: number): T[] {
  return list.length > cap ? list.slice(list.length - cap) : list.slice();
}

/**
 * Fold `incoming` events into the retained log, by seq.
 *
 * Seq is the event's identity (its position in the server's append-only log),
 * so merging on it makes the live `ev` stream, the HTTP seed and the gap
 * refetch idempotent: a reconnect neither duplicates nor drops a line.
 *
 * Both sides stay ascending. On a collision the incoming copy wins: redaction
 * can only widen (a spectator who takes a seat re-fetches with more visible).
 */
export function mergeEvents(list: GameEvent[], incoming: GameEvent[]): GameEvent[] {
  if (!incoming.length) return list;
  const last = list.length ? list[list.length - 1].seq : -1;
  // Hot path: the live stream handing over the next event in order.
  if (incoming.length === 1 && incoming[0].seq > last) return [...list, incoming[0]];

  // Batches arrive ordered (ORDER BY seq), but sorting is cheap at seed
  // frequency and removes the dependency on that.
  const inc = incoming.every((e, i) => i === 0 || incoming[i - 1].seq <= e.seq)
    ? incoming
    : incoming.slice().sort((a, b) => a.seq - b.seq);

  const out: GameEvent[] = [];
  const push = (e: GameEvent) => {
    const n = out.length;
    if (n && out[n - 1].seq === e.seq) out[n - 1] = e;
    else out.push(e);
  };
  let i = 0;
  let j = 0;
  while (i < list.length && j < inc.length) {
    // `<=` so on an equal seq the existing entry is pushed first and the
    // incoming one overwrites it.
    if (list[i].seq <= inc[j].seq) push(list[i++]);
    else push(inc[j++]);
  }
  while (i < list.length) push(list[i++]);
  while (j < inc.length) push(inc[j++]);
  return out;
}

/**
 * The lowest seq the client still needs, i.e. what to ask the server for.
 *
 * Zero when the log is empty, otherwise the first hole rather than `last + 1`,
 * so a gap from a drop is refetched; `mergeEvents` absorbs the overlap.
 */
export function nextNeededSeq(list: GameEvent[]): number {
  let want = 0;
  for (const e of list) {
    if (e.seq > want) break; // hole: everything from `want` is missing
    if (e.seq === want) want++;
  }
  return want;
}

/**
 * The events after `seq`, in order.
 *
 * Binary search, since both callers (sound cues, card flights) run per event
 * against the whole game's sorted log.
 */
export function eventsAfter(list: GameEvent[], seq: number): GameEvent[] {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].seq > seq) hi = mid;
    else lo = mid + 1;
  }
  return lo >= list.length ? [] : list.slice(lo);
}

/** The highest seq in the (ascending) log, or -1 when it is empty. */
export function lastEventSeq(list: GameEvent[]): number {
  return list.length ? list[list.length - 1].seq : -1;
}

/**
 * Report whether an incoming event seq skips past the next expected one.
 * `lastSeq` is the highest event seq already applied (null = no baseline yet, so
 * no gap can be detected; a seed or state frame establishes the baseline). A
 * server FullView's seq is NextSeq, so after a state frame at seq S the baseline
 * is S-1 and the next event is expected at S.
 */
export function hasGap(lastSeq: number | null, incomingSeq: number): boolean {
  return lastSeq !== null && incomingSeq > lastSeq + 1;
}

/** Allows at most one event per `intervalMs`, using an injectable clock. */
export class RateGate {
  private last = -Infinity;
  constructor(
    private intervalMs: number,
    private now: () => number = () => Date.now(),
  ) {}
  try(): boolean {
    const t = this.now();
    if (t - this.last < this.intervalMs) return false;
    this.last = t;
    return true;
  }
}

/**
 * Whether the log already says this seat's forced turn is over, on a snapshot
 * that has not caught up yet.
 *
 * Events are folded for geometry only (see `lib/foldEvent`); phase flags wait
 * for the next snapshot. In between, the view can still say the seat owes a
 * placement the timer already made for it, so the board would keep a live ghost
 * on a spot it can no longer take.
 *
 * Nothing here is derived: each case reads a field the event states (who
 * placed, whose turn started), and the answer only withdraws an offer, the
 * safe direction (as in `viewPatch.pruneLegal`).
 *
 * `viewSeq` is the snapshot's seq (a server FullView's seq is its NextSeq), so
 * an event at or past it is not yet in the snapshot. Folding does not bump it.
 */
export function forcedTurnOver(events: GameEvent[], viewSeq: number, seat: number): boolean {
  if (seat < 0) return false;
  for (const ev of eventsAfter(events, viewSeq - 1)) {
    const d = (ev.data ?? {}) as { player?: unknown };
    const player = typeof d.player === "number" ? d.player : -1;
    switch (ev.type) {
      // Someone else is on the clock now, so nothing is owed here.
      case "turn_started":
        if (player !== seat) return true;
        break;
      // Obligations a seat can hold a live board for, each discharged by an
      // event naming that seat. The timer can answer any of them.
      case "settlement_placed":
      case "road_placed":
      case "robber_moved":
      case "cards_discarded":
        if (player === seat) return true;
        break;
    }
  }
  return false;
}
