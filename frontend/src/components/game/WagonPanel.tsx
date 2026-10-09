import * as React from "react";
import { GoodIcon } from "@/components/asset/AssetParts";
import { Icons } from "./hudIcons";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { MBtn, MChip, MHead, MBar, MCost, ResArt, Glyph } from "./moduleUi";
import {
  CARGO,
  ROLE,
  barbarianPlace,
  canBoost,
  canBuyWithGold,
  canUpgrade,
  upgradeCost,
  carrying,
  destinations,
  driveOffFloor,
  gold,
  level,
  movementLeft,
  swiftHeld,
} from "@/lib/wagons";
import { wagonsExt, type FullView } from "@/lib/types";
import { FLOATING_PROMPT, PROMPT_TOP, SQUAT_RIGHT_OF_DOCK } from "@/lib/hudChrome";
import { vertexKey } from "@/lib/hexgeo";
import { hexLabel } from "@/lib/boardInfo";
import { rulesetCaps } from "@/lib/caps";
import { cn } from "@/lib/utils";

/** Touch targets: 40px for each button (the summary takes its box, DETAILS_SUMMARY). */
const WAGON_TARGETS = "[&_button]:min-h-10";

/**
 * The wagon's turn: where it is going, what it can spend, and how to stop.
 *
 * A sidebar, not a modal, because the movement phase blocks only the pass;
 * building, trading and playing cards stay open throughout.
 *
 * Driving happens on the board: `wagon_steps` lights the reachable
 * intersections (priced by the server) and a click sends the move. This panel
 * carries what the board can't: movement left, the load, the destination, and
 * the four spends.
 */
export function WagonPanel({
  view,
  seat,
  onMove,
  onHalt,
  onBoost,
  onCharge,
  onUpgrade,
  onBuy,
  onSell,
  onSwift,
  onClose,
  driving = false,
}: {
  view: FullView;
  seat: number;
  /** The board is armed for a wagon step, so Drive reads as pressed. */
  driving?: boolean;
  /** Whether the board is currently armed for a wagon move. */
  onMove: () => void;
  onHalt: () => void;
  onBoost: () => void;
  onCharge: (barb: number) => void;
  onUpgrade: () => void;
  onBuy: (res: string) => void;
  onSell: (res: string) => void;
  onSwift: () => void;
  onClose?: () => void;
}) {
  const { t } = useLingui();
  // Which spend has its resource row open, if either. The resource choice is
  // the player's, so it opens a row; one at a time, so the panel doesn't grow
  // ten buttons.
  const [picking, setPicking] = React.useState<"buy" | "sell" | null>(null);
  const ext = wagonsExt(view);
  if (!ext) return null;
  const mp = movementLeft(view, seat);
  const lvl = level(view, seat);
  const cargo = carrying(view, seat);
  // Rivers + Wagons: one purse, which the rest of that ruleset calls coins.
  const shared = !!ext.shared_currency;
  const purse = gold(view, seat);
  const floor = driveOffFloor(view, seat);
  const going = destinations(view, seat);
  const tried = ext.tried ?? [];
  const hand = view.players?.[seat]?.hand;
  const woodCost = lvl >= 3 ? 2 : 1;
  const upgrade = canUpgrade(view, seat);
  const price = upgradeCost(view, seat);
  const wagon = ext.wagons?.find((w) => w.player === seat)?.v;
  const held = swiftHeld(view);
  const adjacent = (ext.barbarians ?? [])
    .map((edge, index) => ({ edge, index }))
    .filter(
      ({ edge }) =>
        wagon && (vertexKey(edge.a) === vertexKey(wagon) || vertexKey(edge.b) === vertexKey(wagon)),
    );

  // This level's starting allowance, for the bar's full width. A boosted trip
  // runs past it and the bar is just full.
  const allowance = Math.max(mp, ext.mp_track?.[lvl - 1] ?? mp);
  const maxLevel = ext.max_level ?? 5;
  const steps = view.legal?.wagon_steps?.length ?? 0;
  const noWheat = (hand?.[4] ?? 0) < 1;

  return (
    <div
      className={cn(
        // A floating panel on HUD chrome rather than an Overlay (always a
        // blocking modal here), since the phase blocks only the pass. Left
        // rather than centred, out of the dice cluster's way and off the board.
        FLOATING_PROMPT,
        "modp-panel right-3 w-78 max-w-[calc(100vw-24px)] max-h-[64vh] overflow-y-auto px-3.5 py-3",
        // Under the seat strip on a phone, at the same measured edge a target
        // prompt uses (see PROMPT_TOP).
        PROMPT_TOP,
        // Beside the dock column on a sideways phone, not over the hand in it.
        SQUAT_RIGHT_OF_DOCK,
        // A thumb-sized floor for every control, as ScenarioDialog does (`sm`
        // buttons are 31-35px).
        WAGON_TARGETS,
      )}
      data-testid="wagon-panel"
    >
      <MHead label={<Trans>Your wagon</Trans>}>
        <MChip icon={<Glyph name="wagon" />}>
          <Trans>
            Level {lvl} <span className="modp-unit">of {maxLevel}</span>
          </Trans>
        </MChip>
        {onClose && (
          <MBtn quiet onClick={onClose}>
            <Trans>Close</Trans>
          </MBtn>
        )}
      </MHead>

      {/* The two numbers a driver decides on: movement is what the next path
          costs against, and gold pays tolls on opponents' roads (a wagon that
          can't pay can't cross). */}
      <div className="modp-row">
        <span className="modp-key">
          <Trans>Movement</Trans>
        </span>
        <MBar value={mp} max={allowance} />
        <span className="modp-num">
          {mp}
          <span className="modp-small">/{allowance}</span>
        </span>
      </div>

      <div className="modp-row">
        <span className="modp-key">
          <Trans>Cargo</Trans>
        </span>
        <span className="modp-slots">
          <span className="modp-slot" data-full={cargo !== CARGO.none ? "" : undefined}>
            {CARGO_GOOD[cargo] && <GoodIcon id={CARGO_GOOD[cargo]} size={20} />}
          </span>
        </span>
        <span className="modp-small modp-grow">
          {cargo === CARGO.none ? (
            <Trans>Empty. Drive to any plaza to pick up a load.</Trans>
          ) : going.length ? (
            <Trans>
              Carrying {t(CARGO_NAME[cargo] ?? CARGO_NAME[CARGO.none])}, for the{" "}
              {t(ROLE_NAME[going[0].role] ?? ROLE_NAME[ROLE.castle])}.
            </Trans>
          ) : (
            // No trade hex accepts this load, so there is no destination to
            // name; a message with an empty argument read "for the .".
            <Trans>Carrying {t(CARGO_NAME[cargo] ?? CARGO_NAME[CARGO.none])}.</Trans>
          )}
        </span>
      </div>

      <div className="modp-row">
        <span data-wagon-purse className="hud-chip modp-chip">
          {/* One purse under Rivers, called coins elsewhere in that ruleset.
              The picture follows the noun: the river coin for coins, bars for
              gold. */}
          {shared ? (
            <GoodIcon id="rivercoin" size={16} fallback={<Icons.coin size={16} />} />
          ) : (
            <GoodIcon id="gold" size={16} fallback={<Icons.gold size={16} />} />
          )}
          {shared ? <Trans>{purse} coins</Trans> : <Trans>{purse} gold</Trans>}
        </span>
        <span className="modp-grow" />
        <MBtn
          primary
          disabled={ext.move_done || steps === 0}
          aria-pressed={driving}
          title={
            ext.move_done
              ? t`The wagon has finished moving this turn.`
              : steps === 0
                ? t`No path the wagon can pay for leads anywhere from here.`
                : undefined
          }
          onClick={onMove}
          data-testid="wagon-move"
        >
          <Trans>Drive</Trans>
        </MBtn>
        <MBtn disabled={ext.move_done} onClick={onHalt} data-testid="wagon-halt">
          <Trans>Finish movement</Trans>
        </MBtn>
      </div>
      {/* One grain for two more movement points, once per trip (a Swift
          Journey's second trip may buy it again). Offered with the allowance
          untouched too, since the rules allow it. */}
      {canBoost(view, seat) && (
        <div className="modp-row">
          <span className="modp-small modp-grow">
            {rulesetCaps(view.config?.ruleset ?? "base").hasFish ? (
              // Fishermen sells the same +2 for two fish from the Fish tile, so
              // say so when this button is disabled.
              <span data-testid="wagon-boost-fish">
                <Trans>Or pay two fish for the same +2, from the Fish tile.</Trans>
              </span>
            ) : (
              <Trans>Once per trip.</Trans>
            )}
          </span>
          <MBtn
            disabled={noWheat}
            title={noWheat ? t`You need a wheat.` : undefined}
            aria-label={t`+2 movement for a wheat`}
            onClick={onBoost}
            data-testid="wagon-boost"
          >
            <Trans>+2 movement for</Trans>
            <ResArt idx={4} size={15} />
          </MBtn>
        </div>
      )}
      {/* The drive-off, right under Drive, since it is chosen from where the
          wagon stands. Only offered when the level allows it (at level 1 no
          roll succeeds). */}
      {!ext.move_done && floor !== null && adjacent.length > 0 && (
        <div className="modp-card">
          <span className="modp-small">
            <Trans>Drive a barbarian off (roll one die, {floor} or higher):</Trans>
          </span>
          <div className="modp-row">
            {adjacent.map(({ edge, index }) => {
              const i = ext.barbarian_ids?.[index] ?? index;
              return (
                <MBtn
                  key={i}
                  disabled={tried[i] === true || ext.path_tried?.[i] === true}
                  onClick={() => onCharge(i)}
                  data-testid={`wagon-charge-${i}`}
                >
                  {/* By where it stands: the pieces carry no number on the
                      board. */}
                  {barbarianPlace(view, edge)}
                </MBtn>
              );
            })}
          </div>
        </div>
      )}
      {/* The Swift Journey in hand, where the driving is; nothing else on screen
          shows the card. A card bought this turn is locked and says when it
          will play. */}
      {(held > 0 || (ext.swift_new ?? 0) > 0) && (
        <div className="modp-row" data-testid="wagon-swift-held">
          <span className="modp-small modp-grow">
            {held > 0 ? (
              <Trans>
                Swift Journeys in hand: {held}. Play one after this trip for a second trip with
                fresh movement.
              </Trans>
            ) : (
              <Trans>Your Swift Journey bought this turn can be played from your next turn.</Trans>
            )}
          </span>
          {held > 0 && (
            <MBtn
              disabled={!ext.move_done || !ext.moved || view.played_dev}
              title={
                view.played_dev
                  ? t`You have already played a card this turn.`
                  : !ext.move_done || !ext.moved
                    ? t`Drive the wagon and finish its movement first; the journey is a second trip.`
                    : undefined
              }
              onClick={onSwift}
              data-testid="wagon-swift"
            >
              <Trans>Play a Swift Journey</Trans>
            </MBtn>
          )}
        </div>
      )}

      {/* Where the three trade hexes are, by terrain and number (they have no
          building yet). The one this load is for is marked. */}
      <div className="modp-sep flex flex-col gap-1.5">
        <span className="modp-small">
          <Trans>
            Drive to a highlighted intersection. Deliver a load to earn 1 victory point.
          </Trans>
        </span>
        <ul className="flex flex-col gap-1" data-testid="wagon-trade-hexes">
          {(ext.trade ?? []).map((th) => {
            const tile = view.board?.tiles?.find(
              (x) => x.hex.q === th.hex.q && x.hex.r === th.hex.r,
            );
            const target = cargo !== CARGO.none && th.accepts.includes(cargo);
            return (
              <li
                key={th.role}
                className="modp-row"
                style={{ flexWrap: "nowrap" }}
                data-wagon-trade-target={target ? "" : undefined}
              >
                <Glyph name="castle" size={13} className="text-(--hud-muted)" />
                <span className={cn("modp-grow", target && "font-semibold")}>
                  {t(ROLE_TITLE[th.role] ?? ROLE_TITLE[ROLE.castle])}
                </span>
                <span className="modp-small">{hexLabel(tile)}</span>
                {target && (
                  <MChip tone="focus">
                    <Trans>your load</Trans>
                  </MChip>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* The spends, one line each with the price beside its button, as a
          build tile carries its price. */}
      <div className="modp-sep flex flex-col gap-2">
        <div className="modp-row">
          <span className="modp-small modp-grow">
            {lvl >= maxLevel ? (
              <Trans>The wagon is at the top level.</Trans>
            ) : (
              <Trans>Upgrade to level {lvl + 1}, before driving</Trans>
            )}
          </span>
          {price && <MCost cost={price} have={hand} />}
          <MBtn
            disabled={!upgrade}
            onClick={onUpgrade}
            aria-label={t`Upgrade before driving: ${woodCost} wood, 1 sheep and 1 ore.`}
            data-testid="wagon-upgrade"
          >
            <Trans>Upgrade</Trans>
          </MBtn>
        </div>
        {canBuyWithGold(view, seat) && (
          <div className="modp-row">
            <span className="modp-small modp-grow">
              {shared ? (
                <Trans>Buy a resource for 2 coins</Trans>
              ) : (
                <Trans>Buy a resource for 2 gold</Trans>
              )}
            </span>
            <MBtn
              aria-pressed={picking === "buy"}
              onClick={() => setPicking(picking === "buy" ? null : "buy")}
              data-testid="wagon-buy"
            >
              <Trans>Buy</Trans>
            </MBtn>
          </div>
        )}
        <div className="modp-row">
          <span className="modp-small modp-grow">
            {shared ? (
              <Trans>Sell to the bank for coins</Trans>
            ) : (
              <Trans>Sell to the bank for gold</Trans>
            )}
          </span>
          <MBtn
            aria-pressed={picking === "sell"}
            onClick={() => setPicking(picking === "sell" ? null : "sell")}
            data-testid="wagon-sell"
          >
            <Trans>Sell</Trans>
          </MBtn>
        </div>

        {picking !== null && (
          <div className="flex flex-col gap-1.5" data-testid="wagon-resources">
            <span className="hud-lab">
              {picking === "buy" ? <Trans>Take which?</Trans> : <Trans>Give which?</Trans>}
            </span>
            <div className="modp-picks">
              {RESOURCES.map((r, index) => (
                <button
                  key={r}
                  type="button"
                  className="modp-pick"
                  aria-label={t(RESOURCE_NAME[r])}
                  disabled={
                    picking === "buy"
                      ? !canBuyWithGold(view, seat) || (view.bank?.[index + 1] ?? 0) < 1
                      : (hand?.[index + 1] ?? 0) < (view.bank_ratios?.[index + 1] ?? 4)
                  }
                  onClick={() => {
                    setPicking(null);
                    if (picking === "buy") onBuy(r);
                    else onSell(r);
                  }}
                  data-testid={`wagon-res-${r}`}
                >
                  <ResArt idx={index + 1} size={24} />
                  <span className="modp-sub">
                    {picking === "sell"
                      ? `${view.bank_ratios?.[index + 1] ?? 4}:1`
                      : (view.bank?.[index + 1] ?? 0)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {ext.shared_currency && (
        <p className="modp-small">
          <Trans>
            The wagon spends the same coins as the river, and shares its two purchases per turn.
            Cross a ford for 3 movement, your bridge for 1, or another player's bridge for 1
            movement and 2 coins.
          </Trans>
        </p>
      )}
    </div>
  );
}

/**
 * The four cargoes, as whole words rather than a frame with a noun slot
 * (locales/README forbids composing a sentence around a runtime noun). The set
 * is closed, so each is its own msgid.
 */
/** The hero render each wagon load is drawn with (lib/resourceArt). */
const CARGO_GOOD: Record<number, string> = {
  [CARGO.marble]: "marble",
  [CARGO.glass]: "glass",
  [CARGO.sand]: "sand",
  [CARGO.tools]: "tools",
};

const CARGO_NAME: Record<number, MessageDescriptor> = {
  [CARGO.none]: msg({ id: "wagon.cargo.none", message: "nothing" }),
  [CARGO.marble]: msg({ id: "wagon.cargo.marble", message: "marble" }),
  [CARGO.glass]: msg({ id: "wagon.cargo.glass", message: "glass" }),
  [CARGO.sand]: msg({ id: "wagon.cargo.sand", message: "sand" }),
  [CARGO.tools]: msg({ id: "wagon.cargo.tools", message: "tools" }),
};

/**
 * The five resources, in the wire spelling the command takes, in the engine's
 * order (engine/board.Resources) to match every other resource list.
 */
const RESOURCES = ["wood", "brick", "sheep", "wheat", "ore"] as const;

const RESOURCE_NAME: Record<string, MessageDescriptor> = {
  wood: msg({ id: "wagon.res.wood", message: "Wood" }),
  brick: msg({ id: "wagon.res.brick", message: "Brick" }),
  sheep: msg({ id: "wagon.res.sheep", message: "Sheep" }),
  wheat: msg({ id: "wagon.res.wheat", message: "Wheat" }),
  ore: msg({ id: "wagon.res.ore", message: "Ore" }),
};

/** The three trade hexes as list titles. */
const ROLE_TITLE: Record<number, MessageDescriptor> = {
  [ROLE.castle]: msg({ id: "wagon.roleTitle.castle", message: "Castle" }),
  [ROLE.quarry]: msg({ id: "wagon.roleTitle.quarry", message: "Quarry" }),
  [ROLE.glassworks]: msg({ id: "wagon.roleTitle.glassworks", message: "Glassworks" }),
};

/** The three trade hexes, likewise. */
const ROLE_NAME: Record<number, MessageDescriptor> = {
  [ROLE.castle]: msg({ id: "wagon.role.castle", message: "castle" }),
  [ROLE.quarry]: msg({ id: "wagon.role.quarry", message: "quarry" }),
  [ROLE.glassworks]: msg({ id: "wagon.role.glassworks", message: "glassworks" }),
};
