// Runs the generated single-file bundle against a replay, so the tests exercise
// the artifact people actually use. Same contract as cli.mjs.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const v = require("./dist/verify.js");

const result = v.verify(readFileSync(process.argv[2], "utf8"));
console.log(v.format(result));
process.exit(result.verdict === "verified" ? 0 : result.verdict === "failed" ? 1 : 2);
