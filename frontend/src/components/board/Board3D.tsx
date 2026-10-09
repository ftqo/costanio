import * as React from "react";
import * as THREE from "three";
import { useLingui } from "@lingui/react/macro";
import { ResetView } from "@/components/game/hudIcons";
import { onBoardModeChange } from "@/lib/board3d/boardTheme";
import { currentBoardLook, onBoardPostFxChange } from "@/lib/boardPostFx";
import { setEmissiveBoost } from "@/lib/board3d/palette";
import { gradedPageHex } from "@/lib/board3d/postfx";
import { createAtmosphere } from "@/lib/board3d/atmosphere";
import { edgeKey, seatColor, vertexKey } from "@/lib/hexgeo";
import type { Hex } from "@/lib/types";
import type { BoardProps, BoardSpot, BuildMode } from "./props";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  boardExtent,
  boardShapeKey,
  boardFitPoints,
  boundingCylinderPoints,
  ceilingMoved,
  fitDistance,
  framingDistanceFor,
  orbitDir,
  usableFrame,
  makeCamera,
  makeLights,
  minCameraDistance,
  maxPolarAngle,
  HUD_BOTTOM_INSET,
  clampPanTarget,
  frameTarget,
  applyViewport,
  openingPose,
  flatView,
  cameraReadout,
  fitBounds,
  type HudInsets,
  type FrameBounds,
  TINTED_LAYER,
  OCEAN_LAYER,
  OVERLAY_LAYER,
  configureShadows,
  invalidateShadows,
  nearOceanRadius,
  oceanRadiusAnyAspect,
  oceanFog,
  farPlaneFor,
  oceanFadeFor,
  CAMERA_DAMPING,
  CAMERA_ROTATE_SPEED,
  ZOOM_DAMPING,
  dampingForFrame,
  wheelDollyFactor,
  dollyStep,
  cameraAtRest,
  reframeNeeded,
  reopenForSideBand,
  cameraElevationDeg,
  showcaseSettle,
  showcaseSpin,
  SHOWCASE_ELEVATION_DEG,
  SHOWCASE_FILL,
} from "@/lib/board3d/scene";
import { loadPalette } from "@/lib/board3d/palette";
import { TILES } from "@/lib/board3d/manifest.generated";
import {
  loadAsset,
  subsetByPrefix,
  subsetByPrefixes,
  tileFileFor,
  materialNamed,
  assetBaseY,
  assetSpanY,
  preloadBoardTiles,
  type LoadedAsset,
} from "@/lib/board3d/loader";
import {
  instanceAsset,
  instanceGeometry,
  disposeInstances,
  animatable,
  poseInstanceAt,
  type InstancePose,
  type Placement,
} from "@/lib/board3d/instancing";
import { createTicker, type Ticker, type TickInfo } from "@/lib/board3d/anim";
import {
  DROP_TOTAL_MS,
  dropPose,
  dropStarts,
  newlyPlaced,
  pieceKey,
  stillFalling,
} from "@/lib/board3d/drop";
import { hopPose, newlyReady, HOP_TOTAL_MS } from "@/lib/board3d/knightMotion";
import {
  swordRaisePose,
  swordLowerPose,
  swordGuardTilt,
  swordPivot,
  promoted,
  newlyStoodDown,
  knightGrowPose,
  SWORD_RAISE_MS,
  SWORD_LOWER_MS,
  SWORD_FLIP_AXIS_Y,
  KNIGHT_GROW_MS,
} from "@/lib/board3d/knightSword";
import { robberPose, stillMoving, ROBBER_STILL, type RobberAnim } from "@/lib/board3d/robberMotion";
import {
  planPeek,
  peekPivot,
  peekTilt,
  stillPeek,
  PEEK_TAP_HOLD_MS,
  type Peek,
} from "@/lib/board3d/robberPeek";
import {
  markerPose,
  planTrip,
  stillTrip,
  tripPose,
  tripRunning,
  MERCHANT_TRAVEL,
  ROBBER_TRAVEL,
  type Trip,
} from "@/lib/board3d/markerMotion";
import { CARRY_PACE, GHOST_SLIDE } from "@/lib/board3d/carry";
import {
  columnGeometry,
  columnMaterial,
  motesGeometry,
  motesMaterial,
  fadeAt,
  FADE_IN_MS,
  FADE_OUT_MS,
  moteSpec,
  pedestalClock,
  pedestalFade,
  PEDESTAL_HOVER_REST,
  PEDESTAL_PARTS,
  restingForCount,
  poolGeometry,
  poolMaterial,
  rimGeometry,
  rimMaterial,
  PEDESTAL_RENDER_ORDER,
} from "@/lib/board3d/pedestal";
import { gapStripGeometry, SAND_Y, GAP_SAND_MATERIAL } from "@/lib/board3d/gapGeometry";
import { planGapSand } from "@/lib/board3d/layers/gap";
import { tintableAsset } from "@/lib/board3d/tintedAsset";
import { createOceanPass, type OceanPass } from "@/lib/board3d/oceanPass";
import { warmPrograms } from "@/lib/board3d/warmPrograms";
import { seatTint } from "@/lib/board3d/tint";
import { buildSeatNumerals, disposeSeatNumerals } from "@/lib/board3d/seatNumerals";
import { planTiles, planOcean, tileScale, TILE_ROTATION_Y } from "@/lib/board3d/layers/tiles";
import {
  tileArtOverrides,
  planCamels,
  planRafts,
  planSpokes,
  CAMEL_PREFIX,
  RAFT_PREFIX,
  SPOKE_PREFIX,
} from "@/lib/board3d/layers/caravans";
import {
  planWeirs,
  planFishingGrounds,
  FISHGROUND_PREFIX,
  planGroundChips,
  groundFitPoints,
  WEIR_PREFIX,
} from "@/lib/board3d/layers/fishermen";
import { planBridges, BRIDGE_PREFIX } from "@/lib/board3d/layers/rivers";
import { dynamicPiecesKey } from "@/lib/board3d/piecesKey";
import {
  hiddenChips,
  hiddenChipsKey,
  castleTileArt,
  planRaiders,
  seatRaiders,
  planRiders,
  RAIDER_PREFIX,
  RIDER_PREFIX,
} from "@/lib/board3d/layers/raiders";
import {
  tradeTileOverrides,
  planWagons,
  planPathBarbarians,
  WAGON_PREFIX,
  PATH_BARBARIAN_PREFIX,
} from "@/lib/board3d/layers/wagons";
import {
  tileArtOverrides as explorersTileArt,
  planCargoShips,
  planCorsair,
  planQuays,
  planHolds,
  planLairs,
  planHexCrews,
  LAIR_PREFIX,
  BOARDER_PREFIX,
  COUNCIL_TILE,
  explorersFrame,
  planShoalHauls,
  SHOAL_DRAWN_PREFIXES,
  SHOAL_HAUL_Y,
  SHOAL_HAUL_SCALE,
  CARGO_PREFIX,
  CORSAIR_PREFIX,
  QUAY_PREFIX,
  CREW_PREFIX,
  SETTLER_PREFIX,
  HAUL_PREFIX,
  SPICE_PREFIX,
  type HoldPart,
} from "@/lib/board3d/layers/explorers";
import { hexKey, hexToWorld, type Vec3 } from "@/lib/board3d/coords";
import {
  planChips,
  planLakeChips,
  isChipKey,
  chipKey,
  chipsMatching,
} from "@/lib/board3d/layers/chips";
import { chipArt, chipPrefix, composeLakeChip } from "@/lib/board3d/lakeChip";
import { lakeNumbers } from "@/lib/fish";
import { CHIP_FLIP, flipAxisY, flipPose, stillFlipping } from "@/lib/board3d/flip";
import { CHIP_SWAP, swapPose, stillSwapping } from "@/lib/board3d/chipSwap";
import { planPieces } from "@/lib/board3d/layers/pieces";
import { planBeaches } from "@/lib/board3d/layers/beaches";
import {
  planFog,
  planFogFloor,
  planFogShore,
  planFogPlates,
  planFogLandBeach,
  fogPlateGeometry,
  fogKeys,
  fogShoreMaterial,
  FOG_SHORE_MATERIALS,
  fogTileArt,
  fogPuffGeometry,
  fogMaterial,
  fogKitMeshes,
  FOG_MODEL,
  FOG_FLOOR_SQUASH,
  FOG_RESOURCE,
} from "@/lib/board3d/layers/fog";
import {
  planPorts,
  portWaterPlacements,
  groupDockArt,
  groupSignArt,
  PORT_TILE,
} from "@/lib/board3d/layers/harbors";
import {
  planRobber,
  robberGhostSeat,
  robberOnBoard,
  robberOnChip,
  ROBBER_KEY,
  ROBBER_PREFIX,
  robberAssetFile,
  applyRobberChroma,
  STOCK_ROBBER_FILE,
} from "@/lib/board3d/layers/robber";
import { pieceSetAssetFile, STOCK_PIECES_FILE } from "@/lib/pieceSets";
// Aliased: `seat` is also the name of the loop variable for a player's seat.
import { seat as seatOn, SURFACE } from "@/lib/board3d/seating";
import { planShips, planPirate, SHIP_PREFIX, PIRATE_PREFIX } from "@/lib/board3d/layers/islands";
import {
  planPickTargets,
  planInfoPicks,
  MARKER_Y,
  type PickTarget,
  type InfoPick,
} from "@/lib/board3d/targets";
import type { PieceInfo } from "@/lib/boardInfo";
import {
  faultRingGeometry,
  faultRingMaterial,
  markerGeometry,
  markerMaterial,
  markerOutlineGeometry,
  markerOutlineMaterial,
  markerPlacements,
  MARKER_RENDER_ORDER,
  type MarkerKind,
} from "@/lib/board3d/markers";
import { isClick, pickAt, pickTap, INFO_SNAP_RADIUS, type Snappable } from "@/lib/board3d/picking";
import { hoverPickAt, type Body } from "@/lib/board3d/hoverPick";
import { flatFitPoints } from "@/lib/board3d/fit";
import { projectToFrame, type Projector } from "@/lib/board3d/project";
import {
  ghostCycleIndex,
  hoverEffectFor,
  ghostFade,
  bulgeEase,
  shrinkEase,
  BULGE_MS,
  BULGE_SCALE,
  setupPlacesCity,
  type GhostKind,
  type HoverEffect,
} from "@/lib/board3d/ghost";
import {
  availableGhostKinds,
  disposeGhosts,
  GHOST_OPACITY,
  SLIDE_GHOST_OPACITY,
  loadGhosts,
  poseGhost,
  type Ghost,
  type GhostSeat,
} from "@/lib/board3d/ghostMesh";
import { actionsAt, pieceAt, type BoardLocation } from "@/lib/locationActions";
import { haptic, LONG_PRESS_MS, LONG_PRESS_SLOP_PX } from "@/lib/touch";

import { resolveCssColorToHex } from "@/lib/colorResolve";
import { MODULE_SCALE, PIECE_PREFIX, PIECE_SCALE, ROBBER_SCALE } from "@/lib/board3d/pieceArt";
import {
  annulusMaterial,
  applyOceanLook,
  oceanAnnulusGeometry,
  seaCastsShadow,
  setOceanFade,
  setOceanTime,
  splitOceanSurface,
  OCEAN_FLAT_Y,
  OCEAN_MAX_Y,
  OCEAN_WATER_MATERIAL,
  OCEAN_CLOCK_HZ,
} from "@/lib/board3d/ocean";
import {
  planKnights,
  planWalls,
  planMetros,
  metropolisVertexKeys,
  planMerchant,
  knightLevels,
  KNIGHT_PREFIX,
  KNIGHT_SWORD_PREFIX,
  SWORD_STATE,
  swordKey,
  isSwordKey,
  METRO_PREFIX,
  WALL_PREFIX,
  MERCHANT_PREFIX,
  metroDraws,
} from "@/lib/board3d/layers/knights";

/**
 * How long the pointer must rest on a piece before it describes itself. A full
 * second, so the card answers a deliberate pause rather than a passing pointer.
 */
const INFO_DWELL_MS = 1000;

/**
 * The merchant's identity, for the animation bookkeeping in `instancing`.
 *
 * Like ROBBER_KEY, a constant: the one merchant moves, and a key derived from
 * its hex would make each move look like a new piece. See
 * lib/board3d/markerMotion. It lives here because `planMerchant` plans keyless
 * placements; the key is attached where instances are built.
 */
const MERCHANT_KEY = "merchant";

/**
 * The modes in which the robber is being moved, so `carryOnHover` has
 * something to carry. `pirate` is included because the seven offers a choice
 * between the two pieces.
 */
const CARRY_MODES: ReadonlySet<BuildMode> = new Set<BuildMode>(["robber", "pirate", "chaserobber"]);

/** Two spots that are the same spot, allowing for float drift. */
function samePoint(a: Vec3, b: Vec3): boolean {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;
}

/** A marker field that has been replaced and is fading out on its own clock. */
interface FadingMarkers {
  objects: THREE.Object3D[];
  stop: () => void;
}

/**
 * Release a marker field, whichever style built it.
 *
 * Pip styles build instanced meshes; pedestal and swarm styles add a `Points`
 * cloud. All own their geometry and material, so both are freed here, and only
 * instanced ones go on to `disposeInstances`.
 */
function disposeMarkers(list: readonly THREE.Object3D[]): void {
  const instanced: THREE.InstancedMesh[] = [];
  for (const o of list) {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material?.dispose();
    o.removeFromParent();
    if ((o as THREE.InstancedMesh).isInstancedMesh) instanced.push(o as THREE.InstancedMesh);
  }
  disposeInstances(instanced);
}

/**
 * Where a ghost is standing, as a plain point. The slide needs it because the
 * target the last hover belonged to is gone.
 */
function ghostPoint(ghost: Ghost): Vec3 {
  const p = ghost.object.position;
  return [p.x, p.y, p.z];
}

/** Material in beach.glb for each sand band. */
const SAND_MATERIAL = {
  dry: "Mat_Shore_sand",
  wet: "Mat_Shore_wetsand",
} as const;

/**
 * Shortest gap between two frames of the ocean, in milliseconds.
 *
 * The rest of the board draws on demand; the ocean alone redraws on a clock.
 * Each frame re-renders the whole board (450-556 draw calls), so the rate
 * directly sets the idle GPU cost. Derived from `OCEAN_CLOCK_HZ` in `ocean.ts`,
 * which sets the rate and wave speeds together. The low-graphics mode freezes
 * the swell and does not run this loop.
 *
 * The better fix would be to stop redrawing the board to move the water (the
 * ocean is a uniform, not geometry).
 */
const OCEAN_FRAME_MS = 1000 / OCEAN_CLOCK_HZ;

/**
 * Split owned placements by seat, preserving order within each seat.
 * `tintedAsset` clones materials per seat, so seat-tinted families must be
 * grouped by owner before instancing.
 */
function bySeat<T extends { owner: number }>(owned: T[]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const item of owned) out.set(item.owner, [...(out.get(item.owner) ?? []), item]);
  return out;
}

/**
 * The camera controls a host can drive from its own chrome.
 *
 * A handle rather than callback props, because the closures are rebuilt with
 * the rig (see the rig effect below) and a ref read at call time is always
 * current. New imperative surface for the HUD goes here.
 */
export type Board3DControls = {
  resetView: () => void;
  /**
   * Make the robber answer for the hex it is blocking.
   *
   * Imperative because it is an event, not state. The board raises it itself
   * for a click on the robber's hex; the game screen raises it when the rolled
   * number is the one the robber sits on.
   */
  pulseRobber: () => void;
  /**
   * Turn over every chip showing the number that just came up. Imperative
   * because a roll is an event only the game screen sees.
   */
  flipChips: (total: number) => void;
  /**
   * Somersault the robber, for a seven (which no chip carries). Distinct from
   * `pulseRobber`, which means "this hex owed you and I blocked it".
   */
  flipRobber: () => void;
  /**
   * Send the number chips on two hexes round to each other's places (the
   * Knights Inventor card).
   *
   * Unlike the others it does not start on the spot: the chips to move are the
   * ones showing the new numbers, which exist only after the static half is
   * rebuilt. See `chipSwap`.
   */
  swapChips: (a: { q: number; r: number }, b: { q: number; r: number }) => void;
  /**
   * The barbarians landed: every knight on the table lowers its sword.
   *
   * The board sees knights deactivate in the next view but not why, and
   * knights deactivate routinely when spent, which is not animated. Only the
   * game screen reads `cak_barbarian_attack`, so it says when, and the board
   * animates whatever stands down on the next commit. See `standDown`.
   */
  standDownKnights: () => void;
  /**
   * Turn the board slowly under a fixed showcase tilt, or stop turning it (the
   * endgame overlay's backdrop).
   *
   * The camera keeps its bearing and eases to `SHOWCASE_ELEVATION_DEG` and a
   * distance that fits at every bearing, while the turn winds up from rest.
   *
   * Off leaves the camera where it is; the reset button returns to the opening
   * pose. Any drag, pinch or wheel also cancels it, and it does not resume.
   */
  setAutoOrbit: (on: boolean) => void;
};

/** The pointer is on nothing, or on a spot with nothing to say. */
const NO_HOVER: HoverEffect = { kind: "none" };

/**
 * What the build knew about one sword: the pivot it turns about (its knight's
 * hand, which depends on level) and which way a hover moves it (from `active`).
 * Both are lost once the sword is an instance. See `swordArt`.
 */
type SwordArt = { pivot: { x: number; y: number }; guard: number };

/**
 * The 3D board. Layout decisions live in lib/board3d/*, which unit-tests
 * without WebGL; this owns one renderer and one scene, drawn with InstancedMesh.
 *
 * It implements the same interaction contract as the 2D board (see ./props).
 * Input is the inverse of `lib/board3d/coords` (one ray, one plane, snap to the
 * nearest legal target) and lives in `lib/board3d/picking` and
 * `lib/board3d/targets`. See picking.ts for why it is not a raycast.
 *
 * Without WebGL (including jsdom) the component still mounts and tears down
 * cleanly and shows an empty board.
 */
/**
 * The board's own reset control, for hosts with no chrome (the preview route).
 * A host that passes `controlsRef` draws its own and this never mounts.
 *
 * A separate component so its `useLingui` context subscription re-renders
 * only the button, not the whole board.
 */
function ResetViewButton({ onClick }: { onClick: () => void }) {
  const { t } = useLingui();
  return (
    <button
      type="button"
      title={t`Reset view`}
      aria-label={t`Reset view`}
      onClick={onClick}
      // No `backdrop-blur`, as for ZoomControls' twin of this button.
      className="absolute left-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-lg border-2 border-border bg-secondary-background shadow-hard-sm hover:brightness-95 active:translate-y-px"
    >
      <ResetView size={14} />
    </button>
  );
}

/**
 * The board, memoised: most of its renders came from ancestors with
 * unchanged props, and nothing below is cheap to redo.
 *
 * When `Game` itself re-renders, its inline handlers and `hudChrome` are new
 * objects and the memo correctly misses. Fixing that belongs in `Game` (pin
 * them to refs, after restructuring its early returns). Do not add a
 * comparator that ignores the handlers: the board would keep closures over a
 * stale `view` and `effMode`.
 */
export const Board3D = React.memo(function Board3D({
  view,
  mode = "none",
  progressCard,
  onVertex,
  onEdge,
  onHex,
  onKnight,
  onShip,
  onInspect,
  heldLoc,
  onHoverInfo,
  explaining,
  onExplained,
  pressToExplain,
  onHoverSpot,
  hudChrome,
  moveFromEdge,
  moveFromVertex,
  moveFromHex,
  moveFromShip,
  shipJob,
  colorOf = seatColor,
  numberPieces = false,
  restingMarkers,
  markerStyle = "pip",
  viewerRobber,
  carryOnHover = false,
  slideGhost = false,
  className,
  controls = false,
  controlsRef,
  onProjector,
  onReady,
  pieceSet,
  flagHexes,
}: BoardProps & {
  className?: string;
  /**
   * Which .glb the buildings and roads come from, when not the stock
   * `pieces.glb`. Dev-only (`dev/board-live.html?pieces=<set>`), for judging a
   * piece set under `art/pieces/<set>.blend` through the game's camera. Not a
   * cosmetics feature. The robber still comes from `pieces.glb`.
   */
  pieceSet?: string;
  /**
   * Let the viewer orbit, pan and zoom. Off by default so previews do not move
   * under the cursor. Placement works either way: a click is told from a drag
   * by distance travelled.
   */
  controls?: boolean;
  /**
   * Handed the camera controls on mount. A host that takes them draws its own
   * reset button, so the board does not.
   */
  controlsRef?: React.Ref<Board3DControls | null>;
  /**
   * Handed a world-to-canvas projector when the rig exists, and null when it
   * goes away, so the host knows when it can draw overlays. Fires once per
   * rig; the projection is cheap enough to call every frame.
   *
   * Not on `BoardProps` (components/board/props), which the SVG fallback also
   * takes. Without WebGL it is never published.
   */
  onProjector?: (projector: Projector | null) => void;
  /**
   * Fired once, after the board has drawn a frame. A built scene is not enough:
   * three compiles shaders, uploads geometry and runs the first shadow pass on
   * the first draw. `Game` holds its entry screen until this fires (see
   * `gameEntry.ts`).
   */
  onReady?: () => void;
  /**
   * Hexes to ring in red because something about them is wrong.
   *
   * Not a marker and not on `BoardProps`: markers come from `view.legal` and
   * mean "pick this", while these are the caller's own list and are not
   * clickable. The only caller is the map builder's preview overlay
   * (`routes/mapbuilder/PreviewOverlay.tsx`), to show which hexes a geometry
   * check failed on. See `faultRingMaterial`.
   *
   * Compared by content, so a caller may rebuild the array every render.
   */
  flagHexes?: readonly Hex[];
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  /**
   * The projector callback, in a ref so the rig effect does not depend on it:
   * an inline arrow would otherwise rebuild the renderer every render, resetting
   * the camera and killing a drag in progress.
   */
  const onProj = React.useRef(onProjector);
  onProj.current = onProjector;

  /** Same treatment, for the same reason. */
  const onReadyCb = React.useRef(onReady);
  onReadyCb.current = onReady;
  /**
   * The handshake between the two effects: the content effect raises `pending`
   * after a build, and the rig's `draw` lowers it once a frame has gone out.
   * `fired` limits it to the first board per mount.
   */
  const readyPending = React.useRef(false);
  const readyFired = React.useRef(false);

  /**
   * The HUD's dead bands, read live by the resize/reframe path. Refs so a
   * breakpoint flip re-runs the resize instead of rebuilding the rig.
   */
  /**
   * The seat rail's width, reserved on both sides of the board.
   *
   * The rail is only on the left, but a one-sided band shifts the board off
   * centre (see `applyHudInset`), and the right edge has its own chrome. The
   * cost is framing into ~74% of the width instead of ~87%.
   */
  const insetLeft = React.useRef(0);
  const insetRight = React.useRef(0);
  const insetBottom = React.useRef(HUD_BOTTOM_INSET);
  const insetTop = React.useRef(0);
  // `railFrac` sets both sides; `left`/`right` override it per side for a host
  // that wants the board off-centre.
  insetLeft.current = Math.max(0, hudChrome?.left ?? hudChrome?.railFrac ?? 0);
  insetRight.current = Math.max(0, hudChrome?.right ?? hudChrome?.railFrac ?? 0);
  insetBottom.current = Math.max(0, hudChrome?.bottom ?? HUD_BOTTOM_INSET);
  insetTop.current = Math.max(0, hudChrome?.top ?? 0);

  /**
   * The rig: renderer, scene, camera, controls. Built once per board and held
   * in a ref so the content effect can draw into it without owning it; it must
   * survive game updates or the camera resets and drags die.
   */
  const gl = React.useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    /** The controls, or undefined on a board that was built without them. */
    orbit: OrbitControls | undefined;
    /**
     * Render now. Only the ticker should call this; everything else uses
     * `requestDraw`, so event handlers (pointermove, resize) do not render
     * synchronously.
     */
    draw: () => void;
    /** Draw on the next frame, once, however many callers ask. */
    requestDraw: () => void;
    /**
     * Compile what `objects` need before they join the scene, so their first
     * frame does not wait on the driver. See `warmPrograms`.
     */
    warm: (objects: readonly THREE.Object3D[], cancelled: () => boolean) => Promise<void>;
    /** Re-read the host's box, re-apply the viewport, re-frame. */
    resize: (keepDistance?: boolean, sidesMoved?: boolean) => void;
    /** Re-frame for the size we already have, after something the framing depends on moved. */
    refit: () => void;
    /**
     * Whether the camera is still damping toward rest, which holds the
     * animation loop open. Must read `false` on a board nobody is touching.
     */
    cameraSettling: () => boolean;
    /**
     * Where the board lands on screen, in CSS px: the projected bounds of the
     * fit point set, and the pivot. See the implementation for why those two
     * answer the whole of the framing question.
     */
    frame: () => {
      centre: { x: number; y: number };
      bounds: { minX: number; maxX: number; minY: number; maxY: number };
      canvas: { top: number; left: number; width: number; height: number };
      flat: boolean;
      wantBounds: FrameBounds;
      fitDist: number;
      dist: number;
      ndc: { minX: number; maxX: number; minY: number; maxY: number };
    };
    sampleRadiance: () => ReturnType<OceanPass["sampleRadiance"]>;
    picks: () => { kind: string; action: string; key: string; x: number; y: number }[];
    /**
     * What the last frame cost the GPU, for the console. `renderer.info.render`
     * resets each frame, so this draws first and reads immediately after.
     *
     * Comparing `programs` to `calls` tells whether per-seat `tintedAsset`
     * variants compile separate programs (fixable with an instance-colour
     * attribute) or the issue is batching.
     */
    stats: () => {
      programs: number;
      calls: number;
      triangles: number;
      geometries: number;
      textures: number;
      staticMeshes: number;
      dynamicMeshes: number;
      byName: Record<string, { meshes: number; instances: number }>;
    };
    /**
     * The board's one animation loop. Every animated thing shares it so the
     * scene renders once per frame. See lib/board3d/anim.
     */
    ticker: Ticker;
  } | null>(null);

  // A changed dead band recentres the board without rebuilding the rig or
  // moving the camera (see `resize`'s `keepDistance`), except a side band on an
  // untouched camera (see `sidesMoved` in `reframe`).
  const lastSides = React.useRef("");
  React.useEffect(() => {
    const sides = `${insetLeft.current},${insetRight.current}`;
    const sidesMoved = sides !== lastSides.current;
    lastSides.current = sides;
    gl.current?.resize(true, sidesMoved);
  }, [hudChrome?.railFrac, hudChrome?.left, hudChrome?.right, hudChrome?.bottom, hudChrome?.top]);

  /**
   * The instanced meshes on screen, owned by the content effect, in two halves
   * rebuilt on different clocks.
   *
   * Static is the board itself (tiles, ocean, annulus, sand, beaches, chips,
   * docks, signs), which does not change during play. Dynamic is everything
   * that moves: pieces, robber, ships, knights, walls, metropolises, the
   * merchant, the barbarians. The split lets the static half be skipped (see
   * `builtStaticKey`); both live here because the rig's teardown frees them.
   */
  const liveStatic = React.useRef<THREE.InstancedMesh[]>([]);
  const liveDynamic = React.useRef<THREE.InstancedMesh[]>([]);

  /**
   * A pick target as the action model names it (`lib/locationActions` speaks in
   * vertices and edges). Only the geometry crosses over.
   */
  const locOf = React.useCallback((t: PickTarget): BoardLocation | null => {
    if (t.kind === "vertex") return { kind: "vertex", v: t.v };
    if (t.kind === "edge") return { kind: "edge", e: t.e };
    // Nothing is ever built on a hex, so it is not an action location.
    return null;
  }, []);

  /**
   * What `liveStatic` was built for: the board's key and the aspect. Unchanged
   * means the static half of the build can be skipped.
   */
  const builtStaticKey = React.useRef<string | null>(null);

  /**
   * A chip's top face and half its thickness, measured off the loaded art.
   *
   * Refs because the chips pass is on the static clock and usually skipped,
   * while the dynamic build needs both: the robber stands on the chip top and
   * the flip turns a chip about its middle.
   */
  const chipTopRef = React.useRef<number | null>(null);
  const chipHalfRef = React.useRef(0);
  /**
   * The seat numerals on screen. Separate from `live` because they are
   * Sprites, which share three's unit quad and must not go through
   * `disposeInstances`.
   */
  const liveNumerals = React.useRef<THREE.Sprite[]>([]);

  /**
   * The highest point of anything drawn, in world units, which fences the
   * camera. Re-measured whenever the contents change.
   */
  const ceiling = React.useRef(0);

  /** Put the camera back where the board was first framed. */
  const resetView = React.useRef<() => void>(() => {});

  /**
   * Start or stop the showcase turn. See `Board3DControls.setAutoOrbit`. A ref
   * because the real closure belongs to the rig.
   */
  const autoOrbit = React.useRef<(on: boolean) => void>(() => {});

  /**
   * Whether the host has asked for the turn, remembered across rig builds: the
   * request can arrive before the rig exists (a finished game opened while art
   * loads). The rig reads it when built.
   */
  const wantAutoOrbit = React.useRef(false);

  /**
   * The marker objects on screen, owned by the marker effect. `Object3D`
   * because the pedestal style's motes are a single `THREE.Points` cloud.
   */
  const markers = React.useRef<THREE.Object3D[]>([]);

  /**
   * Marker fields that are no longer current and are fading out. Each disposes
   * itself when done; the rig keeps the list so its teardown can free any still
   * fading.
   */
  const fadingMarkers = React.useRef<FadingMarkers[]>([]);

  /**
   * The translucent gold preview of each piece a click could place.
   *
   * A ref because the art loads in the content effect while the pointer
   * handlers were attached with the renderer. Built once per rig and disposed
   * with it. Empty until the art arrives, when `showHover` falls back to the
   * disc.
   */
  const ghosts = React.useRef<Map<GhostKind, Ghost>>(new Map());

  /**
   * Hold the hover preview on one spot, by pick key, or release it with null,
   * for the host's open action menu. A ref so `heldLoc` changes do not
   * re-attach the pointer handlers (see `armRobber`).
   */
  const holdHover = React.useRef<(key: string | null) => void>(() => {});

  /**
   * Re-run the hover against the pointer's current position, for a board whose
   * offer changed while the hand held still. Set by the rig; see `refreshHover`
   * inside it.
   */
  const refreshHover = React.useRef<(force?: boolean) => void>(() => {});

  /**
   * Every piece key on the board as of the last commit; null before the first,
   * so a game's opening state does not rain pieces.
   */
  const placed = React.useRef<ReadonlySet<string> | null>(null);

  /**
   * Drops in flight, keyed by piece, valued by tick-clock start time. Survives
   * the content effect's rebuilds so an unrelated update does not restart a
   * fall.
   */
  const falling = React.useRef<ReadonlyMap<string, number>>(new Map());

  /**
   * The knights standing to attention as of the last commit, and the hops in
   * flight. Activation is a state change on an existing knight, so it needs its
   * own before-and-after set. Null before the first commit, so a board opened
   * with active knights does not hop them.
   */
  const readied = React.useRef<ReadonlySet<string> | null>(null);
  const hopping = React.useRef<ReadonlyMap<string, number>>(new Map());

  /**
   * The swords being raised. Separate from `hopping` because the raise outlasts
   * the hop and moves the sword, not the knight.
   */
  const raising = React.useRef<ReadonlyMap<string, number>>(new Map());

  /**
   * The swords being lowered, and the latch that allows it.
   *
   * Knights deactivate routinely and the board stays quiet about that (see
   * `swordLowerPose`). A barbarian landfall is the exception, and the client is
   * told about it rather than seeing it in the diff: `standDownKnights` sets
   * this latch, and only the next commit runs `newlyStoodDown`.
   */
  const standDown = React.useRef(false);
  const lowering = React.useRef<ReadonlyMap<string, number>>(new Map());

  /**
   * Per sword: where it turns, and which way a hover moves it.
   *
   * A ref because the build (which knows level and `active`) and the hover
   * swell in the canvas effect both need it. Replaced on every build.
   */
  const swordArt = React.useRef<ReadonlyMap<string, SwordArt>>(new Map());

  /**
   * Each knight's level as of the last commit, and the growths in flight.
   * `planKnights` keeps level out of the key so a promotion swaps the model in
   * place, so promotions are found by comparing levels. Null before the first
   * commit, so a board opened with mighty knights does not grow them.
   */
  const levels = React.useRef<ReadonlyMap<string, number> | null>(null);
  const growing = React.useRef<ReadonlyMap<string, number>>(new Map());

  /**
   * What the robber is doing, on the shared clock. Carried across rebuilds by
   * `stillMoving`. See lib/board3d/robberMotion.
   */
  const robberAnim = React.useRef<RobberAnim>(ROBBER_STILL);

  /**
   * Where the robber stood as of the last commit; null before the first, so a
   * spectator does not watch it fly in.
   *
   * The seated world position read back off the build, not the hex: on a chip
   * the robber sits higher and offset, so a trip planned from hex centres
   * would pop.
   */
  const robberSeat = React.useRef<Vec3 | null>(null);
  /**
   * The robber's standing volume, measured off the art at build and published
   * at commit. The peek picks against it as well as the footprint: on a tilted
   * camera the piece is drawn above its base, so a ray through its body lands
   * on the ground behind it. Null with no robber, or before the art arrives.
   */
  const robberBody = React.useRef<Body | null>(null);

  /**
   * The merchant's carry and where it stood, as for the robber. Several Knights
   * effects relocate it, so it gets the same travel and redirect handling, but
   * no pulse. A null seat means it has not been seen here, so it appears in
   * place rather than flying in.
   */
  const merchantTrip = React.useRef<Trip | null>(null);
  const merchantSeat = React.useRef<Vec3 | null>(null);

  /**
   * Start the robber's ticker subscription, if the content effect has built
   * one. A ref because the pointer handler was attached once with the renderer
   * while the meshes are rebuilt per view; cleared on teardown so a click never
   * reaches disposed meshes.
   */
  const armRobber = React.useRef<() => void>(() => {});

  /**
   * Write the robber's pose once, without the ticker, for
   * `prefers-reduced-motion` (where `ticker.add` never calls back). Needed only
   * for the hover tip, the one ticker-driven change that does not return to its
   * start. Cleared with `armRobber`.
   */
  const settleRobber = React.useRef<() => void>(() => {});

  /**
   * The hover tip: whether the robber is leaning aside to show its number.
   * Survives rebuilds like `robberAnim`, via `stillMoving`.
   */
  const robberPeek = React.useRef<Peek | null>(null);

  /**
   * The robber is playing dead: a client-only gag that changes nothing. It lies
   * on its side for the session but still blocks and steals, and nothing goes
   * on the wire, so it is per viewer.
   *
   * A ref because only the pose reads it, written straight to the instance
   * matrix; state would rebuild the board.
   */
  const robberDead = React.useRef(false);

  /**
   * Tip the robber over, or stand it back up.
   *
   * Immediate, unlike the info card's dwell: pointing at the robber is a clear
   * request to see the number under it.
   *
   * Idempotent: `planPeek` returns the current leg when the target is
   * unchanged, so repeated pointermoves cost one comparison.
   */
  const firePeek = React.useCallback((on: boolean) => {
    const rig = gl.current;
    if (!rig) return;
    // The fall direction is read from the camera once, here, so the piece does
    // not re-aim mid-motion while the player orbits; `planPeek` adopts it only
    // from upright. Dead stays down: leaving the piece would otherwise stand it
    // up.
    if (robberDead.current) on = true;
    // Cleared on the way out, so a player who never leaves is not blocked for
    // good.
    if (!on) peekBlocked.current = false;
    else if (peekBlocked.current) return;
    const dir = rig.camera.getWorldDirection(new THREE.Vector3());
    const axisY = flipAxisY(dir.x, dir.z);
    // The reveal survives reduced motion, unlike the somersault and chip flip;
    // see `stillPeek`.
    if (rig.ticker.reducedMotion()) {
      // Two states only, so check whether a peek exists.
      if (!!robberPeek.current === on) return;
      const next = stillPeek(on, axisY);
      robberPeek.current = next;
      robberAnim.current = { ...robberAnim.current, peek: next, dead: robberDead.current };
      settleRobber.current();
      return;
    }
    const next = planPeek(robberPeek.current, on, axisY, rig.ticker.now());
    // Toggling dead while tipped changes the angle but not the leg, so set the
    // flag before the early return.
    robberAnim.current = { ...robberAnim.current, dead: robberDead.current };
    if (next === robberPeek.current) {
      armRobber.current();
      return;
    }
    robberPeek.current = next;
    robberAnim.current = { ...robberAnim.current, peek: next };
    armRobber.current();
  }, []);

  /**
   * This viewer moved the robber themselves, and the view has not caught up.
   *
   * Set by the board's own dispatch on click, the only place that knows. The
   * next build that moves the piece consumes it to choose between a landing
   * and a carry (see `startRobber`).
   */
  const iMovedIt = React.useRef(false);

  /**
   * Refuse the hover tip until the pointer has left the robber once, so a
   * piece just placed under the cursor does not immediately tip over. Cleared
   * when the pointer leaves. See `firePeek`.
   */
  const peekBlocked = React.useRef(false);

  /**
   * Make the robber pulse. One entry point for both causes: a click on its
   * hex (seen by the board) and a roll of its number (seen by the game screen,
   * via `Board3DControls`).
   */
  const firePulse = React.useCallback(() => {
    const ticker = gl.current?.ticker;
    if (!ticker) return;
    // Restart from now, so a second click restarts the pulse.
    robberAnim.current = { ...robberAnim.current, pulse: ticker.now() };
    armRobber.current();
  }, []);

  /**
   * Which way the robber's somersault turns, and its pivot height.
   *
   * The axis is read off the camera when the turn starts, as for the chips, so
   * it tips toward the viewer; the pivot is half the piece's drawn height,
   * measured at build time.
   */
  const robberFlipAxis = React.useRef(0);

  /**
   * Turn the robber over, for a seven (which no chip carries). Raised by the
   * game screen through `Board3DControls`.
   */
  const fireRobberFlip = React.useCallback(() => {
    const rig = gl.current;
    if (!rig) return;
    // Under reduced motion the ticker never calls back, so refuse rather than
    // record a turn that never clears.
    if (rig.ticker.reducedMotion()) return;
    const dir = rig.camera.getWorldDirection(new THREE.Vector3());
    robberFlipAxis.current = flipAxisY(dir.x, dir.z);
    robberAnim.current = { ...robberAnim.current, flip: rig.ticker.now() };
    armRobber.current();
  }, []);

  /**
   * The view as of this render, for the imperative handle. The handle must be
   * stable for the component's life, so it reads props through this ref.
   */
  const viewNow = React.useRef(view);
  viewNow.current = view;

  /**
   * The flip a roll started: which chips, when, and about which axis. Survives
   * a rebuild mid-turn, like a falling piece through `stillFalling`.
   */
  const chipFlip = React.useRef<{ keys: string[]; start: number; axisY: number } | null>(null);

  /**
   * Hand the flip to the ticker, on the current build's meshes. A ref like
   * `armRobber`, cleared on teardown.
   */
  const armChipFlip = React.useRef<() => void>(() => {});

  /**
   * Start a flip for the roll the game screen just saw. The axis is read from
   * the camera once, so a chip does not re-aim mid-turn while the player drags.
   */
  const fireChipFlip = React.useCallback((total: number) => {
    const rig = gl.current;
    // No rig (no WebGL, or the board is not up yet), and nothing to turn.
    if (!rig) return;
    // Under reduced motion the ticker never calls back, so refuse rather than
    // record a flip that never clears.
    if (rig.ticker.reducedMotion()) return;
    const board = viewNow.current.board;
    const keys = chipsMatching(board.tiles, board.robber, total, lakeNumbers(viewNow.current));
    if (!keys.length) return;
    const dir = rig.camera.getWorldDirection(new THREE.Vector3());
    chipFlip.current = { keys, start: rig.ticker.now(), axisY: flipAxisY(dir.x, dir.z) };
    armChipFlip.current();
  }, []);

  /**
   * The exchange the Inventor started: which two chips, and when they set off.
   *
   * `start` is null while the swap is pending. The chips to animate are the
   * ones showing the new numbers, which only exist once the static rebuild
   * (awaiting `loadPalette` and `loadAsset`) commits, so the clock starts at
   * that commit. If it never comes (a spectator whose board already had the
   * swapped numbers), nothing is drawn.
   *
   * Once stamped it survives rebuilds like a flip; see `stillSwapping`.
   */
  const chipSwap = React.useRef<{ a: string; b: string; start: number | null } | null>(null);

  /**
   * Record an exchange from the card just played. No camera axis is needed:
   * the oval is fixed in world space (see `swapPose`).
   */
  const fireChipSwap = React.useCallback(
    (a: { q: number; r: number }, b: { q: number; r: number }) => {
      const rig = gl.current;
      // No rig (no WebGL, or the board is not up yet), and nothing to send round.
      if (!rig) return;
      // Under reduced motion the ticker never calls back; the numbers simply
      // change in place.
      if (rig.ticker.reducedMotion()) return;
      chipSwap.current = { a: chipKey(a), b: chipKey(b), start: null };
    },
    [],
  );

  /**
   * The barbarians landed: the next commit may lower the swords it finds down.
   *
   * A latch rather than a command, since the deactivations arrive in a later
   * view; same shape as `fireChipSwap`.
   *
   * Refused under reduced motion: the ticker would never consume it, and a
   * stale latch would animate some later, unrelated deactivation.
   */
  const fireStandDown = React.useCallback(() => {
    const rig = gl.current;
    if (!rig || rig.ticker.reducedMotion()) return;
    standDown.current = true;
  }, []);

  // The handle reads through refs (`resetView.current`, `firePulse`'s
  // `gl.current`), so it is stable for the component's life and picks up rig
  // rebuilds without being re-published.
  React.useImperativeHandle(
    controlsRef,
    () => ({
      resetView: () => resetView.current(),
      setAutoOrbit: (on: boolean) => {
        wantAutoOrbit.current = on;
        autoOrbit.current(on);
      },
      pulseRobber: firePulse,
      flipChips: fireChipFlip,
      flipRobber: fireRobberFlip,
      swapChips: fireChipSwap,
      standDownKnights: fireStandDown,
    }),
    [firePulse, fireChipFlip, fireRobberFlip, fireChipSwap, fireStandDown],
  );

  /**
   * Everything the viewer may point at right now, and where it is. One list
   * feeds both the drawn markers and the click snap (see lib/board3d/targets).
   */
  const targets = React.useMemo(
    () =>
      planPickTargets({
        view,
        mode,
        moveFromEdge,
        moveFromVertex,
        moveFromHex,
        progressCard,
        moveFromShip,
        shipJob,
        ships: !!onShip,
        knights: !!onKnight,
      }),
    [
      view,
      mode,
      moveFromEdge,
      moveFromVertex,
      moveFromHex,
      progressCard,
      moveFromShip,
      shipJob,
      onShip,
      onKnight,
    ],
  );

  /**
   * Everything on the board that can describe itself. Depends on the view
   * alone, since "what is that" is the same for everyone. Gated on whether a
   * host is listening rather than on the callback, whose identity changes
   * every render.
   */
  const wantsInfo = !!onHoverInfo;
  const infoPicks = React.useMemo(() => (wantsInfo ? planInfoPicks(view) : []), [view, wantsInfo]);

  /**
   * The live targets and hit handling, for the pointer handlers. A ref so the
   * listeners, attached once with the renderer, need not be rebuilt when a
   * callback changes.
   */
  const input = React.useRef<{
    targets: readonly PickTarget[];
    dispatch: (t: PickTarget, at: { x: number; y: number }) => void;
    /**
     * What pointing at this spot should do, and to which piece. One answer, so
     * previews that change a piece (a city downgraded, a road lifted by
     * Diplomat) are not overruled by a generic swell. See `hoverEffectFor`.
     *
     * `piece` is the instance key of whatever stands here, or null.
     */
    hover: (t: PickTarget) => { effect: HoverEffect; piece: string | null };
    /**
     * A correction to where a ghost stands, or null for "as built". Only the
     * robber needs one: it climbs onto the hovered tile's number chip.
     */
    ghostSeat: (t: PickTarget, kind: GhostKind) => GhostSeat | null;
    ghostTint: (t: PickTarget) => string;
    /**
     * Spots that are pointable but not choosable, drawn nowhere: the robber's
     * own hex while the mode asks for a land hex. Kept out of `targets` (which
     * get markers and ghosts) so a click can explain why it is missing.
     */
    blocked: readonly PickTarget[];
    /**
     * Everything that can describe itself, and where to send the description.
     * Separate from `targets`, which is empty off-turn, so describing an
     * opponent's city does not make it clickable.
     */
    info: readonly InfoPick[];
    onInfo: (info: PieceInfo | null, at: { x: number; y: number }) => void;
    /**
     * The robber's footing: one entry or none, snapped like the rest (see
     * `Snappable`), so "is the pointer on the robber" is a distance check.
     *
     * Separate from `info`, which exists only when a host listens, because the
     * hover tip should work on any board. The position is the robber's seat
     * (on the chip where there is one), not the hex centre.
     */
    robber: readonly Snappable[];
    /**
     * The piece this board is carrying, or null.
     *
     * A carried preview is the usual ghost, but it travels between candidates
     * with an arc and the sticky pick holds it through gaps. The real piece stays
     * put until the move is committed: solid is where it is, translucent where
     * it would go.
     */
    carried: GhostKind | null;
    /** The host's `onHoverSpot`, in the ref like everything else here. */
    onSpot: (spot: BoardSpot | null) => void;
    /**
     * `slideGhost`, read from here because the pointer handlers were attached
     * once with the renderer and would otherwise see a stale prop.
     */
    slideGhost: boolean;
    /**
     * Explain mode, and the hold that reaches the same answer in one gesture.
     * Read at press time: explain mode is armed from a HUD orb in a different
     * React tree.
     */
    explaining: boolean;
    pressToExplain: boolean;
    onExplained: () => void;
  }>({
    targets: [],
    dispatch: () => {},
    hover: () => ({ effect: { kind: "none" }, piece: null }),
    ghostSeat: () => null,
    ghostTint: () => "",
    blocked: [],
    info: [],
    onInfo: () => {},
    robber: [],
    carried: null,
    onSpot: () => {},
    slideGhost: false,
    explaining: false,
    pressToExplain: false,
    onExplained: () => {},
  });

  React.useEffect(() => {
    // The two readers the ghost hooks share. Both only matter for an inspect
    // target: a build mode already knows its piece, and a hex holds nothing the
    // action model names.
    const inspectActions = (t: PickTarget) => {
      const loc = t.action === "inspect" ? locOf(t) : null;
      return loc ? actionsAt(loc, view) : [];
    };
    /**
     * The piece a preview would stand on, and whose it is. Not limited to
     * inspect: Diplomat's road and Intrigue's knight are progress-card targets,
     * usually someone else's.
     */
    const pieceUnder = (t: PickTarget) => {
      const loc = locOf(t);
      return loc ? pieceAt(loc, view) : null;
    };
    // The robber's own hex, the one hex a robber move may not pick, so a press
    // there can explain itself. (`pirate` targets sea hexes, so it is not
    // included.) Only when the robber is on the board: in Fishermen it can
    // stand off the board, far from every tile.
    const blocker =
      (mode === "robber" || mode === "chaserobber") && robberOnBoard(view.board)
        ? view.board.robber
        : undefined;
    const [bx, , bz] = blocker ? hexToWorld(blocker) : [0, 0, 0];

    input.current = {
      targets,
      blocked: blocker
        ? [
            {
              kind: "hex",
              action: "hex",
              key: hexKey(blocker),
              h: blocker,
              pos: [bx, MARKER_Y.land, bz],
            },
          ]
        : [],
      /**
       * The hover decision for a spot, and the piece it applies to. Inspect
       * targets depend on what the action menu would offer there; build modes
       * already know their piece.
       */
      hover: (t) => {
        const under = pieceUnder(t);
        const loc = locOf(t);
        const effect = hoverEffectFor(
          t,
          mode,
          inspectActions(t),
          // Two facts a mode cannot supply: Knights' round-2 setup places a
          // city through the settlement mode, and a progress mode names only the
          // target's shape, not the card's piece.
          {
            setupCity: setupPlacesCity(view),
            progressCard,
            // Whatever is standing here, whoever owns it: it decides the swell
            // and the ghost of a piece being removed.
            standing: under?.kind ?? null,
          },
        );
        const piece =
          under && loc
            ? pieceKey(
                // Instance keys are tier-agnostic (`planKnights` keeps level out
                // so a promotion is a swap), while ghost kinds carry the tier.
                // Map back to the family to find the instance.
                under.kind.startsWith("knight") ? "knight" : under.kind,
                // The piece's owner, not the current player: Diplomat's road
                // belongs to the player losing it.
                under.owner,
                loc.kind === "vertex" ? vertexKey(loc.v) : edgeKey(loc.e),
              )
            : null;
        return { effect, piece };
      },
      /** The colour a preview is drawn in: its owner's, or the viewer's. */
      ghostTint: (t) => colorOf(pieceUnder(t)?.owner ?? view.viewer),
      // `chipTopRef` is read at call time: the chips may not be built yet.
      ghostSeat: (t, kind) =>
        kind === "robber" && t.kind === "hex"
          ? robberGhostSeat(view.board, t.h, chipTopRef.current, lakeNumbers(view))
          : null,
      dispatch: (t, at) => {
        switch (t.action) {
          case "vertex":
            onVertex?.(t.v, at);
            break;
          case "knight":
            onKnight?.(t.v);
            break;
          case "edge":
            onEdge?.(t.e, at);
            break;
          case "ship":
            onShip?.(t.e);
            break;
          case "hex":
            // This board asked for the move. See `iMovedIt`.
            if (carryOnHover && CARRY_MODES.has(mode)) iMovedIt.current = true;
            onHex?.(t.h, at);
            break;
          case "inspect":
            onInspect?.(
              t.kind === "vertex" ? { kind: "vertex", v: t.v } : { kind: "edge", e: t.e },
              at,
            );
            break;
        }
      },
      info: infoPicks,
      onInfo: (i, at) => onHoverInfo?.(i, at),
      // `planRobber`, not `hexToWorld`, so this is exactly where the build
      // seats the piece, chip offset included.
      robber: planRobber(view.board).map((p) => ({ kind: "hex", pos: p.position }) as const),
      // Only in the modes that move this piece; elsewhere the robber is
      // scenery.
      carried: carryOnHover && CARRY_MODES.has(mode) ? "robber" : null,
      onSpot: (s) => onHoverSpot?.(s),
      slideGhost,
      explaining: !!explaining,
      pressToExplain: !!pressToExplain,
      onExplained: () => onExplained?.(),
    };
  }, [
    targets,
    mode,
    view,
    carryOnHover,
    // The card decides which piece a progress-mode spot previews.
    progressCard,
    onVertex,
    onEdge,
    onHex,
    onKnight,
    onShip,
    onInspect,
    infoPicks,
    onHoverInfo,
    onHoverSpot,
    slideGhost,
    explaining,
    pressToExplain,
    onExplained,
    locOf,
    // Ghosts are tinted by owner, so a re-seat rebuilds them (as in the rig
    // effect).
    colorOf,
  ]);

  /**
   * The board's shape: where the hexes are, which is all the rig reads
   * (extent, fit, camera leash). `view.board.tiles` is a new array per message,
   * so the rig cannot depend on it directly.
   *
   * Terrain and numbers are excluded: an Explorers reveal changes terrain and
   * the Inventor changes numbers, and this key's effect disposes the renderer
   * and resets the camera. Those changes belong to `staticBoardKey`.
   */
  const boardKey = React.useMemo(() => boardShapeKey(view.board), [view.board]);

  /**
   * Everything the board's static half is built from, beyond `boardKey`'s
   * shape: the terrain (an Explorers reveal changes it), the harbours, and the
   * tiles' numbers (the Knights Inventor swaps two). `planChips` batches chips
   * by number, so a swap missing from this key would leave stale numbers until
   * some later rebuild.
   */
  // Which chips are hidden: a Raiders hex that is conquered (or won back) turns
  // its chip over mid-game.
  const chipsHiddenKey = hiddenChipsKey(view);
  // The lakes' numbers are drawn with the chips, so they belong in the static
  // key too. Fixed for a game.
  const lakesKey = lakeNumbers(view)
    .map((l) => `${hexKey(l.hex)}:${l.numbers.join(".")}`)
    .join(";");
  const staticBoardKey = React.useMemo(
    () =>
      `${boardKey}~${view.board.tiles.map((t) => t.res).join(",")}` +
      `@${view.board.tiles.map((t) => t.num ?? 0).join(",")}` +
      `#${JSON.stringify(view.board.harbors ?? [])}` +
      `!${chipsHiddenKey}` +
      `~${lakesKey}`,
    [boardKey, view.board.tiles, view.board.harbors, chipsHiddenKey, lakesKey],
  );

  /**
   * The board's dynamic half: everything that moves during play.
   *
   * `view` is a new object on every server message, and depending on it
   * rebuilt the whole board about once a second for nothing. Most messages
   * (chat, timers, dice, the log) draw nothing on the board, so this lists the
   * slices the piece passes read, in order: `planPieces`, `planRobber`,
   * `planShips`/`planPirate` (islandsExt), the Knights passes (knightsExt) and the
   * Raiders passes (raidersExt, whose riders and raiders can move on others'
   * turns). A slice omitted here is a piece that stops updating.
   *
   * Tile numbers (which the robber pass reads) are covered by `staticBoardKey`,
   * which gates the same effect.
   */
  // Module pieces (bridges, camels, wagons, barbarians, cargo ships, quays,
  // weirs) are included via their plans: see lib/board3d/piecesKey.
  const piecesKey = React.useMemo(() => dynamicPiecesKey(view), [view]);

  /**
   * Who is wearing which set, as a string. Fixed for a game load, but the
   * first view can arrive before any building exists, and `piecesKey` would
   * not change when only the art does.
   */
  const seatPiecesKey = React.useMemo(
    () => JSON.stringify(view.seat_pieces ?? {}),
    [view.seat_pieces],
  );

  /**
   * Which robber skin the table sees, as a string.
   *
   * The robber wears the skin of whoever last moved it, so it changes on a
   * seven. The client folds `robber_moved` locally (lib/foldEvent), moving the
   * piece but not changing the skin, so when the authoritative frame brings the
   * new skin `piecesKey` has already settled and would not trigger a rebuild.
   */
  const robberSkinKey = view.robber_skin ?? "";

  // Derived from the board rather than the view, so it is stable across
  // updates and both effects can share it.
  const extent = React.useMemo(
    () => boardExtent(view.board.tiles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardKey],
  );

  /**
   * The tiles, pinned to the same key. The fireflies are placed over the land
   * (see `atmosphere.ts`), so the scene effect needs the tile list, and reading
   * it through `view` would rebuild the rig on every update.
   *
   * Keyed on shape, so a hex revealed mid-game by Explorers gets no motes until
   * the next rig build, which is an acceptable trade for not resetting the
   * camera.
   */
  const boardTiles = React.useMemo(
    () => view.board.tiles,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardKey],
  );

  /**
   * The board's corners at board level, which the opening view is fitted
   * against (see `opening` below).
   */
  // Plus the Fishermen ground chips on sea hexes the tile list does not carry
  // (see `groundFitPoints`), keyed by count since they live in module state.
  const groundFit = groundFitPoints(view);
  const groundFitKey = groundFit.length;
  // An Explorers board is framed by its rim's centres, not corners: the rim
  // is a ring of sea nothing is revealed on. See `explorersFrame`.
  const fitBase = React.useMemo(() => {
    const frame = explorersFrame(view);
    return boardFitPoints(frame.play).concat(
      frame.rim.map(([x, , z]) => new THREE.Vector3(x, 0, z)),
      groundFit.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey, groundFitKey]);
  /**
   * The same, for a flat (phone-sized) view: the land and its docks, not the
   * open sea the map is framed with. See `flatFitPoints`. An Explorers board
   * keeps `fitBase`, whose frame is already its own (`explorersFrame`).
   */
  const fitFlat = React.useMemo(() => {
    if (explorersFrame(view).rim.length > 0) return fitBase;
    const ports = planPorts(view.board.harbors ?? [], view.board.tiles);
    return flatFitPoints(view.board.tiles, ports).concat(
      groundFit.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitBase]);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        // Measured "default" on the live context, which on a dual-GPU laptop
        // can hand the board the integrated chip.
        powerPreference: "high-performance",
      });
    } catch {
      return; // No WebGL (jsdom, or a client that cannot render a board).
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Shadows give the props contact with the tiles. Recomputed only when a
    // caster moves (see configureShadows / invalidateShadows).
    configureShadows(renderer.shadowMap);
    // PCF: three rewrites the deprecated PCFSoftShadowMap to PCFShadowMap
    // anyway, with a warning.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // Neutral, not ACES: ACES desaturates the flat authored colours.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    // The canvas fills its host in CSS, not in pixels (see `resize`); otherwise
    // it lays out at its buffer size, wrong by the page zoom.
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    // Clip the canvas on its own box: a composited WebGL canvas is clipped by
    // an ancestor's rectangle but not reliably by its border radius.
    // `inherit` all the way down, so whoever mounts the board owns the radius.
    renderer.domElement.style.borderRadius = "inherit";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    /**
     * Day or night, and what follows from it (see `boardTheme.ts`). Re-read on
     * every change, since WebGL cannot use CSS variables.
     */
    // Two axes, one look: the site's light/dark and the viewer's chosen style.
    // `currentBoardLook` (boardStyle.ts) is where they combine.
    let look = currentBoardLook();
    let lights = makeLights(extent, look, renderer.capabilities.maxTextureSize);
    scene.add(lights.board, lights.tinted);
    // The style's glow on self-lit materials, set before the first asset loads
    // so nothing pops on the first look change.
    setEmissiveBoost(look.emissive);

    /**
     * Paint the board's backdrop with the page colour put through the same
     * grade as the water (see `gradedPageHex`), so the fogged far sea meets it
     * seamlessly. On the board's own element, not the site's `--background`
     * token, because the style is the board's alone.
     */
    const paintBackdrop = () => {
      host.style.backgroundColor = gradedPageHex(look);
    };
    paintBackdrop();

    // The horizon: the ocean geometry is finite, so fog fades the far water
    // into the page colour behind the transparent canvas. The two must match
    // or the seam just moves (see boardTheme.ts).
    scene.fog = new THREE.Fog(new THREE.Color(look.pageHex), 1, 2);

    const rect = host.getBoundingClientRect();
    const aspect = rect.height > 0 ? rect.width / rect.height : 1;
    /**
     * Whether the board is small enough to be a map rather than a scene. Owned
     * by `resize`; seeded here so the first camera opens in the right mode.
     */
    let flat = flatView(rect.width, rect.height);

    /**
     * The insets everything frames against: the HUD's measured chrome plus the
     * flat view's own (see `flatFrameInsets`). One reader, so the sizing
     * (`usableFrame`) and centring (`applyHudInset`) always agree.
     */
    const frameInsets = (): HudInsets => ({
      left: insetLeft.current,
      right: insetRight.current,
      bottom: insetBottom.current,
      top: insetTop.current,
    });

    /**
     * The rectangle the board must fit inside: the HUD bands removed by
     * `usableFrame`, then the flat view's margin by `fitBounds`. The margin must
     * not reach `applyHudInset`, where a symmetric inset cancels itself out.
     * See `fitBounds`.
     */
    const frameFit = () => fitBounds(usableFrame(frameInsets()), flat);
    /**
     * The canvas's height in CSS px, kept current by `resize`. The smoothing
     * uses it to judge camera rest in pixels (see `cameraAtRest`).
     */
    let viewPx = rect.height;
    const camera = makeCamera(aspect, extent, flat);
    // `oceanPass` owns the camera's layers from here, setting them per pass.
    // Picking does not use them: `pickAt` raycasts against explicit target
    // lists.

    let alive = true;
    let orbit: OrbitControls | undefined;
    /**
     * Put the camera where its inputs say, immediately, with no leftover
     * momentum. Resizes, the reset button and flat/3D changes use this rather
     * than `orbit.update()`, which with damping applies only a fraction and
     * lets an old drag carry on. Replaced when there are controls.
     */
    let settleCamera = () => {
      orbit?.update();
    };
    /** Undo the wheel handover. Replaced when there is a wheel to hand over. */
    let releaseWheel = () => {};
    /**
     * Start or stop the showcase turn. Boards without controls (previews,
     * thumbnails) never turn.
     */
    let setShowcase = (_on: boolean) => {};
    /** Whether it is turning right now. False whenever there are no controls. */
    let showcasing = () => false;
    /**
     * Forget the zoom the viewer applied during a turn, so the next turn starts
     * from its own fit. Not called when a turn restarts for a reframe.
     */
    let clearShowcaseZoom = () => {};
    /** See the rig's `cameraSettling`. False whenever there are no controls. */
    let cameraSettling = () => false;

    /**
     * Aim the fog at the island and let the water end wherever it likes.
     *
     * THREE.Fog measures from the camera, so a fixed near/far cannot work
     * across the zoom range; both ends are recomputed each frame from the live
     * standoff. `far` is a fixed depth of air past the island (see `oceanFog`),
     * and the ocean only has to outlast it.
     */
    const aimFog = () => {
      const target = orbit ? orbit.target : frameTarget(extent);
      const standoff = camera.position.distanceTo(target);
      // A camera framed against a small band can stand beyond the far plane
      // `applyViewport` set (see `farPlaneFor`). Updated only when it must move.
      const far = farPlaneFor(camera.far, extent, standoff);
      if (far !== camera.far) {
        camera.far = far;
        camera.updateProjectionMatrix();
      }
      const fog = scene.fog as THREE.Fog | null;
      if (!fog) return;
      const range = oceanFog(extent, standoff);
      fog.near = range.near;
      fog.far = range.far;
    };

    /**
     * The board, cached, so the swell can move without redrawing it. Owns
     * `camera.layers` and the render target; every full frame rewrites the
     * cache, so it cannot go stale.
     */
    const oceanPass = createOceanPass(renderer, scene, camera, look);

    /**
     * Fireflies over the island, for the post-processed night look. On
     * OVERLAY_LAYER, so they draw in the live pass rather than the cached board
     * (see `atmosphere.ts`). Empty in the other looks. Takes the tiles because
     * they are placed hex by hex over the land.
     */
    const atmosphere = createAtmosphere(look, boardTiles);
    scene.add(atmosphere.group);

    /**
     * The camera's pose in the console, in dev builds only, for choosing the
     * framing constants in scene.ts (`CAMERA_TILT_DEG`, the opening pose, the
     * flat view's margin and shift). Printed in those constants' own terms (see
     * `cameraReadout`).
     *
     * Logged on change, quantised to 0.1 degree and 0.01 world units, so an
     * idle board prints nothing.
     */
    let lastPose = "";
    const logCamera = () => {
      const r = cameraReadout(camera, orbit ? orbit.target : frameTarget(extent));
      const key = [
        r.elevationDeg.toFixed(1),
        r.azimuthDeg.toFixed(1),
        r.distance.toFixed(2),
        r.position.x.toFixed(2),
        r.position.y.toFixed(2),
        r.position.z.toFixed(2),
        r.target.x.toFixed(2),
        r.target.z.toFixed(2),
        r.fovDeg.toFixed(1),
        r.aspect.toFixed(3),
        flat,
      ].join("|");
      if (key === lastPose) return;
      lastPose = key;
      // One line with a fixed field order so poses line up in the console; the
      // raw object goes on the end.
      console.log(
        `board camera  tilt ${r.elevationDeg.toFixed(1)}deg  bearing ${r.azimuthDeg.toFixed(1)}deg` +
          `  dist ${r.distance.toFixed(2)}` +
          `  pos ${r.position.x.toFixed(2)},${r.position.y.toFixed(2)},${r.position.z.toFixed(2)}` +
          `  target ${r.target.x.toFixed(2)},${r.target.y.toFixed(2)},${r.target.z.toFixed(2)}` +
          `  fov ${r.fovDeg.toFixed(1)}deg  aspect ${r.aspect.toFixed(3)}` +
          `  ${flat ? "flat" : "3d"}`,
        r,
      );
    };

    /**
     * Re-ask the hover after the camera moved under a still pointer (a wheel
     * zoom, the glide after an orbit, a reframe). Set by the pointer handlers.
     */
    let afterCameraMove = () => {};
    const seenView = new THREE.Matrix4();
    const seenProjection = new THREE.Matrix4();
    /** The camera moved since the hover last looked. */
    let cameraMoved = false;
    const draw = (full = true) => {
      if (!alive) return;
      if (import.meta.env.DEV) logCamera();
      // Checked once per frame, not per 'change': the wheel's dolly and the
      // damping move the camera in the ticker, where no event fires.
      camera.updateMatrixWorld();
      if (!seenView.equals(camera.matrixWorld) || !seenProjection.equals(camera.projectionMatrix)) {
        seenView.copy(camera.matrixWorld);
        seenProjection.copy(camera.projectionMatrix);
        cameraMoved = true;
      }
      // Asked once the camera is at rest, not per frame of the glide: spots
      // sweeping under a still pointer would strobe the preview and cursor.
      // Meanwhile the preview stays on its spot, moving with the board, and a
      // click still re-picks where the pointer is. `release` draws once more
      // so the rest is seen.
      if (cameraMoved && !cameraSettling()) {
        cameraMoved = false;
        afterCameraMove();
      }
      aimFog();
      // `full` false means only the swell moved, so the board is replayed from
      // the cached pass (see `oceanPass.ts`). `aimFog` still runs: the water
      // reads its uniforms.
      oceanPass.render(full);
      // After the render: this frame pays for shader compilation, geometry
      // upload and the first shadow pass.
      if (readyPending.current && !readyFired.current) {
        readyPending.current = false;
        readyFired.current = true;
        onReadyCb.current?.();
      }
    };

    const ticker = createTicker({ draw });
    /**
     * Ask for a frame instead of rendering one. The only way anything outside
     * the ticker should get a picture, since pointermove, OrbitControls'
     * 'change' and resize all fire faster than the display.
     */
    const requestDraw = () => ticker.invalidate();

    /**
     * Follow the site's theme or the viewer's style into the scene. Everything
     * that must change together, so the board is never half-themed:
     *
     *   FOG      must match the page colour exactly (see `oceanRadius`).
     *   LIGHTS   rebuilt, since `makeLights` owns layers and shadow framing.
     *   WATER    so a night sea is lit and coloured for night.
     *   PASS     the grade and bloom (see `oceanPass.ts`).
     *   GLOW     the emissive boost on every self-lit material.
     *   WEATHER  mist and motes, rebuilt only if this look's differ.
     *
     * The fog's reach is set per frame by `aimFog`.
     */
    const applyLook = (next: typeof look) => {
      look = next;
      const fog = scene.fog as THREE.Fog | null;
      if (fog) fog.color.set(look.pageHex);
      scene.remove(lights.board, lights.tinted);
      lights = makeLights(extent, look, renderer.capabilities.maxTextureSize);
      scene.add(lights.board, lights.tinted);
      applyOceanLook(scene, look);
      oceanPass.setLook(look);
      setEmissiveBoost(look.emissive);
      atmosphere.setLook(look);
      paintBackdrop();
      // A style switch changes the whole picture, so the cached board is
      // stale.
      oceanPass.invalidate();
      // The key light may have started or stopped casting, and shadows are
      // only recomputed on request (see `configureShadows`).
      invalidateShadows(renderer);
      requestDraw();
    };
    const stopThemeWatch = onBoardModeChange(() => applyLook(currentBoardLook()));
    const stopPostFxWatch = onBoardPostFxChange(() => applyLook(currentBoardLook()));
    // Pause when off screen. Guarded because jsdom has no
    // IntersectionObserver, and a board that cannot observe itself should
    // animate rather than freeze.
    const seen =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            ticker.setVisible(entries.some((e) => e.isIntersecting));
          })
        : null;
    seen?.observe(host);

    /**
     * The ocean's clock, as an ordinary ticker subscriber, so water and other
     * motion share one `renderer.render()` per frame.
     *
     * `elapsedMs` rather than the rAF stamp, which keeps advancing while the
     * loop is stopped and would jump the swell after a backgrounded tab.
     *
     * Throttled, counted in frames (see TickOptions). Under reduced motion it
     * never runs, and the shader's t = 0 is a still swell.
     */
    ticker.add(
      ({ elapsedMs }) => {
        const seconds = elapsedMs / 1000;
        setOceanTime(seconds);
      },
      {
        minIntervalMs: OCEAN_FRAME_MS,
        // Moves only the water and mist, so the frame replays the cached board.
        waterOnly: true,
      },
    );

    /**
     * The weather's clock, on the water's terms: `waterOnly` (mist and motes
     * are on OVERLAY_LAYER) and throttled to the swell's rate.
     *
     * Not subscribed for a style with no weather, since an empty callback would
     * keep the loop running. Under reduced motion the mist is built and stays
     * still.
     */
    if (atmosphere.animated()) {
      ticker.add(({ elapsedMs }) => atmosphere.update(elapsedMs), {
        minIntervalMs: OCEAN_FRAME_MS,
        waterOnly: true,
      });
    }

    /**
     * How far back the camera may stand: the zoom-out limit.
     *
     * In 3D, against the bounding cylinder rather than the corners, because it
     * must hold at every bearing (see `framingDistanceFor`). Reads the live
     * camera, so call it after `applyViewport`.
     *
     * A flat view is never turned, so it uses `opening()`, the exact fit at
     * one bearing. The circle's height-derived bound is wrong on a narrow
     * portrait phone, where width binds.
     */
    const standoff = () =>
      flat ? opening(pose()) : framingDistanceFor(camera, extent, ceiling.current, frameFit());

    /**
     * Where the camera aims: the board's centre, except on a flat view, which
     * aims at the middle of what it frames (see `fitFlat`), so uneven docks do
     * not leave the board off-centre.
     */
    const flatAim = (() => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const q of fitFlat) {
        minX = Math.min(minX, q.x);
        maxX = Math.max(maxX, q.x);
        minZ = Math.min(minZ, q.z);
        maxZ = Math.max(maxZ, q.z);
      }
      return Number.isFinite(minX)
        ? new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
        : frameTarget(extent);
    })();
    const aim = () => (flat ? flatAim.clone() : frameTarget(extent));

    /** The board's own corners, plus a copy of each at the height of the tallest piece. */
    const fitPoints = () => {
      const h = ceiling.current;
      const base = flat ? fitFlat : fitBase;
      if (!(h > 0)) return base;
      return base.concat(base.map((p) => new THREE.Vector3(p.x, h, p.z)));
    };

    /**
     * How far back the board opens: the exact fit, not the bound.
     *
     * `standoff` owes the bounding circle, which is much wider than a hex
     * island. The opening is at one known bearing, so it fits against the
     * frame the HUD leaves, solving distance and the rail's shift together;
     * solving them separately clipped the ports on narrow windows.
     *
     * Fitted against the live camera, which already has this window's aspect
     * and the HUD's view offset.
     */
    const openingFrame = () => frameFit();
    /** Tilt and bearing this viewport opens at; see scene.openingPose. */
    const pose = () => openingPose(camera.aspect, flat);
    const opening = (p: { tiltDeg: number; azimuthRad: number }) =>
      fitDistance(
        camera,
        aim(),
        orbitDir(p.tiltDeg, p.azimuthRad),
        fitPoints(),
        openingFrame(),
        // A flat view's margin is already out of its bounds (see `fitBounds`).
        flat ? 1 : undefined,
      );

    /**
     * Whether the viewer has put a hand on the camera (a drag, a pinch, a
     * wheel notch) since it was last put at the opening fit.
     */
    let viewerMoved = false;
    /** Put the camera at the opening distance, on this viewport's own pose. */
    const openAt = (target: THREE.Vector3) => {
      viewerMoved = false;
      const p = pose();
      const dist = opening(p);
      const dir = orbitDir(p.tiltDeg, p.azimuthRad).multiplyScalar(dist);
      camera.position.set(target.x + dir.x, target.y + dir.y, target.z + dir.z);
      camera.lookAt(target);
    };

    /**
     * Put the camera back where this viewport says it belongs. Used by the
     * reset button and by a change of view mode, which are the same operation.
     * Without controls this is just the reframe.
     */
    let resetCamera = () => {
      openAt(aim());
      requestDraw();
    };

    /**
     * The zoom-in limit against the board as it stands. Re-taken on every
     * reframe because the ceiling is measured only after the async build
     * commits. Capped at the zoom-out limit, since min above max would jam the
     * control.
     */
    const fenceDolly = () => {
      if (!orbit) return;
      orbit.minDistance = Math.min(minCameraDistance(ceiling.current), orbit.maxDistance);
    };

    /** Set on the first resize, once the host has been measured. */
    let framed = 0;
    const reframe = (keepDistance = false, sidesMoved = false) => {
      const want = standoff();
      if (!(want > 0)) return;
      const target = aim();
      // Nothing to do when the distance has not meaningfully moved. `update`
      // advances OrbitControls' damping by a step, so calling it here as well
      // as in the render loop would speed up the viewer's own motion.
      /**
       * Is the viewer sitting where the framing put them? Asked of the camera
       * rather than `framed`, which the early return re-baselines without
       * moving anything. The fit inputs grow after opening (harbours, piece
       * heights), so a baseline-only check would leave the board framed for its
       * size at mount.
       *
       * Within 2%, since the fences and damping land slightly off.
       */
      const at = camera.position.distanceTo(target);
      /**
       * A side band that lands after the board opened, on an untouched camera,
       * re-opens it at the exact fit.
       *
       * The side columns (seat rail; feed island and bank card) mount a beat
       * apart, and a HUD change normally never moves the camera, which left
       * the right coast under the event log. Top and bottom bands still only
       * recentre at the same zoom, and a viewer who has zoomed or turned keeps
       * their view.
       */
      if (
        keepDistance &&
        sidesMoved &&
        reopenForSideBand({
          viewerMoved,
          showcasing: showcasing(),
          at,
          fit: opening(pose()),
        })
      )
        openAt(target);
      /**
       * Flat only. In 3D the limit (`standoff`, the bounding circle) and the
       * opening (the exact fit at one bearing) differ by design, so "at the
       * framing" has no single meaning there. On a flat view they are the same
       * number (see `standoff`).
       */
      const undollied = flat && (!(framed > 0) || Math.abs(at - framed) <= framed * 0.02);

      if (!reframeNeeded(want, framed)) {
        // At the framing but not this framing: the limit moved by less than the
        // epsilon while the camera was off it, so put it back.
        if (undollied && Math.abs(at - want) > want * 0.02) openAt(target);
        // The fences still follow the ceiling. Writing them moves nothing until
        // OrbitControls' next update.
        if (orbit) {
          orbit.maxDistance = want;
          fenceDolly();
        }
        framed = want;
        return;
      }
      if (undollied || !(framed > 0)) {
        // Never dollied, or a flat view still at its framing: re-open at the
        // exact fit rather than scaling from a baseline.
        openAt(target);
      } else if (framed > 0 && !keepDistance) {
        // A resize keeps the viewer's zoom relative to the limit.
        const offset = camera.position.clone().sub(target);
        camera.position.copy(target).addScaledVector(offset, want / framed);
      } else if (framed > 0) {
        // A HUD change is not a window change: the bands move for reasons
        // unrelated to the viewer, so the zoom is left alone and only the
        // baseline is updated. `applyViewport` has already recentred the
        // frustum.
      }
      framed = want;
      if (orbit) {
        orbit.maxDistance = want;
        // After `maxDistance`, which it is capped against, and before the
        // update that applies both.
        fenceDolly();
        // `update`, not `settleCamera`. Settling runs one undamped step that
        // applies all pending rotation, pan and wheel at once, which is right
        // for a reset but not here: `refit` runs whenever the ceiling moves
        // (e.g. a piece is placed), and settling would stop a gliding camera
        // dead. OrbitControls re-derives its coordinates from the live camera
        // each update, so the position written above is picked up.
        orbit.update();
      }
    };

    if (controls) {
      orbit = new OrbitControls(camera, renderer.domElement);
      // The same aim makeCamera used, so the view does not snap on first move.
      orbit.target.copy(aim());
      // Pan along the board, not the screen: screen-space panning lifts the
      // pivot off the ground plane, and later orbits swing around a point in
      // the air.
      orbit.screenSpacePanning = false;
      // Half three's default turn per pixel. See `CAMERA_ROTATE_SPEED`.
      orbit.rotateSpeed = CAMERA_ROTATE_SPEED;
      // Two floors under the tilt, reconciled by `maxPolarAngle` (the stricter
      // wins): one keeps the camera above the tallest piece, which depends on
      // distance and so is recomputed on every change; the other is the flat
      // elevation floor (MIN_CAMERA_ELEVATION_DEG).
      //
      // There is no zoom-out stop at the framing distance; only the tilt is
      // fenced. `minDistance` keeps the dolly out of the region where the angle
      // fence saturates and the camera would pass through the board, measured
      // against the same ceiling.
      orbit.maxDistance = Infinity;
      const keepAboveBoard = () => {
        if (!orbit) return;
        // Both fences read the live ceiling, which is zero until the board is
        // built; `refit` reframes when it lands.
        fenceDolly();
        const d = camera.position.distanceTo(orbit.target);
        if (d <= 0) return;
        orbit.maxPolarAngle = maxPolarAngle(d, ceiling.current, orbit.target.y);
      };
      keepAboveBoard();
      /**
       * Keep the pivot near the board, so a pan cannot walk the camera off the
       * map (OrbitControls fences only the dolly). Normal panning never reaches
       * the stop (see `PAN_MARGIN`).
       *
       * The leash shortens as the viewer zooms in, as a fraction of the zoom-out
       * limit `framed` (re-seeded on reframe); phones have no reset button. See
       * `clampPanTarget`.
       *
       * The camera takes the same correction as the pivot, so pushing against
       * the stop does not turn into a rotation.
       */
      const keepNearBoard = () => {
        if (!orbit) return;
        const zoomFrac = framed > 0 ? camera.position.distanceTo(orbit.target) / framed : 1;
        const inside = clampPanTarget(orbit.target.x, orbit.target.z, extent, zoomFrac);
        const dx = inside.x - orbit.target.x;
        const dz = inside.z - orbit.target.z;
        if (dx === 0 && dz === 0) return;
        orbit.target.x = inside.x;
        orbit.target.z = inside.z;
        camera.position.x += dx;
        camera.position.z += dz;
      };

      // --- Smoothing ----------------------------------------------------
      //
      // Rotate and pan are damped by OrbitControls' `enableDamping`; the wheel
      // by the accumulator below, since three does not damp the dolly (see
      // scene.ts). The ticker is held only while the camera is still settling,
      // judged by a real threshold (`cameraAtRest`), not exact zero.

      /** Dolly still owed to the camera's distance, as a ratio. 1 is nothing. */
      let owedDolly = 1;
      /**
       * The viewer's zoom during a showcase turn, as a ratio on the fitted
       * distance (1 is the fit). The turn writes `camera.position` every frame,
       * so the zoom is applied here rather than by OrbitControls, with the same
       * debt-and-decay as `owedDolly`.
       */
      let showcaseDolly = 1;
      let showcaseOwed = 1;
      clearShowcaseZoom = () => {
        showcaseDolly = 1;
        showcaseOwed = 1;
      };
      /** True between OrbitControls' 'start' and 'end': a drag or a pinch. */
      let gesturing = false;
      /** Held while the camera is settling; null when it is at rest. */
      let settling: (() => void) | null = null;

      /**
       * Whether to damp, read live. Under reduced motion the ticker never calls
       * back, so the camera simply does not damp: it moves under the hand and
       * stops when the hand stops.
       */
      const damped = () => !ticker.reducedMotion();

      const wasAt = new THREE.Vector3();
      const wasAiming = new THREE.Vector3();

      /**
       * One frame of settling: step the damping, spend a slice of the wheel's
       * debt, and decide whether there is anything left to do.
       */
      const tick = ({ dtMs }: TickInfo) => {
        if (!orbit) return;
        // Re-derived every frame: the constant is per 60Hz frame (see
        // `dampingForFrame`). During a drag OrbitControls also steps from its
        // own pointermove handler, so tracking is slightly tighter; the total
        // travel is the same.
        orbit.dampingFactor = dampingForFrame(CAMERA_DAMPING, dtMs);
        wasAt.copy(camera.position);
        wasAiming.copy(orbit.target);
        const wasFar = camera.position.distanceTo(orbit.target);
        if (owedDolly !== 1) {
          const step = dollyStep(owedDolly, dampingForFrame(ZOOM_DAMPING, dtMs));
          // Multiplies the distance by `step` and updates: this is the frame's
          // update.
          orbit.dollyIn(step);
          const got = wasFar > 0 ? camera.position.distanceTo(orbit.target) / wasFar : step;
          // A fence ate the step, so write off the debt; carrying it would make
          // the zoom stick at the limits.
          owedDolly = Math.abs(got - step) > step * 1e-3 ? 1 : owedDolly / step;
        } else {
          orbit.update();
        }
        const moved = Math.max(
          wasAt.distanceTo(camera.position),
          wasAiming.distanceTo(orbit.target),
        );
        // A gesture in progress holds the loop open even if the pointer did not
        // move this frame.
        if (gesturing) return;
        if (Math.abs(Math.log(owedDolly)) > 1e-4) return;
        owedDolly = 1;
        if (cameraAtRest(moved, camera.position.distanceTo(orbit.target), viewPx)) release();
      };

      const release = () => {
        settling?.();
        settling = null;
        // One more frame, so `draw` sees the camera at rest and re-asks the
        // hover (see `afterCameraMove`).
        requestDraw();
      };
      cameraSettling = () => settling !== null;
      const wake = () => {
        if (settling) return;
        settling = ticker.add(tick);
      };

      /**
       * The real `settleCamera`: land the camera and cancel the momentum.
       * Turning damping off for one update is the only public way, since
       * OrbitControls' undamped branch zeroes its deltas.
       */
      settleCamera = () => {
        if (!orbit) return;
        owedDolly = 1;
        const was = orbit.enableDamping;
        orbit.enableDamping = false;
        orbit.update();
        orbit.enableDamping = was;
        release();
        // A resize can land mid-drag; cancelling momentum must not end the
        // gesture.
        if (gesturing && was) wake();
      };

      // A drag or a pinch. Not the wheel: `onWheel` below takes those first.
      orbit.addEventListener("start", () => {
        gesturing = true;
        viewerMoved = true;
        // A hand on the board cancels the showcase turn and the standing
        // request, so a later rig rebuild does not resume it.
        wantAutoOrbit.current = false;
        setShowcase(false);
        // The zoom from that turn is dropped; a later turn starts from its fit.
        clearShowcaseZoom();
        if (!orbit) return;
        orbit.enableDamping = damped();
        if (orbit.enableDamping) wake();
      });
      orbit.addEventListener("end", () => {
        gesturing = false;
      });

      /**
       * The wheel, handled here instead of by OrbitControls. Taken on the host
       * in the capture phase, so it runs before any canvas listener and
       * stopping propagation hides it from OrbitControls entirely.
       * `preventDefault` stops the page scrolling.
       */
      const onWheel = (ev: WheelEvent) => {
        if (!orbit || !orbit.enabled || !orbit.enableZoom) return;
        ev.preventDefault();
        ev.stopPropagation();
        viewerMoved = true;
        const factor = wheelDollyFactor(ev.deltaY, ev.deltaMode);
        // Zooming does not cancel the showcase turn; it adjusts the turn's own
        // distance, since the turn overwrites the camera position each frame.
        // Under reduced motion `turning` is null (the view is parked), so this
        // falls through to the normal dolly.
        if (turning) {
          showcaseOwed *= factor;
          return;
        }
        if (!damped()) {
          // What OrbitControls would have done with it.
          orbit.dollyIn(factor);
          return;
        }
        // Debts compose, so fast wheel spins still travel the full distance.
        owedDolly *= factor;
        orbit.enableDamping = true;
        wake();
      };
      host.addEventListener("wheel", onWheel, { capture: true, passive: false });
      releaseWheel = () => host.removeEventListener("wheel", onWheel, { capture: true });

      // Mark dirty rather than draw: OrbitControls fires 'change' per pointer
      // event, often several per frame. Skipped while settling, since the
      // ticker is already drawing.
      orbit.addEventListener("change", () => {
        keepNearBoard();
        keepAboveBoard();
        if (!settling) requestDraw();
      });
      orbit.enableDamping = damped();
      orbit.dampingFactor = CAMERA_DAMPING;
      settleCamera();

      /**
       * What the viewer may do with the camera in the current mode. A flat
       * view pans and zooms but never turns, so one-finger drag is rebound to
       * pan in both the touch and mouse maps; two fingers still pinch.
       */
      const applyMode = () => {
        if (!orbit) return;
        orbit.enableRotate = !flat;
        orbit.touches = flat
          ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }
          : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
        orbit.mouseButtons = flat
          ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
          : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      };
      applyMode();

      resetCamera = () => {
        const target = aim();
        // Mode first: `openAt` reads it through `pose()`.
        applyMode();
        openAt(target);
        if (orbit) {
          orbit.target.copy(target);
          keepAboveBoard();
          // Not `update`: the reset must cancel any momentum still in flight.
          settleCamera();
        }
        camera.lookAt(target);
        requestDraw();
      };

      // --- Showcase turn ------------------------------------------------
      //
      // The endgame's slow circle around the finished board. A drag cancels it
      // (the 'start' listener above), and the reset button cancels it first.
      //
      // It moves the camera directly rather than through OrbitControls'
      // `autoRotate`, which needs `update()` every frame and would spend the
      // damping. OrbitControls re-derives its state from the live camera, so
      // the first drag after a turn starts from wherever the board got to.

      /** Held while the board is turning; null when it is not. */
      let turning: (() => void) | null = null;
      showcasing = () => turning !== null;
      setShowcase = (on: boolean) => {
        if (!orbit) return;
        if (!on) {
          turning?.();
          turning = null;
          return;
        }
        if (turning) return;
        // Not in a flat view: it has no rotation gesture to undo a turn. See
        // `applyMode`.
        if (flat) return;
        // Cancel any fling first, so it does not fight the glide.
        settleCamera();
        // Start from where the camera is: the bearing is kept, and tilt and
        // framing ease over `SHOWCASE_SETTLE_MS`.
        const from = camera.position.clone().sub(orbit.target);
        let bearing = Math.atan2(from.x, from.z);
        const fromElev = cameraElevationDeg(camera, orbit.target);
        const fromDist = from.length();
        // The pivot comes home too, so a panned view turns in place rather than
        // swinging past the frame.
        const fromPivot = orbit.target.clone();
        const toPivot = frameTarget(extent);
        // Fitted against the bounding cylinder, so one distance holds at every
        // bearing. Solved at the showcase tilt only, unlike `standoff`.
        const toDist = Math.max(
          fitDistance(
            camera,
            toPivot,
            orbitDir(SHOWCASE_ELEVATION_DEG, bearing),
            boundingCylinderPoints(extent, ceiling.current),
            openingFrame(),
          ) * SHOWCASE_FILL,
          orbit.minDistance,
        );
        /** Put the camera on the bearing, at whatever point of the glide `k` is. */
        const place = (k: number) => {
          if (!orbit) return;
          const elev = fromElev + (SHOWCASE_ELEVATION_DEG - fromElev) * k;
          // `showcaseDolly` is the viewer's zoom on top of the fit, fenced by
          // the controls' limits.
          const dist = Math.min(
            Math.max((fromDist + (toDist - fromDist) * k) * showcaseDolly, orbit.minDistance),
            orbit.maxDistance,
          );
          orbit.target.lerpVectors(fromPivot, toPivot, k);
          camera.position.copy(orbit.target).addScaledVector(orbitDir(elev, bearing), dist);
          camera.lookAt(orbit.target);
          keepAboveBoard();
        };
        if (ticker.reducedMotion()) {
          // Under reduced motion there is no glide or turn; the board is put at
          // the showcase pose and left there.
          place(1);
          requestDraw();
          return;
        }
        let spun = 0;
        turning = ticker.add(({ dtMs }) => {
          spun += dtMs;
          if (orbit && showcaseOwed !== 1) {
            // The same split as the wheel's debt elsewhere.
            const step = dollyStep(showcaseOwed, dampingForFrame(ZOOM_DAMPING, dtMs));
            // Multiplied, not divided: the debt is a ratio on the distance, as
            // in `tick`.
            showcaseDolly *= step;
            showcaseOwed /= step;
            // Written off once the fences have it, so the zoom does not stick.
            // `place` clamps, so compare against the same bounds.
            const base = fromDist + (toDist - fromDist) * showcaseSettle(spun);
            const want = base * showcaseDolly;
            if (want <= orbit.minDistance || want >= orbit.maxDistance) {
              showcaseDolly = Math.min(
                Math.max(showcaseDolly, orbit.minDistance / base),
                orbit.maxDistance / base,
              );
              showcaseOwed = 1;
            }
          }
          // Eased over different spans: tilt and framing arrive first
          // (SHOWCASE_SETTLE_MS) while the turn winds up (SHOWCASE_SPINUP_MS).
          // See `showcaseSpin` for why the bearing is integrated.
          bearing += showcaseSpin(spun, dtMs);
          place(showcaseSettle(spun));
          // No `requestDraw`: the ticker draws once after its subscribers run.
        });
      };
      // Nothing to restore: this effect does not re-run on game state changes,
      // so the camera is never taken away.
    }
    resetView.current = () => {
      // A reset asks for a specific view, which the turn would leave at once.
      wantAutoOrbit.current = false;
      setShowcase(false);
      clearShowcaseZoom();
      resetCamera();
    };
    autoOrbit.current = (on: boolean) => setShowcase(on);
    // A rig built while the ask was already standing picks it up here.
    if (wantAutoOrbit.current) setShowcase(true);

    // --- Input --------------------------------------------------------
    //
    // Attached once with the renderer; the handlers read live targets from a
    // ref (see `input` above), so new state or callbacks cost nothing.
    //
    // One highlight mesh per kind, parked out of sight until the pointer is
    // over something, which keeps hover out of React. It is the pedestal's
    // mark, brighter, without the column and motes (those invite a look, which
    // a spot already under the pointer does not need). Fixed clock and fade
    // values, so it needs no ticker.
    const hoverClock = pedestalClock();
    const hoverFade = pedestalFade(1);
    const hoverMesh = new Map<MarkerKind, THREE.Mesh>();
    for (const kind of ["vertex", "edge", "hex"] as const) {
      const mesh = new THREE.Mesh(
        poolGeometry(kind),
        poolMaterial(kind, hoverClock, hoverFade, PEDESTAL_HOVER_REST),
      );
      mesh.renderOrder = MARKER_RENDER_ORDER + PEDESTAL_RENDER_ORDER.motes + 2;
      mesh.frustumCulled = false;
      mesh.visible = false;
      // The rim is a child, so the mark is whole; it separates gold from pale
      // terrain (see RIM_COLOR).
      const ring = new THREE.Mesh(
        rimGeometry(kind),
        rimMaterial(kind, hoverClock, hoverFade, PEDESTAL_HOVER_REST),
      );
      ring.renderOrder = MARKER_RENDER_ORDER + PEDESTAL_RENDER_ORDER.motes + 1;
      ring.frustumCulled = false;
      mesh.add(ring);
      // Over the water (see OVERLAY_LAYER). Layers do not inherit, so the ring
      // child is set separately.
      mesh.layers.set(OVERLAY_LAYER);
      ring.layers.set(OVERLAY_LAYER);
      scene.add(mesh);
      hoverMesh.set(kind, mesh);
    }

    const canvas = renderer.domElement;
    /** The pointer that pressed on the board, if the press could still be a click. */
    let pressed: { id: number; x: number; y: number } | null = null;
    /**
     * Where the current press started, for any button, or null between
     * presses. `pressed` is empty for the middle and right buttons (the
     * camera's), and hover must stay out of those too.
     */
    let dragFrom: { x: number; y: number } | null = null;
    /** True once the press has travelled far enough to be a drag, not a click. */
    let dragging = false;
    let hovered: PickTarget | null = null;

    /**
     * The hover's pick: sticky to the spot it is on (see `hoverPick.ts`), and
     * also what a mouse click commits, so the preview and the click agree.
     */
    const pickClient = (x: number, y: number): PickTarget | null =>
      // The canvas's own rect: index.css zooms the UI on wide screens, and only
      // a ratio within one element is zoom-invariant.
      hoverPickAt(
        camera,
        canvas.getBoundingClientRect(),
        x,
        y,
        input.current.targets,
        hovered?.key ?? null,
      );

    const pick = (ev: PointerEvent): PickTarget | null => pickClient(ev.clientX, ev.clientY);

    /** The pieces the hovered spot can take, and the cycle running between them. */
    let cycle: GhostKind[] = [];
    let stopCycle = () => {};
    /** Stops the fade running for the previous hover. */
    let stopFade = () => {};
    /** Stops the slide running for the previous hover. See `slideGhost`. */
    let stopSlide = () => {};
    /**
     * Where the preview stood at the end of the last hover, or null. The
     * slide's origin: the first spot of a sweep fades in, and later spots
     * travel from here.
     */
    let slideFrom: Vec3 | null = null;
    /** The slide in flight, kept so the next hover can redirect it. */
    let slideTrip: Trip | null = null;
    /**
     * The instances drawing one keyed piece, across every dynamic mesh. Pieces
     * are split by material, so one knight is several instances that move
     * together.
     */
    type PieceParts = { mesh: THREE.InstancedMesh; index: number }[];
    const partsForKey = (key: string) => {
      const parts: PieceParts = [];
      for (const mesh of liveDynamic.current) {
        const index = animatable(mesh)?.index.get(key);
        if (index !== undefined) parts.push({ mesh, index });
      }
      return parts;
    };

    // ---- The swell -----------------------------------------------------
    //
    // A piece under the pointer grows, and shrinks back when the pointer
    // leaves. Two slots, because the shrink outlives the hover and another
    // piece may be swelling at the same time. Each slot remembers its current
    // scale, so returning mid-shrink resumes rather than snaps.

    /** The sword a swelling knight is holding, and what the build knew about it. */
    type SwordHeld = { parts: PieceParts; art: SwordArt };

    /**
     * The sword in a hovered knight's hand, or null. A separate lookup because
     * the sword takes a different pose from the same ramp and needs the build's
     * facts (see `swordArt`). No entry means a plain swell.
     */
    const swordHeld = (key: string | null): SwordHeld | null => {
      if (!key) return null;
      const art = swordArt.current.get(swordKey(key));
      if (!art) return null;
      const parts = partsForKey(swordKey(key));
      return parts.length ? { parts, art } : null;
    };

    /**
     * Pose one slot at `scale`: the piece scaled about its footing, and its
     * sword scaled with it and turned on guard. The guard angle is derived from
     * the scale written this frame, so blade and fist cannot drift apart (see
     * `swordGuardTilt`). The pivot is the grip at full scale, a negligible
     * offset during a hover.
     */
    const poseSwell = (slot: Swelling, scale: number) => {
      for (const p of slot.parts) poseInstanceAt(p.mesh, p.index, { scale });
      const sword = slot.sword;
      if (sword) {
        const pose: InstancePose = {
          scale,
          // Clamped at zero so the guard is a hover-only gesture; the ramp also
          // runs to 0 when a piece blanks, and an unclamped value would swing
          // the blade the wrong way.
          tilt: sword.art.guard * Math.max(0, (scale - 1) / (BULGE_SCALE - 1)),
          tiltAxisY: SWORD_FLIP_AXIS_Y,
          tiltPivotX: sword.art.pivot.x,
          tiltPivotY: sword.art.pivot.y,
        };
        for (const p of sword.parts) poseInstanceAt(p.mesh, p.index, pose);
        for (const p of sword.parts) p.mesh.instanceMatrix.needsUpdate = true;
      }
      for (const p of slot.parts) p.mesh.instanceMatrix.needsUpdate = true;
    };

    /**
     * A piece mid-ramp: its key, instances, sword (if a knight), current scale
     * and target. `to` is `BULGE_SCALE` when answering the pointer or 0 when
     * making way for a preview; carrying it lets a hover change its mind.
     */
    type Swelling = {
      key: string;
      parts: PieceParts;
      sword: SwordHeld | null;
      at: number;
      to: number;
    };
    /** Growing under the pointer, or held at full size once it has arrived. */
    let swell: Swelling | null = null;
    let stopSwell = () => {};
    /** Letting go, after the pointer left. At most one at a time. */
    let shrink: Swelling | null = null;
    let stopShrink = () => {};

    /**
     * Ramp `slot` from where it is to `to`, and run `done` when it lands. Under
     * reduced motion the end state is written outright. Returns its own stop.
     */
    const rampBulge = (slot: Swelling, to: number, done: () => void) => {
      const from = slot.at;
      slot.to = to;
      const land = () => {
        slot.at = to;
        poseSwell(slot, to);
        done();
      };
      if (from === to || ticker.reducedMotion()) {
        land();
        return () => {};
      }
      // The overshoot belongs to the swell alone. See `bulgeEase`/`shrinkEase`.
      const shape = to > from ? bulgeEase : shrinkEase;
      const start = ticker.now();
      let stop = () => {};
      stop = ticker.add(({ elapsedMs }) => {
        const k = (elapsedMs - start) / BULGE_MS;
        if (k >= 1) {
          stop();
          land();
          return;
        }
        slot.at = from + (to - from) * shape(k);
        poseSwell(slot, slot.at);
      });
      return stop;
    };

    /** Hand the swollen piece over to the shrink slot and let it fall back. */
    const releaseSwell = () => {
      if (!swell) return;
      stopSwell();
      stopSwell = () => {};
      // Only one piece shrinks at a time, so a second lands the first
      // outright, at the size it was heading for anyway.
      if (shrink) {
        stopShrink();
        stopShrink = () => {};
        poseSwell(shrink, 1);
      }
      shrink = swell;
      swell = null;
      shrink.to = 1;
      stopShrink = rampBulge(shrink, 1, () => {
        shrink = null;
        stopShrink = () => {};
      });
    };

    /** Show entry `i` of the cycle and nothing else. */
    const showGhost = (i: number) => {
      for (const [kind, ghost] of ghosts.current) ghost.object.visible = kind === cycle[i];
    };

    const applyHover = (t: PickTarget | null) => {
      if (t?.key === hovered?.key) {
        // Nothing to redo, but the cursor is restated: it is the one part of a
        // hover that something else (a press, a menu) may have touched.
        canvas.style.cursor = t ? "pointer" : "";
        return;
      }

      // There is no linger: the pick is sticky instead (`hoverPick.ts`), so a
      // preview survives a small drift off its spot and is still what a click
      // there commits. A preview the pick has let go of is gone.
      hovered = t;

      stopCycle();
      stopCycle = () => {};
      stopFade();
      stopFade = () => {};
      stopSlide();
      stopSlide = () => {};
      // The one decision; everything below carries it out.
      const { effect, piece } = t ? input.current.hover(t) : { effect: NO_HOVER, piece: null };

      // Only kinds whose art has arrived; early in a page load this falls back
      // to the disc.
      cycle = effect.kind === "ghost" ? effect.pieces.filter((k) => ghosts.current.has(k)) : [];
      // A removal never travels or lingers: its ghost is the piece already
      // there, going, with no destination to slide to.
      const leaving = effect.kind === "ghost" && effect.leaving;
      for (const ghost of ghosts.current.values()) ghost.object.visible = false;

      // Is this a spot the carried piece could go to? Only when the board
      // carries (`carried` non-null) and the piece is what would be previewed.
      const carriedKind = input.current.carried;
      const carrying = !!carriedKind && !!t && t.kind === "hex" && cycle.includes(carriedKind);
      // A slide from a spot no longer previewed would fly in from nowhere, so
      // drop the origin whenever the preview lapses.
      if (!cycle.length) {
        slideFrom = null;
        slideTrip = null;
      }

      // What the piece here does under the pointer: grow to answer for itself,
      // or shrink out of the way of a preview replacing it. A ghost that does
      // not replace it (a wall around a city) leaves it alone, which is why
      // `hides` is on the effect.
      const bulging = effect.kind === "bulge";
      const posedKey =
        bulging || (effect.kind === "ghost" && effect.hides && cycle.length) ? piece : null;
      const posedTo = bulging ? BULGE_SCALE : 0;
      const posedParts = posedKey ? partsForKey(posedKey) : [];

      for (const [kind, mesh] of hoverMesh) {
        // The last resort: only for a spot that shows nothing (a road, see
        // NEVER_BULGES) or before a rebuild's meshes exist (see the forced
        // `refreshHover` where they are published).
        const on = !!t && t.kind === kind && !cycle.length && !posedParts.length;
        mesh.visible = on;
        if (on && t) mesh.position.set(t.pos[0], t.pos[1], t.pos[2]);
      }

      // Let go of the last hover's piece unless this hover wants the same thing
      // of the same piece (a ship and the inspect edge under it resolve to one
      // piece). A swollen piece that must now blank re-ramps from where it is.
      if (swell && (swell.key !== posedKey || swell.to !== posedTo)) releaseSwell();
      // Same piece, maybe different instances after a rebuild, so re-read them
      // and the sword (an activated knight holds the other sword).
      if (swell && posedParts.length) {
        swell.parts = posedParts;
        swell.sword = swordHeld(posedKey);
      }
      if (posedKey && posedParts.length && !swell) {
        // Caught mid-release: resume from the current size.
        let at = 1;
        if (shrink?.key === posedKey) {
          stopShrink();
          stopShrink = () => {};
          at = shrink.at;
          shrink = null;
        }
        swell = { key: posedKey, parts: posedParts, sword: swordHeld(posedKey), at, to: posedTo };
        stopSwell = rampBulge(swell, posedTo, () => {
          stopSwell = () => {};
        });
      }

      // The swell and the ghost are mutually exclusive, decided together in
      // `hoverEffectFor`.
      if (t && cycle.length) {
        // Recolour the one material per kind rather than build a ghost per seat.
        const tint = input.current.ghostTint(t);
        if (tint) for (const kind of cycle) ghosts.current.get(kind)?.material.color.set(tint);
        for (const kind of cycle)
          poseGhost(ghosts.current.get(kind)!, t, input.current.ghostSeat(t, kind));
        // A preview travels between spots rather than reappearing; the first of
        // a sweep fades in (`slideFrom` null). `planTrip` redirects from where
        // the ghost visibly is, so fast sweeps read as one moving object.
        const slideTo = ghostPoint(ghosts.current.get(cycle[0])!);
        // A carried piece always travels, at `CARRY_PACE` with an arc and
        // settle, since it is a whole piece being lifted rather than a
        // footprint (`GHOST_SLIDE`).
        const pace = carrying ? CARRY_PACE : GHOST_SLIDE;
        if (
          (carrying || input.current.slideGhost) &&
          !leaving &&
          slideFrom &&
          !ticker.reducedMotion()
        ) {
          slideTrip = planTrip(pace, slideFrom, slideTo, slideTrip, ticker.now());
          if (slideTrip) {
            const trip = slideTrip;
            const rest = cycle.map((kind) => ({
              ghost: ghosts.current.get(kind)!,
              at: ghostPoint(ghosts.current.get(kind)!),
            }));
            stopSlide = ticker.add(({ elapsedMs }) => {
              const p = tripPose(pace, trip, elapsedMs);
              for (const { ghost, at } of rest)
                ghost.object.position.set(at[0] + p.offsetX, at[1] + p.lift, at[2] + p.offsetZ);
              if (!tripRunning(pace, trip, elapsedMs)) {
                stopSlide();
                stopSlide = () => {};
                slideTrip = null;
              }
              requestDraw();
            });
          }
        } else {
          slideTrip = null;
        }
        // A removal leaves no origin: the next preview is a different piece.
        slideFrom = leaving ? null : slideTo;
        // Index 0 first, so the reduced-motion state (no callbacks) is right.
        // Previews fade in from nothing rather than switching on.
        // A sliding preview is drawn more solidly. See SLIDE_GHOST_OPACITY.
        const full = input.current.slideGhost ? SLIDE_GHOST_OPACITY : GHOST_OPACITY;
        const fadeTo = (k: number) => {
          const opacity = full * k;
          for (const kind of cycle) {
            const g = ghosts.current.get(kind);
            if (g) g.material.opacity = opacity;
          }
        };
        fadeTo(1);
        // A preview already up (sliding or carried) does not fade in again,
        // which would strobe it on every move.
        const continued = !!slideTrip;
        if (!ticker.reducedMotion() && !continued) {
          fadeTo(0);
          const fadeStart = ticker.now();
          stopFade = ticker.add(({ elapsedMs }) => {
            const k = ghostFade(elapsedMs - fadeStart);
            fadeTo(k);
            if (k >= 1) {
              stopFade();
              stopFade = () => {};
            }
          });
        }
        showGhost(0);
        if (cycle.length > 1) {
          // Phase from the pointer's arrival, so each spot shows its first
          // option for a full interval.
          const start = ticker.now();
          stopCycle = ticker.add(({ elapsedMs }) =>
            showGhost(ghostCycleIndex(elapsedMs - start, cycle.length)),
          );
        }
      }

      // After drawing: a host acting on this may rebuild the board, and posing
      // into meshes about to be discarded would be wasted.
      input.current.onSpot(
        t === null
          ? null
          : t.kind === "vertex"
            ? { kind: "vertex", v: t.v }
            : t.kind === "edge"
              ? { kind: "edge", e: t.e }
              : { kind: "hex", h: t.h },
      );

      canvas.style.cursor = t ? "pointer" : "";
      // Same as the orbit handler: pointermove outpaces the display.
      requestDraw();
    };

    /**
     * The spot whose action menu is open, if any (see `heldKey`). While set,
     * the preview stays on that spot, and `showHover` ignores the pointer
     * leaving or crossing other spots.
     */
    let held: string | null = null;

    /** The pointer-driven hover: refused while a menu holds the preview. */
    const showHover = (t: PickTarget | null) => {
      if (held) return;
      applyHover(t);
    };

    /** Where the pointer last was on the canvas, or null once it has left. */
    let pointerOn: { x: number; y: number } | null = null;
    /** That pointer's type, so a camera move re-asks only what it would. */
    let lastPointerType = "";

    /**
     * Re-run the hover at the pointer's position because what is on offer
     * changed under a still hand. After a commit the clicked spot is no longer
     * legal, and without this the preview would linger on the new piece until
     * the pointer moved.
     *
     * Cheap: if the spot is unchanged, `applyHover` returns at its first line.
     */
    refreshHover.current = (force = false) => {
      if (held) return;
      // A drag is not a hover. The board can change under a held button (a bot
      // building while you turn the camera); the release re-asks (see
      // `onPointerUp`).
      if (dragging) return;
      // `applyHover` returns early on an unchanged spot, but a rebuild can give
      // the same spot a different answer, so clear the memory to force a re-run.
      if (force) hovered = null;
      applyHover(pointerOn ? pickClient(pointerOn.x, pointerOn.y) : null);
    };

    holdHover.current = (key) => {
      if (key === held) return;
      held = key;
      if (key) {
        // Usually a no-op (the hover already previewed this spot); it matters
        // for a touch tap or a menu reopened under a still pointer.
        applyHover(input.current.targets.find((t) => t.key === key) ?? null);
      } else {
        // Back to what is under the pointer now, without waiting for a
        // pointermove.
        applyHover(pointerOn ? pickClient(pointerOn.x, pointerOn.y) : null);
      }
      requestDraw();
    };

    // --- The descriptive hover ----------------------------------------
    //
    // A second, independent pass: `showHover` says what a click would do; this
    // says what is already there. Both can be true at once (a city ghost and a
    // card naming the settlement it replaces).
    //
    // Kept out of React except that `onInfo` crosses to a DOM card, and only
    // when the pointer reaches a different thing, never per pointermove.
    /** The last thing described, so an unchanged hover is free. */
    let infoKey: string | null = null;
    let infoTimer: ReturnType<typeof setTimeout> | null = null;
    /** Where the pointer is right now, so a card lands where the hand is. */
    let pointerAt = { x: 0, y: 0 };
    const clearInfoTimer = () => {
      if (infoTimer !== null) clearTimeout(infoTimer);
      infoTimer = null;
    };

    const showInfo = (t: InfoPick | null) => {
      const key = t?.key ?? null;
      if (key === infoKey) return;
      infoKey = key;
      clearInfoTimer();
      // Hide immediately; only arriving at a piece waits.
      input.current.onInfo(null, pointerAt);
      if (!t) return;
      // The dwell, so sweeping across a crowded board does not flash a card per
      // piece.
      infoTimer = setTimeout(() => {
        infoTimer = null;
        input.current.onInfo(t.info, pointerAt);
      }, INFO_DWELL_MS);
    };

    /**
     * The same card, asked for rather than swept into: no dwell and no
     * identity check, since a press is already a question and the player may
     * re-ask about the same piece.
     *
     * Returns whether it found anything; only a hit disarms explain mode.
     */
    const explainUnder = (ev: PointerEvent): boolean => {
      const t = infoUnder(ev);
      pointerAt = { x: ev.clientX, y: ev.clientY };
      clearInfoTimer();
      infoKey = t?.key ?? null;
      input.current.onInfo(t?.info ?? null, pointerAt);
      return !!t;
    };

    // INFO_SNAP_RADIUS, not the placement radii: a hover must land on the
    // piece, while a click may land near its marker. See picking.ts.
    const infoUnder = (ev: PointerEvent): InfoPick | null =>
      pickAt(
        camera,
        canvas.getBoundingClientRect(),
        ev.clientX,
        ev.clientY,
        input.current.info,
        INFO_SNAP_RADIUS,
      );

    // --- The robber's peek --------------------------------------------
    //
    // A third pass, for one piece: the robber hides the number it stands on.
    // Picked against its standing volume (`robberBody`) as well as its
    // footprint, at `INFO_SNAP_RADIUS`, so the pointer must be on the model,
    // not merely crossing the tile. Sticky like the placement hover, and the
    // volume is the upright one, so the piece leaning aside to show its number
    // does not move the target out from under the pointer.
    /** Whether the last robber pick was on it, for the stickiness. */
    let onRobber = false;
    const robberAt = (x: number, y: number): boolean => {
      const body = robberBody.current ?? undefined;
      onRobber = !!hoverPickAt(
        camera,
        canvas.getBoundingClientRect(),
        x,
        y,
        input.current.robber.map((r) => ({ ...r, key: ROBBER_KEY, body })),
        onRobber ? ROBBER_KEY : null,
        { radii: INFO_SNAP_RADIUS, floorPx: 0 },
      );
      return onRobber;
    };
    const robberUnder = (ev: PointerEvent): boolean => robberAt(ev.clientX, ev.clientY);

    /**
     * The tap that stands in for a hover on a touchscreen: a tap on the robber
     * tips it, a second tap restores it, and a timer restores it otherwise.
     */
    let peekTapped = false;
    let peekHold: ReturnType<typeof setTimeout> | null = null;
    const dropPeekHold = () => {
      if (peekHold !== null) clearTimeout(peekHold);
      peekHold = null;
      peekTapped = false;
    };
    /** Raise or lower the tip, cancelling any tap that was holding it. */
    const setPeek = (on: boolean) => {
      dropPeekHold();
      firePeek(on);
    };
    const tapPeek = () => {
      if (peekTapped) {
        setPeek(false);
        return;
      }
      dropPeekHold();
      peekTapped = true;
      firePeek(true);
      peekHold = setTimeout(() => {
        peekHold = null;
        peekTapped = false;
        firePeek(false);
      }, PEEK_TAP_HOLD_MS);
    };

    // --- Press and hold to describe ------------------------------------
    //
    // A shortcut for the explain-mode orb. Touch and pen only: a mouse already
    // has hover, and a slow click on a hex should move the robber.
    //
    // A hold that fired consumes its press, so asking what a spot is never
    // builds on it when the finger lifts.
    /** A hold produced an answer, so the lift that follows is spent. */
    let explainHeld = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    const dropHold = () => {
      if (holdTimer !== null) clearTimeout(holdTimer);
      holdTimer = null;
    };

    const onPointerDown = (ev: PointerEvent) => {
      // Only the primary button places; middle and right are the camera's.
      if (ev.pointerType === "mouse" && ev.button !== 0) {
        pressed = null;
        // Hover must still stay out of a camera pan, which `pressed` does not
        // cover.
        dragFrom = { x: ev.clientX, y: ev.clientY };
        dragging = false;
        return;
      }
      pressed = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
      dragFrom = { x: ev.clientX, y: ev.clientY };
      dragging = false;
      explainHeld = false;
      dropHold();
      if (input.current.pressToExplain && ev.pointerType !== "mouse") {
        // The native event is not pooled, so reading it in the timer is safe.
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (!explainUnder(ev)) return; // nothing there: leave the press alone
          explainHeld = true;
          haptic();
        }, LONG_PRESS_MS);
      }
      // A press begins a click or an orbit; neither wants the card.
      showInfo(null);
      // Nor the robber leaning aside while the camera turns. Mouse only: on
      // touch, the press is the first half of the tap that raises it.
      if (ev.pointerType === "mouse") setPeek(false);
    };

    const onPointerMove = (ev: PointerEvent) => {
      pointerAt = { x: ev.clientX, y: ev.clientY };
      pointerOn = pointerAt;
      lastPointerType = ev.pointerType;
      // A finger that has travelled is panning. Measured from the press origin,
      // so a slow drag cannot creep under the threshold.
      if (holdTimer !== null && pressed) {
        const dx = ev.clientX - pressed.x;
        const dy = ev.clientY - pressed.y;
        if (dx * dx + dy * dy > LONG_PRESS_SLOP_PX * LONG_PRESS_SLOP_PX) dropHold();
      }
      // The same reach a click has, so the preview covers everywhere a click
      // would build. See SNAP_RADIUS.
      //
      // A held button is not a hover: the board moves under a still pointer
      // during an orbit. The preview is frozen during a press and dropped only
      // once the press becomes a drag (the same `isClick` slop the release
      // uses), so a click never loses its preview at the moment of commit.
      if (ev.buttons === 0) {
        showHover(pick(ev));
      } else if (!dragging && dragFrom && !isClick(dragFrom, pointerAt)) {
        dragging = true;
        showHover(null);
      }
      // Not while a button is down (an orbit), and never for touch, where a
      // card on tap would look like the tap had done something.
      if (pressed || ev.pointerType === "touch") {
        showInfo(null);
        return;
      }
      showInfo(infoUnder(ev));
      // No dwell (see `firePeek`); `planPeek` makes repeated calls free.
      setPeek(robberUnder(ev));
    };

    const onPointerUp = (ev: PointerEvent) => {
      const down = pressed;
      pressed = null;
      dropHold();
      // The drag is over, so refresh the hover now rather than waiting for a
      // pointermove that may never come.
      const wasDragging = dragging;
      dragFrom = null;
      dragging = false;
      if (wasDragging) showHover(pick(ev));
      // The hold already answered; the lift is part of that gesture.
      if (explainHeld) {
        explainHeld = false;
        return;
      }
      if (!down || down.id !== ev.pointerId) return;
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      // A drag orbited the camera; it placed nothing.
      if (!isClick(down, { x: ev.clientX, y: ev.clientY })) return;
      // Explain mode takes every press: describing some taps and committing
      // others would be worse than nothing. See BoardProps.explaining.
      if (input.current.explaining) {
        if (explainUnder(ev)) input.current.onExplained();
        return;
      }
      // A mouse commits what the hover shows: the same sticky pick, from the
      // spot the preview is on, so a click never builds somewhere the preview
      // was not. A finger has no hover, so it gets the on-screen fallback
      // instead: see `TOUCH_SNAP_PX`.
      const hit =
        ev.pointerType === "mouse"
          ? pickClient(ev.clientX, ev.clientY)
          : pickTap(
              camera,
              canvas.getBoundingClientRect(),
              ev.clientX,
              ev.clientY,
              input.current.targets,
              true,
            );
      if (hit) {
        input.current.dispatch(hit, { x: ev.clientX, y: ev.clientY });
        // Drop the hover ghost, since the spot just changed. An inspect hit
        // changed nothing and opened a menu about this spot, so its preview
        // stays (the hold arrives a tick later; see `heldKey`).
        if (hit.action !== "inspect") showHover(null);
        return;
      }
      // The touch equivalent of the robber hover, only when the tap did not
      // already do something, and not for a mouse, which has real hover.
      if (ev.pointerType !== "mouse" && robberUnder(ev)) tapPeek();
      // Nothing legal under the pointer, but a click on the robber's own hex
      // gets an answer (a pulse) rather than silence. Only on click: on hover
      // it would fire continuously.
      const blocked = pickAt(
        camera,
        canvas.getBoundingClientRect(),
        ev.clientX,
        ev.clientY,
        input.current.blocked,
      );
      if (blocked) {
        firePulse();
        return;
      }
      // Nothing legal or blocked, and the pointer is on the robber: it plays
      // dead, or gets back up. Order matters: `blocked` is populated only
      // during a robber placement, where that click keeps its pulse.
      //
      // Mouse only: touch taps already raise the peek (see `tapPeek`).
      if (ev.pointerType === "mouse" && robberUnder(ev)) {
        robberDead.current = !robberDead.current;
        firePeek(robberDead.current);
      }
    };

    const onPointerLeave = () => {
      pressed = null;
      pointerOn = null;
      dragFrom = null;
      dragging = false;
      // Also handles `pointercancel` (a scroll or second finger), so a hold
      // never fires on an abandoned gesture.
      dropHold();
      explainHeld = false;
      showHover(null);
      showInfo(null);
      // The pointer left the board; a tap-held tip goes too.
      onRobber = false;
      setPeek(false);
    };

    afterCameraMove = () => {
      // A held button is an orbit or a press, where the hover is frozen; the
      // release re-asks.
      if (!pointerOn || dragFrom) return;
      refreshHover.current();
      // Mouse only, as on pointermove: touch has no hover to keep.
      if (lastPointerType === "mouse") setPeek(robberAt(pointerOn.x, pointerOn.y));
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    // Also on arrival, so a pointer the board did not see arrive (an overlay
    // lifted from under a still hand: the opening lid, a closed dialog) is
    // picked up when the browser re-targets it, without waiting for a move.
    canvas.addEventListener("pointerover", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerLeave);
    canvas.addEventListener("pointerleave", onPointerLeave);

    /**
     * Keep the board framed as the window's shape changes. The camera distance
     * is scaled by how much the framing distance moved, so the viewer's zoom
     * survives a resize.
     */
    /** The box, dpr and dead bands the last resize was computed for. */
    let sized = "";
    /**
     * `keepDistance`: re-solve the frame but leave the camera where it is, for
     * a HUD change rather than a window change.
     */
    const resize = (keepDistance = false, sidesMoved = false) => {
      const r = host.getBoundingClientRect();
      // Nothing to do if nothing moved: resize events vastly outnumber real
      // size changes, and each one re-measures, reallocates and repaints.
      // `flat` is decided before the key and the projection, because it changes
      // the framing too (see `flatFrameInsets`); deciding it after
      // `applyViewport` would mix two modes' insets.
      const wantFlat = flatView(r.width, r.height);
      const crossedFlat = wantFlat !== flat;
      flat = wantFlat;
      const key = `${r.width}x${r.height}@${window.devicePixelRatio}+${insetLeft.current},${insetRight.current},${insetBottom.current},${insetTop.current},${flat}`;
      if (key === sized) return;
      sized = key;
      // The rest test is in CSS px of picture, so use the measured height, not
      // the device-pixel buffer.
      viewPx = r.height;
      // Size the drawing buffer from the measurement and leave the canvas's CSS
      // size at 100% of the host. Never write pixel lengths to the canvas
      // style: under index.css `zoom` (wide screens), getBoundingClientRect is
      // zoomed but style lengths are not, and the canvas would overflow.
      // Capped at 2x: a 3x buffer costs much more for nothing visible.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(r.width, r.height, false);
      // The cached board is a buffer-sized texture, in device pixels.
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      oceanPass.setSize(buffer.x, buffer.y);
      applyViewport(camera, r.width, r.height, frameInsets(), extent);
      // Crossing the flat/3D line resets the camera: a pose from one mode may
      // be unreachable or unleavable in the other. So the reset button owns the
      // mode logic.
      if (crossedFlat) {
        resetCamera();
        // `reframe` scales from the last framing distance, which the reset
        // replaced, so re-seed it.
        framed = standoff();
        if (orbit) {
          orbit.maxDistance = framed;
          fenceDolly();
          settleCamera();
        }
      } else {
        reframe(keepDistance, sidesMoved);
      }
      // A turn in progress writes the camera every frame, so restart it to
      // re-solve for the new frame and glide there.
      if (showcasing()) {
        setShowcase(false);
        setShowcase(true);
      }
      requestDraw();
    };

    /**
     * Re-solve the framing for the current size. The zoom-out limit depends on
     * piece heights (see `ceiling`), measured only after the build.
     *
     * Clearing `sized` bypasses `resize`'s guard, so call this only when the
     * ceiling moved and `resize` otherwise, as `commit` does.
     */
    const refit = () => {
      sized = "";
      resize();
    };
    resize();

    // Wrapped: a listener gets an Event, which `resize` would read as a truthy
    // `keepDistance`.
    const onWindowResize = () => resize();
    window.addEventListener("resize", onWindowResize);
    gl.current = {
      renderer,
      scene,
      camera,
      // The controls, so gains like `rotateSpeed` can be read and set from the
      // console without a rebuild. A getter, since the rig outlives the
      // `if (controls)` branch; undefined means the board has no controls.
      get orbit() {
        return orbit;
      },
      draw,
      requestDraw,
      warm: (objects, cancelled) =>
        warmPrograms(
          renderer,
          scene,
          camera,
          objects,
          oceanPass.passes(),
          () => !alive || cancelled(),
        ),
      ticker,
      resize,
      refit,
      cameraSettling: () => cameraSettling(),
      /**
       * Where the board lands on screen, in CSS pixels. Dev only, for checking
       * framing across viewport sizes. Projects the fit point set (`fitPoints`:
       * tile corners pushed out by the beach, sea tiles included) and the
       * pivot, which answers whether the board is centred between the HUD bands
       * and whether every port clears the chrome.
       */
      frame: () => {
        const rect = canvas.getBoundingClientRect();
        const toScreen = (p: THREE.Vector3) => {
          const v = p.clone().project(camera);
          return {
            x: rect.left + ((v.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - v.y) / 2) * rect.height,
          };
        };
        const pts = fitPoints().map(toScreen);
        const centre = toScreen(orbit ? orbit.target.clone() : frameTarget(extent));
        return {
          centre,
          bounds: {
            minX: Math.min(...pts.map((q) => q.x)),
            maxX: Math.max(...pts.map((q) => q.x)),
            minY: Math.min(...pts.map((q) => q.y)),
            maxY: Math.max(...pts.map((q) => q.y)),
          },
          canvas: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          flat,
          // What the fit was solved against and where the points landed, so a
          // framing problem can be traced to the bounds or the solve.
          wantBounds: frameFit(),
          // The exact solve's distance against the camera's. If they differ,
          // something else placed the camera; if they agree and bounds are
          // violated, the solve is wrong.
          fitDist: opening(pose()),
          dist: camera.position.distanceTo(orbit ? orbit.target : frameTarget(extent)),
          ndc: (() => {
            const v = fitPoints().map((q) => q.clone().project(camera));
            return {
              minX: Math.min(...v.map((q) => q.x)),
              maxX: Math.max(...v.map((q) => q.x)),
              minY: Math.min(...v.map((q) => q.y)),
              maxY: Math.max(...v.map((q) => q.y)),
            };
          })(),
        };
      },
      sampleRadiance: () => oceanPass.sampleRadiance(),
      // Every live pick target projected to CSS pixels, so a driven browser can
      // click a legal spot like a player. Dev only.
      picks: () => {
        const rect = canvas.getBoundingClientRect();
        return input.current.targets.map((t) => {
          const v = new THREE.Vector3(t.pos[0], t.pos[1], t.pos[2]).project(camera);
          return {
            kind: t.kind,
            action: t.action,
            key: t.key,
            x: rect.left + ((v.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - v.y) / 2) * rect.height,
          };
        });
      },
      stats: () => {
        draw();
        const info = renderer.info;
        return {
          programs: info.programs?.length ?? 0,
          calls: info.render.calls,
          triangles: info.render.triangles,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          staticMeshes: liveStatic.current.length,
          dynamicMeshes: liveDynamic.current.length,
          // What the meshes are, since each is a draw call and per-call uniform
          // upload dominates render time (few distinct programs): find groups
          // of many meshes with few instances each.
          byName: liveStatic.current
            .concat(liveDynamic.current)
            .reduce<Record<string, { meshes: number; instances: number }>>((acc, m) => {
              // Grouped by art prefix, so `Chip_08_b`-style variants share a row.
              const key = (m.name || "(unnamed)").replace(/_\d+(_[a-z])?$/i, "_*");
              const e = (acc[key] ??= { meshes: 0, instances: 0 });
              e.meshes += 1;
              e.instances += m.count ?? 0;
              return acc;
            }, {}),
        };
      },
    };
    // The rig, reachable from the console and a driven browser, so profiling
    // can read `renderer.info` directly. Dev only.
    if (import.meta.env.DEV) {
      (window as unknown as { __board3d?: unknown }).__board3d = gl.current;
    }
    // Closed over this camera, not `gl.current`, so a projector used after the
    // rig is rebuilt fails visibly rather than quietly working.
    onProj.current?.((w) => projectToFrame(w, camera));

    return () => {
      alive = false;
      gl.current = null;
      if (import.meta.env.DEV) {
        delete (window as unknown as { __board3d?: unknown }).__board3d;
      }
      onProj.current?.(null);
      // As with `armRobber`: a menu closing after teardown must not reach a
      // disposed scene.
      holdHover.current = () => {};
      stopThemeWatch();
      stopPostFxWatch();
      ticker.dispose();
      oceanPass.dispose();
      atmosphere.dispose();
      seen?.disconnect();
      window.removeEventListener("resize", onWindowResize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerover", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerLeave);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      // A pending dwell would put a card up for a board that is gone.
      clearInfoTimer();
      // Same for a hold.
      dropHold();
      // And a tap-held tip, which would arm a ticker that no longer exists.
      dropPeekHold();
      robberPeek.current = null;
      robberAnim.current = { ...robberAnim.current, peek: null };
      stopCycle();
      stopFade();
      // Both ramps: a running swell would pose instances of a disposed rig.
      stopSwell();
      stopShrink();
      swell = null;
      shrink = null;
      // Prototypes, built once per rig and released with the scene.
      disposeGhosts(ghosts.current);
      for (const mesh of hoverMesh.values()) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      hoverMesh.clear();
      releaseWheel();
      setShowcase(false);
      orbit?.dispose();
      // The instances belong to the content effect, but they go with the
      // renderer.
      disposeInstances(liveStatic.current);
      liveStatic.current = [];
      disposeInstances(liveDynamic.current);
      liveDynamic.current = [];
      // The next build must not reuse the static meshes going away here.
      builtStaticKey.current = null;
      chipTopRef.current = null;
      chipHalfRef.current = 0;
      disposeSeatNumerals(liveNumerals.current);
      liveNumerals.current = [];
      disposeMarkers(markers.current);
      markers.current = [];
      // And anything still fading out.
      for (const f of fadingMarkers.current) {
        f.stop();
        disposeMarkers(f.objects);
      }
      fadingMarkers.current = [];
      renderer.dispose();
      // dispose() leaves the GL context alive. Browsers cap live contexts per
      // page (~16) and kill the oldest, so repeated navigation would blank the
      // board. thumbnail.ts does the same.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [boardKey, controls, extent, boardTiles, fitBase, fitFlat, firePulse, firePeek]);

  // Re-ask the hover whenever the set of spots changes; see `refreshHover`.
  React.useEffect(() => {
    refreshHover.current();
  }, [targets]);

  /**
   * The open menu's spot as a pick key (the same one `planPickTargets` builds
   * for an inspect target), so the hover can be held on it. A string, since
   * the host rebuilds the location object every render.
   */
  const heldKey = heldLoc
    ? heldLoc.kind === "vertex"
      ? `inspect:${vertexKey(heldLoc.v)}`
      : `inspect:${edgeKey(heldLoc.e)}`
    : null;

  React.useEffect(() => {
    holdHover.current(heldKey);
  }, [heldKey]);

  /**
   * The board's contents, rebuilt when the game state changes.
   *
   * Separate from the rig effect, since `view` changes on every message and
   * rebuilding the rig would reset the camera and kill drags. New instances
   * are built into local arrays and swapped in only when complete, so no
   * half-built board is shown.
   */
  React.useEffect(() => {
    const ctx = gl.current;
    if (!ctx) return;
    const { scene, requestDraw, ticker, renderer } = ctx;

    let cancelled = false;
    /** Stops the drops and hops this build armed, if it armed any. */
    let stopPieceMotion = () => {};
    /**
     * The knights standing to attention on the board this build makes. Filled
     * by the Knights pass; empty when there are none.
     */
    let ready = new Set<string>();
    /**
     * Each knight's level on this board, by key: the only record of a
     * promotion, since knight keys exclude level (see `planKnights`).
     */
    let levelOf = new Map<string, number>();
    /**
     * Where each sword on this board turns, and which way a hover moves it. The
     * pivot is the knight's hand as a world offset from its vertex.
     *
     * Recorded here, the only pass that knows level and state, and published to
     * `swordArt` at commit so the canvas effect never reads a half-built board.
     */
    const swordPivots = new Map<string, SwordArt>();
    /**
     * Half the robber's drawn height, measured off the loaded art: the pivot
     * of its somersault. Measured because the piece is drawn at `ROBBER_SCALE`.
     * Zero with no robber.
     */
    let robberHalf = 0;
    /** The robber's standing volume, for `robberBody`. Null with no robber. */
    let builtRobberBody: Body | null = null;
    /** Releases the robber this build handed to the ticker. */
    let stopRobber = () => {};
    /** Releases the merchant, which travels the same way. */
    let stopMerchant = () => {};
    /** Releases the chip flip this build armed, if it armed one. */
    let stopChips = () => {};
    const builtStatic: THREE.InstancedMesh[] = [];
    const builtDynamic: THREE.InstancedMesh[] = [];
    /**
     * Which half `add` is filling. The build is one pass in board order (sea,
     * land, what stands on it), which draw order and the ceiling measurement
     * depend on, so the pass switches arrays at the seam.
     */
    let sink = builtStatic;
    const add = (meshes: THREE.InstancedMesh[], opts?: { tinted?: boolean }) => {
      for (const m of meshes) {
        // Everything casts shadows except the water (see seaCastsShadow).
        const shadows = seaCastsShadow(m);
        m.castShadow = shadows;
        m.receiveShadow = shadows;
        // Tinted pieces take only the flat rig, so they stay near their seat
        // colour; everything else takes only the board rig.
        if (opts?.tinted) m.layers.set(TINTED_LAYER);
        // The water draws in its own pass over a cached board (see
        // `oceanPass.ts`); same predicate as the shadow decision.
        if (!shadows) m.layers.set(OCEAN_LAYER);
        // Meshes never move as objects: pieces move via instance matrices
        // (poseInstanceAt). Disabling matrixAutoUpdate saves recomposing a few
        // hundred matrices per frame. The hover highlight, which does move, is
        // not built here.
        m.matrixAutoUpdate = false;
        m.updateMatrix();
      }
      sink.push(...meshes);
    };
    /** Seat numerals this build made, committed and freed with the pieces. */
    const builtNumerals: THREE.Sprite[] = [];

    const host = hostRef.current;
    const rect = host?.getBoundingClientRect();
    const aspect = rect && rect.height > 0 ? rect.width / rect.height : 1;

    /**
     * Whether the static half must be built. Keyed on the board alone: nothing
     * in this half depends on the viewport (the annulus is sized for every
     * aspect; `scene.test.ts` holds that), and a resize does not re-run this
     * effect.
     */
    const staticKey = staticBoardKey;
    const needStatic = builtStaticKey.current !== staticKey;

    /** Swap the finished board in for the one on screen, in one step. */
    const commit = () => {
      if (cancelled) {
        disposeInstances(builtStatic);
        disposeInstances(builtDynamic);
        disposeSeatNumerals(builtNumerals);
        return;
      }
      // The static half is swapped only when rebuilt; when skipped,
      // `builtStatic` is empty and the meshes on screen must stay.
      if (needStatic) {
        for (const m of liveStatic.current) scene.remove(m);
        disposeInstances(liveStatic.current);
        for (const m of builtStatic) scene.add(m);
        liveStatic.current = builtStatic;
        builtStaticKey.current = staticKey;
      }
      // The dynamic half is rebuilt every time, so it always swaps.
      for (const m of liveDynamic.current) scene.remove(m);
      disposeInstances(liveDynamic.current);
      disposeSeatNumerals(liveNumerals.current);
      for (const m of builtDynamic) scene.add(m);
      for (const s of builtNumerals) {
        s.layers.set(OVERLAY_LAYER);
        scene.add(s);
      }
      liveDynamic.current = builtDynamic;
      robberBody.current = builtRobberBody;
      // Re-ask the hover now, forced: what a hover draws depends on these
      // meshes, and a hover that arrived while the build awaited its assets
      // fell back to the bare disc and would otherwise stay there.
      refreshHover.current(true);
      liveNumerals.current = builtNumerals;
      const box = new THREE.Box3();
      // Numerals are left out of the ceiling: they float above the tallest
      // piece. Measured over both live halves, since `builtStatic` is empty on
      // a dynamic-only build.
      for (const m of liveStatic.current) box.expandByObject(m);
      for (const m of liveDynamic.current) box.expandByObject(m);
      const wasCeiling = ceiling.current;
      ceiling.current = Number.isFinite(box.max.y) ? box.max.y : 0;
      // The zoom-out limit's cylinder height. Refit only when the ceiling moved
      // past `CEILING_EPSILON`: `refit` forces a full re-frame, and small moves
      // (the robber on a chip, a metropolis, a raised sword) should not rescale
      // the viewer's distance. The fences re-solve from the updated ceiling on
      // every orbit change anyway.
      if (ceilingMoved(wasCeiling, ceiling.current)) gl.current?.refit();
      else gl.current?.resize();
      // Measured before anything is lifted, so a falling piece does not shove
      // the camera's floor up.
      // Published before the motions start, so the raise and the hover read
      // this build's swords.
      swordArt.current = swordPivots;
      stopPieceMotion = startPieceMotion();
      // After the measurement, for the same reason.
      stopRobber = startRobber();
      stopMerchant = startMerchant();
      // Likewise.
      stopChips = startChips();
      // The dynamic half (every moving caster) is replaced on every build, so
      // the shadow map is stale here. Animations (`startPieceMotion`,
      // `carrier`) invalidate per frame while they run.
      invalidateShadows(renderer);
      requestDraw();
    };

    /**
     * At commit, throw new pieces in from above, hop newly readied knights and
     * raise their swords, grow newly promoted knights, and lower the swords of
     * knights the barbarians stood down. Started at commit because the assets
     * load asynchronously and motion must start when the piece appears.
     *
     * One subscription for all of them: they share the key-to-instance
     * bookkeeping, culling opt-out and shadow invalidation, and motions on the
     * same instance (a hop with a sword turn, a growth while settling) must be
     * composed into one pose per frame. Drop and hop never overlap:
     * `newlyReady` only accepts keys already on the board.
     *
     * Returns the unsubscribe. Under reduced motion nothing is posed, so every
     * pose must be the identity at rest.
     */
    function startPieceMotion(): () => void {
      // Every distinguishable key, read back off what was built so keys and
      // instances cannot drift.
      const keys = new Set<string>();
      const at = new Map<string, { mesh: THREE.InstancedMesh; index: number }>();
      for (const mesh of liveDynamic.current) {
        const state = animatable(mesh);
        if (!state) continue;
        for (const [key, index] of state.index) {
          // The markers carry keys only to be carried (see startRobber and
          // startMerchant); they must not drop.
          if (key === ROBBER_KEY || key === MERCHANT_KEY) continue;
          // Nor chips, keyed only so a roll can turn them; otherwise every chip
          // would drop on the first build or a fog reveal.
          if (isChipKey(key)) continue;
          keys.add(key);
          // A key can name several meshes (one per source material), which move
          // together, so index by key+mesh.
          at.set(`${key}\u0000${mesh.id}`, { mesh, index });
        }
      }

      const now = ticker.now();
      const starts = stillFalling(falling.current, keys, now);
      // Read before `placed.current` is overwritten: only knights already on
      // the board last commit can have been readied.
      const standing = placed.current;
      // The hop, raise and growth clocks carry across rebuilds like the drops.
      const hops = stillFalling(hopping.current, keys, now, HOP_TOTAL_MS);
      const raises = stillFalling(raising.current, keys, now, SWORD_RAISE_MS);
      const grows = stillFalling(growing.current, keys, now, KNIGHT_GROW_MS);
      const drops = stillFalling(lowering.current, keys, now, SWORD_LOWER_MS);

      /**
       * A knight's sword takes its knight's clock exactly. Left to its own key,
       * `dropStarts`' stagger would land it after the hand, and `newlyPlaced`
       * would count it against `DROP_BULK_LIMIT`.
       */
      const alsoTheSword = (into: Map<string, number>, key: string, start: number) => {
        const sword = swordKey(key);
        if (keys.has(sword)) into.set(sword, start);
      };

      // Sword keys stay in `keys` (they are live instances) but out of the
      // drop diff.
      const bodies = new Set([...keys].filter((key) => !isSwordKey(key)));
      for (const [key, start] of dropStarts(newlyPlaced(standing, bodies), now)) {
        starts.set(key, start);
        alsoTheSword(starts, key, start);
      }
      for (const [key, start] of dropStarts(newlyReady(readied.current, ready, standing), now)) {
        hops.set(key, start);
        alsoTheSword(hops, key, start);
        // The raise and the hop start together. Only the sword turns; tilting
        // the body would somersault the piece.
        alsoTheSword(raises, key, start);
      }
      // Promotion swaps the drawn model. No stagger: several at once are one
      // event.
      for (const key of promoted(levels.current, levelOf)) {
        grows.set(key, now);
        alsoTheSword(grows, key, now);
      }
      // Stand-down is the one motion the board must be told about. The latch
      // is consumed even if no knight stood down, so it cannot leak into a
      // later ordinary deactivation. See `standDown`.
      if (standDown.current) {
        standDown.current = false;
        // No stagger or bulk limit: the fleet landed on everyone at once. Only
        // the swords move.
        for (const key of newlyStoodDown(readied.current, ready, keys)) {
          alsoTheSword(drops, key, now);
        }
      }
      placed.current = keys;
      readied.current = ready;
      levels.current = levelOf;
      falling.current = starts;
      hopping.current = hops;
      raising.current = raises;
      growing.current = grows;
      lowering.current = drops;
      if (!starts.size && !hops.size && !raises.size && !grows.size && !drops.size) return () => {};

      // Frustum culling uses the matrices as built, so a lifted piece could be
      // culled mid-air. Meshes with something moving opt out while it moves.
      const culled: THREE.InstancedMesh[] = [];
      const moved = new Set([
        ...starts.keys(),
        ...hops.keys(),
        ...raises.keys(),
        ...grows.keys(),
        ...drops.keys(),
      ]);
      const parts = [...moved].flatMap((key) =>
        liveDynamic.current.flatMap((mesh) => {
          const hit = at.get(`${key}\u0000${mesh.id}`);
          if (!hit) return [];
          if (mesh.frustumCulled) {
            mesh.frustumCulled = false;
            culled.push(mesh);
          }
          return [{ key, ...hit }];
        }),
      );

      const off = ticker.add(({ elapsedMs }) => {
        let moving = false;

        const touched = new Set<THREE.InstancedMesh>();
        for (const part of parts) {
          // One pose per part per frame, composed from whichever motions have
          // this key (a hop with a sword turn, a growth), since they share one
          // instance matrix. Hop and fall never coincide (`newlyReady`); a key
          // with only a raise or growth stays put vertically.
          const hop = hops.get(part.key);
          const fall = starts.get(part.key);
          const pose: InstancePose = {};
          if (hop !== undefined) {
            const t = elapsedMs - hop;
            const hopped = hopPose(t);
            pose.lift = hopped.lift;
            pose.squashY = hopped.squashY;
            if (t < HOP_TOTAL_MS) moving = true;
          } else if (fall !== undefined) {
            const t = elapsedMs - fall;
            const fell = dropPose(t);
            pose.lift = fell.lift;
            pose.squashY = fell.squashY;
            if (t < DROP_TOTAL_MS) moving = true;
          }
          // Raise and lower are one channel: a blade goes up or down, never
          // both. The rules cannot ready a knight on the commit a landfall
          // deactivates it; if they did, the raise would rightly win.
          const raise = raises.get(part.key);
          const lower = raise === undefined ? drops.get(part.key) : undefined;
          if (raise !== undefined || lower !== undefined) {
            const sweep =
              raise !== undefined
                ? swordRaisePose(elapsedMs - raise)
                : swordLowerPose(elapsedMs - lower!);
            const pivot = swordArt.current.get(part.key)?.pivot;
            pose.tilt = sweep.tilt;
            pose.tiltAxisY = SWORD_FLIP_AXIS_Y;
            // The hand, not the vertex, or the sword orbits the knight (see
            // `InstancePose.tiltPivotX`). Measured at full scale; a promotion in
            // the same commit would shift the grip negligibly.
            pose.tiltPivotX = pivot?.x ?? 0;
            pose.tiltPivotY = pivot?.y ?? 0;
            if (!sweep.done) moving = true;
          }
          const grow = grows.get(part.key);
          if (grow !== undefined) {
            const grown = knightGrowPose(elapsedMs - grow);
            pose.scale = grown.scale;
            if (!grown.done) moving = true;
          }
          poseInstanceAt(part.mesh, part.index, pose);
          touched.add(part.mesh);
        }
        for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
        // A piece in the air is a moving caster: redraw shadows every frame of
        // the fall.
        invalidateShadows(renderer);
        // Stops the frame after the last piece lands, returning to on-demand
        // drawing.
        if (!moving) stop();
      });

      const stop = () => {
        off();
        for (const mesh of culled) mesh.frustumCulled = true;
      };
      return stop;
    }

    /**
     * The instances this build made for one carried marker, and where it put
     * them.
     *
     * Unlike a drop (a new key appearing), a marker's key is constant, so the
     * same key at a new position means it travelled. A key may name several
     * meshes (the merchant's stall is ten), which move together.
     *
     * `rest` is read back off what was built, so the seated height and the
     * robber's chip offset come along and a trip does not pop vertically.
     */
    function markerParts(
      key: string,
    ): { parts: { mesh: THREE.InstancedMesh; index: number }[]; rest: Vec3 } | null {
      const parts: { mesh: THREE.InstancedMesh; index: number }[] = [];
      for (const mesh of liveDynamic.current) {
        const index = animatable(mesh)?.index.get(key);
        if (index !== undefined) parts.push({ mesh, index });
      }
      if (!parts.length) return null;
      return { parts, rest: animatable(parts[0].mesh)!.placements[parts[0].index].position };
    }

    /**
     * Hand a marker's instances to the ticker until its motion finishes.
     * `poseAt` answers for the whole piece each frame and reports when done;
     * `arm` is separate so a later motion (the robber's pulse) can start
     * without a rebuild.
     *
     * Under reduced motion nothing is posed and the marker stands at its
     * destination, so the resting pose must equal the placement (see
     * markerMotion's AT_REST).
     */
    function carrier(
      parts: { mesh: THREE.InstancedMesh; index: number }[],
      poseAt: (elapsedMs: number) => InstancePose & { done: boolean },
      onDone: () => void,
    ): { arm: () => void; stop: () => void } {
      let off: (() => void) | null = null;
      const culled: THREE.InstancedMesh[] = [];
      const stop = () => {
        off?.();
        off = null;
        for (const mesh of culled) mesh.frustumCulled = true;
        culled.length = 0;
      };
      const arm = () => {
        if (off) return;
        // As for the drops: a carried marker leaves its bounding sphere and
        // would be culled mid-air.
        for (const part of parts) {
          if (!part.mesh.frustumCulled) continue;
          part.mesh.frustumCulled = false;
          culled.push(part.mesh);
        }
        off = ticker.add(({ elapsedMs }) => {
          const pose = poseAt(elapsedMs);
          for (const part of parts) poseInstanceAt(part.mesh, part.index, pose);
          for (const part of parts) part.mesh.instanceMatrix.needsUpdate = true;
          // A moving marker is a moving caster.
          invalidateShadows(renderer);
          // Stops the frame after the motion finishes.
          if (pose.done) {
            onDone();
            stop();
          }
        });
      };
      return { arm, stop };
    }

    /**
     * Carry the robber to wherever this build put it, and let a click make it
     * pulse. Returns the unsubscribe.
     */
    function startRobber(): () => void {
      const found = markerParts(ROBBER_KEY);
      if (!found) {
        // No robber (or no art yet). Forget where it was, so a robber that
        // reappears stands where it is put instead of being carried.
        armRobber.current = () => {};
        settleRobber.current = () => {};
        robberSeat.current = null;
        return () => {};
      }

      // Culling stays off for the robber: the hover tip holds it 75 degrees
      // over, far outside its sphere, long after `carrier` has restored
      // culling. It is a single small instance, so the cost is one frustum test.
      for (const part of found.parts) part.mesh.frustumCulled = false;

      const now = ticker.now();
      const kept = stillMoving(robberAnim.current, now);

      // A carried piece has already made the trip. The carry is an offset from
      // the seat, and a commit moves the seat; replaying a trip from the old
      // hex would jump the piece back and fly it again. So re-anchor: express
      // where the piece visibly is as an offset from the new seat. For a click
      // under the pointer that offset is zero; other cases (an interrupted
      // carry, a knight chasing the robber) re-base from where it really is.
      //
      // Two answers to how it got here. For other players the move is news,
      // and the arc shows which hex stopped producing. For the player who made
      // it, the piece lands instead (drop.ts's fall), since they already watched
      // it travel. `iMovedIt` is the only way to tell them apart.
      const moved = !!robberSeat.current && !samePoint(robberSeat.current, found.rest);
      const mine = moved && iMovedIt.current;
      if (moved) iMovedIt.current = false;
      // Landing under the player's own cursor would tip it at once. See
      // `peekBlocked`.
      if (mine) peekBlocked.current = true;

      robberAnim.current = {
        trip: mine ? null : planTrip(ROBBER_TRAVEL, robberSeat.current, found.rest, kept.trip, now),
        pulse: kept.pulse,
        // An interrupted somersault carries on, dropped by `stillMoving` when
        // its time is up.
        flip: kept.flip,
        // The tip ends only with the pointer, so it survives a rebuild whole.
        // See `stillMoving`.
        peek: kept.peek,
        drop: mine ? now : kept.drop,
      };
      robberSeat.current = found.rest;

      /**
       * One frame of the robber, with the turn's pivot chosen: the somersault
       * turns about its middle and the hover tip about the far edge of its
       * feet. An instance matrix has one pivot, and `turning` says which wins.
       */
      const frame = (elapsedMs: number): InstancePose & { done: boolean } => {
        const pose = robberPose(robberAnim.current, elapsedMs);
        const axisY = robberAnim.current.peek?.axisY ?? 0;
        const pivot = peekPivot(axisY);
        // A seven spins a dead robber in place rather than somersaulting it,
        // which would haul it upright. The angle goes to `spinY`, the tip keeps
        // it flat, and the timing is the same.
        if (pose.turning && robberAnim.current.dead) {
          return {
            ...pose,
            spinY: pose.tilt,
            tilt: pose.peek,
            tiltAxisY: axisY,
            tiltPivotX: pivot.x,
            tiltPivotZ: pivot.z,
          };
        }
        if (pose.turning) {
          return {
            ...pose,
            // About the screen-horizontal axis the turn started with, through
            // the piece's middle. `robberHalf` is zero only without art.
            tiltAxisY: robberFlipAxis.current,
            tiltPivotY: robberHalf,
          };
        }
        // The tip: an axis read off the camera when the pointer arrived, hinged
        // at the foot it falls over. `tiltPivotY` 0 is the ground.
        return {
          ...pose,
          tilt: pose.peek,
          tiltAxisY: axisY,
          tiltPivotX: pivot.x,
          tiltPivotZ: pivot.z,
        };
      };

      const { arm, stop } = carrier(found.parts, frame, () => {
        // Not `ROBBER_STILL`: the timed motions are over, but `peek` and `dead`
        // are latches the pointer owns. Dropping `dead` here made a dead robber
        // creep up to the hover angle each time it came to rest.
        robberAnim.current = {
          ...ROBBER_STILL,
          peek: robberPeek.current,
          dead: robberDead.current,
        };
      });
      // Armed here when this build found a trip, and from the pointer handler
      // through `armRobber` when a click pulses a still robber.
      armRobber.current = arm;
      /**
       * The tip alone, written once, for reduced motion, so those players can
       * still see the blocked number.
       *
       * Not `frame`: the timed motions have no clock under the preference, and
       * sampling a recorded pulse would leave the robber permanently enlarged.
       * A reduced-motion peek is a zero-length leg (see `stillPeek`); with no
       * peek this reproduces the built matrix.
       */
      settleRobber.current = () => {
        const peek = robberAnim.current.peek ?? null;
        const axisY = peek?.axisY ?? 0;
        const pivot = peekPivot(axisY);
        const pose: InstancePose = {
          tilt: peekTilt(peek, 0),
          tiltAxisY: axisY,
          tiltPivotX: pivot.x,
          tiltPivotZ: pivot.z,
        };
        for (const part of found.parts) poseInstanceAt(part.mesh, part.index, pose);
        for (const part of found.parts) part.mesh.instanceMatrix.needsUpdate = true;
        invalidateShadows(renderer);
        requestDraw();
      };
      if (ticker.reducedMotion()) {
        // Nothing to arm under reduced motion, but a held tip must be
        // re-applied to this build's instances.
        if (robberAnim.current.peek) settleRobber.current();
      } else if (
        robberAnim.current.trip ||
        robberAnim.current.pulse !== null ||
        robberAnim.current.flip !== null ||
        robberAnim.current.peek ||
        robberAnim.current.drop !== null
      ) {
        arm();
      }

      return () => {
        stop();
        // These meshes are about to be disposed; a click must not reach them.
        armRobber.current = () => {};
        settleRobber.current = () => {};
      };
    }

    /**
     * Carry the merchant the same way, on the same clock. It has no pulse, so
     * only a trip arms it. Its own `MERCHANT_TRAVEL`, since the stall is
     * shorter than the robber.
     */
    function startMerchant(): () => void {
      const found = markerParts(MERCHANT_KEY);
      if (!found) {
        merchantSeat.current = null;
        return () => {};
      }

      const now = ticker.now();
      merchantTrip.current = planTrip(
        MERCHANT_TRAVEL,
        merchantSeat.current,
        found.rest,
        stillTrip(MERCHANT_TRAVEL, merchantTrip.current, now),
        now,
      );
      merchantSeat.current = found.rest;

      const { arm, stop } = carrier(
        found.parts,
        (elapsedMs) => markerPose(MERCHANT_TRAVEL, merchantTrip.current, elapsedMs),
        () => {
          merchantTrip.current = null;
        },
      );
      if (merchantTrip.current) arm();
      return stop;
    }

    /**
     * Animate the chips on this build's instances: the flip a roll names and
     * the exchange the Inventor starts, which compete for the same instances.
     *
     * Neither is started by a rebuild alone; this exists to be armed, and to
     * re-arm when meshes are replaced. The exception is the swap's first arm,
     * which is a commit (see `chipSwap`).
     *
     * Returns the unsubscribe.
     */
    function startChips(): () => void {
      // Every chip this build drew, by key. A key names several meshes (disc,
      // face, numeral, pips), which turn together. Instance indices are only
      // valid for this build, so the map dies with its meshes.
      const at = new Map<string, { mesh: THREE.InstancedMesh; index: number }[]>();
      for (const mesh of liveStatic.current) {
        const state = animatable(mesh);
        if (!state) continue;
        for (const [key, index] of state.index) {
          if (!isChipKey(key)) continue;
          at.set(key, [...(at.get(key) ?? []), { mesh, index }]);
        }
      }

      /**
       * Every chip motion this build has running, and its instances. A list
       * because a swap is two carriers (half a lap apart, so no shared pose)
       * and a new motion must be able to lay down either.
       */
      let live: { stop: () => void; parts: { mesh: THREE.InstancedMesh; index: number }[] }[] = [];

      /**
       * Stop everything in progress and lay its chips flat. `carrier.stop` only
       * unsubscribes and leaves the last matrix, so callers must reset the
       * chips; the empty pose is their built matrix.
       */
      const settle = () => {
        for (const m of live) {
          m.stop();
          for (const part of m.parts) poseInstanceAt(part.mesh, part.index, {});
          for (const part of m.parts) part.mesh.instanceMatrix.needsUpdate = true;
        }
        live = [];
      };

      /**
       * Hand one set of chip instances to the ticker and remember them,
       * dropping the entry when the motion finishes so `settle` skips it.
       */
      const run = (
        parts: { mesh: THREE.InstancedMesh; index: number }[],
        poseAt: (elapsedMs: number) => InstancePose & { done: boolean },
        onDone: () => void,
      ) => {
        const entry = { stop: () => {}, parts };
        const { arm: start, stop } = carrier(parts, poseAt, () => {
          onDone();
          live = live.filter((m) => m !== entry);
        });
        entry.stop = stop;
        live.push(entry);
        start();
      };

      const armFlip = () => {
        // A second roll during a turn: put the outgoing chips back, or one could
        // stay on its edge. An exchange in flight is stopped and forgotten; a
        // pending swap survives, since it has drawn nothing yet.
        settle();
        if (chipSwap.current && chipSwap.current.start !== null) chipSwap.current = null;

        const flip = chipFlip.current;
        if (!flip) return;
        const parts = flip.keys.flatMap((k) => at.get(k) ?? []);
        if (!parts.length) return;
        run(
          parts,
          (elapsedMs) => ({
            ...flipPose(CHIP_FLIP, elapsedMs - flip.start),
            tiltAxisY: flip.axisY,
            tiltPivotY: chipHalfRef.current,
          }),
          () => {
            chipFlip.current = null;
          },
        );
      };

      /**
       * One end of an exchange: a chip's instances and where it rests (read
       * back off the build, as in `markerParts`).
       */
      type ChipEnd = { parts: { mesh: THREE.InstancedMesh; index: number }[]; rest: Vec3 };
      const chipEnd = (key: string): ChipEnd | null => {
        const parts = at.get(key) ?? [];
        if (!parts.length) return null;
        const state = animatable(parts[0].mesh);
        if (!state) return null;
        return { parts, rest: state.placements[parts[0].index].position };
      };

      /**
       * Send the two chips of a swap round to each other's hexes. The chip
       * built on A shows B's number, so it sets off from B, and vice versa;
       * opposite point orders put them on opposite sides of the oval (see
       * `swapPose`). Two carriers, since they are half a lap apart.
       */
      const armSwap = () => {
        // The newest motion owns the chips.
        settle();
        chipFlip.current = null;

        const swap = chipSwap.current;
        if (!swap || swap.start === null) return;
        const start = swap.start;
        const a = chipEnd(swap.a);
        const b = chipEnd(swap.b);
        // A missing chip (art that failed to load; never a legal play) means no
        // exchange, and NaN in an instance matrix would blank a whole mesh.
        if (!a || !b) {
          chipSwap.current = null;
          return;
        }
        const send = (self: ChipEnd, other: ChipEnd) =>
          run(
            self.parts,
            (elapsedMs) => swapPose(CHIP_SWAP, other.rest, self.rest, elapsedMs - start),
            () => {
              chipSwap.current = null;
            },
          );
        send(a, b);
        send(b, a);
      };

      armChipFlip.current = armFlip;
      // A turn still running when the board was rebuilt carries on. A rebuild
      // long after the roll must not replay it, and a fresh rig's ticker starts
      // at zero, so an old stamp would read as future. See `stillFlipping`.
      if (chipFlip.current && stillFlipping(CHIP_FLIP, chipFlip.current.start, ticker.now()))
        armFlip();
      else chipFlip.current = null;

      // The exchange is stamped at the first static build after it was
      // recorded, the first to draw the swapped numbers (see `chipSwap`). Gated
      // on `needStatic`: a client that caught up via a gap refetch already has
      // the swapped board, and its swap stays pending and draws nothing.
      const swap = chipSwap.current;
      if (swap && swap.start === null) {
        if (needStatic) {
          swap.start = ticker.now();
          armSwap();
        }
      } else if (swap && stillSwapping(CHIP_SWAP, swap.start!, ticker.now())) armSwap();
      else chipSwap.current = null;

      return () => {
        // Laid flat, not just unsubscribed: these meshes stay on screen until
        // the next build commits (which may never come if it is cancelled),
        // and frames are still painted meanwhile.
        settle();
        // These meshes are about to be disposed; a roll must not reach them.
        armChipFlip.current = () => {};
      };
    }

    (async () => {
      // The board-aware half of the prefetch: the lobby could not know which
      // river channels this board draws, so they are requested here. Not
      // awaited; the tile loop requests them again through the same cache, so
      // this only batches them.
      void preloadBoardTiles(view);

      const palette = await loadPalette();
      if (cancelled) return;

      // The static half: the board itself. Skipped when this rig already drew
      // the same board, i.e. whenever only pieces moved, which saves ~110ms of
      // ocean, annulus, beach and hex instancing.
      if (needStatic) {
        // Docks first: each stands on a water hex, which must not also get a
        // plain sea tile.
        const ports = planPorts(view.board.harbors ?? [], view.board.tiles);
        const portKeys = new Set(ports.map((p) => hexKey(p.hex)));

        // Terrain and ocean, grouped by file so each asset loads once.
        const byFile = new Map<string, Placement[]>();
        // Some hexes are repainted before instancing, which no resource-keyed
        // lookup can express: the Caravans oasis, Explorers' revealed gold
        // fields, shoals and spice farms, and fogged hexes (a blank slab under a
        // cloud). Rivers also turns its tiles, so the channel leaves by the
        // engine's two edges (see `layers/rivers.ts`). Fog wins where it
        // overlaps a river, so an unexplored hex never shows one, and has no yaw.
        const moduleArt = tileArtOverrides(view);
        const castleArt = castleTileArt(view);
        const wagonArt = tradeTileOverrides(view);
        const explorersArt = explorersTileArt(view);
        const fogArt = fogTileArt(view.board.tiles);
        // No two sources name the same hex: the oasis is a desert Caravans
        // derived, the Raiders castle takes the nearest ordinary terrain (not
        // the desert), and fog covers unrevealed hexes.
        const artOverrides = {
          files: new Map([
            ...moduleArt.files,
            ...castleArt.files,
            ...wagonArt.files,
            ...explorersArt.files,
            ...fogArt.files,
          ]),
          land: new Set([
            ...moduleArt.land,
            ...castleArt.land,
            ...wagonArt.land,
            ...explorersArt.land,
            ...fogArt.land,
          ]),
          // A yaw survives only where no later source replaced the tile.
          yaw: new Map([
            ...[...moduleArt.yaw].filter(
              ([key]) =>
                !fogArt.files.has(key) &&
                !castleArt.files.has(key) &&
                !wagonArt.files.has(key) &&
                !explorersArt.files.has(key),
            ),
            // The Explorers Council also turns its tile, to put its quays on the
            // engine's anchor corners (see `councilYaw`). Same rule.
            ...[...explorersArt.yaw].filter(([key]) => !fogArt.files.has(key)),
          ]),
        };
        for (const t of planTiles(
          // A fog hex draws no tile: its cell is a plate of cloud, drawn with
          // the bank below.
          view.board.tiles.filter((t) => !portKeys.has(hexKey(t.hex)) && t.res !== FOG_RESOURCE),
          artOverrides.files,
          artOverrides.yaw,
          // Which overrides are land, so the oasis and fog slab are drawn at
          // land scale and Explorers' shoal (a sea hull) is not.
          artOverrides.land,
        )) {
          byFile.set(t.file, [
            ...(byFile.get(t.file) ?? []),
            { position: t.position, rotationY: t.rotationY, scale: t.scale },
          ]);
        }
        // Set the swell's fade before building anything that reads it; the sea
        // hexes reach exactly `nearOceanRadius`.
        setOceanFade(oceanFadeFor(extent, aspect));

        const oceanFile = tileFileFor("sea");
        if (oceanFile) {
          byFile.set(oceanFile, [
            ...(byFile.get(oceanFile) ?? []),
            ...planOcean(view.board.tiles, aspect, portKeys).map((position) => ({
              position,
              rotationY: TILE_ROTATION_Y,
              scale: tileScale("sea"),
            })),
          ]);
        }
        for (const [file, placements] of byFile) {
          const loaded = await loadAsset(file, palette);
          if (cancelled) return;
          // The Explorers shoal is drawn without its wet-sand flat; see
          // `SHOAL_DRAWN_PREFIXES`.
          const asset =
            file === TILES.sea_shoal?.file
              ? subsetByPrefixes(loaded, SHOAL_DRAWN_PREFIXES)
              : loaded;
          // The Council's town turns to put its quays on its anchors, but its
          // wave sheet keeps the board's facing, as for harbours, so the relief
          // matches the ocean's crests. See `splitOceanSurface`.
          if (file === TILES[COUNCIL_TILE]?.file) {
            const { surface, rest } = splitOceanSurface(asset);
            add(instanceAsset(rest, placements));
            add(
              instanceAsset(
                surface,
                placements.map((p) => ({ ...p, rotationY: TILE_ROTATION_Y })),
              ),
            );
            continue;
          }
          add(instanceAsset(asset, placements));
        }

        // The rest of the way to the horizon, as one flat ring of the same
        // water, borrowing the sea tile's own material. The wave shader is a
        // no-op out here, past `nearOceanRadius`.
        const nearRadius = nearOceanRadius(extent, aspect);
        // Sized for any aspect, since a resize does not re-run this effect.
        // See `oceanRadiusAnyAspect`.
        const seaRadius = oceanRadiusAnyAspect(extent);
        if (oceanFile && seaRadius > nearRadius) {
          const seaAsset = await loadAsset(oceanFile, palette); // cached; already loaded above
          if (cancelled) return;
          const water = materialNamed(seaAsset, OCEAN_WATER_MATERIAL);
          if (water) {
            add(
              instanceGeometry(
                oceanAnnulusGeometry(nearRadius, seaRadius),
                // The same water, losing to the hexes drawn over it. See
                // `annulusMaterial`.
                annulusMaterial(water),
                [{ position: [0, OCEAN_FLAT_Y, 0] }],
                "ocean_annulus",
              ),
            );
          }
        }

        // The lattice gap between land tiles, filled with sand.
        // A fog hex's gutter and shore are cloud, not sand (see `layers/fog.ts`),
        // drawn in the kit's cloud materials, so the kit loads first.
        const fogged = fogKeys(view.board.tiles);
        const fogKit = fogged.size ? await loadAsset(FOG_MODEL, palette).catch(() => null) : null;
        if (cancelled) return;
        const fogShore = (kind: "dry" | "wet") =>
          (fogKit && materialNamed(fogKit, FOG_SHORE_MATERIALS[kind])) || fogShoreMaterial(kind);
        const gapSand = planGapSand(view.board.tiles, artOverrides.land, fogged);
        if (gapSand.length) {
          const sandAsset = await loadAsset("beach.glb", palette);
          if (cancelled) return;
          const sand = materialNamed(sandAsset, GAP_SAND_MATERIAL);
          if (sand) add(instanceGeometry(gapStripGeometry(SAND_Y), sand, gapSand, "gap_sand"));
        }
        // A fog hex's cell, gutter and all, is a plate of cloud rather than a
        // tile (see `fogPlateGeometry`).
        const fogPlates = planFogPlates(view.board.tiles);
        if (fogPlates.length) {
          add(instanceGeometry(fogPlateGeometry(), fogShore("dry"), fogPlates, "fog_plate"));
        }
        // A known land hex's beach on the side it shares with a fog hex, laid
        // on the plate (see `planFogLandBeach`).
        const fogLandBeach = planFogLandBeach(view.board.tiles, artOverrides.land);
        if (fogLandBeach) {
          const beachAsset = await loadAsset("beach.glb", palette);
          if (cancelled) {
            fogLandBeach.dispose();
            return;
          }
          const sand = materialNamed(beachAsset, SAND_MATERIAL.dry);
          if (sand) {
            add(instanceGeometry(fogLandBeach, sand, [{ position: [0, 0, 0] }], "fog_land_beach"));
          } else fogLandBeach.dispose();
        }

        // Beaches: one ribbon per island in world space, using the blend's sand
        // materials so palette.json still applies. Placed at the origin, via
        // `instanceGeometry` for its ownership flag. A fog hex's stretch is
        // drawn in the cloud's materials instead.
        const beaches = planBeaches(view.board.tiles, artOverrides.land, fogged);
        if (beaches) {
          const beachAsset = await loadAsset("beach.glb", palette);
          if (cancelled) return;
          for (const kind of ["dry", "wet"] as const) {
            const material = materialNamed(beachAsset, SAND_MATERIAL[kind]);
            if (!material) {
              beaches[kind].dispose();
              continue;
            }
            add(
              instanceGeometry(beaches[kind], material, [{ position: [0, 0, 0] }], `beach_${kind}`),
            );
          }
          if (beaches.mist) {
            for (const kind of ["dry", "wet"] as const) {
              add(
                instanceGeometry(
                  beaches.mist[kind],
                  fogShore(kind),
                  [{ position: [0, 0, 0] }],
                  `fog_shore_${kind}`,
                ),
              );
            }
          }
        }

        // The cloud bank over every unrevealed hex (the blank slab went in with
        // the terrain; see `fogTileArt`). Drawn from `fog.glb`, at most eight
        // instanced draws, baked into the cached board. Without the kit,
        // generated icosahedra stand in.
        //
        // The shore puffs keep out of harbours and the Council's water, which
        // carry art of their own.
        const fogShorePuffs = planFogShore(
          view.board.tiles,
          artOverrides.land,
          new Set([...portKeys, ...explorersArt.files.keys()]),
        );
        const puffs = [...planFog(view.board.tiles), ...fogShorePuffs.billows];
        if (puffs.length) {
          const floor = [...planFogFloor(view.board.tiles), ...fogShorePuffs.floor];
          const kit = fogKit;
          const drawn = kit ? fogKitMeshes(kit, puffs, floor) : null;
          if (drawn) {
            add(drawn);
          } else {
            add(instanceGeometry(fogPuffGeometry(), fogMaterial(), puffs, "fog"));
            add(
              instanceGeometry(
                fogPuffGeometry(FOG_FLOOR_SQUASH),
                fogMaterial(),
                floor,
                "fog_floor",
              ),
            );
          }
        }

        // Number chips, one subset per (number, variant). Their top face is
        // what the robber stands on, so it is measured here.
        //
        // Minus the Raiders castle's: the engine keeps the hex's number (the
        // fairness audit reproduces the chip layout), but the castle never
        // produces, so the number is hidden.
        const chipsHidden = hiddenChips(view);
        const chips = planChips(view.board.tiles.filter((t) => !chipsHidden.has(hexKey(t.hex))));
        // Reset so a board without chips does not keep old measurements.
        chipTopRef.current = SURFACE.land;
        chipHalfRef.current = 0;
        if (chips.length) {
          const chipAsset = await loadAsset("chips.glb", palette);
          if (cancelled) return;
          const groups = new Map<string, Placement[]>();
          for (const c of chips) {
            const prefix = chipPrefix(c.number, c.variant);
            groups.set(prefix, [
              ...(groups.get(prefix) ?? []),
              { position: c.position, key: c.key },
            ]);
          }
          for (const [prefix, placements] of groups) {
            // `chipArt`, not `subsetByPrefix`: most chips keep their body on an
            // unnamed node.
            const art = chipArt(chipAsset, prefix);
            const [lo, hi] = assetSpanY(art);
            chipTopRef.current = SURFACE.land + (hi - lo);
            chipHalfRef.current = (hi - lo) / 2;
            add(instanceAsset(art, seatOn(placements, SURFACE.land, lo)));
          }
        }

        // The lakes' chips: one per lake, listing every number it pays fish on,
        // composed from the chip file's parts (see lib/board3d/lakeChip). Chip
        // height, so the robber stands at `chipTopRef` as usual.
        const lakeChips = planLakeChips(
          view.board.tiles.filter((t) => !chipsHidden.has(hexKey(t.hex))),
          lakeNumbers(view),
        );
        if (lakeChips.length) {
          const chipAsset = await loadAsset("chips.glb", palette);
          if (cancelled) return;
          for (const c of lakeChips) {
            const art = composeLakeChip(chipAsset, c.numbers);
            const [lo, hi] = assetSpanY(art);
            chipTopRef.current = SURFACE.land + (hi - lo);
            chipHalfRef.current = (hi - lo) / 2;
            add(
              instanceAsset(art, seatOn([{ position: c.position, key: c.key }], SURFACE.land, lo)),
            );
          }
        }

        // The docks, each rotated to face its land (not the tiles' half turn).
        const portFile = tileFileFor(PORT_TILE);
        if (ports.length && portFile) {
          const portAsset = await loadAsset(portFile, palette);
          if (cancelled) return;
          // The dock turns but its water does not, or the harbour's waves would
          // cross the ocean's. See splitOceanSurface and portWaterPlacements.
          const { surface, rest } = splitOceanSurface(portAsset);
          add(instanceAsset(rest, ports));
          add(instanceAsset(surface, portWaterPlacements(ports)));

          // Each harbour's trade dressing, authored on the pier in the dock's
          // frame and instanced at the dock's placement. `dockPrefix` picks the
          // art (a 3:1 is the general market).
          //
          // It takes the dock's placement, not the sign's: the sign may be spun
          // by a third of a turn, which would throw the dressing off the pier.
          // See `groupDockArt`.
          //
          // A missing file just means plain docks.
          const docks = await loadAsset("docks.glb", palette).catch(() => null);
          if (cancelled) return;
          if (docks) {
            for (const [prefix, at] of groupDockArt(ports)) {
              const art = subsetByPrefix(docks, prefix);
              if (art.scene.children.length) add(instanceAsset(art, at));
            }
          }
        }

        // The harbour sign: one modelled wedge per trade carrying the ratio,
        // placed at the dock (see
        // tools/blender/edits/0025_harbour_ratio_signs.py). Its rotation is its
        // own: the wedge is three-fold symmetric, so it is spun to whichever
        // third reads closest to upright. See signPlacement.
        if (ports.length) {
          const signs = await loadAsset("signs.glb", palette).catch(() => null);
          if (cancelled) return;
          if (signs) {
            for (const [prefix, at] of groupSignArt(ports)) {
              const art = subsetByPrefix(signs, prefix);
              if (art.scene.children.length) add(instanceAsset(art, at));
            }
          }
        }
      }

      // ...and from here the dynamic half, rebuilt every time.
      sink = builtDynamic;

      // Pieces, tinted per seat, plus the neutral robber.
      // A metropolis stands in place of its city, so that city is not drawn.
      const pieces = planPieces(view, metropolisVertexKeys(view));
      const robber = planRobber(view.board);
      if (pieces.length || robber.length) {
        // The stock file loads regardless: the robber comes from it, and every
        // fallback lands on it.
        const pieceAsset = await loadAsset("pieces.glb", palette);
        if (cancelled) return;

        // Resolve each seat's set, then draw once per set; the seat colour is
        // an instance attribute (see `tintableAsset`), so a table with no sets
        // draws all settlements in one call.
        const bySet = new Map<LoadedAsset, { seat: number; owned: typeof pieces }[]>();
        for (const [seat, owned] of bySeat(pieces)) {
          // The `pieceSet` prop (dev route) overrides every seat. Every failure
          // (unknown id, 404, misnamed nodes) falls back to stock art, since a
          // board without settlements is unreadable.
          const setFile = pieceSet ?? pieceSetAssetFile(view.seat_pieces?.[seat] ?? "");
          let setAsset = pieceAsset;
          if (setFile !== STOCK_PIECES_FILE) {
            try {
              const loaded = await loadAsset(setFile, palette);
              if (cancelled) return;
              // Only a drop-in if the expected prefixes are present.
              if (subsetByPrefix(loaded, PIECE_PREFIX.settlement).scene.children.length) {
                setAsset = loaded;
              }
            } catch {
              // Keep the stock art.
            }
          }
          // Keyed on the LoadedAsset, which the loader caches per file, so seats
          // on the same set share a bucket.
          bySet.set(setAsset, [...(bySet.get(setAsset) ?? []), { seat, owned }]);
        }

        for (const [setAsset, seats] of bySet) {
          const tintable = tintableAsset(setAsset);
          for (const kind of ["settlement", "city", "road"] as const) {
            const art = subsetByPrefix(tintable, PIECE_PREFIX[kind]);
            // `key` distinguishes new pieces from standing ones (see
            // lib/board3d/drop); `tint` gives each seat its colour in a shared
            // draw.
            const placements = seats.flatMap(({ seat, owned }) => {
              const tint = seatTint(colorOf(seat));
              return owned
                .filter((p) => p.kind === kind)
                .map((p) => ({
                  position: p.position,
                  rotationY: p.rotationY,
                  key: p.key,
                  tint,
                }));
            });
            if (!placements.length) continue;
            add(
              instanceAsset(
                art,
                seatOn(placements, SURFACE.gutter, assetBaseY(art), PIECE_SCALE[kind]),
              ),
              { tinted: true },
            );
            // Colorblind mode: stamp the owner's seat number on buildings, since
            // the palette runs out of distinct colours before ten seats (see
            // lib/colorblind). Not on roads, which are too thin. Per seat, since
            // a numeral is the seat.
            if (numberPieces && kind !== "road") {
              const [lo, hi] = assetSpanY(art);
              const top = SURFACE.gutter + (hi - lo) * PIECE_SCALE[kind];
              for (const { seat, owned } of seats) {
                const mine = owned
                  .filter((p) => p.kind === kind)
                  .map((p) => ({ position: p.position, rotationY: p.rotationY, key: p.key }));
                if (!mine.length) continue;
                builtNumerals.push(...buildSeatNumerals(seat + 1, mine, top));
              }
            }
          }
        }

        // Untinted: the robber belongs to no player. It stands on the number
        // chip where there is one (marking the blocked number), so its surface
        // is the chip's top face. It wears the equipped skin of whoever last
        // moved it, fetched only if there is one. Every failure falls back to
        // stock art: the robber is game state.
        let robberArt = subsetByPrefix(pieceAsset, ROBBER_PREFIX);
        const robberFile = robberAssetFile(view.robber_skin ?? "");
        if (robberFile !== STOCK_ROBBER_FILE) {
          try {
            const skinAsset = await loadAsset(robberFile, palette);
            if (cancelled) return;
            const skinArt = subsetByPrefix(skinAsset, ROBBER_PREFIX);
            // A chroma recolours its design's file; no second download.
            if (skinArt.scene.children.length > 0) {
              robberArt = applyRobberChroma(skinArt, view.robber_skin ?? "");
            }
          } catch {
            // Keep the stock art.
          }
        }
        const [robberLo, robberHi] = assetSpanY(robberArt);
        robberHalf = ((robberHi - robberLo) * ROBBER_SCALE) / 2;
        const robberSurface = robberOnChip(view.board, lakeNumbers(view))
          ? (chipTopRef.current ?? SURFACE.land)
          : SURFACE.land;
        // `assetSpanY` has just updated the art's matrices.
        const robberBox = new THREE.Box3().setFromObject(robberArt.scene);
        builtRobberBody = robberBox.isEmpty()
          ? null
          : {
              y0: robberSurface,
              y1: robberSurface + 2 * robberHalf,
              r:
                (Math.max(robberBox.max.x - robberBox.min.x, robberBox.max.z - robberBox.min.z) *
                  ROBBER_SCALE) /
                2,
            };
        add(
          instanceAsset(
            robberArt,
            seatOn(robber, robberSurface, assetBaseY(robberArt), ROBBER_SCALE),
          ),
        );
      }

      // --- Islands -----------------------------------------------------
      //
      // Ships and the pirate. Files are fetched only when the board has them.
      const ships = planShips(view);
      const pirate = planPirate(view);
      if (ships.length || pirate.length) {
        const shipAsset = await loadAsset("ships.glb", palette);
        if (cancelled) return;
        if (ships.length) {
          // Tinted per seat like roads, in one call for the table, with the
          // seat colour per instance. See `tintableAsset`.
          const art = subsetByPrefix(tintableAsset(shipAsset), SHIP_PREFIX);
          const at = ships.map((s) => ({ ...s, tint: seatTint(colorOf(s.owner)) }));
          add(instanceAsset(art, seatOn(at, SURFACE.sea, assetBaseY(art), MODULE_SCALE.ship)), {
            tinted: true,
          });
        }
        if (pirate.length) {
          const art = subsetByPrefix(shipAsset, PIRATE_PREFIX);
          add(
            instanceAsset(art, seatOn(pirate, SURFACE.sea, assetBaseY(art), MODULE_SCALE.pirate)),
          );
        }
      }

      // --- Knights -----------------------------------------------------
      const knights = planKnights(view);
      if (knights.length) {
        const knightAsset = await loadAsset("knights.glb", palette);
        if (cancelled) return;
        // One draw per level: level picks the model, seat the tint (an instance
        // colour). See `tintableAsset`.
        {
          const tintable = tintableAsset(knightAsset);
          KNIGHT_PREFIX.forEach((prefix, level) => {
            const ofLevel = knights.filter((k) => k.level === level);
            if (!ofLevel.length) return;
            const at = ofLevel.map((k) => ({
              position: k.position,
              key: k.key,
              tint: seatTint(colorOf(k.owner)),
            }));
            const art = subsetByPrefix(tintable, prefix);
            add(
              instanceAsset(art, seatOn(at, SURFACE.gutter, assetBaseY(art), MODULE_SCALE.knight)),
              { tinted: true },
            );

            // The sword: two draws per level with disjoint placements, dark for
            // inactive knights and gold for active ones. Both poses are baked
            // into the art (dark leaning down, gold upright), so the right sword
            // is chosen here at build time and reduced motion still shows it.
            //
            // Seated at base 0 rather than `assetBaseY(swordArt)`: the sword's
            // node carries its grip offset within the knight's frame, so the
            // knight's seat puts it in the hand. `knightSwordArt.test.ts`
            // measures this off the shipped glb.
            for (const [state, of] of [
              [SWORD_STATE.atEase, ofLevel.filter((k) => !k.active)],
              [SWORD_STATE.ready, ofLevel.filter((k) => k.active)],
            ] as const) {
              if (!of.length) continue;
              const swordArt = subsetByPrefix(tintable, `${KNIGHT_SWORD_PREFIX[level]}${state}`);
              add(
                instanceAsset(
                  swordArt,
                  // Its own key: the sword turns and the body does not, so they
                  // cannot share an instance matrix. `startPieceMotion` mirrors
                  // the knight's drop and hop onto it.
                  seatOn(
                    of.map((k) => ({
                      position: k.position,
                      key: swordKey(k.key),
                      tint: seatTint(colorOf(k.owner)),
                    })),
                    SURFACE.gutter,
                    0,
                    MODULE_SCALE.knight,
                  ),
                ),
                { tinted: true },
              );
              // Where each sword turns (its knight's hand) and its hover guard
              // angle, recorded per key since only this pass knows the level
              // and `state`. See `swordGuardTilt`.
              const guard = swordGuardTilt(state === SWORD_STATE.ready, 1);
              for (const k of of) {
                swordPivots.set(swordKey(k.key), {
                  pivot: swordPivot(level, MODULE_SCALE.knight),
                  guard,
                });
              }
            }
          });
        }
        // Which knights are active, read off the plan, for the hop and raise.
        ready = new Set(knights.filter((k) => k.active).map((k) => k.key));
        // Each knight's level, the only record to diff a promotion against.
        levelOf = knightLevels(knights);
      }

      const walls = planWalls(view);
      if (walls.length) {
        const wallAsset = await loadAsset("walls.glb", palette);
        if (cancelled) return;
        const art = subsetByPrefix(wallAsset, WALL_PREFIX);
        add(instanceAsset(art, seatOn(walls, SURFACE.gutter, assetBaseY(art), MODULE_SCALE.wall)));
      }

      const metros = planMetros(view);
      if (metros.length) {
        const metroAsset = await loadAsset("metros.glb", palette);
        if (cancelled) return;
        // One draw per track: the track picks the model and landmark colour,
        // the seat tints the compound (an instance colour). See
        // tools/blender/edits/0036_seat_tint_the_metropolises.py.
        const tintable = tintableAsset(metroAsset);
        const byTrack = new Map<number, ReturnType<typeof metroDraws>>();
        for (const draw of metroDraws(metros)) {
          byTrack.set(draw.track, [...(byTrack.get(draw.track) ?? []), draw]);
        }
        for (const [track, groups] of byTrack) {
          const art = subsetByPrefix(tintable, METRO_PREFIX[track]);
          const at = groups.flatMap(({ seat, at: mine }) => {
            const tint = seatTint(colorOf(seat));
            return mine.map((m) => ({ position: m.position, key: m.key, tint }));
          });
          add(instanceAsset(art, seatOn(at, SURFACE.gutter, assetBaseY(art), MODULE_SCALE.metro)), {
            tinted: true,
          });
          // A metropolis replaces its city, so the pieces pass never numbers
          // it. Per seat, since a numeral is the seat.
          if (numberPieces) {
            const [lo, hi] = assetSpanY(art);
            const top = SURFACE.gutter + (hi - lo) * MODULE_SCALE.metro;
            for (const { seat, at: mine } of groups) {
              builtNumerals.push(...buildSeatNumerals(seat + 1, mine, top));
            }
          }
        }
      }

      const merchant = planMerchant(view);
      if (merchant.length) {
        const traderAsset = await loadAsset("trader.glb", palette);
        if (cancelled) return;
        const art = subsetByPrefix(traderAsset, MERCHANT_PREFIX);
        // A constant key lets the next build recognise the merchant at a new
        // hex and carry it there (see startMerchant).
        const at = merchant.map((p) => ({ ...p, key: MERCHANT_KEY }));
        add(instanceAsset(art, seatOn(at, SURFACE.land, assetBaseY(art), MODULE_SCALE.merchant)));
      }

      // --- Caravans ----------------------------------------------------
      //
      // Neutral: no tint, one draw for the board. A camel takes the road's
      // placement and ground (the gutter), standing beside a road on the same
      // path. Its art is authored at drawn size (MODULE_SCALE.camel is 1).
      //
      // On a pure sea path (with Islands) it rides a punt, not seated:
      // `planCamels` already floats the camel's frame on the mean water line.
      const camels = planCamels(view);
      if (camels.length) {
        const camelAsset = await loadAsset("camels.glb", palette);
        if (cancelled) return;
        const art = subsetByPrefix(camelAsset, CAMEL_PREFIX);
        const ashore = camels.filter((c) => !c.onSea);
        const afloat = camels
          .filter((c) => c.onSea)
          .map((c) => ({ ...c, scale: MODULE_SCALE.camel, groundY: c.position[1] }));
        add(
          instanceAsset(art, [
            ...seatOn(ashore, SURFACE.gutter, assetBaseY(art), MODULE_SCALE.camel),
            ...afloat,
          ]),
        );
        const rafts = planRafts(view);
        if (rafts.length) {
          const raftArt = subsetByPrefix(camelAsset, RAFT_PREFIX);
          add(
            instanceAsset(
              raftArt,
              rafts.map((r) => ({ ...r, scale: MODULE_SCALE.raft, groundY: r.position[1] })),
            ),
          );
        }
      }

      // The wayposts, on spokes no camel has taken yet. Same slot, seat and
      // scale as the camel that replaces one (`planSpokes` drops a spoke once a
      // camel stands on it). Drawn from the start, so the key edges are marked
      // before the first auction resolves.
      const spokes = planSpokes(view);
      if (spokes.length) {
        const spokeAsset = await loadAsset("spokes.glb", palette);
        if (cancelled) return;
        const art = subsetByPrefix(spokeAsset, SPOKE_PREFIX);
        add(
          instanceAsset(art, seatOn(spokes, SURFACE.gutter, assetBaseY(art), MODULE_SCALE.spoke)),
        );
      }

      // --- Rivers ------------------------------------------------------
      //
      // The bridges: seat-tinted like ships, since a bridge is owned and blocks
      // like a road. One draw, tint per instance (see `tintableAsset`). Road
      // slot, gutter ground and road scale (`MODULE_SCALE.bridge`), so a bridge
      // differs from a road only by its arch and authored height (see
      // `bridgeArt.test.ts`).
      const bridges = planBridges(view);
      if (bridges.length) {
        const bridgeAsset = await loadAsset("bridges.glb", palette);
        if (cancelled) return;
        const art = subsetByPrefix(tintableAsset(bridgeAsset), BRIDGE_PREFIX);
        const at = bridges.map((b) => ({ ...b, tint: seatTint(colorOf(b.owner)) }));
        add(instanceAsset(art, seatOn(at, SURFACE.gutter, assetBaseY(art), MODULE_SCALE.bridge)), {
          tinted: true,
        });
      }

      // --- Wagons ------------------------------------------------------
      //
      // Two draws. (The trade hexes are terrain, drawn in the static half
      // through `tradeTileOverrides`.)
      //
      // The wagon is seat-tinted and stands on an intersection, on the land
      // surface; several may share one, so `planWagons` rings them.
      //
      // The barbarian is neutral and lies across the path it blocks, on the
      // road's ground.
      const wagons = planWagons(view);
      if (wagons.length) {
        const wagonAsset = await loadAsset("wagons.glb", palette);
        if (cancelled) return;
        const art = subsetByPrefix(tintableAsset(wagonAsset), WAGON_PREFIX);
        const at = wagons.map((w) => ({ ...w, tint: seatTint(colorOf(w.owner)) }));
        add(instanceAsset(art, seatOn(at, SURFACE.land, assetBaseY(art), MODULE_SCALE.wagon)), {
          tinted: true,
        });
      }

      const pathBarbarians = planPathBarbarians(view);
      if (pathBarbarians.length) {
        const barbAsset = await loadAsset("barbarians.glb", palette);
        if (cancelled) return;
        const art = subsetByPrefix(barbAsset, PATH_BARBARIAN_PREFIX);
        add(
          instanceAsset(
            art,
            seatOn(pathBarbarians, SURFACE.gutter, assetBaseY(art), MODULE_SCALE.pathBarbarian),
          ),
        );
      }

      // --- Fishermen ---------------------------------------------------
      //
      // The weirs, then the grounds' number chips: a weir marks a paying
      // corner, the chip names the number.
      const weirs = planWeirs(view);
      if (weirs.length) {
        const weirAsset = await loadAsset("fishing.glb", palette);
        if (cancelled) return;
        const art = subsetByPrefix(weirAsset, WEIR_PREFIX);
        // Not seated, the one such placement: the weir is planted in the water
        // (stakes below the sea tile's top, floats at the crest), and `seatOn`
        // would lift it out. The authored heights are final; only the turn is
        // added.
        add(
          instanceAsset(
            art,
            weirs.map((w) => ({ ...w, scale: MODULE_SCALE.fishingGround })),
          ),
        );
      }

      // The shallows under each ground's chip. Not seated, like the weir: the
      // file's y = 0 is the mean waterline.
      const grounds = planFishingGrounds(view);
      if (grounds.length) {
        const fishAsset = await loadAsset("fishing.glb", palette);
        if (cancelled) return;
        const art = subsetByPrefix(fishAsset, FISHGROUND_PREFIX);
        if (art.scene.children.length) add(instanceAsset(art, grounds));
      }

      // A ground's number, as an ordinary chip in the middle of its sea hex.
      //
      // Seated on OCEAN_MAX_Y so the swell never washes over it. `chipTopRef`
      // is not written here: the robber never stands on water.
      const groundChips = planGroundChips(view);
      if (groundChips.length) {
        const chipAsset = await loadAsset("chips.glb", palette);
        if (cancelled) return;
        const groups = new Map<string, Placement[]>();
        for (const c of groundChips) {
          const prefix = chipPrefix(c.number, c.variant);
          groups.set(prefix, [...(groups.get(prefix) ?? []), { position: c.position, key: c.key }]);
        }
        for (const [prefix, placements] of groups) {
          const art = chipArt(chipAsset, prefix);
          add(instanceAsset(art, seatOn(placements, OCEAN_MAX_Y, assetBaseY(art))));
        }
      }

      // --- Raiders -----------------------------------------------------
      //
      // A rider is a seat's figure on a path; a raider is a neutral figure on a
      // hex. Riders are tinted with their owner's colour (`tintableAsset`);
      // raiders never are. Riders take the road's seat and scale (SURFACE.gutter,
      // MODULE_SCALE.rider), sharing a path with a road or a camel.
      const riders = planRiders(view);
      if (riders.length) {
        const riderAsset = await loadAsset("riders.glb", palette);
        if (cancelled) return;
        const art = subsetByPrefix(tintableAsset(riderAsset), RIDER_PREFIX);
        const at = riders.map((r) => ({ ...r, tint: seatTint(colorOf(r.owner)) }));
        add(instanceAsset(art, seatOn(at, SURFACE.gutter, assetBaseY(art), MODULE_SCALE.rider)), {
          tinted: true,
        });
      }

      // --- Explorers ---------------------------------------------------
      //
      // The fleet and harbours, seat-tinted (the corsair belongs to whoever
      // placed it). `vessels.glb` holds both the cargo ship and the corsair.
      const cargoShips = planCargoShips(view);
      const corsair = planCorsair(view);
      if (cargoShips.length || corsair.length) {
        const vesselAsset = await loadAsset("vessels.glb", palette);
        if (cancelled) return;
        if (cargoShips.length) {
          // As for route ships: one draw, seat per instance. `planCargoShips`
          // separates two ships sharing a sea edge.
          const art = subsetByPrefix(tintableAsset(vesselAsset), CARGO_PREFIX);
          const at = cargoShips.map((s) => ({ ...s, tint: seatTint(colorOf(s.owner)) }));
          add(instanceAsset(art, seatOn(at, SURFACE.sea, assetBaseY(art), MODULE_SCALE.cargo)), {
            tinted: true,
          });
        }
        if (corsair.length) {
          // Tinted only when the owner is known (`pirate_owner`, never
          // `pirate_by`; see `planCorsair`). -1 means an older server, so the
          // palette's own colours are used.
          const owner = corsair[0].owner;
          const tinted = owner >= 0;
          const art = subsetByPrefix(
            tinted ? tintableAsset(vesselAsset) : vesselAsset,
            CORSAIR_PREFIX,
          );
          const at = tinted
            ? corsair.map((c) => ({ ...c, tint: seatTint(colorOf(owner)) }))
            : corsair;
          add(instanceAsset(art, seatOn(at, SURFACE.sea, assetBaseY(art), MODULE_SCALE.corsair)), {
            tinted,
          });
        }
      }

      // The quays: an add-on on a vertex, beside a building drawn from the
      // player's own set. Seated on the gutter; the art holds the offset.
      const quays = planQuays(view);
      if (quays.length) {
        const harborAsset = await loadAsset("harbors.glb", palette);
        if (cancelled) return;
        const art = subsetByPrefix(tintableAsset(harborAsset), QUAY_PREFIX);
        const at = quays.map((q) => ({ ...q, tint: seatTint(colorOf(q.owner)) }));
        add(instanceAsset(art, seatOn(at, SURFACE.gutter, assetBaseY(art), MODULE_SCALE.harbor)), {
          tinted: true,
        });
      }

      // The raiders: up to three per coastal hex, in the triangle
      // `layers/raiders.ts` lays out (checked against the chip by
      // `barbarianArt.test.ts`). Seated on SURFACE.land and never tinted; the
      // file has no `Seat_*` material.
      const raiderFigures = planRaiders(view);
      if (raiderFigures.length) {
        const raiderAsset = await loadAsset("barbarians.glb", palette);
        if (cancelled) return;
        const art = subsetByPrefix(raiderAsset, RAIDER_PREFIX);
        add(instanceAsset(art, seatRaiders(raiderFigures, assetBaseY(art), MODULE_SCALE.raider)));
      }

      // The pirate lairs and the crews standing on hexes, from one file. The
      // token is neutral and seated on the land (the goldfield's chip socket);
      // the figures are seat-tinted and not seated, since `tileSlotsWorld`
      // already gives their height.
      const lairs = planLairs(view);
      const hexCrews = planHexCrews(view);
      if (lairs.length || hexCrews.length) {
        const lairAsset = await loadAsset("lairs.glb", palette);
        if (cancelled) return;
        if (lairs.length) {
          const art = subsetByPrefix(lairAsset, LAIR_PREFIX);
          add(instanceAsset(art, seatOn(lairs, SURFACE.land, assetBaseY(art), MODULE_SCALE.lair)));
        }
        if (hexCrews.length) {
          const art = subsetByPrefix(tintableAsset(lairAsset), BOARDER_PREFIX);
          add(
            instanceAsset(
              art,
              hexCrews.map((c) => ({
                ...c,
                scale: MODULE_SCALE.boarder,
                groundY: c.position[1],
                tint: seatTint(colorOf(c.owner)),
              })),
            ),
            { tinted: true },
          );
        }
      }

      // What rides in the holds and basins: four families from two files,
      // each fetched only when needed.
      //
      // Not seated (like the weir): cargo stands in a recess in its host, so
      // its height comes from the host (sea line plus a ship's 1.15, or gutter
      // plus a quay's 2.0), which `planHolds` has solved.
      const holds = planHolds(view);
      const HOLD_ART: readonly { part: HoldPart; file: string; prefix: string; tinted: boolean }[] =
        [
          // Settlers belong to a seat; goods belong to nobody.
          { part: "settler", file: "harbors.glb", prefix: SETTLER_PREFIX, tinted: true },
          { part: "crew", file: "harbors.glb", prefix: CREW_PREFIX, tinted: true },
          { part: "haul", file: "cargo.glb", prefix: HAUL_PREFIX, tinted: false },
          { part: "spice", file: "cargo.glb", prefix: SPICE_PREFIX, tinted: false },
        ];
      for (const { part, file, prefix, tinted } of HOLD_ART) {
        const mine = holds.filter((h) => h.part === part);
        if (!mine.length) continue;
        const cargoAsset = await loadAsset(file, palette);
        if (cancelled) return;
        const art = subsetByPrefix(tinted ? tintableAsset(cargoAsset) : cargoAsset, prefix);
        add(
          instanceAsset(
            art,
            mine.map((h) => ({
              ...h,
              scale: MODULE_SCALE.cargoPiece,
              tint: tinted ? seatTint(colorOf(h.owner)) : undefined,
            })),
          ),
          { tinted },
        );
      }

      // Fish hauls on stocked shoals, one per shoal, neutral. Seated at the
      // swell's crest, since a shoal's middle is open water (see
      // `SHOAL_HAUL_Y`).
      const shoalHauls = planShoalHauls(view);
      if (shoalHauls.length) {
        const cargoAsset = await loadAsset("cargo.glb", palette);
        if (cancelled) return;
        const art = subsetByPrefix(cargoAsset, HAUL_PREFIX);
        add(
          instanceAsset(art, seatOn(shoalHauls, SHOAL_HAUL_Y, assetBaseY(art), SHOAL_HAUL_SCALE)),
        );
      }

      // The hover ghosts, last, since the pointer falls back to the disc until
      // they land. Built here, where the palette is available, and stored in a
      // ref for the handlers. Once per rig: rebuilding per update would leak a
      // material each time.
      if (!ghosts.current.size) {
        const built = await loadGhosts(
          palette,
          availableGhostKinds(view),
          resolveCssColorToHex(colorOf(view.viewer)),
          // The viewer's own set: a ghost is the piece you are about to place.
          pieceSet ?? pieceSetAssetFile(view.seat_pieces?.[view.viewer] ?? ""),
          // And the viewer's own robber (see loadGhosts), from the host, since
          // seats' equipped robbers are not on the wire.
          robberAssetFile(viewerRobber ?? ""),
        );
        // Another build may have filled the ref while this one awaited; discard
        // the loser.
        if (cancelled || ghosts.current.size) disposeGhosts(built);
        else {
          for (const ghost of built.values()) {
            // A ghost can stand on a sea edge, so it draws with the overlay pass.
            ghost.object.traverse((n) => n.layers.set(OVERLAY_LAYER));
            scene.add(ghost.object);
          }
          ghosts.current = built;
        }
        if (cancelled) return;
      }

      // Compile the new meshes' programs while the old board is still on
      // screen, so the swap does not freeze the page. Numerals take their
      // layer here so they compile for the pass that draws them.
      for (const n of builtNumerals) n.layers.set(OVERLAY_LAYER);
      await gl.current?.warm(
        [
          ...builtStatic,
          ...builtDynamic,
          ...builtNumerals,
          ...[...ghosts.current.values()].map((g) => g.object),
        ],
        () => cancelled,
      );

      commit();
      // The board is complete but not yet drawn; `draw` announces readiness
      // after the next render.
      if (!readyFired.current) readyPending.current = true;
    })().catch((err: unknown) => {
      // A build that throws must still release the host's entry screen. Most
      // `loadAsset` calls are unguarded, so one missing or LFS-pointer model
      // would otherwise leave `onReady` unfired and the page loading forever.
      // Report it and announce ready anyway: ready means a frame was drawn,
      // not that the board is complete. `cancelled` is a routine teardown.
      if (cancelled) return;
      console.error("board build failed", err);
      if (!readyFired.current) readyPending.current = true;
    });

    return () => {
      cancelled = true;
      // The meshes this build animated are about to be disposed. Start times
      // survive in `falling` and `hopping`, so the next build resumes them.
      stopPieceMotion();
      // Likewise the robber, via `robberAnim` and `stillMoving`.
      stopRobber();
      // And the merchant, via `merchantTrip`.
      stopMerchant();
      // And the chips: `chipFlip` keeps the roll's clock.
      stopChips();
    };
    // `view` is not a dependency: it is a new object per server message. The
    // keys above cover everything this effect reads from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    staticBoardKey,
    piecesKey,
    colorOf,
    extent,
    numberPieces,
    pieceSet,
    seatPiecesKey,
    robberSkinKey,
  ]);

  /**
   * Where the fault rings go, as plain placements. Keyed on the content of
   * `flagHexes`, since the builder's preview rebuilds the array on every check.
   */
  const flagKey = (flagHexes ?? []).map(hexKey).join(" ");
  const flagSpots = React.useMemo(
    () =>
      (flagHexes ?? []).map((h) => {
        const [x, , z] = hexToWorld(h);
        return { position: [x, MARKER_Y.land, z] as Vec3 };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flagKey],
  );

  /**
   * The ghost markers at every pointable spot.
   *
   * A separate effect: entering a build mode changes highlights without
   * changing tiles. Nothing here loads assets (geometry is generated and the
   * material unlit), so it runs synchronously and the highlights appear with
   * the mode.
   *
   * `extent` is a dependency because it changes exactly when the rig (and its
   * scene) is rebuilt.
   */
  React.useEffect(() => {
    const ctx = gl.current;
    if (!ctx) return;
    const { scene, requestDraw, ticker } = ctx;

    const built: THREE.Object3D[] = [];
    /** Adds a mesh to the overlay layer on the given order. */
    const add = (m: THREE.Object3D, order: number) => {
      m.renderOrder = order;
      m.frustumCulled = false;
      m.layers.set(OVERLAY_LAYER);
      built.push(m);
      scene.add(m);
    };

    // `none` builds nothing: no meshes, no ticker, no draw. See
    // BoardProps.markerStyle.
    const lit = markerStyle === "pedestal" || markerStyle === "swarm";

    // The pedestal style's clock, one object shared by every material it
    // builds, so the field costs one number a frame (see pedestal.ts).
    const clock = pedestalClock();
    // Fades up, and back down on the way out (see `fadingMarkers`).
    const fade = pedestalFade(ticker.reducedMotion() ? 1 : 0);
    let stopBreathing = () => {};

    /**
     * How loud the marks are when the host has not said. `restingMarkers`
     * overrides; otherwise a lit style scales with the size of its set (see
     * `restingForCount`), since the pip default (invisible) makes no sense for
     * a lit mark. The board knows the count, so it decides.
     */
    const resting = lit ? (restingMarkers ?? restingForCount(targets.length)) : restingMarkers;

    for (const [kind, placements] of markerStyle === "none" ? [] : markerPlacements(targets)) {
      if (lit) {
        // Which flat parts a spot gets depends on the spot: a tile has room for
        // a pool, a gutter corner gets only its swarm. See PEDESTAL_PARTS.
        const parts = PEDESTAL_PARTS[markerStyle][kind];
        if (parts.pool)
          add(
            instanceGeometry(
              poolGeometry(kind),
              poolMaterial(kind, clock, fade, resting),
              placements,
              `pedestal_pool_${kind}`,
            )[0],
            MARKER_RENDER_ORDER + PEDESTAL_RENDER_ORDER.pool,
          );
        if (parts.rim)
          add(
            instanceGeometry(
              rimGeometry(kind),
              rimMaterial(kind, clock, fade, resting),
              placements,
              `pedestal_rim_${kind}`,
            )[0],
            MARKER_RENDER_ORDER + PEDESTAL_RENDER_ORDER.rim,
          );
        if (parts.column)
          add(
            instanceGeometry(
              columnGeometry(kind),
              columnMaterial(kind, clock, fade, resting),
              placements,
              `pedestal_column_${kind}`,
            )[0],
            MARKER_RENDER_ORDER + PEDESTAL_RENDER_ORDER.column,
          );
        // One point cloud per kind for all spots' motes, rather than a draw
        // call per spot.
        const spec = moteSpec(markerStyle, kind);
        const motes = new THREE.Points(
          motesGeometry(placements, spec),
          motesMaterial(kind, spec, clock, fade, resting),
        );
        motes.name = `pedestal_motes_${kind}`;
        add(motes, MARKER_RENDER_ORDER + PEDESTAL_RENDER_ORDER.motes);
        continue;
      }
      // Outline first, fill on top: the ring separates a yellow pip from the
      // sand gutter.
      const parts: [THREE.BufferGeometry, THREE.Material, number][] = [
        [markerOutlineGeometry(kind), markerOutlineMaterial(false, resting), MARKER_RENDER_ORDER],
        [markerGeometry(kind), markerMaterial(kind, false, resting), MARKER_RENDER_ORDER + 1],
      ];
      for (const [geometry, material, order] of parts) {
        for (const m of instanceGeometry(geometry, material, placements, `marker_${kind}`)) {
          add(m, order);
        }
      }
    }

    // The fault rings, outside the marker loop (they draw even under
    // `markerStyle="none"`, which the builder's preview uses) and above it
    // (a fault matters more than a legal spot on the same hex).
    for (const m of instanceGeometry(
      faultRingGeometry(),
      faultRingMaterial(),
      flagSpots,
      "fault_ring",
    )) {
      add(m, MARKER_RENDER_ORDER + 2);
    }

    // Besides the sea, the only thing that animates while idle: it holds the
    // redraw open while spots are on offer, which is only during your own
    // placement, and the sea is usually redrawing anyway.
    //
    // Skipped under reduced motion. The pedestals still draw, frozen at a
    // fixed point of the breathe.
    if (lit && built.length && !ticker.reducedMotion()) {
      const born = ticker.now();
      stopBreathing = ticker.add(({ elapsedMs }) => {
        clock.value = elapsedMs / 1000;
        // The fade-in shares the breathe's subscription: same field, same clock.
        fade.value = fadeAt(elapsedMs - born, FADE_IN_MS);
        requestDraw();
      });
    }

    markers.current = built;
    requestDraw();

    return () => {
      stopBreathing();
      markers.current = [];
      // A fading field outlives this effect: the next one starts immediately,
      // so the field goes to `fadingMarkers` on the rig, which ticks it down,
      // disposes it, and frees it on teardown if needed.
      //
      // Reduced motion, or a style with nothing to fade, disposes at once.
      if (!lit || ticker.reducedMotion() || !built.length) {
        disposeMarkers(built);
        requestDraw();
        return;
      }
      const from = fade.value;
      const start = ticker.now();
      const entry: FadingMarkers = { objects: built, stop: () => {} };
      entry.stop = ticker.add(({ elapsedMs }) => {
        // Down from wherever it had got to, so a quick arm and disarm does not
        // flash to full brightness.
        fade.value = from * (1 - fadeAt(elapsedMs - start, FADE_OUT_MS));
        requestDraw();
        if (fade.value > 0) return;
        entry.stop();
        disposeMarkers(entry.objects);
        fadingMarkers.current = fadingMarkers.current.filter((f) => f !== entry);
        requestDraw();
      });
      fadingMarkers.current.push(entry);
    };
  }, [targets, extent, restingMarkers, markerStyle, flagSpots]);

  return (
    // `rounded-[inherit]` carries the container's radius to the canvas (see
    // where the renderer's border radius is set).
    <div className={`relative overflow-hidden rounded-[inherit] ${className ?? ""}`}>
      <div ref={hostRef} className="h-full w-full rounded-[inherit]" data-board3d="" />
      {/* The board's own reset, for hosts with no chrome (the preview route).
          A host passing `controlsRef` draws its own (the HUD's utility orbs). */}
      {controls && !controlsRef && <ResetViewButton onClick={() => resetView.current()} />}
    </div>
  );
});
