import * as React from "react";
import { DecisionClock } from "./DecisionClock";
import { Trans, useLingui } from "@lingui/react/macro";
import { ScenarioDialog as Overlay } from "./ScenarioDialog";
import { CamelMap, caravanColor } from "./CamelMap";
import { CamelGlyph } from "./moduleGlyphs";
import { camelPathKey, camelPathMergesWith, camelViewOutcome, camelsPlaced } from "@/lib/caravans";
import { edgeKey } from "@/lib/hexgeo";
import { formatList } from "@/lib/intl";
import { cn } from "@/lib/utils";
import type { Board, BuildingView, CamelPath, CaravansExt } from "@/lib/types";

/**
 * Where the camel this seat won goes.
 *
 * Each row is a (caravan, edge) pair: one edge can extend two caravan fronts,
 * and which chain it joins decides which junctions score. So `camelPathKey`
 * keys everything, the click sends `path.caravan` with `path.e`, and a shared
 * edge says it is shared.
 *
 * Rows keep the server's order (grouped by caravan, then along the drawn
 * chain). Do not sort them.
 */
export function CamelPlacePanel({
  board,
  ext,
  buildings,
  colorOf,
  paths,
  onPlace,
  onClose,
}: {
  board: Board;
  ext: CaravansExt | undefined;
  /** Settlements and cities, drawn on the map in their owners' colours. */
  buildings?: BuildingView[];
  colorOf?: (seat: number) => string;
  paths: CamelPath[];
  onPlace: (p: CamelPath) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  // The placement this seat named in its bid, if still on offer. The panel
  // opens with that row lit, focused and marked, since a wrong tap places the
  // camel with no undo.
  const named = ext?.bids?.find((b) => b.player === ext?.placer)?.path;
  const namedKey =
    named && paths.some((p) => camelPathKey(p) === camelPathKey(named))
      ? camelPathKey(named)
      : null;
  const [lit, setLit] = React.useState<string | null>(namedKey);
  // Hover and focus move the light; leaving a row puts it back on the bid.
  const unlight = (key: string) => setLit((k) => (k === key ? namedKey : k));
  // One placement per camel, enforced locally: rows stay live until the
  // server's next view flips this seat out of "place", and a second click would
  // send a second place_camel (refused by the engine).
  const [sent, setSent] = React.useState(false);
  const place = (path: CamelPath) => {
    if (sent) return;
    setSent(true);
    onPlace(path);
  };
  const { placed, supply } = camelsPlaced(ext);
  // Why this seat is placing. `pickPlacer` has four outcomes and only one is a
  // win: a tie and a round nobody bid in both fall to the finisher through the
  // same `placer`. `coalition` should never reach this panel (the engine places
  // the camel and `placer` stays -1), but is handled rather than falling
  // through to "You won the vote".
  const outcome = camelViewOutcome(ext);

  // Camels per caravan, so a row can say whether it starts or continues a
  // chain. Counted off `ext.camels`, the list the map draws.
  const lengths = new Map<number, number>();
  for (const c of ext?.camels ?? []) lengths.set(c.caravan, (lengths.get(c.caravan) ?? 0) + 1);

  // Edges offered by more than one caravan; those rows are labelled so they
  // don't look identical.
  const perEdge = new Map<string, number[]>();
  for (const p of paths) {
    const k = edgeKey(p.e);
    perEdge.set(k, [...(perEdge.get(k) ?? []), p.caravan]);
  }

  return (
    <Overlay
      title={t({
        id: "camel.place.title",
        message: "Place the camel",
        context: "title of the placement picker (Caravans)",
      })}
      onCancel={onClose}
      // The deadline stays in view while the rows scroll (it fell below the fold
      // at 1280x800). The rows are the answer, so no button is pinned with it.
      footer={
        <>
          {/* As in the camel vote: the sentence says what the timeout does, the
              DecisionClock under it how long is left. */}
          <p className="hudx-note max-w-80 text-center">
            <Trans id="camel.place.clock">
              This choice is on a clock. If it runs out, the camel is placed for you.
            </Trans>
          </p>
          <div className="w-full max-w-80">
            <DecisionClock />
          </div>
        </>
      }
    >
      <p className="hudx-note max-w-80 self-center text-center">
        {/* "between any two camels", not "of the same caravan": once chains
            merge, a junction scores whichever caravans the camels came from. */}
        {outcome === "nobody" ? (
          <Trans id="camel.place.what.nobody">
            Nobody bid, so the camel falls to you for ending the turn. Choose which caravan it
            joins: an intersection between any two camels is worth a point to whoever has built on
            it.
          </Trans>
        ) : outcome === "tie" ? (
          <Trans id="camel.place.what.tie">
            The vote was tied, so the camel falls to you for ending the turn. Choose which caravan
            it joins: an intersection between any two camels is worth a point to whoever has built
            on it.
          </Trans>
        ) : outcome === "coalition" ? (
          <Trans id="camel.place.what.coalition">
            The bidders who agreed on a placement carried the vote, so the camel has already gone
            where they named.
          </Trans>
        ) : (
          <Trans id="camel.place.what">
            You won the vote. Choose which caravan the camel joins: an intersection between any two
            camels is worth a point to whoever has built on it.
          </Trans>
        )}
      </p>

      {/* Map, then rows, except on a short screen (a sideways phone), where they
          swap as in the camel vote so the choices are in the first view. */}
      <div
        data-camel-place-body
        className="flex flex-col gap-4 [@media(max-height:500px)]:flex-col-reverse"
      >
        <CamelMap
          board={board}
          ext={ext}
          candidates={paths}
          highlight={lit}
          buildings={buildings}
          colorOf={colorOf}
          className="w-70 h-45 max-w-full shrink-0 self-center"
        />

        {/* Clamped against the viewport: a bare 280px floor plus padding
            outgrows max-w-[94vw] on a narrow phone, and the Overlay clips
            rather than scrolls. See components/game/Overlay. */}
        <div className="flex flex-col gap-2 min-w-[min(280px,100%)]">
          {paths.length === 0 && (
            <p className="text-center text-xs text-muted">
              <Trans id="camel.place.none">There is nowhere left for this camel to go.</Trans>
            </p>
          )}
          {paths.map((p, i) => {
            const key = camelPathKey(p);
            // Two rows for one caravan (a forked front) are numbered within the
            // caravan in server order; the map lights each on hover.
            const siblings = paths.filter((o) => o.caravan === p.caravan).length;
            const choice = paths.slice(0, i + 1).filter((o) => o.caravan === p.caravan).length;
            const n = p.caravan + 1;
            const others = (perEdge.get(edgeKey(p.e)) ?? []).filter((c) => c !== p.caravan);
            const merges = camelPathMergesWith(ext, p);
            const other = merges === null ? 0 : merges + 1;
            const len =
              (lengths.get(p.caravan) ?? 0) + (merges === null ? 0 : (lengths.get(merges) ?? 0));
            return (
              <button
                key={key}
                type="button"
                data-camel-path={key}
                data-camel-path-caravan={p.caravan}
                onMouseEnter={() => setLit(key)}
                onMouseLeave={() => unlight(key)}
                onFocus={() => setLit(key)}
                onBlur={() => unlight(key)}
                data-camel-named={key === namedKey ? "" : undefined}
                // Where the dialog puts focus when it opens (lib/dialog
                // initialFocus): the one row the player already chose.
                data-initial-focus={key === namedKey ? "" : undefined}
                disabled={sent}
                onClick={() => place(p)}
                // A raised row with a rim, lit by the focus-ring colour; the
                // caravan's colour is the dot, matching its line on the map.
                data-lit={lit === key ? "true" : undefined}
                className={cn(
                  "hudx-cell flex-row items-center justify-start gap-2.5 px-3 py-2.5 text-left",
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{
                    background: caravanColor(p.caravan),
                    boxShadow: "0 0 0 2px var(--hud-raised)",
                  }}
                />
                <span className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span className="text-[13px] font-semibold leading-tight" data-camel-path-name>
                    {/* Caravans are numbered from 1 for a reader; the wire counts
                      from 0. */}
                    {siblings > 1 ? (
                      <Trans id="camel.place.row.choice">
                        Caravan {n}, choice {choice}
                      </Trans>
                    ) : (
                      <Trans id="camel.place.row">Caravan {p.caravan + 1}</Trans>
                    )}
                  </span>
                  <span className="hudx-note leading-tight">
                    {merges !== null ? (
                      <Trans id="camel.place.merged">
                        Continues caravans {n} and {other} as one, a chain of {len}.
                      </Trans>
                    ) : len === 0 ? (
                      <Trans id="camel.place.first">Its first camel, out of the oasis.</Trans>
                    ) : (
                      <Trans id="camel.place.extends">Extends a chain of {len}.</Trans>
                    )}
                  </span>
                  {key === namedKey && (
                    <span
                      className="text-xs font-semibold leading-tight text-(--hud-focus)"
                      data-camel-named-note
                    >
                      <Trans id="camel.place.named">The placement you bid for.</Trans>
                    </span>
                  )}
                  {others.length > 0 && (
                    <span className="hudx-note leading-tight" data-warn="true" data-camel-shared>
                      {/* Every rival, not just the first: an edge can front
                        three caravans at once. */}
                      {others.length === 1 ? (
                        <Trans id="camel.place.shared">
                          The same path also extends caravan {others[0] + 1}. Which one you pick
                          decides which intersections score.
                        </Trans>
                      ) : (
                        <Trans id="camel.place.shared.many">
                          The same path also extends caravans{" "}
                          {formatList(others.map((c) => String(c + 1)))}. Which one you pick decides
                          which intersections score.
                        </Trans>
                      )}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {supply > 0 && (
        <span className="hudx-figure self-center" data-camel-supply={supply}>
          <CamelGlyph />
          <Trans id="camel.place.supply">
            {placed} of {supply} camels placed.
          </Trans>
        </span>
      )}
    </Overlay>
  );
}
