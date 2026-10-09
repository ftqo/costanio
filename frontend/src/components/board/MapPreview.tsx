import type { Board } from "@/lib/types";
import { hexPolygon, boardViewBox, previewFill } from "@/lib/hexgeo";

const S = 10; // small hex size; the viewBox scales it to fit

// MapPreview renders a board's shape (no number tokens or harbors), framed to
// the playable land. Sea is a smooth blob (stroke matches fill so the grid
// disappears); land is drawn as outlined hexes.
export function MapPreview({ board, className }: { board: Board; className?: string }) {
  const sea = board.tiles.filter((t) => t.res === "sea");
  const land = board.tiles.filter((t) => t.res !== "sea");
  const vb = boardViewBox(
    (land.length ? land : board.tiles).map((t) => ({ hex: t.hex })),
    S,
    S * 1.2,
  );
  return (
    <svg viewBox={vb.str} className={className} preserveAspectRatio="xMidYMid meet">
      {/* Sea first, so land hexes on top keep their coastline border. */}
      {sea.map((t, i) => (
        <polygon
          key={`s${i}`}
          points={hexPolygon(t.hex, S)}
          fill={previewFill(t.res, t.hex)}
          stroke={previewFill(t.res, t.hex)}
          strokeWidth={1}
        />
      ))}
      {land.map((t, i) => (
        <polygon
          key={i}
          points={hexPolygon(t.hex, S)}
          fill={previewFill(t.res, t.hex)}
          stroke="var(--color-ink)"
          strokeWidth={0.7}
        />
      ))}
    </svg>
  );
}
