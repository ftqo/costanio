#!/usr/bin/env node
// Builds verify/dist/verify.js: the whole verifier as one file with no imports.
//
// The modules under verify/ are the source of truth for the app and tests. The
// bundle is for someone who wants to paste the auditor into a browser console
// or keep one file next to a saved replay. It is committed, and a test checks
// it matches the source.
//
// The transform is minimal (drop relative `import` lines, drop the
// `export` keyword, concatenate in dependency order), which works because every
// module uses only named exports and relative imports. If a module needs more,
// use a real bundler.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Dependency order, leaves first.
const MODULES = ["rand.mjs", "sha256.mjs", "coords.mjs", "board.mjs", "frame.mjs", "modules.mjs", "verify.mjs"];

const HEADER = `// costan.io fairness verifier -- GENERATED FILE, do not edit.
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
`;

/**
 * strip removes a module's relative imports and its `export` keywords.
 *
 * Imports are dropped statement-wise, not line-wise: several of these modules
 * import enough names to wrap, and a line filter would delete the `import {`
 * and leave the names behind as a syntax error.
 */
function strip(src, name) {
  const lines = src.split("\n");
  const out = [];
  let inImport = false;
  for (const line of lines) {
    const t = line.trim();
    if (inImport) {
      if (/from\s+"\.\/[^"]*";$/.test(t)) inImport = false;
      continue;
    }
    if (/^import\s/.test(t)) {
      // A one-line relative import, or the head of a wrapped one.
      if (/from\s+"\.\/[^"]*";$/.test(t)) continue;
      if (!/;$/.test(t)) { inImport = true; continue; }
    }
    out.push(line);
  }
  const body = out
    .join("\n")
    .replace(/^export (function|class|const|let) /gm, "$1 ")
    .trimEnd();
  // A bare `export { a, b };` would survive the replace above and fail at load
  // time far from the cause. Only one export form is supported; say so here.
  const leftover = body.match(/^\s*export\s.*$/m);
  if (leftover) {
    console.error(
      `bundle-verify: ${name} uses an export form this bundler does not handle:\n  ${leftover[0].trim()}\n` +
      `Write it as \`export function\`/\`export const\` on the declaration itself.`);
    process.exit(1);
  }
  return body;
}

// Concatenation puts every module in one scope, so two modules cannot define
// private helpers with the same name (share it instead). That would fail as a
// duplicate-declaration SyntaxError at load time; name the collision here.
const DECL = /^(?:export )?(?:function|class|const|let|var) ([A-Za-z_$][\w$]*)/gm;
const declaredIn = new Map();

const parts = [HEADER, "const costanVerify = (() => {", '"use strict";'];
for (const name of MODULES) {
  const src = readFileSync(join(root, "verify", name), "utf8");
  for (const m of src.matchAll(DECL)) {
    const prev = declaredIn.get(m[1]);
    if (prev !== undefined) {
      console.error(
        `bundle-verify: "${m[1]}" is declared in both verify/${prev} and verify/${name}.\n` +
        `Flat concatenation shares one scope, so one of them has to export it and the other import it.`);
      process.exit(1);
    }
    declaredIn.set(m[1], name);
  }
  const rule = "-".repeat(Math.max(3, 62 - name.length));
  parts.push("", `// ---- verify/${name} ${rule}`, "");
  parts.push(strip(src, name));
}
parts.push("", "return { verify, format, exactSeeds, seedCommitment };", "})();", "");
parts.push('if (typeof module !== "undefined" && module.exports) module.exports = costanVerify;');
parts.push("");

const out = join(root, "verify", "dist", "verify.js");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, parts.join("\n"));
console.log(`wrote ${out}`);
