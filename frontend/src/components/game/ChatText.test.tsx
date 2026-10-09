import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatText } from "./ChatText";
import { RES } from "@/lib/cardFace";

// What a chat message looks like once its resources are cards. The parse is
// covered in lib/chatTokens.test.ts; these pin that a run of five is five cards
// (the log caps at four) and that a message with nothing to draw comes back as
// plain text.

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

const draw = (msg: string, commodities?: boolean) =>
  act(() => {
    root.render(<ChatText msg={msg} commodities={commodities} />);
  });

/** The coloured tiles a card run draws, in order. */
function tiles(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("span[style*='background']")];
}

describe("ChatText", () => {
  it("draws five wood as five cards", () => {
    // Five is drawn as a run of cards, not a numeral.
    draw("5 wood");
    expect(tiles()).toHaveLength(5);
    expect(host.textContent).not.toContain("×");
  });

  it("collapses past five to a count", () => {
    draw("9 wheat");
    expect(tiles()).toHaveLength(5);
    expect(host.textContent).toContain("×9");
  });

  it("gives each card its own token colour", () => {
    draw("2 sheep for 3 wood");
    const drawn = tiles();
    expect(drawn).toHaveLength(5);
    const sheep = RES[2].color;
    const wood = RES[0].color;
    expect(drawn.slice(0, 2).map((t) => t.style.background)).toEqual([sheep, sheep]);
    expect(drawn.slice(2).map((t) => t.style.background)).toEqual([wood, wood, wood]);
  });

  it("keeps the words between the cards", () => {
    draw("2 sheep for 3 wood");
    expect(host.textContent).toContain(" for ");
  });

  it("leaves a message with no resources as plain text", () => {
    const msg = "good luck everyone";
    draw(msg);
    expect(host.textContent).toBe(msg);
    expect(tiles()).toHaveLength(0);
  });

  it("names the run for a screen reader", () => {
    // The cards are the message here, so the row cannot read as empty.
    draw("3 ore");
    const run = host.querySelector("[aria-label]");
    expect(run?.getAttribute("aria-label")).toBe("Ore ×3");
  });

  it("draws commodities only when the ruleset has them", () => {
    draw("2 paper");
    expect(tiles()).toHaveLength(0);
    draw("2 paper", true);
    expect(tiles()).toHaveLength(2);
  });
});
