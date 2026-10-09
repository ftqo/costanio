import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    data-ui-switch=""
    className={cn(
      // 38x22 visually. On touch pointers a pseudo-element grows the hit area
      // to 54x38 without drawing anything.
      "pointer-coarse:relative pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']",
      // No outline. Off is a well; on is the accent.
      "peer inline-flex h-5.5 w-9.5 shrink-0 cursor-pointer items-center rounded-full transition-colors data-[state=checked]:bg-toggle data-[state=unchecked]:bg-elev2 data-[state=unchecked]:shadow-[inset_0_0_0_1px_var(--color-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      data-ui-switch-thumb=""
      className="pointer-events-none block h-4.5 w-4.5 rounded-full bg-toggle-thumb shadow-[0_1px_2px_rgba(10,24,48,0.3)] transition-transform data-[state=checked]:translate-x-4.5 data-[state=unchecked]:translate-x-0.5"
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
