import * as React from "react";
import { seatRingAnim, tierEndsInMs, timerTier, TIER_COLOR, type TimerTier } from "@/lib/seatRing";

/**
 * The bar's colour, kept current without a per-frame tick. The drain is one
 * compositor CSS animation, and the remaining budget only arrives with server
 * frames, so reading the tier off `remainingMs` would lag. A timeout armed for
 * the exact crossing (see `tierEndsInMs`) costs two re-renders per decision.
 *
 * `frozen` (the game has ended) holds the colour, as it holds the drain.
 */
function useTimerTier(remainingMs: number | null, frozen?: boolean): TimerTier {
  /**
   * What the timeouts have escalated to, tagged with the message it was
   * measured from. The prop wins whenever it changes; the tag drops a stale
   * escalation during render rather than resetting state in an effect (a second
   * render).
   */
  const [ticked, setTicked] = React.useState<{ from: number | null; tier: TimerTier }>({
    from: remainingMs,
    tier: timerTier(remainingMs),
  });
  const tier = ticked.from === remainingMs ? ticked.tier : timerTier(remainingMs);
  React.useEffect(() => {
    if (remainingMs == null || frozen) return;
    // Measured against a monotonic anchor, so a long decision goes green ->
    // yellow -> red off one server message.
    const anchor = performance.now();
    let id: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const left = remainingMs - (performance.now() - anchor);
      const next = tierEndsInMs(left);
      if (next == null) return; // already red: nothing further to become
      id = setTimeout(() => {
        setTicked({
          from: remainingMs,
          tier: timerTier(remainingMs - (performance.now() - anchor)),
        });
        arm();
      }, next);
    };
    arm();
    return () => clearTimeout(id);
  }, [remainingMs, frozen]);
  return tier;
}

/**
 * The countdown, drawn as a hairline that drains from right to left. The maths
 * is lib/seatRing (same inputs, same remount key), so every countdown agrees.
 *
 * Drawn along the bottom of a seat panel (SeatRail) and across the top of the
 * screen for the viewer's own decision (TurnTimerEdge); it stretches to its
 * box, so no per-caller geometry.
 *
 * Two divs and a `scaleX` transform, which runs on the compositor (an SVG
 * `stroke-dashoffset` restyled the main thread on every tick). Keep the
 * animated element to transform/opacity only; see the keyframe in index.css.
 */
export function SeatTimerBar({
  remainingMs,
  budgetMs,
  frozen,
}: {
  remainingMs: number | null;
  budgetMs: number | null;
  frozen?: boolean;
}) {
  // Above the early return: a hook after a conditional return runs on some
  // renders and not others (React #310).
  const tier = useTimerTier(remainingMs, frozen);
  const a = seatRingAnim(remainingMs, budgetMs);
  if (!a) return null;
  return (
    // `seat-timer` carries no style; it names the bar so tests can ask whether a
    // clock is showing without depending on its markup.
    //
    // `aria-hidden`: drawn once per seat, so announcing each would be noise.
    // TurnTimerEdge announces the viewer's own countdown (see `ANNOUNCE_AT_MS`).
    <div aria-hidden className="seat-timer pointer-events-none relative w-full h-full">
      <div className="absolute inset-0 bg-hud-track" />
      {/* Pinned at the left and scaled toward it, so the bar empties right to
          left. `transform-origin` lives in the class beside the keyframe;
          change the direction in both together. */}
      <div
        key={a.key}
        className={`absolute inset-0${a.static ? "" : " seat-timer-fill"}`}
        // The tier, for the palette's red (styles/pb-hud.css).
        data-tier={tier}
        style={{
          // Set, never transitioned: a colour fade repaints every frame, and
          // this element must stay off the main thread (see the keyframe in
          // index.css).
          background: TIER_COLOR[tier],
          ...(a.static
            ? null
            : {
                animationDuration: `${a.durationMs}ms`,
                animationDelay: `${a.delayMs}ms`,
                animationPlayState: frozen ? "paused" : "running",
              }),
        }}
      />
    </div>
  );
}
