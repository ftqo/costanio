import * as React from "react";
import { ResIcon } from "@/components/asset/AssetParts";
import { RES, resIconSlot } from "@/lib/cardFace";
import { cn } from "@/lib/utils";

/**
 * Parts for the scenario panels (Raiders, Wagons, Explorers): a header with a
 * mono label, rows of glyph + words + chip + button, a movement bar, cargo
 * slots, mission cells. Drawn with the HUD's materials (`hud-primary`,
 * `hud-secondary`, `hud-chip`, the `--hud-*` tokens); styles are the `modp-`
 * block in index.css. Each part is a thin name for a class combination, so the
 * panels say what a thing is.
 */

/** A module-panel button: the amber primary, or the rimmed secondary. */
export const MBtn = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; quiet?: boolean }
>(function MBtn({ primary, quiet, className, type, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "modp-btn",
        primary ? "hud-primary" : quiet ? "modp-btn-quiet" : "hud-secondary",
        className,
      )}
      {...rest}
    />
  );
});

/** A panel's header: the mono label on the left, a chip or two on the right. */
export function MHead({ label, children }: { label: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="modp-head">
      <span className="hud-lab">{label}</span>
      {children && <span className="modp-head-end">{children}</span>}
    </div>
  );
}

/** A counter chip: a glyph and a number, optionally a unit after it. */
export function MChip({
  icon,
  children,
  tone,
  className,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & {
  icon?: React.ReactNode;
  tone?: "bad" | "good" | "focus";
}) {
  return (
    <span className={cn("hud-chip modp-chip", className)} data-tone={tone} {...rest}>
      {icon}
      {children}
    </span>
  );
}

/** A movement bar: `value` of `max`, filled in the focus colour. */
export function MBar({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className="modp-bar" aria-hidden>
      <i style={{ width: `${Math.round(w * 100)}%` }} />
    </span>
  );
}

/** One resource's art, at chip size, with the dark theme's rim light. */
export function ResArt({ idx, size = 16 }: { idx: number; size?: number }) {
  return <ResIcon slot={resIconSlot(idx)} size={size} className="hud-ic object-contain" />;
}

/**
 * A price as grouped resource art, the build tiles' `hud-cc` row: one icon per
 * kind and its count past one, the kind you are short of underlined.
 */
export function MCost({ cost, have }: { cost: Record<number, number>; have?: number[] }) {
  const items = RES.filter((r) => cost[r.idx]);
  return (
    <span className="modp-cost" aria-hidden>
      {items.map((r) => (
        <span
          key={r.idx}
          className="hud-cc"
          data-short={have && (have[r.idx] ?? 0) < cost[r.idx] ? "true" : undefined}
        >
          <ResArt idx={r.idx} size={15} />
          {cost[r.idx] > 1 && <sub>{cost[r.idx]}</sub>}
        </span>
      ))}
    </span>
  );
}

/**
 * Module glyphs the HUD has no icon for: a rider, a wagon, a cargo ship, a
 * crew, a settler, a harbour settlement, a pirate lair's flag. Drawn on a 16px
 * grid in `currentColor`, matching the Phosphor `bold` set beside them.
 */
const GLYPH = {
  rider: "M3.5 14.5 4.6 9l2.8-4.6L9.6 2l1 2.2 3 1.8-1 2.2-2-1-1 2.8 1.2 4.5z",
  wagon:
    "M1 4.5h11v5.2H1z M12 6.5h2l1.2 3.2H12z M3.6 13.8a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6z M10.4 13.8a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6z",
  cship: "M1.5 9.5h13l-2.3 4H3.8z M4 5h4v4H4z M8.8 6.2h3.4v2.8H8.8z",
  crew: "M5.2 2.4a2 2 0 1 1 0 4 2 2 0 0 1 0-4z M1.6 13.6c0-2.8 1.6-5 3.6-5s3.6 2.2 3.6 5z M11 3.4a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z M9.4 8.9c.5-.3 1-.5 1.6-.5 1.9 0 3.4 2.1 3.4 4.8H10c0-1.7-.2-3.1-.6-4.3z",
  person:
    "M8 1.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z M3.6 14.4c0-3.2 2-5.8 4.4-5.8s4.4 2.6 4.4 5.8z",
  hset: "M3 8.5 8 4l5 4.5V12H3z M1 13.2c1.2-.8 2.4-.8 3.5 0s2.3.8 3.5 0 2.3-.8 3.5 0 2.3.8 3.5 0v1.4c-1.2.8-2.4.8-3.5 0s-2.3-.8-3.5 0-2.3.8-3.5 0-2.3-.8-3.5 0z",
  flag: "M3 1.5h1.5v13H3z M4.5 2h8.5l-2 3 2 3H4.5z",
  raider: "M8 1.2 13.8 3.4v4.3c0 3.6-2.5 6.1-5.8 7.2-3.3-1.1-5.8-3.6-5.8-7.2V3.4z",
  fish: "M1 8c2.2-3.2 6.2-4.2 9.2-2l3.8-2.6v9.2L10.2 10C7.2 12.2 3.2 11.2 1 8z",
  spice: "M8 1.5c3 2.5 5 5.2 5 7.8a5 5 0 0 1-10 0C3 6.7 5 4 8 1.5z",
  castle: "M1.5 6.5h2V4h2.2v2.5h1.2V4h2.2v2.5h1.2V4h2.2v2.5h2V14h-13z",
  delivery: "M2 5.5 8 2l6 3.5v6L8 15l-6-3.5z M8 8.6 2.4 5.4 M8 8.6l5.6-3.2 M8 8.6V15",
} as const;
export type GlyphName = keyof typeof GLYPH;

export function Glyph({
  name,
  size = 14,
  className,
  style,
}: {
  name: GlyphName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const stroke = name === "delivery";
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden
      className={cn("shrink-0", className)}
      style={style}
    >
      <path
        d={GLYPH[name]}
        fill={stroke ? "none" : "currentColor"}
        stroke={stroke ? "currentColor" : undefined}
        strokeWidth={stroke ? 1.5 : undefined}
        strokeLinejoin="round"
      />
    </svg>
  );
}
