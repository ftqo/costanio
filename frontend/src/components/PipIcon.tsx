import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The pips mark: a cut gem, drawn rather than typed.
 *
 * The same diamond silhouette as the `◆` glyph players know, with crown and
 * pavilion facets and a sweeping specular bar so it reads as a stone at 16px.
 *
 * Every fill but the highlight is `currentColor`, so it takes the surrounding
 * text colour; a fixed amber vanishes on the page ground (see `Pips` in
 * routes/Store.tsx).
 *
 * Sized in `em` to match adjacent text; `size` overrides it.
 */
export function PipIcon({ size, className }: { size?: string | number; className?: string }) {
  // The clip path needs a document-unique id, since a page can show several.
  const clip = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      width={size ?? "1em"}
      height={size ?? "1em"}
      // Nudge the 1em box up from the baseline to sit level with the digits.
      className={cn("inline-block align-[-0.125em]", className)}
      // Decorative: callers provide the number and label.
      aria-hidden="true"
      focusable="false"
    >
      <clipPath id={clip}>
        <path d="M12 2.4 20.6 12 12 21.6 3.4 12Z" />
      </clipPath>
      <path d="M12 2.4 20.6 12 12 21.6 3.4 12Z" fill="currentColor" opacity=".9" />
      <g clipPath={`url(#${clip})`}>
        <path d="M12 2.4 20.6 12 12 12Z" fill="currentColor" />
        <path d="M3.4 12 12 12 12 21.6Z" fill="currentColor" opacity=".55" />
        {/* The bar's fill comes from `.pip-gem-sweep` in index.css (a
            specular, not currentColor), clipped to the silhouette. */}
        {/* The tilt is on this wrapper because a CSS `transform` on the bar
            would replace its SVG `transform` attribute. */}
        <g transform="rotate(18 12 12)">
          <rect className="pip-gem-sweep" x="8" y="-4" width="4.5" height="32" opacity=".55" />
        </g>
      </g>
    </svg>
  );
}
