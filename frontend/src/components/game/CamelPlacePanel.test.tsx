import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CamelPlacePanel } from "./CamelPlacePanel";
import type { Board, CamelPath, CaravansExt, Edge, Vertex } from "@/lib/types";

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

const v = (q: number, r: number, side: 0 | 1): Vertex => ({ q, r, side });
const e = (a: Vertex, b: Vertex): Edge => ({ a, b });

const board = {
  radius: 1,
  tiles: [{ hex: { q: 0, r: 0 }, res: "wood" }],
  robber: { q: 9, r: 9 },
  harbors: [],
} as unknown as Board;

/** The edge that two caravan fronts share, which is why the key is a pair. */
const SHARED = e(v(0, 0, 0), v(0, 0, 1));

function render(paths: CamelPath[], ext: CaravansExt = {}) {
  const sent: CamelPath[] = [];
  // A fresh mount each time: the panel holds "this seat has placed" locally,
  // and re-rendering the same root would keep that state.
  act(() => root.render(null));
  act(() =>
    root.render(
      <CamelPlacePanel
        board={board}
        ext={ext}
        paths={paths}
        onPlace={(p) => sent.push(p)}
        onClose={() => {}}
      />,
    ),
  );
  return sent;
}

function rows(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>("[data-camel-path]")];
}

describe("rows keyed by (caravan, edge)", () => {
  it("a shared edge gets one row per caravan", () => {
    // Keyed on the edge, these two would collapse into one row, and which chain
    // the camel joined would decide which junctions score.
    const paths: CamelPath[] = [
      { caravan: 0, e: SHARED },
      { caravan: 2, e: SHARED },
    ];
    expect(render(paths) && rows()).toHaveLength(2);

    // A fresh mount per row: the panel closes its rows after the first press
    // (see "one placement per camel" below).
    const sent = [0, 1].map((i) => {
      const out = render(paths);
      act(() => rows()[i].click());
      return out[0];
    });
    expect(sent.map((p) => p.caravan)).toEqual([0, 2]);
    // And the edge travels with it, both times.
    expect(sent.every((p) => p.e === SHARED)).toBe(true);
  });

  it("the row sends the caravan its own label names", () => {
    // Catches a stale closure sending row 0's caravan for every row: the label
    // is read off the DOM.
    const paths: CamelPath[] = [
      { caravan: 1, e: e(v(1, 0, 0), v(1, 0, 1)) },
      { caravan: 0, e: SHARED },
    ];
    // One mount per row, for the reason above.
    const sent = paths.map((_, i) => {
      const out = render(paths);
      const row = rows()[i];
      const labelled = Number(row.getAttribute("data-camel-path-caravan"));
      act(() => row.click());
      expect(out[0].caravan).toBe(labelled);
      return out[0];
    });
    expect(sent.map((p) => p.caravan)).toEqual([1, 0]);
  });

  it("marks a shared edge as shared", () => {
    render([
      { caravan: 0, e: SHARED },
      { caravan: 2, e: SHARED },
    ]);
    expect(document.body.querySelectorAll("[data-camel-shared]")).toHaveLength(2);
  });

  it("a three-way shared edge names both rivals", () => {
    // On an edge fronting three caravans, both alternatives must be named.
    render([
      { caravan: 0, e: SHARED },
      { caravan: 1, e: SHARED },
      { caravan: 2, e: SHARED },
    ]);
    const warnings = [...document.body.querySelectorAll("[data-camel-shared]")].map(
      (n) => n.textContent ?? "",
    );
    expect(warnings).toHaveLength(3);
    // Caravans are 1-based to a reader: row 0 (caravan 0) must name 2 and 3.
    expect(warnings[0]).toMatch(/2/);
    expect(warnings[0]).toMatch(/3/);
    expect(warnings[1]).toMatch(/1/);
    expect(warnings[1]).toMatch(/3/);
  });

  it("a row whose edge nobody else offers carries no such warning", () => {
    render([
      { caravan: 0, e: SHARED },
      { caravan: 1, e: e(v(3, 0, 0), v(3, 0, 1)) },
    ]);
    expect(document.body.querySelectorAll("[data-camel-shared]")).toHaveLength(0);
  });
});

describe("row order", () => {
  it("renders the rows in the order given, even when that is not sorted", () => {
    // `legalPaths` emits them grouped by caravan and along the drawn chain; a
    // client-side sort could permute a caravan's own entries.
    const paths: CamelPath[] = [
      { caravan: 2, e: e(v(0, 0, 0), v(0, 0, 1)) },
      { caravan: 0, e: e(v(1, 0, 0), v(1, 0, 1)) },
      { caravan: 2, e: e(v(2, 0, 0), v(2, 0, 1)) },
      { caravan: 1, e: e(v(3, 0, 0), v(3, 0, 1)) },
    ];
    render(paths);
    expect(rows().map((r) => Number(r.getAttribute("data-camel-path-caravan")))).toEqual([
      2, 0, 2, 1,
    ]);
  });
});

// `pickPlacer` has four outcomes and only one is a win: a tie and a round
// nobody bid in both fall to the finisher through the same `placer` field. The
// engine stamps which outcome it was, so the panel looks it up rather than
// re-deriving the voting rule.
describe("vote outcome", () => {
  const paths: CamelPath[] = [{ caravan: 0, e: SHARED }];
  const opener = () =>
    document.body.querySelector<HTMLElement>("p")?.textContent?.replace(/\s+/g, " ").trim() ?? "";

  it("says you won only on a win", () => {
    render(paths, { placer: 1, reason: "majority" });
    expect(opener()).toContain("You won the vote");
  });

  it("does not claim a win on a tie", () => {
    render(paths, { placer: 1, reason: "tie" });
    expect(opener()).toContain("The vote was tied");
    expect(opener()).not.toContain("You won");
  });

  it("does not claim a win when nobody bid", () => {
    render(paths, { placer: 1, reason: "nobody" });
    expect(opener()).toContain("Nobody bid");
    expect(opener()).not.toContain("You won");
  });

  // The stamped reason wins: a tie whose payments look like a clean win is
  // still a tie.
  it("reads the stamped reason rather than the payments", () => {
    render(paths, {
      placer: 1,
      reason: "tie",
      bids: [{ player: 1, cards: [5, 0] }],
    });
    expect(opener()).toContain("The vote was tied");
  });

  // A log or view without the `reason` field falls back to deriving it from
  // the payments.
  it("falls back to the payments when the server sends no reason", () => {
    render(paths, { placer: 1, bids: [] });
    expect(opener()).toContain("Nobody bid");
  });

  // A coalition never reaches this panel (the engine places the camel itself
  // and `placer` stays -1), but if it did, "You won the vote" would be false.
  it("claims no win when a coalition carried the vote", () => {
    render(paths, { placer: -1, reason: "coalition" });
    expect(opener()).not.toContain("You won");
    expect(opener()).toContain("agreed on a placement");
  });
});

// Each settlement or city between two camels, from any caravans, is worth +1 VP
// (docs/rules/scenarios.md). The panel must not say "of the same caravan".
describe("scoring rule", () => {
  const paths: CamelPath[] = [{ caravan: 0, e: SHARED }];
  it("says any two camels, never two of the same caravan", () => {
    for (const reason of ["majority", "tie", "nobody"]) {
      render(paths, { placer: 1, reason });
      const text = document.body.textContent ?? "";
      expect(text).toContain("between any two camels");
      expect(text).not.toContain("of the same caravan");
    }
  });
});

describe("one placement per camel", () => {
  // As in the bid panel: rows stay live until the server's next view, so they
  // lock after the first click to avoid a second place_camel.
  it("a second click sends nothing more", () => {
    const sent = render([
      { caravan: 0, e: SHARED },
      { caravan: 1, e: SHARED },
    ]);
    act(() => rows()[0].click());
    act(() => rows()[0].click());
    expect(sent).toEqual([{ caravan: 0, e: SHARED }]);
  });

  it("closes every other row too, not just the one that was pressed", () => {
    // The camel is placed once; no row may stay live.
    const sent = render([
      { caravan: 0, e: SHARED },
      { caravan: 1, e: SHARED },
    ]);
    act(() => rows()[0].click());
    expect(rows().every((r) => (r as HTMLButtonElement).disabled)).toBe(true);
    act(() => rows()[1].click());
    expect(sent).toHaveLength(1);
  });
});

// A caravan whose front forks offers two rows, which must read differently.
describe("two placements for one caravan", () => {
  it("are numbered within the caravan", () => {
    render([
      { caravan: 0, e: e(v(0, 0, 0), v(0, 0, 1)) },
      { caravan: 0, e: e(v(1, 0, 0), v(1, 0, 1)) },
      { caravan: 1, e: e(v(2, 0, 0), v(2, 0, 1)) },
    ]);
    const heads = rows().map((r) => r.querySelector("[data-camel-path-name]")?.textContent?.trim());
    expect(heads).toEqual(["Caravan 1, choice 1", "Caravan 1, choice 2", "Caravan 2"]);
  });
});

// A winner who bid for a placement opens on the row the bid named (a wrong tap
// places the camel with no undo).
describe("the placement the winner bid for", () => {
  const A: CamelPath = { caravan: 0, e: e(v(1, 0, 0), v(1, 0, 1)) };
  const B: CamelPath = { caravan: 1, e: SHARED };
  const C: CamelPath = { caravan: 2, e: SHARED };
  const named = () => rows().filter((r) => r.hasAttribute("data-camel-named"));

  it("is highlighted and focused, and sends only on a tap", () => {
    const sent = render([A, B, C], {
      placer: 2,
      reason: "majority",
      bids: [
        { player: 0, cards: [1, 0] },
        { player: 2, cards: [2, 0], path: C },
      ],
    });
    expect(named()).toHaveLength(1);
    expect(named()[0].getAttribute("data-camel-path-caravan")).toBe("2");
    expect(document.activeElement).toBe(named()[0]);
    expect(named()[0].textContent).toContain("The placement you bid for.");
    // Preselected is not placed.
    expect(sent).toEqual([]);
  });

  it("marks nothing when the bid's path is absent or not offered", () => {
    render([A, B], { placer: 1, bids: [{ player: 1, cards: [1, 0] }] });
    expect(named()).toHaveLength(0);
    render([A, B], {
      placer: 1,
      bids: [{ player: 1, cards: [1, 0], path: C }],
    });
    expect(named()).toHaveLength(0);
  });

  it("reads the placer's bid", () => {
    render([A, B], {
      placer: 0,
      bids: [
        { player: 0, cards: [1, 0], path: A },
        { player: 1, cards: [1, 0], path: B },
      ],
    });
    expect(named().map((r) => r.getAttribute("data-camel-path-caravan"))).toEqual(["0"]);
  });
});

describe("sticky footer", () => {
  // At 1280x800 the clock fell below the fold, so it lives in the pinned footer,
  // as the camel vote's does.
  it("puts the clock sentence in the sticky footer, last in the dialog", () => {
    render([{ caravan: 0, e: SHARED }]);
    const footer = document.body.querySelector<HTMLElement>("[role=dialog] [data-overlay-footer]")!;
    expect(footer).toBeTruthy();
    expect(footer.className.split(" ")).toContain("sticky");
    expect(footer.textContent).toContain("This choice is on a clock.");
    expect(document.body.querySelector("[role=dialog]")!.lastElementChild).toBe(footer);
    // And the rows are not in it: they scroll with the map.
    expect(footer.querySelector("[data-camel-path]")).toBeNull();
  });

  it("swaps the rows above the map on a short screen", () => {
    render([{ caravan: 0, e: SHARED }]);
    const body = document.body.querySelector<HTMLElement>("[data-camel-place-body]")!;
    expect(body.className).toContain("[@media(max-height:500px)]:flex-col-reverse");
    expect(body.lastElementChild!.querySelector("[data-camel-path]")).toBeTruthy();
  });
});

describe("merge label", () => {
  // Two heads meeting at M merge, and the engine offers the next camel once, on
  // the lower-numbered caravan. The row must say it continues caravan 2 too.
  const M = v(1, 0, 0);
  const ext = {
    camels: [
      { caravan: 0, e: e(v(0, 0, 0), v(0, 0, 1)) },
      { caravan: 0, e: e(v(0, 0, 1), M) },
      { caravan: 1, e: e(v(2, -1, 1), M) },
    ],
  } as unknown as CaravansExt;
  it("names both caravans and the combined length", () => {
    render([{ caravan: 0, e: e(M, v(1, 1, 1)) }], ext);
    expect(rows()[0].textContent).toContain("Continues caravans 1 and 2 as one, a chain of 3.");
  });
  it("an ordinary extension still reads as one", () => {
    render([{ caravan: 1, e: e(v(2, -1, 1), v(3, -2, 0)) }], {
      camels: [{ caravan: 1, e: e(v(2, -1, 1), M) }],
    });
    expect(rows()[0].textContent).toContain("Extends a chain of 1.");
    expect(rows()[0].textContent).not.toContain("Continues");
  });
});
