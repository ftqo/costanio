import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A single-select tab strip in the track look: the joined Segmented's flat
 * well with the chosen tab as the selected-yellow tile, for groups with too
 * many options to sit in one equal-width capsule (rulesets, rules tabs,
 * playback speeds). It wraps where the Segmented capsule cannot.
 *
 * `data-ui-seg` puts it under the same Punchboard rules as the Segmented
 * capsule (print: no keyline, no edge).
 */
export function TrackTabs<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className,
  optionClassName,
}: {
  options: { label: React.ReactNode; value: T; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  /** The group's accessible name. */
  label?: string;
  size?: "sm" | "md";
  className?: string;
  /** Extra classes for every option (layout only: a touch-size floor). */
  optionClassName?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-ui-seg=""
      data-track-tabs=""
      className={cn("inline-flex flex-wrap gap-0.5 rounded-control bg-panel p-1", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg font-semibold cursor-pointer transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active ? "bg-selected text-selected-ink" : "text-muted hover:text-foreground",
              optionClassName,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
