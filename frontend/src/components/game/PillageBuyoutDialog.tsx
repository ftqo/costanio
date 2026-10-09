import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Overlay } from "./Overlay";
import { Button } from "@/components/ui/button";
import { PILLAGE_BUYOUT_COINS, type buyoutWealthCost } from "@/lib/rivers";

/**
 * Rivers alongside Knights: 5 coins keeps the city the barbarians came for.
 *
 * The price is paid in the currency the wealth tiles count, so it can cost more
 * points than the city is worth; the warning says so before the tap.
 *
 * Both answers stay legal while the debt stands, and declining is tapping a
 * city on the board. So the dialog can be stood down (`onStandDown`), which is
 * all "Give a city up instead" does.
 */
export function PillageBuyoutDialog({
  coins,
  afford,
  cost,
  onPay,
  onStandDown,
}: {
  /** The owing seat's coins, for the "you cannot pay" sentence. */
  coins: number;
  afford: boolean;
  cost: ReturnType<typeof buyoutWealthCost>;
  onPay: () => void;
  onStandDown: () => void;
}) {
  const { t } = useLingui();
  // Named for the catalogue: translator notes use `{myCoins}`.
  const myCoins = coins;
  return (
    <Overlay
      title={t({
        id: "rivers.pillage.title",
        message: "Barbarians broke through: pay to keep your city?",
        context: "Rivers alongside Knights: 5 coins instead of losing a city",
      })}
      onCancel={onStandDown}
    >
      <span className="text-xs text-muted text-center max-w-75" data-pillage-rule>
        {afford ? (
          <Trans id="rivers.pillage.rule">
            Pay {PILLAGE_BUYOUT_COINS} coins and the city stands. Or give one up: tap one of your
            cities on the board and it goes back to being a settlement (1 point).
          </Trans>
        ) : (
          <Trans id="rivers.pillage.short">
            You hold <Plural value={myCoins} one="# coin" other="# coins" /> and cannot pay. Tap one
            of your cities to give it up.
          </Trans>
        )}
      </span>
      {afford && (cost.losesWealthiest || cost.gainsPoorest) && (
        <span
          className="text-xs font-bold text-amber-ink text-center max-w-75"
          data-pillage-wealth-warning
        >
          {cost.losesWealthiest && cost.gainsPoorest ? (
            <Trans id="rivers.pillage.cost.both">
              Paying leaves you {cost.after} coins: you would lose the Wealthiest Settler (+1) and
              take a Poorest Settler tile (-2).
            </Trans>
          ) : cost.losesWealthiest ? (
            <Trans id="rivers.pillage.cost.wealthiest">
              Paying leaves you {cost.after} coins: you would lose the Wealthiest Settler (+1).
            </Trans>
          ) : (
            <Trans id="rivers.pillage.cost.poorest">
              Paying leaves you {cost.after} coins, the fewest at the table: you would take a
              Poorest Settler tile (-2).
            </Trans>
          )}
        </span>
      )}
      <Button
        size="sm"
        variant="primary"
        tone="accent"
        className="min-h-10"
        disabled={!afford}
        onClick={onPay}
      >
        <Plural
          id="rivers.pillage.pay"
          value={PILLAGE_BUYOUT_COINS}
          one="Pay # coin"
          other="Pay # coins"
        />
      </Button>
      <Button size="sm" variant="quiet" className="min-h-10" onClick={onStandDown}>
        <Trans id="rivers.pillage.decline">Give a city up instead</Trans>
      </Button>
    </Overlay>
  );
}
