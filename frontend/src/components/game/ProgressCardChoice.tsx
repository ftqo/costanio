import { Tip } from "@/components/game/Tip";
import { CardFace } from "@/components/asset/AssetParts";
import {
  progressCardName,
  progressCardHint,
  progressDeckLook,
  progressSlot,
} from "@/lib/progressCards";
import { cn } from "@/lib/utils";

/**
 * One progress card offered as a choice in a picker (Spy's steal, the
 * over-limit discard).
 *
 * Drawn as the card itself (the baked face, at card proportions), which carries
 * its own name. The effect text is in the hover tip, a real cost on touch. The
 * deck stripe stays on top of the art so a card seen here is recognisable later
 * in your hand.
 */
export function ProgressCardChoice({
  card,
  onSelect,
  disabled,
  className,
}: {
  card: string;
  onSelect: (card: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const name = progressCardName(card);
  const hint = progressCardHint(card);
  const deck = progressDeckLook(card);
  return (
    <Tip title={name} hint={hint}>
      <button
        type="button"
        disabled={disabled}
        aria-label={hint ? `${name}: ${hint}` : name}
        onClick={() => onSelect(card)}
        data-progress-choice=""
        className={cn(
          // Two to a row in a 320px dialog (256px inside), so a four-card Spy
          // hand isn't one tall column. The hand's card frame (`hud-card-frame`):
          // a hairline edge, a soft drop, and the same lift under the pointer.
          "hud-card-frame relative isolate w-[116px] sm:w-[124px] overflow-hidden bg-[var(--card-face)]",
          disabled ? "cursor-default" : "hud-lift cursor-pointer",
          className,
        )}
      >
        {deck && (
          <span
            role="img"
            aria-label={deck.aria}
            className="hud-deck-band"
            style={{ background: deck.color }}
          />
        )}
        {/* Blank until the face loads: the name and effect are the button's
            label and the tip. */}
        <CardFace slot={progressSlot(card)} className="block h-auto w-full" />
      </button>
    </Tip>
  );
}
