/**
 * The seat rail, wired to the socket one seat at a time.
 *
 * Each tile subscribes for itself: the selector returns that seat's numbers as
 * primitives, compared field by field, so a seat re-renders only when its own
 * values change (a roll that pays one player re-renders one card). What the
 * live view doesn't carry (display names, colours, cosmetics) arrives as
 * `chrome`, memoised by the screen against the roster query.
 */
import * as React from "react";
import { msg, t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";
import { useGameSocket, shallowEqual, type State } from "@/lib/ws";
import {
  knightsExt,
  explorersExt,
  harbormasterExt,
  islandsExt,
  raidersExt,
  wagonsExt,
  type FullView,
} from "@/lib/types";
import { seatBudgetMs, seatCountdownMs, timerBarPct } from "@/lib/gamestate";
import { timerTier } from "@/lib/seatRing";
import { PlayerCard, type PlayerCardData, type TrackInfo } from "@/components/game/PlayerCard";
import { DecoratedName } from "@/components/DecoratedName";
import { botCharacter } from "@/lib/botPersonality";
import { COMMOD } from "@/lib/cardFace";
import { TRACK_ROW } from "@/lib/improvements";
import { gameCaps } from "@/lib/caps";
import { bootHolder, revealedFishMix, seatFishTiles } from "@/lib/fish";
import { isPoorest, poorestInPlay, seatCoins, wealthiestSeat } from "@/lib/rivers";
import { seatCamelVp } from "@/lib/caravans";
import { GLASS } from "./HudLayer";
import { Stat } from "@/components/game/Stat";
import { CardFan, Icons } from "@/components/game/hudIcons";
import { SeatTimerBar } from "./SeatTimerBar";
import {
  seatPanelGap,
  SEAT_STRIP_GAP,
  seatRailHeight,
  railMaxHeight,
  seatPanelHeight,
  seatCounterCount,
  seatCounterGrid,
  SEAT_RAIL_BOTTOM_INSET,
  SEAT_TIMER_H,
  OWN_SEAT_GAP,
  COMPACT_ROW_H,
  SQUAT_RAIL_WIDTH,
  seatRailMode,
  type SeatDensity,
  type SeatVariant,
} from "@/lib/seatPanels";
import { useMeasure, SKIP } from "@/lib/measure";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { COLUMN_LAYOUT_QUERY, SQUAT_QUERY } from "@/lib/hudChrome";
import { cn } from "@/lib/utils";
import { formatList } from "@/lib/intl";
import type { HudAnchors } from "@/lib/hudAnchors";
import { lastDrawn } from "@/lib/cardReveal";
import type { CardKind } from "@/lib/cardText";
import { LastDrawnTab } from "@/components/game/CardRevealLayer";

/**
 * Whether the phone strip is left open, remembered between games. A plain
 * read/write pair like the other board-side preferences (lib/boardPostFx,
 * lib/colorblind). A read that throws (private mode, a locked-down webview)
 * opens it closed, the default anyway.
 */
const RAIL_OPEN_KEY = "costan.railopen";

export function readRailOpen(): boolean {
  try {
    return localStorage.getItem(RAIL_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeRailOpen(on: boolean): void {
  try {
    localStorage.setItem(RAIL_OPEN_KEY, on ? "1" : "0");
  } catch {
    /* ignore: the choice still holds for this session */
  }
}

/**
 * Everything a seat's card shows that the live view doesn't carry: the roster
 * name and cosmetics, and the resolved seat colour (colourblind mode may
 * override it). Memoised against the roster query, so it is stable between
 * socket frames and the tiles can be memoised.
 */
export interface SeatChrome {
  /** Display name for a seat; `viewName` is the fallback the view itself carries. */
  label(seat: number, viewName: string | undefined): string;
  decoration(seat: number): string | undefined;
  color(seat: number): string;
}

// Engine track order: 0 Trade, 1 Politics, 2 Science, matching
// `improve`/`metropolis` on the wire. The row is drawn in TRACK_ROW order
// (lib/improvements). Descriptors, not strings, since this is evaluated once at
// import; each has a context because the words mean other things elsewhere.
const TRACKS: MessageDescriptor[] = [
  msg({ message: "Trade", context: "city improvement track" }),
  msg({ message: "Politics", context: "city improvement track" }),
  msg({ message: "Science", context: "city improvement track" }),
];
// Trade -> cloth, Politics -> coin, Science -> paper.
const TRACK_COMMOD = [0, 2, 1];

/**
 * One seat's card, flattened to primitives: the slice is compared with
 * `shallowEqual`, so anything nested and rebuilt per read would never compare
 * equal. The three improvement tracks are folded into one string for that
 * reason.
 */
export interface SeatSlice {
  present: boolean;
  vp: number;
  active: boolean;
  handCount: number;
  devCount: number;
  knightsPlayed: number;
  routeLength: number;
  longestRoad: boolean;
  largestArmy: boolean;
  islandVp: number;
  islands: boolean;
  /**
   * Whether this is a Fishermen game, from the ruleset (like `knights`): the
   * module's state doesn't exist until the first catch.
   */
  fishermen: boolean;
  /**
   * How many fish tiles this seat holds. Public like a card count; their value
   * is not (lib/types FishExt.tiles).
   */
  fish: number;
  /**
   * This seat's actual tiles, in a revealed replay of a finished game only.
   * Null in every live view.
   */
  fishMix: readonly [number, number, number] | null;
  /** Holds the old boot: no points, one extra point needed to win. */
  hasBoot: boolean;
  /**
   * Whether this is a Harbormaster game, from the ruleset like `knights` and
   * `fishermen`. The module publishes its ext from the first frame (lib/types
   * HarbormasterExt), but the slot and counter are a ruleset property either
   * way.
   */
  harbormaster: boolean;
  /**
   * This seat's harbour points: 1 per settlement and 2 per city on a harbour
   * vertex. Public, derived by the engine every batch; shows who is close.
   */
  harbourPoints: number;
  /** Holds the Harbormaster card: +2 public victory points. */
  hasHarbormaster: boolean;
  /**
   * The harbour points needed before the card enters play, from the wire
   * (`ext.harbormaster.threshold`) so it matches the engine. 0 means not sent:
   * no line to draw against.
   */
  harbourThreshold: number;
  /**
   * Whether this is a Rivers game, from the ruleset like `fishermen` and `knights`:
   * the coin counter and wealth slots exist from the first frame; the numbers
   * come from module state.
   */
  rivers: boolean;
  /** This seat's coins. Public, all of it: Rivers holds no hidden state. */
  coins: number;
  /**
   * Whether this is a Caravans game (ruleset, not state), so the camel counter
   * is on every card from the first frame.
   */
  caravans: boolean;
  /** This seat's points from buildings between two camels (lib/caravans). */
  camelVp: number;
  /** Holds the Wealthiest Settler tile (+1). Nobody does on a tie. */
  wealthiest: boolean;
  /** Holds a Poorest Settler tile (-2). Several seats can, and at setup all do. */
  poorest: boolean;
  /**
   * The Poorest Settler tile is in this game: false alongside Wagons and
   * Raiders, where the slot is hidden.
   */
  poorestInPlay: boolean;
  /**
   * There is a Longest Road award in this game: false under Wagons
   * (`Hooks.NoLongestRoad`). Gates the award chip and the "5 or more takes the
   * title" half of the route counter's hint; the counter itself stays.
   */
  longestRoadInPlay: boolean;
  /** The base deck and Largest Army are in this game; false under Raiders and Explorers. */
  devDeckInPlay: boolean;
  largestArmyInPlay: boolean;
  /**
   * Raiders, Wagons or Explorers gold; -1 when the game has none (a primitive,
   * for the compare). Also -1 under Wagons + Rivers without Raiders, where the
   * wagon's gold is the Rivers coin purse and the coin counter shows it.
   */
  gold: number;
  /** Raiders prisoners; -1 outside Raiders. */
  prisoners: number;
  prisonersPerVp: number;
  /** Raiders riders on the board; -1 outside Raiders. */
  ridersOut: number;
  ridersPerSeat: number;
  /** Wagons level and deliveries; -1 outside Wagons. */
  wagonLevel: number;
  deliveries: number;
  /** Explorers ships on the water and mission points; -1 outside Explorers. */
  ships: number;
  missionVp: number;
  viewName: string | undefined;
  deadlineMs: number | null;
  budgetMs: number | null;
  /**
   * Whether this is a Knights game, from the ruleset, never from `ext.cak`: the
   * module creates its state on its first event (the first roll's event die),
   * so through setup and the first pre-roll turn there is no `ext.cak`, and the
   * rail would swap tiers mid-turn.
   */
  knights: boolean;
  commodityCount: number;
  progressCount: number;
  knightsActive: number;
  knightsTotal: number;
  defenderVp: number;
  /**
   * Victory points from the Printer and the Constitution, kept and never
   * played, so not in `progressCount`. Public for every seat (see
   * `PlayerCardData.knights.extraVp`), unlike `commodities`/`progress`, which the
   * redactor fills in only for the owner.
   */
  extraVp: number;
  /** "level:metropolis|…" per track, so a nested array can't break the compare. */
  tracks: string;
  /**
   * Cards this seat may keep on a 7, from the engine. 0 means not sent (older
   * server), treated as unknown rather than guessed from config and walls.
   */
  discardAt: number;
}

const ABSENT: SeatSlice = {
  present: false,
  vp: 0,
  active: false,
  handCount: 0,
  devCount: 0,
  knightsPlayed: 0,
  routeLength: 0,
  longestRoad: false,
  largestArmy: false,
  islandVp: 0,
  islands: false,
  fishermen: false,
  fish: 0,
  fishMix: null,
  hasBoot: false,
  harbormaster: false,
  harbourPoints: 0,
  hasHarbormaster: false,
  harbourThreshold: 0,
  rivers: false,
  coins: 0,
  caravans: false,
  camelVp: 0,
  devDeckInPlay: true,
  largestArmyInPlay: true,
  gold: -1,
  prisoners: -1,
  prisonersPerVp: 2,
  ridersOut: -1,
  ridersPerSeat: 6,
  wagonLevel: -1,
  deliveries: -1,
  ships: -1,
  missionVp: -1,
  wealthiest: false,
  poorest: false,
  poorestInPlay: false,
  longestRoadInPlay: true,
  viewName: undefined,
  deadlineMs: null,
  budgetMs: null,
  knights: false,
  commodityCount: 0,
  progressCount: 0,
  knightsActive: 0,
  knightsTotal: 0,
  defenderVp: 0,
  extraVp: 0,
  tracks: "",
  discardAt: 0,
};

export function selectSeat(view: FullView | null, seat: number): SeatSlice {
  if (!view) return ABSENT;
  const p = view.players.find((x) => x.seat === seat);
  if (!p) return ABSENT;
  // "Does this game have Knights?" is a ruleset question; `ext.cak` doesn't
  // exist until the module's first event. See SeatSlice.knights.
  const knights = gameCaps(view).hasKnightPieces;
  const knightsState = knightsExt(view);
  const islands = islandsExt(view);
  const harbor = harbormasterExt(view);
  const cp = knightsState?.players?.[seat];
  let knightsActive = 0;
  let knightsTotal = 0;
  if (knightsState) {
    for (const k of knightsState.knights) {
      if (k.owner !== seat) continue;
      knightsTotal++;
      if (k.active) knightsActive++;
    }
  }
  return {
    present: true,
    vp: p.vp,
    active: seat === view.cur,
    handCount: p.hand_count,
    devCount: p.dev_count,
    knightsPlayed: p.knights_played,
    // From the engine (engine.LongestRouteLength), like discardAt below: the
    // traversal handles ship routes and knights breaking a route, and a copy
    // here would disagree with the server's award. 0 from an older server.
    routeLength: p.route_length ?? 0,
    longestRoad: view.longest_road === seat,
    largestArmy: view.largest_army === seat,
    islandVp: islands?.island_vp?.[seat] ?? 0,
    islands: !!islands,
    // Ruleset vs state again: the fish counter and boot slot exist from the
    // start; the numbers come from module state, which appears on the first
    // catch.
    fishermen: gameCaps(view).hasFish,
    fish: seatFishTiles(view, seat),
    fishMix: revealedFishMix(view, seat),
    hasBoot: bootHolder(view) === seat,
    // Ruleset vs state: the slot and counter from the ruleset, the numbers from
    // the module's ext.
    harbormaster: gameCaps(view).hasHarbormaster,
    harbourPoints: harbor?.points?.[seat] ?? 0,
    // `?? -1`: the wire sentinel for nobody is -1, so an absent holder must not
    // read as seat 0.
    hasHarbormaster: (harbor?.holder ?? -1) === seat,
    harbourThreshold: harbor?.threshold ?? 0,
    // Slots from the ruleset, numbers from `ext.rivers` (complete from the board
    // event onward).
    rivers: gameCaps(view).hasRivers,
    coins: seatCoins(view, seat),
    // Caravans: the slot from the ruleset, the number derived from the public
    // camels and buildings.
    caravans: gameCaps(view).hasCaravans,
    camelVp: seatCamelVp(view, seat),
    wealthiest: wealthiestSeat(view) === seat,
    poorest: isPoorest(view, seat),
    poorestInPlay: poorestInPlay(view),
    // The ruleset, not the standings: the awards row fixes its slots on the
    // first frame.
    longestRoadInPlay: gameCaps(view).hasLongestRoad,
    devDeckInPlay: gameCaps(view).hasDevCards,
    largestArmyInPlay: gameCaps(view).hasLargestArmy,
    // Raiders' gold if present, else Wagons', else Explorers' (all public).
    // Ruleset first, so the slot exists from the first frame.
    //
    // Wagons beside Rivers has one purse: the wagon's gold is the Rivers coins
    // (engine/wagons/river_economy.go), so this slot goes and the coin counter
    // stays. Keyed on the ruleset rather than `shared_currency` (set only once
    // the wagons start), to agree with seatCounterCount from the first frame.
    gold: gameCaps(view).hasRaiders
      ? (raidersExt(view)?.gold?.[seat] ?? 0)
      : gameCaps(view).hasWagons
        ? gameCaps(view).hasRivers
          ? -1
          : (wagonsExt(view)?.gold?.[seat] ?? 0)
        : gameCaps(view).hasExplorers
          ? (explorersExt(view)?.seats?.[seat]?.gold ?? 0)
          : -1,
    prisoners: gameCaps(view).hasRaiders ? (raidersExt(view)?.prisoners?.[seat] ?? 0) : -1,
    prisonersPerVp: knights ? 3 : 2,
    // Module counters: ruleset first, numbers from the ext.
    ridersOut: gameCaps(view).hasRaiders
      ? (raidersExt(view)?.riders_per_seat ?? 6) -
        (raidersExt(view)?.riders_left?.[seat] ?? raidersExt(view)?.riders_per_seat ?? 6)
      : -1,
    ridersPerSeat: raidersExt(view)?.riders_per_seat ?? 6,
    wagonLevel: gameCaps(view).hasWagons ? wagonsExt(view)?.level?.[seat] || 1 : -1,
    deliveries: gameCaps(view).hasWagons ? (wagonsExt(view)?.delivered?.[seat] ?? 0) : -1,
    ships: gameCaps(view).hasExplorers
      ? (explorersExt(view)?.ships ?? []).filter((sh) => sh.owner === seat).length
      : -1,
    missionVp: gameCaps(view).hasExplorers
      ? (explorersExt(view)?.seats?.[seat]?.mission_vp ?? 0)
      : -1,
    viewName: view.seat_names?.[seat],
    deadlineMs: seatCountdownMs(view, seat),
    budgetMs: seatBudgetMs(view, seat),
    knights,
    commodityCount: cp?.commodity_count ?? 0,
    progressCount: cp?.progress_count ?? 0,
    knightsActive,
    knightsTotal,
    defenderVp: cp?.defender_vp ?? 0,
    extraVp: cp?.extra_vp ?? 0,
    // From the engine (engine.DiscardThreshold) rather than recomputed from
    // `config.discard_limit + 2*walls`, which would drift once a module adds a
    // delta. 0 when absent, so counters go unmarked.
    discardAt: p.discard_at ?? 0,
    // Serialised in engine track order and split back by the same index, so
    // TRACK_ROW decides the columns at draw time. A seat with no module state
    // reads "0:false" three times, which is correct.
    tracks: knights
      ? TRACKS.map((_, i) => `${cp?.improve?.[i] ?? 0}:${cp?.metropolis?.[i] ?? false}`).join("|")
      : "",
  };
}

/**
 * Unpack a `SeatSlice.tracks` string into the card's three columns.
 *
 * The string is in engine track order (0 Trade, 1 Politics, 2 Science); the
 * columns come out in TRACK_ROW order (Science, Trade, Politics). Every field
 * of a column (name, level, metropolis flag, next cost, colour, commodity, and
 * the `track` passed back to `improvementReward`) is read with the same `i`, so
 * reordering can't mix two tracks.
 */
export function seatTracks(tracks: string): TrackInfo[] {
  const parts = tracks.split("|");
  return TRACK_ROW.map((i) => {
    const [level, metro] = (parts[i] ?? "0:false").split(":");
    return {
      name: i18n._(TRACKS[i]),
      track: i,
      level: Number(level),
      metropolis: metro === "true",
      nextCost: Number(level) + 1,
      // .ink, not .color: the card-face pastel doesn't read as bare 10px pips.
      pipColor: COMMOD[TRACK_COMMOD[i]].ink,
      // The key, not the display name: the tip puts the commodity next to a
      // count, which needs a per-card message (lib/cardPhrases).
      commodity: COMMOD[TRACK_COMMOD[i]].key,
    };
  });
}

// The view a seat's card reads. Post-game the socket carries the final board on
// `postgame` rather than `full`, as the game screen resolves it, so the rail
// keeps drawing the finished table.
const liveView = (s: State): FullView | null => s.full ?? s.postgame?.board ?? null;

// TileCountdown shows the active player's remaining decision budget as a
// depleting bar on their tile. The server sends the remaining time every frame;
// between frames it ticks locally off a monotonic anchor. The bar's full mark is
// budgetMs, the decision's whole budget from the server; it must not be inferred
// from the remaining stream, which can tick upward (a new decision, the
// inactivity floor) and would make the bar jump. deadlineMs is null when a
// bot/auto seat is up: the tile still glows but shows no bar.
function TileCountdown({
  deadlineMs,
  budgetMs,
  frozen,
}: {
  deadlineMs: number | null;
  budgetMs: number | null;
  frozen?: boolean;
}) {
  const [remaining, setRemaining] = React.useState(deadlineMs ?? 0);
  React.useEffect(() => {
    // After the game ends the endgame overlay floats over the board; freeze the
    // countdown rather than draining it behind the scoreboard.
    if (deadlineMs == null || frozen) return;
    const anchor = performance.now();
    // Snap to whole seconds so the bar steps once per second; the tick is faster
    // than 1s only to land each step near the boundary despite drift.
    const tick = () => {
      const raw = Math.max(0, deadlineMs - (performance.now() - anchor));
      setRemaining(Math.ceil(raw / 1000) * 1000);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadlineMs, frozen]);
  if (deadlineMs == null) return null;
  // The same three tiers the hairline uses (lib/seatRing), from this
  // component's own per-second tick.
  const tier = timerTier(remaining);
  const low = tier === "red";
  const pct = timerBarPct(remaining, budgetMs);
  // Reserve the label's width for the largest second count (+1ch for "s"),
  // right-aligned, so the 10s -> 9s drop doesn't narrow the label and make the
  // flex-1 bar jump wider.
  const secsLeft = Math.ceil(remaining / 1000);
  const labelCh = String(Math.ceil(Math.max(budgetMs ?? 0, deadlineMs) / 1000)).length + 1;
  return (
    <div className="mt-0.5 flex items-center gap-1.5">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full border border-border bg-panel">
        <div
          className={cn(
            "absolute inset-y-0 left-0 transition-[width] duration-100 ease-linear",
            tier === "red" ? "bg-red" : tier === "yellow" ? "bg-yellow" : "bg-green",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={cn(
          "text-right text-[11px] font-extrabold leading-none font-num tabular-nums",
          low ? "text-red-ink" : "text-muted",
        )}
        style={{ minWidth: `${labelCh}ch` }}
      >
        {t({ message: `${secsLeft}s`, context: "seconds left on a timer, compact" })}
      </span>
    </div>
  );
}

/**
 * One seat's panel: subscribes to its own slice and nothing else. Memoised on
 * props that hold still between frames (`seat`, `density`, `variant`,
 * `chrome`, `anchors`, two booleans), so only its slice changing re-renders it.
 */
const SeatTile = React.memo(function SeatTile({
  seat,
  density,
  variant,
  memory,
  chrome,
  anchors,
  frozen,
  expandable,
  expanded,
  onOpen,
  onClose,
  canHover,
  mine = false,
  fill = false,
}: {
  seat: number;
  /** The viewer's own seat: the raised surface, and the "you" mark. */
  mine?: boolean;
  /**
   * The card takes the panel's whole width. Only your own panel under the
   * compact rail (seven seats and up), where the column is 252px and the
   * card's narrower sideways-phone width would leave a gap.
   */
  fill?: boolean;
  density: SeatDensity;
  variant: SeatVariant;
  /** The table's memory mode; see PlayerCard's `memory`. */
  memory: boolean;
  chrome: SeatChrome;
  anchors?: HudAnchors;
  frozen: boolean;
  expandable: boolean;
  expanded: boolean;
  onOpen: (seat: number) => void;
  onClose: () => void;
  canHover: boolean;
}) {
  const sel = React.useCallback((s: State) => selectSeat(liveView(s), seat), [seat]);
  const v = useGameSocket(sel, shallowEqual);
  // The card this seat drew last, as one string so the selector compares by
  // value.
  const drawnSel = React.useCallback(
    (s: State) => {
      const d = lastDrawn(s.events, seat);
      return d ? `${d.kind}:${d.id}` : "";
    },
    [seat],
  );
  const drawn = useGameSocket(drawnSel);
  if (!v.present) return null;
  const [drawnKind, drawnId] = drawn ? (drawn.split(":") as [CardKind, string]) : [null, ""];

  const data: PlayerCardData = {
    seat,
    name: (
      <DecoratedName decoration={chrome.decoration(seat)}>
        {chrome.label(seat, v.viewName)}
      </DecoratedName>
    ),
    // A bot's character, on hover, from the display name (see
    // lib/botPersonality). Undefined for human seats and for a takeover bot
    // using a human's name.
    nameTitle: (() => {
      const c = botCharacter(chrome.label(seat, v.viewName));
      return c ? i18n._(c) : undefined;
    })(),
    color: chrome.color(seat),
    vp: v.vp,
    active: v.active,
    mine,
    handCount: v.handCount,
    devCount: v.devCount,
    knightsPlayed: v.knightsPlayed,
    routeLength: v.routeLength,
    longestRoad: v.longestRoad,
    longestRoadLabel: v.islands ? "ROUTE" : "ROAD",
    largestArmy: v.largestArmy,
    islandVp: v.islandVp,
    islands: v.islands,
    fishermen: v.fishermen,
    fish: v.fish,
    fishMix: v.fishMix,
    hasBoot: v.hasBoot,
    harbormaster: v.harbormaster,
    harbourPoints: v.harbourPoints,
    hasHarbormaster: v.hasHarbormaster,
    harbourThreshold: v.harbourThreshold || undefined,
    rivers: v.rivers,
    coins: v.coins,
    caravans: v.caravans,
    camelVp: v.camelVp,
    wealthiest: v.wealthiest,
    poorest: v.poorest,
    poorestInPlay: v.poorestInPlay,
    longestRoadInPlay: v.longestRoadInPlay,
    devDeckInPlay: v.devDeckInPlay,
    largestArmyInPlay: v.largestArmyInPlay,
    gold: v.gold >= 0 ? v.gold : undefined,
    prisoners: v.prisoners >= 0 ? v.prisoners : undefined,
    prisonersPerVp: v.prisonersPerVp,
    ridersOut: v.ridersOut >= 0 ? v.ridersOut : undefined,
    ridersPerSeat: v.ridersPerSeat,
    wagonLevel: v.wagonLevel >= 0 ? v.wagonLevel : undefined,
    deliveries: v.deliveries >= 0 ? v.deliveries : undefined,
    ships: v.ships >= 0 ? v.ships : undefined,
    missionVp: v.missionVp >= 0 ? v.missionVp : undefined,
    discardAt: v.discardAt || undefined,
    knights: v.knights
      ? {
          commodityCount: v.commodityCount,
          progressCount: v.progressCount,
          knightsActive: v.knightsActive,
          knightsTotal: v.knightsTotal,
          defenderVp: v.defenderVp,
          extraVp: v.extraVp,
          tracks: seatTracks(v.tracks),
        }
      : undefined,
  };

  return (
    <div
      ref={anchors?.ref(`seat:${seat}`)}
      data-seat-tile={seat}
      data-mine={mine ? "true" : undefined}
      data-active={v.active ? "true" : undefined}
      className={cn(
        // Your own seat uses the raised solid surface (`hud-surf-own`), others
        // the glass. The whose-turn ring is `.hud-seat[data-active]` in index.css.
        mine ? "hud-surf-own isolate" : GLASS,
        "hud-seat hud-pc relative shrink-0 overflow-hidden",
        "h-[var(--seat-panel-h)]",
        // The seat on the clock is solid as well as ringed, a third cue for
        // whose turn it is.
      )}
      style={{ ["--pc" as string]: data.color }}
      tabIndex={expandable ? 0 : undefined}
      onMouseEnter={expandable && canHover ? () => onOpen(seat) : undefined}
      onMouseLeave={expandable && canHover ? onClose : undefined}
      onFocus={expandable ? () => onOpen(seat) : undefined}
      onBlur={expandable ? onClose : undefined}
    >
      {/* The solid half of the glass/solid swap, faded on the same 150ms as the
          card's border and wash so the transition stays in step. Painted behind
          the content but in front of GLASS's background: `isolate` comes with
          GLASS, and a negative-z child of a stacking context lands there. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 -z-10 bg-secondary-background",
          "transition-opacity duration-150 motion-reduce:transition-none",
          v.active ? "opacity-100" : "opacity-0",
        )}
      />
      {/* The clock has its own strip, reserved at every tier whether or not this
          seat is on it, inside the card's border (which marks whose turn it
          is). Reserving it always keeps the panels a fixed size.

          The card is stretched to the full declared height, so the strip sits
          at the same place on every seat. */}
      <PlayerCard
        p={data}
        density={density}
        variant={variant}
        memory={memory}
        tab={drawnKind ? <LastDrawnTab kind={drawnKind} id={drawnId} /> : undefined}
        className={fill ? "h-full squat:w-full" : "h-full"}
        footer={
          <div className="px-0.5" style={{ height: SEAT_TIMER_H }}>
            <SeatTimerBar remainingMs={v.deadlineMs} budgetMs={v.budgetMs} frozen={frozen} />
          </div>
        }
      />
      {expandable && expanded && (
        <div
          className={cn(
            GLASS,
            "absolute z-20 w-[250px] p-2",
            "lg:left-[calc(100%+0.5rem)] lg:top-[-0.5rem] max-lg:top-[calc(100%+0.5rem)] max-lg:left-0",
          )}
        >
          {/* At `full` density and the game's own variant, so the expanded card
              shows the improvement tracks in a Knights game. Its height is its
              content here (no declared panel). */}
          <PlayerCard
            p={data}
            variant={variant}
            memory={memory}
            footer={
              v.deadlineMs != null ? (
                <TileCountdown deadlineMs={v.deadlineMs} budgetMs={v.budgetMs} frozen={frozen} />
              ) : null
            }
          />
        </div>
      )}
    </div>
  );
});

/**
 * A seat's three improvement tracks at one line of the compact rail: three
 * five-segment bars stacked, in TRACK_ROW order and commodity ink, like the
 * full card's track row at a quarter of the height. The title names the levels
 * in words.
 */
function MiniTracks({ tracks }: { tracks: string }) {
  const rows = seatTracks(tracks);
  const title = formatList(
    rows.map((r) => {
      const { name, level } = r;
      return t({
        message: `${name} ${level}/5`,
        context: "improvement track and its level out of 5",
      });
    }),
  );
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      data-mini-tracks
      className="flex w-[20px] flex-col gap-[2px]"
    >
      {rows.map((r) => (
        <span key={r.track} className="flex gap-px">
          {Array.from({ length: 5 }).map((_, j) => (
            <span
              key={j}
              className="h-[3px] flex-1 rounded-[1px]"
              style={{ background: j < r.level ? r.pipColor : "var(--color-line)" }}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * One opponent as a single line (the compact rail, 7 to 10 seats): colour,
 * name, the hand as a fan of backs and a count, the face-down deck, and the
 * score. At a big table the glance question is who is close and who holds a
 * lot; the rest is a hover away.
 */
const CompactSeatRow = React.memo(function CompactSeatRow({
  seat,
  narrow = false,
  tracks = false,
  memory,
  chrome,
  anchors,
  frozen,
}: {
  seat: number;
  /**
   * The sideways phone's closed rail (SQUAT_RAIL_W): name, hand and score.
   * Everything else is one tap away on the opened rail.
   */
  narrow?: boolean;
  /** Knights with the table's improvement tracks shown: a mini readout of all three. */
  tracks?: boolean;
  memory: boolean;
  chrome: SeatChrome;
  anchors?: HudAnchors;
  frozen: boolean;
}) {
  const sel = React.useCallback((s: State) => selectSeat(liveView(s), seat), [seat]);
  const v = useGameSocket(sel, shallowEqual);
  if (!v.present) return null;
  const name = chrome.label(seat, v.viewName);
  const cards = v.handCount + (v.knights ? v.commodityCount : 0);
  const over = v.discardAt > 0 && cards > v.discardAt;
  const deck = v.knights ? v.progressCount : v.devCount;
  const handTitle = v.knights ? i18n._(msg`Cards in hand`) : i18n._(msg`Resource cards`);
  const deckTitle = v.knights ? i18n._(msg`Progress cards`) : i18n._(msg`Development cards`);
  const vpTitle = i18n._(
    msg({ message: `${v.vp} VP`, context: "compact seat row: a seat's score" }),
  );
  return (
    <div
      ref={anchors?.ref(`seat:${seat}`)}
      data-seat-row={seat}
      data-active={v.active ? "true" : undefined}
      className={cn(
        "hud-crow hud-pc relative grid h-[30px] items-center overflow-hidden rounded-[7px] px-2 text-[13px]",
        // The track cell costs the name ~26px, so tighter gaps give some back.
        narrow
          ? // eslint-disable-next-line shadcn/no-arbitrary-values -- a grid template: the narrow line's three cells beside the dot, no token is a track list
            "gap-1 grid-cols-[10px_minmax(0,1fr)_auto_20px]"
          : tracks
            ? "gap-1 grid-cols-[10px_minmax(0,1fr)_auto_auto_auto_22px]"
            : "gap-1.5 grid-cols-[10px_minmax(0,1fr)_auto_auto_24px]",
      )}
      style={{ ["--pc" as string]: chrome.color(seat) }}
    >
      <span
        aria-hidden
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: chrome.color(seat) }}
      />
      <span className="min-w-0 truncate font-medium">
        <DecoratedName decoration={chrome.decoration(seat)}>{name}</DecoratedName>
      </span>
      {memory ? (
        <>
          <span />
          {!narrow && <span />}
          {tracks && <span />}
          <span />
        </>
      ) : (
        <>
          <Stat
            className="h-6 px-0.5 text-[12px] [&>span:last-child]:min-w-[2ch]"
            // The narrow line's glyph is one card wide: the fan grows with the
            // hand and was the widest thing on a 168px row.
            icon={narrow ? <Icons.hand size={13} /> : <CardFan n={cards} />}
            value={cards}
            title={handTitle}
            hot={over}
          />
          {!narrow && (
            <Stat
              className="h-6 px-0.5 text-[12px] [&>span:last-child]:min-w-[2ch]"
              icon={<Icons.devCard size={13} />}
              value={deck}
              title={deckTitle}
            />
          )}
          {tracks && <MiniTracks tracks={v.tracks} />}
          <span
            role="img"
            aria-label={vpTitle}
            title={vpTitle}
            className="text-right text-[15px] font-semibold font-num tabular-nums"
          >
            {v.vp}
          </span>
        </>
      )}
      {v.active && (
        <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px]">
          <SeatTimerBar remainingMs={v.deadlineMs} budgetMs={v.budgetMs} frozen={frozen} />
        </span>
      )}
    </div>
  );
});

/**
 * The other seats in turn order, starting from the one after `viewer` and
 * wrapping. `seats` is ascending, which is turn order.
 */
export function opponentsAfter(seats: number[], viewer: number): number[] {
  const after = seats.filter((s) => s > viewer);
  const before = seats.filter((s) => s < viewer);
  return after.concat(before);
}

/**
 * The rail's own inputs: which seats exist, and whether cards carry the
 * improvement-track row (which sets the declared panel heights). Fixed for a
 * game, so this settles after the first frame.
 *
 * `tracks` is Knights and `show_improvements`, resolved here so the height
 * arithmetic and the card agree. Absent config means shown (older games).
 *
 * Primitives only (the seat list is a joined string), so the slice compares
 * equal between frames.
 */
export function selectRailShape(s: State): {
  seatKey: string;
  tracks: boolean;
  memory: boolean;
  viewer: number;
  counters: number;
} {
  const view = liveView(s);
  const seats = view ? view.players.map((p) => p.seat).sort((a, b) => a - b) : [];
  // The ruleset, not `ext.cak`, which appears on the first roll and would
  // re-tier the whole rail (and its panel heights) mid-game.
  const knights = !!view && gameCaps(view).hasImprovements;
  return {
    seatKey: seats.join(","),
    tracks: knights && (view?.config?.show_improvements ?? true),
    // Memory mode, resolved here too: it decides both what a card draws and how
    // tall its panel is, so both must come from one place. Absent config means
    // off.
    memory: !!view?.config?.memory_mode,
    // The viewer's own seat is pulled out of the stack and pinned to the foot
    // of the column. -1 for a spectator.
    viewer: view?.viewer ?? -1,
    // How many counters a full card draws, which sets the counter lines and so
    // the panel height. Answered from the caps the card gates on (see
    // seatCounterCount).
    counters: view ? seatCounterCount(gameCaps(view)) : 0,
  };
}

/**
 * The player rail: every seat, always open, down the left edge.
 *
 * A rectangle per seat carries a name and several numbers (hand size, dev
 * cards, who holds the +2s, time left) at a glance, side by side for
 * comparison. When space runs short the rail shows less per player rather than
 * fewer players (see lib/seatPanels).
 */
export const SeatRail = React.memo(function SeatRail({
  chrome,
  anchors,
  frozen,
  scrollRef,
  bottomInset = SEAT_RAIL_BOTTOM_INSET,
  top,
}: {
  chrome: SeatChrome;
  /**
   * The HUD anchor registry, so a card flying to a player has somewhere to
   * land. Keyed by seat. See lib/hudAnchors.
   */
  anchors?: HudAnchors;
  /** Game over: hold the timer bars where they stand rather than draining. */
  frozen: boolean;
  /**
   * The element that actually scrolls, so the screen can reveal the active
   * seat. The surrounding HUD cluster sizes to its content and never overflows,
   * so it can't be the target.
   */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * Room to leave below the rail, in layout pixels (see the zoom correction
   * below). Defaults to the edge inset; in the column layout the screen passes
   * the bottom row's measured height too, so the last seat stops above the hand
   * shelf. Measured by the screen, since the shelf's height depends on what the
   * viewer holds.
   */
  bottomInset?: number;
  /**
   * Where the rail's cluster sits from the top (the measured top row). Only
   * used to trigger a re-measure: the cluster moves when the top-row
   * measurement lands, a frame or more after mount, without any resize; a stale
   * measurement would overflow a short screen.
   */
  top?: number;
}) {
  // The rail's shape depends on a few things, all fixed for a game, so this
  // settles after the first frame; tiles answer for their own seats.
  const shape = useGameSocket(selectRailShape, shallowEqual);
  const seats = React.useMemo(
    () => (shape.seatKey ? shape.seatKey.split(",").map(Number) : []),
    [shape.seatKey],
  );
  /**
   * Your seat isn't stacked with the opponents. The opponents stack at the top
   * in turn order, and your own panel is pinned to the foot of the column on its
   * raised surface. A spectator has no seat, so the whole table stacks.
   *
   * The stack starts at the seat after yours and wraps, so the column reads as
   * one turn order with you at the foot: at seats A B C D, A sees B C D above A,
   * and C sees D A B above C. Ascending seat order is turn order (the engine
   * passes the turn to `(cur + 1) % players`).
   */
  const ownSeated = shape.viewer >= 0 && seats.includes(shape.viewer);
  const opponents = React.useMemo(
    () => (ownSeated ? opponentsAfter(seats, shape.viewer) : seats),
    [seats, ownSeated, shape.viewer],
  );

  // Measured: the rail's height depends on the viewport, safe-area insets and
  // the rest of the HUD.
  const [available, setAvailable] = React.useState(0);
  // Two elements: `hostRef` is the whole column, measured for its room;
  // `scrollerRef` is the opponents' stack inside it, which scrolls (and which
  // the screen scrolls to reveal the active seat). On the phone strip they are
  // the same element.
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const attachScroller = React.useCallback(
    (el: HTMLDivElement | null) => {
      scrollerRef.current = el;
      if (scrollRef) scrollRef.current = el;
    },
    [scrollRef],
  );
  // Used to clamp the column inside the window (so it scrolls rather than
  // running under the hand shelf) and for the height it stretches to, so your
  // own seat lands at its foot.
  //
  // Coalesced to one pass per frame (see lib/measure); only the settled value
  // matters, and the scheduler always measures the last event of a burst.
  useMeasure<number>({
    read: () => {
      const el = hostRef.current;
      if (!el || typeof ResizeObserver === "undefined") return SKIP;
      const rect = el.getBoundingClientRect();
      // index.css applies `zoom: 1.2` above 1700px: window.innerHeight is in
      // visual pixels while getBoundingClientRect is scaled. Measuring the scale
      // off this element captures whatever is in effect (zoom, transform, or
      // nothing).
      const zoom = el.offsetHeight ? rect.height / el.offsetHeight : 1;
      const room = (window.innerHeight - rect.top) / (zoom || 1);
      return railMaxHeight(room, bottomInset);
    },
    write: setAvailable,
    // The inset tracks the shelf, which changes during the game (dev cards
    // appear, the bank strip mounts) without any resize, so it is a dep: a new
    // inset re-subscribes, and useMeasure measures synchronously then.
    deps: [bottomInset, top],
  });

  const count = seats.length;
  // The variant is "does a card carry the tracks row", not "is this Knights":
  // a Knights table with the setting off is sized like a base table.
  const variant: SeatVariant = shape.tracks ? "knights" : "base";

  /**
   * The whole card at every size. A per-seat summary made reading the table a
   * series of open-read-close taps. The phone strip is horizontal, so full
   * cards cost length and the strip scrolls. `expandable` follows: a whole card
   * has nothing behind it.
   */
  const wide = useMediaQuery(COLUMN_LAYOUT_QUERY);

  /**
   * Except on the phone strip, which opens and closes as one. One press shows
   * or summarises the whole table, so there is no per-seat toll, and the closed
   * state gives back the top of a phone screen (four full cards across a 390px
   * strip take most of the room above the board).
   *
   * Closed by default (names and scores are the standing question); the choice
   * is remembered.
   */
  const [railOpen, setRailOpen] = React.useState(readRailOpen);
  const toggleRail = React.useCallback(() => {
    setRailOpen((v) => {
      writeRailOpen(!v);
      return !v;
    });
  }, []);
  // A sideways phone's card is 200-224px rather than 252, so it holds fewer
  // counters per line (see seatCounterGrid) and may need another line.
  const squat = useMediaQuery(SQUAT_QUERY);
  // Closed, a sideways phone's rail is one narrow line per seat; a tap anywhere
  // on it opens the desktop column. See `seatRailMode` for all cases.
  const mode = seatRailMode({ wide, squat, railOpen, count });
  const density: SeatDensity = mode.density;
  const counterRows = seatCounterGrid(shape.counters, squat).rows;

  /**
   * The gap between cards. Part of the column's pitch, so part of whether the
   * rail fits: `seatPanelGap` spends only spare room (see lib/seatPanels).
   *
   * Measured against the column only: below `lg` the element is a horizontal
   * strip, where `available` describes the wrong axis.
   */
  // The opponents get the column minus your own panel and the gap above it.
  const panelH = seatPanelHeight(density, variant, shape.memory, counterRows);
  const oppRoom = wide && available > 0 ? available - (ownSeated ? panelH + OWN_SEAT_GAP : 0) : 0;
  const gap = seatPanelGap(
    opponents.length,
    density,
    variant,
    Math.max(0, oppRoom),
    shape.memory,
    counterRows,
  );
  /**
   * Seven seats and up, opponents go to one line each (in the column only,
   * where nine whole panels would scroll): name, hand fan, face-down deck and
   * score. Your own panel stays whole. The phone strip has its own summary (see
   * `railOpen`).
   */
  const compact = mode.compact;
  const narrow = mode.narrow;

  // A column question only. The strip below lg runs off the side, so this sum
  // would exceed `available` on any phone and light a vertical fade on a box
  // that doesn't scroll vertically.
  const overflows =
    wide &&
    oppRoom > 0 &&
    (compact
      ? opponents.length * COMPACT_ROW_H + 8
      : seatRailHeight(opponents.length, density, variant, gap, shape.memory, counterRows)) >
      oppRoom;

  /**
   * Which end still has a seat past it, not just whether the rail scrolls: a
   * rail at its top has nothing above it to fade.
   *
   * The 4px slack absorbs sub-pixel scroll positions (trackpads, smooth
   * `scrollIntoView`), or the top fade flickers at scrollTop 0.5.
   */
  const [ends, setEnds] = React.useState({ top: false, bottom: false });
  const readEnds = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return SKIP;
    return {
      top: el.scrollTop > 4,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 4,
    };
  }, []);
  const applyEnds = React.useCallback((next: { top: boolean; bottom: boolean }) => {
    setEnds((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
  }, []);
  // Through the shared frame-coalesced pass: a resize changes which ends have
  // content past them without a scroll. `equals` is pinned false, as in
  // ScrollFade, because scrolling writes the same state outside the scheduler;
  // `applyEnds` bails on an unchanged pair instead.
  useMeasure<{ top: boolean; bottom: boolean }>({
    read: readEnds,
    write: applyEnds,
    equals: () => false,
  });
  // Scrolling doesn't wait for the scheduler: it already fires per frame, and
  // the fade must track without lag. A scroll within one end costs a layout read
  // and no render.
  const onScroll = React.useCallback(() => {
    const next = readEnds();
    if (next !== SKIP) applyEnds(next);
  }, [readEnds, applyEnds]);
  // And after every render: `available` landing a frame after mount can clamp
  // the rail into overflowing with neither a scroll nor a resize.
  React.useLayoutEffect(() => {
    const next = readEnds();
    if (next !== SKIP) applyEnds(next);
  });

  // Per-seat open state, still taken by SeatTile, though every card is now
  // whole at every size.
  const [open, setOpen] = React.useState<number | null>(null);
  const canHover = useMediaQuery("(hover: hover)");
  /**
   * Nothing to open per seat: the small tier's detail is revealed by opening
   * the whole strip, not one seat at a time.
   */
  const expandable = false;
  // Stable handlers, so opening one card can't re-render the other nine.
  const onOpen = React.useCallback((seat: number) => setOpen(seat), []);
  const onClose = React.useCallback(() => setOpen(null), []);

  const tile = (seat: number, mine = false, fill = false) => (
    <SeatTile
      key={seat}
      seat={seat}
      mine={mine}
      fill={fill}
      density={density}
      variant={variant}
      memory={shape.memory}
      chrome={chrome}
      anchors={anchors}
      frozen={frozen}
      expandable={expandable}
      expanded={open === seat}
      onOpen={onOpen}
      onClose={onClose}
      canHover={canHover}
    />
  );
  const fade = overflows
    ? {
        ["--scroll-fade-top" as string]: ends.top ? "12px" : "0px",
        ["--scroll-fade-bottom" as string]: ends.bottom ? "12px" : "0px",
      }
    : {};
  const panelVar = { ["--seat-panel-h" as string]: `${panelH}px` };

  /**
   * Tap the players to see more of them, as one control for the whole table:
   * the portrait strip's gesture, and the sideways-phone column's (one narrow
   * line per seat until opened). The role and key handler keep it keyboard
   * reachable; nothing inside is interactive.
   */
  const toggleProps = {
    role: "button",
    tabIndex: 0,
    "aria-expanded": railOpen,
    "aria-label": railOpen
      ? i18n._(msg({ message: "Show less about each player", context: "seat strip" }))
      : i18n._(msg({ message: "Show more about each player", context: "seat strip" })),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      // Space scrolls a scroll container by default, and this is one.
      e.preventDefault();
      toggleRail();
    },
    onClick: toggleRail,
  } as const;

  if (wide) {
    return (
      <div
        ref={hostRef}
        data-density={density}
        data-rail={narrow ? "narrow" : compact ? "compact" : "full"}
        {...(squat ? toggleProps : null)}
        className={cn("flex flex-col", squat && "cursor-pointer")}
        style={{
          ...panelVar,
          // Stretched to the room it has, so your own panel lands at the foot;
          // capped at it, so nothing runs under the shelf.
          ...(available > 0 ? { maxHeight: available } : {}),
          ...(available > 0 && ownSeated ? { height: available } : {}),
        }}
      >
        <div
          ref={attachScroller}
          onScroll={onScroll}
          className={cn(
            "flex min-h-0 shrink flex-col overflow-y-auto no-scrollbar",
            // Show when a seat is off the end, rather than clipping silently.
            overflows && "scroll-fade-y",
          )}
          style={{ rowGap: `${gap}px`, ...fade }}
        >
          {compact ? (
            <div
              className={cn(
                GLASS,
                "flex shrink-0 flex-col gap-px p-1",
                narrow ? SQUAT_RAIL_WIDTH : "w-[252px]",
              )}
            >
              {opponents.map((seat) => (
                <CompactSeatRow
                  key={seat}
                  seat={seat}
                  narrow={narrow}
                  tracks={shape.tracks && !narrow}
                  memory={shape.memory}
                  chrome={chrome}
                  anchors={anchors}
                  frozen={frozen}
                />
              ))}
            </div>
          ) : (
            opponents.map((seat) => tile(seat))
          )}
        </div>
        {ownSeated && (
          <>
            {/* The separation: at least a clear gap, plus any spare column
                height. */}
            <div aria-hidden className="flex-1" style={{ minHeight: OWN_SEAT_GAP }} />
            {narrow ? (
              <div className={SQUAT_RAIL_WIDTH}>{tile(shape.viewer, true, true)}</div>
            ) : (
              tile(shape.viewer, true, compact)
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={(el) => {
        hostRef.current = el;
        attachScroller(el);
      }}
      data-density={density}
      style={{
        ...panelVar,
        // Two gaps, one per orientation: `row-gap` applies as a column,
        // `column-gap` as a row.
        rowGap: `${gap}px`,
        columnGap: `${SEAT_STRIP_GAP}px`,
        ...(available > 0 ? { maxHeight: available } : {}),
      }}
      onScroll={onScroll}
      // Tap the players to see more of them. Bound to the whole strip, the
      // biggest target on screen, and only where it is a strip (from `lg` the
      // element is the always-whole desktop column).
      //
      // The role and key handler keep it keyboard accessible (a 900px desktop
      // window is a narrow strip). Safe as a `button` because nothing inside is
      // interactive.
      {...toggleProps}
      className={cn(
        "flex cursor-pointer flex-row overflow-x-auto",
        // The row may fill the viewport less the cluster's inset on each side,
        // read from the variable the cluster sets.
        "max-w-[calc(100vw-var(--hud-inset,0.5rem)*2)]",
        "no-scrollbar",
      )}
    >
      {/* Your own seat first on the strip, set apart by a wider gap (the strip's
          version of the column's foot). First, not last, because the strip
          scrolls to reveal whoever is on the clock, and a seat at the far end
          would drag every opponent off screen on your turn. */}
      {ownSeated && (
        <>
          {tile(shape.viewer, true)}
          <span aria-hidden className="w-1.5 shrink-0" />
        </>
      )}
      {opponents.map((seat) => tile(seat))}
    </div>
  );
});
