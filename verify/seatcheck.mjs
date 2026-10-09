// Checks the ported seating permutation against fixtures dumped by Go.
// Driven by TestJSSeatOrderMatchesGo; not useful on its own.
import { readFileSync } from "node:fs";
import { PCG, Rand } from "./rand.mjs";

const MASK64 = (1n << 64n) - 1n;
const GOLDEN = 0x9e3779b97f4a7c15n;
const SEAT_ORDER_SEQ = -1000000;
const rngFor = (seed, seq) =>
  new Rand(new PCG(seed, (BigInt.asUintN(64, BigInt(seq)) * GOLDEN + 1n) & MASK64));

let bad = 0;
for (const row of JSON.parse(readFileSync(process.argv[2], "utf8"))) {
  const got = rngFor(BigInt(row.seed), SEAT_ORDER_SEQ).perm(row.n);
  if (JSON.stringify(got) !== JSON.stringify(row.order)) {
    bad++;
    console.log(`seed ${row.seed} n=${row.n}: js ${got} vs go ${row.order}`);
  }
}
console.log(bad ? `${bad} mismatches` : "seat order matches");
process.exit(bad ? 1 : 0);
