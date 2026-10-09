// The ghost piece's art: a translucent copy of a real board piece, standing
// where a click would put it.
//
// `ghost.ts` decides which piece to preview; this builds it and works out its
// pose. This needs the loaded glTF but no GL context, which is why it is not
// in Board3D.
//
// The node, the scale (`pieceArt`), the seating (`seating.seat`) and the turn
// (`coords.edgeRotationY`) all come from what the real pieces use, so the
// preview matches the piece that arrives. Only the material is its own.
import * as THREE from "three";
import type { FullView } from "@/lib/types";
import { parseExpansions } from "@/lib/format";
import type { GhostKind } from "./ghost";
import { assetBaseY, loadAsset, subsetByPrefixes, type LoadedAsset } from "./loader";
import type { Palette } from "./palette";
import { MODULE_SCALE, PIECE_FACING, PIECE_PREFIX, PIECE_SCALE, ROBBER_SCALE } from "./pieceArt";
import { PIRATE_PREFIX, SHIP_PREFIX } from "./layers/islands";
import { BRIDGE_PREFIX } from "./layers/rivers";
import { RIDER_PREFIX } from "./layers/raiders";
import { ROBBER_PREFIX } from "./layers/robber";
import {
  KNIGHT_PREFIX,
  KNIGHT_SWORD_PREFIX,
  MERCHANT_PREFIX,
  SWORD_STATE,
  WALL_PREFIX,
} from "./layers/knights";
import { MARKER_COLOR, MARKER_RENDER_ORDER } from "./markers";
import { seatY, SURFACE } from "./seating";
import { edgeRotationY, type Vec3 } from "./coords";
import type { PickTarget } from "./targets";

/**
 * Where each previewable piece's art comes from and how it stands.
 *
 * `align` is whether the piece lies along the edge it spans; roads and ships
 * do, and take `edgeRotationY`. Everything else takes `yaw`, the fixed turn
 * that squares its art to the board.
 *
 * `yaw` reads PIECE_FACING rather than restating it, so the ghost always faces
 * the way the built piece will. Those are all zero today because the art is
 * exported square.
 *
 * A knight ghost is a basic knight: `build_knight` places a level-1 knight,
 * and promotion is a separate action.
 */
const GHOST_ART: Record<
  GhostKind,
  {
    file: string;
    /** One node prefix, or several when a piece is drawn from more than one. */
    prefix: string | readonly string[];
    scale: number;
    surface: number;
    align: boolean;
    yaw: number;
  }
> = {
  settlement: {
    file: "pieces.glb",
    prefix: PIECE_PREFIX.settlement,
    scale: PIECE_SCALE.settlement,
    surface: SURFACE.gutter,
    align: false,
    yaw: PIECE_FACING.settlement,
  },
  city: {
    file: "pieces.glb",
    prefix: PIECE_PREFIX.city,
    scale: PIECE_SCALE.city,
    surface: SURFACE.gutter,
    align: false,
    yaw: PIECE_FACING.city,
  },
  road: {
    file: "pieces.glb",
    prefix: PIECE_PREFIX.road,
    scale: PIECE_SCALE.road,
    surface: SURFACE.gutter,
    align: true,
    yaw: PIECE_FACING.road,
  },
  ship: {
    file: "ships.glb",
    prefix: SHIP_PREFIX,
    scale: MODULE_SCALE.ship,
    surface: SURFACE.sea,
    align: true,
    yaw: 0,
  },
  bridge: {
    // The road's numbers except the file: a bridge stands in the road's slot,
    // in the gutter, aligned along its edge, at the road's drawn factor. Only
    // the silhouette differs, which shows the player this edge takes a bridge.
    // Authored square along +x, so no yaw (`bridgeArt.test.ts` asserts the
    // export carries no turn).
    file: "bridges.glb",
    prefix: BRIDGE_PREFIX,
    scale: MODULE_SCALE.bridge,
    surface: SURFACE.gutter,
    align: true,
    yaw: 0,
  },
  rider: {
    file: "riders.glb",
    prefix: RIDER_PREFIX,
    scale: MODULE_SCALE.rider,
    // The gutter, like a road. The engine only offers paths with at least one
    // adjacent land hex, so there is no sea case.
    surface: SURFACE.gutter,
    align: true,
    // Authored facing +x and left wherever the edge puts it, as in
    // `planRiders`: an `Edge` is an unordered pair with no bearing.
    yaw: 0,
  },
  knight: {
    file: "knights.glb",
    // The body and the sword in its hand; a swordless knight would look like
    // the art failed to load. Always at ease: a knight being built arrives
    // inactive, and one being removed is leaving. The at-ease sword has its
    // lean baked into the vertices, so the preview needs no pose.
    prefix: [KNIGHT_PREFIX[0], `${KNIGHT_SWORD_PREFIX[0]}${SWORD_STATE.atEase}`],
    scale: MODULE_SCALE.knight,
    surface: SURFACE.gutter,
    align: false,
    // The knight art faces +x rather than +z, out of step with the buildings.
    // Left alone: squaring it is a separate visual call (a shield seen dead-on
    // falls into its own shadow; see the shop rig in lib/board3d/thumbnail).
    yaw: 0,
  },
  knight_mighty: {
    file: "knights.glb",
    // Body and sword, at ease; see `knight`.
    prefix: [KNIGHT_PREFIX[2], `${KNIGHT_SWORD_PREFIX[2]}${SWORD_STATE.atEase}`],
    scale: MODULE_SCALE.knight,
    surface: SURFACE.gutter,
    align: false,
    // Faces +x; see `knight`.
    yaw: 0,
  },
  knight_strong: {
    file: "knights.glb",
    // Body and sword, at ease; see `knight`.
    prefix: [KNIGHT_PREFIX[1], `${KNIGHT_SWORD_PREFIX[1]}${SWORD_STATE.atEase}`],
    scale: MODULE_SCALE.knight,
    surface: SURFACE.gutter,
    align: false,
    // Faces +x; see `knight`.
    yaw: 0,
  },
  // The ring the live board draws around a walled city (Board3D's wall pass:
  // walls.glb / WALL_PREFIX, gutter surface, MODULE_SCALE.wall), from the same
  // constants. It ghosts around the city already there, so the cursor shows
  // the walled city being bought.
  wall: {
    file: "walls.glb",
    prefix: WALL_PREFIX,
    scale: MODULE_SCALE.wall,
    surface: SURFACE.gutter,
    align: false,
    // The placed wall is instanced with no turn; matching that keeps the
    // gatehouse where the preview put it.
    yaw: 0,
  },
  // The Merchant progress card's token. The only ghost standing on a hex
  // rather than in the gutter; seated at gutter height it would sink into the
  // tile. Same asset and scale as Board3D's merchant pass.
  merchant: {
    file: "trader.glb",
    prefix: MERCHANT_PREFIX,
    scale: MODULE_SCALE.merchant,
    surface: SURFACE.land,
    align: false,
    yaw: 0,
  },
  // The robber, from pieces.glb. Neutral art (Mat_Robber, outside the Seat_*
  // tints).
  //
  // `surface` is the bare tile. On a numbered hex the robber climbs onto the
  // chip, and the ghost follows through `poseGhost`'s seat override because
  // the chip height is measured off the loaded art. See `robberGhostSeat`.
  robber: {
    file: "pieces.glb",
    prefix: ROBBER_PREFIX,
    scale: ROBBER_SCALE,
    surface: SURFACE.land,
    align: false,
    yaw: 0,
  },
  // The pirate, like the robber but on the water: same file and scale as
  // Board3D's pirate pass, floating on the mean waterline.
  pirate: {
    file: "ships.glb",
    prefix: PIRATE_PREFIX,
    scale: MODULE_SCALE.pirate,
    surface: SURFACE.sea,
    align: false,
    yaw: 0,
  },
};

/**
 * How solid a ghost is.
 *
 * Solid enough to read as a piece, thin enough that the board under it stays
 * visible and a preview is never mistaken for a real piece. At 0.5 a ghost in
 * your seat colour read as a washed-out real piece.
 */
export const GHOST_OPACITY = 0.3;

/**
 * How solid a sliding ghost is, which is more.
 *
 * A sliding preview persists and travels between spots, so it gets no help
 * from appearing and disappearing; at 0.3 the eye lost it as it moved. It can
 * be more solid because it moves, which no built piece does, but it stays well
 * short of 0.5.
 */
export const SLIDE_GHOST_OPACITY = 0.44;

/**
 * Above the markers, which are already above the board.
 *
 * A ghost belongs in the markers' overlay pass: it must show behind a hill or
 * through the settlement a city ghost would replace, which a depth-tested
 * preview gets wrong.
 */
const GHOST_RENDER_ORDER = MARKER_RENDER_ORDER + 3;

/** One previewable piece, built and parked out of sight. */
export interface Ghost {
  /** Add once, then toggle `visible` and re-pose. */
  object: THREE.Object3D;
  /** Where the object's origin goes so the art stands on its surface. */
  y: number;
  /**
   * The art's own base and drawn scale, kept so the ghost can be re-seated.
   *
   * `y` covers the common case at build time. The robber's height depends on
   * the hex under the pointer (it climbs onto a number chip), so callers redo
   * the `seatY` sum for a target instead of hand-tuning an offset.
   */
  baseY: number;
  scale: number;
  /** Whether it turns to lie along the edge it is shown on. */
  align: boolean;
  /** The fixed turn that squares its art, used when it does not align. */
  yaw: number;
  /**
   * The one material the whole ghost wears, owned by this ghost and disposed
   * with it.
   *
   * Typed concretely because the hover recolours it: a preview is drawn in the
   * colour of the player whose piece it is, usually the viewer but the road's
   * owner when Diplomat is taking it away.
   */
  material: THREE.MeshBasicMaterial;
}

/**
 * A per-target correction to where a ghost stands.
 *
 * Only the robber needs one, because a number chip raises the tile it stands
 * on. Everything else is seated once at build time.
 */
export interface GhostSeat {
  /** The height the art's base lands on, replacing the ghost's own surface. */
  surface: number;
  /** Nudge along +z, the same one `planRobber` applies to sit on the chip. */
  dz?: number;
}

/**
 * Unlit, translucent and always on top: a marker's material with a piece's
 * shape, in the colour of the player it belongs to.
 *
 * The seat colour makes it a preview of your piece; translucency and drawing
 * over everything are what separate it from a real one.
 *
 * `MeshBasicMaterial` because a ghost is UI drawn into the scene, and shading
 * would make one in shadow look like a different state. Depth testing is off
 * (see GHOST_RENDER_ORDER), so the far side paints over the near side; with a
 * uniform colour that gives a solid silhouette, slightly denser where the
 * piece is thick.
 */
export function ghostMaterial(
  color: THREE.ColorRepresentation = MARKER_COLOR,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: GHOST_OPACITY,
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * Cut one piece out of a loaded asset and dress it as a ghost.
 *
 * The subset's meshes are fresh wrappers around shared geometry (see
 * `subsetByPrefix`), so re-materialising them cannot leak into the cached
 * asset the real pieces are drawn from.
 */
export function makeGhost(
  asset: LoadedAsset,
  kind: GhostKind,
  color?: THREE.ColorRepresentation,
): Ghost {
  const { prefix, scale, surface, align, yaw } = GHOST_ART[kind];
  const art = subsetByPrefixes(asset, prefix);
  const material = ghostMaterial(color);
  art.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = material;
    mesh.renderOrder = GHOST_RENDER_ORDER;
    // It moves around the board on every pointer move, so its bounding sphere
    // is always stale.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });

  // Measured before the group is scaled: `assetBaseY` reads a world-space box,
  // so scaling first would apply the scale twice (here and in `seatY`).
  const baseY = assetBaseY(art);
  const y = seatY(surface, baseY, scale);
  art.scene.scale.setScalar(scale);
  art.scene.visible = false;
  return { object: art.scene, y, baseY, scale, align, yaw, material };
}

/**
 * The pieces worth building a ghost for on this board.
 *
 * Gated on the game's expansions, like the content effect's art fetches, so a
 * base game does not request ship and knight art it cannot show.
 *
 * Asked of the ruleset, not `view.ext`: a module's state is created by its
 * first event (engine/state.go), so `ext.islands` and `ext.cak` are absent
 * when a new game's board mounts, and ghosts are built once per rig.
 * `setupPlacesCity` in ghost.ts makes the same distinction.
 *
 * The robber is unconditional because every ruleset has one.
 */
export function availableGhostKinds(view: FullView): GhostKind[] {
  const expansions = parseExpansions(view.config.ruleset);
  const kinds: GhostKind[] = ["settlement", "city", "road", "robber"];
  if (expansions.islands) kinds.push("ship", "pirate");
  if (expansions.rivers) kinds.push("bridge");
  if (expansions.knights)
    kinds.push("knight", "knight_strong", "knight_mighty", "wall", "merchant");
  if (expansions.raiders) kinds.push("rider");
  return kinds;
}

/**
 * Build every requested ghost, loading each file once.
 *
 * Tolerates a missing file, like the harbour dressing: a board whose expansion
 * art has not shipped yet previews what it has. A missing kind is absent from
 * the map and the caller falls back to the disc.
 */
export async function loadGhosts(
  palette: Palette,
  kinds: readonly GhostKind[],
  color?: THREE.ColorRepresentation,
  pieceSetFile?: string,
  robberFile?: string,
): Promise<Map<GhostKind, Ghost>> {
  const out = new Map<GhostKind, Ghost>();
  const files = new Map<string, GhostKind[]>();
  for (const kind of kinds) {
    // The viewer's own piece set decides which file the three building ghosts
    // come from, since the ghost previews the piece a click would build. Other
    // kinds keep their own art; the robber belongs to no set.
    const art = GHOST_ART[kind];
    // The robber ghost wears a robber skin, and a different one from the
    // board's: the board's robber wears `view.robber_skin` (whoever last moved
    // it), while the ghost is the piece you are about to place, so it wears
    // yours.
    const file =
      kind === "robber" && robberFile
        ? robberFile
        : pieceSetFile && SET_GHOSTS.has(kind)
          ? pieceSetFile
          : art.file;
    files.set(file, [...(files.get(file) ?? []), kind]);
  }
  for (const [file, wanted] of files) {
    const asset = await loadAsset(file, palette).catch(() => null);
    for (const kind of wanted) {
      const ghost = asset ? makeGhost(asset, kind, color) : null;
      // An empty subset means the art was renamed out from under the prefix;
      // for a set, it is not a true drop-in. Fall back to the stock art so the
      // player keeps the preview.
      if (ghost && ghost.object.children.length) {
        out.set(kind, ghost);
        continue;
      }
      ghost?.material.dispose();
      if (file === GHOST_ART[kind].file) continue; // already the stock art
      const stock = await loadAsset(GHOST_ART[kind].file, palette).catch(() => null);
      if (!stock) continue;
      const fallback = makeGhost(stock, kind, color);
      // Better a disc than an invisible ghost that swallows the marker.
      if (fallback.object.children.length) out.set(kind, fallback);
      else fallback.material.dispose();
    }
  }
  return out;
}

/**
 * The ghosts a piece set replaces: the three things you build out of your own
 * art. Kept beside `loadGhosts` because it is the only thing that reads it.
 */
const SET_GHOSTS = new Set<GhostKind>(["settlement", "city", "road"]);

/**
 * Stand a ghost at a hovered target.
 *
 * XZ comes from the target, where the marker is drawn; the height is the
 * ghost's own, since a marker floats above the ground and a piece stands on it.
 *
 * `seat` overrides the height for the robber, which stands on a hex's number
 * chip where there is one. Absent, the ghost sits where `makeGhost` seated it.
 */
export function poseGhost(ghost: Ghost, target: PickTarget, seat?: GhostSeat | null): void {
  poseGhostAt(ghost, target.pos, seat);
  ghost.object.rotation.y =
    ghost.align && target.kind === "edge" ? edgeRotationY(target.e) : ghost.yaw;
}

/**
 * Stand a ghost at a bare world point, with no target behind it.
 *
 * The core of `poseGhost`, for a carried piece leaving its ghost on the hex it
 * is leaving (see Board3D's `carryHome`); that hex is not a target.
 *
 * The yaw is left alone: only an edge alignment sets it, and only `poseGhost`
 * has an edge.
 */
export function poseGhostAt(ghost: Ghost, at: Vec3, seat?: GhostSeat | null): void {
  const y = seat ? seatY(seat.surface, ghost.baseY, ghost.scale) : ghost.y;
  ghost.object.position.set(at[0], y, at[2] + (seat?.dz ?? 0));
}

/**
 * Geometry is shared with the cached asset and outlives any one board, so only
 * the material this built is released, as in `disposeInstances`.
 */
export function disposeGhosts(ghosts: Map<GhostKind, Ghost>): void {
  for (const ghost of ghosts.values()) {
    ghost.object.removeFromParent();
    ghost.material.dispose();
  }
  ghosts.clear();
}
