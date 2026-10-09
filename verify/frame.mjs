// Board.Frame, ported from engine/board/frame.go.
//
// Frame computes a board's ocean from its land. Every gallery map except the
// three full-hexagon "standard" ones authors land only (see
// frontend/src/lib/maps/gallery.ts); the engine runs this at game start.
//
// It draws no randomness: Frame runs before the rng is minted
// (engine/state.go: Clone, Frame, then rngFor(seed, 1) for Resolve).
//
// Nothing here depends on map iteration order. Go's map ranges are randomized,
// so the original makes every choice by an explicit sort or lexicographic
// minimum, and those are ported as written (see connectComponents).

import { hex, hexKey, neighbors, hexesInRadius, abs } from "./coords.mjs";
import { ResNone, Wood, Brick, Sheep, Wheat, Ore, Gold, Sea, Lake, ResLand, Border } from "./board.mjs";

/** hexFromKey inverts coords.mjs's hexKey. */
export function hexFromKey(k) {
  const i = k.indexOf(",");
  return hex(Number(k.slice(0, i)), Number(k.slice(i + 1)));
}

/**
 * cross2 returns twice the signed area of triangle o -> a -> b in doubled axial
 * coordinates (X = 2q+r, Y = r). The sqrt(3)/2 scale on Y is a positive
 * constant that factors out of the cross product, so the sign of this
 * all-integer expression is the exact geometric orientation. Positive =
 * counter-clockwise, zero = collinear.
 */
function cross2(o, a, b) {
  const ox = 2 * o.q + o.r, oy = o.r;
  const ax = 2 * a.q + a.r, ay = a.r;
  const bx = 2 * b.q + b.r, by = b.r;
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

/** doubledLess is the sort order both hull passes use: X ascending, then R. */
function doubledLess(a, b) {
  const xa = 2 * a.q + a.r, xb = 2 * b.q + b.r;
  if (xa !== xb) return xa - xb;
  return a.r - b.r;
}

/**
 * convexHull returns the convex hull of the land hex centers via Andrew's
 * monotone chain in doubled coords. The `<= 0` pop drops collinear points, so
 * the result is strictly convex; collinear or fewer-than-3-point input yields
 * the <=2 extreme points (handled as a degenerate segment by the fill).
 *
 * Go sorts with sort.Slice, which is not stable and does not need to be:
 * (X, R) determines a hex uniquely (q = (X-R)/2), so the comparator is a strict
 * total order over distinct points and no tie can arise.
 */
function convexHull(solid) {
  const pts = [...solid].map(hexFromKey);
  pts.sort(doubledLess);
  if (pts.length < 3) return pts;
  const hull = [];
  for (const p of pts) { // lower chain
    while (hull.length >= 2 && cross2(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
    hull.push(p);
  }
  const lower = hull.length + 1;
  for (let i = pts.length - 2; i >= 0; i--) { // upper chain
    const p = pts[i];
    while (hull.length >= lower && cross2(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
    hull.push(p);
  }
  return hull.slice(0, hull.length - 1); // drop the duplicated start point
}

/**
 * hexDist is the cube distance between two hexes.
 *
 * Exported for the Rivers port in modules.mjs, which needs the same distance:
 * engine/rivers/board.go writes its own `hexDist` with the same three terms,
 * and transcribing it a second time would put two implementations of one
 * formula into a bundle that shares a single scope (scripts/bundle-verify.mjs
 * concatenates these modules and refuses a duplicate top-level name). One
 * definition, imported.
 */
export function hexDist(a, b) {
  return (abs(a.q - b.q) + abs(a.r - b.r) + abs(a.q + a.r - b.q - b.r)) / 2;
}

/**
 * hexLine returns a connected chain of hexes from a to b (each consecutive
 * pair is adjacent). It steps greedily toward b, breaking ties by (Q,R) so the
 * path is deterministic. Because every step lands on a neighbor strictly closer
 * to b, it terminates in hexDist(a,b) steps.
 *
 * The tie-break compares the candidate against `best`, which is the incumbent
 * and starts as `cur` itself, not against the best-so-far distance alone, as
 * the Go does.
 */
function hexLine(a, b) {
  const out = [a];
  let cur = a;
  while (cur.q !== b.q || cur.r !== b.r) {
    let best = cur;
    let bestD = 1 << 30;
    for (const n of neighbors(cur)) {
      const d = hexDist(n, b);
      if (d < bestD || (d === bestD && (n.q < best.q || (n.q === best.q && n.r < best.r)))) {
        best = n;
        bestD = d;
      }
    }
    cur = best;
    out.push(cur);
  }
  return out;
}

/** floorDiv / ceilDiv mirror Go's integer division (d > 0). */
function floorDiv(n, d) {
  if (n >= 0) return Math.floor(n / d);
  return -Math.floor((-n + d - 1) / d);
}

function ceilDiv(n, d) {
  if (n >= 0) return Math.floor((n + d - 1) / d);
  return -Math.floor(-n / d);
}

/**
 * scanlineFill returns every hex inside the convex hull, filling each row's
 * full span between the hull's left and right edges. In doubled coords a hex
 * (q,r) sits at X=2q+r on row Y=r (so X = r mod 2). For each row the convex
 * hull meets a single X-interval [xlo,xhi] (rational, from where the edges
 * cross Y=r); every real hex whose center X lies in it is filled. Because every
 * row is one contiguous span and a convex hull's rows overlap, the result is
 * solid (no interior holes) and connected. Requires a hull with area (3+
 * non-collinear vertices); degenerate hulls are the caller's problem.
 */
function scanlineFill(hull) {
  const out = new Set();
  const xOf = (h) => 2 * h.q + h.r;
  let minR = hull[0].r, maxR = hull[0].r;
  for (const h of hull) {
    minR = Math.min(minR, h.r);
    maxR = Math.max(maxR, h.r);
  }
  const n = hull.length;
  for (let r = minR; r <= maxR; r++) {
    // Row X-interval as rationals loN/loD .. hiN/hiD with loD, hiD > 0.
    let have = false;
    let loN = 0, loD = 0, hiN = 0, hiD = 0;
    const consider = (xn, xd) => {
      if (xd < 0) { xn = -xn; xd = -xd; }
      if (!have) {
        loN = xn; loD = xd; hiN = xn; hiD = xd; have = true;
        return;
      }
      if (xn * loD < loN * xd) { loN = xn; loD = xd; }
      if (xn * hiD > hiN * xd) { hiN = xn; hiD = xd; }
    };
    for (let i = 0; i < n; i++) {
      const a = hull[i], b = hull[(i + 1) % n];
      if (a.r === b.r) { // horizontal edge: both ends bound this row
        if (a.r === r) {
          consider(xOf(a), 1);
          consider(xOf(b), 1);
        }
        continue;
      }
      if (r < Math.min(a.r, b.r) || r > Math.max(a.r, b.r)) continue;
      // X where edge a -> b crosses Y=r, as a rational num/den.
      consider(xOf(a) * (b.r - a.r) + (xOf(b) - xOf(a)) * (r - a.r), b.r - a.r);
    }
    if (!have) continue;
    for (let x = ceilDiv(loN, loD); x <= floorDiv(hiN, hiD); x++) {
      if ((x - r) & 1) continue; // X must share r's parity to be a real hex center
      out.add(hexKey(hex((x - r) / 2, r)));
    }
  }
  return out;
}

/**
 * hullInside returns the land plus the solid interior of its convex hull. A
 * hull with area (3+ vertices; the monotone chain drops collinear points, so
 * 3+ implies non-collinear) is filled solid by scanlineFill, and its edges are
 * rasterized as hex lines so even a sliver too thin for any scanline row stays
 * connected. A degenerate hull (a single point or a line) has no area, so its
 * land hexes are simply joined in order along the line. The narrow gap a
 * rasterized edge can leave beside the scanline fill is healed by frameBoard's
 * enclosed-fill.
 */
function hullInside(solid) {
  const out = new Set(solid);
  const hull = convexHull(solid);
  if (hull.length >= 3) {
    for (const k of scanlineFill(hull)) out.add(k);
    const n = hull.length;
    for (let i = 0; i < n; i++) {
      for (const h of hexLine(hull[i], hull[(i + 1) % n])) out.add(hexKey(h));
    }
    return out;
  }
  // Degenerate hull: the land is collinear (or a single hex). Connect the land
  // hexes in order along the line; joining only the two extreme hull vertices
  // could zig-zag past a middle hex and strand it.
  const pts = [...solid].map(hexFromKey);
  pts.sort(doubledLess);
  for (let i = 1; i < pts.length; i++) {
    for (const h of hexLine(pts[i - 1], pts[i])) out.add(hexKey(h));
  }
  return out;
}

/** lessHex orders hexes lexicographically by (Q, R). */
function lessHex(a, b) { return a.q < b.q || (a.q === b.q && a.r < b.r); }

function minHex(hs) {
  let m = hs[0];
  for (const h of hs) if (lessHex(h, m)) m = h;
  return m;
}

/**
 * tileComponents returns the connected components (6-neighbor) of the tile
 * footprint. Component contents are deterministic; their order is not (in Go),
 * so every consumer here treats them as sets.
 */
function tileComponents(tiles) {
  const seen = new Set();
  const comps = [];
  for (const startKey of tiles.keys()) {
    if (seen.has(startKey)) continue;
    const comp = [];
    const stack = [hexFromKey(startKey)];
    seen.add(startKey);
    while (stack.length > 0) {
      const cur = stack.pop();
      comp.push(cur);
      for (const nb of neighbors(cur)) {
        const k = hexKey(nb);
        if (tiles.has(k) && !seen.has(k)) {
          seen.add(k);
          stack.push(nb);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

/**
 * connectComponents bridges every connected component of the tile footprint
 * into one with sea. While more than one component exists, it joins the two
 * closest hexes of two different components with a hex line of Sea.
 *
 * Deterministic by construction: it roots at the component holding
 * the lexicographically smallest hex, and picks the bridge as the lexicographic
 * minimum of (distance, root hex, other hex) over every cross pair, so the
 * answer does not depend on the order components or their members come out in.
 * Without that the bridge varies run to run and breaks replay == live.
 */
function connectComponents(tiles) {
  for (;;) {
    const comps = tileComponents(tiles);
    if (comps.length <= 1) return;
    let rootIdx = 0;
    for (let i = 0; i < comps.length; i++) {
      if (lessHex(minHex(comps[i]), minHex(comps[rootIdx]))) rootIdx = i;
    }
    let ra = null, rb = null;
    let best = 1 << 30;
    let found = false;
    for (let i = 0; i < comps.length; i++) {
      if (i === rootIdx) continue;
      for (const h of comps[i]) {
        for (const g of comps[rootIdx]) {
          const d = hexDist(h, g);
          const tie = d === best && (lessHex(g, ra) || (g.q === ra.q && g.r === ra.r && lessHex(h, rb)));
          if (!found || d < best || tie) {
            best = d; ra = g; rb = h; found = true;
          }
        }
      }
    }
    for (const h of hexLine(ra, rb)) {
      const k = hexKey(h);
      if (!tiles.has(k)) tiles.set(k, { res: Sea, number: 0 });
    }
  }
}

function cubeDistOrigin(h) { return Math.max(abs(h.q), abs(h.r), abs(h.q + h.r)); }

/**
 * fillEnclosed adds every absent hex that the tile footprint encloses. It
 * flood-fills the exterior from the ring just past the footprint's extent
 * through absent hexes; any in-range absent hex the flood cannot reach is
 * sealed inside and becomes Sea. The coastal margin is a complete one-hex ring
 * around the land+ocean, so the flood can never reach a sealed interior. This
 * plugs the thin notches edge rasterization leaves.
 */
function fillEnclosed(tiles) {
  let limit = 0;
  for (const k of tiles.keys()) {
    const d = cubeDistOrigin(hexFromKey(k));
    if (d > limit) limit = d;
  }
  limit++;

  const exterior = new Set();
  const queue = [];
  for (const h of hexesInRadius(limit)) {
    if (cubeDistOrigin(h) === limit && !tiles.has(hexKey(h))) {
      exterior.add(hexKey(h));
      queue.push(h);
    }
  }
  while (queue.length > 0) {
    const cur = queue.pop();
    for (const nb of neighbors(cur)) {
      const k = hexKey(nb);
      if (cubeDistOrigin(nb) > limit || tiles.has(k)) continue;
      if (exterior.has(k)) continue;
      exterior.add(k);
      queue.push(nb);
    }
  }
  for (const h of hexesInRadius(limit - 1)) {
    const k = hexKey(h);
    if (tiles.has(k)) continue;
    if (!exterior.has(k)) tiles.set(k, { res: Sea, number: 0 }); // enclosed
  }
}

/** extent returns the max cube-distance of any tile hex from the origin. */
function extent(tiles) {
  let m = 0;
  for (const k of tiles.keys()) {
    const d = cubeDistOrigin(hexFromKey(k));
    if (d > m) m = d;
  }
  return m;
}

/**
 * firstGroundHex returns the non-sea tile with the smallest (Q,R): a
 * deterministic landing spot for a relocated robber. It tests `res === Sea`
 * rather than "is ground", as the Go does; after framing the map holds nothing
 * else, so the two agree, and transcribing the weaker test keeps them agreeing
 * if that ever stops being true in one language only.
 */
function firstGroundHex(tiles) {
  let first = true;
  let best = hex(0, 0);
  for (const [k, t] of tiles) {
    if (t.res === Sea) continue;
    const h = hexFromKey(k);
    if (first || h.q < best.q || (h.q === best.q && h.r < best.r)) {
      best = h;
      first = false;
    }
  }
  return best;
}

/**
 * isGround reports whether a resource is part of the land silhouette. Sea is
 * not ground; an absent hex (not in the map) is not ground either. Fog and any
 * unused value are not ground.
 */
function isGround(r) {
  switch (r) {
    case ResLand: case Wood: case Brick: case Sheep: case Wheat:
    case Ore: case Gold: case Lake: case ResNone: case Border:
      return true;
    default: // Sea, Fog, and any unused value
      return false;
  }
}

/** solidSet returns the keys of the ground hexes currently in b.tiles. */
function solidSet(b) {
  const out = new Set();
  for (const [k, t] of b.tiles) if (isGround(t.res)) out.add(k);
  return out;
}

/**
 * isFullHexagon reports whether solid is exactly HexesInRadius(radius): every
 * hex of the radius-r hexagon is present and ground, with none missing. This is
 * the condition under which Frame returns without touching anything, which is
 * what protects the standard maps and the full-land shape the lobby injects.
 */
function isFullHexagon(solid, radius) {
  const full = hexesInRadius(radius);
  if (solid.size !== full.length) return false;
  for (const h of full) if (!solid.has(hexKey(h))) return false;
  return true;
}

/**
 * dilate returns the union over h in s of { h + d : d in HexesInRadius(k) } --
 * every hex within cube-distance k of a member.
 */
function dilate(s, k) {
  const deltas = hexesInRadius(k);
  const out = new Set();
  for (const key of s) {
    const h = hexFromKey(key);
    for (const d of deltas) out.add(hexKey(hex(h.q + d.q, h.r + d.r)));
  }
  return out;
}

/** setDiff returns a \ b. */
function setDiff(a, b) {
  const out = new Set();
  for (const k of a) if (!b.has(k)) out.add(k);
  return out;
}

/**
 * frameBoard is Board.Frame: it computes the ocean from the land and replaces
 * the tile map in place. Pure and deterministic; the result depends solely on
 * which hexes are ground in b.tiles, never on any pre-existing sea, so
 * re-framing an already-framed board is a no-op.
 *
 * A full hexagon of ground is returned unchanged, which is what makes this a
 * no-op for the standard maps and for the full-land shape the lobby injects.
 */
export function frameBoard(b) {
  const solid = solidSet(b);

  // Skip standard maps: a full hexagon of ground at the current radius.
  if (isFullHexagon(solid, b.radius)) return;

  const inside = hullInside(solid);
  const margin = setDiff(dilate(inside, 1), inside);

  // Compose the new tile map: land keeps its tile; the hull interior and the
  // one-hex margin become Sea; everything else is absent.
  const newTiles = new Map();
  for (const k of solid) newTiles.set(k, b.tiles.get(k)); // the original tile
  for (const k of inside) {
    if (solid.has(k)) continue;
    newTiles.set(k, { res: Sea, number: 0 });
  }
  for (const k of margin) {
    if (solid.has(k)) continue; // solid wins; never overwrite ground with sea
    newTiles.set(k, { res: Sea, number: 0 });
  }

  // Plug any absent hex the land+ocean footprint encloses (e.g. a thin notch
  // beside a rasterized hull edge) so the sea has no holes.
  fillEnclosed(newTiles);

  // Guarantee one connected body: a thin hull can fragment despite the fill.
  // Bridge any leftover components with sea, then re-plug.
  connectComponents(newTiles);
  fillEnclosed(newTiles);

  b.radius = Math.max(extent(newTiles), 1);
  b.tiles = newTiles;

  // Relocate the robber if it fell off the board or onto a sea tile.
  const tl = newTiles.get(hexKey(b.robber));
  if (tl === undefined || tl.res === Sea) b.robber = firstGroundHex(newTiles);
}
