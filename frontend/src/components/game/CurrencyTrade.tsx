import { Trans, useLingui } from "@lingui/react/macro";
import { GoodIcon } from "@/components/asset/AssetParts";
import { Icons } from "./hudIcons";
import { CURRENCY_NAMES, type CurrencyAmounts, type CurrencyKey } from "@/lib/scenarioCurrency";

/** The shipped art for each purse: the river coin, and gold for the other two. */
const CURRENCY_ICON: Record<CurrencyKey, string> = {
  coins: "rivercoin",
  gold: "gold",
  wagon_gold: "gold",
};

/**
 * The scenario currencies in a player trade: one line per purse, with what you
 * hold and a stepper for each side. A recessed chip with the purse's art and
 * count, and two raised steppers (as in the camel vote).
 */
export function CurrencyTrade({
  currencies,
  give,
  want,
  onGive,
  onWant,
}: {
  currencies: { key: CurrencyKey; held: number }[];
  give: CurrencyAmounts;
  want: CurrencyAmounts;
  onGive: (next: CurrencyAmounts) => void;
  onWant: (next: CurrencyAmounts) => void;
}) {
  const { t } = useLingui();
  if (!currencies.length) return null;
  return (
    <div className="hud-chip flex flex-col gap-1.5 px-2 py-1.5 text-foreground">
      <p className="hud-lab">
        <Trans>Currency in this player trade</Trans>
      </p>
      {currencies.map(({ key, held }) => (
        <div
          key={key}
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
          data-trade-currency={key}
        >
          <span className="mr-auto inline-flex items-center gap-1.5 text-[13px] font-semibold">
            <GoodIcon
              id={CURRENCY_ICON[key]}
              size={18}
              fallback={key === "coins" ? <Icons.coin size={14} /> : <Icons.gold size={14} />}
              className="hud-ic object-contain"
            />
            {t(CURRENCY_NAMES[key])}
            <span className="hudx-figure px-1.5 py-0.5 text-[11px]">{held}</span>
          </span>
          {/* The two sides stay together: on a phone they drop under the
              purse as one line. */}
          <span className="flex items-center gap-3 max-sm:w-full max-sm:justify-between">
            {(["give", "want"] as const).map((side) => {
              const amounts = side === "give" ? give : want,
                set = side === "give" ? onGive : onWant,
                n = amounts[key] ?? 0;
              return (
                <span
                  key={side}
                  role="group"
                  aria-label={side === "give" ? t`Currency you give` : t`Currency you request`}
                  className="inline-flex items-center gap-1.5"
                >
                  <span className="hud-lab">
                    {side === "give" ? <Trans>Give</Trans> : <Trans>Request</Trans>}
                  </span>
                  <span className="hudx-step">
                    <button
                      type="button"
                      aria-label={t`Decrease amount`}
                      disabled={n === 0}
                      onClick={() => set({ ...amounts, [key]: n - 1 })}
                    >
                      −
                    </button>
                    <output className="min-w-6 text-center text-[14px] font-semibold font-num tabular-nums">
                      {n}
                    </output>
                    <button
                      type="button"
                      aria-label={t`Increase amount`}
                      disabled={side === "give" ? n >= held : n >= 99}
                      onClick={() => set({ ...amounts, [key]: n + 1 })}
                    >
                      +
                    </button>
                  </span>
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}
