import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, test, expect } from "vitest";
import {
  railFraction,
  quantiseFrac,
  dockPanelMaxH,
  keyboardInset,
  hudViewport,
  feedIslandFits,
  dockYieldsToTrade,
  feedIslandRoom,
  feedHeightReserve,
  poppedCardMaxH,
  bankCardNaturalH,
  bankCardOuterH,
  type BankCardShape,
  DOCK_TRIGGER_H,
  DOCK_TRIGGER_PILL,
  DOCK_TRIGGER_ICON,
  FEED_ISLAND_CHROME,
  FEED_ISLAND_MIN_PANE,
  HOTBAR_H,
  HOTBAR_H_SM,
  HOTBAR_TILE,
  SQUAT_DOCK_COLUMN,
  SQUAT_DOCK_W,
  squatDockWidth,
  squatBoardStrip,
  SQUAT_RIGHT_OF_DOCK,
  SQUAT_TURN_H,
  SQUAT_TURN_ROW,
  SQUAT_DIE_SIZE,
  SQUAT_DOCK_PANEL,
  dividerInked,
  DIVIDER_AT_PX,
  shelfLead,
  hotbarH,
  endTurnH,
  endTurnGap,
  END_TURN_GAP_SM,
  rollTargetH,
  dockDieSize,
  parkedDieSize,
  turnControlsPlacement,
  HUD_PANEL_MIN_H,
  HUD_COLUMN_GAP,
  TRADE_PANEL_WRAP,
  tradePanelLift,
  TRADE_PANEL_BUILDER,
  TRADE_PANEL_RAIL,
  TRADE_ROW,
  TRADE_SCROLL,
  TRADE_SCROLL_WRAP,
  FEED_ISLAND_MIN_H,
  barbRailRight,
  BANK_CARD_W,
  SQUAT_PROMPT,
  squatPromptVars,
  promptTopPx,
  PROMPT_TOP,
} from "./hudChrome";
import { usableFrame } from "./board3d/scene";

test("the rail only insets the board where it is a column", () => {
  // From lg the rail is a left column: 208px of 1600 is 0.13 of the width.
  expect(railFraction(208, 1600, true)).toBeCloseTo(0.13, 6);
  expect(railFraction(248, 1600, true)).toBeCloseTo(0.155, 6);

  // Below lg the same element is a full-width strip; measuring it would report a
  // full-viewport left inset and leave the board no frame.
  expect(railFraction(390, 390, false)).toBe(0);
  expect(railFraction(844, 844, false)).toBe(0);
});

test("a full-width left inset would leave the board no frame at all", () => {
  // Why the guard above is a correctness fix.
  const degenerate = usableFrame({ left: 1 });
  expect(degenerate.minX).toBe(degenerate.maxX);
  const real = usableFrame({ left: railFraction(390, 390, false) });
  expect(real.minX).toBe(-1);
  expect(real.maxX).toBe(1);
});

test("quantises fractions", () => {
  // Half-percent steps: rail widths a pixel apart land on the same value.
  expect(quantiseFrac(0.1301)).toBe(0.13);
  expect(quantiseFrac(0.1299)).toBe(0.13);
  expect(railFraction(208, 1600, true)).toBe(railFraction(209, 1600, true));
  // But a real change still gets through.
  expect(railFraction(208, 1600, true)).not.toBe(railFraction(248, 1600, true));
});

test("a zero-width window does not divide by zero", () => {
  expect(railFraction(0, 0, true)).toBe(0);
  expect(Number.isFinite(railFraction(100, 0, true))).toBe(true);
});

/**
 * The dock rule laid out as the browser would, since jsdom has no layout.
 *
 * Every box is inside the `fixed inset-0` HUD layer, so the layer is the layout
 * viewport:
 *
 *  - the dock cluster hangs off the bottom edge and is `bottomRowH` tall;
 *  - the panel sits at `bottom: 100%` of the cluster, raised by a bottom margin
 *    equal to what the on-screen keyboard covers;
 *  - it grows upward as far as `dockPanelMaxH` allows.
 *
 * The keyboard covers the bottom of the layout viewport without resizing it, so
 * `layoutH`, `svh` and `innerHeight` do not change.
 */
function layOutDockPanel(o: {
  /** The layout viewport: what `fixed` is positioned against. Never moves. */
  layoutH: number;
  /** What the keyboard covers at the bottom of it. Zero when it is down. */
  keyboardH: number;
  topRowH: number;
  bottomRowH: number;
  /** The panel at its natural height, before any cap. */
  wantH: number;
}) {
  const visibleH = o.layoutH - o.keyboardH;
  const lift = keyboardInset(o.layoutH, visibleH, 0);
  const maxH = dockPanelMaxH(visibleH, o.topRowH, o.bottomRowH);
  const panelH = Math.min(o.wantH, maxH);
  const dockTop = o.layoutH - o.bottomRowH;
  const panelBottom = dockTop - lift;
  return {
    dockTop,
    /** The last row of the screen the player can still see. */
    visibleBottom: o.layoutH - o.keyboardH,
    maxH,
    panelH,
    panelBottom,
    panelTop: panelBottom - panelH,
  };
}

// Windows and rulesets the dock has to survive. The dock grows with the shelf
// (Knights adds commodities and a progress row); the top row grows when the left
// island wraps; the panel's natural height moves with the composer.
const VIEWPORTS = [420, 500, 560, 620, 700, 768, 800, 874, 900, 1080, 1440];
const DOCKS = [130, 166, 234, 294];
const TOP_ROWS = [56, 62, 78, 104];
const WANTS = [200, 340, 430];
// No keyboard, an iPhone portrait keyboard, and an Android one with a
// suggestion strip. The tallest is over half the shortest viewport.
const KEYBOARDS = [0, 291, 336];

function everyDock(fn: (box: ReturnType<typeof layOutDockPanel>, label: string) => void) {
  for (const layoutH of VIEWPORTS)
    for (const bottomRowH of DOCKS)
      for (const topRowH of TOP_ROWS)
        for (const wantH of WANTS)
          for (const keyboardH of KEYBOARDS)
            fn(
              layOutDockPanel({ layoutH, keyboardH, topRowH, bottomRowH, wantH }),
              `${layoutH}h dock=${bottomRowH} top=${topRowH} want=${wantH} kbd=${keyboardH}`,
            );
}

test("keeps the panel clear of the hotbar and dice", () => {
  // The panel's bottom edge is at or above the dock's top edge in every case,
  // keyboard up or down.
  const collisions: string[] = [];
  everyDock((box, label) => {
    if (box.panelBottom > box.dockTop) {
      collisions.push(`${label}: panel ends at ${box.panelBottom}, dock starts at ${box.dockTop}`);
    }
  });
  expect(collisions).toEqual([]);
});

test("the panel never reaches the top row either", () => {
  const collisions: string[] = [];
  everyDock((box, label) => {
    if (box.panelH > 0 && box.panelTop < 0) {
      collisions.push(`${label}: panel starts at ${box.panelTop}, off the top of the window`);
    }
  });
  expect(collisions).toEqual([]);
});

test("raises the panel that made room for the dock", () => {
  // With the keyboard down, every realistic window keeps at least a label plus
  // the bank's five counts, or the feed's tabs, a few lines and its composer.
  const short: string[] = [];
  const tooShort: number[] = [];
  everyDock((box, label) => {
    if (!label.endsWith("kbd=0") || box.maxH >= HUD_PANEL_MIN_H) return;
    // Where the chrome alone fills the window, the panel shrinks or collapses
    // rather than being drawn over the dock.
    const height = Number(label.split("h ")[0]);
    if (height <= 500) tooShort.push(height);
    else short.push(`${label}: ${box.maxH}px of panel`);
  });
  expect(short).toEqual([]);
  // That only happens on the two shortest windows with the tallest dock (a
  // landscape phone with a Knights shelf), never a portrait phone or a laptop.
  expect(tooShort.length).toBeGreaterThan(0);
  expect(Math.max(...tooShort)).toBeLessThanOrEqual(500);
});

test("a keyboard shrinks the panel instead of sliding over it", () => {
  // A 402x874 phone with a 336px keyboard. `max-h-[70svh]` and `h-[42svh]` are
  // defined against the small viewport, which ignores the keyboard, so the panel
  // would size itself to 612px with the composer under the keys.
  const box = layOutDockPanel({
    layoutH: 874,
    keyboardH: 336,
    topRowH: 104,
    bottomRowH: 166,
    wantH: 430,
  });
  expect(0.7 * 874).toBeGreaterThan(box.maxH);
  // Instead: everything between the top row and the lifted anchor.
  expect(box.maxH).toBe(874 - 336 - 104 - 166 - HUD_COLUMN_GAP);
  // The whole panel, composer included, is visible.
  expect(box.panelBottom).toBeLessThanOrEqual(box.visibleBottom);
  expect(box.panelTop).toBeGreaterThanOrEqual(0);
  // And still usable.
  expect(box.panelH).toBeGreaterThanOrEqual(HUD_PANEL_MIN_H);
});

test("no visual viewport means no change at all", () => {
  // Without `visualViewport`, `readViewportMetrics` reports
  // `visibleH === layoutH`: no lift, and the cap is the room between top row and
  // dock.
  expect(keyboardInset(874, 874, 0)).toBe(0);
  expect(dockPanelMaxH(874, 104, 166)).toBe(874 - 104 - 166 - HUD_COLUMN_GAP);
});

test("a pinch zoom is not a keyboard", () => {
  // `offsetTop` is the visual viewport scrolled down inside the layout one; those
  // pixels are hidden off the top, not covered at the bottom.
  expect(keyboardInset(874, 500, 374)).toBe(0);
  expect(keyboardInset(874, 500, 100)).toBe(274);
  // A visual viewport briefly taller than the layout one (iOS, mid-gesture) is
  // floored rather than pulling the panel onto the shelf.
  expect(keyboardInset(874, 900, 0)).toBe(0);
});

test("collapses the panel in a very short window", () => {
  // At the limit the panel gives, since the hotbar and dice are what is pressed.
  expect(dockPanelMaxH(300, 104, 234)).toBe(0);
  expect(dockPanelMaxH(0, 0, 0)).toBe(0);
  // Negative measurements (a detached node, a zoom mid-read) are floored.
  expect(dockPanelMaxH(874, -40, -40)).toBe(874 - HUD_COLUMN_GAP);
});

// --- Which surface is on the dock at all -------------------------------------
//
// The bank prefers a card off the top-right orb row and the feed an island in
// the bottom-right corner; each drops to the dock under different conditions. A
// wide but short window has the bank up top and the feed on the dock.

/** Mirrors the `(min-width: 1024px)` query the game screen keys `lgUp` on. */
const LG = 1024;
/** And the `(min-width: 1280px)` one it pins the bank card open from. */
const PIN = 1280;

/**
 * The width-keyed `zoom` ladder in index.css, which divides the height too.
 *
 * Only the real-screen table below needs it (HudLayer reads the zoomed height
 * directly). The next test keeps it in sync with the stylesheet.
 */
const ZOOM_STEPS: ReadonlyArray<readonly [number, number]> = [
  [3400, 2],
  [2800, 1.7],
  [2200, 1.45],
  [1700, 1.2],
];
const uiZoom = (winW: number) => ZOOM_STEPS.find(([min]) => winW >= min)?.[1] ?? 1;
/** The HUD's height on a window of this size: the raw viewport, less the zoom. */
const hudHeightOf = (winW: number, winH: number) => Math.round(winH / uiZoom(winW));

test("the zoom ladder this file reasons about is the one index.css applies", () => {
  // Must match index.css. Read off the project root, not `import.meta.url`:
  // vitest serves this module over http, so its URL has no file scheme.
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  const found = Array.from(
    css.matchAll(/@media \(min-width: (\d+)px\) \{\s*html \{\s*zoom: ([\d.]+);/g),
  ).map((m) => [Number(m[1]), Number(m[2])] as const);
  expect(new Map(found)).toEqual(new Map(ZOOM_STEPS));
});

/**
 * The whole HUD column laid out as the browser would, so the placement rules
 * and the two boxes sharing the right-hand column can be checked together.
 *
 * Every box is inside the `fixed inset-0` HUD layer, in HUD pixels (`hudH`):
 *
 *  - the dock cluster hangs off the bottom edge: its insets, a row of reference
 *    triggers (only for surfaces that landed there), and the hand shelf;
 *  - the island hangs off the top of the dock, capped by its reserve (the bank
 *    card's natural height);
 *  - the bank card hangs off the top row, capped short of the shelf;
 *  - a raised dock panel hangs off the top of the dock.
 *
 * The shelf's top edge does not move when the trigger row appears (the row
 * grows the cluster upward), so the placement rule has one answer.
 */
/** The dock cluster's own inset, top and bottom: `--hud-inset` at sm and up. */
const DOCK_PAD = 12;
/** A trigger row: one control tall, plus its `mb-1.5`. */
const TRIGGER_ROW_H = DOCK_TRIGGER_H + 6;

function layOutHud(o: {
  winW: number;
  /** The HUD layer's own height, after the UI zoom. */
  hudH: number;
  topRowH: number;
  /** The hand shelf and the dice. The trigger row is added above it. */
  shelfH: number;
  /** The bank card and the feed island at their natural heights. */
  cardWantH: number;
  islandWantH: number;
  /** A dock panel at its natural height, for the case one is raised. */
  panelWantH: number;
}) {
  const wide = o.winW >= LG;
  // Width only. Height never moves the bank.
  const bankAtTop = wide;
  const shelfTop = o.hudH - o.shelfH - DOCK_PAD;
  // Width and height: is there room for the card at full size with a readable
  // feed left over?
  const feedAsIsland =
    wide && feedIslandFits({ shelfTop, topRowH: o.topRowH, bankCardH: o.cardWantH });

  // The log and the chat are two triggers; the bank is one more below lg.
  const dockTriggers = (bankAtTop ? 0 : 1) + (feedAsIsland ? 0 : 2);
  const dockH = o.shelfH + DOCK_PAD * 2 + (dockTriggers > 0 ? TRIGGER_ROW_H : 0);
  const dockTop = o.hudH - dockH;

  const islandH = feedAsIsland
    ? Math.min(
        o.islandWantH,
        Math.max(0, o.hudH - feedHeightReserve(o.topRowH, dockH, o.cardWantH)),
      )
    : 0;
  const islandTop = feedAsIsland ? dockTop - islandH : 0;

  // `poppedCardMaxH` returns 0 before the dock has been measured, which the game
  // screen reads as "no cap" and the card falls back to its 60vh class.
  const cardCap = poppedCardMaxH(shelfTop, o.topRowH) || 0.6 * o.hudH;
  const cardH = bankAtTop ? Math.min(o.cardWantH, cardCap) : 0;

  const panelMaxH = dockPanelMaxH(o.hudH, o.topRowH, dockH);
  const panelH = dockTriggers > 0 ? Math.min(o.panelWantH, panelMaxH) : 0;

  return {
    wide,
    bankAtTop,
    feedAsIsland,
    dockTriggers,
    shelfTop,
    dockTop,
    islandTop,
    islandBottom: feedAsIsland ? dockTop : 0,
    islandH,
    islandRoom: feedIslandRoom({ shelfTop, topRowH: o.topRowH, bankCardH: o.cardWantH }),
    cardTop: o.topRowH,
    cardBottom: o.topRowH + cardH,
    cardCap,
    cardH,
    /** What the card wanted, so "did it shrink" is a comparison and not a guess. */
    cardWantH: o.cardWantH,
    panelMaxH,
    panelH,
    panelTop: dockTop - panelH,
    panelBottom: dockTop,
  };
}

/**
 * The bank card at the sizes real games render it, from `bankCardNaturalH`. A
 * seated Knights card is 350px against a spectator's 232, so the grid covers
 * all of them.
 */
const SHAPES: ReadonlyArray<readonly [string, BankCardShape]> = [
  [
    "knights seated",
    {
      counts: true,
      commodities: true,
      discard: true,
    },
  ],
  [
    "base seated",
    {
      counts: true,
      commodities: false,
      discard: true,
    },
  ],
  [
    "knights spectating",
    {
      counts: true,
      commodities: true,
      discard: false,
    },
  ],
  [
    "bank hidden, base seated",
    {
      counts: false,
      commodities: false,
      discard: true,
    },
  ],
];

// Real HUD heights: a phone, a laptop, the two ultrawides (both 655 after zoom),
// a maximized 1920x1080 browser, and one with no browser chrome.
const HUDS = [500, 638, 655, 700, 732, 768, 780, 791, 874, 900, 1000, 1033, 1080, 1400];
const WIDTHS = [402, 768, 1024, 1280, 1366, 1920, 3440];
const SHELVES = [84, 107, 166, 234];
const HUD_TOP_ROWS = [56, 63, 78, 104];

function everyHud(fn: (box: ReturnType<typeof layOutHud>, label: string) => void) {
  for (const winW of WIDTHS)
    for (const hudH of HUDS)
      for (const shelfH of SHELVES)
        for (const topRowH of HUD_TOP_ROWS)
          for (const [shape, card] of SHAPES)
            fn(
              layOutHud({
                winW,
                hudH,
                topRowH,
                shelfH,
                cardWantH: bankCardNaturalH(card),
                // The island at the size a real game renders it, measured at
                // 1920x1080: header, a 180px pane, the composer, glass, insets.
                islandWantH: 286,
                panelWantH: 430,
              }),
              `${winW}x${hudH} shelf=${shelfH} top=${topRowH} card=${shape}`,
            );
}

const REAL = {
  winW: 1920,
  topRowH: 63,
  shelfH: 107,
  cardWantH: bankCardNaturalH(SHAPES[0][1]),
  islandWantH: 286,
  panelWantH: 430,
};

test("the bank answers to the width and to nothing else", () => {
  // A window getting shorter must never move the bank.
  const moved: string[] = [];
  everyHud((box, label) => {
    const [w] = label.split("x");
    if (box.bankAtTop !== Number(w) >= LG) moved.push(label);
  });
  expect(moved).toEqual([]);

  // Hold everything but the height, and the answer holds.
  const at = (hudH: number) => layOutHud({ ...REAL, winW: 1366, hudH });
  expect(HUDS.map((h) => at(h).bankAtTop)).toEqual(HUDS.map(() => true));
});

test("the bank never shrinks while there is an island beside it", () => {
  // `feedIslandFits` may only be true where `poppedCardMaxH` clears the card's
  // own height plus the island's floor.
  const squeezed: string[] = [];
  everyHud((box, label) => {
    if (!box.feedAsIsland || !box.bankAtTop) return;
    if (box.cardH < box.cardWantH) {
      squeezed.push(`${label}: card ${box.cardH} of ${box.cardWantH}`);
    }
    if (box.cardCap < box.cardWantH + FEED_ISLAND_MIN_H) {
      squeezed.push(`${label}: cap ${box.cardCap} leaves the island nothing`);
    }
  });
  expect(squeezed).toEqual([]);
});

test("the island is what yields, and it yields its pane first", () => {
  // Between both fitting and the island going, the island is squeezed and the
  // card is untouched.
  const at = (hudH: number) => layOutHud({ ...REAL, hudH });
  const natural = REAL.cardWantH;
  // Both whole.
  expect(at(900).cardH).toBe(natural);
  expect(at(900).islandH).toBe(286);
  // The island squeezed, the card still whole.
  expect(at(680).cardH).toBe(natural);
  expect(at(680).islandH).toBeLessThan(286);
  expect(at(680).islandH).toBeGreaterThanOrEqual(FEED_ISLAND_MIN_H);
  // Island gone; the card is whole with the column to itself.
  expect(at(626).feedAsIsland).toBe(false);
  expect(at(626).cardH).toBe(natural);
  expect(at(626).cardCap).toBeGreaterThan(natural);
});

test("derives the fit point from the layout", () => {
  // A seated Knights game at 1920x1080: top row 63, gap 8, card 245, gap 8,
  // island floor 184, shelf 107 and the dock's own 12.
  expect(REAL.cardWantH).toBe(245);
  expect(FEED_ISLAND_MIN_H).toBe(184);
  const at = (hudH: number) => layOutHud({ ...REAL, hudH });
  expect(at(627).feedAsIsland).toBe(true);
  expect(at(626).feedAsIsland).toBe(false);
  // A base game's card is 78px shorter, so it keeps its island further down.
  const base = { ...REAL, cardWantH: bankCardNaturalH(SHAPES[1][1]) };
  expect(base.cardWantH).toBe(167);
  expect(layOutHud({ ...base, hudH: 549 }).feedAsIsland).toBe(true);
  expect(layOutHud({ ...base, hudH: 548 }).feedAsIsland).toBe(false);
  // 1240 raw pixels at 1920px wide (1.2x zoom) is 1033 HUD pixels: both whole.
  expect(hudHeightOf(1920, 1240)).toBe(1033);
  expect(at(1033).cardH).toBe(REAL.cardWantH);
  expect(at(1033).islandH).toBe(286);
});

test("the placement rule does not chase its own tail", () => {
  // Collapsing the island adds a trigger row (~40px) to the dock. A rule that
  // measured the dock would flip back and forth across a 40px band of heights;
  // measuring the shelf's top edge, which does not move, avoids that.
  const dockH = (triggers: number) =>
    REAL.shelfH + DOCK_PAD * 2 + (triggers > 0 ? TRIGGER_ROW_H : 0);
  const naive = (hudH: number, triggers: number) =>
    hudH - dockH(triggers) - REAL.topRowH - HUD_COLUMN_GAP * 2 - REAL.cardWantH >=
    FEED_ISLAND_MIN_H;
  const oscillating: number[] = [];
  for (let hudH = 600; hudH <= 900; hudH++) {
    // The naive rule is true with the island up and false once it is gone.
    if (naive(hudH, 0) && !naive(hudH, 2)) oscillating.push(hudH);
  }
  expect(oscillating.length).toBeGreaterThan(30);

  // The real rule reads the shelf, so it answers the same either way.
  for (const hudH of oscillating) {
    const box = layOutHud({ ...REAL, hudH });
    const shelfTopIfIslandWereUp = hudH - REAL.shelfH - DOCK_PAD;
    expect(box.shelfTop).toBe(shelfTopIfIslandWereUp);
    expect(
      feedIslandFits({
        shelfTop: box.shelfTop,
        topRowH: REAL.topRowH,
        bankCardH: REAL.cardWantH,
      }),
    ).toBe(box.feedAsIsland);
  }
});

test("feed placement depends on height", () => {
  // Wide enough for the bank's column, too short for the island in it.
  const laptop = layOutHud({
    ...REAL,
    winW: 1366,
    // A 1366-wide window 560px tall. (A full 1366x768 laptop, 638 of HUD,
    // keeps its island.)
    hudH: 560,
  });
  expect(laptop.bankAtTop).toBe(true);
  expect(laptop.feedAsIsland).toBe(false);
  // Two triggers: log and chat.
  expect(laptop.dockTriggers).toBe(2);

  // The other three corners of the matrix.
  const corner = (winW: number, hudH: number) => layOutHud({ ...REAL, winW, hudH });
  expect(corner(402, 874)).toMatchObject({
    bankAtTop: false,
    feedAsIsland: false,
    dockTriggers: 3,
  });
  expect(corner(1024, 1000)).toMatchObject({
    bankAtTop: true,
    feedAsIsland: true,
    dockTriggers: 0,
  });
  expect(corner(1920, 900)).toMatchObject({ bankAtTop: true, feedAsIsland: true, dockTriggers: 0 });
  // Tall but narrow: no column for either.
  expect(corner(768, 1400)).toMatchObject({ bankAtTop: false, feedAsIsland: false });
});

test("ultrawide windows use the dock", () => {
  // index.css zooms the root by 2 at 3440 wide, so 1310 raw pixels are 655 HUD
  // pixels. A height media query would match on 1310; the rule measures inside
  // the zoomed subtree.
  expect(hudHeightOf(3440, 1310)).toBe(655);
  expect(hudHeightOf(5120, 1310)).toBe(655);
  expect(hudHeightOf(3440, 1100)).toBe(550);
  const at = (hudH: number) => layOutHud({ ...REAL, winW: 3440, hudH });
  expect(at(550).feedAsIsland).toBe(false);
  // What a query on the raw viewport would have decided.
  expect(at(1100).feedAsIsland).toBe(true);

  // Screens either side of the threshold, in HUD units.
  expect(layOutHud({ ...REAL, hudH: hudHeightOf(1366, 560) }).feedAsIsland).toBe(false); // a short laptop window
  expect(layOutHud({ ...REAL, hudH: hudHeightOf(1366, 638) }).feedAsIsland).toBe(true); // a full laptop
  expect(layOutHud({ ...REAL, hudH: hudHeightOf(1920, 950) }).feedAsIsland).toBe(true); // maximized
  expect(layOutHud({ ...REAL, hudH: hudHeightOf(1920, 1080) }).feedAsIsland).toBe(true); // no chrome
});

test("the bank's card and the feed's island never draw through each other", () => {
  // The island's reserve and the card's cap keep the two apart.
  const collisions: string[] = [];
  everyHud((box, label) => {
    if (!box.feedAsIsland || box.cardH <= 0) return;
    if (box.cardBottom > box.islandTop) {
      collisions.push(
        `${label}: card ends at ${box.cardBottom}, island starts at ${box.islandTop}`,
      );
    }
  });
  expect(collisions).toEqual([]);
});

test("a card capped by the shelf is a card with no island under it", () => {
  // The cap only guards the hotbar and dice; wherever it binds, the feed is
  // already on the dock.
  const wrong: string[] = [];
  everyHud((box, label) => {
    if (box.bankAtTop && box.cardCap < box.cardWantH && box.feedAsIsland) wrong.push(label);
  });
  expect(wrong).toEqual([]);
});

test("bounds a dock panel by the hotbar", () => {
  // One trigger on the dock is the common desktop case; the panel is anchored to
  // that row either way.
  const collisions: string[] = [];
  const stubs: string[] = [];
  everyHud((box, label) => {
    if (box.dockTriggers === 0) {
      // Nothing down there, nothing raised.
      if (box.panelH !== 0) stubs.push(`${label}: a panel with no trigger`);
      return;
    }
    if (box.panelBottom > box.dockTop) collisions.push(`${label}: panel over the dock`);
    if (box.panelH > 0 && box.panelTop < 0) collisions.push(`${label}: panel off the top`);
  });
  expect(collisions).toEqual([]);
  expect(stubs).toEqual([]);
});

test("the dock is only empty where both surfaces have somewhere else to be", () => {
  const wrong: string[] = [];
  everyHud((box, label) => {
    if ((box.dockTriggers === 0) !== (box.bankAtTop && box.feedAsIsland)) wrong.push(label);
  });
  expect(wrong).toEqual([]);

  // It happens only from lg.
  const empties: string[] = [];
  everyHud((box, label) => {
    if (box.dockTriggers === 0) empties.push(label);
  });
  expect(empties.length).toBeGreaterThan(0);
  expect(empties.every((l) => Number(l.split("x")[0]) >= LG)).toBe(true);

  // An empty dock is shorter: the trigger row's pixels go back to the board.
  const withRow = layOutHud({ ...REAL, hudH: 590 }); // too short: the feed docks
  const without = layOutHud({ ...REAL, hudH: 900 }); // both surfaces elsewhere
  expect(590 - withRow.dockTop).toBe(REAL.shelfH + DOCK_PAD * 2 + TRIGGER_ROW_H);
  expect(900 - without.dockTop).toBe(REAL.shelfH + DOCK_PAD * 2);
  // The shelf is where it was either way.
  expect(590 - withRow.shelfTop).toBe(900 - without.shelfTop);
});

// --- Where the barbarian rail sits -------------------------------------------

test("the rail clears the bank card exactly when the card is open", () => {
  // Keyed to whether the card is open, not to a breakpoint: between lg and 1280
  // the card starts closed, and above 1280 the player can close it.
  expect(barbRailRight(true)).toBe(BANK_CARD_W + HUD_COLUMN_GAP);
  // Flush: the rail takes the corner the card vacated.
  expect(barbRailRight(false)).toBe(0);
});

test("the open inset clears the card's whole width, so the two cannot touch", () => {
  // The gap matters: neither box has a margin, so an inset of exactly the card's
  // width would make them touch.
  expect(barbRailRight(true)).toBeGreaterThan(BANK_CARD_W);
});

// --- What the bank card actually asks for ------------------------------------

test("bank card height depends on ruleset and seat", () => {
  // Measured in Chromium off the rendered 264px card, at zoom 1.
  const h = (i: number) => bankCardNaturalH(SHAPES[i][1]);
  expect(h(0)).toBe(245); // knights, seated: the tallest card
  expect(h(1)).toBe(167); // base, seated
  expect(h(2)).toBe(190); // knights, spectating: no discard
  expect(h(3)).toBe(69); // counts switched off by the table
  // A card is never taller than one with strictly more in it.
  expect(h(1)).toBeLessThan(h(0));
  expect(h(2)).toBeLessThan(h(0));
  expect(h(3)).toBeLessThan(h(1));
  // The Knights commodity row is 78px.
  expect(h(0) - bankCardNaturalH({ ...SHAPES[0][1], commodities: false })).toBe(78);
});

test("a card with nothing in it costs the column nothing", () => {
  // A spectator at a table with the bank hidden draws no card, so the reserve
  // is zero rather than a frame of padding around nothing.
  expect(
    bankCardNaturalH({
      counts: false,
      commodities: false,
      discard: false,
    }),
  ).toBe(0);
});

test("the estimate and the measurement are of the same box", () => {
  // The screen measures the stack inside the card (the card carries the cap).
  // `bankCardOuterH` adds the frame back so `Math.max` of estimate and
  // measurement does not ratchet by a padding.
  const knights = bankCardNaturalH(SHAPES[0][1]);
  expect(bankCardOuterH(knights - 22)).toBe(knights);
  // Nothing measured yet reserves nothing.
  expect(bankCardOuterH(0)).toBe(0);
});

test("the island's floor is its own parts, not a viewport height", () => {
  // The parts that cannot shrink plus the smallest pane worth reading.
  expect(FEED_ISLAND_MIN_H).toBe(FEED_ISLAND_CHROME + FEED_ISLAND_MIN_PANE);
  // Room is measured from the shelf, minus the card and the gaps around it.
  expect(feedIslandRoom({ shelfTop: 900, topRowH: 63, bankCardH: 350 })).toBe(
    900 - HUD_COLUMN_GAP - 63 - HUD_COLUMN_GAP - 350,
  );
  // An unmeasured dock gets no island.
  expect(feedIslandRoom({ shelfTop: 0, topRowH: 63, bankCardH: 350 })).toBe(0);
  expect(feedIslandFits({ shelfTop: 0, topRowH: 63, bankCardH: 350 })).toBe(false);
  // A column the card alone overflows gives 0, not a negative.
  expect(feedIslandRoom({ shelfTop: 300, topRowH: 63, bankCardH: 350 })).toBe(0);
});

test("the island reserves the card's whole height, open or closed", () => {
  // The reserve the island's CSS cap subtracts from 100%: the card's own height.
  expect(feedHeightReserve(63, 131, 350)).toBe(63 + 131 + HUD_COLUMN_GAP + 350);
  expect(feedHeightReserve(63, 131, 219)).toBeLessThan(feedHeightReserve(63, 131, 350));
  // Negative measurements are floored.
  expect(feedHeightReserve(-5, -5, -5)).toBe(HUD_COLUMN_GAP);
});

// --- The dock's trigger row --------------------------------------------------

test("every control on the trigger row is the same height", () => {
  // The row declares one height and both controls take it.
  expect(DOCK_TRIGGER_PILL).toBe(`h-[${DOCK_TRIGGER_H}px]`);
  expect(DOCK_TRIGGER_ICON).toContain(`h-[${DOCK_TRIGGER_H}px]`);
  expect(DOCK_TRIGGER_ICON).toContain(`w-[${DOCK_TRIGGER_H}px]`);
  // The pill's height (32.5px of content) rounded up.
  expect(DOCK_TRIGGER_H).toBeGreaterThanOrEqual(33);
  expect(DOCK_TRIGGER_H).toBeLessThan(36);
});

test("the card pins itself open only where there is room to leave it up", () => {
  // `defaultPinned` is a third width above lg: from lg the card can be opened,
  // from 1280px it starts open. Height plays no part.
  expect(PIN).toBeGreaterThan(LG);
  expect(1024 >= PIN).toBe(false);
  expect(1280 >= PIN).toBe(true);
});

// --- The HUD's own height, against the UI zoom -------------------------------

test("measures the HUD in layout pixels", () => {
  // On a 3440x1310 window index.css zooms the root by 2, so the HUD is laid out
  // in 655 pixels while `innerHeight`, `100svh` and media queries report 1310.
  const zoomed = hudViewport({ layerH: 655, layoutH: 1310, visibleH: 1310, offsetTop: 0 });
  expect(zoomed).toEqual({ hudH: 655, visibleH: 655, lift: 0 });
  // A cap of 453 in a HUD 655 tall, against 1108 if the raw height were used.
  expect(dockPanelMaxH(zoomed.visibleH, 63, 131)).toBe(453);
  expect(dockPanelMaxH(1310, 63, 131)).toBe(1108);
});

test("the keyboard's lift crosses into HUD pixels with the panel it lifts", () => {
  // A 336px keyboard on a 2x zoomed window covers 168 HUD pixels.
  const kbd = hudViewport({ layerH: 655, layoutH: 1310, visibleH: 974, offsetTop: 0 });
  expect(kbd).toEqual({ hudH: 655, visibleH: 487, lift: 168 });
  // Unzoomed (under 1700px wide), nothing changes.
  expect(hudViewport({ layerH: 874, layoutH: 874, visibleH: 538, offsetTop: 0 })).toEqual({
    hudH: 874,
    visibleH: 538,
    lift: 336,
  });
});

test("answers before the HUD has mounted", () => {
  // `layerH` of zero is the first commit; the raw viewport is used, which is
  // right below 1700px.
  expect(hudViewport({ layerH: 0, layoutH: 874, visibleH: 874, offsetTop: 0 })).toEqual({
    hudH: 874,
    visibleH: 874,
    lift: 0,
  });
  // Without a visual viewport the lift is zero.
  expect(hudViewport({ layerH: 655, layoutH: 1310, visibleH: 1310, offsetTop: 0 }).lift).toBe(0);
});

// --- The hotbar row, and the dice sized from it ------------------------------
// jsdom has no layout, so this checks the arithmetic the two panels share; the
// rendered heights are a Playwright job.

/** A panel's outer height: its content, its vertical padding, its 2px border. */
const panelH = (contentH: number, padY: number) => contentH + padY * 2 + 4;

test("the hotbar tile's class and its number are the same fact", () => {
  // Tailwind needs literal class names, so this keeps the two in sync.
  expect(HOTBAR_TILE).toContain(`h-[${HOTBAR_H}px]`);
  expect(HOTBAR_TILE).toContain(`sm:h-[${HOTBAR_H_SM}px]`);
});

test("the turn cluster matches the hand shelf height", () => {
  // Both panels are one tile plus the same vertical padding: py-2 below sm,
  // py-3 from it.
  for (const [wide, padY] of [
    [false, 8],
    [true, 12],
  ] as const) {
    const shelf = panelH(hotbarH(wide), padY);
    // Seated: dice band + gap + End turn band, all out of the tile.
    expect(panelH(rollTargetH(wide, true) + endTurnGap(wide) + endTurnH(wide), padY)).toBe(shelf);
    // Spectating: no End turn, the dice take the whole tile.
    expect(panelH(rollTargetH(wide, false), padY)).toBe(shelf);
  }
  // Concrete numbers, so a padding change is noticed.
  expect(panelH(hotbarH(false), 8)).toBe(84);
  expect(panelH(hotbarH(true), 12)).toBe(124);
});

test("the dice are one size whether or not End turn is beside them", () => {
  // Always sized against the seated player's band, so the width does not jump.
  expect(dockDieSize(false)).toBe(40);
  expect(dockDieSize(true)).toBe(54);
  expect(dockDieSize(false)).toBeLessThan(rollTargetH(false, false));
});

test("the dice and End turn do not share an edge", () => {
  // Touching targets invite a slipped press that ends the turn. The gap comes
  // out of the dice, so the cluster stays one tile and End turn keeps its height.
  expect(endTurnGap(true)).toBe(END_TURN_GAP_SM);
  expect(END_TURN_GAP_SM).toBeGreaterThan(0);
  expect(endTurnH(true)).toBe(32);
  expect(dockDieSize(true)).toBe(60 - END_TURN_GAP_SM);
  // Zero below sm, where it would cut into a 44px tap target; the cluster only
  // exists from lg anyway.
  expect(endTurnGap(false)).toBe(0);
  // A spectator has no End turn.
  expect(rollTargetH(true, false)).toBe(hotbarH(true));
});

test("the dice shrank on a phone rather than growing into the hotbar", () => {
  // 44 -> 40 narrow, 56 -> 52 wide. A die matching the tile height would make
  // the pair 134px wide on a 402px screen.
  expect(dockDieSize(false)).toBeLessThan(44);
  expect(dockDieSize(true)).toBeLessThan(56);
  expect(dockDieSize(false) * 2).toBeLessThan(HOTBAR_H * 2);
});

test("the roll target stays at the touch floor", () => {
  // The dice are the roll button, so the tap target is the box, not the die:
  // 44px on a phone.
  expect(rollTargetH(false, true)).toBe(44);
  expect(rollTargetH(true, true)).toBe(58);
  expect(rollTargetH(false, false)).toBe(HOTBAR_H);
  // Still above the floor after the gap.
  expect(rollTargetH(true, true)).toBeGreaterThanOrEqual(44);
});

test("the phone's pips are exactly the pips it had", () => {
  // Die.tsx sizes a pip at round(size * 0.139): 40 rounds to the same 6px as 44.
  const pip = (size: number) => Math.round(size * 0.139);
  expect(pip(dockDieSize(false))).toBe(pip(44));
  expect(pip(dockDieSize(false))).toBe(6);
  // The desktop die (54px) has an 8px pip.
  expect(pip(dockDieSize(true))).toBe(8);
});

// --- The trade panel's width -------------------------------------------------
// jsdom has no layout, so this checks which classes each breakpoint gets; the
// real rects are a Playwright job.

test("the trade panel is bounded by the row below lg, and free above it", () => {
  // Below lg the width is the HUD's content box: the window less
  // max(inset, safe-area) on each side, which accounts for a landscape notch.
  expect(TRADE_PANEL_WRAP).toContain("max-lg:w-[calc(100vw-");
  expect(TRADE_PANEL_WRAP).toContain("max(var(--hud-inset,0.5rem),env(safe-area-inset-left))");
  expect(TRADE_PANEL_WRAP).toContain("max(var(--hud-inset,0.5rem),env(safe-area-inset-right))");
  // `right-auto` too: left, right and a width together are over-constrained.
  expect(TRADE_PANEL_WRAP).toContain("max-lg:right-auto");
  // From lg it spans the dock with no width of its own.
  expect(TRADE_PANEL_WRAP).toContain("left-0");
  expect(TRADE_PANEL_WRAP).toContain("right-0");
  expect(TRADE_PANEL_WRAP).not.toMatch(/(^| )w-\[/);
  // It opens over your own seat panel, neither pushed aside nor lifted above it.
  expect(TRADE_PANEL_WRAP).not.toContain("lg:left-[");
  expect(TRADE_PANEL_WRAP).not.toContain("lg:mb-[");
});

test("below lg the trade panel stands above the End row, not over it", () => {
  // The row above the shelf holds the dice and End turn; lifting by the shelf's
  // offset in the dock keeps the Bank / Offer / Cancel rail off End turn.
  expect(tradePanelLift(88, true)).toBe(88);
  // From lg (and on a sideways phone) End turn is not above the shelf.
  expect(tradePanelLift(88, false)).toBe(0);
  expect(tradePanelLift(-4, true)).toBe(0);
  // The class reads it and keeps the 0.5rem gap.
  expect(TRADE_PANEL_WRAP).toContain("mb-[calc(0.5rem+var(--trade-lift,0px))]");
  expect(TRADE_PANEL_WRAP).not.toMatch(/(^| )mb-2( |$)/);
});

test("the action rail stacks under the trays on a phone", () => {
  // The 100px column is lg-only; below that the three controls are a row, so
  // they stay on a 402px screen.
  expect(TRADE_PANEL_RAIL).toContain("lg:flex-col");
  expect(TRADE_PANEL_RAIL).toContain("lg:w-[100px]");
  expect(TRADE_PANEL_RAIL).not.toMatch(/(^| )w-\[100px\]/);
  expect(TRADE_PANEL_WRAP).toContain("max-lg:flex-col");
});

test("the builder squeezes only where it has to", () => {
  // From lg it keeps its natural width (the row must not wrap); below lg it can
  // shrink so the wrapper's cap binds.
  expect(TRADE_PANEL_BUILDER).toContain("lg:w-max");
  expect(TRADE_PANEL_BUILDER).toContain("lg:shrink-0");
  expect(TRADE_PANEL_BUILDER).toContain("min-w-0");
  expect(TRADE_PANEL_BUILDER).not.toMatch(/(^| )shrink-0/);
});

test("a card row overflows into a scroll box rather than squashing its cards", () => {
  // Eight cards do not fit a phone, so the box scrolls and the cards refuse to
  // shrink.
  expect(TRADE_SCROLL).toContain("overflow-x-auto");
  expect(TRADE_ROW).toContain("[&>*]:shrink-0");
  // The badge overhangs the card's top by 6px and a scroll container clips at
  // its padding box; the wrapper's negative margin keeps the lane height.
  expect(TRADE_SCROLL).toContain("py-1.5");
  expect(TRADE_SCROLL_WRAP).toContain("-my-1.5");
  expect(TRADE_SCROLL_WRAP).toContain("min-w-0");
  // Same 6px on the scrolling axis, so a one-card lane does not light
  // ScrollFade's arrow.
  expect(TRADE_SCROLL).toContain("pr-1.5");
  expect(TRADE_SCROLL_WRAP).toContain("-mr-1.5");
});

test("trigger row yields to the trade panel only on overlap", () => {
  // Below lg the builder opens above the triggers, which pushed the hotbar off a
  // phone's screen.
  const yields = (o: Partial<Parameters<typeof dockYieldsToTrade>[0]>) =>
    dockYieldsToTrade({ tradePanelOpen: false, bankAtTop: false, ...o });
  expect(yields({ tradePanelOpen: true })).toBe(true);
  // From lg the bank is in the orb row and the panel has its own column.
  expect(yields({ tradePanelOpen: true, bankAtTop: true })).toBe(false);
  // With no offer being built the row stays.
  expect(yields({})).toBe(false);
  expect(yields({ bankAtTop: true })).toBe(false);
  // Only the reference triggers yield; End turn and Rejoin stay on the row
  // (see DockPanels).
});

test("the parked dice are the trigger row's height, so they cannot grow it", () => {
  // The trigger row is one height at every width, so parked dice are too,
  // unlike `dockDieSize`, which follows the tile.
  expect(parkedDieSize()).toBeLessThan(DOCK_TRIGGER_H);
  expect(parkedDieSize()).toBeLessThan(dockDieSize(false));
  expect(DOCK_TRIGGER_PILL).toContain(`h-[${DOCK_TRIGGER_H}px]`);
});

test("the turn controls come apart below lg, where the shelf needs the width", () => {
  // Below lg the corner cluster would spend the shelf's width on the dice.
  expect(turnControlsPlacement({ bankAtTop: false })).toBe("dock");

  // With the bank in the orb row there is no trigger row for End turn, and the
  // shelf has width to spare.
  expect(turnControlsPlacement({ bankAtTop: true })).toBe("corner");
});

describe("dividerInked", () => {
  test("inks only once the two groups are close to touching", () => {
    expect(dividerInked(0)).toBe(true);
    expect(dividerInked(DIVIDER_AT_PX)).toBe(true);
    expect(dividerInked(DIVIDER_AT_PX + 1)).toBe(false);
    expect(dividerInked(400)).toBe(false);
  });

  // A shelf mid-drag can report a negative gap.
  test("treats an overlap as touching", () => {
    expect(dividerInked(-12)).toBe(true);
  });

  test("fires early, but not from across the shelf", () => {
    expect(DIVIDER_AT_PX).toBeGreaterThan(8);
    expect(DIVIDER_AT_PX).toBeLessThan(64);
  });
});

describe("shelfLead", () => {
  // A desktop shelf: starts at the HUD's left inset and stops short of the turn
  // cluster, so its middle is left of the window's.
  const desk = {
    screenW: 1400,
    trackLeft: 16,
    trackW: 1200,
    gap: 6,
    buyOffset: 8, // the rule between the hand and the tiles
    buyW: 400,
    groupW: 520, // the tiles, plus the rules and the cards in hand around them
    scale: 1,
  };

  /** Where the tiles land on screen, given what the lead is applied as. */
  const buyLeft = (m: typeof desk & { handW: number }) => {
    const { lead } = shelfLead(m);
    return m.trackLeft + m.handW + m.gap + lead * m.scale + m.buyOffset;
  };

  test("centres the buy tiles on the window", () => {
    const handW = 120;
    const left = buyLeft({ ...desk, handW });
    expect(left + desk.buyW / 2).toBeCloseTo(desk.screenW / 2, 0);
    // Not where centring in the shelf would put them (84px short here).
    expect(left).not.toBeCloseTo(desk.trackLeft + (desk.trackW - desk.buyW) / 2, 0);
  });

  test("holds the tiles still as the hand grows into them", () => {
    // A wider hand shortens the lead by the same amount, so the tiles stay put.
    expect(buyLeft({ ...desk, handW: 120 })).toBeCloseTo(buyLeft({ ...desk, handW: 220 }), 0);
    expect(buyLeft({ ...desk, handW: 220 })).toBeCloseTo(buyLeft({ ...desk, handW: 380 }), 0);
  });

  test("never goes negative: a big hand shoves the tiles right", () => {
    expect(shelfLead({ ...desk, handW: 900 }).lead).toBe(0);
  });

  // A narrow track keeps the group inside rather than centring it off the end.
  test("never pushes the group past the end of the track", () => {
    const handW = 60;
    const narrow = { ...desk, handW, trackW: 640 };
    const { lead } = shelfLead(narrow);
    expect(handW + narrow.gap + lead + narrow.groupW).toBeLessThanOrEqual(narrow.trackW);
    // The cap binds here, not the ideal.
    expect(lead).toBeLessThan(shelfLead({ ...narrow, trackW: 4000 }).lead);
  });

  test("a track with no room to give leads by nothing", () => {
    expect(shelfLead({ ...desk, handW: 400, trackW: 500 }).lead).toBe(0);
  });

  // A fractional margin would straddle device pixels.
  test("answers in whole pixels", () => {
    expect(Number.isInteger(shelfLead({ ...desk, handW: 123, buyW: 401 }).lead)).toBe(true);
  });

  /**
   * Under CSS `zoom` a rect and an `offsetWidth` differ for the same box. Mixing
   * them is exact at zoom 1 but 175px off at 1840px (zoom 1.2). Numbers are from
   * that window: a 1609px track at 36, an empty hand, and a 280px buy row 10px
   * into a 289px group, all on-screen px.
   */
  test("centres under UI zoom and returns layout px", () => {
    const zoomed = {
      screenW: 1840,
      trackLeft: 36,
      trackW: 1609,
      handW: 0,
      gap: 6 * 1.2,
      groupW: 289,
      buyOffset: 10,
      buyW: 280,
      scale: 1.2,
    };
    const { lead } = shelfLead(zoomed);
    // The margin is in layout px and rendered 1.2x, so the tiles land mid-screen.
    const left =
      zoomed.trackLeft + zoomed.handW + zoomed.gap + lead * zoomed.scale + zoomed.buyOffset;
    expect(left + zoomed.buyW / 2).toBeCloseTo(zoomed.screenW / 2, 0);
    // Treating the on-screen answer as a margin puts the row 175px off centre.
    const naive =
      zoomed.trackLeft + zoomed.gap + lead * zoomed.scale * zoomed.scale + zoomed.buyOffset;
    expect(naive + zoomed.buyW / 2 - zoomed.screenW / 2).toBeGreaterThan(140);
  });

  test("a zoom of zero or nonsense is treated as no zoom at all", () => {
    const at = (scale: number) => shelfLead({ ...desk, handW: 120, scale }).lead;
    expect(at(0)).toBe(at(1));
    expect(at(Number.NaN)).toBe(at(1));
    expect(at(-2)).toBe(at(1));
  });

  // The divider's gap is on-screen px: the rendered lead plus the row gap.
  test("reports the clear space beside the lead, in the px the player sees", () => {
    const { lead, gap } = shelfLead({ ...desk, handW: 120, scale: 1.2, gap: 7.2 });
    expect(gap).toBeCloseTo(lead * 1.2 + 7.2, 5);
  });
});

// The dock column's clamp is written on the column and on the surfaces that
// clear it (a class cannot read another class); these keep them equal.
describe("the dock column on a sideways phone", () => {
  const clamp = (s: string) => s.match(/clamp\([^)]*\)/)?.[0];
  test("surfaces that clear the column clear exactly its width", () => {
    expect(clamp(SQUAT_DOCK_COLUMN)).toBeTruthy();
    expect(clamp(SQUAT_RIGHT_OF_DOCK)).toBe(clamp(SQUAT_DOCK_COLUMN));
  });
  // Three phone-sized tiles across (44px, 3px gaps) inside the shelf's padding
  // (squat:px-1), 1px border and the cluster's 0.75rem inset. More would take
  // width from the board.
  test("the narrowest column holds three hotbar tiles across", () => {
    const min = Number(clamp(SQUAT_DOCK_COLUMN)!.match(/clamp\((\d+)px/)![1]);
    const inner = min - 2 * 12 - 2 * 4 - 2 * 1;
    // The last tile's count badge hangs 7px past its edge.
    expect(inner).toBeGreaterThanOrEqual(3 * 44 + 2 * 3 + 2 * 7);
    expect(min).toBe(SQUAT_DOCK_W.min);
  });
  test("the class and the arithmetic are one clamp", () => {
    const { min, vw, max } = SQUAT_DOCK_W;
    expect(clamp(SQUAT_DOCK_COLUMN)).toBe(`clamp(${min}px,${vw}vw,${max}px)`);
    expect(squatDockWidth(740)).toBe(min);
    expect(squatDockWidth(2000)).toBe(max);
  });
  // Before this layout the board got 357px at 844x390 and 297px at 740x360.
  test("the board gets substantially more of a sideways phone", () => {
    expect(squatBoardStrip(844)).toBeGreaterThanOrEqual(480);
    expect(squatBoardStrip(740)).toBeGreaterThanOrEqual(375);
    expect(squatBoardStrip(667)).toBeGreaterThanOrEqual(300);
  });
  // The dice and End turn on one line at the foot of the column; a second line
  // would cost the shelf a row.
  test("the dice and End turn share one line in the narrowest column", () => {
    const inner = SQUAT_DOCK_W.min - 2 * 12 - 2 * 1 - 2 * SQUAT_TURN_ROW.padX;
    const dice = 2 * SQUAT_DIE_SIZE + SQUAT_TURN_ROW.diceGap + 2 * SQUAT_TURN_ROW.dicePadX;
    expect(dice + SQUAT_TURN_ROW.gap + SQUAT_TURN_ROW.endMinW).toBeLessThanOrEqual(inner);
    // "End turn" at 13px is 54px of text, plus the button's padding.
    expect(SQUAT_TURN_ROW.endMinW).toBeGreaterThanOrEqual(54 + 2 * 4);
    expect(SQUAT_DIE_SIZE).toBeGreaterThanOrEqual(34);
  });
  test("the turn row is a thumb's height", () => {
    expect(SQUAT_TURN_H).toBeGreaterThanOrEqual(40);
  });
  // Raised surfaces open beside the column from its top edge; `bottom-full`
  // would be off screen.
  test("raised surfaces open beside the column, not above it", () => {
    for (const s of [SQUAT_DOCK_PANEL, TRADE_PANEL_WRAP]) {
      expect(s).toContain("squat:right-full");
      expect(s).toContain("squat:top-0");
      expect(s).toContain("squat:bottom-auto");
    }
  });
});

// A target prompt on a sideways phone stands over the seat rail's column, not
// the board's top row. Every class is squat-only.
describe("SQUAT_PROMPT", () => {
  it("only ever applies on a sideways phone", () => {
    for (const c of SQUAT_PROMPT.split(" ")) expect(c.startsWith("squat:")).toBe(true);
  });

  it("lets go of the centred pill's anchor and takes the rail's box", () => {
    const cls = SQUAT_PROMPT.split(" ");
    expect(cls).toContain("squat:translate-x-0");
    expect(cls.some((c) => c.startsWith("squat:left-[var(--squat-prompt-left"))).toBe(true);
    expect(cls.some((c) => c.startsWith("squat:top-[var(--squat-prompt-top"))).toBe(true);
    expect(cls.some((c) => c.startsWith("squat:w-[var(--squat-prompt-w"))).toBe(true);
    expect(cls).toContain("squat:overflow-y-auto");
  });

  it("measures the rail's content column, top edge down to the inset", () => {
    expect(
      squatPromptVars({ left: 0, top: 60, width: 210 }, { left: 12, right: 12, bottom: 12 }, 390),
    ).toEqual({
      "--squat-prompt-left": "12px",
      "--squat-prompt-top": "60px",
      "--squat-prompt-w": "186px",
      "--squat-prompt-maxh": "318px",
    });
  });

  it("gives up rather than draw a box with no room", () => {
    expect(
      squatPromptVars({ left: 0, top: 0, width: 20 }, { left: 12, right: 12, bottom: 0 }, 390),
    ).toBeNull();
    expect(
      squatPromptVars({ left: 0, top: 400, width: 200 }, { left: 0, right: 0, bottom: 0 }, 390),
    ).toBeNull();
  });
});

describe("promptTopPx", () => {
  const phone = { wide: false, squat: false, topRowH: 52, seatStripH: 59, barbAcrossH: 0 };

  it("stands the prompt under the seat strip on a portrait phone", () => {
    // 390x844 base game: the strip runs 52px to 103px plus its inset.
    expect(promptTopPx(phone)).toBe(111);
    expect(promptTopPx(phone)!).toBeGreaterThan(96);
  });

  it("goes under the barbarian fleet too, where it lies across the board", () => {
    expect(promptTopPx({ ...phone, barbAcrossH: 40 })).toBe(151);
  });

  it("returns null from lg, sideways, and unmeasured", () => {
    expect(promptTopPx({ ...phone, wide: true })).toBeNull();
    expect(promptTopPx({ ...phone, squat: true })).toBeNull();
    expect(promptTopPx({ ...phone, topRowH: 0 })).toBeNull();
  });

  it("reads the variable in both rules with fallbacks", () => {
    const rules = PROMPT_TOP.split(" ");
    expect(rules).toHaveLength(2);
    for (const r of rules) expect(r).toContain("var(--hud-prompt-top,");
    expect(PROMPT_TOP).toContain("6rem");
    expect(PROMPT_TOP).toContain("3.5rem");
  });
});
