import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Panel surface: opaque fill, a faint 1px rim (separates a navy panel from a
// navy background in dark mode) and the theme's soft lift, on a fixed radius
// scale (use these instead of rounded-[Npx]). The shadow names resolve to the
// soft shadows in index.css.
const cardVariants = cva("border border-rim bg-secondary-background", {
  variants: {
    shadow: { none: "", hard: "shadow-hard", lg: "shadow-hard-lg" },
    radius: { base: "rounded-base", card: "rounded-card", lg: "rounded-card-lg" },
  },
  defaultVariants: { shadow: "none", radius: "card" },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, shadow, radius, ...props }, ref) => (
    <div
      ref={ref}
      // pb-primitives.css: hard/lg are pieces; a plain card nested in a piece
      // is print; the three radii are 8, 12 and 16px.
      data-ui-card=""
      data-shadow={shadow ?? "none"}
      data-radius={radius ?? "card"}
      className={cn(cardVariants({ shadow, radius }), className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export { cardVariants };
