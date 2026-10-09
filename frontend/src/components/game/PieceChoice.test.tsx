import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PieceChoice } from "./PieceChoice";

// The "Move: Robber | Pirate" and "Place: Road | Ship" rows under the turn chip.
// jsdom has no layout or colour, so this pins the structure: the row has its
// own surface rather than bare text over the board, and the choice is stated.

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

const OPTIONS = [
  { key: "robber", label: "Robber" },
  { key: "pirate", label: "Pirate" },
] as const;

function draw(value: "robber" | "pirate", onChange = vi.fn()) {
  act(() =>
    root.render(<PieceChoice label="Move:" options={OPTIONS} value={value} onChange={onChange} />),
  );
  return onChange;
}

const row = () => host.querySelector<HTMLElement>("[data-piece-choice]")!;
const buttons = () => [...host.querySelectorAll("button")];

describe("PieceChoice", () => {
  it("draws on its own surface", () => {
    draw("robber");
    // The HUD's panel material, whose fill keeps a muted label at 4.5:1 over
    // the worst pixel of the board.
    expect(row().className).toContain("hud-surf");
    const label = host.querySelector<HTMLElement>("[data-piece-choice-label]")!;
    expect(label.textContent).toBe("Move:");
    // The HUD's section label (mono, tracked caps), not bare muted text.
    expect(label.className).toContain("hud-lab");
    expect(row().className).toContain("text-foreground");
  });

  it("draws an option's piece beside its word, when one is given", () => {
    act(() =>
      root.render(
        <PieceChoice
          label="Move:"
          options={[
            { key: "robber", label: "Robber", icon: <i data-ic="r" /> },
            { key: "pirate", label: "Pirate" },
          ]}
          value="robber"
          onChange={() => {}}
        />,
      ),
    );
    expect(buttons()[0].querySelector("[data-ic=r]")).not.toBeNull();
    expect(buttons()[1].querySelector("[aria-hidden]")).toBeNull();
  });

  it("says which option is chosen, not only by fill", () => {
    draw("pirate");
    expect(buttons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  });

  it("hands back the key of the option pressed", () => {
    const onChange = draw("robber");
    act(() => buttons()[1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith("pirate");
  });

  it("is a labelled group", () => {
    draw("robber");
    expect(row().getAttribute("role")).toBe("group");
    const id = row().getAttribute("aria-labelledby")!;
    expect(document.getElementById(id)?.textContent).toBe("Move:");
  });
});
