import { CircleNotch } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * The app's loading spinner, a muted spinning CircleNotch. Pass `label` to
 * announce it as a live status (role=status); without one it is decorative
 * (aria-hidden), for use next to visible "Loading..." text.
 */
export function Spinner({
  size = 20,
  className,
  label,
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <CircleNotch
      weight="bold"
      size={size}
      className={cn("animate-spin text-muted shrink-0", className)}
      // pb-primitives.css gives it the ink in both the site and the HUD.
      data-ui-spinner=""
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
