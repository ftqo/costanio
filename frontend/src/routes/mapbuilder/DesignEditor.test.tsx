import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DesignEditor } from "./DesignEditor";
import { coastEdges, edgeSeaHex } from "@/lib/maps/harbors";
import { edgeKey, hexKey } from "@/lib/hexgeo";
import type { Board } from "@/lib/types";

// jsdom has no layout, so `document.elementFromPoint` returns null and the
// paint path's hit-testing cannot be exercised here (as with ShapeEditor). The
// paint transforms are covered by the `setTileResource`/`setTileNumber` unit
// tests. This is a render-structure smoke test: the board and palettes render
// with their data-attributes.
function board(): Board {
  return {
    radius: 1,
    robber: { q: 1, r: 0 },
    harbors: [],
    tiles: [
      { hex: { q: 0, r: 0 }, res: "ore", num: 6 },
      { hex: { q: 1, r: 0 }, res: "none", num: 0 },
    ],
  };
}

describe("DesignEditor render structure", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders a tile polygon per board tile", () => {
    act(() =>
      root.render(
        <DesignEditor board={board()} onBoardChange={vi.fn()} issues={[]} highlightHexes={[]} />,
      ),
    );
    // Water cells carry data-hex too (the outline brush paints them), so the
    // tiles are the hexes that are not water.
    const hexes = container.querySelectorAll("[data-hex]:not([data-water])");
    expect(hexes.length).toBe(2);
    expect(container.querySelectorAll("[data-water]").length).toBeGreaterThan(0);
    expect(container.querySelector('[data-hex="0,0"]')).toBeTruthy();
    expect(container.querySelector('[data-hex="1,0"]')).toBeTruthy();
  });

  it("renders the resource and number palettes, without gold by default", () => {
    act(() =>
      root.render(
        <DesignEditor board={board()} onBoardChange={vi.fn()} issues={[]} highlightHexes={[]} />,
      ),
    );
    // One button per design resource (5 producing + none) and per number. No
    // gold: it only produces under Islands, and the shell enables it with the
    // switch.
    expect(container.querySelectorAll("[data-restool]").length).toBe(6);
    expect(container.querySelector('[data-restool="wheat"]')).toBeTruthy();
    expect(container.querySelector('[data-restool="gold"]')).toBeNull();
    expect(container.querySelectorAll("[data-numtool]").length).toBe(10);
    expect(container.querySelector('[data-numtool="6"]')).toBeTruthy();
  });

  it("puts gold on the palette when the shell says Islands is on", () => {
    act(() =>
      root.render(
        <DesignEditor
          board={board()}
          onBoardChange={vi.fn()}
          issues={[]}
          highlightHexes={[]}
          allowGold
        />,
      ),
    );
    expect(container.querySelectorAll("[data-restool]").length).toBe(7);
    expect(container.querySelector('[data-restool="gold"]')).toBeTruthy();
  });

  it("takes the brush off gold when gold leaves the palette", () => {
    const render = (allowGold: boolean) =>
      act(() =>
        root.render(
          <DesignEditor
            board={board()}
            onBoardChange={vi.fn()}
            issues={[]}
            highlightHexes={[]}
            allowGold={allowGold}
          />,
        ),
      );
    render(true);
    act(() => {
      container
        .querySelector('[data-restool="gold"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Islands turns off while gold is selected.
    render(false);
    expect(container.querySelector('[data-restool="gold"]')).toBeNull();
    // The brush falls back to a swatch that is on screen.
    const selected = [...container.querySelectorAll("[data-restool]")].filter((b) =>
      b.className.includes("bg-selected"),
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-restool")).toBe("wood");
  });

  it("renders a number chip only for the producing tile with a number", () => {
    act(() =>
      root.render(
        <DesignEditor board={board()} onBoardChange={vi.fn()} issues={[]} highlightHexes={[]} />,
      ),
    );
    // The TokenLabel for ore@6 renders the number text "6"; the desert renders none.
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("6");
  });

  it("renders a Draw/Swap paint-mode toggle defaulting to draw", async () => {
    act(() =>
      root.render(
        <DesignEditor board={board()} onBoardChange={vi.fn()} issues={[]} highlightHexes={[]} />,
      ),
    );
    const draw = container.querySelector('[data-paintmode="draw"]') as HTMLElement;
    const swap = container.querySelector('[data-paintmode="swap"]') as HTMLElement;
    expect(draw).toBeTruthy();
    expect(swap).toBeTruthy();
    // Draw is selected by default (it carries the active "bg-selected" class).
    expect(draw.className).toContain("bg-selected");
    expect(swap.className).not.toContain("bg-selected");

    // Clicking Swap switches the active button.
    await act(async () => {
      swap.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(swap.className).toContain("bg-selected");
  });
});

// A harbour's dock stands on the water hex beside its edge, so two harbours
// must never resolve to one hex: once a hex is claimed, every other coast edge
// facing it goes inert.
describe("DesignEditor harbour placement", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // Two land hexes with an open-water hex wedged between them: the coast edges
  // on either side of (1,0) all want the same dock.
  function bayBoard(): Board {
    return {
      radius: 3,
      robber: { q: 0, r: 0 },
      harbors: [],
      tiles: [
        { hex: { q: 0, r: 0 }, res: "ore", num: 6 },
        { hex: { q: 2, r: 0 }, res: "none", num: 0 },
        { hex: { q: 1, r: 0 }, res: "sea", num: 0 },
      ],
    };
  }

  async function harborMode(b: Board, onBoardChange = vi.fn()) {
    act(() =>
      root.render(
        <DesignEditor board={b} onBoardChange={onBoardChange} issues={[]} highlightHexes={[]} />,
      ),
    );
    const tab = container.querySelector('[data-tooltab="harbors"]') as HTMLElement;
    await act(async () => {
      tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    return onBoardChange;
  }

  it("offers every coast edge when no harbour is placed", async () => {
    await harborMode(bayBoard());
    const edges = [...container.querySelectorAll("[data-coastedge]")];
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((g) => g.getAttribute("data-harborable") === "true")).toBe(true);
  });

  /** The two rendered coast-edge groups that face the water hex (1,0). */
  function facingTheBay(): HTMLElement[] {
    const bay = hexKey({ q: 1, r: 0 });
    const keys = new Set(
      coastEdges(bayBoard())
        .filter((e) => {
          const sea = edgeSeaHex(bayBoard(), e);
          return sea !== null && hexKey(sea) === bay;
        })
        .map(edgeKey),
    );
    return [...container.querySelectorAll("[data-coastedge]")].filter((g) =>
      keys.has(g.getAttribute("data-coastedge") as string),
    ) as HTMLElement[];
  }

  it("blocks the other edges of a water hex once a harbour docks there", async () => {
    const onChange = vi.fn();
    await harborMode(bayBoard(), onChange);
    const [first] = facingTheBay();
    await act(async () => {
      first.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Board;
    expect(next.harbors.length).toBe(1);

    // Re-render with that harbour in place: its own edge stays live (its type
    // can still be changed or cleared), and the other bay edge goes inert.
    await harborMode(next);
    const [live, blocked] = facingTheBay();
    expect(live.getAttribute("data-harborable")).toBe("true");
    expect(blocked.getAttribute("data-harborable")).toBe("false");
  });

  it("ignores a click on a blocked edge", async () => {
    const onChange = vi.fn();
    await harborMode(bayBoard(), onChange);
    await act(async () => {
      facingTheBay()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const next = onChange.mock.calls[0][0] as Board;

    const after = vi.fn();
    await harborMode(next, after);
    await act(async () => {
      facingTheBay()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(after).not.toHaveBeenCalled();
    expect(next.harbors.length).toBe(1); // still exactly one dock on that hex
  });

  it("places the port type selected in the palette", async () => {
    const onChange = vi.fn();
    await harborMode(bayBoard(), onChange);
    const ore = container.querySelector('[data-harbortool="2:1-ore"]') as HTMLElement;
    await act(async () => {
      ore.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      facingTheBay()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const next = onChange.mock.calls[0][0] as Board;
    expect(next.harbors).toHaveLength(1);
    expect(next.harbors[0].ratio).toBe(2);
    expect(next.harbors[0].res).toBe("ore");
  });

  it("clears every port at once", async () => {
    const onChange = vi.fn();
    await harborMode(bayBoard(), onChange);
    await act(async () => {
      facingTheBay()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const placed = onChange.mock.calls[0][0] as Board;

    const after = vi.fn();
    await harborMode(placed, after);
    const clear = container.querySelector('[data-harboraction="clear"]') as HTMLElement;
    await act(async () => {
      clear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect((after.mock.calls[0][0] as Board).harbors).toEqual([]);
  });
});
