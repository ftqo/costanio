import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StealPicker } from "./StealPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The robber / pirate / chase steal picker must show each victim's hand size
// (public, and what separates two victims) and a visible way back to choosing
// a hex. The robber hasn't moved when this opens, so backing out sends nothing.

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

const seatName = (s: number) => ["Ada", "Bo", "Cy", "Dee"][s] ?? `P${s}`;
const held: Record<number, number> = { 1: 1, 3: 7 };

function render(props: Partial<React.ComponentProps<typeof StealPicker>> = {}) {
  act(() =>
    root.render(
      <StealPicker
        victims={[1, 3]}
        seatName={seatName}
        colorOf={(s) => `var(--seat-${s})`}
        cardsHeld={(s) => held[s] ?? 0}
        onPick={() => {}}
        onBack={() => {}}
        {...props}
      />,
    ),
  );
}

const buttons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"));

describe("StealPicker", () => {
  it("shows each victim's hand size under their name", () => {
    render();
    const bo = buttons().find((b) => b.textContent?.includes("Bo"));
    const dee = buttons().find((b) => b.textContent?.includes("Dee"));
    expect(bo?.textContent).toContain("1 card");
    expect(bo?.textContent).not.toContain("1 cards");
    expect(dee?.textContent).toContain("7 cards");
  });

  it("steals from the seat that was pressed", () => {
    const onPick = vi.fn();
    render({ onPick });
    act(() =>
      buttons()
        .find((b) => b.textContent?.includes("Dee"))!
        .click(),
    );
    expect(onPick).toHaveBeenCalledWith(3);
  });

  it("has a back button to pick another hex", () => {
    const onPick = vi.fn();
    const onBack = vi.fn();
    render({ onPick, onBack });
    const back = buttons().find((b) => b.textContent === "Choose a different hex");
    expect(back).toBeTruthy();
    act(() => back!.click());
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });
});

// At 844x390 "Bot Camembert" was cut to "Bot Camemb..."; names wrap to a
// second line instead.
describe("seat names in a steal", () => {
  it("wraps a long name rather than cutting it off", () => {
    render({ seatName: (s) => (s === 1 ? "Bot Camembert" : "Bot Happaya") });
    const name = document.body.querySelector("[data-seat-choice-name]");
    expect(name?.textContent).toBe("Bot Camembert");
    const cls = name!.className.split(" ");
    expect(cls).not.toContain("truncate");
    expect(cls).toContain("line-clamp-2");
    expect(cls).toContain("break-words");
  });

  // The Raiders steal (no robber, a 7 takes a card from anyone) says "6 cards",
  // as the robber's picker does.
  it("the Raiders steal counts cards with their unit", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/Game.tsx"), "utf8");
    const at = src.indexOf("{raidersVictims.map((seat) => (");
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, src.indexOf("</SeatChoiceRow>", at));
    expect(block).toContain('plural(cardsHeld(seat), { one: "# card", other: "# cards" })');
    expect(block).not.toMatch(/detail=\{cardsHeld\(seat\)\}/);
  });
});
