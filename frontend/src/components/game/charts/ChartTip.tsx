import type { CSSProperties, ReactNode } from "react";

/** One line of the hover card: an optional mark, a name, and its figure. */
export interface ChartTipRow {
  key: string | number;
  mark?: ReactNode;
  name: ReactNode;
  value: ReactNode;
  /** Set in the heavy weight, for the winner's line. */
  strong?: boolean;
}

/**
 * The charts' hover card: a Punchboard piece (`[data-chart-tip]` in
 * pb-modules.css),
 * raised off the panel with the keyline and board edge, a heading, and a small
 * table of names against figures with the figures right-aligned. Recharts'
 * own card is a style object on a div: it read as loose text on the panel it
 * matched, with "Name : 6" punctuation, so the charts pass this as `content`.
 */
export function ChartTip({ title, rows }: { title: ReactNode; rows: ChartTipRow[] }) {
  return (
    <div data-chart-tip="">
      <div data-tip-h="">{title}</div>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-strong={r.strong ? "true" : undefined}>
              <td data-tip-mark="">{r.mark}</td>
              <td data-tip-name="">{r.name}</td>
              <td data-tip-value="">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A seat's swatch in the card: a dot in its line colour. */
export function TipDot({ color }: { color: string }) {
  return <span aria-hidden data-tip-dot="" style={{ "--dot": color } as CSSProperties} />;
}
