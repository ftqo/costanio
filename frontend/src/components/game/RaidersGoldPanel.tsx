import { Trans, useLingui } from "@lingui/react/macro";
import { GoodIcon } from "@/components/asset/AssetParts";
import { Icons } from "./hudIcons";
import { ScenarioDialog as Overlay } from "./ScenarioDialog";
import type * as React from "react";
import { MBtn, MChip, ResArt } from "./moduleUi";
import { RES } from "@/lib/cardFace";
import type { GoldBuyOffer, GoldSellOffer } from "@/lib/raiders";
import { GOLD_PER_RESOURCE } from "@/lib/raiders";

/**
 * Gold: what it buys, and what buys it.
 *
 * Gold is not a resource: a public per-seat counter, not counted toward the
 * 7-discard, safe from the 7's steal, and invisible to effects naming resource
 * cards. So it is never drawn as a card. The two halves below are everything it
 * does on your turn (riding along in a player trade belongs to the trade
 * panel).
 *
 * Buying is bank-limited and capped at two a turn, and both refusals are shown.
 * The engine checks the bank before taking the gold, so an attempt at an empty
 * stack costs nothing.
 *
 * Sales use the server's per-resource maritime rates.
 */
export function RaidersGoldPanel({
  gold,
  buysLeft,
  buys,
  sells,
  onBuy,
  onSell,
  onClose,
  extra,
}: {
  /** The coast readout, below the spends; see RaidersCoast. */
  extra?: React.ReactNode;
  gold: number;
  buysLeft: number;
  buys: GoldBuyOffer[];
  sells: GoldSellOffer[];
  onBuy: (res: number) => void;
  onSell: (res: number) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  return (
    <Overlay
      title={t({
        id: "raiders.gold.title",
        message: "Gold",
        context: "title of the panel where Raiders gold is spent",
      })}
      onCancel={onClose}
    >
      <div className="modp-panel w-full">
        <div className="modp-row" style={{ flexWrap: "nowrap" }}>
          <MChip
            icon={<GoodIcon id="gold" size={18} fallback={<Icons.gold size={18} />} />}
            data-raiders-gold={gold}
          >
            <Trans id="raiders.gold.held">{gold} gold</Trans>
          </MChip>
          <span className="modp-small modp-grow">
            <Trans id="raiders.gold.rule">
              Gold is a counter, not a card. It is never discarded on a 7 and cannot be stolen.
            </Trans>
          </span>
        </div>

        <div className="modp-sep flex flex-col gap-2">
          <span className="modp-small" data-raiders-buys-left={buysLeft}>
            {buysLeft > 0 ? (
              <Trans id="raiders.gold.buysLeft">
                Buy a resource for {GOLD_PER_RESOURCE} gold. {buysLeft} left this turn.
              </Trans>
            ) : (
              <Trans id="raiders.gold.buysUsed">
                You have already bought twice with gold this turn.
              </Trans>
            )}
          </span>
          <div className="modp-picks">
            {buys.map((o) => (
              <button
                key={o.res}
                type="button"
                className="modp-pick"
                data-raiders-buy={o.res}
                data-raiders-res={o.res}
                disabled={!o.affordable}
                aria-label={RES.find((r) => r.idx === o.res)?.name}
                title={
                  o.stock < 1
                    ? t({ id: "raiders.gold.bankEmpty", message: "The bank has none left." })
                    : undefined
                }
                onClick={() => o.affordable && onBuy(o.res)}
              >
                <ResArt idx={o.res} size={26} />
                <span className="modp-sub">{o.stock}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="modp-sep flex flex-col gap-1.5">
          <span className="modp-small">
            <Trans id="raiders.gold.sellFor">Sell identical resources for 1 gold</Trans>
          </span>
          {sells.map((o) => (
            <button
              key={o.res}
              type="button"
              className="modp-card"
              style={{ flexDirection: "row", alignItems: "center", padding: "6px 10px" }}
              data-raiders-sell={o.res}
              disabled={!o.affordable}
              onClick={() => o.affordable && onSell(o.res)}
            >
              <ResArt idx={o.res} size={20} />
              <span className="modp-grow font-medium">
                {RES.find((r) => r.idx === o.res)?.name}
              </span>
              <span className="modp-small font-num tabular-nums">
                {/* The ratio is shown per row, since a generic harbour changes it
                    for every resource at once. */}
                <Trans id="raiders.gold.sellPrice">
                  {o.ratio} for 1 gold (you hold {o.held})
                </Trans>
              </span>
            </button>
          ))}
        </div>

        {extra && <div className="modp-sep">{extra}</div>}

        <MBtn className="self-center" onClick={onClose}>
          <Trans id="raiders.gold.close">Close</Trans>
        </MBtn>
      </div>
    </Overlay>
  );
}
