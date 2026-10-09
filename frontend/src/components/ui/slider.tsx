import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    trackClassName?: string;
    thumbSize?: number;
  }
>(({ className, trackClassName, thumbSize = 24, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    data-ui-slider=""
    className={cn("relative flex w-full touch-none select-none items-center", className)}
    {...props}
  >
    <SliderPrimitive.Track
      data-ui-slider-track=""
      className={cn(
        // A thin well; the range uses the action accent.
        "relative h-1.5 w-full grow overflow-hidden rounded-full bg-elev2",
        trackClassName,
      )}
    >
      <SliderPrimitive.Range data-ui-slider-range="" className="absolute h-full bg-toggle" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      data-ui-slider-thumb=""
      className="block rounded-full border border-border bg-secondary-background shadow-hard-sm cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ width: thumbSize, height: thumbSize }}
    />
  </SliderPrimitive.Root>
));
Slider.displayName = "Slider";
