import { test, expect, describe } from "vitest";
import {
  seatPanelHeight,
  SEAT_COUNTERS_H,
  seatPanelGap,
  seatRailHeight,
  seatFields,
  SEAT_PANEL_HEIGHT,
  SEAT_PANEL_GAP,
  SEAT_STRIP_GAP,
  SEAT_RAIL_BOTTOM_INSET,
  SEAT_RAIL_MIN_H,
  railMaxHeight,
  seatCounterGrid,
  SEAT_COUNTER_ROW_H,
  SEAT_COUNTER_COLS_MAX,
  seatRailMode,
  SQUAT_RAIL_W,
  SQUAT_RAIL_WIDTH,
} from "./seatPanels";

// Two sizes, picked by breakpoint (see SeatRail). These pin what each size
// draws and the arithmetic the rail uses to decide whether a seat is off the
// end.

test("no size ever drops the identity fields", () => {
  // A seat must never render as a bare number with no name.
  for (const d of ["full", "micro"] as const) {
    const f = seatFields(d);
    expect(f.name, d).toBe(true);
    expect(f.vp, d).toBe(true);
  }
  // The desktop card shows everything.
  expect(seatFields("full")).toEqual({
    name: true,
    vp: true,
    counters: true,
    extras: true,
    handOnly: false,
    awards: true,
    tracks: true,
  });
});

test("the phone card, closed, is who is playing and what they are on", () => {
  // Micro is the closed half of a toggle that opens the whole strip, so it
  // drops the hand count and tracks; they are one press away.
  const micro = seatFields("micro");
  expect(micro.name).toBe(true);
  expect(micro.vp).toBe(true);
  expect(micro.counters).toBe(false);
  expect(micro.awards).toBe(false);
  expect(micro.handOnly).toBe(false);
  expect(micro.tracks).toBe(false);
  // The open half is the whole card, tracks included.
  expect(seatFields("full").tracks).toBe(true);
});

test("a panel reserves the tracks row exactly when it draws one", () => {
  // A size that draws the tracks must be taller under Knights than base; one
  // that does not must be the same height. The panel is a fixed height over
  // `overflow-hidden`, so getting this wrong clips the countdown strip.
  for (const d of ["full", "micro"] as const) {
    const draws = seatFields(d).tracks;
    const delta = SEAT_PANEL_HEIGHT[d].knights - SEAT_PANEL_HEIGHT[d].base;
    if (draws) expect(delta, d).toBeGreaterThan(0);
    else expect(delta, d).toBe(0);
  }
  expect(SEAT_PANEL_HEIGHT.full.knights - SEAT_PANEL_HEIGHT.full.base).toBe(20);
});

test("the phone card is smaller than the desktop one, in both rulesets", () => {
  for (const v of ["base", "knights"] as const) {
    expect(SEAT_PANEL_HEIGHT.micro[v], v).toBeLessThan(SEAT_PANEL_HEIGHT.full[v]);
  }
});

test("rail height counts the gaps, not just the panels", () => {
  // The gaps count: this total is what the scroll-fade is decided from.
  for (const d of ["full", "micro"] as const) {
    for (const v of ["base", "knights"] as const) {
      expect(seatRailHeight(10, d, v) - seatRailHeight(9, d, v)).toBe(
        SEAT_PANEL_HEIGHT[d][v] + SEAT_PANEL_GAP,
      );
    }
  }
  expect(seatRailHeight(0, "full")).toBe(0);
  expect(seatRailHeight(1, "full", "knights")).toBe(SEAT_PANEL_HEIGHT.full.knights);
});

// The gap. jsdom has no layout, so this is arithmetic the rail applies.

test("a rail with room to spare gets the full gap", () => {
  // Four full Knights cards are 484px of panel; a 900px window's column has
  // plenty spare.
  expect(seatPanelGap(4, "full", "knights", 690)).toBe(SEAT_PANEL_GAP);
  expect(seatPanelGap(3, "full", "base", 690)).toBe(SEAT_PANEL_GAP);
  // Unmeasured (the first frame) and single-seat rails are unconstrained.
  expect(seatPanelGap(10, "full", "knights", 0)).toBe(SEAT_PANEL_GAP);
  expect(seatPanelGap(1, "full", "knights", 50)).toBe(SEAT_PANEL_GAP);
});

test("the gap never pushes a seat off a rail that fits", () => {
  // Panels that fit flush must not be pushed out by the gaps between them.
  // Sweep seat counts against a band of viewport heights.
  for (const density of ["full", "micro"] as const) {
    for (const variant of ["base", "knights"] as const) {
      const h = SEAT_PANEL_HEIGHT[density][variant];
      for (let count = 2; count <= 10; count++) {
        for (let available = 40; available <= 1400; available += 7) {
          const gap = seatPanelGap(count, density, variant, available);
          expect(gap, `${density}/${variant} n=${count} avail=${available}`).toBeGreaterThanOrEqual(
            0,
          );
          expect(gap).toBeLessThanOrEqual(SEAT_PANEL_GAP);
          if (count * h <= available) {
            expect(
              seatRailHeight(count, density, variant, gap),
              `${density}/${variant} n=${count} avail=${available}`,
            ).toBeLessThanOrEqual(available);
          }
        }
      }
    }
  }
});

test("a rail that cannot fit keeps its gap", () => {
  // Ten full Knights cards are 1210px of panel, taller than any laptop column.
  // It scrolls either way, so the full gap is kept.
  const tenPanels = 10 * SEAT_PANEL_HEIGHT.full.knights;
  expect(seatPanelGap(10, "full", "knights", tenPanels - 1)).toBe(SEAT_PANEL_GAP);
  expect(seatPanelGap(10, "full", "knights", 690)).toBe(SEAT_PANEL_GAP);
  // ...and the rail reports overflow, which lights the scroll-fade.
  const gap = seatPanelGap(10, "full", "knights", 690);
  expect(seatRailHeight(10, "full", "knights", gap)).toBeGreaterThan(690);
});

test("the gap shrinks by degrees rather than all at once", () => {
  // Between "fits with the full gap" and "does not fit" the gap tapers to
  // spend exactly the spare room. Ten micro cards are 510px with nine gaps.
  const h = SEAT_PANEL_HEIGHT.micro.base; // 51
  const panels = 10 * h;
  expect(seatPanelGap(10, "micro", "base", panels)).toBe(0); // flush, exactly
  expect(seatPanelGap(10, "micro", "base", panels + 9)).toBe(1);
  expect(seatPanelGap(10, "micro", "base", panels + 45)).toBe(5);
  expect(seatPanelGap(10, "micro", "base", panels + 72)).toBe(SEAT_PANEL_GAP);
  // Extra room does not widen it past the full value.
  expect(seatPanelGap(10, "micro", "base", panels + 400)).toBe(SEAT_PANEL_GAP);
  // Monotonic in the available room.
  let prev = -1;
  for (let available = panels; available <= panels + 100; available++) {
    const gap = seatPanelGap(10, "micro", "base", available);
    expect(gap).toBeGreaterThanOrEqual(prev);
    prev = gap;
  }
});

test("more players means no more air than fewer players", () => {
  // At a fixed viewport the gap is non-increasing in seat count, up to where
  // the panels overflow on their own.
  const available = 700;
  let prev = SEAT_PANEL_GAP;
  for (let count = 2; count <= 10; count++) {
    const h = SEAT_PANEL_HEIGHT.full.base;
    if (count * h > available) break;
    const gap = seatPanelGap(count, "full", "base", available);
    expect(gap, `n=${count}`).toBeLessThanOrEqual(prev);
    prev = gap;
  }
});

test("a big desktop table scrolls", () => {
  // Every seat gets the whole card on desktop, so a full table is taller than
  // the column (ten Knights cards are 1264px against ~690 on 1440x900). The
  // rail scrolls, with the fade cue and the active seat kept in view.
  const laptopColumn = 690; // 900 - the top row - the hand shelf
  expect(seatRailHeight(10, "full", "knights")).toBeGreaterThan(laptopColumn);
  expect(seatRailHeight(5, "full", "knights")).toBeLessThanOrEqual(laptopColumn);
  // The phone strip is horizontal and width-bound, but ten micro cards stacked
  // would still fit the same column.
  expect(seatRailHeight(10, "micro", "knights")).toBeLessThan(seatRailHeight(6, "full", "knights"));
});

test("the strip is tighter than the column", () => {
  // Cards are far wider than tall, so the same number would be a hairline
  // stacked and a gutter side by side.
  expect(SEAT_STRIP_GAP).toBeLessThan(SEAT_PANEL_GAP);
  // The column's gap yields to the fit; the strip's is constant because it
  // scrolls sideways. 18px of slack over ten panels is two per join: tight but
  // not overflowing (an overflowing column keeps the full gap).
  const tenPanels = 10 * SEAT_PANEL_HEIGHT.full.knights;
  expect(seatPanelGap(10, "full", "knights", tenPanels + 18)).toBe(2);
  expect(seatPanelGap(10, "full", "knights", tenPanels + 18)).toBeLessThan(SEAT_PANEL_GAP);
});

test("a short window still gets a rail it can scroll", () => {
  // 874x402 landscape, four seats: COLUMN_LAYOUT_QUERY matches, and
  // `room - bottomInset` goes negative. Clamping that to 0 would mean "not
  // measured" to the rail, which then applies no max-height and runs off the
  // window with the last seat unreachable.
  const room = 402 - 74; // below the measured top row
  expect(railMaxHeight(room, 340)).toBe(SEAT_RAIL_MIN_H);
  // With room to spare the shelf gets everything it asked for.
  expect(railMaxHeight(room, 120)).toBe(room - 120);
});

test("the rail never runs past the bottom of the window", () => {
  // The floor may overlap the shelf (a scrolling rail can still reach every
  // seat) but not the screen edge, so a window shorter than the floor is
  // capped by what it has.
  expect(railMaxHeight(90, 300)).toBe(90 - SEAT_RAIL_BOTTOM_INSET);
  expect(railMaxHeight(90, 300)).toBeLessThan(SEAT_RAIL_MIN_H);
});

test("an unmeasured rail is left alone", () => {
  // 0 means "set no max-height", which the rail wants before its first
  // measurement.
  expect(railMaxHeight(0, 100)).toBe(0);
  expect(railMaxHeight(-20, 100)).toBe(0);
});

// Memory mode: the card drops its score and counters row (see
// PlayerCardMemory.test.tsx), and the panel must stop reserving that row too.

test("memory mode shortens the panel by exactly the counters row", () => {
  for (const v of ["base", "knights"] as const) {
    expect(seatPanelHeight("full", v, true), v).toBe(seatPanelHeight("full", v) - SEAT_COUNTERS_H);
  }
});

test("memory mode does not change the phone strip", () => {
  // `micro` is name and score only; taking 21px off it would clip the
  // countdown strip on a phone.
  expect(seatFields("micro").counters).toBe(false);
  for (const v of ["base", "knights"] as const) {
    expect(seatPanelHeight("micro", v, true), v).toBe(seatPanelHeight("micro", v));
  }
});

test("the fit arithmetic uses the shorter panel", () => {
  // The gap and the scroll-fade must agree with the declared height, or the
  // rail misreports whether a seat is off the end. Ten seats differ by 210px.
  const gap = 6;
  expect(seatRailHeight(10, "full", "base", gap, true)).toBe(
    seatRailHeight(10, "full", "base", gap) - 10 * SEAT_COUNTERS_H,
  );
  // 18px spare over ten full cards: the full rail spreads it over nine gaps
  // (2px each), while ten memory-mode cards keep the whole gap. The gap is
  // fitted against the panel height.
  const room = 10 * seatPanelHeight("full", "base") + 18;
  expect(seatPanelGap(10, "full", "base", room, false)).toBe(2);
  expect(seatPanelGap(10, "full", "base", room, true)).toBe(SEAT_PANEL_GAP);
});

test("memory mode drops the score and counters", () => {
  for (const d of ["full", "micro"] as const) {
    const on = seatFields(d, true);
    const off = seatFields(d);
    expect(on.vp, d).toBe(false);
    expect(on.counters, d).toBe(false);
    expect(on.extras, d).toBe(false);
    // The name and awards row belong to the tier, not this switch.
    expect(on.name, d).toBe(off.name);
    expect(on.awards, d).toBe(off.awards);
    // The improvement tracks follow the host's `show_improvements` setting,
    // not this one: improvement levels are public at a real table.
    expect(on.tracks, d).toBe(off.tracks);
    // One direction only: a field this tier does not draw stays undrawn.
    for (const k of Object.keys(on) as (keyof typeof on)[]) {
      if (!off[k]) expect(on[k], `${d}.${k}`).toBe(false);
    }
  }
});

test("the counters row takes as few lines as fit, then balances them", () => {
  // One line for everything a base, Knights or single-module game draws.
  for (const n of [2, 3, 4]) {
    expect(seatCounterGrid(n, false), `${n}`).toEqual({ rows: 1, cols: n });
    expect(seatCounterGrid(n, true), `${n} squat`).toEqual({ rows: 1, cols: n });
  }
  expect(seatCounterGrid(5, false)).toEqual({ rows: 1, cols: 5 });
  // Five is too many for the sideways phone's card: two lines.
  expect(seatCounterGrid(5, true)).toEqual({ rows: 2, cols: 3 });
  // Seven (Knights + Fishermen + Raiders + Wagons) is four over three.
  expect(seatCounterGrid(7, false)).toEqual({ rows: 2, cols: 4 });
  // Nine, every module on.
  expect(seatCounterGrid(9, false)).toEqual({ rows: 2, cols: 5 });
  expect(seatCounterGrid(9, true)).toEqual({ rows: 3, cols: 3 });
  // No grid is ever wider than a line can hold readably.
  for (let n = 1; n <= 12; n++) {
    expect(seatCounterGrid(n, false).cols).toBeLessThanOrEqual(SEAT_COUNTER_COLS_MAX.wide);
    expect(seatCounterGrid(n, true).cols).toBeLessThanOrEqual(SEAT_COUNTER_COLS_MAX.squat);
  }
});

test("each extra counters line is reserved in the declared panel height", () => {
  for (const v of ["base", "knights"] as const) {
    const one = seatPanelHeight("full", v);
    expect(seatPanelHeight("full", v, false, 1)).toBe(one);
    expect(seatPanelHeight("full", v, false, 2)).toBe(one + SEAT_COUNTER_ROW_H);
    expect(seatPanelHeight("full", v, false, 3)).toBe(one + 2 * SEAT_COUNTER_ROW_H);
    // Memory mode draws no counters row, so it has no lines to reserve.
    expect(seatPanelHeight("full", v, true, 3)).toBe(one - SEAT_COUNTERS_H);
    // Nor does `micro`.
    expect(seatPanelHeight("micro", v, false, 3)).toBe(seatPanelHeight("micro", v));
  }
  expect(seatRailHeight(4, "full", "base", SEAT_PANEL_GAP, false, 2)).toBe(
    4 * (SEAT_PANEL_HEIGHT.full.base + SEAT_COUNTER_ROW_H) + 3 * SEAT_PANEL_GAP,
  );
});

// The sideways phone's rail, closed and open. At 844x390 the board had only
// 357px beside the seat rail and dock, so the rail is closed by default (one
// line per seat: name, hand, score) and a tap opens every card.
describe("seatRailMode", () => {
  test("a sideways phone's rail is one narrow line per seat until it is opened", () => {
    for (const count of [3, 4, 6, 8, 10]) {
      expect(seatRailMode({ wide: true, squat: true, railOpen: false, count })).toEqual({
        density: "micro",
        compact: true,
        narrow: true,
      });
    }
  });

  test("an opened rail uses full density", () => {
    expect(seatRailMode({ wide: true, squat: true, railOpen: true, count: 4 })).toEqual({
      density: "full",
      compact: false,
      narrow: false,
    });
    expect(seatRailMode({ wide: true, squat: true, railOpen: true, count: 8 })).toEqual({
      density: "full",
      compact: true,
      narrow: false,
    });
  });

  test("a desktop column never closes, whatever the stored choice", () => {
    for (const railOpen of [false, true]) {
      expect(seatRailMode({ wide: true, squat: false, railOpen, count: 4 })).toEqual({
        density: "full",
        compact: false,
        narrow: false,
      });
      expect(seatRailMode({ wide: true, squat: false, railOpen, count: 8 }).compact).toBe(true);
    }
  });

  test("the portrait strip keeps its own toggle and never goes to rows", () => {
    expect(seatRailMode({ wide: false, squat: false, railOpen: false, count: 8 })).toEqual({
      density: "micro",
      compact: false,
      narrow: false,
    });
    expect(seatRailMode({ wide: false, squat: false, railOpen: true, count: 4 }).density).toBe(
      "full",
    );
  });

  test("the narrow rail fits a name, the hand and the score on a line", () => {
    expect(SQUAT_RAIL_W).toBeLessThanOrEqual(176);
    // The class that draws it says the same number.
    expect(Number(SQUAT_RAIL_WIDTH.match(/^w-(\d+)$/)![1]) * 4).toBe(SQUAT_RAIL_W);
    // Dot, three gaps, the hand's fan and count, a two-digit score: the rest
    // is the name, which must hold "Bot Winston" at 13px.
    const name = SQUAT_RAIL_W - 2 * 4 - 2 * 8 - 10 - 3 * 4 - 32 - 20;
    expect(name).toBeGreaterThanOrEqual(64);
  });
});
