import { test, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DockPanels, type DockPanel } from "./DockPanels";

afterEach(() => {
  document.body.innerHTML = "";
});

function render(ui: React.ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(ui));
  return { el, root };
}

// The real pair: the bank carries its counts on the trigger, the feed a glyph.
// Both are panels of one set, so they are mutually exclusive.
const PANELS: DockPanel[] = [
  {
    key: "table",
    icon: "🏦",
    title: "Bank",
    pill: <span>7 8 9</span>,
    content: <div>BANK CARD</div>,
  },
  { key: "feed", icon: "📜", title: "Table", content: <div>TABLE CARD</div> },
];

function trigger(el: HTMLElement, label: string) {
  return el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

/** The raised panel, found by the accessible name it borrows from its trigger. */
function panel(el: HTMLElement, label: string) {
  return el.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`);
}

test("a trigger toggles its own panel, and only one panel is up at a time", () => {
  const { el } = render(<DockPanels panels={PANELS} />);
  expect(el.textContent).not.toContain("BANK CARD");

  act(() => trigger(el, "Bank").click());
  expect(el.textContent).toContain("BANK CARD");
  expect(trigger(el, "Bank").getAttribute("aria-pressed")).toBe("true");

  // The pair shares a patch of screen, so a second panel replaces the first.
  act(() => trigger(el, "Table").click());
  expect(el.textContent).toContain("TABLE CARD");
  expect(el.textContent).not.toContain("BANK CARD");

  act(() => trigger(el, "Table").click());
  expect(el.textContent).not.toContain("TABLE CARD");
  expect(trigger(el, "Table").getAttribute("aria-pressed")).toBe("false");
});

// The dock is the fallback. The bank is here only below lg, and the feed only
// where the window is too narrow or too short for its island, so the row may
// hold one, both or neither. It must read right in all three cases.
test("a lone trigger keeps its slot", () => {
  const { el } = render(<DockPanels panels={[PANELS[1]]} />);
  const row = trigger(el, "Table").parentElement!;
  // Against the right edge, under the corner the panel opens in.
  expect(row.className).toContain("justify-end");
  expect(el.querySelectorAll("button[aria-pressed]").length).toBe(1);
  // And it still raises its own panel.
  act(() => trigger(el, "Table").click());
  expect(el.textContent).toContain("TABLE CARD");
});

test("renders no row without panels", () => {
  // Both surfaces are up in the right-hand column on a big desktop. An empty
  // row would leave its `mb-1.5` behind (6px of board for nothing).
  const { el } = render(<DockPanels panels={[]} />);
  expect(el.innerHTML).toBe("");
});

test("drops the bank trigger when the window widens mid-open", () => {
  // The panel can't stay up once its trigger is gone: crossing lg moves the
  // bank to the orb row, and crossing the feed's height threshold moves the
  // feed to its island, possibly while the panel is raised.
  const { el, root } = render(<DockPanels panels={PANELS} />);
  act(() => trigger(el, "Bank").click());
  expect(el.textContent).toContain("BANK CARD");
  act(() => root.render(<DockPanels panels={[PANELS[1]]} />));
  expect(el.textContent).not.toContain("BANK CARD");
  expect(trigger(el, "Table")).not.toBeNull();
  // And on to the desktop arrangement, where the row itself goes.
  act(() => root.render(<DockPanels panels={[]} />));
  expect(el.innerHTML).toBe("");
});

// The bank has one trigger, in one place (not also an orb in the top row
// below `lg`).
test("renders one trigger per panel, side by side", () => {
  const { el } = render(<DockPanels panels={PANELS} />);
  const row = trigger(el, "Bank").parentElement!;
  expect(row.contains(trigger(el, "Table"))).toBe(true);
  expect(row.className).toContain("justify-end");
  expect(el.querySelectorAll('button[aria-label="Bank"]').length).toBe(1);

  // The bank's trigger carries the counts; a panel with no `pill` gets a glyph.
  expect(trigger(el, "Bank").textContent).toContain("7 8 9");
  expect(trigger(el, "Table").textContent).toContain("📜");
});

// The panel opens in the bottom-right corner, where the feed's island sits on a
// taller window, so the feed stays put as the window changes. jsdom has no
// layout, so this checks the rule: pinned to the right inset, capped, and no
// width (with `left`, `right` and a width, CSS drops `right`).
test("a raised panel sits in the bottom right corner, above the dock", () => {
  const { el } = render(<DockPanels panels={PANELS} />);
  act(() => trigger(el, "Bank").click());
  const box = panel(el, "Bank")!;
  expect(box.className).toContain("ml-auto");
  expect(box.className).not.toContain("mx-auto");
  expect(box.className).toContain("max-w-[26rem]");
  expect(box.className).not.toMatch(/(^| )w-full/);
  // `bottom-full` of the dock cluster: the panel's bottom edge is the cluster's
  // top edge, so it can't reach the hotbar or dice.
  expect(box.className).toContain("bottom-full");
});

// Nothing pins itself open here: a dock panel covers the board near the shelf,
// so a press elsewhere closes it. The pinned card is desktop-only (UtilityOrbs).
test("Escape and an outside press both dismiss the raised panel", () => {
  const { el } = render(<DockPanels panels={PANELS} />);

  act(() => trigger(el, "Bank").click());
  expect(el.textContent).toContain("BANK CARD");
  act(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  expect(el.textContent).not.toContain("BANK CARD");

  act(() => trigger(el, "Bank").click());
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(el.textContent).not.toContain("BANK CARD");
});

test("a press inside the panel or on the row leaves it up", () => {
  const { el } = render(<DockPanels panels={PANELS} />);
  act(() => trigger(el, "Bank").click());
  const inside = panel(el, "Bank")!;
  act(() => {
    inside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  expect(el.textContent).toContain("BANK CARD");
});

test("the grab handle closes the panel it belongs to", () => {
  const { el } = render(<DockPanels panels={PANELS} />);
  act(() => trigger(el, "Bank").click());
  act(() => trigger(el, "Close Bank").click());
  expect(el.textContent).not.toContain("BANK CARD");
});

// `openRef` is the one way for chrome elsewhere to raise a panel, so no outside
// control keeps an open-state of its own.
test("openRef raises a panel from outside, through the same state", () => {
  const ref: React.MutableRefObject<((key: string) => void) | null> = { current: null };
  const { el, root } = render(<DockPanels panels={PANELS} openRef={ref} />);
  expect(ref.current).toBeTypeOf("function");

  act(() => ref.current!("feed"));
  expect(el.textContent).toContain("TABLE CARD");
  expect(trigger(el, "Table").getAttribute("aria-pressed")).toBe("true");

  act(() => root.unmount());
  expect(ref.current).toBeNull();
});

// The bank's trigger is where spent cards fly to and drawn ones come from.
// `anchorRef` takes a ref so the host can pass a stable callback and React
// keeps the registration across renders.
test("anchorRef publishes the trigger it is given", () => {
  const seen: (HTMLElement | null)[] = [];
  const anchorRef = (node: HTMLElement | null) => seen.push(node);
  const panels: DockPanel[] = [{ ...PANELS[0], anchorRef }, PANELS[1]];

  const { el, root } = render(<DockPanels panels={panels} />);
  expect(seen.at(-1)).toBe(trigger(el, "Bank"));

  act(() => root.unmount());
  expect(seen.at(-1)).toBeNull();
});

// The panel is a reference surface, not a decision, so the badge only shows
// while what it announces is closed.
test("the badge shows only while its panel is closed", () => {
  const panels: DockPanel[] = [PANELS[0], { ...PANELS[1], badge: true }];
  const dot = (el: HTMLElement) => trigger(el, "Table").querySelector("span[aria-hidden]");

  const { el } = render(<DockPanels panels={panels} />);
  expect(dot(el)).not.toBeNull();
  act(() => trigger(el, "Table").click());
  expect(dot(el)).toBeNull();
});

// The panel is bounded by the furniture below it, not the screen edge: it hangs
// off the top of the dock cluster, so it can't cover the hotbar, the dice, or
// the buttons that raised it. jsdom has no layout, so this checks the rule; the
// geometry is checked with real rects in the Playwright pass, and the `maxH`
// arithmetic in lib/hudChrome.test.
test("the panel is anchored above the dock, never over it", () => {
  const { el } = render(<DockPanels panels={PANELS} maxH={214} />);
  act(() => trigger(el, "Bank").click());
  const card = panel(el, "Bank")!;

  expect(card.className).toContain("absolute");
  expect(card.className).toContain("bottom-full");
  // Not `inset-x-0 bottom-0` on the viewport, which covered the shelf.
  expect(card.className).not.toContain("fixed");
  expect(card.className).not.toContain("bottom-0");
});

test("panel height uses the given room or a viewport share", () => {
  const { el, root } = render(<DockPanels panels={PANELS} maxH={214} />);
  act(() => trigger(el, "Bank").click());
  expect(panel(el, "Bank")!.style.maxHeight).toBe("214px");
  // Two caps on one box would conflict, so the class is dropped rather than
  // overridden.
  expect(panel(el, "Bank")!.className).not.toContain("max-h-[60svh]");

  // Nothing measured yet (the first frame): the panel keeps a share of the
  // viewport.
  act(() => root.render(<DockPanels panels={PANELS} />));
  expect(panel(el, "Bank")!.style.maxHeight).toBe("");
  expect(panel(el, "Bank")!.className).toContain("max-h-[60svh]");

  // No room at all (a window a couple of hundred pixels tall) collapses the
  // panel rather than letting it reach over the dock.
  act(() => root.render(<DockPanels panels={PANELS} maxH={0} />));
  expect(panel(el, "Bank")!.style.maxHeight).toBe("0px");
});

// The on-screen keyboard doesn't resize the layout viewport, so the dock is
// behind the keys too. The lift carries the composer back above them; with
// `bottom: 100%`, a bottom margin is all it takes.
test("the panel is lifted off the dock by the keyboard's height", () => {
  const { el, root } = render(<DockPanels panels={PANELS} maxH={400} lift={336} />);
  act(() => trigger(el, "Bank").click());
  expect(panel(el, "Bank")!.style.marginBottom).toBe("336px");

  // No keyboard, no lift: the panel sits straight on the dock.
  act(() => root.render(<DockPanels panels={PANELS} maxH={400} lift={0} />));
  expect(panel(el, "Bank")!.style.marginBottom).toBe("");
});

// With the bank hidden by config there are still trade rates, a discard limit
// and (under Knights) a barbarian track to read, so the panel stays reachable;
// only the trigger loses its counts.
test("a panel with no pill still gets a trigger and still opens", () => {
  const panels: DockPanel[] = [{ ...PANELS[0], pill: undefined }, PANELS[1]];
  const { el } = render(<DockPanels panels={panels} />);
  expect(trigger(el, "Bank").textContent).toContain("🏦");
  act(() => trigger(el, "Bank").click());
  expect(el.textContent).toContain("BANK CARD");
});

test("closes a panel whose trigger goes away", () => {
  const { el, root } = render(<DockPanels panels={PANELS} />);
  act(() => trigger(el, "Bank").click());
  expect(el.textContent).toContain("BANK CARD");
  act(() => root.render(<DockPanels panels={[PANELS[1]]} />));
  expect(el.textContent).not.toContain("BANK CARD");
});

test("the leading slot uses the opposite corner without adding a row", () => {
  // The game screen puts Rejoin here where the seat rail is horizontal and the
  // bank is in this row, so both ends share one baseline.
  const { el } = render(
    <DockPanels panels={PANELS} leading={<button type="button">Rejoin</button>} />,
  );
  const row = trigger(el, "Bank").parentElement!;
  const lead = [...row.children].find((c) => c.textContent === "Rejoin")!;
  // First child, pushed to the far end by its own auto margin; `justify-end`
  // keeps the panels in their corner.
  expect(row.firstElementChild).toBe(lead);
  expect(lead.className).toContain("mr-auto");
  expect(row.className).toContain("justify-end");

  // With no surfaces on the dock there is no row (the 6px case above); Rejoin
  // has a home in the top row at those widths.
  const { el: bare } = render(
    <DockPanels panels={[]} leading={<button type="button">Rejoin</button>} />,
  );
  expect(bare.innerHTML).toBe("");
});

test("the trailing slot keeps its corner and adds a row", () => {
  // End turn rides here below lg, where the corner cluster has come apart, in
  // the corner the cluster holds from lg.
  const { el } = render(
    <DockPanels panels={PANELS} trailing={<button type="button">End</button>} />,
  );
  const row = trigger(el, "Bank").parentElement!;
  const tail = [...row.children].find((c) => c.textContent === "End")!;
  expect(row.lastElementChild).toBe(tail);

  // Unlike `leading`, it holds the row up on its own: End turn has no other
  // home at these sizes, and must stay findable when panels stand down for a
  // trade offer.
  const { el: alone } = render(
    <DockPanels panels={[]} trailing={<button type="button">End</button>} />,
  );
  expect(alone.textContent).toContain("End");
});
