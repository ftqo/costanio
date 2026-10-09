// Settlements, cities, and roads. Geometry is loaded once, untinted; the
// Seat_* materials are cloned per seat by tint.ts, so ten seats share one mesh.
import type { FullView } from "@/lib/types";
import { vertexToWorld, edgeToWorld, edgeRotationY, type Vec3 } from "../coords";
import { edgeKey, vertexKey } from "@/lib/hexgeo";
import { pieceKey } from "../drop";
import { PIECE_FACING } from "../pieceArt";

export interface PiecePlacement {
  kind: "settlement" | "city" | "road";
  owner: number;
  position: Vec3;
  rotationY: number;
  /** Stable identity, so a newly built piece can be told from a standing one. */
  key: string;
}

/**
 * `replaced` is the set of vertex keys where a grander marker (a metropolis)
 * stands in place of the building; those are skipped.
 */
export function planPieces(
  view: Pick<FullView, "buildings" | "roads">,
  replaced: ReadonlySet<string> = new Set(),
): PiecePlacement[] {
  const out: PiecePlacement[] = [];

  for (const b of view.buildings) {
    if (replaced.has(vertexKey(b.v))) continue;
    const kind = b.city ? "city" : "settlement";
    out.push({
      kind,
      owner: b.owner,
      position: vertexToWorld(b.v),
      // Square to the chips. Buildings ship square, so this is zero; see
      // PIECE_FACING for why the export owns it.
      rotationY: PIECE_FACING[kind],
      key: pieceKey(kind, b.owner, vertexKey(b.v)),
    });
  }

  for (const r of view.roads) {
    // `edgeRotationY` aligns the bar with its edge, shared with ships and the
    // ghost preview so all three agree.
    out.push({
      kind: "road",
      owner: r.owner,
      position: edgeToWorld(r.e),
      rotationY: edgeRotationY(r.e),
      key: pieceKey("road", r.owner, edgeKey(r.e)),
    });
  }

  return out;
}
