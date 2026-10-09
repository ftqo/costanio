// Checks the ported Caravans finisher against boards finished by Go.
// Driven by TestJSLoneOasisPromotion; not useful on its own.
//
// Each row is { name, players, fair, seed1, seed2, board, finished }: `board`
// (Board.MarshalJSON wire form) goes to caravansFinishBoard with a generator
// seeded NewPCG(seed1, seed2) and every hex movable; `finished` is Go's
// Caravans.FinishBoard of it. The port must match tiles and robber.
//
// This covers the one-oasis promotion (and its fair-mode rebalance) on a board
// with no desert or lake, which no board engine.New deals can reach.
import { readFileSync } from "node:fs";
import { boardToWire, resourcesByName } from "./board.mjs";
import { caravansFinishBoard } from "./modules.mjs";
import { PCG, Rand } from "./rand.mjs";

function fromWire(raw) {
  const b = {
    radius: raw.radius,
    tiles: new Map(),
    robber: raw.robber ? { q: raw.robber.q, r: raw.robber.r } : { q: 0, r: 0 },
    harbors: [],
  };
  for (const t of raw.tiles || []) {
    const res = resourcesByName[t.res];
    if (res === undefined) throw new Error(`unknown terrain ${JSON.stringify(t.res)}`);
    b.tiles.set(`${t.hex.q},${t.hex.r}`, { res, number: t.num });
  }
  return b;
}

// The finisher never touches harbours, and the rows carry none.
const shape = (wire) => JSON.stringify({ radius: wire.radius, tiles: wire.tiles, robber: wire.robber });

let bad = 0, n = 0;
for (const row of JSON.parse(readFileSync(process.argv[2], "utf8"))) {
  n++;
  const b = fromWire(row.board);
  const rng = new Rand(new PCG(BigInt(row.seed1), BigInt(row.seed2)));
  caravansFinishBoard(b, rng, () => true, null, row.players, row.fair);
  const got = shape(boardToWire(b));
  const want = shape(row.finished);
  if (got !== want) {
    bad++;
    if (bad <= 3) console.log(`${row.name}:\n  js ${got}\n  go ${want}`);
  }
}
console.log(bad ? `${bad} of ${n} boards finished differently` : `${n} boards finished identically`);
process.exit(bad ? 1 : 0);
