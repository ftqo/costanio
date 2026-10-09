import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Menu, MenuItem } from "./menu";

// The site header's avatar dropdown. Rows must activate from the keyboard, so
// each test dispatches a real key event and checks the handler fired; a row
// existing or having tabIndex is not enough.

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

function render(ui: React.ReactElement) {
  act(() => root.render(ui));
}

const triggerBtn = () => host.querySelector<HTMLButtonElement>("button[aria-haspopup]")!;
const items = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function key(el: Element, k: string, opts: KeyboardEventInit = {}) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...opts }));
  });
}

function open(children: React.ReactNode) {
  render(<Menu trigger="Account">{children}</Menu>);
  click(triggerBtn());
}

/**
 * A press outside the menu: `pointerdown` on a real target, since dismissal
 * checks whether the target is inside the menu's root.
 */
function pressOutside(el: Element = document.body) {
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
}

/**
 * A keypress plus the activation a browser would perform for it.
 *
 * jsdom does not turn Enter or Space on a focused button into a click, so that
 * rule is modelled here: a click follows only if the focused element is one
 * the browser activates for that key. A `<div role="menuitem">` gets only the
 * keydown, so a regression to a div fails these tests.
 */
function press(el: HTMLElement, k: string) {
  key(el, k);
  const tag = el.tagName;
  const activates =
    (tag === "BUTTON" && (k === "Enter" || k === " ")) ||
    (tag === "A" && (el as HTMLAnchorElement).href !== "" && k === "Enter") ||
    (tag === "INPUT" && k === "Enter");
  if (activates) click(el);
}

describe("MenuItem activation", () => {
  it("renders as a native button", () => {
    // The element type is what makes the keys work.
    open(<MenuItem onSelect={() => {}}>Store</MenuItem>);
    const row = items()[0];
    expect(row.tagName).toBe("BUTTON");
    expect((row as HTMLButtonElement).type).toBe("button");
  });

  it("fires onSelect from Enter on the focused row", () => {
    const onSelect = vi.fn();
    open(<MenuItem onSelect={onSelect}>Store</MenuItem>);
    const row = items()[0];
    row.focus();
    press(row, "Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(items()).toHaveLength(0); // and the menu closed behind it
  });

  it("fires onSelect from Space on the focused row", () => {
    const onSelect = vi.fn();
    open(<MenuItem onSelect={onSelect}>Settings</MenuItem>);
    const row = items()[0];
    row.focus();
    press(row, " ");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("keeps the menu open for a keepOpen row", () => {
    const onSelect = vi.fn();
    open(
      <MenuItem keepOpen onSelect={onSelect}>
        Dark mode
      </MenuItem>,
    );
    press(items()[0], "Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(items()).toHaveLength(1);
  });

  it("clones an asChild anchor instead of wrapping it", () => {
    const onSelect = vi.fn();
    open(
      <MenuItem asChild onSelect={onSelect}>
        <a href="/store">Store</a>
      </MenuItem>,
    );
    const row = items()[0];
    expect(row.tagName).toBe("A");
    press(row, "Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("Menu keyboard navigation", () => {
  const three = (
    <>
      <MenuItem onSelect={() => {}}>One</MenuItem>
      <MenuItem onSelect={() => {}}>Two</MenuItem>
      <MenuItem onSelect={() => {}}>Three</MenuItem>
    </>
  );

  it("moves focus down and up between rows, wrapping at both ends", () => {
    open(three);
    const [a, b, c] = items();
    a.focus();
    key(a, "ArrowDown");
    expect(document.activeElement).toBe(b);
    key(b, "ArrowDown");
    expect(document.activeElement).toBe(c);
    key(c, "ArrowDown");
    expect(document.activeElement).toBe(a);
    key(a, "ArrowUp");
    expect(document.activeElement).toBe(c);
  });

  it("jumps to the ends with Home and End", () => {
    open(three);
    const [a, , c] = items();
    a.focus();
    key(a, "End");
    expect(document.activeElement).toBe(c);
    key(c, "Home");
    expect(document.activeElement).toBe(a);
  });

  it("opens on ArrowDown at the trigger", () => {
    render(
      <Menu trigger="Account">
        <MenuItem onSelect={() => {}}>One</MenuItem>
      </Menu>,
    );
    expect(items()).toHaveLength(0);
    key(triggerBtn(), "ArrowDown");
    expect(items()).toHaveLength(1);
  });

  it("points aria-controls at the open list and drops it when closed", () => {
    open(<MenuItem onSelect={() => {}}>One</MenuItem>);
    const id = triggerBtn().getAttribute("aria-controls")!;
    expect(id).toBeTruthy();
    expect(document.getElementById(id)!.getAttribute("role")).toBe("menu");
    expect(triggerBtn().getAttribute("aria-expanded")).toBe("true");
    click(triggerBtn());
    expect(triggerBtn().getAttribute("aria-controls")).toBeNull();
  });
});

// Focus after the panel closes. Escape and choosing a row return focus to the
// trigger, matching LanguagePicker.
describe("Menu focus", () => {
  const three = (
    <>
      <MenuItem onSelect={() => {}}>One</MenuItem>
      <MenuItem onSelect={() => {}}>Two</MenuItem>
      <MenuItem onSelect={() => {}}>Three</MenuItem>
    </>
  );

  it("returns focus to the trigger when Escape closes the menu", () => {
    open(three);
    const row = items()[0];
    row.focus();
    key(row, "Escape");
    expect(items()).toHaveLength(0);
    expect(document.activeElement).toBe(triggerBtn());
  });

  it("returns focus to the trigger when a row is chosen", () => {
    const onSelect = vi.fn();
    open(<MenuItem onSelect={onSelect}>Store</MenuItem>);
    const row = items()[0];
    row.focus();
    press(row, "Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(triggerBtn());
  });

  it("leaves focus alone when a press outside closes the menu", () => {
    // Focus is already moving where the player chose; do not pull it back.
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    open(three);
    elsewhere.focus();
    pressOutside(elsewhere);
    expect(items()).toHaveLength(0);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("closes when focus leaves the menu entirely", () => {
    // Tabbing out closes the panel.
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    open(three);
    items()[0].focus();
    expect(items()).toHaveLength(3);
    act(() => elsewhere.focus());
    expect(items()).toHaveLength(0);
    elsewhere.remove();
  });

  it("does not close when focus moves between its own rows", () => {
    open(three);
    const [a, b] = items();
    a.focus();
    act(() => b.focus());
    expect(items()).toHaveLength(3);
  });
});

// ArrowDown on the trigger opens the menu and steps into it. The key handler
// sits on the root, which contains the trigger and the panel.
describe("Menu arrow entry", () => {
  const three = (
    <>
      <MenuItem onSelect={() => {}}>One</MenuItem>
      <MenuItem onSelect={() => {}}>Two</MenuItem>
      <MenuItem onSelect={() => {}}>Three</MenuItem>
    </>
  );

  it("opens on ArrowDown and lands on the first row", () => {
    render(<Menu trigger="Account">{three}</Menu>);
    key(triggerBtn(), "ArrowDown");
    expect(document.activeElement).toBe(items()[0]);
  });

  it("opens on ArrowUp and lands on the last row", () => {
    render(<Menu trigger="Account">{three}</Menu>);
    key(triggerBtn(), "ArrowUp");
    expect(document.activeElement).toBe(items()[2]);
  });

  it("moves into a clicked-open menu on ArrowDown", () => {
    open(three);
    triggerBtn().focus();
    key(triggerBtn(), "ArrowDown");
    expect(document.activeElement).toBe(items()[0]);
  });
});

// Escape closes only the menu that has focus and stops propagation there.
// A menu closes when focus leaves it, so two cannot be open at once.
describe("Menu Escape scope", () => {
  function twoMenus() {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const two = createRoot(el);
    act(() =>
      two.render(
        <>
          <Menu trigger="A">
            <MenuItem onSelect={() => {}}>A one</MenuItem>
          </Menu>
          <Menu trigger="B">
            <MenuItem onSelect={() => {}}>B one</MenuItem>
          </Menu>
        </>,
      ),
    );
    const rows = () => Array.from(el.querySelectorAll('[role="menuitem"]'));
    const triggers = Array.from(el.querySelectorAll<HTMLButtonElement>("button[aria-haspopup]"));
    return { el, two, rows, triggers };
  }

  it("never leaves two menus open", () => {
    const { el, two, rows, triggers } = twoMenus();
    const [a, b] = triggers;
    key(a, "ArrowDown");
    expect(rows().map((r) => r.textContent)).toEqual(["A one"]);
    // Reaching B moves focus out of A, which is what puts A away.
    key(b, "ArrowDown");
    expect(rows().map((r) => r.textContent)).toEqual(["B one"]);
    act(() => two.unmount());
    el.remove();
  });

  it("stops Escape from propagating to the window", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    open(<MenuItem onSelect={() => {}}>One</MenuItem>);
    items()[0].focus();
    key(items()[0], "Escape");
    expect(items()).toHaveLength(0);
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener("keydown", seen);
  });
});
