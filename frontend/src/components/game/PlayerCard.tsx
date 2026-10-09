import * as React from "react";
import { Trans, Plural, useLingui } from "@lingui/react/macro";
import { cn } from "@/lib/utils";
import { Tip } from "./Tip";
import { Stat, Award } from "./Stat";
import { CamelGlyph, RouteGlyph } from "./moduleGlyphs";
import { Icons, CardFan } from "./hudIcons";
import { Glyph } from "./moduleUi";
import { seatCounterGrid, seatFields, type SeatDensity, type SeatVariant } from "@/lib/seatPanels";
import { improvementReward, nextImprovementReward } from "@/lib/improvements";
import { improvementCostText } from "@/lib/cardPhrases";
import type { ComKey } from "@/lib/cardFace";
import { TrackPips } from "./TrackPips";
import { GoodIcon } from "@/components/asset/AssetParts";

export interface TrackInfo {
  name: string; // Trade / Politics / Science
  track: number; // 0 Trade, 1 Politics, 2 Science (index into improvement rewards)
  level: number; // 0..5
  metropolis: boolean;
  nextCost: number; // commodities to reach the next level
  // The track's commodity as a bare mark. The card-face pastels are illegible
  // as thin pips on the HUD glass (filled vs unfilled measured 1.21:1). See
  // COMMOD.ink in lib/cardFace.
  pipColor: string;
  commodity: ComKey; // the track's commodity, as the token its messages are keyed by
}

export interface PlayerCardData {
  seat: number;
  name: React.ReactNode; // decorated name node
  /**
   * Hover text for the name, or undefined. Carries a bot's one-line character.
   * A string because it becomes a `title`; a second line under the name would
   * push the counters out of the fixed-height card.
   */
  nameTitle?: string;
  color: string;
  vp: number;
  active: boolean; // whose turn it is
  /**
   * This card is the viewer's own seat. Only the rail sets it; it marks the
   * name with a quiet "you" rather than changing anything the card counts.
   */
  mine?: boolean;

  handCount: number;
  devCount: number;
  knightsPlayed: number; // base-game largest-army count
  /**
   * Longest continuous route, as a length. The award chip says who holds the
   * title; this says how close everyone else is.
   */
  routeLength: number;

  longestRoad: boolean;
  longestRoadLabel: string; // ROAD | ROUTE
  /**
   * There is a Longest Road award in this game. False only under Wagons, which
   * removes the title (`Hooks.NoLongestRoad`). Undefined reads as "yes". The
   * route counter is not gated: wagon games still have roads; only the "5 or
   * more takes the title" half of its hint goes.
   */
  longestRoadInPlay?: boolean;
  /**
   * The base development deck, and with it Largest Army, is in this game. False
   * under Raiders and Explorers (`NoDevCards`); Knights has its own deck and
   * ignores these. Undefined reads as "yes".
   */
  devDeckInPlay?: boolean;
  largestArmyInPlay?: boolean;
  /**
   * The seat's gold, in a scenario that has it (Raiders, Wagons). Public, like
   * Rivers' coins. Undefined means no gold counter.
   */
  gold?: number;
  /** Raiders prisoners held; two are worth a point. Undefined outside Raiders. */
  prisoners?: number;
  /** Raiders: prisoners per point (2, or 3 alongside Knights). */
  prisonersPerVp?: number;
  /** Raiders: riders this seat has on the board. Undefined outside Raiders. */
  ridersOut?: number;
  /** Raiders: the component limit riders are counted against (six). */
  ridersPerSeat?: number;
  /** Wagons: the wagon's level, 1 to 5. Undefined outside Wagons. */
  wagonLevel?: number;
  /** Wagons: cargo delivered, each already a victory point in the score. */
  deliveries?: number;
  /** Explorers: cargo ships this seat has on the water. Undefined outside Explorers. */
  ships?: number;
  /** Explorers: victory points from the three mission tracks, bonus tiles included. */
  missionVp?: number;
  largestArmy: boolean;
  islandVp: number;
  /** Islands is in play, so the island-discovery slot is part of this game. */
  islands: boolean;

  /** Fishermen is in play, so the fish counter and the boot slot belong here. */
  fishermen?: boolean;
  /**
   * How many fish tiles this seat holds, which is public like a card count.
   * Their value is not public and is not shown: next to the count it would
   * identify the tiles (lib/types FishExt.tiles).
   */
  fish?: number;
  /**
   * This seat's actual tiles, in a revealed replay of a finished game and
   * nowhere else. Null in every live view.
   */
  fishMix?: readonly [number, number, number] | null;
  /**
   * This seat holds the old boot. Not a number and not in `vp`: it scores
   * nothing but raises its holder's win threshold by one, so it sits in the
   * awards row with the cost in the hint, never in the VP chip.
   */
  hasBoot?: boolean;

  /** Caravans is in play, so the camel-points counter belongs here. */
  caravans?: boolean;
  /**
   * This seat's points from its buildings between two camels. Already in `vp`;
   * the counter is the breakdown.
   */
  camelVp?: number;
  /** Rivers is in play, so the coin counter and the two wealth slots belong here. */
  rivers?: boolean;
  /**
   * This seat's coins. Fully public (the module has no hidden state), which is
   * what makes the two wealth chips readable: both compare these totals.
   */
  coins?: number;
  /** Holds the Wealthiest Settler tile. At most one seat, and none on a tie. */
  wealthiest?: boolean;
  /** Holds a Poorest Settler tile. Several seats can, and at setup all of them do. */
  poorest?: boolean;
  /**
   * The Poorest Settler tile is in this game. Dropped alongside Wagons and
   * Raiders, where the slot is hidden rather than drawn empty. The Wealthiest
   * slot survives both and is drawn whenever `rivers` is.
   */
  poorestInPlay?: boolean;

  /**
   * Harbormaster is in play, so the card slot and the harbour-point counter
   * belong on this card. Keyed on the ruleset, not this seat's standing, so the
   * slot exists from the first frame and the awards row never re-divides.
   */
  harbormaster?: boolean;
  /**
   * This seat's harbour points: 1 per settlement and 2 per city on a harbour
   * vertex. Drawn against `harbourThreshold` as "2 / 3".
   */
  harbourPoints?: number;
  /** This seat holds the Harbormaster card: +2 public victory points. */
  hasHarbormaster?: boolean;
  /**
   * The harbour points the card needs before it enters play, from the wire.
   * Undefined when not sent, in which case the counter shows a bare count.
   */
  harbourThreshold?: number;

  /**
   * Cards this seat may keep on a 7 before discarding half: the table limit
   * plus 2 per city wall. Undefined when unknown (a spectator view of a ruleset
   * that hasn't sent config).
   *
   * Resources and commodities are counted apart because they are spent apart,
   * but the 7 and the robber count their sum, which the counters show against
   * this limit.
   */
  discardAt?: number;

  knights?: {
    commodityCount: number;
    progressCount: number;
    knightsActive: number;
    knightsTotal: number;
    tracks: TrackInfo[];
    defenderVp: number;
    /**
     * Victory points from the Printer and the Constitution, kept and never
     * played, so they are not in `progressCount`. Public for every seat (the
     * redactor reveals VP cards), so showing the count leaks nothing.
     */
    extraVp: number;
  };
}

/** An award, drawn only on the seat that holds it. */
function HeldAward(props: React.ComponentProps<typeof Award>) {
  return props.held === false ? null : <Award {...props} />;
}

/**
 * A counter's chip, sized to fit the narrowest cell the grid gives it.
 *
 * The widest value is a fraction ("1/1", "2/3"), 18.9px in the numerals face at
 * 11px. With 2px padding each side, a 2px gap and a 2ch value reserve, a
 * fraction needs 40.9px, which fits the narrowest cells (43px for five columns
 * on the 252px card; see the card's `squat:` width for the phone).
 *
 * min-w-0 lets a cell give up width; `justify-center-safe` falls back to the
 * start edge when contents overflow, so they spill right instead of being
 * clipped on the left.
 */
const COUNTER =
  // eslint-disable-next-line shadcn/no-arbitrary-values -- the 2ch reserve is the measurement above; no token is a width in ch
  "hud-chip min-w-0 justify-center-safe h-6.5 px-0.5 gap-0.5 [&>span:last-child]:min-w-[2ch]";

/**
 * The counters row: every counter a ruleset has, in as few equal-width lines
 * as keep each one readable.
 *
 * A grid of `seatCounterGrid` columns, so a cell is never narrower than its
 * counter; with many modules a second line appears, which the rail reserves
 * (see lib/seatPanels). The column count comes from the cells actually drawn,
 * at both card widths, and the `squat:` variant switches with the same media
 * query that narrows the card.
 */
function CounterRow({ children }: { children: React.ReactNode }) {
  const cells = React.Children.toArray(children);
  const wide = seatCounterGrid(cells.length, false);
  const squat = seatCounterGrid(cells.length, true);
  return (
    <div
      data-counters
      data-rows={wide.rows}
      data-rows-squat={squat.rows}
      style={{
        ["--seat-cols" as string]: wide.cols,
        ["--seat-cols-squat" as string]: squat.cols,
      }}
      className={cn(
        "grid items-center gap-x-1 gap-y-1 overflow-hidden text-[11px]",
        "grid-cols-[repeat(var(--seat-cols),minmax(0,1fr))]",
        "squat:grid-cols-[repeat(var(--seat-cols-squat),minmax(0,1fr))]",
      )}
    >
      {cells}
    </div>
  );
}

// One opponent at a glance: who they are, how close they are to winning, and
// what threats and bonuses they hold, in three tiers (counts, bonus pills,
// city-improvement progress), each value explained on hover/focus.
// `footer` carries anything that must sit at the bottom of the tile (e.g. the
// per-seat turn countdown), inside the border that marks whose turn it is.
export function PlayerCard({
  p,
  footer,
  tab,
  density = "full",
  variant = "base",
  memory = false,
  className,
}: {
  p: PlayerCardData;
  footer?: React.ReactNode;
  /**
   * A small mark beside the name: the "last drawn" card tab (CardRevealLayer's
   * LastDrawnTab), which says what this seat just drew until its next turn.
   */
  tab?: React.ReactNode;
  /**
   * How much to show. The rail drops tiers as the seat count climbs, so ten
   * players still all fit on screen; see lib/seatPanels.
   */
  density?: SeatDensity;
  /** Knights adds a row; only the rail passes this, the expand card is always full. */
  variant?: SeatVariant;
  /**
   * Memory mode (GameConfig.memory_mode): the table counts nothing for you.
   *
   * Drops the score badge and the counters row, leaving the name and award
   * chips. Every dropped number can be worked out by watching the table; the
   * chips (Defender of the realm, a kept VP card) name points that aren't on
   * the board.
   *
   * Improvement tracks are not affected: they are face up at a real table, and
   * `show_improvements` already controls them.
   *
   * A prop because it is game-wide and never changes mid-game.
   */
  memory?: boolean;
  /** The rail stretches the card over the whole declared panel height. */
  className?: string;
}) {
  const { t } = useLingui();
  // The rail's Knights tier reserves a row for the tracks whether or not this
  // seat has improved anything, so every card in a game is the same height.
  const knights = p.knights;
  const show = seatFields(density, memory);
  const reserveTracks = show.tracks && variant === "knights";
  // What a 7 would take. The two pools are kept apart where they are spent and
  // summed here, since on someone else's card the sum is what matters (the
  // discard rule and the robber use it).
  const combined = p.handCount + (knights?.commodityCount ?? 0);
  const overLimit = p.discardAt !== undefined && combined > p.discardAt;
  // Said in the tip only; a permanent red wash on up to half the rail was too
  // loud for a roll that hasn't happened. A whole sentence of its own rather
  // than a fragment appended to the hint above, so translators can reorder it.
  const discardAt = p.discardAt;
  const overNote = overLimit ? (
    <>
      {" "}
      <Trans>
        Over the limit: <Plural value={combined} one="# card" other="# cards" /> against {discardAt}
        , so half go on a 7.
      </Trans>
    </>
  ) : null;
  const handHint = (
    <>
      {/* "A 7", not "a 7 and the robber": the discard counts the sum in every
          ruleset, but Wagons and Raiders have no robber. */}
      {knights ? (
        <Trans>Resources and commodities together, which is what a 7 counts.</Trans>
      ) : (
        <Trans>Cards held in hand.</Trans>
      )}
      {overNote}
    </>
  );
  const handTitle = knights ? t`Cards in hand` : t`Resource cards`;
  // The last counter of the row in both rulesets (the row branches on Knights
  // for its middle cells), hence a value.
  //
  // Two whole messages rather than one with "road" or "route" dropped in, so
  // inflecting languages can write each out.
  const isRoute = p.longestRoadLabel === "ROUTE";
  // Whether there is a title to take (false only under Wagons; see
  // PlayerCardData.longestRoadInPlay). The length still shows; the hint loses
  // its second half.
  const roadTitleInPlay = p.longestRoadInPlay !== false;
  const routeStat = (
    <Stat
      className={COUNTER}
      // Islands: roads and ships are one route, so the glyph and tooltip both
      // say route.
      icon={isRoute ? <RouteGlyph size={15} /> : <Icons.roadBar />}
      value={p.routeLength}
      title={isRoute ? t`Longest route` : t`Longest road`}
      hint={
        roadTitleInPlay
          ? isRoute
            ? t`This seat's longest unbroken route. 5 or more takes the title, and only a strictly longer one takes it off the holder.`
            : t`This seat's longest unbroken road. 5 or more takes the title, and only a strictly longer one takes it off the holder.`
          : t`This seat's longest unbroken road. There is no Longest Road title in this game, so it is worth no points.`
      }
    />
  );
  return (
    <div
      data-seat={p.seat}
      data-active={p.active ? "true" : undefined}
      className={cn(
        // No border or active ring: the card is the content of a seat panel
        // (SeatRail's tile), which owns the edge and the whose-turn ring.
        "relative isolate shrink-0 rounded-xl flex flex-col",
        // 252px at both tiers, so the rail holds still as content changes width.
        density === "full" ? "w-63 px-2.5 pt-2 pb-1.5 gap-1.5" : "w-63 px-2.5 py-1 gap-0.5",
        // A sideways phone's rail is one of two columns beside the board. Four
        // counters a line need 41px cells (a 196px row), so 200px is the floor
        // that fits a fraction in the last column; it then takes a quarter of
        // the width, up to 224px on a 932px phone, where the board is bound by
        // height.
        // eslint-disable-next-line shadcn/no-arbitrary-values -- a floor, a share of the width and a cap: no token is a clamp
        "squat:w-[clamp(200px,25vw,224px)]",
        className,
      )}
    >
      {/* identity + score. `data-identity` is a stable hook for this row; it
          isn't the card's first child, so don't reach it by position. */}
      <div data-identity className="flex items-center gap-1.5">
        {/* The seat's colour, as a dot with a ring of its own ink, matching the
            pieces and the banner dot. */}
        <span
          aria-hidden
          className={cn(
            "hud-pc shrink-0 rounded-full",
            density === "micro" ? "h-2.5 w-2.5" : "h-3 w-3",
          )}
          style={
            {
              "--pc": p.color,
              background: p.color,
              boxShadow:
                "0 0 0 2px var(--hud-fill-solid), 0 0 0 3px color-mix(in srgb, var(--pc-ink) 60%, var(--hud-fill))",
            } as React.CSSProperties
          }
        />
        {/* overflow-hidden, so a long name can't push the score out of a card
            that clips. */}
        <span
          className={cn(
            "flex min-w-0 items-baseline gap-1 overflow-hidden font-semibold",
            density === "micro" ? "text-[13px]" : "text-[14px]",
          )}
        >
          {/* Truncated to one line: the card is a fixed height, so a wrapped name
              would push the rows below out of the clipping box. An ellipsis
              shows there is more. */}
          <span className="min-w-0 truncate" title={p.nameTitle}>
            {p.name}
          </span>
          {p.mine && (
            <span className="hud-lab shrink-0">
              <Trans context="marks your own seat panel">you</Trans>
            </span>
          )}
        </span>
        {tab && <span className="flex shrink-0 items-center self-center">{tab}</span>}
        {/* The one counter `micro` keeps (name, score and hand size; see
            lib/seatPanels). `ml-auto` here rather than on the score, so the two
            stay together at the right end. */}
        {show.handOnly && (
          <span className="ml-auto shrink-0">
            <Stat icon={<Icons.hand />} value={combined} title={handTitle} hint={handHint} />
          </span>
        )}
        {/* The score, and in memory mode nothing in its place: a dash or hidden
            glyph would suggest a number is being withheld, when the table just
            isn't adding it up. */}
        {/* Awards the seat holds, as filled badges beside the score, since they
            are points. A title this seat doesn't hold draws nothing; the race
            reads off the counters row and the log. */}
        {show.awards && (
          <span data-awards className="ml-auto flex shrink-0 items-center gap-0.75">
            {/* Wagons removes Longest Road (its points go to delivered cargo), so
              the slot goes too, as with Largest Army below. */}
            {roadTitleInPlay && (
              <HeldAward
                icon={<Icons.road size={13} />}
                name="road"
                held={p.longestRoad}
                title={isRoute ? t`Longest Route` : t`Longest Road`}
                hint={
                  p.longestRoad
                    ? t`+2 victory points.`
                    : t`Not held by this player: worth +2 to whoever takes it.`
                }
              />
            )}
            {/* Knights has no Largest Army: progress cards replace the
              development deck and knight pieces replace soldiers. Defender of
              the realm has its own chip below. */}
            {!knights && p.largestArmyInPlay !== false && (
              <HeldAward
                icon={<Icons.knight size={13} />}
                name="army"
                held={p.largestArmy}
                title={t`Largest Army`}
                hint={
                  p.largestArmy
                    ? t`+2 victory points.`
                    : t`Not held by this player: worth +2 to whoever takes it.`
                }
              />
            )}
            {/* Drawn from the ruleset, not this seat's score, so a Knights game
              has a defender slot and an Islands game an island slot on every
              card from the first frame. A chip appearing mid-game would
              re-divide the row on every card. */}
            {knights && (
              <HeldAward
                icon={<Icons.defender size={13} />}
                name="defender"
                label={knights.defenderVp > 0 ? `+${knights.defenderVp}` : undefined}
                held={knights.defenderVp > 0}
                title={t`Defender of the realm`}
                hint={
                  knights.defenderVp > 0 ? (
                    <Plural
                      value={knights.defenderVp}
                      one="+# victory point from repelling barbarian attacks."
                      other="+# victory points from repelling barbarian attacks."
                    />
                  ) : (
                    t`No VP yet: worth +1 each time this seat is among the strongest defenders.`
                  )
                }
              />
            )}
            {/* Kept VP cards (the Printer, the Constitution): a public VP source
              like the two beside it, as a labelled chip with a tip. Ruleset
              driven, so the slot exists from the first frame. */}
            {knights && (
              <HeldAward
                icon={<Icons.keptVp size={13} />}
                name="kept-vp"
                label={knights.extraVp > 0 ? `+${knights.extraVp}` : undefined}
                held={knights.extraVp > 0}
                title={t`Victory point cards`}
                hint={
                  knights.extraVp > 0 ? (
                    <Plural
                      value={knights.extraVp}
                      one="+# victory point from cards kept outright (the Printer, the Constitution). Already counted in the score above."
                      other="+# victory points from cards kept outright (the Printer, the Constitution). Already counted in the score above."
                    />
                  ) : (
                    t`No VP yet: the Printer and the Constitution are kept outright, never played, and are worth +1 each.`
                  )
                }
              />
            )}
            {/* The island slot is the one chip dropped in memory mode: a first
              landing is a settlement visible on the board, while the others
              name points you can't see. */}
            {p.islands && !memory && (
              <HeldAward
                icon={<Icons.island size={13} />}
                name="island"
                label={p.islandVp > 0 ? `+${p.islandVp}` : undefined}
                held={p.islandVp > 0}
                title={t`Island bonus`}
                hint={
                  p.islandVp > 0 ? (
                    <Plural
                      value={p.islandVp}
                      one="+# victory point from reaching new islands."
                      other="+# victory points from reaching new islands."
                    />
                  ) : (
                    t`No VP yet: worth points for settling a new island first.`
                  )
                }
              />
            )}
            {/* The old boot: the one chip here that is bad news (a point its
              holder must find). It sits in the awards row because that is where
              held things live; the hint says which way it cuts. */}
            {p.fishermen && !memory && (
              <HeldAward
                icon={<GoodIcon id="boot" size={13} fallback={<Icons.boot size={13} />} />}
                name="boot"
                penalty
                held={!!p.hasBoot}
                title={t`The old boot`}
                hint={
                  p.hasBoot
                    ? t`Worth no points. Its holder needs one extra point to win, and may pass it after rolling to a player doing at least as well.`
                    : t`It can turn up in any catch, and in a short game may never appear. Whoever holds it needs one extra point to win.`
                }
              />
            )}
            {/* The Harbormaster is a title, so it sits with the two base ones:
              the engine re-derives it, it moves only to a strictly higher
              total, and a tie keeps it with the holder if they are in the tie,
              otherwise with nobody. That is why it survives memory mode (it
              isn't something you can read off the board). Ruleset-driven, so
              the slot exists from the first frame. */}
            {p.harbormaster && (
              <HeldAward
                icon={<Icons.harbor size={13} />}
                name="harbormaster"
                held={!!p.hasHarbormaster}
                title={t`Harbormaster`}
                hint={
                  p.hasHarbormaster
                    ? t`+2 victory points.`
                    : t`Not held by this player: worth +2 to whoever takes it.`
                }
              />
            )}
            {/* The two wealth tiles. Here rather than beside the coin count
              because they are points and coins are currency.

              Ruleset-driven like every slot above, and kept in memory mode:
              who holds them follows from every seat's coin total, which memory
              mode hides. */}
            {p.rivers && (
              <HeldAward
                icon={<GoodIcon id="rivercoin" size={13} fallback={<Icons.coin size={13} />} />}
                name="wealthiest"
                label={p.wealthiest ? "+1" : undefined}
                held={!!p.wealthiest}
                title={t`Wealthiest Settler`}
                hint={
                  p.wealthiest
                    ? t`+1 victory point, for holding the most coins outright.`
                    : t`Worth +1 to whoever holds the most coins on their own. On a tie nobody holds it.`
                }
              />
            )}
            {/* The other bad-news chip, a penalty. Several players can hold it,
              and at the start of setup everyone does. Hidden entirely where the
              pairing drops it (see `poorestInPlay`). */}
            {p.rivers && p.poorestInPlay && (
              <HeldAward
                icon={<GoodIcon id="rivercoin" size={13} fallback={<Icons.coin size={13} />} />}
                name="poorest"
                penalty
                label={p.poorest ? "-2" : undefined}
                held={!!p.poorest}
                title={t`Poorest Settler`}
                hint={
                  p.poorest
                    ? t`-2 victory points, for being among the players with the fewest coins. It goes the moment somebody else is lower.`
                    : t`Every player tied for the fewest coins holds it and loses 2 victory points. Everyone holds it at the start of the game.`
                }
              />
            )}
          </span>
        )}
        {show.vp && (
          <Tip
            title={<Plural value={p.vp} one="# victory point" other="# victory points" />}
            hint={<Trans>First to the target score wins.</Trans>}
            tapToOpen
          >
            <span
              className={cn(
                "hud-vp inline-flex shrink-0 cursor-default items-baseline gap-0.5 tabular-nums outline-none",
                !show.handOnly && !show.awards && "ml-auto",
              )}
            >
              {/* The numeral alone carries `data-vp`, so a reader of the badge
                  gets the score and not the unit printed after it. */}
              <b
                data-vp
                className={cn(
                  "font-display font-heavy leading-none",
                  density === "micro" ? "text-[15px]" : "text-[20px]",
                )}
              >
                {p.vp}
              </b>
              {/* The unit comes from an attribute, so the badge's text is just
                  the score ("7", not "7VP") for readers, copy-paste and tests. */}
              <i
                aria-hidden
                data-unit={t({
                  message: "VP",
                  context: "unit after a seat's score: victory points",
                })}
                className="hud-lab not-italic after:content-[attr(data-unit)]"
              />
            </span>
          </Tip>
        )}
      </div>

      {/* Counts, as a grid of equal cells that takes extra lines when one
          can't hold them readably (see CounterRow). The panel clips, so the
          rail reserves those lines (seatCounterGrid / seatPanelHeight) from the
          same ruleset-fixed count. */}
      {show.counters && (
        <CounterRow>
          {/* One card counter: from outside, what matters is what a 7 or the
            robber would take, and both count the sum. The resources/commodities
            split is shown on your own shelf, where you spend them. */}
          <Stat
            className={COUNTER}
            icon={<CardFan n={combined} />}
            value={combined}
            title={handTitle}
            hint={handHint}
            hot={overLimit}
          />
          {/* The cards a seat holds, together on the left: the hand, then the
              ruleset's face-down deck (development cards, or progress cards
              under Knights). The military counters on the right are board
              facts. */}
          {!knights && p.devDeckInPlay !== false && (
            <Stat
              className={COUNTER}
              icon={<Icons.devCard />}
              value={p.devCount}
              title={t`Development cards`}
              hint={t`Unplayed development cards.`}
            />
          )}
          {knights && show.extras && (
            <Stat
              className={COUNTER}
              icon={<Icons.devCard />}
              value={knights.progressCount}
              title={t`Progress cards`}
              hint={t`Trade / politics / science cards held. Hand limit 4.`}
            />
          )}
          {knights ? (
            /* Always "active/total", never a bare 0, so the value keeps the
               same shape from the first frame. */
            <Stat
              className={COUNTER}
              icon={<Icons.knightShield />}
              value={`${knights.knightsActive}/${knights.knightsTotal}`}
              title={t({ message: "Knights", context: "knights this seat has on the board" })}
              hint={t`Active / total knights on the board.`}
            />
          ) : p.largestArmyInPlay !== false ? (
            <Stat
              className={COUNTER}
              icon={<Icons.knightShield />}
              value={p.knightsPlayed}
              title={t`Knights played`}
              hint={t`Counts toward Largest Army.`}
            />
          ) : null}
          {/* Gold and prisoners, the Raiders (and Wagons) stocks. Public:
              gold is spendable this turn, prisoners are points in waiting.
              Drawn from zero, since the slot belongs to the game. */}
          {p.gold !== undefined && show.extras && (
            <Stat
              className={COUNTER}
              icon={<Icons.gold />}
              value={p.gold}
              title={t({ message: "Gold", context: "a seat's gold counter (Raiders, Wagons)" })}
              hint={t`Gold: not a resource, never discarded and never stolen. 2 gold buys a resource from the bank.`}
            />
          )}
          {p.prisoners !== undefined && show.extras && (
            <Stat
              className={COUNTER}
              icon={<Icons.prisoner />}
              value={p.prisoners}
              title={t({ message: "Prisoners", context: "Raiders prisoners a seat holds" })}
              hint={t`Raiders taken prisoner in battle. Every ${p.prisonersPerVp ?? 2} are worth a victory point, already counted in the score.`}
            />
          )}
          {/* The module pieces visible across the table: riders on the board,
              the wagon's level and deliveries, the fleet and the mission
              points. All public, drawn from the first frame. */}
          {p.ridersOut !== undefined && show.extras && (
            <Stat
              className={COUNTER}
              icon={<Glyph name="rider" size={14} />}
              value={p.ridersOut}
              title={t({ message: "Riders", context: "Raiders riders a seat has on the board" })}
              hint={t`Riders on the board, of ${p.ridersPerSeat ?? 6}. A card from the Raiders deck brings another on.`}
            />
          )}
          {p.wagonLevel !== undefined && show.extras && (
            <Stat
              className={COUNTER}
              icon={<Glyph name="wagon" size={15} />}
              value={p.wagonLevel}
              title={t({ message: "Wagon level", context: "Wagons: a seat's wagon level" })}
              hint={t`The wagon's level, 1 to 5. Each level moves further and drives barbarians off more often.`}
            />
          )}
          {p.deliveries !== undefined && show.extras && (
            <Stat
              className={COUNTER}
              icon={<Glyph name="delivery" size={14} />}
              value={p.deliveries}
              title={t({ message: "Deliveries", context: "Wagons: cargo a seat has delivered" })}
              hint={t`Loads delivered. Each is 1 victory point, already counted in the score.`}
            />
          )}
          {p.ships !== undefined && show.extras && (
            <Stat
              className={COUNTER}
              icon={<Glyph name="cship" size={15} />}
              value={p.ships}
              title={t({
                message: "Cargo ships",
                context: "Explorers: ships a seat has on the water",
              })}
              hint={t`Cargo ships on the water.`}
            />
          )}
          {p.missionVp !== undefined && show.extras && (
            <Stat
              className={COUNTER}
              icon={<Glyph name="flag" size={14} />}
              value={p.missionVp}
              title={t({ message: "Missions", context: "Explorers: mission victory points" })}
              hint={t`Victory points from the three mission tracks and their bonus tiles, already counted in the score.`}
            />
          )}
          {/* Fish sit with the cards, as a spendable stock. The tile count, not
              the value: how many tiles a seat drew follows from the public
              board, so a value beside it would name the tiles (lib/types
              FishExt.tiles). A finished game's replay reveals the mix. */}
          {p.fishermen && show.extras && (
            <Stat
              className={COUNTER}
              icon={<GoodIcon id="fish" size={16} fallback={<Icons.fish />} />}
              value={p.fish ?? 0}
              title={t({ message: "Fish", context: "fish tiles this seat holds" })}
              hint={
                // No price list: the ladder varies with ruleset and board (a
                // 6-fish bridge under Rivers, no 2-fish rung under Raiders, a
                // progress card at 7 under Knights). The Fish panel prices it.
                p.fishMix
                  ? t`Fish tiles held: ${p.fishMix[0]} worth 1, ${p.fishMix[1]} worth 2, ${p.fishMix[2]} worth 3. Spent whole on the actions in the Fish panel.`
                  : t`Fish tiles held. What each one is worth is that player's own business. Spent whole on the actions in the Fish panel.`
              }
            />
          )}
          {/* Harbour points, the race behind the Harbormaster chip. A fraction
              against the threshold (as with knights, the value keeps its shape
              from the start). The denominator comes off the wire
              (`ext.harbormaster.threshold`); with none sent, a bare count. */}
          {p.harbormaster && show.extras && (
            <Stat
              className={COUNTER}
              icon={<Icons.harbor />}
              // The fraction only where the row has room: beside the fish and
              // coin counters "0/3" overflows its cell, so the count stands
              // alone and the hint carries the threshold. The ruleset fixes
              // which form a card uses.
              value={
                p.harbourThreshold && !p.fishermen && !p.rivers
                  ? `${p.harbourPoints ?? 0}/${p.harbourThreshold}`
                  : (p.harbourPoints ?? 0)
              }
              title={t({ message: "Harbour points", context: "the Harbormaster race" })}
              hint={t`Victory points in this seat's buildings standing on harbours: 1 for a settlement, 2 for a city. The Harbormaster goes to whoever leads alone, and only from three up.`}
            />
          )}
          {/* Coins sit with the cards as a spendable stock, and are public: this
              is what the wealth chips compare. Drawn from zero, since zero
              earns the Poorest Settler tile. */}
          {p.rivers && show.extras && (
            <Stat
              className={COUNTER}
              icon={<GoodIcon id="rivercoin" size={16} fallback={<Icons.coin />} />}
              value={p.coins ?? 0}
              title={t({ message: "Coins", context: "the Rivers side currency" })}
              hint={t`Coins, earned by building along the river. Not resources: they are never discarded on a 7, cannot be stolen, and 2 of them buy any one resource from the supply.`}
            />
          )}
          {/* Caravans: the points this seat's buildings earn between two
              camels. Public (camels and buildings are on the board). Drawn from
              zero, since the slot belongs to the game. */}
          {p.caravans && show.extras && (
            <Stat
              className={COUNTER}
              icon={<CamelGlyph size={15} />}
              value={p.camelVp ?? 0}
              title={t({ message: "Camel points", context: "a seat's points from caravans" })}
              hint={t`Victory points from this seat's buildings between two camels, 1 each. Already counted in the score.`}
            />
          )}
          {routeStat}
        </CounterRow>
      )}

      {/* city improvements */}
      {reserveTracks && knights && (
        <div className="flex items-center gap-2">
          {/* `tr`, not `t`: the tooltip macro's `t` is in scope here. */}
          {knights.tracks.map((tr) => {
            // Bound outside the JSX so placeholders are named (`{nextReward}`,
            // `{nextCost}`), not `{0}`/`{1}`.
            //
            // The price is a whole rendered sentence (`improvementCostText`,
            // one message per commodity with an ICU plural), since German and
            // Spanish inflect the noun for the number.
            const nextReward = nextImprovementReward(tr.track, tr.level);
            const nextCost = improvementCostText(tr.commodity, tr.nextCost);
            return (
              <Tip
                key={tr.name}
                tapToOpen
                title={`${tr.name} ${tr.level}/5`}
                hint={
                  // The reward text for every seat's tracks (formerly only on
                  // the status panel, for your own).
                  <span className="flex flex-col gap-1">
                    {improvementReward(tr.track, tr.level) && (
                      <span>
                        <b className="text-foreground">
                          <Trans context="the reward this track already pays">Now:</Trans>
                        </b>{" "}
                        {improvementReward(tr.track, tr.level)}
                      </span>
                    )}
                    {tr.level >= 5 ? (
                      <span>
                        <Trans>Maxed out.</Trans>
                      </span>
                    ) : (
                      <span>
                        <b className="text-foreground">
                          <Trans context="the reward the next level would pay">
                            Next ({tr.level + 1}):
                          </Trans>
                        </b>{" "}
                        <Trans>
                          {nextReward}. {nextCost}
                        </Trans>
                      </span>
                    )}
                    {tr.metropolis && (
                      <span>
                        {tr.level >= 5 ? (
                          <Trans>Metropolis (permanent).</Trans>
                        ) : (
                          <Trans>Metropolis (temporary): reach level 5 to keep it.</Trans>
                        )}
                      </span>
                    )}
                  </span>
                }
              >
                {/* The three tracks split the card's width and each one's five
                  segments split that, so the row is a bar across the card and a
                  level reads as a proportion. One line of equal slots at every
                  seat, as in the awards row (see Stat.tsx's Award). */}
                <span className="flex min-w-0 flex-1 cursor-default items-center gap-1 outline-none">
                  {/* The track's commodity, not its initial: paper, cloth and
                    coin read the same in every language. */}
                  <GoodIcon
                    id={tr.commodity}
                    size={13}
                    className="hud-ic shrink-0 object-contain"
                  />
                  {/* Bars and the metropolis underline live in TrackPips, shared
                    with the shop's upgrade tiles, where it is the only level
                    readout. The metropolis underlines its track rather than
                    adding a star, which would make the bars unequal. */}
                  <TrackPips level={tr.level} metropolis={tr.metropolis} color={tr.pipColor} />
                </span>
              </Tip>
            );
          })}
        </div>
      )}
      {/* mt-auto, so the clock hangs off the bottom of whatever height the card
          was given, landing in the same place on every seat. */}
      {footer && <div className="mt-auto shrink-0">{footer}</div>}
    </div>
  );
}
