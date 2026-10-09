import * as React from "react";

/**
 * Whether the game's own action controls are held: shown, but disabled.
 *
 * The game screen holds them while the board is still loading behind its
 * entry cover (see lib/useGameEntry). The board layer is `inert` for that
 * window; the HUD is not, because the header, account menu, chat, log, seat
 * rail, settings and Leave must stay usable. What is held is every control
 * that sends a game command or arms a board placement: a player must not end
 * a turn, roll or build against a board they cannot see yet.
 *
 * One flag read in a few places rather than a condition at every button: the
 * game screen provides it, `HeldActions` disables whole groups of controls,
 * `Overlay` holds every decision dialog's body, and the command path itself
 * (`cmd` in routes/Game) refuses while it is set, so nothing leaves even
 * from a control nobody wrapped.
 */
export const CommandHoldContext = React.createContext(false);

/** The current hold. False outside a provider, so nothing else is affected. */
export function useCommandHold(): boolean {
  return React.useContext(CommandHoldContext);
}

/**
 * Disables every form control inside while the hold is on.
 *
 * A `<fieldset disabled>` rather than a prop threaded to each button: the
 * browser then disables every descendant control natively, so the press, the
 * keyboard activation and focus all go, `:disabled` matches (every HUD
 * primitive's disabled face is a `disabled:` variant, so they look disabled),
 * and assistive tech reads each control as unavailable.
 *
 * `contents` gives the fieldset no box, so wrapping a group changes no
 * layout: its children stay flex or grid items of the parent.
 *
 * Native disabling follows the DOM, not the React tree, so a portal inside
 * escapes it. Wrap the portal's own content instead (as `Overlay` does).
 */
export function HeldActions({ children }: { children: React.ReactNode }) {
  const held = useCommandHold();
  return (
    <fieldset disabled={held} data-command-hold={held ? "" : undefined} className="contents">
      {children}
    </fieldset>
  );
}
