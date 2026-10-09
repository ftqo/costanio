import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { ScenarioDialog as Overlay } from "./ScenarioDialog";
import type * as React from "react";
import { GoodIcon } from "@/components/asset/AssetParts";
import { Icons } from "./hudIcons";
import { Glyph, MBtn } from "./moduleUi";
import type { Edge, RiderMoves } from "@/lib/types";
import { edgeKey } from "@/lib/hexgeo";

/**
 * Which of your riders to move, before the board is asked where.
 *
 * A rider move is two picks, and the board can only take the second:
 * `rider_moves` is a viewer-only list, a ghost on a rider's path would double
 * the piece, and the inspect menu is keyed on the core's legal lists, which
 * Raiders doesn't write to. So the rider is chosen here, then the destinations
 * light up on the board.
 *
 * One row per rider that may still move. A rider that already moved is absent
 * from `rider_moves` and so absent here. Rows keep the wire's path order, so
 * they don't shift between the look and the click.
 *
 * `must_leave` is the one non-optional row: a rider on a castle path with
 * somewhere to go must move before the turn can end. It is flagged per row.
 */
export function RaidersRidersPanel({
  moves,
  grain,
  fishHurry = false,
  onChoose,
  onClose,
  gold,
  extra,
}: {
  /**
   * The seat's gold, as one line that opens the Gold panel: riders and gold are
   * spent in the same turn.
   */
  gold?: { gold: number; buysLeft: number; onOpen: () => void };
  /** The coast readout, below the riders; see RaidersCoast. */
  extra?: React.ReactNode;
  moves: RiderMoves[];
  /** Grain in hand, for whether the 1-grain hurry is a real offer. */
  grain: number;
  /**
   * Whether two fish can pay for the hurry instead (Raiders with Fishermen,
   * and at least two fish in hand).
   */
  fishHurry?: boolean;
  onChoose: (from: Edge) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const owed = moves.filter((m) => m.must_leave).length;
  return (
    <Overlay
      title={t({
        id: "raiders.riders.title",
        message: "Move your riders",
        context: "title of the Raiders panel that picks which rider to move",
      })}
      onCancel={onClose}
    >
      <div className="modp-panel w-full">
        <span className="modp-small">
          <Trans id="raiders.riders.rule">
            Each of your riders may move once, up to three paths. One wheat pushes a single rider to
            five. A rider may not finish on a path that already holds one, or on one of the castle's
            six paths.
          </Trans>
          {fishHurry && (
            <>
              {" "}
              <Trans id="raiders.riders.ruleFish">
                Two fish can pay for that push instead of the wheat.
              </Trans>
            </>
          )}
        </span>

        {owed > 0 && (
          <span className="modp-warn" data-raiders-must-leave={owed}>
            <Trans id="raiders.riders.mustLeave">
              The castle is a gateway, not a garrison. Your turn cannot end while a rider that could
              leave it is still standing there.
            </Trans>
          </span>
        )}

        {moves.length === 0 && (
          <span className="modp-small">
            {/* A mustered rider is a new rider placed on a castle path and
              obliged to ride out, not a move given back to a rider. "Muster
              another" invited that misreading. */}
            <Trans id="raiders.riders.none">
              None of your riders has a move left this turn. Buy a card to bring another rider onto
              the board.
            </Trans>
          </span>
        )}

        <div className="flex flex-col gap-2">
          {moves.map((m, i) => {
            const free = m.to?.length ?? 0;
            const hurried = m.hurry?.length ?? 0;
            // Stuck: on a castle path with nothing in reach. The rules let it
            // stay and the turn end, so it is not `must_leave`.
            const stuck = free === 0 && hurried === 0;
            return (
              <button
                key={edgeKey(m.from)}
                type="button"
                data-raiders-rider={edgeKey(m.from)}
                data-raiders-rider-owed={m.must_leave ? "" : undefined}
                disabled={stuck}
                onClick={() => !stuck && onChoose(m.from)}
                data-owed={m.must_leave ? "" : undefined}
                className="modp-card"
                style={{ flexDirection: "row", alignItems: "center" }}
              >
                <Glyph name="rider" size={18} className="text-[var(--hud-muted)]" />
                <span className="flex flex-col gap-0.5 modp-grow">
                  <span className="font-semibold leading-tight">
                    {/* Numbered from 1 for a reader: riders are identical, and
                      only their path tells them apart. */}
                    <Trans id="raiders.riders.nth">Rider {i + 1}</Trans>
                  </span>
                  {m.must_leave && (
                    <span className="modp-warn leading-tight">
                      <Trans id="raiders.riders.atCastle">At the castle, and must ride out.</Trans>
                    </span>
                  )}
                  {stuck && (
                    <span className="modp-small leading-tight">
                      <Trans id="raiders.riders.stuck">
                        Every path within reach already holds a rider, so this one stays.
                      </Trans>
                    </span>
                  )}
                </span>
                <span className="flex flex-col items-end gap-1 shrink-0 font-num tabular-nums">
                  <span className="hud-chip modp-chip">
                    {/* How many places it can end on, not how far it goes ("25
                      paths" read as moving twenty-five against a rule of three). */}
                    <Plural
                      id="raiders.riders.reachN"
                      value={free}
                      one="# place in reach"
                      other="# places in reach"
                    />
                  </span>
                  {/* Shown only where the grain is in hand; the engine refuses
                    the move otherwise. */}
                  {hurried > 0 && (grain > 0 || fishHurry) && (
                    <span className="modp-small" data-raiders-rider-hurry={hurried}>
                      {/* The noun says these are places ("2 more for a wheat"
                        read as two more wheat). */}
                      {grain > 0 && fishHurry ? (
                        <Plural
                          id="raiders.riders.hurryEitherN"
                          value={hurried}
                          one="# more place for a wheat or two fish"
                          other="# more places for a wheat or two fish"
                        />
                      ) : grain > 0 ? (
                        <Plural
                          id="raiders.riders.hurryN"
                          value={hurried}
                          one="# more place for a wheat"
                          other="# more places for a wheat"
                        />
                      ) : (
                        <Plural
                          id="raiders.riders.hurryFishN"
                          value={hurried}
                          one="# more place for two fish"
                          other="# more places for two fish"
                        />
                      )}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {gold && (
          <div className="modp-row modp-sep" data-raiders-riders-gold>
            <GoodIcon id="gold" size={18} fallback={<Icons.gold size={18} />} />
            <span className="modp-grow">
              {/* Each number carries its own noun, so the price and the
                  allowance can be told apart. */}
              <Trans id="raiders.riders.goldHeld">{gold.gold} gold.</Trans>{" "}
              <Plural
                id="raiders.riders.goldBuys"
                value={gold.buysLeft}
                one="A resource costs 2 gold; you can buy # more this turn."
                other="A resource costs 2 gold; you can buy # more this turn."
                _0="A resource costs 2 gold; you have no buys left this turn."
              />
            </span>
            <MBtn onClick={gold.onOpen}>
              <Trans id="raiders.riders.goldOpen">Spend gold</Trans>
            </MBtn>
          </div>
        )}

        {extra && <div className="modp-sep">{extra}</div>}
        {/* No second Close: the dialog's corner button, Escape and the dim
            already close it. */}
      </div>
    </Overlay>
  );
}
