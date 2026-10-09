import * as React from "react";
import { cn } from "@/lib/utils";
import { Pill } from "./pill";

export interface SegmentedOption<T> {
  label: React.ReactNode;
  value: T;
  title?: string;
}

// A single-select pill group (turn timer, dice mode, board size, ...) with
// aria-pressed and a focus-visible ring.
//
// Two looks:
// - "pills" (default): separate pills. For roomy groups; the only variant
//   that can wrap onto multiple lines.
// - "joined": one capsule of equal-width segments with a thumb that slides to
//   the active one. For tight spaces (card headers, settings rows).
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  className,
  variant = "pills",
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  className?: string;
  variant?: "pills" | "joined";
}) {
  if (variant === "joined") {
    const idx = options.findIndex((o) => o.value === value);
    return (
      // isolate + -z-10 keeps the thumb between the capsule background and the
      // labels without going under other content.
      <div
        data-ui-seg=""
        className={cn(
          "relative isolate inline-grid grid-flow-col auto-cols-fr items-stretch",
          // A well with a 1px rim and an ink thumb. `data-ui-seg` lets the HUD
          // keep its 2px capsule (index.css, site-material block).
          "rounded-control border border-border bg-panel p-1",
          disabled && "opacity-60",
          className,
        )}
      >
        <span
          aria-hidden
          data-ui-seg-thumb=""
          className={cn(
            "absolute inset-y-1 -z-10 rounded-[calc(var(--radius-control)-3px)] bg-selected shadow-hard-sm",
            "transition-transform duration-200 ease-out motion-reduce:transition-none",
            idx < 0 && "hidden",
          )}
          // left/width place the thumb over the first equal-width segment
          // (4px = the capsule's p-1); translateX then slides it by whole
          // segments, so the switch animates on transform alone.
          style={{
            left: "4px",
            width: `calc((100% - 8px) / ${options.length})`,
            transform: `translateX(${Math.max(idx, 0) * 100}%)`,
          }}
        />
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={active}
              title={o.title}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={cn(
                // Segments abut, so the touch hit area grows only vertically:
                // 21px becomes 37px (WCAG 2.2 asks for 24).
                "relative pointer-coarse:before:absolute pointer-coarse:before:-inset-y-2 pointer-coarse:before:inset-x-0 pointer-coarse:before:content-['']",
                "rounded-control px-2.5 py-0.5 text-[12px] font-semibold text-center",
                "transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "text-selected-ink"
                  : "text-muted enabled:cursor-pointer enabled:hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className={cn("flex gap-1.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pill
            key={String(o.value)}
            interactive
            tone={active ? "active" : "neutral"}
            aria-pressed={active}
            title={o.title}
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Pill>
        );
      })}
    </div>
  );
}
