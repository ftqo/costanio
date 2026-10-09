import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LocationDial, cardRowWidth } from "./LocationDial";
import type { LocationAction } from "@/lib/locationActions";

// jsdom has no layout, so nothing here asserts geometry. What is tested is
// structural: one seat per roster entry, in rank order, carrying its status,
// and a readout that is never empty.

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

const action = (over: Partial<LocationAction> & { id: string }): LocationAction => ({
  rank: 1,
  label: over.id,
  seatLabel: over.id,
  status: "ready",
  ...over,
});

const KNIGHT: LocationAction[] = [
  action({ id: "activate_knight", rank: 1, label: "Activate", seatLabel: "Activate" }),
  action({
    id: "promote_knight",
    rank: 2,
    label: "Promote to strength 2",
    seatLabel: "Strength 2",
    status: "short",
    cost: { 3: 1, 5: 1 },
    missing: [5],
    reason: "You need 1 more ore.",
  }),
  action({
    id: "move_knight",
    rank: 3,
    label: "Move",
    seatLabel: "Move",
    status: "blocked",
    reason: "Activate this knight first.",
  }),
  action({
    id: "chase_robber",
    rank: 4,
    label: "Chase robber",
    seatLabel: "Chase robber",
    status: "blocked",
    reason: "The robber is not next to this knight.",
  }),
];

const THUMBS = { build_settlement: "data:image/png;base64,SETTLEMENT" };

function render(actions: LocationAction[], onChoose = vi.fn()) {
  act(() => {
    root.render(
      <LocationDial
        actions={actions}
        at={{ x: 100, y: 100 }}
        thumbs={THUMBS}
        onChoose={onChoose}
        onClose={() => {}}
      />,
    );
  });
  return onChoose;
}

const seats = () => [...document.querySelectorAll<HTMLElement>("[data-seat]")];
const readout = () => document.querySelector("[data-readout]")?.textContent ?? "";
const focus = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
const click = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

describe("LocationDial", () => {
  it("draws one seat per roster entry, in rank order", () => {
    render(KNIGHT);
    expect(seats().map((s) => s.dataset.action)).toEqual([
      "activate_knight",
      "promote_knight",
      "move_knight",
      "chase_robber",
    ]);
  });

  it("draws one card per entry and no more", () => {
    render(KNIGHT.slice(0, 3));
    expect(seats()).toHaveLength(3);
  });

  it("carries each entry's status onto its seat", () => {
    render(KNIGHT);
    expect(seats().map((s) => s.dataset.status)).toEqual(["ready", "short", "blocked", "blocked"]);
  });

  it("clears the label when the pointer leaves", () => {
    // The focus must clear, or a menu pointed at once keeps describing that
    // card for as long as it stays open.
    render(KNIGHT);
    focus(seats()[0]);
    expect(document.querySelector("[data-readout]")).not.toBeNull();
    act(() => {
      document
        .querySelector("[data-cards]")!
        .dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(document.querySelector("[data-readout]")).toBeNull();
  });

  it("shows no label until a card is hovered", () => {
    // A card is its own label, so no prose until one is pointed at, and the
    // readout never describes the spot itself, which the player can see.
    render(KNIGHT);
    expect(document.querySelector("[data-readout]")).toBeNull();
    focus(seats()[0]);
    expect(readout()).toContain("Activate");
  });

  it("shows the focused entry's full label and its reason", () => {
    render(KNIGHT);
    focus(seats()[2]);
    expect(readout()).toContain("Move");
    expect(readout()).toContain("Activate this knight first.");
  });

  it("shows the full label on a seat whose short label was abbreviated", () => {
    render(KNIGHT);
    focus(seats()[1]);
    expect(readout()).toContain("Promote to strength 2");
    expect(readout()).toContain("You need 1 more ore.");
  });

  it("commits a ready seat", () => {
    const onChoose = render(KNIGHT);
    click(seats()[0]);
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0][0].id).toBe("activate_knight");
  });

  it("explains instead of committing a short or blocked seat", () => {
    // The click asks "why not?"; answering locally beats a round trip to an
    // error frame.
    const onChoose = render(KNIGHT);
    click(seats()[1]);
    click(seats()[2]);
    expect(onChoose).not.toHaveBeenCalled();
    expect(readout()).toContain("Activate this knight first.");
  });

  it("shows the focused entry's cost in the readout, not on the seat", () => {
    // The card is hotbar-tile sized with no room for a price; like the hotbar,
    // the recipe shows on hover, in the readout.
    render(KNIGHT);
    expect(seats()[1].querySelectorAll("[data-res]")).toHaveLength(0);
    focus(seats()[1]);
    const chips = [...document.querySelectorAll<HTMLElement>("[data-readout] [data-res]")];
    expect(chips.map((c) => c.dataset.res)).toEqual(["3", "5"]);
  });

  it("draws no cost for a costless mode entry", () => {
    render(KNIGHT);
    focus(seats()[2]);
    expect(document.querySelectorAll("[data-readout] [data-res]")).toHaveLength(0);
  });

  it("draws a placement seat as the hotbar piece card", () => {
    // The settlement art already says what it is; no extra number or word.
    render([
      action({ id: "build_settlement", label: "Build settlement", seatLabel: "Settlement" }),
    ]);
    const img = seats()[0].querySelector("img");
    expect(img?.getAttribute("src")).toBe(THUMBS.build_settlement);
    expect(seats()[0].textContent).toBe("");
  });

  it("names every card, including picture-only faces", () => {
    // The art is alt="" and the readout isn't tied to the card, so a piece
    // card needs its own name.
    render([
      action({ id: "build_settlement", label: "Build settlement", seatLabel: "Settlement" }),
      ...KNIGHT,
    ]);
    const names = seats().map((s) => s.getAttribute("aria-label"));
    expect(names[0]).toBe("Build settlement");
    expect(names[1]).toBe("Activate");
    // A card that will not act says why, as the readout would.
    expect(names[2]).toBe("Promote to strength 2. You need 1 more ore.");
    expect(names[3]).toBe("Move. Activate this knight first.");
  });

  it("leaves a card blank until its render lands, keeping its name", () => {
    // No render for activate_knight in THUMBS, as before the shot resolves or
    // without WebGL: no word stands in for the art, and the card is still
    // named for assistive tech.
    render(KNIGHT);
    expect(seats()[0].querySelector("img")).toBeNull();
    expect(seats()[0].textContent).toBe("");
    expect(seats()[0].getAttribute("aria-label")).toBe("Activate");
  });
});

describe("a reason that does not fit leaves the cards alone", () => {
  // The readout reserves one label line and two reason lines, measured in
  // English, but translations wrap differently and the excess must not spill
  // onto the cards. jsdom has no layout, so this asserts the two rules instead:
  // the reserved height is a floor that grows upward (the slot is
  // bottom-aligned), and the reason is clamped so growth is bounded.
  const panel = () => document.querySelector("[data-readout]") as HTMLElement;
  const reason = () => panel().querySelector("[class*='line-clamp']") as HTMLElement;

  it("reserves the readout's height as a minimum, never as a cap", () => {
    render(KNIGHT);
    focus(seats()[2]);
    expect(panel().className).toContain("min-h-full");
    // `h-full` would make the reserve a cap, overflowing onto the card row.
    expect(panel().className).not.toMatch(/(^|\s)h-full(\s|$)/);
  });

  it("clamps the reason, and nothing overrides the clamp's display", () => {
    render(KNIGHT);
    focus(seats()[2]);
    const cls = reason().className;
    expect(cls).toContain("line-clamp-3");
    // The clamp makes the span a `-webkit-box`; a `block` utility alongside it
    // comes later in Tailwind's layer and would disable the clamp.
    expect(cls).not.toMatch(/(^|\s)(block|flex|inline-block|grid)(\s|$)/);
  });
});

describe("cardRowWidth", () => {
  it("grows only sideways as the roster grows", () => {
    // The only geometry left in the component. placeAbove centres the whole
    // box on the click, so one card and four point at the same spot.
    expect(cardRowWidth(2)).toBeGreaterThan(cardRowWidth(1));
    expect(cardRowWidth(4)).toBeGreaterThan(cardRowWidth(2));
  });
});

describe("unaffordable entries", () => {
  it("greys a short card as heavily as a blocked one", () => {
    // Both are "not now", so both are grey; full-colour art reads as available.
    render(KNIGHT);
    const dim = (el: HTMLElement) => el.querySelector("[data-dim]")?.getAttribute("data-dim");
    expect(dim(seats()[1])).toBe("true");
    expect(dim(seats()[2])).toBe("true");
    expect(dim(seats()[0])).toBeUndefined();
  });
});

describe("piece art and action badges", () => {
  const THUMBS2 = {
    build_knight: "K1",
    build_knight_strong: "K2",
    build_knight_mighty: "K3",
    activate_knight: "SWORD",
  };
  const render2 = (actions: LocationAction[]) =>
    act(() => {
      root.render(
        <LocationDial
          actions={actions}
          at={{ x: 100, y: 100 }}
          thumbs={THUMBS2}
          onChoose={() => {}}
          onClose={() => {}}
        />,
      );
    });
  const art = (el: HTMLElement) => el.querySelector("img")?.getAttribute("src");
  const badge = (el: HTMLElement) => el.querySelector("[data-badge]")?.getAttribute("data-badge");

  it("shows the promoted knight on a promote", () => {
    // The card shows the knight tier the ore and sheep buy. The tier comes from
    // the action's `art`, not parsed off the (translated) label.
    render2([
      action({
        id: "promote_knight",
        label: "Promote to strength 2",
        seatLabel: "Strength 2",
        art: "build_knight_strong",
      }),
    ]);
    expect(art(seats()[0])).toBe("K2");
    expect(badge(seats()[0])).toBe("upgrade");
  });

  it("shows the mighty knight when promoting a strong one", () => {
    render2([
      action({
        id: "promote_knight",
        label: "Promote to strength 3",
        seatLabel: "Strength 3",
        art: "build_knight_mighty",
      }),
    ]);
    expect(art(seats()[0])).toBe("K3");
  });

  it("shows the gold sword for Activate", () => {
    render2([action({ id: "activate_knight", label: "Activate", seatLabel: "Activate" })]);
    expect(art(seats()[0])).toBe("SWORD");
  });

  it("badges a move", () => {
    render2([action({ id: "move_knight", label: "Move", seatLabel: "Move" })]);
    expect(art(seats()[0])).toBe("K1");
    expect(badge(seats()[0])).toBe("move");
  });

  it("leaves a plain build unbadged", () => {
    render2([
      action({ id: "build_settlement", label: "Build settlement", seatLabel: "Settlement" }),
    ]);
    expect(badge(seats()[0])).toBeUndefined();
  });
});

/** A tap as a pointer of this type makes it: down, enter, then the click. */
function tapAs(el: Element, pointerType: string) {
  for (const type of ["pointerdown", "pointerover", "pointerenter"]) {
    const e = new MouseEvent(type, { bubbles: type !== "pointerenter" });
    Object.defineProperty(e, "pointerType", { value: pointerType });
    act(() => {
      el.dispatchEvent(e);
    });
  }
  act(() => (el as HTMLElement).click());
}

const MOVE_SHIP: LocationAction[] = [
  action({ id: "move_ship", label: "Move the ship here", seatLabel: "Ship" }),
];

describe("a one-card confirm on touch takes two taps", () => {
  // On a phone the tap that focuses the card would also commit it, so a
  // one-card menu takes two taps: the first shows the label, the second commits.
  it("shows the label on the first tap and commits on the second", () => {
    const onChoose = render(MOVE_SHIP);
    const card = seats()[0];
    tapAs(card, "touch");
    expect(onChoose).not.toHaveBeenCalled();
    const readout = document.querySelector("[data-readout]");
    expect(readout?.textContent).toContain("Move the ship here");
    expect(readout?.textContent).toContain("Tap again to confirm");
    tapAs(card, "touch");
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0][0].id).toBe("move_ship");
  });

  it("runs a mode-arming entry on the first tap", () => {
    // "Move ship" off the inspect menu arms and sends nothing; the destination
    // tap that follows commits and confirms on its own.
    const onChoose = render([
      action({ id: "move_ship", label: "Move ship", seatLabel: "Move ship", arms: true }),
    ]);
    tapAs(seats()[0], "touch");
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-readout]")?.textContent ?? "").not.toContain(
      "Tap again to confirm",
    );
  });

  it("a mouse still commits on the first click", () => {
    const onChoose = render(MOVE_SHIP);
    tapAs(seats()[0], "mouse");
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it("a key press commits on the first press", () => {
    const onChoose = render(MOVE_SHIP);
    const card = seats()[0];
    act(() => card.focus());
    expect(document.querySelector("[data-readout]")?.textContent).toContain("Move the ship here");
    act(() => card.click()); // Enter or Space on a button: a click with no pointer
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it("a multi-card menu commits on the first tap", () => {
    const onChoose = render([
      action({ id: "build_road", label: "Build road", seatLabel: "Road" }),
      action({ id: "build_ship", label: "Build ship", seatLabel: "Ship" }),
    ]);
    tapAs(seats()[1], "touch");
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0][0].id).toBe("build_ship");
  });

  it("announces the prompt to a screen reader", () => {
    render(MOVE_SHIP);
    tapAs(seats()[0], "touch");
    const live = document.querySelector("[aria-live]");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.textContent).toContain("Tap again to confirm");
  });

  it("a tap elsewhere cancels the pending confirm", () => {
    const onClose = vi.fn();
    const onChoose = vi.fn();
    act(() => {
      root.render(
        <LocationDial
          actions={MOVE_SHIP}
          at={{ x: 100, y: 100 }}
          thumbs={THUMBS}
          onChoose={onChoose}
          onClose={onClose}
        />,
      );
    });
    tapAs(seats()[0], "touch");
    act(() => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });
});
