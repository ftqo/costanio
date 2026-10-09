import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Overlay } from "./Overlay";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The dialog semantics behind about a dozen in-game pickers: role, aria-modal,
// initial focus, trap, restore, Escape.

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

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const backdrop = () => dialog().parentElement!;

function key(el: Element, k: string, opts: KeyboardEventInit = {}) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...opts }));
  });
}

describe("Overlay dialog semantics", () => {
  it("is a modal dialog labelled by its own title", () => {
    render(
      <Overlay title="Monopoly: take all of one resource">
        <button>Wood</button>
      </Overlay>,
    );
    const d = dialog();
    expect(d.getAttribute("aria-modal")).toBe("true");
    const labelledBy = d.getAttribute("aria-labelledby")!;
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy)!.textContent).toBe(
      "Monopoly: take all of one resource",
    );
  });

  it("gives two simultaneous dialogs distinct title ids", () => {
    render(
      <>
        <Overlay title="One">
          <button>a</button>
        </Overlay>
        <Overlay title="Two">
          <button>b</button>
        </Overlay>
      </>,
    );
    const ids = [...document.querySelectorAll('[role="dialog"]')].map((d) =>
      d.getAttribute("aria-labelledby"),
    );
    expect(new Set(ids).size).toBe(2);
  });

  it("takes focus on open, on the first choice rather than the panel", () => {
    // For a keyboard user (see the pointer case below for everyone else).
    key(document.body, "Tab");
    render(
      <Overlay title="Steal from…">
        <button id="first">Ana</button>
        <button id="second">Bo</button>
      </Overlay>,
    );
    expect(document.activeElement!.id).toBe("first");
  });

  it("focuses the panel itself when there is nothing to press", () => {
    // Never leave focus on the page behind the dim.
    render(
      <Overlay title="Waiting">
        <p>nothing yet</p>
      </Overlay>,
    );
    expect(document.activeElement).toBe(dialog());
  });

  it("restores focus to whatever opened it", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    render(
      <Overlay title="Year of Plenty">
        <button>Wood</button>
      </Overlay>,
    );
    expect(document.activeElement).not.toBe(trigger);

    act(() => root.render(<></>));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("does not try to restore focus to a trigger that has gone away", () => {
    // Playing a progress card removes the card you clicked, so the restore
    // target is routinely detached by the time the dialog closes.
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    render(
      <Overlay title="Spy">
        <button>card</button>
      </Overlay>,
    );
    trigger.remove();
    expect(() => act(() => root.render(<></>))).not.toThrow();
  });

  it("traps Tab inside the dialog, wrapping both ways", () => {
    render(
      <Overlay title="Commercial Harbor">
        <button id="a">a</button>
        <button id="b">b</button>
      </Overlay>,
    );
    expect(document.activeElement!.id).toBe("a");
    key(document.activeElement!, "Tab");
    expect(document.activeElement!.id).toBe("b");
    // Wrap forwards: focus must not reach the dock behind the dim.
    key(document.activeElement!, "Tab");
    expect(document.activeElement!.id).toBe("a");
    key(document.activeElement!, "Tab", { shiftKey: true });
    expect(document.activeElement!.id).toBe("b");
  });

  it("skips disabled controls when trapping", () => {
    render(
      <Overlay title="Crane">
        <button id="a">a</button>
        <button id="skip" disabled>
          skip
        </button>
        <button id="c">c</button>
      </Overlay>,
    );
    key(document.activeElement!, "Tab");
    expect(document.activeElement!.id).toBe("c");
  });
});

describe("Overlay dismissal", () => {
  it("Escape calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <Overlay title="Monopoly" onCancel={onCancel}>
        <button>Wood</button>
      </Overlay>,
    );
    key(document.activeElement!, "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("stops Escape from reaching the page", () => {
    // The game screen unwinds an armed build mode on Escape. One press must not
    // both close the dialog and disarm the mode behind it.
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    render(
      <Overlay title="Monopoly" onCancel={() => {}}>
        <button>Wood</button>
      </Overlay>,
    );
    key(document.activeElement!, "Escape");
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener("keydown", outer);
  });

  it("a forced decision swallows Escape", () => {
    // The Deserter's victim owes a knight and cannot decline (no onCancel). The
    // dialog stays, and Escape must still be consumed so it doesn't disarm the
    // build mode behind it.
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    render(
      <Overlay title="Aqueduct: take any 1 resource">
        <button>Ore</button>
      </Overlay>,
    );
    key(document.activeElement!, "Escape");
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener("keydown", outer);
  });

  it("a press on the dim backdrop dismisses", () => {
    const onCancel = vi.fn();
    render(
      <Overlay title="Trading House" onCancel={onCancel}>
        <button>Cloth</button>
      </Overlay>,
    );
    act(() => {
      backdrop().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("a press inside the panel does not dismiss", () => {
    const onCancel = vi.fn();
    render(
      <Overlay title="Trading House" onCancel={onCancel}>
        <button id="inner">Cloth</button>
      </Overlay>,
    );
    act(() => {
      document
        .getElementById("inner")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("the backdrop is inert without onCancel", () => {
    render(
      <Overlay title="Discard">
        <button>card</button>
      </Overlay>,
    );
    expect(() =>
      act(() => {
        backdrop().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      }),
    ).not.toThrow();
  });
});

/**
 * The panel's width contract, which jsdom can't measure.
 *
 * In CSS min-width wins over max-width, so `min-w-[280px] max-w-[94vw]` is not
 * a clamp: below ~320px of viewport the panel is clipped on both sides of a
 * centred flex row with no overflow, and the camel panels (15-20s clock) become
 * unplayable. Discord's narrowest panel is about 360px. Read as text because the
 * numbers are the contract.
 */
describe("panel size clamps", () => {
  const clamped = /min-w-\[min\(\d+px,\s*(?:94vw|100%)\)\]/;
  const bare = /min-w-\[\d+px\]/;

  it("clamps the dialog's own floor against the same bound as its ceiling", () => {
    render(<Overlay title="T">body</Overlay>);
    const cls = dialog().className;
    expect(cls).toContain("max-w-[94vw]");
    expect(cls, "a bare px floor beats max-w-[94vw]").not.toMatch(bare);
    expect(cls).toMatch(clamped);
  });

  // The floors that actually bite are inside the panels: each one sits within
  // the Overlay's p-5, so a 280px child floor is a ~324px border-box floor and
  // beats 94vw under about 345px of viewport.
  it.each(["CamelPlacePanel.tsx", "CamelBidPanel.tsx", "FishSpendPanel.tsx"])(
    "%s sets no unclamped pixel floor inside the dialog",
    (file) => {
      const src = readFileSync(join(__dirname, file), "utf8");
      expect(src, `${file} has a bare min-w-[Npx]; clamp it with min(Npx, 100%)`).not.toMatch(bare);
    },
  );
});

describe("Overlay height under the root zoom", () => {
  it("caps its height by the zoom-corrected viewport, not a bare 90vh", () => {
    // index.css zooms the root (0.75 on a landscape phone, 1.2 from 1700px wide)
    // and viewport units don't follow it: a bare 90vh at 1.2 is 108% of the
    // screen.
    render(
      <Overlay title="T">
        <button type="button">x</button>
      </Overlay>,
    );
    const d = document.body.querySelector('[role="dialog"]')!;
    expect(d.className).toContain("max-h-[calc(90vh/var(--ui-zoom,1))]");
    expect(d.className).not.toMatch(/(^|\s)max-h-\[90vh\]/);
  });
});

describe("Overlay footer", () => {
  it("pins the footer to the bottom of the scrolling panel", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <Overlay title="T" footer={<button type="button">Answer</button>}>
          <p>Body</p>
        </Overlay>,
      ),
    );
    const dialog = document.querySelector("[role=dialog]")!;
    const footer = dialog.querySelector<HTMLElement>("[data-overlay-footer]")!;
    expect(footer.textContent).toBe("Answer");
    expect(dialog.lastElementChild).toBe(footer);
    // Sticky at the panel's own edge: the panel has p-5, so a bottom of 0
    // would stick 20px up and let the body show through underneath.
    // The opaque fill is `hud-dialog-foot` (the solid HUD material).
    for (const c of ["sticky", "-bottom-5", "-mx-5", "-mb-5", "hud-dialog-foot"])
      expect(footer.className.split(" ")).toContain(c);
    act(() => root.unmount());
    host.remove();
  });

  it("draws no footer when none is given", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<Overlay title="T">body</Overlay>));
    expect(document.querySelector("[data-overlay-footer]")).toBeNull();
    act(() => root.unmount());
    host.remove();
  });
  it("focuses the panel when opened by a pointer", () => {
    // A dialog opened from a board press must not show a focus ring on the
    // first choice, which reads as already chosen.
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    render(
      <Overlay title="Steal from…">
        <button id="first">Ana</button>
        <button id="second">Bo</button>
      </Overlay>,
    );
    expect(document.activeElement).toBe(dialog());
    // The first Tab still lands on the first choice.
    key(dialog(), "Tab");
    expect(document.activeElement!.id).toBe("first");
    act(() => root.render(<></>));
    // And the keyboard gets the first choice straight away again.
    key(document.body, "x");
    render(
      <Overlay title="Steal from…">
        <button id="first">Ana</button>
      </Overlay>,
    );
    expect(document.activeElement!.id).toBe("first");
  });
});
