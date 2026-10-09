import { test, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ProgressCardChoice } from "./ProgressCardChoice";
import {
  PROGRESS_CARDS,
  progressCardHint,
  progressCardName,
  progressSlot,
} from "@/lib/progressCards";

afterEach(() => {
  document.body.innerHTML = "";
});

function render(ui: React.ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(ui));
  return el;
}

// The Spy hand a thief picks from. Spans all three decks; each card must say
// what it does.
const SPY_HAND = ["crane", "intrigue", "merchant_fleet", "irrigation"];

// The face is the baked art, which carries the card's name. jsdom never loads
// an <img>, so every render below is the face before it loads, which is blank.
// The accessible name and the Tip hold either way, and the first two tests
// check those.

test("the choice's accessible name carries the effect, art or no art", () => {
  const el = render(<ProgressCardChoice card="crane" onSelect={() => {}} />);
  const label = el.querySelector("button")!.getAttribute("aria-label")!;
  expect(label).toContain("Crane");
  expect(label).toContain(
    "Upgrade one city-improvement track for one fewer commodity than normal.",
  );
});

test("names every card and its effect in a spy hand", () => {
  const el = render(
    <>
      {SPY_HAND.map((card) => (
        <ProgressCardChoice key={card} card={card} onSelect={() => {}} />
      ))}
    </>,
  );
  const labels = [...el.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
  for (const card of SPY_HAND) {
    const hit = labels.find((l) => l?.includes(progressCardName(card)));
    expect(hit, card).toBeTruthy();
    expect(hit, card).toContain(progressCardHint(card));
  }
});

test("it asks the pack for that card's own face", () => {
  expect(progressSlot("crane")).toBe("progress_crane");
  expect(progressSlot("merchant_fleet")).toBe("progress_merchant_fleet");
});

// Until the face loads the card is blank: no text face stands in for the art.
// The name and effect are still the button's label (tested above).
test("draws nothing in place of the face before it loads", () => {
  const el = render(<ProgressCardChoice card="crane" onSelect={() => {}} />);
  expect(el.textContent).toBe("");
  expect(el.querySelector("img")).toBeNull();
});

test("adds a Tip to the face", () => {
  const el = render(<ProgressCardChoice card="spy" onSelect={() => {}} />);
  const btn = el.querySelector("button")!;
  // React routes onFocus off the bubbling `focusin`, not the native `focus`.
  act(() => {
    btn.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  const tip = document.querySelector('[role="tooltip"]')!;
  expect(tip).toBeTruthy();
  expect(tip.textContent).toContain("Spy");
  expect(tip.textContent).toContain("Look at an opponent's progress cards");
});

test("selecting reports the wire id, not the display name", () => {
  const picked: string[] = [];
  const el = render(<ProgressCardChoice card="merchant_fleet" onSelect={(c) => picked.push(c)} />);
  act(() => el.querySelector("button")!.click());
  expect(picked).toEqual(["merchant_fleet"]);
});

test("a disabled choice cannot be selected", () => {
  const picked: string[] = [];
  const el = render(<ProgressCardChoice card="crane" disabled onSelect={(c) => picked.push(c)} />);
  const btn = el.querySelector("button")!;
  expect(btn.disabled).toBe(true);
  act(() => btn.click());
  expect(picked).toEqual([]);
});

// An id the table doesn't know yet must still read as a card, never a raw
// identifier: the picker is the one place a player can't look the card up.
test("an unknown card still gets a readable name and no bogus hint", () => {
  const el = render(<ProgressCardChoice card="future_card" onSelect={() => {}} />);
  const label = el.querySelector("button")!.getAttribute("aria-label")!;
  expect(label).toContain("Future Card");
  expect(label).not.toContain("future_card");
});

// The stripe marks the deck of origin (Trade, Politics, Science).
test("a card choice carries its deck's mark", () => {
  const el = render(<ProgressCardChoice card="crane" onSelect={() => {}} />);
  const mark = el.querySelector('[role="img"]')!;
  expect(mark).toBeTruthy();
  expect(mark.getAttribute("aria-label")).toBe("Science deck");
  expect((mark as HTMLElement).style.background).toContain("--color-papyrus");
});

test("the mark distinguishes the three decks", () => {
  const label = (card: string) =>
    render(<ProgressCardChoice card={card} onSelect={() => {}} />)
      .querySelector('[role="img"]')!
      .getAttribute("aria-label");
  expect(label("merchant_fleet")).toBe("Trade deck");
  expect(label("intrigue")).toBe("Politics deck");
  expect(label("crane")).toBe("Science deck");
});

// An id with no deck gets no mark, rather than one claiming a deck.
test("an unknown card gets no deck mark", () => {
  const el = render(<ProgressCardChoice card="future_card" onSelect={() => {}} />);
  expect(el.querySelector('[role="img"]')).toBeNull();
});

// Any progress card can be in a Spy hand, so a gap in the table is a card
// picked blind.
test("every progress card in the table has a non-empty effect sentence", () => {
  for (const [id, info] of Object.entries(PROGRESS_CARDS)) {
    expect(info.name, id).toBeTruthy();
    expect(info.hint.length, id).toBeGreaterThan(10);
  }
});
