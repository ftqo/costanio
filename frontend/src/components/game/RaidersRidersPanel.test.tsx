import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RaidersRidersPanel } from "./RaidersRidersPanel";
import { edgeKey } from "@/lib/hexgeo";
import type { Edge, RiderMoves } from "@/lib/types";

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

const edge = (q: number): Edge => ({ a: { q, r: 0, side: 0 }, b: { q: q + 1, r: 0, side: 1 } });

function render(
  moves: RiderMoves[],
  grain = 3,
  onChoose: (e: Edge) => void = () => {},
  fishHurry = false,
) {
  act(() =>
    root.render(
      <RaidersRidersPanel
        moves={moves}
        grain={grain}
        fishHurry={fishHurry}
        onChoose={onChoose}
        onClose={() => {}}
      />,
    ),
  );
  return document.body;
}

const row = (e: Edge) =>
  document.body.querySelector(`[data-raiders-rider="${edgeKey(e)}"]`) as HTMLButtonElement;

describe("which rider to move", () => {
  it("lists movable riders in server order", () => {
    const body = render([
      { from: edge(0), to: [edge(1)] },
      { from: edge(2), to: [edge(3), edge(4)] },
    ]);
    const rows = [...body.querySelectorAll("[data-raiders-rider]")];
    expect(rows).toHaveLength(2);
    // Path order, which must stay stable, or a different rider could be under
    // the cursor between the look and the click.
    expect(rows[0].getAttribute("data-raiders-rider")).toBe(edgeKey(edge(0)));
  });

  // A rider that has already moved this turn is absent from `rider_moves`, so
  // it is absent here (not greyed out).
  it("says when no rider can move", () => {
    const body = render([]);
    expect(body.querySelectorAll("[data-raiders-rider]")).toHaveLength(0);
    // Not "muster another": a mustered rider is a new figure that must ride out
    // of the castle, not a move given back to a rider that has spent its own.
    expect(body.textContent).toContain("Buy a card to bring another rider onto the board");
  });

  it("hands back the path the chosen rider is standing on", () => {
    const chosen: Edge[] = [];
    render([{ from: edge(0), to: [edge(1)] }], 3, (e) => chosen.push(e));
    act(() => row(edge(0)).click());
    expect(chosen).toEqual([edge(0)]);
  });
});

describe("castle rule", () => {
  it("marks the rider that blocks the turn, with one reason", () => {
    const body = render([
      { from: edge(0), to: [edge(1)], must_leave: true },
      { from: edge(2), to: [edge(3)] },
    ]);
    expect(row(edge(0)).hasAttribute("data-raiders-rider-owed")).toBe(true);
    expect(row(edge(2)).hasAttribute("data-raiders-rider-owed")).toBe(false);
    expect(
      body.querySelector("[data-raiders-must-leave]")?.getAttribute("data-raiders-must-leave"),
    ).toBe("1");
    expect(body.textContent).toContain("cannot end");
  });

  // A rider with nowhere legal to go is not marked by the engine (the rules
  // let it stay and the turn end), so the panel neither demands nor offers it.
  it("ignores a rider that cannot move", () => {
    const body = render([{ from: edge(0), to: [] }]);
    expect(row(edge(0)).disabled).toBe(true);
    expect(body.querySelector("[data-raiders-must-leave]")).toBeNull();
    expect(body.textContent).toContain("already holds a rider");
  });
});

describe("the grain that hurries one rider", () => {
  // The price is per rider, so the offer is per row, and shown only where the
  // grain is in hand (the engine refuses the move otherwise).
  it("advertises the extra reach only while a grain is held", () => {
    render([{ from: edge(0), to: [edge(1)], hurry: [edge(2), edge(3)] }], 1);
    expect(row(edge(0)).querySelector("[data-raiders-rider-hurry]")?.textContent).toContain("2");

    act(() => root.unmount());
    root = createRoot(host);
    render([{ from: edge(0), to: [edge(1)], hurry: [edge(2), edge(3)] }], 0);
    expect(row(edge(0)).querySelector("[data-raiders-rider-hurry]")).toBeNull();
  });

  // A rider that can only move by paying is still selectable: the destinations
  // light together on the board and the tap decides whether the grain goes.
  it("offers a rider whose only reach is the hurried one", () => {
    render([{ from: edge(0), to: [], hurry: [edge(2)] }], 2);
    expect(row(edge(0)).disabled).toBe(false);
  });
});

describe("two fish instead of the grain (with Fishermen)", () => {
  // Two fish can pay the same price as 1 wheat, so a seat with fish and no
  // grain is still offered the reach.
  it("offers fish-only reach and names both prices when both are held", () => {
    render([{ from: edge(0), to: [edge(1)], hurry: [edge(2)] }], 0, () => {}, true);
    expect(row(edge(0)).querySelector("[data-raiders-rider-hurry]")?.textContent).toContain(
      "two fish",
    );
    expect(document.body.textContent).toContain("Two fish can pay");

    act(() => root.unmount());
    root = createRoot(host);
    render([{ from: edge(0), to: [edge(1)], hurry: [edge(2)] }], 1, () => {}, true);
    expect(row(edge(0)).querySelector("[data-raiders-rider-hurry]")?.textContent).toContain(
      "a wheat or two fish",
    );
  });
});

describe("place counts", () => {
  // Pluralised: "1 places in reach" was reachable, and "2 more for a wheat"
  // read as two more wheat.
  it("says one place and two places", () => {
    render([{ from: edge(0), to: [edge(1)], hurry: [edge(2), edge(3)] }], 1);
    expect(row(edge(0)).textContent).toContain("1 place in reach");
    expect(row(edge(0)).textContent).not.toContain("1 places");
    expect(row(edge(0)).querySelector("[data-raiders-rider-hurry]")?.textContent).toBe(
      "2 more places for a wheat",
    );
  });
});

describe("the gold line", () => {
  // The same bullion glyph as the gold panel, not an empty slot.
  it("draws the gold glyph beside the purse", () => {
    act(() =>
      root.render(
        <RaidersRidersPanel
          moves={[{ from: edge(0), to: [edge(1)] }]}
          grain={0}
          fishHurry={false}
          onChoose={() => {}}
          onClose={() => {}}
          gold={{ gold: 3, buysLeft: 2, onOpen: () => {} }}
        />,
      ),
    );
    expect(
      document.body.querySelector('[data-raiders-riders-gold] svg[data-glyph="gold"]'),
    ).not.toBeNull();
  });
});
