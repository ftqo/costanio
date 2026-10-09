// costan.io fairness verifier -- GENERATED FILE, do not edit.
//
// Built from verify/*.mjs by scripts/bundle-verify.mjs. Edit those and rebuild:
//   node scripts/bundle-verify.mjs
//
// Usage, anywhere with a JavaScript engine:
//
//   const text = await (await fetch("/api/games/GAME_ID/replay")).text();
//   console.log(costanVerify.format(costanVerify.verify(text)));
//
// Pass the response TEXT, not a parsed object: seeds are 64-bit and JSON.parse
// rounds them off.

const costanVerify = (() => {
"use strict";

// ---- verify/rand.mjs ------------------------------------------------------

// Bit-exact port of the subset of Go 1.26 math/rand/v2 that the engine's
// public (verifiable) randomness uses: PCG as a Source, plus Rand.IntN,
// Rand.Shuffle and Rand.Perm.
//
// Transcribed from $GOROOT/src/math/rand/v2/{pcg.go,rand.go}; identifiers and
// branch structure follow the Go source, and any deviation is a bug.
//
// Go's `is32bit` is false on the amd64/arm64 hosts the server runs on, so
// uint64n never takes its uint32n branch and Shuffle (and Perm) always go
// through uint64n. uint32n is not ported; calling it would change every
// sequence.
//
// Arithmetic is BigInt masked to 64 bits; Number would lose low bits.

const MASK64 = (1n << 64n) - 1n;
const MASK32 = (1n << 32n) - 1n;

/** Multiply two uint64s, returning [hi, lo] like Go's bits.Mul64. */
function mul64(x, y) {
  const x0 = x & MASK32, x1 = x >> 32n;
  const y0 = y & MASK32, y1 = y >> 32n;
  const w0 = x0 * y0;
  const t = x1 * y0 + (w0 >> 32n);
  let w1 = t & MASK32;
  const w2 = t >> 32n;
  w1 += x0 * y1;
  const hi = x1 * y1 + w2 + (w1 >> 32n);
  const lo = (x * y) & MASK64;
  return [hi & MASK64, lo];
}

/** Add two uint64s with carry in, returning [sum, carryOut] like bits.Add64. */
function add64(x, y, carry) {
  const sum = x + y + carry;
  return [sum & MASK64, sum >> 64n];
}

/**
 * PCG is Go's math/rand/v2.PCG: a 128-bit-state LCG with a DXSM output
 * function. NewPCG(seed1, seed2) seeds hi=seed1, lo=seed2.
 */
class PCG {
  constructor(seed1, seed2) {
    this.hi = BigInt.asUintN(64, BigInt(seed1));
    this.lo = BigInt.asUintN(64, BigInt(seed2));
  }

  // next advances the 128-bit state: state = state*mul + inc.
  next() {
    const mulHi = 2549297995355413924n;
    const mulLo = 4865540595714422341n;
    const incHi = 6364136223846793005n;
    const incLo = 1442695040888963407n;

    let [hi, lo] = mul64(this.lo, mulLo);
    hi = (hi + this.hi * mulLo + this.lo * mulHi) & MASK64;
    let c;
    [lo, c] = add64(lo, incLo, 0n);
    [hi] = add64(hi, incHi, c);
    this.lo = lo;
    this.hi = hi;
    return [hi, lo];
  }

  uint64() {
    let [hi, lo] = this.next();
    // DXSM "double xorshift multiply".
    const cheapMul = 0xda942042e4dd58b5n;
    hi ^= hi >> 32n;
    hi = (hi * cheapMul) & MASK64;
    hi ^= hi >> 48n;
    hi = (hi * (lo | 1n)) & MASK64;
    return hi;
  }
}

/** Rand is Go's math/rand/v2.Rand over a Source (here, always a PCG). */
class Rand {
  constructor(src) {
    this.src = src;
  }

  uint64() {
    return this.src.uint64();
  }

  // uint64n is the no-bounds-checks version of Uint64N. The is32bit branch of
  // the Go original is omitted: see the note at the top of this file.
  uint64n(n) {
    if ((n & (n - 1n)) === 0n) {
      // n is power of two, can mask
      return this.uint64() & (n - 1n);
    }
    let [hi, lo] = mul64(this.uint64(), n);
    if (lo < n) {
      const thresh = BigInt.asUintN(64, -n) % n;
      while (lo < thresh) {
        [hi, lo] = mul64(this.uint64(), n);
      }
    }
    return hi;
  }

  /** IntN returns a number in [0,n). n is a JS number; the result is too. */
  intN(n) {
    if (n <= 0) throw new Error("invalid argument to IntN");
    return Number(this.uint64n(BigInt(n)));
  }

  /** Shuffle is Fisher-Yates in Go's exact order: i from n-1 down to 1. */
  shuffle(n, swap) {
    if (n < 0) throw new Error("invalid argument to Shuffle");
    for (let i = n - 1; i > 0; i--) {
      const j = Number(this.uint64n(BigInt(i + 1)));
      swap(i, j);
    }
  }

  /** Perm returns a permutation of [0,n). */
  perm(n) {
    const p = new Array(n);
    for (let i = 0; i < n; i++) p[i] = i;
    this.shuffle(p.length, (i, j) => {
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    });
    return p;
  }
}

// ---- verify/sha256.mjs ----------------------------------------------------

// SHA-256 (FIPS 180-4), implemented here so the verifier runs unchanged in a
// browser console and under node with no install step. Node's crypto is sync
// and SubtleCrypto is async and needs a secure context, so neither works in
// both.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

/** sha256 of a byte array, returned as lowercase hex. */
function sha256(bytes) {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = bytes.length;
  const padded = new Uint8Array((((len + 8) >> 6) + 1) * 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const bits = len * 8;
  // Length is a 64-bit big-endian bit count.
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(padded.length - 4, bits >>> 0);

  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

/**
 * seedCommitment mirrors engine.SeedCommitment: SHA-256 over the seed as eight
 * little-endian bytes. The byte order is part of the published scheme.
 */
function seedCommitment(seed) {
  let n = BigInt.asUintN(64, BigInt(seed));
  const b = new Uint8Array(8);
  for (let i = 0; i < 8; i++) { b[i] = Number(n & 0xffn); n >>= 8n; }
  return sha256(b);
}

// ---- verify/coords.mjs ----------------------------------------------------

// Hex geometry, ported from engine/board/coords.go.
//
// Axial coordinates, pointy-top hexes. Every vertex is canonically the North or
// South corner of exactly one hex, so shared vertices have a single identity
// with no normalization table.
//
// Hexes, vertices and edges are plain objects here, and are keyed by string
// wherever Go used them as map keys. Order matters everywhere the generator
// iterates, so the ports keep Go's iteration order exactly.

const N = 0;
const S = 1;

const hex = (q, r) => ({ q, r });
const hexKey = (h) => `${h.q},${h.r}`;
const vert = (q, r, side) => ({ q, r, side });
const vertKey = (v) => `${v.q},${v.r},${v.side}`;
const edgeKey = (e) => `${vertKey(e.a)}|${vertKey(e.b)}`;

function vertexLess(a, b) {
  if (a.q !== b.q) return a.q < b.q;
  if (a.r !== b.r) return a.r < b.r;
  return a.side < b.side;
}

function vertexEq(a, b) {
  return a.q === b.q && a.r === b.r && a.side === b.side;
}

/** NewEdge normalizes the pair so A < B. */
function newEdge(a, b) {
  return vertexLess(b, a) ? { a: b, b: a } : { a, b };
}

const hexDirs = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

function neighbors(h) {
  return hexDirs.map(([dq, dr]) => hex(h.q + dq, h.r + dr));
}

/** The hex's six corners, clockwise from the top. */
function hexVertices(h) {
  const { q, r } = h;
  return [
    vert(q, r, N),         // top
    vert(q + 1, r - 1, S), // north-east
    vert(q, r + 1, N),     // south-east
    vert(q, r, S),         // bottom
    vert(q - 1, r + 1, N), // south-west
    vert(q, r - 1, S),     // north-west
  ];
}

function hexEdges(h) {
  const v = hexVertices(h);
  return v.map((_, i) => newEdge(v[i], v[(i + 1) % 6]));
}

/** The (up to) three hexes touching a vertex. */
function vertexHexes(v) {
  if (v.side === N) {
    return [hex(v.q, v.r), hex(v.q, v.r - 1), hex(v.q + 1, v.r - 1)];
  }
  return [hex(v.q, v.r), hex(v.q, v.r + 1), hex(v.q - 1, v.r + 1)];
}

/** The hexes an edge separates: those shared by both endpoints. */
function edgeHexes(e) {
  const out = [];
  for (const ha of vertexHexes(e.a)) {
    for (const hb of vertexHexes(e.b)) {
      if (ha.q === hb.q && ha.r === hb.r) out.push(ha);
    }
  }
  return out;
}

function edgeOther(e, v) {
  return vertexEq(e.a, v) ? e.b : e.a;
}

/** abs, exported so the generator port shares one definition. */
const abs = (n) => (n < 0 ? -n : n);

/**
 * Every hex within cube-distance `radius` of the origin, in Go's iteration
 * order (q ascending, then r ascending). The generator indexes tiles by
 * position in this list, so the order is part of the derivation.
 */
function hexesInRadius(radius) {
  const out = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const x = q, y = -q - r, z = r;
      if (abs(x) <= radius && abs(y) <= radius && abs(z) <= radius) out.push(hex(q, r));
    }
  }
  return out;
}

/** radiusFor maps player count to board radius: 19, 37 or 61 hexes. */
function radiusFor(players) {
  if (players <= 4) return 2;
  if (players <= 6) return 3;
  return 4;
}

/** sortEdges: the generator's deterministic edge order (generate.go). */
function sortEdges(edges) {
  const less = (a, b) =>
    !vertexEq(a.a, b.a) ? vertexLess(a.a, b.a) : vertexLess(a.b, b.b);
  // Go uses an insertion sort here; any correct sort agrees, because `less` is
  // a strict total order over a set of distinct edges.
  edges.sort((a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0));
  return edges;
}

// ---- verify/board.mjs -----------------------------------------------------

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


// Resource, matching engine/board.Resource's iota order exactly. The numeric
// values index the pip-sum arrays and are what the wire format carries.
const ResNone = 0;
const Wood = 1;
const Brick = 2;
const Sheep = 3;
const Wheat = 4;
const Ore = 5;
const Gold = 6;
const Sea = 7;
const Lake = 8;
const Fog = 9;
const ResLand = 10;
const Border = 11;
// Swamp is where a river reaches the sea (Rivers): land, buildable,
// robber-legal, producing nothing. It is appended rather than placed beside
// Lake because the numeric values are a persisted encoding and are frozen.
const Swamp = 12;

const Resources = [Wood, Brick, Sheep, Wheat, Ore];
/** producing: a tile resource that pays out on its number. */
const producing = (r) => r >= Wood && r <= Ore;

const BoardRandom = "random";
const BoardFair = "fair";

const isRed = (n) => n === 6 || n === 8;

function pipValue(n) {
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
function tileBag(hexes) {
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
function numberTokens(rng, n) {
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

function rebalanceNumbers(b, movable) {
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
const isLand = (b, h) => {
  const t = b.tiles.get(hexKey(h));
  return t !== undefined && t.res !== Sea && t.res !== Border;
};

/**
 * edgeSeaHex mirrors Board.edgeSeaHex: the single water hex an edge borders, or
 * null when it borders none or both. Exported because the scenarios module port needs
 * it too (a harbor's dock stands on this hex, and no fishing ground may).
 */
function edgeSeaHex(b, e) {
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

function placeHarborsFor(rng, b, n) {
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
function generateRadius(rng, players, radius, mode) {
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
function presetBoard(rng, name) {
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
const resourceNames = {
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
function boardToWire(b) {
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
function resolveBoard(rng, b, mode) {
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
function ensureHarbors(rng, b) {
  if (b.harbors.length !== 0) return;
  const n = Math.min(Math.max(Math.floor((coastEdges(b).length * 3) / 10), 5), 16);
  b.harbors = placeHarbors(rng, b, n);
}

/** resourcesByName is resourceNames inverted: the wire form back to the enum. */
const resourcesByName = Object.fromEntries(
  Object.entries(resourceNames).map(([num, name]) => [name, Number(num)]),
);

// ---- verify/frame.mjs -----------------------------------------------------

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


/** hexFromKey inverts coords.mjs's hexKey. */
function hexFromKey(k) {
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
function hexDist(a, b) {
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
function frameBoard(b) {
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

// ---- verify/modules.mjs ---------------------------------------------------

// Module board setup, ported from the SetupBoard hooks in engine/islands and
// engine/scenarios. These run after GenerateRadius and reshape the board, so a
// non-base ruleset's board is not reproducible without them.
//
// Each module receives a fresh rng at stream position 2 (engine/state.go calls
// rngFor(publicSeed, 2) once per module), so modules do not share a cursor.
//
// A second pass, FinishBoard (finishBoardFor), runs at stream position 3 for
// hooks that need the finished board. SetupBoard order is a name sort, so a
// survey done in pass one could be undone by a later module.

// The bundle concatenates modules into one scope (scripts/bundle-verify.mjs),
// so hexDist is imported rather than redeclared.

/** vertexHexesOf / vertexEdgesOf mirror Vertex.Hexes and Vertex.Edges. */
function vertexNeighbors(v) {
  if (v.side === N) {
    return [vert(v.q + 1, v.r - 1, S), vert(v.q, v.r - 1, S), vert(v.q + 1, v.r - 2, S)];
  }
  return [vert(v.q, v.r + 1, N), vert(v.q - 1, v.r + 1, N), vert(v.q - 1, v.r + 2, N)];
}

function vertexEdgesOf(v) {
  return vertexNeighbors(v).map((n) => newEdge(v, n));
}

function landVertex(b, v) {
  const hs = v.side === N
    ? [{ q: v.q, r: v.r }, { q: v.q, r: v.r - 1 }, { q: v.q + 1, r: v.r - 1 }]
    : [{ q: v.q, r: v.r }, { q: v.q, r: v.r + 1 }, { q: v.q - 1, r: v.r + 1 }];
  return hs.some((h) => isLand(b, h));
}

/**
 * landEdge mirrors board.LandEdge: one of the two hexes the edge separates is
 * land (derivation 12).
 */
function landEdge(b, e) {
  return edgeHexes(e).some((h) => isLand(b, h));
}

/**
 * spokeCount mirrors engine/scenarios.spokeCount: how many of the three caravans an
 * oasis at h can start. Each of corners 0, 2 and 4 needs an outward
 * (non-perimeter) land edge.
 */
function spokeCount(b, h) {
  const perim = new Set(hexEdges(h).map(edgeKey));
  const verts = hexVertices(h);
  let n = 0;
  for (const ci of [0, 2, 4]) {
    for (const ve of vertexEdgesOf(verts[ci])) {
      if (!perim.has(edgeKey(ve)) && landEdge(b, ve)) { n++; break; }
    }
  }
  return n;
}

function ringHexes(radius) {
  const out = [];
  for (const h of hexesInRadius(radius)) {
    const x = h.q, y = -h.q - h.r, z = h.r;
    if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) === radius) out.push(h);
  }
  return out;
}

/**
 * OFF_BOARD is board.OffBoard's coordinate: where the robber stands while it is
 * off the board. No tile lookup can match it.
 */
const OFF_BOARD = -(2 ** 30);

/** robberOnBoard mirrors board.RobberOnBoard. */
function robberOnBoard(b) {
  return !(b.robber && b.robber.q === OFF_BOARD && b.robber.r === OFF_BOARD);
}

/**
 * robberOK mirrors board.RobberOK: the hexes the robber may sit on (producing
 * land, gold, desert, lake and swamp).
 */
function robberOK(b, h) {
  const t = b.tiles.get(hexKey(h));
  return t !== undefined &&
    (producing(t.res) || t.res === ResNone || t.res === Gold || t.res === Lake ||
     t.res === Swamp);
}

/**
 * robberNeutral mirrors board.RobberNeutral: a hex that blocks nothing, which
 * setup and relocation prefer. Swamp counts, as in Go: an authored map with a
 * swamp and no desert would otherwise take relocateRobber's drawing branch
 * here and not in the engine.
 */
function robberNeutral(b, h) {
  const t = b.tiles.get(hexKey(h));
  return t !== undefined && (t.res === ResNone || t.res === Lake || t.res === Swamp);
}

/** hasNeutral: does any hex on the board block nothing? */
function hasNeutral(b) {
  for (const t of b.tiles.values()) {
    if (t.res === ResNone || t.res === Lake || t.res === Swamp) return true;
  }
  return false;
}

/** ringOf: a hex's distance from the centre, in rings. */
function ringOf(h) {
  return Math.max(Math.abs(h.q), Math.abs(-h.q - h.r), Math.abs(h.r));
}

/** pips mirrors board.Pips: dice combinations a token pays on, 0 for no token. */
function pips(n) {
  return (n <= 0 || n === 7) ? 0 : 6 - Math.abs(7 - n);
}

/**
 * oasisSites mirrors engine/scenarios.oasisSites: interior producing hexes with
 * enough land around them to start all three caravans, in board order. The
 * finishers draw from this list with the seeded rng.
 */
function oasisSites(b) {
  const all = [], spoked = [];
  for (const h of hexesInRadius(b.radius)) {
    if (ringOf(h) >= b.radius) continue;
    const t = b.tiles.get(hexKey(h));
    if (t === undefined || !producing(t.res)) continue;
    all.push(h);
    if (spokeCount(b, h) === 3) spoked.push(h);
  }
  return spoked.length > 0 ? spoked : all;
}

/**
 * pickOasis mirrors engine/scenarios.pickOasis: the first desert in board order, else
 * the first lake.
 */
function pickOasis(b) {
  const hs = neutralHexes(b);
  return hs.length > 0 ? hs[0] : null;
}

/** neutralHexes mirrors engine/scenarios.neutralHexes: deserts, then lakes, each in board order. */
function neutralHexes(b) {
  const out = [];
  for (const want of [ResNone, Lake]) {
    for (const h of hexesInRadius(b.radius)) {
      const t = b.tiles.get(hexKey(h));
      if (t !== undefined && t.res === want) out.push(h);
    }
  }
  return out;
}

/** oasisCountFor mirrors engine/scenarios.oasisCountFor (derivation 13): 1, 2 or 3 oases. */
function oasisCountFor(players) {
  return players <= 4 ? 1 : players <= 6 ? 2 : 3;
}

/**
 * pickOases mirrors engine/scenarios.pickOases: the neutral hexes in order, each
 * taken unless it clashes with one already taken, until there are n.
 */
function pickOases(b, n) {
  const out = [];
  for (const h of neutralHexes(b)) {
    if (out.length === n) break;
    if (!out.some((o) => oasesClash(b, h, o))) out.push(h);
  }
  return out;
}

/**
 * oasesClash mirrors engine/scenarios.oasesClash: two oases clash when they touch or
 * a spoke of one shares an intersection with a spoke of the other.
 */
function oasesClash(b, a, c) {
  if (hexDist(a, c) < 2) return true;
  const ends = new Set();
  for (const e of spokeEdges(b, a)) { ends.add(vertKey(e.a)); ends.add(vertKey(e.b)); }
  return spokeEdges(b, c).some((e) => ends.has(vertKey(e.a)) || ends.has(vertKey(e.b)));
}

/** spokeEdges is oasisSpokes' real arrows (the missing ones left out). */
function spokeEdges(b, oasis) {
  const perim = new Set(hexEdges(oasis).map(edgeKey));
  const verts = hexVertices(oasis);
  const out = [];
  for (const ci of [0, 2, 4]) {
    for (const ve of vertexEdgesOf(verts[ci])) {
      if (!perim.has(edgeKey(ve)) && landEdge(b, ve)) { out.push(ve); break; }
    }
  }
  return out;
}

/**
 * relocateRobber mirrors islands.relocateRobber: the first neutral hex (desert,
 * lake or swamp), else a seeded pick among the lowest-pip legal hexes.
 */
function relocateRobber(b, rng) {
  for (const h of hexesInRadius(b.radius)) {
    if (robberNeutral(b, h)) { b.robber = h; return; }
  }
  let cands = [], best = -1;
  for (const h of hexesInRadius(b.radius)) {
    if (!robberOK(b, h)) continue;
    const p = pips(b.tiles.get(hexKey(h)).number);
    if (best < 0 || p < best) { best = p; cands = [h]; }
    else if (p === best) cands.push(h);
  }
  if (cands.length > 0) b.robber = cands[rng.intN(cands.length)];
}

/**
 * ringWalk mirrors islands.ringWalk: the hexes at exactly `radius` in cyclic
 * order, each adjacent to the next (hexesInRadius is row-major).
 */
function ringWalk(radius) {
  if (radius <= 0) return [{ q: 0, r: 0 }];
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  let h = { q: dirs[4][0] * radius, r: dirs[4][1] * radius };
  const out = [];
  for (let d = 0; d < 6; d++) {
    for (let i = 0; i < radius; i++) {
      out.push(h);
      h = { q: h.q + dirs[d][0], r: h.r + dirs[d][1] };
    }
  }
  return out;
}

/** outerIslands mirrors islands.outerIslands: 1 island at radius 2, 2 at 3, 3 at 4. */
function outerIslands(radius) {
  return Math.max(1, Math.min(3, radius - 1));
}

/** arcSpan mirrors islands.arcSpan. It draws on larger boards, so call order
 *  matters. */
function arcSpan(radius, rng) {
  if (radius < 3) return 2;
  return 2 + rng.intN(2);
}

/**
 * islandsSetupBoard ports engine/islands.SetupBoard: it carves a mainland, one
 * to three outer islands parted from it by a sea channel, a notched mainland
 * coast and gold on the islands, then recomputes harbors.
 *
 * The caller skips it when cfg.preset or cfg.board is set, as the Go hook does.
 */
function islandsSetupBoard(b, rng, fair = false) {
  const ring = ringWalk(b.radius);
  const l = ring.length;
  const k = outerIslands(b.radius);
  const slot = Math.floor(l / k);

  const off = rng.intN(l);
  const inArc = new Set();
  // key -> hex, so the drowned set can be both tested and walked.
  const drown = new Map();
  const arcs = [];
  for (let i = 0; i < k; i++) {
    const span = arcSpan(b.radius, rng);
    const jitter = slot > span ? rng.intN(slot - span) : 0;
    const start = off + i * slot + jitter;
    const arc = [];
    for (let j = 0; j < span; j++) {
      const h = ring[(start + j) % l];
      arc.push(h);
      inArc.add(hexKey(h));
    }
    arcs.push(arc);
    for (const h of [ring[(((start - 1) % l) + l) % l], ring[(start + span) % l]]) {
      if (!inArc.has(hexKey(h))) drown.set(hexKey(h), h);
    }
  }
  // The channel: an arc hex's only remaining land neighbours are at ring R-1.
  for (const arc of arcs) {
    for (const h of arc) {
      for (const n of neighbors(h)) {
        if (ringOf(n) === b.radius - 1) drown.set(hexKey(n), n);
      }
    }
  }
  // Notches: single-hex bays, never shoulder to shoulder, at most `radius` of
  // them. The draw happens for every candidate whether or not it is accepted.
  let notches = 0;
  const budget = b.radius;
  for (let i = 0; i < l; i++) {
    const key = hexKey(ring[i]);
    if (inArc.has(key) || drown.has(key)) continue;
    const hit = rng.intN(4) === 0;
    if (!hit || notches === budget) continue;
    if (drown.has(hexKey(ring[(i + l - 1) % l])) || drown.has(hexKey(ring[(i + 1) % l]))) continue;
    drown.set(key, ring[i]);
    notches++;
  }

  for (const h of drown.values()) b.tiles.set(hexKey(h), { res: Sea, number: 0 });

  // If the carve took the last desert, make a new one from the lowest-pip
  // surviving hex (seeded tie-break). Reviving a drowned hex could close the
  // channel.
  if (!hasNeutral(b)) {
    let cands = [], best = -1;
    for (const h of hexesInRadius(b.radius)) {
      const key = hexKey(h);
      if (drown.has(key) || inArc.has(key)) continue;
      const t = b.tiles.get(key);
      if (t === undefined || !producing(t.res)) continue;
      const p = pips(t.number);
      if (best < 0 || p < best) { best = p; cands = [h]; }
      else if (p === best) cands.push(h);
    }
    if (cands.length > 0) {
      b.tiles.set(hexKey(cands[rng.intN(cands.length)]), { res: ResNone, number: 0 });
    }
  }

  goldRush(b, arcs, rng);

  // Fair boards are rebalanced after the carve (derivation 13). rng-free;
  // every token is movable since a carved board is never authored. Runs after
  // gold and before FinishBoard, as in Go.
  if (fair) rebalanceNumbers(b, () => true);

  // The carve may have drowned the robber's hex. An off-board robber
  // (Fishermen) is left alone, as in Go, so no extra draw is spent.
  if (robberOnBoard(b) && !robberOK(b, b.robber)) relocateRobber(b, rng);
  b.harbors = placeHarborsFor(rng, b, b.harbors.length);
}

/**
 * goldRush mirrors islands.goldRush: island tiles turn to gold at one in four,
 * keeping their token, and at least one always does.
 */
function goldRush(b, arcs, rng) {
  const cands = [];
  for (const arc of arcs) {
    for (const h of arc) {
      const t = b.tiles.get(hexKey(h));
      if (t !== undefined && producing(t.res) && t.number !== 0) cands.push(h);
    }
  }
  if (cands.length === 0) {
    for (const h of hexesInRadius(b.radius)) {
      const t = b.tiles.get(hexKey(h));
      if (t !== undefined && producing(t.res) && t.number !== 0) cands.push(h);
    }
  }
  let gold = 0;
  for (const h of cands) {
    if (rng.intN(4) !== 0) continue;
    b.tiles.set(hexKey(h), { res: Gold, number: b.tiles.get(hexKey(h)).number });
    gold++;
  }
  if (gold === 0 && cands.length > 0) {
    const h = cands[rng.intN(cands.length)];
    b.tiles.set(hexKey(h), { res: Gold, number: b.tiles.get(hexKey(h)).number });
  }
}

/**
 * fishermenSetupBoard turns every desert into a lake and puts the robber off
 * the board (it enters on the first 7), since on the lake it would block all
 * four lake numbers. It draws nothing.
 */
function fishermenSetupBoard(b, rng) {
  for (const [k, t] of b.tiles) {
    // Number 0, as in Go: the lake pays on its four LakeNumbers, not a tile
    // token. Matters only for a config that numbered a desert.
    if (t.res === ResNone) b.tiles.set(k, { res: Lake, number: 0 });
  }
  b.robber = { q: OFF_BOARD, r: OFF_BOARD };
}

/**
 * dealtTerrain is engine/scenarios/caravans.go's dealtTerrain: per hex, whether the
 * tile was dealt by the engine (movable) or pinned by the map author. Generic
 * land with a blank number was dealt; a named terrain or chosen token was
 * pinned, and a preset pins every tile.
 */
function dealtTerrain(cfg) {
  // Board before preset, mirroring engine.State.New: an inlined board wins.
  if (cfg && cfg.board) {
    const src = new Map();
    for (const t of cfg.board.tiles || []) src.set(hexKey(t.hex), t);
    return (h) => {
      const t = src.get(hexKey(h));
      // Absent means Board.Frame added it as ocean: nobody's to promote.
      return t !== undefined && t.res === "land" && (t.num || 0) === 0;
    };
  }
  if (cfg && cfg.preset) return () => false;
  return () => true;
}

/**
 * caravansFinishBoard is engine/scenarios/caravans.go's FinishBoard: it ensures the
 * board has an oasis (a desert, or the lake Fishermen made of it) that can
 * start all three caravans. It runs after every SetupBoard because Islands may
 * drown the only desert.
 *
 * With no oasis left it promotes an interior producing hex (token removed) to
 * desert. The robber then goes off the board, since it may not start on the
 * oasis (derivation 10).
 *
 * It draws only when repairing: once for a promotion, once per swap, and once
 * per oasis fillOases promotes. The order of those draws on the position-3
 * stream must match Go.
 *
 * `dealt` says which hexes it may reshape (see dealtTerrain).
 */
function caravansFinishBoard(b, rng, dealt = () => true, reserved = null, players = 0, fair = false) {
  finishOasis(b, rng, dealt, reserved, players, fair);
  b.robber = { q: OFF_BOARD, r: OFF_BOARD };
}

/** finishOasis is engine/scenarios/caravans.go's finishOasis: the repair half. */
function finishOasis(b, rng, dealt, reserved = null, players = 0, fair = false) {
  // Hexes another module claims off the finished board (engine.ReservedHexes:
  // the Wagons trade-hex candidates). The oasis may not sit on one and no
  // repair moves it onto one (derivation 11).
  const isReserved = (h) => reserved !== null && reserved.has(hexKey(h));
  const n = oasisCountFor(players);
  if (pickOasis(b) === null && n === 1) {
    // No oasis: promote a seeded producing hex. Tables of five or more use
    // fillOases instead.
    const sites = oasisSites(b).filter((h) => dealt(h) && !isReserved(h));
    if (sites.length === 0) return;
    const h = sites[rng.intN(sites.length)];
    b.tiles.set(hexKey(h), { res: ResNone, number: 0 });
    // Rebalance a fair board after removing a token (derivation 13). No
    // engine-dealt board reaches this today; oasischeck.mjs covers it.
    if (fair) rebalanceNumbers(b, dealt);
    return;
  }
  // Every oasis (derivation 13: two at 5-6 seats, three at 7-10) must start
  // three caravans and avoid reserved hexes. Each pass repairs the first bad
  // dealt oasis, else, while an oasis short, the first dealt neutral hex
  // pickOases skipped. The swap partner is an interior non-red hex that starts
  // three caravans and clashes with no other oasis; a hex with no partner is
  // marked stuck.
  const stuck = new Set();
  for (let i = 0; i < b.tiles.size; i++) {
    const oases = pickOases(b, n);
    let target = null;
    for (const o of oases) {
      if (stuck.has(hexKey(o)) || !dealt(o)) continue;
      if (spokeCount(b, o) !== 3 || isReserved(o)) { target = o; break; }
    }
    if (target === null && oases.length < n) {
      const taken = new Set(oases.map(hexKey));
      for (const h of neutralHexes(b)) {
        if (!taken.has(hexKey(h)) && !stuck.has(hexKey(h)) && dealt(h)) { target = h; break; }
      }
    }
    if (target === null) break;
    const others = oases.filter((o) => hexKey(o) !== hexKey(target));
    const sites = oasisSites(b).filter((h) => {
      if (!dealt(h) || isReserved(h) || spokeCount(b, h) !== 3) return false;
      const num = b.tiles.get(hexKey(h)).number;
      if (num === 6 || num === 8) return false;
      return !others.some((o) => oasesClash(b, h, o));
    });
    if (sites.length === 0) { stuck.add(hexKey(target)); continue; }
    const h = sites[rng.intN(sites.length)];
    const ta = b.tiles.get(hexKey(target)), tc = b.tiles.get(hexKey(h));
    b.tiles.set(hexKey(target), tc);
    b.tiles.set(hexKey(h), ta);
  }
  // Rebalance a fair board after a promotion (derivation 13).
  if (fillOases(b, rng, dealt, isReserved, n) && fair) rebalanceNumbers(b, dealt);
}

/**
 * fillOases is engine/scenarios.fillOases: for each oasis a table of five or more is
 * still short after the swaps (an Islands carve drowned a desert), promote an
 * interior, dealt, unreserved, non-red producing hex that starts three caravans
 * and clashes with no oasis, drawn from the finisher's stream after the swaps,
 * and only among the candidates that leave room for the rest (fillable). It
 * becomes a desert with no token. Reports whether it promoted any.
 */
function fillOases(b, rng, dealt, isReserved, n) {
  const oases = pickOases(b, n);
  let need = n - oases.length;
  if (need <= 0) return false;
  let cands = oasisSites(b).filter((h) => {
    if (!dealt(h) || isReserved(h) || spokeCount(b, h) !== 3) return false;
    const num = b.tiles.get(hexKey(h)).number;
    if (num === 6 || num === 8) return false;
    return !oases.some((o) => oasesClash(b, h, o));
  });
  while (need > 0 && !fillable(b, cands, need)) need--;
  for (let k = need; k > 0; k--) {
    const sites = cands.filter((h) => fillable(b, compatibleWith(b, cands, h), k - 1));
    const h = sites[rng.intN(sites.length)];
    b.tiles.set(hexKey(h), { res: ResNone, number: 0 });
    cands = compatibleWith(b, cands, h);
  }
  return need > 0;
}

/** compatibleWith is engine/scenarios.compatible: the candidates that do not clash with h. */
function compatibleWith(b, cands, h) {
  return cands.filter((c) => !oasesClash(b, c, h));
}

/** fillable is engine/scenarios.fillable: can k pairwise-compatible oases come from cands? */
function fillable(b, cands, k) {
  if (k <= 0) return true;
  for (let i = 0; i < cands.length; i++) {
    if (fillable(b, compatibleWith(b, cands.slice(i + 1), cands[i]), k - 1)) return true;
  }
  return false;
}

/**
 * fishermenFinishBoard is engine/scenarios/fishermen.go's FinishBoard: it ensures
 * the board still has a lake after every other module has run. It floods any
 * dealt desert that reappeared (Caravans' finisher makes one, and "caravans"
 * sorts first), and if no lake exists promotes a seeded interior hex. With
 * Caravans, the lake and the oasis are the same hex.
 */
function fishermenFinishBoard(b, rng, dealt = () => true, reserved = null) {
  let lake = false;
  for (const h of hexesInRadius(b.radius)) {
    const t = b.tiles.get(hexKey(h));
    if (t === undefined) continue;
    if (t.res === ResNone) {
      // Only engine-dealt deserts are flooded.
      if (!dealt(h)) continue;
      b.tiles.set(hexKey(h), { res: Lake, number: 0 });
      lake = true;
    } else if (t.res === Lake) {
      lake = true;
    }
  }
  if (!lake) {
    const sites = oasisSites(b).filter(dealt);
    if (sites.length > 0) {
      const h = sites[rng.intN(sites.length)];
      b.tiles.set(hexKey(h), { res: Lake, number: 0 });
      if (robberOnBoard(b) && !robberNeutral(b, b.robber)) b.robber = h;
    }
  }
  keepLakesOffReserved(b, dealt, reserved);
}

/**
 * keepLakesOffReserved is engine/scenarios.keepLakesOffReserved (derivation 12): each
 * engine-dealt lake on a reserved hex (a Wagons trade-hex candidate) swaps
 * tiles with the nearest dealt, unreserved oasis site without a 6 or 8 (cube
 * distance, ties by board order). No draw.
 */
function keepLakesOffReserved(b, dealt, reserved) {
  if (reserved === null || reserved.size === 0) return;
  for (const h of hexesInRadius(b.radius)) {
    const t = b.tiles.get(hexKey(h));
    if (t === undefined || t.res !== Lake || !reserved.has(hexKey(h)) || !dealt(h)) continue;
    let best = null, bestD = 0;
    for (const c of oasisSites(b)) {
      if (!dealt(c) || reserved.has(hexKey(c))) continue;
      const n = b.tiles.get(hexKey(c)).number;
      if (n === 6 || n === 8) continue;
      const d = hexDistOf(h, c);
      if (best === null || d < bestD) { best = c; bestD = d; }
    }
    if (best !== null) {
      const a = b.tiles.get(hexKey(h)), c = b.tiles.get(hexKey(best));
      b.tiles.set(hexKey(h), c);
      b.tiles.set(hexKey(best), a);
    }
  }
}

// ---------------------------------------------------------------------------
// Wagons (engine/wagons).
//
//   - SetupBoard removes the robber for the whole game; a 7 moves a barbarian.
//   - InitExtBoard derives the three trade hexes, which is the castle, and the
//     three barbarians' starts from the finished board and the public seed
//     (slot WagonsBoardSeq), recorded in EvBoardGenerated's ext blob.

/** WAGONS_BOARD_SEQ is engine.WagonsBoardSeq: the one public slot the board layer reads. */
const WAGONS_BOARD_SEQ = -7_000_000;

/** TRADE_HEX_COUNT is three, at every player count. */
const TRADE_HEX_COUNT = 3;

/**
 * wagonsSetupBoard is engine/wagons.SetupBoard: the robber goes beside the
 * board and nothing brings it back.
 */
function wagonsSetupBoard(b) {
  b.robber = { q: OFF_BOARD, r: OFF_BOARD };
}

/**
 * capeOutward mirrors engine/wagons.capeOutward: a cape is land with exactly
 * three consecutive non-land neighbours; returns the middle one's direction,
 * or -1. On a full hexagon the capes are the six corners.
 */
function capeOutward(b, h) {
  if (!isLand(b, h)) return -1;
  const water = neighbors(h).map((nb) => !isLand(b, nb));
  if (water.filter(Boolean).length !== 3) return -1;
  for (let s = 0; s < 6; s++) {
    if (water[s] && water[(s + 1) % 6] && water[(s + 2) % 6]) return (s + 1) % 6;
  }
  return -1; // three, but not consecutive: a strait, not a cape
}

// hexDistOf is the cube distance between two hexes. It cannot be named
// hexDist: the bundle shares one scope with frame.mjs.
function hexDistOf(a, c) {
  const dq = a.q - c.q, dr = a.r - c.r, ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/** MAX_CAPES bounds the triple enumeration, as engine/wagons.maxCapes does. */
const MAX_CAPES = 20;

/**
 * wagonsTrade is engine/wagons.deriveTrade: the triple of capes with the
 * largest minimum pairwise distance, the tie broken by the seeded rng, and the
 * three roles permuted over it.
 */
function wagonsTrade(b, rng, raiders = false, caravans = false, fishermen = false, castleAvoid = null, players = 0) {
 // Caravans' TradeHexAllowed: no oasis is a trade hex (derivation 11; every
 // oasis of a larger table since derivation 13).
 const oasis = caravans ? caravansOasis(b, players) : null;
 const oasisKeys = new Set(oasis && oasis.HasOasis ? oasis.Oases.map(hexKey) : []);
 const land = raiders ? raidersMainLandmass(b) : [];
 const landSet = new Set(land.map(hexKey));
 // Raiders' TradeHexAllowed: the castle, which avoids the watercourse and the
 // reserved hexes (derivation 12), is never a trade hex.
 const castle = raiders ? raidersCastleHex(b,land,landSet,castleAvoid) : null;
 // Fishermen's TradeHexAllowed: no lake is a trade hex (derivation 12).
 const isLake = (h) => { const t = b.tiles.get(hexKey(h)); return fishermen && t !== undefined && t.res === Lake; };
  let capes = [];
  for (const h of hexesInRadius(b.radius)) {
    if (capeOutward(b, h) >= 0 && (!raiders || (landSet.has(hexKey(h)) && (!castle || hexKey(h)!==hexKey(castle)))) && !oasisKeys.has(hexKey(h)) && !isLake(h)) capes.push(h);
  }
  if (capes.length > MAX_CAPES) capes = capes.slice(0, MAX_CAPES);
  if (capes.length < TRADE_HEX_COUNT) return null;
  let best = -1;
  let pick = [];
  for (let i = 0; i < capes.length; i++) {
    for (let j = i + 1; j < capes.length; j++) {
      for (let k = j + 1; k < capes.length; k++) {
        const d = Math.min(
          hexDistOf(capes[i], capes[j]), hexDistOf(capes[i], capes[k]), hexDistOf(capes[j], capes[k]),
        );
        if (d > best) { best = d; pick = []; }
        if (d === best) pick.push([capes[i], capes[j], capes[k]]);
      }
    }
  }
  if (pick.length === 0) return null;
  const hexes = pick[rng.intN(pick.length)];
  const roles = rng.perm(TRADE_HEX_COUNT);
  return { hexes, roles };
}

/** seawardEdgesOf are a trade hex's three blocked coastal edges. */
function seawardEdgesOf(b, h) {
  const out = [];
  for (const e of hexEdges(h)) {
    for (const hh of edgeHexes(e)) {
      if (hexKey(hh) !== hexKey(h) && !isLand(b, hh)) { out.push(e); break; }
    }
  }
  return out;
}

/** sharedEdgeOf is the edge two adjacent hexes share, or null. */
function sharedEdgeOf(a, c) {
  for (const e of hexEdges(a)) {
    for (const hh of edgeHexes(e)) {
      if (hexKey(hh) === hexKey(c)) return e;
    }
  }
  return null;
}

/** boardEdgesOf lists every edge of the board once, in board order. */
function boardEdgesOf(b) {
  const seen = new Set();
  const out = [];
  for (const h of hexesInRadius(b.radius)) {
    if (!b.tiles.has(hexKey(h))) continue;
    for (const e of hexEdges(h)) {
      const k = edgeKey(e);
      if (!seen.has(k)) { seen.add(k); out.push(e); }
    }
  }
  return out;
}

/**
 * wagonsBarbarians is engine/wagons.deriveBarbarians: per trade hex, the path
 * shared by the hex one ring in along its outward direction and the hex one step
 * around from that, with a walk of the board's edge order as the fallback.
 */
function wagonsBarbarians(b, hexes) {
  const all = boardEdgesOf(b);
  const index = new Map(all.map((e, i) => [edgeKey(e), i]));
  const taken = new Set();
  const blocked = new Set();
  for (const h of hexes) for (const e of seawardEdgesOf(b, h)) blocked.add(edgeKey(e));
  const legal = (e) => {
    const k = edgeKey(e);
    return landEdge(b, e) && !blocked.has(k) && !taken.has(k);
  };
  const out = [];
  for (const h of hexes) {
    let start = 0;
    let placed = null;
    const dir = capeOutward(b, h);
    if (dir >= 0) {
      const d = neighbors({ q: 0, r: 0 });
      const inner = { q: h.q - d[dir].q, r: h.r - d[dir].r };
      const round = d[(dir + 1) % 6];
      const around = { q: inner.q + round.q, r: inner.r + round.r };
      const e = sharedEdgeOf(inner, around);
      if (e) {
        if (legal(e)) placed = e;
        else if (index.has(edgeKey(e))) start = index.get(edgeKey(e));
      }
    }
    if (!placed) {
      for (let n = 0; n < all.length; n++) {
        const e = all[(start + n) % all.length];
        if (legal(e)) { placed = e; break; }
      }
    }
    out.push(placed || { a: { q: 0, r: 0, side: N }, b: { q: 0, r: 0, side: N } });
    if (placed) taken.add(edgeKey(placed));
  }
  return out;
}

/**
 * wagonsFinishBoard is engine/wagons.FinishBoard (derivation 12): a harbour
 * whose ends are both a cape's sea-only corners (which a trade hex blocks for
 * building) moves to the first of the cape's other seaward edges, in the
 * cape's edge order, that shares no corner or dock hex with another harbour.
 * Covers every cape Wagons could pick, in board order; no draw.
 */
function wagonsFinishBoard(b) {
  const capes = [];
  for (const h of hexesInRadius(b.radius)) {
    if (capeOutward(b, h) >= 0) capes.push(h);
  }
  const touchesLand = (c, v) => vertexHexes(v).some((hh) => hexKey(hh) !== hexKey(c) && isLand(b, hh));
  const fits = (i, e) => {
    const sea = harborSeaHex(b, { verts: [e.a, e.b] });
    if (sea === null) return false;
    for (let j = 0; j < b.harbors.length; j++) {
      if (j === i) continue;
      const o = b.harbors[j];
      const ov = o.verts.map(vertKey);
      if (ov.includes(vertKey(e.a)) || ov.includes(vertKey(e.b))) return false;
      const os = harborSeaHex(b, o);
      if (os !== null && hexKey(os) === hexKey(sea)) return false;
    }
    return true;
  };
  for (const c of capes.slice(0, MAX_CAPES)) {
    const corners = new Set(hexVertices(c).map(vertKey));
    for (let i = 0; i < b.harbors.length; i++) {
      const hb = b.harbors[i];
      if (!hb.verts.every((v) => corners.has(vertKey(v)) && !touchesLand(c, v))) continue;
      const own = edgeKey(newEdge(hb.verts[0], hb.verts[1]));
      for (const e of seawardEdgesOf(b, c)) {
        if (edgeKey(e) === own || !fits(i, e)) continue;
        b.harbors[i] = { ...hb, verts: [e.a, e.b] };
        break;
      }
    }
  }
}

/**
 * wagonsBoardExt is the audited half of the wagons ext blob: the three trade
 * hexes, their roles, and the three barbarian start paths. Field names and
 * shapes match engine/wagons.WagonsExt, since the check compares by key.
 */
function wagonsBoardExt(b, publicSeed, rngFor, raiders = false, caravans = false, fishermen = false, castleAvoid = null, players = 0) {
  const t = wagonsTrade(b, rngFor(publicSeed, WAGONS_BOARD_SEQ), raiders, caravans, fishermen, castleAvoid, players);
  if (!t) return { Trade: [], Roles: [], HasTrade: false, Barbarians: [] };
  return {
    Trade: t.hexes.map((h) => ({ q: h.q, r: h.r })),
    Roles: t.roles,
    HasTrade: true,
    Barbarians: wagonsBarbarians(b, t.hexes),
  };
}

// ---------------------------------------------------------------------------
// The Rivers watercourse (engine/rivers/board.go)
// ---------------------------------------------------------------------------
//
// Everything from here to riversFinishBoard transcribes engine/rivers/board.go
// function for function and draw for draw; docs/rules/rivers.md ("Deriving the
// river on a generated board") specifies both. Where they disagree, Go wins.
//
// The derivation: one source-to-sea chain of land hexes per 30 land hexes,
// each chosen from the best-scoring candidates with one seeded draw. The board
// is then painted: the estuary becomes a swamp with no token and the source
// becomes mountains (see paintRivers). A second, cosmetic draw per east-west
// hex picks one of two meanders.
//
// It runs twice and both runs must agree: FinishBoard derives and paints, then
// InitExtBoard derives again off the painted board, and that second result is
// what the ext blob records. Both mint a fresh generator on the same slot, and
// the derivation reads no terrain, so painting cannot change the answer.
//
// Three names differ from Go to avoid collisions in the bundle's shared scope:
// newRiverGrid (newGrid), enumerateChains (enumerate), riverEligible
// (eligible).

/**
 * RIVERS_BOARD_SEQ is the reserved public slot the watercourse derivation
 * reads; must match engine.RiversBoardSeq. Rivers draws on every board, so on
 * the shared slot 3 its first draw would equal the Caravans repair draw.
 */
const RIVERS_BOARD_SEQ = -4000000;

/**
 * RIVERS_VARIANT_SEQ is the public slot for the tile variant choice: which of
 * two east-west meanders each straight river hex draws (engine.RiversVariantSeq).
 * It is separate from RIVERS_BOARD_SEQ so it does not shift the chain draws.
 * The result is visible and recorded in the ext blob, so it is audited.
 */
const RIVERS_VARIANT_SEQ = -4000001;

/** EW_VARIANTS is how many authored meanders the east-west straight has. */
const EW_VARIANTS = 2;

/**
 * BOARD_FINISH_SEQ is the shared position-3 slot for finishers without a
 * reserved slot of their own (engine's boardFinishSeq).
 */
const BOARD_FINISH_SEQ = 3;

/**
 * riverCount is how many watercourses a board of this many land hexes carries:
 * 1 + (land-1)/30 (Go integer division). One river at radius 2 (19 hexes), two
 * at radius 3 (37), three at radius 4 (61).
 */
function riverCount(land) {
  if (land < 1) return 0;
  return 1 + Math.floor((land - 1) / 30);
}

/**
 * chainLenCeiling caps maxChainLen at its radius-4 value (11), the largest
 * procedural board. An authored map may be radius 16, and the search is
 * exponential in the cap.
 */
const chainLenCeiling = 11;

/** maxChainLen is the cap on a chain, 2*radius+3. */
function maxChainLen(radius) {
  return Math.min(2 * radius + 3, chainLenCeiling);
}

/** minChainLen is the shortest chain that reads as a river. */
const minChainLen = 4;

/**
 * searchNodeBudget bounds the chain enumeration for a whole derivation (all
 * rivers), so the counter is threaded through rather than reset per river.
 * Procedural boards peak around 1.5M nodes at radius 4, so 16M leaves about
 * 4x headroom; the bound exists for large authored maps.
 *
 * It is part of the derivation: when it runs out, the engine keeps the
 * candidates found so far, so a different budget would pick a different river.
 */
const searchNodeBudget = 16000000;

/**
 * riverEligible reports whether hex h may carry a channel (engine/rivers's
 * `eligible`). Excluded: sea, border, fog, generic land, desert, lake and gold.
 * Swamp stays eligible because the first pass paints one at the mouth and the
 * second pass must agree with it.
 */
function riverEligible(b, h) {
  const t = b.tiles.get(hexKey(h));
  if (t === undefined) return false;
  switch (t.res) {
    case Sea: case Border: case Fog: case ResNone:
    case Lake: case Gold: case ResLand:
      return false;
    default:
      return true;
  }
}

/**
 * openWater reports whether hex h borders sea or the board's edge (a missing
 * tile is not land), i.e. the coast a chain must reach.
 */
function openWater(b, h) {
  for (const n of neighbors(h)) {
    if (!isLand(b, n)) return true;
  }
  return false;
}

/**
 * dirTo returns the index in neighbors() of neighbour n of h, and whether n is
 * a neighbour at all.
 */
function dirTo(h, n) {
  const ns = neighbors(h);
  for (let i = 0; i < 6; i++) {
    if (ns[i].q === n.q && ns[i].r === n.r) return { dir: i, ok: true };
  }
  return { dir: 0, ok: false };
}

/**
 * drawable reports whether two channel directions out of one hex are a shape a
 * tile can draw: opposite (straight) or two apart (a bend). Adjacent directions
 * would be a 60 degree hairpin.
 */
function drawable(a, b) {
  const d = (((a - b) % 6) + 6) % 6;
  return d === 2 || d === 3 || d === 4;
}

/**
 * Directions: neighbors() runs {+1,0} {+1,-1} {0,-1} {-1,0} {-1,+1} {0,+1},
 * which the client draws as east, north-east, north-west, west, south-west and
 * south-east (bearings 0, 60, 120, 180, 240, 300). A chain may step in all
 * six; the step rule decides which chains exist, so it must match the engine.
 */

/**
 * edgeIndexForDir maps a neighbour direction (index in neighbors()) to the
 * index in hexEdges() of the shared edge: e = (1 - d) mod 6. hexEdges runs
 * clockwise from the north-east edge, neighbors anticlockwise from east.
 */
function edgeIndexForDir(d) {
  return (((1 - d) % 6) + 6) % 6;
}

/** seamEdge is the edge hexes a and b share. a and b must be neighbours. */
function seamEdge(a, b) {
  const { dir, ok } = dirTo(a, b);
  if (!ok) return null;
  return hexEdges(a)[edgeIndexForDir(dir)];
}

/**
 * outerEdge picks the coastal outlet at a chain's estuary: the edge shared with
 * a non-land neighbour whose direction is opposite or two apart from the seam
 * with its chain neighbour. The source end has no outlet.
 *
 * With several candidates, the first sea neighbour in board order (Q, R) wins;
 * the candidates are distinct, so the order is total.
 */
function outerEdge(b, end, inward) {
  const seam = dirTo(end, inward);
  if (!seam.ok) return { edge: null, dir: 0, ok: false };
  const cands = [];
  const ns = neighbors(end);
  for (let d = 0; d < 6; d++) {
    // drawable excludes the 60 degree hairpin at an end hex.
    if (isLand(b, ns[d]) || !drawable(d, seam.dir)) continue;
    cands.push({ hex: ns[d], dir: d });
  }
  if (cands.length === 0) return { edge: null, dir: 0, ok: false };
  cands.sort((x, y) => (x.hex.q !== y.hex.q ? x.hex.q - y.hex.q : x.hex.r - y.hex.r));
  const d = cands[0].dir;
  return { edge: hexEdges(end)[edgeIndexForDir(d)], dir: d, ok: true };
}

/** hexLess is board order over one hex: Q, then R. */
function hexLess(a, b) {
  if (a.q !== b.q) return a.q < b.q;
  return a.r < b.r;
}

/**
 * chainLess is board order over whole chains: h1's (Q, R), then h2's, and so
 * on. The candidate list is sorted by it so the seeded pick is stable.
 */
function chainLess(a, b) {
  for (let i = 0; i < a.length && i < b.length; i++) {
    if (a[i].q !== b[i].q || a[i].r !== b[i].r) return hexLess(a[i], b[i]);
  }
  return a.length < b.length;
}

/**
 * newRiverGrid (engine/rivers's `newGrid`) flattens the board into
 * index-addressed arrays, in board order, for the chain walk, which visits
 * millions of nodes on the largest board.
 */
function newRiverGrid(b, reserved = null) {
  const all = hexesInRadius(b.radius);
  const g = {
    hexes: all,
    index: new Map(),
    // nbr[i][d] is the index of hex i's neighbour in direction d, or -1 when
    // that neighbour is off the board or ineligible.
    nbr: [],
    coastal: [],
    eligible: [],
  };
  all.forEach((h, i) => g.index.set(hexKey(h), i));
  for (let i = 0; i < all.length; i++) {
    const h = all[i];
    const free = (x) => !reserved || !reserved.has(hexKey(x));
    g.eligible[i] = riverEligible(b, h) && free(h);
    g.coastal[i] = openWater(b, h);
    const row = [-1, -1, -1, -1, -1, -1];
    const ns = neighbors(h);
    for (let d = 0; d < 6; d++) {
      const j = g.index.get(hexKey(ns[d]));
      if (j === undefined || !riverEligible(b, ns[d]) || !free(ns[d])) continue;
      row[d] = j;
    }
    g.nbr[i] = row;
  }
  return g;
}

/**
 * enumerateChains walks candidate chains and keeps only the best-scoring ones:
 * longest, then coastal ends farthest apart. `blocked` is earlier rivers and
 * their neighbours; `nodes` is the budget counter shared across the whole
 * derivation (a box, as Go passes a pointer). Discarding worse candidates as
 * it goes matters once the budget runs out.
 *
 * The walk starts at the estuary (a coastal hex) and each candidate is
 * reversed so `hexes` reads source to sea. A chain and its reverse are two
 * candidates when both ends are coastal; do not dedupe them.
 *
 * `maxLen` comes from deriveRivers, which lowers it pass by pass.
 */
function enumerateChains(b, g, blocked, minLen, maxLen, nodes) {
  const n = g.hexes.length;

  const chain = [];
  const onChain = new Array(n).fill(false);
  let best = [];
  let bestLen = 0, bestDist = 0;

  // touchesChain reports whether hex i touches a chain hex other than the
  // chain's last. This is the hairpin rule: if h(k-1) and h(k+1) were
  // adjacent, h(k)'s channel edges would be 60 degrees apart.
  const touchesChain = (i, last) => {
    for (const j of g.nbr[i]) {
      if (j >= 0 && j !== last && onChain[j]) return true;
    }
    return false;
  };

  const record = (outDir) => {
    const first = chain[0], last = chain[chain.length - 1];
    const fh = g.hexes[first], lh = g.hexes[last];
    const dist = hexDist(fh, lh);
    if (chain.length < bestLen || (chain.length === bestLen && dist < bestDist)) return;
    if (chain.length > bestLen || dist > bestDist) {
      bestLen = chain.length;
      bestDist = dist;
      best = [];
    }
    // Reversed so the candidate reads source to sea.
    best.push({
      hexes: chain.map((ci) => g.hexes[ci]).reverse(),
      outDir,
      endDist: dist,
    });
  };

  // walk extends the chain by one hex, away from the estuary. outDir/outOK are
  // the estuary's (chain[0]) coastal outlet, fixed once the chain has a second
  // hex.
  const walk = (outDir, outOK, inFrom) => {
    if (nodes.n > searchNodeBudget) return;
    if (outOK && chain.length >= minLen) record(outDir);
    if (chain.length >= maxLen) return;
    const last = chain[chain.length - 1];
    for (let d = 0; d < 6; d++) {
      const j = g.nbr[last][d];
      // Count every direction examined, as the engine does.
      nodes.n++;
      if (nodes.n > searchNodeBudget) return;
      if (j < 0 || blocked[j] || onChain[j]) continue;
      // The channel through `last` must be drawable.
      if (inFrom >= 0 && !drawable(inFrom, d)) continue;
      if (touchesChain(j, last)) continue;
      let nextOut = outDir, nextOK = outOK;
      if (chain.length === 1) {
        // The estuary's outlet depends on the chain's first step; without a
        // drawable outlet the subtree is dead.
        const oe = outerEdge(b, g.hexes[chain[0]], g.hexes[j]);
        if (!oe.ok) continue;
        nextOut = oe.dir;
        nextOK = true;
      }
      chain.push(j);
      onChain[j] = true;
      // j's seam back toward `last` is direction d+3.
      walk(nextOut, nextOK, (d + 3) % 6);
      onChain[j] = false;
      chain.pop();
    }
  };

  // Roots are coastal eligible hexes (estuaries).
  for (let i = 0; i < g.hexes.length; i++) {
    if (blocked[i] || !g.eligible[i] || !g.coastal[i]) continue;
    chain.length = 0;
    chain.push(i);
    onChain[i] = true;
    walk(0, false, -1);
    onChain[i] = false;
  }
  // Board order, matching Go's sort.SliceStable (Array.sort is stable).
  best.sort((x, y) => (chainLess(x.hexes, y.hexes) ? -1 : chainLess(y.hexes, x.hexes) ? 1 : 0));
  return best;
}

/**
 * buildRiver turns a chosen candidate into the stored River: channel edges per
 * hex, the mouth and the bridge sites. hexes[0] is the source and hexes[n-1]
 * the estuary (the mouth). The source has one opening, recorded as
 * in[0] === out[0], so there are n bridge sites: n-1 seams plus the outlet.
 *
 * Key order must match Go's field order (hexes, mouth, in, out, sites,
 * variants) because verifyBoardExt compares with JSON.stringify.
 */
function buildRiver(b, c) {
  const n = c.hexes.length;
  const hexes = c.hexes.slice();
  const inEdges = new Array(n).fill(null);
  const outEdges = new Array(n).fill(null);
  for (let i = 0; i < n - 1; i++) {
    const seam = seamEdge(hexes[i], hexes[i + 1]);
    // Unreachable: chain hexes are neighbours.
    if (seam === null) continue;
    outEdges[i] = seam;
    inEdges[i + 1] = seam;
  }
  outEdges[n - 1] = hexEdges(hexes[n - 1])[edgeIndexForDir(c.outDir)];
  // The source's single opening serves as both channel edges (after the loop,
  // so a one-hex chain gets its outlet).
  inEdges[0] = outEdges[0];
  // Bridge sites are exactly `out`, in chain order.
  const sites = outEdges.slice();
  const mouth = n - 1;
  return { hexes, mouth, in: inEdges, out: outEdges, sites, variants: new Array(n).fill(0) };
}

/**
 * isEastWest reports whether hex h's two channel edges are east and west, the
 * only shape with more than one meander (engine/rivers's isEastWest). The full
 * shape table is not needed to reproduce the variant.
 */
function isEastWest(h, inE, outE) {
  const es = hexEdges(h);
  const e = es[edgeIndexForDir(0)], w = es[edgeIndexForDir(3)];
  const same = (a, x) => a !== null && edgeKey(a) === edgeKey(x);
  return (same(inE, e) && same(outE, w)) || (same(inE, w) && same(outE, e));
}

/**
 * assignVariants picks each east-west hex's meander (engine/rivers's
 * assignVariants): one draw per such hex, in river then chain order, off
 * RIVERS_VARIANT_SEQ. Other hexes get 0.
 */
function assignVariants(rivers, rng) {
  for (const r of rivers) {
    r.variants = r.hexes.map((h, i) => (isEastWest(h, r.in[i], r.out[i]) ? rng.intN(EW_VARIANTS) : 0));
  }
}

/**
 * deriveRivers is the whole derivation (engine/rivers.DeriveRivers), a pure
 * function of the finished board and the reserved public stream.
 *
 * One draw per river: rng.intN indexes the best-scoring candidates (longest,
 * then ends farthest apart), sorted by board order.
 *
 * If the board cannot fit all its rivers, the whole derivation is rerun with a
 * lower length cap, and the first cap that fits wins. Failed passes still
 * spend draws from the same generator, so they must be reproduced.
 */
function deriveRivers(b, rng, reserved = null) {
  if (!b) return [];
  let land = 0;
  for (const h of hexesInRadius(b.radius)) {
    if (isLand(b, h)) land++;
  }
  const want = riverCount(land);
  if (want === 0) return [];
  const g = newRiverGrid(b, reserved);
  // One budget for every pass and river, as in engine/rivers.
  const nodes = { n: 0 };
  let best = [];
  for (let cap = maxChainLen(b.radius); cap >= minChainLen; cap--) {
    const out = deriveAtCap(b, g, rng, want, minChainLen, cap, nodes);
    if (out.length === want) return out;
    if (out.length > best.length) best = out;
    if (nodes.n > searchNodeBudget) return best;
  }
  return best;
}

/** deriveAtCap chooses up to `want` rivers with chains of at most `cap` hexes. */
function deriveAtCap(b, g, rng, want, minLen, cap, nodes) {
  const blocked = new Array(g.hexes.length).fill(false);
  const out = [];
  for (let k = 0; k < want; k++) {
    // The seed picks one of the best-scoring chains.
    const best = enumerateChains(b, g, blocked, minLen, cap, nodes);
    if (best.length === 0) break;
    const r = buildRiver(b, best[rng.intN(best.length)]);
    out.push(r);
    // Later rivers may not touch this one, so each edge has at most one
    // channel.
    for (const h of r.hexes) {
      const j = g.index.get(hexKey(h));
      if (j !== undefined) blocked[j] = true;
      for (const nb of neighbors(h)) {
        const jn = g.index.get(hexKey(nb));
        if (jn !== undefined) blocked[jn] = true;
      }
    }
  }
  return out;
}

/**
 * swapPartner is engine/rivers's swapPartner: the mountain hex a headwater
 * trades terrain with. Preference: off-river first, then closest pips to the
 * headwater's token, then nearest, then board order. Never a source or mouth.
 */
function swapPartner(b, h, onRiver, ends) {
  let best = null, bestKey = null;
  const want = pipValue((b.tiles.get(hexKey(h)) || { number: 0 }).number || 0);
  for (const c of hexesInRadius(b.radius)) {
    const key = hexKey(c);
    if (ends.has(key)) continue;
    const t = b.tiles.get(key);
    if (t === undefined || t.res !== Ore) continue;
    const k = [onRiver.has(key) ? 1 : 0, Math.abs(pipValue(t.number || 0) - want), hexDist(h, c)];
    if (best === null || k[0] < bestKey[0] || (k[0] === bestKey[0] && (k[1] < bestKey[1] ||
        (k[1] === bestKey[1] && k[2] < bestKey[2])))) {
      best = c;
      bestKey = k;
    }
  }
  return best;
}

/**
 * paintRivers applies a derived layout (engine/rivers's `paint`): a swamp with
 * no chit at each estuary, mountains at each source, and every hex between
 * left as dealt (derivation 11).
 *
 * The headwater tile exists only for mountains, so the source swaps terrain
 * with a mountains hex (swapPartner), keeping its own if there is none. Chits
 * stay put, except the mouth's, which is discarded. Idempotent.
 */
function paintRivers(b, rivers) {
  const onRiver = new Set();
  const ends = new Set();
  for (const r of rivers) {
    for (const h of r.hexes) onRiver.add(hexKey(h));
    ends.add(hexKey(r.hexes[0]));
    ends.add(hexKey(r.hexes[r.mouth]));
  }
  for (const r of rivers) {
    for (let i = 0; i < r.hexes.length; i++) {
      const h = r.hexes[i];
      const key = hexKey(h);
      if (i === r.mouth) {
        b.tiles.set(key, { res: Swamp, number: 0 });
        continue;
      }
      if (i !== 0) continue; // the channel runs through whatever was dealt
      // Mirrors Go's zero Tile; unreachable for a chain hex.
      const t = b.tiles.get(key) || { res: ResNone, number: 0 };
      if (t.res === Ore) continue;
      const partner = swapPartner(b, h, onRiver, ends);
      if (partner === null) continue;
      const pkey = hexKey(partner);
      const pt = b.tiles.get(pkey);
      b.tiles.set(key, { res: pt.res, number: t.number });
      b.tiles.set(pkey, { res: t.res, number: pt.number });
    }
  }
}

/**
 * riversFinishBoard is engine/rivers's FinishBoard: derive the watercourses and
 * paint them. Like the Go hook it has no authored-board guard.
 */
function riversFinishBoard(b, rng, reserved = null, fair = false, movable = () => true) {
  paintRivers(b, deriveRivers(b, rng, reserved));
  // engine/rivers FinishBoard: a fair-mode board has the tokens the engine
  // dealt rebalanced over what painting left (derivation 11).
  if (fair) rebalanceNumbers(b, movable);
}

/**
 * reservedHexesFor is engine.ReservedHexes: hexes a module claims before other
 * derivations build on the board, as a set of hexKeys, or null. Only Wagons
 * reserves: its first MAX_CAPES capes in board order. Rivers routes around
 * them (derivation 11). It depends only on the land mask, so both Rivers
 * passes see the same set.
 */
function reservedHexesFor(ruleset, b) {
  if (!String(ruleset || "").split("+").includes("wagons")) return null;
  const capes = [];
  for (const h of hexesInRadius(b.radius)) {
    if (capeOutward(b, h) >= 0) capes.push(h);
  }
  const out = new Set(capes.slice(0, MAX_CAPES).map(hexKey));
  return out.size === 0 ? null : out;
}

/**
 * setupBoardFor applies the ruleset's SetupBoard hooks, in ruleset order.
 *
 * `newRng` must mint a fresh generator per call (rngFor(publicSeed, 2) once
 * per module, as in engine/state.go).
 *
 * `supplied` is true when the config carried its own board (preset or inlined
 * map); terrain-reshaping hooks skip those, as in Go.
 *
 * Modules without a SetupBoard hook are omitted; verify_test.go's registry
 * check catches a new engine hook missing here.
 */
function setupBoardFor(ruleset, b, newRng, supplied = false, players = 0, rngAt = null, mode = BoardFair) {
  for (const part of String(ruleset || "base").split("+")) {
    switch (part) {
      case "islands":
        if (!supplied) islandsSetupBoard(b, newRng(), mode === BoardFair);
        break;
      case "fishermen":
        fishermenSetupBoard(b, newRng());
        break;
      case "wagons":
        // Runs on authored boards too; it only removes the robber.
        wagonsSetupBoard(b, newRng());
        break;
      case EXPLORERS:
        // Explorers reads six reserved slots, hence `rngAt` (see BoardSeeder).
        // The Knights flag applies rule B (one starting-island forest becomes
        // fields).
        if (rngAt) {
          explorersSetupBoard(b, players, rngAt, String(ruleset || "").split("+").includes("cak"));
        }
        break;
      default:
        break; // base, Knights, Caravans: no SetupBoard hook
    }
  }
}

/**
 * finishBoardFor applies the ruleset's FinishBoard hooks, in ruleset order,
 * after every SetupBoard (engine/state.go's second board loop).
 *
 * `rngAt(seq)` mints a fresh generator on the given slot. Each finisher gets
 * its own generator, and its slot comes from engine.BoardFinisherSlot:
 * Caravans, Fishermen and Raiders share position 3, Rivers uses
 * RIVERS_BOARD_SEQ.
 *
 * Caravans and Fishermen only reshape tiles the engine dealt (`dealt`, see
 * dealtTerrain); without `dealt`, `supplied` decides. Rivers, Wagons and
 * Raiders have no guard, as in Go.
 */
function finishBoardFor(ruleset, b, rngAt, supplied = false, dealt = null, mode = BoardFair, players = 0) {
  const may = dealt || (() => !supplied);
  for (const part of String(ruleset || "base").split("+")) {
    switch (part) {
      case "caravans":
        // Restricted to engine-dealt tiles; see dealtTerrain.
        caravansFinishBoard(b, rngAt(BOARD_FINISH_SEQ), may, reservedHexesFor(ruleset, b), players, mode === BoardFair);
        break;
      case "fishermen":
        // Gated by `dealt`, as in Go (derivation 12).
        fishermenFinishBoard(b, rngAt(BOARD_FINISH_SEQ), may, reservedHexesFor(ruleset, b));
        break;
      case "wagons":
        // Draws nothing and runs on every board: see wagonsFinishBoard.
        wagonsFinishBoard(b);
        break;
      case "rivers":
        // Own reserved slot, no authored-board guard.
        riversFinishBoard(b, rngAt(RIVERS_BOARD_SEQ), reservedHexesFor(ruleset, b), mode === BoardFair, may);
        break;
      case "raiders":
        // Runs on authored boards too: it only reclaims sea left by an Islands
        // carve and removes the robber. Raiders has no BoardFinisherSlot, so it
        // uses the shared position-3 slot.
        raidersFinishBoard(b, rngAt(BOARD_FINISH_SEQ));
        break;
      default:
        break; // nothing else finishes the board
    }
  }
}

// ---------------------------------------------------------------------------
// The board's second layer: rules-bearing module state derived from the
// finished board and carried in EvBoardGenerated's `ext` blob (fishing grounds,
// oases and spokes, rivers and bridge sites, and so on). Some parts are pure
// functions of the board; others draw from reserved public slots, hence the
// rng passed to boardExtFor. engine.Apply runs off the logged blob, so
// verifyBoardExt re-derives it here.

/** groundNumbers mirrors engine/scenarios.groundNumbers: the six grounds' tokens at 2-4 seats. */
const groundNumbers = [4, 5, 6, 8, 9, 10];

/** LAKE_NUMBERS and SECOND_LAKE_NUMBERS mirror engine/scenarios' two lake sets. */
const LAKE_NUMBERS = [2, 3, 11, 12];
const SECOND_LAKE_NUMBERS = [4, 10];

/**
 * fishTableFor mirrors engine/scenarios.fishTableFor (derivation 13): the grounds'
 * numbers and the lakes' number sets per table size. 2-4 seats: the base set;
 * 5-6: 8 grounds (5 and 9 added) and a second lake on 4 and 10; 7-10: 10
 * grounds and a third lake on 4 and 10.
 */
function fishTableFor(players) {
  if (players <= 4) return { grounds: groundNumbers, lakes: [LAKE_NUMBERS] };
  if (players <= 6) {
    return { grounds: [4, 5, 5, 6, 8, 9, 9, 10], lakes: [LAKE_NUMBERS, SECOND_LAKE_NUMBERS] };
  }
  return {
    grounds: [4, 5, 5, 5, 6, 8, 9, 9, 9, 10],
    lakes: [LAKE_NUMBERS, SECOND_LAKE_NUMBERS, SECOND_LAKE_NUMBERS],
  };
}

/**
 * bootSupplyFor is engine/scenarios.fishTableFor's supply total plus the boot: 29
 * tokens (11/10/8) at 2-4 seats, 43 (15/15/13) at 5-6, 57 (19/20/18) at 7-10.
 */
function bootSupplyFor(players) {
  const supply = players <= 4 ? [11, 10, 8] : players <= 6 ? [15, 15, 13] : [19, 20, 18];
  return supply[0] + supply[1] + supply[2] + 1;
}

/**
 * FISH_LAKES_SEQ is engine.FishLakesSeq: the one public slot the lakes' number
 * deal reads (derivation 13).
 */
const FISH_LAKES_SEQ = -10_000_001;

/**
 * dealLakeNumbers mirrors engine/scenarios.dealLakeNumbers: the lakes in board order,
 * one Shuffle of their indices, then the first of the shuffled order takes the
 * first set and every other lake the last. Returned in board order.
 */
function dealLakeNumbers(b, players, rng) {
  const lakes = [];
  for (const h of hexesInRadius(b.radius)) {
    const t = b.tiles.get(hexKey(h));
    if (t !== undefined && t.res === Lake) lakes.push({ hex: { q: h.q, r: h.r }, numbers: null });
  }
  const sets = fishTableFor(players).lakes;
  const order = lakes.map((_, i) => i);
  rng.shuffle(order.length, (i, j) => { const t = order[i]; order[i] = order[j]; order[j] = t; });
  order.forEach((i, k) => { lakes[i].numbers = sets[Math.min(k, sets.length - 1)].slice(); });
  // Go's nil slice marshals as null, and the audit compares JSON text.
  return lakes.length === 0 ? null : lakes;
}

/**
 * FISH_GROUNDS_SEQ is engine.FishGroundsSeq: the one public slot the fishing
 * grounds' number deal reads (derivation 12).
 */
const FISH_GROUNDS_SEQ = -10_000_000;

/**
 * dealGroundNumbers mirrors engine/scenarios.dealGroundNumbers: one Shuffle of the
 * numbers deriveGrounds placed, over the grounds in deriveGrounds' own order,
 * then re-sorted by number. Placement is untouched.
 */
function dealGroundNumbers(grounds, rng) {
  const nums = grounds.map((g) => g.number);
  rng.shuffle(nums.length, (i, j) => { const t = nums[i]; nums[i] = nums[j]; nums[j] = t; });
  const out = grounds.map((g, i) => ({ ...g, number: nums[i] }));
  out.sort((a, c) => a.number - c.number);
  return out;
}

/** groundCorners mirrors engine/scenarios.groundCorners. */
const groundCorners = 3;

/** harborSeaHex mirrors Board.HarborSeaHex: the water hex a harbor's dock sits on. */
function harborSeaHex(b, hb) {
  return edgeSeaHex(b, newEdge(hb.verts[0], hb.verts[1]));
}

/**
 * shoreRun mirrors engine/scenarios.shoreRun: the corners a fishing ground on sea hex
 * h would touch, i.e. the longest run of consecutive land corners around h,
 * trimmed to its first three and returned in ascending ring order (not from
 * the run's head). Returns null for fewer than two contiguous corners.
 */
function shoreRun(b, h) {
  const ring = hexVertices(h);
  const land = ring.map((v) => landVertex(b, v));
  const n = land.reduce((a, x) => a + (x ? 1 : 0), 0);
  if (n < 2) return null;
  // Fully enclosed: every index starts a maximal run, so pick index 0.
  if (n === 6) return [ring[0], ring[1], ring[2]];

  let bestStart = 0, bestLen = 0;
  for (let s = 0; s < 6; s++) {
    if (!land[s] || land[(s + 5) % 6]) continue; // not land, or not a run's head
    let l = 0;
    while (l < 6 && land[(s + l) % 6]) l++;
    if (l > bestLen) { bestStart = s; bestLen = l; }
  }
  if (bestLen < 2) return null;
  bestLen = Math.min(bestLen, groundCorners);
  const keep = [false, false, false, false, false, false];
  for (let i = 0; i < bestLen; i++) keep[(bestStart + i) % 6] = true;
  return ring.filter((_, i) => keep[i]);
}

/**
 * deriveGrounds mirrors engine/scenarios.deriveGrounds: fishing grounds on coastal
 * notches, no two sharing a vertex, never on a harbor's dock hex.
 *
 * Candidates are sorted by anchor (Q, R), then stably by notch width (Go's
 * sort.SliceStable; Array.sort is stable). Candidates come from land's
 * neighbours, so they include off-map ocean hexes, as in the engine.
 */
function deriveGrounds(b, numbers = groundNumbers) {
  const docked = new Set();
  for (const hb of b.harbors || []) {
    const sea = harborSeaHex(b, hb);
    if (sea !== null) docked.add(hexKey(sea));
  }
  const seen = new Set();
  const cands = [];
  for (const h of hexesInRadius(b.radius)) {
    if (!isLand(b, h)) continue;
    for (const nb of neighbors(h)) {
      const key = hexKey(nb);
      if (isLand(b, nb) || seen.has(key)) continue;
      seen.add(key);
      if (docked.has(key)) continue;
      const lv = shoreRun(b, nb);
      if (lv !== null && lv.length >= 2) cands.push({ anchor: nb, verts: lv });
    }
  }
  cands.sort((a, c) => (a.anchor.q !== c.anchor.q ? a.anchor.q - c.anchor.q : a.anchor.r - c.anchor.r));
  const order = cands.slice().sort((a, c) => c.verts.length - a.verts.length);

  // take mirrors deriveGrounds' take: keep each candidate that shares no corner
  // with one already kept, and with `trim` keep an overlapping three-corner
  // notch as its first two corners, else its last two, when that pair is free
  // and adjacent on the hex's ring.
  const take = (ord, trim) => {
    const out = [];
    const used = new Set();
    const free = (vs) => !vs.some((v) => used.has(vertKey(v)));
    for (const c of ord) {
      if (out.length === numbers.length) break;
      let verts = c.verts;
      if (!free(verts)) {
        if (!trim || verts.length !== groundCorners) continue;
        if (free(verts.slice(0, 2)) && ringAdjacent(c.anchor, verts[0], verts[1])) verts = verts.slice(0, 2);
        else if (free(verts.slice(1)) && ringAdjacent(c.anchor, verts[1], verts[2])) verts = verts.slice(1);
        else continue;
      }
      for (const v of verts) used.add(vertKey(v));
      out.push({ v: verts, hex: c.anchor, number: numbers[out.length] });
    }
    return out;
  };
  let out = take(order, false);
  // Short of the table's count: the thin notches first, with trimming, used
  // only when it places more (derivation 13; see engine/scenarios.deriveGrounds).
  if (out.length < numbers.length) {
    const thin = cands.slice().sort((a, c) => a.verts.length - c.verts.length);
    const alt = take(thin, true);
    if (alt.length > out.length) out = alt;
  }
  out.sort((a, c) => a.number - c.number);
  return out;
}

/** ringAdjacent mirrors engine/scenarios.ringAdjacent. */
function ringAdjacent(h, a, c) {
  const ring = hexVertices(h);
  const ka = vertKey(a), kc = vertKey(c);
  for (let i = 0; i < 6; i++) {
    const x = vertKey(ring[i]), y = vertKey(ring[(i + 1) % 6]);
    if ((x === ka && y === kc) || (x === kc && y === ka)) return true;
  }
  return false;
}

/**
 * oasisSpokes mirrors engine/scenarios.oasisSpokes: one spoke per corner 0, 2 and 4,
 * each that corner's first outward (non-perimeter) land edge. A corner without
 * one gets Go's zero value, vertices at (0, 0, N).
 */
function oasisSpokes(b, oasis) {
  const zeroVert = () => vert(0, 0, N);
  const arrows = [], corners = [];
  const perim = new Set(hexEdges(oasis).map(edgeKey));
  const verts = hexVertices(oasis);
  for (const ci of [0, 2, 4]) {
    const v = verts[ci];
    let arrow = null;
    for (const ve of vertexEdgesOf(v)) {
      if (!perim.has(edgeKey(ve)) && landEdge(b, ve)) { arrow = ve; break; }
    }
    arrows.push(arrow === null ? { a: zeroVert(), b: zeroVert() } : arrow);
    corners.push(arrow === null ? zeroVert() : v);
  }
  return { arrows, corners };
}

/**
 * caravansOasis mirrors engine/scenarios.freshCaravans' board-derived half: the oases
 * and their spokes. Oases come from pickOases (deserts, then lakes); an
 * authored map with neither falls back to the first producing hex.
 */
function caravansOasis(b, players = 0) {
  let oases = pickOases(b, oasisCountFor(players));
  if (oases.length === 0) {
    for (const h of hexesInRadius(b.radius)) {
      const t = b.tiles.get(hexKey(h));
      if (t !== undefined && producing(t.res)) { oases = [h]; break; }
    }
  }
  if (oases.length === 0) {
    return { Oasis: { q: 0, r: 0 }, HasOasis: false, Oases: null };
  }
  const arrows = [], corners = [];
  for (const o of oases) {
    const sp = oasisSpokes(b, o);
    arrows.push(...sp.arrows);
    corners.push(...sp.corners);
  }
  return {
    Oasis: { q: oases[0].q, r: oases[0].r },
    HasOasis: true,
    Oases: oases.map((o) => ({ q: o.q, r: o.r })),
    Arrows: arrows,
    ArrowCorner: corners,
  };
}

/**
 * boardExtFor derives the audited part of EvBoardGenerated's ext layer: one
 * entry per module with board-derived state, holding only the fields the board
 * and seed decide. Opening bookkeeping in the blob (bid maps, supplies) depends
 * only on ruleset and player count and is not compared.
 */
function boardExtFor(ruleset, b, publicSeed, rngFor, players = 0) {
  // Takes the seed and factory so each arm below names its reserved slot at
  // the call.
  const rngAt = (seq) => rngFor(publicSeed, seq);
  const parts = String(ruleset || "base").split("+");
  // The Raiders castle avoids river and reserved hexes (derivation 12,
  // raiders.castleAvoid), and Wagons reads that castle, so both need the
  // watercourse. A fresh generator on the same slot gives the same rivers.
  let castleAvoid = null;
  if (parts.includes("raiders")) {
    castleAvoid = new Set();
    if (parts.includes("rivers") && typeof rngFor === "function") {
      for (const r of deriveRivers(b, rngAt(RIVERS_BOARD_SEQ), reservedHexesFor(ruleset, b))) {
        for (const h of r.hexes) castleAvoid.add(hexKey(h));
      }
    }
    for (const k of reservedHexesFor(ruleset, b) || []) castleAvoid.add(k);
  }
  const out = {};
  for (const part of parts) {
    switch (part) {
      case "fishermen": {
        // Ground numbers are shuffled off FISH_GROUNDS_SEQ (derivation 12),
        // lake numbers dealt off FISH_LAKES_SEQ (derivation 13).
        const table = fishTableFor(players);
        out.fishermen = typeof rngFor === "function"
          ? {
            Grounds: dealGroundNumbers(deriveGrounds(b, table.grounds), rngAt(FISH_GROUNDS_SEQ)),
            Lakes: dealLakeNumbers(b, players, rngAt(FISH_LAKES_SEQ)),
          }
          : { Grounds: deriveGrounds(b, table.grounds) };
        break;
      }
      case "caravans":
        out.caravans = caravansOasis(b, players);
        break;
      case "rivers": {
        // A fresh generator on the paint pass's slot, as in
        // engine/rivers.InitExtBoard, so both passes agree. Only the "rivers"
        // key of the blob is compared; the rest is opening bookkeeping.
        if (typeof rngFor !== "function") {
          // Throw rather than derive "no rivers", which would falsely report
          // tampering; verifyBoardExt reports the error.
          throw new Error("rivers: boardExtFor needs rngFor to read the reserved stream slot");
        }
        const rs = deriveRivers(b, rngAt(RIVERS_BOARD_SEQ), reservedHexesFor(ruleset, b));
        // Meander variants, on their own slot (see RIVERS_VARIANT_SEQ).
        assignVariants(rs, rngAt(RIVERS_VARIANT_SEQ));
        // Go's nil slice marshals as null, and the comparison is on JSON text.
        out.rivers = { rivers: rs.length === 0 ? null : rs };
        break;
      }
      case "raiders":
        out.raiders = raidersBoardExt(b, parts.includes("cak"),
          parts.includes("wagons")
            ? wagonsBoardExt(b, publicSeed, rngFor, true, parts.includes("caravans"), parts.includes("fishermen"), castleAvoid, players)
            : null,
          castleAvoid);
        break;
      case "wagons":
        // Trade hexes and roles draw from WAGONS_BOARD_SEQ.
        out.wagons = wagonsBoardExt(b, publicSeed, rngFor, parts.includes("raiders"),
          parts.includes("caravans"), parts.includes("fishermen"), castleAvoid, players);
        break;
      case EXPLORERS:
        if (typeof rngFor === "function") out.explorers = explorersLayout(b, players, rngAt);
        break;
      default:
        break; // base, Knights, Islands: no board-derived module state
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Raiders.
//
// The ext layer records the castle, the raiders' landmass, the coastal hexes
// they may land on, and where they start. The castle is not a tile: like the
// Caravans oasis it is recorded in the ext blob and the tile is untouched. The
// only board changes are growing a landmass Islands carved too small and
// removing the robber.

/** RAIDERS_MIN_COAST mirrors raiders.minCoastHexes. */
const RAIDERS_MIN_COAST = 8;

/** RAIDERS_REPAIR_NUMBERS mirrors raiders.repairNumbers: never a 6 or an 8. */
const RAIDERS_REPAIR_NUMBERS = [3, 4, 5, 9, 10, 11];

// sortHexes mirrors raiders.sortHexes, using the hexLess declared above.
function sortHexes(hs) {
  return hs.slice().sort((a, c) => (hexLess(a, c) ? -1 : hexLess(c, a) ? 1 : 0));
}

/** hexDist mirrors raiders.hexDist. */
function raidersHexDist(a, c) {
  return (Math.abs(a.q - c.q) + Math.abs(a.r - c.r) + Math.abs(a.q + a.r - c.q - c.r)) / 2;
}

/**
 * raidersMainLandmass mirrors raiders.mainLandmass (via Board.Islands): the
 * largest connected land component, ties by lowest (Q, R), returned ascending.
 * The flood fill walks hexesInRadius in board order so component ids match.
 */
function raidersMainLandmass(b) {
  const comp = new Map();
  const byID = [];
  let next = 0;
  for (const h of hexesInRadius(b.radius)) {
    if (!isLand(b, h) || comp.has(hexKey(h))) continue;
    const id = next++;
    byID.push([]);
    const stack = [h];
    comp.set(hexKey(h), id);
    while (stack.length > 0) {
      const cur = stack.pop();
      for (const n of neighbors(cur)) {
        if (isLand(b, n) && !comp.has(hexKey(n))) {
          comp.set(hexKey(n), id);
          stack.push(n);
        }
      }
    }
  }
  // Group in board order, so each component's first member is its lowest (Q, R).
  for (const h of hexesInRadius(b.radius)) {
    const id = comp.get(hexKey(h));
    if (id !== undefined) byID[id].push(h);
  }
  let best = 0, bestID = -1;
  for (let id = 0; id < byID.length; id++) {
    const hs = byID[id];
    if (hs.length > best) { best = hs.length; bestID = id; }
    else if (hs.length === best && bestID >= 0 && hexLess(hs[0], byID[bestID][0])) bestID = id;
  }
  return bestID < 0 ? [] : sortHexes(byID[bestID]);
}

/** raidersIsCoastal mirrors raiders.isCoastal: a neighbouring position off the landmass. */
function raidersIsCoastal(land, h) {
  return neighbors(h).some((n) => !land.has(hexKey(n)));
}

/**
 * raidersNumberedCoast mirrors raiders.numberedCoast: the landing-eligible
 * hexes, ascending (Q, R): numbered, coastal, on the main landmass, and not
 * the castle.
 */
function raidersNumberedCoast(b, land, landSet, castle) {
  const out = [];
  for (const h of land) {
    if (castle !== null && h.q === castle.q && h.r === castle.r) continue;
    const t = b.tiles.get(hexKey(h));
    if (t === undefined || !producing(t.res) || t.number === 0) continue;
    if (raidersIsCoastal(landSet, h)) out.push(h);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Explorers (engine/explorers/board.go)
// ---------------------------------------------------------------------------
//
// The whole Explorers map derives from the public seed: a sea rim, a home
// island taken in a fixed order off the west, a ring of home waters, and a
// face-down pool split into two regions, each with nine special hexes, a shoal
// numbering and a number-chit stack.
//
// It reads six reserved slots (engine/seeds.go: ExplorersBoardSeqs) instead of
// the shared position-2 one, so its hooks take `rngAt(seq)`.

const EXPLORERS = "explorers";

/** The reserved public stream slots, from engine.ExplorersBoardSeqs. */
const EXPLORERS_SEQ = {
  region: -8000000,
  special: -8000001,
  shoal: -8000002,
  chitNorth: -8000003,
  chitSouth: -8000004,
  terrain: -8000005,
};

const EXP_REGION_NORTH = 0;
const EXP_REGION_SOUTH = 1;
const EXP_REGIONS = 2;
const EXP_SPECIAL_NONE = 0;
const EXP_SPECIAL_GOLD = 1;
const EXP_SPECIAL_SHOAL = 2;
const EXP_SPECIAL_SPICE = 3;
const EXP_VILLAGE_SWIFT = 0;
const EXP_VILLAGE_PIRATE = 1;
const EXP_VILLAGE_GOLD = 2;
const EXP_PER_REGION = 3; // gold fields, shoals and farms, three of each
const EXP_PLACEMENT_ATTEMPTS = 32;

/** doubled coordinates: X = 2q + r (a vertical column), Y = r. */
function expDoubled(h) {
  return [2 * h.q + h.r, h.r];
}

function expDist(h) {
  const x = h.q;
  const z = h.r;
  const y = -x - z;
  return Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
}

function expHexLess(a, b) {
  if (a.q !== b.q) return a.q - b.q;
  return a.r - b.r;
}

/** boardRadiusFor is the module BoardRadiuser hook: Explorers needs three more. */
function boardRadiusFor(ruleset, players, base) {
  for (const part of String(ruleset || "base").split("+")) {
    if (part === EXPLORERS) return base + 3;
  }
  return base;
}

/** expHexDirs mirrors board's own direction order, which Neighbors walks. */
const EXP_HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

/**
 * EXP_CORNER_BETWEEN[i] is the index into hexVertices() of the corner between
 * the neighbours in directions i and i+1, copied from engine/explorers/board.go.
 */
const EXP_CORNER_BETWEEN = [1, 0, 5, 4, 3, 2];

/** expPartition is the pure-geometry half: rim, island, waters, pool, council. */
function expPartition(radius, players) {
  const interior = hexesInRadius(radius - 1);
  const ordered = interior.slice().sort((a, b) => {
    const [ax, ay] = expDoubled(a);
    const [bx, by] = expDoubled(b);
    if (ax !== bx) return ax - bx;
    if (Math.abs(ay) !== Math.abs(by)) return Math.abs(ay) - Math.abs(by);
    return ay - by;
  });
  const size = Math.min(Math.floor((7 * players + 1) / 2), ordered.length);
  const home = ordered.slice(0, size);
  const inHome = new Set(home.map(hexKey));

  const inWater = new Set();
  const waters = [];
  for (const h of home) {
    for (const nb of neighbors(h)) {
      const k = hexKey(nb);
      if (inHome.has(k) || inWater.has(k) || expDist(nb) >= radius) continue;
      inWater.add(k);
      waters.push(nb);
    }
  }
  waters.sort(expHexLess);

  const pool = interior.filter((h) => !inHome.has(hexKey(h)) && !inWater.has(hexKey(h)));
  pool.sort(expHexLess);

  const { council, anchors } = expCouncil(home, waters);
  return { home, waters, pool, council, anchors };
}

function expCouncil(home, waters) {
  if (waters.length === 0) return { council: { q: 0, r: 0 }, anchors: [] };
  let best = waters[0];
  for (const h of waters.slice(1)) {
    const [hx, hy] = expDoubled(h);
    const [bx, by] = expDoubled(best);
    if (hx !== bx) {
      if (hx > bx) best = h;
      continue;
    }
    if (Math.abs(hy) !== Math.abs(by)) {
      if (Math.abs(hy) < Math.abs(by)) best = h;
      continue;
    }
    if (hy < by) best = h;
  }
  const d = expDirectionToward(best, home);
  const verts = hexVertices(best);
  return {
    council: best,
    anchors: [
      verts[EXP_CORNER_BETWEEN[(d + 1) % 6]],
      verts[EXP_CORNER_BETWEEN[(d + 4) % 6]],
    ],
  };
}

/**
 * expDirectionToward is the hex direction from `from` toward the centroid of
 * `at`, by largest cube dot product, ties to the lowest index. The centroid is
 * scaled by the count to stay in integers.
 */
function expDirectionToward(from, at) {
  if (at.length === 0) return 0;
  let sq = 0;
  let sr = 0;
  for (const h of at) { sq += h.q; sr += h.r; }
  const n = at.length;
  const dx = sq - from.q * n;
  const dz = sr - from.r * n;
  const dy = -dx - dz;
  let bestIdx = 0;
  let bestDot = 0;
  EXP_HEX_DIRS.forEach((dir, i) => {
    const ex = dir.q;
    const ez = dir.r;
    const ey = -ex - ez;
    const dot = dx * ex + dy * ey + dz * ez;
    if (i === 0 || dot > bestDot) { bestIdx = i; bestDot = dot; }
  });
  return bestIdx;
}

/**
 * expSplitRegions divides the pool about the equator, dealing the equator row
 * in ascending X to whichever region holds fewer (ties to north).
 */
function expSplitRegions(pool) {
  const out = [[], []];
  const equator = [];
  for (const h of pool) {
    const [, y] = expDoubled(h);
    if (y < 0) out[EXP_REGION_NORTH].push(h);
    else if (y > 0) out[EXP_REGION_SOUTH].push(h);
    else equator.push(h);
  }
  equator.sort((a, b) => {
    const [ax] = expDoubled(a);
    const [bx] = expDoubled(b);
    if (ax !== bx) return ax - bx;
    return expHexLess(a, b);
  });
  for (const h of equator) {
    if (out[EXP_REGION_SOUTH].length < out[EXP_REGION_NORTH].length) out[EXP_REGION_SOUTH].push(h);
    else out[EXP_REGION_NORTH].push(h);
  }
  out[EXP_REGION_NORTH].sort(expHexLess);
  out[EXP_REGION_SOUTH].sort(expHexLess);
  return out;
}

function expAdjacentCount(h, chosen) {
  let n = 0;
  for (const nb of neighbors(h)) if (chosen.has(hexKey(nb))) n++;
  return n;
}

function expAdjacentPairs(hexes) {
  const set = new Set(hexes.map(hexKey));
  let n = 0;
  for (const h of hexes) n += expAdjacentCount(h, set);
  return n / 2;
}

/** expOnePlacement is one greedy pass: an independent set, then cheapest-first. */
function expOnePlacement(order, want) {
  const chosen = new Set();
  const out = [];
  for (const h of order) {
    if (out.length === want) break;
    if (expAdjacentCount(h, chosen) === 0) { chosen.add(hexKey(h)); out.push(h); }
  }
  while (out.length < want) {
    let best = null;
    let bestCost = 0;
    for (const h of order) {
      if (chosen.has(hexKey(h))) continue;
      const cost = expAdjacentCount(h, chosen);
      if (best === null || cost < bestCost) { best = h; bestCost = cost; }
    }
    if (best === null) break;
    chosen.add(hexKey(best));
    out.push(best);
  }
  return out;
}

/**
 * raidersCastleHex mirrors raiders.castleHex: find the centre-most hex of the
 * main landmass (minimising the maximum distance to its coast, ties by
 * ascending (Q, R)), then take the nearest ordinary interior hex to it, else
 * the nearest ordinary hex, else the centre.
 */
function raidersCastleHex(b, land, landSet, avoid = null) {
  if (land.length === 0) return null;
  const coastal = land.filter((h) => raidersIsCoastal(landSet, h));
  let centre = land[0], bestScore = -1;
  for (const h of land) {
    let worst = 0;
    for (const c of coastal) {
      const d = raidersHexDist(h, c);
      if (d > worst) worst = d;
    }
    if (bestScore < 0 || worst < bestScore) { centre = h; bestScore = worst; }
  }
  const pick = (want) => {
    let best = null, bestD = 0;
    for (const h of land) {
      if (!want(h)) continue;
      const d = raidersHexDist(h, centre);
      if (best === null || d < bestD) { best = h; bestD = d; }
    }
    return best;
  };
  const ordinary = (h) => {
    const t = b.tiles.get(hexKey(h));
    return t !== undefined && producing(t.res);
  };
  // Derivation 12: avoid river and reserved hexes (raiders.castleAvoid) when
  // possible.
  const free = (h) => avoid === null || !avoid.has(hexKey(h));
  return pick((h) => ordinary(h) && free(h) && !raidersIsCoastal(landSet, h)) ??
    pick((h) => ordinary(h) && free(h)) ?? pick(ordinary) ?? centre;
}

/**
 * raidersSeedSites mirrors raiders.seedSites: one raider on each of the
 * max(2, round(coast/5)) numbered coastal hexes with the lowest pips, ties by
 * ascending (Q, R) (stable sort over a sorted list). Returns ascending indexes
 * into coast.
 */
function raidersSeedSites(b, coast) {
  if (coast.length === 0) return [];
  let n = Math.max(2, Math.floor((coast.length + 2) / 5)); // round(coast/5), half up
  n = Math.min(n, coast.length);
  const idx = coast.map((_, i) => i);
  idx.sort((a, c) => pips(b.tiles.get(hexKey(coast[a])).number) - pips(b.tiles.get(hexKey(coast[c])).number));
  return idx.slice(0, n).sort((a, c) => a - c);
}

/**
 * raidersFinishBoard mirrors raiders.Module.FinishBoard: it grows the main
 * landmass if its numbered coast is too short (in practice only after an
 * Islands carve), then removes the robber, which Raiders never uses.
 *
 * Patch selection is deterministic: fewest new tiles, then centre (Q, R).
 * New tiles draw a resource and token in board order; harbours are redealt
 * after framing. The patch preserves channels separating other islands.
 */
function raidersFinishBoard(b, rng) {
  const land = raidersMainLandmass(b);
  const landSet = new Set(land.map(hexKey));
  const castle = raidersCastleHex(b, land, landSet);
  const refuge = land.some((h) => {
    const t = b.tiles.get(hexKey(h));
    return (castle === null || hexKey(h) !== hexKey(castle)) && producing(t.res) && t.number > 0 && !raidersIsCoastal(landSet, h);
  });
  if (land.length > 0 && !(refuge && raidersNumberedCoast(b, land, landSet, castle).length >= RAIDERS_MIN_COAST)) {
    let patch = [], best = -1;
    for (const centre of hexesInRadius(b.radius + 3)) {
      const missing = [];
      let touches = false, allowed = true;
      for (const offset of hexesInRadius(2)) {
        const h = { q: centre.q + offset.q, r: centre.r + offset.r };
        if (landSet.has(hexKey(h))) { touches = true; continue; }
        const t = b.tiles.get(hexKey(h));
        if (t !== undefined && t.res !== Sea) { allowed = false; break; }
        if (neighbors(h).some((n) => isLand(b, n) && !landSet.has(hexKey(n)))) { allowed = false; break; }
        missing.push(h);
      }
      if (allowed && touches && (best < 0 || missing.length < best)) { patch = missing; best = missing.length; }
    }
    if (best >= 0) {
      for (const h of patch) {
        const res = Resources[rng.intN(Resources.length)];
        b.tiles.set(hexKey(h), { res, number: RAIDERS_REPAIR_NUMBERS[rng.intN(RAIDERS_REPAIR_NUMBERS.length)] });
      }
      frameBoard(b);
      b.harbors = placeHarborsFor(rng, b, b.harbors.length);
    }
  }
  b.robber = { q: OFF_BOARD, r: OFF_BOARD };
}

/**
 * raidersBoardExt mirrors raiders.deriveBoard: the board-derived ext fields.
 *
 * The supply is 3 x the numbered coastal hexes, minus the raiders seeded at
 * setup. Under Knights it is unbounded, so `knights` zeroes it.
 */
function raidersBoardExt(b, knights, wagons = null, castleAvoid = null) {
  const land = raidersMainLandmass(b);
  const landSet = new Set(land.map(hexKey));
  const castle = raidersCastleHex(b, land, landSet, castleAvoid);
  const coast = raidersNumberedCoast(b, land, landSet, castle);
  const raider_count = coast.map(() => 0);
  let supply = knights ? 0 : 3 * coast.length;
  for (const i of (wagons?.HasTrade ? [] : raidersSeedSites(b, coast))) {
    raider_count[i]++;
    if (!knights) supply--;
  }
 const extra={};
 if(wagons?.HasTrade) {
  extra.shared_paths=true;
  extra.path_figures=wagons.Trade.filter((_,i)=>wagons.Roles[i]===0 || wagons.Roles[i]===2).map(hex=>({hex,edge:{a:{q:0,r:0,side:0},b:{q:0,r:0,side:0}},alive:true,on_path:false}));
  for(const r of extra.path_figures) { const i=coast.findIndex(h=>hexKey(h)===hexKey(r.hex)); if(i>=0) raider_count[i]++; if(!knights) supply--; }
 }
 return {
 ...extra,
    // Zero hex when absent; has_castle disambiguates.
    castle: castle === null ? { q: 0, r: 0 } : { q: castle.q, r: castle.r },
    has_castle: castle !== null,
    land: land.map((h) => ({ q: h.q, r: h.r })),
    coast: coast.map((h) => ({ q: h.q, r: h.r })),
    raider_count,
    supply,
  };
}

/**
 * expPlaceSpecials spreads the nine specials as far apart as the region allows:
 * the best of 32 seeded shuffles, ties to the earlier attempt. A four-player
 * region cannot fit nine non-adjacent hexes, so some adjacency is normal.
 */
function expPlaceSpecials(hexes, rng) {
  const want = EXP_PER_REGION * 3;
  let best = [];
  let bestCost = -1;
  for (let attempt = 0; attempt < EXP_PLACEMENT_ATTEMPTS; attempt++) {
    const order = hexes.slice();
    rng.shuffle(order.length, (i, j) => { const t = order[i]; order[i] = order[j]; order[j] = t; });
    const got = expOnePlacement(order, want);
    const cost = expAdjacentPairs(got);
    if (bestCost < 0 || cost < bestCost) { best = got; bestCost = cost; }
    if (bestCost === 0) break;
  }
  return best;
}

/**
 * expAssignKinds assigns kinds to both regions' specials so no two of a kind
 * touch, across the equator too. Exhaustive search, since greedy can dead-end.
 */
function expAssignKinds(specials) {
  const kinds = [EXP_SPECIAL_GOLD, EXP_SPECIAL_SHOAL, EXP_SPECIAL_SPICE];
  const left = [
    { [EXP_SPECIAL_GOLD]: EXP_PER_REGION, [EXP_SPECIAL_SHOAL]: EXP_PER_REGION, [EXP_SPECIAL_SPICE]: EXP_PER_REGION },
    { [EXP_SPECIAL_GOLD]: EXP_PER_REGION, [EXP_SPECIAL_SHOAL]: EXP_PER_REGION, [EXP_SPECIAL_SPICE]: EXP_PER_REGION },
  ];
  const slots = [];
  for (let region = 0; region < EXP_REGIONS; region++) {
    for (const h of specials[region]) slots.push({ region, h });
  }
  const index = new Map();
  slots.forEach((sl, i) => index.set(hexKey(sl.h), i));
  const before = slots.map((sl, i) => {
    const out = [];
    for (const nb of neighbors(sl.h)) {
      const j = index.get(hexKey(nb));
      if (j !== undefined && j < i) out.push(j);
    }
    return out;
  });
  const painted = new Array(slots.length).fill(EXP_SPECIAL_NONE);
  const walk = (i) => {
    if (i === slots.length) return true;
    const region = slots[i].region;
    for (const k of kinds) {
      if (left[region][k] === 0) continue;
      if (before[i].some((j) => painted[j] === k)) continue;
      left[region][k]--;
      painted[i] = k;
      if (walk(i + 1)) return true;
      left[region][k]++;
    }
    return false;
  };
  const out = [[], []];
  if (!walk(0)) {
    for (let region = 0; region < EXP_REGIONS; region++) {
      for (const k of kinds) {
        for (let i = 0; i < left[region][k]; i++) out[region].push(k);
      }
      while (out[region].length < specials[region].length) out[region].push(EXP_SPECIAL_GOLD);
      out[region] = out[region].slice(0, specials[region].length);
    }
    return out;
  }
  slots.forEach((sl, i) => out[sl.region].push(painted[i]));
  return out;
}

function expShoalFaces(region) {
  return region === EXP_REGION_NORTH ? [1, 2, 3] : [4, 5, 6];
}

/** expProducingBag deals n producing tiles at the base weights, with no desert. */
function expProducingBag(n) {
  const order = [Wood, Sheep, Wheat, Brick, Ore];
  const weights = [4, 4, 4, 3, 3];
  const counts = order.map((_, i) => Math.floor((n * weights[i]) / 18));
  let assigned = counts.reduce((a, c) => a + c, 0);
  for (let i = 0; assigned < n; i++) { counts[i % order.length]++; assigned++; }
  const bag = [];
  order.forEach((r, i) => { for (let k = 0; k < counts[i]; k++) bag.push(r); });
  return bag;
}

/** The base distribution with 2 and 12 removed, in the generator's deal order. */
const EXP_CHIT_VALUES = [3, 11, 4, 10, 5, 9, 6, 8];

function expChitStack(n, rng) {
  if (n <= 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) out.push(EXP_CHIT_VALUES[i % EXP_CHIT_VALUES.length]);
  rng.shuffle(out.length, (i, j) => { const t = out[i]; out[i] = out[j]; out[j] = t; });
  return out;
}

/**
 * expDerivePool is the seeded half: region membership, the nine specials, the
 * shoal numbering, the terrain and the two chit stacks. Pure in (pool, rngAt).
 */
function expDerivePool(pool, rngAt) {
  const regions = expSplitRegions(pool);
  const specialRng = rngAt(EXPLORERS_SEQ.special);
  const shoalRng = rngAt(EXPLORERS_SEQ.shoal);
  const terrainRng = rngAt(EXPLORERS_SEQ.terrain);
  const chitRng = [rngAt(EXPLORERS_SEQ.chitNorth), rngAt(EXPLORERS_SEQ.chitSouth)];

  const specials = [];
  for (let region = 0; region < EXP_REGIONS; region++) {
    specials.push(expPlaceSpecials(regions[region], specialRng));
  }
  const kindsOf = expAssignKinds(specials);

  const hexes = [];
  const chits = [];
  const res = new Map();
  const sea = new Set();
  for (let region = 0; region < EXP_REGIONS; region++) {
    const kind = new Map();
    const shoals = [];
    const farms = [];
    specials[region].forEach((h, i) => {
      kind.set(hexKey(h), kindsOf[region][i]);
      if (kindsOf[region][i] === EXP_SPECIAL_SHOAL) shoals.push(h);
      if (kindsOf[region][i] === EXP_SPECIAL_SPICE) farms.push(h);
    });
    const faces = expShoalFaces(region);
    shoalRng.shuffle(faces.length, (i, j) => { const t = faces[i]; faces[i] = faces[j]; faces[j] = t; });
    const shoalOf = new Map();
    shoals.forEach((h, i) => { if (i < faces.length) shoalOf.set(hexKey(h), faces[i]); });
    const villages = [EXP_VILLAGE_SWIFT, EXP_VILLAGE_PIRATE, EXP_VILLAGE_GOLD];
    const villageOf = new Map();
    farms.forEach((h, i) => { if (i < villages.length) villageOf.set(hexKey(h), villages[i]); });

    const rest = regions[region].filter((h) => (kind.get(hexKey(h)) ?? EXP_SPECIAL_NONE) === EXP_SPECIAL_NONE);
    const order = rest.slice();
    terrainRng.shuffle(order.length, (i, j) => { const t = order[i]; order[i] = order[j]; order[j] = t; });
    const seaWanted = Math.min(
      Math.max(1, Math.floor((regions[region].length + 8) / 16)),
      order.length,
    );
    for (const h of order.slice(0, seaWanted)) sea.add(hexKey(h));
    const land = order.slice(seaWanted);
    const bag = expProducingBag(land.length);
    terrainRng.shuffle(bag.length, (i, j) => { const t = bag[i]; bag[i] = bag[j]; bag[j] = t; });
    land.forEach((h, i) => res.set(hexKey(h), bag[i]));

    for (const h of regions[region]) {
      const k = kind.get(hexKey(h)) ?? EXP_SPECIAL_NONE;
      const p = { h: { q: h.q, r: h.r }, region };
      if (k !== EXP_SPECIAL_NONE) p.kind = k;
      if (k === EXP_SPECIAL_SHOAL) p.shoal = shoalOf.get(hexKey(h));
      if (k === EXP_SPECIAL_SPICE) {
        const v = villageOf.get(hexKey(h));
        if (v) p.village = v; // VillageSwift is 0 and omitempty drops it
      }
      hexes.push(p);
    }
    chits.push(expChitStack(land.length + EXP_PER_REGION, chitRng[region]));
  }
  hexes.sort((a, b) => expHexLess(a.h, b.h));
  return { hexes, chits, res, sea };
}

/**
 * explorersSetupBoard reshapes the generated full hexagon into the Explorers
 * map. It mirrors engine/explorers.Module.SetupBoardSeeded exactly, including
 * the order the six streams are read in.
 */
function explorersSetupBoard(b, players, rngAt, withKnights = false) {
  const l = expPartition(b.radius, players);
  const plan = expDerivePool(l.pool, rngAt);

  // No ports and no robber: bank trade is a flat 3:1 for everyone, and a 7 moves
  // a pirate ship on the water.
  b.harbors = [];
  b.robber = { q: OFF_BOARD, r: OFF_BOARD };

  for (const h of hexesInRadius(b.radius)) {
    if (expDist(h) === b.radius) b.tiles.set(hexKey(h), { res: Sea, number: 0 });
  }
  for (const h of l.waters) b.tiles.set(hexKey(h), { res: Sea, number: 0 });

  // The island keeps its dealt tiles, except a desert, which is re-dealt as
  // producing terrain with a non-red chit so no 6/8 adjacency is created.
  const fill = rngAt(EXPLORERS_SEQ.terrain);
  const safe = [3, 4, 5, 9, 10, 11];
  for (const h of l.home) {
    const t = b.tiles.get(hexKey(h));
    if (t === undefined || producing(t.res)) continue;
    const res = Resources[fill.intN(Resources.length)];
    b.tiles.set(hexKey(h), { res, number: safe[fill.intN(safe.length)] });
  }

  // cak+explorers rule B: the island's first forest in (X, |Y|, Y) order
  // becomes fields, keeping its chit. No draw.
  if (withKnights) {
    for (const h of l.home) {
      const t = b.tiles.get(hexKey(h));
      if (t !== undefined && t.res === Wood) {
        b.tiles.set(hexKey(h), { res: Wheat, number: t.number });
        break;
      }
    }
  }

  for (const p of plan.hexes) {
    const k = hexKey(p.h);
    const kind = p.kind ?? EXP_SPECIAL_NONE;
    if (kind === EXP_SPECIAL_GOLD) b.tiles.set(k, { res: Gold, number: 0 });
    else if (kind === EXP_SPECIAL_SHOAL) b.tiles.set(k, { res: Sea, number: 0 });
    else if (kind === EXP_SPECIAL_SPICE) b.tiles.set(k, { res: ResNone, number: 0 });
    else if (plan.sea.has(k)) b.tiles.set(k, { res: Sea, number: 0 });
    else b.tiles.set(k, { res: plan.res.get(k), number: 0 });
  }
}

/**
 * explorersLayout is the board-derived state board_generated carries: the
 * partition, the dealt pool, the two chit stacks and the Council with its
 * anchors. The pool is redacted from live clients
 * (engine/explorers/views.go); the audit uses the post-game log.
 */
function explorersLayout(b, players, rngAt) {
  const l = expPartition(b.radius, players);
  const plan = expDerivePool(l.pool, rngAt);
  return {
    home: l.home.map((h) => ({ q: h.q, r: h.r })),
    waters: l.waters.map((h) => ({ q: h.q, r: h.r })),
    pool: plan.hexes,
    chits: plan.chits,
    council: { q: l.council.q, r: l.council.r },
    anchors: l.anchors.map((v) => ({ q: v.q, r: v.r, side: v.side })),
  };
}

// ---- verify/verify.mjs ----------------------------------------------------

// The fairness audit.
//
// Feed it the JSON from `GET /api/games/{id}/replay` of a finished game you
// played in, and it re-derives, from the revealed public seed, every outcome
// that seed was supposed to decide: the board, the fishing grounds, caravan
// spokes and river channels that hang off it, the seating, every dice roll,
// every Knights event die, the Fishermen old boot. Then it checks each one
// against what the log says actually happened, and checks the seed itself
// against the commitment that was published when the table opened.
//
// A clean result proves:
//
//   - The seed hashes to the commitment published before anyone joined the
//     table, so the server did not pick or change the seed after seeing who
//     was playing.
//   - Every visible outcome follows from that seed by a published rule.
//
// It does not prove the server did not draw and discard seeds before
// publishing the commitment. That needs player-supplied entropy (see
// docs/dice.md).
//
// Hidden outcomes (which card a steal took, which card a draw dealt, which fish
// tiles a seat drew) use a second, independent seed and are outside this
// audit; tying them to the public seed would reveal every hand mid-game. The
// split is by visibility: any outcome the table sees belongs on the public seed
// and needs a check here.


const GOLDEN = 0x9e3779b97f4a7c15n;

/**
 * rngFor is engine.rngFor: PCG seeded (seed, seq*golden+1). Frozen: every past
 * game is audited against it.
 */
function rngFor(seed, seq) {
  const s2 = (BigInt.asUintN(64, BigInt(seq)) * GOLDEN + 1n) & MASK64;
  return new Rand(new PCG(seed, s2));
}

// seatOrderSeq: the reserved stream slot for the lobby's turn-order shuffle.
// Must match engine/seeds.go.
const SEAT_ORDER_SEQ = -1000000;

// fishBootSeqBase: the base of the Fishermen old boot's descending run of public
// stream slots, one per roll. Must match engine.FishBootSeq.
const FISH_BOOT_SEQ_BASE = -3000000;

// Board slots (BOARD_FINISH_SEQ, RIVERS_BOARD_SEQ) live in modules.mjs beside
// the hooks that use them. engine/seeds.go (seatOrderSeq) lists every slot.

/**
 * exactSeeds recovers the seeds from the replay's raw text. Seeds are uint64
 * and JSON.parse rounds them to doubles, which breaks the commitment check on
 * large seeds.
 *
 * It uses the reviver's `context.source` where available (Node 24, current
 * Chrome/Safari), otherwise a regex over the text. `"seed"` and
 * `"public_seed"` appear only in game_created's payload, so the first match
 * of each is the right one.
 */
function exactSeeds(text) {
  const found = { seed: null, public_seed: null };
  try {
    JSON.parse(text, function (k, v, ctx) {
      if ((k === "seed" || k === "public_seed") && found[k] === null &&
          ctx && typeof ctx.source === "string" && /^\d+$/.test(ctx.source)) {
        found[k] = BigInt(ctx.source);
      }
      return v;
    });
  } catch {
    // fall through to the text scan
  }
  for (const k of ["seed", "public_seed"]) {
    if (found[k] !== null) continue;
    const m = text.match(new RegExp(`"${k}"\\s*:\\s*(\\d+)`));
    if (m) found[k] = BigInt(m[1]);
  }
  return found;
}

/**
 * DERIVATION_VERSION is the set of published derivations this verifier
 * implements (board generation, module board hooks, and the public stream
 * slots for dice, fair deck, seat shuffle and event die). It must equal
 * engine.DerivationVersion. Only one version is implemented; games built by
 * any other are reported unauditable (see derivationSupport).
 */
const DERIVATION_VERSION = 13;

/**
 * derivationSupport says whether this verifier can reproduce the derivations a
 * game was built with, and if not, why, in words a player can read. Without it
 * a game from an older generator would report a false board failure.
 */
function derivationSupport(created) {
  const got = created.derivation_version;
  if (got === undefined || got === null) {
    return {
      ok: false,
      why: "this game predates derivation versioning, so its log does not say which generator built it and this auditor cannot know whether it is the one implemented here",
    };
  }
  if (got !== DERIVATION_VERSION) {
    return {
      ok: false,
      why: `this game was built by derivation version ${got} and this auditor implements version ${DERIVATION_VERSION}, so it cannot reproduce what the seed decided here (this is not a claim that anything is wrong with the game)`,
    };
  }
  return { ok: true, why: "" };
}

/** BOARD_CHECK is shared because verify() checks whether this check ran. */
const BOARD_CHECK = "board built from the seed";

/**
 * BOARD_EXT_CHECK names the board's second layer: the rules-bearing state each
 * module derives from the finished board and the log carries beside it. The
 * detail line says what was compared per module.
 */
const BOARD_EXT_CHECK = "scenario state derived from the board";

const ok = (name, detail) => ({ name, status: "ok", detail });
const bad = (name, detail) => ({ name, status: "FAILED", detail });
const skip = (name, detail) => ({ name, status: "skipped", detail });

/**
 * verify audits a replay. Returns
 *   {game, verdict, checks: [{name, status, detail}], rolls: [...]}
 * where verdict is "verified" (every applicable check passed), "failed" (at
 * least one check failed) or "unauditable" (nothing could be checked, e.g. a
 * spectator's redacted copy, or a game older than the commitment scheme).
 *
 * Skipped checks never fail a verdict, but they are always reported so they
 * cannot be mistaken for passes.
 */
function verify(input) {
  // Accepts raw response text or a parsed object. Only text keeps large seeds
  // exact (see exactSeeds).
  const isText = typeof input === "string";
  const replay = isText ? JSON.parse(input) : input;
  const exact = isText ? exactSeeds(input) : { seed: null, public_seed: null };
  const checks = [];
  const events = replay.events || [];
  const audit = replay.audit || {};

  const createdEv = events.find((e) => e.type === "game_created");
  if (!createdEv) {
    return { game: replay.game, verdict: "unauditable", checks: [skip("game_created", "no game_created event in this log")], rolls: [] };
  }
  const created = createdEv.data || {};
  const cfg = created.config || {};
  // Derived outcomes are checkable only if this build implements the game's
  // derivation version; the commitments are checked regardless.
  const support = derivationSupport(created);

  // --- the seeds ----------------------------------------------------------
  if (!created.public_seed_commit) {
    checks.push(skip("public seed commitment",
      "this game predates the split seeds (migration 0030): it ran on one undivided seed with no pre-committed public seed, so its board and seating cannot be audited"));
    return { game: replay.game, verdict: "unauditable", checks, rolls: [] };
  }
  if (created.public_seed === undefined || created.public_seed === null) {
    checks.push(skip("public seed",
      "the seed is absent from this copy of the log. Only a participant's replay reveals it; a spectator copy is redacted"));
    return { game: replay.game, verdict: "unauditable", checks, rolls: [] };
  }

  if (exact.public_seed === null && !Number.isSafeInteger(created.public_seed)) {
    checks.push(skip("public seed",
      "this replay was handed over already parsed, and the seed is larger than a JavaScript number can hold exactly. Pass the raw response text instead"));
    return { game: replay.game, verdict: "unauditable", checks, rolls: [] };
  }
  const pub = exact.public_seed !== null ? exact.public_seed : BigInt(created.public_seed);
  const derivedCommit = seedCommitment(pub);
  if (derivedCommit === created.public_seed_commit) {
    checks.push(ok("public seed matches its commitment", `sha256(seed) = ${derivedCommit}`));
  } else {
    checks.push(bad("public seed matches its commitment",
      `sha256(seed) = ${derivedCommit}, but the log commits to ${created.public_seed_commit}`));
  }

  // The log's commitment must equal the one stored when the lobby opened;
  // otherwise a commitment written at game start proves nothing.
  if (audit.public_seed_commit) {
    if (audit.public_seed_commit === created.public_seed_commit) {
      checks.push(ok("commitment published at table creation", audit.public_seed_commit));
    } else {
      checks.push(bad("commitment published at table creation",
        `the table was opened committing to ${audit.public_seed_commit}, but the game log commits to ${created.public_seed_commit}`));
    }
  } else {
    checks.push(skip("commitment published at table creation", "the replay carries no audit block"));
  }

  const priv = exact.seed !== null ? exact.seed
    : Number.isSafeInteger(created.seed) ? BigInt(created.seed) : null;
  if (priv !== null && created.seed_commit) {
    const c = seedCommitment(priv);
    checks.push(c === created.seed_commit
      ? ok("private seed matches its commitment", `sha256(seed) = ${c}`)
      : bad("private seed matches its commitment", `sha256(seed) = ${c}, committed ${created.seed_commit}`));
  }

  // --- the board ----------------------------------------------------------
  const board = verifyBoard(pub, cfg, events, support);
  checks.push(board.check);
  // The board's second layer (fishing grounds, oasis, rivers, raiders coast,
  // trade hexes, Explorers' face-down hexes). Apply runs off the logged copy,
  // so it needs its own check; see verifyBoardExt.
  checks.push(verifyBoardExt(cfg, events, support, board.derived, pub));

  // --- the seating --------------------------------------------------------
  checks.push(verifySeating(pub, cfg, audit, support));

  // --- the dice -----------------------------------------------------------
  const { check: diceCheck, rolls } = verifyDice(pub, cfg, events, support);
  checks.push(diceCheck);
  checks.push(verifyEventDie(pub, events, support));
  checks.push(verifyFishBoot(pub, cfg, events, support));

  const failed = checks.some((c) => c.status === "FAILED");
  const anyOk = checks.some((c) => c.status === "ok");
  const boardChecked = checks.some((c) => c.name === BOARD_CHECK && c.status === "ok");
  // An unsupported version or a skipped board check makes the game
  // unauditable even when the commitments pass: the commitments only show the
  // seeds were fixed in advance, not what they produced.
  if (!failed && (!support.ok || !boardChecked)) {
    return { game: replay.game, verdict: "unauditable", checks, rolls };
  }
  return {
    game: replay.game,
    verdict: failed ? "failed" : anyOk ? "verified" : "unauditable",
    checks,
    rolls,
  };
}

/**
 * verifyBoard returns the check and the board it derived, which verifyBoardExt
 * builds on. `derived` is null when no board could be derived.
 */
function verifyBoard(pub, cfg, events, support) {
  const name = BOARD_CHECK;
  if (!support.ok) {
    return { check: skip(name, support.why), derived: null };
  }
  const boardEv = events.find((e) => e.type === "board_generated");
  if (!boardEv || !boardEv.data || !boardEv.data.board) {
    return { check: skip(name, "no board in this log (a fog-of-war ruleset hides it, and a spectator copy is redacted)"), derived: null };
  }
  const mode = cfg.board_mode || BoardFair;
  let derived;
  try {
    if (cfg.board) {
      // A lobby table (the common case). Its config carries a shape (generic
      // land, blank numbers); the seed decides resources, numbers, deserts
      // and harbors.
      derived = inlineBoard(cfg.board);
      if (derived === null) {
        return { check: skip(name, "this map carries a terrain this build does not know, so its board is not checked here"), derived: null };
      }
      // Frame before minting the rng, as engine.New does, so harbors follow
      // the computed coast. Frame draws nothing.
      frameBoard(derived);
      const rng = rngFor(pub, 1);
      resolveBoard(rng, derived, mode);
      ensureHarbors(rng, derived);
    } else if (cfg.preset) {
      // A curated table. Tiles and numbers are fixed, but PresetBoard deals
      // harbors off the same stream slot as a procedural board.
      derived = presetBoard(rngFor(pub, 1), cfg.preset);
      if (derived === null) {
        return { check: skip(name, `this table used the curated map "${cfg.preset}", which this build does not carry, so its board is not checked here`), derived: null };
      }
    } else {
      derived = generateRadius(rngFor(pub, 1), cfg.players,
        boardRadiusFor(cfg.ruleset, cfg.players, radiusFor(cfg.players)), mode);
    }
    // Each module gets a fresh stream at position 2, then FinishBoard hooks
    // get one at position 3; see modules.mjs.
    // `supplied` means the board was authored (preset or inlined map). Modules
    // use it differently:
    //
    //   - islands SetupBoard skips when supplied.
    //   - fishermen FinishBoard skips when supplied; its SetupBoard (desert to
    //     lake) always runs.
    //   - caravans FinishBoard ignores it and uses dealtTerrain instead.
    const supplied = Boolean(cfg.board || cfg.preset);
    setupBoardFor(cfg.ruleset, derived, () => rngFor(pub, 2), supplied,
      cfg.players, (seq) => rngFor(pub, seq), mode);
    // Finishers get rngAt(seq) because each may use its own reserved slot
    // (BoardFinisherSlot): Caravans and Fishermen share slot 3, Rivers uses
    // RIVERS_BOARD_SEQ. finishBoardFor mints a fresh generator per hook.
    finishBoardFor(cfg.ruleset, derived, (seq) => rngFor(pub, seq), supplied, dealtTerrain(cfg), cfg.board_mode || BoardFair, cfg.players);
  } catch (err) {
    return { check: bad(name, `could not re-derive the board: ${err.message}`), derived: null };
  }

  const got = JSON.stringify(boardToWire(derived));
  const want = JSON.stringify(normalizeBoard(boardEv.data.board));
  return {
    check: got === want
      ? ok(name, `${derived.tiles.size} tiles and ${derived.harbors.length} harbors re-derived exactly`)
      : bad(name, "the logged board is not the board this seed produces"),
    // Passed on even on a mismatch so the ext layer is still reported.
    derived,
  };
}

/**
 * verifyBoardExt audits the module state derived from the finished board and
 * logged in board_generated's `ext` blob (engine.BoardGeneratedData.Ext).
 *
 * engine.Apply unmarshals that blob over the value it derives, so a game
 * replays as played and the log, not the derivation, is what the game runs on.
 * The blob decides scoring (fishing grounds, the oasis and its spokes, river
 * hexes and bridge sites, and so on), so the audit re-derives it from the same
 * board and requires the log to agree. Rivers picks its watercourse from a
 * reserved public slot, hence the rng passed to boardExtFor.
 *
 * Reported for every ruleset, as a skip when there is nothing to check.
 */
function verifyBoardExt(cfg, events, support, derived, pub) {
  const name = BOARD_EXT_CHECK;
  const parts = String(cfg.ruleset || "base").split("+");
  const wanted = ["fishermen", "caravans", "rivers", "raiders", "wagons", "explorers"].filter((m) => parts.includes(m));
  if (wanted.length === 0) {
    return skip(name, "this ruleset derives nothing from the board beyond the board (Fishermen, Caravans, Rivers, Raiders, Wagons and Explorers do)");
  }
  if (!support.ok) return skip(name, support.why);
  if (derived === null) {
    return skip(name, "the board itself could not be re-derived here, so what hangs off it cannot be either");
  }
  const boardEv = events.find((e) => e.type === "board_generated");
  const logged = (boardEv && boardEv.data && boardEv.data.ext) || null;
  if (logged === null) {
    // Not a skip: every game of these rulesets records this blob.
    return bad(name, "this ruleset derives scenario state from the board and the log carries none, so the game was not built the way this auditor derives it");
  }

  let want;
  try {
    want = boardExtFor(cfg.ruleset, derived, pub, rngFor, cfg.players);
  } catch (err) {
    return bad(name, `could not re-derive the scenario state: ${err.message}`);
  }
  const mismatched = [];
  const summary = [];
  for (const mod of wanted) {
    const got = logged[mod];
    if (got === undefined || got === null) {
      mismatched.push(`${mod}: the log carries no scenario state for it`);
      continue;
    }
    // Compare only the fields the board decided (see boardExtFor), keyed from
    // the derived side so logged key order does not matter.
    for (const [key, value] of Object.entries(want[mod])) {
      if (JSON.stringify(value) !== JSON.stringify(got[key])) {
        mismatched.push(`${mod}.${key}`);
      }
    }
    if (mod === "fishermen") summary.push(`${want.fishermen.Grounds.length} fishing grounds`);
    if (mod === "caravans") summary.push(want.caravans.HasOasis ? "the oasis and its 3 caravan spokes" : "no oasis on this board");
    if (mod === "rivers") {
      const rs = want.rivers.rivers || [];
      const sites = rs.reduce((n, r) => n + r.sites.length, 0);
      summary.push(rs.length === 1
        ? `1 river of ${rs[0].hexes.length} hexes and its ${sites} bridge sites`
        : `${rs.length} rivers and their ${sites} bridge sites`);
    }
    if (mod === "raiders") {
      summary.push(want.raiders.has_castle
        ? `the castle and the ${want.raiders.coast.length} coastal hexes raiders land on`
        : "no castle on this board");
    }
    if (mod === "wagons") summary.push(want.wagons.HasTrade ? "the 3 trade hexes, their roles and their 3 barbarians" : "no trade hexes on this board");
    if (mod === "explorers") {
      summary.push(`the home island, ${want.explorers.pool.length} face-down hexes and both chit stacks`);
    }
  }
  return mismatched.length === 0
    ? ok(name, `${summary.join(" and ")} re-derived exactly`)
    : bad(name, `the log does not match what this board produces: ${mismatched.join(", ")}`);
}

/**
 * verifyFishBoot audits the Fishermen old boot: whether a catch turned it up.
 * The boot is public and decides games, so it draws from a reserved public
 * slot (engine.FishBootSeq), one per roll.
 *
 * Everything needed is in the public log: `total` is on the catch event;
 * `tiles_left` counts down from the table's supply (30 at 2-4 seats, 44 at
 * 5-6, 58 at 7-10) by each catch's total and resets when it would reach zero;
 * a catch is keyed on the roll's position, or the placement's for the setup
 * bonus; and drawing stops once the boot is out. The audit folds these forward
 * and checks each catch's first draw.
 *
 * It does not check which seat received the boot. That second draw is weighted
 * by each seat's draw count, which would need the base game's building state
 * ported here; the detail line says so.
 */
function verifyFishBoot(pub, cfg, events, support) {
  const name = "the old boot follows from the seed";
  if (!String(cfg.ruleset || "base").split("+").includes("fishermen")) {
    return skip(name, "no old boot in this game (it is a Fishermen ruleset feature)");
  }
  if (!support.ok) return skip(name, support.why);

  // engine/scenarios.bootSupplyFor: every token of the table's supply plus the boot
  // (30 at 2-4 seats, 44 at 5-6, 58 at 7-10; derivation 13).
  const BOOT_SUPPLY = bootSupplyFor(cfg.players || 0);
  let tilesLeft = BOOT_SUPPLY;
  let inPlay = false;
  // The log position the catch's streams are keyed on: a roll's dice_rolled,
  // or, for the setup bonus (derivation 13: a second settlement beside a ground
  // or a lake draws one token), the placement that earned it.
  let lastRollSeq = null;
  let checked = 0, mismatches = 0;
  for (const e of events) {
    if (e.type === "dice_rolled" || e.type === "settlement_placed" || e.type === "setup_city_placed") {
      lastRollSeq = e.seq;
      continue;
    }
    if (e.type !== "tab_fish_caught") continue;
    const d = e.data || {};
    if (d.total === undefined || d.boot_to === undefined) continue; // redacted copy
    const gotBoot = d.boot_to !== -1;
    if (!inPlay && lastRollSeq !== null) {
      // engine/scenarios.fishCatch: rng.IntN(max(TilesLeft, total)) < total.
      const left = Math.max(tilesLeft, d.total);
      const draw = rngFor(pub, FISH_BOOT_SEQ_BASE - lastRollSeq).intN(left);
      checked++;
      if ((draw < d.total) !== gotBoot) mismatches++;
    }
    tilesLeft -= d.total;
    if (tilesLeft < 1) tilesLeft = BOOT_SUPPLY;
    if (gotBoot) inPlay = true;
  }
  if (checked === 0) {
    return skip(name, "no fish were caught before the boot came into play, so the seed decided nothing here");
  }
  return mismatches === 0
    ? ok(name, `${checked} catches: whether the boot turned up re-derived exactly (which seat received it is weighted by that roll's draw counts and is not re-derived here)`)
    : bad(name, `on ${mismatches} of ${checked} catches the boot did not do what this seed says it should`);
}

/**
 * inlineBoard reads the shape out of a config, as engine.New does with
 * cfg.Board.Clone(). Returns null only when the config names a terrain this
 * build does not know. Land-only gallery maps are framed by the caller
 * (frame.mjs).
 */
function inlineBoard(raw) {
  const b = {
    radius: raw.radius,
    tiles: new Map(),
    robber: raw.robber ? { q: raw.robber.q, r: raw.robber.r } : { q: 0, r: 0 },
    harbors: (raw.harbors || []).map((h) => ({
      verts: h.verts.map((v) => ({ q: v.q, r: v.r, side: v.side })),
      ratio: h.ratio,
      res: resourcesByName[h.res],
    })),
  };
  for (const t of raw.tiles || []) {
    const res = resourcesByName[t.res];
    if (res === undefined) return null; // a terrain this build does not know
    b.tiles.set(`${t.hex.q},${t.hex.r}`, { res, number: t.num });
  }
  return b;
}

/**
 * normalizeBoard re-emits a logged board in the same key order boardToWire
 * uses, so the two can be compared as strings. It does not reorder tiles: the
 * server emits them in HexesInRadius order and a differing order is itself a
 * mismatch worth reporting.
 */
function normalizeBoard(b) {
  return {
    radius: b.radius,
    tiles: (b.tiles || []).map((t) => ({ hex: { q: t.hex.q, r: t.hex.r }, res: t.res, num: t.num })),
    robber: { q: b.robber.q, r: b.robber.r },
    harbors: (b.harbors || []).map((h) => ({
      verts: h.verts.map((v) => ({ q: v.q, r: v.r, side: v.side })),
      ratio: h.ratio,
      res: h.res,
    })),
  };
}

function verifySeating(pub, cfg, audit, support) {
  const name = "seating derived from the seed";
  if (!support.ok) {
    return skip(name, support.why);
  }
  if (cfg.turn_order === "lobby") {
    return skip(name, "this table kept lobby order, so no shuffle happened");
  }
  const pre = audit.pre_shuffle_seats;
  const final = audit.final_seats;
  if (!pre || !final) {
    return skip(name, "the replay carries no pre-shuffle roster, so the permutation has nothing to be checked against");
  }
  if (pre.length !== final.length) {
    return bad(name, `roster sizes disagree: ${pre.length} before the shuffle, ${final.length} after`);
  }
  const order = rngFor(pub, SEAT_ORDER_SEQ).perm(pre.length);
  const want = order.map((idx) => pre[idx]);
  return JSON.stringify(want) === JSON.stringify(final)
    ? ok(name, `seats ${order.join(", ")}: the permutation this seed produces`)
    : bad(name, `this seed seats the roster as [${want.join(", ")}], but the game was played as [${final.join(", ")}]`);
}

function verifyDice(pub, cfg, events, support) {
  const name = "every roll follows from the seed";
  if (!support.ok) {
    return { check: skip(name, support.why), rolls: [] };
  }
  const fairMode = cfg.dice_mode === "fair";
  const rolls = [];
  let rollCount = 0; // mirrors State.RollCount: incremented for every logged roll
  let mismatches = 0, checked = 0, declared = 0;

  // An Alchemist roll is not decided by the seed, so a `fixed` flag is only
  // accepted when a preceding public `cak_dice_fixed` event declared those two
  // numbers in a Knights ruleset. Each declaration covers one roll, as in the
  // engine (AlchemistD1 is cleared on use, engine/knights/apply.go).
  const knights = (cfg.ruleset || "").split("+").includes("cak");
  const declarations = [];
  for (const e of events) {
    if (e.type !== "cak_dice_fixed") continue;
    const d = e.data || {};
    if (d.d1 === undefined) continue;
    declarations.push({ seq: e.seq, d1: d.d1, d2: d.d2, used: false });
  }
  const claimDeclaration = (seq, logged) => {
    for (let i = declarations.length - 1; i >= 0; i--) {
      const c = declarations[i];
      if (c.used || c.seq >= seq) continue;
      if (c.d1 !== logged[0] || c.d2 !== logged[1]) return { ok: false, why: `an Alchemist declared ${c.d1}+${c.d2}` };
      c.used = true;
      return { ok: true };
    }
    return { ok: false, why: "no Alchemist declared it" };
  };
  let forged = 0;

  for (const e of events) {
    if (e.type !== "dice_rolled") continue;
    const d = e.data || {};
    if (d.d1 === undefined) continue; // redacted copy

    let expect = null;
    if (fairMode) {
      // The fair deck: all 36 ordered outcomes, shuffled once per 36-roll
      // epoch on its own reserved (negative) stream slot, dealt without
      // replacement.
      const epoch = Math.floor(rollCount / 36);
      const pos = rollCount % 36;
      const perm = rngFor(pub, -(epoch + 1)).perm(36);
      const outcome = perm[pos];
      expect = [Math.floor(outcome / 6) + 1, (outcome % 6) + 1];
    } else {
      const rng = rngFor(pub, e.seq);
      expect = [rng.intN(6) + 1, rng.intN(6) + 1];
    }

    const logged = [d.d1, d.d2];
    if (d.fixed) {
      // An Alchemist roll: reported but not counted, once its declaration is
      // found.
      const claim = knights ? claimDeclaration(e.seq, logged) : { ok: false, why: "this ruleset has no Alchemist" };
      if (!claim.ok) {
        forged++;
        rolls.push({ seq: e.seq, n: rollCount + 1, logged, expected: null, status: `UNDECLARED (${claim.why})` });
      } else {
        declared++;
        rolls.push({ seq: e.seq, n: rollCount + 1, logged, expected: null, status: "declared (Alchemist)" });
      }
    } else {
      checked++;
      const same = expect[0] === logged[0] && expect[1] === logged[1];
      if (!same) mismatches++;
      rolls.push({ seq: e.seq, n: rollCount + 1, logged, expected: expect, status: same ? "ok" : "MISMATCH" });
    }
    rollCount++;
  }

  if (forged > 0) {
    return { check: bad(name, `${forged} of ${rollCount} rolls claim to be Alchemist rolls with nothing in the log declaring them`), rolls };
  }
  if (checked === 0 && rollCount > 0) {
    // Not a skip: a skip would let an all-Alchemist log pass while deriving
    // nothing from the seed.
    return { check: bad(name, `all ${rollCount} rolls were declared by an Alchemist, so no roll in this game came from the seed`), rolls };
  }
  if (checked === 0) {
    return { check: skip(name, "this game logged no rolls"), rolls };
  }
  const suffix = declared > 0 ? `; ${declared} declared by an Alchemist and not derivable` : "";
  return {
    check: mismatches === 0
      ? ok(name, `${checked} rolls re-derived exactly${suffix}`)
      : bad(name, `${mismatches} of ${checked} rolls are not what this seed produces${suffix}`),
    rolls,
  };
}

function verifyEventDie(pub, events, support) {
  const name = "every event die follows from the seed";
  // The event die's slot has moved before (engine.EventDieSeq); the version
  // check covers older games.
  if (!support.ok) {
    return skip(name, support.why);
  }
  const faces = { 3: "trade", 4: "politics", 5: "science" };
  let checked = 0, mismatches = 0;
  // The event die uses its own reserved slot: -2000000 minus the roll event's
  // log position. A positive offset from the roll's seq would collide with a
  // later roll's dice stream (see engine.EventDieSeq).
  const eventDieSeq = (rollSeq) => -2000000 - rollSeq;
  let lastRollSeq = null;
  for (const e of events) {
    if (e.type === "dice_rolled") { lastRollSeq = e.seq; continue; }
    if (e.type !== "cak_event_die") continue;
    if (lastRollSeq === null || !e.data || e.data.face === undefined) continue;
    const die = rngFor(pub, eventDieSeq(lastRollSeq)).intN(6);
    const want = faces[die] || "ship";
    checked++;
    if (want !== e.data.face) mismatches++;
  }
  if (checked === 0) return skip(name, "no event die in this game (it is a Knights ruleset feature)");
  return mismatches === 0
    ? ok(name, `${checked} event dice re-derived exactly`)
    : bad(name, `${mismatches} of ${checked} event dice are not what this seed produces`);
}

/** format renders a verify() result as plain text. */
function format(result) {
  const lines = [];
  lines.push(`game ${result.game}: ${result.verdict.toUpperCase()}`);
  lines.push("");
  for (const c of result.checks) {
    const mark = c.status === "ok" ? "PASS" : c.status === "FAILED" ? "FAIL" : "----";
    lines.push(`  [${mark}] ${c.name}`);
    if (c.detail) lines.push(`         ${c.detail}`);
  }
  if (result.rolls.length > 0) {
    lines.push("");
    lines.push(`  rolls (${result.rolls.length}):`);
    for (const r of result.rolls) {
      const exp = r.expected ? ` expected ${r.expected[0]}+${r.expected[1]}` : "";
      lines.push(`    #${String(r.n).padStart(3)} seq ${String(r.seq).padStart(5)}  rolled ${r.logged[0]}+${r.logged[1]} = ${r.logged[0] + r.logged[1]}${exp}  ${r.status}`);
    }
  }
  return lines.join("\n");
}

return { verify, format, exactSeeds, seedCommitment };
})();

if (typeof module !== "undefined" && module.exports) module.exports = costanVerify;
