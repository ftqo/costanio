import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DrawOfferCard } from "./DrawOfferCard";

// A draw offer is answerable once, by exactly the seats being asked. Rendered
// rather than scanned because what matters is who gets the buttons: the
// offerer, a spectator or a seat that already accepted must not see Accept.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const seatName = (s: number) => ["Ada", "Bo", "Cy"][s] ?? `P${s}`;

const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");

const card = (props: Partial<React.ComponentProps<typeof DrawOfferCard>> = {}) => (
  <DrawOfferCard offer={{ by: 0 }} viewer={1} seatName={seatName} onRespond={() => {}} {...props} />
);

describe("DrawOfferCard", () => {
  it("offers accept and decline to a seat that has not answered", () => {
    const onRespond = vi.fn();
    render(card({ onRespond }));
    expect(host.textContent).toContain("Ada offers a draw");
    expect(buttons()).toEqual(["Accept draw", "Decline"]);

    const accept = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Accept draw",
    )!;
    act(() => accept.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onRespond).toHaveBeenCalledWith(true);
  });

  it("sends a decline from the decline button", () => {
    const onRespond = vi.fn();
    render(card({ onRespond }));
    const decline = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Decline",
    )!;
    act(() => decline.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onRespond).toHaveBeenCalledWith(false);
  });

  it("gives the offerer no buttons to answer their own offer", () => {
    render(card({ viewer: 0 }));
    expect(host.textContent).toContain("You offered a draw");
    expect(buttons()).toEqual([]);
  });

  it("gives a spectator the news and none of the controls", () => {
    render(card({ viewer: -1 }));
    expect(host.textContent).toContain("Ada offers a draw");
    expect(buttons()).toEqual([]);
  });

  it("drops the controls once this seat has accepted, and says who has", () => {
    render(card({ offer: { by: 0, accepted: [1] } }));
    expect(buttons()).toEqual([]);
    expect(host.textContent).toContain("Accepted: Bo");
  });
});

// The offerer can withdraw. An offer also has its own expiry, which is all a
// table with no turn timer has.
describe("withdrawing", () => {
  it("offers the control only to the seat that made the offer", () => {
    const withdraw = vi.fn();
    render(card({ viewer: 0, onWithdraw: withdraw }));
    expect(buttons()).toContain("Withdraw offer");
    act(() => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Withdraw offer")!
        .click();
    });
    expect(withdraw).toHaveBeenCalledTimes(1);
  });

  it("shows nothing to withdraw to anyone else", () => {
    render(card({ viewer: 1, onWithdraw: () => {} }));
    expect(buttons()).not.toContain("Withdraw offer");
    render(card({ viewer: -1, onWithdraw: () => {} }));
    expect(buttons()).not.toContain("Withdraw offer");
  });
});
