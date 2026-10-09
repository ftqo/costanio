import * as React from "react";
import { DecisionClock } from "./DecisionClock";
import { Trans, useLingui } from "@lingui/react/macro";
import { ScenarioDialog as Overlay } from "./ScenarioDialog";
import { CamelMap, caravanColor } from "./CamelMap";
import { ResIcon } from "@/components/asset/AssetParts";
import { CamelGlyph } from "./moduleGlyphs";
import { RES, resIconSlot } from "@/lib/cardFace";
import { bidResources, bidVotes, camelPathKey, camelsPlaced } from "@/lib/caravans";
import { cn } from "@/lib/utils";
import type { Board, BuildingView, CamelBid, CamelPath, CaravansExt, Hand } from "@/lib/types";

/** One resource's stepper: minus, the count, plus, capped at the hand. */
function BidStepper({
  idx,
  value,
  held,
  onChange,
}: {
  idx: number;
  value: number;
  held: number;
  onChange: (n: number) => void;
}) {
  const { t } = useLingui();
  const res = RES.find((r) => r.idx === idx)!;
  // The resource goes in each button's name, so a screen reader can tell the
  // two steppers apart.
  const name = res.name;
  return (
    <div className="hudx-line" data-camel-bid-row={idx} role="group" aria-label={name}>
      <ResIcon slot={resIconSlot(idx)} size={22} className="hud-ic shrink-0 object-contain" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="text-[13px] font-semibold">{res.name}</span>
        <span className="hudx-note font-num tabular-nums">
          <Trans id="camel.bid.held">you hold {held}</Trans>
        </span>
      </span>
      <span className="hudx-step">
        <button
          type="button"
          aria-label={t({ id: "camel.bid.less", message: `Bid one less ${name}` })}
          data-camel-bid-minus={idx}
          disabled={value <= 0}
          onClick={() => onChange(value - 1)}
        >
          {"−"}
        </button>
        {/* A spinbutton, so a screen reader announces the value the buttons
            change. Not `<input type="number">`: it is driven only by the
            buttons, and a text caret would go nowhere. */}
        <span
          data-camel-bid-value={idx}
          role="spinbutton"
          aria-label={name}
          aria-valuemin={0}
          aria-valuemax={held}
          aria-valuenow={value}
        >
          {value}
        </span>
        <button
          type="button"
          aria-label={t({ id: "camel.bid.more", message: `Bid one more ${name}` })}
          data-camel-bid-plus={idx}
          disabled={value >= held}
          onClick={() => onChange(value + 1)}
        >
          {"+"}
        </button>
      </span>
    </div>
  );
}

/**
 * The camel auction, for the seat whose go it is.
 *
 * The round is open and sequential: bidding starts with the seat that just
 * finished its turn and goes clockwise, one answer each, face up. So the panel:
 *
 *  1. Shows the bids already cast, in cast order. A later seat is meant to know
 *     what earlier ones committed.
 *  2. Lets the bid optionally name a placement. That is how coalitions form:
 *     bidders naming the same path with a combined majority beat the largest
 *     single bidder. A bid naming nothing joins nobody, so the picker opens on
 *     "no preference".
 *  3. Renders only for the seat on the clock; `camelRole` puts every other seat
 *     in `bid-waiting` (the engine refuses them with NOT_YOUR_TURN).
 *
 * It must not:
 *
 *  - Predict the clamp. A bid is charged when the round closes, clamped to what
 *    the seat holds then, and a 7 can force a discard in between. The panel
 *    states the rule instead of previewing it.
 *  - Treat abstaining as a timeout. `[0, 0]` is a legal and common bid, so it
 *    is a button.
 *
 * The two piles come from `ext.bid_resources`: wool and grain normally, brick
 * and lumber alongside Knights. Steppers are capped at the hand for usability;
 * the engine validates every bid.
 */
export function CamelBidPanel({
  board,
  ext,
  buildings,
  colorOf,
  hand,
  paths,
  pending,
  seatName,
  onBid,
  onClose,
}: {
  board: Board;
  ext: CaravansExt | undefined;
  /** Settlements and cities, drawn on the map in their owners' colours. */
  buildings?: BuildingView[];
  colorOf?: (seat: number) => string;
  /** The viewer's own hand, for the stepper caps. */
  hand: Hand;
  /**
   * The placements this bid may name, from `legal.camel_paths` (published to
   * the seat on the clock as well as the placer). Empty on an older server, in
   * which case the bid joins no coalition.
   */
  paths: CamelPath[];
  /** Seats yet to answer after this one, in the order they will be asked. */
  pending: number[];
  seatName: (s: number) => string;
  onBid: (cards: [number, number], path?: CamelPath) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [resA, resB] = bidResources(ext);
  // Always from zero: the panel renders only for a seat that has not answered.
  const [a, setA] = React.useState(0);
  const [b, setB] = React.useState(0);
  // The placement this bid names, keyed by `camelPathKey`: a placement is a
  // (caravan, edge) pair, since one edge can extend two caravan fronts and the
  // chain it joins decides which junctions score. Null is "no preference".
  const [want, setWant] = React.useState<string | null>(null);
  // The row under the pointer or keyboard focus, lit on the map before it is
  // chosen, so a player can see where each option is without committing.
  const [hover, setHover] = React.useState<string | null>(null);
  // One answer per round, enforced locally: the panel stays mounted until the
  // server's next view moves the clock off this seat, and the engine would
  // refuse a second bid with ALREADY_BID.
  const [sent, setSent] = React.useState(false);
  const chosen = paths.find((p) => camelPathKey(p) === want);
  const bid = (x: number, y: number) => {
    if (sent) return;
    setSent(true);
    onBid([x, y], chosen);
  };
  const total = a + b;
  const heldA = hand[resA] ?? 0;
  const heldB = hand[resB] ?? 0;
  const cast: CamelBid[] = ext?.bids ?? [];
  const { placed, supply } = camelsPlaced(ext);
  const dot = (seat: number) => (
    <span
      aria-hidden
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: colorOf ? colorOf(seat) : "var(--hud-muted)" }}
    />
  );

  return (
    <Overlay
      title={t({
        id: "camel.bid.title",
        message: "Camel vote",
        context: "title of the bidding panel (Caravans)",
      })}
      onCancel={onClose}
      // The answer and its clock stay in view while the rest scrolls (the Bid
      // buttons fell below the fold at 1280x800).
      footer={
        <>
          <div className="w-full max-w-80">
            <DecisionClock />
          </div>

          <div className="flex items-center gap-2">
            {/* Abstaining is a real answer and the most common one. It sends
                [0, 0] rather than leaving it to the clock. */}
            <button
              type="button"
              className="hud-secondary hudx-btn"
              data-camel-bid-abstain
              disabled={sent}
              onClick={() => bid(0, 0)}
            >
              <Trans id="camel.bid.abstain">Bid nothing</Trans>
            </button>
            <button
              type="button"
              className="hud-primary hudx-btn"
              data-camel-bid-send
              onClick={() => bid(a, b)}
              disabled={total === 0 || sent}
            >
              <Trans id="camel.bid.send">Bid {total}</Trans>
            </button>
          </div>
        </>
      }
    >
      <div className="flex flex-col items-center gap-2">
        <p className="hudx-note max-w-80 text-center">
          <Trans id="camel.bid.what">
            A caravan is ready to grow, and it is your go. Bid cards for the right to place the next
            camel: one card, one vote.
          </Trans>
        </p>
        {/* The supply: what a seat weighs a bid against, since the caravans end
            when it runs out. A label and value rather than a plural (see the
            tally below). */}
        {supply > 0 && (
          <span className="hudx-figure" data-camel-bid-left={supply - placed}>
            <CamelGlyph />
            <Trans id="camel.bid.left">Camels left: {supply - placed}</Trans>
          </span>
        )}
      </div>

      {/* Map, then steppers, except on a short screen (a sideways phone), where
          they swap so the steppers and the pinned answer are in the first view. */}
      <div
        data-camel-bid-body
        className="flex flex-col gap-3 [@media(max-height:500px)]:flex-col-reverse"
      >
        <CamelMap
          board={board}
          ext={ext}
          candidates={paths}
          highlight={hover ?? want}
          buildings={buildings}
          colorOf={colorOf}
          className="w-70 h-45 max-w-full shrink-0 self-center"
        />

        {/* Clamped against the viewport; see components/game/Overlay. */}
        <div className="flex flex-col gap-2 min-w-[min(280px,100%)]">
          <BidStepper idx={resA} value={a} held={heldA} onChange={setA} />
          <BidStepper idx={resB} value={b} held={heldB} onChange={setB} />
          {/* Polite, not assertive: the total changes on every press, and an
              assertive region would cut off the button's own name. */}
          <div
            className={cn(
              "self-end text-[12px] font-semibold font-num tabular-nums",
              total === 0 && "text-muted",
            )}
            data-camel-bid-total={total}
            aria-live="polite"
          >
            {/* A tally of the two steppers. At zero it says nothing about
                sitting out: nothing has been sent, and bidding nothing is an
                answer (skipping is not allowed).

                No ICU plural, and not "{total} votes" ("1 votes"): a locale with
                one plural form (zh-Hans) and a blank translation falls back to
                English under its own plural rules, so n=1 takes `other`
                (lib/i18n.test catches it). A label and value avoids that. */}
            {total === 0 ? (
              <Trans id="camel.bid.votes.none">No votes</Trans>
            ) : (
              <Trans id="camel.bid.votes">Votes: {total}</Trans>
            )}
          </div>
        </div>
      </div>

      {/* The bids already down in cast order, then the seats still to answer
          in asking order. One row per seat. */}
      {(cast.length > 0 || pending.length > 0) && (
        <div className="flex flex-col gap-1.5 min-w-[min(280px,100%)]">
          <div className="hudx-rule" />
          {cast.length > 0 && (
            <div className="flex flex-col gap-1.5" data-camel-bid-cast={cast.length}>
              {cast.map((x) => {
                const n = bidVotes(x);
                const c = x.path?.caravan;
                return (
                  <div
                    key={x.player}
                    className="hudx-line text-[12.5px]"
                    data-camel-bid-cast-seat={x.player}
                  >
                    {dot(x.player)}
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {seatName(x.player)}
                    </span>
                    {n > 0 && typeof c === "number" && (
                      <span className="hud-chip inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px]">
                        <span
                          aria-hidden
                          className="h-2 w-2 rounded-full"
                          style={{ background: caravanColor(c) }}
                        />
                        <Trans id="camel.bid.row.caravan">caravan {c + 1}</Trans>
                      </span>
                    )}
                    <span className="hudx-note font-num tabular-nums">
                      {n <= 0 ? (
                        <Trans id="camel.bid.row.none">bid nothing</Trans>
                      ) : (
                        <Trans id="camel.bid.row.votes">Votes: {n}</Trans>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {pending.length > 0 && (
            <div className="flex flex-col gap-1.5" data-camel-bid-pending={pending.length}>
              {pending.map((seat) => (
                <div
                  key={seat}
                  className="hudx-line text-[12.5px] text-muted"
                  data-camel-bid-pending-seat={seat}
                >
                  {dot(seat)}
                  <span className="min-w-0 flex-1 truncate">{seatName(seat)}</span>
                  <span className="hudx-note">
                    <Trans id="camel.bid.row.waiting" context="a seat that has not bid yet">
                      waiting
                    </Trans>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="hudx-rule" />
        </div>
      )}

      {/* Naming a placement is optional and defaults to none. It is the only
          way to join a coalition. */}
      {paths.length > 0 && (
        <div className="flex flex-col gap-1.5 min-w-[min(280px,100%)]" data-camel-bid-paths>
          <span className="hud-lab">
            <Trans id="camel.bid.prefer">Name where you want it (optional)</Trans>
          </span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-camel-bid-path="none"
              aria-pressed={want === null}
              onClick={() => setWant(null)}
              className="hudx-cell flex-row px-2.5 text-[12px]"
            >
              <Trans id="camel.bid.prefer.none">No preference</Trans>
            </button>
            {paths.map((p, i) => {
              const key = camelPathKey(p);
              // A caravan with two fronts (or a fork) offers several
              // placements; number them within their caravan, in server order,
              // so the rows aren't identical.
              const siblings = paths.filter((o) => o.caravan === p.caravan);
              const choice = paths.slice(0, i + 1).filter((o) => o.caravan === p.caravan).length;
              const n = p.caravan + 1;
              return (
                <button
                  key={key}
                  type="button"
                  data-camel-bid-path={key}
                  aria-pressed={want === key}
                  onClick={() => setWant((k) => (k === key ? null : key))}
                  onMouseEnter={() => setHover(key)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(key)}
                  onBlur={() => setHover(null)}
                  className="hudx-cell flex-row gap-1.5 px-2.5 text-[12px]"
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: caravanColor(p.caravan) }}
                  />
                  {/* Caravans are numbered from 1 for a reader; the wire counts
                      from 0. */}
                  {siblings.length > 1 ? (
                    <Trans id="camel.bid.prefer.row.choice">
                      Caravan {n}, choice {choice}
                    </Trans>
                  ) : (
                    <Trans id="camel.bid.prefer.row">Caravan {p.caravan + 1}</Trans>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* "Win or lose" (every bid is paid whatever the outcome) is the most
          surprising rule, so it stays in view; the clamp, the open round, the
          coalition rule and the clock are one tap away. */}
      <p className="hudx-note text-center">
        <Trans id="camel.bid.promise.short">You pay when the round closes, win or lose.</Trans>
      </p>
      <details className="hud-chip px-3 py-2 text-xs text-muted">
        <summary className="cursor-pointer font-semibold text-foreground">
          <Trans>How bidding works</Trans>
        </summary>
        <div className="mt-2 flex flex-col gap-2 leading-snug">
          <span>
            <Trans id="camel.bid.open">
              Bidding is open and goes clockwise from the player who just built, one answer each.
              Every bid is face up, so a later bidder answers knowing the tally.
            </Trans>
          </span>
          <span>
            <Trans id="camel.bid.coalition">
              Two or more bidders who name the same placement pool their votes, and a majority
              between them beats the largest single bidder. That is what naming one is for.
            </Trans>
          </span>
          <span>
            <Trans id="camel.bid.promise">
              You pay when the round closes, win or lose, not now. If you spend those cards first,
              your bid is trimmed to what you still hold and you keep only the votes you can pay
              for.
            </Trans>
          </span>
          <span>
            {/* The clock in words: the sentence says what the timeout does,
                the footer's DecisionClock shows how long is left. */}
            <Trans id="camel.bid.clock">
              This vote is on a clock. If it runs out, nothing is bid on your behalf.
            </Trans>
          </span>
        </div>
      </details>
    </Overlay>
  );
}
