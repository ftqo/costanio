import * as React from "react";
import { createPortal } from "react-dom";
import { Trans } from "@lingui/react/macro";
import { CardFace } from "@/components/asset/AssetParts";
import { HudButton } from "@/components/game/hud/HudButton";
import { cn } from "@/lib/utils";

/**
 * A card in your hand, enlarged, with what it does and a second press to play.
 *
 * On a phone there is no hover, so tapping a hand tile would play the card
 * before the player could learn what it does. Here the first press opens the
 * card and the second ("play it?") commits. The art (256x358, with its title
 * plate) is unreadable at tile size.
 *
 * Desktops don't need it, since hover answers for free; the caller gates it on
 * `useNoHover`.
 *
 * Not an `Overlay`, which is for decisions the game demands. Here nothing is
 * pending, so it dims but doesn't trap, and every way out is one press.
 */
export function CardSheet({
  slot,
  title,
  text,
  note,
  warn,
  action,
  onClose,
}: {
  /** Art slot for the card's baked face. See lib/cardText `playedCardSlot`. */
  slot: string;
  title: string;
  /** What the card does, in full. */
  text?: string;
  /** Why it cannot be played, when it cannot. Suppresses the action. */
  note?: string | null;
  /** It can be played and would achieve nothing. Does not suppress the action. */
  warn?: string | null;
  /**
   * The commit. Absent for a card that is never played (a Victory Point),
   * rather than a disabled button that suggests something could enable it.
   */
  action?: { label: React.ReactNode; onAct: () => void };
  onClose: () => void;
}) {
  const panel = React.useRef<HTMLDivElement>(null);

  // Escape, and a press on the dim: "I was only looking", the common case.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Focus the panel on open so a keyboard or switch user lands inside it, and
  // so Escape reaches the handler above without a stop in the dock first.
  React.useEffect(() => {
    panel.current?.focus();
  }, []);

  return createPortal(
    <div
      // `bg-ink/40`, the same dim `Overlay` draws.
      className="hud-root hud-dim fixed inset-0 z-[300] flex items-center justify-center p-4"
      // Only a press that lands on the dim closes it; one that started inside
      // the panel and drifted out (an overshot scroll) does not.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="false"
        aria-label={title}
        tabIndex={-1}
        className="hud-dialog flex max-h-full w-full max-w-[300px] flex-col items-center gap-3 overflow-y-auto p-4 outline-none"
      >
        {/* `aspect-[5/7]` is the art's own ratio, so the face is never cropped
            here (the tile crops 4% off each side). */}
        <CardFace slot={slot} className="hud-card-frame w-[160px] max-w-full overflow-hidden" />
        <div className="hud-dialog-title text-center">{title}</div>
        {text && <div className="hud-dialog-note text-center">{text}</div>}
        {/* A refusal replaces the action; a futility warning sits above one
            that still works, since a no-effect play is still allowed. See
            lib/reachability. */}
        {note && (
          <div className="hud-lane w-full px-2.5 py-2 text-center text-[12px] leading-snug text-foreground">
            {note}
          </div>
        )}
        {!note && warn && (
          <div className="w-full rounded-[10px] bg-hud-bad-tint px-2.5 py-2 text-center text-[12px] font-medium leading-snug text-[var(--hud-bad)]">
            {warn}
          </div>
        )}
        <div className={cn("flex w-full gap-2", action ? "flex-row" : "flex-col")}>
          <HudButton
            kind="secondary"
            size="md"
            className={action ? "flex-1" : "w-full"}
            onClick={onClose}
          >
            {action ? <Trans context="dismiss the card sheet">Close</Trans> : <Trans>Done</Trans>}
          </HudButton>
          {action && !note && (
            <HudButton
              kind="primary"
              size="md"
              className="flex-1"
              onClick={() => {
                // Close first, then act: a card that opens its own picker
                // (Monopoly, Year of Plenty) would otherwise stack two dialogs.
                onClose();
                action.onAct();
              }}
            >
              {action.label}
            </HudButton>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
