import * as React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";
import { formatNumber } from "@/lib/intl";
import { type PlayerStat } from "@/lib/types";
import { type GameCaps } from "@/lib/caps";
import { type VPSource, vpBreakdownOf, vpOther, vpSources } from "@/lib/vp";
import { Boot, CrownSimple } from "@/lib/icons";
import { Spinner } from "@/components/ui/spinner";

/**
 * The two charts are lazy: they are the only users of the charting library,
 * which shouldn't be in the bundle every player downloads to reach the lobby.
 * They draw on the overview, so the fetch happens when a game ends.
 */
const RollChart = React.lazy(() =>
  import("./charts/RollChart").then((m) => ({ default: m.RollChart })),
);
const VPChart = React.lazy(() => import("./charts/VPChart").then((m) => ({ default: m.VPChart })));
import { Tip } from "./Tip";

/**
 * Scenario blocks the server sends that the shared `PlayerStat` type doesn't
 * name yet (game/scoreboard.go RaidersStat and WagonStat). Declared here since
 * the details matrix is the only reader.
 */
interface RaidersStatLine {
  prisoners: number;
  prisoner_vp: number;
  gold: number;
  riders_on_board: number;
  buildings_conquered: number;
}
interface WagonStatLine {
  delivered: number;
  level: number;
  gold: number;
  tolls: number;
  paid: number;
}
type StatLine = PlayerStat & { raiders?: RaidersStatLine; wagons?: WagonStatLine };

export interface PostGameScoreboardProps {
  players: PlayerStat[];
  winner: number;
  caps: GameCaps;
  seatName: (seat: number) => string;
  colorOf: (seat: number) => string;
  rolls: Record<number, number>;
  /**
   * The standings at every turn boundary, folded by the server. Optional: older
   * match records lack it, and then the race isn't drawn.
   */
  vpTrack?: number[][];
  /** The score the game was played to, when the caller knows it. */
  targetVP?: number;
  /**
   * Which dice the game used. Balanced dice change what the roll chart may
   * claim.
   */
  diceMode?: "random" | "fair";
}

/**
 * The two views: the overview (standings, then rolls, then race, read top to
 * bottom) and the details matrix (a reference table, no graphs).
 *
 * Rolls come before the race: the dice concern every seat equally and are what
 * players look at first.
 */
type ScoreView = "overview" | "details";

/** One decimal, in the app's language rather than the browser's. */
function oneDecimal(n: number): string {
  return formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** A signed figure: the sign, then the size. */
function signed(n: number): string {
  return `${n >= 0 ? "+" : "−"}${oneDecimal(Math.abs(n))}`;
}

/** A signed whole number of points: `+8`, `−2`. */
function signedPoints(n: number): string {
  return `${n >= 0 ? "+" : "−"}${formatNumber(Math.abs(n))}`;
}

/** The seat colour as a custom property, for `hud-pc` to derive its ink from. */
function pcStyle(color: string): React.CSSProperties {
  return { "--pc": color } as React.CSSProperties;
}

// The breakdown behind the Luck row: raw production numbers and the
// table-relative figure actually shown in the cell.
function LuckTipContent({ r }: { r: PlayerStat }) {
  const raw = r.produced - r.expected;
  const row = (label: React.ReactNode, value: React.ReactNode) => (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="font-num tabular-nums text-foreground">{value}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-0.5">
      {row(<Trans context="post-game stats row">Produced</Trans>, r.produced)}
      {row(<Trans context="post-game stats row">Expected</Trans>, oneDecimal(r.expected))}
      {row(<Trans context="post-game stats row">Raw luck</Trans>, signed(raw))}
    </div>
  );
}

// Every point a seat is holding, named. Doubles as the VP tooltip, where it is
// the one place the whole ledger is laid out as a sum.
function VPTipContent({
  r,
  sources,
  other,
}: {
  r: PlayerStat;
  sources: VPSource[];
  other: number;
}) {
  const { t } = useLingui();
  const b = vpBreakdownOf(r);
  const rows = sources
    .map((s) => [i18n._(s.label), s.value(b)] as const)
    .filter(([, v]) => v !== 0);
  if (other !== 0)
    rows.push([
      t({ message: "Other", context: "a victory-point source with no column of its own" }),
      other,
    ]);
  return (
    <div className="flex flex-col gap-0.5">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <span className="text-muted">{label}</span>
          <span className="font-num tabular-nums text-foreground">{value}</span>
        </div>
      ))}
      <div className="flex justify-between gap-4 border-t border-line mt-0.5 pt-0.5">
        <span className="text-muted">
          <Trans context="the sum of a scoreboard column">Total</Trans>
        </span>
        <span className="font-num tabular-nums text-foreground font-extrabold">{r.vp}</span>
      </div>
    </div>
  );
}

/**
 * Competition ranking, so a tie reads as a tie: two seats on 8 are both 2nd
 * and the next one down is 4th.
 */
function ranksOf(sorted: PlayerStat[]): number[] {
  return sorted.map((r) => 1 + sorted.filter((o) => o.vp > r.vp).length);
}

/**
 * The standings: who won, and why, in one read.
 *
 * A ranked list, not a table with a column per source: a Knights game with
 * Raiders and Wagons has eleven sources, too many for a 390px phone. Each seat
 * is one row (rank, seat, total, then the points it holds, as chips that wrap).
 * Sources a seat never scored in are left out. The chips always add up to the
 * total (any remainder gets an "Other" chip), and the tests check that.
 *
 * Chips are signed (`Cities +8`) because they are points, not pieces. Counts
 * that aren't points (roads built, cards held, production) and per-expansion
 * figures live in the details matrix.
 */
function Standings({
  rows,
  winner,
  seatName,
  colorOf,
  caps,
  targetVP,
}: {
  rows: PlayerStat[];
  winner: number;
  seatName: (s: number) => string;
  colorOf: (s: number) => string;
  caps: GameCaps;
  targetVP?: number;
}) {
  const { t } = useLingui();
  const sorted = [...rows].sort((a, b) => b.vp - a.vp);
  const ranks = ranksOf(sorted);
  const sources = vpSources(caps);
  const otherLabel = t({
    message: "Other",
    context: "a victory-point source with no column of its own",
  });
  return (
    <ol className="pg-standings" aria-label={t`Final standings`}>
      {sorted.map((r, i) => {
        const b = vpBreakdownOf(r);
        // Normally zero for every shipped ruleset. If a VP source goes unnamed,
        // the points surface here so the row still adds up.
        const other = vpOther(r, sources);
        const won = r.seat === winner;
        const chips = sources.map((s) => ({ s, v: s.value(b) })).filter(({ v }) => v !== 0);
        const name = seatName(r.seat);
        return (
          <li
            key={r.seat}
            className="pg-row hud-pc"
            style={pcStyle(colorOf(r.seat))}
            data-winner={won ? "true" : undefined}
            data-seat={r.seat}
          >
            <span className="pg-rank" aria-label={t`Place ${ranks[i]}`}>
              {formatNumber(ranks[i])}
            </span>
            <span className="pg-who">
              <span className="pg-dot" aria-hidden />
              <span className="pg-name" title={name}>
                {name}
              </span>
              {won && (
                <span className="pg-winner">
                  <CrownSimple weight="fill" aria-hidden />
                  <Trans context="post-game standings: the seat that won">Winner</Trans>
                </span>
              )}
            </span>
            <span className="pg-sources">
              {chips.map(({ s, v }) => (
                <span
                  key={s.key}
                  className="pg-src"
                  data-source={s.key}
                  data-points={v}
                  data-negative={v < 0 ? "true" : undefined}
                  title={i18n._(s.rate)}
                >
                  <span className="pg-src-l">{i18n._(s.label)}</span>
                  <span className="pg-src-v">{signedPoints(v)}</span>
                </span>
              ))}
              {other !== 0 && (
                <span
                  className="pg-src"
                  data-source="other"
                  data-points={other}
                  data-negative={other < 0 ? "true" : undefined}
                  title={t`Victory points from another source`}
                >
                  <span className="pg-src-l">{otherLabel}</span>
                  <span className="pg-src-v">{signedPoints(other)}</span>
                </span>
              )}
            </span>
            <Tip
              tapToOpen
              title={<VPTipContent r={r} sources={sources} other={other} />}
              hint={<Trans>Every chip on the row adds up to this total.</Trans>}
            >
              <span className="pg-total" data-vp={r.vp}>
                <span className="pg-total-n">{formatNumber(r.vp)}</span>
                <span className="pg-total-u">
                  {targetVP != null ? (
                    <Trans context="post-game standings: points out of the winning score">
                      of {formatNumber(targetVP)}
                    </Trans>
                  ) : (
                    <Trans context="scoreboard column: victory points">VP</Trans>
                  )}
                </span>
              </span>
            </Tip>
          </li>
        );
      })}
    </ol>
  );
}

interface DetailRow {
  /**
   * A descriptor, not a string. The labels are terse words whose meaning
   * depends on the column ("Cities" here is cities built; on the status panel
   * it is cities left), so each carries a `context` and is resolved where it is
   * drawn (see DetailsMatrix).
   */
  label: MessageDescriptor;
  get: (r: StatLine) => React.ReactNode;
}
interface DetailSection {
  title: MessageDescriptor;
  rows: DetailRow[];
}

/** A figure with the title it earned beside it: `7` and a held-award star. */
function held(n: number, has: boolean): React.ReactNode {
  return (
    <>
      {n}
      {has && (
        <span className="pg-held" aria-hidden>
          ★
        </span>
      )}
    </>
  );
}

// The per-player figures, grouped by area and gated by ruleset, as a comparison
// matrix (stats down, players across) in the Details view.
//
// Per seat only: `barbarian_defenses_won` and `camels_placed` are game-wide
// counts the server repeats on every line, so they are shown once, under the
// board.
function detailSections(caps: GameCaps): DetailSection[] {
  // Pieces on the board. Counts, not points: the standings are the VP ledger.
  const build: DetailRow[] = [
    {
      label: msg({ message: "Settlements", context: "post-game stats row: settlements built" }),
      get: (r) => r.settlements,
    },
    ...(caps.hasCities
      ? [
          {
            label: msg({ message: "Cities", context: "post-game stats row: cities built" }),
            get: (r: StatLine) => r.cities,
          },
        ]
      : []),
    {
      label: msg({ message: "Roads", context: "post-game stats row: roads built" }),
      get: (r) => r.roads,
    },
    // Only where the title is in play (not Explorers or Wagons).
    ...(caps.hasLongestRoad
      ? [
          {
            // Two whole labels rather than one with the noun swapped in.
            // Islands calls the title a trade route (it can cross water), and
            // word agreement is the translator's call.
            label: caps.hasShips
              ? msg({ message: "Longest trade route length", context: "post-game stats row" })
              : msg({ message: "Longest road length", context: "post-game stats row" }),
            get: (r: StatLine) => held(r.longest_road, r.has_longest_road),
          },
        ]
      : []),
  ];
  if (caps.hasDevCards) {
    build.push({ label: msg`Dev cards held`, get: (r) => r.dev_cards });
  }
  if (caps.hasLargestArmy) {
    build.push({
      label: msg({ message: "Knights played", context: "post-game stats row" }),
      get: (r) => held(r.knights, r.has_largest_army),
    });
  }
  const sections: DetailSection[] = [
    {
      title: msg({ message: "Board", context: "post-game stats section: the pieces on the board" }),
      rows: build,
    },
    {
      title: msg`Production & trade`,
      rows: [
        {
          label: msg({ message: "Produced", context: "post-game stats row" }),
          get: (r) => r.produced,
        },
        {
          label: msg({ message: "Expected", context: "post-game stats row" }),
          get: (r) => oneDecimal(r.expected),
        },
        {
          label: msg({ message: "Raw luck", context: "post-game stats row" }),
          get: (r) => signed(r.produced - r.expected),
        },
        {
          label: msg`Luck vs table`,
          get: (r) => (
            <Tip
              tapToOpen
              title={<LuckTipContent r={r} />}
              hint={
                <Trans>
                  Your dice deviation minus the table average, so a game-wide hot or cold run
                  cancels out.
                </Trans>
              }
            >
              <span className="pg-luck" data-sign={r.luck_rel >= 0 ? "up" : "down"}>
                {signed(r.luck_rel)}
              </span>
            </Tip>
          ),
        },
        // Cards discarded on a 7. With no robber (Explorers, Raiders, Wagons)
        // the label says what happened instead of naming the robber.
        {
          label: caps.hasRobber
            ? msg`Lost to robber`
            : msg({ message: "Discarded on a 7", context: "post-game stats row" }),
          get: (r) => r.robber_loss,
        },
        { label: msg`Stole / lost`, get: (r) => `${r.steals}/${r.stolen}` },
        { label: msg`Bank trades`, get: (r) => r.bank_trades },
        { label: msg`Player trades`, get: (r) => r.player_trades },
      ],
    },
  ];
  if (caps.hasKnightPieces) {
    sections.push({
      title: msg({ message: "Knights", context: "post-game stats section: the Knights expansion" }),
      rows: [
        // Science, Trade, Politics: the order the tracks are drawn in during the
        // game (lib/improvements TRACK_ROW). The `improve` indices stay engine
        // order (0 Trade, 1 Politics, 2 Science) and are spelled out per row.
        { label: msg`Science level`, get: (r) => r.cak?.improve[2] ?? "–" },
        { label: msg`Trade level`, get: (r) => r.cak?.improve[0] ?? "–" },
        { label: msg`Politics level`, get: (r) => r.cak?.improve[1] ?? "–" },
        // Numbered, not named: the number is the knight's contribution to the
        // barbarian defence, where tier words must be learnt.
        //
        // Unhyphenated, and the same message as the StatusPanel legend, so each
        // concept has one catalogue entry ("Strength {level} of 3" elsewhere is
        // unhyphenated too).
        { label: msg`Strength 1 knights`, get: (r) => r.cak?.knight_levels[0] ?? "–" },
        { label: msg`Strength 2 knights`, get: (r) => r.cak?.knight_levels[1] ?? "–" },
        { label: msg`Strength 3 knights`, get: (r) => r.cak?.knight_levels[2] ?? "–" },
        {
          label: msg({ message: "Active / total", context: "post-game stats row: knights" }),
          get: (r) => (r.cak ? `${r.cak.knights_active}/${r.cak.knights_total}` : "–"),
        },
        { label: msg`Metropolises`, get: (r) => r.cak?.metropolis ?? "–" },
        {
          label: msg({ message: "Walls", context: "post-game stats row: walls built" }),
          get: (r) => r.cak?.walls ?? "–",
        },
        {
          label: msg({
            message: "Commodities",
            context: "post-game stats row: commodities produced",
          }),
          get: (r) => r.cak?.commodities_produced ?? "–",
        },
        { label: msg`Progress played`, get: (r) => r.cak?.progress_played ?? "–" },
        { label: msg`Cities lost`, get: (r) => r.cak?.cities_lost_to_barbarians ?? "–" },
      ],
    });
  }
  if (caps.hasShips) {
    sections.push({
      title: msg({ message: "Islands", context: "post-game stats section: the Islands expansion" }),
      rows: [
        { label: msg`Gold gained`, get: (r) => r.islands?.gold_gained ?? "–" },
        { label: msg`Ships built`, get: (r) => r.islands?.ships ?? "–" },
        { label: msg`Island bonus`, get: (r) => r.islands?.island_vp ?? "–" },
      ],
    });
  }
  if (caps.hasFish) {
    // The three counts are tiles still held at the end (the server's `caught`
    // is `Held`), not tiles caught over the game.
    sections.push({
      title: msg({ message: "Fish", context: "post-game stats section: the Fishermen expansion" }),
      rows: [
        {
          label: msg({
            message: "1-fish tiles held",
            context: "post-game stats row: fish tiles worth one still held at the end",
          }),
          get: (r) => r.fish?.caught[0] ?? "–",
        },
        {
          label: msg({
            message: "2-fish tiles held",
            context: "post-game stats row: fish tiles worth two still held at the end",
          }),
          get: (r) => r.fish?.caught[1] ?? "–",
        },
        {
          label: msg({
            message: "3-fish tiles held",
            context: "post-game stats row: fish tiles worth three still held at the end",
          }),
          get: (r) => r.fish?.caught[2] ?? "–",
        },
        { label: msg`Value held`, get: (r) => r.fish?.value ?? "–" },
        {
          label: msg({ message: "Spent", context: "post-game stats row: fish value spent" }),
          get: (r) => r.fish?.spent ?? "–",
        },
        {
          label: msg`Old boot`,
          get: (r) =>
            r.fish?.has_boot ? (
              <Boot className="pg-boot" weight="fill" aria-label={i18n._(msg`Old boot`)} />
            ) : (
              "–"
            ),
        },
      ],
    });
  }
  if (caps.hasCaravans) {
    sections.push({
      title: msg({
        message: "Caravans",
        context: "post-game stats section: the Caravans expansion",
      }),
      rows: [
        { label: msg`Route bonus`, get: (r) => r.caravans?.route_bonus ?? "–" },
        { label: msg`Votes cast`, get: (r) => r.caravans?.votes_cast ?? "–" },
      ],
    });
  }
  // Raiders and Wagons. Raiders' prisoners are where count and score differ
  // (two make a point, three under Knights, a lone one is worth nothing), so
  // the standings carry points and this carries the count.
  if (caps.hasRaiders) {
    sections.push({
      title: msg({
        message: "Raiders",
        context: "post-game stats section: the Raiders scenario",
      }),
      rows: [
        {
          label: msg({
            message: "Prisoners taken",
            context: "post-game stats row: raiders captured",
          }),
          get: (r) => r.raiders?.prisoners ?? "–",
        },
        {
          label: msg({
            message: "Buildings conquered",
            context: "post-game stats row: own buildings the raiders hold at the end",
          }),
          get: (r) => r.raiders?.buildings_conquered ?? "–",
        },
        {
          label: msg({
            message: "Gold held",
            context: "post-game stats row: gold at game end",
          }),
          get: (r) => r.raiders?.gold ?? "–",
        },
      ],
    });
  }
  if (caps.hasWagons) {
    sections.push({
      title: msg({
        message: "Wagons",
        context: "post-game stats section: the Wagons scenario",
      }),
      rows: [
        {
          label: msg({
            message: "Loads delivered",
            context: "post-game stats row: wagon cargo delivered",
          }),
          get: (r) => r.wagons?.delivered ?? "–",
        },
        {
          label: msg({
            message: "Wagon level",
            context: "post-game stats row: upgrade level reached, 1 to 5",
          }),
          get: (r) => r.wagons?.level ?? "–",
        },
        {
          label: msg({
            message: "Tolls taken",
            context: "post-game stats row: gold taken from other wagons",
          }),
          get: (r) => r.wagons?.tolls ?? "–",
        },
        {
          label: msg({
            message: "Tolls paid",
            context: "post-game stats row: gold paid to other wagons",
          }),
          get: (r) => r.wagons?.paid ?? "–",
        },
      ],
    });
  }
  return sections;
}

function DetailsMatrix({
  rows,
  winner,
  seatName,
  colorOf,
  caps,
}: {
  rows: StatLine[];
  winner: number;
  seatName: (s: number) => string;
  colorOf: (s: number) => string;
  caps: GameCaps;
}) {
  const { t } = useLingui();
  const sorted = [...rows].sort((a, b) => b.vp - a.vp);
  const sections = detailSections(caps);
  return (
    <table className="pg-matrix">
      <thead>
        <tr>
          <th className="pg-stat-h sticky left-0 z-10">
            <Trans context="scoreboard column: which figure the row is">Stat</Trans>
          </th>
          {sorted.map((p) => {
            const name = seatName(p.seat);
            return (
              <th
                key={p.seat}
                className="pg-seat-h hud-pc"
                style={pcStyle(colorOf(p.seat))}
                data-winner={p.seat === winner ? "true" : undefined}
              >
                <span className="pg-seat-h-in">
                  <span className="pg-dot" aria-hidden />
                  <span className="pg-seat-name" title={name}>
                    {name}
                  </span>
                  {p.seat === winner && <CrownSimple weight="fill" aria-label={t`Winner`} />}
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {/* Resolved here, at draw time, and keyed by the resolved text: the
            tables hold descriptors so nothing is baked at module scope. */}
        {sections.map((sec) => (
          <React.Fragment key={i18n._(sec.title)}>
            <tr className="pg-sec">
              <td colSpan={sorted.length + 1}>
                <span className="sticky left-3">{i18n._(sec.title)}</span>
              </td>
            </tr>
            {sec.rows.map((row) => (
              <tr key={i18n._(row.label)}>
                {/* The stat name is the frozen first column of a sideways
                    scrolling table, so its width comes off every player column.
                    With `nowrap` it tracked the longest translation (`Dev cards
                    held` is 28 characters in German and Spanish): a 200px column
                    on a 360px phone.

                    So it wraps in a 150px block: a wrapped label only makes its
                    own row taller. 150px is about 21 English characters, enough
                    for every `en`, `ja` and `zh-Hans` label on one line and the
                    longest German and Spanish ones on two. */}
                <td className="pg-stat sticky left-0 z-10">
                  <span className="block max-w-[150px]">{i18n._(row.label)}</span>
                </td>
                {sorted.map((p) => (
                  <td key={p.seat} data-winner={p.seat === winner ? "true" : undefined}>
                    {row.get(p)}
                  </td>
                ))}
              </tr>
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}

export function PostGameScoreboard({
  players,
  winner,
  caps,
  seatName,
  colorOf,
  rolls,
  vpTrack,
  targetVP,
  diceMode,
}: PostGameScoreboardProps): React.JSX.Element {
  const { t } = useLingui();
  const [view, setView] = React.useState<ScoreView>("overview");
  const tabId = React.useId();
  // Narrowed rather than merely tested, so the chart below needs no second check.
  const hasTrack = !!vpTrack && vpTrack.length > 1;
  // Figures about the whole table. The server repeats them on every seat's
  // line, so the first is as good as any.
  const first = players[0] as StatLine | undefined;
  const facts: React.ReactNode[] = [];
  if (caps.hasBarbarians && first?.cak != null)
    facts.push(
      <span key="barb">
        <Trans>Barbarian attacks repelled: {first.cak.barbarian_defenses_won}</Trans>
      </span>,
    );
  if (caps.hasCaravans && first?.caravans != null)
    facts.push(
      <span key="camels">
        <Trans>Camels placed: {first.caravans.camels_placed}</Trans>
      </span>,
    );
  const views: { value: ScoreView; label: string }[] = [
    {
      value: "overview",
      label: t({ message: "Overview", context: "scoreboard view: the standings table" }),
    },
    {
      value: "details",
      label: t({ message: "Details", context: "scoreboard view: the full stats matrix" }),
    },
  ];
  return (
    <div className="pg-board">
      {/* When space runs out the caption wraps (`min-w-0`; German and Spanish
          run long) and `shrink-0` keeps the two view buttons intact. */}
      <div className="pg-head">
        <span className="hud-lab min-w-0 leading-tight">
          {view === "overview" ? <Trans>Final standings</Trans> : <Trans>Detailed stats</Trans>}
        </span>
        <div role="tablist" className="pg-tabs shrink-0">
          {views.map((v) => (
            <button
              key={v.value}
              type="button"
              role="tab"
              id={`${tabId}-${v.value}`}
              aria-selected={view === v.value}
              aria-controls={`${tabId}-panel`}
              className="pg-tab"
              onClick={() => setView(v.value)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${view}`}>
        {players.length === 0 ? (
          <div className="pg-empty">
            <Trans>Final standings unavailable.</Trans>
          </div>
        ) : view === "details" ? (
          // The matrix scrolls sideways on a narrow window; the charts must not,
          // since they size themselves to their box.
          <div className="pg-scroll">
            <DetailsMatrix
              rows={players}
              winner={winner}
              seatName={seatName}
              colorOf={colorOf}
              caps={caps}
            />
          </div>
        ) : (
          <>
            <Standings
              rows={players}
              winner={winner}
              seatName={seatName}
              colorOf={colorOf}
              caps={caps}
              targetVP={targetVP}
            />
            <ChartSection
              title={
                <Trans context="chart caption: how the dice fell over the game">Every roll</Trans>
              }
            >
              <RollChart rolls={rolls} diceMode={diceMode} />
            </ChartSection>
            {/* The race is drawn only when the log has one; older match records
                have no series. */}
            {hasTrack && (
              <ChartSection
                title={
                  <Trans context="chart caption: the score of every seat, turn by turn">
                    The race
                  </Trans>
                }
              >
                <VPChart
                  track={vpTrack}
                  winner={winner}
                  seatName={seatName}
                  colorOf={colorOf}
                  target={targetVP}
                />
              </ChartSection>
            )}
          </>
        )}
      </div>
      {facts.length > 0 && <div className="pg-facts">{facts}</div>}
    </div>
  );
}

/**
 * One chart under the standings, with its caption. Each has its own Suspense
 * boundary so a slow chunk holds only its own space.
 */
function ChartSection({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="pg-section">
      <div className="hud-lab pg-section-h">{title}</div>
      <ChartBoundary>
        <React.Suspense fallback={<ChartLoading />}>{children}</React.Suspense>
      </ChartBoundary>
    </section>
  );
}

/**
 * A chart that can't load costs its own space, not the end screen. A page
 * loaded before a deploy asks for the old chunk name, gets a 404, and the lazy
 * import rethrows at render; without this boundary the router's error page
 * replaces the whole game screen.
 */
export class ChartBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    console.error("[scoreboard] chart failed to load", error);
  }

  override render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <p className="hud-dialog-note py-6 text-center">
        <Trans>This chart could not be loaded. Reload the page to see it.</Trans>
      </p>
    );
  }
}

/** Held space while a chart's chunk arrives, sized so the panel does not jump. */
function ChartLoading() {
  return (
    <div className="h-[260px] grid place-items-center">
      <Spinner />
    </div>
  );
}
