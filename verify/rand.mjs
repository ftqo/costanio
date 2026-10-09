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

export const MASK64 = (1n << 64n) - 1n;
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
export class PCG {
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
export class Rand {
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
