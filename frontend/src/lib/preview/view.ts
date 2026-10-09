import type { FullView, PreviewEnvelope } from "@/lib/types";

/**
 * The view `Board3D` is handed for a dealt-but-unplayed board.
 *
 * The same synthetic shape `board-shots.tsx` builds: seats with empty hands, no
 * buildings or roads, and `config.ruleset` set, since every module layer asks
 * `parseExpansions` what is on and throws without it.
 *
 * The seat count follows the envelope's config, so a board previewed for six
 * players is drawn with six seats.
 */
export function previewView(envelope: PreviewEnvelope): FullView {
  const seats = Math.max(2, envelope.config.players ?? 4);
  return {
    seq: 0,
    viewer: 0,
    phase: "play",
    cur: 0,
    legal: {},
    players: Array.from({ length: seats }, (_, seat) => ({ seat, hand: [0, 0, 0, 0, 0, 0] })),
    config: envelope.config,
    board: envelope.board,
    buildings: [],
    roads: [],
    ext: envelope.ext,
  } as unknown as FullView;
}
