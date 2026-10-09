// "Don't show this again", persisted per browser.
//
// These flags are viewer-local and advisory (nothing here gates an action), so
// localStorage is enough: a cleared profile only costs one more dialog.
//
// Every access is wrapped: localStorage throws in a browser that blocks site
// data, and the dialog must still open.

const PREFIX = "dismissed:";

/** Has the viewer asked not to see this dialog again? False if unreadable. */
export function isDismissed(key: string): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(PREFIX + key) === "1";
  } catch {
    return false;
  }
}

/** Remember not to show this dialog again. A no-op if storage is unwritable. */
export function dismiss(key: string): void {
  try {
    localStorage.setItem(PREFIX + key, "1");
  } catch {
    // Blocked storage: the dialog opens again next time, the safe failure.
  }
}

/** Show this dialog again. The undo for `dismiss`, and what tests reset with. */
export function undismiss(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // As above.
  }
}
