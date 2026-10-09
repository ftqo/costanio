import { Trans, useLingui } from "@lingui/react/macro";
import { GoodIcon } from "@/components/asset/AssetParts";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { ScenarioDialog as Overlay } from "./ScenarioDialog";
import { Icons } from "./hudIcons";
import * as React from "react";
import { FISH_TILE_CAP, type FishMix, type FishOffer, type FishSpend, tileCount } from "@/lib/fish";

/** What each spend buys, one whole sentence per spend rather than a noun slot. */
const SPEND_NAME: Record<FishSpend, MessageDescriptor> = {
  wagon_boost: msg({
    id: "fish.spend.wagonBoost",
    message: "Give your wagon 2 extra movement points",
  }),
  remove_robber: msg({
    id: "fish.spend.removeRobber",
    message: "Take the robber off the board",
  }),
  steal: msg({ id: "fish.spend.steal", message: "Steal a card" }),
  take_resource: msg({
    id: "fish.spend.takeResource",
    message: "Take a resource from the bank",
  }),
  free_road: msg({ id: "fish.spend.freeRoad", message: "Build a road for nothing" }),
  bridge: msg({ id: "fish.spend.bridge", message: "Build a bridge for nothing" }),
  dev_card: msg({ id: "fish.spend.devCard", message: "Draw a development card" }),
  progress_card: msg({ id: "fish.spend.progressCard", message: "Draw a progress card" }),
};

const SPEND_HINT: Record<FishSpend, MessageDescriptor> = {
  wagon_boost: msg({
    id: "fish.hint.wagonBoost.perTrip",
    message: "Once per trip, instead of spending wheat. Whole fish tiles are spent.",
  }),
  remove_robber: msg({
    id: "fish.hint.removeRobber",
    message:
      "It leaves play entirely, with no steal, and comes back when somebody next rolls a 7 or plays a knight.",
  }),
  steal: msg({ id: "fish.hint.steal", message: "One card at random, from a player you name." }),
  take_resource: msg({
    id: "fish.hint.takeResource",
    message: "Any one of the five resources, if the bank still has it.",
  }),
  // The spot is chosen first: the spend names the edge, and Game.tsx's
  // fishRoad effect builds there as soon as the engine's credit lands.
  free_road: msg({
    id: "fish.hint.freeRoad.placed",
    message:
      "A road, or a ship where the game has them. You pick the spot next and it is built there.",
  }),
  // "the three-bridge supply", not "within your three", which read as three
  // things on the board.
  bridge: msg({
    id: "fish.hint.bridge.supply",
    message:
      "On a bridge site your network reaches, if you have a bridge left. You still receive the bridge's coins. You pick the site next.",
  }),
  dev_card: msg({ id: "fish.hint.devCard", message: "Straight off the top of the deck." }),
  progress_card: msg({
    id: "fish.hint.progressCard",
    message: "One progress card from the track you name, in a game with no development deck.",
  }),
};

/**
 * The rung's name on the ladder: a word or two, since six share one row. The
 * full sentence (SPEND_NAME) and rule (SPEND_HINT) appear under the ladder once
 * a rung is chosen, and stay inside the rung for screen readers.
 */
const RUNG_NAME: Record<FishSpend, MessageDescriptor> = {
  wagon_boost: msg({
    id: "fish.rung.wagonBoost",
    message: "Wagon +2",
    context: "fish ladder rung",
  }),
  remove_robber: msg({
    id: "fish.rung.removeRobber",
    message: "Robber off",
    context: "fish ladder rung: take the robber off the board",
  }),
  steal: msg({ id: "fish.rung.steal", message: "Steal", context: "fish ladder rung" }),
  take_resource: msg({
    id: "fish.rung.takeResource",
    message: "Resource",
    context: "fish ladder rung",
  }),
  free_road: msg({ id: "fish.rung.freeRoad", message: "Road", context: "fish ladder rung" }),
  bridge: msg({ id: "fish.rung.bridge", message: "Bridge", context: "fish ladder rung" }),
  dev_card: msg({ id: "fish.rung.devCard", message: "Dev card", context: "fish ladder rung" }),
  progress_card: msg({
    id: "fish.rung.progressCard",
    message: "Progress",
    context: "fish ladder rung: a progress card",
  }),
};

/**
 * One fish tile, drawn at the size it is worth: a small recessed chip with the
 * fish and its value, so it reads as an object you hand over.
 */
function TileChip({ value, n }: { value: 1 | 2 | 3; n: number }) {
  return (
    <span
      data-fish-tile={`${value}x${n}`}
      className="hud-chip inline-flex items-center gap-0.5 px-1 py-0.5 text-[11px] font-semibold tabular-nums text-foreground"
    >
      <GoodIcon id="fish" size={13} fallback={<Icons.fish size={11} />} className="hud-ic" />
      {value}
      {n > 1 && <span className="text-muted">{`×${n}`}</span>}
    </span>
  );
}

/** The tiles a spend actually takes, or a dash when it cannot be paid at all. */
export function TilesSpent({ pay }: { pay: FishMix | null }) {
  if (!pay) return <span className="text-xs text-muted">{"–"}</span>;
  return (
    <span className="flex items-center justify-center gap-1 flex-wrap">
      {([1, 2, 3] as const).map((v) =>
        pay[v - 1] > 0 ? <TileChip key={v} value={v} n={pay[v - 1]} /> : null,
      )}
    </span>
  );
}

/**
 * The fish spends, priced in the tiles the player will actually hand over.
 *
 * Fish don't make change: the engine picks the discard that wastes the least,
 * then the fewest tiles, and takes them whole. Holding one 3-fish tile, the
 * 2-fish spend costs all three. So every rung shows the tiles, and a rung that
 * destroys fish says so.
 *
 * Layout: a ladder of equal rungs (price, a word, the tiles), then the chosen
 * rung's detail and one Spend button. Two taps, since the spend is irreversible
 * and the second tap is where the waste warning is read.
 *
 * A spend the ruleset or board refuses isn't in `offers` at all (see
 * `fishOffers`), so the 7-fish rung is a development card in one game and a
 * progress card in another. An unaffordable spend is drawn disabled: seeing the
 * ladder up to 7 is how a player plans.
 */
export function FishSpendPanel({
  offers,
  mix,
  onSpend,
  onClose,
  onGiveBoot,
  riderHurry = false,
}: {
  offers: FishOffer[];
  mix: FishMix;
  onSpend: (spend: FishSpend) => void;
  onClose: () => void;
  /** Offered only when this player holds the boot and someone may take it. */
  onGiveBoot?: () => void;
  /**
   * Raiders: two fish can also hurry a rider. That spend is made from the rider
   * move itself, so it isn't a rung; this line notes it so the ladder doesn't
   * seem to start at 3.
   */
  riderHurry?: boolean;
}) {
  const { i18n, t } = useLingui();
  const total = mix[0] + 2 * mix[1] + 3 * mix[2];
  const tiles = tileCount(mix);
  const [pick, setPick] = React.useState<FishSpend | null>(null);
  const chosen = offers.find((o) => o.spend === pick && o.affordable) ?? null;
  const atCap = tiles >= FISH_TILE_CAP;
  // Bound outside the JSX so the placeholders are named: the waste sentence is
  // shared with the rungs, and `{chosen.waste}` would extract as `{0}`.
  const lost = chosen?.waste ?? 0;
  const cost = chosen?.cost ?? 0;
  // Five across fits at every width; a sixth rung (the Rivers bridge) splits
  // the ladder into two rows of three.
  const cols = offers.length <= 5 ? offers.length : 3;
  return (
    <Overlay
      title={t({
        id: "fish.panel.title",
        message: "Fish",
        context: "title of the panel where fish are spent",
      })}
      onCancel={onClose}
    >
      {/* What is in hand, as tiles. Tile count and fish value are both shown
          because they differ once a 2- or 3-fish tile is drawn: prices are paid
          in tiles, plans are made in fish. */}
      <div className="flex items-center justify-center gap-2 flex-wrap" data-fish-holding>
        {/* Nothing for an empty holding: a lone dash read as a stray mark. */}
        {tiles > 0 && <TilesSpent pay={mix} />}
        <span className="hudx-figure">
          <Trans id="fish.panel.held">{total} fish held</Trans>
        </span>
      </div>

      {/* Clamped against the viewport; see components/game/Overlay. */}
      <div
        className="hudx-row min-w-[min(300px,100%)]"
        style={{ "--n": cols } as React.CSSProperties}
        role="group"
        aria-label={t({ id: "fish.panel.ladder", message: "What fish buy" })}
      >
        {offers.map((o) => {
          const lost = o.waste;
          return (
            <button
              key={o.spend}
              type="button"
              data-fish-spend={o.spend}
              disabled={!o.affordable}
              aria-pressed={pick === o.spend}
              onClick={() => setPick((k) => (k === o.spend ? null : o.spend))}
              title={`${i18n._(SPEND_NAME[o.spend])}. ${i18n._(SPEND_HINT[o.spend])}`}
              className="hudx-cell min-h-19 justify-start"
            >
              <b>{o.cost}</b>
              <span aria-hidden className="leading-tight">
                {i18n._(RUNG_NAME[o.spend])}
              </span>
              {/* The sentence and the rule, for screen readers: the visible word
                is only a label. */}
              <span className="sr-only">
                {i18n._(SPEND_NAME[o.spend])}. {i18n._(SPEND_HINT[o.spend])}
              </span>
              {o.pay && <TilesSpent pay={o.pay} />}
              {/* Only where it bites; a warning on every rung would stop being
                read. */}
              {lost > 0 && (
                <span
                  className="text-[10.5px] font-semibold text-red-ink leading-tight"
                  data-fish-waste
                >
                  {/* Verbless, no plural: the count is only 1 or 2, and a
                    one/other pair renders wrong in single-plural-form languages
                    (see lib/i18n.test). */}
                  <Trans id="fish.rung.waste">{lost} lost</Trans>
                  <span className="sr-only">
                    {" "}
                    <Trans id="fish.panel.waste">
                      You cannot make change: {lost} fish destroyed.
                    </Trans>
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* The chosen rung in full: the sentence, the rule, and what it destroys.
          With nothing chosen, the holding cap. */}
      {chosen ? (
        <div className="flex flex-col gap-1 max-w-85" data-fish-detail={chosen.spend}>
          <span className="text-[13px] font-semibold leading-tight">
            {i18n._(SPEND_NAME[chosen.spend])}
          </span>
          <span className="hudx-note">{i18n._(SPEND_HINT[chosen.spend])}</span>
          {lost > 0 && (
            <span className="text-xs font-semibold text-red-ink leading-tight">
              <Trans id="fish.panel.waste">You cannot make change: {lost} fish destroyed.</Trans>
            </span>
          )}
        </div>
      ) : null}
      {(!chosen || atCap) && (
        /* A count of tiles, not fish: seven 3-fish tiles is legal, eight 1-fish
           tiles is not. Stated, and emphasised at the cap, so a player knows
           why catches stopped. */
        <span
          className="hudx-note max-w-85 text-center self-center"
          data-warn={atCap ? "true" : undefined}
          data-fish-cap={tiles}
        >
          {atCap ? (
            <Trans id="fish.panel.capReached">
              You are holding the most tiles allowed ({FISH_TILE_CAP}), so you draw no more. A catch
              may swap one of your 1-fish tiles for a fresh one instead, once a turn. Spend some.
            </Trans>
          ) : (
            <Trans id="fish.panel.cap">
              You may hold {FISH_TILE_CAP} tiles at most. At the cap you draw nothing, and a catch
              may swap one of your 1-fish tiles for a fresh one instead, once a turn.
            </Trans>
          )}
        </span>
      )}

      {riderHurry && (
        <span className="hudx-note max-w-85 text-center self-center" data-fish-rider>
          <Trans id="fish.panel.riderHurry">
            Two fish can also hurry a rider past three paths. Start the rider move and tap a path
            beyond three.
          </Trans>
        </span>
      )}

      {/* The old boot: its holder is a point further from winning. The seat chip
          says who holds it; this is where it is passed on. */}
      {onGiveBoot && (
        <div className="hudx-line hud-chip px-2 py-1.5" data-fish-boot>
          <GoodIcon id="boot" size={18} fallback={<Icons.boot size={14} />} className="hud-ic" />
          <span className="hudx-note flex-1 text-foreground">
            <Trans id="fish.panel.bootHeld">You hold the old boot: one more point to win.</Trans>
          </span>
          <button type="button" className="hud-secondary hudx-btn" onClick={onGiveBoot}>
            <Trans id="fish.panel.passBoot">Pass the old boot</Trans>
          </button>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="hud-secondary hudx-btn" onClick={onClose}>
          <Trans id="fish.panel.close">Close</Trans>
        </button>
        <button
          type="button"
          className="hud-primary hudx-btn"
          data-fish-send
          disabled={!chosen}
          onClick={() => chosen && onSpend(chosen.spend)}
        >
          {chosen ? (
            <Trans id="fish.panel.spendN">Spend {cost} fish</Trans>
          ) : (
            <Trans id="fish.panel.spend">Spend</Trans>
          )}
        </button>
      </div>
    </Overlay>
  );
}
