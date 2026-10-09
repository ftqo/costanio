import type { Board, Hex, RaidersExt } from "@/lib/types";
import { boardViewBox, hexCenter, hexKey, hexPolygon, previewFill } from "@/lib/hexgeo";
import { CONQUERED } from "@/lib/raiders";
import { hexLabel } from "@/lib/boardInfo";
import { useLingui } from "@lingui/react/macro";

const S = 10; // small hex size; the viewBox scales it to fit

/**
 * A flat, cheap picture of the coast, for the panels that ask about it.
 *
 * Not the game board: a Treason plan is two picks that must be seen together
 * before either is sent, and the player may have panned `Board3D` elsewhere. So
 * the panel carries its own map, using the same SVG approach as `MapPreview`
 * and `CamelMap`.
 *
 * It draws raider counts on hexes and nothing about riders (seat-tinted pieces
 * on paths), since the panels using it ask about hexes and two kinds of marker
 * would invite confusion.
 */
export function RaidersMap({
  board,
  ext,
  sources = [],
  destinations = [],
  chosen = [],
  onPick,
  pickLabel,
  className,
}: {
  board: Board;
  ext: RaidersExt | undefined;
  /** Hexes a raider may be taken from, drawn as outlined and clickable. */
  sources?: Hex[];
  /** Hexes a raider may be put on. */
  destinations?: Hex[];
  /** What the plan has taken so far, so the picture shows the pair being built. */
  chosen?: Hex[];
  /** Absent makes the map a picture rather than a control. */
  onPick?: (hex: Hex) => void;
  /**
   * What choosing this hex would do, as a sentence for screen readers and the
   * hover tooltip. Supplied by the panel, which knows which step a tap fills (a
   * hex can be both source and destination).
   */
  pickLabel?: (hex: Hex) => string;
  className?: string;
}) {
  const { t } = useLingui();
  const land = board.tiles.filter((tile) => tile.res !== "sea");
  const vb = boardViewBox(
    (land.length ? land : board.tiles).map((tile) => ({ hex: tile.hex })),
    S,
    S * 1.2,
  );
  const coast = ext?.coast ?? [];
  const counts = ext?.raider_count ?? [];
  const castle = ext?.castle;
  const sourceKeys = new Set(sources.map(hexKey));
  const destKeys = new Set(destinations.map(hexKey));
  const chosenKeys = new Set(chosen.map(hexKey));
  return (
    <svg
      viewBox={vb.str}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      // A control only when it can be picked from; otherwise a plain picture.
      role={onPick ? "group" : "img"}
      aria-label={t({
        id: "raiders.map.label",
        message: "Map of the coast",
        context: "accessible name of the small Raiders map in the Treason planner",
      })}
    >
      {board.tiles.map((tile, i) => (
        <polygon
          key={i}
          points={hexPolygon(tile.hex, S)}
          fill={previewFill(tile.res, tile.hex)}
          stroke={tile.res === "sea" ? previewFill(tile.res, tile.hex) : "var(--color-ink)"}
          strokeWidth={tile.res === "sea" ? 1 : 0.5}
          opacity={tile.res === "sea" ? 1 : 0.55}
        />
      ))}

      {/* The castle, so the riders' way in is visible. Absent (not zeroed) on a
          board without one; a bare {q:0,r:0} would draw a castle at the board
          centre. */}
      {castle && (
        <circle
          cx={hexCenter(castle, S).x}
          cy={hexCenter(castle, S).y}
          r={S * 0.32}
          fill="var(--color-raiders)"
          stroke="var(--color-ink)"
          strokeWidth={0.6}
          data-raiders-castle=""
        />
      )}

      {/* The coast, one marker per hex, with the count as a number: riders on
          the six paths must outnumber it, and three conquers the hex. */}
      {coast.map((h, i) => {
        const n = counts[i] ?? 0;
        const c = hexCenter(h, S);
        const done = n >= CONQUERED;
        return (
          <g key={hexKey(h)} data-raiders-coast={hexKey(h)} data-raiders-count={n}>
            <circle
              cx={c.x}
              cy={c.y}
              r={S * 0.34}
              fill={n > 0 ? "var(--color-raiders)" : "none"}
              stroke="var(--color-raiders)"
              strokeWidth={done ? 1.6 : 0.7}
              opacity={n > 0 ? 0.9 : 0.35}
            />
            {n > 0 && (
              <text
                x={c.x}
                y={c.y + S * 0.15}
                textAnchor="middle"
                fontSize={S * 0.5}
                fontWeight="800"
                fill="var(--color-paper)"
              >
                {n}
              </text>
            )}
          </g>
        );
      })}

      {/* The picks. Source and destination look different because they are
          opposite halves of one plan: a source is a ring around a hex holding a
          raider, a destination a dashed ring. */}
      {board.tiles.map((tile) => {
        const k = hexKey(tile.hex);
        const isSource = sourceKeys.has(k);
        const isDest = destKeys.has(k);
        if (!isSource && !isDest) return null;
        const c = hexCenter(tile.hex, S);
        const picked = chosenKeys.has(k);
        const label = pickLabel?.(tile.hex) ?? hexLabel(tile);
        return (
          <circle
            key={`pick-${k}`}
            // Keyboard and screen-reader access: Tab walks the picks in board
            // order, Enter or Space picks.
            role={onPick ? "button" : undefined}
            tabIndex={onPick ? 0 : undefined}
            aria-label={onPick ? label : undefined}
            aria-pressed={onPick ? picked : undefined}
            onKeyDown={
              onPick
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick(tile.hex);
                    }
                  }
                : undefined
            }
            className="outline-none focus-visible:[stroke:var(--hud-focus)] focus-visible:[stroke-width:2.4]"
            data-raiders-pick={k}
            data-raiders-pick-kind={isSource ? "from" : "to"}
            data-raiders-picked={picked ? "" : undefined}
            cx={c.x}
            cy={c.y}
            // Nearly the hex's inscribed circle (0.866): the ring is the touch
            // target, and on a phone each hex is ~30px.
            r={S * 0.8}
            fill="transparent"
            stroke={picked ? "var(--hud-primary)" : "var(--color-ink)"}
            strokeWidth={picked ? 2 : 1}
            strokeDasharray={isSource ? undefined : "2 2"}
            style={onPick ? { cursor: "pointer" } : undefined}
            onClick={onPick ? () => onPick(tile.hex) : undefined}
          >
            {onPick && <title>{label}</title>}
          </circle>
        );
      })}
    </svg>
  );
}
