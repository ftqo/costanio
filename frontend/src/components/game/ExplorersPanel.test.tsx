import { afterEach, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { ExplorersPanel } from "./ExplorersPanel";
import { previewView } from "@/lib/board3d/previewFixture";
import { explorersExt, type FullView } from "@/lib/types";
const a = { q: 0, r: 0, side: 0 } as const;
const b = { q: 0, r: 0, side: 1 } as const;
i18n.load("en", {});
i18n.activate("en");
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});
function render(movement: boolean, docked = false, change?: (v: FullView) => void) {
  const view = {
    ...previewView,
    players: [{ ...previewView.players[0], hand: [0, 4, 4, 4, 4, 4] }],
    bank: [0, 19, 0, 19, 19, 19],
    ext: {
      explorers: {
        movement,
        anchors: docked ? [a] : [],
        ships: [{ id: 1, owner: 0, e: { a, b }, left: 4, hold: { haul: 1 } }],
        seats: [
          {
            gold: 4,
            track: [0, 0, 0],
            ships_left: 2,
            settlers_left: 2,
            crews_left: 4,
            harbours_left: 2,
          },
        ],
      },
    },
  } as unknown as FullView;
  change?.(view);
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  const send = vi.fn();
  act(() =>
    root.render(
      <I18nProvider i18n={i18n}>
        <ExplorersPanel view={view} seat={0} onSend={send} onArm={vi.fn()} onClose={vi.fn()} />
      </I18nProvider>,
    ),
  );
  return { el, send };
}
const button = (el: HTMLElement, label: string) =>
  Array.from(el.querySelectorAll("button")).find((b) => b.textContent === label)!;
test("gold purchases name resources and respect the bank's stock", () => {
  const { el, send } = render(false);
  const groups = Array.from(el.querySelectorAll<HTMLElement>('[role="group"]'));
  expect(groups).toHaveLength(5);
  expect(groups.every((g) => g.getAttribute("aria-label"))).toBe(true);
  expect(button(groups[1], "Buy for 2 gold").disabled).toBe(true);
  act(() => button(groups[0], "Buy for 2 gold").click());
  expect(send).toHaveBeenCalledWith("explorers_gold_buy", { res: 1 });
  expect(el.textContent).not.toContain("Buy 1");
});
test("delivery is unavailable away from the Council anchors", () => {
  const { el } = render(true);
  expect(button(el, "Deliver to the Council").disabled).toBe(true);
  expect(el.textContent).toContain("1 fish haul");
  expect(el.textContent).not.toContain("0 settlers");
});
test("a docked ship can deliver its cargo during movement", () => {
  const { el, send } = render(true, true);
  act(() => button(el, "Deliver to the Council").click());
  expect(send).toHaveBeenCalledWith("explorers_deliver", { ship_id: 1 });
  expect(el.textContent).not.toContain("Start the Movement phase");
});

test("storage purchases ask for the harbour", () => {
  const { el, send } = render(false, false, (v) => {
    const x = explorersExt(v)!;
    x.harbours = [{ v: a, owner: 0, basin: {} }];
  });
  const bay = el.querySelector<HTMLElement>('[data-cargo-bay="harbour-0"]')!;
  act(() => button(bay, "Hire crew here").click());
  expect(send).toHaveBeenCalledWith("explorers_buy_cargo", {
    at_ship: false,
    v: a,
    settler: false,
  });
  expect(
    button(el.querySelector<HTMLElement>('[data-cargo-bay="ship-1"]')!, "Hire crew here").disabled,
  ).toBe(true);
});
test("docked ships can load and unload single-slot cargo", () => {
  const { el, send } = render(true, false, (v) => {
    const x = explorersExt(v)!;
    x.ships![0].hold = { crew: 1 };
    x.harbours = [{ v: a, owner: 0, basin: { spice: 1 } }];
  });
  act(() => button(el, "Load Spice sack").click());
  expect(send).toHaveBeenCalledWith("explorers_load", { ship_id: 1, cargo: { spice: 1 } });
  act(() => button(el, "Unload Crew").click());
  expect(send).toHaveBeenCalledWith("explorers_unload", { ship_id: 1, cargo: { crew: 1 } });
});
test("a spent allowance can buy wool movement once", () => {
  const { el } = render(true, false, (v) => {
    explorersExt(v)!.ships![0].left = 0;
  });
  const speed = Array.from(el.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("sheep"),
  )!;
  expect(speed.disabled).toBe(false);
});
test("used Fast Gold villages stop offering sales", () => {
  const { el } = render(false, false, (v) => {
    const seat = explorersExt(v)!.seats![0];
    seat.villages = [[], [], [true, false]];
    seat.fast_gold = 1;
  });
  expect(
    Array.from(el.querySelectorAll("button")).some((b) => b.textContent === "Sell 1 for 1 gold"),
  ).toBe(false);
});

test("offers cargo discard only when docked storage is full", () => {
  const { el, send } = render(false, false, (v) => {
    const x = explorersExt(v)!;
    x.harbours = [{ v: a, owner: 0, basin: { settler: 1 } }];
  });
  const bay = el.querySelector<HTMLElement>('[data-cargo-bay="harbour-0"]')!;
  act(() => button(bay, "Discard Settler").click());
  expect(send).toHaveBeenCalledWith("explorers_jettison", {
    at_ship: false,
    v: a,
    cargo: { settler: 1 },
  });
});

test("a ship that bought speed cannot buy it again", () => {
  const { el } = render(true, false, (v) => {
    explorersExt(v)!.ships![0].sped = true;
  });
  expect(button(el, "+2 movement for a sheep").disabled).toBe(true);
});
test("ships are numbered within the seat's own fleet, not by global id", () => {
  // Ships are numbered within the seat; the id is global across the table.
  const { el } = render(true, false, (v) => {
    explorersExt(v)!.ships![0].id = 7;
  });
  const row = el.querySelector('[data-explorers-ship="7"]')!;
  expect(row.textContent).toContain("Ship 1");
  expect(row.textContent).not.toContain("Ship 7");
});

test("the supply line counts each piece in the singular when there is one", () => {
  const { el } = render(false, false, (v) => {
    const seat = explorersExt(v)!.seats![0];
    seat.ships_left = 1;
    seat.settlers_left = 1;
    seat.crews_left = 1;
    seat.harbours_left = 1;
  });
  expect(el.textContent).toContain("1 ship, 1 settler, 1 crew, 1 harbour settlement");
  expect(el.textContent).not.toContain("1 settlers");
});
test("ship buttons explain why they are disabled before Movement", () => {
  const { el } = render(false);
  for (const label of ["Sail", "+2 movement for a sheep", "Deliver to the Council"]) {
    const b = button(el, label);
    expect(b.disabled).toBe(true);
    expect(b.title).toMatch(/Movement phase/);
  }
});
test("a Fast Gold sale offers commodities only where Knights deals them", () => {
  const { el } = render(false, false, (v) => {
    explorersExt(v)!.seats![0].villages = [[], [], [true]];
  });
  expect(el.textContent).toContain("Sell one resource for one gold.");
  expect(el.textContent).not.toContain("commodity");
});

// The whole bordered box of each disclosure toggles, not just its text line.
test("every disclosure row is the whole bordered box", () => {
  render(false, true);
  const rows = Array.from(document.body.querySelectorAll("summary"));
  // The missions are always in view, so they aren't a disclosure.
  expect(rows.map((s) => s.textContent)).toEqual(["Crews, settlers and storage", "Trade gold"]);
  for (const s of rows) {
    expect(s.className.split(" ")).toEqual(expect.arrayContaining(["-m-3", "p-3"]));
    expect(s.parentElement!.className).toContain("p-3");
  }
});

// The fleet-wide moves (leaving the Action phase, fishing) live in the pinned
// footer, since the body overflows the panel at 1280x800.
test("the phase's own moves sit in the dialog's pinned footer", () => {
  for (const movement of [false, true]) {
    const { el, send } = render(movement);
    const footer = el.querySelector<HTMLElement>("[role=dialog] [data-overlay-footer]")!;
    expect(footer).toBeTruthy();
    expect(footer.className.split(" ")).toContain("sticky");
    expect(el.querySelector("[role=dialog]")!.lastElementChild).toBe(footer);
    expect(button(footer, "Fish for the Council")).toBeTruthy();
    const start = button(footer, "Start the Movement phase");
    if (movement) expect(start).toBeUndefined();
    else {
      act(() => start.click());
      expect(send).toHaveBeenCalledWith("explorers_enter_movement");
    }
    act(() => root.unmount());
    document.body.innerHTML = "";
  }
});
// Explorers' gold chip must draw an icon, not an empty slot.
test("the gold chip draws the bullion glyph", () => {
  const { el } = render(false);
  expect(el.querySelector('[data-explorers-gold] svg[data-glyph="gold"]')).not.toBeNull();
});
