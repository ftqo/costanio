import type { Board, BuildingView, CamelPath, CaravansExt } from "@/lib/types";
import {
  boardViewBox,
  edgeEnds,
  edgeKey,
  hexCenter,
  hexPolygon,
  previewFill,
  vertexKey,
  vertexPt,
} from "@/lib/hexgeo";
import { camelPathKey } from "@/lib/caravans";

const S = 10; // small hex size; the viewBox scales it to fit

/**
 * The caravans' colours: three per oasis, up to three oases, so nine.
 *
 * Unrelated hues rather than tints of one brown, which would be
 * indistinguishable at this width. Every caravan is also named by number
 * wherever it appears, so colour is never the only cue.
 */
export const CARAVAN_COLORS = [
  "var(--color-amber)",
  "var(--color-rose)",
  "var(--color-blue)",
  "var(--color-green)",
  "var(--color-purple)",
  "var(--color-orange)",
  "var(--color-yellow)",
  "var(--color-slate)",
  "var(--color-red)",
];

export function caravanColor(i: number): string {
  return CARAVAN_COLORS[i] ?? "var(--color-caravans)";
}

/**
 * A flat, cheap picture of the camels, for the panels that ask about them.
 * Not the game board: `Board3D` has no camel model, so this reuses
 * `MapPreview`'s SVG approach (board shape, then caravans on top).
 *
 * `camels` is drawn in arrival order, which matters: it is the chain,
 * oasis-outwards, and the vertex shared by a consecutive pair is a scoring
 * junction. Do not sort it.
 */
export function CamelMap({
  board,
  ext,
  candidates = [],
  highlight,
  buildings = [],
  colorOf,
  className,
}: {
  board: Board;
  ext: CaravansExt | undefined;
  /**
   * Settlements and cities on the board, so the picture shows which of them a
   * caravan would pass (a building between two camels scores its owner a point).
   */
  buildings?: BuildingView[];
  /** A seat's colour, as the rest of the table draws it. */
  colorOf?: (seat: number) => string;
  /** Placements on offer, drawn as dashed outlines. */
  candidates?: CamelPath[];
  /** The candidate under the cursor or keyboard focus, as a `camelPathKey`. */
  highlight?: string | null;
  className?: string;
}) {
  const land = board.tiles.filter((t) => t.res !== "sea");
  const vb = boardViewBox(
    (land.length ? land : board.tiles).map((t) => ({ hex: t.hex })),
    S,
    S * 1.2,
  );
  const camels = ext?.camels ?? [];
  const spokes = ext?.caravans ?? [];
  // Every oasis: two at 5 and 6 seats, three at 7 to 10. An older server sends
  // only `oasis`.
  const oases = ext?.oasis ? (ext.oases ?? [ext.oasis]) : [];
  return (
    <svg
      viewBox={vb.str}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {board.tiles.map((t, i) => (
        <polygon
          key={i}
          points={hexPolygon(t.hex, S)}
          fill={previewFill(t.res, t.hex)}
          stroke={t.res === "sea" ? previewFill(t.res, t.hex) : "var(--color-ink)"}
          strokeWidth={t.res === "sea" ? 1 : 0.5}
          opacity={t.res === "sea" ? 1 : 0.55}
        />
      ))}

      {/* The oasis, so chains have a visible source before any camel exists.
          Absent (not zeroed) on a board without one; a bare {q:0,r:0} would
          draw a marker at the centre of every Caravans-less board. */}
      {oases.map((oasis, i) => (
        <circle
          key={`oasis${i}`}
          cx={hexCenter(oasis, S).x}
          cy={hexCenter(oasis, S).y}
          r={S * 0.3}
          fill="var(--color-caravans)"
          stroke="var(--color-ink)"
          strokeWidth={0.6}
          data-camel-oasis=""
        />
      ))}

      {/* The spokes: which edge each caravan leaves the oasis by. */}
      {spokes.map((s) => {
        const [a, b] = edgeEnds(s.arrow, S);
        return (
          <line
            key={`spoke${s.caravan}`}
            data-camel-spoke={s.caravan}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={caravanColor(s.caravan)}
            strokeWidth={1.4}
            strokeDasharray="2 2"
            strokeLinecap="round"
            opacity={0.7}
          />
        );
      })}

      {camels.map((c, i) => {
        const [a, b] = edgeEnds(c.e, S);
        return (
          <line
            key={`${edgeKey(c.e)}-${i}`}
            data-camel={c.caravan}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={caravanColor(c.caravan)}
            strokeWidth={2.6}
            strokeLinecap="round"
          />
        );
      })}

      {/* Interior junctions: vertices two consecutive camels of one caravan
          share. They are what a camel scores. */}
      {camels.map((c, i) => {
        const next = camels[i + 1];
        if (!next || next.caravan !== c.caravan) return null;
        const ends = new Set([vertexKey(next.e.a), vertexKey(next.e.b)]);
        const shared = [c.e.a, c.e.b].find((v) => ends.has(vertexKey(v)));
        if (!shared) return null;
        const p = vertexPt(shared, S);
        return (
          <circle
            key={`j${i}`}
            data-camel-junction={c.caravan}
            cx={p.x}
            cy={p.y}
            r={1.5}
            fill="var(--color-ink)"
          />
        );
      })}

      {buildings.map((b) => {
        const p = vertexPt(b.v, S);
        const fill = colorOf ? colorOf(b.owner) : "var(--color-ink)";
        return b.city ? (
          <rect
            key={`b${vertexKey(b.v)}`}
            data-camel-building={b.owner}
            x={p.x - 2.2}
            y={p.y - 2.2}
            width={4.4}
            height={4.4}
            fill={fill}
            stroke="var(--color-ink)"
            strokeWidth={0.6}
          />
        ) : (
          <circle
            key={`b${vertexKey(b.v)}`}
            data-camel-building={b.owner}
            cx={p.x}
            cy={p.y}
            r={1.9}
            fill={fill}
            stroke="var(--color-ink)"
            strokeWidth={0.6}
          />
        );
      })}

      {candidates.map((c) => {
        const [a, b] = edgeEnds(c.e, S);
        const on = highlight === camelPathKey(c);
        return (
          <line
            key={camelPathKey(c)}
            data-camel-candidate={camelPathKey(c)}
            data-camel-lit={on ? "" : undefined}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={caravanColor(c.caravan)}
            strokeWidth={on ? 3.2 : 1.8}
            strokeDasharray={on ? undefined : "1.5 1.5"}
            strokeLinecap="round"
            opacity={on ? 1 : 0.75}
          />
        );
      })}
    </svg>
  );
}
