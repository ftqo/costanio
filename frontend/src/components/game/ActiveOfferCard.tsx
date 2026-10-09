import type { TradeExtra } from "@/lib/types";
import {
  extraCommodities,
  extraCurrencies,
  CURRENCY_NAMES,
  type CurrencyKey,
} from "@/lib/scenarioCurrency";
import * as React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "@/lib/utils";
import { formatList } from "@/lib/intl";
import { Button } from "@/components/ui/button";
import { ResIcon } from "@/components/asset/AssetParts";
import { handChips, goodCount } from "@/lib/cardFace";
import { FLOATING_OFFER_POS, FLOATING_PROMPT } from "@/lib/hudChrome";
import { SeatChoice, SeatChoiceRow } from "./SeatChoice";

/**
 * One side of a trade offer: the card art with a count beside each, and the
 * name on hover. Same treatment as the bank strip and the event log.
 *
 * `size` covers the two scales it appears at: the offer's headline row, and a
 * caption under a counter-offering player's name.
 */
function HandChips({
  hand,
  coms,
  size = 20,
}: {
  hand: number[];
  coms?: TradeExtra;
  size?: number;
}) {
  const { t } = useLingui();
  const chips = handChips(hand, extraCommodities(coms));
  const currencies = Object.entries(extraCurrencies(coms)).filter(
    ([key, n]) => key in CURRENCY_NAMES && typeof n === "number" && n > 0,
  );
  if (chips.length === 0 && currencies.length === 0)
    return (
      <span className="text-muted">
        <Trans context="one side of a trade offer holds no cards">nothing</Trans>
      </span>
    );
  return (
    // Wraps: a Knights offer can name eight kinds on a side, more than fits on
    // a phone, and the card is `fixed`, so overflow would just be clipped.
    <span className="flex flex-wrap items-center justify-center gap-1.5">
      {currencies.map(([key, n]) => (
        <span key={key} className="font-semibold font-num tabular-nums">
          {t(CURRENCY_NAMES[key as CurrencyKey])} × {n}
        </span>
      ))}
      {chips.map((chip) => (
        <span
          key={chip.key}
          title={goodCount(chip.name, chip.n)}
          className="flex items-center gap-0.5 font-extrabold font-num tabular-nums"
        >
          {/* Falls back to the name, so a count always says what it counts. */}
          <ResIcon slot={chip.slot} size={size} fallback={<span>{chip.name}</span>} />×{chip.n}
        </span>
      ))}
    </span>
  );
}

/**
 * The standing trade offer, from every seat's point of view. Its own component
 * so the opponent picker can be rendered and clicked in a test.
 */
export function ActiveOfferCard({
  offer,
  viewer,
  recipients,
  deadlineMs,
  seatName,
  colorOf,
  onRespond,
  onRetract,
  onExecute,
  onCancel,
}: {
  offer: {
    by: number;
    give: number[];
    want: number[];
    give_com?: TradeExtra;
    want_com?: TradeExtra;
    accepted?: number[];
    declined?: number[];
    counters?: {
      by: number;
      give: number[];
      want: number[];
      give_com?: TradeExtra;
      want_com?: TradeExtra;
    }[];
  };
  viewer: number;
  /** Every seat the offer is put to, i.e. every seat but the offerer's. Lets
   *  the offerer's card say who it is waiting on, and resolve as soon as the
   *  last of them answers. */
  recipients: number[];
  deadlineMs: number | null;
  seatName: (s: number) => string;
  colorOf: (s: number) => string;
  onRespond: (accept: boolean) => void;
  onRetract: () => void;
  onExecute: (withSeat: number) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  // A negative viewer has no seat to trade from (a spectator, or an owner
  // watching a bot play their seat). They see the offer, which is public, but
  // get no controls.
  const watching = viewer < 0;
  const isMine = offer.by === viewer;
  const accepted = offer.accepted ?? [];
  const counters = offer.counters ?? [];
  const declined = offer.declined ?? [];
  const iAccepted = accepted.includes(viewer);
  const iDeclined = declined.includes(viewer);
  const iCountered = counters.some((c) => c.by === viewer);
  const iResponded = iAccepted || iDeclined || iCountered;
  // Who the offerer is still waiting on. Bots answer every offer, so once this
  // is empty the table has spoken; if nobody took it, the card says so and
  // stops counting down.
  const answered = (s: number) =>
    accepted.includes(s) || declined.includes(s) || counters.some((c) => c.by === s);
  const others = recipients.filter((s) => s !== offer.by);
  const waitingOn = others.filter((s) => !answered(s));
  const allDeclined =
    others.length > 0 && waitingOn.length === 0 && accepted.length === 0 && counters.length === 0;
  const showClock = deadlineMs != null && !(isMine && allDeclined);
  const waitingNames = formatList(waitingOn.map(seatName));
  const declinedNames = formatList(declined.map(seatName));
  // Tick the offer's remaining lifetime locally off a monotonic anchor; the
  // server re-syncs deadlineMs on every frame and auto-cancels when it elapses.
  const [remaining, setRemaining] = React.useState(deadlineMs ?? 0);
  React.useEffect(() => {
    if (deadlineMs == null) return;
    const anchor = performance.now();
    setRemaining(deadlineMs);
    const id = setInterval(
      () => setRemaining(Math.max(0, deadlineMs - (performance.now() - anchor))),
      200,
    );
    return () => clearInterval(id);
  }, [deadlineMs]);
  const secsLeft = Math.ceil(remaining / 1000);
  // The lifetime scales with the game's pace, so the bar's full mark is the
  // largest budget seen for this offer. The card remounts per offer, so this
  // ref is per-offer.
  const peakMs = React.useRef(0);
  if (deadlineMs != null && deadlineMs > peakMs.current) peakMs.current = deadlineMs;
  const pct = peakMs.current > 0 ? Math.min(100, (remaining / peakMs.current) * 100) : 100;
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
      <div className="flex items-center justify-center gap-2 text-[12px] font-extrabold">
        <span>
          {isMine ? <Trans>Your offer</Trans> : <Trans>{seatName(offer.by)} offers a trade</Trans>}
        </span>
        {showClock && (
          <span
            className={cn(
              "text-[11px] font-num tabular-nums",
              remaining <= 10_000 ? "text-red-ink" : "text-muted",
            )}
          >
            {t({ message: `${secsLeft}s`, context: "seconds left on a timer, compact" })}
          </span>
        )}
      </div>
      {showClock && (
        <div className="h-1.5 w-full rounded-full bg-panel overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-200 ease-linear",
              remaining <= 10_000 ? "bg-red" : "bg-green",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 justify-center text-[12px]">
        <span className="text-muted">
          <Trans context="what the offering seat puts in">gives</Trans>
        </span>{" "}
        <HandChips hand={offer.give} coms={offer.give_com} />
        <span>↔</span>
        <span className="text-muted">
          <Trans context="what the offering seat asks for">wants</Trans>
        </span>{" "}
        <HandChips hand={offer.want} coms={offer.want_com} />
      </div>
      {watching ? null : isMine ? (
        <div className="flex flex-col items-center gap-1.5">
          {/* Closing the deal picks an opponent, drawn like every other seat
              picker (robber steal, Deserter, Spy, Master Merchant): a
              settlement in the seat's colour with the name under it. The verb
              goes in the caption above, since every tile does the same thing. */}
          {(accepted.length > 0 || counters.length > 0) && (
            <span className="text-[10px] font-bold text-muted">
              <Trans>Tap a player to close the deal</Trans>
            </span>
          )}
          <SeatChoiceRow>
            {accepted.map((s) => (
              <SeatChoice
                key={s}
                seat={s}
                name={seatName(s)}
                color={colorOf(s)}
                // What they agreed to, so an acceptance and a counter differ
                // by their detail line.
                detail={<Trans context="this seat accepted the offer unchanged">as offered</Trans>}
                title={t`Trade with ${seatName(s)} on your terms`}
                onSelect={onExecute}
              />
            ))}
            {counters.map((c) => (
              <SeatChoice
                key={`c${c.by}`}
                seat={c.by}
                name={seatName(c.by)}
                color={colorOf(c.by)}
                // A counter is a different trade, so the tile shows its terms.
                detail={
                  // Wraps: a counter names both sides, wider than the tile on
                  // a phone.
                  <span className="flex flex-wrap items-center justify-center gap-1">
                    <Trans context="what the countering seat puts in">gives</Trans>{" "}
                    <HandChips hand={c.give} coms={c.give_com} size={14} />{" "}
                    <Trans context="what the countering seat asks for">wants</Trans>{" "}
                    <HandChips hand={c.want} coms={c.want_com} size={14} />
                  </span>
                }
                title={t`Trade with ${seatName(c.by)} on their counter-offer`}
                onSelect={onExecute}
              />
            ))}
          </SeatChoiceRow>
          {allDeclined ? (
            <span className="text-[11px] font-bold" role="status">
              <Trans>Everyone declined.</Trans>
            </span>
          ) : waitingOn.length > 0 ? (
            <span className="text-[11px] text-muted" role="status">
              <Trans>Waiting for {waitingNames}…</Trans>
            </span>
          ) : null}
          {declined.length > 0 && !allDeclined && (
            <span className="text-[11px] text-muted">
              <Trans context="the seats that turned down your trade offer">
                Declined: {declinedNames}
              </Trans>
            </span>
          )}
          <Button size="sm" variant="secondary" onClick={onCancel}>
            {allDeclined ? (
              <Trans context="dismiss your own trade offer after everyone declined it">Close</Trans>
            ) : (
              <Trans context="withdraw your own trade offer">Cancel</Trans>
            )}
          </Button>
        </div>
      ) : (
        // An answer stands until the offerer acts on it, and can be changed or
        // taken back until then (mis-taps are common).
        //
        // Each answer is a toggle, like the bank and event log: press to say it,
        // press again to take it back, and it stays held down while it is on
        // record. That makes re-sending the recorded answer (which the server
        // refuses) unreachable.
        //
        // A counter is not one of these toggles: it is built from the hand
        // below. Reject replaces it, and a second press of Reject clears that,
        // so the two buttons still reach every server state.
        <div className="flex flex-col items-center gap-1">
          <div className="flex gap-1.5 justify-center">
            <Button
              size="sm"
              aria-pressed={iAccepted}
              data-offer-answer=""
              className={cn(
                "bg-green text-main-foreground",
                iAccepted &&
                  "translate-x-boxShadowX translate-y-boxShadowY shadow-[0_0_0_0_var(--border)]",
              )}
              onClick={() => (iAccepted ? onRetract() : onRespond(true))}
            >
              <Trans context="accept a trade offer">Accept</Trans>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-pressed={iDeclined}
              data-offer-answer=""
              className={cn(
                iDeclined &&
                  "translate-x-boxShadowX translate-y-boxShadowY shadow-[0_0_0_0_var(--border)]",
              )}
              onClick={() => (iDeclined ? onRetract() : onRespond(false))}
            >
              <Trans context="reject a trade offer">Reject</Trans>
            </Button>
          </div>
          <span className="text-[10px] text-muted">
            {iCountered ? (
              <Trans>Counter-offer sent. Change it from your hand below, or answer above.</Trans>
            ) : iResponded ? (
              <Trans>Press your answer again to take it back.</Trans>
            ) : (
              <Trans>…or build a counter-offer from your hand below</Trans>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
