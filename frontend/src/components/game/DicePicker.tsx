import * as React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { HudButton } from "@/components/game/hud/HudButton";

/**
 * One die's row of faces.
 *
 * Kept at module scope: declared inside `DicePicker` it would be a new
 * component type each render, so React would replace the buttons, and a
 * re-render between mousedown and mouseup would swallow the click.
 */
function Row({
  val,
  set,
  label,
  hint,
  die,
}: {
  val: number;
  set: (n: number) => void;
  label: string;
  hint: string;
  /** Which die: the chosen face takes yellow (white die) or red. */
  die: "white" | "red";
}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-foreground">
        {label}
        <span className="font-normal text-muted">: {hint}</span>
      </span>
      <div className="flex gap-1 justify-center" role="group" aria-label={label}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={t`${label}: ${n}`}
            aria-pressed={val === n}
            onClick={() => set(n)}
            // A die face is a piece; the chosen one is held down in its die's
            // colour (pb-modules.css, `[data-pb-die]`).
            data-pb-die={die}
            className="w-11 h-11 rounded-[10px] text-[15px] font-semibold cursor-pointer focus-visible:outline-none"
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Alchemist: name both dice before the roll.
 *
 * Each row is named and coloured as its die, because in Knights the second die
 * is the red production die (`red := d2`, engine/knights/hooks.go), which decides
 * the progress-card draw, so 3-then-4 differs from 4-then-3. The total is
 * stated because it decides production, the 7 case is called out (legal, and
 * it moves the robber), and faces are 44px for touch.
 */
export function DicePicker({ onPick }: { onPick: (d1: number, d2: number) => void }) {
  const { t } = useLingui();
  const [d1, setD1] = React.useState(0);
  const [d2, setD2] = React.useState(0);
  const total = d1 && d2 ? d1 + d2 : 0;
  return (
    <div className="flex flex-col gap-3">
      <Row
        val={d1}
        set={setD1}
        label={t`White die`}
        hint={t({ message: "production", context: "what the white die decides" })}
        die="white"
      />
      <Row
        val={d2}
        set={setD2}
        label={t`Red die`}
        hint={t`also decides your progress-card draw`}
        die="red"
      />
      <div className="text-[13px] font-semibold text-center" aria-live="polite">
        {total ? (
          // Whole sentences rather than a clause appended to one, since word
          // order differs between languages.
          total === 7 ? (
            <Trans>
              Rolls <span className="text-[15px]">{total}</span>
              <span className="text-muted">, that's the robber</span>
            </Trans>
          ) : (
            <Trans>
              Rolls <span className="text-[15px]">{total}</span>
            </Trans>
          )
        ) : (
          <span className="text-muted">
            <Trans>Pick a face on each die.</Trans>
          </span>
        )}
      </div>
      <HudButton
        kind="primary"
        className="self-center min-w-[120px]"
        disabled={d1 === 0 || d2 === 0}
        onClick={() => onPick(d1, d2)}
      >
        <Trans>Set dice</Trans>
      </HudButton>
    </div>
  );
}
