import * as React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ScenarioDialog as Overlay } from "./ScenarioDialog";
import { MBtn } from "./moduleUi";
import { RaidersMap } from "./RaidersMap";
import type { Board, Hex, RaidersExt, TreasonMove } from "@/lib/types";
import { hexKey } from "@/lib/hexgeo";
import { hexLabel } from "@/lib/boardInfo";

/**
 * Treason: take 2 gold, then move 2 raiders onto 2 other unconquered hexes.
 *
 * `raiders_treason` carries the whole plan in one message and the engine
 * refuses a plan of the wrong length, so this is a planner: the player sees and
 * can unpick the pair before anything is sent.
 *
 * A raider may come from the supply instead of the board, only for the
 * shortfall when fewer than two stand on the coast. So a move is `{from?, to}`,
 * and the supply is offered as a source when the engine's list is short.
 *
 * Legality is left to the engine (`validateTreason`: distinct sources, distinct
 * destinations, no destination that is also a source); this only enforces the
 * shape, `count` moves each with a destination.
 */
export function RaidersTreasonPanel({
  board,
  ext,
  sources,
  destinations,
  count,
  onPlan,
  onClose,
  card,
}: {
  board: Board;
  ext: RaidersExt | undefined;
  /** Hexes holding a raider, from `pend.treason_from`. */
  sources: Hex[];
  /** Unconquered hexes, from `pend.treason_to`. */
  destinations: Hex[];
  /** How many raiders this Treason actually moves. Usually two. */
  count: number;
  onPlan: (moves: TreasonMove[]) => void;
  onClose: () => void;
  /** The Treason card just turned over, beside its rule (see CardRevealLayer). */
  card?: React.ReactNode;
}) {
  const { t } = useLingui();
  const [moves, setMoves] = React.useState<TreasonMove[]>([]);
  // Half a move: a source named without a destination. Kept apart from
  // `moves` because the wire has no shape for half a move.
  const [pendingFrom, setPendingFrom] = React.useState<Hex | null>(null);
  // One-shot, like the camel panels: the plan is sent once and the panel
  // closes.
  const [sent, setSent] = React.useState(false);

  const done = moves.length >= count;
  const usedFrom = new Set(moves.filter((m) => m.from).map((m) => hexKey(m.from!)));
  const usedTo = new Set(moves.map((m) => hexKey(m.to)));

  // The supply is a source only for the shortfall and while it has raiders.
  // Offered as a button, not a hex: it is the absence of a `from`.
  const onBoard = sources.length;
  const supplyOffered = moves.length + (pendingFrom ? 1 : 0) >= onBoard;

  const pick = (hex: Hex) => {
    const k = hexKey(hex);
    const isSource = sources.some((h) => hexKey(h) === k);
    const isDest = destinations.some((h) => hexKey(h) === k);
    if (done) return;
    // A destination first, when a source (or the supply) is already chosen.
    if (isDest && (pendingFrom || supplyOffered) && !usedTo.has(k)) {
      setMoves([...moves, pendingFrom ? { from: pendingFrom, to: hex } : { to: hex }]);
      setPendingFrom(null);
      return;
    }
    if (isSource && !usedFrom.has(k)) setPendingFrom(hex);
  };

  // What a tap on each hex would do right now, mirroring `pick`, for screen
  // readers.
  const pickLabel = (hex: Hex) => {
    const k = hexKey(hex);
    const name = hexLabel(board.tiles.find((tile) => hexKey(tile.hex) === k));
    const isSource = sources.some((h) => hexKey(h) === k);
    const isDest = destinations.some((h) => hexKey(h) === k);
    if (!done && isDest && (pendingFrom || supplyOffered) && !usedTo.has(k))
      return t({
        id: "raiders.treason.pickToLabel",
        message: `Move the raider to ${name}`,
        context: "Treason planner: choose this hex as a destination",
      });
    if (!done && isSource && !usedFrom.has(k))
      return t({
        id: "raiders.treason.pickFromLabel",
        message: `Take a raider from ${name}`,
        context: "Treason planner: choose this hex as a source",
      });
    return name;
  };

  const chosen = [
    ...moves.flatMap((m) => (m.from ? [m.from, m.to] : [m.to])),
    ...(pendingFrom ? [pendingFrom] : []),
  ];

  return (
    <Overlay
      title={t({
        id: "raiders.treason.title",
        message: "Treason",
        context: "title of the Raiders card that moves raiders about",
      })}
      onCancel={onClose}
    >
      <span className="flex items-center gap-2.5 max-w-85">
        {card}
        <span className={card ? "modp-small text-left" : "modp-small text-center"}>
          <Trans id="raiders.treason.rule">
            Take 2 gold, then move {count} raiders onto other hexes that are not conquered. A raider
            may come from the supply only if there are not enough on the board.
          </Trans>
        </span>
      </span>

      <RaidersMap
        board={board}
        ext={ext}
        sources={sources.filter((h) => !usedFrom.has(hexKey(h)))}
        destinations={destinations.filter((h) => !usedTo.has(hexKey(h)))}
        chosen={chosen}
        onPick={pick}
        pickLabel={pickLabel}
        // Full panel width so the pick circles (which scale with the map) are a
        // usable touch target. `shrink-0` stops the scrolling flex column from
        // squeezing the map on a short landscape phone.
        className="w-full max-w-100 h-auto shrink-0"
      />

      {/* The key: which ring style means source and which destination. */}
      <span className="modp-legend" data-raiders-treason-key>
        <span className="inline-flex items-center gap-1">
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
            <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <Trans id="raiders.treason.keyFrom">take a raider from</Trans>
        </span>
        <span className="inline-flex items-center gap-1">
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
            <circle
              cx="6"
              cy="6"
              r="4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
          </svg>
          <Trans id="raiders.treason.keyTo">a raider may go here</Trans>
        </span>
        <span className="inline-flex items-center gap-1">
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
            <circle cx="6" cy="6" r="3.5" fill="var(--color-raiders)" />
          </svg>
          <Trans id="raiders.treason.keyCastle">the castle</Trans>
        </span>
      </span>

      <span className="text-[13px] font-medium text-center" data-raiders-treason-step>
        {done ? (
          <Trans id="raiders.treason.ready">The plan is ready.</Trans>
        ) : pendingFrom ? (
          <Trans id="raiders.treason.pickTo">Now choose where that raider goes.</Trans>
        ) : supplyOffered ? (
          <Trans id="raiders.treason.pickToSupply">
            Choose where the raider from the supply goes.
          </Trans>
        ) : (
          <Trans id="raiders.treason.pickFrom">Choose a hex to take a raider from.</Trans>
        )}
      </span>

      {/* What has been assembled, as a count rather than coordinates: the map
          above is where the pair is read. */}
      <span className="hud-chip modp-chip self-center" data-raiders-treason-count={moves.length}>
        <Trans id="raiders.treason.progress">
          {moves.length} of {count} chosen
        </Trans>
      </span>

      <div className="flex gap-2 self-center">
        <MBtn
          primary
          disabled={!done || sent}
          data-raiders-treason-send
          onClick={() => {
            if (!done || sent) return;
            setSent(true);
            onPlan(moves);
          }}
        >
          <Trans id="raiders.treason.send">Do it</Trans>
        </MBtn>
        <MBtn
          disabled={moves.length === 0 && !pendingFrom}
          data-raiders-treason-undo
          onClick={() => {
            if (pendingFrom) {
              setPendingFrom(null);
              return;
            }
            setMoves(moves.slice(0, -1));
          }}
        >
          <Trans id="raiders.treason.undo">Undo</Trans>
        </MBtn>
      </div>
    </Overlay>
  );
}
