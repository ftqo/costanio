import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { ExpansionShelf } from "./ExpansionShelf";
import { VISIBLE_EXPANSIONS, EXPANSION_MODULE, type Expansions } from "@/lib/format";
import { selectionConflicts, type CompatPair } from "@/lib/expansionCompat";

/**
 * The picker's compatibility behaviour, driven by an injected table.
 *
 * The shipped set does conflict (Explorers refuses every partner but Knights,
 * and Wagons refuses Islands), but these test that the component reads a
 * table, not the rules; lib/expansionCompat.test.ts checks the real table
 * against the engine's golden file. Using the real table here would tie markup
 * tests to rules decisions.
 *
 * The synthetic pairs are the shipped module keys with made-up verdicts.
 */
const SYNTHETIC_CONFLICT: readonly CompatPair[] = [
  {
    a: "cak",
    b: "islands",
    reason: msg({
      id: "test.syntheticConflict",
      message: "Knights and Islands cannot share a board in this test.",
    }),
  },
];

const SYNTHETIC_WARNING: readonly CompatPair[] = [
  {
    a: "caravans",
    b: "fishermen",
    reason: msg({
      id: "test.syntheticWarning",
      message: "Fishermen turns the desert into a lake in this test.",
    }),
  },
];

const NONE: Expansions = {
  islands: false,
  knights: false,
  fishermen: false,
  caravans: false,
  harbormaster: false,
  rivers: false,
  raiders: false,
  wagons: false,
  explorers: false,
};

/** Every picker key, so a new expansion joins these loops by existing. */
const ALL_KEYS = Object.keys(EXPANSION_MODULE) as (keyof Expansions)[];

afterEach(() => {
  document.body.innerHTML = "";
});

function render(props: Partial<Parameters<typeof ExpansionShelf>[0]> & { exp: Expansions }) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const toggles: [keyof Expansions, boolean][] = [];
  act(() =>
    createRoot(el).render(
      <ExpansionShelf
        disabled={false}
        onToggle={(k, on) => toggles.push([k, on])}
        conflicts={SYNTHETIC_CONFLICT}
        warnings={SYNTHETIC_WARNING}
        {...props}
      />,
    ),
  );
  return { el, toggles };
}

/**
 * The card for one picker key, found by the module name it carries, not by the
 * translated label or the display order.
 */
function card(el: HTMLElement, key: keyof Expansions): HTMLElement {
  const found = el.querySelector<HTMLElement>(`[data-expansion="${EXPANSION_MODULE[key]}"]`);
  expect(found, `no card rendered for ${key}`).toBeTruthy();
  return found!;
}

const switchIn = (c: HTMLElement) => c.querySelector("button")!;

/** The scenarios shelf is a dropdown, closed unless a scenario is on. */
function openScenarios(el: HTMLElement) {
  const btn = el.querySelector<HTMLButtonElement>("[data-scenarios-toggle]");
  expect(btn, "no scenarios dropdown rendered").toBeTruthy();
  if (btn!.getAttribute("aria-expanded") !== "true") act(() => btn!.click());
}

describe("the expansion shelf", () => {
  it("puts scenarios in a closed Beta dropdown", () => {
    const { el } = render({ exp: NONE });
    const btn = el.querySelector<HTMLButtonElement>("[data-scenarios-toggle]")!;
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.textContent).toMatch(/Scenarios/);
    // The Beta badge is on the heading.
    expect(btn.querySelector("[data-beta-badge]")?.textContent).toBe("Beta");
    expect(el.querySelector('[data-expansion="caravans"]')).toBeNull();
    act(() => btn.click());
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(el.querySelector('[data-expansion="caravans"]')).toBeTruthy();
    // The heading carries Beta, so the cards under it do not repeat it.
    expect(card(el, "caravans").textContent).not.toMatch(/Beta/);
  });

  it("opens the scenarios dropdown when a scenario is on", () => {
    const { el } = render({ exp: { ...NONE, caravans: true } });
    expect(el.querySelector("[data-scenarios-toggle]")?.getAttribute("aria-expanded")).toBe("true");
    expect(el.querySelector('[data-expansion="caravans"]')).toBeTruthy();
  });

  it("renders every visible expansion enabled with nothing selected", () => {
    const { el } = render({ exp: NONE });
    openScenarios(el);
    // Counted against the shelf's own list (VISIBLE_EXPANSIONS, exactly what it
    // renders) rather than a literal, so a new expansion keeps this honest.
    expect(el.querySelectorAll("[data-expansion]")).toHaveLength(VISIBLE_EXPANSIONS.length);
    for (const [key] of VISIBLE_EXPANSIONS) {
      expect(switchIn(card(el, key)).hasAttribute("disabled"), key).toBe(false);
    }
  });

  // Each switch must be named by its label, not announced as a bare "switch".
  it("names every switch after its expansion", () => {
    const { el } = render({ exp: NONE });
    openScenarios(el);
    for (const [key] of VISIBLE_EXPANSIONS) {
      const c = card(el, key);
      const name = c.querySelector("span")!.textContent;
      expect(switchIn(c).getAttribute("aria-label"), key).toBe(name);
    }
  });

  it("disables a conflicting toggle and shows the reason", () => {
    const { el } = render({ exp: { ...NONE, knights: true } });
    openScenarios(el);
    const islands = card(el, "islands");
    expect(switchIn(islands).hasAttribute("disabled")).toBe(true);
    expect(islands.textContent).toContain("cannot share a board in this test");
    // The reason is also on the control, for a pointer user.
    expect(islands.querySelector("[title]")?.getAttribute("title")).toContain(
      "cannot share a board",
    );
    // Only that one: an unrelated switch is untouched.
    expect(switchIn(card(el, "caravans")).hasAttribute("disabled")).toBe(false);
  });

  it("keeps both switches of an active conflict enabled", () => {
    // Both on at once (an old lobby, a pasted config): the host must be able to
    // turn one off, so neither is greyed out.
    const { el } = render({ exp: { ...NONE, knights: true, islands: true } });
    expect(switchIn(card(el, "knights")).hasAttribute("disabled")).toBe(false);
    expect(switchIn(card(el, "islands")).hasAttribute("disabled")).toBe(false);
  });

  it("shows a warning pair inline without disabling anything", () => {
    const { el } = render({ exp: { ...NONE, caravans: true, fishermen: true } });
    const note = el.querySelector('[data-compat-warning="caravans+fishermen"]');
    expect(note?.textContent).toContain("turns the desert into a lake");
    expect(switchIn(card(el, "caravans")).hasAttribute("disabled")).toBe(false);
    expect(switchIn(card(el, "fishermen")).hasAttribute("disabled")).toBe(false);
  });

  it("shows no warning until both halves of the pair are on", () => {
    const { el } = render({ exp: { ...NONE, caravans: true } });
    expect(el.querySelector("[data-compat-warning]")).toBeNull();
  });

  it("reports a toggle with the key and its current state", () => {
    const { el, toggles } = render({ exp: { ...NONE, caravans: true } });
    act(() => switchIn(card(el, "caravans")).click());
    expect(toggles).toEqual([["caravans", true]]);
  });

  it("disables every switch for a non-host", () => {
    const { el } = render({ exp: NONE, disabled: true });
    openScenarios(el);
    for (const key of ALL_KEYS) {
      expect(switchIn(card(el, key)).hasAttribute("disabled"), key).toBe(true);
    }
  });

  // Seven of the nine modules compose; the other two are refused for reasons in
  // engine/compat.go. Wagons can't cross water, and an island board has no
  // single landmass for the trade route; Explorers is Standalone (its board is a
  // partition, not a terrain layout), so it refuses every partner. The shelf
  // must not offer a table the lobby would refuse.
  //
  // Asserted: every module that is on can be switched off, the two that can't
  // join are greyed, and the real tables produce no warning banner here.
  it("disables only the modules the real tables refuse", () => {
    const on: (keyof Expansions)[] = [
      "islands",
      "knights",
      "fishermen",
      "caravans",
      "harbormaster",
      "rivers",
      "raiders",
    ];
    const blocked: (keyof Expansions)[] = ["wagons", "explorers"];
    const exp = Object.fromEntries(
      ALL_KEYS.map((k) => [k, on.includes(k)]),
    ) as unknown as Expansions;
    const { el } = render({ exp, conflicts: undefined, warnings: undefined });
    for (const key of on) {
      expect(switchIn(card(el, key)).hasAttribute("disabled"), key).toBe(false);
    }
    for (const key of blocked) {
      expect(switchIn(card(el, key)).hasAttribute("disabled"), key).toBe(true);
    }
    // The two lists cover the whole picker, so a new expansion fails this
    // rather than going unchecked.
    expect([...on, ...blocked].sort()).toEqual([...ALL_KEYS].sort());
    expect(el.querySelector("[data-compat-warning]")).toBeNull();
  });

  it("maps every picker key to its module name", () => {
    // `knights` is `cak` on the wire; looking the picker key up in the module
    // table would find nothing for that one expansion.
    expect(EXPANSION_MODULE).toEqual({
      raiders: "raiders",
      wagons: "wagons",
      explorers: "explorers",
      islands: "islands",
      knights: "cak",
      fishermen: "fishermen",
      caravans: "caravans",
      harbormaster: "harbormaster",
      rivers: "rivers",
    });
  });

  // Harbormaster's conflict, checked off the real table rather than the
  // synthetic one, and through the table rather than the shelf.
  it("refuses harbormaster with explorers", () => {
    const [pair] = selectionConflicts(["harbormaster", "explorers"]);
    expect(pair).toBeTruthy();
    expect(i18n._(pair.reason)).toContain("no harbours");
    // And it composes with everything the picker can actually reach.
    expect(selectionConflicts(["harbormaster", "cak", "islands", "fishermen", "caravans"])).toEqual(
      [],
    );
  });
});

// Renders the raw English when a descriptor has no catalogue entry, which the
// synthetic ids above rely on.
it("renders an uncatalogued descriptor as its source text", () => {
  expect(i18n._(SYNTHETIC_CONFLICT[0].reason)).toContain("cannot share a board in this test");
});

describe("scenario release visibility", () => {
  it("offers only core expansions in production", () => {
    const { el } = render({ exp: NONE, allowScenarios: false });
    expect(el.querySelectorAll("[data-expansion]")).toHaveLength(2);
    expect(el.querySelector("[data-scenarios-toggle]")).toBeNull();
    card(el, "islands");
    card(el, "knights");
  });
  it("keeps an API-selected scenario visible and removable", () => {
    const { el, toggles } = render({ exp: { ...NONE, wagons: true }, allowScenarios: false });
    act(() => switchIn(card(el, "wagons")).click());
    expect(toggles).toEqual([["wagons", true]]);
    expect(el.querySelector('[data-expansion="fishermen"]')).toBeNull();
  });
  it("offers every scenario in development", () => {
    const { el } = render({ exp: NONE, allowScenarios: true });
    openScenarios(el);
    expect(el.querySelectorAll("[data-expansion]")).toHaveLength(9);
  });
});
