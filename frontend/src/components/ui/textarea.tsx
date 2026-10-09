import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClasses } from "@/components/ui/input";

// The multi-line twin of Input, on the same well (see fieldClasses).
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    data-ui-input=""
    className={cn(fieldClasses, "resize-y", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";
