import { test, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Tip } from "./Tip";

// The three slots are ordered: a standing fact ("11 left in the deck", what the
// next level grants) is a header above the name and price; only the
// conditional hint hangs below.

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function open(node: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  const trigger = host.querySelector("span")!;
  // React synthesizes onPointerEnter from a bubbling `pointerover`, so that is
  // the event a hover has to arrive as here.
  act(() => {
    trigger.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return document.body.querySelector('[role="tooltip"]') as HTMLElement;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

test("the note sits above the title, the hint below it", () => {
  const text =
    open(
      <Tip title="Development Card" note="11 left in the deck" hint="Costs 3 resources">
        <span>hover me</span>
      </Tip>,
    ).textContent ?? "";
  expect(text.indexOf("11 left in the deck")).toBeLessThan(text.indexOf("Development Card"));
  expect(text.indexOf("Development Card")).toBeLessThan(text.indexOf("Costs 3 resources"));
});

test("no note, no band", () => {
  const tip = open(
    <Tip title="Road">
      <span>hover me</span>
    </Tip>,
  );
  expect(tip.textContent).toBe("Road");
});

// A tap focuses the trigger as a side effect, and with no pointer to leave the
// tip would never close. A focus arriving with a press is that press; a focus
// arriving on its own is a keyboard user and still shows the tip.
test("focus from a press shows nothing", () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Tip title="Road">
        <span>press me</span>
      </Tip>,
    ),
  );
  const trigger = host.querySelector("span")!;
  act(() => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
    trigger.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
});

test("keyboard focus shows the tip", () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Tip title="Road">
        <span>tab to me</span>
      </Tip>,
    ),
  );
  const trigger = host.querySelector("span")!;
  act(() => {
    trigger.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe("Road");
});

// A dialog focuses its first control on open; on a phone that is not a
// keyboard user, so no tip should open over the dialog.
test("without hover, only Tab focus shows the tip", () => {
  const mm = window.matchMedia;
  window.matchMedia = ((q: string) => ({
    matches: q === "(hover: none)",
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  try {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <Tip title="Spy">
          <span>first card</span>
        </Tip>,
      ),
    );
    const trigger = host.querySelector("span")!;
    act(() => {
      trigger.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    act(() => {
      trigger.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
      trigger.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe("Spy");
  } finally {
    window.matchMedia = mm;
  }
});

// Tab stops and names. Tip must not make a tab stop of every child (most
// triggers are non-interactive spans with `outline-none`, giving stops with no
// role, name or ring, one per card name in the event log), and it must name
// icon-only triggers: `aria-describedby` is not a name and is only present while
// the tip is open.

function mount(node: React.ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

test("a plain span is left out of the tab order", () => {
  const el = mount(
    <Tip title="Wood">
      <span>3</span>
    </Tip>,
  );
  expect(el.querySelector("span")!.hasAttribute("tabindex")).toBe(false);
});

test("`focusable` is honoured for a trigger that has a name", () => {
  const el = mount(
    <Tip title="Wood in the bank" focusable>
      <span role="img" aria-label="3 wood left in the bank">
        3
      </span>
    </Tip>,
  );
  const span = el.querySelector("span")!;
  expect(span.tabIndex).toBe(0);
  // And a visible focus ring: these triggers all set `outline-none`.
  expect(span.className).toContain("focus-visible:ring-2");
});

test("`focusable` is ignored for an unnamed trigger", () => {
  // A stop that announces nothing is not access, and many of them bury the
  // controls a player needs.
  const el = mount(
    <Tip title={<b>markup, not a name</b>} focusable>
      <span>3</span>
    </Tip>,
  );
  expect(el.querySelector("span")!.hasAttribute("tabindex")).toBe(false);
});

test("a child that set its own tabIndex keeps it", () => {
  // LogLine sets its card runs to -1 so a run takes hover but not a stop; Tip
  // must not override that.
  const el = mount(
    <Tip title="Two wood" focusable>
      <span tabIndex={-1} aria-label="Two wood">
        ww
      </span>
    </Tip>,
  );
  expect(el.querySelector("span")!.tabIndex).toBe(-1);
});

test("an icon-only button is named by its title", () => {
  const el = mount(
    <Tip title="Zoom in">
      <button type="button">
        <svg />
      </button>
    </Tip>,
  );
  expect(el.querySelector("button")!.getAttribute("aria-label")).toBe("Zoom in");
});

test("a button that has words keeps them as its name", () => {
  // Replacing a control's visible label breaks WCAG 2.5.3 (voice users name
  // the button by what they see).
  const el = mount(
    <Tip title="Ends your turn and passes the dice">
      <button type="button">End turn</button>
    </Tip>,
  );
  expect(el.querySelector("button")!.hasAttribute("aria-label")).toBe(false);
});

test("keeps a caller-supplied name", () => {
  const el = mount(
    <Tip title="Zoom in">
      <button type="button" aria-label="Zoom the board in">
        <svg />
      </button>
    </Tip>,
  );
  expect(el.querySelector("button")!.getAttribute("aria-label")).toBe("Zoom the board in");
});

// An open tip (keyboard focus or sticky tap) can outlive its viewport, e.g. a
// phone rotating. It re-reads its trigger on every resize so it stays on screen.
test("an open tip re-clamps itself when the window shrinks", () => {
  const W = { w: 1280, h: 800 };
  const trig = { left: 760, top: 700, width: 44, height: 64 };
  const tipSize = { width: 110, height: 40 };
  const rect = (x: number, y: number, w: number, h: number) =>
    ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y }) as DOMRect;
  const orig = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect")!;
  const iw = Object.getOwnPropertyDescriptor(window, "innerWidth");
  const ih = Object.getOwnPropertyDescriptor(window, "innerHeight");
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => W.w });
  Object.defineProperty(window, "innerHeight", { configurable: true, get: () => W.h });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.getAttribute("role") === "tooltip") return rect(0, 0, tipSize.width, tipSize.height);
    if (this.hasAttribute("data-trigger"))
      return rect(trig.left, trig.top, trig.width, trig.height);
    return rect(0, 0, 0, 0);
  };
  try {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <Tip title="Fleet" hint="Sail, explore, deliver">
          <span data-trigger>tile</span>
        </Tip>,
      ),
    );
    act(() => {
      host!
        .querySelector("[data-trigger]")!
        .dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    const tip = () => document.body.querySelector<HTMLElement>('[role="tooltip"]')!;
    const box = () => ({ left: parseFloat(tip().style.left), top: parseFloat(tip().style.top) });
    // Placed above the trigger, centred on it, at 1280x800.
    expect(box()).toEqual({ left: 727, top: 652 });
    // The window turns: 740x360, and the trigger reflows to the new shelf.
    W.w = 740;
    W.h = 360;
    trig.left = 700;
    trig.top = 250;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    const b = box();
    expect(b.left + tipSize.width).toBeLessThanOrEqual(740 - 6);
    expect(b.top + tipSize.height).toBeLessThanOrEqual(360 - 6);
    expect(b.top).toBe(250 - 8 - 40);
  } finally {
    Object.defineProperty(Element.prototype, "getBoundingClientRect", orig);
    if (iw) Object.defineProperty(window, "innerWidth", iw);
    if (ih) Object.defineProperty(window, "innerHeight", ih);
  }
});

// A trigger that moves or re-renders out from under the pointer never gets its
// leave, so opening a tip closes the previous one.
test("only one tip is open at a time", () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <>
        <Tip title="Wood">
          <span>a</span>
        </Tip>
        <Tip title="Brick">
          <span>b</span>
        </Tip>
      </>,
    ),
  );
  const [a, b] = Array.from(host.querySelectorAll("span"));
  act(() => {
    a.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  // No leave on `a`: the pointer's exit was never seen.
  act(() => {
    b.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const tips = document.body.querySelectorAll('[role="tooltip"]');
  expect(tips).toHaveLength(1);
  expect(tips[0].textContent).toBe("Brick");
});
