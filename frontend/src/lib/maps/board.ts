import type { Board, BoardTile, Harbor, Hex, Resource } from "@/lib/types";
import { edgeHexes, hexKey } from "@/lib/hexgeo";

export type BuilderMode = "shape" | "design";

/** The five bankable producing resources, in palette order. */
export const PRODUCING: Resource[] = ["wood", "brick", "sheep", "wheat", "ore"];
/** Everything a design tile can be set to: producing resources, gold, and unset (none). */
export const DESIGN_RESOURCES: Resource[] = [...PRODUCING, "gold", "none"];

const isProducing = (r: Resource) => PRODUCING.includes(r);

/**
 * Which terrains can carry a dice token: the five producing resources plus gold
 * (the engine's `takesNumber`). A number on any other tile is not drawn by the
 * design canvas and cannot be recovered, so swaps must respect this.
 */
export const canHoldNumber = (r: Resource) => isProducing(r) || r === "gold";

/**
 * Classify a loaded board. Any concrete producing resource or non-zero number
 * means the author chose contents, so it loads in design mode. Only generic
 * land / desert / sea / gold with no numbers is a shape (contents rolled at
 * game start).
 */
export function detectMode(b: Board): BuilderMode {
  for (const t of b.tiles) {
    if (isProducing(t.res) || t.num !== 0) return "design";
  }
  return "shape";
}

/**
 * Collapse a painted design board back to the silhouette a roll starts from:
 * every resource and desert the fill chose becomes generic land with no token,
 * while water, lake, border, fog and gold keep their hex.
 *
 * This makes Randomize produce a new map. The server's `StripToShape`
 * (engine/board/generate.go) pins deserts so a desert painted in Shape mode
 * stays put, but on a design board the deserts came from the previous roll and
 * should be re-rolled too.
 *
 * Gold survives because nothing rolls it: `Resolve` fills land with the five
 * producing resources only, so flattening gold would delete the author's
 * Islands terrain.
 */
export function stripToShape(b: Board): Board {
  return {
    ...b,
    tiles: b.tiles.map((t) =>
      t.res === "gold" ||
      t.res === "sea" ||
      t.res === "lake" ||
      t.res === "border" ||
      t.res === "fog"
        ? { ...t, num: 0 }
        : { ...t, res: "land", num: 0 },
    ),
  };
}

function findIdx(tiles: BoardTile[], h: Hex): number {
  const k = hexKey(h);
  return tiles.findIndex((t) => hexKey(t.hex) === k);
}

/**
 * Exchange the resources of two tiles. No-op if either hex is absent.
 *
 * Numbers normally stay put (they are their own layer, swapped by the number
 * drag), so trading terrains keeps the author's token spread.
 *
 * The exception is a swap with a tile that cannot hold a token (desert, sea):
 * the token would end up invisible on it. When exactly one end can hold a
 * number, the token travels with its terrain.
 */
export function swapResource(tiles: BoardTile[], a: Hex, b: Hex): BoardTile[] {
  const ia = findIdx(tiles, a),
    ib = findIdx(tiles, b);
  if (ia < 0 || ib < 0 || ia === ib) return tiles;
  const next = tiles.map((t) => ({ ...t }));
  const carry = canHoldNumber(next[ia].res) !== canHoldNumber(next[ib].res);
  [next[ia].res, next[ib].res] = [next[ib].res, next[ia].res];
  if (carry) {
    [next[ia].num, next[ib].num] = [next[ib].num, next[ia].num];
    // Clear a stray token that was already on the non-producing tile (an older
    // board, a hand-edited code) rather than letting it appear on the other.
    if (!canHoldNumber(next[ia].res)) next[ia].num = 0;
    if (!canHoldNumber(next[ib].res)) next[ib].num = 0;
  }
  return next;
}

/** Exchange the numbers of two tiles, leaving resources in place. No-op if either hex is absent. */
export function swapNumber(tiles: BoardTile[], a: Hex, b: Hex): BoardTile[] {
  const ia = findIdx(tiles, a),
    ib = findIdx(tiles, b);
  if (ia < 0 || ib < 0 || ia === ib) return tiles;
  const next = tiles.map((t) => ({ ...t }));
  [next[ia].num, next[ib].num] = [next[ib].num, next[ia].num];
  return next;
}

/**
 * Is this hex water, as a harbor sees it?
 *
 * Two things are water: a hex the board does not hold (open ocean; the builder
 * erases by removing, and `Frame` computes the sea), and a `sea` tile (authored
 * water, as in loaded islands codes). `border` is the frame's edging. Testing
 * presence alone would strip every harbor on an islands map.
 */
function isWaterFor(tiles: BoardTile[], h: Hex): boolean {
  const t = tiles.find((x) => hexKey(x.hex) === hexKey(h));
  return !t || t.res === "sea" || t.res === "border";
}

/**
 * Drop harbors that no longer stand on a coast.
 *
 * A harbor sits on an edge with land one side and water the other; painting
 * the water side to land leaves it inland. (`removeLand` handles the opposite
 * case.)
 */
export function pruneInlandHarbors(b: Board, tiles: BoardTile[]): Harbor[] {
  return b.harbors.filter((hb) =>
    edgeHexes({ a: hb.verts[0], b: hb.verts[1] }).some((x) => isWaterFor(tiles, x)),
  );
}

/** Immutable: set one tile's resource (clearing its number if it becomes non-producing). */
export function setTileResource(tiles: BoardTile[], h: Hex, res: Resource): BoardTile[] {
  const i = findIdx(tiles, h);
  if (i < 0) return tiles;
  const next = tiles.map((t) => ({ ...t }));
  next[i].res = res;
  if (res === "none" || res === "sea") next[i].num = 0;
  return next;
}

/** Immutable: set one tile's number. */
export function setTileNumber(tiles: BoardTile[], h: Hex, num: number): BoardTile[] {
  const i = findIdx(tiles, h);
  if (i < 0) return tiles;
  const next = tiles.map((t) => ({ ...t }));
  next[i].num = num;
  return next;
}

/** Which layer a drag/click acts on: a tile's resource body or its center number chip. */
export type DragLayer = "resource" | "number";

export interface DragInput {
  tiles: BoardTile[];
  from: Hex;
  to: Hex | null; // hex under the pointer at release, or null
  layer: DragLayer; // chosen at press: chip => "number", body => "resource" (used for swaps)
  paintLayer: DragLayer; // active palette toggle: drives which layer a click-paint targets
  moved: boolean; // did the pointer leave the origin hex during the drag?
  paintRes: Resource; // active resource palette value (for a click-paint)
  paintNum: number; // active number palette value
}

/**
 * Resolve a pointer gesture over the board. A drag onto a different tile swaps
 * by the press layer (`layer`): chip-press swaps numbers, body-press swaps
 * resources. A click (or release on the same or no tile) paints by the palette
 * toggle (`paintLayer`), so the toggle works even on a tile with no chip.
 */
export function applyDrag(d: DragInput): BoardTile[] {
  const swapped = d.moved && d.to && (d.to.q !== d.from.q || d.to.r !== d.from.r);
  if (swapped) {
    return d.layer === "number"
      ? swapNumber(d.tiles, d.from, d.to!)
      : swapResource(d.tiles, d.from, d.to!);
  }
  return d.paintLayer === "resource"
    ? setTileResource(d.tiles, d.from, d.paintRes)
    : setTileNumber(d.tiles, d.from, d.paintNum);
}

/** Terrain a desert can be carved out of: the fill's generic land. */
const CARVABLE: ReadonlySet<Resource> = new Set<Resource>(["land"]);

/**
 * Pin one desert on the land tile nearest the middle of the map, the way the
 * standard board has it, and leave the rest of the shape to the roll.
 *
 * The middle is the centroid of the land, not the origin, so an off-centre or
 * strip-shaped map gets the tile a player would call its centre (measured in
 * cube distance).
 *
 * Expects a silhouette (`stripToShape` first, so a previous desert is land
 * again). The server's `Resolve` keeps a pinned desert and carves none of its
 * own. Tiles that cannot become a desert are skipped; a shape with none is
 * returned unchanged.
 */
export function centerDesert(b: Board): Board {
  const land = b.tiles.filter((t) => CARVABLE.has(t.res));
  if (land.length === 0) return b;
  // Centroid in cube coordinates (x = q, z = r, y = -q - r).
  let cx = 0;
  let cz = 0;
  for (const t of land) {
    cx += t.hex.q;
    cz += t.hex.r;
  }
  cx /= land.length;
  cz /= land.length;
  const cy = -cx - cz;
  let best = land[0];
  let bestD = Infinity;
  for (const t of land) {
    const y = -t.hex.q - t.hex.r;
    const d = Math.max(Math.abs(t.hex.q - cx), Math.abs(t.hex.r - cz), Math.abs(y - cy));
    // Strict less-than keeps the first tile in board order on a tie, so the
    // pick is stable between rolls.
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return {
    ...b,
    robber: best.hex,
    tiles: b.tiles.map((t) => (t === best ? { ...t, res: "none", num: 0 } : t)),
  };
}

/** Cube distance from the origin: the radius a hex needs to be inside. */
export const cubeDist = (h: Hex) => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r));

export const MIN_CANVAS = 2;
export const MAX_CANVAS = 10;
/** Where a fresh builder's canvas opens: room to grow the standard hexagon on every side. */
export const DEFAULT_CANVAS = 3;

/**
 * The editor's canvas: a rectangle of hexes, cols = 5*size wide and rows =
 * 2*size+1 tall (size 2 is 10x5). Pointy-top rows offset by half a hex, centred
 * on the origin. Cells without a tile draw as open water.
 */
export function rectHexes(size: number): Hex[] {
  const cols = 5 * size;
  const rows = 2 * size + 1;
  const r0 = -Math.floor(rows / 2);
  const out: Hex[] = [];
  for (let row = 0; row < rows; row++) {
    const r = r0 + row;
    const qStart = -Math.floor(cols / 2) - Math.floor(r / 2);
    for (let c = 0; c < cols; c++) out.push({ q: qStart + c, r });
  }
  return out;
}

/** The smallest canvas that holds every tile of a board, nothing cut off. */
export function fitCanvas(b: Board): number {
  const keys = b.tiles.map((t) => hexKey(t.hex));
  let size = MIN_CANVAS;
  while (size < MAX_CANVAS) {
    const rect = new Set(rectHexes(size).map(hexKey));
    if (keys.every((k) => rect.has(k))) break;
    size++;
  }
  return size;
}

/** A fresh board: a hexagon of blank land the roll fills, radius `radius`. */
export function blankBoard(radius = 2): Board {
  const tiles: BoardTile[] = [];
  for (const h of rectHexes(radius)) {
    if (cubeDist(h) <= radius) tiles.push({ hex: h, res: "land", num: 0 });
  }
  return { radius, tiles, robber: { q: 0, r: 0 }, harbors: [] };
}

/** The bounding radius of a board's tiles (never below the minimum canvas). */
function boundRadius(tiles: BoardTile[]): number {
  let radius = MIN_CANVAS;
  for (const t of tiles) radius = Math.max(radius, cubeDist(t.hex));
  return radius;
}

/** Add a blank land tile at `h` (a no-op if the hex already holds one). */
export function addLand(b: Board, h: Hex): Board {
  if (b.tiles.some((t) => hexKey(t.hex) === hexKey(h))) return b;
  const tiles = [...b.tiles, { hex: h, res: "land" as Resource, num: 0 }];
  return { ...b, tiles, harbors: pruneInlandHarbors(b, tiles), radius: boundRadius(tiles) };
}

/**
 * Erase the tile at `h`: the hex becomes open water (absent from the board, the
 * way the ocean is computed rather than authored). Ports on its edges go with
 * it, and the robber moves to another desert (or any land) if it stood there.
 */
export function removeLand(b: Board, h: Hex): Board {
  const k = hexKey(h);
  if (!b.tiles.some((t) => hexKey(t.hex) === k)) return b;
  const tiles = b.tiles.filter((t) => hexKey(t.hex) !== k);
  const has = new Set(tiles.map((t) => hexKey(t.hex)));
  const harbors = b.harbors.filter((hb) =>
    edgeHexes({ a: hb.verts[0], b: hb.verts[1] }).some((x) => has.has(hexKey(x))),
  );
  let robber = b.robber;
  if (hexKey(robber) === k) {
    const home = tiles.find((t) => t.res === "none") ?? tiles[0];
    robber = home?.hex ?? { q: 0, r: 0 };
  }
  return { ...b, tiles, harbors, robber, radius: boundRadius(tiles) };
}

/** True while any tile is still waiting for the roll: blank land, or a producing tile with no number. */
export function hasBlanks(b: Board): boolean {
  return b.tiles.some((t) => t.res === "land" || (canHoldNumber(t.res) && t.num === 0));
}
