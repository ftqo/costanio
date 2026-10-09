import { describe, it, test, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LogSentence, LogTokens } from "./LogLine";
import { RES, COMMOD } from "@/lib/cardFace";
import type { LogLine, LogMessage } from "@/lib/eventlog";

// Cards in the log stand on a tile of their own colour.
//
// The icon art has a near-ink outline that dissolves on the dark panel (about
// 1.2:1), and sheep fails the other way in light mode. The card tokens are
// theme-independent, so a tile in the card's colour fixes both. The tile keeps
// its border, since a bare fill fails 3:1 against the light panel.

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

const draw = (line: LogLine) =>
  act(() => {
    root.render(
      <LogTokens line={line} colorOf={() => "var(--color-red)"} pieceIcon={() => null} />,
    );
  });

/** The tiles a line drew, in order, as their background colour. */
function tiles(): string[] {
  return Array.from(host.querySelectorAll<HTMLElement>("span[style*='background']")).map(
    (el) => el.style.background,
  );
}

describe("cards in the log stand on their own colour", () => {
  it("gives a resource run one tile per card, in that resource's token", () => {
    draw([{ k: "res", idx: 1, n: 3 }]);
    // Wood is RES index 0 (the array is 1-based on the wire, 0-based here).
    expect(tiles()).toEqual([RES[0].color, RES[0].color, RES[0].color]);
  });

  it("gives a commodity its own token too", () => {
    draw([{ k: "com", idx: 2, n: 1 }]);
    expect(tiles()).toEqual([COMMOD[2].color]);
  });

  it("draws each card of a mixed line in its own colour", () => {
    draw([
      { k: "t", s: "Vera got" },
      { k: "res", idx: 1, n: 1 },
      { k: "res", idx: 5, n: 1 },
      { k: "com", idx: 0, n: 1 },
    ]);
    expect(tiles()).toEqual([RES[0].color, RES[4].color, COMMOD[0].color]);
  });

  it("keeps the tile border", () => {
    draw([{ k: "res", idx: 4, n: 1 }]);
    const tile = host.querySelector<HTMLElement>("span[style*='background']");
    expect(tile?.className).toContain("border-ink");
  });

  it("draws the art directly on the fill", () => {
    // Unlike the hand's card, no light well: an 18px tile leaves 15px of
    // interior, and a well would shrink the colour to a ring. The colour
    // identifies a card at this size, so it gets the whole tile.
    draw([{ k: "res", idx: 1, n: 1 }]);
    const tile = host.querySelector<HTMLElement>("span[style*='background']");
    expect(tile?.innerHTML).not.toContain("rgba(255,255,255");
  });

  it("still collapses a sweep to one tile and a count", () => {
    // REPEAT_CAP is 4: a Monopoly for nine wheat must not wrap the row.
    draw([{ k: "res", idx: 4, n: 9 }]);
    expect(tiles()).toHaveLength(4);
    expect(host.textContent).toContain("×9");
  });

  it("colours a card the same whether it was gained or spent", () => {
    // `loss` marks the run; it must not become a different card.
    draw([{ k: "res", idx: 3, n: 1, loss: true }]);
    expect(tiles()).toEqual([RES[2].color]);
  });
});

// The run is icons with empty alt, so the loss needs words for a screen reader.
test("announces a lost run as lost", () => {
  draw([{ k: "res", idx: 4, n: 3, loss: true }]);
  const run = host.querySelector("[aria-label]")!;
  expect(run.getAttribute("aria-label")).toBe("Lost Wheat ×3");
});

test("a gained run is not announced as a loss", () => {
  draw([{ k: "res", idx: 4, n: 3 }]);
  expect(host.querySelector("[aria-label]")!.getAttribute("aria-label")).toBe("Wheat ×3");
});

// The sentence, and the pictures inside it. A line is a message id with named
// parameters and numbered tags, and the translation decides where the pictures
// fall. These pin that the renderer keeps that order and doesn't drop unknown
// tags (lib/eventlog.test.ts can't see either).

/** Draw one message line. */
const sentence = (line: LogMessage) =>
  act(() => {
    root.render(
      <LogSentence line={line} colorOf={() => "var(--color-red)"} pieceIcon={() => null} />,
    );
  });

describe("inline cards in messages", () => {
  it("draws the words and the cards in the order the message puts them", () => {
    sentence({
      msg: { id: "log.traded", message: "{player} traded <0/> → <1/>" },
      values: { player: "Vera" },
      slots: [{ fill: [{ k: "res", idx: 1, n: 1 }] }, { fill: [{ k: "res", idx: 5, n: 2 }] }],
    });
    expect(host.textContent).toContain("Vera traded");
    expect(tiles()).toEqual([RES[0].color, RES[4].color, RES[4].color]);
  });

  it("places cards where the translation puts them", () => {
    // A locale that leads with the cards and ends with the verb gets the cards
    // first; the renderer doesn't know which locale that is.
    sentence({
      msg: { id: "x.reordered", message: "<0/> hat {player} gebaut" },
      values: { player: "Vera" },
      slots: [{ fill: [{ k: "com", idx: 0, n: 1 }] }],
    });
    // The card is drawn before the first word; the sentence's own words come
    // last.
    const row = host.firstElementChild!;
    expect(row.lastElementChild!.textContent).toBe("hat Vera gebaut");
    expect(tiles()).toEqual([COMMOD[0].color]);
  });

  it("draws a paired tag's contents as an aside, and keeps the words", () => {
    sentence({
      msg: { id: "log.rolled", message: "{player} rolled <0/> <1>{total}</1> <2/>" },
      values: { player: "Vera", total: 7 },
      slots: [
        {
          fill: [
            { k: "die", n: 3 },
            { k: "die", n: 4, red: true },
          ],
        },
        { dim: true },
        { fill: [] },
      ],
    });
    expect(host.textContent).toContain("7");
    const dim = Array.from(host.querySelectorAll("span")).find((s) =>
      s.className.includes("text-muted"),
    );
    expect(dim?.textContent).toBe("7");
  });

  it("draws nothing for an empty run", () => {
    // `<2/>` is the Knights event die: present in one ruleset and absent in the
    // other, with no hole or stray space in either.
    sentence({
      msg: { id: "log.rolled", message: "{player} rolled <0/> <1>{total}</1> <2/>" },
      values: { player: "Vera", total: 5 },
      slots: [{ fill: [{ k: "die", n: 5 }] }, { dim: true }, { fill: [] }],
    });
    expect(host.textContent).toBe("Vera rolled5");
    expect(host.textContent).not.toContain("<2/>");
  });

  it("never leaves a tag or an unfilled placeholder on screen", () => {
    sentence({
      msg: { id: "log.tookFrom", message: "{player} took <0/> from {other}" },
      values: { player: "Vera", other: "Nils" },
      slots: [{ fill: [{ k: "res", idx: 3, n: 1 }] }],
    });
    // "Sheep" is the icon's text fallback, so with no asset pack the card still
    // renders as its name.
    expect(host.textContent).toBe("Vera tookSheepfrom Nils");
    expect(host.textContent).not.toMatch(/[<{]/);
  });
});
