/**
 * One city-improvement track's level, as five pips with the metropolis rule
 * under them. Shared by the seat card and the shop tile (which does not print
 * the track name), so both show the same picture.
 *
 * The metropolis underlines its track: solid when permanent (level 5), dashed
 * while a rival can still take it. The row is reserved either way so the pips
 * don't shift.
 *
 * The underline fills only at `size="card"`. On shop tiles (`size="tile"`)
 * `MetropolisMark` (a star replacing the upgrade chevron) already says it. The
 * 2px row is reserved at both sizes so pip baselines align.
 *
 * `size` changes only the pip height: `card` is the seat card's 10px bar,
 * `tile` the 3px strip a 56x80 shop tile can spare, the smallest that still
 * reads as five pips.
 */
export function TrackPips({
  level,
  metropolis,
  color,
  size = "card",
}: {
  /** 0..5. */
  level: number;
  metropolis: boolean;
  /** The track's commodity as a bare mark: COMMOD.ink, not the card face. */
  color: string;
  size?: "card" | "tile";
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 gap-[1.5px]">
        {Array.from({ length: 5 }).map((_, j) => (
          <span
            key={j}
            className={
              size === "card"
                ? "h-2.5 min-w-0 flex-1 rounded-[1px]"
                : "h-0.75 min-w-0 flex-1 rounded-[1px]"
            }
            data-pip={j < level ? "on" : "empty"}
            // `--pip-empty` lets a surface re-ink the empty pip: the site's
            // hairline is invisible on a shop tile's cream stock.
            style={{ background: j < level ? color : "var(--pip-empty, var(--color-line))" }}
          />
        ))}
      </span>
      <span
        aria-hidden
        className="h-0.5 rounded-[1px]"
        style={
          metropolis && size === "card"
            ? level >= 5
              ? { background: color }
              : {
                  background: `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 6px)`,
                }
            : undefined
        }
      />
    </span>
  );
}
