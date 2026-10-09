import {
  Bar,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReactNode } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { formatNumber } from "@/lib/intl";
import { ChartTip } from "./ChartTip";
import { DICE_TOTALS, expectedCount } from "./stats";

/**
 * What the dice did: eleven bars and a reference curve.
 *
 * Counts are drawn plainly with the number on each bar. A shaded 90% band was
 * dropped: it filled the plot at ordinary roll counts and answers a question
 * ("is this significant?") few players ask.
 *
 * The dashed curve is what two dice do, so every bar is read against it.
 *
 * One series, so the bars need no palette; the seven is red because it pays
 * nobody and takes from everyone. The curve uses reference ink.
 */
export function RollChart({
  rolls,
  /**
   * Balanced dice, when the page knows. In fair mode the engine deals the 36
   * outcomes rather than rolling them (see engine/dice.go), so the distribution
   * is flat by construction. Said plainly.
   */
  diceMode,
}: {
  rolls: Record<number, number>;
  diceMode?: "random" | "fair";
}) {
  const { t } = useLingui();
  const total = DICE_TOTALS.reduce((a, n) => a + (rolls[n] ?? 0), 0);
  const fair = diceMode === "fair";

  if (total === 0) {
    return (
      <div className="text-[12.5px] font-bold text-muted py-6 text-center">
        <Trans>Nobody rolled a die in this game.</Trans>
      </div>
    );
  }

  const data = DICE_TOTALS.map((n) => ({
    total: n,
    rolled: rolls[n] ?? 0,
    expected: expectedCount(n, total),
  }));
  const peak = Math.max(...data.map((d) => d.rolled));

  const labels = {
    rolled: t`Rolled`,
    expected: t`Expected`,
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Our own key rather than recharts', which can't say "the seven is red"
          (a fact about one bar, not a series). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] font-bold text-muted">
        <LegendKey swatch={<span className="w-2.5 h-2.5 rounded-[3px] bg-blue" />}>
          {labels.rolled}
        </LegendKey>
        {/* The numeral rather than a word: the key sits under an axis of
            numerals, and it spares the catalogues an entry. */}
        <LegendKey swatch={<span className="w-2.5 h-2.5 rounded-[3px] bg-red" />}>
          {formatNumber(7)}
        </LegendKey>
        <LegendKey
          swatch={
            <svg width="16" height="10" aria-hidden="true">
              <line
                x1="0"
                y1="5"
                x2="16"
                y2="5"
                stroke="var(--pbm-chart-ref)"
                strokeWidth="2"
                strokeDasharray="5 4"
              />
            </svg>
          }
        >
          {labels.expected}
        </LegendKey>
      </div>
      <div className="w-full h-[240px] text-[11px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 8 }}>
            {/* No Y axis and no grid: every bar carries its own count. */}
            <XAxis
              dataKey="total"
              tick={{ fill: "var(--color-muted)", fontSize: 11, fontWeight: 500 }}
              tickLine={false}
              axisLine={{ stroke: "var(--color-line)" }}
              interval={0}
            />
            {/* Hidden, but it gives the labels above the tallest bar room inside
                the plot. */}
            <YAxis hide domain={[0, Math.max(peak * 1.18, 1)]} />
            <Tooltip
              // No hover box behind the column: the hovered bar takes the ink
              // keyline instead (`activeBar`), as a piece does under the
              // pointer.
              cursor={false}
              offset={14}
              isAnimationActive={false}
              wrapperStyle={{ outline: "none", zIndex: 2 }}
              content={({ active, payload, label }) => {
                const d = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !d) return null;
                return (
                  <ChartTip
                    title={t`Total ${formatNumber(Number(label))}`}
                    rows={[
                      {
                        key: "r",
                        name: labels.rolled,
                        value: formatNumber(d.rolled),
                        strong: true,
                      },
                      // The expectation is a fraction and the count isn't;
                      // "9.7" beside "12" is where a decimal earns its place.
                      { key: "e", name: labels.expected, value: d.expected.toFixed(1) },
                    ]}
                  />
                );
              }}
            />
            <Bar
              dataKey="rolled"
              name={labels.rolled}
              fill="var(--color-blue)"
              radius={[4, 4, 0, 0]}
              maxBarSize={30}
              activeBar={{ stroke: "var(--hud-ink)", strokeWidth: 2 }}
              isAnimationActive={false}
            >
              {data.map((d) => (
                // The seven pays nobody and takes from everyone.
                <Cell
                  key={d.total}
                  fill={d.total === 7 ? "var(--color-red)" : "var(--color-blue)"}
                />
              ))}
              <LabelList
                dataKey="rolled"
                position="top"
                offset={6}
                fill="var(--hud-ink)"
                fontSize={11}
                fontWeight={700}
                formatter={(v) => (Number(v) === 0 ? "" : formatNumber(Number(v)))}
              />
            </Bar>
            <Line
              dataKey="expected"
              name={labels.expected}
              type="linear"
              stroke="var(--pbm-chart-ref)"
              strokeWidth={2}
              strokeDasharray="4 4"
              strokeLinecap="round"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* Balanced dice get a line of prose because the engine deals the 36
          outcomes, so an even spread is the dealer, not luck. Random dice get
          nothing. */}
      {fair && (
        <div className="text-[10.5px] font-semibold text-muted leading-snug">
          <Trans>
            {formatNumber(total)} rolls with balanced dice on, so the game deals the 36 outcomes
            instead of rolling them. The spread is the deal, not luck.
          </Trans>
        </div>
      )}
    </div>
  );
}

/** One entry in the hand-rolled key: a mark, then what it means. */
function LegendKey({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {children}
    </span>
  );
}
