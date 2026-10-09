import * as React from "react";

/**
 * A labelled either/or under the turn chip: "Move: Robber | Pirate" on an
 * Islands 7, "Place: Road | Ship" for an Islands setup connection.
 *
 * It sits over the 3D board, so the row has its own `hud-surf` panel, whose
 * fill keeps a muted label legible over any part of the board.
 *
 * A segmented control: one recessed well, the chosen half raised. Each half may
 * show the piece it names. `aria-pressed` marks the chosen option.
 */
export function PieceChoice<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** The verb the pair answers ("Move:", "Place:"), already translated. */
  label: React.ReactNode;
  options: readonly { key: K; label: React.ReactNode; icon?: React.ReactNode }[];
  value: K;
  onChange: (key: K) => void;
}) {
  const labelId = React.useId();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      data-piece-choice=""
      className="hud-surf flex items-center gap-2 py-[3px] pl-3 pr-[3px] text-foreground"
    >
      <span id={labelId} data-piece-choice-label="" className="hud-lab">
        {label}
      </span>
      <span className="hudx-seg">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={value === o.key}
            onClick={() => onChange(o.key)}
            // 40px tall for a thumb.
            className="pointer-coarse:min-h-10 pointer-coarse:px-3"
          >
            {o.icon && (
              <span aria-hidden className="hudx-seg-ic">
                {o.icon}
              </span>
            )}
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}
