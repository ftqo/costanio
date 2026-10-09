import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The text-field well, shared by Input and Textarea so a form that mixes the
 * two reads as one set of fields: panel fill, 1px rim and a faint inset shade
 * so it reads as a well; focus is the ring.
 */
export const fieldClasses =
  "w-full border border-border rounded-control px-3.5 py-2.5 text-[14px] font-medium text-foreground placeholder:text-muted2 bg-secondary-background shadow-[inset_0_1px_2px_rgba(10,24,48,0.06)] focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    // pb-primitives.css: print fill, an inset focus ring, aria-invalid and disabled.
    data-ui-input=""
    className={cn(fieldClasses, className)}
    {...props}
  />
));
Input.displayName = "Input";
