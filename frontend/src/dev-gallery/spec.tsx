// Dev-only specimen framework for the style gallery (/dev/gallery). Not part
// of the shipped UI: it exists so every component can be rendered in every
// state, with real components and the real stylesheet, and screenshotted.
import * as React from "react";
import { cn } from "@/lib/utils";

/** Where a group sits: on the page ground, on a site panel, or inside the HUD. */
export type Surface = "ground" | "panel" | "hud";

/**
 * One component (or one variant of it) shown across its states. The capture
 * script screenshots each `[data-specimen]` element once per theme, so keep a
 * group to one row or a small grid that fits ~1100px wide.
 */
export function Group({
  id,
  title,
  surface = "panel",
  children,
  wide,
}: {
  /** Stable id, used as the screenshot file name: "section/component-variant". */
  id: string;
  title: string;
  surface?: Surface;
  children: React.ReactNode;
  /** Let the group take the full width (default caps at 1100px). */
  wide?: boolean;
}) {
  const body = <div className="flex flex-wrap items-start gap-x-6 gap-y-5">{children}</div>;
  return (
    <section
      data-specimen={id}
      data-title={title}
      className={cn("rounded-[12px] p-5", wide ? "w-full" : "w-fit max-w-[1100px]")}
      style={{
        background:
          surface === "ground"
            ? "var(--color-background)"
            : surface === "hud"
              ? "var(--sea)"
              : "var(--color-secondary-background)",
        // Labels follow the group's ground, not the component's own ink.
        ["--gallery-label" as string]:
          surface === "panel" ? "var(--color-foreground)" : "var(--color-on-background)",
      }}
    >
      <div
        className="mb-3 text-[13px] font-bold"
        style={{
          color: surface === "panel" ? "var(--color-foreground)" : "var(--color-on-background)",
        }}
      >
        {title}
      </div>
      {surface === "hud" ? <div className="hud-root">{body}</div> : body}
    </section>
  );
}

/**
 * One state of a component, labelled underneath. `force` asks the capture
 * script to force that CSS pseudo-class (via DevTools) on the first element
 * child, so hover/active/focus can be shown side by side with rest.
 */
export function State({
  label,
  force,
  children,
  className,
}: {
  label: string;
  force?: "hover" | "active" | "focus" | "focus-visible";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      <div data-force={force} className={className}>
        {children}
      </div>
      <div className="text-[11px] font-semibold" style={{ color: "var(--gallery-label)" }}>
        <span data-state-label>{label}</span>
      </div>
    </div>
  );
}

/** A row break inside a group. */
export function Break() {
  return <div className="basis-full h-0" />;
}
