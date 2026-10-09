// The barbarian fleet's one home: a vertical hex tack down the HUD's right side.
// It replaces the bank-strip pip and the status-panel track.
//
// The geometry lives in lib/barbRail (and is tested there); this file is the
// drawing and the wiring.
import * as React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";
import { cn } from "@/lib/utils";
import { barbDist, barbFirstIgnored, knightsExt, type FullView } from "@/lib/types";
import { gameCaps } from "@/lib/caps";
import { useGameSocket, shallowEqual, type State } from "@/lib/ws";
import {
  RAIL_BOX_H,
  hexSizeFor,
  hexPoints,
  railBoxW,
  railCells,
  railStroke,
  railRowCells,
  railRowH,
  hexSizeForRow,
  RAIL_ROW_W,
  type RailCell,
} from "@/lib/barbRail";
import { SAIL_MS, sailPose, type ShipPose } from "@/lib/barbMotion";
import { Tip } from "@/components/game/Tip";
import { Icons } from "@/components/game/hudIcons";
import { GlassPanel, HudLabel } from "./HudLayer";

/**
 * Room under the box for the verdict (the sum on one line); the shield's colour
 * carries the holding/short answer.
 */
const VERDICT_H = 18;
/**
 * What the verdict adds over a one-line "11/3" (18px), taken off the track's
 * budget so the rail's total height doesn't change: the event log's island is
 * bottom-anchored under this column and doesn't know about the rail.
 */
const VERDICT_GROWTH = VERDICT_H - 18;

/**
 * Everything the rail draws, flattened to comparable scalars: the slice is
 * compared with `shallowEqual` on every state frame (as `BankSlice` is), and
 * anything rebuilt per read would never compare equal.
 *
 * `dist` is 0, not 7, when there is no fleet. `barbDist` clamps to [4,12], so 0
 * unambiguously means "no barbarians in this ruleset" (as `BankSlice.barbarians`
 * uses -1), keeping a base game distinct from a Knights game not yet sailed.
 */
export interface RailSlice {
  dist: number;
  at: number;
  /** The table's free first landfall, still unspent. */
  firstIgnored: boolean;
  /** Total level of every active knight on the board, all seats together. */
  defense: number;
  /** One barbarian per city on the board. */
  cities: number;
}

const NO_RAIL: RailSlice = { dist: 0, at: 0, firstIgnored: false, defense: 0, cities: 0 };

// Post-game the socket carries the final board on `postgame` rather than
// `full`, as the game screen resolves it.
const liveView = (s: State): FullView | null => s.full ?? s.postgame?.board ?? null;

export function selectRail(s: State): RailSlice {
  const v = liveView(s);
  if (!v) return NO_RAIL;
  // Whether there is a fleet is a ruleset question. `ext.cak` exists only once
  // the module has folded an event, so it would leave the rail absent through a
  // Knights game's opening (as `BankSlice` documents).
  if (!gameCaps(v).hasBarbarians) return NO_RAIL;
  const knightsState = knightsExt(v);
  let defense = 0;
  for (const k of knightsState?.knights ?? []) if (k.active) defense += k.level;
  return {
    dist: barbDist(v),
    at: knightsState?.barbarians ?? 0,
    firstIgnored: barbFirstIgnored(v),
    defense,
    cities: v.buildings.reduce((n, b) => n + (b.city ? 1 : 0), 0),
  };
}

export type RailVerdict = "hold" | "free" | "exposed";

/**
 * Whether the cities hold, and if not, whether it costs anything.
 *
 * Three states: while the table's free first landfall is unspent, a short
 * defence costs nothing, so it is amber rather than red.
 *
 * Pure and exported so tests assert this function rather than restating the
 * rule.
 */
export function railVerdict(defense: number, cities: number, firstIgnored: boolean): RailVerdict {
  if (defense >= cities) return "hold";
  return firstIgnored ? "free" : "exposed";
}

/**
 * Descriptors, not strings: this table is evaluated once at import, and a
 * string would freeze the language then. Resolved where the verdict is drawn.
 */
const VERDICT_LABEL: Record<RailVerdict, MessageDescriptor> = {
  hold: msg`Cities are holding`,
  free: msg`Cities are short, but the first invasion is ignored`,
  exposed: msg`Cities are exposed`,
};

/**
 * The rail, given a height budget.
 *
 * `boxH` is a budget so a short viewport can pass a smaller one; the hex size
 * re-solves to fill it, and the step count never changes (the track length is
 * a rule of the table).
 *
 * `across` lays the fleet out as a straight row, for widths where the seat rail
 * is a strip under the top row: a 175px column there would take a quarter of a
 * phone's board. See lib/barbRail's horizontal section for why the row may be
 * straight.
 *
 * `size` is the budget for the long axis (height down, width across).
 */
export const BarbarianRail = React.memo(function BarbarianRail({
  size,
  across = false,
  className,
}: {
  size?: number;
  across?: boolean;
  className?: string;
}) {
  const rail = useGameSocket(selectRail, shallowEqual);
  // The drawing is a separate component so its motion hooks are unconditional:
  // a base game mustn't run them, and a hook can't follow an early return.
  if (rail.dist === 0) return null;
  return (
    <Rail
      rail={rail}
      size={size ?? (across ? RAIL_ROW_W : RAIL_BOX_H - VERDICT_GROWTH)}
      across={across}
      className={className}
    />
  );
});

function Rail({
  rail,
  size,
  across,
  className,
}: {
  rail: RailSlice;
  size: number;
  across: boolean;
  className?: string;
}) {
  const { t } = useLingui();
  const { dist, at, firstIgnored, defense, cities } = rail;
  const s = across ? hexSizeForRow(dist, size) : hexSizeFor(dist, size);
  const w = across ? size : railBoxW(size);
  const h = across ? railRowH(dist, size) : size;
  const cells = React.useMemo(
    () => (across ? railRowCells(dist, size) : railCells(dist, size)),
    [across, dist, size],
  );
  const stroke = railStroke(s);
  // No roll across: every move is the same direction, so a lean would be a
  // constant tilt; the ship stays upright.
  const ship = React.useRef<SVGGElement>(null);
  useSail(cells, at, !across, ship);

  const verdict = railVerdict(defense, cities, firstIgnored);
  const Shield = verdict === "hold" ? Icons.shieldOk : Icons.shieldWarn;
  const label = i18n._(VERDICT_LABEL[verdict]);

  return (
    // On the HUD glass like every other cluster; directly over the water, an
    // unsailed cell (outline only) would be invisible.
    <GlassPanel
      className={cn(
        "flex items-center gap-1",
        // Across, the label and verdict flank the row instead of stacking, which
        // would triple the strip's height.
        across ? "flex-row px-2 py-1" : "flex-col px-2 py-1.5",
        className,
      )}
    >
      <HudLabel>
        <Trans context="the barbarian fleet">Fleet</Trans>
      </HudLabel>
      <Tip
        tapToOpen
        title={t`Barbarian fleet`}
        hint={
          <span className="flex flex-col gap-1">
            <span>
              <Trans>
                Advances one step whenever the event die shows a ship. Attacks the cities when it
                reaches {dist}.
              </Trans>
            </span>
            <span>
              <Trans>
                All knights: the total level of every active knight on the board, every seat's
                together, not just yours. The barbarians: one for each city on the board, {cities}{" "}
                right now. The knights must match them to repel the raid.
              </Trans>
            </span>
            {firstIgnored && (
              <span>
                <Trans>
                  This table skips the barbarians' first landfall. Nothing is razed, no one is
                  honoured as defender, and your knights stay active. The fleet then sails again and
                  the next invasion counts for real.
                </Trans>
              </span>
            )}
          </span>
        }
      >
        <svg
          // Across, the viewBox is a design width and the element scales to the
          // strip, so no window measurement is needed. Down, the box is a layout
          // term other things are positioned against, so it is drawn at size.
          width={across ? undefined : w}
          height={across ? undefined : h}
          viewBox={`0 0 ${w} ${h}`}
          className={cn("cursor-default outline-none", across && "h-auto w-full min-w-0")}
          role="img"
          // Not "{at} of {dist}": a bare "of" frame inflects badly in most
          // target languages. Named as a labelled step instead.
          aria-label={t`Barbarians. Step ${at} of ${dist}. ${label}.`}
        >
          {/* The tack is always drawn whole: every cell has the same outline
              whatever step the fleet is on, so the route is a fixed scale the
              ship moves against (one moving part). The exception is the shore,
              the fleet's destination. */}
          {cells.map((c) => (
            <polygon
              key={c.step}
              points={hexPoints(c.x, c.y, s)}
              strokeWidth={stroke}
              // Three states; only the last hex is coloured.
              //
              // The shore is red with nothing in it: any glyph is a smudge at a
              // 9px hex, and red means "this is where it goes wrong".
              //
              // `--red-ink`, not `--red`: the ink pair is theme-aware (#c20017
              // light, #ff4f64 dark) and matches the verdict below.
              fill={
                c.step === dist
                  ? "var(--color-red-ink)"
                  : c.step <= at
                    ? "var(--color-foreground)"
                    : "none"
              }
              // Water the fleet has crossed takes the ship's colour, so the
              // track reads as a wake.
              fillOpacity={c.step === dist ? 0.3 : c.step <= at ? 0.22 : 0}
              // `--line-strong`, not `--line` (a hairline divider, #d9e6f2 in
              // light mode, invisible as a 1.1px stroke on the HUD glass). See
              // the tokens in index.css.
              stroke={c.step === dist ? "var(--color-red-ink)" : "var(--color-line-strong)"}
            />
          ))}

          <Ship ref={ship} />
        </svg>
      </Tip>

      {/* The verdict: the sum (every seat's knights against one barbarian per
          city) behind a shield in the verdict's colour. Under the box when
          down, after the track when across. */}
      <Tip title={label} tapToOpen>
        <span
          data-rail-verdict={verdict}
          className={cn(
            "flex cursor-default items-center justify-center outline-none",
            across ? "shrink-0 flex-row pl-1" : "flex-col",
          )}
          style={across ? undefined : { minHeight: VERDICT_H }}
        >
          <span className="hud-verdict-sum flex items-center gap-1 whitespace-nowrap tabular-nums">
            <span
              className={cn(
                "flex h-[13px] w-[13px] items-center justify-center",
                verdict === "hold"
                  ? "text-green-ink"
                  : verdict === "free"
                    ? "text-amber-ink"
                    : "text-red-ink",
              )}
            >
              <Shield />
            </span>
            <Trans context="barbarian rail: all knights' strength against the barbarians' strength">
              {defense} <i>vs</i> {cities}
            </Trans>
          </span>
        </span>
      </Tip>
    </GlassPanel>
  );
}

/**
 * Drive the ship between hexes ourselves, a frame at a time, with no CSS
 * transition (see lib/barbMotion for why those failed). Owning every frame
 * avoids interpolation and transform-origin issues, and matches how the board
 * moves (robberMotion, knightMotion and chipSwap are pose functions over a
 * ticker).
 */
function useSail(
  cells: RailCell[],
  at: number,
  roll: boolean,
  ship: React.RefObject<SVGGElement | null>,
): void {
  const clamp = (n: number) => Math.min(Math.max(n, 0), cells.length - 1);
  // Where the ship was last time, which it sails from. A ref, since a state
  // update would re-run the effect and restart the sail.
  const from = React.useRef(clamp(at));

  // A layout effect that writes the pose to the DOM node rather than state, so
  // a 460ms sail doesn't re-render the whole Rail every frame.
  //
  // Layout rather than passive so the start pose lands before paint: `at` has
  // already changed, so a frame painted before the first rAF would show the
  // ship at its destination.
  React.useLayoutEffect(() => {
    const write = (p: ShipPose) => {
      const g = ship.current;
      if (!g) return;
      g.setAttribute(
        "transform",
        `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${p.rot.toFixed(2)})`,
      );
    };
    const a = cells[from.current] ?? cells[0];
    const b = cells[clamp(at)];
    from.current = clamp(at);
    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || a === b) {
      write({ x: b.x, y: b.y, rot: 0 });
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    write(sailPose(a, b, 0));
    const tick = (now: number) => {
      const t = (now - t0) / SAIL_MS;
      const p = sailPose(a, b, t);
      write(roll ? p : { ...p, rot: 0 });
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `clamp` closes over `cells`, which is memoised on the track's shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, cells, roll]);
}

/** The fleet. A flat glyph for now; the baked ship sprite replaces this. */
const Ship = React.forwardRef<SVGGElement>(function Ship(_props, ref) {
  return (
    // No `transform` here: useSail owns it, and a JSX value would overwrite the
    // sail on every unrelated re-render.
    <g ref={ref} className="text-foreground" fill="currentColor">
      <path d="M -8 2.5 L 8 2.5 L 5.4 8 L -5.4 8 Z" />
      <path d="M -0.8 -10 L 0.8 -10 L 0.8 2.5 L -0.8 2.5 Z" />
      <path d="M 0.8 -9 L 6.6 1 L 0.8 1 Z" />
      <path d="M -0.8 -6.6 L -5.2 1 L -0.8 1 Z" opacity="0.55" />
    </g>
  );
});
