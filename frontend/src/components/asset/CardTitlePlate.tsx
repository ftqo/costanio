// The title plate a card face wears: the scrim, the name, the rule and its dots.
//
// SVG rather than DOM text: the spec places text by baseline ("y = 1199 px on
// a 1400 px card") with a measured outline and rule, which a 1000x1400 viewBox
// takes as coordinates directly, while DOM baselines depend on platform font
// metrics. It scales with the card and cannot reflow.
//
// The fitter uppercases the text (not `text-transform`), so the drawn string is
// the measured one; Turkish's dotted i is handled in `titleCase`.
import * as React from "react";
import { fitCardTitle, TITLE } from "@/lib/cardTitle";

const W = 1000;
const H = 1400;

export function CardTitlePlate({ title, locale }: { title: string; locale: string }) {
  const id = React.useId();
  const layout = React.useMemo(() => fitCardTitle(title, locale), [title, locale]);

  const size = layout.fontSize * H;
  const tracking = layout.tracking * size;
  // Letter-spacing adds a gap after the last glyph, so shift right by half a
  // gap to centre the ink (the CJK rule needs the same at 0.053 em).
  const x = W / 2 + tracking / 2;
  const leading = layout.leading * size;

  const common = {
    x,
    textAnchor: "middle" as const,
    fontSize: size,
    fontWeight: 700,
    letterSpacing: tracking,
    // The fitter's model is advances plus tracking, without kerning.
    style: { fontKerning: "none" as const },
  };

  const lines = layout.lines.map((text, i) => ({
    text,
    y: layout.baseline * H - (layout.lines.length - 1 - i) * leading,
  }));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="pointer-events-none absolute inset-0 h-full w-full"
      role="presentation"
    >
      <defs>
        <linearGradient id={`${id}-scrim`} x1="0" y1="0" x2="0" y2="1">
          {TITLE.scrim.stops.map((s) => (
            <stop key={s.at} offset={s.at} stopColor={TITLE.scrim.color} stopOpacity={s.alpha} />
          ))}
        </linearGradient>
      </defs>

      {/* The scrim, which the untitled masters do not carry. Bright title
          bands (knight, victory_point) need it. */}
      <rect
        x={0}
        y={TITLE.scrim.stops[0].at * H}
        width={W}
        height={H - TITLE.scrim.stops[0].at * H}
        fill={`url(#${id}-scrim)`}
      />

      <g className="card-title" lang={locale}>
        {/* The dark copy, standing proud of the ink. */}
        {lines.map((l, i) => (
          <text
            key={`o${i}`}
            {...common}
            y={l.y}
            fill={TITLE.outline}
            stroke={TITLE.outline}
            strokeWidth={TITLE.outlineStroke * size}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {l.text}
          </text>
        ))}
        {lines.map((l, i) => (
          <text
            key={`i${i}`}
            {...common}
            y={l.y}
            fill={TITLE.ink}
            stroke={TITLE.ink}
            strokeWidth={TITLE.inkStroke * size}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {l.text}
          </text>
        ))}
      </g>

      {/* The rule and its two end dots, identical in every locale. */}
      <rect
        x={(W * (1 - TITLE.rule.width)) / 2}
        y={TITLE.rule.top * H}
        width={W * TITLE.rule.width}
        height={TITLE.rule.height * H}
        fill={TITLE.rule.color}
      />
      {[-1, 1].map((s) => (
        <rect
          key={s}
          x={W * (0.5 + s * TITLE.rule.dotOffset) - (W * TITLE.rule.dot) / 2}
          y={TITLE.rule.top * H + (TITLE.rule.height * H) / 2 - (W * TITLE.rule.dot) / 2}
          width={W * TITLE.rule.dot}
          height={W * TITLE.rule.dot}
          fill={TITLE.rule.color}
        />
      ))}
    </svg>
  );
}
