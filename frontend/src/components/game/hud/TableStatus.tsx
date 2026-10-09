/**
 * The bank row and the viewer's own status panel, each wired to the socket
 * directly. Both select their own slice and are memoised on stable props, so
 * the top-right orb rebuilding its content doesn't redraw them on every server
 * frame.
 */
import * as React from "react";
import { Trans, Plural, useLingui } from "@lingui/react/macro";
import { msg, plural } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import { useGameSocket, shallowEqual, type State } from "@/lib/ws";
import {
  knightsExt,
  islandsExt,
  barbFirstIgnored,
  ISLANDS_MAX_SHIPS,
  type FullView,
} from "@/lib/types";
import { RES, COMMOD, COMMOD_ROW, resIconSlot, comIconSlot } from "@/lib/cardFace";
import {
  cardsLeftInBank,
  cardsLeftInSupply,
  harborRateCom,
  harborRateRes,
} from "@/lib/cardPhrases";
import { gameCaps } from "@/lib/caps";
import { resourceText, commodityText } from "@/lib/cardText";
import { ResIcon, CardFace } from "@/components/asset/AssetParts";
import { Tip } from "@/components/game/Tip";
import { cn } from "@/lib/utils";
import type { BankCardShape } from "@/lib/hudChrome";
import { HudLabel } from "./HudLayer";

/**
 * The bank's five counts, spread over the pinned panel's full width. A grid
 * because the bank always has exactly five values; the trade rates below don't
 * share this shape (one entry per port, usually one or none).
 */
const BANK_GRID = "grid grid-cols-5 gap-x-1 gap-y-0.5";

/**
 * The three commodities, spread over the same width as the five above. Their
 * own grid, since running them into BANK_GRID would leave two empty columns
 * that read as missing counts.
 */
const COMMOD_GRID = "grid grid-cols-3 gap-x-1 gap-y-0.5";

/**
 * Commodities are a finite supply: 12 of each, spent cards return to the
 * stack, and `ext.cak.commodity_supply` counts what remains (covered by the sim
 * conservation invariants). So they are drawn like resource piles, zero
 * colouring included: an empty stack withholds production under the shortage
 * rule and refuses supply trades.
 *
 * A descriptor, not a string: evaluated once at import, a string would freeze
 * the language then.
 */
const COMMODITY_SUPPLY = msg`Commodities are a limited supply, like resources.`;

// Post-game the socket carries the final board on `postgame` rather than
// `full`, as the game screen resolves it.
const liveView = (s: State): FullView | null => s.full ?? s.postgame?.board ?? null;

/**
 * The bank's five resource counts, and the commodity stacks beside them.
 *
 * The counts travel as a joined string: the `bank` array is a new object every
 * frame and would never compare equal. The barbarians have their own rail
 * (hud/BarbarianRail), so this slice is the bank alone.
 */
export interface BankSlice {
  show: boolean;
  counts: string;
  /**
   * Development cards left in the deck, or null where the ruleset has none
   * (Knights, Raiders). The base deck never recycles, so this can reach zero; it
   * sits with the other shared supplies.
   */
  devDeck: number | null;
  /**
   * Whether the panel also draws the three commodities. A ruleset question:
   * `ext.cak` appears only on the first roll, so asking it would add a row
   * mid-turn.
   */
  commodities: boolean;
  /**
   * The three commodity stacks, joined like `counts` so the slice compares
   * equal. Empty when the ruleset has no commodities.
   */
  comCounts: string;
}

export function selectBank(s: State): BankSlice {
  const v = liveView(s);
  if (!v) return { show: false, counts: "", devDeck: null, commodities: false, comCounts: "" };
  const caps = gameCaps(v);
  const knightsState = knightsExt(v);
  return {
    // Either switch hides it: the host's `show_bank`, or memory mode (see
    // GameConfig.memory_mode), which is stricter and can't turn a hidden bank
    // back on.
    show: (v.config.show_bank ?? true) && !v.config.memory_mode,
    counts: RES.map((r) => v.bank[r.idx]).join(","),
    devDeck: caps.hasDevCards ? v.dev_deck_count : null,
    commodities: caps.hasCommodities,
    // Indexed by the engine's commodity order, so `c.idx` reads it directly as
    // `r.idx` reads the bank. The engine seeds the state at game creation, so
    // setup shows a full stack.
    comCounts: caps.hasCommodities ? (knightsState?.commodity_supply ?? []).join(",") : "",
  };
}

/**
 * Your bank rate for a pile, shown on the pile, since the question is always
 * "what does wheat cost me". Green where it beats your default (a 2:1 harbour,
 * the merchant, a Merchant Fleet); the default is stated once in the header.
 * Decorative: the pile's accessible name gives the rate in words.
 */
function RateMark({ rate, better, compact }: { rate: number; better: boolean; compact?: boolean }) {
  return (
    <span
      aria-hidden
      data-rate={rate}
      data-better={better ? "true" : "false"}
      className={cn("hud-rate-mark", compact && "hud-rate-mark-sm")}
    >
      {rate}:1
    </span>
  );
}

/** The rate half of a pile's accessible name. */
function rateSentence(rate: number, base: number, better: string): string {
  return rate < base
    ? better
    : i18n._(msg({ message: `Trades at ${rate}:1`, context: "bank pile: your rate for it" }));
}

/** The development deck as one more pile in the bank: a card back and how many
 * are left. The deck doesn't recycle, so empty shows red like an empty pile. */
function DevDeckPile({ n }: { n: number }) {
  const { t } = useLingui();
  const label = t`${plural(n, {
    one: "# development card left in the deck",
    other: "# development cards left in the deck",
  })}`;
  return (
    <Tip tapToOpen title={label}>
      <span
        role="img"
        aria-label={label}
        className="flex cursor-default flex-col items-center gap-1 outline-none"
      >
        <span className={cn("flex h-[22px] items-center", n === 0 && "grayscale")}>
          <CardFace slot="devcard_back" className="h-[22px] w-[16px] rounded-[3px] object-cover" />
        </span>
        <span className={cn("font-num tabular-nums", n === 0 && "text-red-ink")}>{n}</span>
      </span>
    </Tip>
  );
}

export const BankRow = React.memo(function BankRow({ compact }: { compact?: boolean } = {}) {
  const bank = useGameSocket(selectBank, shallowEqual);
  // Your rate for each pile, drawn on the pile (see RateMark). Null for a
  // spectator, who trades with nobody.
  const rates = useMyRates();
  if (!bank.show) return null;
  const counts = bank.counts.split(",");
  // Empty string splits to [""], which would draw a blank cell, so guard on the
  // joined string.
  const comCounts = bank.comCounts ? bank.comCounts.split(",") : [];
  // Compact drops the label and inner panel: it is the always-on strip, where
  // the chrome would cost more room than the numbers. (It is also the phone's
  // dock trigger pill; see routes/Game.tsx.)
  //
  // The fleet is not shown here: it is a clock, not a stock, and has its own
  // rail (hud/BarbarianRail).
  //
  // Card icon art, not coloured dots. `ResIcon` draws nothing if the slot is
  // missing, so the count stays outside it.
  //
  // Commodities are left out for width: eight entries don't fit 360px legibly.
  // They are one tap away in the panel. If this must grow, add a second line
  // rather than cramming eight cells.
  if (compact) {
    return (
      <span className="flex items-center gap-2 text-[11px] font-extrabold">
        {RES.map((r, i) => (
          <span key={r.idx} className="flex items-center gap-0.5" title={r.name}>
            <ResIcon slot={resIconSlot(r.idx)} size={15} />
            {counts[i]}
            {/* The always-on phone strip only has room for exceptions: rates
                that beat your default. The full list is in the bank sheet. */}
            {rates && rates.res[r.idx] < rates.base && (
              <RateMark rate={rates.res[r.idx]} better compact />
            )}
          </span>
        ))}
      </span>
    );
  }
  // Five columns across the panel's full width, art stacked over count, so
  // each number sits under what it counts.
  return (
    <>
      {/* The header states your default rate, which every card trades at unless
          a pile shows its own. */}
      <div className="flex items-center justify-between gap-2">
        <HudLabel>
          <Trans context="the resource supply everyone draws from">Bank</Trans>
        </HudLabel>
        <DefaultRateChip />
      </div>
      <div className="flex flex-col gap-1.5 text-[14px] font-semibold">
        <div className={cn(BANK_GRID, bank.devDeck != null && "grid-cols-6")}>
          {RES.map((r, i) => {
            const n = Number(counts[i]);
            return (
              <Tip
                key={r.idx}
                tapToOpen
                title={cardsLeftInBank(r.key, n)}
                hint={resourceText(r.idx)?.hint}
              >
                {/* `role="img"` with the tip's sentence as the name, as Stat does
                    for the seat rail's counters: a glyph and a digit mean
                    nothing apart, and a name on a role-less span is dropped. */}
                <span
                  role="img"
                  aria-label={
                    rates
                      ? `${cardsLeftInBank(r.key, n)}. ${rateSentence(rates.res[r.idx], rates.base, harborRateRes(r.key, rates.res[r.idx]))}`
                      : cardsLeftInBank(r.key, n)
                  }
                  className="flex cursor-default flex-col items-center gap-1 outline-none"
                >
                  {/* The pile as a small card of that resource, the same face the
                      hand shelf deals. */}
                  <span className={cn("hud-ic flex h-[22px] items-center", n === 0 && "grayscale")}>
                    <ResIcon slot={resIconSlot(r.idx)} size={22} />
                  </span>
                  {/* An empty pile is a rule, not a low number: the bank can't
                      cover that production, so zero gets the colour. */}
                  <span className={cn("font-num tabular-nums", n === 0 && "text-red-ink")}>
                    {counts[i]}
                  </span>
                  {rates && (
                    <RateMark rate={rates.res[r.idx]} better={rates.res[r.idx] < rates.base} />
                  )}
                </span>
              </Tip>
            );
          })}
          {bank.devDeck != null && <DevDeckPile n={bank.devDeck} />}
        </div>
        {/* The Knights half, below a rule: in one grid with the resources they
            would read as three more resources. In COMMOD_ROW order (paper,
            cloth, coin) to match the hand shelf, trade builder and rate strip;
            `c.idx` carries the engine index for lookups. */}
        {bank.commodities && comCounts.length > 0 && (
          <>
            <span className="bg-line h-px w-full" />
            <div className={COMMOD_GRID}>
              {COMMOD_ROW.map((c) => {
                const left = comCounts[c.idx];
                const n = Number(left);
                return (
                  <Tip
                    key={c.idx}
                    tapToOpen
                    title={cardsLeftInSupply(c.key, n)}
                    hint={
                      <span className="flex flex-col gap-1">
                        <span>{i18n._(COMMODITY_SUPPLY)}</span>
                        <span>{commodityText(c.idx)?.hint}</span>
                      </span>
                    }
                  >
                    <span
                      role="img"
                      aria-label={
                        rates && rates.com[c.idx] > 0
                          ? `${cardsLeftInSupply(c.key, n)}. ${rateSentence(rates.com[c.idx], rates.base, harborRateCom(c.key, rates.com[c.idx]))}`
                          : cardsLeftInSupply(c.key, n)
                      }
                      className="flex cursor-default flex-col items-center gap-1 outline-none"
                    >
                      <span
                        className={cn("hud-ic flex h-[22px] items-center", n === 0 && "grayscale")}
                      >
                        <ResIcon slot={comIconSlot(c.idx)} size={22} />
                      </span>
                      {/* Same as a resource count, zero colouring included: an
                          empty stack withholds production and refuses supply
                          trades. */}
                      <span className={cn("font-num tabular-nums", n === 0 && "text-red-ink")}>
                        {left}
                      </span>
                      {rates && rates.com[c.idx] > 0 && (
                        <RateMark rate={rates.com[c.idx]} better={rates.com[c.idx] < rates.base} />
                      )}
                    </span>
                  </Tip>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
});

/**
 * The viewer's maritime rates, shown before they open the trade builder.
 * Spectators have no rates and get nothing.
 */
export function selectRates(s: State): { show: boolean; rates: string; coms: string } {
  const v = liveView(s);
  if (!v?.bank_ratios) return { show: false, rates: "", coms: "" };
  const good = v.good_ratios;
  return {
    show: true,
    rates: RES.map((r) => v.bank_ratios![r.idx] ?? 4).join(","),
    // Joined: the slice is compared with shallowEqual, and a map rebuilt per
    // read never compares equal. Empty in a base game, so the row hides.
    coms: good ? COMMOD.map((c) => good[c.name.toLowerCase()] ?? 0).join(",") : "",
  };
}

/**
 * The rate you pay for anything you hold no specific port for.
 *
 * Read off the commodities when there are any: only a generic 3:1 harbour
 * lowers a commodity's rate, and a Merchant Fleet cuts just one good, so the
 * highest commodity rate is the baseline. Resource rates can't be used (2:1
 * harbours on all five with no generic port gives every resource 2 and a
 * baseline of 4). Without commodities, the highest resource rate is the answer.
 */
export function defaultRate(resRates: number[], comRates: number[]): number {
  return comRates.length ? Math.max(...comRates) : Math.max(...resRates);
}

/**
 * The viewer's rates, parsed: per resource (engine index 1..5, slot 0 unused),
 * per commodity (engine index), and the default. Null for a spectator.
 */
export interface MyRates {
  res: number[];
  com: number[];
  base: number;
}
export function useMyRates(): MyRates | null {
  const { show, rates, coms } = useGameSocket(selectRates, shallowEqual);
  return React.useMemo(() => {
    if (!show) return null;
    const list = rates.split(",").map(Number);
    const com = coms ? coms.split(",").map(Number) : [];
    return { res: [0, ...list], com, base: defaultRate(list, com) };
  }, [show, rates, coms]);
}

/**
 * "You trade 3:1": the one rate the bank header states. Green when a generic
 * harbour has cut it below the bank's standing 4:1.
 */
export const DefaultRateChip = React.memo(function DefaultRateChip() {
  const { t } = useLingui();
  const r = useMyRates();
  if (!r) return null;
  const base = r.base;
  const hint =
    base === 3
      ? t`Your generic harbor. It applies to every resource and to commodities alike.`
      : t`The bank's standing rate. A generic 3:1 harbor would cut it for everything, including commodities; a specific 2:1 harbor only ever helps its own resource.`;
  const label = t({ message: `You trade ${base}:1`, context: "bank header: your default rate" });
  return (
    <Tip tapToOpen title={t`${base}:1 on everything else`} hint={hint}>
      <span
        role="img"
        aria-label={label}
        data-rate-default={base}
        className="hud-rate cursor-default shadow-none outline-none"
        data-better={base < 4 ? "true" : "false"}
      >
        {label}
      </span>
    </Tip>
  );
});

/**
 * What a 7 would cost the viewer right now. Under the trade rates, as the
 * other half of the question: the rates say what your cards are worth, this
 * says how many you may keep.
 *
 * `limit` comes from the server (PlayerView.DiscardAt, engine.DiscardThreshold),
 * not rebuilt from config and walls. The parts below only explain it, and the
 * remainder line keeps the explanation honest if a module adds a delta.
 *
 * Hidden entirely when the server didn't send the field (see selectDiscard).
 */
export interface DiscardSlice {
  show: boolean;
  held: number;
  limit: number;
  base: number;
  walls: number;
  knights: boolean;
}

export function selectDiscard(s: State): DiscardSlice {
  const v = liveView(s);
  const me = v?.players.find((p) => p.seat === v.viewer);
  // No `discard_at` means a server older than the field. Show nothing rather
  // than invent a limit: the table's configured limit ignores city walls and
  // would look right while being wrong.
  if (!v || !me || !me.discard_at) {
    return { show: false, held: 0, limit: 0, base: 0, walls: 0, knights: false };
  }
  const knightsState = knightsExt(v);
  const mine = knightsState?.players?.[v.viewer];
  return {
    show: true,
    held: me.hand_count + (mine?.commodity_count ?? 0),
    limit: me.discard_at,
    base: v.config?.discard_limit || 7,
    walls: mine?.walls ?? 0,
    // Ruleset, not state: the "City walls" line and the "resources and
    // commodities count together" note apply to a Knights game from its first
    // frame.
    knights: gameCaps(v).hasWalls,
  };
}

export const DiscardLimit = React.memo(function DiscardLimit() {
  const { t } = useLingui();
  const d = useGameSocket(selectDiscard, shallowEqual);
  if (!d.show) return null;
  const over = d.held > d.limit;
  // Strictly over, and half rounded down, as engine/turn.go decides it.
  const loses = over ? Math.floor(d.held / 2) : 0;
  const fromWalls = 2 * d.walls;
  // Anything the two known parts don't account for. Zero today; drawn so a
  // future module's delta shows up as a line instead of a wrong sum.
  const other = d.limit - d.base - fromWalls;
  const limit = d.limit;
  const held = d.held;
  const walls = d.walls;
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <HudLabel>
        <Trans context="the cards a 7 takes off you">Discard</Trans>
      </HudLabel>
      <Tip
        title={
          over ? (
            t`You would discard: ${loses}`
          ) : (
            // A plural: "Safe up to 1 cards" was reachable, and some locales
            // need more than two plural categories.
            <Plural value={limit} one="Safe up to # card" other="Safe up to # cards" />
          )
        }
        hint={
          <span className="flex flex-col gap-1">
            {over && (
              <span>
                <Trans>
                  Rolling a 7 now costs you{" "}
                  <b className="text-foreground">
                    <Plural value={loses} one="# card" other="# cards" />
                  </b>
                  , half of {held}, rounded down.
                </Trans>
              </span>
            )}
            <span>
              <b className="text-foreground">
                <Trans context="the table's configured discard limit">Table limit:</Trans>
              </b>{" "}
              {d.base}
            </span>
            {d.knights && (
              <span>
                <b className="text-foreground">
                  <Trans context="what the player's walls add to the discard limit">
                    City walls:
                  </Trans>
                </b>{" "}
                {walls} × 2 = +{fromWalls}
              </span>
            )}
            {/* Never seen in a healthy game: fires only when the client's
                breakdown has drifted from the server's number (a module delta
                this doesn't know about). Labelled as a discrepancy. */}
            {other !== 0 && (
              <span>
                <b className="text-foreground">
                  <Trans context="a discard-limit delta the client cannot explain">
                    Unaccounted:
                  </Trans>
                </b>{" "}
                {other > 0 ? "+" : ""}
                {other}
              </span>
            )}
            <span>
              <b className="text-foreground">
                <Trans context="this player's own discard limit">Your limit:</Trans>
              </b>{" "}
              {limit}
            </span>
            {/* Two whole sentences rather than one with a clause appended, so
                translators can place each. */}
            <span>
              {d.knights ? (
                <Trans>
                  Hold more than {limit} when a 7 comes up and you discard half, rounded down.
                  Resources and commodities count together.
                </Trans>
              ) : (
                <Trans>
                  Hold more than {limit} when a 7 comes up and you discard half, rounded down.
                </Trans>
              )}
            </span>
          </span>
        }
      >
        {/* Just the two numbers, `held/limit`, under the DISCARD label; what
            you would lose is one hover away. No glyph: the label already says
            what this is. */}
        <div
          className={cn(
            "bg-panel flex cursor-default items-center justify-center rounded-[10px] px-2.5 py-1.5 text-[11px] font-extrabold outline-none",
            over && "text-red-ink",
          )}
        >
          <span className="font-num tabular-nums">
            {d.held}/{d.limit}
          </span>
        </div>
      </Tip>
    </div>
  );
});

/**
 * The viewer's own reference state: pieces left, and in Knights the
 * barbarian track, their knights and their city improvements. Flattened to
 * primitives, like the seat rail's slice, so the comparison holds.
 */
export interface StatusSlice {
  show: boolean;
  viewer: number;
  roads: number;
  settlements: number;
  /** Cities still in hand. -1 where the ruleset has no cities (Explorers). */
  cities: number;
  /** Ships still in hand. -1 where the ruleset has no ships to count. */
  ships: number;
  hasPieces: boolean;
  knights: boolean;
  barbarians: number;
  /** The table's free first landfall, still unspent. See barbFirstIgnored. */
  firstIgnored: boolean;
  defense: number;
  knightsCities: number;
  /**
   * Knight pieces still in hand at each strength, as three fields rather than
   * a tuple: the slice is compared with `shallowEqual`, and a rebuilt array
   * would re-render the panel every frame.
   */
  knights1: number;
  knights2: number;
  knights3: number;
  /** Walls left to build, of the three a player owns. */
  wallsLeft: number;
  hasMine: boolean;
}

const NO_STATUS: StatusSlice = {
  show: false,
  viewer: -1,
  roads: 0,
  settlements: 0,
  cities: 0,
  ships: -1,
  hasPieces: false,
  knights: false,
  barbarians: 0,
  firstIgnored: false,
  defense: 0,
  knightsCities: 0,
  knights1: 0,
  knights2: 0,
  knights3: 0,
  wallsLeft: 0,
  hasMine: false,
};

/**
 * The per-player piece supply the engine enforces, restated for the readout:
 * two knight pieces at each strength (`knightsPerLevel`, engine/knights decide.go)
 * and three walls (`decideBuildWall`). Not on the wire (the view sends what is
 * on the board), so constants here too; if either becomes configurable this
 * must ask.
 */
const KNIGHTS_PER_LEVEL = 2;
const WALLS_PER_PLAYER = 3;

export function selectStatus(s: State): StatusSlice {
  const v = liveView(s);
  if (!v) return NO_STATUS;
  const me = v.players.find((p) => p.seat === v.viewer);
  // The Barbarians and You sections belong to any Knights game, not only one
  // that has rolled. See SeatSlice.knights in hud/SeatRail.
  const knights = gameCaps(v).hasBarbarians;
  const knightsState = knightsExt(v);
  if (!me && !knights) return NO_STATUS;
  const mine = knightsState?.players?.[v.viewer];
  let defense = 0;
  // Knight pieces the viewer has on the board, per strength. The panel draws
  // the rest of the supply, which can't be counted off the map.
  const placed = [0, 0, 0];
  if (knightsState) {
    for (const k of knightsState.knights) {
      if (k.active) defense += k.level;
      if (k.owner !== v.viewer) continue;
      if (k.level >= 1 && k.level <= 3) placed[k.level - 1]++;
    }
  }
  const islands = gameCaps(v).hasShips;
  return {
    show: true,
    viewer: v.viewer,
    roads: me?.roads_left ?? 0,
    settlements: me?.settlements_left ?? 0,
    // Explorers has no cities unless Knights brings them back.
    cities: gameCaps(v).hasExplorers && !gameCaps(v).hasKnights ? -1 : (me?.cities_left ?? 0),
    // Only for a seated player in an Islands game: `ships_left` is indexed by
    // seat. -1 is the "no ships in this game" sentinel (like `barbarians`).
    //
    // Missing module state means a full supply: the engine creates the Islands
    // state on its first Islands event (a ship, or the first turn's reset), so
    // setup views have no `ext.islands`.
    ships:
      islands && v.viewer >= 0
        ? (islandsExt(v)?.ships_left?.[v.viewer] ?? (islandsExt(v) ? 0 : ISLANDS_MAX_SHIPS))
        : -1,
    hasPieces: !!me,
    knights,
    barbarians: knightsState?.barbarians ?? 0,
    firstIgnored: knights && barbFirstIgnored(v),
    defense,
    knightsCities: knights ? v.buildings.reduce((n, b) => n + (b.city ? 1 : 0), 0) : 0,
    knights1: KNIGHTS_PER_LEVEL - placed[0],
    knights2: KNIGHTS_PER_LEVEL - placed[1],
    knights3: KNIGHTS_PER_LEVEL - placed[2],
    wallsLeft: WALLS_PER_PLAYER - (mine?.walls ?? 0),
    // A seat in a Knights game owns knights and walls from the start, so You is
    // drawn for anyone seated (not spectators).
    //
    // Gated on the pieces, not the fleet: `knights` above is `hasBarbarians`,
    // false under Raiders, but a Knights + Raiders table still builds both.
    hasMine: gameCaps(v).hasKnightPieces && v.viewer >= 0,
  };
}

/**
 * Which blocks the bank card draws, for the column that has to fit it.
 *
 * The HUD's right-hand column keeps the table feed's island only while it can
 * hold this card at full height with room to spare (see lib/hudChrome). The
 * card's shape (a spectator has no rates, discard line or pieces; a base game
 * has no commodities or barbarian track) comes from the four selectors above,
 * so it is assembled from them rather than re-derived.
 *
 * Composed rather than measured, since the column must reserve the card's
 * height while it is closed (at every width from `lg` to 1280px). The screen
 * also measures the rendered card and takes the larger; this is the answer on
 * the first frame and in jsdom.
 */
export function selectBankCardShape(s: State): BankCardShape {
  const bank = selectBank(s);
  return {
    counts: bank.show,
    commodities: bank.show && bank.commodities,
    discard: selectDiscard(s).show,
  };
}
