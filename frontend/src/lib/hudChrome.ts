import { SQUAT_RAIL_W } from "./seatPanels";

/**
 * How much of the viewport the HUD's chrome takes from the board: the numbers
 * the camera frames against (`scene.usableFrame`, `scene.applyHudInset`), kept
 * here as pure arithmetic so they can be tested without the game screen. The
 * measuring stays in the screen, next to the refs.
 */

/**
 * Quantise a fraction to half-percent steps before it reaches state, so a
 * sub-pixel reflow (a score going 9 to 10) does not re-render the screen and
 * re-frame the camera.
 */
export function quantiseFrac(v: number): number {
  return Math.round(v * 200) / 200;
}

/**
 * The seat rail's share of the viewport width.
 *
 * Only from lg, where the rail is a left column. Below that it is a horizontal
 * strip as wide as the window, which would report a full-viewport left inset;
 * the top-band measurement accounts for the strip instead.
 */
export function railFraction(railWidth: number, winWidth: number, wide: boolean): number {
  if (!wide) return 0;
  return quantiseFrac(railWidth / (winWidth || 1));
}

/*
 * The dock column. The bank and the table feed can be raised from a button
 * above the hand shelf when the window has no room for them elsewhere. A panel
 * raised there is bounded by the top edge of the bottom cluster, not the screen
 * edge, so it never covers the hotbar or dice. It is anchored to the cluster
 * (`bottom: 100%`) and capped by the arithmetic below.
 */

/**
 * Whether the chrome stands in columns beside the board rather than in bands
 * above and below it.
 *
 * JS twin of the `lg` variant in index.css; the two must agree or the camera is
 * framed for the wrong layout. The second and third arms are a phone held
 * sideways: wide enough for a column, too short for a band.
 */
export const COLUMN_LAYOUT_QUERY =
  "(min-width: 1024px), (min-width: 700px) and (max-height: 600px), (min-width: 560px) and (max-height: 500px)";

/**
 * A phone held sideways: JS twin of the `squat` variant in index.css.
 *
 * Within the column layout, but the dock (hand, reference triggers, dice, End
 * turn) is the right-hand column instead of a bottom band, since at 360 to 430px
 * tall a band costs the board a third of its height. The camera gets no bottom
 * band and a right inset the width of the dock column.
 */
export const SQUAT_QUERY = "(min-width: 560px) and (max-width: 1023.98px) and (max-height: 500px)";

/** Breathing room kept between a HUD surface and whatever it is bounded by. */
export const HUD_COLUMN_GAP = 8;

/**
 * The bank card's width (`w-[264px]` in `UtilityOrbs`), shared because the
 * barbarian rail is positioned against it. A constant rather than a measurement
 * because the card is only present from lg and only open from 1280px.
 */
export const BANK_CARD_W = 264;

/**
 * How far the barbarian rail sits from the right edge: beside the bank card
 * while the card is open, in the corner otherwise. The two must not overlap.
 *
 * Keyed to the open state rather than a breakpoint, because between lg and
 * 1280px the card starts closed and above 1280px the player can close it. The
 * caller passes `false` when the card is not rendered at all (below lg it lives
 * on the dock).
 */
export function barbRailRight(bankCardOpen: boolean): number {
  return bankCardOpen ? BANK_CARD_W + HUD_COLUMN_GAP : 0;
}

/**
 * The height below which a panel raised from the dock is no longer worth
 * raising: roughly a label and the bank's five counts. Not enforced (a shorter
 * window gets a shorter panel rather than one drawn over the dock), but the grid
 * test asserts no realistic window comes out under it.
 */
export const HUD_PANEL_MIN_H = 140;

/**
 * The tallest a dock panel may be: the room between the top row and the dock.
 *
 * `visibleH` is the visual viewport where available, else `innerHeight`. `svh`
 * and `innerHeight` ignore the on-screen keyboard, so a panel sized from them
 * would put the chat composer under the keys.
 *
 * `topRowH` is the whole top cluster, padding included. `bottomRowH` is the
 * dock. Only the gap above the panel is taken here; the gap below is the dock
 * cluster's own top padding. Zero means no room, and the panel collapses.
 */
export function dockPanelMaxH(visibleH: number, topRowH: number, bottomRowH: number): number {
  return Math.max(0, visibleH - Math.max(0, topRowH) - Math.max(0, bottomRowH) - HUD_COLUMN_GAP);
}

/**
 * How far the bottom of the layout viewport is covered (by the on-screen
 * keyboard). The keyboard does not resize the layout viewport, so fixed
 * elements stay laid out behind it; a dock panel is lifted by this much.
 *
 * `offsetTop` is subtracted because a pinch-zoomed page hides pixels off the
 * top, not the bottom. Floored at zero since iOS can report a visual viewport
 * taller than the layout one mid-gesture.
 */
export function keyboardInset(layoutH: number, visibleH: number, offsetTop: number): number {
  return Math.max(0, layoutH - visibleH - Math.max(0, offsetTop));
}

/**
 * The viewport in HUD pixels, keyboard included.
 *
 * Above 1700px index.css scales the UI with `zoom`, and two units meet here:
 *
 *  - `layerH` is the HUD layer's `offsetHeight`, in the zoomed subtree's own
 *    pixels (as are the top row's and dock's heights).
 *  - `layoutH`/`visibleH`/`offsetTop` come from `window` and `visualViewport`
 *    and report raw viewport pixels (1310 against the layer's 655 on a
 *    3440x1310 window).
 *
 * Everything returned is in HUD pixels. A `layerH` of zero means the HUD has
 * not mounted yet; the raw viewport is used then, which is correct below 1700px.
 */
export function hudViewport(o: {
  layerH: number;
  layoutH: number;
  visibleH: number;
  offsetTop: number;
}): { hudH: number; visibleH: number; lift: number } {
  const hudH = o.layerH > 0 ? o.layerH : Math.max(0, o.layoutH);
  const scale = o.layerH > 0 && o.layoutH > 0 ? o.layerH / o.layoutH : 1;
  const lift = Math.round(keyboardInset(o.layoutH, o.visibleH, o.offsetTop) * scale);
  return { hudH, visibleH: Math.max(0, hudH - lift), lift };
}

/*
 * Where the two reference surfaces live. Each has a preferred home and drops
 * to the dock when the window cannot hold it there.
 *
 * The bank depends only on width: its home is a card hanging off an orb in the
 * top-right row, which needs the right-hand column that exists from lg.
 *
 * The feed depends on width and height: its home is a tall island in the
 * bottom-right corner, sharing the column with the bank card above it.
 *
 * The bank never shrinks; the island yields first. The bank is a readout (counts,
 * rates, discard line) and half a readout is no use, while the feed is a scroll
 * box. So the column keeps the island only while it can hold the bank
 * at its natural height (`bankCardNaturalH`) and still leave the island enough
 * (`feedIslandRoom`). `poppedCardMaxH` is bounded by the shelf, not the island, so
 * the card is capped only where the island is already gone. The tests assert the
 * two rules together.
 *
 * On a wide but short window (a 1366x768 laptop) the bank is in the orb row while
 * the feed is on the dock, so neither row may assume the other is occupied.
 */

/*
 * The bank card's natural height, built from what it draws.
 *
 * Block heights are measured in Chromium off the 264px-wide card. They are
 * constants because the column reserves the card's height even while it is
 * closed (it starts closed between lg and 1280px), and a reserve that appeared
 * on open would move the feed's composer under the pointer.
 *
 * They are a floor: the game screen also measures the rendered card
 * (`attachBankCardBody` in routes/Game) and takes the larger value.
 */

/** `p-2.5` on the card plus its 1px glass rim, top and bottom of the stack. */
const BANK_CARD_FRAME = 22;
/** `gap-2` between the card's blocks, and inside the ones that stack. */
const BANK_CARD_GAP = 8;
/** The header line: the BANK label and your default rate chip ("You trade 3:1"). */
const BANK_LABEL_H = 17;
/** The five piles: art over count over your rate for it, straight on the card. */
const BANK_COUNTS_H = 65;
/** The Knights half under them: a hairline rule, a 6px gap, three more piles. */
const BANK_COMMODITY_H = 78;
/** The DISCARD block: its mono label, the gap, and one well. */
const BANK_DISCARD_H = 47;

/**
 * Which blocks the card draws, a ruleset and seat question. Answered by the
 * same selectors that draw them (`selectBankCardShape` in hud/TableStatus).
 */
export interface BankCardShape {
  /** The five resource counts and their header. `show_bank` can switch them off. */
  counts: boolean;
  /** The three commodities under them, in a Knights game. */
  commodities: boolean;
  /** DISCARD: a seated player with a limit on the wire. */
  discard: boolean;
}

export function bankCardNaturalH(shape: BankCardShape): number {
  // One entry per child of the card's flex column. Gaps are added once at the
  // end, so a block that is not drawn costs neither its height nor a gap.
  const blocks: number[] = [];
  if (shape.counts) {
    blocks.push(BANK_LABEL_H);
    blocks.push(BANK_COUNTS_H + (shape.commodities ? BANK_COMMODITY_H : 0));
  }
  if (shape.discard) blocks.push(BANK_DISCARD_H);
  if (blocks.length === 0) return 0;
  return BANK_CARD_FRAME + blocks.reduce((a, b) => a + b, 0) + (blocks.length - 1) * BANK_CARD_GAP;
}

/**
 * The card's outer height given the measured height of the stack inside it
 * (`TopPanelOrb`'s `contentRef`; the card itself carries the cap). Adds the
 * same frame `bankCardNaturalH` uses so estimate and measurement agree.
 */
export function bankCardOuterH(contentH: number): number {
  return contentH > 0 ? contentH + BANK_CARD_FRAME : 0;
}

/*
 * The island's floor: header, composer, glass and border, cluster insets and
 * gaps (measured, fixed), plus at least three lines of pane. Measured on the
 * chat side, which is taller, and against the cluster box that
 * `feedHeightReserve` caps.
 */
/** Header, composer, glass, cluster insets, gaps: the island minus its pane. */
export const FEED_ISLAND_CHROME = 106;
/** Three lines of feed at the 26px row this log draws. */
export const FEED_ISLAND_MIN_PANE = 78;
export const FEED_ISLAND_MIN_H = FEED_ISLAND_CHROME + FEED_ISLAND_MIN_PANE;

/**
 * How much height is left for the island once the bank has had its own.
 *
 * `shelfTop` is the top of the hand-shelf row in HUD pixels. It is used rather
 * than the dock cluster's height because collapsing the island adds a trigger
 * row above the shelf (about 40px), which would feed back into this decision and
 * make it oscillate. The shelf's top edge does not move either way.
 *
 * One `HUD_COLUMN_GAP` stands in for the dock cluster's 12px top padding: 4px
 * generous, which errs toward a slightly shorter pane.
 */
export function feedIslandRoom(o: {
  /** Top of the hand shelf inside the HUD layer, in HUD pixels. */
  shelfTop: number;
  /** The whole top cluster, padding included. */
  topRowH: number;
  /** What the bank's card wants, from `bankCardNaturalH` or a measurement. */
  bankCardH: number;
}): number {
  if (!(o.shelfTop > 0)) return 0;
  const cardBottom = Math.max(0, o.topRowH) + HUD_COLUMN_GAP + Math.max(0, o.bankCardH);
  return Math.max(0, o.shelfTop - HUD_COLUMN_GAP - cardBottom);
}

/**
 * Whether the feed's island fits: the bank at full height, and a feed left over.
 *
 * The `lg` width half of the condition stays with the caller. Heights are HUD
 * pixels measured inside the zoomed subtree; media queries and `innerHeight`
 * report the raw viewport, so this cannot be a `(min-height: …)` query.
 */
export function feedIslandFits(o: {
  shelfTop: number;
  topRowH: number;
  bankCardH: number;
}): boolean {
  return feedIslandRoom(o) >= FEED_ISLAND_MIN_H;
}

/**
 * Whether the dock's reference triggers (bank, log, chat) hide while an offer
 * is being built.
 *
 * Below lg the trade builder opens above the dock, and on a phone the triggers
 * would push the hotbar off the bottom of the window. The panel shows
 * its own bank rate, and chat and log are a Cancel away. The row itself stays,
 * since End turn and Rejoin are on it. `bankAtTop` (from lg) means the bank is
 * not on the dock and the panel has its own column.
 */
export function dockYieldsToTrade(o: { tradePanelOpen: boolean; bankAtTop: boolean }): boolean {
  return o.tradePanelOpen && !o.bankAtTop;
}

/*
 * The right-hand column, shared by the bank card (top, grows down) and the feed
 * island (above the shelf, grows up). Both are absolutely positioned against the
 * right edge. The island reserves the card's natural height
 * (`feedHeightReserve`); the card is bounded by the shelf (`poppedCardMaxH`),
 * which never binds while there is an island. One direction, no measurement
 * loop.
 */

/**
 * How much of the HUD layer's height the feed island may not use, subtracted
 * from 100% (`calc(100% - reserve)`), so it survives the UI zoom past 1700px.
 *
 * Reserves the bank's height unconditionally, open or not, so closing the bank
 * does not make the feed jump under the pointer.
 */
export function feedHeightReserve(topRowH: number, bottomRowH: number, bankCardH: number): number {
  return Math.max(0, topRowH) + Math.max(0, bottomRowH) + HUD_COLUMN_GAP + Math.max(0, bankCardH);
}

/**
 * The tallest the bank's hanging card may be: the room above the hand shelf.
 *
 * Bounded by the shelf rather than the island, because the island is what
 * yields; this only binds on windows too short for an island. `shelfTop` is the
 * same pixel whether or not a trigger row sits above the shelf.
 *
 * `topRowH` is the whole top cluster, while the card starts at the orb row's
 * bottom, at least one inset higher: slack in the safe direction.
 *
 * Zero `shelfTop` means the dock is not measured yet; the card then falls back
 * to its own viewport share.
 */
export function poppedCardMaxH(shelfTop: number, topRowH: number): number {
  if (!(shelfTop > 0)) return 0;
  return Math.max(0, shelfTop - Math.max(0, topRowH) - HUD_COLUMN_GAP);
}

/**
 * The dock trigger row's height, shared by the bank's counts pill and the log
 * and chat buttons so they line up on every device.
 *
 * The pill's content-driven height (five counts at 11px, `py-1.5`, 2px border:
 * 32.5px) rounded up. It is under the 44px touch floor used elsewhere; the pill
 * has always been this tall and works fine as a target.
 */
export const DOCK_TRIGGER_H = 34;

/**
 * Tailwind spellings of `DOCK_TRIGGER_H`. Tailwind scans for whole class names,
 * so these cannot be templated; the test keeps them in sync.
 */
export const DOCK_TRIGGER_PILL = "h-[34px]";
export const DOCK_TRIGGER_ICON = "w-[34px] h-[34px]";

/*
 * The hotbar row and the dice sized from it.
 *
 * The bottom row is the hand shelf and the turn cluster (dice over End turn)
 * side by side. They must be the same height, so the row height is declared
 * here and the dice take what is left after End turn's band.
 */

/**
 * The hotbar row's content height: one resource card, one shop tile, one die
 * stack. 96px from sm (68x96 tiles, the 5:7 card shape); 64px on phones.
 */
export const HOTBAR_H = 64;
export const HOTBAR_H_SM = 96;

/**
 * Tailwind size for every hotbar tile, matching the numbers above (the test
 * keeps them in sync; `h-[${HOTBAR_H}px]` would generate no rule).
 */
// `squat:` puts a sideways phone back on the small tile: its hand is stacked
// down a column there, and the 64px row is what lets hand and buy tiles fit.
export const HOTBAR_TILE = "w-11 h-[64px] sm:w-[68px] sm:h-[96px] squat:w-11 squat:h-[64px]";

/**
 * The chrome a non-blocking prompt wears.
 *
 * Reactive prompts come in two tiers:
 *   - Blocking modals (components/game/Overlay): dimmed backdrop at z-50, for
 *     decisions that halt the game (the steal, card pickers, gold, the Wedding
 *     give).
 *   - Floating prompts (this): no backdrop, z-40, above the board and dock but
 *     below modals, for nudges such as a standing trade offer or a target hint.
 * The in-dock trade/discard basket lives inside the dock at z-10.
 */
export const FLOATING_PROMPT =
  // `hud-root` so a prompt mounted outside HudLayer still takes the HUD's tokens.
  "hud-root hud-surf-solid fixed z-40";

/** End turn's band inside the turn cluster; the dice get the rest of the tile. */
export const END_TURN_H = 20;
export const END_TURN_H_SM = 32;

/** Breathing room around the dice inside their tap target, per side. */
const DIE_INSET = 2;

/**
 * Gap between the dice and End turn, so a slipped press on the roll button does
 * not end the turn. Taken from the dice, not the button, since the cluster's
 * height is fixed to one hotbar tile.
 *
 * Zero below sm, where it would break the 44px touch floor; the corner cluster
 * only exists from lg anyway (`turnControlsPlacement`).
 */
export const END_TURN_GAP_SM = 6;

export function hotbarH(wide: boolean): number {
  return wide ? HOTBAR_H_SM : HOTBAR_H;
}

export function endTurnH(wide: boolean): number {
  return wide ? END_TURN_H_SM : END_TURN_H;
}

export function endTurnGap(wide: boolean): number {
  return wide ? END_TURN_GAP_SM : 0;
}

/**
 * The dice's tap target (they are the roll button): the tile height less End
 * turn's band and gap when End turn is shown. 44px on a phone. A spectator has
 * no End turn, so their dice get the whole tile.
 */
export function rollTargetH(wide: boolean, showEnd: boolean): number {
  return hotbarH(wide) - (showEnd ? endTurnH(wide) + endTurnGap(wide) : 0);
}

/*
 * The trade panel width.
 *
 * The builder hangs off the top of the hand shelf, sized by its contents. The
 * HUD is `fixed`, so overflow is unreachable rather than scrollable: on a phone
 * the Bank/Offer/Cancel rail ended up off screen. Below lg the panel is bounded
 * to the HUD's content box: the rail drops under the trays, the builder takes
 * the full width, and the card rows scroll inside their lanes.
 *
 * The width is the window less `max(inset, safe-area)` on each side (as in
 * HudLayer), not `100vw - inset*2`, which differs by the notch on a landscape
 * phone. Strings because Tailwind cannot be handed a template.
 */
/**
 * The dock as the right-hand column of a sideways phone.
 *
 * The bottom cluster drops its left edge and takes a column's width; the host
 * gives it a `top` (the measured top row). `justify-end` packs the trigger row,
 * hand and turn controls at the bottom.
 *
 * 186px holds three phone-sized hotbar tiles plus the last one's 7px count
 * badge without a sideways scroll; past 198px the width belongs to the board.
 * The shelf scrolls before the column grows (`squatBoardStrip`).
 */
export const SQUAT_DOCK_COLUMN =
  "squat:left-auto squat:w-[clamp(186px,22vw,198px)] squat:flex squat:flex-col squat:justify-end";

/** SQUAT_DOCK_COLUMN's clamp as numbers, for the arithmetic below. */
export const SQUAT_DOCK_W = { min: 186, vw: 22, max: 198 } as const;

/** The dock column's width on a `winW`-wide sideways phone: the clamp, in JS. */
export function squatDockWidth(winW: number): number {
  const { min, vw, max } = SQUAT_DOCK_W;
  return Math.min(max, Math.max(min, (winW * vw) / 100));
}

/** The seat rail's inset from the left edge: the HUD cluster's own padding. */
const SQUAT_RAIL_INSET = 12;

/**
 * What a sideways phone leaves the board across, with the seat rail closed:
 * the window less the rail and its inset on the left and the dock on the
 * right. The height is the board's whole column either way.
 */
export function squatBoardStrip(winW: number): number {
  return winW - SQUAT_RAIL_INSET - SQUAT_RAIL_W - squatDockWidth(winW);
}

/**
 * A target prompt on a sideways phone sits over the top of the seat rail's
 * column, not across the board.
 *
 * Elsewhere the prompt is a pill near the top of the board. On a squat screen
 * that covered the board's top row and the triggers above the dock, so taps
 * landed on the prompt. The seat rail is only read, not tapped, while the board
 * asks a question, so the prompt covers it (as `SQUAT_DOCK_PANEL` does).
 *
 * The box comes from the measured rail (`squatPromptVars`); fallbacks cover the
 * first frame. `!` on the four properties the pill's own responsive classes also
 * set, so Tailwind's variant order does not decide which wins.
 */
export const SQUAT_PROMPT = [
  "squat:left-[var(--squat-prompt-left,0.75rem)]! squat:top-[var(--squat-prompt-top,3.75rem)]!",
  "squat:translate-x-0 squat:w-[var(--squat-prompt-w,11rem)] squat:max-w-none",
  "squat:max-h-[var(--squat-prompt-maxh,70vh)] squat:overflow-y-auto",
  "squat:flex-col squat:items-stretch squat:gap-1.5 squat:rounded-[14px]",
  "squat:px-3! squat:py-2!",
].join(" ");

/**
 * Where a target prompt's top edge goes below lg in portrait, in layout px:
 * under the top row, the seat strip, and (in a Knights game) the barbarian
 * fleet beneath the strip. Null wherever the prompt's classes place it instead:
 * from lg, on a sideways phone (`SQUAT_PROMPT`), and before the top row is
 * measured.
 *
 * Measured because the strip's height varies (modules add seat counters, the
 * fleet adds a band), and a fixed offset covered the seat cards the robber
 * prompt asks you to pick from. No gap is added: both clusters already measure
 * with their own bottom inset.
 */
export function promptTopPx(m: {
  wide: boolean;
  squat: boolean;
  topRowH: number;
  seatStripH: number;
  barbAcrossH: number;
}): number | null {
  if (m.wide || m.squat || !(m.topRowH > 0)) return null;
  return Math.round(m.topRowH + Math.max(0, m.seatStripH) + Math.max(0, m.barbAcrossH));
}

/**
 * The top edge a target prompt takes. `--hud-prompt-top` is set on the game
 * screen's root from `promptTopPx`; where unset, the defaults apply (6rem, or
 * 3.5rem on a short window). `SQUAT_PROMPT` overrides both with `!` on a
 * sideways phone.
 */
export const PROMPT_TOP =
  "top-[var(--hud-prompt-top,6rem)] [@media(max-height:600px)]:top-[var(--hud-prompt-top,3.5rem)]";

/**
 * Where a standing offer (a trade, a draw) floats: centred, above the dock.
 *
 * `--hud-float-bottom` is the dock's measured height, set below lg in portrait
 * (see `promptTopPx`'s caller), so the offer does not cover the hand and bank
 * chips the player needs to judge it. On a sideways phone it hangs from under
 * the top row instead and scrolls if taller than the window. From lg the
 * variable is unset and 176px applies.
 */
export const FLOATING_OFFER_POS = [
  "left-1/2 -translate-x-1/2 max-w-[94vw]",
  "bottom-[var(--hud-float-bottom,0.75rem)] sm:bottom-[var(--hud-float-bottom,176px)]",
  "squat:bottom-auto! squat:top-[var(--hud-top-row,3.75rem)]",
  "squat:max-h-[calc(100dvh-var(--hud-top-row,3.75rem)-0.75rem)] squat:overflow-y-auto",
].join(" ");

/**
 * The CSS variables `SQUAT_PROMPT` reads, from the seat rail cluster's box: its
 * content column (the cluster's padding is the HUD inset) from its top edge down
 * to the inset above the bottom of the screen. Null when there is no rail to
 * stand on, which leaves the fallbacks in charge.
 */
export function squatPromptVars(
  rail: { left: number; top: number; width: number },
  pad: { left: number; right: number; bottom: number },
  viewportH: number,
): Record<string, string> | null {
  const width = Math.round(rail.width - pad.left - pad.right);
  const maxH = Math.round(viewportH - rail.top - pad.bottom);
  if (width <= 0 || maxH <= 0) return null;
  return {
    "--squat-prompt-left": `${Math.round(rail.left + pad.left)}px`,
    "--squat-prompt-top": `${Math.round(rail.top)}px`,
    "--squat-prompt-w": `${width}px`,
    "--squat-prompt-maxh": `${maxH}px`,
  };
}

/**
 * A right-anchored floating surface on a sideways phone stands clear of that
 * column rather than on top of the hand: the column's own width plus a gap.
 * The clamp is the column's, restated because a class cannot read another.
 */
export const SQUAT_RIGHT_OF_DOCK = "squat:right-[calc(clamp(186px,22vw,198px)+0.75rem)]";

/**
 * A surface raised from that column (a dock panel, the trade builder, the
 * discard box) opens to its left, over the board, from the column's top edge.
 * Elsewhere they are `bottom-full` of the dock, which here would be off screen.
 * The width is capped so it may cover seats but not the whole screen.
 */
export const SQUAT_DOCK_PANEL =
  "squat:top-0 squat:bottom-auto squat:left-auto squat:right-full squat:mr-2 squat:ml-0 squat:w-[min(24rem,56vw)]";

/**
 * How far the trade builder is lifted off the hand shelf, in HUD px.
 *
 * Below lg the dock stacks the dice and trigger row (with End turn) above the
 * shelf, so a panel at the shelf's top edge would cover End turn. Lifting by the
 * shelf's offset in the dock cluster opens it above the whole dock. Zero where
 * those rows are not above the shelf (from lg, and on a sideways phone).
 */
export function tradePanelLift(shelfOffsetTop: number, stacked: boolean): number {
  return stacked ? Math.max(0, Math.round(shelfOffsetTop)) : 0;
}

export const TRADE_PANEL_WRAP = [
  // `--trade-lift` is `tradePanelLift`, set on the shelf by the game screen.
  "absolute left-0 right-0 bottom-full mb-[calc(0.5rem+var(--trade-lift,0px))] z-30 flex items-stretch gap-2 pointer-events-none",
  // From lg the builder opens over your own seat panel (pinned above the
  // shelf's left end) and covers it while you trade.
  "max-lg:right-auto max-lg:w-[calc(100vw-max(var(--hud-inset,0.5rem),env(safe-area-inset-left))-max(var(--hud-inset,0.5rem),env(safe-area-inset-right)))]",
  "max-lg:flex-col",
  // Sideways phone: beside the dock column, trays and rail side by side since
  // there is no height for a stacked rail. The trays give up width instead.
  "squat:top-0 squat:bottom-auto squat:left-auto squat:right-full squat:mb-0 squat:mr-2",
  "squat:w-[min(28rem,62vw)] squat:max-h-full",
].join(" ");

/** The trays. Its natural width from `lg`; the wrapper's below that. */
export const TRADE_PANEL_BUILDER =
  "hud-surf-solid min-w-0 lg:w-max lg:shrink-0 squat:w-auto squat:shrink squat:flex-1 flex flex-col gap-1.5 rounded-[14px] p-2.5 pointer-events-auto";

/** Bank / Offer / Cancel: a column beside the trays from `lg`, a row under them below it. */
export const TRADE_PANEL_RAIL =
  "shrink-0 flex gap-1.5 pointer-events-auto lg:w-[100px] lg:flex-col";

/**
 * The counterparty glyph above the label on the Bank and Offer/Counter rail
 * buttons. 44px from lg, where the rail is a tall column; 20px below, where the
 * rail is a row and height comes out of the board.
 *
 * Sized in CSS, not Phosphor's `size` prop: the prop writes width/height
 * attributes, which a CSS rule overrides, so leave it off or the two disagree.
 */
export const TRADE_RAIL_ICON = "size-5 lg:size-11";

/**
 * The card row inside a lane (and the REQUEST palette). `[&>*]:shrink-0` makes
 * it overflow and scroll instead of squashing the cards.
 */
export const TRADE_ROW = "flex items-center gap-1.5 [&>*]:shrink-0";

/**
 * The bounded box that row scrolls inside.
 *
 * `py-1.5` gives the count badge (which overhangs a card's top by 6px) and the
 * hover lift room inside the scroll container's padding box; the wrapper's
 * `-my-1.5` gives the height back. `pr-1.5` does the same for the badge on the
 * last card's right edge, which otherwise counts as scrollable overflow and
 * lights ScrollFade's arrow on a one-card lane.
 */
export const TRADE_SCROLL = "overflow-x-auto no-scrollbar py-1.5 pr-1.5";
export const TRADE_SCROLL_WRAP = "min-w-0 -my-1.5 -mr-1.5";

/**
 * One die's size in the dock: always the seated player's target, so the dice
 * do not change size (and the row width) when End turn appears or goes. 40px on
 * a phone, 54px from sm.
 */
export function dockDieSize(wide: boolean): number {
  return rollTargetH(wide, true) - DIE_INSET * 2;
}

/**
 * One die's size once the dice are parked: a result, not a control.
 *
 * After the roll the dice move up to the trigger row beside the bank counts and
 * the log and chat buttons, and the shelf gets the corner back. That row is
 * `DOCK_TRIGGER_H` at every width, so the dice take its height less the usual
 * inset.
 */
export function parkedDieSize(): number {
  return DOCK_TRIGGER_H - DIE_INSET * 2;
}

/**
 * The turn row's height at the foot of a sideways phone's dock column (dice and
 * End turn side by side, `TurnControls` with `row`). The 44px touch target;
 * nothing beside it needs a matching height.
 */
export const SQUAT_TURN_H = 44;

/**
 * The dice drawn inside that row. 36 so the pair and End turn fit one line of
 * the dock column (see SQUAT_TURN_ROW).
 */
export const SQUAT_DIE_SIZE = 36;

/**
 * The turn row's horizontal budget in px, as TurnControls' `row` classes spell
 * it (`px-1`, `gap-1.5`, the dice's `px-0.5`, End turn's `min-w-[62px]`). Dice
 * and End turn must share one line in the 186px column.
 */
export const SQUAT_TURN_ROW = { padX: 4, gap: 6, dicePadX: 2, diceGap: 6, endMinW: 62 } as const;

/** Where the turn controls live: the corner cluster, or down the dock stack. */
export type TurnPlacement = "corner" | "dock";

/**
 * Where the dice and End turn are drawn.
 *
 * From lg they share a corner box beside the hand shelf. Below lg that box would
 * cost the shelf its width all game, so the dice get a row of their own
 * (`DiceRow`) and End turn becomes a pill on the trigger row (`EndTurnPill`).
 * `bankAtTop` decides it, since it also decides whether the dock has a trigger
 * row.
 */
export function turnControlsPlacement(o: { bankAtTop: boolean }): TurnPlacement {
  return o.bankAtTop ? "corner" : "dock";
}

/**
 * Gap in px below which the rule between the hand and the tiles is drawn. Set a
 * little wide so it fades in before the groups touch.
 */
export const DIVIDER_AT_PX = 20;

/**
 * Whether the shelf divider should be inked, given the gap between the two
 * groups. The divider always occupies its 2px and only its colour changes;
 * removing it would change the gap it measures and oscillate.
 */
export function dividerInked(gapPx: number): boolean {
  return gapPx <= DIVIDER_AT_PX;
}

/**
 * Centres the shop tiles on the screen rather than on the shelf.
 *
 * The shelf's own middle shifts with the turn cluster (present for a seated
 * player, absent for a spectator, gone below lg), so the buy row gets the fixed
 * middle of the window instead. Two limits apply:
 *
 *  - The lead never goes negative: a wide hand pushes the tiles right.
 *  - The lead is capped at the room left in the track, so the group is not
 *    centred off the end of a narrow shelf.
 *
 * All inputs are measured with no lead applied, so the result does not depend on
 * its previous value.
 *
 * Above 1700px index.css puts `zoom` on <html>. `getBoundingClientRect` and
 * `innerWidth` report zoomed px; `offsetWidth`, `clientWidth` and
 * `style.marginLeft` use layout px. All inputs here are zoomed px; only `lead`
 * is converted back to layout px, since it is written to a margin.
 *
 *  - `screenW`     the window
 *  - `trackLeft`   the shelf's scroll track, left edge, on screen
 *  - `trackW`      that track's visible width
 *  - `handW`       your hand, which is hard against the track's left edge
 *  - `gap`         the row's own gap, between the hand and the centred group
 *  - `groupW`      the whole centred group (tiles, rules, cards in hand)
 *  - `buyOffset`   the buy tiles' left edge, measured from the group's
 *  - `buyW`        the buy tiles, which are the thing being centred
 *  - `scale`       zoomed px per layout px: 1 below 1700px, `zoom` above it
 */
export interface ShelfLead {
  /** Layout px, because its only destination is the group's `margin-left`. */
  lead: number;
  /**
   * Zoomed px: the clear space between hand and group (lead plus the row gap).
   * Fed to `dividerInked`, whose threshold is about what the player sees.
   */
  gap: number;
}

export function shelfLead(m: {
  screenW: number;
  trackLeft: number;
  trackW: number;
  handW: number;
  gap: number;
  groupW: number;
  buyOffset: number;
  buyW: number;
  scale: number;
}): ShelfLead {
  // Where the tiles would land with the group packed straight after the hand.
  const packed = m.trackLeft + m.handW + m.gap + m.buyOffset;
  const ideal = (m.screenW - m.buyW) / 2 - packed;
  const room = m.trackW - m.handW - m.gap - m.groupW;
  const onScreen = Math.max(0, Math.min(ideal, room));
  // Guard against a zero or non-finite zoom.
  const scale = m.scale > 0 && Number.isFinite(m.scale) ? m.scale : 1;
  const lead = Math.round(onScreen / scale);
  return { lead, gap: lead * scale + m.gap };
}

/**
 * The heading row of a `<details>` box in a module panel (`rounded-xl border
 * p-3`): it takes the box's padding as its own so the whole bordered row is the
 * tap target. When open, the bottom margin returns so the contents start below
 * the row.
 */
export const DETAILS_SUMMARY = "-m-3 p-3 [details[open]>&]:mb-0 cursor-pointer";
