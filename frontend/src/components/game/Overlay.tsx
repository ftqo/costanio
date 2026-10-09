import * as React from "react";
import { cn } from "@/lib/utils";
import { focusableIn, initialFocus, nextFocus } from "@/lib/dialog";
import { HeldActions } from "./CommandHold";

let seq = 0;

/**
 * How the player last touched the page: a pointer (mouse, finger, pen) or the
 * keyboard. Read when a dialog opens, to decide where focus lands.
 *
 * Focus moved by script after a pointer press matches `:focus-visible` in
 * Chrome, so focusing the first choice would draw a ring that reads as
 * "already selected". Keyboard users get the first choice; anyone else
 * (including an untouched page, as when another seat's roll opens a dialog)
 * gets the panel itself, which draws no ring and still announces the title.
 *
 * Module state: a fact about the document, installed once, nothing renders
 * from it.
 */
let lastInput: "none" | "keyboard" | "pointer" = "none";
let tracking = false;
function trackInput(doc: Document | undefined) {
  if (tracking || !doc) return;
  tracking = true;
  doc.addEventListener("pointerdown", () => (lastInput = "pointer"), true);
  doc.addEventListener("keydown", () => (lastInput = "keyboard"), true);
}
trackInput(typeof document === "undefined" ? undefined : document);

/**
 * The game screen's one blocking modal, used by about a dozen decisions
 * (steal-from, Monopoly, Year of Plenty, the Aqueduct, the Wedding give, the
 * Commercial Harbor, both Master Merchant steps, the Spy pick, the Trading
 * House, the tied-defender draw, the over-limit progress discard, the host's
 * reset confirm).
 *
 * Provides `role="dialog"`/`aria-modal`, initial focus, a focus trap, focus
 * restore on close, and Escape. `onCancel` is optional because some decisions
 * can't be declined (the Deserter's victim owes a knight); those omit it and
 * keep a trap with no exit.
 */
export function Overlay({
  title,
  children,
  onCancel,
  className,
  dismissLabel,
  footer,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  /**
   * The decision itself (its buttons and clock), pinned to the bottom of the
   * panel while the body scrolls, so a tall decision like the camel vote keeps
   * its answer above the fold.
   */
  footer?: React.ReactNode;
  /**
   * Dismiss the dialog. Wired to Escape and to a click on the dim backdrop.
   * Omit for a decision the player is not allowed to decline.
   */
  onCancel?: () => void;
  className?: string;
  dismissLabel?: string;
}) {
  const panel = React.useRef<HTMLDivElement>(null);
  // Stable per mount, so the title's id and the panel's aria-labelledby agree
  // even when two dialogs are on screen at once.
  const [titleId] = React.useState(() => `overlay-title-${++seq}`);
  // Read through a ref so the focus effect stays mount/unmount only; a changing
  // handler would re-run it and steal focus back after every keystroke.
  const cancelRef = React.useRef(onCancel);
  cancelRef.current = onCancel;

  // Take focus on open, restore on close. The restore target is captured at
  // mount, since the trigger may be gone by unmount (playing a progress card
  // removes the card you clicked).
  React.useEffect(() => {
    const doc = panel.current?.ownerDocument;
    const restore = doc?.activeElement;
    const marked = panel.current?.querySelector<HTMLElement>("[data-initial-focus]");
    if (lastInput !== "keyboard" && !marked) panel.current?.focus();
    else initialFocus(panel.current)?.focus();
    return () => {
      if (restore instanceof HTMLElement && restore.isConnected) restore.focus();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // The game screen runs an Escape "ladder" on window (disarm a build mode,
      // back out of a move, …). A dialog sits above all of it, so it consumes
      // the key, even when it can't be dismissed; otherwise one press would
      // leave the forced dialog open and silently disarm the mode behind it.
      e.preventDefault();
      e.stopPropagation();
      cancelRef.current?.();
      return;
    }
    if (e.key !== "Tab") return;
    const items = focusableIn(panel.current);
    const to = nextFocus(items, panel.current?.ownerDocument?.activeElement ?? null, e.shiftKey);
    if (!to) return;
    e.preventDefault();
    to.focus();
  };

  return (
    <div
      // `hud-root`: a game dialog is HUD chrome wherever it is mounted, so it
      // takes the HUD tokens and type even outside HudLayer.
      className="hud-root hud-dim fixed inset-0 z-50 flex items-center justify-center p-3"
      // A click that starts and ends on the dim dismisses it. Checked on the
      // target, so a drag from inside the panel released on the backdrop
      // doesn't count.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancelRef.current?.();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "hud-dialog p-5",
          // `min-w` is clamped against the same viewport bound as `max-w`: in
          // CSS min-width wins, and the container is a centred flex row with no
          // overflow, so an oversized panel is clipped on both sides. Panels
          // with their own floor clamp it the same way (CamelPlacePanel,
          // CamelBidPanel, FishSpendPanel).
          // Viewport units don't follow the root `zoom` (index.css): a bare 90vh
          // at zoom 1.2 is 108% of the screen. `--ui-zoom` is set beside every
          // zoom rule.
          "flex flex-col gap-3 min-w-[min(280px,94vw)] max-w-[94vw] max-h-[calc(90vh/var(--ui-zoom,1))] overflow-y-auto",
          "focus-visible:outline-none",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div id={titleId} className="hud-dialog-title flex-1 text-center">
            {title}
          </div>
          {onCancel && dismissLabel && (
            <button
              type="button"
              aria-label={dismissLabel}
              onClick={onCancel}
              // 36px, and 27px under the sideways-phone zoom; the hit area grows
              // 8px a side on touch, so 39px there.
              className="hud-dismiss relative grid size-9 shrink-0 place-items-center text-[18px] leading-none pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']"
            >
              <span aria-hidden>×</span>
            </button>
          )}
        </div>
        {/* The decision itself is held while the game's commands are (see
            CommandHold); the title and the dismiss button are not. Body and
            footer each get their own box-less fieldset, so the footer stays
            the panel's last child. */}
        <HeldActions>{children}</HeldActions>
        {footer && (
          // Sticky rather than outside the scroller, so a short dialog looks
          // unchanged and a tall one keeps the footer in view. Negative margins
          // reach the panel's edges so the body scrolls behind it; the solid
          // background and rule show that the list continues above.
          <div
            data-overlay-footer
            className="hud-dialog-foot sticky -bottom-5 z-10 -mx-5 -mb-5 mt-auto flex flex-col items-center gap-2 px-5 pt-3 pb-5"
          >
            <HeldActions>{footer}</HeldActions>
          </div>
        )}
      </div>
    </div>
  );
}
