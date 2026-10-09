// Procedural board generation, ported from engine/board/{generate.go,solve.go}.
//
// This reproduces GenerateRadius: the tile bag, the number-token bag, the
// constructive layout solver (hard no-adjacent-6/8 rule plus fair mode's soft
// balancing), and harbor placement. Every rng draw happens in the same order
// and with the same arguments as the Go original.
//
// Float arithmetic in the fair-mode penalty is IEEE-754 double in both
// languages, and the expressions are written in Go's exact association order,
// so the comparisons that steer the local search agree bit for bit.

import { PCG, Rand } from "./rand.mjs";
import {
  hex, hexKey, vertKey, edgeKey, neighbors, hexVertices, hexEdges,
  vertexHexes, edgeHexes, edgeOther, hexesInRadius, sortEdges, abs,
} from "./coords.mjs";

// Resource, matching engine/board.Resource's iota order exactly. The numeric
// values index the pip-sum arrays and are what the wire format carries.
export const ResNone = 0;
export const Wood = 1;
export const Brick = 2;
export const Sheep = 3;
export const Wheat = 4;
export const Ore = 5;
export const Gold = 6;
export const Sea = 7;
export const Lake = 8;
export const Fog = 9;
export const ResLand = 10;
export const Border = 11;
// Swamp is where a river reaches the sea (Rivers): land, buildable,
// robber-legal, producing nothing. It is appended rather than placed beside
// Lake because the numeric values are a persisted encoding and are frozen.
export const Swamp = 12;

export const Resources = [Wood, Brick, Sheep, Wheat, Ore];
/** producing: a tile resource that pays out on its number. */
export const producing = (r) => r >= Wood && r <= Ore;

export const BoardRandom = "random";
export const BoardFair = "fair";

const isRed = (n) => n === 6 || n === 8;

export function pipValue(n) {
  if (n <= 0 || n === 7) return 0;
  return 6 - abs(7 - n);
}

// Fair-mode tuning, from generate.go (see the Go comments). These must match
// the Go values.
const fairPipBand = 0.34;
const hotSpot3 = 13;
const hotSpot2 = 9;
const clumpMax = 2;

// ---------------------------------------------------------------------------
// Bags
// ---------------------------------------------------------------------------

/** tileBag builds the resource bag for a board size (generate.go). */
export function tileBag(hexes) {
  const deserts = 1 + Math.floor((hexes - 1) / 30);
  const prod = hexes - deserts;
  const order = [Wood, Sheep, Wheat, Brick, Ore];
  const weights = { [Wood]: 4, [Sheep]: 4, [Wheat]: 4, [Brick]: 3, [Ore]: 3 };
  const counts = {};
  let assigned = 0;
  for (const r of order) {
    counts[r] = Math.floor((prod * weights[r]) / 18);
    assigned += counts[r];
  }
  for (let i = 0; assigned < prod; i++) {
    counts[order[i % order.length]]++;
    assigned++;
  }
  const bag = [];
  for (const r of order) for (let i = 0; i < counts[r]; i++) bag.push(r);
  for (let i = 0; i < deserts; i++) bag.push(ResNone);
  return bag;
}

const tokenValues = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
const tokenShare = { 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 };
const tokenDealOrder = [2, 12, 3, 11, 4, 10, 5, 9, 6, 8];

/**
 * numberTokens builds n dice tokens carrying the base distribution scaled to
 * the board: n*share/18 each, leftovers dealt by largest shortfall.
 *
 * Ties are broken from the seed when an rng is supplied, by reservoir sampling
 * over the equally-short values: one intN per candidate past the first, in
 * tokenDealOrder order. That must match engine/board.numberTokens draw for
 * draw, because every later shuffle reads the same stream. A tie is the normal
 * case: 6 and 8 carry the same share and go short together, and dealing the
 * spare by tokenDealOrder (which lists 6 first) gave every 5- and 6-player
 * board four 6s and three 8s on every seed.
 *
 * rng may be null, and then tokenDealOrder decides, mirroring the Go default
 * used by complementTokens for a partially-pinned authored board.
 */
export function numberTokens(rng, n) {
  if (n <= 0) return [];
  const counts = {};
  let dealt = 0;
  for (const v of tokenDealOrder) {
    counts[v] = Math.floor((n * tokenShare[v]) / 18);
    dealt += counts[v];
  }
  for (; dealt < n; dealt++) {
    let best = 0, most = -1, ties = 0;
    for (const v of tokenDealOrder) {
      const short = n * tokenShare[v] - counts[v] * 18;
      if (short > most) {
        best = v; most = short; ties = 1;
      } else if (short === most) {
        ties++;
        if (rng !== null && rng !== undefined && rng.intN(ties) === 0) best = v;
      }
    }
    counts[best]++;
  }
  const out = [];
  for (const v of tokenValues) for (let i = 0; i < counts[v]; i++) out.push(v);
  return out;
}

function countDeserts(bag) {
  return bag.reduce((n, r) => n + (r === ResNone ? 1 : 0), 0);
}

// ---------------------------------------------------------------------------
// grid: the index-based substrate the solver scores over (solve.go)
// ---------------------------------------------------------------------------

function newGrid(hexes) {
  const index = new Map();
  hexes.forEach((h, i) => index.set(hexKey(h), i));
  const nbr = hexes.map((h) => {
    const out = [];
    for (const nb of neighbors(h)) {
      const j = index.get(hexKey(nb));
      if (j !== undefined) out.push(j);
    }
    return out;
  });
  // Every vertex incident to a present hex, once, in hex order then corner
  // order, recording the tile indices around it (-1 for absent).
  const seen = new Set();
  const verts = [];
  for (const h of hexes) {
    for (const v of hexVertices(h)) {
      const k = vertKey(v);
      if (seen.has(k)) continue;
      seen.add(k);
      verts.push(vertexHexes(v).map((hh) => {
        const j = index.get(hexKey(hh));
        return j === undefined ? -1 : j;
      }));
    }
  }
  return { hexes, index, nbr, verts };
}

function pipImbalance(g, res, num) {
  const pipSum = new Array(6).fill(0);
  const count = new Array(6).fill(0);
  for (let i = 0; i < g.hexes.length; i++) {
    if (!producing(res[i])) continue;
    pipSum[res[i]] += pipValue(num[i]);
    count[res[i]]++;
  }
  let minAvg = Infinity, maxAvg = -Infinity;
  for (const r of Resources) {
    if (count[r] === 0) continue;
    const avg = pipSum[r] / count[r];
    minAvg = Math.min(minAvg, avg);
    maxAvg = Math.max(maxAvg, avg);
  }
  const spread = maxAvg - minAvg;
  return spread > fairPipBand ? spread - fairPipBand : 0;
}

function hotSpots(g, res, num) {
  let hot3 = 0, hot2 = 0;
  for (const group of g.verts) {
    let p = 0, pips = 0;
    for (const ti of group) {
      if (ti < 0 || !producing(res[ti])) continue;
      p++;
      pips += pipValue(num[ti]);
    }
    if (p >= 3 && pips >= hotSpot3) hot3++;
    else if (p === 2 && pips >= hotSpot2) hot2++;
  }
  return [hot3, hot2];
}

function clumpExcess(g, res) {
  const seen = new Array(g.hexes.length).fill(false);
  let excess = 0;
  for (let i = 0; i < g.hexes.length; i++) {
    if (seen[i] || !producing(res[i])) continue;
    seen[i] = true;
    const stack = [i];
    let size = 0;
    while (stack.length > 0) {
      const cur = stack.pop();
      size++;
      for (const j of g.nbr[cur]) {
        if (!seen[j] && res[j] === res[i]) {
          seen[j] = true;
          stack.push(j);
        }
      }
    }
    if (size > clumpMax) excess += size - clumpMax;
  }
  return excess;
}

function numPenalty(g, res, num) {
  let redPairs = 0, samePairs = 0;
  for (let i = 0; i < g.hexes.length; i++) {
    if (num[i] === 0) continue;
    for (const j of g.nbr[i]) {
      if (j <= i || num[j] === 0) continue;
      if (isRed(num[i]) && isRed(num[j])) redPairs++;
      if (num[i] === num[j]) samePairs++;
    }
  }
  const [hot3, hot2] = hotSpots(g, res, num);
  return redPairs * 100 + samePairs * 12 + hot3 * 8 + hot2 * 3;
}

function gridPenalty(g, res, num, fair) {
  if (!fair) {
    let redPairs = 0;
    for (let i = 0; i < g.hexes.length; i++) {
      if (num[i] === 0 || !isRed(num[i])) continue;
      for (const j of g.nbr[i]) if (j > i && isRed(num[j])) redPairs++;
    }
    return redPairs * 100;
  }
  return numPenalty(g, res, num) + clumpExcess(g, res) * 10 + pipImbalance(g, res, num) * 20;
}

/**
 * rebalanceNumbers is engine/board's Board.Rebalance: a deterministic,
 * rng-free first-improvement descent over pairs of movable numbered producing
 * hexes (board order), swapping tokens while the fair penalty strictly drops and
 * the count of touching red pairs does not rise, until a full pass accepts
 * nothing or MAX_REBALANCE_PASSES is reached. Rivers runs it after painting a
 * fair-mode board (derivation 11).
 */
const MAX_REBALANCE_PASSES = 32;

function redPairsOf(g, num) {
  let n = 0;
  for (let i = 0; i < g.hexes.length; i++) {
    if (!isRed(num[i])) continue;
    for (const j of g.nbr[i]) if (j > i && isRed(num[j])) n++;
  }
  return n;
}

export function rebalanceNumbers(b, movable) {
  const present = hexesInRadius(b.radius).filter((h) => b.tiles.has(hexKey(h)));
  const g = newGrid(present);
  const res = present.map((h) => b.tiles.get(hexKey(h)).res);
  const num = present.map((h) => b.tiles.get(hexKey(h)).number || 0);
  const slots = [];
  present.forEach((h, i) => {
    if (producing(res[i]) && num[i] !== 0 && movable(h)) slots.push(i);
  });
  let pen = gridPenalty(g, res, num, true);
  const reds = redPairsOf(g, num);
  for (let pass = 0; pass < MAX_REBALANCE_PASSES && pen > 0; pass++) {
    let improved = false;
    for (let x = 0; x < slots.length; x++) {
      for (let y = x + 1; y < slots.length; y++) {
        const i = slots[x], j = slots[y];
        if (num[i] === num[j]) continue;
        [num[i], num[j]] = [num[j], num[i]];
        const p = gridPenalty(g, res, num, true);
        if (p < pen && redPairsOf(g, num) <= reds) {
          pen = p;
          improved = true;
          continue;
        }
        [num[i], num[j]] = [num[j], num[i]];
      }
    }
    if (!improved) break;
  }
  present.forEach((h, i) => {
    const t = b.tiles.get(hexKey(h));
    if ((t.number || 0) !== num[i]) b.tiles.set(hexKey(h), { ...t, number: num[i] });
  });
}

// ---------------------------------------------------------------------------
// The solver (solve.go)
// ---------------------------------------------------------------------------

const takesNumber = (r) => producing(r) || r === Gold || r === ResLand;

function redNeighbors(g, isRedAt, s) {
  let c = 0;
  for (const j of g.nbr[s]) if (isRedAt[j]) c++;
  return c;
}

function repairReds(g, order, num, isRedAt) {
  const limit = 4 * order.length;
  for (let k = 0; k < limit; k++) {
    let conflict = -1;
    for (const s of order) {
      if (isRedAt[s] && redNeighbors(g, isRedAt, s) > 0) { conflict = s; break; }
    }
    if (conflict < 0) return;
    let target = -1;
    for (const s of order) {
      if (!isRedAt[s] && s !== conflict && redNeighbors(g, isRedAt, s) === 0) { target = s; break; }
    }
    if (target < 0) return;
    [num[conflict], num[target]] = [num[target], num[conflict]];
    isRedAt[conflict] = false;
    isRedAt[target] = true;
  }
}

function placeNumbers(rng, g, numSlots, numbers, num) {
  const reds = [], rest = [];
  for (const n of numbers) (isRed(n) ? reds : rest).push(n);
  rng.shuffle(reds.length, (i, j) => { [reds[i], reds[j]] = [reds[j], reds[i]]; });
  rng.shuffle(rest.length, (i, j) => { [rest[i], rest[j]] = [rest[j], rest[i]]; });

  const order = numSlots.slice();
  rng.shuffle(order.length, (i, j) => { [order[i], order[j]] = [order[j], order[i]]; });

  const isRedAt = new Array(g.hexes.length).fill(false);
  const placed = new Array(g.hexes.length).fill(false);
  for (let i = 0; i < g.hexes.length; i++) {
    if (num[i] !== 0) { placed[i] = true; isRedAt[i] = isRed(num[i]); }
  }

  // Pass 1: greedily place reds where no neighbor is already red.
  let ri = 0;
  for (const s of order) {
    if (ri >= reds.length) break;
    if (redNeighbors(g, isRedAt, s) === 0) {
      num[s] = reds[ri]; isRedAt[s] = true; placed[s] = true; ri++;
    }
  }
  // Pass 2: leftovers go where they add the fewest new adjacencies.
  for (; ri < reds.length; ri++) {
    let best = -1, bestCost = 1 << 30;
    for (const s of order) {
      if (placed[s]) continue;
      const c = redNeighbors(g, isRedAt, s);
      if (c < bestCost) { best = s; bestCost = c; if (c === 0) break; }
    }
    if (best < 0) break;
    num[best] = reds[ri]; isRedAt[best] = true; placed[best] = true;
  }
  // Fill the rest with non-red tokens.
  let ti = 0;
  for (const s of order) {
    if (!placed[s]) { num[s] = rest[ti]; placed[s] = true; ti++; }
  }
  repairReds(g, order, num, isRedAt);
}

function shuffleAt(rng, v, idx) {
  rng.shuffle(idx.length, (i, j) => {
    [v[idx[i]], v[idx[j]]] = [v[idx[j]], v[idx[i]]];
  });
}

function descend(rng, g, res, num, nonRed, resMov) {
  const budget = 60 * (nonRed.length + resMov.length);
  let numPart = numPenalty(g, res, num);
  let resPart = clumpExcess(g, res) * 10;
  let pen = numPart + resPart + pipImbalance(g, res, num) * 20;
  for (let t = 0; t < budget && pen > 0; t++) {
    const swapNums = resMov.length < 2 || (nonRed.length >= 2 && rng.intN(2) === 0);
    let a, b;
    let newNum = numPart, newRes = resPart;
    if (swapNums) {
      a = nonRed[rng.intN(nonRed.length)];
      b = nonRed[rng.intN(nonRed.length)];
      if (a === b) continue;
      [num[a], num[b]] = [num[b], num[a]];
      newNum = numPenalty(g, res, num);
    } else {
      a = resMov[rng.intN(resMov.length)];
      b = resMov[rng.intN(resMov.length)];
      if (a === b) continue;
      [res[a], res[b]] = [res[b], res[a]];
      newRes = clumpExcess(g, res) * 10;
    }
    const newPip = pipImbalance(g, res, num) * 20;
    const newPen = newNum + newRes + newPip;
    if (newPen <= pen) {
      pen = newPen; numPart = newNum; resPart = newRes;
      continue;
    }
    if (swapNums) [num[a], num[b]] = [num[b], num[a]];
    else [res[a], res[b]] = [res[b], res[a]];
  }
}

function fairLayout(rng, g, res, num, resSlots, numSlots) {
  const nonRed = [], resMov = [];
  for (const s of numSlots) if (!isRed(num[s])) nonRed.push(s);
  for (const s of resSlots) if (producing(res[s])) resMov.push(s);
  if (nonRed.length < 2 && resMov.length < 2) return;

  let bestRes = res.slice();
  let bestNum = num.slice();
  let bestPen = gridPenalty(g, res, num, true);

  const restarts = 40;
  for (let k = 0; k < restarts && bestPen > 0; k++) {
    if (k > 0) {
      for (let i = 0; i < res.length; i++) res[i] = bestRes[i];
      for (let i = 0; i < num.length; i++) num[i] = bestNum[i];
      shuffleAt(rng, num, nonRed);
      shuffleAt(rng, res, resMov);
    }
    descend(rng, g, res, num, nonRed, resMov);
    const pen = gridPenalty(g, res, num, true);
    if (pen < bestPen) {
      bestPen = pen;
      bestRes = res.slice();
      bestNum = num.slice();
    }
  }
  for (let i = 0; i < res.length; i++) res[i] = bestRes[i];
  for (let i = 0; i < num.length; i++) num[i] = bestNum[i];
}

function solveLayout(rng, g, res, num, resSlots, numSlots, resBag, numbers, fair) {
  rng.shuffle(resBag.length, (i, j) => { [resBag[i], resBag[j]] = [resBag[j], resBag[i]]; });
  resSlots.forEach((s, k) => { res[s] = resBag[k]; });
  if (numSlots === null) {
    numSlots = [];
    for (const s of resSlots) if (takesNumber(res[s])) numSlots.push(s);
  }
  placeNumbers(rng, g, numSlots, numbers, num);
  if (fair) fairLayout(rng, g, res, num, resSlots, numSlots);
}

// ---------------------------------------------------------------------------
// Harbors (generate.go)
// ---------------------------------------------------------------------------

function harborCount(radius) {
  return 9 + 3 * (radius - 2);
}

/** isLand: on the board, not sea, not impassable border. */
export const isLand = (b, h) => {
  const t = b.tiles.get(hexKey(h));
  return t !== undefined && t.res !== Sea && t.res !== Border;
};

/**
 * edgeSeaHex mirrors Board.edgeSeaHex: the single water hex an edge borders, or
 * null when it borders none or both. Exported because the scenarios module port needs
 * it too (a harbor's dock stands on this hex, and no fishing ground may).
 */
export function edgeSeaHex(b, e) {
  let sea = null, n = 0;
  for (const h of edgeHexes(e)) {
    if (!isLand(b, h)) { sea = h; n++; }
  }
  return n === 1 ? sea : null;
}

function coastEdges(b) {
  const set = new Map();
  for (const [k, t] of b.tiles) {
    if (t.res === Sea) continue;
    const [q, r] = k.split(",").map(Number);
    for (const e of hexEdges(hex(q, r))) {
      let land = 0;
      for (const eh of edgeHexes(e)) if (isLand(b, eh)) land++;
      if (land === 1) set.set(edgeKey(e), e);
    }
  }
  return sortEdges([...set.values()]);
}

function coastLoops(coast) {
  const inc = new Map();
  const push = (v, e) => {
    const k = vertKey(v);
    if (!inc.has(k)) inc.set(k, []);
    inc.get(k).push(e);
  };
  for (const e of coast) { push(e.a, e); push(e.b, e); }
  const visited = new Set();
  const loops = [];
  for (const start of coast) {
    if (visited.has(edgeKey(start))) continue;
    visited.add(edgeKey(start));
    const loop = [start];
    let v = start.b;
    for (;;) {
      let next = null;
      for (const e of inc.get(vertKey(v)) || []) {
        if (!visited.has(edgeKey(e))) { next = e; break; }
      }
      if (next === null) break;
      visited.add(edgeKey(next));
      loop.push(next);
      v = edgeOther(next, v);
    }
    loops.push(loop);
  }
  return loops;
}

function allocateHarbors(loops, n) {
  const alloc = new Array(loops.length).fill(0);
  for (let k = 0; k < n; k++) {
    let best = -1, bestDensity = 0;
    loops.forEach((loop, i) => {
      if (alloc[i] >= Math.floor(loop.length / 2)) return;
      const d = alloc[i] / loop.length;
      if (best === -1 || d < bestDensity) { best = i; bestDensity = d; }
    });
    if (best === -1) break;
    alloc[best]++;
  }
  return alloc;
}

function spaceOnLoop(rng, loop, k) {
  const L = loop.length;
  if (k <= 0 || L === 0) return [];
  const off = rng.intN(L);
  const out = [];
  for (let i = 0; i < k; i++) out.push(loop[(off + Math.floor((i * L) / k)) % L]);
  return out;
}

function harborFits(b, e, usedVerts, usedSea) {
  if (usedVerts.has(vertKey(e.a)) || usedVerts.has(vertKey(e.b))) return false;
  const sea = edgeSeaHex(b, e);
  return sea !== null && !usedSea.has(hexKey(sea));
}

function nearestFreeCoastEdge(b, loop, want, usedVerts, usedSea) {
  const L = loop.length;
  const idx = loop.findIndex((e) => edgeKey(e) === edgeKey(want));
  if (idx < 0) return null;
  for (let d = 0; d <= Math.floor(L / 2); d++) {
    for (const off of [d, -d]) {
      const e = loop[(((idx + off) % L) + L) % L];
      if (harborFits(b, e, usedVerts, usedSea)) return e;
      if (d === 0) break;
    }
  }
  return null;
}

function harborMix(rng, n) {
  if (n <= 0) return [];
  let generic = Math.floor((8 * n + 9) / 18);
  const maxGeneric = n - Math.min(n, Resources.length);
  if (generic > maxGeneric) generic = maxGeneric;
  const specific = n - generic;

  const res = Resources.slice();
  rng.shuffle(res.length, (i, j) => { [res[i], res[j]] = [res[j], res[i]]; });

  const kinds = [];
  for (let i = 0; i < specific; i++) kinds.push({ ratio: 2, res: res[i % res.length] });
  for (let i = 0; i < generic; i++) kinds.push({ ratio: 3, res: ResNone });
  rng.shuffle(kinds.length, (i, j) => { [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; });
  return kinds;
}

export function placeHarborsFor(rng, b, n) {
  return placeHarbors(rng, b, n);
}

function placeHarbors(rng, b, n) {
  if (n < 0) n = 0;
  const loops = coastLoops(coastEdges(b));
  const alloc = allocateHarbors(loops, n);
  const usedVerts = new Set();
  const usedSea = new Set();
  const edges = [];
  loops.forEach((loop, i) => {
    for (const want of spaceOnLoop(rng, loop, alloc[i])) {
      const e = nearestFreeCoastEdge(b, loop, want, usedVerts, usedSea);
      if (e === null) continue;
      usedVerts.add(vertKey(e.a));
      usedVerts.add(vertKey(e.b));
      const sea = edgeSeaHex(b, e);
      if (sea !== null) usedSea.add(hexKey(sea));
      edges.push(e);
    }
  });
  const kinds = harborMix(rng, edges.length);
  return edges.map((e, i) => ({ ...kinds[i], verts: [e.a, e.b] }));
}

// ---------------------------------------------------------------------------
// GenerateRadius
// ---------------------------------------------------------------------------

/**
 * generateRadius reproduces engine/board.GenerateRadius for the given rng
 * (which must be a Rand over PCG(publicSeed, ...) positioned exactly as the
 * engine positions it: see verify.mjs).
 *
 * Returns {radius, tiles: Map<hexKey,{res,number}>, robber, harbors}.
 */
export function generateRadius(rng, players, radius, mode) {
  if (players < 2 || players > 10) throw new Error(`players must be 2-10, got ${players}`);
  const hexes = hexesInRadius(radius);
  const bag = tileBag(hexes.length);
  const numbers = numberTokens(rng, hexes.length - countDeserts(bag));
  const fair = mode === BoardFair;

  const g = newGrid(hexes);
  const res = new Array(hexes.length).fill(ResNone);
  const num = new Array(hexes.length).fill(0);
  const resSlots = hexes.map((_, i) => i);
  solveLayout(rng, g, res, num, resSlots, null, bag, numbers, fair);

  const b = { radius, tiles: new Map(), robber: null, harbors: [] };
  hexes.forEach((h, i) => {
    if (res[i] === ResNone) {
      b.tiles.set(hexKey(h), { res: ResNone, number: 0 });
      b.robber = h; // multiple deserts: the robber lands on the last one
      return;
    }
    b.tiles.set(hexKey(h), { res: res[i], number: num[i] });
  });
  b.harbors = placeHarbors(rng, b, harborCount(radius));
  return b;
}

// ---------------------------------------------------------------------------
// Presets (presets.go)
// ---------------------------------------------------------------------------
//
// PresetBoard copies a curated map's fixed tiles and then places the harbors
// from the seed, so the layouts are carried here to audit that deal.

/**
 * presetRobber mirrors presets.go: the first desert in board order, never a
 * Go-map iteration, because "expanded" has two deserts and "grand" three and
 * the robber has to land on the same one every replay of the same game.
 */
function presetRobber(radius, tiles) {
  for (const h of hexesInRadius(radius)) {
    const t = tiles.get(hexKey(h));
    if (t !== undefined && t.res === ResNone) return h;
  }
  return hex(0, 0);
}

/** The beginner layout, rows top to bottom, left to right. */
function beginnerTiles() {
  const rows = [
    [[Ore, 10], [Sheep, 2], [Wood, 9]],
    [[Wheat, 12], [Brick, 6], [Sheep, 4], [Brick, 10]],
    [[Wheat, 9], [Wood, 11], [ResNone, 0], [Wood, 3], [Ore, 8]],
    [[Wood, 8], [Ore, 3], [Wheat, 4], [Sheep, 5]],
    [[Brick, 5], [Wheat, 6], [Sheep, 11]],
  ];
  const tiles = new Map();
  rows.forEach((row, i) => {
    const r = i - 2;
    const qStart = r < 0 ? -2 - r : -2;
    row.forEach(([res, number], j) => tiles.set(hexKey(hex(qStart + j, r)), { res, number }));
  });
  return tiles;
}

// The golden ratio constant presets.go seeds its frozen layouts with. It never
// touches a game seed; it only reproduces the two fixed boards.
const freezeGolden = 0x9e3779b97f4a7c15n;

/**
 * frozenTiles reproduces presets.go's freeze(): the larger curated maps are
 * output of the procedural generator on a fixed seed in random mode, so they
 * are ported by running the generator rather than by transcribing 37 and 61
 * tiles. A transcription would be a second copy of the layout to keep in step
 * with the generator, and the generator is already ported and gated.
 */
function frozenTiles(seed, players, radius) {
  const s = BigInt.asUintN(64, seed);
  return generateRadius(new Rand(new PCG(s, s ^ freezeGolden)), players, radius, BoardRandom).tiles;
}

const presetDefs = {
  beginner: { radius: 2, tiles: beginnerTiles },
  expanded: { radius: 3, tiles: () => frozenTiles(0xC0FFEEn, 6, 3) },
  grand: { radius: 4, tiles: () => frozenTiles(0xBADCABn, 10, 4) },
};

// Built once per preset: the frozen two cost a full generator run each.
const presetTiles = new Map();

/**
 * presetBoard is engine/board.PresetBoard: the preset's fixed tiles, the robber
 * on the first desert, and the harbors placed from the seed at stream position
 * 1, exactly where a procedural board places its own.
 *
 * Returns null for a name this build does not carry, so the caller reports the
 * board unchecked rather than failing a game it simply cannot rebuild.
 */
export function presetBoard(rng, name) {
  const def = presetDefs[name];
  if (def === undefined) return null;
  let tiles = presetTiles.get(name);
  if (tiles === undefined) {
    tiles = def.tiles();
    presetTiles.set(name, tiles);
  }
  // Copied per call, values included: the modules reshape the board they are
  // handed, and the cached layout has to stay the layout.
  const b = {
    radius: def.radius,
    tiles: new Map([...tiles].map(([k, t]) => [k, { res: t.res, number: t.number }])),
    robber: null,
    harbors: [],
  };
  b.robber = presetRobber(b.radius, b.tiles);
  b.harbors = placeHarbors(rng, b, harborCount(def.radius));
  return b;
}

// ---------------------------------------------------------------------------
// Wire form
// ---------------------------------------------------------------------------

/**
 * resourceNames mirrors engine/board's JSON vocabulary. Resources travel as
 * self-describing strings, so this is the only place the numeric values above
 * meet the wire.
 */
export const resourceNames = {
  [ResNone]: "none", [Wood]: "wood", [Brick]: "brick", [Sheep]: "sheep",
  [Wheat]: "wheat", [Ore]: "ore", [Gold]: "gold", [Sea]: "sea",
  [Lake]: "lake", [Fog]: "fog", [ResLand]: "land", [Border]: "border",
  [Swamp]: "swamp",
};

/**
 * boardToWire renders a generated board in exactly the shape
 * board.Board.MarshalJSON emits, so a re-derived board can be compared to the
 * one the server logged by comparing JSON.
 *
 * Tiles come out in HexesInRadius order, which is what MarshalJSON does; that
 * is why the comparison can be a string equality rather than a set compare.
 */
export function boardToWire(b) {
  const tiles = [];
  for (const h of hexesInRadius(b.radius)) {
    const t = b.tiles.get(hexKey(h));
    if (t === undefined) continue;
    tiles.push({ hex: { q: h.q, r: h.r }, res: resourceNames[t.res], num: t.number });
  }
  return {
    radius: b.radius,
    tiles,
    robber: b.robber ? { q: b.robber.q, r: b.robber.r } : { q: 0, r: 0 },
    harbors: b.harbors.map((h) => ({
      verts: [
        { q: h.verts[0].q, r: h.verts[0].r, side: h.verts[0].side },
        { q: h.verts[1].q, r: h.verts[1].r, side: h.verts[1].side },
      ],
      ratio: h.ratio,
      res: resourceNames[h.res],
    })),
  };
}


// ---------------------------------------------------------------------------
// Resolve: the path a lobby table takes (engine/board/resolve.go)
// ---------------------------------------------------------------------------
//
// A lobby table does not go through generateRadius. Its config carries a shape
// (generic land, blank numbers), and the engine fills it in at start with
// Resolve, then adds harbors. This is the common case.

/** desertCount mirrors the procedural ratio: ~1 desert per 30 land tiles. */
function desertCount(landTiles) {
  if (landTiles <= 0) return 0;
  return 1 + Math.floor((landTiles - 1) / 30);
}

/** producingBag: n producing resources in the 4:4:4:3:3 ratio, no deserts. */
function producingBag(n) {
  if (n <= 0) return [];
  const order = [Wood, Sheep, Wheat, Brick, Ore];
  const weights = [4, 4, 4, 3, 3];
  const counts = order.map((_, i) => Math.floor((n * weights[i]) / 18));
  let assigned = counts.reduce((a, c) => a + c, 0);
  for (let i = 0; assigned < n; i++) {
    counts[i % order.length]++;
    assigned++;
  }
  const bag = [];
  order.forEach((r, i) => { for (let k = 0; k < counts[i]; k++) bag.push(r); });
  return bag;
}

/**
 * complementTokens fills `blanks` tokens around already-pinned ones, aiming at
 * the standard spread for the whole board rather than repeating the base bag's
 * low-front prefix. With no pins it equals numberTokens(blanks).
 */
function complementTokens(pinned, blanks) {
  if (blanks <= 0) return [];
  const count = {};
  for (const n of numberTokens(null, pinned.length + blanks)) count[n] = (count[n] || 0) + 1;
  for (const n of pinned) if (count[n] > 0) count[n]--;
  const bag = [];
  for (const v of tokenValues) for (let i = 0; i < (count[v] || 0); i++) bag.push(v);
  // Pins can over-fill a value past its standard count; trim the surplus from
  // whichever value is most abundant so the fill stays as balanced as it can.
  while (bag.length > blanks) {
    const cnt = {};
    for (const n of bag) cnt[n] = (cnt[n] || 0) + 1;
    let most = 0, mostCount = -1;
    for (const v of tokenValues) {
      if ((cnt[v] || 0) > mostCount) { most = v; mostCount = cnt[v] || 0; }
    }
    bag.splice(bag.indexOf(most), 1);
  }
  return bag;
}

/**
 * resolveBoard is Board.Resolve: every generic-land tile gets a real resource
 * and every blank producing tile gets a number, balanced per `mode`. Pinned
 * values are kept. Mutates `b`.
 */
export function resolveBoard(rng, b, mode) {
  const hexes = hexesInRadius(b.radius);
  let resFree = [];
  const deserts = [];
  let landCount = 0;
  for (const h of hexes) {
    const t = b.tiles.get(hexKey(h));
    if (t === undefined) continue;
    if (t.res === ResNone) { deserts.push(h); landCount++; }
    else if (t.res === ResLand) { resFree.push(h); landCount++; }
    else if (producing(t.res) || t.res === Gold) landCount++;
  }

  // A shape-only board (all generic land, no pinned desert) gets the standard
  // desert allotment carved out of its land, robber parked on one.
  if (deserts.length === 0 && resFree.length > 0) {
    rng.shuffle(resFree.length, (a, c) => { [resFree[a], resFree[c]] = [resFree[c], resFree[a]]; });
    const want = desertCount(landCount);
    for (let i = 0; i < want && resFree.length > 0; i++) {
      const h = resFree[0];
      resFree = resFree.slice(1);
      b.tiles.set(hexKey(h), { res: ResNone, number: 0 });
      b.robber = h; // multiple deserts: the robber lands on the last one
    }
  }

  // The robber always begins on a desert. A custom map that pins its own desert
  // may have saved the robber elsewhere, so snap it onto a desert tile unless it
  // is already on one.
  //
  // A robber on no tile is left where it is: in Go a map miss yields the zero
  // Tile, whose Res is ResNone, so it reads as "already on a desert". The
  // auditor does not run ValidateLayout, so it can meet this input.
  if (deserts.length > 0) {
    const rt = b.tiles.get(hexKey(b.robber));
    if (rt !== undefined && rt.res !== ResNone) b.robber = deserts[deserts.length - 1];
  }

  const numFree = [];
  const pinnedNums = [];
  for (const h of hexes) {
    const t = b.tiles.get(hexKey(h));
    if (t === undefined) continue;
    if (t.number === 0 && (t.res === ResLand || producing(t.res) || t.res === Gold)) {
      numFree.push(h);
    } else if (t.number !== 0 && takesNumber(t.res)) {
      pinnedNums.push(t.number);
    }
  }
  if (resFree.length === 0 && numFree.length === 0) return; // already resolved

  const resBag = producingBag(resFree.length);
  const numbers = complementTokens(pinnedNums, numFree.length);
  const fair = mode === BoardFair;

  const present = hexes.filter((h) => b.tiles.has(hexKey(h)));
  const g = newGrid(present);
  const res = present.map((h) => b.tiles.get(hexKey(h)).res);
  const num = present.map((h) => b.tiles.get(hexKey(h)).number);
  const slot = (list) => list.map((h) => g.index.get(hexKey(h)));

  solveLayout(rng, g, res, num, slot(resFree), slot(numFree), resBag, numbers, fair);

  present.forEach((h, i) => { b.tiles.set(hexKey(h), { res: res[i], number: num[i] }); });
}

/**
 * ensureHarbors is Board.EnsureHarbors: a board carrying no harbors of its own
 * gets a set scaled to its coastline length (not its radius), so a hand-built
 * map plays with ports like a procedural one.
 */
export function ensureHarbors(rng, b) {
  if (b.harbors.length !== 0) return;
  const n = Math.min(Math.max(Math.floor((coastEdges(b).length * 3) / 10), 5), 16);
  b.harbors = placeHarbors(rng, b, n);
}

/** resourcesByName is resourceNames inverted: the wire form back to the enum. */
export const resourcesByName = Object.fromEntries(
  Object.entries(resourceNames).map(([num, name]) => [name, Number(num)]),
);
