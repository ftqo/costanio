import * as React from "react";
import { Link } from "@tanstack/react-router";
import { inActivityMode } from "@/lib/activity";
import { cn } from "@/lib/utils";

/**
 * The COSTAN.IO wordmark. On the web it links to the homepage; in the Discord
 * Activity there is no homepage, so it renders as identically styled text.
 *
 * Memoised: callers pass a literal className, so it does not re-render with
 * the game screen on every socket frame.
 */
export const BrandPill = React.memo(function BrandPill({ className }: { className?: string }) {
  // Always the wordmark face (Dela via --font-wordmark), whatever else the
  // caller sets, so the header, footer, loading pill and bare uses agree.
  const cls = cn("font-wordmark", className);
  if (inActivityMode()) return <span className={cls}>COSTAN.IO</span>;
  return (
    <Link to="/" className={cls}>
      COSTAN.IO
    </Link>
  );
});
