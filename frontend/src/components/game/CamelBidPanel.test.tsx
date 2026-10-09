import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CamelBidPanel } from "./CamelBidPanel";
import type { Board, CamelPath, CaravansExt, Hand, Vertex } from "@/lib/types";

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

const board = {
  radius: 1,
  tiles: [{ hex: { q: 0, r: 0 }, res: "wood" }],
  robber: { q: 9, r: 9 },
  harbors: [],
} as unknown as Board;

const v = (q: number, r: number, side: 0 | 1): Vertex => ({ q, r, side });
const path = (caravan: number): CamelPath => ({
  caravan,
  e: { a: v(caravan, 0, 0), b: v(caravan, 0, 1) },
});

// [_, wood, brick, sheep, wheat, ore]. Wool and grain (3 and 4) are the default
// pair; alongside Knights the vote is bid in brick and lumber (1 and 2), which
// the panel reads off `ext.bid_resources`.
const hand = (sheep: number, wheat: number): Hand => [0, 0, 0, sheep, wheat, 0];

interface Sent {
  cards: [number, number];
  path?: CamelPath;
}

function render(opts: { hand?: Hand; ext?: CaravansExt; pending?: number[]; paths?: CamelPath[] }) {
  const sent: Sent[] = [];
  act(() =>
    root.render(
      <CamelBidPanel
        board={board}
        ext={opts.ext ?? {}}
        hand={opts.hand ?? hand(5, 5)}
        paths={opts.paths ?? []}
        pending={opts.pending ?? []}
        seatName={(s) => `Seat ${s + 1}`}
        onBid={(cards, p) => sent.push({ cards, path: p })}
        onClose={() => {}}
      />,
    ),
  );
  return sent;
}

const q = (sel: string) => document.body.querySelector<HTMLElement>(sel);
const qq = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)];
const click = (sel: string) => act(() => q(sel)!.click());

// The round is open and sequential (docs/rules/scenarios.md): bids go face up
// clockwise from the seat that just finished, so a later bidder sees earlier
// bids. The panel must show the tally.
describe("open round: cast bids are shown", () => {
  it("shows earlier bids in cast order", () => {
    render({
      hand: hand(1, 0),
      pending: [2],
      ext: {
        voting: true,
        bidded: [1, 3],
        bids: [
          { player: 1, cards: [7, 0] },
          { player: 3, cards: [0, 9] },
        ],
      },
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("7");
    expect(text).toContain("9");
    expect(q("[data-camel-bid-cast]")!.getAttribute("data-camel-bid-cast")).toBe("2");
    // In cast order, not seat order and not sorted.
    expect(qq("[data-camel-bid-cast-seat]").map((el) => el.dataset.camelBidCastSeat)).toEqual([
      "1",
      "3",
    ]);
  });

  it("lists an empty bid as an answer", () => {
    render({ ext: { voting: true, bidded: [1], bids: [{ player: 1, cards: [0, 0] }] } });
    expect(q("[data-camel-bid-cast-seat='1']")!.textContent).toMatch(/bid nothing/i);
  });

  it("names the placement a bid asked for", () => {
    render({
      ext: { voting: true, bidded: [1], bids: [{ player: 1, cards: [2, 0], path: path(1) }] },
    });
    // Caravans are 1-based to a reader and 0-based on the wire.
    expect(q("[data-camel-bid-cast-seat='1']")!.textContent).toContain("caravan 2");
  });

  it("says nothing about anyone else when nothing has been cast", () => {
    render({ pending: [] });
    expect(q("[data-camel-bid-cast]")).toBeNull();
    expect(q("[data-camel-bid-pending]")).toBeNull();
  });
});

// Alongside Knights the vote is bid in brick and lumber instead of wool and
// grain; the steppers must name and cap against those piles.
describe("bid resources come from the server", () => {
  it("defaults to wool and grain when the server sends no pair", () => {
    render({ hand: hand(2, 2) });
    expect(q("[data-camel-bid-row='3']")).toBeTruthy();
    expect(q("[data-camel-bid-row='4']")).toBeTruthy();
  });

  it("bids brick and lumber where the ruleset says so", () => {
    // [_, wood, brick, ...]: two lumber and three brick.
    const knightsHand = [0, 2, 3, 0, 0, 0] as unknown as Hand;
    const sent = render({
      hand: knightsHand,
      ext: { voting: true, bid_resources: [2, 1] },
    });
    expect(q("[data-camel-bid-row='3']")).toBeNull();
    expect(q("[data-camel-bid-row='4']")).toBeNull();
    // Capped against the pile the wire named, in the order it named them.
    click("[data-camel-bid-plus='2']"); // brick, 3 held
    click("[data-camel-bid-plus='1']"); // lumber, 2 held
    click("[data-camel-bid-send]");
    expect(sent).toEqual([{ cards: [1, 1], path: undefined }]);
  });
});

// What the server sends: board.Resource marshals as its name, so the wire says
// ["sheep","wheat"] (["brick","wood"] under Knights), not the indices used by
// the fixtures above.
describe("the pair as the server spells it", () => {
  it("renders the wool and grain steppers from resource names", () => {
    const sent = render({
      hand: hand(2, 1),
      ext: { voting: true, bid_resources: ["sheep", "wheat"] },
    });
    expect(q("[data-camel-bid-row='3']")).toBeTruthy();
    expect(q("[data-camel-bid-row='4']")).toBeTruthy();
    click("[data-camel-bid-plus='3']");
    click("[data-camel-bid-send]");
    expect(sent).toEqual([{ cards: [1, 0], path: undefined }]);
  });

  it("renders brick and lumber from the Knights pair's names", () => {
    const knightsHand = [0, 2, 3, 0, 0, 0] as unknown as Hand;
    const sent = render({
      hand: knightsHand,
      ext: { voting: true, bid_resources: ["brick", "wood"] },
    });
    click("[data-camel-bid-plus='2']");
    click("[data-camel-bid-send]");
    expect(sent).toEqual([{ cards: [1, 0], path: undefined }]);
  });
});

// The map has to be big enough to read, and show buildings, since which
// settlements a caravan passes is what a bid is about.
describe("the camel map", () => {
  it("does not shrink inside the dialog's flex column", () => {
    render({});
    const svg = q("[role=dialog] svg[viewBox]") ?? q("svg[viewBox]");
    expect(svg?.getAttribute("class") ?? "").toContain("shrink-0");
  });

  it("draws every settlement and city in its owner's colour", () => {
    act(() =>
      root.render(
        <CamelBidPanel
          board={board}
          ext={{ voting: true }}
          hand={hand(1, 1)}
          paths={[]}
          pending={[]}
          seatName={(s) => `Seat ${s + 1}`}
          buildings={[
            { v: v(0, 0, 0), owner: 2, city: false },
            { v: v(0, 0, 1), owner: 1, city: true },
          ]}
          colorOf={(s) => `seat-${s}`}
          onBid={() => {}}
          onClose={() => {}}
        />,
      ),
    );
    const marks = qq("[data-camel-building]");
    expect(marks.map((m) => [m.tagName.toLowerCase(), m.getAttribute("fill")])).toEqual([
      ["circle", "seat-2"],
      ["rect", "seat-1"],
    ]);
  });
});

describe("placement choices that share a caravan", () => {
  it("are numbered rather than labelled identically", () => {
    const a: CamelPath = { caravan: 0, e: { a: v(0, 0, 0), b: v(0, 0, 1) } };
    const b: CamelPath = { caravan: 0, e: { a: v(1, 0, 0), b: v(1, 0, 1) } };
    render({ paths: [a, b, path(2)] });
    const rows = qq("[data-camel-bid-path]:not([data-camel-bid-path='none'])").map((r) =>
      r.textContent?.trim(),
    );
    expect(rows).toEqual(["Caravan 1, choice 1", "Caravan 1, choice 2", "Caravan 3"]);
  });
});

describe("abstaining", () => {
  it("sits-this-one-out sends [0, 0]", () => {
    const sent = render({});
    click("[data-camel-bid-abstain]");
    expect(sent).toEqual([{ cards: [0, 0], path: undefined }]);
  });

  it("abstains even after the steppers have been moved off zero", () => {
    // The engine reads the command, not the panel's state: a player who dialled
    // up a bid must still be able to abstain outright.
    const sent = render({ hand: hand(3, 3) });
    click("[data-camel-bid-plus='3']");
    click("[data-camel-bid-plus='4']");
    expect(q("[data-camel-bid-total]")!.getAttribute("data-camel-bid-total")).toBe("2");
    click("[data-camel-bid-abstain]");
    expect(sent).toEqual([{ cards: [0, 0], path: undefined }]);
  });

  it("Bid is disabled at zero", () => {
    render({});
    expect((q("[data-camel-bid-send]") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("stepper limits", () => {
  it("cannot dial past the cards held", () => {
    render({ hand: hand(1, 0) });
    click("[data-camel-bid-plus='3']");
    expect(q("[data-camel-bid-value='3']")!.textContent).toBe("1");
    expect((q("[data-camel-bid-plus='3']") as HTMLButtonElement).disabled).toBe(true);
    // Nothing to bid at all in wheat.
    expect((q("[data-camel-bid-plus='4']") as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends both piles as named, positionally", () => {
    const sent = render({ hand: hand(2, 2) });
    click("[data-camel-bid-plus='3']");
    click("[data-camel-bid-plus='3']");
    click("[data-camel-bid-plus='4']");
    click("[data-camel-bid-send]");
    expect(sent).toEqual([{ cards: [2, 1], path: undefined }]);
  });
});

// A bid may name a placement (bids naming the same one pool their votes); one
// naming none joins no coalition. Optional, so the default is none.
describe("a bid may name the placement it wants", () => {
  const paths = [path(0), path(1)];

  it("names no placement by default", () => {
    const sent = render({ hand: hand(2, 0), paths });
    expect((q("[data-camel-bid-path='none']") as HTMLElement).getAttribute("aria-pressed")).toBe(
      "true",
    );
    click("[data-camel-bid-plus='3']");
    click("[data-camel-bid-send]");
    expect(sent[0].path).toBeUndefined();
  });

  it("sends the (caravan, edge) PAIR when one is chosen", () => {
    const sent = render({ hand: hand(2, 0), paths });
    click("[data-camel-bid-path='1:1,0,0|1,0,1']");
    click("[data-camel-bid-plus='3']");
    click("[data-camel-bid-send]");
    expect(sent[0].path).toEqual(paths[1]);
  });

  it("pressing the chosen row again goes back to naming nothing", () => {
    const sent = render({ hand: hand(2, 0), paths });
    click("[data-camel-bid-path='1:1,0,0|1,0,1']");
    click("[data-camel-bid-path='1:1,0,0|1,0,1']");
    click("[data-camel-bid-plus='3']");
    click("[data-camel-bid-send]");
    expect(sent[0].path).toBeUndefined();
  });

  it("offers no picker at all when the server published no placements", () => {
    // Seats not on the clock get an empty list, as does an older server. The
    // fallback is to offer no placements.
    render({ paths: [] });
    expect(q("[data-camel-bid-paths]")).toBeNull();
  });
});

describe("rules text", () => {
  it("states the open round, the coalition rule and the clamp", () => {
    render({ hand: hand(4, 4) });
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/open and goes clockwise/i);
    expect(text).toMatch(/face up/i);
    expect(text).toMatch(/pool their votes/i);
    expect(text).toMatch(/pay when the round closes/i);
    expect(text).toMatch(/trimmed to what you still hold/i);
    // And it doesn't claim the bids are sealed.
    expect(text).not.toMatch(/sealed/i);
  });
});

// The running total is a tally of the steppers.
//
// At zero it must not say the player is sitting out: nothing has been sent, and
// bidding nothing is an answer ("Bid nothing").
//
// "{total} votes" would read "1 votes", and an ICU plural doesn't fix it: a
// single-plural-form locale with a blank translation falls back to the English
// source under its own plural rules, so n=1 takes `other`. lib/i18n.test covers
// the catalogues; this pins the English.
describe("vote tally", () => {
  const tally = () => q("[data-camel-bid-total]")!.textContent.trim();
  const bump = (idx: number, n: number) => {
    for (let i = 0; i < n; i++) click(`[data-camel-bid-plus="${idx}"]`);
  };

  it("never mentions sitting out", () => {
    render({ hand: hand(5, 5) });
    expect(tally()).toBe("No votes");
    expect(document.body.textContent).not.toMatch(/sitting this one out/i);
    // And the button offers the answer that zero actually is.
    expect(q("[data-camel-bid-abstain]")!.textContent).toMatch(/Bid nothing/);
  });

  it("uses the singular at one", () => {
    render({ hand: hand(5, 5) });
    bump(3, 1); // one sheep
    expect(tally()).toBe("Votes: 1");
    expect(tally()).not.toBe("1 votes");
  });

  it("counts both piles together", () => {
    render({ hand: hand(5, 5) });
    bump(3, 2); // sheep
    bump(4, 1); // wheat
    expect(tally()).toBe("Votes: 3");
  });
});

describe("one answer per round", () => {
  // The panel unmounts only when the server's next view moves the clock off
  // this seat, so both buttons must lock after the first press or a double
  // click sends two bid_camel commands (the second refused with ALREADY_BID).
  it("a second click on Bid sends nothing more", () => {
    const sent = render({ hand: hand(2, 0) });
    click("[data-camel-bid-plus='3']");
    click("[data-camel-bid-send]");
    click("[data-camel-bid-send]");
    expect(sent).toEqual([{ cards: [1, 0], path: undefined }]);
  });

  it("disables both answers once one has gone", () => {
    render({ hand: hand(2, 0) });
    click("[data-camel-bid-plus='3']");
    click("[data-camel-bid-send]");
    expect((q("[data-camel-bid-send]") as HTMLButtonElement).disabled).toBe(true);
    expect((q("[data-camel-bid-abstain]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("abstaining also uses up the answer", () => {
    const sent = render({ hand: hand(2, 0) });
    click("[data-camel-bid-abstain]");
    expect(q("[data-camel-bid-send]")).toBeTruthy();
    click("[data-camel-bid-plus='3']");
    click("[data-camel-bid-send]");
    expect(sent).toEqual([{ cards: [0, 0], path: undefined }]);
  });
});

describe("waiting seats", () => {
  // The round is a table, one row per seat, so waiting seats line up under the
  // bids already cast.
  it("draws one waiting row per seat, clockwise from the viewer", () => {
    render({ pending: [3, 1] });
    expect(q("[data-camel-bid-pending]")!.getAttribute("data-camel-bid-pending")).toBe("2");
    const rows = qq("[data-camel-bid-pending-seat]");
    expect(rows.map((r) => r.dataset.camelBidPendingSeat)).toEqual(["3", "1"]);
    expect(rows[0].textContent).toContain("Seat 4");
    expect(rows[0].textContent).toMatch(/waiting/);
  });
});

describe("sticky footer", () => {
  // At 1280x800 the Bid buttons fell below the fold, so they live in the
  // dialog's pinned footer (Overlay `footer`) with the clock.
  it("puts both answers in the sticky footer, inside the dialog", () => {
    render({ hand: hand(1, 1), paths: [path(0), path(1)] });
    const footer = q("[role=dialog] [data-overlay-footer]")!;
    expect(footer).toBeTruthy();
    expect(footer.className.split(" ")).toContain("sticky");
    expect(footer.querySelector("[data-camel-bid-send]")).toBeTruthy();
    expect(footer.querySelector("[data-camel-bid-abstain]")).toBeTruthy();
    // And last, so the body scrolls behind it rather than below it.
    expect(q("[role=dialog]")!.lastElementChild).toBe(footer);
  });

  it("swaps the map below the steppers on a short screen", () => {
    render({ hand: hand(1, 1) });
    const body = q("[data-camel-bid-body]")!;
    expect(body.className).toContain("[@media(max-height:500px)]:flex-col-reverse");
    // Map first in the DOM, so a tall screen still reads map-then-bid.
    expect(body.firstElementChild!.tagName.toLowerCase()).toBe("svg");
  });
});
