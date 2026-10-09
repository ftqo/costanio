import * as React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { GLASS } from "./HudLayer";
import { DOCK_PILL } from "./DockPanels";
import {
  DOCK_TRIGGER_H,
  DOCK_TRIGGER_PILL,
  endTurnGap,
  endTurnH,
  hotbarH,
  rollTargetH,
  SQUAT_TURN_H,
} from "@/lib/hudChrome";
import { cn } from "@/lib/utils";

/**
 * Bottom-right turn cluster: the dice on top are the roll control, with End
 * turn beneath at the same width and a small gap (`endTurnGap`) so a slipped
 * press can't hit the wrong one and cost the turn.
 *
 * From `lg` only. Below that the two controls go down the dock (`DiceRow` and
 * `EndTurnPill` at the foot of this file), so the corner doesn't take width
 * from the hand shelf. `turnControlsPlacement` in lib/hudChrome picks.
 *
 * It never moves: it is the chrome a player touches every turn, so it stays in
 * the corner nearest the thumb (and the mouse's resting corner).
 *
 * It shares a row with the hand shelf, so it has the same height: the same
 * vertical padding around a box one hotbar tile high, both numbers from
 * lib/hudChrome. The box is a fixed height, not a sum of its contents, so it
 * doesn't change for spectators, Knights, or your own turn.
 */
export function TurnControls({
  dice,
  canRoll,
  onRoll,
  canEnd,
  onEnd,
  showEnd = true,
  wide,
  row = false,
  className,
}: {
  /** Set by the host below lg, where this rides inside the bottom row. */
  className?: string;
  /** Rendered dice: the live roll, or blank shapes before the first one. */
  dice: React.ReactNode;
  canRoll: boolean;
  onRoll: () => void;
  canEnd: boolean;
  onEnd: () => void;
  /**
   * False for a viewer with no seat. `canEnd` false only greys the button out,
   * which suits a player waiting their turn; a spectator never ends a turn, so
   * the control is absent. The dice stay either way.
   */
  showEnd?: boolean;
  /** `sm` and up. The shelf changes tile height and padding there; so does this. */
  wide: boolean;
  /**
   * Side by side rather than stacked: the foot of a sideways phone's dock
   * column (`squat`), the last row under the hand. A stack would spend a
   * hotbar's height of a 390px screen, so dice and End turn share one line at
   * a thumb's height (`SQUAT_TURN_H`), End turn taking the width left. It wraps
   * under them when three dice (Knights) leave too little.
   */
  row?: boolean;
}) {
  const { t } = useLingui();
  const rollH = rollTargetH(wide, showEnd);
  if (row) {
    return (
      <div
        className={cn(
          GLASS,
          "flex flex-wrap items-center justify-center gap-1.5 px-1 py-1.5",
          className,
        )}
      >
        {canRoll ? (
          <button
            type="button"
            onClick={onRoll}
            title={t`Roll the dice`}
            aria-label={t`Roll the dice`}
            // The same three wobbles as the stacked cluster below, but
            // sideways only (`data-wobble="flat"`, styles/pb-hud.css): the
            // rotating wobble swings a quarter of its width and the panel edge
            // clipped the first die.
            data-wobble="flat"
            className="flex items-center justify-center px-0.5 animate__animated animate__wobble animate__repeat-3 cursor-pointer"
            style={{ "--animate-duration": "1.5s", height: SQUAT_TURN_H } as React.CSSProperties}
          >
            {dice}
          </button>
        ) : (
          <div className="flex items-center justify-center px-0.5" style={{ height: SQUAT_TURN_H }}>
            {dice}
          </div>
        )}
        {showEnd && (
          // The sideways phone's End turn, in the same faces as the primary turn
          // action below: amber when it does something, secondary while waiting.
          <button
            type="button"
            disabled={!canEnd}
            onClick={onEnd}
            aria-label={t({ message: "End turn", context: "finish your turn" })}
            // `data-end-turn="row"`: 12px type with 10px sides, and the short
            // "End" once the button is under 96px wide (a container query in
            // styles/pb-hud.css), so the label never touches its edges.
            data-end-turn="row"
            className={cn(
              "flex flex-1 min-w-[62px] items-center justify-center rounded-[11px] px-1 py-0 leading-none text-[13px] font-semibold",
              canEnd ? "hud-primary cursor-pointer" : "hud-secondary cursor-default text-muted",
            )}
            style={{ height: SQUAT_TURN_H }}
          >
            <span data-end-label="long" aria-hidden>
              <Trans context="finish your turn">End turn</Trans>
            </span>
            <span data-end-label="short" aria-hidden>
              <Trans context="finish your turn, shortened for a narrow pill">End</Trans>
            </span>
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={cn(GLASS, "flex flex-col px-2 sm:px-3 py-2 sm:py-3", className)}>
      {/* One tile tall, whatever is inside it. */}
      <div className="flex flex-col items-stretch" style={{ height: hotbarH(wide) }}>
        {canRoll ? (
          <button
            type="button"
            onClick={onRoll}
            title={t`Roll the dice`}
            aria-label={t`Roll the dice`}
            // Three 1.5s wobbles (animate.css's default is 1s; --animate-duration
            // overrides it). animate.css has its own prefers-reduced-motion
            // guard.
            //
            // `repeat-3` rather than `infinite`: a compositor animation keeps the
            // compositor at display rate while it runs, i.e. the whole time the
            // player thinks. Same in DiceRow below.
            className="relative flex items-center justify-center animate__animated animate__wobble animate__repeat-3 cursor-pointer"
            style={{ "--animate-duration": "1.5s", height: rollH } as React.CSSProperties}
          >
            {dice}
          </button>
        ) : (
          // Not this client's roll (or before the first roll): still render the
          // dice shapes, blank until a result arrives.
          <div className="flex items-center justify-center" style={{ height: rollH }}>
            {dice}
          </div>
        )}
        {showEnd && (
          // The primary turn action, one button: before the roll there is
          // nothing to end, after it nothing to roll, so the band under the dice
          // says whichever is next (Roll, then End turn). The dice are also a
          // roll button.
          //
          // Height is set, not padded, so the button is exactly the band the
          // dice were sized around. The margin is the gap band (see
          // `endTurnGap`), kept on the button so height + margin is exactly what
          // `rollTargetH` subtracted.
          <button
            type="button"
            disabled={!canRoll && !canEnd}
            onClick={canRoll ? onRoll : onEnd}
            // A different accessible name for each job; the Roll name is the
            // dice's own.
            aria-label={
              canRoll ? t`Roll the dice` : t({ message: "End turn", context: "finish your turn" })
            }
            // Waiting on somebody else: the quiet secondary face. The amber
            // primary is lit only when pressing it does something.
            data-waiting={!canRoll && !canEnd ? "true" : undefined}
            className={cn(
              "flex w-full items-center justify-center gap-2 px-2 py-0 leading-none font-semibold text-[12px] sm:text-[16px]",
              "cursor-pointer transition-[filter] hover:brightness-105 active:brightness-95",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !canRoll && !canEnd ? "hud-secondary cursor-default text-muted" : "hud-primary",
            )}
            style={{ height: endTurnH(wide), marginTop: endTurnGap(wide) }}
          >
            {canRoll ? (
              <Trans context="roll the dice, on the primary turn button">Roll</Trans>
            ) : (
              <Trans context="finish your turn">End turn</Trans>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The dice on their own line at the top of the dock stack, hard right. Below
 * `lg` the turn cluster is gone (see the top of this file): the dice go here
 * and End turn on the trigger row beneath. Their own line because they wobble
 * when rollable, and a moving control can't share a baseline.
 *
 * One size, rolled or not, matching the trigger row's height. Growing would
 * shove the dock down when the turn changes; instead `-my`/`py` give a thumb
 * its 44px target out of the gaps without changing layout.
 */
export function DiceRow({
  dice,
  canRoll,
  onRoll,
}: {
  dice: React.ReactNode;
  canRoll: boolean;
  onRoll: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="mb-1.5 flex items-center justify-end" style={{ height: DOCK_TRIGGER_H }}>
      {canRoll ? (
        <button
          type="button"
          onClick={onRoll}
          title={t`Roll the dice`}
          aria-label={t`Roll the dice`}
          // Three 1.5s wobbles, as in the corner (see TurnCluster for why it
          // stops). animate.css has its own prefers-reduced-motion guard.
          className={cn(
            "animate__animated animate__wobble animate__repeat-3 cursor-pointer",
            // Hit area only: the padding is paid for by the matching negative
            // margin, so the line stays DOCK_TRIGGER_H tall.
            "-my-[5px] flex items-center px-2 py-[5px] -mx-2",
          )}
          style={{ "--animate-duration": "1.5s" } as React.CSSProperties}
        >
          {dice}
        </button>
      ) : (
        // Nobody's roll: a readout, and it says so by not being a button.
        <span className="pointer-events-none flex items-center">{dice}</span>
      )}
    </div>
  );
}

/**
 * End turn, as a pill on the dock's trigger row. "End", not "End turn": it sits
 * beside the bank's five counts and two icon buttons.
 *
 * Green and button-like even before it is pressable, since a player looks for
 * it all turn; `disabled` takes the press and pointer, and the muted face says
 * why.
 */
export function EndTurnPill({
  canEnd,
  onEnd,
  canRoll = false,
  onRoll,
}: {
  canEnd: boolean;
  onEnd: () => void;
  /**
   * The roll is yours: the same pill says Roll and rolls, in the same box, so
   * a phone has a green prompt for its first action as the corner cluster
   * does. The wobbling dice above stay a roll button too.
   */
  canRoll?: boolean;
  onRoll?: () => void;
}) {
  const { t } = useLingui();
  const roll = canRoll && !!onRoll;
  const live = roll || canEnd;
  const name = roll ? t`Roll the dice` : t({ message: "End turn", context: "finish your turn" });
  return (
    <button
      type="button"
      disabled={!live}
      onClick={roll ? onRoll : onEnd}
      title={name}
      aria-label={name}
      className={cn(
        DOCK_PILL,
        DOCK_TRIGGER_PILL,
        "text-[13px] font-semibold",
        // The HUD's one filled control while pressable; the quiet secondary face
        // during somebody else's turn, as in the corner cluster.
        live ? "hud-primary" : "hud-secondary text-muted",
        "disabled:pointer-events-none disabled:cursor-default",
      )}
      data-waiting={!live ? "true" : undefined}
    >
      {roll ? (
        <Trans context="roll the dice, on the primary turn button">Roll</Trans>
      ) : (
        <Trans context="finish your turn, shortened for a narrow pill">End</Trans>
      )}
    </button>
  );
}
