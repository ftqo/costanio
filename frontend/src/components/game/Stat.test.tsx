import { test, expect, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Stat, Award } from "./Stat";

// `role="img"` is a leaf role: with a name set, nothing inside is announced.
// So Stat folds its scalar `value` into the name, and Award must fold its
// `label` (the island bonus's `+3` and the like) or the figure is never read.

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(node: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
});

const chip = (el: HTMLElement) => el.querySelector<HTMLElement>('[role="img"]')!;

test("announces an award's figure", () => {
  const el = mount(
    <Award icon={<svg />} label="+3" title="Island victory points" name="islands" />,
  );
  expect(chip(el).getAttribute("aria-label")).toBe(
    "Island victory points (+3): held by this player",
  );
});

test("announces an empty slot", () => {
  const el = mount(
    <Award icon={<svg />} label="+3" title="Island victory points" held={false} name="islands" />,
  );
  expect(chip(el).getAttribute("aria-label")).toBe(
    "Island victory points (+3): not held by this player",
  );
});

test("an icon-only award is unchanged", () => {
  // The named bonuses have no figure, so their names are unchanged.
  const el = mount(<Award icon={<svg />} title="Longest Road" name="road" />);
  expect(chip(el).getAttribute("aria-label")).toBe("Longest Road: held by this player");
});

test("a named chip is focusable and shows focus", () => {
  // Tip gives a tab stop only where there is a name to announce and a ring to
  // see; these chips ask for one.
  const el = mount(<Stat icon={<svg />} value={3} title="Knights" />);
  expect(chip(el).tabIndex).toBe(0);
  expect(chip(el).getAttribute("aria-label")).toBe("Knights: 3");
  expect(chip(el).className).toContain("focus-visible:ring-2");
});

test("a nameless chip is not a tab stop", () => {
  // `title` is markup and no `srTitle` was given, so there is nothing to
  // announce; better skipped than reached.
  const el = mount(<Stat icon={<svg />} value={3} title={<b>Knights</b>} />);
  expect(el.querySelector('[role="img"]')).toBeNull();
  expect(el.querySelector("span")!.hasAttribute("tabindex")).toBe(false);
});
