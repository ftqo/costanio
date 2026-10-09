import * as React from "react";
import { useLingui } from "@lingui/react/macro";
import { cn } from "@/lib/utils";
import { Tip } from "./Tip";

/**
 * The chip's accessible name. Tip's title is in the DOM only while open, so
 * without this every counter announces as a bare number and every award as
 * nothing.
 *
 * `title` is a ReactNode because a few callers pass markup, and only a string
 * can be a name. A string `title` (the common case, a `t` template) is used
 * directly; otherwise `srTitle`. A chip with neither stays nameless.
 */
function srName(title: React.ReactNode, srTitle?: string): string | undefined {
  if (srTitle) return srTitle;
  return typeof title === "string" ? title : undefined;
}

// One stat: an icon and a value, with a tooltip that names and explains it. The
// building block for every HUD counter, so they all share weight, spacing and
// baseline.
export function Stat({
  icon,
  value,
  title,
  hint,
  tone,
  className,
  srTitle,
  hot,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  tone?: string;
  className?: string;
  /** Accessible name, when `title` is markup rather than a string. */
  srTitle?: string;
  /**
   * The number is past a line that matters (a hand over the discard limit), so
   * the chip gets a red edge and numeral. Visual only; the reason is in the hint.
   */
  hot?: boolean;
}) {
  const name = srName(title, srTitle);
  return (
    // `focusable`: the chip has a name and a ring, so it earns a tab stop.
    <Tip title={title} hint={hint} tapToOpen focusable>
      <span
        // `role="img"` with a name: the glyph and digit mean nothing read
        // separately. Without the role, the label on a bare span is ignored and
        // the reader announces only the number.
        role={name ? "img" : undefined}
        // Only a scalar joins the name; a few callers pass markup as `value`,
        // which would stringify to "[object Object]".
        aria-label={
          name && (typeof value === "string" || typeof value === "number")
            ? `${name}: ${value}`
            : name
        }
        data-hot={hot ? "true" : undefined}
        className={cn(
          "inline-flex items-center gap-1 rounded-[7px] px-1 leading-none cursor-default outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <span
          className="flex h-4 min-w-4 items-center justify-center text-muted"
          style={tone ? { color: tone } : undefined}
        >
          {icon}
        </span>
        {/* The value's box is reserved at a 3ch minimum, centred, so a value
            going from "0" to "12" (or "3/6") doesn't shift the counters to its
            right or change card widths. `min` so wider values still show in
            full; tabular-nums keeps digit widths equal. */}
        <span className="min-w-[3ch] text-center font-num tabular-nums font-semibold text-foreground">
          {value}
        </span>
      </span>
    </Tip>
  );
}

// A standalone achievement marker (Longest Road, Largest Army, …): an icon in
// the yellow "you hold this bonus" pill, with an explaining tip. `label` is for
// awards that carry a number (+2 island VP); named titles are icon-only, since
// a ROAD/ROUTE label would change the rail's width, which frames the board
// camera.
//
// `held=false` draws the empty state: a --color-line slot with muted contents
// (the improvement tracks' look for absent-but-possible), not a faded gold pill
// that would read as a disabled control.
export function Award({
  icon,
  label,
  title,
  hint,
  held = true,
  name,
  srTitle,
  caption,
  penalty = false,
}: {
  icon: React.ReactNode;
  label?: string;
  /**
   * The award's name, written on the chip. Only where the row has room (the
   * base game's two titles on a 252px card), never once an expansion brings the
   * slots to four or more; there the name is in the tip. Visual only; the
   * accessible name already carries the title.
   */
  caption?: string;
  /**
   * A chip that costs its holder (the Poorest Settler's -2, the old boot).
   * Held, it uses the warning colour instead of the award colour, so "-2" and
   * "+1" side by side don't read alike.
   */
  penalty?: boolean;
  title: React.ReactNode;
  hint?: React.ReactNode;
  held?: boolean;
  /**
   * Which award this slot is, on the element itself. The title lives inside a
   * Tip (in the DOM only while open), so this is how a test or debugger names a
   * chip without hovering.
   */
  name?: string;
  /** Accessible name, when `title` is markup rather than a string. */
  srTitle?: string;
}) {
  const { t } = useLingui();
  /**
   * The number is part of the name: `role="img"` is a leaf role, so `label`
   * inside is never announced. Stat folds its scalar into the name likewise.
   *
   * Parenthesised into `award` rather than a new message, so the held/not-held
   * sentences below keep their existing catalogue entries. The figure is a
   * numeral either way.
   */
  const base = srName(title, srTitle);
  const award = base && label ? `${base} (${label})` : base;
  return (
    <Tip title={title} hint={hint} tapToOpen focusable>
      <span
        data-award={name}
        data-held={held ? "true" : "false"}
        data-penalty={penalty ? "true" : undefined}
        role={award ? "img" : undefined}
        // Held is in the name, not only the fill: the two states otherwise
        // differ only by colour.
        aria-label={
          award
            ? held
              ? t({
                  id: "award.held",
                  message: `${award}: held by this player`,
                  comment:
                    "Screen-reader label on a per-seat award chip. The parameter is the AWARD " +
                    "(its title, sometimes with its figure: 'Longest Road (+2)'), not a person. " +
                    "It was named {who} and read as a player, so it is {award} now.",
                })
              : t({
                  id: "award.notheld",
                  message: `${award}: not held by this player`,
                  comment:
                    "Screen-reader label on a per-seat award chip. Scoped to THIS seat: it shows " +
                    "on every player who lacks the award, including while another player holds " +
                    "it. Do not render it as 'nobody holds it'.",
                })
            : undefined
        }
        className={cn(
          // A compact badge: fixed height, at least square, never shrinks.
          "inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.5 rounded-md border px-1 text-[10px] font-semibold leading-none cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring",
          // The border is the non-colour cue: solid when held, dashed when
          // empty. Same width, so no layout cost.
          held && penalty
            ? "border-solid border-transparent bg-hud-bad-tint text-(--hud-bad)"
            : held
              ? "border-solid border-transparent bg-(--hud-award-held-bg) text-(--hud-award-held-ink)"
              : "border-dashed border-line-strong bg-transparent text-muted",
        )}
      >
        <span className="flex h-3.25 w-3.25 shrink-0 items-center justify-center">{icon}</span>
        {caption && (
          <span aria-hidden className="min-w-0 truncate">
            {caption}
          </span>
        )}
        {label}
      </span>
    </Tip>
  );
}
