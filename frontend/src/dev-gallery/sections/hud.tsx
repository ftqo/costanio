// Gallery section: the in-game HUD's building blocks, rendered with the real
// components and the real stylesheet. See ../spec.tsx.
//
// Several HUD components read the session socket store (`gameSocket`) rather
// than props: the bank, the discard limit, the barbarian rail, the seat rail,
// the turn-timer edge, the compact bank pill. That store is a singleton, so
// this section ingests ONE fixture view on mount (a 4-seat Knights game,
// viewer seat 0, seat 2 on the clock) and those components show that one
// state. `?seats=8` swaps in an 8-seat table, which turns the opponents in the
// seat rail into compact rows.
import * as React from "react";
import { cn } from "@/lib/utils";
import { Group, State, Break } from "../spec";
import { gameSocket } from "@/lib/ws";
import type { FullView } from "@/lib/types";
import type { GameEvent } from "@/lib/gamestate";
import { RES, COMMOD, COMMOD_ROW, resIconSlot, comIconSlot } from "@/lib/cardFace";
import { COST } from "@/lib/costs";
import { seatColor } from "@/lib/hexgeo";
import { dockDieSize, parkedDieSize, SQUAT_DIE_SIZE } from "@/lib/hudChrome";
import { handStack } from "@/lib/handStack";
import { progressSlot, progressDeckLook } from "@/lib/progressCards";
import { usePieceThumbnails } from "@/lib/usePieceThumbnails";
import { usePieceIcons } from "@/lib/usePieceIcons";
import { useStickyScroll } from "@/lib/stickyScroll";
import { CardFace, ResIcon } from "@/components/asset/AssetParts";
import {
  ResCard,
  StackBacks,
  ShopTile,
  ShopArt,
  DeckChoiceTile,
  CostRow,
  RecipeCards,
  CommitPill,
  HoldPill,
  ShelfDivider,
  EventLogFeed,
  DiceDisplay,
  ChatBar,
  UpgradeChevron,
  MetropolisMark,
} from "@/routes/Game";
import { PlayerCard, type PlayerCardData, type TrackInfo } from "@/components/game/PlayerCard";
import { Stat, Award } from "@/components/game/Stat";
import { TrackPips } from "@/components/game/TrackPips";
import { CostChips } from "@/components/game/CostChips";
import { DecisionClockView } from "@/components/game/DecisionClock";
import { ChatText } from "@/components/game/ChatText";
import { SeatChoice, SeatChoiceRow } from "@/components/game/SeatChoice";
import { PieceChoice } from "@/components/game/PieceChoice";
import { RobberGlyph } from "@/components/game/moduleGlyphs";
import { Icons, CardFan } from "@/components/game/hudIcons";
import { Die, EventDie } from "@/components/board/Die";
import { HudButton } from "@/components/game/hud/HudButton";
import { GlassPanel, HudOrb, HudLabel } from "@/components/game/hud/HudLayer";
import { UtilityOrbs, TopPanelOrb } from "@/components/game/hud/UtilityOrbs";
import { ThemeOrb } from "@/components/game/hud/ThemeOrb";
import { ExplainOrb } from "@/components/game/hud/ExplainOrb";
import { DockPanels, DOCK_PILL } from "@/components/game/hud/DockPanels";
import { SeatTimerBar } from "@/components/game/hud/SeatTimerBar";
import { TurnTimerEdge } from "@/components/game/hud/TurnTimerEdge";
import { TurnControls, DiceRow, EndTurnPill } from "@/components/game/hud/TurnControls";
import { TurnBanner } from "@/components/game/hud/TurnBanner";
import { BankRow, DefaultRateChip, DiscardLimit } from "@/components/game/hud/TableStatus";
import { TableFeed } from "@/components/game/hud/TableFeed";
import { BarbarianRail } from "@/components/game/hud/BarbarianRail";
import { SeatRail, type SeatChrome } from "@/components/game/hud/SeatRail";
import { Bank, ChatCircle, Scroll, Question, UsersThree } from "@/lib/icons";

export const title = "Game HUD pieces";

const noop = () => {};
const NAMES = ["Ada", "Bram", "Cleo", "Dov", "Esme", "Finn", "Gus", "Hana", "Ivo", "Jun"];
const seatName = (s: number) => NAMES[s] ?? `Seat ${s}`;
const colorOf = (s: number) => seatColor(s);
const MY = colorOf(0);

/** A positioned, transformed box: `position: fixed` children are contained in it. */
function Contain({
  w,
  h,
  children,
  className,
}: {
  w: number;
  h: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-[8px]", className)}
      style={{ width: w, height: h, transform: "translateZ(0)", background: "var(--sea)" }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The store fixture
// ---------------------------------------------------------------------------

function fixtureView(seats: number): FullView {
  const vertex = { q: 0, r: 0, d: 0 } as never;
  const players = Array.from({ length: seats }, (_, s) => ({
    seat: s,
    hand_count: [9, 3, 11, 5, 2, 7, 4, 6, 1, 8][s] ?? 4,
    discard_at: s === 0 ? 9 : 7,
    hand: s === 0 ? [0, 1, 3, 0, 4, 1] : undefined,
    roads_left: 9,
    settlements_left: 3,
    cities_left: 2,
    dev_count: 0,
    knights_played: 0,
    route_length: [4, 2, 5, 7, 3, 1, 2, 3, 4, 2][s] ?? 2,
    vp: [6, 4, 8, 5, 3, 4, 5, 6, 2, 7][s] ?? 3,
  }));
  const knight = (owner: number, level: number, active: boolean) => ({
    v: vertex,
    owner,
    level,
    active,
    freshly_activated: false,
    promoted_this_turn: false,
  });
  return {
    seq: 100,
    viewer: 0,
    config: {
      players: seats,
      target_vp: 13,
      discard_limit: 7,
      turn_timer_sec: 60,
      ruleset: "base+cak",
      show_bank: true,
      show_improvements: true,
    },
    phase: "play",
    cur: 2,
    rolled: true,
    board: {} as never,
    bank: [0, 19, 0, 12, 3, 8],
    players,
    buildings: [0, 1, 2, 3].map((o) => ({ v: vertex, owner: o, city: true })),
    roads: [],
    dev_deck_count: 0,
    longest_road: 3,
    largest_army: -1,
    winner: -1,
    bank_ratios: [0, 4, 2, 4, 4, 4],
    good_ratios: { cloth: 4, paper: 4, coin: 4 },
    seat_deadlines: { 0: 45_000, 2: 8_000 },
    seat_budgets: { 0: 60_000, 2: 60_000 },
    seat_names: Object.fromEntries(Array.from({ length: seats }, (_, s) => [s, NAMES[s]])),
    ext: {
      cak: {
        players: Array.from({ length: seats }, (_, s) => ({
          commodity_count: s === 0 ? 2 : s === 2 ? 3 : 0,
          commodities: s === 0 ? [1, 1, 0] : undefined,
          improve: s === 0 ? [2, 0, 1] : s === 2 ? [5, 3, 0] : s === 3 ? [1, 1, 1] : [0, 0, 0],
          progress_count: s === 2 ? 2 : 0,
          metropolis: s === 2 ? [true, false, false] : [false, false, false],
          metropolis_at: [vertex, vertex, vertex],
          walls: s === 0 ? 1 : 0,
          defender_vp: s === 2 ? 1 : 0,
          merchant_vp: 0,
          extra_vp: s === 2 ? 1 : 0,
        })),
        knights: [knight(0, 1, true), knight(2, 2, true), knight(3, 1, false)],
        commodity_supply: [12, 0, 7],
        barbarians: 4,
        attacks: 0,
        decks: [12, 9, 0],
      },
    },
  } as unknown as FullView;
}

/** Ingest the fixture once the section mounts, and render store readers after. */
function useFixture(): boolean {
  const [ready, setReady] = React.useState(false);
  React.useLayoutEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get("seats")) || 4;
    const v = fixtureView(Math.min(10, Math.max(2, n)));
    gameSocket.ingest({ t: "state", game: "gallery", seq: v.seq, full: v } as never);
    setReady(true);
  }, []);
  return ready;
}

// ---------------------------------------------------------------------------
// Resource cards
// ---------------------------------------------------------------------------

const GOODS = [
  ...RES.map((r) => ({ key: r.key, name: r.name, color: r.color, slot: resIconSlot(r.idx) })),
  ...COMMOD_ROW.map((c) => ({
    key: c.key,
    name: c.name,
    color: c.color,
    slot: comIconSlot(c.idx),
  })),
];
const card = (i: number) => ({ color: GOODS[i].color, name: GOODS[i].name, slot: GOODS[i].slot });
const WHEAT = card(3);
const ORE = card(4);

function ResCardGroups() {
  return (
    <>
      {(["sm", "lg", "hand"] as const).map((size) => (
        <Group
          key={size}
          id={`hud/res-card-${size}`}
          title={`ResCard, size "${size}", every resource and commodity (countMode always, count 2)`}
          surface="hud"
        >
          {GOODS.map((g, i) => (
            <State key={g.key} label={g.name}>
              <ResCard {...card(i)} count={2} size={size} />
            </State>
          ))}
        </Group>
      ))}
      <Group id="hud/res-card-countmode" title="ResCard countMode (size lg, wheat)" surface="hud">
        <State label="multi, count 1 (no badge)">
          <ResCard {...WHEAT} count={1} countMode="multi" size="lg" />
        </State>
        <State label="multi, count 2 (×2)">
          <ResCard {...WHEAT} count={2} countMode="multi" size="lg" />
        </State>
        <State label="always, count 0">
          <ResCard {...WHEAT} count={0} countMode="always" size="lg" />
        </State>
        <State label="always, count 4">
          <ResCard {...WHEAT} count={4} countMode="always" size="lg" />
        </State>
        <State label="positive, count 0 (no badge)">
          <ResCard {...WHEAT} count={0} countMode="positive" size="lg" />
        </State>
        <State label="positive, count 3">
          <ResCard {...WHEAT} count={3} countMode="positive" size="lg" />
        </State>
        <State label="no count">
          <ResCard {...WHEAT} size="lg" />
        </State>
      </Group>
      <Group
        id="hud/res-card-stack"
        title="ResCard countMode stack (hand size): the pile is drawn, one back per copy"
        surface="hud"
      >
        {[1, 2, 4, 9].map((n) => (
          <State key={n} label={`stack, count ${n}`}>
            <ResCard {...ORE} count={n} countMode="stack" size="hand" onClick={noop} />
          </State>
        ))}
        <State label="stack, count 0, dimmed">
          <ResCard {...ORE} count={0} countMode="stack" size="hand" dimmed onClick={noop} />
        </State>
        <State label="stack, count 3, disabled (not your turn)">
          <ResCard {...ORE} count={3} countMode="stack" size="hand" disabled onClick={noop} />
        </State>
        <State label="stack 3, discard pill 2">
          <ResCard
            {...ORE}
            count={3}
            countMode="stack"
            size="hand"
            onClick={noop}
            footer={<CommitPill n={2} tone="discard" onRemove={noop} />}
          />
        </State>
        <State label="StackBacks alone (3 backs)">
          <span
            className="relative block h-[96px] [--cw:68px]"
            style={{ width: "calc(68px * 1.4)" }}
          >
            <StackBacks layers={handStack(4).behind} className="hud-card-back" color={ORE.color} />
          </span>
        </State>
      </Group>
      <Group
        id="hud/res-card-states"
        title="ResCard interaction states (size lg, brick and sheep)"
        surface="hud"
      >
        <State label="static (span, no onClick)">
          <ResCard {...card(1)} count={2} size="lg" />
        </State>
        <State label="interactive, rest">
          <ResCard {...card(1)} count={2} size="lg" onClick={noop} />
        </State>
        <State label="interactive, hover" force="hover">
          <ResCard {...card(1)} count={2} size="lg" onClick={noop} />
        </State>
        <State label="interactive, active" force="active">
          <ResCard {...card(1)} count={2} size="lg" onClick={noop} />
        </State>
        <State label="interactive, focus-visible" force="focus-visible">
          <ResCard {...card(1)} count={2} size="lg" onClick={noop} />
        </State>
        <State label="selected (picker ring)">
          <ResCard {...card(1)} count={2} size="lg" selected onClick={noop} />
        </State>
        <State label="dimmed (count 0)">
          <ResCard {...card(1)} count={0} size="lg" dimmed onClick={noop} />
        </State>
        <State label="disabled">
          <ResCard {...card(1)} count={2} size="lg" disabled onClick={noop} />
        </State>
        <State label="badge takes one back (onBadgeClick)">
          <ResCard
            {...card(1)}
            count={2}
            countMode="positive"
            size="lg"
            onClick={noop}
            onBadgeClick={noop}
          />
        </State>
        <Break />
        <State label="footer: CommitPill give (green)">
          <ResCard
            {...card(2)}
            count={3}
            size="lg"
            onClick={noop}
            footer={<CommitPill n={1} tone="give" onRemove={noop} />}
          />
        </State>
        <State label="footer: CommitPill discard (red)">
          <ResCard
            {...card(2)}
            count={3}
            size="lg"
            onClick={noop}
            footer={<CommitPill n={2} tone="discard" onRemove={noop} />}
          />
        </State>
        <State label="footer: HoldPill (hand still holds 4)">
          <div className="pb-3">
            <ResCard
              {...card(2)}
              count={1}
              countMode="positive"
              size="lg"
              onClick={noop}
              footer={<HoldPill n={4} />}
            />
          </div>
        </State>
        <State label="sm, dimmed">
          <ResCard {...card(2)} count={1} size="sm" dimmed />
        </State>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Development and progress cards. These tiles are inline JSX in Game.tsx's hand
// shelf, with no component to import, so the class strings below are copied
// from there verbatim.
// ---------------------------------------------------------------------------

const DEV_FRAME =
  "hud-card-frame relative w-11 h-[64px] sm:w-[68px] sm:h-[96px] squat:w-11 squat:h-[64px] overflow-hidden bg-panel flex items-center justify-center transition-transform";
const PROGRESS_FRAME =
  "hud-card-frame relative isolate overflow-hidden w-11 h-[64px] sm:w-[68px] sm:h-[96px] squat:w-11 squat:h-[64px] flex items-center justify-center text-center bg-panel text-[9px] sm:text-[10px] font-extrabold leading-[1.05] transition-transform";
const DEV_BADGE =
  "hud-badge absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] sm:text-[11px] font-extrabold tabular-nums leading-none";

function DevTile({
  slot,
  look = "playable",
  badge,
  warn,
}: {
  slot: string;
  look?: "playable" | "held" | "dim";
  badge?: string;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      aria-disabled={look !== "playable"}
      className={cn(
        DEV_FRAME,
        look === "held"
          ? "cursor-default ring-2 ring-inset ring-green"
          : look === "playable"
            ? "hud-lift cursor-pointer"
            : "grayscale opacity-60 cursor-default",
      )}
    >
      <CardFace slot={slot} className="block h-full w-full" />
      {badge && <span className={DEV_BADGE}>{badge}</span>}
      {warn && (
        <span
          aria-hidden
          className="absolute top-0.5 left-0.5 w-3.5 h-3.5 flex items-center justify-center rounded-full border-2 border-border bg-red text-main-foreground text-[8px] leading-none"
        >
          !
        </span>
      )}
    </button>
  );
}

function ProgressTile({
  card: id,
  playable = true,
  tucked,
}: {
  card: string;
  playable?: boolean;
  tucked?: boolean;
}) {
  const deck = progressDeckLook(id);
  return (
    <button
      type="button"
      aria-disabled={!playable}
      className={cn(
        PROGRESS_FRAME,
        playable ? "hud-lift cursor-pointer" : "cursor-default",
        tucked && "-ml-[22px] sm:-ml-[28px] squat:ml-0",
      )}
    >
      {deck && (
        <span
          role="img"
          aria-label={deck.aria}
          className="hud-deck-band"
          style={{ background: deck.color }}
        />
      )}
      <CardFace
        slot={progressSlot(id)}
        className={cn("block h-full w-full", !playable && "grayscale opacity-60")}
      />
    </button>
  );
}

const DEV_SLOTS = [
  ["devcard_knight", "Knight"],
  ["devcard_victorypoint", "Victory Point"],
  ["devcard_roadbuilding", "Road Building"],
  ["devcard_yearofplenty", "Year of Plenty"],
  ["devcard_monopoly", "Monopoly"],
  ["devcard_swiftjourney", "Swift Journey"],
  ["devcard_back", "Back"],
] as const;

function CardGroups() {
  const pile = handStack(3);
  return (
    <>
      <Group
        id="hud/dev-card-faces"
        title="Development card tiles (hud-card-frame + CardFace), every face"
        surface="hud"
      >
        {DEV_SLOTS.map(([slot, name]) => (
          <State key={slot} label={name}>
            <DevTile slot={slot} />
          </State>
        ))}
      </Group>
      <Group id="hud/dev-card-states" title="Development card tile states (Knight)" surface="hud">
        <State label="playable, rest">
          <DevTile slot="devcard_knight" />
        </State>
        <State label="playable, hover" force="hover">
          <DevTile slot="devcard_knight" />
        </State>
        <State label="playable, focus-visible" force="focus-visible">
          <DevTile slot="devcard_knight" />
        </State>
        <State label="can't play (grey, faded)">
          <DevTile slot="devcard_knight" look="dim" />
        </State>
        <State label="Victory Point, held (green ring)">
          <DevTile slot="devcard_victorypoint" look="held" />
        </State>
        <State label="count badge 2">
          <DevTile slot="devcard_knight" badge="2" />
        </State>
        <State label="split badge 1+1 (one bought this turn)">
          <DevTile slot="devcard_knight" badge="1+1" />
        </State>
        <State label="playable with warning mark">
          <DevTile slot="devcard_monopoly" warn />
        </State>
        <State label="pile of 3 (StackBacks behind)">
          <span
            className="relative inline-flex justify-end shrink-0 [--cw:44px] sm:[--cw:68px] squat:[--cw:44px]"
            style={{ width: `calc(var(--cw) * ${pile.width})` }}
          >
            <StackBacks layers={pile.behind} className="hud-card-back" />
            <DevTile slot="devcard_knight" badge="3" />
          </span>
        </State>
        <State label="pile of 3, can't play">
          <span
            className="relative inline-flex justify-end shrink-0 [--cw:44px] sm:[--cw:68px] squat:[--cw:44px]"
            style={{ width: `calc(var(--cw) * ${pile.width})` }}
          >
            <StackBacks layers={pile.behind} className="hud-card-back grayscale opacity-60" />
            <DevTile slot="devcard_knight" look="dim" badge="3" />
          </span>
        </State>
      </Group>
      <Group
        id="hud/progress-cards"
        title="Progress card tiles (hud-card-frame, hud-deck-band, CardFace with its title plate)"
        surface="hud"
      >
        <State label="Trade deck (Merchant Fleet), playable">
          <ProgressTile card="merchant_fleet" />
        </State>
        <State label="Politics deck (Bishop), playable">
          <ProgressTile card="bishop" />
        </State>
        <State label="Science deck (Crane), playable">
          <ProgressTile card="crane" />
        </State>
        <State label="playable, hover" force="hover">
          <ProgressTile card="alchemist" />
        </State>
        <State label="can't play (grey face, band kept)">
          <ProgressTile card="warlord" playable={false} />
        </State>
        <State label="stacked hand of 4 (each tucked under the last)">
          <span className="flex items-center">
            <ProgressTile card="alchemist" />
            <ProgressTile card="spy" tucked />
            <ProgressTile card="medicine" tucked />
            <ProgressTile card="wedding" tucked playable={false} />
          </span>
        </State>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Build tiles
// ---------------------------------------------------------------------------

const ENOUGH = [0, 5, 5, 5, 5, 5];
const SHORT = [0, 0, 1, 1, 0, 0];
const TRACK_NAME = ["Trade", "Politics", "Science"];
// Trade -> cloth, Politics -> coin, Science -> paper (indices into COMMOD).
const TRACK_COMMOD = [0, 2, 1];
const IMPROVE_SLOT = ["improve_trade", "improve_politics", "improve_science"];

function ShopGroups() {
  const thumbs = usePieceThumbnails(MY);
  const art = (slot: string) => <ShopArt slot={slot} thumbs={thumbs} />;
  const devArt = <CardFace slot="devcard_back" className="h-full w-full object-cover" />;
  const tiles: {
    id: string;
    name: string;
    label?: string;
    cost: Record<number, number>;
    art: React.ReactNode;
    showLeft?: boolean;
  }[] = [
    { id: "road", name: "Road", cost: COST.road, art: art("build_road") },
    {
      id: "settlement",
      name: "Settle­ment",
      cost: COST.settlement,
      art: art("build_settlement"),
    },
    { id: "city", name: "City", cost: COST.city, art: art("build_city") },
    {
      id: "dev",
      name: "Development Card",
      label: "Dev card",
      cost: COST.dev,
      art: devArt,
      showLeft: false,
    },
    { id: "ship", name: "Ship", cost: COST.ship, art: art("build_ship") },
    { id: "knight", name: "Knight", cost: COST.knight, art: art("build_knight") },
    { id: "wall", name: "Wall", cost: COST.wall, art: art("build_wall") },
  ];
  const plain = (n: string) => n.replace("­", "");
  return (
    <>
      <Group
        id="hud/shop-tile-kinds"
        title="ShopTile, every buildable, ready (affordable and legal), pieces left in the corner"
        surface="hud"
      >
        {tiles.map(({ id, ...tl }) => (
          <State key={id} label={plain(tl.name)}>
            <ShopTile {...tl} left={tl.showLeft === false ? 20 : 5} have={ENOUGH} onClick={noop} />
          </State>
        ))}
      </Group>
      {tiles.slice(0, 4).map(({ id, ...tl }) => (
        <Group
          key={id}
          id={`hud/shop-tile-${id}`}
          title={`ShopTile states: ${plain(tl.name)}`}
          surface="hud"
        >
          <State label="ready">
            <ShopTile {...tl} left={4} have={ENOUGH} onClick={noop} />
          </State>
          <State label="ready, hover (forced on the wrapper span, see report)" force="hover">
            <ShopTile {...tl} left={4} have={ENOUGH} onClick={noop} />
          </State>
          <State label="ready, focus-visible (forced on the wrapper span)" force="focus-visible">
            <ShopTile {...tl} left={4} have={ENOUGH} onClick={noop} />
          </State>
          <State label="selected (placing)">
            <ShopTile {...tl} left={4} have={ENOUGH} selected onClick={noop} />
          </State>
          <State label="short (missing cards underlined)">
            <ShopTile {...tl} left={4} have={SHORT} disabled onClick={noop} />
          </State>
          <State label="lock (affordable, not legal now)">
            <ShopTile {...tl} left={4} have={ENOUGH} disabled onClick={noop} />
          </State>
          <State label="out (0 left: red count, hatched)">
            <ShopTile {...tl} left={0} have={ENOUGH} disabled onClick={noop} />
          </State>
          {id === "road" && (
            <State label="free (Road Building)">
              <ShopTile {...tl} left={4} have={SHORT} free onClick={noop} />
            </State>
          )}
          <State label="no supply count (left omitted)">
            <ShopTile {...tl} have={ENOUGH} onClick={noop} />
          </State>
          <State label="no art: name only">
            <ShopTile name={tl.name} cost={tl.cost} have={ENOUGH} left={4} onClick={noop} />
          </State>
        </Group>
      ))}
      <Group
        id="hud/shop-tile-improve"
        title="ShopTile as a city-improvement track (Knights): pips strip, commodity price, corner mark"
        surface="hud"
      >
        {[
          {
            i: 2,
            lvl: 0,
            label: "Science, level 0, ready (chevron)",
            dis: false,
            metro: false,
            cost: 1,
            afford: true,
          },
          {
            i: 0,
            lvl: 2,
            label: "Trade, level 2, short (price underlined)",
            dis: true,
            metro: false,
            cost: 3,
            afford: false,
          },
          {
            i: 1,
            lvl: 3,
            label: "Politics, level 3, lock",
            dis: true,
            metro: false,
            cost: 4,
            afford: true,
          },
          {
            i: 0,
            lvl: 4,
            label: "Trade, level 4, metropolis (star)",
            dis: false,
            metro: true,
            cost: 5,
            afford: true,
          },
          {
            i: 1,
            lvl: 5,
            label: "Politics, level 5, maxed, metropolis",
            dis: true,
            metro: true,
            cost: 0,
            afford: true,
          },
          {
            i: 2,
            lvl: 0,
            label: "Science, Crane armed: Free, selected",
            dis: false,
            metro: false,
            cost: 0,
            afford: true,
            sel: true,
          },
        ].map((x) => {
          const com = COMMOD[TRACK_COMMOD[x.i]];
          const track = TRACK_NAME[x.i];
          return (
            <State key={x.label} label={x.label}>
              <ShopTile
                name={`${track}: level ${x.lvl} of 5`}
                label={track}
                disabled={x.dis}
                selected={x.sel}
                onClick={noop}
                badge={x.metro ? <MetropolisMark /> : x.dis ? undefined : <UpgradeChevron />}
                art={
                  <span className="relative block h-full w-full">
                    <span className="absolute inset-0 flex items-center justify-center">
                      <ShopArt slot={IMPROVE_SLOT[x.i]} thumbs={thumbs} />
                    </span>
                  </span>
                }
                strip={<TrackPips level={x.lvl} metropolis={x.metro} color={com.ink} size="tile" />}
                price={
                  x.lvl >= 5 ? null : x.cost === 0 ? (
                    <span className="text-[10.5px] font-semibold text-green-ink">Free</span>
                  ) : (
                    <span className="hud-cc hud-ic" data-short={x.afford ? undefined : "true"}>
                      <ResIcon slot={comIconSlot(com.idx)} size={15} />
                      {x.cost > 1 && <sub>{x.cost}</sub>}
                    </span>
                  )
                }
                recipe={
                  <ResCard
                    color={com.color}
                    name={com.name}
                    slot={comIconSlot(com.idx)}
                    count={x.cost}
                    countMode="multi"
                  />
                }
              />
            </State>
          );
        })}
      </Group>
      <Group
        id="hud/shop-tile-badge"
        title="ShopTile with a count badge and a recipe (scenario tiles: Fleet, Coins, Gold)"
        surface="hud"
      >
        <State label="badge 3, ready">
          <ShopTile
            name="Fleet"
            badge={<span className="font-num tabular-nums">3</span>}
            recipe={
              <span className="text-[10px] font-bold leading-tight">Sail, explore, deliver</span>
            }
            art={art("build_cargoship")}
            onClick={noop}
          />
        </State>
        <State label="badge 12, selected">
          <ShopTile
            name="Coins"
            selected
            badge={<span className="font-num tabular-nums">12</span>}
            recipe={
              <span className="text-[10px] font-bold leading-tight">
                Sell for coins, or buy with them
              </span>
            }
            art={art("scenario_coins")}
            onClick={noop}
          />
        </State>
        <State label="no badge, lock">
          <ShopTile
            name="Gold"
            disabled
            recipe={
              <span className="text-[10px] font-bold leading-tight">2 gold buys a resource</span>
            }
            art={art("scenario_gold")}
            onClick={noop}
          />
        </State>
      </Group>
      <Group id="hud/deck-choice-tile" title="DeckChoiceTile (pick a progress deck)" surface="hud">
        {[0, 1, 2].map((track) => (
          <State key={track} label={`${TRACK_NAME[track]}, 9 left`}>
            <DeckChoiceTile track={track} left={9} thumbs={thumbs} onPick={noop} />
          </State>
        ))}
        <State label="hover" force="hover">
          <DeckChoiceTile track={0} left={9} thumbs={thumbs} onPick={noop} />
        </State>
        <State label="focus-visible" force="focus-visible">
          <DeckChoiceTile track={0} left={9} thumbs={thumbs} onPick={noop} />
        </State>
        <State label="empty deck (0 left, disabled)">
          <DeckChoiceTile track={2} left={0} thumbs={thumbs} onPick={noop} />
        </State>
      </Group>
      <Group
        id="hud/cost-displays"
        title="Prices: CostRow (tile cost row), RecipeCards (tooltip recipe), CostChips"
        surface="hud"
      >
        <State label="CostRow city, affordable">
          <span className="flex w-[68px]">
            <CostRow cost={COST.city} have={ENOUGH} />
          </span>
        </State>
        <State label="CostRow city, short of wheat and ore">
          <span className="flex w-[68px]">
            <CostRow cost={COST.city} have={SHORT} />
          </span>
        </State>
        <State label="CostRow settlement, short of wood">
          <span className="flex w-[68px]">
            <CostRow cost={COST.settlement} have={SHORT} />
          </span>
        </State>
        <State label="RecipeCards settlement">
          <RecipeCards cost={COST.settlement} />
        </State>
        <State label="RecipeCards city (×2, ×3)">
          <RecipeCards cost={COST.city} />
        </State>
        <State label="CostChips city">
          <CostChips cost={COST.city} />
        </State>
        <State label="CostChips dev card, size 18">
          <CostChips cost={COST.dev} size={18} />
        </State>
      </Group>
      <Group
        id="hud/shelf-divider"
        title="ShelfDivider (rule between hand and tiles)"
        surface="hud"
      >
        <State label="inked (groups close)">
          <ShelfDivider gapPx={0} />
        </State>
        <State label="transparent (groups apart)">
          <ShelfDivider gapPx={400} />
        </State>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Seat panels
// ---------------------------------------------------------------------------

const trackInfo = (levels: number[], metro: boolean[]): TrackInfo[] =>
  [2, 0, 1].map((i) => ({
    name: TRACK_NAME[i],
    track: i,
    level: levels[i],
    metropolis: metro[i],
    nextCost: levels[i] + 1,
    pipColor: COMMOD[TRACK_COMMOD[i]].ink,
    commodity: COMMOD[TRACK_COMMOD[i]].key,
  }));

const BASE_CARD: PlayerCardData = {
  seat: 1,
  name: "Bram",
  color: colorOf(1),
  vp: 5,
  active: false,
  handCount: 4,
  devCount: 1,
  knightsPlayed: 1,
  routeLength: 4,
  longestRoad: false,
  longestRoadLabel: "ROAD",
  largestArmy: false,
  islandVp: 0,
  islands: false,
  discardAt: 7,
};

const KNIGHTS_CARD: PlayerCardData = {
  ...BASE_CARD,
  seat: 2,
  name: "Cleo",
  color: colorOf(2),
  vp: 8,
  devDeckInPlay: false,
  largestArmyInPlay: false,
  knights: {
    commodityCount: 3,
    progressCount: 2,
    knightsActive: 1,
    knightsTotal: 2,
    tracks: trackInfo([4, 2, 0], [true, false, false]),
    defenderVp: 1,
    extraVp: 1,
  },
};

/** A seat card's frame, as the rail's SeatTile draws it (glass, or the own-seat surface). */
function SeatFrame({
  children,
  mine,
  active,
  color,
}: {
  children: React.ReactNode;
  mine?: boolean;
  active?: boolean;
  color: string;
}) {
  return (
    <div
      data-active={active ? "true" : undefined}
      className={cn(
        mine ? "hud-surf-own isolate" : "hud-surf isolate",
        "hud-seat hud-pc relative w-[252px] shrink-0 overflow-hidden",
      )}
      style={{ ["--pc" as string]: color }}
    >
      {children}
    </div>
  );
}

function SeatGroups({ ready }: { ready: boolean }) {
  const timer = (ms: number | null, budget: number | null = 60_000) => (
    <div className="px-0.5" style={{ height: 4 }}>
      <SeatTimerBar remainingMs={ms} budgetMs={budget} frozen />
    </div>
  );
  const seat = (
    p: PlayerCardData,
    extra: Partial<React.ComponentProps<typeof PlayerCard>> = {},
  ) => (
    <SeatFrame mine={p.mine} active={p.active} color={p.color}>
      <PlayerCard p={p} {...extra} />
    </SeatFrame>
  );
  return (
    <>
      <Group
        id="hud/player-card-base"
        title="PlayerCard, base game, in a hud-seat frame as the rail's SeatTile draws it"
        surface="hud"
        wide
      >
        <State label="full, not active">{seat(BASE_CARD)}</State>
        <State label="full, active (their turn, 40s on the clock)">
          {seat({ ...BASE_CARD, active: true }, { footer: timer(40_000) })}
        </State>
        <State label="full, your own seat (mine)">
          {seat({ ...BASE_CARD, seat: 0, name: "Ada", color: MY, mine: true })}
        </State>
        <State label="full, holds Longest Road + Largest Army">
          {seat({
            ...BASE_CARD,
            longestRoad: true,
            largestArmy: true,
            routeLength: 7,
            knightsPlayed: 3,
            vp: 9,
          })}
        </State>
        <State label="full, hot: over the discard limit (10 cards vs 7)">
          {seat({ ...BASE_CARD, handCount: 10 })}
        </State>
        <State label="full, Islands: Longest Trade Route + island VP">
          {seat({
            ...BASE_CARD,
            islands: true,
            islandVp: 2,
            longestRoadLabel: "ROUTE",
            longestRoad: true,
          })}
        </State>
        <State label="micro density">{seat(BASE_CARD, { density: "micro" })}</State>
        <State label="micro density, active">
          {seat({ ...BASE_CARD, active: true }, { density: "micro" })}
        </State>
        <State label="memory mode (no score, no counters)">
          {seat({ ...BASE_CARD, longestRoad: true }, { memory: true })}
        </State>
      </Group>
      <Group
        id="hud/player-card-knights"
        title="PlayerCard, Knights variant (track row)"
        surface="hud"
        wide
      >
        <State label="full, knights, metropolis on Trade, defender + kept VP">
          {seat(KNIGHTS_CARD, { variant: "knights" })}
        </State>
        <State label="full, knights, active (8s, red), over limit (hot)">
          {seat(
            { ...KNIGHTS_CARD, active: true, handCount: 6 },
            { variant: "knights", footer: timer(8_000) },
          )}
        </State>
        <State label="full, knights, nothing improved">
          {seat(
            {
              ...KNIGHTS_CARD,
              knights: {
                ...KNIGHTS_CARD.knights!,
                tracks: trackInfo([0, 0, 0], [false, false, false]),
                defenderVp: 0,
                extraVp: 0,
              },
            },
            { variant: "knights" },
          )}
        </State>
        <State label="micro, knights">
          {seat(KNIGHTS_CARD, { density: "micro", variant: "knights" })}
        </State>
      </Group>
      <Group
        id="hud/player-card-modules"
        title="PlayerCard with scenario counters"
        surface="hud"
        wide
      >
        <State label="Fishermen: fish 3, holds the old boot">
          {seat({ ...BASE_CARD, fishermen: true, fish: 3, hasBoot: true })}
        </State>
        <State label="Rivers: 7 coins, Wealthiest Settler">
          {seat({ ...BASE_CARD, rivers: true, coins: 7, wealthiest: true, poorestInPlay: true })}
        </State>
        <State label="Rivers: Poorest Settler (penalty)">
          {seat({ ...BASE_CARD, rivers: true, coins: 0, poorest: true, poorestInPlay: true })}
        </State>
        <State label="Harbormaster: 3 of 3, holds the card">
          {seat({
            ...BASE_CARD,
            harbormaster: true,
            harbourPoints: 3,
            hasHarbormaster: true,
            harbourThreshold: 3,
          })}
        </State>
        <State label="Caravans: camel VP 2">
          {seat({ ...BASE_CARD, caravans: true, camelVp: 2 })}
        </State>
        <State label="Raiders: gold 4, prisoners 3, riders 2 of 6">
          {seat({
            ...BASE_CARD,
            devDeckInPlay: false,
            largestArmyInPlay: false,
            gold: 4,
            prisoners: 3,
            prisonersPerVp: 2,
            ridersOut: 2,
            ridersPerSeat: 6,
          })}
        </State>
        <State label="Wagons: level 3, 2 deliveries, gold 5">
          {seat({ ...BASE_CARD, longestRoadInPlay: false, wagonLevel: 3, deliveries: 2, gold: 5 })}
        </State>
        <State label="Explorers: 2 ships, mission VP 3, gold 1">
          {seat({
            ...BASE_CARD,
            devDeckInPlay: false,
            largestArmyInPlay: false,
            ships: 2,
            missionVp: 3,
            gold: 1,
          })}
        </State>
      </Group>
      <Group id="hud/stat" title="Stat (seat counter) and its states" surface="hud">
        <State label="rest">
          <Stat icon={<Icons.hand />} value={4} title="Resource cards" />
        </State>
        <State label="hover" force="hover">
          <Stat icon={<Icons.hand />} value={4} title="Resource cards" />
        </State>
        <State label="focus-visible" force="focus-visible">
          <Stat icon={<Icons.hand />} value={4} title="Resource cards" />
        </State>
        <State label="with tone colour">
          <Stat
            icon={<Icons.knight size={13} />}
            value="1/2"
            title="Knights"
            tone="var(--color-red-ink)"
          />
        </State>
        <State label="in a hud-chip (as PlayerCard draws it)">
          <Stat
            icon={<Icons.road size={13} />}
            value={7}
            title="Route"
            className="hud-chip h-6.5 px-0.5 gap-0.5"
          />
        </State>
        <State label="hud-chip, hot (data-hot)">
          <Stat
            icon={<CardFan n={4} />}
            value={10}
            title="Cards"
            className="hud-chip h-6.5 px-0.5 gap-0.5"
            hot
          />
        </State>
      </Group>
      <Group id="hud/award" title="Award chip" surface="hud">
        <State label="held (Longest Road, +2)">
          <Award icon={<Icons.road size={13} />} label="+2" title="Longest Road" name="road" />
        </State>
        <State label="not held (dashed)">
          <Award
            icon={<Icons.road size={13} />}
            label="+2"
            title="Longest Road"
            name="road"
            held={false}
          />
        </State>
        <State label="held, Largest Army">
          <Award icon={<Icons.knight size={13} />} label="+2" title="Largest Army" name="army" />
        </State>
        <State label="held, with caption (Defender)">
          <Award
            icon={<Icons.defender size={13} />}
            caption="Defender"
            label="1"
            title="Defender of the realm"
          />
        </State>
        <State label="held, penalty (Poorest Settler)">
          <Award icon={<Icons.coin size={13} />} label="-2" title="Poorest Settler" penalty />
        </State>
        <State label="hover" force="hover">
          <Award icon={<Icons.road size={13} />} label="+2" title="Longest Road" />
        </State>
        <State label="focus-visible" force="focus-visible">
          <Award icon={<Icons.road size={13} />} label="+2" title="Longest Road" />
        </State>
      </Group>
      <Group id="hud/track-pips" title="TrackPips (improvement level)" surface="hud">
        {[0, 1, 3, 5].map((lvl) => (
          <State key={lvl} label={`card size, level ${lvl}`}>
            <span className="flex w-[60px]">
              <TrackPips level={lvl} metropolis={false} color={COMMOD[0].ink} />
            </span>
          </State>
        ))}
        <State label="card, level 4, metropolis (stealable: dashed)">
          <span className="flex w-[60px]">
            <TrackPips level={4} metropolis color={COMMOD[2].ink} />
          </span>
        </State>
        <State label="card, level 5, metropolis (permanent: solid)">
          <span className="flex w-[60px]">
            <TrackPips level={5} metropolis color={COMMOD[1].ink} />
          </span>
        </State>
        <State label="tile size, level 2">
          <span className="flex w-[60px]">
            <TrackPips level={2} metropolis={false} color={COMMOD[1].ink} size="tile" />
          </span>
        </State>
      </Group>
      <Group
        id="hud/seat-timer-bar"
        title="SeatTimerBar, frozen (tiers: green above 30s, yellow, red at 10s or less)"
        surface="hud"
      >
        {(
          [
            ["full (60s of 60s), green", 60_000],
            ["half (30s), yellow", 30_000],
            ["low (8s), red", 8_000],
            ["empty (0s), red", 0],
          ] as const
        ).map(([label, ms]) => (
          <State key={label} label={label}>
            <div className="relative h-2 w-[200px] overflow-hidden rounded-full border border-border">
              <SeatTimerBar remainingMs={ms} budgetMs={60_000} frozen />
            </div>
          </State>
        ))}
        <State label="no budget: static full bar">
          <div className="relative h-2 w-[200px] overflow-hidden rounded-full border border-border">
            <SeatTimerBar remainingMs={45_000} budgetMs={null} frozen />
          </div>
        </State>
      </Group>
      <Group
        id="hud/decision-clock"
        title="DecisionClockView (bar plus seconds; it counts down live)"
        surface="hud"
      >
        {(
          [
            ["50 seconds of 60, green", 50_000],
            ["20 seconds, yellow", 20_000],
            ["5 seconds, red", 5_000],
          ] as const
        ).map(([label, ms]) => (
          <State key={label} label={label}>
            <div className="w-[240px]">
              <DecisionClockView remainingMs={ms} budgetMs={60_000} />
            </div>
          </State>
        ))}
      </Group>
      <Group
        id="hud/turn-timer-edge"
        title="TurnTimerEdge (a fixed hairline at the window top, contained here; store fixture: 45s of 60s)"
        surface="hud"
      >
        <State label="your clock, frozen">
          <Contain w={420} h={24}>
            {ready && <TurnTimerEdge frozen botControlled={false} />}
          </Contain>
        </State>
        <State label="bot-controlled (renders nothing)">
          <Contain w={420} h={24}>
            {ready && <TurnTimerEdge frozen botControlled />}
          </Contain>
        </State>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Turn controls and dice
// ---------------------------------------------------------------------------

const DOCK_DIE = dockDieSize(true);
const PHONE_DIE = dockDieSize(false);
const PARKED_DIE = parkedDieSize();

function dice(size: number, d1 = 3, d2 = 5, event?: string) {
  return <DiceDisplay d1={d1} d2={d2} event={event} size={size} />;
}
/** The unrolled dice, as Game.tsx draws them before any roll. */
function blankDice(size: number) {
  return (
    <span className="flex items-center justify-center gap-1.5">
      <Die n={0} variant="white" size={size} />
      <Die n={0} variant="red" size={size} />
      <EventDie face="" size={size} />
    </span>
  );
}

const PHASES = [
  "Place a settlement",
  "Place a road",
  "Place a ship",
  "Place a city",
  "Place a harbour settlement",
  "Place your ship, with its settler, beside your harbour settlement",
  "Place a road beside your settlement",
  "Place a road beside your city",
  "Roll the dice",
  "Discard 4",
  "Move the robber",
  "Move the pirate",
  "Move your pirate ship",
  "Build / Trade",
  "Move your ships",
];

function TurnGroups() {
  return (
    <>
      <Group id="hud/turn-controls" title="TurnControls, column (the desktop corner)" surface="hud">
        <State label="roll available (dice wobble, Roll button)">
          <TurnControls
            dice={blankDice(DOCK_DIE)}
            canRoll
            onRoll={noop}
            canEnd={false}
            onEnd={noop}
            wide
          />
        </State>
        <State label="rolled, End turn available">
          <TurnControls
            dice={dice(DOCK_DIE, 4, 2, "trade")}
            canRoll={false}
            onRoll={noop}
            canEnd
            onEnd={noop}
            wide
          />
        </State>
        <State label="waiting (not your turn)">
          <TurnControls
            dice={dice(DOCK_DIE, 6, 6, "ship")}
            canRoll={false}
            onRoll={noop}
            canEnd={false}
            onEnd={noop}
            wide
          />
        </State>
        <State label="no End button (spectator)">
          <TurnControls
            dice={dice(DOCK_DIE, 1, 2)}
            canRoll={false}
            onRoll={noop}
            canEnd={false}
            onEnd={noop}
            showEnd={false}
            wide
          />
        </State>
        <State label="narrow (wide=false), End turn">
          <TurnControls
            dice={dice(PHONE_DIE, 5, 3)}
            canRoll={false}
            onRoll={noop}
            canEnd
            onEnd={noop}
            wide={false}
          />
        </State>
      </Group>
      <Group id="hud/turn-controls-row" title="TurnControls, row (sideways phone)" surface="hud">
        <State label="roll available">
          <TurnControls
            row
            dice={blankDice(SQUAT_DIE_SIZE)}
            canRoll
            onRoll={noop}
            canEnd={false}
            onEnd={noop}
            wide={false}
          />
        </State>
        <State label="End turn available">
          <TurnControls
            row
            dice={dice(SQUAT_DIE_SIZE, 2, 2)}
            canRoll={false}
            onRoll={noop}
            canEnd
            onEnd={noop}
            wide={false}
          />
        </State>
        <State label="waiting (End disabled)">
          <TurnControls
            row
            dice={dice(SQUAT_DIE_SIZE, 6, 1)}
            canRoll={false}
            onRoll={noop}
            canEnd={false}
            onEnd={noop}
            wide={false}
          />
        </State>
      </Group>
      <Group
        id="hud/dice-row-end-pill"
        title="DiceRow and EndTurnPill (dock trigger row)"
        surface="hud"
      >
        <State label="DiceRow, roll available">
          <DiceRow dice={blankDice(PARKED_DIE)} canRoll onRoll={noop} />
        </State>
        <State label="DiceRow, parked result">
          <DiceRow dice={dice(PARKED_DIE, 6, 4, "politics")} canRoll={false} onRoll={noop} />
        </State>
        <State label="EndTurnPill, enabled">
          <EndTurnPill canEnd onEnd={noop} />
        </State>
        <State label="EndTurnPill, hover" force="hover">
          <EndTurnPill canEnd onEnd={noop} />
        </State>
        <State label="EndTurnPill, focus-visible" force="focus-visible">
          <EndTurnPill canEnd onEnd={noop} />
        </State>
        <State label="EndTurnPill, waiting (disabled)">
          <EndTurnPill canEnd={false} onEnd={noop} />
        </State>
      </Group>
      <Group id="hud/turn-banner" title="TurnBanner, mine vs theirs" surface="hud">
        <State label="theirs (glass, small dot)">
          <TurnBanner turnLabel="Cleo's turn" color={colorOf(2)} />
        </State>
        <State label="mine (solid, big dot)">
          <TurnBanner turnLabel="Build / Trade" color={MY} mine />
        </State>
        <State label="game over (no colour)">
          <TurnBanner turnLabel="Game over" />
        </State>
        <State label="very long name (truncates)">
          <div className="w-[300px]">
            <TurnBanner
              turnLabel="Bot Camembert de Normandie the Third's turn"
              color={colorOf(5)}
            />
          </div>
        </State>
        <State label="mine, with a choice chip (robber or pirate)">
          <TurnBanner turnLabel="Move the robber" color={MY} mine>
            <PieceChoice
              label="Move:"
              value="robber"
              onChange={noop}
              options={[
                { key: "robber", label: "Robber", icon: <RobberGlyph /> },
                { key: "pirate", label: "Pirate", icon: <Icons.ship size={14} /> },
              ]}
            />
          </TurnBanner>
        </State>
      </Group>
      <Group
        id="hud/turn-banner-phases"
        title="TurnBanner, every phase text (mine)"
        surface="hud"
        wide
      >
        {PHASES.map((label) => (
          <State key={label} label={label}>
            <TurnBanner turnLabel={label} color={MY} mine />
          </State>
        ))}
      </Group>
      <Group
        id="hud/die-dock"
        title={`Die, dock size (${DOCK_DIE}px), every face`}
        surface="hud"
        wide
      >
        {[0, 1, 2, 3, 4, 5, 6].map((n) => (
          <State key={`w${n}`} label={n === 0 ? "white, blank (0)" : `white ${n}`}>
            <Die n={n} size={DOCK_DIE} />
          </State>
        ))}
        <Break />
        {[0, 1, 2, 3, 4, 5, 6].map((n) => (
          <State key={`r${n}`} label={n === 0 ? "red, blank (0)" : `red ${n}`}>
            <Die n={n} variant="red" size={DOCK_DIE} />
          </State>
        ))}
      </Group>
      <Group
        id="hud/die-small"
        title={`Die, parked (${PARKED_DIE}px), phone dock (${PHONE_DIE}px) and inline log size (15px)`}
        surface="hud"
        wide
      >
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <State key={`p${n}`} label={`parked white ${n}`}>
            <Die n={n} size={PARKED_DIE} />
          </State>
        ))}
        <State label="phone dock, red 6">
          <Die n={6} variant="red" size={PHONE_DIE} />
        </State>
        <Break />
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <State key={`i${n}`} label={`inline white ${n}`}>
            <Die n={n} size={15} />
          </State>
        ))}
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <State key={`ir${n}`} label={`inline red ${n}`}>
            <Die n={n} variant="red" size={15} />
          </State>
        ))}
      </Group>
      <Group
        id="hud/event-die"
        title="EventDie (Knights), every face, dock and inline sizes"
        surface="hud"
      >
        {["ship", "trade", "politics", "science", ""].map((f) => (
          <State key={`d${f}`} label={f ? `${f}, dock` : "unrolled, dock"}>
            <EventDie face={f} size={DOCK_DIE} />
          </State>
        ))}
        <Break />
        {["ship", "trade", "politics", "science", ""].map((f) => (
          <State key={`i${f}`} label={f ? `${f}, inline 15px` : "unrolled, inline"}>
            <EventDie face={f} size={15} />
          </State>
        ))}
      </Group>
      <Group
        id="hud/dice-display"
        title="DiceDisplay (the roll: white, red, event die)"
        surface="hud"
      >
        <State label="base roll 3 + 5">{dice(DOCK_DIE, 3, 5)}</State>
        <State label="Knights roll 6 + 1, ship">{dice(DOCK_DIE, 6, 1, "ship")}</State>
        <State label="Knights roll 2 + 2, science, parked size">
          {dice(PARKED_DIE, 2, 2, "science")}
        </State>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Buttons, orbs, dock
// ---------------------------------------------------------------------------

function ButtonGroups({ ready }: { ready: boolean }) {
  const openRef = React.useRef<((key: string) => void) | null>(null);
  React.useEffect(() => {
    if (ready) openRef.current?.("table");
  }, [ready]);
  const panels = (withPill: boolean) => [
    {
      key: "table",
      icon: <Bank weight="bold" size={16} />,
      title: "Bank & table status",
      pill: withPill ? <BankRow compact /> : undefined,
      content: (
        <>
          <BankRow />
          <DiscardLimit />
        </>
      ),
    },
    {
      key: "log",
      icon: <Scroll weight="bold" size={16} />,
      title: "Event log",
      content: <div className="text-[12px]">Event log</div>,
    },
    {
      key: "chat",
      icon: <ChatCircle weight="bold" size={16} />,
      title: "Table chat",
      badge: true,
      content: <div className="text-[12px]">Table chat</div>,
    },
  ];
  return (
    <>
      {(["primary", "secondary", "danger"] as const).map((kind) => (
        <Group
          key={kind}
          id={`hud/hud-button-${kind}`}
          title={`HudButton kind="${kind}"`}
          surface="hud"
        >
          {(["sm", "md"] as const).map((size) => (
            <React.Fragment key={size}>
              <State label={`${size}, rest`}>
                <HudButton kind={kind} size={size}>
                  Offer trade
                </HudButton>
              </State>
              <State label={`${size}, hover`} force="hover">
                <HudButton kind={kind} size={size}>
                  Offer trade
                </HudButton>
              </State>
              <State label={`${size}, active`} force="active">
                <HudButton kind={kind} size={size}>
                  Offer trade
                </HudButton>
              </State>
              <State label={`${size}, focus-visible`} force="focus-visible">
                <HudButton kind={kind} size={size}>
                  Offer trade
                </HudButton>
              </State>
              <State label={`${size}, pressed`}>
                <HudButton kind={kind} size={size} pressed>
                  Offer trade
                </HudButton>
              </State>
              <State label={`${size}, pressed, hover`} force="hover">
                <HudButton kind={kind} size={size} pressed>
                  Offer trade
                </HudButton>
              </State>
              <State label={`${size}, disabled`}>
                <HudButton kind={kind} size={size} disabled>
                  Offer trade
                </HudButton>
              </State>
              <State label={`${size}, pressed, disabled`}>
                <HudButton kind={kind} size={size} pressed disabled>
                  Offer trade
                </HudButton>
              </State>
              <Break />
            </React.Fragment>
          ))}
        </Group>
      ))}
      <Group id="hud/hud-orb" title="HudOrb (utility orbs), ThemeOrb, ExplainOrb" surface="hud">
        <State label="rest">
          <HudOrb title="Players">
            <UsersThree weight="bold" size={16} />
          </HudOrb>
        </State>
        <State label="hover" force="hover">
          <HudOrb title="Players">
            <UsersThree weight="bold" size={16} />
          </HudOrb>
        </State>
        <State label="active (pressing)" force="active">
          <HudOrb title="Players">
            <UsersThree weight="bold" size={16} />
          </HudOrb>
        </State>
        <State label="focus-visible" force="focus-visible">
          <HudOrb title="Players">
            <UsersThree weight="bold" size={16} />
          </HudOrb>
        </State>
        <State label="active prop (panel open)">
          <HudOrb title="Players" active aria-pressed>
            <UsersThree weight="bold" size={16} />
          </HudOrb>
        </State>
        <State label="round">
          <HudOrb title="Bank" round>
            <Bank weight="bold" size={16} />
          </HudOrb>
        </State>
        <State label="round, active prop">
          <HudOrb title="Bank" round active>
            <Bank weight="bold" size={16} />
          </HudOrb>
        </State>
        <State label="disabled">
          <HudOrb title="Players" disabled>
            <UsersThree weight="bold" size={16} />
          </HudOrb>
        </State>
        <State label="with unread badge">
          <HudOrb title="Chat" round>
            <ChatCircle weight="bold" size={16} />
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red border-2 border-border"
            />
          </HudOrb>
        </State>
        <State label="ThemeOrb">
          <ThemeOrb />
        </State>
        <State label="ExplainOrb's face, off (the orb itself renders only on touch)">
          <HudOrb title="What does this do?">
            <Question weight="bold" size={16} />
          </HudOrb>
        </State>
        <State label="ExplainOrb's face, armed">
          <HudOrb title="Tap anything to learn what it does" active aria-pressed>
            <Question weight="bold" size={16} />
          </HudOrb>
        </State>
        <State label="ExplainOrb (empty here: null on a hover device)">
          <span className="inline-flex min-h-9 min-w-9 items-center">
            <ExplainOrb />
          </span>
        </State>
      </Group>
      <Group
        id="hud/utility-orbs"
        title="UtilityOrbs row with TopPanelOrb (closed with badge; pinned open with its card)"
        surface="hud"
      >
        <State label="TopPanelOrb closed, with badge">
          <UtilityOrbs>
            <TopPanelOrb title="Bank & table status" icon={<Bank weight="bold" size={16} />} badge>
              <div />
            </TopPanelOrb>
            <ThemeOrb />
          </UtilityOrbs>
        </State>
        <State label="TopPanelOrb pinned open (card below the row)">
          <div className="relative h-[330px] w-[290px]">
            <div className="absolute right-0 top-0">
              <UtilityOrbs>
                <ThemeOrb />
                <TopPanelOrb
                  title="Bank & table status"
                  icon={<Bank weight="bold" size={16} />}
                  pinned
                >
                  {ready && (
                    <>
                      <BankRow />
                      <DiscardLimit />
                    </>
                  )}
                </TopPanelOrb>
              </UtilityOrbs>
            </div>
          </div>
        </State>
      </Group>
      <Group
        id="hud/dock-panels"
        title="DockPanels (the trigger row above the hotbar) and DOCK_PILL"
        surface="hud"
        wide
      >
        <State label="closed: bank pill (compact BankRow), log and chat orbs (chat unread), End pill">
          <div className="relative w-[520px]">
            {ready && (
              <DockPanels panels={panels(true)} trailing={<EndTurnPill canEnd onEnd={noop} />} />
            )}
          </div>
        </State>
        <State label="open: bank panel raised above, its pill active">
          <div className="flex h-[440px] w-[520px] flex-col justify-end">
            <div className="relative">
              {ready && (
                <DockPanels
                  panels={panels(true)}
                  openRef={openRef}
                  leading={<DiceRow dice={dice(PARKED_DIE, 5, 2)} canRoll={false} onRoll={noop} />}
                />
              )}
            </div>
          </div>
        </State>
        <State label="closed: glyph orbs only (no bank pill)">
          <div className="relative w-[300px]">{ready && <DockPanels panels={panels(false)} />}</div>
        </State>
        <Break />
        <State label="DOCK_PILL, rest">
          <button type="button" className={DOCK_PILL}>
            Pill
          </button>
        </State>
        <State label="DOCK_PILL, hover" force="hover">
          <button type="button" className={DOCK_PILL}>
            Pill
          </button>
        </State>
        <State label="DOCK_PILL, active" force="active">
          <button type="button" className={DOCK_PILL}>
            Pill
          </button>
        </State>
        <State label="DOCK_PILL, focus-visible" force="focus-visible">
          <button type="button" className={DOCK_PILL}>
            Pill
          </button>
        </State>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Table status, feed, barbarians
// ---------------------------------------------------------------------------

function ev(seq: number, type: string, data: unknown): GameEvent {
  return { seq, type, data };
}

const LOG_EVENTS: GameEvent[] = [
  ev(1, "settlement_placed", { player: 0 }),
  ev(2, "road_placed", { player: 0 }),
  ev(3, "starting_resources", { player: 0, gain: [0, 1, 1, 0, 1, 0] }),
  ev(4, "turn_started", { player: 1 }),
  ev(5, "dice_rolled", { player: 1, d1: 4, d2: 4 }),
  ev(6, "cak_event_die", { face: "trade" }),
  ev(7, "resources_distributed", {
    gains: [
      { player: 0, gain: [0, 2, 0, 0, 1, 0] },
      { player: 2, gain: [0, 0, 0, 1, 0, 0] },
    ],
  }),
  ev(8, "road_built", { player: 1 }),
  ev(9, "city_built", { player: 1 }),
  ev(10, "bank_traded", { player: 1, give: [0, 0, 0, 4, 0, 0], get: [0, 0, 0, 0, 0, 1] }),
  ev(11, "trade_executed", { by: 1, with: 0, give: [0, 1, 0, 0, 0, 0], want: [0, 0, 1, 0, 0, 0] }),
  ev(12, "turn_started", { player: 2 }),
  ev(13, "dice_rolled", { player: 2, d1: 6, d2: 1 }),
  ev(14, "cak_event_die", { face: "ship" }),
  ev(15, "cards_discarded", { player: 0, cards: [0, 2, 0, 1, 1, 0] }),
  ev(16, "robber_moved", { player: 2, hex: { q: 1, r: 0 } }),
  ev(17, "card_stolen", { thief: 2, victim: 0, res: "ore" }),
  ev(18, "cak_progress_drawn", { player: 2, card: "crane" }),
  ev(19, "cak_improved", { player: 2, track: 0, cost: 3 }),
  ev(20, "cak_progress_played", { player: 2, card: "crane" }),
  ev(21, "monopoly_resolved", {
    player: 2,
    res: "wheat",
    takes: [
      { player: 0, count: 2 },
      { player: 1, count: 1 },
    ],
  }),
  ev(22, "longest_road", { holder: 3 }),
  ev(23, "settlement_built", { player: 2 }),
  ev(24, "draw_offered", { player: 3 }),
  ev(25, "game_finished", { winner: 2 }),
];

const CHAT = [
  { from: "Bram", msg: "anyone have brick?", color: colorOf(1) },
  { from: "Cleo", msg: "2 wheat for 1 ore", color: colorOf(2) },
  { from: "Dov", msg: "gg, nice longest road", color: colorOf(3) },
  { from: "Ada", msg: "I'll give wood wood sheep for ore", color: colorOf(0) },
];

/** A chat row, with the class strings of Game.tsx's `chatNodes` (inline JSX there). */
function ChatRow({
  from,
  msg,
  color,
  report,
}: {
  from: string;
  msg: string;
  color: string;
  report?: boolean;
}) {
  return (
    <div className="group flex items-baseline gap-1 text-[12px] leading-snug">
      <span>
        <b style={{ color }}>{from}</b>: <ChatText msg={msg} commodities />
      </span>
      {report && (
        <button
          type="button"
          aria-label="Report message"
          className="opacity-0 group-hover:opacity-100 text-[var(--muted-foreground)] hover:text-[var(--destructive)] leading-none"
        >
          ⚑
        </button>
      )}
    </div>
  );
}

function FeedGroups({ ready }: { ready: boolean }) {
  const pieceIcon = usePieceIcons([0, 1, 2, 3].map(colorOf));
  const logA = useStickyScroll<HTMLDivElement>(LOG_EVENTS);
  const chatA = useStickyScroll<HTMLDivElement>(CHAT);
  const logB = useStickyScroll<HTMLDivElement>(LOG_EVENTS);
  const chatB = useStickyScroll<HTMLDivElement>(CHAT);
  const logC = useStickyScroll<HTMLDivElement>(LOG_EVENTS);
  const chatC = useStickyScroll<HTMLDivElement>(CHAT);
  const logD = useStickyScroll<HTMLDivElement>(LOG_EVENTS);
  const chatD = useStickyScroll<HTMLDivElement>(CHAT);
  const log = (
    <EventLogFeed
      events={LOG_EVENTS}
      seatName={seatName}
      islands={false}
      colorOf={colorOf}
      pieceIcon={pieceIcon}
      tiles={null}
      fadeAt={null}
    />
  );
  const chat = CHAT.map((c, i) => <ChatRow key={i} {...c} report={i === 0} />);
  const chatBar = <ChatBar onSend={() => true} />;
  return (
    <>
      <Group
        id="hud/table-status"
        title="TableStatus (store fixture: brick and paper at 0, a 2:1 brick harbour, 11 cards held against a limit of 9)"
        surface="hud"
      >
        <State label="BankRow (full; Knights adds the commodities row)">
          <GlassPanel className="flex w-[264px] flex-col gap-2 p-2.5 text-[13px]">
            {ready && <BankRow />}
          </GlassPanel>
        </State>
        <State label="BankRow compact (the dock pill's counts)">
          <GlassPanel className="px-3 py-1.5">{ready && <BankRow compact />}</GlassPanel>
        </State>
        <State label="DefaultRateChip, default 4:1 (data-better=false)">
          <GlassPanel className="p-2.5">{ready && <DefaultRateChip />}</GlassPanel>
        </State>
        <State label="DiscardLimit, over (11/9, red)">
          <GlassPanel className="w-[160px] p-2.5">{ready && <DiscardLimit />}</GlassPanel>
        </State>
      </Group>
      <Group
        id="hud/table-feed"
        title="TableFeed island, with the real EventLogFeed and chat rows"
        surface="hud"
      >
        <State label="island, log pane">
          <TableFeed
            pane="log"
            log={log}
            chat={chat}
            chatBar={chatBar}
            logScroll={logA}
            chatScroll={chatA}
          />
        </State>
        <State label="island, chat pane (with the composer)">
          <TableFeed
            pane="chat"
            log={log}
            chat={chat}
            chatBar={chatBar}
            logScroll={logB}
            chatScroll={chatB}
          />
        </State>
        <State label="island, chat pane, empty">
          <TableFeed
            pane="chat"
            log={log}
            chat={<div className="text-muted text-[12px]">Say something to the table…</div>}
            chatBar={chatBar}
            logScroll={logC}
            chatScroll={chatC}
          />
        </State>
      </Group>
      <Group
        id="hud/table-feed-sheet"
        title="TableFeed variant sheet (inside a dock panel), log pane"
        surface="hud"
      >
        <State label="sheet, log">
          <GlassPanel className="flex h-[420px] w-[380px] flex-col p-2.5">
            <TableFeed
              variant="sheet"
              pane="log"
              log={log}
              chat={chat}
              chatBar={chatBar}
              logScroll={logD}
              chatScroll={chatD}
            />
          </GlassPanel>
        </State>
      </Group>
      <Group
        id="hud/log-lines"
        title="Event log lines (EventLogFeed: rows, turn dividers, dice, event die, cards, pieces, progress cards)"
        surface="hud"
      >
        <State label="every row type in the fixture, unclipped">
          <div className="hud-surf flex w-[340px] flex-col px-2.5 py-2">{log}</div>
        </State>
      </Group>
      <Group id="hud/chat" title="Chat rows (ChatText) and the ChatBar composer" surface="hud">
        <State label="chat rows: plain text, and goods drawn as cards">
          <div className="hud-surf flex w-[300px] flex-col gap-1 px-2.5 py-2">{chat}</div>
        </State>
        <State label="row with report flag, hover (flag shows)" force="hover">
          <ChatRow {...CHAT[0]} report />
        </State>
        <State label="ChatBar, empty">
          <div className="w-[280px]">
            <ChatBar onSend={() => true} />
          </div>
        </State>
      </Group>
      <Group
        id="hud/barbarian-rail"
        title="BarbarianRail (store fixture: step 4 of 7, all knights 3 vs 4 cities: exposed)"
        surface="hud"
      >
        <State label="down (the box in the right column)">
          {ready ? <BarbarianRail /> : <span />}
        </State>
        <State label="across (a row)">
          <div className="w-[300px]">{ready && <BarbarianRail across />}</div>
        </State>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// CSS-class pieces without a component
// ---------------------------------------------------------------------------

function ClassGroups() {
  return (
    <>
      <Group
        id="hud/surfaces"
        title="HUD surfaces: hud-surf (glass), hud-surf-solid, hud-surf-own; GlassPanel + HudLabel"
        surface="hud"
      >
        <State label="hud-surf">
          <div className="hud-surf w-[160px] p-3 text-[13px]">Glass panel</div>
        </State>
        <State label="hud-surf-solid">
          <div className="hud-surf-solid w-[160px] p-3 text-[13px]">Solid panel</div>
        </State>
        <State label="hud-surf-own (your seat)">
          <div className="hud-surf-own w-[160px] p-3 text-[13px]">Own panel</div>
        </State>
        <State label="GlassPanel + HudLabel">
          <GlassPanel className="flex w-[160px] flex-col gap-1 p-3 text-[13px]">
            <HudLabel>Fleet</HudLabel>
            Section text
          </GlassPanel>
        </State>
      </Group>
      <Group
        id="hud/chips-badges"
        title="hud-chip, hud-badge, hud-pill-count, hud-left, hud-fan"
        surface="hud"
      >
        <State label="hud-chip">
          <span className="hud-chip h-6.5 px-1.5 text-[11px]">4</span>
        </State>
        <State label="hud-chip data-hot">
          <span className="hud-chip h-6.5 px-1.5 text-[11px]" data-hot="true">
            10
          </span>
        </State>
        <State label="hud-badge">
          <span className="hud-badge flex h-[18px] min-w-[18px] items-center justify-center px-1 text-[10px] font-bold">
            3
          </span>
        </State>
        <State label="hud-pill-count give (bg-green)">
          <span className="relative block h-5 w-8">
            <CommitPill n={2} tone="give" onRemove={noop} />
          </span>
        </State>
        <State label="hud-pill-count discard (bg-red)">
          <span className="relative block h-5 w-8">
            <CommitPill n={2} tone="discard" onRemove={noop} />
          </span>
        </State>
        <State label="hud-pill-count data-tone=hold (HoldPill)">
          <span className="relative block h-6 w-8">
            <HoldPill n={4} />
          </span>
        </State>
        <State label="hud-left (pieces left)">
          <span className="relative inline-flex h-10 w-14">
            <span className="hud-left">5</span>
          </span>
        </State>
        <State label="hud-left data-out (0 left)">
          <span className="relative inline-flex h-10 w-14">
            <span className="hud-left" data-out="true">
              0
            </span>
          </span>
        </State>
        {[0, 1, 2, 4, 9].map((n) => (
          <State key={n} label={`hud-fan (CardFan n=${n})`}>
            <CardFan n={n} />
          </State>
        ))}
      </Group>
      <Group id="hud/rates-lanes" title="hud-rate, hud-rate-mark, hud-lane" surface="hud">
        <State label="hud-rate data-better=false (4:1)">
          <span className="hud-rate" data-better="false">
            You trade 4:1
          </span>
        </State>
        <State label="hud-rate data-better=true (3:1)">
          <span className="hud-rate" data-better="true">
            You trade 3:1
          </span>
        </State>
        <State label="hud-rate-mark, default">
          <span className="hud-surf inline-flex p-2">
            <span className="hud-rate-mark" data-better="false">
              4:1
            </span>
          </span>
        </State>
        <State label="hud-rate-mark, better">
          <span className="hud-surf inline-flex p-2">
            <span className="hud-rate-mark" data-better="true">
              2:1
            </span>
          </span>
        </State>
        <State label="hud-rate-mark-sm, better">
          <span className="hud-surf inline-flex p-2">
            <span className="hud-rate-mark hud-rate-mark-sm" data-better="true">
              2:1
            </span>
          </span>
        </State>
        <Break />
        <State label="hud-lane, empty (data-empty), on a hud-surf panel">
          <div className="hud-surf p-2">
            <div
              className="hud-lane flex min-h-[60px] w-[300px] items-center gap-2 px-2 py-1.5"
              data-empty="true"
            >
              <span className="px-1 text-[12px] text-muted">
                Choose cards from your hand below.
              </span>
            </div>
          </div>
        </State>
        <State label="hud-lane, filled, on a hud-surf panel">
          <div className="hud-surf p-2">
            <div className="hud-lane flex min-h-[60px] w-[300px] items-center gap-2 px-2 py-1.5">
              <div className="flex flex-wrap gap-1.5">
                <ResCard {...card(0)} count={2} size="lg" onClick={noop} />
                <ResCard {...card(4)} count={1} size="lg" onClick={noop} />
              </div>
            </div>
          </div>
        </State>
      </Group>
      <Group
        id="hud/dialog"
        title="hud-dialog over a hud-dim scrim, with Overlay's classes (hud-dialog-title, hud-dismiss, hud-dialog-note, hud-dialog-foot)"
        surface="hud"
      >
        <State label="dialog: title, dismiss, note, seat picks, sticky foot">
          <Contain w={420} h={340} className="hud-root">
            <div className="hud-dim absolute inset-0 flex items-center justify-center p-3">
              <div className="hud-dialog flex max-h-[310px] w-[340px] flex-col gap-3 overflow-y-auto p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="hud-dialog-title flex-1 text-center">Choose a player to rob</div>
                  <button
                    type="button"
                    aria-label="Close"
                    className="hud-dismiss relative grid size-9 shrink-0 place-items-center text-[18px] leading-none"
                  >
                    <span aria-hidden>×</span>
                  </button>
                </div>
                <p className="hud-dialog-note text-center">Each of them has cards in hand.</p>
                <SeatChoiceRow>
                  <SeatChoice
                    seat={1}
                    name="Bram"
                    color={colorOf(1)}
                    detail="3 cards"
                    onSelect={noop}
                  />
                  <SeatChoice
                    seat={2}
                    name="Cleo"
                    color={colorOf(2)}
                    detail="11 cards"
                    onSelect={noop}
                  />
                </SeatChoiceRow>
                <div className="hud-dialog-foot sticky -bottom-5 z-10 -mx-5 -mb-5 mt-auto flex flex-col items-center gap-2 px-5 pt-3 pb-5">
                  <HudButton kind="primary">Confirm</HudButton>
                </div>
              </div>
            </div>
          </Contain>
        </State>
        <div className="hud-dialog flex gap-6 p-4">
          <State label="hud-dismiss, rest (on hud-dialog)">
            <button
              type="button"
              aria-label="Close"
              className="hud-dismiss relative grid size-9 shrink-0 place-items-center text-[18px] leading-none"
            >
              <span aria-hidden>×</span>
            </button>
          </State>
          <State label="hud-dismiss, hover (on hud-dialog)" force="hover">
            <button
              type="button"
              aria-label="Close"
              className="hud-dismiss relative grid size-9 shrink-0 place-items-center text-[18px] leading-none"
            >
              <span aria-hidden>×</span>
            </button>
          </State>
        </div>
        <State label="hud-dim scrim over a sample">
          <Contain w={200} h={120}>
            <div className="absolute inset-0 flex items-center justify-center gap-2">
              <ResCard {...card(0)} count={2} size="lg" />
              <ResCard {...card(3)} count={1} size="lg" />
            </div>
            <div className="hud-dim absolute inset-0" />
          </Contain>
        </State>
      </Group>
      <Group id="hud/seatpick" title="hud-seatpick + hud-seatpick-well (SeatChoice)" surface="hud">
        <State label="rest">
          <SeatChoice seat={1} name="Bram" color={colorOf(1)} detail="3 cards" onSelect={noop} />
        </State>
        <State label="hover" force="hover">
          <SeatChoice seat={1} name="Bram" color={colorOf(1)} detail="3 cards" onSelect={noop} />
        </State>
        <State label="focus-visible" force="focus-visible">
          <SeatChoice seat={1} name="Bram" color={colorOf(1)} detail="3 cards" onSelect={noop} />
        </State>
        <State label="disabled">
          <SeatChoice
            seat={3}
            name="Dov"
            color={colorOf(3)}
            detail="0 cards"
            disabled
            onSelect={noop}
          />
        </State>
        <State label="long bot name (two lines)">
          <SeatChoice
            seat={5}
            name="Bot Camembert"
            color={colorOf(5)}
            detail="7 cards"
            onSelect={noop}
          />
        </State>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// The seat rail (last: it measures the room left below it in the window)
// ---------------------------------------------------------------------------

const CHROME: SeatChrome = {
  label: (seat, viewName) => viewName ?? seatName(seat),
  decoration: () => undefined,
  color: colorOf,
};

function RailGroup({ ready }: { ready: boolean }) {
  return (
    <Group
      id="hud/seat-rail"
      title="SeatRail (store fixture: Knights, Cleo on the clock, your seat pinned at the foot; ?seats=8 gives compact rows)"
      surface="hud"
    >
      <State label="column (lg and up), timers frozen">
        <div className="w-[260px]">{ready && <SeatRail chrome={CHROME} frozen />}</div>
      </State>
    </Group>
  );
}

export function Section() {
  const ready = useFixture();
  return (
    <div className="flex flex-col gap-6">
      <ResCardGroups />
      <CardGroups />
      <ShopGroups />
      <TurnGroups />
      <ButtonGroups ready={ready} />
      <SeatGroups ready={ready} />
      <FeedGroups ready={ready} />
      <ClassGroups />
      <RailGroup ready={ready} />
    </div>
  );
}
