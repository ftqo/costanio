import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SeatChoice } from "./SeatChoice";

// The shared "pick an opponent" control, behind the robber and pirate steal, the
// knight chase, the Deserter, the Spy and the Master Merchant.

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

const seat = (o: Partial<React.ComponentProps<typeof SeatChoice>> = {}) => (
  <SeatChoice seat={2} name="Robin" color="#c33" onSelect={() => {}} {...o} />
);

describe("SeatChoice", () => {
  it("is a real button carrying the seat's name", () => {
    render(seat());
    const btn = host.querySelector("button")!;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("Robin");
  });

  it("hands the seat number back, not the array index", () => {
    // Call sites key by seat and the engine's `victim` is a seat; a picker
    // reporting a position would target the wrong player when the legal set is
    // a subset of the table.
    const onSelect = vi.fn();
    render(seat({ seat: 5, onSelect }));
    act(() => host.querySelector("button")!.click());
    expect(onSelect).toHaveBeenCalledWith(5);
  });

  it("paints the seat colour on the ring", () => {
    // The ring is drawn by `.hud-seatpick-well` from `--pc-ink`, which
    // `.hud-pc` derives from the `--pc` the button carries.
    render(seat({ color: "rgb(0, 128, 0)" }));
    const btn = host.querySelector("button") as HTMLElement;
    expect(btn.classList.contains("hud-pc")).toBe(true);
    expect(btn.style.getPropertyValue("--pc")).toBe("rgb(0, 128, 0)");
    expect(host.querySelector(".hud-seatpick-well")).not.toBeNull();
  });

  it("shows the per-prompt detail only when given one", () => {
    render(seat({ detail: "3 cards" }));
    expect(host.textContent).toContain("3 cards");
    render(seat());
    expect(host.textContent).toBe("Robin");
  });

  it("a disabled choice cannot be taken", () => {
    const onSelect = vi.fn();
    render(seat({ disabled: true, onSelect }));
    const btn = host.querySelector("button")!;
    expect(btn.disabled).toBe(true);
    act(() => btn.click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("leaves the piece well blank when no model render is available", () => {
    // jsdom never loads the piece renders, as at first paint before
    // `usePieceIcons` resolves: no stand-in glyph, but the well keeps its size.
    render(seat());
    expect(host.querySelector("svg")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".hud-seatpick-well")?.className).toContain("w-11 h-11");
  });
});
