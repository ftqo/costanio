import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { HOW_TO_PLAY_TABS, type HowToPlayTab } from "@/routes/howToPlayTabs";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";
import { ArrowsLeftRight, ArrowFatUp, Lightning, Question } from "@/lib/icons";
import { SiteHeader } from "@/components/SiteHeader";
import { Screen } from "@/components/Screen";
import { PageBody } from "@/components/PageBody";
import { PageTitle } from "@/components/PageTitle";
import { TrackTabs } from "@/components/TrackTabs";
import { HexCluster } from "@/components/board/HexCluster";
import { Die } from "@/components/board/Die";
import { ResIcon, CardFace } from "@/components/asset/AssetParts";
import { PieceArt } from "@/components/game/PieceIcon";
import { Icons } from "@/components/game/hudIcons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { mkMini, modeClassic, modeSea, modeKnights, SEA } from "@/lib/board";
import { resIconSlot, comIconSlot, goodCount } from "@/lib/cardFace";
import { DEV_CARDS, playedCardSlot } from "@/lib/cardText";
import { COST } from "@/lib/costs";
import { improvementReward, TRACK_ROW } from "@/lib/improvements";
import {
  PROGRESS_CARDS,
  PROGRESS_COUNTS,
  PROGRESS_DECKS,
  PROGRESS_DECK_LOOK,
  progressDeckCards,
  progressSlot,
  type ProgressDeck,
} from "@/lib/progressCards";
import { FREE_SEAT_COLORS } from "@/lib/board3d/freeColors";
import { useRulesProps } from "@/lib/useRulesProps";
import type { PieceKind } from "@/lib/eventlog";

/* ------------------------------------------------------------------ *
 * Resource & commodity tokens.
 *
 * Names, colours and icon slots come from lib/cardFace, so a card a player
 * learns here is the same object they pick up at the table.
 * ------------------------------------------------------------------ */

interface Good {
  /**
   * Display label, lowercased for running text.
   *
   * A descriptor, not a string: this table is evaluated once at import, so a
   * translated string would be frozen in the language active then. The five
   * resources reuse the `resource, standalone label` messages from
   * lib/boardInfo and lib/locationActions, so the page names a card as the
   * board tooltip does. Case is the translator's call (German capitalises
   * nouns), and the context says so.
   */
  label: MessageDescriptor;
  /** Asset slot for the baked icon. */
  slot: string;
}

/**
 * Every good the rules can name, keyed by the word the page uses in prose.
 *
 * No gold: a gold hex pays a choice of real resources, so there is no gold
 * card. (The pack's `icon_gold` is the scenario gold currency of Raiders,
 * Wagons and Explorers.)
 */
const GOODS = {
  wood: {
    label: msg({ message: "wood", context: "resource, standalone label" }),
    slot: resIconSlot(1),
  },
  brick: {
    label: msg({ message: "brick", context: "resource, standalone label" }),
    slot: resIconSlot(2),
  },
  sheep: {
    label: msg({ message: "sheep", context: "resource, standalone label" }),
    slot: resIconSlot(3),
  },
  wheat: {
    label: msg({ message: "wheat", context: "resource, standalone label" }),
    slot: resIconSlot(4),
  },
  ore: {
    label: msg({ message: "ore", context: "resource, standalone label" }),
    slot: resIconSlot(5),
  },
  cloth: {
    label: msg({ message: "cloth", context: "commodity, standalone label" }),
    slot: comIconSlot(0),
  },
  paper: {
    label: msg({ message: "paper", context: "commodity, standalone label" }),
    slot: comIconSlot(1),
  },
  coin: {
    label: msg({ message: "coin", context: "commodity, standalone label" }),
    slot: comIconSlot(2),
  },
} as const satisfies Record<string, Good>;

type ResKey = keyof typeof GOODS;

/** Resource index (as a Hand is indexed) → the key this page names it by. */
const BY_RES_IDX: Record<number, ResKey> = {
  1: "wood",
  2: "brick",
  3: "sheep",
  4: "wheat",
  5: "ore",
};

function Chip({ k }: { k: ResKey }) {
  const g = GOODS[k];
  return (
    <Badge tone="resource" className="align-middle">
      <ResIcon slot={g.slot} size={14} />
      {i18n._(g.label)}
    </Badge>
  );
}

/**
 * A cost or payment as a row of resource chips, each optionally with a count.
 *
 * The count is a multiplier on the card: `goodCount` writes "wood ×2", the
 * notation the log and trade chips use, which avoids a counted noun phrase over
 * a name only known at runtime (see src/locales/README.md).
 */
function Cost({ items }: { items: [ResKey, number][] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {items.map(([k, n]) => (
        <Badge key={k} tone="resource">
          <ResIcon slot={GOODS[k].slot} size={14} />
          {n > 1 ? goodCount(i18n._(GOODS[k].label), n) : i18n._(GOODS[k].label)}
        </Badge>
      ))}
    </span>
  );
}

/**
 * The cost of a buildable, read from the same table the buy shelf reads, so
 * the page cannot quote a stale price.
 */
function costOf(kind: keyof typeof COST): [ResKey, number][] {
  return Object.entries(COST[kind]).map(([idx, n]) => [BY_RES_IDX[Number(idx)], n]);
}

/* ------------------------------------------------------------------ *
 * Prose primitives.
 * ------------------------------------------------------------------ */

function P({ children }: { children: ReactNode }) {
  return <p className="text-[14px] text-muted leading-relaxed">{children}</p>;
}

function B({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-foreground">{children}</span>;
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((it, i) => (
        <li key={i} className="text-[14px] text-muted leading-relaxed pl-4 relative">
          <span aria-hidden className="absolute left-0 top-0 text-muted2">
            ›
          </span>
          {it}
        </li>
      ))}
    </ul>
  );
}

/** A labelled inset panel for grouping related rules inside a section. */
function Panel({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-elev rounded-base px-4 py-3.5 flex flex-col gap-2">
      {title && <div className="text-[14px] font-semibold text-foreground">{title}</div>}
      {children}
    </div>
  );
}

/** A named rule (term + body), e.g. one development card or one ability. */
function Term({
  name,
  color,
  tag,
  children,
}: {
  name: ReactNode;
  color?: string;
  tag?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[14px] font-semibold text-foreground flex items-center gap-1.5 flex-wrap">
        {color && (
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0 bg-(--swatch)"
            style={{ "--swatch": color } as CSSProperties}
          />
        )}
        {name}
        {tag}
      </div>
      <div className="text-[13px] text-muted leading-relaxed">{children}</div>
    </div>
  );
}

function VP({ children }: { children: ReactNode }) {
  return <Badge tone="award">{children}</Badge>;
}

/**
 * A number the host chose, not a law of the game (10 points, a hand limit of
 * 7, a 19-hex board). Each such number is marked where it appears, and the
 * marker points at the chapter listing what a host can set.
 */
function Cfg({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  return (
    <span
      className="underline decoration-dotted decoration-from-font underline-offset-2 cursor-help"
      title={t`A table setting: the host can change this. See Playing online → Table settings.`}
    >
      {children}
    </span>
  );
}

/** Table header cells: a tracked mono label over 1px row rules. */
const TH = "font-semibold text-[12px] text-muted text-left pb-2 pr-3";
const TH_LAST = "font-semibold text-[12px] text-muted text-left pb-2";

/* ------------------------------------------------------------------ *
 * Section wrapper: every chapter is a bordered card with an anchor id.
 * ------------------------------------------------------------------ */

function Sec({
  id,
  title,
  badge,
  children,
}: {
  id: string;
  title: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        cardVariants({ shadow: "hard" }),
        "scroll-mt-4 px-6 py-5 flex flex-col gap-3.5 max-[640px]:px-4.5",
      )}
    >
      <div className="flex items-center gap-2.5 flex-wrap">
        <h2 className="font-display text-[20px] font-semibold tracking-[-0.01em] leading-tight">
          {title}
        </h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Board pieces: the game's own models, drawn by PieceArt as in the log and
 * the buy shelf, so the picture here matches the piece on the board.
 *
 * One fixed colour for the page: renders are cached per seat colour, and a
 * free preset is one most players already have baked.
 * ------------------------------------------------------------------ */

const PIECE_COLOR = FREE_SEAT_COLORS[8];

/**
 * A piece at text scale, for a bullet or an inline run. The box is sized
 * either way: without WebGL, or before the render lands, it stays blank.
 */
function Piece({ kind, size = 22 }: { kind: PieceKind; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 align-middle size-(--size)"
      style={{ "--size": `${size}px` } as CSSProperties}
    >
      <PieceArt piece={kind} color={PIECE_COLOR} />
    </span>
  );
}

/**
 * A neutral prop (the robber, the pirate, the barbarian fleet, the merchant).
 * Separate from Piece because these belong to no seat: they come from
 * RULES_SET rather than the per-colour icon set, and the hook takes no colour.
 * Like Piece, the sized box stays blank until the render lands.
 */
function Prop({
  slot,
  size = 26,
}: {
  slot: "prop_robber" | "prop_pirate" | "prop_barbarian" | "prop_merchant";
  size?: number;
}) {
  const props = useRulesProps(PIECE_COLOR);
  const url = props[slot];
  return (
    <span
      className="inline-block shrink-0 align-middle size-(--size)"
      style={{ "--size": `${size}px` } as CSSProperties}
    >
      {url && <img src={url} alt="" draggable={false} className="h-full w-full object-contain" />}
    </span>
  );
}

const devCardGlyph = (
  <CardFace slot="devcard_back" className="h-6.5 w-auto rounded-xs border border-border" />
);

/**
 * One buildable: its piece, its name, what it costs, and its limit. `cost`
 * names a key of the shared COST table rather than restating a price.
 */
function PieceRow({
  glyph,
  kind,
  name,
  cost,
  items,
  right,
}: {
  glyph?: ReactNode;
  kind?: PieceKind;
  name: ReactNode;
  cost?: keyof typeof COST;
  items?: [ResKey, number][];
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <div className="w-7 h-7 flex items-center justify-center shrink-0">
        {kind ? <Piece kind={kind} size={26} /> : glyph}
      </div>
      <div className="text-[13px] font-semibold w-21.5 shrink-0">{name}</div>
      <Cost items={cost ? costOf(cost) : (items ?? [])} />
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

/* ================================================================== *
 * TAB CONTENT
 * ================================================================== */

interface Chapter {
  id: string;
  label: ReactNode;
  render: () => ReactNode;
}

interface Tab {
  // Typed against the router's list, so a tab added here without a key there
  // fails the build. See routes/howToPlayTabs.
  key: HowToPlayTab;
  label: ReactNode;
  tone: "success" | "accent" | "danger" | "default";
  blurb: ReactNode;
  /** Playable, but still settling. Renders the beta notice at the top of the
   *  tab, and matches the Beta badge the lobby puts on the same expansions. */
  beta?: boolean;
  chapters: Chapter[];
}

/* ---------------------------- BASE -------------------------------- */

/**
 * How the board scales with the table.
 *
 * Mirrors engine/board/generate.go: RadiusFor picks radius 2/3/4, tileBag
 * spreads a 4:4:4:3:3 ratio over the producing hexes with one desert per ~30
 * tiles, and harborCount is 9 + 3*(radius-2). The mixes below are that
 * arithmetic worked through; ore comes up short above the smallest board
 * because it is last in the remainder order.
 */
/*
 * The counts sit inside each message rather than beside an interpolated noun,
 * so a locale writes "4 Wälder, 3 Hügel" with its own agreement.
 */
const BOARD_SIZES = [
  {
    players: "3–4",
    hexes: 19,
    mix: msg({ message: "4 forest, 4 pasture, 4 field, 3 clay, 3 mountain, 1 desert" }),
    harbors: msg({ message: "9 (4 generic, one 2:1 per resource)" }),
  },
  {
    players: "5–6",
    hexes: 37,
    mix: msg({ message: "8 forest, 8 pasture, 8 field, 6 clay, 5 mountain, 2 deserts" }),
    harbors: msg({ message: "12 (5 generic, 7 specific)" }),
  },
  {
    players: "7–10",
    hexes: 61,
    mix: msg({ message: "13 forest, 13 pasture, 13 field, 10 clay, 9 mountain, 3 deserts" }),
    harbors: msg({ message: "15 (7 generic, 8 specific)" }),
  },
];

/**
 * Development-deck composition per bracket, from engine/types.go. The 5-6
 * bracket adds knights and victory points and no progress cards, and the
 * larger brackets extrapolate that.
 */
const DEV_DECKS = [
  { players: "3–4", knights: 14, vp: 5 },
  { players: "5–6", knights: 20, vp: 8 },
  { players: "7–8", knights: 26, vp: 11 },
  { players: "9–10", knights: 32, vp: 14 },
];

/** The five dev cards, in the order the deck lists them. */
const DEV_DECK_ORDER = [
  "knight",
  "road_building",
  "year_of_plenty",
  "monopoly",
  "victory_point",
] as const;

/**
 * One development card, drawn with its own baked face. Text comes from
 * lib/cardText, the same table the in-game log uses for card captions.
 */
function DevCardTile({ id }: { id: string }) {
  const card = DEV_CARDS[id];
  return (
    <div className="bg-elev rounded-base p-2.5 flex flex-col gap-1.5">
      <CardFace slot={playedCardSlot("dev", id)} className="w-full h-auto rounded-lg" />
      <div className="text-[13px] font-semibold leading-tight">{card.name}</div>
      <div className="text-[12px] text-muted leading-[1.4]">{card.hint}</div>
    </div>
  );
}

const TURN_STEPS = [
  {
    n: 1,
    title: <Trans context="turn step: roll the dice">Roll</Trans>,
    desc: (
      <Trans>
        Two dice decide which hexes pay out. Rolling is mandatory, and almost nothing else can
        happen first.
      </Trans>
    ),
    // The real pair, in the game's own colors: a white die and the red one the
    // engine designates d2 (and which Knights reads for progress-card draws).
    glyph: (
      <span className="flex gap-1">
        <Die n={5} size={22} />
        <Die n={3} variant="red" size={22} />
      </span>
    ),
  },
  {
    n: 2,
    title: <Trans context="turn step: collect production">Gather</Trans>,
    desc: (
      <Trans>Every player, not just you, collects from matching hexes their buildings touch.</Trans>
    ),
    glyph: <ResIcon slot={resIconSlot(4)} size={26} />,
  },
  {
    n: 3,
    title: <Trans context="turn step: trading">Trade</Trans>,
    desc: <Trans>Swap with the bank, your harbours, or other players.</Trans>,
    glyph: <ArrowsLeftRight weight="bold" size={22} />,
  },
  {
    n: 4,
    title: <Trans context="turn step: building">Build</Trans>,
    desc: (
      <Trans>
        Spend your cards on roads, settlements, cities, and development cards; play up to one
        development card.
      </Trans>
    ),
    glyph: <Piece kind="settlement" size={26} />,
  },
];

const baseChapters: Chapter[] = [
  {
    id: "base-goal",
    label: <Trans>Goal &amp; overview</Trans>,
    render: () => (
      <Sec
        id="base-goal"
        title={<Trans>The goal</Trans>}
        badge={
          <VP>
            <Trans>first to 10 points wins</Trans>
          </VP>
        }
      >
        <P>
          <Trans>
            Costanio is a game of settling and trading on a hex island. You collect five resources:{" "}
            <Chip k="wood" /> <Chip k="brick" /> <Chip k="sheep" /> <Chip k="wheat" />{" "}
            <Chip k="ore" />, and spend them to build out a road-and-settlement network, buy
            development cards, and out-trade your rivals.
          </Trans>
        </P>
        <P>
          <Trans>
            The first player to reach <Cfg>10 victory points</Cfg> <B>on their own turn</B> wins
            immediately. Points come from settlements, cities, the two special cards, and hidden
            victory-point cards.
          </Trans>
        </P>
        <P>
          <Trans>
            Numbers with a dotted underline, like the 10 above, are <B>table settings</B>: they are
            the defaults, and the host can change them when they create the game. Everything else on
            this page is a rule.
          </Trans>
        </P>
        <div className="grid grid-cols-4 gap-2.5 max-[640px]:grid-cols-2">
          {TURN_STEPS.map((s) => (
            <div
              key={s.n}
              className="bg-elev rounded-base p-3 flex flex-col items-center gap-1.5 text-center"
            >
              <div className="font-num text-[12px] font-medium text-muted tabular-nums">{s.n}</div>
              <div className="h-8 flex items-center">{s.glyph}</div>
              <div className="text-[13px] font-semibold">{s.title}</div>
              <div className="text-[13px] text-muted leading-[1.4]">{s.desc}</div>
            </div>
          ))}
        </div>
      </Sec>
    ),
  },
  {
    id: "base-setup",
    label: <Trans>Setup</Trans>,
    render: () => (
      <Sec id="base-setup" title={<Trans>Setting up the board</Trans>}>
        <P>
          <Trans>
            The board is a hexagon of hexes, and it <B>grows with the table</B>. Costanio seats 2 to
            10 players, so the classic 19-hex island is only the small size.
          </Trans>
        </P>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] text-muted border-collapse min-w-95">
            <thead>
              <tr className="text-foreground text-left">
                <th className={TH}>
                  <Trans context="board size table column: player count">Players</Trans>
                </th>
                <th className={TH}>
                  <Trans context="board size table column: number of hexes">Hexes</Trans>
                </th>
                <th className={TH}>
                  <Trans context="board size table column: which terrains, how many">
                    Land mix
                  </Trans>
                </th>
                <th className={TH_LAST}>
                  <Trans context="board size table column: harbours on the coast">Harbours</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {BOARD_SIZES.map((b) => (
                <tr key={b.players} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-semibold text-foreground">{b.players}</td>
                  <td className="py-1.5 pr-3">{b.hexes}</td>
                  <td className="py-1.5 pr-3">{i18n._(b.mix)}</td>
                  <td className="py-1.5">{i18n._(b.harbors)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          <Trans>
            Number chits come from the standard 18-chit bag: one 2, one 12, two each of 3–6 and
            8–11, and no 7. A 19-hex board is exactly that bag. Bigger boards keep the same{" "}
            <B>proportions</B> rather than repeating the bag, so <B>2 and 12 stay half as common</B>{" "}
            as every other number however large the island gets. Chits left over after the split go
            to whichever numbers are furthest short of their share.
          </Trans>
        </P>
        <P>
          <Trans>
            The two <span className="text-red-ink font-semibold">red numbers</span> (6 and 8) get
            special treatment twice over. They are <B>last in line</B> for those leftover chits, so
            a spare becomes a red only once every other number has been served, and no two of them
            are placed on adjacent hexes. On the largest boards perfect spacing is not always
            achievable, and the generator then keeps the layout with the fewest adjacent reds rather
            than failing.
          </Trans>
        </P>
        <P>
          <Trans>
            Boards with more than one desert put the robber on just one of them; the rest are simply
            blank.
          </Trans>
        </P>
        <P>
          <Trans>
            Each player has <B>5 settlements, 4 cities, and 15 roads</B>, at every table size. The
            bank holds <B>19 cards of each resource</B>, more in larger games, plus the
            development-card deck. Everything you spend goes <B>back to the bank</B>, which is why
            it can run short (see below) and then recover.
          </Trans>
        </P>
        <Panel title={<Trans>Placement: snake order</Trans>}>
          <Bullets
            items={[
              <Trans>
                Seating order is <Cfg>shuffled</Cfg> when the game starts, so the lobby order is not
                the turn order. Whoever ends up first places first.
              </Trans>,
              <Trans>
                In turn order, each player places <B>1 settlement</B>, then{" "}
                <B>1 road touching that settlement</B>. The settlement comes first, and the road
                must touch the piece you just placed.
              </Trans>,
              <Trans>
                Then in <B>reverse order</B>, each places a <B>second settlement and road</B>. The
                player who placed last therefore places twice in a row, and then takes the first
                real turn.
              </Trans>,
              <Trans>
                The <B>second</B> settlement immediately pays one resource for each adjacent
                producing hex. The first one pays nothing.
              </Trans>,
              <Trans>
                The <B>distance rule</B> applies to every settlement, in setup and forever after: no
                settlement may sit on an intersection one edge away from another settlement or city.
              </Trans>,
              <Trans>
                The robber starts on a <B>desert</B>, which produces nothing. (Islands can reshape
                the board so that no desert survives, and the robber then starts elsewhere. In a
                Fishermen or Caravans game it starts <B>beside the board</B> and only comes into
                play on the first 7.)
              </Trans>,
              <Trans>
                Setup is on its own short clocks: <Cfg>45 seconds</Cfg> for a settlement and{" "}
                <Cfg>15 seconds</Cfg> for its road. Run out and the server places{" "}
                <B>a random legal one</B> for you.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>In Knights, the second placement is a city</Trans>}>
          <P>
            <Trans>
              This is the one setup rule an expansion changes outright. In a Knights game your{" "}
              <B>second placement is a city, not a settlement</B>, so everyone opens with one
              settlement and one city. It still pays only <B>1 card per adjacent hex</B> (not 2, and
              no commodity), but it means you can improve and make commodities from the first turn,
              and that every player's starting city already counts toward the barbarians' strength.
            </Trans>
          </P>
        </Panel>
      </Sec>
    ),
  },
  {
    id: "base-turn",
    label: <Trans>Your turn</Trans>,
    render: () => (
      <Sec id="base-turn" title={<Trans>Your turn, step by step</Trans>}>
        <P>
          <Trans>
            Rolling comes first and everything else follows it, in whatever order you like. There is
            no separate trade phase and no separate build phase.
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              <B>Before you roll</B> you may play <B>one development card</B>, and place any free
              roads it gave you. That is the whole list. Buying, trading and building all wait.
            </Trans>,
            <Trans>
              <B>Roll</B> the two dice. Mandatory. If you played a knight first, you have to finish
              moving the robber before the roll is allowed.
            </Trans>,
            <Trans>
              <B>Production.</B> Every player, not just you, collects from hexes matching the roll
              where they have a building: <B>1 card per settlement, 2 per city</B>. A building
              touching two hexes that both show the number is paid for both. The robber's hex pays
              nothing.
            </Trans>,
            <Trans>
              <B>Trade</B> with the bank and your harbours, and with other players. Player trades
              happen only on the active player's turn, but everyone can respond to them.
            </Trans>,
            <Trans>
              <B>Build &amp; buy</B> roads, settlements, cities, and development cards, in any
              order, and play up to one development card if you have not already played one this
              turn.
            </Trans>,
            <Trans>
              <B>End your turn.</B> Anything you did not spend is kept, but unused free roads are
              lost and any trade offer still on the table is closed.
            </Trans>,
          ]}
        />
        <Panel title={<Trans>Production shortage (bank limit)</Trans>}>
          <P>
            <Trans>
              The bank is finite, and spending returns cards to it. If it can't pay everyone owed a
              given resource on a roll:
            </Trans>
          </P>
          <Bullets
            items={[
              <Trans>
                If <B>exactly one</B> player is owed that resource, they take whatever the bank has
                left.
              </Trans>,
              <Trans>
                If <B>two or more</B> players are owed it and the bank is short, <B>none of them</B>{" "}
                receive that resource. Other resources that roll are unaffected.
              </Trans>,
              <Trans>
                Your claim is totalled first. A player owed 3 wheat from a city and a settlement is
                one claimant for 3, not two claims of 2 and 1.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans context="chapter panel: turn timers">Clocks</Trans>}>
          <P>
            <Trans>
              Every turn is on a <Cfg>60 second</Cfg> clock, and the roll has its own{" "}
              <Cfg>15 second</Cfg> one. The turn clock is an <B>inactivity timer</B>, not a hard
              cap: each thing you do refloors it to at least 15 seconds, so a player who keeps
              acting is never cut off mid-turn. When a clock does run out the server plays the
              minimum legal move for that one decision and stops. See{" "}
              <B>Playing online → Clocks and auto-play</B> for exactly what it picks.
            </Trans>
          </P>
        </Panel>
      </Sec>
    ),
  },
  {
    id: "base-seven",
    label: <Trans context="chapter: what a roll of 7 does">Rolling a 7</Trans>,
    render: () => (
      <Sec id="base-seven" title={<Trans>Rolling a 7: the robber</Trans>}>
        <div className="flex items-start gap-3">
          <Prop slot="prop_robber" size={34} />
          <P>
            <Trans>A 7 produces nothing. Instead the robber moves and someone gets robbed.</Trans>
          </P>
        </div>
        <Bullets
          items={[
            <Trans>
              <B>Discard.</B> Every player holding <Cfg>more than 7</Cfg> resource cards discards
              half (rounded down), of their own choosing. Everyone owed a discard pays at the same
              time, the roller included, and <B>development cards don't count</B> toward the limit.
              Your discard must be exactly the required number, from cards you actually hold.
            </Trans>,
            <Trans>
              <B>Move the robber</B> to any other land hex (a desert is allowed, its current hex is
              not). Its hex stops producing. You can't move it until every discard is in.
            </Trans>,
            <Trans>
              <B>Steal.</B> <B>You choose the victim</B> from the opponents with a building on that
              hex, never yourself, and one of their cards is taken at random. If any of them has a
              card you must steal from one of them; if none of them holds anything, there is no
              steal. Only you and the victim learn which card moved.
            </Trans>,
          ]}
        />
        <Panel title={<Trans>Friendly robber (optional)</Trans>}>
          <P>
            <Trans>
              A host can turn on <Cfg>friendly robber</Cfg>. Then a player still at the visible
              score everyone starts with (<B>2 points</B>, or <B>3</B> in a game where setup deals a
              city) cannot be robbed at all, and you are not allowed to park the robber somewhere
              harmless to dodge the decision: if any hex would reach an unprotected player, you must
              choose one that does. A game with no robber (Wagons, Raiders, Explorers) has no such
              setting.
            </Trans>
          </P>
        </Panel>
      </Sec>
    ),
  },
  {
    id: "base-build",
    label: <Trans>Building &amp; costs</Trans>,
    render: () => (
      <Sec id="base-build" title={<Trans>What things cost</Trans>}>
        <div className="flex flex-col gap-2.5">
          <PieceRow
            kind="road"
            name={<Trans context="a road piece">Road</Trans>}
            cost="road"
            right={
              <span className="font-num text-[11px] font-medium text-muted tabular-nums">
                <Trans>limit 15</Trans>
              </span>
            }
          />
          <PieceRow
            kind="settlement"
            name={<Trans context="a settlement piece">Settlement</Trans>}
            cost="settlement"
            right={
              <VP>
                <Trans>+1 pt · limit 5</Trans>
              </VP>
            }
          />
          <PieceRow
            kind="city"
            name={<Trans context="a city piece">City</Trans>}
            cost="city"
            right={
              <VP>
                <Trans>+2 pts · limit 4</Trans>
              </VP>
            }
          />
          <PieceRow
            glyph={devCardGlyph}
            name={<Trans>Development Card</Trans>}
            cost="dev"
            right={
              <span className="font-num text-[11px] font-medium text-muted tabular-nums">
                <Trans>while the deck lasts</Trans>
              </span>
            }
          />
        </div>
        <Panel title={<Trans>Placement rules</Trans>}>
          <Bullets
            items={[
              <Trans>
                A <B>road</B> must connect to your own road, settlement, or city, and can't continue
                through an intersection holding an opponent's settlement or city. Each edge holds at
                most one road, and a road needs land on at least one side.
              </Trans>,
              <Trans>
                A <B>settlement</B> must satisfy the distance rule and touch one of your own
                connections. That means <B>a road of yours</B> in the base game, and in Islands a{" "}
                <B>ship of yours</B> counts too, which is how you colonise across water.
              </Trans>,
              <Trans>
                A <B>city</B> upgrades one of your own settlements, returning that settlement piece
                to your supply. Once all 5 settlements are on the board, upgrading one is the only
                way to get a settlement piece back.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "base-dev",
    label: <Trans>Development cards</Trans>,
    render: () => (
      <Sec id="base-dev" title={<Trans>Development cards</Trans>}>
        <P>
          <Trans>
            Buy one for <Cost items={costOf("dev")} />. You draw at random from what is left, and
            the card stays secret until you play it.
          </Trans>
        </P>
        <P>
          <Trans>
            The deck <B>grows with the table</B>, and only the knight and victory-point counts
            change: the three action cards stay at 2 each at every size.
          </Trans>
        </P>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] text-muted border-collapse min-w-90">
            <thead>
              <tr className="text-foreground text-left">
                <th className={TH}>
                  <Trans context="dev deck table column: player count">Players</Trans>
                </th>
                <th className={TH}>
                  <Trans context="dev deck table column: knight cards in the deck">Knights</Trans>
                </th>
                <th className={TH}>
                  <Trans context="dev deck table column: victory-point cards in the deck">
                    Victory point
                  </Trans>
                </th>
                <th className={TH_LAST}>
                  <Trans context="dev deck table column: copies of each action card">
                    Each action card
                  </Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {DEV_DECKS.map((d) => (
                <tr key={d.players} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-semibold text-foreground">{d.players}</td>
                  <td className="py-1.5 pr-3">{d.knights}</td>
                  <td className="py-1.5 pr-3">{d.vp}</td>
                  <td className="py-1.5">2</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
          {DEV_DECK_ORDER.map((id) => (
            <DevCardTile key={id} id={id} />
          ))}
        </div>
        <Panel title={<Trans context="panel: when you may play a card">Timing</Trans>}>
          <Bullets
            items={[
              <Trans>
                You may play at most <B>one</B> development card per turn, at any point, even{" "}
                <B>before rolling</B>.
              </Trans>,
              <Trans>
                A card <B>bought this turn can't be played this turn</B>. Victory-point cards are
                never "played", so this never holds them up: a victory-point card counts the moment
                you buy it, and buying one that takes you to the target <B>wins on the spot</B>.
              </Trans>,
              <Trans>
                When the deck runs out, <B>that's it</B>: there is no reshuffle and no more buying.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>Fine print worth knowing</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>Road Building</B> with only one road piece left gives you <B>one</B> road, and
                the card is still spent. With none left you can't play it at all. Free roads are
                placeable before you roll, and any you don't use are <B>lost at end of turn</B>.
              </Trans>,
              <Trans>
                <B>Year of Plenty</B> is all or nothing: the bank must cover both picks, or the card
                is not played. Both picks may be the same resource.
              </Trans>,
              <Trans>
                <B>Monopoly</B> against opponents who all hold none of it is still a legal play, and
                still uses up your card for the turn.
              </Trans>,
              <Trans>
                Everyone can see <B>that you bought a card</B> and <B>how many you hold</B>. Only
                you see which.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "base-special",
    label: <Trans>Special cards</Trans>,
    render: () => (
      <Sec
        id="base-special"
        title={<Trans>Largest Army &amp; Longest Road</Trans>}
        badge={
          <VP>
            <Trans>2 pts each</Trans>
          </VP>
        }
      >
        <Term name={<Trans>Largest Army</Trans>}>
          <Trans>
            The first player to play <B>3 knights</B> takes it. It passes only to a player who has
            played <B>strictly more</B> knights than the current holder, and a tie keeps the holder.
            Since knight counts only ever go up, this card can never be lost any other way: nothing
            on the board takes it off you.
          </Trans>
        </Term>
        <Term name={<Trans>Longest Road</Trans>}>
          <Trans>
            The first player with a continuous road of <B>5+ segments</B> takes it, and it passes
            only to a <B>strictly longer</B> road; a tie keeps the current holder.
          </Trans>
        </Term>
        <Panel title={<Trans>How the road is actually measured</Trans>}>
          <Bullets
            items={[
              <Trans>
                Only your <B>single longest path</B> counts. Branches are never added together, so a
                sprawling network can score worse than a straight line.
              </Trans>,
              <Trans>
                A path may not reuse the same road twice, but it{" "}
                <B>may pass through the same intersection twice</B>, which is why a loop counts
                every one of its segments.
              </Trans>,
              <Trans>
                <B>Your own</B> settlements and cities never break your road. Only an opponent's
                building does, and it cuts the path at that intersection.
              </Trans>,
              <Trans>
                If a break drops the holder below the lead, the card goes to the sole new leader at
                5+, or is <B>set aside entirely</B> if two or more tie for it. That set-aside also
                happens when a holder who is still at 5+ is overtaken by two players tied above
                them.
              </Trans>,
              <Trans>
                The title is recalculated whenever roads or settlements change (and, in Islands,
                whenever a ship is built or moved). Nothing else in the base game moves it.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "base-trade",
    label: <Trans context="chapter: trading">Trading</Trans>,
    render: () => (
      <Sec id="base-trade" title={<Trans context="chapter: trading">Trading</Trans>}>
        <P>
          <Trans>
            Two different things share the word. <B>Bank trades</B> are an exchange rate you can use
            on your own turn. <B>Player trades</B> are an offer everyone at the table can answer.
          </Trans>
        </P>
        <Panel title={<Trans>Trading with the bank</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>4:1</B> by default: four of one resource for one of another. You have to have
                rolled first, like any other action on your turn.
              </Trans>,
              <Trans>
                <B>3:1</B> if you have a building on a generic harbour, and <B>2:1</B> on the
                matching resource if you have a building on that resource's harbour. Each harbour
                spans <B>two coastal intersections</B>, and a settlement or city on either one
                qualifies you.
              </Trans>,
              <Trans>
                You never pick a rate: the game charges you the <B>best one you qualify for</B> on
                that resource, automatically.
              </Trans>,
              <Trans>
                You can do several at once, but the bank has to be able to cover the whole lot; if
                it can't, none of it happens.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>Trading with players</Trans>}>
          <Bullets
            items={[
              <Trans>
                Only the player whose turn it is can <B>open</B> an offer, and only resources may be
                traded (never development cards, and in Knights commodities count too). Each side
                must put up at least one card.
              </Trans>,
              <Trans>
                <B>You can't ask for the same resource you're offering.</B> Even a partial overlap,
                like 2 ore and 1 wheat for 1 ore, is rejected.
              </Trans>,
              <Trans>
                <B>Only one offer is open at a time.</B> Posting a new one silently replaces the
                old, discarding every response it had collected.
              </Trans>,
              <Trans>
                Every other player may accept, decline, or <B>counter</B> with terms of their own.
                An answer is <B>not final</B>: while the offer stands you can change it, replace a
                counter with different terms, or take it back entirely, as often as you like. Only
                sending the same answer twice is refused.
              </Trans>,
              <Trans>
                Several people may accept. The player who opened it then picks who to deal with, and
                the trade is <B>re-checked at that moment</B>, so a deal can fall through if either
                side has spent the cards in the meantime.
              </Trans>,
              <Trans>
                An offer expires on a window of <Cfg>half the turn timer</Cfg>, held between 15 and
                30 seconds, measured from when it was posted; responses don't extend that. The
                offerer may cancel at any time, and every offer closes at end of turn.
              </Trans>,
              <Trans>
                All of it is <B>public</B>: the terms, who accepted, who declined, and what was
                finally traded.
              </Trans>,
              <Trans>
                <B>Bots do trade with players.</B> They will consider an offer aimed at the table,
                and they make offers of their own, so it is worth including them.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "base-victory",
    label: <Trans context="chapter: how to win">Winning</Trans>,
    render: () => (
      <Sec
        id="base-victory"
        title={<Trans>Winning the game</Trans>}
        badge={
          <VP>
            <Trans>10 points</Trans>
          </VP>
        }
      >
        <P>
          <Trans>
            The first player to <Cfg>10 victory points</Cfg> <B>on their own turn</B> wins. Points
            come from:
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              Settlement: <B>1</B> each · City: <B>2</B> each
            </Trans>,
            <Trans>
              Largest Army: <B>2</B> · Longest Road: <B>2</B>
            </Trans>,
            <Trans>
              Each hidden victory-point development card: <B>1</B>
            </Trans>,
          ]}
        />
        <Panel title={<Trans>Only on your own turn</Trans>}>
          <P>
            <Trans>
              The score is checked <B>after each thing you do on your own turn</B>, and at no other
              moment. If someone else's move pushes you to the target, nothing happens then; you win
              at your next action, usually the roll at the start of your turn. That is also why a
              hidden victory-point card can sit in your hand for several turns and only then end the
              game.
            </Trans>
          </P>
          <P>
            <Trans>
              Opponents see your <B>public</B> score, which leaves out hidden victory-point cards,
              so the scoreboard reads lower than your real total. Your own display shows the truth.
            </Trans>
          </P>
        </Panel>
        <Panel title={<Trans>Other ways a game ends</Trans>}>
          <Bullets
            items={[
              <Trans>
                Everyone leaves and nobody is watching: the game is <B>abandoned</B> after a few
                minutes, with no winner.
              </Trans>,
              <Trans>
                A game that runs extraordinarily long is <B>force-finished</B>, and the win goes to
                the leader by most points, then most cities, most settlements, most knights played,
                and longest road.
              </Trans>,
              <Trans>
                If the server ever catches itself in an inconsistent state it <B>pauses the game</B>{" "}
                rather than guessing. Nothing is lost, and nothing can be played on afterwards.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
];

/* --------------------------- ISLANDS ------------------------------ */

const islandsChapters: Chapter[] = [
  {
    id: "isl-overview",
    label: <Trans context="chapter: expansion overview">Overview</Trans>,
    render: () => (
      <Sec id="isl-overview" title={<Trans>Islands: sail to new shores</Trans>}>
        <P>
          <Trans>
            Islands layers onto the base game; only the differences below change. The board mixes a
            starting island with outer islands across open sea, and adds <B>ships</B>,{" "}
            <B>gold hexes</B>, and the <B>pirate</B>.
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              <B>Sea hexes</B> (water) and <B>gold hexes</B> join the land terrains.
            </Trans>,
            <Trans>
              Each player gets a supply of <B>15 ships</B>, a second connection piece alongside
              roads.
            </Trans>,
            <Trans>
              The <B>pirate</B> is a sea-going counterpart to the robber.
            </Trans>,
            <Trans>
              An Islands game <B>requires a map with sea</B>: pick an Islands map such as Shores or
              Archipelago, or paint water into a custom map in the map builder.
            </Trans>,
            <Trans>
              Islands stacks with the other expansions. In a Knights game the pirate steals from
              commodities as well as resources, and enemy knights break your trade routes.
            </Trans>,
            <Trans>
              Knights go to sea with you. A knight moves along your <B>roads and your ships</B>, and
              may finish its move on an empty intersection out in open water. The two networks are
              one route only where they meet at <B>a settlement or city of yours</B>, so a knight
              boards and lands at your own buildings. A knight may also be raised at the end of one
              of your ships, though never on a sea intersection.
            </Trans>,
            <Trans>
              A knight out at sea keeps its way home: you <B>may not move a ship</B> that a knight
              of yours is standing on the end of. And a knight on a sea intersection{" "}
              <B>chases the pirate</B> off its hex exactly as a knight on land chases the robber.
            </Trans>,
          ]}
        />
      </Sec>
    ),
  },
  {
    id: "isl-ships",
    label: <Trans context="chapter: the ship piece">Ships</Trans>,
    render: () => (
      <Sec id="isl-ships" title={<Trans>Building ships</Trans>}>
        <P>
          <Trans>
            A <B>ship</B> is your second connection piece. Where a road runs over land, a ship runs
            over water, so your network can cross open sea to reach the outer islands. You start
            with a supply of <B>15</B>.
          </Trans>
        </P>
        <PieceRow
          kind="ship"
          name={<Trans context="a ship piece">Ship</Trans>}
          cost="ship"
          right={
            <span className="font-num text-[11px] font-medium text-muted tabular-nums">
              <Trans>limit 15</Trans>
            </span>
          }
        />
        <Bullets
          items={[
            <Trans>
              A ship goes on a <B>sea edge</B>, an edge bordering at least one sea hex. Roads can't
              cross open water, so ships are what carry your network out to sea.
            </Trans>,
            <Trans>
              A new ship must <B>extend your own network</B>: place it next to one of your ships, or
              out from one of your coastal settlements or cities, on any island you occupy. An
              opponent's settlement or city on an intersection <B>cuts your chain</B> there, exactly
              as it cuts a road.
            </Trans>,
            <Trans>
              One sea edge holds <B>at most one ship</B>, and your ships block opponents' routes
              just like roads.
            </Trans>,
            <Trans>
              A coastal edge takes <B>one road or one ship, never both</B>. Laying a road along a
              shoreline permanently closes that lane to shipping, and a ship closes it to roads.
            </Trans>,
            <Trans>
              Ships never come back to your supply. Once all 15 are placed, moving one is your only
              option.
            </Trans>,
          ]}
        />
        <Panel title={<Trans>Ships settle new land</Trans>}>
          <P>
            <Trans>
              This is what ships are <B>for</B>. A settlement normally has to touch a road of yours,
              but <B>a ship anchors a settlement too</B>: sail a chain to an empty shore and you can
              found a settlement at its far end with no road anywhere near it. The distance rule
              still applies, and the intersection still has to touch land.
            </Trans>
          </P>
        </Panel>
        <Panel title={<Trans>Setup, and free builds</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>You start on the main island.</B> Both setup placements (in Knights, the
                settlement and the city) go on the board's main island, and the small islands are
                what your ships are for. A map of similar-sized islands, like the Archipelago, has
                no main island, and there you may start on any island. A host can allow any island
                on every map with the <Cfg>Starting island</Cfg> setting.
              </Trans>,
              <Trans>
                The main island is the <B>largest landmass</B>, when it holds more than half of all
                the land and at least twice as much as the next largest. Every generated board has
                one.
              </Trans>,
              <Trans>
                A coastal starting settlement may open with a <B>ship instead of a road</B>. That
                setup ship is free, and unlike a ship you build it is{" "}
                <B>movable on your first turn</B>.
              </Trans>,
              <Trans>
                The two free builds from the <B>Road Building</B> development card may each be a
                road <B>or a ship</B>: two roads, two ships, or one of each.
              </Trans>,
              <Trans>
                Either free build may be placed <B>before you roll</B>. The card is playable then,
                and its free ship is exempt from the rule that otherwise lets you build ships only
                after you roll.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>Roads and ships meet only at a building</Trans>}>
          <P>
            <Trans>
              Roads and ships join into one continuous route, but they{" "}
              <B>don't connect end-to-end on their own</B>. A ship hands off to a road, or a road to
              a ship, only by passing <B>through your own settlement or city</B> at that
              intersection.
            </Trans>
          </P>
          <div className="flex items-center gap-2.5 text-[13px] text-muted flex-wrap">
            <span className="flex items-center gap-1.5">
              <Piece kind="road" /> <Trans context="road piece, mid-sentence">road</Trans>
            </span>
            <span className="text-foreground">→</span>
            <span className="flex items-center gap-1.5">
              <Piece kind="settlement" />{" "}
              <Trans context="a settlement or city of the reader's own">your building</Trans>
            </span>
            <span className="text-foreground">→</span>
            <span className="flex items-center gap-1.5">
              <Piece kind="ship" /> <Trans context="ship piece, mid-sentence">ship</Trans>
            </span>
          </div>
        </Panel>
      </Sec>
    ),
  },
  {
    id: "isl-move",
    label: <Trans>Moving ships</Trans>,
    render: () => (
      <Sec
        id="isl-move"
        title={<Trans>Moving a ship</Trans>}
        badge={
          <Badge tone="muted" type="label">
            <Trans>once per turn</Trans>
          </Badge>
        }
      >
        <P>
          <Trans>
            Stuck behind your own pieces? Once per turn you may pick up and re-sail{" "}
            <B>one open ship</B>, a ship with a <B>free end</B>, one not anchored by your
            settlement, city, or another of your ships.
          </Trans>
        </P>
        <P>
          <Trans>
            To move one, <B>tap the ship</B> on the board and choose Move ship, then tap one of the
            highlighted sea edges. Cancel puts it back where it was.
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              A <B>road never anchors a ship</B>. Since roads and ships only meet through a
              building, a road touching a ship's end still leaves that end free to move.
            </Trans>,
            <Trans>
              You can't move a ship <B>the turn you built it</B>, and a ship with neither end open
              can't move at all: a building of yours at one end and your own continuing ship at the
              other pins it just as two buildings do.
            </Trans>,
            <Trans>
              Set it down on any legal sea edge that still connects to your network{" "}
              <B>without counting the ship being moved</B>, so you can't leap-frog a chain forward
              off its own hull. You also can't put it back where it came from. It's a relocation,
              not a new ship, so it <B>costs nothing</B> and it stays movable on later turns.
            </Trans>,
            <Trans>
              The pirate freezes ships <B>both ways</B>: you can't move a ship that borders the
              pirate's hex, and you can't move or build one onto an edge beside it.
            </Trans>,
            <Trans>
              Moving recalculates the <B>Longest Trade Route</B>, so re-sailing a ship can hand the
              card to someone else.
            </Trans>,
          ]}
        />
        <Panel title={<Trans>Loops are not stuck</Trans>}>
          <P>
            <Trans>
              A ship whose ends are both busy is usually frozen, but two shapes are exceptions worth
              knowing. A <B>ring of ships with no building of yours on it</B> is entirely movable,
              every ship in it. And a route that leaves one of your settlements and loops back to
              that same settlement, with no other building on it, leaves the{" "}
              <B>two ships touching that settlement</B> free. Only a chain carrying{" "}
              <B>two or more</B> of your buildings is genuinely locked.
            </Trans>
          </P>
        </Panel>
      </Sec>
    ),
  },
  {
    id: "isl-pirate",
    label: <Trans>The pirate</Trans>,
    render: () => (
      <Sec id="isl-pirate" title={<Trans>The pirate</Trans>}>
        <div className="flex items-start gap-3">
          <Prop slot="prop_pirate" size={34} />
          <P>
            <Trans>
              The pirate is the robber's counterpart at sea. On a 7, or when you play a knight, you
              move <B>either the land robber or the pirate, never both</B>.
            </Trans>
          </P>
        </div>
        <Bullets
          items={[
            <Trans>
              <B>It does not start on the board.</B> There is no pirate anywhere until a player
              first chooses to move it, and until then it blocks nothing.
            </Trans>,
            <Trans>
              It goes on <B>any sea hex except the one it is already on</B>, whether or not there
              are ships there.
            </Trans>,
            <Trans>
              It <B>blocks ship building and movement</B> on every adjacent sea edge, including{" "}
              <B>your own</B> ships. It does not stop production, roads, buildings or trade.
            </Trans>,
            <Trans>
              You then <B>choose a victim</B> among players with a ship next to it who hold a card,
              and take one at random. As with the robber, if such a victim exists you must steal.
            </Trans>,
            <Trans>
              The <B>friendly robber</B> setting protects low-scoring players from the pirate too,
              and forces you onto a hex that actually robs someone when one exists.
            </Trans>,
            <Trans>
              A host can <Cfg>turn the pirate off</Cfg> entirely. Then a 7 is always the land
              robber.
            </Trans>,
          ]}
        />
      </Sec>
    ),
  },
  {
    id: "isl-gold",
    label: <Trans>Gold hexes</Trans>,
    render: () => (
      <Sec
        id="isl-gold"
        title={<Trans>Gold hexes</Trans>}
        badge={<span className="w-3.5 h-3.5 rounded-full bg-gold" />}
      >
        <P>
          <Trans>
            A gold hex pays its adjacent builders <B>resources of their own free choice</B>: one per
            adjacent settlement, two per adjacent city. A gold hex sitting <B>under the robber</B>{" "}
            produces nothing, like any other hex.
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              Every player with a building on the hex is owed a pick, not just whoever rolled, and{" "}
              <B>the game waits for all of them</B>. Nobody can act, and the turn cannot end, until
              every gold pick is in. Run out of time and the server picks for you.
            </Trans>,
            <Trans>
              Picks come out of the bank: each card you name has to be in stock, and your pick is
              capped by what the bank holds in total. With an empty bank you take nothing and the
              game moves on.
            </Trans>,
            <Trans>
              A <B>second setup settlement</B> next to gold owes a pick too, one per adjacent gold
              hex, taken during setup. In Knights, where the second placement is a city, it is still{" "}
              <B>one</B> pick per gold hex. Gold usually sits on the outer islands, so this happens
              only where you may start off the main island.
            </Trans>,
            <Trans>
              Gold hexes sit where the map puts them, each keeping its number chit. Hand-made maps
              can place them anywhere.
            </Trans>,
          ]}
        />
      </Sec>
    ),
  },
  {
    id: "isl-route",
    label: <Trans>Longest Trade Route</Trans>,
    render: () => (
      <Sec
        id="isl-route"
        title={<Trans>Longest Trade Route</Trans>}
        badge={
          <VP>
            <Trans>2 pts</Trans>
          </VP>
        }
      >
        <P>
          <Trans>
            The Longest Road card becomes the <B>Longest Trade Route</B>: your longest continuous
            path counts <B>roads and ships together</B>, joined only at your own settlements and
            cities. The 5-segment minimum, the strictly-longer rule and the tie handling are
            unchanged from the base game.
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              Your score is the <B>better</B> of your best road-only route and your best mixed
              route, so adding ships can never make your score worse.
            </Trans>,
            <Trans>
              Relocating a ship <B>can</B> make it worse, because the title is recalculated on every
              ship build and every ship move.
            </Trans>,
            <Trans>
              Playing Knights as well? An enemy <B>knight</B> standing on an intersection breaks a
              mixed route through it, just as an enemy building does.
            </Trans>,
          ]}
        />
      </Sec>
    ),
  },
  {
    id: "isl-explore",
    label: <Trans>Exploration points</Trans>,
    render: () => (
      <Sec
        id="isl-explore"
        title={<Trans>The island bonus</Trans>}
        badge={
          <VP>
            <Trans>+2 per new island</Trans>
          </VP>
        }
      >
        <P>
          <Trans>
            Reaching across the water rewards you: the{" "}
            <B>first settlement a player builds on an island they don't already occupy</B> earns the
            island bonus, <Cfg>2 points</Cfg>, so every new shore you reach during the game pays out
            once.
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              <B>Only during play.</B> Your two setup placements never earn the bonus, however far
              apart they are, and the island you start on is one you already occupy. Starting on the
              main island, your first settlement on each outer island earns it.
            </Trans>,
            <Trans>
              "Already occupy" means <B>any</B> building of yours already touching that landmass,
              and each island pays you <B>once</B> however many settlements you go on to build
              there.
            </Trans>,
            <Trans>
              The bonus is <B>per player</B>, not a race: every player can claim the same island.
            </Trans>,
            <Trans>
              It is <B>permanent and public</B>. Nothing takes it back, and opponents can see it.
            </Trans>,
            <Trans>
              A host can set the island bonus to <Cfg>0</Cfg>, which switches it off completely.
            </Trans>,
          ]}
        />
      </Sec>
    ),
  },
];

/* --------------------------- KNIGHTS ------------------------------ */

/**
 * The three improvement tracks, by engine index (0 Trade, 1 Politics,
 * 2 Science). Drawn in TRACK_ROW order, as everywhere else in the app.
 */
/*
 * `title` is a whole message per track rather than "{track} · costs
 * {commodity}", since the grammar depends on a word only known at render (see
 * src/locales/README.md).
 */
const TRACKS: Record<number, { name: MessageDescriptor; title: MessageDescriptor; good: ResKey }> =
  {
    0: {
      name: msg({ message: "Trade", context: "city improvement track" }),
      title: msg({ message: "Trade · costs cloth", context: "city improvement track heading" }),
      good: "cloth",
    },
    1: {
      name: msg({ message: "Politics", context: "city improvement track" }),
      title: msg({ message: "Politics · costs coin", context: "city improvement track heading" }),
      good: "coin",
    },
    2: {
      name: msg({ message: "Science", context: "city improvement track" }),
      title: msg({ message: "Science · costs paper", context: "city improvement track heading" }),
      good: "paper",
    },
  };

/**
 * One improvement track, all five levels. The reward text comes from
 * lib/improvements, the same strings as the upgrade tile's tooltip.
 */
function ImproveTrack({ track }: { track: number }) {
  const t = TRACKS[track];
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <ResIcon slot={GOODS[t.good].slot} size={16} />
          {i18n._(t.title)}
        </span>
      }
    >
      <div className="flex flex-col gap-1">
        {[1, 2, 3, 4, 5].map((lvl) => (
          <div key={lvl} className="flex items-start gap-2 text-[13px] leading-normal">
            <span className="font-num text-[11px] font-medium text-foreground tabular-nums shrink-0 w-21 pt-px">
              <Trans context="city improvement track rung">Level {lvl}</Trans> · {lvl}
              {"×"}
            </span>
            <span className="text-muted">{improvementReward(track, lvl)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/**
 * One progress deck, every card in it, with its face and its count. Names and
 * rule text come from lib/progressCards (used by the game's prompts and hover
 * hints), counts from PROGRESS_COUNTS (pinned to the engine by a drift test),
 * and the art is the baked face used in play.
 */
/*
 * Written out per deck for the same reason as ImproveTrack's heading: a deck
 * name dropped into a frame cannot be inflected correctly.
 */
const DECK_HEADING: Record<ProgressDeck, MessageDescriptor> = {
  trade: msg({ message: "Trade deck · 18 cards", context: "progress card deck heading" }),
  politics: msg({ message: "Politics deck · 18 cards", context: "progress card deck heading" }),
  science: msg({ message: "Science deck · 18 cards", context: "progress card deck heading" }),
};

function ProgressDeckList({ deck }: { deck: ProgressDeck }) {
  const look = PROGRESS_DECK_LOOK[deck];
  const cards = progressDeckCards(deck);
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-full bg-(--swatch)"
            style={{ "--swatch": look.color } as CSSProperties}
          />
          {i18n._(DECK_HEADING[deck])}
        </span>
      }
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5">
        {cards.map((id) => (
          <div key={id} className="flex gap-2.5">
            <CardFace
              slot={progressSlot(id)}
              className="w-11.5 h-auto shrink-0 rounded-[3px] border border-border self-start"
            />
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="text-[13px] font-semibold leading-tight flex items-baseline gap-1.5">
                {PROGRESS_CARDS[id].name}
                <span className="font-num text-[11px] font-medium text-muted tabular-nums shrink-0">
                  ×{PROGRESS_COUNTS[id]}
                </span>
              </div>
              <div className="text-[12px] text-muted leading-[1.4]">{PROGRESS_CARDS[id].hint}</div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

const knightsChapters: Chapter[] = [
  {
    id: "ck-overview",
    label: <Trans context="chapter: expansion overview">Overview</Trans>,
    render: () => (
      <Sec
        id="ck-overview"
        title={<Trans>Knights: defend the island</Trans>}
        badge={
          <VP>
            <Trans>first to 13 points</Trans>
          </VP>
        }
      >
        <P>
          <Trans>
            Knights is the deepest mode. The victory target rises to <Cfg>13</Cfg>. There are{" "}
            <B>no development cards and no Largest Army</B>; their roles pass to{" "}
            <B>progress cards</B> and <B>knight pieces</B>. Cities now produce <B>commodities</B>,
            an event die drives <B>barbarian raids</B>, and three improvement tracks unlock powerful
            abilities.
          </Trans>
        </P>
        <Panel title={<Trans>What changes before the first turn</Trans>}>
          <Bullets
            items={[
              <Trans>
                Your <B>second setup placement is a city</B>, not a settlement, so everyone opens
                with one settlement and one city. It still pays just 1 card per adjacent hex, and no
                commodity.
              </Trans>,
              <Trans>
                That means every player can improve and make commodities immediately, and every
                player's starting city already counts toward the barbarians' attack strength.
              </Trans>,
              <Trans>
                Longest Road still exists and is still worth 2. Largest Army does not exist at all.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "ck-commodities",
    label: <Trans>Commodities</Trans>,
    render: () => (
      <Sec id="ck-commodities" title={<Trans>Commodities, and how to trade them</Trans>}>
        <P>
          <Trans>
            A city on commodity terrain splits its output: instead of 2 resources it yields{" "}
            <B>1 resource and 1 commodity</B>. Settlements are unchanged, and always yield just the
            base resource.
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              City on a <B>forest hex</B> → <Chip k="wood" /> <B>and</B> <Chip k="paper" />
            </Trans>,
            <Trans>
              City on a <B>pasture hex</B> → <Chip k="sheep" /> <B>and</B> <Chip k="cloth" />
            </Trans>,
            <Trans>
              City on a <B>mountain hex</B> → <Chip k="ore" /> <B>and</B> <Chip k="coin" />
            </Trans>,
            <Trans>
              Field and clay hexes have <B>no commodity</B>, so a city there simply yields 2 wheat
              or 2 brick as usual.
            </Trans>,
            <Trans>
              The resource and the commodity come from <B>different stacks</B>, so a shortage of one
              never costs you the other.
            </Trans>,
          ]}
        />
        <Panel title={<Trans>Trading commodities</Trans>}>
          <Bullets
            items={[
              <Trans>
                Commodities trade with the supply at <B>4:1</B>, or <B>3:1</B> if you hold a generic
                harbour.
              </Trans>,
              <Trans>
                A harbour prices what you <B>give</B>. So a 2:1 harbour never applies to a commodity
                you give, but a resource you give keeps its 2:1 even when what you are buying is a
                commodity: 2 wood at a wood harbour buys 1 paper. There is no such thing as a paper
                harbour.
              </Trans>,
              <Trans>
                The only ways to reach 2:1 on a commodity are the <B>Merchant Guild</B> (Trade level
                3) and the <B>Merchant Fleet</B> progress card, and each has its own restrictions.
                The <B>Merchant token</B> is not one of them: it only ever discounts the resource of
                the hex it stands on.
              </Trans>,
              <Trans>
                Player-to-player trades <B>can</B> include commodities, and you can swap resources
                for commodities and commodities for other commodities with the supply.
              </Trans>,
              <Trans>
                Commodities are a <B>limited supply</B> like resources, and the stacks{" "}
                <B>grow with the table</B>: 12 of each at 3–4 players, 18 at 5–6, and up again from
                there. Cards you spend go back, but a stack can run out, and then production of it
                is withheld and a trade for it is refused.
              </Trans>,
              <Trans>
                Opponents see <B>how many</B> commodities you hold in total, but not which.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "ck-improve",
    label: <Trans>City improvements</Trans>,
    render: () => (
      <Sec id="ck-improve" title={<Trans>City improvements: three tracks</Trans>}>
        <P>
          <Trans>
            Each city owner improves along three tracks, paying that track's commodity. Advancing to
            level <B>n</B> costs <B>n</B> of it: 1, then 2, up to 5, so a full track costs 15. You
            must <B>own at least one city</B> to improve at all.
          </Trans>
        </P>
        <P>
          <Trans>
            Every level does two things: it raises your chance of drawing that track's{" "}
            <B>progress cards</B>, and levels 3, 4 and 5 unlock something outright. At level{" "}
            <B>0 you never draw</B>.
          </Trans>
        </P>
        {TRACK_ROW.map((track) => (
          <ImproveTrack key={track} track={track} />
        ))}
        <Panel title={<Trans>Metropolis: the fine print</Trans>}>
          <Bullets
            items={[
              <Trans>
                Reaching <B>level 4</B> builds a <B>metropolis</B> on one of your cities if nobody
                holds that track's yet: <VP>+2 pts</VP>, and that city can no longer be pillaged by
                barbarians. Reaching level 4 when someone else already holds it still gets you{" "}
                <B>the level</B> and its wider draw range, but <B>not the metropolis</B>; you have
                to reach 5 and take it.
              </Trans>,
              <Trans>
                <B>Level 5 is permanent.</B> A steal needs a strictly higher level and 5 is the cap,
                so a level-5 holder can never be dislodged.
              </Trans>,
              <Trans>
                Each of your metropolises sits on a <B>different city</B>, and{" "}
                <B>you choose which one</B>. It matters: a metropolis city can never be pillaged by
                the barbarians, so the choice decides which of your cities becomes permanently safe.
                With exactly one city free of a metropolis you are not asked, and if every city you
                own already carries one, the level-4 or level-5 purchase is <B>rejected outright</B>{" "}
                until you build another city.
              </Trans>,
              <Trans>Losing a metropolis to a level-5 rival takes its 2 points with it.</Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "ck-barbarians",
    label: <Trans>Event die &amp; barbarians</Trans>,
    render: () => (
      <Sec id="ck-barbarians" title={<Trans>The event die &amp; the barbarians</Trans>}>
        <div className="flex items-start gap-3">
          <Prop slot="prop_barbarian" size={34} />
          <P>
            <Trans>
              Each turn you roll the two production dice <B>plus an event die</B>. It shows either a{" "}
              <B>barbarian ship</B> or one of three colored gates (matching the three improvement
              tracks). The event die is rolled every turn, <B>including on a 7</B>, and it resolves{" "}
              <B>before</B> production and before any discarding.
            </Trans>
          </P>
        </div>
        <Bullets
          items={[
            <Trans>
              <B>Barbarian ship:</B> the fleet advances one step along its track. The track is{" "}
              <Cfg>7 steps</Cfg> long. When the fleet arrives, it attacks.
            </Trans>,
            <Trans>
              <B>Colored gate:</B> everyone at <B>level 1 or higher</B> on that track draws a{" "}
              <B>progress card</B> from its deck if the{" "}
              <B>red production die is at most their level + 1</B>. Level 1 draws on a red 1–2,
              level 5 draws on anything. Level 0 never draws.
            </Trans>,
            <Trans>
              Because the event die rides the same roll, resolving before production, a city
              pillaged on that roll produces as a settlement, and a wall lost on that roll no longer
              protects you from that same 7.
            </Trans>,
            <Trans>
              A host can turn on <Cfg>skip the first attack</Cfg>, which lets the fleet arrive once
              harmlessly. It still counts as an attack for everything that depends on one, including
              waking the robber, but no knight stands down and no Defender token is awarded.
            </Trans>,
          ]}
        />
        <Panel title={<Trans>When the fleet attacks</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>Attack strength</B> = the number of cities on the board (a metropolis still
                counts as a city here).
              </Trans>,
              <Trans>
                <B>Defense strength</B> = the summed levels of all <B>active</B> knights across all
                players.
              </Trans>,
              <Trans>
                <B>Defense ≥ attack, repelled:</B> the player with the single strongest knight
                contribution earns a <B>Defender token</B> <VP>+1 pt</VP>. Defender tokens are{" "}
                <B>repeatable</B>: every raid you lead the defence against is another point. If two
                or more tie for strongest, each tied player instead <B>draws a progress card</B>,
                choosing which deck, and nobody gets the point.
              </Trans>,
              <Trans>
                <B>Defense {"<"} attack, barbarians win:</B> among players who actually have a city
                left to lose, those with the weakest knight contribution each lose one, and{" "}
                <B>the owner chooses which of their cities</B> is razed. A metropolis is never
                taken, and a player whose only cities are metropolises is left out of the
                calculation altogether, so they cannot absorb the loss for anyone else. If every
                city on the board is a metropolis, nobody loses anything.
              </Trans>,
              <Trans>
                A razed city becomes a settlement. If you have <B>no settlement piece left</B>, the
                city is laid on its side instead: it counts as a settlement, and you must{" "}
                <B>upgrade it back before you may upgrade any other settlement</B>.
              </Trans>,
              <Trans>
                After any attack, <B>all knights deactivate</B> and the fleet resets to the start of
                its track.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "ck-knights",
    label: <Trans context="chapter: the knight piece">Knights</Trans>,
    render: () => (
      <Sec id="ck-knights" title={<Trans context="chapter: the knight piece">Knights</Trans>}>
        <P>
          <Trans>
            Knights are pieces placed on <B>intersections</B> (not roads), in three levels:{" "}
            <B>strength 1, 2 and 3</B>. You have <B>six pieces in all: two of each level</B>, and
            that supply is a real constraint. Promotion consumes a piece <B>at the level above</B>,
            so with both strength 2 knights already on the board you cannot promote a strength 1
            knight, however much you can afford.
          </Trans>
        </P>
        <div className="flex flex-col gap-2.5">
          <PieceRow
            kind="knight"
            name={<Trans>Build strength 1</Trans>}
            cost="knight"
            right={
              <span className="font-num text-[11px] font-medium text-muted tabular-nums">
                <Trans>on an intersection on your roads</Trans>
              </span>
            }
          />
          <PieceRow
            glyph={<Lightning weight="fill" size={20} />}
            name={<Trans context="make a knight active">Activate</Trans>}
            items={[["wheat", 1]]}
            right={
              <span className="font-num text-[11px] font-medium text-muted tabular-nums">
                <Trans>can't act this turn</Trans>
              </span>
            }
          />
          <PieceRow
            glyph={<ArrowFatUp weight="bold" size={20} />}
            name={<Trans context="raise a knight's level">Promote</Trans>}
            cost="knight"
            right={
              <span className="font-num text-[11px] font-medium text-muted tabular-nums">
                <Trans>one promotion per knight per turn</Trans>
              </span>
            }
          />
        </div>
        <Panel title={<Trans>Placing and paying for them</Trans>}>
          <Bullets
            items={[
              <Trans>
                A knight goes on an <B>empty intersection touching one of your own roads</B>. The
                distance rule does not apply to knights, so they can stand right next to buildings.
              </Trans>,
              <Trans>
                A newly built knight is <B>inactive</B>, and activating it costs wheat and locks it
                for that turn, so a knight is never useful the turn you build it.
              </Trans>,
              <Trans>
                Each knight may be promoted <B>once per turn</B>, so two different knights can both
                go up in the same turn if you can pay. What is barred is walking one knight from
                strength 1 to 3 in a single turn. The Smith progress card promotes two knights for
                free, and it obeys the same once per knight limit.
              </Trans>,
              <Trans>
                Promoting to <B>strength 3</B> additionally requires <B>Politics level 3</B>, the
                Fortress.
              </Trans>,
              <Trans>
                Knights travel your <B>routes</B>: your roads, and in an Islands game your ships as
                well. The two networks count as one route only where they meet at a settlement or
                city of yours, so a knight boards and lands at your own buildings. A knight may be
                raised at the end of one of your ships, though never on a sea intersection.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>Actions: one per active knight per turn</Trans>}>
          <P>
            <Trans>
              Only an <B>active</B> knight can act, and never the turn it was activated. Acting
              turns the knight inactive again.
            </Trans>
          </P>
          <P>
            <Trans>
              <B>Tap one of your knights</B> on the board to see what it can do: activate, promote,
              move, or chase the robber. An action you cannot take yet is shown greyed, and pointing
              at it says why.
            </Trans>
          </P>
          <Bullets
            items={[
              <Trans>
                <B>Move:</B> travel along your connected routes, roads and ships alike, to a new{" "}
                <B>empty</B> intersection. It may pass straight <B>through your own</B> buildings
                and knights on the way; only an opponent's piece blocks the path. It just cannot
                stop on an occupied intersection.
              </Trans>,
              <Trans>
                <B>Displace:</B> move onto a <B>strictly weaker</B> enemy knight's intersection. Its
                owner then relocates it to{" "}
                <B>any empty intersection their own routes still reach</B> from the contested one,
                however far along the network that is, or it is removed from the board if there is
                none.
              </Trans>,
              <Trans>
                <B>Chase the robber:</B> push the robber off an adjacent hex to any other land hex,
                then steal one random card from the victim's resources and commodities together. The
                knight deactivates where it stands. A knight standing on a sea intersection chases
                the <B>pirate</B> off its hex the same way.
              </Trans>,
            ]}
          />
          <P>
            <Trans>
              Active knights add their level to barbarian defense. Any knight, active or not,
              occupies its intersection, blocks an opponent's road there and{" "}
              <B>breaks their longest route</B> through it, exactly like a building. Every knight
              deactivates after a barbarian attack.
            </Trans>
          </P>
        </Panel>
      </Sec>
    ),
  },
  {
    id: "ck-progress",
    label: <Trans>Progress cards</Trans>,
    render: () => (
      <Sec
        id="ck-progress"
        title={<Trans>Progress cards</Trans>}
        badge={
          <Badge tone="muted" type="label">
            <Trans>hand limit 4</Trans>
          </Badge>
        }
      >
        <P>
          <Trans>
            Progress cards replace the base game's development cards. There are <B>54</B> of them in
            three decks of 18, one per track, and you draw them from the event die's gates rather
            than buying them. Every card in the game is listed below, with how many of it the deck
            holds.
          </Trans>
        </P>
        <Panel title={<Trans>Holding and playing progress cards</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>Every card is played on your own turn, after you roll.</B> The one exception is{" "}
                <B>Alchemist</B>, which must be played <B>before</B> the roll. There are no
                interrupts: you can never play one on someone else's turn.
              </Trans>,
              <Trans>
                A card <B>may be played the same turn you draw it</B>, unlike a development card.
              </Trans>,
              <Trans>
                Played and discarded cards go face down <B>under their deck</B>, so one comes round
                again only after every card above it has been drawn.
              </Trans>,
              <Trans>
                <B>Hand limit 4.</B> Over the limit on someone else's turn and you must discard down
                before anyone can continue. On your own turn you may keep playing and trading while
                over, and get back to 4 by <B>playing or discarding</B> cards, but you cannot end
                your turn until you are at 4.
              </Trans>,
              <Trans>
                Opponents see <B>how many</B> cards you hold, and which track a discarded card
                belongs to, but never which card. The two victory-point cards are the exception:
                they are face-up and never enter a hand at all.
              </Trans>,
              <Trans>
                A card that plainly <B>would do nothing</B> (a Saboteur with nobody at or above your
                score, a Warlord with every knight already awake) <B>cannot be played</B>, so it
                stays in your hand. The one exception is a monopoly naming a good nobody turns out
                to hold: what opponents hold is hidden, so that card is played and is spent.
              </Trans>,
            ]}
          />
        </Panel>
        {PROGRESS_DECKS.map((deck) => (
          <ProgressDeckList key={deck} deck={deck} />
        ))}
      </Sec>
    ),
  },
  {
    id: "ck-seven",
    label: <Trans context="chapter: what a roll of 7 does">Rolling a 7</Trans>,
    render: () => (
      <Sec id="ck-seven" title={<Trans>The 7-roll discard</Trans>}>
        <P>
          <Trans>
            On a 7, count your <B>resources and commodities together</B> against the{" "}
            <Cfg>limit of 7</Cfg>. If the combined total is over it, discard{" "}
            <B>half the combined total</B> (rounded down), paid from either pool in any mix you
            like. City walls raise your own limit; see below.
          </Trans>
        </P>
        <Panel title={<Trans>The robber sleeps until the first raid</Trans>}>
          <P>
            <Trans>
              Until the barbarians have attacked <B>once</B>, a 7 does nothing but trigger discards.
              The robber does not move, nothing is stolen, and until then the Chase-the-robber
              knight action and the Bishop card are both illegal. The log says the robber stayed
              idle, so you can tell this apart from a bug.
            </Trans>
          </P>
          <P>
            <Trans>
              Note the event die is <B>still rolled on a 7</B>, so the barbarians can advance, or
              even land and attack, on the same roll that makes you discard.
            </Trans>
          </P>
          <P>
            <Trans>
              Once the robber is awake it steals from the victim's{" "}
              <B>resources and commodities together</B>, so a player holding nothing but commodities
              is still a target.
            </Trans>
          </P>
        </Panel>
      </Sec>
    ),
  },
  {
    id: "ck-walls",
    label: <Trans>City walls</Trans>,
    render: () => (
      <Sec id="ck-walls" title={<Trans>City walls</Trans>}>
        <PieceRow
          kind="wall"
          name={<Trans context="a city wall piece">City wall</Trans>}
          cost="wall"
          right={
            <span className="font-num text-[11px] font-medium text-muted tabular-nums">
              <Trans>max 3 cities</Trans>
            </span>
          }
        />
        <P>
          <Trans>
            Each city may have <B>one</B> wall, and you may wall up to <B>3</B> cities. Each wall
            lets you keep <B>2 more cards</B> on a 7, so on a table with the default{" "}
            <Cfg>limit of 7</Cfg> three walls take your own limit to 9, then 11, then 13.
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              <B>You choose which city to wall</B>, and it matters: when the barbarians pick a city
              to raze for you, they prefer an <B>unwalled</B> one.
            </Trans>,
            <Trans>
              A walled city <B>destroyed by barbarians loses its wall</B>, and the +2 with it. If
              that happens on the same roll as a 7, you have already lost the bonus by the time you
              discard.
            </Trans>,
            <Trans>
              The <B>Engineer</B> progress card builds one free, but picks the city for you.
            </Trans>,
          ]}
        />
      </Sec>
    ),
  },
  {
    id: "ck-victory",
    label: <Trans context="chapter: how to win">Winning</Trans>,
    render: () => (
      <Sec
        id="ck-victory"
        title={<Trans>Winning the game</Trans>}
        badge={
          <VP>
            <Trans>13 points</Trans>
          </VP>
        }
      >
        <P>
          <Trans>
            First to <Cfg>13 points</Cfg> <B>on their own turn</B> wins. Points come from:
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              Settlement: <B>1</B> · City: <B>2</B> · Each metropolis: <B>2</B>
            </Trans>,
            <Trans>
              Each <B>Defender token</B>: <B>1</B>, and there is no cap on how many you collect
            </Trans>,
            <Trans>
              <Prop slot="prop_merchant" size={18} /> The <B>Merchant token</B>: <B>1</B> while you
              hold it, lost the moment someone else plays a Merchant card
            </Trans>,
            <Trans>
              <B>Constitution</B> and <B>Printer</B>: <B>1</B> each. These are the only two
              victory-point progress cards, they score the instant they are drawn, and they are{" "}
              <B>face up</B>
            </Trans>,
            <Trans>
              Longest Road still exists and is worth <B>2</B>. There is no Largest Army.
            </Trans>,
          ]}
        />
        <P>
          <Trans>
            Because the two victory-point cards are public,{" "}
            <B>there is no hidden score in Knights</B>. What the scoreboard shows is everyone's real
            total, which is also what Master Merchant, Wedding and Saboteur compare when they ask
            who is ahead of you.
          </Trans>
        </P>
      </Sec>
    ),
  },
];

/* -------------------------- SCENARIOS ----------------------------- */

const modeFish = mkMini([
  SEA,
  "var(--color-green)",
  SEA,
  "var(--color-lake)",
  SEA,
  "var(--color-sheep)",
  SEA,
]);
// The coast under attack: land at the top, a ring of enemy red along the
// bottom edge, the castle in the middle. Three hues to contrast the safe
// interior with the coast.
const modeRaiders = mkMini([
  "var(--color-raiders)",
  "var(--color-green)",
  "var(--color-raiders)",
  "var(--color-yellow)",
  "var(--color-raiders)",
  "var(--color-sheep)",
  "var(--color-raiders)",
]);
const modeCaravans = mkMini([
  "var(--color-yellow)",
  "var(--color-sheep)",
  "var(--color-desert)",
  "var(--color-green)",
  "var(--color-desert)",
  "var(--color-yellow)",
  "var(--color-sheep)",
]);
// Three trade hexes on alternating corners: the ring alternates.
const modeWagons = mkMini([
  "var(--color-ore)",
  "var(--color-green)",
  "var(--color-ore)",
  "var(--color-yellow)",
  "var(--color-ore)",
  "var(--color-green)",
  "var(--color-yellow)",
]);
// A watercourse from a mountain headwater through whatever it was dealt
// (derivation 11 repaints only the source) down to the swamp. `--color-rivers`
// rather than `--color-lake`, which is the Fishermen lake's colour.
const modeRivers = mkMini([
  "var(--color-ore)",
  "var(--color-rivers)",
  "var(--color-sheep)",
  "var(--color-rivers)",
  "var(--color-green)",
  "var(--color-rivers)",
  "var(--color-desert)",
]);
// A sliver of known land in the west, open water, and the rest under fog: two
// thirds face down is the scenario's premise (docs/rules/explorers.md:31).
const modeExplorers = mkMini([
  "var(--color-green)",
  SEA,
  "var(--color-explorers)",
  "var(--color-explorers)",
  SEA,
  "var(--color-explorers)",
  "var(--color-explorers)",
]);

/**
 * Wagons' three tables, as data.
 *
 * `id` is React's key, as in TABLE_SETTINGS: keying by name would key by a
 * translated string that changes with the language. Numbers and ranges stay
 * literals; only words are messages.
 *
 * The cargo cycle mirrors docs/rules/wagons.md: marble and glass go to the
 * castle, tools to the quarry, sand to the glassworks, and no hex sends out
 * what it takes in.
 */
const CARGO_CYCLE: { id: string; hex: ReactNode; accepts: ReactNode; sends: ReactNode }[] = [
  {
    id: "castle",
    hex: <Trans context="Wagons trade hex">Castle</Trans>,
    accepts: <Trans context="Wagons cargo">marble, glass</Trans>,
    sends: <Trans context="Wagons cargo">tools, sand</Trans>,
  },
  {
    id: "quarry",
    hex: <Trans context="Wagons trade hex">Quarry</Trans>,
    accepts: <Trans context="Wagons cargo">tools</Trans>,
    sends: <Trans context="Wagons cargo">marble, sand</Trans>,
  },
  {
    id: "glassworks",
    hex: <Trans context="Wagons trade hex">Glassworks</Trans>,
    accepts: <Trans context="Wagons cargo">sand</Trans>,
    sends: <Trans context="Wagons cargo">glass, tools</Trans>,
  },
];

const WAGON_PATH_COSTS: { id: string; path: ReactNode; mp: ReactNode; toll: ReactNode }[] = [
  {
    id: "bare",
    path: <Trans>A path with no road on it</Trans>,
    mp: "2",
    toll: <Trans context="no toll is paid">none</Trans>,
  },
  {
    id: "own",
    path: <Trans>One of your own roads</Trans>,
    mp: "1",
    toll: <Trans context="no toll is paid">none</Trans>,
  },
  {
    id: "other",
    path: <Trans>Another player's road</Trans>,
    mp: "1",
    toll: <Trans>1 gold, to them</Trans>,
  },
  {
    id: "barb",
    path: <Trans>Any of those, with a barbarian standing on it</Trans>,
    mp: <Trans context="added to the movement cost">+2</Trans>,
    toll: <Trans context="the toll is not changed">unchanged</Trans>,
  },
];

// Movement is given for all three board sizes because it is the one number
// the board changes: every level gains 2 more per ring past the smallest board
// (docs/rules/wagons.md). Gold, die ranges and upgrade costs are the same at
// every size.
const WAGON_LEVELS: { level: number; mp: string; gold: string; chase: ReactNode }[] = [
  { level: 1, mp: "4 / 6 / 8", gold: "1", chase: <Trans context="cannot try at all">never</Trans> },
  { level: 2, mp: "5 / 7 / 9", gold: "2", chase: "6" },
  { level: 3, mp: "6 / 8 / 10", gold: "3", chase: "5, 6" },
  { level: 4, mp: "7 / 9 / 11", gold: "4", chase: "4, 5, 6" },
  { level: 5, mp: "7 / 9 / 11", gold: "5", chase: "3, 4, 5, 6" },
];

const scenarioChapters: Chapter[] = [
  {
    id: "sc-intro",
    label: <Trans>About scenarios</Trans>,
    render: () => (
      <Sec id="sc-intro" title={<Trans>Scenario variants</Trans>}>
        <P>
          <Trans>
            Scenarios are self-contained twists that play on the standard procedurally generated
            board. There are <B>seven</B>: Fishermen, Caravans, Harbormaster, Rivers, Raiders,
            Wagons and Explorers. Each one adds a single system to an otherwise normal table, except
            the last two, which change enough that they are described as games of their own below.
          </Trans>
        </P>
        <P>
          <Trans>
            Most of them <B>compose</B>, with each other and with Islands and Knights, and a table
            may run several at once. Running Fishermen and Caravans together is a supported
            combination, and the two meet at the desert: Fishermen floods it, so the Caravans oasis{" "}
            <B>is</B> the lake, growing camels out of a hex that is also a fish source. Where a pair
            does not work the lobby greys the second switch out and says why; the refusals are
            listed at the end of this chapter.
          </Trans>
        </P>
        <P>
          <Trans>
            Every scenario is in <B>beta</B>. They are playable and far younger than Islands and
            Knights, so expect the copy and the art to keep moving.
          </Trans>
        </P>
        <div className="grid grid-cols-3 gap-2.5 max-[860px]:grid-cols-2 max-[640px]:grid-cols-1">
          <ScenarioCard thumb={modeFish} name={<Trans context="scenario name">Fishermen</Trans>}>
            <Trans>
              A lake and coastal fishing grounds add a fish side-currency, and the old boot.
            </Trans>
          </ScenarioCard>
          <ScenarioCard thumb={modeCaravans} name={<Trans context="scenario name">Caravans</Trans>}>
            <Trans>The table votes on where each camel goes; buildings between camels score.</Trans>
          </ScenarioCard>
          {/* No hex thumbnail: Harbormaster adds no terrain, marker or piece
              (its harbours are on every board), so an anchor stands in. */}
          <ScenarioCard
            icon={<Icons.harbor size={20} />}
            name={<Trans context="scenario name">Harbormaster</Trans>}
          >
            <Trans>
              A 2 point card for whoever builds most on the harbours, and one more point to win.
            </Trans>
          </ScenarioCard>
          <ScenarioCard thumb={modeRivers} name={<Trans context="scenario name">Rivers</Trans>}>
            <Trans>
              A river runs from the mountains to the sea; only a bridge crosses it, and building
              along the water pays coins.
            </Trans>
          </ScenarioCard>
          <ScenarioCard thumb={modeRaiders} name={<Trans context="scenario name">Raiders</Trans>}>
            <Trans>
              Raiders land on the coast whenever anybody builds. Its chapters have a tab of their
              own, next to this one.
            </Trans>
          </ScenarioCard>
          <ScenarioCard thumb={modeWagons} name={<Trans context="scenario name">Wagons</Trans>}>
            <Trans>
              Haul cargo between three trade hexes for points. No robber, no longest road.
            </Trans>
          </ScenarioCard>
          <ScenarioCard
            thumb={modeExplorers}
            name={<Trans context="scenario name">Explorers</Trans>}
          >
            <Trans>
              Two thirds of the map face down, and ships that reveal it. Plays alone, or with
              Knights.
            </Trans>
          </ScenarioCard>
        </div>
        <Panel title={<Trans>Pairs the lobby refuses</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>Explorers takes one partner, Knights.</B> It brings its own board, its own pieces
                and a turn structure of its own, so there is nothing underneath it for most modules
                to change. Switching it on greys out every switch except Knights, and each one says
                why: Caravans has no longest route to double, Fishermen has no coastline to lay
                grounds along, Harbormaster has no harbours to score, Islands disagrees with it
                about what a ship and a pirate are, Rivers and Raiders both need a map that is face
                up, and Wagons needs land that connects.
              </Trans>,
              <Trans>
                <B>Wagons refuses Islands.</B> A wagon cannot cross water, and an island board has
                no single landmass for the delivery circuit to go round.
              </Trans>,
              <Trans>
                <B>Wagons and Caravans play, and lose something.</B> Wagons takes the Longest Road
                award out of the game, so the camels' road bonus has nothing to apply to. Their
                settlement points still score, and the lobby notes this beside the switches rather
                than blocking it: it is a trade a host is entitled to make.
              </Trans>,
              <Trans>Every other pair composes, Islands and Knights included.</Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "sc-fish",
    label: <Trans context="scenario name">Fishermen</Trans>,
    render: () => (
      <Sec
        id="sc-fish"
        title={<Trans context="scenario name">Fishermen</Trans>}
        badge={
          <VP>
            <Trans>10 points · 11 with the boot</Trans>
          </VP>
        }
      >
        <Bullets
          items={[
            <Trans>
              <B>Every desert becomes a lake</B>, so a big board with several deserts gets several
              lakes. One lake yields on <B>2, 3, 11 and 12</B>; at five or more players the others
              yield on <B>4 and 10</B> only. Hover a lake to see its numbers. The robber does not
              start on one: with no desert left to park it on, it <B>starts beside the board</B> and
              comes into play on the first 7 (or the first knight).
            </Trans>,
            <Trans>
              A robber standing on a lake <B>blocks it</B>, exactly as it blocks any other hex, and
              stops the catch on every one of its numbers. The two fishing rules that follow from
              that are worth knowing together: the lake is blockable and a{" "}
              <B>fishing ground never is</B>.
            </Trans>,
            <Trans>
              <B>Six fishing grounds</B> sit on the coast, numbered 4, 5, 6, 8, 9, 10, each touching
              two or three neighbouring coastal intersections. At five or six players there are{" "}
              <B>eight</B> (a second 5 and a second 9), and at seven to ten there are <B>ten</B> (a
              third 5 and a third 9). They are placed procedurally, so a cramped coastline can yield
              fewer, dropping the highest numbers first. A ground is a marker on <B>water</B> rather
              than a hex, and the robber cannot stand on water, so nothing can shut one off.
            </Trans>,
            <Trans>
              When a fish source's number rolls, every adjacent{" "}
              <B>settlement draws 1 fish tile and every city 2</B>, from a shared supply of 1-, 2-,
              and 3-fish tiles: 11/10/8 of each, 15/15/13 at five or six players, and 19/20/18 at
              seven to ten. Spent tiles reshuffle into the supply when it empties, so the test is
              against the supply <B>and the spent pile together</B>: only if those two cannot cover
              every draw that roll does <B>no one draw</B>.
            </Trans>,
            <Trans>
              <B>A head start at setup:</B> if your <B>second settlement</B> (or, where the second
              placement is a city, that city) stands next to a fishing ground or a lake, you draw{" "}
              <B>one fish tile</B> along with your starting resources. One tile, however many fish
              sources the spot touches. It can turn up the old boot.
            </Trans>,
            <Trans>
              Fish are a <B>side currency</B>: they don't count toward the hand limit and can't be
              stolen, discarded or <B>traded</B>, whether to the bank or to another player, by the
              robber, the pirate, a knight or Monopoly. You spend <B>whole tiles</B> and can't make
              change; overpayment is lost.
            </Trans>,
            <Trans>
              <B>How many tiles</B> you hold is public, the way a card count is. What they are{" "}
              <B>worth</B> is yours alone: nobody else learns whether your three tiles are worth 3
              or 9, and a spend says how many tiles it took, never what they were worth. Once the
              game is over the replay shows everyone's tiles, as it shows everyone's cards.
            </Trans>,
            <Trans>
              You may hold <B>seven tiles at most</B>. That is a count of tiles, not of fish: seven
              3-fish tiles is twenty-one fish and perfectly legal. A player already at the cap{" "}
              <B>draws nothing more</B>; instead a catch may swap one of their 1-fish tiles for a
              fresh one, once a turn. The old boot is not a tile and does not count toward the
              seven.
            </Trans>,
          ]}
        />
        <Panel title={<Trans>When you can spend</Trans>}>
          <P>
            <Trans>
              Spending fish is an action like any other: <B>your own turn, after you have rolled</B>
              , with no discard or robber move still owed. In particular you <B>cannot</B> spend 2
              fish to head off a 7 you have just rolled. You have to resolve the 7 first, and by
              then the robber has already landed and taken its card.
            </Trans>
          </P>
        </Panel>
        <Panel title={<Trans>Fish spends (escalating value)</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>2</B>: <B>take the robber off the board</B>. There is nowhere to name and nothing
                is stolen: it leaves play entirely and comes back when somebody next rolls a 7 or
                plays a knight. With no robber on the board there is nothing to remove, so the spend
                is refused (and costs you nothing) until one is back.
              </Trans>,
              <Trans>
                <B>3</B>: steal a card from any player who has one. No adjacency is needed. In a
                Knights game this can take a commodity. The <B>friendly robber</B> setting shields
                here too: a player still at their starting visible score cannot be picked.
              </Trans>,
              <Trans>
                <B>4</B>: take any <B>resource</B> from the bank. Not gold, and not a commodity.
              </Trans>,
              <Trans>
                <B>5</B>: a free road, or a <B>ship</B> in a game that has them. You name the edge
                as you spend, and it must be a legal placement right then, which is what stops the
                credit being bought with nowhere to spend it; the piece then goes down on that edge.
              </Trans>,
              <Trans>
                <B>6</B>: a <B>bridge</B>, in a game with Rivers. The bridge still has to be a legal
                one, on an empty bridge site your network reaches, and you need one of your three
                bridges left. You still receive the bridge's coins (3, or 2 alongside Wagons).
                Without Rivers there are no bridges and the rung does not exist.
              </Trans>,
              <Trans>
                <B>7</B>: a free development card. In a game with no development deck (that is,
                alongside Knights) it buys <B>one progress card from the track you name</B> instead.
                Alongside Raiders or Wagons it draws from that scenario's own deck.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>Alongside Knights</Trans>}>
          <P>
            <Trans>
              One spend is <B>off the table</B>, and only for a while: the 2-fish robber removal is
              refused, with your fish untouched, until the barbarians have landed once and the
              robber enters play. From then on it works as usual. The 7-fish rung is{" "}
              <B>replaced, not removed</B>: with no development deck to draw from it buys one
              progress card from the track you name.
            </Trans>
          </P>
        </Panel>
        <Panel title={<Trans>The old boot</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>Nobody starts with the boot.</B> It turns up in someone's catch at some point,
                and in a short game it may never appear at all, which is why the target above is
                conditional.
              </Trans>,
              <Trans>
                Once it is in play it <B>never leaves</B>. It can only be handed on.
              </Trans>,
              <Trans>
                Its holder is public and may, <B>after rolling on their own turn</B>, give it to any
                player with <B>at least as many points</B>. You can't force it on someone, and a
                sole leader is stuck with it.
              </Trans>,
              <Trans>
                The comparison uses <B>public</B> points, so a player quietly sitting on hidden
                victory-point cards can still be handed the boot.
              </Trans>,
              <Trans>
                The boot is <B>not</B> a victory point. It adds <B>1 to your own target</B>,
                whatever that target is: 11 in a plain Fishermen game, 13 alongside Caravans, 14
                alongside Knights.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "sc-caravans",
    label: <Trans>The Caravans</Trans>,
    render: () => (
      <Sec
        id="sc-caravans"
        title={<Trans>The Caravans</Trans>}
        badge={
          <VP>
            <Trans>first to 12 points</Trans>
          </VP>
        }
      >
        <Bullets
          items={[
            <Trans>
              A desert becomes the <B>oasis</B>. Three neutral caravans grow outward from spokes at
              three alternating intersections of the oasis. At five or six players there are{" "}
              <B>two oases</B> (six caravans), and at seven to ten <B>three</B> (nine caravans);
              each new camel may start or extend any of them. Two oases never touch. Any further
              desert stays plain desert. Alongside Fishermen every desert has already become a lake,
              and each oasis is one of the lakes. An oasis dealt on the outer ring is swapped inward
              with a producing hex, so that all three of its caravans have room to start. Where an
              Islands sea swallows a desert, a producing hex that is never a 6 or an 8 becomes the
              missing oasis instead, and its number chip leaves the board.
            </Trans>,
            <Trans>
              The robber starts <B>beside the board</B> and comes into play on the first 7 or
              Knight. It may go to any hex <B>except an oasis</B>, which it can never stand on, even
              when the oasis is a Fishermen lake.
            </Trans>,
            <Trans>
              After any turn in which the active player{" "}
              <B>built a settlement or upgraded to a city</B>, exactly <B>one camel</B> is placed.
              Roads, ships and knights do not count.
            </Trans>,
            <Trans>
              A caravan is a <B>non-branching chain</B>: each camel extends from the front of the
              last camel in one of the caravans, or starts one on its oasis spoke. One edge may hold
              a camel and a road side by side, but never two camels. There are <B>22 camels</B> in
              the shared supply, and <B>11 more</B> for each further oasis (33 with two, 44 with
              three). Once they run out the voting simply stops for the rest of the game.
            </Trans>,
            <Trans>
              <B>Caravans merge, they do not block.</B> When the fronts of two caravans meet at an
              intersection, the next camel may go on that intersection's third edge, and from then
              on the two carry on as a single caravan. The only spots closed to a growing caravan
              are edges that already carry a camel, edges that are not land (in an Islands game, sea
              edges are open too) and one that follows from a chain not branching: a camel may not
              run into the side of another caravan.
            </Trans>,
            <Trans>
              Only a caravan's <B>first</B> camel is barred from the oasis edges, so a chain that
              later winds its way back round to the oasis may run along one. A caravan that reaches
              the coast with nowhere to go has simply <B>ended</B>. On a generated board every oasis
              and its <B>three spokes are guaranteed</B>; only an authored map that pins an oasis
              somewhere cramped can leave a caravan without a first edge.
            </Trans>,
          ]}
        />
        <Panel title={<Trans>The voting round</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>The turn waits, but the table does not freeze.</B> The vote opens as the next
                turn begins. That player may still roll, and once they have answered the vote they
                may build and trade as usual. What nobody can do is end their turn: the camel is
                placed before the turn passes.
              </Trans>,
              <Trans>
                Everyone votes, <B>including the player who just built</B>, by bidding{" "}
                <Chip k="sheep" /> and/or <Chip k="wheat" />: one vote per card, and the cards are
                spent to the bank. Alongside Knights the two piles change to <Chip k="brick" /> and{" "}
                <Chip k="wood" />, which keeps the vote off the cards Knights turns into
                commodities.
              </Trans>,
              <Trans>
                Bidding <B>nothing is allowed</B>, but skipping is not: the round waits on you, and
                if your clock runs out the server bids nothing on your behalf.
              </Trans>,
              <Trans>
                <B>Bidding is open, and goes round the table.</B> It starts with the player who just
                built and continues clockwise, one answer each, with every bid face up as it lands.
                So going later tells you more: you answer knowing exactly what the seats before you
                committed.
              </Trans>,
              <Trans>
                <B>You pay when the round closes, win or lose, not when you bid.</B> Every bid is
                paid whatever the outcome. A bid is a promise, so if you spend those cards in
                between (or a 7 makes you discard them) the bid is trimmed to what you still hold
                and you keep only the votes you can pay for.
              </Trans>,
              <Trans>
                A <B>strict majority</B> (more votes than everyone else combined) wins outright.
                Failing that, <B>a coalition beats the biggest single bidder</B>: any bid may name
                the placement it wants, and two or more bidders who name the same one pool their
                votes, provided that pool is <B>a majority of every vote cast</B>. At 4 / 3 / 3 the
                two threes agreeing take it from the four, and the camel goes straight to the spot
                they agreed on. At 5 / 2 / 2 the two twos are not a majority, so the five wins.
              </Trans>,
              <Trans>
                With no majority and no agreement, the single highest bidder wins; a tie for the
                most votes, or a round with no bids at all, falls to the player who just finished
                their turn.
              </Trans>,
              <Trans>
                Winning the vote and placing the camel are <B>two separate steps</B>, and only the
                winner may place. The exception is a coalition: the placement was named in the bids,
                so the camel goes down at once and nobody gets a pick.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans context="panel: how points are scored">Scoring</Trans>}>
          <Bullets
            items={[
              <Trans>
                Each settlement or city sitting <B>between two camels</B> is worth <VP>+1 pt</VP> to
                its owner. Any two camels, whichever caravans they came from: once caravans merge,
                asking whether they belong to the same one stops meaning anything. A city scores the
                same 1 as a settlement.
              </Trans>,
              <Trans>
                Since caravans only ever grow, an intersection that is once between two camels{" "}
                <B>stays that way</B>: caravan points can never be lost, only gained, and you can
                collect one by building onto a spot the caravan already passed.
              </Trans>,
              <Trans>
                These are <B>public</B> points, so they count for friendly-robber protection and for
                who is "ahead of you" everywhere that matters.
              </Trans>,
              <Trans>
                A road sharing an edge with a camel counts <B>double</B> for the Longest Road, which
                means three roads through two camels already reach the 5-segment threshold. A ship
                counts double the same way in a game that has ships.
              </Trans>,
              <Trans>
                <B>The target depends on what else is in the game.</B> <Cfg>12 points</Cfg> for
                Caravans on its own, <Cfg>15</Cfg> alongside Knights, and <B>2 more than either</B>{" "}
                alongside Islands, so 14, or 17 with both.
              </Trans>,
              <Trans>
                <B>You only win on your own turn.</B> A camel placed by somebody else can carry you
                over the target, since the points are for your buildings and the placer is usually
                not you. The win is banked and lands at the <B>start of your next turn</B>, and
                until then the game carries on.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "sc-harbormaster",
    label: <Trans context="scenario name">Harbormaster</Trans>,
    render: () => (
      <Sec
        id="sc-harbormaster"
        title={<Trans context="scenario name">Harbormaster</Trans>}
        badge={
          <VP>
            <Trans>11 points, one more than usual</Trans>
          </VP>
        }
      >
        <P>
          <Trans>
            The smallest variant here. It adds no hex, no piece, no cost and no new action: one
            special card, a counter derived from the board, and a point on the target. The harbours
            it is played over are already on every board.
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              The <B>Harbormaster</B> card is worth <VP>2 pts</VP> and at most one player holds it.
              It behaves like Longest Road: a public title the table re-derives, never bought,
              played or traded.
            </Trans>,
            <Trans>
              Your <B>harbour points</B> are your victory points in buildings standing on a harbour:{" "}
              <B>1 for a settlement, 2 for a city</B>. Everything else is worth nothing here, roads,
              ships and knights included, and so is a building one intersection away from the
              harbour. Which harbour it is does not matter: a 2:1 ore harbour counts the same as a
              generic 3:1.
            </Trans>,
            <Trans>
              Two rules follow from that being <B>victory points in buildings</B>. A building counts{" "}
              <B>once</B>, however many harbours share its intersection, so a curated map with two
              harbours on one intersection still pays 1 or 2. And a building worth{" "}
              <B>no victory points</B> is worth <B>no harbour points</B>, which is what a Raiders
              conquest does to one.
            </Trans>,
            <Trans>
              You need <B>3</B> harbour points before the card enters play at all, and 3 always
              means <B>at least two harbours</B>: a harbour spans one coast edge, and the distance
              rule forbids building on both of its ends.
            </Trans>,
            <Trans>
              The sole leader at 3 or more holds it. It moves only to a <B>strictly higher total</B>
              , so a leader nobody has passed keeps it. On a tie it matters whether the holder is in
              the tie: a tie <B>between the holder and a challenger</B> leaves it with the holder,
              and a tie the <B>holder is not part of</B> leaves it held by nobody until someone
              leads alone. A tie with the card already unheld leaves it unheld the same way.
            </Trans>,
            <Trans>
              It moves the <B>moment the points change</B>, not at the end of a turn, so upgrading a
              settlement on a harbour to a city can hand you the card and its 2 points in time for
              the same turn's win check.
            </Trans>,
            <Trans>
              A holder who drops <B>below 3</B> loses it even though nobody has more. That needs
              something to take a building's value away, so it cannot happen in a plain game: a
              barbarian attack razing a city on a harbour is the case it exists for, and a Raiders
              conquest enclosing one does the same.
            </Trans>,
            <Trans>
              <B>The target rises by one</B>, not while somebody holds the card but{" "}
              <B>for the whole game</B>, on top of whatever the rest of the ruleset asked for.{" "}
              <Cfg>11 points</Cfg> on its own, <Cfg>14</Cfg> alongside Knights, <Cfg>13</Cfg>{" "}
              alongside Caravans. The one exception is a table that <B>names its own target</B>:
              that number is played as typed, so a table that wants 12 with Harbormaster sets 12 and
              plays to 12.
            </Trans>,
          ]}
        />
        <Panel title={<Trans>Alongside the others</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>Islands.</B> Every harbour counts, including one left on a new coastline by the
                sea the generator carves. A ship is worth nothing and does not connect a building to
                a harbour it does not touch, and the pirate cannot shut a harbour off.
              </Trans>,
              <Trans>
                <B>Knights.</B> One of the two pairings where harbour points can fall, and they can
                fall on somebody else's turn: barbarians razing a harbour city take its owner from 2
                to 1 there. A metropolis on a harbour city is still worth 2, not 4, because the
                building is still a city and the metropolis is a separate award sitting on it. Setup
                can hand the card out, since Knights places a city in the second round.
              </Trans>,
              <Trans>
                <B>Fishermen.</B> A fishing ground is not a harbour and pays no harbour points, but
                an intersection touching both gets both in full: it draws fish on the ground's
                number and scores its 1 or 2 all the same.
              </Trans>,
              <Trans>
                <B>Caravans.</B> No interaction at all. A camel never changes what an intersection's
                harbour is worth, and one building can be worth a caravan point and its harbour
                points at once. Target 13.
              </Trans>,
              <Trans>
                <B>Rivers.</B> No interaction. A bridge is an edge piece and scores nothing here.
              </Trans>,
              <Trans>
                <B>Raiders.</B> The second pairing where harbour points can fall, and the other way
                they can come back. A <B>conquered</B> building is worth nothing at all, so it is
                worth no harbour points either, and it is worth its full value again the moment a
                neighbouring hex is liberated. The card can change hands because of a battle three
                seats away.
              </Trans>,
              <Trans>
                <B>Wagons.</B> No rule changes. A harbour dealt on a trade hex's two seaward corners
                is moved one edge along the coast, so every harbour can be built beside and counts
                as usual. Target 14.
              </Trans>,
              <Trans>
                <B>Explorers is refused.</B> It has no harbours to build on: bank trade there is a
                flat 3 for 1 everywhere and the harbours are gone, so there would be nothing for the
                card to be a race over, and every seat would sit on zero forever while the target
                still went up by one. That is a pure penalty, so the pair is not offered rather than
                offered and broken. Note the word collision: an Explorers <B>harbour settlement</B>{" "}
                is a building, not a harbour.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "sc-rivers",
    label: <Trans>The Rivers</Trans>,
    render: () => (
      <Sec
        id="sc-rivers"
        title={<Trans>The Rivers</Trans>}
        badge={
          <VP>
            <Trans>first to 10 points</Trans>
          </VP>
        }
      >
        <Bullets
          items={[
            <Trans>
              One or more <B>rivers</B> are drawn across the board, one for every 30 land tiles: one
              on a small board, two on a medium one, three on a large one. A river is a chain of
              hexes with a channel running through them, running{" "}
              <B>from a mountain headwater down to the sea</B>, and it always ends in a <B>swamp</B>{" "}
              at that one mouth: a new tile that produces nothing, takes no number, and holds the
              robber exactly as the desert does.
            </Trans>,
            <Trans>
              The river never moves and it costs nobody a hex they were counting on: the tiles it
              runs through keep their numbers and go on producing. Only the swamp at the mouth loses
              its number, and the robber still starts on the desert.
            </Trans>,
            <Trans>
              The watercourse <B>repaints only its source</B>: the headwater becomes mountain, by
              swapping terrain with a mountain elsewhere on the board, so no resource is lost. Every
              hex between the source and the sea keeps the terrain it was dealt. If the ore looks
              like it has moved, that is why. On a <Cfg>fair</Cfg> board the numbers are rebalanced
              afterwards, to make up for the swamp.
            </Trans>,
            <Trans>
              Every path the channel crosses is a <B>bridge site</B>, including the one where the
              river meets the sea. A bridge site is a path like any other for working out who is
              next to whom, but only a bridge may ever stand on one: no road, and no ship in a game
              with Islands. No road can ford a river at any price.
            </Trans>,
            <Trans>
              Each player has exactly <B>three bridges</B> for the whole game. They are never
              removed, never moved and never destroyed, and they are a separate supply from your
              roads: running out of one does not stop you building the other.
            </Trans>,
          ]}
        />
        <Panel title={<Trans>Building a bridge</Trans>}>
          <PieceRow
            kind="bridge"
            name={<Trans context="a bridge piece">Bridge</Trans>}
            items={[
              ["brick", 2],
              ["wood", 1],
            ]}
            right={
              <span className="font-num text-[11px] font-medium text-muted tabular-nums">
                <Trans>3 per player</Trans>
              </span>
            }
          />
          <Bullets
            items={[
              <Trans>
                A bridge goes on an <B>empty bridge site</B> and has to join your own network at one
                of its ends, exactly as a road does. It blocks opponents the way a road does, and it
                counts as one segment of your <B>Longest Road</B>.
              </Trans>,
              <Trans>
                A bridge is worth <B>no victory points</B> on its own, and{" "}
                <B>Road Building cannot build one</B>: the card buys roads, and a bridge costs more
                than a road for a reason. (Alongside Fishermen a bridge can be bought with fish
                instead; see below.)
              </Trans>,
              <Trans>
                <B>No bridges during setup.</B> Your two free connectors are roads (or ships), and a
                bridge site is closed to both, so setup never leaves you unable to place one.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>Coins</Trans>}>
          <Bullets
            items={[
              <Trans>
                Building on the river pays <B>coins</B>. A road on a river edge pays 1, a settlement
                on a river intersection pays 1, and a bridge pays <B>3</B>. Upgrading a settlement
                to a city pays nothing: the intersection has already been paid for. A piece placed
                for free still pays, because the coin is for the placement and not for the price.
              </Trans>,
              <Trans>
                <B>Coins are not resources.</B> They never count toward the hand limit, are never
                discarded on a 7, cannot be stolen by the robber or the pirate, and Monopoly cannot
                take them. Every seat's total is <B>public</B>.
              </Trans>,
              <Trans>
                You can <B>sell resources to the supply for a coin</B>, as often as you like on your
                turn, at <B>your own harbour rate for what you give</B>: 4 of a kind normally, 3 at
                a generic harbour, and <B>2 at that resource's own 2:1 harbour</B>. Going the other
                way, <B>2 coins buy any one resource</B>, at most twice a turn. If the supply has
                run out of it, the purchase is refused and you spend nothing.
              </Trans>,
              <Trans>
                Coins can be <B>given and taken in trades</B> like resources, on the active player's
                turn. Set the amounts in the trade panel's currency rows. With Knights, you can also
                sell commodities for coins in the coins panel, at their maritime rate.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>The two wealth tiles</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>
                  Wealthiest Settler, <VP>+1 pt</VP>.
                </B>{" "}
                Held by whoever has the most coins outright. <B>On a tie nobody holds it</B>: it
                goes back until one player leads again.
              </Trans>,
              <Trans>
                <B>
                  Poorest Settler, <VP>-2 pts</VP>.
                </B>{" "}
                Held by <B>every</B> player tied for the fewest coins, so several people hold one at
                once, and at the start of the game everybody does. You shed it the moment somebody
                else is lower.
              </Trans>,
              <Trans>
                Both move on their own, the instant any coin changes hands, on anybody's turn. A
                score really can go <B>negative</B>: a player on 1 point holding the Poorest Settler
                is on -1.
              </Trans>,
              <Trans>
                They do not change the target. Rivers plays to the same number the rest of your
                ruleset sets, <Cfg>10 points</Cfg> on its own, and as always you only win{" "}
                <B>on your own turn</B>: a trade on someone else's can hand you the Wealthiest
                Settler, and the win lands when your turn comes round.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>With the other expansions</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>Islands.</B> A ship on a river edge pays a coin like a road, and moving one off a
                river edge costs a coin back, so shuffling a ship along the same river is free. A
                ship may not be built on a bridge site, which bites: the two river mouths are
                exactly the coastal edges a ship would otherwise take.
              </Trans>,
              <Trans>
                <B>Knights.</B> Knights walk over bridges as if they were roads. A city about to be
                pillaged can be saved by paying <B>5 coins</B>. No progress card touches coins, and
                the setup city on a river intersection pays 1 coin like a settlement. The Diplomat
                can never touch a bridge, and taking a road off a river edge with it costs{" "}
                <B>you</B> 1 coin, whoever's road it was; rebuilding your own on another river edge
                earns it back.
              </Trans>,
              <Trans>
                <B>Fishermen.</B> A bridge can be bought for <B>6 fish</B> instead of its resource
                cost, and it still pays its 3 coins. The lake stays: our board still deals a desert
                for Fishermen to flood, and the river is forbidden from running through it.
              </Trans>,
              <Trans>
                <B>Caravans.</B> A camel may stand on a bridge site whether or not a bridge is
                there, and it doubles a bridge for the Longest Road exactly as it doubles a road.
                Neither piece keeps the other out; only a second camel is refused. The oasis is
                never a river hex and a river hex is never the oasis. Bids stay in cards: coins are
                never votes. Target 12.
              </Trans>,
              <Trans>
                <B>Wagons.</B> The two scenarios share <B>one purse of coins</B>: the wagon spends
                the same coins the river pays, so they are re-priced. You start with <B>3</B> coins
                rather than the wagon's usual 5, a bridge pays <B>2</B> coins rather than 3, fording
                a river costs a wagon <B>3 movement</B> where any bridge costs 1, and crossing
                somebody else's bridge pays them <B>2</B> coins. The{" "}
                <B>Poorest Settler tile is not used at all</B>: coins are the wagon's fuel here, so
                being broke is already the punishment, and the Wealthiest Settler stays.
              </Trans>,
              <Trans>
                <B>Raiders.</B> The <B>Poorest Settler tile is not used</B> here either. Raiders
                keeps its <B>own gold</B>, a separate purse from your coins: gold is what Raiders
                buys and sells with, and only coins count toward the Wealthiest Settler, which
                stays. A bridge site is a path, so a rider may stand on one whether or not a bridge
                is there, and riders ford rivers freely: bridges are irrelevant to them.
              </Trans>,
              <Trans>
                <B>Harbormaster.</B> No conflict. The raised target applies and the +1 and -2 apply
                to it unchanged.
              </Trans>,
              <Trans>
                <B>Explorers is refused.</B> It deals most of its map face down, so there is no
                board for a river to be laid across.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "sc-wagons",
    label: <Trans>Wagons: the circuit</Trans>,
    render: () => (
      <Sec
        id="sc-wagons"
        title={<Trans>Wagons</Trans>}
        badge={
          <VP>
            <Trans>first to 13 points</Trans>
          </VP>
        }
      >
        <P>
          <Trans>
            You own one <B>wagon</B>. It hauls cargo around the road network between three trade
            hexes, pays other people to use their roads, and scores you a point for every load it
            delivers. This is a replacement rather than a layer: there is <B>no robber</B> in the
            game and <B>no Longest Road award</B>. Largest Army stays.
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              Three hexes on alternating corners of the outer ring become the <B>castle</B>, the{" "}
              <B>quarry</B> and the <B>glassworks</B>. Alternating corners is what makes the three
              legs of the circuit the same length, so no seat starts closer to the money. Which hex
              takes which role is dealt from the seed.
            </Trans>,
            <Trans>
              A trade hex <B>keeps the terrain and the number it was dealt</B> and still pays out to
              buildings on its four land intersections. Nothing is taken out of the bag and no roll
              is ever re-rolled, so the 2 and the 12 stay in the deal.
            </Trans>,
            <Trans>
              Each has a <B>plaza</B> at its centre. A plaza is a real intersection and the only
              place cargo changes hands, and <B>nothing may ever be built on one</B>. Four{" "}
              <B>spokes</B> run from the plaza out to the hex's four land intersections. A wagon
              drives a spoke for 2 movement and no toll, and no road can be built on one.
            </Trans>,
            <Trans>
              The three edges a trade hex shares with water are <B>closed</B>, to roads and to
              wagons, and so are the two intersections that touch only closed edges. That leaves a
              trade hex with <B>seven usable paths</B> where an ordinary hex has six, and{" "}
              <B>four buildable intersections</B>.
            </Trans>,
            <Trans>
              <B>Your wagon never blocks and is never blocked.</B> Any number of wagons may share an
              intersection, buildings do not stop them, and an opponent's road does not break their
              path the way it breaks a route.
            </Trans>,
          ]}
        />
        <Panel title={<Trans>What each hex takes and what it sends out</Trans>}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] text-muted border-collapse min-w-90">
              <thead>
                <tr className="text-foreground text-left">
                  <th className={TH}>
                    <Trans context="cargo table column: the trade hex">Trade hex</Trans>
                  </th>
                  <th className={TH}>
                    <Trans context="cargo table column: cargo it accepts">Accepts</Trans>
                  </th>
                  <th className={TH_LAST}>
                    <Trans context="cargo table column: cargo it sends out">Sends out</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {CARGO_CYCLE.map((c) => (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className="py-1.5 pr-3 font-semibold text-foreground whitespace-nowrap">
                      {c.hex}
                    </td>
                    <td className="py-1.5 pr-3">{c.accepts}</td>
                    <td className="py-1.5">{c.sends}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <P>
            <Trans>
              <B>No trade hex ever sends out something it takes in</B>, so the load you pick up
              always points you somewhere else. Each hex has its own shuffled stack of twelve
              tokens, six of each cargo it sends; when a stack runs out it is refilled and
              reshuffled.
            </Trans>
          </P>
        </Panel>
        <Panel title={<Trans>Setup, and what is public</Trans>}>
          <Bullets
            items={[
              <Trans>
                Your <B>second placement is a city</B>, not a settlement, and it pays <B>one</B>{" "}
                resource per adjacent producing hex rather than two. Your wagon starts on that
                city's intersection.
              </Trans>,
              <Trans>
                You start with <B>5 gold</B>. Alongside Rivers the gold and the river's coins are
                one purse, called coins, and you start with <B>3</B>.
              </Trans>,
              <Trans>
                <B>Three barbarians</B> are placed on paths, one near each trade hex. No robber is
                placed, at any point in the game.
              </Trans>,
              <Trans>
                The cargo your wagon is carrying is <B>face up</B>: what everyone is hauling, and
                therefore where they have to take it, is open information. The{" "}
                <B>only hidden thing</B> in the scenario is the order of the three stacks.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "sc-wagons-drive",
    label: <Trans>Wagons: driving</Trans>,
    render: () => (
      <Sec id="sc-wagons-drive" title={<Trans>Moving the wagon</Trans>}>
        <P>
          <Trans>
            After you have finished trading and building, and before you end your turn, you{" "}
            <B>may</B> move your wagon. Declining is always legal and ends the turn, but you have to
            do one or the other: the turn will not pass while the choice is open. While the wagon is
            on the move you cannot build, buy a development card or trade; the wagon's own gold
            purchases stay open, and the rest opens again once it stops. Whatever movement you do
            not spend is lost, and it never banks.
          </Trans>
        </P>
        <Panel title={<Trans>What a path costs</Trans>}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] text-muted border-collapse min-w-95">
              <thead>
                <tr className="text-foreground text-left">
                  <th className={TH}>
                    <Trans context="movement table column: the kind of path">Path</Trans>
                  </th>
                  <th className={TH}>
                    <Trans context="movement table column: movement points">Movement</Trans>
                  </th>
                  <th className={TH_LAST}>
                    <Trans context="movement table column: gold toll">Toll</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {WAGON_PATH_COSTS.map((c) => (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className="py-1.5 pr-3 font-semibold text-foreground">{c.path}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{c.mp}</td>
                    <td className="py-1.5">{c.toll}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Bullets
            items={[
              <Trans>
                You must be able to pay a path <B>in full</B> to enter it. There is no part-way
                movement, and a toll you cannot pay simply closes that road to you. A wagon really
                can be walled in by roads it cannot afford, and no rule rescues it.
              </Trans>,
              <Trans>
                Once per trip you may spend <Chip k="wheat" /> for <B>2 more movement</B>, and you
                may do it mid-trip, after you have already run out.
              </Trans>,
              <Trans>
                You may stop on any intersection you reach, and you <B>must</B> stop the moment you
                enter a plaza.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>Arriving at a plaza</Trans>}>
          <Bullets
            items={[
              <Trans>
                If you are carrying what that hex <B>accepts</B>, you deliver it. The token goes
                face down in front of you, worth <VP>1 pt</VP> for the rest of the game, and you
                take gold equal to your wagon's level.
              </Trans>,
              <Trans>
                Then, if your wagon is <B>empty</B>, it draws the top token of that hex's stack and
                turns it face up. That token names where you are going next.
              </Trans>,
              <Trans>
                Arriving at a plaza that does <B>not</B> take your cargo does nothing at all, and it
                still ends the trip. Going to the wrong plaza wastes a turn, and it is a real
                mistake a player can make.
              </Trans>,
              <Trans>
                Your <B>first</B> load is a plain pick-up: drive to whichever plaza you like,
                deliver nothing, earn nothing, and draw your first token. You can never deliver at
                two plazas in one trip, because entering the first one ends it.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>The wagon track</Trans>}>
          <PieceRow
            glyph={<Icons.dev size={22} />}
            name={<Trans>Levels 2, 3</Trans>}
            items={[
              ["wood", 1],
              ["sheep", 1],
              ["ore", 1],
            ]}
          />
          <PieceRow
            glyph={<Icons.dev size={22} />}
            name={<Trans>Levels 4, 5</Trans>}
            items={[
              ["wood", 2],
              ["sheep", 1],
              ["ore", 1],
            ]}
          />
          <Bullets
            items={[
              <Trans>
                Upgrades are bought <B>while you are building</B>, not while you are driving. One
                level at a time, no skipping, and no way back down.
              </Trans>,
              <Trans>
                Every level gives more movement, pays more gold per delivery, and from level 2
                widens the die roll that drives a barbarian off. Reaching <B>level 5</B> is worth{" "}
                <VP>1 pt</VP>.
              </Trans>,
              <Trans>
                <B>Movement scales with the board.</B> Every entry below gains 2 more for each ring
                past the smallest board, because a bigger board is a longer circuit. The gold, the
                die ranges and the upgrade costs do not change.
              </Trans>,
            ]}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] text-muted border-collapse min-w-105">
              <thead>
                <tr className="text-foreground text-left">
                  <th className={TH}>
                    <Trans context="wagon table column: upgrade level">Level</Trans>
                  </th>
                  <th className={TH}>
                    <Trans context="wagon table column: movement points by board size">
                      Movement (small / medium / large)
                    </Trans>
                  </th>
                  <th className={TH}>
                    <Trans context="wagon table column: gold per delivery">Gold</Trans>
                  </th>
                  <th className={TH_LAST}>
                    <Trans context="wagon table column: die roll that drives a barbarian off">
                      Drives off on
                    </Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {WAGON_LEVELS.map((l) => (
                  <tr key={l.level} className="border-t border-line align-top">
                    <td className="py-1.5 pr-3 font-semibold text-foreground">{l.level}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{l.mp}</td>
                    <td className="py-1.5 pr-3">{l.gold}</td>
                    <td className="py-1.5">{l.chase}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title={<Trans>Driving a barbarian off</Trans>}>
          <Bullets
            items={[
              <Trans>
                From <B>level 2</B> up, standing on either end of a barbarian's path, you may roll
                one die and move that barbarian to any path on the board that has none on it. A
                level 1 wagon cannot try at all.
              </Trans>,
              <Trans>
                It <B>costs no movement</B> and does not end your trip, whether it works or not, and
                nothing is stolen. You may try from the intersection you start on, any you pass
                through, and the one you finish on.
              </Trans>,
              <Trans>
                <B>Each barbarian may be tried once a turn</B>, so a wagon parked between two of
                them may have a go at both.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "sc-wagons-score",
    label: <Trans>Wagons: gold and winning</Trans>,
    render: () => (
      <Sec
        id="sc-wagons-score"
        title={<Trans>Gold, the deck, and the target</Trans>}
        badge={
          <VP>
            <Trans>first to 13 points</Trans>
          </VP>
        }
      >
        <Panel title={<Trans>Gold</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>Gold is a count, not a card.</B> It never counts toward your hand limit, a 7
                never makes you discard it, and <B>nothing in this game can steal it</B>: the deck
                has no Monopoly and no Year of Plenty.
              </Trans>,
              <Trans>
                It pays road tolls, and <B>2 gold buy any one resource</B> from the bank, at most
                twice a turn. It can sit on either side of a trade with another player.
              </Trans>,
              <Trans>
                Selling to the bank pays out in gold at whatever rate your harbours give you: 4 of a
                kind normally, 3 at a generic harbour, and <B>2 at that resource's own harbour</B>.
                A harbour prices what you give, so every scenario currency works the same way: you
                get Rivers coins and Raiders gold for your resources at the same three rates.
              </Trans>,
              <Trans>
                <B>Gold is never a victory point</B> and there is no conversion at the end. The one
                exception anywhere is the Wealthiest Settler tile alongside Rivers.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>The barbarians, and rolling a 7</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>Three barbarians</B> stand on paths, at most one to a path. They stop nothing
                being built and block nothing: their whole effect is the 2 extra movement they cost
                a wagon crossing that path.
              </Trans>,
              <Trans>
                A <B>7</B> produces nothing, and everyone over the hand limit discards half as
                usual, gold not counted. Then the active player <B>moves one barbarian</B> to a free
                path, and it has to end up somewhere other than where it was.
              </Trans>,
              <Trans>
                If it lands on a path that holds a road, the active player{" "}
                <B>steals one random resource</B> from that road's owner. That is the only stealing
                in the scenario.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>A deck of its own</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>Knight</B> (16). Move one barbarian to a free path; if it lands on a road, steal
                one random resource from its owner. These still count toward <B>Largest Army</B>,
                worth <VP>2 pts</VP>, which is the only base title left in the game.
              </Trans>,
              <Trans>
                <B>Road Building</B> (3). Two roads at no cost, as in the base game. Spokes carry no
                roads, so they are not targets.
              </Trans>,
              <Trans>
                <B>Swift Journey</B> (3). Take a second movement action this turn, with a{" "}
                <B>fresh full allowance</B> rather than what was left of the first. The second trip
                may buy the wheat boost again.
              </Trans>,
              <Trans>
                <B>Victory Point</B> (3). <VP>1 pt</VP>, held hidden until it wins the game.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans context="panel: how points are scored">Scoring</Trans>}>
          <Bullets
            items={[
              <Trans>
                Settlements and cities score as normal, plus <VP>1 pt</VP> for every{" "}
                <B>delivered cargo token</B>, <VP>1 pt</VP> for reaching <B>level 5</B>, your hidden
                victory-point cards, and Largest Army.
              </Trans>,
              <Trans>
                <B>No points from gold, and no Longest Road at all.</B> Deliveries are where the
                scenario's points are, and they have no component limit: the tokens keep coming as
                long as the stacks are refilled.
              </Trans>,
              <Trans>
                <B>The target depends on what else is at the table.</B> <Cfg>13</Cfg> on its own and
                alongside Fishermen or Rivers, <Cfg>14</Cfg> alongside Raiders or Harbormaster, and{" "}
                <Cfg>15</Cfg> alongside Knights or Caravans. The old boot adds 1 to whichever of
                those applies. As always, you only win on your own turn.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>With the other expansions</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>Islands is refused.</B> A wagon cannot cross water, and the scenario needs one
                roughly round landmass so the three legs come out equal and three coastal corners to
                put the trade hexes on. An archipelago offers neither.
              </Trans>,
              <Trans>
                <B>Explorers is refused</B> too, and for more reasons than one: it has no robber and
                no harbours for gold to be bought through, and it builds harbour settlements instead
                of cities, so the round-2 city that carries your wagon has nothing to be.
              </Trans>,
              <Trans>
                <B>Knights.</B> Knights already replaces the development deck, so this scenario's
                deck is not used either: no Swift Journey, and progress cards do the work. Gold buys
                resources and never commodities. A ready active knight beside a path barbarian can
                chase it away, deactivating the knight. Move the barbarian to an empty path; if
                another player owns a road there, steal one random resource or commodity from that
                player. This works before the first invasion. Target 15.
              </Trans>,
              <Trans>
                <B>Caravans.</B> Plays, and loses something: with no Longest Road award the camels'
                road bonus is dead, and only their between-two-camels points survive. Barbarians do
                not stop a camel being placed. Target 15.
              </Trans>,
              <Trans>
                <B>Rivers.</B> The wagon's gold and the river's coins become <B>one purse</B>,
                called coins, so it is re-priced: you start with <B>3</B> rather than 5, a bridge
                pays <B>2</B> coins rather than 3, fording a river costs a wagon <B>3 movement</B>{" "}
                and any bridge costs 1, and crossing somebody else's bridge pays them <B>2</B>{" "}
                rather than the usual 1. The Poorest Settler tile is not used, because coins are
                fuel here and being broke is punishment enough.
              </Trans>,
              <Trans>
                <B>Fishermen.</B> The 2-fish spend that sends the robber away is refused, since
                there is no robber. Instead, two fish buy two extra wagon movement points. Fish and
                wheat share the same once-per-turn boost limit. Whole fish tiles are spent without
                change, and a finished movement cannot be reopened. The 7-fish free card draws from
                this deck. The lake stays: our trade hexes take coastal corners and never touch the
                desert.
              </Trans>,
              <Trans>
                <B>Raiders.</B> Neither scenario has a robber, so nothing is lost there, and the two
                barbarian populations merge. Each new raider is assigned to one path of its hex,
                adding two movement points there. Trade hexes also offer interior paths. Capture
                clears the blocker; a successful drive-off may send it to an unconquered interior
                hex. Cargo still changes hands at conquered trade hexes. A 7 steals without moving a
                raider, and a roll of 2 or 12 lands one. Target 14.
              </Trans>,
              <Trans>
                <B>Harbormaster.</B> No rule changes at all. A harbour dealt on a trade hex's
                seaward corners is moved one edge along the coast, so every harbour still counts.
                Target 14.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "sc-explorers-setup",
    label: <Trans>Explorers: setting out</Trans>,
    render: () => (
      <Sec
        id="sc-explorers-setup"
        title={<Trans>The home island, and what you start with</Trans>}
        badge={
          <VP>
            <Trans>first to 17 points</Trans>
          </VP>
        }
      >
        <P>
          <Trans>
            Explorers deals a much bigger board than the other rulesets, then hides most of it. A
            small <B>home island</B> sits in the west, ringed by a full hex of <B>home waters</B>,
            and every hex beyond that ring is dealt <B>face down</B>. The fog is not a drawing
            trick: the server does not send those hexes to your client at all, so nobody at the
            table knows what is under them, and neither does anybody watching.
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              The home island is generated the ordinary way, chits and all, and any desert among its
              hexes is re-dealt as producing land: there is <B>no desert</B> in this game.
            </Trans>,
            <Trans>
              The hidden part is split into a <B>north region</B> and a <B>south region</B>, each
              holding exactly nine special hexes: <B>3 gold fields</B> (each under a pirate lair),{" "}
              <B>3 fish shoals</B> and <B>3 spice farms</B>, one for each spice village (Swift
              Voyage, Pirate Bonus and Fast Gold). No two of the nine are ever dealt next to each
              other, so a region's gold cannot all land in one corner and one ship cannot work two
              farms from a single spot.
            </Trans>,
            <Trans>
              The six shoals carry the six die faces between them, 1, 2 and 3 in the north and 4, 5
              and 6 in the south, which is what makes the fishing roll a single die.
            </Trans>,
            <Trans>
              A revealed land hex draws its number from its own region's shuffled stack, and those
              stacks have <B>no 2 and no 12</B>. The no-adjacent-red-numbers rule does not apply out
              there: a chit is dealt before anyone knows what its neighbours are. The home island is
              generated under the rule; the new world is not, and that asymmetry is the price of
              fog.
            </Trans>,
            <Trans>
              Explorers <B>will not load a shared or authored map</B>. The layout is a partition
              into home island, home waters and two hidden regions with their own chit stacks, and
              no share code carries any of that.
            </Trans>,
          ]}
        />
        <Panel title={<Trans>Setup, in four rounds</Trans>}>
          <Bullets
            items={[
              <Trans>
                Everyone takes <B>2 gold</B>.
              </Trans>,
              <Trans>
                In turn order, each player places a <B>harbour settlement</B>, with no road, on any
                coastal intersection of the home island.
              </Trans>,
              <Trans>
                In reverse order, each player places a <B>settlement</B>, with no road, anywhere on
                the home island. The distance rule counts everything placed so far, harbour
                settlements included.
              </Trans>,
              <Trans>
                In turn order again, each player places <B>one road</B> touching their settlement
                and <B>one ship carrying a settler</B> on a sea edge touching their harbour
                settlement.
              </Trans>,
              <Trans>
                Each player collects one resource per producing hex beside their <B>settlement</B>.
                The harbour settlement pays nothing at setup. You open on <VP>3 pts</VP> of the 17,
                with a road, a loaded ship and two gold.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>What things cost</Trans>}>
          <PieceRow kind="road" name={<Trans context="a road piece">Road</Trans>} cost="road" />
          <PieceRow
            kind="settlement"
            name={<Trans context="a settlement piece">Settlement</Trans>}
            cost="settlement"
            right={
              <span className="font-num text-[11px] font-medium text-muted tabular-nums">
                <Trans>limit 5</Trans>
              </span>
            }
          />
          {/* An anchor rather than the city model: Explorers has no cities. */}
          <PieceRow
            glyph={<Icons.harbor size={22} />}
            name={<Trans>Harbour settlement</Trans>}
            items={[
              ["wheat", 2],
              ["ore", 2],
            ]}
            right={
              <span className="font-num text-[11px] font-medium text-muted tabular-nums">
                <Trans>limit 4</Trans>
              </span>
            }
          />
          <PieceRow
            kind="ship"
            name={<Trans context="a ship piece">Ship</Trans>}
            cost="ship"
            right={
              <span className="font-num text-[11px] font-medium text-muted tabular-nums">
                <Trans>limit 3</Trans>
              </span>
            }
          />
          <PieceRow
            glyph={<Icons.hand size={22} />}
            name={<Trans>Settler</Trans>}
            cost="settlement"
            right={
              <span className="font-num text-[11px] font-medium text-muted tabular-nums">
                <Trans>limit 2</Trans>
              </span>
            }
          />
          <PieceRow
            glyph={<Icons.hand size={22} />}
            name={<Trans>Crew</Trans>}
            items={[
              ["sheep", 1],
              ["ore", 1],
            ]}
            right={
              <span className="font-num text-[11px] font-medium text-muted tabular-nums">
                <Trans>limit 9</Trans>
              </span>
            }
          />
          <Bullets
            items={[
              <Trans>
                A settler or a crew is <B>bought straight into a slot</B>, either in one of your
                harbour settlements or in one of your ships tied up beside one. Neither can ever be
                put on land directly: <B>no settler or crew reaches land except aboard a ship</B>.
                Roads and further settlements are a different matter, and are built on explored land
                the ordinary way.
              </Trans>,
              <Trans>
                There are <B>no harbours</B>. Bank trade is a flat <B>3 identical cards for 1</B>{" "}
                anywhere on the board, and the same three cards buy a gold instead if you would
                rather.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "sc-explorers",
    label: <Trans>Explorers: the voyage</Trans>,
    render: () => (
      <Sec
        id="sc-explorers"
        title={<Trans>The Explorers</Trans>}
        badge={
          <VP>
            <Trans>first to 17 points</Trans>
          </VP>
        }
      >
        <P>
          <Trans>
            Explorers does not sit on top of the base game, it <B>replaces</B> most of it. There are
            no development cards, no cities, no robber, no Longest Road or Largest Army, and no
            harbours: bank trade is a flat 3 for 1 everywhere. The only expansion it mixes with is
            Knights, and it is the one ruleset that will not load a shared or authored map, because
            the layout is a partition of the board that no share code can carry.
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              You start on a <B>home island</B> in the west, ringed by home waters. Everything
              beyond it, roughly <B>two thirds of the board</B>, is face down. Nobody knows what is
              under the fog, and the server does not tell your client either.
            </Trans>,
            <Trans>
              <B>Only ships reveal it.</B> After every single movement point, any unexplored hex
              touching either end of the ship that just moved is turned over. It is mandatory, it
              reveals <B>every</B> hex that qualifies, and it{" "}
              <B>ends that ship's movement on the spot</B>, forfeiting the rest of its points. A
              road pointing into the fog reveals nothing at all.
            </Trans>,
            <Trans>
              What is under a hex: producing land pays its finder <B>one resource</B> of that
              terrain and takes a number chit off its region's stack. Open sea, a fish shoal, a gold
              field or a spice farm pays <B>2 gold</B> instead. Nothing can be built on an edge or
              an intersection shared with a hex that is still face down, so the map opens one ship's
              length at a time.
            </Trans>,
            <Trans>
              A turn has <B>three phases in a fixed order</B>: Production, Action, then Movement.
              You trade and build in Action, and you sail in Movement.{" "}
              <B>Movement is a one-way door</B>: once you enter it you cannot go back and build, and
              the only things you spend there are <Chip k="sheep" /> for extra speed and gold for
              tribute. A piece bought in Action is usable the same turn, so buy a settler, load it,
              sail and found a settlement in one go.
            </Trans>,
            <Trans>
              A settlement never becomes a city. It becomes a <B>harbour settlement</B>, worth{" "}
              <VP>2 pts</VP>, for <Chip k="wheat" /> <Chip k="wheat" /> <Chip k="ore" />{" "}
              <Chip k="ore" />, on any coastal spot you already own. Four per player, ever, and they
              are the largest block of points in the game. They are also the <B>only shipyard</B>: a
              plain coastal settlement cannot build ships, which is the reason to plant one
              overseas.
            </Trans>,
            <Trans>
              <B>Ships are vehicles, not roads.</B> Three per player, built beside your own harbour
              settlements for <Chip k="wood" /> <Chip k="sheep" />. They link nothing, block nothing
              and score nothing, two may share an edge, and a coastal edge holds a road and ships at
              the same time. Each moves <B>4 spaces</B> a turn, plus 2 for a <Chip k="sheep" /> once
              per ship, plus 1 or 2 from the Swift Voyage villages. Finish one ship before you start
              the next.
            </Trans>,
            <Trans>
              Every ship has a <B>hold</B> and every harbour settlement a basin of the same size:{" "}
              <B>one large piece or two small ones</B>. Large is a settler or a fish haul; small is
              a crew or a spice sack. Loading and unloading cost no movement, so a ship can stop,
              swap and carry on. Ship to ship is not allowed; pass the piece through a harbour
              settlement you both touch. Open Fleet to choose the destination for a crew or settler
              purchase; during movement, use the docked ship's Load and Unload buttons.
            </Trans>,
            <Trans>
              A <B>settler</B> is the only way to reach new land: put a ship's end on an
              intersection of an explored land hex and found a settlement there, with no connecting
              road needed. The ship does not stay behind: <B>both pieces go back to your supply</B>,
              so the ship has to be built again and the settler can be bought and sailed out again.
              What you spent is the settlement now standing there. A <B>crew</B> is the small piece
              that storms lairs and befriends spice villages, and neither settlers nor crews can
              ever walk: <B>no settler or crew reaches land except aboard a ship</B>. Roads and
              further settlements are built on explored land the ordinary way once you hold a
              settlement in that region.
            </Trans>,
            <Trans>
              If all three of your ships are on the board you may <B>scrap one</B> to build another,
              and whatever it was carrying is lost. That is how a ship stranded in the wrong ocean
              comes home. The cargo ship build button lets you choose which ship to replace.
            </Trans>,
          ]}
        />
        <Panel
          title={
            <span className="flex items-center gap-2">
              <Prop slot="prop_pirate" size={22} />
              <Trans>The pirate ship</Trans>
            </span>
          }
        >
          <Bullets
            items={[
              <Trans>
                There is no robber. A <B>7</B> makes everyone over 7 cards discard as usual, and
                then the roller activates a <B>pirate ship</B> on the water. Everyone owns one, but
                only <B>one stands on the board at a time</B>: place yours if the board is empty,
                move yours if it is already out, or send an opponent's home and put yours down.
                Either way it goes to a <B>different hex</B> from the one the last pirate ship stood
                on.
              </Trans>,
              <Trans>
                Legal hexes are any <B>revealed sea</B> hex, shoals included, except one that
                touches the starting island. Then steal one random resource card from a player with
                a ship on that hex, your choice which. Buildings are irrelevant; only ships are
                robbed. If the player you pick holds no cards at all you may take <B>1 gold</B>{" "}
                instead, and that is the only way gold is ever stolen. A pirate ship landing on a
                shoal scatters the fish haul sitting there.
              </Trans>,
              <Trans>
                <B>Tribute.</B> While an opponent's pirate ship sits on a hex, each of your ships
                pays <B>1 gold once per turn</B> to move onto, off, or along any edge of it.
                Building there is free, and the owner never pays. There is no debt and no forced
                sale: if you will not pay, you simply cannot use those edges this turn.
              </Trans>,
              <Trans>
                <B>Chasing it off.</B> In your Movement phase, any of your ships that has not moved
                yet and touches the pirate's hex may roll. You name the order and rolling{" "}
                <B>stops at the first success</B>: a 6 wins on its own. Each Pirate Bonus village
                adds the one number it shows, not everything above it: the northern one adds a{" "}
                <B>5</B> and the southern one a <B>4</B>, so the northern village alone chases on a
                5 or a 6, the southern alone on a 4 or a 6, and both together on a 4, 5 or 6. On a
                success the pirate goes home and you immediately place your own and steal, exactly
                as on a 7. A ship that rolled may still move afterwards.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>The three missions</Trans>}>
          <Bullets
            items={[
              <Trans>
                All three run at once, and each has its own <B>track</B> of a start space and seven
                more, worth <B>0 / 1 / 1 / 2 / 2 / 2 / 3 / 3</B> points. Markers only ever move
                forward, they stack, and progress past the last space is discarded. Whoever is{" "}
                <B>farthest along</B> a track also holds its bonus tile, worth <VP>1 pt</VP>; on a
                tie the player who arrived first keeps it.
              </Trans>,
              <Trans>
                <B>Pirate lairs.</B> Every gold field comes up with a face-down lair on it: it
                produces nothing and nobody can build there. Unload crews onto it, and when the{" "}
                <B>third</B> crew arrives the lair falls at the end of that Movement phase. Every
                player with a crew there takes <B>2 gold and one space</B>, then all of them roll a
                die and add their own crews; the highest takes <B>one more space</B> and one crew
                back. The chit underneath is revealed and the hex pays <B>2 gold per building</B> on
                it from then on.
              </Trans>,
              <Trans>
                <B>Fish for the Council.</B> Once per Movement phase you may roll one die, before or
                after moving a ship but not halfway through: rolling ends the move of a ship that is
                under way. If it matches an <B>explored</B> shoal's number a fish haul appears
                there. A haul is a large piece, so the ship carrying it must be otherwise empty;
                deliver it to either <B>anchor</B> of the <B>Council hex</B> off the home coast (the
                two intersections flanking its seaward side) for one space. Hauls can be parked in a
                basin and picked up later, which is the intended relay.
              </Trans>,
              <Trans>
                <B>Spices.</B> A revealed spice farm carries one sack per player. Unload a crew onto
                it and take a sack aboard:{" "}
                <B>one crew and one sack per player per farm, forever.</B> The crew is spent and
                never comes back. Delivering sacks at a Council anchor is one space each. Placing
                the crew also opens that farm to <B>your</B> roads and settlements and grants its
                advantage at once.
              </Trans>,
              <Trans>
                Each village exists <B>once per region</B>, so twice on the board, and holding both
                copies doubles it. <B>Swift Voyage</B> gives all your ships +1 movement, or +2.{" "}
                <B>Pirate Bonus</B> lets you chase the pirate on a 5 or 6, or a 4, 5 or 6.{" "}
                <B>Fast Gold</B> lets you sell a resource for 1 gold once per Action phase, or
                twice.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>Gold, and winning</Trans>}>
          <Bullets
            items={[
              <Trans>
                Gold is a <B>second currency, not a resource card</B>. It never counts toward the
                7-card discard, it is never discarded, and the pirate cannot take it except from a
                player holding no cards at all. Everyone starts with <B>2</B>.
              </Trans>,
              <Trans>
                It comes from discoveries, from captured gold fields, from lair battles, from three
                identical resources at the bank, from Fast Gold, and from the{" "}
                <B>consolation gold</B>: any production roll that pays you no resource cards pays
                you 1 gold instead. It goes on resources (<B>2 gold buys any 1</B>, twice a turn),
                on tribute, and on player trades, which may mix gold and cards freely both ways.
              </Trans>,
              <Trans>
                <Cfg>17 points</Cfg> wins, at every player count (22 alongside Knights). They come
                from settlements (1 each, up to 5), harbour settlements (2 each, up to 4), your
                position on the three tracks (up to 9) and the three bonus tiles. A settler in a
                hold is worth nothing.
              </Trans>,
              <Trans>
                <B>Somebody else's turn can carry you over the line</B>, because a lair battle pays
                every player who had a crew there. It does not end the game there and then:{" "}
                <B>you only ever win on your own turn</B>, so the win is banked and lands when your
                turn comes round. Until then the game carries on and the points can still move.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>What it plays with</Trans>}>
          <P>
            <Trans>
              Explorers takes exactly one partner, and the reason it takes no others is not that it
              would be too much at once. It is that each of the others needs something Explorers has
              already removed or replaced, so there would be nothing for them to attach to.
            </Trans>
          </P>
          <Bullets
            items={[
              <Trans>
                <B>Knights</B> is the one that plays, with a few changes for the pairing. Cities
                come back, so a coastal settlement chooses between a city and a harbour settlement,
                and the choice is final. Setup places a city first, and it is the building that
                collects your starting resources, then the harbour settlement second. The barbarians
                count cities only, never harbour settlements. Knights stay on the island they were
                built on and never storm a lair or befriend a village, gold buys resources but never
                commodities, and the game plays to <B>22</B>. The Bishop simply activates your
                pirate ship, as a 7 does. The Aqueduct works as in Knights, never on a 7: on any
                other roll that pays you nothing, you take its resource of your choice and the
                consolation gold as well.
              </Trans>,
              <Trans>
                <B>Islands</B> also has ships and a pirate, and disagrees about both. An Islands
                ship is territory: it claims an edge, blocks opponents and counts toward the longest
                route. An Explorers ship is a vehicle that shares an edge with roads and with other
                ships, sails up to eight spaces in a turn and scores nothing. There is no
                reconciliation there, only a choice.
              </Trans>,
              <Trans>
                <B>Caravans</B> pays for buildings between camels and doubles roads beside them for
                the longest route, and Explorers computes no route length at all.
              </Trans>,
              <Trans>
                <B>Fishermen</B> lays its grounds along a coastline, <B>Rivers</B> lays a channel
                across the board and <B>Raiders</B> needs a fixed coast to land on and a castle to
                defend. All three need a map that is face up, and two thirds of this one is not.
              </Trans>,
              <Trans>
                <B>Wagons</B> drives overland between three trade hexes, and this board is
                deliberately not land-connected. <B>Harbormaster</B> scores buildings on harbours,
                and the harbours are gone.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
];

/**
 * One scenario's card on the overview grid: a thumbnail and a line, so adding
 * a scenario is one row.
 */
function ScenarioCard({
  thumb,
  icon,
  name,
  children,
}: {
  thumb?: ReturnType<typeof mkMini>;
  icon?: ReactNode;
  name: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <span className="w-7 h-7 overflow-hidden inline-block">
            {thumb ? (
              <HexCluster cells={thumb} hexW={31} hexH={36} boxW={102} boxH={97} scale={0.34} />
            ) : (
              <span className="w-7 h-7 inline-flex items-center justify-center">{icon}</span>
            )}
          </span>
          {name}
        </span>
      }
    >
      <div className="text-[13px] text-muted">{children}</div>
    </Panel>
  );
}

/* ------------------------- PLAYING ONLINE ------------------------- */

/**
 * The host's options, in the order the create-game panel presents them, so a
 * player sees which numbers at their table are choices.
 */
/*
 * `id` is React's key; keying by name would key by a translated string. A
 * `value` that is a number or range stays a literal; only words ("none",
 * "off", "shuffled") are messages.
 */
const TABLE_SETTINGS: { id: string; name: ReactNode; value: ReactNode; what: ReactNode }[] = [
  {
    id: "expansions",
    name: <Trans context="table setting">Expansions</Trans>,
    value: <Trans context="table setting value: no expansions">none</Trans>,
    what: (
      <Trans>
        Islands, Knights and the seven scenarios. Most of them stack, and each one raises the
        suggested point target. Explorers is the exception: it replaces the base game and takes only
        Knights alongside it.
      </Trans>
    ),
  },
  {
    id: "players",
    name: <Trans context="table setting: player count">Players</Trans>,
    value: "2–10",
    what: <Trans>The board grows with the count. See Base game → Setting up the board.</Trans>,
  },
  {
    id: "points",
    name: <Trans context="table setting">Points to win</Trans>,
    value: "10",
    what: (
      <Trans>
        5 to 13 in the base game, and higher with the expansions. Explorers always plays to 17, or
        22 with Knights.
      </Trans>
    ),
  },
  {
    id: "hand-limit",
    name: <Trans context="table setting">Hand limit</Trans>,
    value: "7",
    what: <Trans>How many cards you can hold before a 7 makes you discard. 5 to 15.</Trans>,
  },
  {
    id: "turn-timer",
    name: <Trans context="table setting">Turn timer</Trans>,
    value: "60s",
    what: (
      <Trans>
        Relaxed 120s, Normal 60s, or Blitz 30s. Every other clock is scaled to fit inside it.
      </Trans>
    ),
  },
  {
    id: "friendly-robber",
    name: <Trans context="table setting">Friendly robber</Trans>,
    value: <Trans context="table setting value: switched off">off</Trans>,
    what: (
      <Trans>
        Shields players still at their starting score (2 points, or 3 where setup deals a city) from
        the robber and the pirate. Not offered in a game with no robber.
      </Trans>
    ),
  },
  {
    id: "dice",
    name: <Trans context="table setting: how the dice are generated">Dice</Trans>,
    value: <Trans context="table setting value: dice are independent rolls">random</Trans>,
    what: <Trans>Random, or a shuffled deck of all 36 outcomes. See Dice and fairness.</Trans>,
  },
  {
    id: "board",
    name: <Trans context="table setting: how the board is generated">Board</Trans>,
    value: <Trans context="table setting value: balanced board generation">fair</Trans>,
    what: (
      <Trans>
        Fair balances number spacing and pip totals; random only enforces no adjacent 6s and 8s.
      </Trans>
    ),
  },
  {
    id: "turn-order",
    name: <Trans context="table setting">Turn order</Trans>,
    value: <Trans context="table setting value: seats are shuffled">shuffled</Trans>,
    what: <Trans>Shuffled at start, or the order players joined.</Trans>,
  },
  {
    id: "show-bank",
    name: <Trans context="table setting">Show bank</Trans>,
    value: <Trans context="table setting value: switched on">on</Trans>,
    what: <Trans>Whether the bank's remaining cards are displayed.</Trans>,
  },
  {
    id: "island-points",
    name: <Trans context="table setting">Island bonus</Trans>,
    value: "2",
    what: <Trans>Islands only. 0 to 4, and 0 turns the island bonus off.</Trans>,
  },
  {
    id: "pirate",
    name: <Trans context="table setting">Pirate</Trans>,
    value: <Trans context="table setting value: switched on">on</Trans>,
    what: <Trans>Islands only. Off means a 7 is always the land robber.</Trans>,
  },
  {
    id: "barbarian-distance",
    name: <Trans context="table setting">Barbarian distance</Trans>,
    value: "7",
    what: (
      <Trans>Knights only. The number of steps the fleet advances before it lands. 4 to 12.</Trans>
    ),
  },
  {
    id: "skip-first-attack",
    name: <Trans context="table setting">Skip first attack</Trans>,
    value: <Trans context="table setting value: switched off">off</Trans>,
    what: <Trans>Knights only. The fleet's first arrival is harmless.</Trans>,
  },
];

/**
 * Per-decision budgets and what auto-play does, from timings/timings.go and
 * engine/auto.go. The expiry column answers "it timed out and discarded the
 * wrong cards": auto-discard spreads evenly across your resource types.
 */
const CLOCKS: { id: string; what: ReactNode; budget: ReactNode; onExpiry: ReactNode }[] = [
  {
    id: "turn",
    what: <Trans context="clock table row: the whole turn">Your turn</Trans>,
    budget: <Trans>the turn timer</Trans>,
    onExpiry: <Trans>Ends your turn. It never builds, buys or trades for you.</Trans>,
  },
  {
    id: "roll",
    what: <Trans context="clock table row: rolling the dice">Rolling</Trans>,
    budget: "15s",
    onExpiry: <Trans context="auto-play: rolls the dice for you">Rolls.</Trans>,
  },
  {
    id: "setup-settlement",
    what: <Trans context="clock table row">Setup settlement</Trans>,
    budget: "45s",
    onExpiry: <Trans>Places a settlement at random, from the legal spots.</Trans>,
  },
  {
    id: "setup-road",
    what: <Trans context="clock table row">Setup road</Trans>,
    budget: "15s",
    onExpiry: <Trans>Places a road at random.</Trans>,
  },
  {
    id: "discard",
    what: <Trans context="clock table row">Discarding on a 7</Trans>,
    budget: "30s",
    onExpiry: <Trans>Spreads the discard evenly across the kinds of card you hold.</Trans>,
  },
  {
    id: "robber",
    what: <Trans context="clock table row">Moving the robber</Trans>,
    budget: "20s",
    onExpiry: <Trans>Takes the first hex with a valid victim, and does rob them.</Trans>,
  },
  {
    id: "offer",
    what: <Trans context="clock table row">A trade offer you made</Trans>,
    budget: <Trans>half the turn timer, 15s to 30s</Trans>,
    onExpiry: <Trans>Cancelled on your behalf. Nobody is forced to decline.</Trans>,
  },
  {
    id: "one-tap",
    what: <Trans context="clock table row">Expansion one-tap picks</Trans>,
    budget: "10s",
    onExpiry: (
      <Trans>
        Takes the obvious one (the bank's most plentiful resource, the first legal spot).
      </Trans>
    ),
  },
  {
    id: "targets",
    what: <Trans context="clock table row">Expansion target picks</Trans>,
    budget: "15s",
    onExpiry: <Trans>Takes the first legal target.</Trans>,
  },
  {
    id: "hand",
    what: <Trans context="clock table row">Expansion hand decisions</Trans>,
    budget: "20s",
    onExpiry: <Trans>Gives up your lowest-value cards, or bids nothing in a camel vote.</Trans>,
  },
];

const onlineChapters: Chapter[] = [
  {
    id: "on-settings",
    label: <Trans>Table settings</Trans>,
    render: () => (
      <Sec id="on-settings" title={<Trans>What the host chooses</Trans>}>
        <P>
          <Trans>
            Most numbers on the other tabs are defaults. When someone creates a game they pick from
            this list, and everything they pick applies to everyone at the table. Anywhere else on
            this page you see a <Cfg>dotted underline</Cfg>, this is the chapter it points at.
          </Trans>
        </P>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] text-muted border-collapse min-w-105">
            <thead>
              <tr className="text-foreground text-left">
                <th className={TH}>
                  <Trans context="table settings column: the setting's name">Setting</Trans>
                </th>
                <th className={TH}>
                  <Trans context="table settings column: the default value">Default</Trans>
                </th>
                <th className={TH_LAST}>
                  <Trans context="table settings column: what the setting does">What it does</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {TABLE_SETTINGS.map((s) => (
                <tr key={s.id} className="border-t border-line align-top">
                  <td className="py-1.5 pr-3 font-semibold text-foreground whitespace-nowrap">
                    {s.name}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{s.value}</td>
                  <td className="py-1.5">{s.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Panel title={<Trans>Ranked games ignore all of it</Trans>}>
          <P>
            <Trans>
              The ranked queues run a fixed setup nobody can adjust: 4 players, random dice, a fair
              board, shuffled turn order, no bots. There are two, one for the base game at 10 points
              and one for Knights at 13.
            </Trans>
          </P>
        </Panel>
      </Sec>
    ),
  },
  {
    id: "on-clocks",
    label: <Trans>Clocks &amp; auto-play</Trans>,
    render: () => (
      <Sec id="on-clocks" title={<Trans>Clocks, and what happens when one runs out</Trans>}>
        <P>
          <Trans>
            Every decision has its own budget, all of them capped by the table's{" "}
            <Cfg>turn timer</Cfg>, so a Blitz game squeezes the whole list. You also get about a
            second and a half of grace past the visible bar before anything happens.
          </Trans>
        </P>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] text-muted border-collapse min-w-95">
            <thead>
              <tr className="text-foreground text-left">
                <th className={TH}>
                  <Trans context="clock table column: which decision">Decision</Trans>
                </th>
                <th className={TH}>
                  <Trans context="clock table column: how long you get">Budget</Trans>
                </th>
                <th className={TH_LAST}>
                  <Trans context="clock table column: what auto-play does">If it expires</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {CLOCKS.map((c) => (
                <tr key={c.id} className="border-t border-line align-top">
                  <td className="py-1.5 pr-3 font-semibold text-foreground whitespace-nowrap">
                    {c.what}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{c.budget}</td>
                  <td className="py-1.5">{c.onExpiry}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Panel title={<Trans>The turn clock measures inactivity, not the turn</Trans>}>
          <P>
            <Trans>
              This is the part worth knowing. Every action you take{" "}
              <B>refloors your remaining time</B> to at least 15 seconds, so a player who keeps
              building and trading is never cut off in the middle of a long turn. The clock only
              bites when you stop doing anything.
            </Trans>
          </P>
          <P>
            <Trans>
              Auto-play also resolves <B>one decision</B> and stops. It never chains: after it rolls
              for you, the clock restarts fresh for what you do next. It will never build or trade
              on your behalf.
            </Trans>
          </P>
        </Panel>
      </Sec>
    ),
  },
  {
    id: "on-visible",
    label: <Trans>What everyone can see</Trans>,
    render: () => (
      <Sec id="on-visible" title={<Trans>What everyone can see</Trans>}>
        <P>
          <Trans>
            Costanio hides less than a physical table does, and a couple of these surprise people.
            Spectators see exactly what an opponent sees, never more.
          </Trans>
        </P>
        <div className="grid grid-cols-2 gap-2.5 max-[640px]:grid-cols-1">
          <Panel title={<Trans>Public to everyone</Trans>}>
            <Bullets
              items={[
                <Trans>How many cards you hold, and how many development cards</Trans>,
                <Trans>
                  <B>Exactly what you discard on a 7.</B> The full list, to the whole table
                </Trans>,
                <Trans>
                  Every dice roll, and every resource you gain: setup, production, bank trades,
                  completed trades
                </Trans>,
                <Trans>
                  Every trade offer, counter, decline and cancellation. There are no private offers
                </Trans>,
                <Trans>
                  Monopoly, Year of Plenty and Road Building in full, including who lost what
                </Trans>,
                <Trans>
                  The bank's exact remaining cards, and how many development cards are left
                </Trans>,
                <Trans>
                  Knights: commodity counts, improvement levels, metropolises, walls, knights
                </Trans>,
                <Trans>
                  <B>The whole board, from turn one</B>, in every ruleset except Explorers, which
                  deals two thirds of its map face down and turns it up as you sail
                </Trans>,
              ]}
            />
          </Panel>
          <Panel title={<Trans>Yours alone</Trans>}>
            <Bullets
              items={[
                <Trans>Which cards are in your hand, and which development cards</Trans>,
                <Trans>
                  <B>Which</B> card the robber took: only you and the victim know, though everyone
                  sees that a card moved
                </Trans>,
                <Trans>Knights: which progress cards you hold, though the count is public</Trans>,
                <Trans>
                  Knights: what a Master Merchant or a Wedding handed over, beyond how many
                </Trans>,
                <Trans>Your hidden victory-point cards, until they win you the game</Trans>,
              ]}
            />
          </Panel>
        </div>
        <P>
          <Trans>
            Worth being honest about: because almost every card movement is announced, a determined
            opponent can reconstruct most of your hand from the log. Treat the hidden list as "not
            shown", not as "unknowable".
          </Trans>
        </P>
      </Sec>
    ),
  },
  {
    id: "on-dice",
    label: <Trans>Dice &amp; fairness</Trans>,
    render: () => (
      <Sec id="on-dice" title={<Trans>Dice, and how you can check them</Trans>}>
        <div className="flex items-start gap-3">
          <span className="flex gap-1 shrink-0">
            <Die n={4} size={26} />
            <Die n={3} variant="red" size={26} />
          </span>
          <P>
            <Trans>
              Two modes, chosen by the host. <B>Random</B> is the default: independent rolls, real
              streaks, and <B>no balancing of any kind</B>. Nothing tracks who is behind, and
              nothing suppresses a run of the same number.
            </Trans>
          </P>
        </div>
        <P>
          <Trans>
            <B>Fair</B> deals instead from a shuffled deck of all 36 possible outcomes, refilled
            every 36 rolls, so over each cycle every total comes up exactly as often as it should.
            Ranked games always use <B>random</B>.
          </Trans>
        </P>
        <Panel title={<Trans>You can check we didn't rig it</Trans>}>
          <P>
            <Trans>
              The moment a table opens, before anyone has joined it, the server publishes a{" "}
              <B>fingerprint of the seed</B> that will decide everything you can see: the board, the
              seating, and every roll. It publishes the fingerprint, not the seed. Because the
              fingerprint comes first, the server cannot try seeds until it finds a board it likes,
              and it cannot swap the seed later without the fingerprint no longer matching.
            </Trans>
          </P>
          <P>
            <Trans>
              Hidden things (which card a robber steals, which card you draw) run on a{" "}
              <B>second, separate seed</B>. That is deliberate: it means the first seed can be
              released for checking without also revealing anybody's hand.
            </Trans>
          </P>
          <P>
            <Trans>
              When the game ends, both seeds are <B>released</B> with the replay. Open{" "}
              <B>Verify a game</B> from any of your finished games and the check runs in your own
              browser: it works the board, the seating and every roll out from the seed and shows
              you, roll by roll, whether they match what you were dealt.
            </Trans>
          </P>
          <P>
            <Trans>
              That page is on our site, so it proves less than it looks like it does. The same check
              is one file with no dependencies, downloadable from that page, and you can run it
              yourself against your saved game log.
            </Trans>
          </P>
        </Panel>
      </Sec>
    ),
  },
  {
    id: "on-leaving",
    label: <Trans>Disconnects &amp; bots</Trans>,
    render: () => (
      <Sec id="on-leaving" title={<Trans>Leaving, disconnects, and bots</Trans>}>
        <Bullets
          items={[
            <Trans>
              A disconnect doesn't skip you immediately. Your clock keeps running, and reconnecting
              picks up <B>the time you had left</B>, not a fresh budget.
            </Trans>,
            <Trans>
              If you are still gone after <B>a full lap of the table</B>, a bot takes your seat and
              plays on. <B>You can always take it back</B> by returning.
            </Trans>,
            <Trans>
              <B>Leave &amp; spectate</B> hands your seat to a bot right away and keeps you
              watching, with a button to rejoin. Joining a different table does the same thing to
              the one you were in.
            </Trans>,
            <Trans>
              A <B>forfeit</B> is recorded the first time the bot actually plays a move for you, and
              only once. Leaving and coming back before it moves costs nothing.
            </Trans>,
            <Trans>
              In a <B>ranked</B> game a forfeit places you <B>last regardless of your score</B> and
              locks you out of the queue for a spell that grows if you keep doing it. In a casual
              game there is <B>no penalty at all</B>.
            </Trans>,
            <Trans>
              If everyone leaves and nobody is watching, the game freezes and is{" "}
              <B>abandoned after a few minutes</B> with no winner.
            </Trans>,
            <Trans>
              <B>There is no undo.</B> Once a move is sent it is part of the game's history.
            </Trans>,
          ]}
        />
        <Panel title={<Trans>About the bots</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>Bots trade with players</B>, as the Trading chapter says. They accept, decline or
                counter your offers, and they propose trades of their own.
              </Trans>,
              <Trans>
                They play the base game and Knights properly, and fall back to simpler play for
                Islands ships and scenario pieces.
              </Trans>,
              <Trans>
                They pause about a second and a half between actions so their turns are watchable. A
                bot covering an absent player does not.
              </Trans>,
              <Trans>
                <B>Any game with a bot in it is never ranked</B> and never moves anyone's rating.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "on-ranked",
    label: <Trans>Ranked &amp; conduct</Trans>,
    render: () => (
      <Sec id="on-ranked" title={<Trans>Ranked play, and conduct</Trans>}>
        <Panel title={<Trans>What counts</Trans>}>
          <Bullets
            items={[
              <Trans>
                Only <B>ranked</B> games move your rating, and only when at least two rated players
                are in them. Casual and bot games still count toward your games and wins.
              </Trans>,
              <Trans>
                Ranked needs a linked Discord account, and the queues never include bots.
              </Trans>,
              <Trans>
                Your rating is shown as a <B>conservative estimate</B>: it starts low and climbs as
                the system becomes confident about you, so early games can feel like slow progress
                even when you are winning. It is marked provisional until then.
              </Trans>,
              <Trans>
                Leave a ranked game and you are placed <B>last regardless of score</B>, with a queue
                cooldown that grows each time.
              </Trans>,
              <Trans>
                The leaderboard is rebuilt once a day, so standings move on that schedule.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>Chat and reporting</Trans>}>
          <Bullets
            items={[
              <Trans>
                Chat needs a <B>linked Discord account</B>. There are two rooms, the lobby and the
                game you are in, no private messages, and spectators can talk in the game they are
                watching.
              </Trans>,
              <Trans>
                <B>Slurs are an immediate, permanent chat ban, with no warning.</B> The message is
                never sent or stored. You can still play; you just cannot talk. The same filter
                applies to display names, and a name that trips it is locked.
              </Trans>,
              <Trans>
                <B>Report a specific message</B> and a moderator sees it. Reports are anonymous, so
                you get no confirmation back. Reporting in bad faith repeatedly takes the ability
                away.
              </Trans>,
              <Trans>Three warnings, and the next one is a permanent ban.</Trans>,
              <Trans>Chat is not part of the game record, and never appears in a replay.</Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>Cosmetics never affect play</Trans>}>
          <P>
            <Trans>
              Nothing you can buy, earn or unlock changes a rule, a probability, a limit or what you
              can see. The rules engine has no idea any of it exists. The only thing supporting the
              game unlocks that touches a game at all is the ability to{" "}
              <B>host a table with fewer than two humans in it</B>, which is a hosting permission,
              not an advantage.
            </Trans>
          </P>
        </Panel>
      </Sec>
    ),
  },
];

const raidersChapters: Chapter[] = [
  {
    id: "rd-intro",
    label: <Trans>What changes</Trans>,
    render: () => (
      <Sec
        id="rd-intro"
        title={<Trans>The Raiders</Trans>}
        badge={
          <VP>
            <Trans>first to 12 points</Trans>
          </VP>
        }
      >
        <P>
          <Trans>
            Raiders turns the base game inside out. A hostile force lands on the coast, hex by hex,
            every time <B>anybody</B> builds. Hexes it saturates stop producing, buildings it
            surrounds stop scoring, and you answer by putting <B>riders</B> on the board and
            marching them to the coast. The arithmetic of a battle is table-wide, so defending is
            usually a joint effort between two or three players who then argue over the spoils.
          </Trans>
        </P>
        <Panel title={<Trans>Raiders and riders: two different figures</Trans>}>
          <Bullets
            items={[
              <Trans>
                A <B>raider</B> is a neutral enemy figure standing on a <B>hex</B>. Nobody owns one.
                They arrive from the sea, they stop hexes producing, and you capture them.
              </Trans>,
              <Trans>
                A <B>rider</B> is your own figure standing on a <B>path</B>, in your colour. Riders
                are the defenders. This is the piece the Knights expansion would call a knight; the
                word is different here because both can be in the same game.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans>What is taken away</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>No robber, and no pirate.</B> Neither is in play at all, in any combination.
              </Trans>,
              <Trans>
                <B>No development deck and no Largest Army.</B> Raiders ships four cards of its own,
                and nothing is ever held in hand.
              </Trans>,
              <Trans>
                Longest Road is unchanged, and becomes Longest Trade Route alongside Islands as
                usual.
              </Trans>,
              <Trans>
                Setup changes in one place: your <B>second placement is a city</B>, not a
                settlement, and it still pays <B>one</B> resource per adjacent producing hex.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "rd-landing",
    label: <Trans>The landings</Trans>,
    render: () => (
      <Sec id="rd-landing" title={<Trans>Every build brings them ashore</Trans>}>
        <Bullets
          items={[
            <Trans>
              Each time you build a settlement or upgrade one to a city, the dice are rolled until
              they give <B>three different numbers that are not 7</B>. One raider lands on the
              coastal hex each number names, in the order rolled.
            </Trans>,
            <Trans>
              A number that names <B>no</B> eligible coastal hex places nothing, and is{" "}
              <B>not re-rolled</B>. It still counts as one of the three.
            </Trans>,
            <Trans>
              Where several coastal hexes share a number, the raider goes to whichever holds the{" "}
              <B>fewest</B> raiders. If several are tied for fewest, the player who rolled chooses.
              You are only asked when the choice is real.
            </Trans>,
            <Trans>
              There is a fixed supply of raiders, three times the number of numbered coastal hexes
              on your board. When it runs out, <B>landings stop happening entirely</B> and building
              becomes free of consequence for the rest of the game. Captured raiders never go back
              into it, so the pressure tails off.
            </Trans>,
            <Trans>
              The placement round triggers <B>no</B> landings. Instead, the game itself puts the
              opening raiders on the coast before the first roll: one raider on each of the least
              likely numbers, scaled to the length of your coastline.
            </Trans>,
          ]}
        />
      </Sec>
    ),
  },
  {
    id: "rd-conquest",
    label: <Trans>Conquered hexes</Trans>,
    render: () => (
      <Sec id="rd-conquest" title={<Trans>Three raiders take a hex</Trans>}>
        <Bullets
          items={[
            <Trans>
              A coastal hex holding <B>three</B> raiders is conquered. It produces nothing on any
              roll, receives no further landings, and you may not <B>build</B> on any of its six
              paths or six intersections: no new road, no new settlement, and <B>no city upgrade</B>{" "}
              of a settlement you already own there.
            </Trans>,
            <Trans>
              Roads and settlements already there stay where they are. Nothing is ever removed by
              conquest.
            </Trans>,
            <Trans>
              A settlement or city with <B>no unconquered neighbour at all</B> is itself conquered:
              it is worth <VP>0 pts</VP>, produces nothing, draws no fish under Fishermen, and
              cannot use its harbour, so it contributes no harbour points under Harbormaster either.
              It still exists and still blocks, so an opponent's conquered settlement breaks your
              road exactly as an upright one does.
            </Trans>,
            <Trans>
              What a conquered building of your own stops doing is <B>joining</B>. Alongside Islands
              a road and a ship route that meet only there are two separate routes for the Longest
              Trade Route, and the pieces either side of it are not open ends.
            </Trans>,
            <Trans>
              Only the coastal fringe is ever at risk. The castle, the desert and (alongside
              Fishermen) the lake carry no single number and can never be conquered, and neither can
              any interior hex.
            </Trans>,
          ]}
        />
      </Sec>
    ),
  },
  {
    id: "rd-cards",
    label: <Trans>The four cards</Trans>,
    render: () => (
      <Sec id="rd-cards" title={<Trans>Buying an army</Trans>}>
        <P>
          <Trans>
            Riders cost no resources. There is no "build a rider", so buying a card <B>is</B> how
            you raise one, which is why more than half the deck is Muster. A card costs{" "}
            <Chip k="ore" /> <Chip k="sheep" /> <Chip k="wheat" /> and is{" "}
            <B>revealed and resolved the moment you buy it</B>, then discarded. Nothing is ever held
            in hand, so there are no hidden cards and no victory-point cards. When the deck runs out
            the discards are shuffled back, so it never truly empties.
          </Trans>
        </P>
        <Panel title={<Trans>What is in it</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>Muster</B> (14 of 26). Put one of your riders on one of the castle's six paths,
                if one is free.
              </Trans>,
              <Trans>
                <B>Swift Rider</B> (4). You <B>may</B> put one of your riders on any free path on
                the board. The only card you can decline.
              </Trans>,
              <Trans>
                <B>Treason</B> (4). Take 2 gold, then move 2 raiders from 2 different hexes onto 2
                other unconquered coastal hexes. With fewer than 2 on the board, take one or both
                from the supply instead.
              </Trans>,
              <Trans>
                <B>Intrigue</B> (4). Take 1 raider off a hex of your choice and add it to your
                prisoners. With no raider anywhere, it is discarded and you draw again.
              </Trans>,
            ]}
          />
        </Panel>
        <P>
          <Trans>
            A Muster with nothing to place, because you have no rider left or every castle path is
            taken, is discarded with no effect. It is not held, not refunded, and does not draw a
            replacement. Only Intrigue redraws, because only Intrigue says so.
          </Trans>
        </P>
      </Sec>
    ),
  },
  {
    id: "rd-riders",
    label: <Trans>Your riders</Trans>,
    render: () => (
      <Sec id="rd-riders" title={<Trans>Six figures, and how they march</Trans>}>
        <Bullets
          items={[
            <Trans>
              You have <B>six riders</B>, and that is a component limit like roads and settlements:
              with all six on the board you cannot place a seventh. One comes back each time one is
              lost.
            </Trans>,
            <Trans>
              A path holds at most one rider. Riders and roads share a path freely, in either order,
              and neither blocks the other. A rider never affects the distance rule, never blocks a
              settlement, and never breaks a road.
            </Trans>,
            <Trans>
              After you have finished trading and building, you may move <B>each</B> of your riders
              once. The allowance is <B>3 paths</B>; paying <Chip k="wheat" /> raises{" "}
              <B>that one rider</B> to 5. It is paid per rider, so hurrying three of them costs
              three wheat. With Fishermen, <B>two fish</B> can pay for one rider's push instead of
              the wheat: that is the 2-fish rung here, since there is no robber for it to remove.
            </Trans>,
            <Trans>
              Movement passes through everything: other riders, roads, settlements, cities,
              conquered hexes, raiders and rivers. A rider may not <B>end</B> on a path that already
              holds one, nor on one of the castle's six paths, and it may only travel on paths with
              land on at least one side.
            </Trans>,
            <Trans>
              <B>The castle sits at the centre of the board</B>, or on a hex beside it when a river
              runs through the centre. It carries no number chip and produces nothing, it can never
              be conquered, and its six paths are where every rider enters play. The centre keeps
              every coast about the same march away, on boards that run from 19 hexes to 61.
            </Trans>,
            <Trans>
              <B>The castle is a gateway, not a garrison.</B> A rider placed there must ride out on
              the same turn, and no move may end back on a castle path, so your turn will not end
              while one that could have left is still standing there. If every path within its reach
              is taken, it stays and the turn ends.
            </Trans>,
          ]}
        />
      </Sec>
    ),
  },
  {
    id: "rd-battle",
    label: <Trans>The battle sweep</Trans>,
    render: () => (
      <Sec id="rd-battle" title={<Trans>After everyone has moved</Trans>}>
        <P>
          <Trans>
            You move <B>all</B> of your riders, and only then are <B>all</B> the battles fought.
            They are never interleaved: you cannot fight one, see the result, and then move another
            rider into a second.
          </Trans>
        </P>
        <Bullets
          items={[
            <Trans>
              Every coastal hex is checked once, in a fixed order. A hex falls when it holds at
              least one raider and the riders on its <B>six adjacent paths outnumber them</B>.
            </Trans>,
            <Trans>
              <B>Every player's riders count, whoever's turn it is.</B> The sweep is automatic, not
              an action: nobody can decline a battle or choose which hexes to check, and you can be
              handed prisoners on somebody else's turn without doing anything.
            </Trans>,
            <Trans>
              Every raider on the hex becomes a <B>prisoner</B>, and prisoners never return to the
              supply. One involved player takes them all. Several take one each in turn order; if
              there are fewer prisoners than players, they roll for them and{" "}
              <B>anyone who comes away empty-handed takes 3 gold</B>. A leftover goes to whoever had
              the <B>most riders</B> in the fight, and if that is tied the tied players roll for it,
              with 3 gold each to the losers.
            </Trans>,
            <Trans>
              <B>Then the losses.</B> One die is rolled after each victory. It names a direction,
              and every rider that fought and stands on a path facing that way goes back to its
              owner, who takes <B>3 gold</B> for each one. Losses are settled immediately, so a
              rider lost at one hex is not there to defend the next.
            </Trans>,
            <Trans>
              A rider that survives may fight again in the same sweep, for a hex checked later. A
              rider that was lost may not.
            </Trans>,
            <Trans>
              Winning on a <B>conquered</B> hex un-conquers it: it produces again, it can be landed
              on again, and every conquered building beside it stands back up.
            </Trans>,
          ]}
        />
      </Sec>
    ),
  },
  {
    id: "rd-gold",
    label: <Trans>Gold and the 7</Trans>,
    render: () => (
      <Sec id="rd-gold" title={<Trans>A counter, not a card</Trans>}>
        <Bullets
          items={[
            <Trans>
              <B>Gold is not a resource.</B> It is a public counter: it is never discarded on a 7,
              it cannot be stolen, and no effect that names resource cards can see it.
            </Trans>,
            <Trans>
              You gain it 3 at a time for each of your riders lost in a battle, 3 for rolling off in
              a prisoner split and coming away empty, 2 from Treason, and from maritime trade.
            </Trans>,
            <Trans>
              You spend it on <B>2 gold for one resource from the bank, at most twice a turn</B>. If
              the bank has none of it, the purchase is refused before the gold is spent. It can also
              go on either side of a trade with another player, in any mix with resources.
            </Trans>,
            <Trans>
              Maritime trade can also produce gold, at{" "}
              <B>your own harbour rate for what you give</B>: 4 identical resources for 1 gold, 3
              with a generic harbour, and 2 at that resource's own 2:1 harbour. It is a poor deal at
              4 and worth a look at 2, and it is the same rate every scenario currency is bought at.
            </Trans>,
            <Trans>
              <B>A 7 has no robber to move.</B> Everyone holding more than seven resource cards
              returns half, and then you steal <B>one random card from a player of your choice</B>.
              Nothing is moved, nothing is blocked, and there is no production.
            </Trans>,
          ]}
        />
      </Sec>
    ),
  },
  {
    id: "rd-with-others",
    label: <Trans>With the other expansions</Trans>,
    render: () => (
      <Sec id="rd-with-others" title={<Trans>Raiders alongside the rest</Trans>}>
        <Panel title={<Trans>Knights</Trans>}>
          <Bullets
            items={[
              <Trans>
                <B>The barbarian fleet is gone</B>, and with it the track, the attacks and the
                Defender of the Realm card. Raiders' coast replaces that whole system, so there is
                one invasion in the game rather than two. The event die is still rolled and its
                colored gates still deal progress cards; only the ship face stops advancing
                anything.
              </Trans>,
              <Trans>
                Two consequences follow and they are worth knowing before you pick the pair.{" "}
                <B>Defender of the Realm can never be scored</B>, because no attack is ever
                repelled. And Knights' robber, which only ever enters play on the first attack,{" "}
                <B>never enters play at all</B>: no knight chases it, the Bishop has nothing to
                move, and under Fishermen the 2-fish spend that removes it is refused for the whole
                game (two fish hurry a rider instead).
              </Trans>,
              <Trans>
                <B>Landings get two extra triggers.</B> The event die's <B>ship face</B> lands one
                raider on the coastal hex the turn's own production dice named, and each{" "}
                <B>city improvement</B> you build rolls the two dice at once and lands one the same
                way. Both are single raiders rather than full three-raider landings, and both stack
                with the build trigger, which is not removed. A production roll of 7 lands nothing.
              </Trans>,
              <Trans>
                Every <B>three</B> prisoners make a point instead of every two, the raider supply is
                unbounded, and the 7 is this scenario's: discard over the limit, then take one
                random card from a player of your choice. Riders and knights are separate pieces and
                both are on the board.
              </Trans>,
              <Trans>
                The conquest ban covers Knights' pieces too: no new knight and no city wall on an
                intersection of a conquered hex, whether bought or from a card. A knight may still{" "}
                <B>move</B> there, and promoting or activating one is not building. A metropolis is
                placed by a city improvement, not built, so it is not affected.
              </Trans>,
            ]}
          />
        </Panel>
        <Panel title={<Trans context="scenario name">Islands</Trans>}>
          <Bullets
            items={[
              <Trans>
                Everything happens on the <B>main landmass</B>. The castle sits at its centre,
                raiders land only on its coastal hexes, and riders never cross water or stand on an
                outer island, Swift Rider included. If the deal leaves that landmass short of coast,
                the board is grown until it carries at least eight numbered coastal hexes.
              </Trans>,
              <Trans>
                Building or upgrading on an <B>outer island still triggers a full landing</B>, on
                the main landmass. Sailing away is not a way out of the invasion.
              </Trans>,
              <Trans>
                <B>Ships may be built on the edges of a conquered hex, and roads may not.</B> That
                asymmetry is deliberate: the coast is where you retreat to. A ship route hanging off
                a conquered building of yours is frozen until that building stands up again.
              </Trans>,
              <Trans>
                Neither the pirate nor the robber is in play. The island bonus and the rest of
                Islands scoring are unchanged, and the target stays <Cfg>12</Cfg>.
              </Trans>,
            ]}
          />
        </Panel>
      </Sec>
    ),
  },
  {
    id: "rd-victory",
    label: <Trans>Winning</Trans>,
    render: () => (
      <Sec
        id="rd-victory"
        title={<Trans>Twelve points</Trans>}
        badge={
          <VP>
            <Trans>first to 12 points</Trans>
          </VP>
        }
      >
        <Bullets
          items={[
            <Trans>
              Settlements <VP>1 pt</VP>, cities <VP>2 pts</VP>, Longest Road <VP>2 pts</VP>, and{" "}
              <B>one point per two prisoners</B>, plus whatever else is in your game.
            </Trans>,
            <Trans>
              <B>A lone prisoner is worth nothing at all.</B> It is not half a point, not even when
              working out who is in the lead.
            </Trans>,
            <Trans>
              Conquered buildings contribute <VP>0 pts</VP>. There is no Largest Army and no
              development-card points, because nothing is ever held.
            </Trans>,
            <Trans>
              The target depends on what else is at the table: <Cfg>12 points</Cfg> on its own and
              alongside Islands, Fishermen or Rivers, <Cfg>13</Cfg> alongside Knights (where every{" "}
              <B>three</B> prisoners make a point instead), and <Cfg>14</Cfg> alongside Wagons.
              Harbormaster adds 1 to whichever applies, Caravans adds 2 (4 when Islands is in the
              game too), and the old boot adds 1. As always, you only win on your own turn.
            </Trans>,
            <Trans>
              Buildings alone will not get you to 12 while the coast is being eaten, so every game
              is decided by prisoners. Prisoners are decided by whether two or three players will
              co-operate long enough to outnumber three raiders on one hex. That co-operation{" "}
              <B>is</B> the scenario.
            </Trans>,
          ]}
        />
      </Sec>
    ),
  },
];

const TABS: Tab[] = [
  {
    key: "base",
    label: <Trans context="ruleset name">Base Game</Trans>,
    tone: "success",
    blurb: <Trans>The core rules; every game builds on these. Race to 10 points.</Trans>,
    chapters: baseChapters,
  },
  {
    key: "islands",
    label: <Trans context="ruleset name">Islands</Trans>,
    tone: "accent",
    blurb: (
      <Trans>
        Ships sail the sea, gold hexes pay your pick, and the pirate prowls. Explore for bonus
        points.
      </Trans>
    ),
    chapters: islandsChapters,
  },
  {
    key: "knights",
    label: <Trans context="ruleset name">Knights</Trans>,
    tone: "danger",
    blurb: (
      <Trans>
        Commodities, city improvements, and knights that repel barbarian raids. Race to 13.
      </Trans>
    ),
    chapters: knightsChapters,
  },
  {
    key: "scenarios",
    label: <Trans context="ruleset name">Scenarios</Trans>,
    tone: "default",
    blurb: (
      <Trans>
        Self-contained twists on the standard board: Fishermen, Caravans, Harbormaster, Rivers,
        Wagons and Explorers. Raiders has a tab of its own.
      </Trans>
    ),
    beta: true,
    chapters: scenarioChapters,
  },
  {
    key: "raiders",
    label: <Trans context="scenario name">Raiders</Trans>,
    tone: "danger",
    blurb: (
      <Trans>
        Raiders land on the coast every time anybody builds. No robber, and no development deck: you
        answer with riders, and defending is a joint effort.
      </Trans>
    ),
    beta: true,
    chapters: raidersChapters,
  },
  {
    key: "online",
    label: <Trans>Playing online</Trans>,
    tone: "default",
    blurb: (
      <Trans>
        The parts that only exist online: table settings, clocks, who can see what, the dice, and
        what happens when someone leaves.
      </Trans>
    ),
    chapters: onlineChapters,
  },
];

// Re-exported for pages that import it from here. The list lives in
// `howToPlayTabs` so the router can read it without loading this module.
export { HOW_TO_PLAY_TABS };

const MODE_THUMBS: Record<string, ReturnType<typeof mkMini>> = {
  base: modeClassic,
  islands: modeSea,
  knights: modeKnights,
  scenarios: modeFish,
  // Raiders has its own tab rather than a chapter under Scenarios: it has no
  // robber, no development deck, a new victory condition and its own piece, so
  // it is not a twist on a standard table.
  raiders: modeRaiders,
  online: modeClassic,
};

/* ================================================================== *
 * Scroll-spy: highlight the chapter currently in view.
 * ================================================================== */

function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  const key = ids.join(",");
  useEffect(() => {
    if (!ids.length) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const scroller = document.scrollingElement ?? document.documentElement;
      // The line below the viewport top that marks the "current" chapter; a
      // section becomes active once its heading scrolls up past it.
      const line = Math.max(120, window.innerHeight * 0.25);
      // Bottom guard: when the page can't scroll further, the last chapter is
      // the one being read even if its top never reaches the line. Small
      // epsilon for fractional device pixels.
      if (window.innerHeight + window.scrollY >= scroller.scrollHeight - 2) {
        setActive(ids[ids.length - 1]);
        return;
      }
      // Sections are in document order, so the active one is the last whose top
      // has crossed the line.
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = id;
        else break;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

/* ================================================================== *
 * Page
 * ================================================================== */

export function HowToPlay() {
  const { t } = useLingui();
  const navigate = useNavigate();
  // The tab lives in the URL, not state, so deep links into these rules can
  // name both tab and chapter.
  const { tab: tabParam } = useSearch({ from: "/how-to-play" });
  const tab = TABS.find((t) => t.key === tabParam) ?? TABS[0];
  const ids = tab.chapters.map((c) => c.id);
  const active = useScrollSpy(ids);

  // Land on the chapter the hash names, on arrival and on a tab switch that
  // carries one. Deferred a frame because a new tab's sections mount after
  // this render. (The router handles a hash it routed to; this covers a full
  // page load.)
  const arrivalHash = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  useEffect(() => {
    if (!arrivalHash) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(arrivalHash)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(raf);
    // Arrival only. See the warning on writing the hash below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.key]);

  // Nothing here writes the hash on scroll. The router treats any history
  // write, even replaceState, as a navigation and scrolls the hash's element
  // into view, so updating it from a scroll handler yanks the reader back to
  // the previous chapter. The URL changes only on an explicit chapter or tab
  // pick, and `go` below leaves the scrolling to the router.

  function selectTab(key: string) {
    void navigate({ to: "/how-to-play", search: key === "base" ? {} : { tab: key }, hash: "" });
    // No scroll of our own: with no hash, the router puts a new tab at the top.
    // Scrolling here as well raced it.
  }

  function go(id: string) {
    // Set the hash and let the router scroll; scrolling here too would race
    // it and stop short.
    void navigate({
      to: "/how-to-play",
      search: tab.key === "base" ? {} : { tab: tab.key },
      hash: id,
      replace: true,
    });
  }

  return (
    <Screen>
      <SiteHeader active="howto" compact />

      <PageBody>
        <PageTitle
          icon={<Question weight="bold" size={26} />}
          title={<Trans>How to play</Trans>}
          actions={
            // The track look every toggle group shares: a flat well, the
            // chosen tab as the yellow tile.
            <TrackTabs
              label={t`Rules`}
              options={TABS.map((tb) => ({ label: tb.label, value: tb.key }))}
              value={tab.key}
              onChange={(k) => selectTab(k)}
            />
          }
        />

        <div className="grid grid-cols-[250px_1fr] gap-4 max-[900px]:grid-cols-1">
          {/* sidebar */}
          <div className="flex flex-col gap-3.5 self-start sticky top-4 max-[900px]:static max-[900px]:order-2">
            <nav
              aria-label={t`Chapters`}
              className={cn(cardVariants({ shadow: "hard" }), "p-3 flex flex-col gap-0.5")}
            >
              <div className="flex items-center gap-2 mb-1.5 px-2">
                <div className="w-7 h-7 overflow-hidden">
                  <HexCluster
                    cells={MODE_THUMBS[tab.key]}
                    hexW={31}
                    hexH={36}
                    boxW={102}
                    boxH={97}
                    scale={0.34}
                  />
                </div>
                <div className="text-[12px] font-semibold text-muted">
                  <Trans context="sidebar heading, drawn in caps">Chapters</Trans>
                </div>
              </div>
              {tab.chapters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => go(c.id)}
                  aria-current={c.id === active ? "true" : undefined}
                  className={cn(
                    "relative text-left rounded-lg px-3 py-1.5 text-[13px] cursor-pointer transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    // The chapter in view: the selected yellow print fill.
                    c.id === active
                      ? "bg-selected text-selected-ink font-semibold"
                      : "text-muted hover:text-foreground hover:bg-elev",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </nav>
            <div className={cn(cardVariants({ shadow: "hard" }), "p-4 flex flex-col gap-2.5")}>
              <div className="text-[12px] font-semibold text-muted">
                <Trans>New here?</Trans>
              </div>
              <div className="text-[13px] text-muted leading-relaxed">
                <Trans>
                  Read <strong className="font-semibold text-foreground">The goal</strong> and{" "}
                  <strong className="font-semibold text-foreground">Your turn</strong> on the Base
                  game tab and you know enough to play. Everything else is here for when a game does
                  something you want explained.
                </Trans>
              </div>
              <Button size="sm" className="self-start" onClick={() => selectTab("base")}>
                <Trans>Start with the basics</Trans>
              </Button>
              <div className="text-[12px] text-muted leading-normal">
                <Trans>A play-along tutorial is on the way.</Trans>
              </div>
            </div>
          </div>

          {/* body */}
          <div className="flex flex-col gap-3.5 min-w-0 max-[900px]:order-1">
            {tab.beta && (
              // Static notes: flat print slabs, not pieces (pb-site.css).
              <div
                data-pb-flat=""
                className={cn(
                  cardVariants({ shadow: "hard" }),
                  "px-5 py-3.5 flex items-center gap-3 max-[640px]:items-start",
                )}
              >
                <Badge tone="award" type="label" className="shrink-0">
                  <Trans>Beta</Trans>
                </Badge>
                <div className="text-[14px] text-muted leading-relaxed">
                  <Trans>
                    You can play these now: turn them on in the lobby when you make a table. They
                    are newer than the other rulesets and have had fewer games through them, so some
                    wording and art is still settling.
                  </Trans>
                </div>
              </div>
            )}
            <div
              data-pb-flat=""
              className={cn(
                cardVariants({ shadow: "hard" }),
                "px-5 py-3.5 flex items-center gap-3",
              )}
            >
              <div className="w-13.5 h-12.5 overflow-hidden shrink-0">
                <HexCluster
                  cells={MODE_THUMBS[tab.key]}
                  hexW={31}
                  hexH={36}
                  boxW={102}
                  boxH={97}
                  scale={0.52}
                />
              </div>
              <div className="text-[14px] text-muted leading-[1.5]">{tab.blurb}</div>
            </div>
            {tab.chapters.map((c) => (
              <div key={c.id}>{c.render()}</div>
            ))}
          </div>
        </div>
      </PageBody>
    </Screen>
  );
}
