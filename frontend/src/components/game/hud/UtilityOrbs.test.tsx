import { test, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { UtilityOrbs, TopPanelOrb } from "./UtilityOrbs";
import { HudOrb } from "./HudLayer";

afterEach(() => {
  document.body.innerHTML = "";
});

function render(ui: React.ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(ui));
  return { el, root };
}

function orb(el: HTMLElement, label: string) {
  return el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

// Panel tests live with DockPanels. A control in this row acts: it reveals
// nothing, so it owns no state, and the dock's open surface is none of its
// business.
test("lays controls on one line, each independent", () => {
  let reset = 0;
  let theme = 0;
  const { el } = render(
    <UtilityOrbs>
      <HudOrb aria-label="Reset view" onClick={() => (reset += 1)} />
      <HudOrb aria-label="Toggle theme" onClick={() => (theme += 1)} />
    </UtilityOrbs>,
  );

  const row = orb(el, "Reset view").parentElement!;
  expect(row.contains(orb(el, "Toggle theme"))).toBe(true);
  expect(row.className).toContain("flex");

  act(() => orb(el, "Reset view").click());
  act(() => orb(el, "Toggle theme").click());
  act(() => orb(el, "Toggle theme").click());
  expect(reset).toBe(1);
  expect(theme).toBe(2);
  // Nothing was revealed, so nothing has to be dismissed.
  expect(orb(el, "Reset view").getAttribute("aria-pressed")).toBeNull();
});

test("a row with one control still renders it", () => {
  const { el } = render(
    <UtilityOrbs>
      <HudOrb aria-label="Reset view" />
    </UtilityOrbs>,
  );
  expect(orb(el, "Reset view")).not.toBeNull();
});

// The bank's card, hanging off the row: the one control here that reveals
// something, and only from lg (below that the panel is raised from the dock).
// The host renders nothing here at those widths, so the tests below are about
// the desktop arrangement.

function card(el: HTMLElement, label: string) {
  return el.querySelector<HTMLElement>(`div[role="group"][aria-label="${label}"]`);
}

// The card is always in the DOM: it stays laid out while closed because the
// right-hand column reserves its height either way (see TopPanelOrb).
// `visibility: hidden` takes it off screen, out of the accessibility tree and
// tab order, so the tests check that rather than whether the node exists.
function shown(el: HTMLElement, label: string) {
  const box = card(el, label);
  return !!box && box.style.visibility !== "hidden";
}

function bankRow(
  props: { pinned?: boolean; maxH?: number; onOpenChange?: (open: boolean) => void } = {},
) {
  return (
    <UtilityOrbs>
      <TopPanelOrb title="Bank" icon="B" {...props}>
        <div>BANK CARD</div>
      </TopPanelOrb>
      <HudOrb aria-label="Reset view" />
    </UtilityOrbs>
  );
}

test("the orb toggles its card, anchored to the row's right edge", () => {
  const { el } = render(bankRow());
  expect(shown(el, "Bank")).toBe(false);
  // Laid out, and inert while closed.
  expect(card(el, "Bank")!.className).toContain("pointer-events-none");

  act(() => orb(el, "Bank").click());
  expect(shown(el, "Bank")).toBe(true);
  expect(el.textContent).toContain("BANK CARD");
  expect(orb(el, "Bank").getAttribute("aria-pressed")).toBe("true");

  // `right-0` against the row, not the orb, so the card sits flush with the
  // screen's inset.
  const box = card(el, "Bank")!;
  expect(box.className).toContain("absolute");
  expect(box.className).toContain("top-full");
  expect(box.className).toContain("right-0");
  expect(box.parentElement).toBe(orb(el, "Bank").parentElement);
  expect(box.parentElement!.className).toContain("relative");

  act(() => orb(el, "Bank").click());
  expect(shown(el, "Bank")).toBe(false);
});

test("the pinned card opens itself and closes only on its own orb", () => {
  const { el } = render(bankRow({ pinned: true }));
  expect(shown(el, "Bank")).toBe(true);

  // The bank, trade rates and barbarian track are read while deciding, which
  // means pressing elsewhere; the pinned card must not close on outside
  // presses.
  act(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  expect(shown(el, "Bank")).toBe(true);

  act(() => orb(el, "Bank").click());
  expect(shown(el, "Bank")).toBe(false);
});

test("an unpinned card is a popover that ignores presses on the row", () => {
  // Between lg and 1280 the card opens by hand and dismisses like a popover,
  // but a press on a neighbouring orb is inside this cluster and mustn't close
  // it.
  const { el } = render(bankRow());
  act(() => orb(el, "Bank").click());

  act(() =>
    orb(el, "Reset view").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
  );
  expect(shown(el, "Bank")).toBe(true);

  act(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  expect(shown(el, "Bank")).toBe(false);

  act(() => orb(el, "Bank").click());
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(shown(el, "Bank")).toBe(false);
});

test("the pin follows the window in both directions", () => {
  // The pin follows the media query: a window that starts wide then narrows
  // must not keep the card open over the seat rail.
  const { el, root } = render(bankRow({ pinned: false }));
  expect(shown(el, "Bank")).toBe(false);
  act(() => root.render(bankRow({ pinned: true })));
  expect(shown(el, "Bank")).toBe(true);
  act(() => root.render(bankRow({ pinned: false })));
  expect(shown(el, "Bank")).toBe(false);
});

test("card height uses the given room or a viewport share", () => {
  // The cap is the room down to the hand shelf, measured by the host. Until
  // measured, the class is the answer; two caps on one box would conflict, so
  // the class is dropped rather than overridden.
  const { el, root } = render(bankRow({ pinned: true, maxH: 407 }));
  expect(card(el, "Bank")!.style.maxHeight).toBe("407px");
  expect(card(el, "Bank")!.style.visibility).toBe("");
  expect(card(el, "Bank")!.className).not.toContain("max-h-[60vh]");

  act(() => root.render(bankRow({ pinned: true })));
  expect(card(el, "Bank")!.style.maxHeight).toBe("");
  expect(card(el, "Bank")!.className).toContain("max-h-[60vh]");
});

// Reporting state for the barbarian rail. The card hangs down into the rail's
// column, and the two must never overlap. The game screen positions the rail
// and can't see this state, so the card reports it. See
// lib/hudChrome#barbRailRight.

test("the card reports its open state, whichever way it was opened", () => {
  const seen: boolean[] = [];
  const { el } = render(bankRow({ onOpenChange: (o) => seen.push(o) }));
  // Closed at mount, and reported: the rail must be told, not assume.
  expect(seen).toEqual([false]);

  act(() => orb(el, "Bank").click());
  expect(seen.at(-1)).toBe(true);

  act(() => orb(el, "Bank").click());
  expect(seen.at(-1)).toBe(false);
});

test("reports a card opened by the pin", () => {
  // `pinned` opens the card with no press (common on a wide window), so the
  // rail must hear about it too.
  const seen: boolean[] = [];
  render(bankRow({ pinned: true, onOpenChange: (o) => seen.push(o) }));
  expect(seen.at(-1)).toBe(true);
});

test("reports a pinned card closed by hand", () => {
  // A closed pinned card must not hold a gap beside the rail.
  const seen: boolean[] = [];
  const { el } = render(bankRow({ pinned: true, onOpenChange: (o) => seen.push(o) }));
  act(() => orb(el, "Bank").click());
  expect(seen.at(-1)).toBe(false);
});

test("the pin following the window is reported in both directions", () => {
  // `pinned` changing sets state during render; reporting to the host from
  // there would be a render-phase update of another component, so it is
  // reported from an effect.
  const seen: boolean[] = [];
  const { el, root } = render(bankRow({ pinned: false, onOpenChange: (o) => seen.push(o) }));
  expect(seen.at(-1)).toBe(false);

  act(() => root.render(bankRow({ pinned: true, onOpenChange: (o) => seen.push(o) })));
  expect(seen.at(-1)).toBe(true);
  expect(shown(el, "Bank")).toBe(true);

  act(() => root.render(bankRow({ pinned: false, onOpenChange: (o) => seen.push(o) })));
  expect(seen.at(-1)).toBe(false);
});
