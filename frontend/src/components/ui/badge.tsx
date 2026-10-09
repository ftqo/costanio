import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Recurring tones and sizes. A look not listed here needs a new variant.
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold leading-tight",
  {
    variants: {
      tone: {
        // No fill.
        none: "",
        // A quiet state: unrated, connecting, a "once per turn" tag.
        muted: "bg-elev text-muted",
        // A good state: ready, connected.
        ready: "bg-green-tint text-green-ink",
        // Newer than the rest (expansion shelf).
        beta: "bg-amber-tint text-amber-ink",
        // A victory-point award, in the HUD's award colours.
        award: "bg-(--hud-award-bg) text-(--hud-award-ink)",
        // A resource chip: its icon, then its name.
        resource: "bg-elev2 text-foreground font-bold gap-1 pl-1",
        // A rating (RatingBadge): neutral print with tabular digits. Yellow is
        // kept for selection and awards.
        rating: "bg-elev2 text-foreground tabular-nums",
        // The fill is the ruleset's own colour, passed as `--badge-fill` (see rulesetTags).
        ruleset: "bg-(--badge-fill) text-main-foreground uppercase",
      },
      // Typography: the site's heading face, or the tracked mono label.
      type: {
        body: "",
        label: "font-semibold",
      },
      size: {
        xs: "px-1.5 text-[10px]",
        sm: "",
        md: "px-2.5 text-[12px]",
        lg: "px-3 text-[13px]",
      },
      // Provisional, or otherwise not yet worth full weight.
      // Drawn as the disabled print (pb-primitives.css), never faded.
      dim: { true: "", false: "" },
    },
    defaultVariants: { tone: "none", type: "body", size: "sm", dim: false },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

/** Status chip: a small coloured tag with no border or shadow, so it never
 * reads as clickable. A 6px tag rather than a pill.
 * forwardRef so the Tip hint primitive can wrap it. */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, tone, type, size, dim, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      // pb-primitives.css draws the tones that need more than a class.
      data-ui-badge=""
      data-tone={tone ?? "none"}
      data-dim={dim ? "true" : undefined}
      className={cn(badgeVariants({ tone, type, size, dim }), className)}
      {...props}
    />
  );
});

export { badgeVariants };
