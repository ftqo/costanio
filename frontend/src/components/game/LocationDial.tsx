import * as React from "react";
import { Trans } from "@lingui/react/macro";
import { AnchoredMenu } from "./AnchoredMenu";
import { CostChips } from "./CostChips";
import type { LocationAction } from "@/lib/locationActions";
import { cn } from "@/lib/utils";
import { HOTBAR_TILE } from "@/lib/hudChrome";

/**
 * The location menu: a row of cards straddling the spot you clicked.
 *
 * It shows the location's whole roster in rank order, with what you can't do
 * greyed in place rather than removed, so the menu is stable from turn to turn
 * and you see options you can't yet afford. Only what is permanently impossible
 * is absent.
 *
 * Cards sit just above the spot and the readout just below, so the clicked
 * piece or vertex stays visible between them.
 *
 * Placement, zoom normalisation, Escape and outside-press dismissal come from
 * `AnchoredMenu`, with its panel turned off: the cards are the panels.
 */

/** A card's footprint, matching the hotbar tile it is cut from. */
const CARD_W = 56;
const CARD_H = 80;
/** Space between cards in the row. */
const CARD_GAP = 10;
/**
 * The menu's width and its readout's height, fixed while it is open.
 * `AnchoredMenu` measures and places once, so a box that grew as the readout
 * filled in would shift under the pointer. The readout reserves room for a
 * four-card row and a label plus the longest reason, and is never empty (it
 * opens describing rank 1).
 *
 * READOUT_H is a floor, not a cap. 74 is one 13px label line (19.5) plus two
 * 11.5px reason lines at `snug` (2 x 15.81), the mt-0.5, `py-2` and the 3px
 * border, measured in English. The longest reason in en, zh-Hans and ja fills
 * it exactly at the 240px minimum width, so there is no headroom; a longer
 * translation or a wrapped label grows the readout upward (see `min-h-full` at
 * the box).
 */
const MENU_MIN_W = 240;
const READOUT_H = 74;
/** Clear air between the spot and each half of the menu. */
const SPOT_GAP = 12;

/**
 * How far down the rendered box the clicked spot falls. The help text is on
 * top, the cards under it, and the spot clear below, so the cards are nearest
 * the spot. All constants, so the box can be placed exactly once.
 */
export const ANCHOR_Y = READOUT_H + SPOT_GAP + CARD_H + SPOT_GAP;

/** How wide a row of `n` cards is. */
export function cardRowWidth(n: number): number {
  const cards = Math.max(1, n);
  return cards * CARD_W + (cards - 1) * CARD_GAP;
}

/** The whole menu's width: the row, or the readout's minimum, whichever is wider. */
export function menuWidth(n: number): number {
  return Math.max(cardRowWidth(n), MENU_MIN_W);
}

/**
 * What a card shows, and what it says is being done to it.
 *
 * A card is the piece the action concerns; the badge is the verb, as on the
 * improvement tiles (art plus a chevron for "next level"). A piece is
 * recognised on sight, where "Strength 3" has to be read.
 *
 * `art` names an asset slot. Most actions share their id with a shop slot; the
 * rest are named here.
 */
const CARD_ART: Record<string, string> = {
  // The knight the ore and sheep buy, not the one already standing there.
  // Filled in per tier below.
  activate_knight: "activate_knight",
  move_knight: "build_knight",
  chase_robber: "chase_robber",
  // The pirate is the robber's counterpart on the water; the card shows the
  // piece that moves, not the knight moving it.
  chase_pirate: "chase_pirate",
  move_ship: "build_ship",
  // Setup places the shop's three pieces under its own command names, and the
  // slots are keyed to the shop's ids, so these need mapping.
  place_settlement: "build_settlement",
  place_road: "build_road",
  place_ship: "build_ship",
  // The robber, whichever verb moved it. `chase_robber` is the slot its art
  // was baked into.
  move_robber: "chase_robber",
};

/** The verb badge a card carries, if the piece alone does not say it. */
const CARD_BADGE: Record<string, "upgrade" | "move"> = {
  promote_knight: "upgrade",
  move_knight: "move",
  move_ship: "move",
  chase_robber: "move",
  chase_pirate: "move",
};

/**
 * The card art for an action. `a.art` is set by the roster for promotion,
 * where the picture depends on the tier bought rather than the id.
 */
function artSlot(a: LocationAction): string {
  return a.art ?? CARD_ART[a.id] ?? a.id;
}

export function LocationDial({
  actions,
  at,
  thumbs,
  onChoose,
  onClose,
}: {
  actions: LocationAction[];
  at: { x: number; y: number };
  /**
   * The build shelf's piece photographs, keyed by slot. Slots are named like
   * the placement action ids, so `thumbs[a.id]` is the card the player buys
   * that piece from.
   */
  thumbs: Record<string, string>;
  onChoose: (a: LocationAction) => void;
  onClose: () => void;
}) {
  // The readout describes an option, never the spot itself (which the player
  // can see). Nothing is focused until the pointer says so, and with nothing
  // focused no help text is drawn: a card is its own label.
  const [focused, setFocused] = React.useState<number | null>(null);
  const shown = focused == null ? null : actions[focused];
  // A one-card menu on touch takes two taps. The tap that focuses the card
  // would otherwise commit at once, and on a one-card menu the label is the
  // purpose (the card confirms an armed action, see lib/boardTap). The
  // first touch tap only focuses and the readout says to tap again; a tap
  // elsewhere dismisses (AnchoredMenu).
  //
  // Touch only, read off the pointer that pressed this card, so mouse and
  // keyboard (Enter/Space is a click with no pointer) are unchanged. Menus of
  // several cards are unchanged too: the tapped card is the choice.
  const pressedBy = React.useRef<string | null>(null);
  const [touchArmed, setTouchArmed] = React.useState<number | null>(null);
  // Only a commit needs it. An entry that merely arms a mode (`arms`, e.g.
  // "Move ship") sends nothing, and the destination tap confirms on its own.
  const twoTap = actions.length === 1 && !actions[0].arms;

  return (
    <AnchoredMenu
      at={at}
      onClose={onClose}
      above
      anchorY={ANCHOR_Y}
      // The box is wider and taller than the cards (the readout sets the width,
      // and the spot sits in a gap), so only the cards and readout take the
      // pointer; a press anywhere else reaches the board and dismisses.
      className="pointer-events-none flex flex-col items-center border-0 bg-transparent p-0 shadow-none"
    >
      {/* Above the cards, drawn only once one is pointed at (a card is its own
          label). Its space is reserved either way so the cards never move under
          the pointer. */}
      <div
        className="flex items-end justify-center"
        style={{ width: menuWidth(actions.length), height: READOUT_H }}
        // Polite, so the touch prompt ("Tap again to confirm") and its label are
        // spoken when the first tap draws them. Cards have their own aria-labels.
        aria-live="polite"
      >
        {shown && (
          <div
            data-readout=""
            className={cn(
              // `min-h-full`, not `h-full`: the reserved slot is a floor, and
              // anything taller grows upward into the board.
              //
              // The reserve is measured in English (see READOUT_H), but
              // translations wrap differently and Han line boxes are taller. The
              // slot keeps its height, so the cards and spot don't move
              // (`ANCHOR_Y` is unchanged and AnchoredMenu places once); the box is
              // bottom-aligned, so the excess goes over empty board. The clamp
              // below bounds it.
              "pointer-events-auto min-h-full w-full rounded-xl border-[3px] border-border",
              "bg-secondary-background px-3 py-2",
              // Centred like the row below, so it reads as belonging to the
              // focused card.
              "flex flex-col items-center justify-center text-center text-[13px] font-extrabold",
            )}
          >
            <span className="flex items-center justify-center gap-2">
              <span>{shown.label}</span>
              {shown.cost && <CostChips cost={shown.cost} />}
            </span>
            {/* `line-clamp-3` and nothing else about display: the clamp makes the
                span a `-webkit-box`, and `block` comes later in Tailwind's layer
                and would win, disabling the clamp (a four-line Japanese reason
                measures 63px against a 32px reserve). */}
            {shown.reason && (
              <span className="mt-0.5 line-clamp-3 text-[11.5px] font-semibold leading-snug text-muted">
                {shown.reason}
              </span>
            )}
            {touchArmed != null && touchArmed === focused && (
              <span className="mt-0.5 text-xs font-semibold leading-snug text-muted">
                <Trans context="board menu: a touch confirm, after the first tap">
                  Tap again to confirm
                </Trans>
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ height: SPOT_GAP }} aria-hidden="true" />

      <div
        data-cards=""
        className="pointer-events-auto flex items-end gap-2.5"
        style={{ width: cardRowWidth(actions.length) }}
        // Leaving the row clears it, not leaving a card, so the text doesn't
        // blink while crossing the gap between neighbours.
        onMouseLeave={() => setFocused(null)}
      >
        {actions.map((a, i) => {
          const dim = a.status !== "ready";
          return (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              // The card's name. Its face is a photograph with `alt=""` (or
              // nothing, before the render lands), and the readout isn't
              // associated with the card. A card that won't act also carries
              // its reason.
              aria-label={a.reason && a.status !== "ready" ? `${a.label}. ${a.reason}` : a.label}
              data-seat=""
              data-action={a.id}
              data-status={a.status}
              onFocus={() => setFocused(i)}
              onPointerEnter={() => setFocused(i)}
              // A card you can't act on is still clickable: the click asks
              // "why not?", answered locally rather than via an error frame. A
              // ready card on a one-card touch menu takes a second tap (`twoTap`).
              onPointerDown={(e) => {
                pressedBy.current = e.pointerType;
              }}
              onClick={() => {
                const by = pressedBy.current;
                pressedBy.current = null;
                setFocused(i);
                if (a.status !== "ready") return;
                if (twoTap && by === "touch" && touchArmed !== i) {
                  setTouchArmed(i);
                  return;
                }
                onChoose(a);
              }}
              className={cn(
                HOTBAR_TILE,
                // `relative` for the badge, and not `overflow-hidden`: the badge
                // overhangs the corner as on the shop tile.
                "relative flex flex-none items-center justify-center rounded-xl",
                "border-[3px] border-border bg-panel text-center text-[10px] font-extrabold",
                "leading-[1.05]",
                // No extra shadow or ring, so the card matches the hotbar tile.
                // Usability shows in the light face and full-colour art. Only a
                // card that will act gets the hand cursor; the others are still
                // clickable (to ask "why not?") but shouldn't promise a purchase.
                a.status === "ready" && "cursor-pointer bg-secondary-background",
                "focus-visible:outline-none",
              )}
            >
              <span
                // Anything you can't do right now is grey, whether the spot or
                // your hand refuses it; full-colour art reads as available.
                data-dim={dim ? "true" : undefined}
                className={cn("flex h-full w-full items-center justify-center px-0.5")}
              >
                {/* Blank until the render lands (or with no WebGL): the card
                    keeps its size and its name is the button's label. */}
                {thumbs[artSlot(a)] && (
                  <img
                    src={thumbs[artSlot(a)]}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-contain"
                  />
                )}
              </span>
              {CARD_BADGE[a.id] && (
                <span
                  data-badge={CARD_BADGE[a.id]}
                  className={cn(
                    "absolute -left-1.5 -top-1.5 grid h-4.5 w-4.5 place-items-center",
                    "rounded-full border-2 border-secondary-background bg-ink text-main-foreground",
                  )}
                >
                  {CARD_BADGE[a.id] === "upgrade" ? <BadgeChevron /> : <BadgeArrow />}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </AnchoredMenu>
  );
}

/** The improvement tiles' chevron: "the next one up of this". */
function BadgeChevron() {
  return (
    <svg width={10} height={10} viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.5 7.5 L6 4 L9.5 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Something already on the board is going somewhere else. */
function BadgeArrow() {
  return (
    <svg width={10} height={10} viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2 6 H9 M6.5 3 L9.5 6 L6.5 9"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
