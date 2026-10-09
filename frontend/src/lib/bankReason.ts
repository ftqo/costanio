import { msg, plural } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MaritimePlan } from "./bank";
import { RES } from "./cardFace";

/**
 * Why the Bank button is disabled, in a few words, for a maritime plan that is
 * not `ok`. Undefined when it is ok.
 *
 * The trays show what is staged but not why it fails (three wood against one
 * brick at a 2:1 wood harbour: wood goes in twos). Names the one blocking
 * issue, checked in the order a player fixes them: the shape of the trade,
 * then whether the cards exist.
 */
export function maritimeBlockedReason(
  plan: MaritimePlan,
  hand: readonly number[] | undefined,
  bank: readonly number[] | undefined,
): string | undefined {
  if (plan.ok) return undefined;
  if (plan.overlap) return i18n._(msg`Same card on both sides`);
  const odd = plan.giveKinds.find((k) => plan.rates[k] > 0 && plan.cmd.spend[k] % plan.rates[k]);
  if (odd !== undefined) {
    const res = RES[odd - 1].name;
    const rate = plan.rates[odd];
    return i18n._(msg`${res} goes ${rate} for 1`);
  }
  if (plan.funded < plan.wantTotal) {
    const funded = plan.funded;
    return i18n._(
      msg({
        message: plural(funded, { one: "Pays for only # card", other: "Pays for only # cards" }),
      }),
    );
  }
  if (plan.funded > plan.wantTotal) {
    const funded = plan.funded;
    return i18n._(
      msg({
        message: plural(funded, {
          one: "Pays for # card: ask for more",
          other: "Pays for # cards: ask for more",
        }),
      }),
    );
  }
  const short = plan.giveKinds.find((k) => (hand?.[k] ?? 0) < plan.cmd.spend[k]);
  if (short !== undefined) {
    const res = RES[short - 1].name;
    return i18n._(msg`Not enough ${res} in hand`);
  }
  const out = plan.wantKinds.find((k) => (bank?.[k] ?? 0) < plan.cmd.want[k]);
  if (out !== undefined) {
    const res = RES[out - 1].name;
    return i18n._(msg`The bank is short of ${res}`);
  }
  return undefined;
}
