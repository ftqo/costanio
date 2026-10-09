import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActiveOfferCard } from "./ActiveOfferCard";

// This card holds state and runs an effect, so React needs to know it is under
// test to flush updates inside act() quietly (as in ShapeEditor.test).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The standing trade offer, mainly the offerer's side: closing a deal picks an
// opponent, drawn as seat tiles in the seat's colour.
//
// Rendered rather than source-scanned (unlike routes/Game.pickers) because the
// point is that tapping the second tile trades with the second player.

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
});

function render(ui: React.ReactNode) {
  act(() => root.render(ui));
}

const EMPTY = [0, 0, 0, 0, 0, 0];
const seatName = (s: number) =>
  ["Ada", "Bo", "Cy", "Dee", "Eli", "Fay", "Gus", "Hal"][s] ?? `P${s}`;
const colorOf = (s: number) => `var(--seat-${s})`;

const card = (o: Partial<React.ComponentProps<typeof ActiveOfferCard>> = {}) => (
  <ActiveOfferCard
    offer={{ by: 1, give: [0, 2, 0, 0, 0, 0], want: [0, 0, 0, 0, 1, 0], ...(o.offer ?? {}) }}
    viewer={1}
    recipients={[0, 1, 2, 3]}
    // Null, so the component starts no interval (a live timer in jsdom leaks).
    deadlineMs={null}
    seatName={seatName}
    colorOf={colorOf}
    onRespond={() => {}}
    onRetract={() => {}}
    onExecute={() => {}}
    onCancel={() => {}}
    {...o}
  />
);

/** The seat tiles in the deal row, in the order they are offered. */
function tiles(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>("button")).filter(
    (b) => b.textContent !== "Cancel" && b.textContent !== "Close",
  );
}

describe("ActiveOfferCard, the offerer's side", () => {
  it("draws each responder as a named seat tile", () => {
    render(card({ offer: { by: 1, give: EMPTY, want: EMPTY, accepted: [3, 6] } }));
    expect(host.textContent).not.toContain("Deal w/");
    expect(host.textContent).toContain("Tap a player to close the deal");
    const names = tiles().map((b) => b.textContent ?? "");
    expect(names).toHaveLength(2);
    expect(names[0]).toContain("Dee");
    expect(names[1]).toContain("Gus");
  });

  it("closes the deal with the tapped seat", () => {
    // `accepted` is a list of seats; a picker reporting an index would trade
    // with seats 0 and 1 when the responders are 3 and 6. The engine takes
    // `with` as a seat.
    const onExecute = vi.fn();
    render(card({ offer: { by: 1, give: EMPTY, want: EMPTY, accepted: [3, 6] }, onExecute }));
    act(() => tiles()[1].click());
    expect(onExecute).toHaveBeenCalledWith(6);
  });

  it("carries the responder's seat colour on the tile", () => {
    // The seat is identified by its colour on its own piece.
    render(card({ offer: { by: 1, give: EMPTY, want: EMPTY, accepted: [3] } }));
    // The ring is drawn from `--pc` (SeatChoice's `.hud-pc` ink), carried on
    // the tile's button.
    const tile = tiles()[0] as HTMLElement;
    const btn = (tile.matches("button") ? tile : tile.querySelector("button")) as HTMLElement;
    expect(btn.style.getPropertyValue("--pc")).toBe("var(--seat-3)");
  });

  it("executes a counter-offer tile against the counterer", () => {
    const onExecute = vi.fn();
    render(
      card({
        offer: {
          by: 1,
          give: EMPTY,
          want: EMPTY,
          counters: [{ by: 4, give: [0, 0, 0, 1, 0, 0], want: [0, 0, 1, 0, 0, 0] }],
        },
        onExecute,
      }),
    );
    const tile = tiles()[0];
    expect(tile.textContent).toContain("Eli");
    act(() => tile.click());
    expect(onExecute).toHaveBeenCalledWith(4);
  });

  it("shows what each counter-offer gives", () => {
    // A seat alone would make an acceptance and a counter look identical, and
    // they commit to different trades.
    render(
      card({
        offer: {
          by: 1,
          give: EMPTY,
          want: EMPTY,
          accepted: [3],
          counters: [{ by: 4, give: [0, 0, 0, 1, 0, 0], want: [0, 0, 1, 0, 0, 0] }],
        },
      }),
    );
    const [accept, counter] = tiles();
    expect(accept.textContent).toContain("as offered");
    // jsdom loads no art, so the chips fall back to their card names.
    expect(counter.textContent).toContain("gives");
    expect(counter.textContent).toContain("Sheep");
    expect(counter.textContent).toContain("wants");
    expect(counter.textContent).toContain("Brick");
  });

  it("shows no deal tiles before any response", () => {
    render(card({ offer: { by: 1, give: EMPTY, want: EMPTY } }));
    expect(tiles()).toHaveLength(0);
    expect(host.textContent).toContain("Waiting for Ada, Cy, and Dee");
    expect(host.textContent).not.toContain("Tap a player");
  });

  // Bots decline out loud, so the card can tell a table that has answered from
  // one still thinking.
  it("names pending and declined seats", () => {
    render(card({ offer: { by: 1, give: EMPTY, want: EMPTY, declined: [0, 3] } }));
    expect(host.textContent).toContain("Waiting for Cy…");
    expect(host.textContent).toContain("Declined: Ada and Dee");
    expect(host.textContent).not.toContain("Everyone declined");
  });

  it("resolves and stops the clock when the last recipient declines", () => {
    const onCancel = vi.fn();
    render(
      card({
        offer: { by: 1, give: EMPTY, want: EMPTY, declined: [0, 2, 3] },
        deadlineMs: 20_000,
        onCancel,
      }),
    );
    expect(host.textContent).toContain("Everyone declined.");
    expect(host.textContent).not.toContain("Waiting for");
    // No countdown on an offer that is already dead.
    expect(host.textContent).not.toMatch(/\d+s/);
    const close = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Close",
    );
    expect(close).toBeTruthy();
    act(() => close!.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("treats any acceptance as a deal to close", () => {
    render(card({ offer: { by: 1, give: EMPTY, want: EMPTY, declined: [0, 2], accepted: [3] } }));
    expect(host.textContent).not.toContain("Everyone declined");
    expect(host.textContent).toContain("Tap a player to close the deal");
  });
});

describe("ActiveOfferCard, everybody else", () => {
  it("gives a responder Accept and Reject", () => {
    const onRespond = vi.fn();
    render(card({ viewer: 5, offer: { by: 1, give: EMPTY, want: EMPTY, accepted: [3] } }));
    const labels = tiles().map((b) => b.textContent);
    expect(labels).toEqual(["Accept", "Reject"]);
    render(
      card({ viewer: 5, offer: { by: 1, give: EMPTY, want: EMPTY, accepted: [3] }, onRespond }),
    );
    act(() => tiles()[0].click());
    expect(onRespond).toHaveBeenCalledWith(true);
  });

  it("keeps the controls after answering", () => {
    // Answering must not lock the card: a mis-tapped Reject has to be changeable.
    const onRespond = vi.fn();
    const onRetract = vi.fn();
    render(
      card({
        viewer: 5,
        offer: { by: 1, give: EMPTY, want: EMPTY, declined: [5] },
        onRespond,
        onRetract,
      }),
    );
    // Two controls: taking an answer back is a second press of that answer.
    const labels = tiles().map((b) => b.textContent);
    expect(labels).toEqual(["Accept", "Reject"]);
    // The answer on record is drawn held down, and pressing it again retracts
    // it, so re-sending the same answer (which the server refuses) can't happen.
    expect(tiles().map((b) => b.hasAttribute("disabled"))).toEqual([false, false]);
    expect(tiles().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    act(() => tiles()[1].click());
    expect(onRetract).toHaveBeenCalled();
    expect(onRespond).not.toHaveBeenCalled();
    act(() => tiles()[0].click());
    expect(onRespond).toHaveBeenCalledWith(true);
  });

  it("switches an answer between accept and reject", () => {
    const onRespond = vi.fn();
    const onRetract = vi.fn();
    render(
      card({
        viewer: 5,
        offer: { by: 1, give: EMPTY, want: EMPTY, accepted: [5] },
        onRespond,
        onRetract,
      }),
    );
    expect(tiles().map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    // Pressing the other answer switches; only the pressed one retracts.
    act(() => tiles()[1].click());
    expect(onRespond).toHaveBeenCalledWith(false);
    expect(onRetract).not.toHaveBeenCalled();
    act(() => tiles()[0].click());
    expect(onRetract).toHaveBeenCalled();
  });

  it("lets a counterer still accept or reject", () => {
    const onRespond = vi.fn();
    render(
      card({
        viewer: 5,
        offer: {
          by: 1,
          give: EMPTY,
          want: EMPTY,
          counters: [{ by: 5, give: [0, 1, 0, 0, 0, 0], want: [0, 0, 1, 0, 0, 0] }],
        },
        onRespond,
      }),
    );
    // A counter is terms, not yes or no, so neither toggle is held down by it,
    // and pressing either sends that plain answer (also how a counter is
    // taken back).
    expect(
      tiles()
        .slice(0, 2)
        .map((b) => b.getAttribute("aria-pressed")),
    ).toEqual(["false", "false"]);
    act(() => tiles()[0].click());
    expect(onRespond).toHaveBeenCalledWith(true);
  });

  it("shows a spectator the status without controls", () => {
    // viewer < 0 is the seatless client; without the guard they'd be offered
    // Accept on a trade they aren't party to.
    render(card({ viewer: -1, offer: { by: 1, give: EMPTY, want: EMPTY, accepted: [3] } }));
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(host.textContent).toContain("offers a trade");
  });
});

it("displays currency and commodities together in an API offer", () => {
  render(
    card({
      offer: {
        by: 1,
        give: EMPTY,
        want: [0, 1, 0, 0, 0, 0],
        give_com: { commodities: [1, 0, 0], coins: 3, wagon_gold: 2 },
      },
    }),
  );
  expect(host.textContent).toContain("Coins × 3");
  expect(host.textContent).toContain("Wagon gold × 2");
  expect(
    host.querySelector('[title="1 Cloth"]') ?? host.textContent?.includes("Cloth"),
  ).toBeTruthy();
});
