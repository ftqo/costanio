// Checks the ported Board.Frame against boards framed by Go.
// Driven by TestJSFrameMatchesGo; not useful on its own.
//
// Each row is { name, board, framed }: `board` is an unframed board in
// Board.MarshalJSON's wire form, `framed` is Go's Frame of it. The port must
// match tiles, radius and robber.
import { readFileSync } from "node:fs";
import { boardToWire, resourcesByName } from "./board.mjs";
import { frameBoard } from "./frame.mjs";

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

// Frame ignores harbors and the fixtures carry none, so leave them out of the
// comparison (an empty list vs an absent one would otherwise differ).
const shape = (wire) => JSON.stringify({ radius: wire.radius, tiles: wire.tiles, robber: wire.robber });

let bad = 0, n = 0;
for (const row of JSON.parse(readFileSync(process.argv[2], "utf8"))) {
  n++;
  const b = fromWire(row.board);
  frameBoard(b);
  const got = shape(boardToWire(b));
  const want = shape(row.framed);
  if (got !== want) {
    bad++;
    if (bad <= 3) console.log(`${row.name}:\n  js ${got}\n  go ${want}`);
  }
}
console.log(bad ? `${bad} of ${n} boards framed differently` : `${n} boards framed identically`);
process.exit(bad ? 1 : 0);
