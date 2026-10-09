import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLingui } from "@lingui/react/macro";
import { formatNumber } from "@/lib/intl";
import { ChartTip, TipDot } from "./ChartTip";
import { raceSamples, scoreTicks, turnTicks, vpSeries } from "./stats";

/** A seat colour as ink on the panel: see `.hud-pc` in index.css. */
function seatInk(color: string): string {
  return `color-mix(in oklab, ${color} var(--hud-pc-keep), var(--hud-pc-toward))`;
}

/**
 * The race: how the score developed over the game, which the standings can't
 * show (who led, when it stopped being close).
 *
 * The series is the server's (game/scoreboard.go stamps standings at every turn
 * boundary while folding the log). Nothing here derives victory points; the
 * client doesn't know hidden cards and shouldn't be a second rules engine.
 *
 * Colour is the seat's, via the same `colorOf` the log and board use (which
 * follows the viewer's colourblind palette), never the series' rank.
 */
export function VPChart({
  track,
  winner,
  seatName,
  colorOf,
  /** The score the game was played to, when the page knows it. */
  target,
}: {
  track: number[][];
  winner: number;
  seatName: (seat: number) => string;
  colorOf: (seat: number) => string;
  target?: number;
}) {
  const { t } = useLingui();
  // Two rows are the minimum for a line. A game that ended inside one turn
  // draws nothing.
  if (track.length < 2) return null;

  const seats = Math.max(...track.map((r) => r.length));
  const series = Array.from({ length: seats }, (_, seat) => vpSeries(track, seat));
  const highest = Math.max(1, ...track.flat());
  // The target belongs on the axis even when nobody reached it (a conceded or
  // drawn game): the chart is about distance from it.
  const yMax = Math.max(highest, target ?? 0);

  // Recharts wants a row per x, so the columns are transposed once here, one
  // row per round (`raceSamples`). Turns are 1-based on screen: the first row
  // is the start of turn 1, everyone on 0.
  const data = raceSamples(track.length, seats).map((i) => {
    const row: Record<string, number> = { turn: i + 1 };
    for (let seat = 0; seat < seats; seat++) row[`s${seat}`] = series[seat][i];
    return row;
  });

  // The winner is painted last, since SVG has no z-index and the lines converge
  // at the top right at the end.
  const order = Array.from({ length: seats }, (_, i) => i)
    .filter((i) => i !== winner)
    .concat(winner >= 0 && winner < seats ? [winner] : []);

  // The key reads in finishing order, matching the standings above.
  const last = track[track.length - 1];
  const standing = Array.from({ length: seats }, (_, i) => i).sort(
    (a, b) => (last[b] ?? 0) - (last[a] ?? 0) || a - b,
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="w-full h-[240px] text-[11px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 14, bottom: 4, left: -18 }}>
            {/* Solid hairlines at the score ticks: something to measure
              against, not to read. */}
            <CartesianGrid stroke="var(--pbm-chart-grid)" vertical={false} />
            <XAxis
              dataKey="turn"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--pbm-chart-grid)" }}
              ticks={turnTicks(data.map((d) => d.turn))}
            />
            <YAxis
              domain={[0, yMax]}
              ticks={scoreTicks(yMax)}
              allowDecimals={false}
              width={38}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            {target != null && (
              <ReferenceLine
                y={target}
                stroke="var(--pbm-chart-ref)"
                strokeDasharray="4 4"
                strokeLinecap="round"
                label={{
                  value: t`${formatNumber(target)} to win`,
                  // Left, not right: the winner's line ends at the top right, so
                  // that space is always occupied.
                  position: "insideTopLeft",
                  fill: "var(--color-muted)",
                  fontSize: 10,
                }}
              />
            )}
            <Tooltip
              cursor={{ stroke: "var(--pbm-chart-ref)", strokeWidth: 1.5 }}
              // Pinned to the top of the plot and following the pointer
              // across: it never sits on the lines it describes.
              position={{ y: 0 }}
              offset={14}
              isAnimationActive={false}
              wrapperStyle={{ outline: "none", zIndex: 2 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                // Highest score first, so a turn reads as a standings table.
                // One row per seat: recharts reports the casing lines too
                // (same dataKey), whatever their tooltipType.
                const bySeat = new Map<number, number>();
                for (const p of payload)
                  bySeat.set(Number(String(p.dataKey).slice(1)), Number(p.value));
                const rows = [...bySeat]
                  .map(([seat, v]) => ({ seat, v }))
                  .sort((a, b) => b.v - a.v || a.seat - b.seat);
                return (
                  <ChartTip
                    title={t`Turn ${formatNumber(Number(label))}`}
                    rows={rows.map(({ seat, v }) => ({
                      key: seat,
                      mark: <TipDot color={seatInk(colorOf(seat))} />,
                      name: seatName(seat),
                      value: formatNumber(v),
                      strong: seat === winner,
                    }))}
                  />
                );
              }}
            />
            {/* A casing in the panel's own colour under every line, painted
              before any line: where two lines cross, the one on top is cut
              cleanly out of the one beneath instead of the two blurring
              together. Not in the tooltip. */}
            {order.map((seat) => (
              <Line
                key={`case${seat}`}
                type="monotone"
                dataKey={`s${seat}`}
                stroke="var(--pg-bg, var(--hud-fill-solid))"
                strokeWidth={seat === winner ? 8 : 7}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={false}
                legendType="none"
                tooltipType="none"
                isAnimationActive={false}
              />
            ))}
            {order.map((seat) => (
              <Line
                key={seat}
                // A curve through one point a round (`raceSamples`). Monotone
                // interpolation never overshoots the points it passes
                // through, so a line cannot dip below a held score or rise
                // past the winning one between rounds.
                type="monotone"
                dataKey={`s${seat}`}
                name={seatName(seat)}
                // The seat's ink, not its raw colour (as `hud-pc` does for
                // lines): raw yellow vanished on the light panel and raw blue on
                // the dark.
                stroke={seatInk(colorOf(seat))}
                strokeWidth={seat === winner ? 4 : 3}
                strokeLinecap="round"
                strokeLinejoin="round"
                // No dot per round; only the hover dot, in the seat's colour on
                // a ring of the panel's.
                dot={false}
                activeDot={{
                  r: 5,
                  fill: seatInk(colorOf(seat)),
                  strokeWidth: 2.5,
                  stroke: "var(--pg-bg, var(--hud-fill-solid))",
                }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* Our own key rather than recharts', whose legend sits inside the
          chart's fixed height and overflowed at ten seats on a phone. In
          finishing order with each final score, so the key doubles as the
          result. Names in ink, not line colour (black/white seats); the
          swatch shows which line. */}
      <ul className="pg-key">
        {standing.map((seat) => (
          <li key={seat} data-winner={seat === winner ? "true" : undefined}>
            <svg width="16" height="8" aria-hidden="true">
              <line
                x1="2"
                y1="4"
                x2="14"
                y2="4"
                stroke={seatInk(colorOf(seat))}
                strokeWidth="4"
                strokeLinecap="round"
              />
            </svg>
            {seatName(seat)}
            <span data-key-score="">{formatNumber(last[seat] ?? 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
