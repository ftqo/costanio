import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Square color-pick button. The fill `color` is arbitrary data (player/cosmetic
// colors) so it stays an inline style; the border/ring use theme tokens.
const swatchVariants = cva(
  "rounded-full border border-border cursor-pointer transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    // Selected: a ring in the panel colour, then one in ink, plus the soft
    // lift. Both rings use theme tokens so it works in either theme.
    variants: {
      selected: {
        true: "shadow-[0_0_0_2px_var(--color-secondary-background),0_0_0_4px_var(--color-selected)]",
        false: "",
      },
    },
    defaultVariants: { selected: false },
  },
);

export interface SwatchProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color">,
    VariantProps<typeof swatchVariants> {
  color: string;
  size?: number;
}

export const Swatch = React.forwardRef<HTMLButtonElement, SwatchProps>(
  ({ className, color, selected, size = 28, style, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      data-ui-swatch=""
      data-selected={selected ? "true" : undefined}
      className={cn(swatchVariants({ selected }), className)}
      style={{ background: color, width: size, height: size, ...style }}
      {...props}
    />
  ),
);
Swatch.displayName = "Swatch";

export { swatchVariants };
