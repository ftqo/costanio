#!/usr/bin/env node
// Bake the picked hero still-life renders into the asset pack.
//
//   node scripts/resource-art.mjs --src <render dir> [--only wood,brick] [--dry-run]
//
// Reads the pick map (src/lib/resourceArt.json) and, for every item in it,
// converts the two chosen PNGs out of the render batch into webp:
//
//   <src>/<id>-<card>-512.png   ->  public/assets/card_<id>.webp  (cardPx square)
//   <src>/<id>-<small>-128.png  ->  public/assets/icon_<id>.webp  (smallPx square)
//
// and records both slots in public/assets/manifest.json, which the runtime
// resolves art from (lib/assets). The render dir is the batch folder whose
// manifest.json lists `items.<id>[]` with `file` (512) and `small` (128); file
// names are read from that manifest.
//
// To swap a pick: edit resourceArt.json, run this, commit the two webp and the
// manifest. A pick of "shipped" restores a good's shipped icon. A new item is
// the same plus one line in resourceArt.json.
//
// Needs `cwebp` (libwebp). The flake does not ship it; on macOS it is
// `brew install webp`, and CWEBP=/path/to/cwebp overrides the lookup.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const picksPath = join(root, "src/lib/resourceArt.json");
const assets = join(root, "public/assets");
const packPath = join(assets, "manifest.json");

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const src = opt("--src") ?? process.env.RESOURCE_ART_SRC;
function picks_peek() {
  return JSON.parse(readFileSync(join(root, "src/lib/resourceArt.json"), "utf8")).items;
}
const only = opt("--only")?.split(",").filter(Boolean);
const dry = args.includes("--dry-run");
if (!src && !Object.values(picks_peek()).every((v) => v === "shipped")) {
  console.error("usage: node scripts/resource-art.mjs --src <render dir> [--only a,b] [--dry-run]");
  process.exit(2);
}

function findCwebp() {
  if (process.env.CWEBP) return process.env.CWEBP;
  for (const p of ["/opt/homebrew/bin/cwebp", "/usr/local/bin/cwebp", "/usr/bin/cwebp"]) {
    if (existsSync(p)) return p;
  }
  return "cwebp";
}
const cwebp = findCwebp();

const picks = JSON.parse(readFileSync(picksPath, "utf8"));
const batch = src ? JSON.parse(readFileSync(join(src, "manifest.json"), "utf8")) : { items: {} };
const pack = JSON.parse(readFileSync(packPath, "utf8"));

function variant(id, n) {
  const v = (batch.items?.[id] ?? []).find((x) => x.n === n);
  if (!v) throw new Error(`${id}: variant ${n} is not in ${src}/manifest.json`);
  return v;
}

function bake(from, to, px) {
  if (!existsSync(from)) throw new Error(`missing render: ${from}`);
  const argv = [
    "-quiet",
    "-q",
    "86",
    "-alpha_q",
    "90",
    "-m",
    "6",
    "-resize",
    `${px}`,
    `${px}`,
    from,
    "-o",
    to,
  ];
  if (dry) {
    console.log(`would: cwebp ${argv.join(" ")}`);
    return;
  }
  execFileSync(cwebp, argv, { stdio: "inherit" });
  console.log(`${to.slice(root.length + 1)}  ${(statSync(to).size / 1024).toFixed(1)} KB`);
}

let n = 0;
for (const [id, pick] of Object.entries(picks.items)) {
  if (only && !only.includes(id)) continue;
  if (pick === "shipped") {
    // Back to the shipped art: drop any baked card render (the card then draws
    // the small icon). icon_<id> is left alone; restore a re-baked one from git
    // (`git show <rev>:frontend/public/assets/icon_<id>.webp | git lfs smudge`).
    const card = join(assets, `card_${id}.webp`);
    if (!dry && existsSync(card)) unlinkSync(card);
    if (!dry) delete pack.slots[`card_${id}`];
    console.log(`${id}: shipped`);
    n++;
    continue;
  }
  if (!batch.items?.[id]) {
    console.log(`${id}: not in this batch, skipped`);
    continue;
  }
  if (pick.card) {
    const v = variant(id, pick.card);
    bake(join(src, v.file), join(assets, `card_${id}.webp`), picks.cardPx);
    pack.slots[`card_${id}`] = { ext: "webp" };
  }
  if (pick.small) {
    const v = variant(id, pick.small);
    bake(join(src, v.small ?? v.file), join(assets, `icon_${id}.webp`), picks.smallPx);
    pack.slots[`icon_${id}`] = { ext: "webp" };
  }
  n++;
}

if (!dry) {
  // Sorted, so a re-bake is a stable diff.
  pack.slots = Object.fromEntries(
    Object.entries(pack.slots).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(packPath, JSON.stringify(pack, null, 2) + "\n");
}
console.log(`${n} item(s) ${dry ? "checked" : "baked"}`);
