/**
 * Seeds, as the decimal strings the server speaks.
 *
 * A seed is a uint64 on the wire and JSON numbers are float64, so a seed above
 * 2^53 passed through `Number` is rounded and deals a different board. This
 * works on strings and BigInts so the seed beside a board always deals that
 * board again.
 */

/** A random uint64, as the decimal string the endpoints speak. */
export function randomSeed(): string {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return ((BigInt(buf[0]) << 32n) | BigInt(buf[1])).toString();
}
