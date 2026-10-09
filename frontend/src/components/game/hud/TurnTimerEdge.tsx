/**
 * The viewer's own countdown, along the very top edge of the screen.
 *
 * The seat rail draws every seat's clock as a hairline in a card, easy to miss
 * when the clock running out is yours. This mirrors the rail's bar (same
 * component and lib/seatRing maths, so they agree) where it is visible from
 * anywhere without taking space.
 *
 * It shows the viewer's own deadline only, never the active seat's: several
 * seats can be on the clock at once (discard-on-7), and a screen-wide bar reads
 * as "act now". Spectators and timer-less games get nothing (`seatCountdownMs`
 * returns null). A seat handed to a bot by "Leave & Spectate" keeps its viewer
 * index and deadlines, so the caller passes `botControlled` (see
 * lib/seat.actingSeat).
 *
 * The one piece of chrome that spans a screen edge, against HudLayer's rule: a
 * 5px strip isn't a frame, and inset it would stop reading as an edge.
 *
 * It also speaks the countdown, since the bar is `aria-hidden` and running out
 * plays a move for you. See `ANNOUNCE_AT_MS`.
 */
import * as React from "react";
import { Plural } from "@lingui/react/macro";
import { useGameSocket, shallowEqual, type State } from "@/lib/ws";
import { type FullView } from "@/lib/types";
import { seatBudgetMs, seatCountdownMs } from "@/lib/gamestate";
import { SeatTimerBar } from "./SeatTimerBar";

/** Height of the strip, in px. Thin enough to be chrome, not a border. */
export const TURN_TIMER_EDGE_H = 5;

/**
 * Primitives only, compared with `shallowEqual`: this subscribes for itself so
 * a frame that moves anything else on the table cannot re-render it, and a
 * nested object rebuilt per read would defeat that.
 */
interface EdgeSlice {
  remainingMs: number | null;
  budgetMs: number | null;
}

const IDLE: EdgeSlice = { remainingMs: null, budgetMs: null };

/**
 * Where the countdown is announced, in ms remaining. The bar is colour only
 * (`SeatTimerBar` is `aria-hidden`, and the seat rail's number isn't
 * announced), so this is the spoken channel.
 *
 * Four marks, not a tick, so the region doesn't talk over everything: two land
 * in a 60s turn and four in a 120s one. The last two are inside `TIMER_RED_MS`,
 * so the spoken and drawn urgency agree.
 *
 * Descending, read with `find`: the next mark is the first strictly below
 * what is left.
 */
const ANNOUNCE_AT_MS = [60_000, 30_000, 10_000, 5_000] as const;

/**
 * The last mark the clock has passed, and how many have passed. The counter
 * keys the node, so two decisions reaching the same mark still produce a fresh
 * insertion (an identical sentence would be no mutation, so silence).
 */
interface Mark {
  secs: number;
  n: number;
}

/**
 * The mark to announce, kept current without a per-frame tick (as
 * `useTimerTier` in SeatTimerBar): the drain is one compositor animation and the
 * budget arrives only with server frames, so a timeout per crossing costs one
 * re-render per mark.
 *
 * Nothing is cleared when a new decision starts: a stale sentence costs
 * nothing, and clearing is itself a mutation some readers announce.
 */
function useTimerAnnouncement(remainingMs: number | null, frozen?: boolean): Mark | null {
  const [mark, setMark] = React.useState<Mark | null>(null);
  React.useEffect(() => {
    if (remainingMs == null || frozen) return;
    // Monotonic anchor, so one server message carries the whole chain of marks.
    const anchor = performance.now();
    let id: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const left = remainingMs - (performance.now() - anchor);
      const next = ANNOUNCE_AT_MS.find((at) => at < left);
      if (next == null) return; // past the last mark: nothing further to say
      id = setTimeout(() => {
        setMark((m) => ({ secs: next / 1000, n: (m?.n ?? 0) + 1 }));
        arm();
      }, left - next);
    };
    arm();
    return () => clearTimeout(id);
  }, [remainingMs, frozen]);
  return mark;
}

// Post-game the socket carries the final board on `postgame` rather than
// `full`, as the rail resolves it.
const liveView = (s: State): FullView | null => s.full ?? s.postgame?.board ?? null;

function selectEdge(s: State): EdgeSlice {
  const view = liveView(s);
  if (!view || view.viewer < 0) return IDLE;
  return {
    remainingMs: seatCountdownMs(view, view.viewer),
    budgetMs: seatBudgetMs(view, view.viewer),
  };
}

export const TurnTimerEdge = React.memo(function TurnTimerEdge({
  frozen,
  botControlled,
}: {
  /** The game has ended: hold the bar where it stands instead of draining it. */
  frozen: boolean;
  /**
   * A bot is playing the viewer's seat ("Leave & Spectate"), so the deadlines
   * are the bot's and a screen-wide "act now" bar would be wrong. From the seat
   * roster, which the socket doesn't carry.
   */
  botControlled: boolean;
}) {
  const v = useGameSocket(selectEdge, shallowEqual);
  // A bot answering the viewer's deadlines isn't the viewer on a clock, for the
  // spoken channel as for the drawn one.
  const remainingMs = botControlled ? null : v.remainingMs;
  const mark = useTimerAnnouncement(remainingMs, frozen);
  return (
    <>
      {/* Mounted whether or not there is a clock: a live region announces
          changes, so one created with its first sentence says nothing (as
          `ui/toast` once did).

          Polite: none of these is worth cutting a reader off mid-word. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {/* Except once the game is over: a countdown for a finished game is
            wrong. */}
        {mark && !frozen && (
          <span key={mark.n}>
            <Plural value={mark.secs} one="# second left" other="# seconds left" />
          </span>
        )}
      </div>
      {remainingMs != null && (
        <div
          className="fixed inset-x-0 top-0 z-50 pointer-events-none"
          style={{ height: TURN_TIMER_EDGE_H }}
        >
          <SeatTimerBar remainingMs={remainingMs} budgetMs={v.budgetMs} frozen={frozen} />
        </div>
      )}
    </>
  );
});
