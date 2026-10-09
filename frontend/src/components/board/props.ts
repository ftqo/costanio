// The board's interaction contract. Board3D implements it; the map builder and
// the preview route hand a board these props without being one.
//
// Nothing here is renderer-specific: a board takes a view, a mode, and one
// callback per kind of thing that can be pointed at. A renderer ignores what it
// cannot honour.
import type { FullView, Vertex, Edge, Hex } from "@/lib/types";
import type { BoardLocation } from "@/lib/locationActions";
import type { PieceInfo } from "@/lib/boardInfo";
import type { BoardMode } from "@/lib/boardTargets";

// BuildMode is BoardMode, so a new mode reaches MODE_SHAPE's exhaustive Record.
export type BuildMode = BoardMode;

export interface BoardProps {
  view: FullView;
  mode?: BuildMode;
  /** The progress card being played, for card-specific target sets (phex/pvertex/pedge). */
  progressCard?: string | null;
  /**
   * A spot was chosen in a build or forced mode. `at` is the client-space point
   * of the press, so a host can anchor a panel there. Optional, but always
   * supplied by a renderer with a pointer.
   */
  onVertex?: (v: Vertex, at?: { x: number; y: number }) => void;
  onEdge?: (e: Edge, at?: { x: number; y: number }) => void;
  onHex?: (h: Hex, at?: { x: number; y: number }) => void;
  onKnight?: (v: Vertex) => void;
  onShip?: (e: Edge) => void;
  /**
   * Location-first ("inspect") mode: a clickable spot was tapped. `at` is the
   * client-space point of the click, for anchoring a menu. Pointer coordinates
   * rather than a re-projected world point: no per-frame loop needed, and the
   * next board press closes the menu anyway.
   */
  onInspect?: (loc: BoardLocation, at: { x: number; y: number }) => void;
  /**
   * The spot whose action menu is open, or null. Once the menu opens the
   * pointer leaves the board, so a board with a hover treatment holds it on this
   * spot until the menu closes. The host owns it because the host owns the menu.
   * Honoured by Board3D only.
   */
  heldLoc?: BoardLocation | null;
  /**
   * The pointer came to rest on something, or left it. Descriptive only (see
   * `lib/boardInfo`). Fires null as soon as the pointer leaves, and a
   * description only after a short dwell, so sweeping doesn't strobe a card.
   * Honoured by Board3D only.
   */
  onHoverInfo?: (info: PieceInfo | null, at: { x: number; y: number }) => void;
  /**
   * Explain mode (lib/explainMode): every press describes what it lands on via
   * `onHoverInfo` and dispatches nothing (no build, robber or inspect menu).
   * The player arms this because they don't know what a tap would do, so no tap
   * may commit. No dwell, since every press is already a question.
   * Honoured by Board3D only.
   */
  explaining?: boolean;
  /**
   * An explanation was produced, so explain mode can stand down. Separate from
   * `onHoverInfo` because a press on empty sea also calls that (with null) and
   * must not disarm.
   */
  onExplained?: () => void;
  /**
   * Press and hold to describe a piece, on a pointer with no hover. A hidden
   * shortcut, so explain mode stays as the discoverable path. A hold that fires
   * suppresses the tap (see `heldExplain` in Board3D, like `lib/touch`). Off on
   * a mouse: hover already answers there, and a slow click on a hex would
   * describe it instead of moving the robber.
   */
  pressToExplain?: boolean;
  /**
   * What the host's chrome covers, so the board frames itself into the visible
   * area. The board does not measure the chrome itself: which clusters are
   * mounted is the game screen's business, and below `lg` the rail is a strip.
   *
   * `railFrac` is the rail's measured width as a fraction of the viewport, not
   * an inset. The board shifts only as much as it needs to, which on most
   * windows is none; it is symmetric (see `HudInsets.right`).
   *
   * `left`/`right` override it per side, for a host that wants the board off
   * centre (e.g. a landing page with a headline column).
   */
  hudChrome?: {
    railFrac?: number;
    left?: number;
    right?: number;
    bottom?: number;
    top?: number;
  };
  /** Selected source for a ship move (shipmove mode): scopes the highlights. */
  moveFromEdge?: Edge;
  /** Selected source for a knight move (knightmove mode): scopes the highlights. */
  moveFromVertex?: Vertex;
  /**
   * Already-chosen first hex of a two-hex pick (Inventor's `inventor2` step).
   * Both steps read the same target set, and the engine accepts `{a: h, b: h}`,
   * which would spend the card and change nothing.
   */
  moveFromHex?: Hex;
  /**
   * Explorers: the ship chosen in the fleet panel and the job armed for it.
   * `sail` and `shipact` look their targets up by ship id (and `shipact` by
   * job), as `ridermove` looks a rider up by edge.
   */
  moveFromShip?: number | null;
  shipJob?: string | null;
  colorOf?: (seat: number) => string;
  /**
   * Stamp each building with its owner's seat number (1-based). Colorblind
   * mode's non-colour channel: past six or seven seats no palette stays
   * distinguishable. Honoured by both boards.
   */
  numberPieces?: boolean;
  /**
   * How plainly a legal spot shows when nothing points at it. `undefined` keeps
   * the board's default: invisible until hovered. That suits a mode the player
   * armed, but not one the game forced (setup, a seven, a knight owed a spot) or
   * a coarse pointer with no hover. A number because a whole-phase placement can
   * be loud while an expected set only needs to be findable.
   * Honoured by Board3D only.
   */
  restingMarkers?: number;
  /**
   * What a legal spot is drawn as.
   *
   * - `pip`: a flat gold disc with a dark ring in the board plane.
   * - `none`: no resting mark; nothing is built or animated.
   * - `pedestal`: a pool of glow, a short column of light and drifting motes
   *   (lib/board3d/pedestal). It has height, which a flat mark lacks at a 56
   *   degree view, and motion, which sets it apart from the board's static gold.
   *
   * A resting mark is shown only when the board is asking: the player committed
   * to an action (armed a piece, played a card wanting a spot) or the game
   * demanded one (setup, a seven, a knight owed a spot, a city owed to the
   * barbarians). `inspect` is the default state of your own turn and gets no
   * resting mark, only hover previews.
   *
   * Honoured by Board3D only.
   */
  markerStyle?: "none" | "pip" | "pedestal" | "swarm";
  /**
   * Carry the piece itself on the pointer instead of previewing a copy. For the
   * robber, which is moved rather than built: a ghost robber on the hovered hex
   * would show two robbers, so the hex it is leaving takes the ghost instead.
   * Nothing is committed until a click.
   */
  carryOnHover?: boolean;
  /**
   * The viewer's own equipped robber skin, for the carried preview. Absent
   * means stock art. `view.robber_skin` is whoever last moved the robber; this
   * is the viewer's own cosmetic, which the client already knows. The robber on
   * the board keeps its skin until the move completes.
   */
  viewerRobber?: string;
  /**
   * A preview that travels between candidate spots instead of fading out and
   * back in, so the eye can follow it as the pointer moves between legal spots.
   */
  slideGhost?: boolean;
  /**
   * The legal spot under the pointer, or null. Unlike `onHoverInfo` (one-second
   * dwell, describes what stands there), this fires as soon as the nearest
   * candidate changes and carries only the spot.
   *
   * Used when the turn timer runs out: the hovered spot is sent as the move the
   * player was about to make instead of passing the turn.
   * Honoured by Board3D only.
   */
  onHoverSpot?: (spot: BoardSpot | null) => void;
}

/**
 * A place on the board of any of the three kinds. `BoardLocation` (the inspect
 * menu's type) has no hex; this widens it because the robber's destinations
 * are hexes.
 */
export type BoardSpot = BoardLocation | { kind: "hex"; h: Hex };
