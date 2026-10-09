import * as React from "react";
import { Plural } from "@lingui/react/macro";
import { useGameSocket, shallowEqual, type State } from "@/lib/ws";
import { seatBudgetMs, seatCountdownMs } from "@/lib/gamestate";
import { SeatTimerBar } from "./hud/SeatTimerBar";

/**
 * The viewer's own clock, drawn inside a decision panel: a draining bar and the
 * seconds left, where the player is looking (the edge strip sits behind the
 * dialog's scrim).
 *
 * Draws nothing while the viewer is not on the clock, so a panel can mount it
 * unconditionally.
 */
export function DecisionClock() {
  const v = useGameSocket(selectClock, shallowEqual);
  return <DecisionClockView remainingMs={v.remainingMs} budgetMs={v.budgetMs} />;
}

interface ClockSlice {
  remainingMs: number | null;
  budgetMs: number | null;
}
const IDLE: ClockSlice = { remainingMs: null, budgetMs: null };

function selectClock(s: State): ClockSlice {
  const view = s.full;
  if (!view || view.viewer < 0) return IDLE;
  return {
    remainingMs: seatCountdownMs(view, view.viewer),
    budgetMs: seatBudgetMs(view, view.viewer),
  };
}

/** The drawing, apart from the socket, so a test can hand it a clock. */
export function DecisionClockView({ remainingMs, budgetMs }: ClockSlice) {
  const secs = useSecondsLeft(remainingMs);
  if (remainingMs == null || secs == null) return null;
  return (
    // aria-hidden: TurnTimerEdge announces the viewer's clock at fixed marks;
    // this number would otherwise be read out every second.
    <div data-decision-clock className="flex w-full items-center gap-2" aria-hidden>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full border border-border">
        <SeatTimerBar remainingMs={remainingMs} budgetMs={budgetMs} />
      </div>
      <span
        className="shrink-0 text-[11px] font-extrabold font-num tabular-nums"
        data-decision-clock-secs
      >
        <Plural value={secs} one="# second left" other="# seconds left" />
      </span>
    </div>
  );
}

/**
 * Whole seconds left on a countdown the server reported as `remainingMs` when
 * the view arrived, ticking down locally once a second. Null for no clock.
 */
function useSecondsLeft(remainingMs: number | null): number | null {
  const [secs, setSecs] = React.useState<number | null>(
    remainingMs == null ? null : Math.max(0, Math.ceil(remainingMs / 1000)),
  );
  React.useEffect(() => {
    if (remainingMs == null) {
      setSecs(null);
      return;
    }
    const anchor = performance.now();
    const tick = () =>
      setSecs(Math.max(0, Math.ceil((remainingMs - (performance.now() - anchor)) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [remainingMs]);
  return secs;
}
