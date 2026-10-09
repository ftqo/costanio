import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { ScenarioDialog as Overlay } from "./ScenarioDialog";
import { Icons } from "./hudIcons";
import { ResIcon } from "@/components/asset/AssetParts";
import { GoodIcon } from "@/components/asset/AssetParts";
import { cn } from "@/lib/utils";
import { RES, COMMOD, comIconSlot, resIconSlot } from "@/lib/cardFace";
import type { CoinTrades } from "@/lib/rivers";

/**
 * The two things a coin can do, side by side, with the price on every row.
 *
 * Selling to the supply goes through the seat's maritime rate, so one player's
 * ore costs four cards and another's two; each cell shows its rate.
 *
 * Every resource is drawn both ways, unaffordable ones included (as in
 * `FishSpendPanel`), and each half states its own refusal reasons.
 *
 * Each half is one row of five equal cells (art and number) under a mono
 * label. A rate better than the default 4:1 is marked green, as the bank
 * marks it.
 *
 * Pure: offers in, callbacks out. Prices, caps and affordability come from
 * `lib/rivers.coinTrades`.
 */
export function RiverCoinsPanel({
  trades,
  onBuy,
  onSpend,
  onClose,
  onSellGood,
}: {
  trades: CoinTrades;
  /** Sell this resource to the supply for one coin. */
  onBuy: (idx: number) => void;
  /** Buy one of this resource with coins. */
  onSpend: (idx: number) => void;
  onClose: () => void;
  onSellGood?: (good: string) => void;
}) {
  const { t } = useLingui();
  const { coins, price, spendsLeft } = trades;
  const goods = onSellGood ? (trades.goods ?? []) : [];
  return (
    <Overlay
      title={t({
        id: "rivers.coins.title",
        message: "Coins",
        context: "title of the panel where Rivers coins are traded",
      })}
      onCancel={onClose}
    >
      {/* What is in hand. Coins are a count, not cards: outside the hand limit,
          safe from robber, pirate and Monopoly, never discarded. So a figure
          with the coin glyph, not a pile of cards. */}
      <span className="hudx-figure self-center" data-rivers-coins={coins}>
        <GoodIcon id="rivercoin" size={18} fallback={<Icons.coin size={14} />} className="hud-ic" />
        {/* A plural, unlike the fish panel's holding line: "1 coins" would be
            the first thing a player reads on earning one. */}
        <Plural id="rivers.coins.held" value={coins} one="# coin" other="# coins" />
      </span>

      <Section
        title={<Trans id="rivers.coins.buy.title">Sell to the supply for a coin</Trans>}
        note={
          <Trans id="rivers.coins.buy.note">
            At your own rate for that resource, as often as you like on your turn.
          </Trans>
        }
      >
        {trades.buys.map((b) => (
          <Cell
            key={b.idx}
            attr={{ "data-rivers-buy": RES[b.idx - 1].key }}
            name={RES[b.idx - 1].name}
            art={<ResIcon slot={resIconSlot(b.idx)} size={26} className="hud-ic object-contain" />}
            disabled={!b.ok}
            onClick={() => onBuy(b.idx)}
          >
            <span className="hud-rate-mark" data-better={b.ratio < DEFAULT_RATIO}>
              <Trans id="rivers.coins.buy.price">{b.ratio} for 1</Trans>
            </span>
          </Cell>
        ))}
      </Section>

      <Section
        title={<Trans id="rivers.coins.spend.title">Buy a resource for {price} coins</Trans>}
        note={
          // The cap (twice a turn, so at most four coins into two cards) is
          // stated, since nothing else explains the cells going dark. Being
          // short of the price, the commonest reason, is stated too.
          spendsLeft > 0 && coins < price ? (
            <Trans id="rivers.coins.spend.short">
              Each costs {price} coins, and you have {coins}. Up to two a turn.
            </Trans>
          ) : spendsLeft > 0 ? (
            <Trans id="rivers.coins.spend.left">{spendsLeft} of 2 left this turn.</Trans>
          ) : (
            <Trans id="rivers.coins.spend.none">
              You have already bought twice this turn. The cap resets next turn.
            </Trans>
          )
        }
        warn={spendsLeft === 0}
      >
        {trades.spends.map((sp) => (
          <Cell
            key={sp.idx}
            attr={{ "data-rivers-spend": RES[sp.idx - 1].key }}
            name={RES[sp.idx - 1].name}
            art={<ResIcon slot={resIconSlot(sp.idx)} size={26} className="hud-ic object-contain" />}
            disabled={!sp.ok}
            onClick={() => onSpend(sp.idx)}
          >
            {/* The bank's own stock: an empty stack refuses the purchase and
                spends no coins. */}
            <span
              className={cn(
                "text-[10.5px] font-num tabular-nums",
                sp.stock === 0 ? "font-semibold text-red-ink" : "text-muted",
              )}
            >
              <Trans id="rivers.coins.spend.stock">{sp.stock} left</Trans>
            </span>
          </Cell>
        ))}
      </Section>

      {/* Alongside Knights, commodities sell for a coin too, in the same cells
          with card-coloured art and an "N for 1" rate. The Knights commodity
          is called Coin, so a bare "Coin 4:1" would read as coins for coins. */}
      {goods.length > 0 && (
        <div data-rivers-goods>
          <Section
            title={<Trans id="rivers.coins.goods.title">Sell a commodity for a coin</Trans>}
            note={
              <Trans id="rivers.coins.goods.note">
                At your own rate for that commodity. Coins never buy commodities back.
              </Trans>
            }
            n={goods.length}
          >
            {goods.map((good) => {
              const c = COMMOD[good.idx];
              return (
                <Cell
                  key={good.key}
                  attr={{ "data-rivers-good": good.key }}
                  name={c.name}
                  art={
                    <ResIcon
                      slot={comIconSlot(good.idx)}
                      size={26}
                      className="hud-ic object-contain"
                    />
                  }
                  disabled={!good.ok}
                  onClick={() => onSellGood!(good.key)}
                >
                  <span className="hud-rate-mark" data-better={good.ratio < DEFAULT_RATIO}>
                    <Trans id="rivers.coins.buy.price">{good.ratio} for 1</Trans>
                  </span>
                </Cell>
              );
            })}
          </Section>
        </div>
      )}
      <div className="flex justify-end">
        <button type="button" className="hud-secondary hudx-btn" onClick={onClose}>
          <Trans id="rivers.coins.close">Close</Trans>
        </button>
      </div>
    </Overlay>
  );
}

/** The maritime rate with no harbour. A cell whose rate beats it goes green. */
const DEFAULT_RATIO = 4;

/** One half of the panel: a label, the rule under it, and its row of cells. */
function Section({
  title,
  note,
  warn,
  n = 5,
  children,
}: {
  title: React.ReactNode;
  note: React.ReactNode;
  warn?: boolean;
  n?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[min(300px,100%)]">
      <span className="hud-lab">{title}</span>
      <div className="hudx-row" style={{ "--n": n } as React.CSSProperties}>
        {children}
      </div>
      <span className="hudx-note" data-warn={warn ? "true" : undefined}>
        {note}
      </span>
    </div>
  );
}

/**
 * One resource's cell: its art, its number (a rate, a stock), and its name for
 * screen readers and on hover.
 *
 * `data-rivers-buy` / `data-rivers-spend` carry the wire name, not the index,
 * so a test names what the command will name.
 */
function Cell({
  attr,
  name,
  art,
  disabled,
  onClick,
  children,
}: {
  attr: Record<string, string>;
  name: string;
  art: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      {...attr}
      title={name}
      disabled={disabled}
      onClick={onClick}
      // 40px floor at least: these are the touch targets on a phone.
      className="hudx-cell min-h-14.5"
    >
      {art}
      <span className="sr-only">{name}</span>
      {children}
    </button>
  );
}
