// The store's 3D cards: a still each, and the real thing when you point at one.
//
// Two families share this: a robber (one neutral piece, level-on) and a piece
// set (your settlement and city in your colour, from above). See the Family
// definitions below.
//
// The grid is <img> stills so cards scroll natively; a fixed WebGL overlay
// lagged behind compositor scrolling. Hovering a card moves the one shared
// canvas inside it to show the live model.
//
// Stills are rendered here once per tab rather than baked, so a skin ships as
// just its model, and piece sets can follow the viewer's seat colour (as in
// thumbnail.ts, whose staging this borrows).
import * as React from "react";
import * as THREE from "three";
import { loadAsset, subsetByPrefix } from "@/lib/board3d/loader";
import { loadPalette, type Palette } from "@/lib/board3d/palette";
import { ROBBER_PREFIX, robberAssetFile, applyRobberChroma } from "@/lib/board3d/layers/robber";
import { stagePart } from "@/lib/board3d/thumbnail";
import { PIECE_PREFIX } from "@/lib/board3d/pieceArt";
import { supportsWebGL } from "@/lib/board3d/webgl";
import { pieceSetAssetFile } from "@/lib/pieceSets";
import { seatColor } from "@/lib/hexgeo";
import { cn } from "@/lib/utils";

/** Still size, 3:4 like the card slot it fills. */
const STILL_W = 256;
const STILL_H = 340;
/** One turn every twelve seconds: enough to read the shape, not a spinner. */
const TURN_MS = 12_000;
/**
 * The angle everything starts at: the model's front, turned 30 degrees
 * clockwise (seen from above).
 *
 * Square-on flattens the pieces and hides their asymmetric features (beak,
 * bung, brim); a slight turn reads as depth.
 *
 * The still and the hover animation both start here, so the piece does not
 * jump when pointed at.
 */
const STILL_TURN = -Math.PI / 6;

const FOV_DEG = 24;
const RAD = Math.PI / 180;

/**
 * What a card is a picture of, and how to photograph it.
 *
 * Framing is fixed per family, sized for its largest member, so relative sizes
 * stay visible between cards.
 */
interface Family {
  /** The art for one id, standing on the floor, centred on the origin. */
  build(id: string, palette: Palette, seat: string): Promise<THREE.Object3D | null>;
  /** Half the frame's height in model units, about `centreY`. */
  halfHeight: number;
  centreY: number;
  /** Where the camera sits above the ground plane, in degrees. */
  elevationDeg: number;
  /** Whether the picture changes with the viewer's seat colour. */
  seatColoured: boolean;
}

/**
 * Stand a subset on the floor and centre it on its own footprint.
 *
 * Standing on the floor gives a family a shared ground line. Centring the
 * footprint matters because the stock pieces are modelled off the origin and
 * newer sets at it.
 */
function seat(art: THREE.Object3D): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(art);
  if (!Number.isFinite(box.min.y)) return art;
  const centre = new THREE.Vector3();
  box.getCenter(centre);
  art.position.set(-centre.x, -box.min.y, -centre.z);
  const holder = new THREE.Group();
  holder.add(art);
  return holder;
}

/**
 * The robber family: one piece, level-on.
 *
 * Half-height 1.05 about y = 0.8 puts the envelope's ceiling just inside the
 * top of the frame and the ground just inside the bottom, measured against the
 * tallest skin.
 */
const ROBBER_FAMILY: Family = {
  halfHeight: 1.05,
  centreY: 0.8,
  elevationDeg: 0,
  seatColoured: false,
  async build(id, palette) {
    const asset = await loadAsset(robberAssetFile(id), palette).catch(() => null);
    if (!asset) return null;
    // A chroma shares its design's file and differs only in colour.
    const art = applyRobberChroma(subsetByPrefix(asset, ROBBER_PREFIX), id);
    if (!art.scene.children.length) return null;
    return seat(art.scene);
  },
};

/**
 * How far apart the two buildings stand on a piece-set card, and how far each
 * is pushed back or forward.
 *
 * Side by side they would be framed for width and leave the top of the
 * portrait card empty; staggered in depth, the far piece rides up the frame.
 */
const PIECE_SPREAD_X = 0.36;
const PIECE_SPREAD_Z = 0.3;

/**
 * The piece-set family: your city and your settlement, in your colour, from
 * the board's own elevation.
 *
 * The road is left out: it is too long for the frame and varies least between
 * sets.
 *
 * 34 degrees rather than the board's 56, to show more wall and less roof.
 */
const PIECES_FAMILY: Family = {
  halfHeight: 0.72,
  centreY: 0.32,
  elevationDeg: 34,
  seatColoured: true,
  async build(id, palette, seatCol) {
    const asset = await loadAsset(pieceSetAssetFile(id), palette).catch(() => null);
    if (!asset) return null;
    const group = new THREE.Group();
    // The taller city behind and left, the settlement in front and right.
    const city = stagePart(asset.scene, { file: "", prefix: PIECE_PREFIX.city }, seatCol);
    const settlement = stagePart(
      asset.scene,
      { file: "", prefix: PIECE_PREFIX.settlement },
      seatCol,
    );
    if (!city.children.length && !settlement.children.length) return null;
    // Seat each on its own footprint first, whatever its authored origin.
    const left = seat(city);
    const right = seat(settlement);
    left.position.x -= PIECE_SPREAD_X;
    left.position.z -= PIECE_SPREAD_Z;
    right.position.x += PIECE_SPREAD_X;
    right.position.z += PIECE_SPREAD_Z;
    group.add(left, right);
    return group;
  },
};

/** Which family an id belongs to. */
function familyFor(id: string): Family {
  return id.startsWith("pieces.") ? PIECES_FAMILY : ROBBER_FAMILY;
}

/** Rendered stills, kept for the life of the tab and across remounts. */
const stillCache = new Map<string, string>();

/**
 * What a subject is cached under.
 *
 * Includes the seat colour for families that wear one, so a colour change
 * re-renders them.
 */
function cacheKey(id: string, seatCol: string): string {
  return familyFor(id).seatColoured ? `${id}|${seatCol}` : id;
}

interface Entry {
  pivot: THREE.Group;
  family: Family;
}

interface Rig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  entries: Map<string, Entry>;
  /**
   * Builds in flight, so a key is built once even when the still loop and a
   * hover ask for it at the same time. A duplicate build would leave a stray
   * pivot in the scene (see `pose`).
   */
  building: Map<string, Promise<Entry | null>>;
}

let rig: Rig | null = null;

/**
 * The page's one renderer, made on first use.
 *
 * Its canvas starts detached, takes the stills, then moves into whichever card
 * is hovered. Moving a canvas keeps its context; browsers cap contexts per
 * page.
 */
function ensureRig(): Rig | null {
  if (rig) return rig;
  if (!supportsWebGL()) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      // toDataURL reads the drawing buffer, which the browser may clear after
      // a composite unless this is set.
      preserveDrawingBuffer: true,
    });
  } catch {
    return null;
  }
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral, matching the board: filmic tone mapping desaturates the flat
  // colours the art relies on.
  renderer.toneMapping = THREE.NeutralToneMapping;

  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(3, 3.4, 4);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-3, 1.5, -2);
  scene.add(key, fill, new THREE.AmbientLight(0xffffff, 1.05));

  const camera = new THREE.PerspectiveCamera(FOV_DEG, STILL_W / STILL_H, 0.1, 100);

  rig = { renderer, scene, camera, entries: new Map(), building: new Map() };
  return rig;
}

/**
 * The subject, loaded and stood on the floor. Built once per id and seat
 * colour, however many callers ask for it and whenever they ask.
 *
 * The in-flight promise is shared, since the build spans two awaits. See
 * `Rig.building`.
 */
function entryFor(id: string, seatCol: string): Promise<Entry | null> {
  const r = ensureRig();
  if (!r) return Promise.resolve(null);
  const key = cacheKey(id, seatCol);
  const have = r.entries.get(key);
  if (have) return Promise.resolve(have);
  const pending = r.building.get(key);
  if (pending) return pending;

  const build = (async () => {
    try {
      const palette = await loadPalette().catch(() => null);
      if (!palette) return null;
      const family = familyFor(id);
      const art = await family.build(id, palette, seatCol);
      if (!art) return null;

      const pivot = new THREE.Group();
      pivot.add(art);
      pivot.visible = false;
      r.scene.add(pivot);
      const entry = { pivot, family };
      r.entries.set(key, entry);
      return entry;
    } catch {
      // One card loses its picture; the grid around it is unaffected.
      return null;
    } finally {
      // Dropped either way, so a failed build is retried on the next hover.
      // Safe: registration checks for a pending build synchronously.
      r.building.delete(key);
    }
  })();
  r.building.set(key, build);
  return build;
}

/**
 * Show exactly one subject, at a given turn, from its family's camera.
 *
 * The camera moves per pose, since only one subject is ever visible.
 */
function pose(r: Rig, entry: Entry, turn: number) {
  // Hide everything in the scene, not just what `entries` holds, so a stray
  // pivot can never leak into a cached still.
  for (const child of r.scene.children) if (child instanceof THREE.Group) child.visible = false;
  entry.pivot.visible = true;
  entry.pivot.rotation.y = turn;

  const { halfHeight, centreY, elevationDeg } = entry.family;
  const dist = halfHeight / Math.tan((FOV_DEG * RAD) / 2);
  const el = elevationDeg * RAD;
  r.camera.position.set(0, centreY + Math.sin(el) * dist, Math.cos(el) * dist);
  r.camera.lookAt(0, centreY, 0);
}

/** Photograph one subject, or null if this client cannot draw it. */
async function renderStill(id: string, seatCol: string): Promise<string | null> {
  const key = cacheKey(id, seatCol);
  const cached = stillCache.get(key);
  if (cached) return cached;
  const r = ensureRig();
  const entry = await entryFor(id, seatCol);
  if (!r || !entry) return null;

  r.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.renderer.setSize(STILL_W, STILL_H, false);
  r.camera.aspect = STILL_W / STILL_H;
  r.camera.updateProjectionMatrix();
  pose(r, entry, STILL_TURN);
  r.renderer.render(r.scene, r.camera);
  const url = r.renderer.domElement.toDataURL("image/webp", 0.92);
  stillCache.set(key, url);
  return url;
}

interface GalleryValue {
  /** Data URLs by cache key; absent until rendered, or forever without WebGL. */
  stills: Record<string, string>;
  seatColor: string;
  register: (id: string) => void;
  hover: (id: string | null, host: HTMLElement | null) => void;
}

/** Exported for tests: a slot's behaviour is entirely a conversation with this
 *  context, and the provider it normally comes from needs WebGL. */
export const GalleryContext = React.createContext<GalleryValue | null>(null);

export function useCosmeticGallery() {
  return React.useContext(GalleryContext);
}

/**
 * A card's picture: the still, replaced by the turning subject while pointed
 * at.
 *
 * Both live inside the card, so both scroll with it.
 */
export function CosmeticSlot({ id, className }: { id: string; className?: string }) {
  const gallery = useCosmeticGallery();
  const host = React.useRef<HTMLDivElement | null>(null);
  const [live, setLive] = React.useState(false);
  const still = gallery ? gallery.stills[cacheKey(id, gallery.seatColor)] : undefined;
  const register = gallery?.register;

  React.useEffect(() => {
    register?.(id);
  }, [register, id]);

  function enter() {
    if (!gallery || !host.current) return;
    setLive(true);
    gallery.hover(id, host.current);
  }
  function leave() {
    if (!gallery) return;
    setLive(false);
    gallery.hover(null, null);
  }

  /** A pointer that hovers. Touch and pen "enter" on contact and "leave" on
   *  release, so they use the tap toggle below instead. */
  const hovers = (t: string) => t === "" || t === "mouse";

  function keyboardFocus(el: HTMLElement) {
    // Engines without :focus-visible (jsdom) throw; treat that as keyboard.
    try {
      return el.matches(":focus-visible");
    } catch {
      return true;
    }
  }

  /**
   * Tap to turn it on, tap again to turn it off: the only way to reach the
   * turning preview on touch devices.
   */
  function tap(e: React.PointerEvent) {
    if (hovers(e.pointerType)) return;
    if (live) leave();
    else enter();
  }

  return (
    <div
      ref={host}
      className={`relative overflow-hidden ${className ?? ""}`}
      onPointerEnter={(e) => hovers(e.pointerType) && enter()}
      onPointerLeave={(e) => hovers(e.pointerType) && leave()}
      onPointerDown={tap}
      // Keyboard focus only (`:focus-visible`); a tap also focuses a tabbable
      // element.
      onFocus={(e) => keyboardFocus(e.currentTarget) && enter()}
      onBlur={leave}
      // Keyboard users can turn it too.
      tabIndex={still ? 0 : -1}
    >
      {/* No still yet, or no WebGL to take one: the card stays empty. */}
      {still && (
        <img
          src={still}
          alt=""
          draggable={false}
          // Hidden rather than unmounted, so the card does not collapse for a
          // frame on hover.
          className={cn("w-full h-full object-contain", live ? "invisible" : "visible")}
        />
      )}
    </div>
  );
}

export function CosmeticGallery({
  children,
  seatColor: seatCol = seatColor(0),
}: {
  children: React.ReactNode;
  /**
   * The colour the seat-coloured families are drawn in: the viewer's own, from
   * their loadout.
   */
  seatColor?: string;
}) {
  const [stills, setStills] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(stillCache),
  );
  const wanted = React.useRef(new Set<string>());
  const [pending, setPending] = React.useState(0);
  // `since` is when this hover began: the turn is measured from it, so every
  // subject starts its rotation at STILL_TURN rather than at the page's age.
  const hovered = React.useRef<{ id: string; host: HTMLElement; since: number } | null>(null);

  const register = React.useCallback((id: string) => {
    if (wanted.current.has(id)) return;
    wanted.current.add(id);
    setPending((n) => n + 1);
  }, []);

  // Take the stills one at a time, to avoid a hitch on mount and let cards
  // fill in as they land. Re-runs when the seat colour changes; robbers are
  // cached under a colourless key and cost nothing.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const id of [...wanted.current]) {
        if (cancelled) return;
        const key = cacheKey(id, seatCol);
        if (stillCache.has(key)) continue;
        const url = await renderStill(id, seatCol);
        if (cancelled || !url) continue;
        setStills((prev) => ({ ...prev, [key]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pending, seatCol]);

  const hover = React.useCallback(
    (id: string | null, host: HTMLElement | null) => {
      const r = ensureRig();
      if (!r) return;
      if (!id || !host) {
        hovered.current = null;
        r.renderer.domElement.remove();
        return;
      }
      hovered.current = { id, host, since: performance.now() };
      void entryFor(id, seatCol).then(() => {
        // Still the card the pointer is on? A quick sweep across the grid can
        // resolve these out of order.
        if (hovered.current?.id !== id) return;
        const canvas = r.renderer.domElement;
        canvas.style.position = "absolute";
        canvas.style.inset = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        host.appendChild(canvas);
      });
    },
    [seatCol],
  );

  // One loop for the page, doing nothing at all unless a card is hovered.
  React.useEffect(() => {
    let raf = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const r = rig;
      const on = hovered.current;
      if (!r || !on || !r.renderer.domElement.parentElement) return;
      const canvas = r.renderer.domElement;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;

      // The UI zooms past 1700px (index.css), so render at the zoomed density.
      const scale = canvas.getBoundingClientRect().width / w || 1;
      const dpr = Math.min(devicePixelRatio * scale, 2);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        r.renderer.setPixelRatio(dpr);
        r.renderer.setSize(w, h, false);
      }
      const entry = r.entries.get(cacheKey(on.id, seatCol));
      if (!entry) return;
      if (r.camera.aspect !== w / h) {
        r.camera.aspect = w / h;
        r.camera.updateProjectionMatrix();
      }
      const turned = ((now - on.since) / TURN_MS) * Math.PI * 2;
      pose(r, entry, STILL_TURN + (reduced ? 0 : turned));
      r.renderer.render(r.scene, r.camera);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [seatCol]);

  const value = React.useMemo<GalleryValue>(
    () => ({ stills, seatColor: seatCol, register, hover }),
    [stills, seatCol, register, hover],
  );

  return <GalleryContext.Provider value={value}>{children}</GalleryContext.Provider>;
}
