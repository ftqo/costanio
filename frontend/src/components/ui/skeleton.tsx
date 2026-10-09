import { cn } from "@/lib/utils";

/**
 * A shimmering placeholder that holds a list or card's shape while data loads,
 * avoiding layout shift. Size and radius come from `className`. Decorative
 * (aria-hidden); the container carries role=status.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      data-ui-skeleton=""
      className={cn("animate-pulse rounded-base bg-elev2", className)}
    />
  );
}
