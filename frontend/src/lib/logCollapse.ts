// One log line per journey, not per tap.
//
// On a phone an Explorers ship or a Wagons wagon moves one edge per tap (see
// `boardTap`), each its own command and event. The events stay as they are
// (replay needs each); only the feed merges them. A run of steps by the same
// piece, each starting where the last stopped, becomes one event with the
// whole journey (first `from`, last `to`, summed steps, tribute and tolls).
// Silent events (`null` formatters) may sit between steps; anything with its
// own line, or a turn boundary, ends the run.
//
// Knights and Raiders riders are not merged: each move is one command with the
// whole distance (`cak_knight_moved`, `raiders_rider_moved`).
import type { GameEvent } from "./gamestate";
import { EVENT_FORMATTERS } from "./eventlog";

type Data = Record<string, unknown>;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const num = (v: unknown, dflt = 0): number => (typeof v === "number" ? v : dflt);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : []);

/** Says nothing in the log, and so can sit inside a journey. */
function silent(e: GameEvent): boolean {
  if (e.type === "turn_started" || e.type === "turn_ended") return false;
  return (EVENT_FORMATTERS as Record<string, unknown>)[e.type] === null;
}

interface Rule {
  /** Whether `next` continues the journey whose merged data so far is `run`. */
  continues: (run: Data, next: Data) => boolean;
  /** Fold `next` into the journey. */
  merge: (run: Data, next: Data) => Data;
}

const RULES: Record<string, Rule> = {
  explorers_ship_moved: {
    continues: (run, next) =>
      run.player === next.player &&
      run.ship_id === next.ship_id &&
      // A move ending in a discovery forfeits the ship's remaining movement,
      // and its reveal follows it.
      run.stopped !== true &&
      same(run.to, next.from),
    merge: (run, next) => ({
      ...next,
      from: run.from,
      path: [...list(run.path), ...list(next.path)],
      steps: num(run.steps, 1) + num(next.steps, 1),
      tribute: num(run.tribute) + num(next.tribute),
    }),
  },
  wagons_moved: {
    continues: (run, next) => {
      if (run.player !== next.player || !same(run.to, next.from)) return false;
      // Tolls to two different owners are two transfers and stay two lines.
      const a = num(run.toll) > 0 ? num(run.paid, -1) : -1;
      const b = num(next.toll) > 0 ? num(next.paid, -1) : -1;
      return a < 0 || b < 0 || a === b;
    },
    merge: (run, next) => {
      const toll = num(run.toll) + num(next.toll);
      const paid = num(run.toll) > 0 ? run.paid : next.paid;
      return {
        ...next,
        from: run.from,
        mp: num(run.mp) + num(next.mp),
        ...(toll > 0 ? { toll, paid } : { toll: 0 }),
      };
    },
  },
};

/**
 * The merged events, cached on the last step of each journey, so rebuilding
 * the feed returns the same object (the row memo depends on it) and a new step
 * makes a new one.
 */
const merged = new WeakMap<GameEvent, { first: GameEvent; n: number; out: GameEvent }>();

export function collapseSteps(events: readonly GameEvent[]): readonly GameEvent[] {
  let out: GameEvent[] | null = null;
  for (let i = 0; i < events.length; i++) {
    const head = events[i];
    const rule = RULES[head.type];
    if (!rule) {
      out?.push(head);
      continue;
    }
    let run = (head.data ?? {}) as Data;
    let last = head;
    let n = 1;
    let end = i;
    for (let j = i + 1; j < events.length; j++) {
      const x = events[j];
      if (x.type === head.type && rule.continues(run, (x.data ?? {}) as Data)) {
        run = rule.merge(run, (x.data ?? {}) as Data);
        last = x;
        n++;
        end = j;
        continue;
      }
      if (silent(x)) continue;
      break;
    }
    if (n === 1) {
      out?.push(head);
      continue;
    }
    out ??= events.slice(0, i);
    const hit = merged.get(last);
    let ev: GameEvent;
    if (hit && hit.first === head && hit.n === n) ev = hit.out;
    else {
      ev = { seq: head.seq, type: head.type, data: run };
      merged.set(last, { first: head, n, out: ev });
    }
    out.push(ev);
    // The silent events swallowed in the journey render nothing anyway.
    i = end;
  }
  return out ?? events;
}
