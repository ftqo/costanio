import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RaidersTreasonPanel } from "./RaidersTreasonPanel";
import { hexKey } from "@/lib/hexgeo";
import type { Board, Hex, RaidersExt, TreasonMove } from "@/lib/types";

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

const A = { q: 2, r: 0 };
const B = { q: 0, r: 2 };
const C = { q: -2, r: 0 };
const D = { q: 2, r: -2 };

const board = {
  tiles: [A, B, C, D, { q: 0, r: 0 }].map((hex) => ({ hex, res: "wood", num: 5 })),
  robber: { q: 0, r: 0 },
  harbors: [],
} as unknown as Board;

const ext: RaidersExt = {
  coast: [A, B, C, D],
  raider_count: [1, 1, 0, 0],
  castle: { q: 0, r: 0 },
};

function render(opts: {
  sources?: Hex[];
  destinations?: Hex[];
  count?: number;
  onPlan?: (m: TreasonMove[]) => void;
}) {
  act(() =>
    root.render(
      <RaidersTreasonPanel
        board={board}
        ext={ext}
        sources={opts.sources ?? [A, B]}
        destinations={opts.destinations ?? [C, D]}
        count={opts.count ?? 2}
        onPlan={opts.onPlan ?? (() => {})}
        onClose={() => {}}
      />,
    ),
  );
  return document.body;
}

const pick = (h: Hex) =>
  document.body.querySelector(`[data-raiders-pick="${hexKey(h)}"]`) as SVGCircleElement;
const send = () => document.body.querySelector("[data-raiders-treason-send]") as HTMLButtonElement;
const undo = () => document.body.querySelector("[data-raiders-treason-undo]") as HTMLButtonElement;
const step = () => document.body.querySelector("[data-raiders-treason-step]")!.textContent;

describe("building the plan", () => {
  // Treason sends every move in one message and the engine refuses a plan of
  // the wrong length, so a player must be able to see and unpick the pair
  // before sending.
  it("sends only a complete plan", () => {
    render({});
    expect(send().disabled).toBe(true);
    act(() => pick(A).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => pick(C).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(send().disabled).toBe(true);
    act(() => pick(B).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => pick(D).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(send().disabled).toBe(false);
  });

  it("sends a from and a to per move, in the order they were picked", () => {
    const plans: TreasonMove[][] = [];
    render({ onPlan: (m) => plans.push(m) });
    for (const h of [A, C, B, D])
      act(() => pick(h).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => send().click());
    expect(plans).toEqual([
      [
        { from: A, to: C },
        { from: B, to: D },
      ],
    ]);
  });

  // One-shot, like the camel panels: a second press in flight would send a
  // second Treason after the card has resolved.
  it("sends the plan once", () => {
    const plans: TreasonMove[][] = [];
    render({ onPlan: (m) => plans.push(m) });
    for (const h of [A, C, B, D])
      act(() => pick(h).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => send().click());
    act(() => send().click());
    expect(plans).toHaveLength(1);
  });

  it("undoes half a move first, then whole ones", () => {
    render({});
    expect(undo().disabled).toBe(true);
    act(() => pick(A).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(step()).toContain("where that raider goes");
    act(() => undo().click());
    expect(step()).toContain("take a raider from");
    act(() => pick(A).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => pick(C).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(
      document.body
        .querySelector("[data-raiders-treason-count]")
        ?.getAttribute("data-raiders-treason-count"),
    ).toBe("1");
    act(() => undo().click());
    expect(
      document.body
        .querySelector("[data-raiders-treason-count]")
        ?.getAttribute("data-raiders-treason-count"),
    ).toBe("0");
  });
});

describe("supply as source", () => {
  // With fewer than 2 raiders on the board, take one or both from the supply.
  // A move from the supply has no `from`.
  it("omits `from` once the board has no raiders left", () => {
    const plans: TreasonMove[][] = [];
    render({ sources: [A], onPlan: (m) => plans.push(m) });
    act(() => pick(A).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => pick(C).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(step()).toContain("from the supply");
    act(() => pick(D).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => send().click());
    expect(plans).toEqual([[{ from: A, to: C }, { to: D }]]);
  });

  it("takes both from the supply when the board has none at all", () => {
    const plans: TreasonMove[][] = [];
    render({ sources: [], onPlan: (m) => plans.push(m) });
    act(() => pick(C).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => pick(D).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => send().click());
    expect(plans).toEqual([[{ to: C }, { to: D }]]);
  });
});

describe("a shortened Treason", () => {
  // The card moves fewer than two when the board and supply can't furnish two,
  // or there aren't two distinct unconquered hexes. A wrong-length plan is
  // refused, so the panel asks for the count it was given.
  it("is ready at the count it was given", () => {
    render({ destinations: [C], count: 1 });
    act(() => pick(A).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => pick(C).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(send().disabled).toBe(false);
    expect(step()).toContain("ready");
  });
});

describe("keyboard map control", () => {
  // The picks are SVG circles with no focus or name of their own. A plan made
  // with Tab and Enter must match one made with clicks.
  const key = (h: Hex, k: string) =>
    act(() => pick(h).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

  it("names each pick by its effect", () => {
    render({});
    expect(pick(A).getAttribute("role")).toBe("button");
    expect(pick(A).getAttribute("tabindex")).toBe("0");
    expect(pick(A).getAttribute("aria-label")).toBe("Take a raider from wood 5");
    key(A, "Enter");
    expect(pick(C).getAttribute("aria-label")).toBe("Move the raider to wood 5");
  });

  it("builds and sends a plan from Enter and Space alone", () => {
    const plans: TreasonMove[][] = [];
    render({ onPlan: (m) => plans.push(m) });
    key(A, "Enter");
    key(C, " ");
    key(B, "Enter");
    key(D, "Enter");
    act(() => send().click());
    expect(plans).toEqual([
      [
        { from: A, to: C },
        { from: B, to: D },
      ],
    ]);
  });
});
