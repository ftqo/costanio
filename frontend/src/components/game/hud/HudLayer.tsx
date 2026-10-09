import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Floating Isles HUD primitives.
 *
 * The game view is the 3D scene, edge to edge, at layer 0. Everything else is a
 * small island of glass floating over it. Two rules make that work:
 *
 *  1. The layer itself is click-through (`pointer-events-none`) so board clicks
 *     land everywhere the chrome isn't; each cluster opts back in. Without this
 *     a full-viewport HUD would swallow every drag of the camera.
 *  2. Nothing spans a screen edge. Clusters are inset from the corners, so the
 *     board stays visible corner to corner rather than being framed by rails.
 */

/**
 * Full-viewport, click-through container for every floating cluster.
 *
 * The `ref` gives the HUD's height in HUD pixels. `index.css` scales the UI
 * with `zoom` past 1700px, which `window.innerHeight`, `clientHeight`, `100svh`
 * and media queries all ignore (on a 3440x1310 window they say 1310; this box
 * is 655). The top row's and dock's `offsetHeight` are in the same space as
 * this box, so compare against this.
 */
export function HudLayer({
  children,
  ref,
}: {
  children: React.ReactNode;
  /** The layer's own box, for a host that needs the HUD's height in HUD pixels. */
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className="hud-root fixed inset-0 z-10 pointer-events-none">
      {children}
    </div>
  );
}

/**
 * Anchors one cluster to a spot on the viewport. `inset` keeps clusters off the
 * literal edge; safe-area padding keeps them clear of notches and home bars when
 * the scene runs under them (`viewport-fit=cover`).
 */
const ANCHORS = {
  "top-left": "top-0 left-0",
  "top-center": "top-0 left-1/2 -translate-x-1/2",
  "top-right": "top-0 right-0",
  /** Full-width strip along the top edge; the host lays out its own columns. */
  "top-row": "top-0 inset-x-0",
  "mid-left": "top-1/2 left-0 -translate-y-1/2",
  "mid-right": "top-1/2 right-0 -translate-y-1/2",
  "bottom-left": "bottom-0 left-0",
  "bottom-center": "bottom-0 left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-0 right-0",
  /** Full-width strip along the bottom edge; same deal as `top-row`. */
  "bottom-row": "bottom-0 inset-x-0",
} as const;

export type HudAnchor = keyof typeof ANCHORS;

/**
 * The inset every cluster keeps from the viewport edge, as a variable so the
 * safe-area guard is written once: one `max()` covers both, so `sm:p-3` can't
 * override the notch floor.
 */
const INSET = "[--hud-inset:0.5rem] sm:[--hud-inset:0.75rem]";
const INSET_PAD = cn(
  INSET,
  "[padding-top:var(--hud-inset)] [padding-bottom:var(--hud-inset)]",
  "[padding-left:max(var(--hud-inset),env(safe-area-inset-left))]",
  "[padding-right:max(var(--hud-inset),env(safe-area-inset-right))]",
);

export function HudCluster({
  at,
  className,
  children,
  style,
  ref,
}: {
  at: HudAnchor;
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  /** The cluster's own box, for a host that needs to measure or scroll it. */
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      style={style}
      className={cn("absolute pointer-events-auto", INSET_PAD, ANCHORS[at], className)}
    >
      {children}
    </div>
  );
}

/**
 * The top row: three islands sharing one line, laid out as a grid rather than
 * three absolutely positioned clusters (which grew into each other: absolute
 * boxes can't negotiate for space).
 *
 * The side tracks are equal `1fr`s, so the middle track stays screen-centred,
 * and every island may shrink (`min-w-0`) or wrap rather than overflow.
 *
 * One line at every width, with no breakpoints: stacking the pill below the
 * islands tied its position to their heights and cost board height for a few
 * more characters of an already truncated name.
 *
 * The pill is on grid row 1 and `items-start` top-aligns every island, so an
 * island that wraps grows downward and never pushes the turn banner.
 *
 * The side tracks have a `min-content` floor. With `minmax(0,1fr)` the
 * intrinsically sized middle track claimed its max-content first, and a long
 * name pushed the (non-wrapping, `justify-self-end`) right island under it.
 * `minmax(min-content,1fr)` stops that, and `minmax(0,auto)` in the middle
 * lets the pill yield (it truncates). With room, the `1fr`s resolve equal and
 * the pill is centred; only in a squeeze is it a few pixels off.
 *
 * Not absolute, because:
 *
 *  1. `TurnBanner` can hang the robber/pirate and road/ship pickers under its
 *     label, two rows tall; out of flow it would grow over the hamburger and
 *     utility orbs. Grid tracks with `min-content` floors can't overlap.
 *  2. The host measures this cluster's `offsetHeight` to park the seat rail
 *     beneath it and for lib/hudChrome's arithmetic. Out of flow, the pill's
 *     band would vanish from that height and the rail would sit on the pill.
 */
export function HudTopRow({
  left,
  center,
  right,
  ref,
}: {
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
  /** Measured by the host, which parks the seat rail directly beneath it. */
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <HudCluster
      ref={ref}
      at="top-row"
      className={cn(
        // Click-through between the islands: this box spans the whole width, so
        // it would otherwise eat every board drag along the top edge. Each island
        // opts back in.
        "pointer-events-none z-20",
        "grid grid-cols-[minmax(min-content,1fr)_minmax(0,auto)_minmax(min-content,1fr)] items-start gap-2",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 min-w-0 *:pointer-events-auto">{left}</div>
      {/* No `justify-self` on the middle slot, so it stretches to its track and
          the pill inside truncates against it (a content-sized slot would hang
          over both islands). The other half is the `min(70vw,100%)` cap in
          TurnBanner. */}
      <div className="min-w-0 *:pointer-events-auto">{center}</div>
      <div className="justify-self-end min-w-0 *:pointer-events-auto">{right}</div>
    </HudCluster>
  );
}

/**
 * The glass surface every cluster shares, as one class string so a material
 * change reaches the whole HUD.
 *
 * No `backdrop-blur`. A backdrop filter forces its own compositor surface and
 * re-blurs everything behind it on every recomposite; with 19 panels over the
 * WebGL canvas it was the most expensive thing on screen. The panels are
 * opaque now anyway.
 *
 * The material is `hud-surf` in index.css: an opaque panel colour, a 1px rim,
 * an inset highlight and a soft shadow, all theme tokens.
 *
 * `isolate` must stay: the HUD's layering relies on each panel opening a
 * stacking context (see the dock row's comment in routes/Game.tsx). It does
 * not create a containing block; the panels that need one (SeatRail's seat
 * tile, DockPanels' trigger pill) set `relative` themselves.
 */
export const GLASS = "hud-surf isolate";

export function GlassPanel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn(GLASS, className)} {...rest}>
      {children}
    </div>
  );
}

/**
 * The utility orbs' class string, extracted so it can be asserted on without a
 * DOM (like buttonVariants/iconButtonVariants in ui/button.tsx); hudOrb.test.ts
 * guards it.
 */
export function hudOrbClasses(opts: { active?: boolean; round?: boolean } = {}) {
  return cn(
    GLASS,
    // `relative` so an orb can carry a badge in its corner.
    "relative w-9 h-9 flex items-center justify-center text-[15px] leading-none shrink-0",
    // 36px is under the HUD's 44px target, so a finger gets the extra 8px as
    // an invisible halo around a 36px face. Keyed on the pointer, not the
    // viewport. The face stays 36px so the orbs line up with the 36px hamburger
    // and avatar beside them.
    //
    // -6px, not -4px: a pseudo-element is laid out against its originator's
    // padding box, so the orb's 2px border is spent first (-inset-1 measured
    // 40px). Revisit if the border width changes.
    //
    // The row's gap is 6px, so neighbouring halos meet mid-gap and the later
    // orb takes the shared pixel.
    "pointer-coarse:before:absolute pointer-coarse:before:-inset-1.5 pointer-coarse:before:content-['']",
    // An orb is a small panel that brightens under the pointer and takes the
    // focus ring. No hard shadow or press; the primary action is the HUD's one
    // raised thing.
    "cursor-pointer transition-colors",
    "hover:bg-[var(--hud-raised)] active:bg-[var(--hud-well)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    // The dim goes on the glyph, not the orb, so the board doesn't show
    // through the face.
    "disabled:pointer-events-none disabled:*:opacity-50",
    opts.round ? "rounded-full" : "rounded-[12px]",
    // `active` means "this orb's panel is open": a held toggle, in the
    // primary's hue so it reads as on rather than hovered.
    opts.active &&
      "bg-[color-mix(in_srgb,var(--hud-primary)_16%,var(--hud-fill-solid))] text-[var(--hud-award-ink)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--hud-primary)_55%,var(--hud-fill-solid))] hover:bg-[color-mix(in_srgb,var(--hud-primary)_16%,var(--hud-fill-solid))]",
  );
}

/** Small circular/rounded glass button used for the utility orbs. */
export const HudOrb = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; round?: boolean }
>(function HudOrb({ className, active, round, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(hudOrbClasses({ active, round }), className)}
      // Hooks for styles/pb-hud.css: an open orb is the selected yellow, a
      // disabled one keeps an opaque muted glyph.
      data-hud-orb
      data-active={active ? "true" : undefined}
      {...rest}
    />
  );
});

/**
 * Section label inside a popped card ("Bank", "Fleet", "Discard"). Caps come
 * from CSS so translators get normal words; index.css turns it off for CJK
 * locales, which have no case.
 */
export function HudLabel({ children }: { children: React.ReactNode }) {
  return <div className="hud-lab">{children}</div>;
}
