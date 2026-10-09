#!/usr/bin/env node
// Audit a finished game from the command line.
//
//   node verify/cli.mjs replay.json
//   curl -s -H "Cookie: $C" https://costan.io/api/games/ID/replay > replay.json
//
// Exits 0 when the game verified, 1 when a check failed, 2 when there was
// nothing to check (a redacted copy, or a game older than the scheme).

import { readFileSync } from "node:fs";
import { verify, format } from "./verify.mjs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node verify/cli.mjs <replay.json>");
  process.exit(2);
}
// Raw text: uint64 seeds do not survive JSON.parse.
const result = verify(readFileSync(path, "utf8"));
console.log(format(result));
process.exit(result.verdict === "verified" ? 0 : result.verdict === "failed" ? 1 : 2);
