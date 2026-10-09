// Modal-dialog mechanics, as pure functions over a DOM subtree.
//
// The game screen's `Overlay` hosts about a dozen decisions (steal-from,
// Monopoly, Year of Plenty, the Aqueduct, the Wedding give, the Commercial
// Harbor, both Master Merchant steps, the Spy pick, the tied-defender draw, the
// over-limit progress discard, the host's reset confirm). Each needs a role,
// `aria-modal`, initial focus, a focus trap, focus restore and Escape.
//
// Kept out of the component so it can be tested against a jsdom subtree and
// reused by any dialog.

/**
 * What counts as focusable, in document order. `[tabindex="-1"]` is excluded:
 * a programmatically focusable container (the panel) is not a tab stop.
 */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Whether an element can currently take focus.
 *
 * `disabled` is not enough: pickers here disable rather than remove buttons,
 * and some render hidden buttons (the Aqueduct's "Take nothing" appears only
 * when the bank is empty). `hidden`, `display:none` and `visibility:hidden`
 * all drop out.
 *
 * jsdom has no `offsetParent` or layout, so visibility uses computed style.
 */
export function isFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled")) return false;
  // Disabled through an ancestor (a held decision; see CommandHold). The
  // browser will not focus it, so a trap that picked it would stick.
  if (el.matches("button, input, select, textarea") && el.closest("fieldset[disabled]")) {
    return false;
  }
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (el.hidden) return false;
  const win = el.ownerDocument?.defaultView;
  if (win) {
    const st = win.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
  }
  return true;
}

/** Every focusable descendant of `root`, in tab order. */
export function focusableIn(root: HTMLElement | null | undefined): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isFocusable);
}

/**
 * Where focus should go when a dialog opens: the first focusable control,
 * since these dialogs are all "pick one of these". Falls back to the panel
 * (`tabIndex={-1}`) when there are no controls, so focus never stays on the
 * page underneath.
 */
export function initialFocus(root: HTMLElement | null | undefined): HTMLElement | null {
  if (!root) return null;
  // A dialog can mark a preferred control: the camel placement opens on the row
  // its winner named in their bid.
  const preferred = root.querySelector<HTMLElement>("[data-initial-focus]");
  if (preferred && isFocusable(preferred)) return preferred;
  return focusableIn(root)[0] ?? root;
}

/**
 * The element Tab should move to, wrapping at both ends.
 *
 * Returns null when there is nothing to move to (the caller leaves the event
 * alone). With `current` outside the dialog, Tab goes to the first control and
 * Shift+Tab to the last, pulling focus back in.
 */
export function nextFocus(
  items: HTMLElement[],
  current: Element | null,
  shift: boolean,
): HTMLElement | null {
  if (items.length === 0) return null;
  const i = current instanceof HTMLElement ? items.indexOf(current) : -1;
  if (i < 0) return shift ? items[items.length - 1] : items[0];
  const n = items.length;
  return items[(i + (shift ? -1 : 1) + n) % n];
}
