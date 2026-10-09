import { test, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { HudTopRow } from "./HudLayer";

/**
 * The turn banner's placement, asserted on the grid rules rather than pixels
 * (jsdom's rects are all zero; real pixels are a Playwright job). Three rules:
 *
 *  1. All three islands are on one line at every width, with no breakpoint.
 *  2. The pill shares grid row 1 and `items-start` top-aligns each island, so
 *     a wrapping island grows downward instead of moving the pill.
 *  3. The side tracks have a `min-content` floor and the middle doesn't, so a
 *     long seat name truncates the pill rather than sliding the orbs under it.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

function renderRow() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() =>
    root.render(
      <HudTopRow
        left={<button data-slot="left">left</button>}
        center={<div data-slot="center">center</div>}
        right={<button data-slot="right">right</button>}
      />,
    ),
  );
  const slotOf = (name: string) => el.querySelector(`[data-slot="${name}"]`)!.parentElement!;
  return {
    el,
    row: el.firstElementChild as HTMLElement,
    left: slotOf("left"),
    center: slotOf("center"),
    right: slotOf("right"),
  };
}

test("the three islands share one line at every width", () => {
  const { row, left, center, right } = renderRow();

  // No slot places itself on a row or column at any breakpoint: the three
  // columns take them in source order in one row. A `row-start-2` (or a
  // `min-[...]` variant) would bring back the stacked layout.
  for (const slot of [left, center, right]) {
    expect(slot.className).not.toMatch(/row-start-/);
    expect(slot.className).not.toMatch(/col-start-|col-span-/);
  }

  // The row names exactly one `grid-cols-*` template, with no breakpoint. (The
  // row does carry an `sm:` class, the shared `--hud-inset` from HudCluster, so
  // this checks the grid classes only.)
  const gridCols = row.className.split(/\s+/).filter((c) => c.includes("grid-cols-"));
  expect(gridCols).toEqual([
    "grid-cols-[minmax(min-content,1fr)_minmax(0,auto)_minmax(min-content,1fr)]",
  ]);
});

test("aligns each island to the top of the row", () => {
  const { row } = renderRow();
  // `items-start` keeps the pill's top edge at the row's top while an island
  // wraps; otherwise every slot stretches to the row height.
  expect(row.className).toContain("items-start");
});

test("only the pill's track shrinks below min-content", () => {
  const { row, center, left, right } = renderRow();

  // The side tracks can't be squeezed below their content: the right island is
  // `justify-self-end` and doesn't wrap, so with `minmax(0,1fr)` a long seat
  // name pushed the orbs under the pill. The two `1fr`s still resolve equal
  // when there is room, keeping the middle track centred.
  expect(row.className).toContain("minmax(min-content,1fr)_minmax(0,auto)_minmax(min-content,1fr)");
  expect(right.className).toContain("justify-self-end");

  // The middle track's `minmax(0,...)` is half of "the pill yields"; the other
  // half is its slot stretching to the track (the default). A
  // `justify-self-center` item would keep its full width and hang over both
  // islands.
  expect(center.className).not.toMatch(/justify-self-/);

  // Every slot may be narrower than its contents; otherwise the automatic
  // minimum floors each at min-content.
  for (const slot of [left, center, right]) {
    expect(slot.className).toContain("min-w-0");
  }
});

test("the row is click-through and each island opts back in", () => {
  const { row, left, center, right } = renderRow();
  // The row spans the whole width, so it would otherwise swallow board drags
  // along the top edge.
  expect(row.className).toContain("pointer-events-none");
  for (const slot of [left, center, right]) {
    expect(slot.className).toContain("*:pointer-events-auto");
  }
});
