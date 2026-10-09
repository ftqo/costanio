import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const iconButtonVariants = cva(
  // A round control on the panel fill with a 1px rim and soft lift. Shares the
  // button's site hover through `data-ui-button`; no press.
  "inline-flex items-center justify-center shrink-0 border border-border bg-secondary-background text-foreground rounded-full cursor-pointer shadow-hard-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: { size: { sm: "h-7 w-7", md: "h-9 w-9" } },
    defaultVariants: { size: "md" },
  },
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {
  asChild?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        data-ui-button=""
        data-variant="secondary"
        className={cn(iconButtonVariants({ size }), className)}
        {...props}
      />
    );
  },
);
IconButton.displayName = "IconButton";

export { iconButtonVariants };
