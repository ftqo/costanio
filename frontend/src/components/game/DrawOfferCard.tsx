import { Trans } from "@lingui/react/macro";
import { formatList } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FLOATING_OFFER_POS, FLOATING_PROMPT } from "@/lib/hudChrome";

/**
 * The standing offer to end the game in a draw, from every seat's point of view.
 *
 * Same floating-prompt idiom as the trade offer. No countdown, but it expires
 * at the end of the turn or on its own timer, whichever comes first; the timer
 * covers a table with no turn timer, where the turn need never end.
 */
export function DrawOfferCard({
  offer,
  viewer,
  seatName,
  onRespond,
  onWithdraw,
}: {
  offer: { by: number; accepted?: number[] };
  viewer: number;
  seatName: (s: number) => string;
  onRespond: (accept: boolean) => void;
  // Absent for a viewer with nothing to withdraw (spectators, and anyone who is
  // not the offerer).
  onWithdraw?: () => void;
}) {
  // A negative viewer has no seat to answer from (a spectator, or an owner
  // watching a bot play their seat). They see the offer but no controls, as
  // with a trade offer.
  const watching = viewer < 0;
  const isMine = offer.by === viewer;
  const accepted = offer.accepted ?? [];
  const iAccepted = accepted.includes(viewer);
  return (
    <div
      className={cn(
        FLOATING_PROMPT,
        // Above the dock, measured; hung from the top row on a sideways
        // phone. See FLOATING_OFFER_POS.
        FLOATING_OFFER_POS,
        "rounded-2xl p-3 flex flex-col gap-2",
      )}
    >
      <div className="text-center text-[12px] font-extrabold">
        {isMine ? (
          <Trans context="the game ends level">You offered a draw</Trans>
        ) : (
          <Trans context="the game ends level">{seatName(offer.by)} offers a draw</Trans>
        )}
      </div>
      <div className="text-center text-[11px] text-muted">
        {isMine || watching || iAccepted ? (
          <Trans>Every other player has to accept. The offer expires if it isn't answered.</Trans>
        ) : (
          <Trans>Accepting ends the game with no winner.</Trans>
        )}
      </div>
      {accepted.length > 0 && (
        <div className="text-center text-[11px] text-muted">
          {/* The locale's own list grammar, not a hardcoded comma: see lib/intl. */}
          <Trans>Accepted: {formatList(accepted.map(seatName))}</Trans>
        </div>
      )}
      {isMine && onWithdraw && (
        <div className="flex justify-center">
          <Button size="sm" variant="secondary" onClick={onWithdraw}>
            <Trans context="take back your own draw offer">Withdraw offer</Trans>
          </Button>
        </div>
      )}
      {watching || isMine || iAccepted ? null : (
        <div className="flex gap-1.5 justify-center">
          <Button
            size="sm"
            className="bg-green text-main-foreground"
            onClick={() => onRespond(true)}
          >
            <Trans context="the game ends level">Accept draw</Trans>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onRespond(false)}>
            <Trans context="decline a draw offer">Decline</Trans>
          </Button>
        </div>
      )}
    </div>
  );
}
