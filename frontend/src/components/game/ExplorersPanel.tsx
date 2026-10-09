import * as React from "react";
import { GoodIcon } from "@/components/asset/AssetParts";
import { Icons } from "./hudIcons";
import { Trans, Plural, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { ScenarioDialog as Overlay } from "./ScenarioDialog";
import { ExplorerCargoPanel, CARGO_LABELS, CargoSlots } from "./ExplorerCargoPanel";
import { Glyph, MBtn, MChip, MHead, ResArt } from "./moduleUi";
import { RES, COMMOD } from "@/lib/cardFace";
import { vertexKey } from "@/lib/hexgeo";
import { cn } from "@/lib/utils";
import { DETAILS_SUMMARY } from "@/lib/hudChrome";
import type { ExplorerShipAct, ExplorersShip, FullView, LegalTargets } from "@/lib/types";
import { knightsExt, explorersExt, EXPLORERS_TRACK_VP } from "@/lib/types";
import {
  battleReady,
  canAfford,
  canFish,
  EXPLORERS_COSTS,
  GOLD_BUYS_PER_TURN,
  GOLD_PER_RESOURCE,
  goldOf,
  holdCount,
  offeredJobs,
  shipOffers,
  supplies,
  dockedHarbour,
  cargoSwaps,
  cargoTransfers,
} from "@/lib/explorers";

/**
 * The Explorers control surface: one panel for the whole module.
 *
 * One panel rather than a shelf tile per command, because Explorers is a second
 * half of the turn with its own pieces, currency and phase. The Action phase's
 * buys sit on the buy shelf; everything the Movement phase does is here, where
 * a player can see every hull, its cargo and its remaining movement.
 *
 * Targets are still chosen on the board: this panel arms a mode and closes.
 *
 * The phase stepper and gold chip head it, the three mission tracks are always
 * in view (the only thing here worth points), and each hull is one raised card
 * with its cargo drawn as slots.
 */
export function ExplorersPanel({
  view,
  seat,
  legal,
  onArm,
  onSend,
  onClose,
}: {
  view: FullView;
  seat: number;
  legal?: LegalTargets;
  /**
   * Arm a board mode for a ship: the player then taps the destination or the
   * corner on the board itself. `null` disarms.
   */
  onArm: (
    mode: "sail" | "shipact" | null,
    ship: number | null,
    job?: ExplorerShipAct["job"] | null,
  ) => void;
  onSend: (cmd: string, payload?: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const x = explorersExt(view);
  const me = view.players[seat];
  const offers = shipOffers(view, seat, legal);
  const supply = supplies(view, seat);
  const gold = goldOf(view, seat);
  const fish = canFish(view);
  const ready = battleReady(view, seat);
  const movement = !!x?.movement;

  return (
    <Overlay
      title={<Trans>Your fleet</Trans>}
      onCancel={onClose}
      // The phase's own moves (leaving the Action phase, fishing, chasing the
      // pirate) stay in view while the fleet scrolls.
      footer={
        <div data-explorers-actions className="modp-actions">
          {!movement && (
            <MBtn primary onClick={() => onSend("explorers_enter_movement")}>
              <Trans>Start the Movement phase</Trans>
            </MBtn>
          )}
          <MBtn
            disabled={!movement || !fish.open}
            // One sentence per cause, so an exhausted supply isn't reported as
            // "nowhere". The piece is a "fish haul" everywhere else, so here too.
            title={
              !movement
                ? t`Start the Movement phase to fish.`
                : fish.why === "rolled"
                  ? t`You have already fished this turn.`
                  : fish.why === "nowhere"
                    ? t`No explored shoal can take a fish haul yet.`
                    : fish.why === "supply"
                      ? t`Every fish haul in the game has been taken.`
                      : offers.some((o) => o.ship.moved && !o.ship.done && o.left > 0)
                        ? t`Fishing now ends the move of the ship you are sailing.`
                        : undefined
            }
            onClick={() => onSend("explorers_fish_roll")}
          >
            <Trans>Fish for the Council</Trans>
          </MBtn>
          {ready.length > 0 && (
            <MBtn
              disabled={!movement}
              onClick={() => onSend("explorers_chase_pirate", { ships: ready.map((s) => s.id) })}
            >
              {/* Every ready ship, in id order. The engine stops rolling at the
                  first success, so nominating all of them only raises the odds. */}
              <Plural
                value={ready.length}
                one="Chase the pirate (# ship)"
                other="Chase the pirate (# ships)"
              />
            </MBtn>
          )}
        </div>
      }
    >
      <div className="modp-panel w-full">
        {/* The turn's three phases. Production is always done by the time the
            fleet can be opened (the roll pays it); Action and Movement are the
            two this panel moves between, and Movement can't go back. */}
        <div className="modp-row" data-explorers-phase={movement ? "movement" : "action"}>
          <span className="modp-phase modp-grow" aria-hidden>
            <span data-done="">
              <Trans>Production</Trans>
            </span>
            <span data-on={!movement ? "" : undefined} data-done={movement ? "" : undefined}>
              <Trans>Action</Trans>
            </span>
            <span data-on={movement ? "" : undefined}>
              <Trans>Movement</Trans>
            </span>
          </span>
          <span className="sr-only">
            {movement ? <Trans>Movement phase</Trans> : <Trans>Action phase</Trans>}
          </span>
          <MChip
            icon={<GoodIcon id="gold" size={16} fallback={<Icons.gold size={16} />} />}
            data-explorers-gold={gold}
          >
            <Trans>{gold} gold</Trans>
          </MChip>
        </div>
        <p className="modp-small">
          {movement ? (
            <Trans>
              Choose a ship, then a highlighted destination. Deliver fish and spices at either
              Council anchor.
            </Trans>
          ) : (
            <Trans>
              Finish building and trading before you sail. You cannot return to this phase this
              turn.
            </Trans>
          )}
        </p>

        {/* The three tracks, always in view: missions are the only thing here
            worth points. */}
        <div className="modp-sep">
          <MissionTracks view={view} seat={seat} />
        </div>

        <div className="modp-sep flex flex-col gap-2">
          <MHead label={<Trans>Fleet</Trans>}>
            {supply && (
              <span className="modp-head-end" data-explorers-supply>
                {/* One plural per piece ("1 settlers" was reachable). The chips
                    are the picture; the sentence is for screen readers. */}
                <span className="sr-only">
                  <Trans>In supply:</Trans>{" "}
                  <Plural value={supply.ships} one="# ship" other="# ships" />,{" "}
                  <Plural value={supply.settlers} one="# settler" other="# settlers" />,{" "}
                  <Plural value={supply.crews} one="# crew" other="# crews" />,{" "}
                  <Plural
                    value={supply.harbours}
                    one="# harbour settlement"
                    other="# harbour settlements"
                  />
                </span>
                <span className="modp-head-end" aria-hidden title={t`In supply`}>
                  <MChip icon={<Glyph name="cship" size={13} />}>{supply.ships}</MChip>
                  <MChip icon={<Glyph name="person" size={13} />}>{supply.settlers}</MChip>
                  <MChip icon={<Glyph name="crew" size={13} />}>{supply.crews}</MChip>
                  <MChip icon={<Glyph name="hset" size={13} />}>{supply.harbours}</MChip>
                </span>
              </span>
            )}
          </MHead>

          {offers.length === 0 ? (
            <p className="modp-small">
              <Trans>
                You have no ships on the water. Build one beside a harbour settlement of yours.
              </Trans>
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {offers.map((o, i) => (
                <li key={o.ship.id}>
                  <ShipRow
                    n={i + 1}
                    ship={o.ship}
                    moves={o.moves}
                    acts={o.acts}
                    left={o.left}
                    movement={movement}
                    harbour={dockedHarbour(view, seat, o.ship)}
                    onTransfer={(load, piece) =>
                      onSend(load ? "explorers_load" : "explorers_unload", {
                        ship_id: o.ship.id,
                        cargo: { [piece]: 1 },
                      })
                    }
                    onSwap={(cargo, back) =>
                      onSend("explorers_load", { ship_id: o.ship.id, cargo, back })
                    }
                    canSpeed={
                      movement && !!me?.hand && me.hand[3] > 0 && !o.ship.done && !o.ship.sped
                    }
                    onSail={() => onArm("sail", o.ship.id, null)}
                    onWork={(job) => onArm("shipact", o.ship.id, job)}
                    onSpeed={() => onSend("explorers_speed_ship", { ship_id: o.ship.id })}
                    canDeliver={
                      movement &&
                      (x?.anchors ?? []).some(
                        (v) =>
                          vertexKey(v) === vertexKey(o.ship.e.a) ||
                          vertexKey(v) === vertexKey(o.ship.e.b),
                      )
                    }
                    onDeliver={() => onSend("explorers_deliver", { ship_id: o.ship.id })}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {!movement && <ExplorerCargoPanel view={view} seat={seat} onSend={onSend} />}
        {!movement && (
          <details className="modp-disclosure p-3">
            <summary className={cn(DETAILS_SUMMARY, "modp-summary")}>
              <Trans>Trade gold</Trans>
            </summary>
            <GoldRow
              gold={gold}
              used={x?.seats?.[seat]?.gold_buys ?? 0}
              onBuy={(res) => onSend("explorers_gold_buy", { res })}
              onSell={(res) => onSend("explorers_gold_sell", { res })}
              onSellGood={(good) => onSend("explorers_gold_sell", { good })}
              commodities={knightsExt(view)?.players?.[seat]?.commodities}
              onBank={(res) => onSend("explorers_bank_gold", { res })}
              hand={me?.hand}
              bank={view.bank}
              fastGold={Math.max(
                0,
                (x?.seats?.[seat]?.villages?.[2] ?? []).filter(Boolean).length -
                  (x?.seats?.[seat]?.fast_gold ?? 0),
              )}
            />
          </details>
        )}
      </div>
    </Overlay>
  );
}

/**
 * What each job is called, one whole phrase per job rather than a verb with a
 * noun slot: they are four different things with different costs.
 */
const JOB_LABEL: Record<ExplorerShipAct["job"], React.ReactNode> = {
  found: <Trans>Land the settler</Trans>,
  load_haul: <Trans>Take the fish haul aboard</Trans>,
  land_crew: <Trans>Put a crew ashore</Trans>,
  take_crew: <Trans>Pick a crew back up</Trans>,
};

/** One hull: where it is, what it carries, and what it can still do. */
function ShipRow({
  n,
  ship,
  moves,
  acts,
  left,
  movement,
  canSpeed,
  onSail,
  onWork,
  onSpeed,
  onDeliver,
  canDeliver,
  harbour,
  onTransfer,
  onSwap,
}: {
  /** The ship's place in this seat's own list: "Ship 1" rather than a global id. */
  n: number;
  ship: ExplorersShip;
  moves: number;
  acts: ExplorerShipAct[];
  left: number;
  movement: boolean;
  canSpeed: boolean;
  onSail: () => void;
  onWork: (job: ExplorerShipAct["job"]) => void;
  onSpeed: () => void;
  onDeliver: () => void;
  canDeliver: boolean;
  harbour: ReturnType<typeof dockedHarbour>;
  onTransfer: (load: boolean, piece: keyof typeof CARGO_LABELS) => void;
  onSwap: (
    cargo: ReturnType<typeof cargoSwaps>[number]["cargo"],
    back: ReturnType<typeof cargoSwaps>[number]["back"],
  ) => void;
}) {
  const { t } = useLingui();
  const h = ship.hold ?? {};
  return (
    <div data-explorers-ship={ship.id} className="modp-card">
      <div className="modp-row" style={{ flexWrap: "nowrap" }}>
        <Glyph name="cship" size={18} className="text-(--hud-muted)" />
        <span className="font-semibold font-num tabular-nums whitespace-nowrap">
          {/* Numbered within the seat's own fleet; the id is global. */}
          <Trans>Ship {n}</Trans>
        </span>
        <span className="modp-grow">
          <CargoSlots cargo={h} />
          <span className="sr-only">
            <ShipHold ship={ship} />
          </span>
        </span>
        <MChip tone={left === 0 || ship.done ? undefined : "good"}>
          {ship.done ? (
            <Trans>Finished for this turn</Trans>
          ) : (
            // ICU plurals, as in the event log ("1 movement points left" was
            // reachable).
            <Plural value={left} one="# movement point left" other="# movement points left" />
          )}
        </MChip>
      </div>
      <div className="modp-row">
        <MBtn
          disabled={!movement || moves === 0}
          // A disabled button says why: before the Movement phase every ship
          // button is disabled, and a bare greyed "Sail" read as broken.
          title={
            !movement
              ? t`Start the Movement phase to sail.`
              : moves === 0
                ? t`This ship cannot sail any further this turn.`
                : undefined
          }
          onClick={onSail}
        >
          <Trans>Sail</Trans>
        </MBtn>
        {/* One button per job: two jobs can be legal at the same corner, and
            founding spends the ship. Arming a job also narrows what the board
            lights up. */}
        {offeredJobs(acts).map((job) => (
          <MBtn key={job} disabled={!movement} onClick={() => onWork(job)}>
            {JOB_LABEL[job]}
          </MBtn>
        ))}
        <MBtn
          disabled={!canSpeed}
          title={
            !movement
              ? t`Start the Movement phase to buy speed.`
              : ship.sped
                ? t`This ship has already bought speed this turn.`
                : ship.done
                  ? t`This ship has finished for this turn.`
                  : !canSpeed
                    ? t`You need a sheep.`
                    : undefined
          }
          onClick={onSpeed}
        >
          {/* One wool, once per ship per turn. The label says what it buys. */}
          <Trans>+2 movement for a sheep</Trans>
        </MBtn>
        <MBtn
          disabled={!canDeliver || ((h.haul ?? 0) === 0 && (h.spice ?? 0) === 0)}
          title={
            !movement
              ? t`Start the Movement phase to deliver.`
              : (h.haul ?? 0) === 0 && (h.spice ?? 0) === 0
                ? t`Only fish hauls and spice sacks can be delivered, and this ship has none.`
                : !canDeliver
                  ? t`Sail to either anchor of the Council hex to deliver.`
                  : undefined
          }
          onClick={onDeliver}
        >
          <Trans>Deliver to the Council</Trans>
        </MBtn>
      </div>
      {movement && harbour && (
        <div className="modp-row modp-sep">
          {cargoTransfers(harbour.basin, h).map((piece) => (
            <MBtn key={`load-${piece}`} onClick={() => onTransfer(true, piece)}>
              <Trans>Load {t(CARGO_LABELS[piece])}</Trans>
            </MBtn>
          ))}
          {cargoTransfers(h, harbour.basin).map((piece) => (
            <MBtn key={`unload-${piece}`} onClick={() => onTransfer(false, piece)}>
              <Trans>Unload {t(CARGO_LABELS[piece])}</Trans>
            </MBtn>
          ))}
          {/* A swap is one transfer, for when neither side has room until the
              other piece has left (a settler aboard and two crews ashore). */}
          {cargoSwaps(h, harbour.basin).map((sw) => (
            <MBtn
              key={`swap-${sw.give ?? "all"}-${sw.take ?? "all"}`}
              onClick={() => onSwap(sw.cargo, sw.back)}
            >
              {sw.give && sw.take ? (
                <Trans>
                  Swap {t(CARGO_LABELS[sw.give])} for {t(CARGO_LABELS[sw.take])}
                </Trans>
              ) : (
                <Trans>Swap the hold with the harbour</Trans>
              )}
            </MBtn>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What a ship is carrying, one plural per piece, or "Hold empty". Shared with
 * the replace-a-ship dialog, where the cargo is what tells two ships apart.
 */
export function ShipHold({ ship }: { ship: ExplorersShip }) {
  const h = ship.hold ?? {};
  if (holdCount(ship) === 0) return <Trans>Hold empty</Trans>;
  return (
    <span className="inline-flex flex-wrap gap-x-3">
      {!!h.settler && (
        <span>
          <Plural value={h.settler} one="# settler" other="# settlers" />
        </span>
      )}
      {!!h.crew && (
        <span>
          <Plural value={h.crew} one="# crew" other="# crews" />
        </span>
      )}
      {!!h.haul && (
        <span>
          <Plural value={h.haul} one="# fish haul" other="# fish hauls" />
        </span>
      )}
      {!!h.spice && (
        <span>
          <Plural value={h.spice} one="# spice sack" other="# spice sacks" />
        </span>
      )}
    </span>
  );
}

/** The three tracks' names and colours, in engine track order. */
const TRACKS: { name: MessageDescriptor; color: string; icon: React.ReactNode }[] = [
  {
    name: msg`Pirate lairs`,
    color: "var(--modp-track-lairs)",
    icon: <Glyph name="flag" size={15} style={{ color: "var(--modp-track-lairs)" }} />,
  },
  {
    name: msg`Fish`,
    color: "var(--modp-track-fish)",
    icon: (
      <GoodIcon
        id="fish"
        size={17}
        fallback={<Glyph name="fish" size={15} style={{ color: "var(--modp-track-fish)" }} />}
      />
    ),
  },
  {
    name: msg`Spices`,
    color: "var(--modp-track-spice)",
    icon: (
      <GoodIcon
        id="spice"
        size={17}
        fallback={<Glyph name="spice" size={15} style={{ color: "var(--modp-track-spice)" }} />}
      />
    ),
  },
];

/** The three mission tracks, S then seven spaces worth 0/1/1/2/2/2/3/3. */
function MissionTracks({ view, seat }: { view: FullView; seat: number }) {
  const { t } = useLingui();
  const x = explorersExt(view);
  const track = x?.seats?.[seat]?.track ?? [0, 0, 0];
  const leaders = x?.leaders ?? [];
  const total = x?.seats?.[seat]?.mission_vp;
  return (
    <div className="flex flex-col gap-1.5">
      <MHead label={<Trans>Missions</Trans>}>
        {total !== undefined && (
          <span className="hud-lab" data-explorers-mission-vp={total}>
            <Trans>{total} VP</Trans>
          </span>
        )}
      </MHead>
      <ul className="flex flex-col gap-1.5">
        {TRACKS.map((tr, i) => {
          const pos = track[i] ?? 0;
          const vp = EXPLORERS_TRACK_VP[pos] ?? 0;
          const name = t(tr.name);
          return (
            <li
              key={i}
              className="modp-track"
              style={{ ["--tc" as string]: tr.color }}
              title={t`${name}: space ${pos} of 7, worth ${vp} VP`}
              aria-label={t`${name}: space ${pos} of 7, worth ${vp} VP`}
            >
              <span className="grid place-items-center">{tr.icon}</span>
              <span className="text-[12.5px]">{name}</span>
              <span className="modp-cells" aria-hidden>
                {Array.from({ length: 7 }, (_, c) => (
                  <i key={c} data-on={c < pos ? "" : undefined} />
                ))}
              </span>
              <span className="flex items-center gap-1.5">
                {leaders[i] === seat && (
                  <MChip tone="focus" title={t`You hold this track's bonus tile.`}>
                    <Trans>bonus</Trans>
                  </MChip>
                )}
                <span className="modp-num w-4 text-right">{vp}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The three gold lanes: two gold buy a resource, twice a turn; a Fast Gold
 * village sells one the other way, once per village per Action phase; and three
 * identical cards buy a gold at the flat bank rate (there are no ports here).
 */
function GoldRow({
  gold,
  used,
  hand,
  bank,
  fastGold,
  onBuy,
  onSell,
  onBank,
  onSellGood,
  commodities,
}: {
  gold: number;
  used: number;
  hand?: number[];
  bank?: number[];
  fastGold: number;
  commodities?: number[];
  onSellGood: (good: string) => void;
  onBuy: (res: number) => void;
  onSell: (res: number) => void;
  onBank: (res: number) => void;
}) {
  const canBuy = gold >= GOLD_PER_RESOURCE && used < GOLD_BUYS_PER_TURN;
  return (
    <div className="flex flex-col gap-2 pt-2">
      <span className="modp-small">
        <Trans>
          Two gold buy any resource, twice a turn ({GOLD_BUYS_PER_TURN - used} left). Three
          identical cards buy one gold.
        </Trans>
      </span>
      {fastGold > 0 && (
        <p className="modp-small">
          {/* Commodities exist only alongside Knights; don't name them otherwise. */}
          {commodities ? (
            <Trans>
              Fast Gold sales left: {fastGold}. Sell one resource or commodity for one gold.
            </Trans>
          ) : (
            <Trans>Fast Gold sales left: {fastGold}. Sell one resource for one gold.</Trans>
          )}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {RES.map(({ idx: r, name }) => (
          <span key={r} role="group" aria-label={name} className="modp-row">
            <ResArt idx={r} size={20} />
            <span className="modp-grow font-medium">{name}</span>
            <MBtn disabled={!canBuy || (bank?.[r] ?? 0) === 0} onClick={() => onBuy(r)}>
              <Trans>Buy for 2 gold</Trans>
            </MBtn>
            <MBtn quiet disabled={!hand || (hand[r] ?? 0) < 3} onClick={() => onBank(r)}>
              <Trans>Sell 3 for 1 gold</Trans>
            </MBtn>
            {fastGold > 0 && (
              <MBtn quiet disabled={!hand || (hand[r] ?? 0) < 1} onClick={() => onSell(r)}>
                <Trans>Sell 1 for 1 gold</Trans>
              </MBtn>
            )}
          </span>
        ))}
        {fastGold > 0 &&
          commodities &&
          COMMOD.map(({ idx, name }) => (
            <span key={idx} role="group" aria-label={name} className="modp-row">
              <span className="modp-grow font-medium">{name}</span>
              <MBtn
                quiet
                disabled={(commodities[idx] ?? 0) < 1}
                onClick={() => onSellGood(["cloth", "paper", "coin"][idx])}
              >
                <Trans>Sell 1 for 1 gold</Trans>
              </MBtn>
            </span>
          ))}
      </div>
    </div>
  );
}

/** Re-exported so the shop tile can price the buys without a second table. */
export { EXPLORERS_COSTS, canAfford };
