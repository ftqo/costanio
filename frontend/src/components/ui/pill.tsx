import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// A small rounded tag for toggles, labels and count readouts. `active` and
// `neutral` are the single-select toggle states; `count` is the readout.
//
// An unselected toggle sits on the panel fill with a 1px rim and soft lift; the
// selected one is filled with ink and flat. Fill versus rim is the cue, which
// keeps a selected toggle distinct from the coloured, rimless ruleset badges.
const pillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
  {
    variants: {
      tone: {
        // Sit on a surface so the page does not show through.
        neutral: "border border-border bg-secondary-background text-foreground",
        active: "border border-selected bg-selected text-selected-ink",
        count: "border-0 bg-elev2 text-foreground font-num tabular-nums",
      },
      size: {
        sm: "px-2.5 py-0.5 text-[12px]",
        md: "px-3 py-1 text-[13px]",
      },
      // Interactive chips get a soft lift and a hover; no travel.
      interactive: {
        true: "cursor-pointer shadow-hard-sm enabled:hover:bg-elev",
        false: "",
      },
      // Most chips name a setting ("fair dice") and are capitalised; a chip
      // that shows a proper name (a module, a decoration) keeps its own case.
      caps: {
        true: "capitalize",
        false: "normal-case",
      },
      // Shown but not yours to pick: a locked cosmetic.
      locked: {
        true: "opacity-40 cursor-not-allowed",
        false: "",
      },
    },
    // A selected interactive toggle is flat; the ink fill shows the state.
    compoundVariants: [
      {
        interactive: true,
        tone: "active",
        className: "shadow-none enabled:hover:bg-selected",
      },
    ],
    defaultVariants: {
      tone: "neutral",
      size: "sm",
      interactive: false,
      caps: true,
      locked: false,
    },
  },
);

export interface PillProps
  extends React.HTMLAttributes<HTMLElement>, VariantProps<typeof pillVariants> {
  asChild?: boolean;
  disabled?: boolean;
}

export const Pill = React.forwardRef<HTMLElement, PillProps>(
  ({ className, tone, size, interactive, caps, locked, asChild = false, ...props }, ref) => {
    const Comp = (asChild ? Slot : interactive ? "button" : "span") as React.ElementType<{
      ref?: React.Ref<HTMLElement>;
    }>;
    // A real <button> defaults to type="button" so it never submits an ancestor form.
    const extra = !asChild && interactive ? { type: "button" as const } : {};
    return (
      <Comp
        ref={ref}
        // pb-primitives.css: an interactive pill is a piece, a static one print.
        data-ui-pill=""
        data-tone={tone ?? "neutral"}
        data-interactive={interactive ? "true" : undefined}
        data-locked={locked ? "true" : undefined}
        className={cn(pillVariants({ tone, size, interactive, caps, locked }), className)}
        {...extra}
        {...props}
      />
    );
  },
);
Pill.displayName = "Pill";

export { pillVariants };
