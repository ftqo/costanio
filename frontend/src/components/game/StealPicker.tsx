import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { HudButton } from "@/components/game/hud/HudButton";
import { Overlay } from "./Overlay";
import { SeatChoice, SeatChoiceRow } from "./SeatChoice";

/**
 * Who the robber (or the pirate, or a chasing knight) steals from, when more
 * than one opponent is beside the chosen hex. It shows:
 *
 *  - Each victim's hand size. Public, and what separates two victims: stealing
 *    from someone with one card differs from stealing from someone with nine.
 *  - A way back. The hex and victim travel in one command, so nothing has been
 *    sent and backing out is free. Escape or a press on the dim also work, but
 *    nobody finds those on a phone.
 */
export function StealPicker({
  victims,
  seatName,
  colorOf,
  cardsHeld,
  onPick,
  onBack,
}: {
  victims: number[];
  seatName: (s: number) => string;
  colorOf: (s: number) => string;
  /** Cards the seat holds (resources, plus commodities under Knights). */
  cardsHeld: (s: number) => number;
  onPick: (seat: number) => void;
  onBack: () => void;
}) {
  const { t } = useLingui();
  return (
    <Overlay title={t`Steal from…`} onCancel={onBack}>
      <SeatChoiceRow>
        {victims.map((v) => (
          <SeatChoice
            key={v}
            seat={v}
            name={seatName(v)}
            color={colorOf(v)}
            detail={t`${plural(cardsHeld(v), { one: "# card", other: "# cards" })}`}
            title={((who: string) => t`Steal a card from ${who}`)(seatName(v))}
            onSelect={onPick}
          />
        ))}
      </SeatChoiceRow>
      <HudButton kind="secondary" onClick={onBack}>
        <Trans context="back out of the steal and pick another hex for the robber or pirate">
          Choose a different hex
        </Trans>
      </HudButton>
    </Overlay>
  );
}
