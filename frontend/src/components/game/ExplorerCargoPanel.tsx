import { Trans, useLingui } from "@lingui/react/macro";
import { GoodIcon } from "@/components/asset/AssetParts";
import { msg } from "@lingui/core/macro";
import {
  cargoBays,
  cargoSlots,
  CARGO_PIECES,
  canAfford,
  EXPLORERS_COSTS,
  supplies,
} from "@/lib/explorers";
import type { FullView } from "@/lib/types";
import { DETAILS_SUMMARY } from "@/lib/hudChrome";
import { cn } from "@/lib/utils";
import { Glyph, MBtn, MCost } from "./moduleUi";

export const CARGO_LABELS = {
  settler: msg`Settler`,
  crew: msg`Crew`,
  haul: msg`Fish haul`,
  spice: msg`Spice sack`,
};

type Cargo = { settler?: number; crew?: number; haul?: number; spice?: number };

/** A piece's picture: the shipped art where it exists, else the module glyph. */
function PieceArt({ piece }: { piece: (typeof CARGO_PIECES)[number] }) {
  if (piece === "haul")
    return <GoodIcon id="fish" size={18} fallback={<Glyph name="fish" size={15} />} />;
  if (piece === "spice")
    return <GoodIcon id="spice" size={18} fallback={<Glyph name="spice" size={15} />} />;
  return <Glyph name={piece === "settler" ? "person" : "crew"} size={15} />;
}

/**
 * A hold or a basin as its two spaces: a settler or a fish haul fills both (one
 * wide slot), a crew or a spice sack fills one, and what is left is an empty
 * well. Decorative: every caller also says what is aboard in words.
 */
export function CargoSlots({ cargo }: { cargo?: Cargo }) {
  const c = cargo ?? {};
  const slots: { piece: (typeof CARGO_PIECES)[number]; wide: boolean }[] = [];
  for (const p of CARGO_PIECES) {
    for (let i = 0; i < (c[p] ?? 0); i++)
      slots.push({ piece: p, wide: p === "settler" || p === "haul" });
  }
  const empty = Math.max(0, 2 - cargoSlots(c));
  return (
    <span className="modp-slots" aria-hidden>
      {slots.map((s, i) => (
        <span key={i} className="modp-slot" data-full="" style={s.wide ? { width: 60 } : undefined}>
          <PieceArt piece={s.piece} />
        </span>
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <span key={`e${i}`} className="modp-slot" />
      ))}
    </span>
  );
}

/** Purchasing and freeing storage, with an explicit destination for every purchase. */
export function ExplorerCargoPanel({
  view,
  seat,
  onSend,
}: {
  view: FullView;
  seat: number;
  onSend: (cmd: string, data: Record<string, unknown>) => void;
}) {
  const { t } = useLingui();
  const bays = cargoBays(view, seat);
  const stock = supplies(view, seat);
  const hand = view.players[seat]?.hand;
  const full = bays.filter((b) => b.docked).every((b) => cargoSlots(b.cargo) === 2);
  return (
    <details className="modp-disclosure p-3">
      <summary className={cn(DETAILS_SUMMARY, "modp-summary")}>
        <Trans>Crews, settlers and storage</Trans>
      </summary>
      <div className="flex flex-col gap-2 pt-2">
        <p className="modp-small">
          <Trans>
            Choose where to place a purchase. A settler fills both spaces; a crew fills one. Load
            and unload ships during movement.
          </Trans>
        </p>
        {/* The two prices as the build tiles draw them. The sentence stays for
            screen readers. */}
        <div className="modp-row">
          <span className="sr-only">
            <Trans>Crew: 1 sheep + 1 ore. Settler: 1 wood + 1 brick + 1 sheep + 1 wheat.</Trans>
          </span>
          <span className="modp-row" aria-hidden>
            <Glyph name="crew" size={14} />
            <span className="modp-small">{t(CARGO_LABELS.crew)}</span>
            <MCost cost={EXPLORERS_COSTS.crew} have={hand} />
          </span>
          <span className="modp-row" aria-hidden>
            <Glyph name="person" size={14} />
            <span className="modp-small">{t(CARGO_LABELS.settler)}</span>
            <MCost cost={EXPLORERS_COSTS.settler} have={hand} />
          </span>
        </div>
        {bays.map((bay) => (
          <div key={bay.key} data-cargo-bay={bay.key} className="modp-card">
            <div className="modp-row" style={{ flexWrap: "nowrap" }}>
              <Glyph name={bay.ship ? "cship" : "hset"} size={16} className="text-(--hud-muted)" />
              <span className="font-semibold">
                {bay.ship ? <Trans>Ship {bay.n}</Trans> : <Trans>Harbour {bay.harbour}</Trans>}
              </span>
              <span className="modp-grow">
                <CargoSlots cargo={bay.cargo} />
              </span>
              <span className="modp-small font-num tabular-nums">
                <Trans>{cargoSlots(bay.cargo)}/2 spaces</Trans>
              </span>
            </div>
            {CARGO_PIECES.some((p) => (bay.cargo?.[p] ?? 0) > 0) && (
              <div className="modp-small flex flex-wrap gap-x-3">
                {CARGO_PIECES.filter((p) => (bay.cargo?.[p] ?? 0) > 0).map((p) => (
                  <span key={p}>
                    {t(CARGO_LABELS[p])} × {bay.cargo[p]}
                  </span>
                ))}
              </div>
            )}
            <div className="modp-row">
              {bay.docked && (
                <>
                  <MBtn
                    disabled={
                      cargoSlots(bay.cargo) >= 2 ||
                      !stock?.crews ||
                      !canAfford(hand, EXPLORERS_COSTS.crew)
                    }
                    onClick={() =>
                      onSend("explorers_buy_cargo", { ...bay.payload, settler: false })
                    }
                  >
                    <Trans>Hire crew here</Trans>
                  </MBtn>
                  <MBtn
                    disabled={
                      cargoSlots(bay.cargo) > 0 ||
                      !stock?.settlers ||
                      !canAfford(hand, EXPLORERS_COSTS.settler)
                    }
                    onClick={() => onSend("explorers_buy_cargo", { ...bay.payload, settler: true })}
                  >
                    <Trans>Place settler here</Trans>
                  </MBtn>
                </>
              )}
              {!bay.docked && (
                <span className="modp-small">
                  <Trans>Return to a harbour to buy cargo.</Trans>
                </span>
              )}
              {full &&
                CARGO_PIECES.filter((p) => (bay.cargo?.[p] ?? 0) > 0).map((p) => (
                  <MBtn
                    key={p}
                    quiet
                    onClick={() =>
                      onSend("explorers_jettison", { ...bay.payload, cargo: { [p]: 1 } })
                    }
                  >
                    <Trans>Discard {t(CARGO_LABELS[p])}</Trans>
                  </MBtn>
                ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
