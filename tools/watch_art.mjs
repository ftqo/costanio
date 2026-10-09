// Watch every blend in the 3D pipeline and re-export whatever changes.
//
//     node tools/watch_art.mjs
//
// Driven by `make art-live`, which starts this and the dev server together.
//
// Save any 3D asset in Blender and a second later the board in the browser is
// drawn with it, so art is judged through the game's camera (56 degrees)
// rather than the viewport.
//
// One watcher for every pipeline:
//
//   art/hexes/<terrain>.blend  ->  that tile's .glb          (fast, ~1s)
//   art/pieces/<set>.blend     ->  models/pieces/<set>.glb   (fast, ~1s)
//   art/<family>.blend         ->  that family's .glb        (fast, ~1s)
//   art/robbers.blend          ->  robbers.glb
//
// One blend, one asset: saving `art/pieces.blend` re-exports `pieces.glb` and
// nothing else. Neither job rewrites the manifest or palette.json, which are
// properties of every blend at once and cannot be written from one file. Run
// `make export-assets` after adding or removing a material.
//
// `art/board.blend` is not watched: it is the linked assembly, an output of
// the tiles rather than a source.
//
// No dependencies (`fs.watch` is built in), so it runs from a bare checkout.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, watch, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ART = path.join(REPO, "art");
const HEXES = path.join(ART, "hexes");
// The culture piece sets, one blend per set, the same shape as art/hexes/.
// `art/pieces.blend` (the stock set, a file rather than a directory) is picked
// up by the family branch below.
const PIECE_SETS = path.join(ART, "pieces");
const VERSION = path.join(REPO, "frontend", "public", "models", ".artversion");

/** Blender is not on PATH on macOS; resolve it the way the Makefile does. */
function blender() {
  return (
    [
      process.env.BLENDER,
      path.join(process.env.HOME ?? "", "blender/blender-5.2.0-linux-x64/blender"),
      "/Applications/Blender.app/Contents/MacOS/Blender",
    ].filter(Boolean).find((p) => existsSync(p)) ?? "blender"
  );
}

const BLENDER = blender();
const script = (name) => path.join(REPO, "tools", "blender", name);

/**
 * What to run for a given job, as argv after the Blender binary.
 *
 * A tile job carries its terrain so only that tile is re-exported: opening
 * eleven blends costs about a second and a half.
 */
function commandFor(job) {
  if (job.kind === "tile") {
    return ["--background", "--factory-startup", "--python", script("export_tiles.py"), "--", job.name];
  }
  if (job.kind === "family") {
    return ["--background", "--factory-startup", "--python", script("export_assets.py"), "--", job.name];
  }
  if (job.kind === "robbers") {
    return ["--background", "--factory-startup", "--python", script("export_robbers_glb.py")];
  }
  throw new Error(`unknown job ${job.kind}`);
}

/** Which job a changed file belongs to, or null for one we do not rebuild. */
function jobFor(dir, file) {
  if (!file || !file.endsWith(".blend")) return null;
  if (dir === HEXES) {
    return { key: `tile:${file}`, kind: "tile", name: path.basename(file, ".blend") };
  }
  if (dir === PIECE_SETS) {
    // `pieces/<set>` is what export_assets.py calls it, which is how it stays
    // distinguishable from the family `pieces` (art/pieces.blend).
    const name = `pieces/${path.basename(file, ".blend")}`;
    return { key: `set:${name}`, kind: "family", name };
  }
  if (file === "robbers.blend") return { key: "robbers", kind: "robbers", name: "robbers" };
  // board.blend is an output (the linked assembly), not a source.
  if (dir === ART && file !== "board.blend") {
    const name = path.basename(file, ".blend");
    return { key: `family:${name}`, kind: "family", name };
  }
  return null;
}

/**
 * Blender writes a save as a rename dance and leaves a .blend1 behind, so one
 * Ctrl-S produces several events within a few milliseconds. Coalesce per job.
 */
const DEBOUNCE_MS = 400;
const pending = new Map();
const queue = new Map();
let running = false;

function bump(reason) {
  // The page polls this file. Content, not mtime: a browser may serve a
  // cached 304 for a body that did not change.
  writeFileSync(VERSION, JSON.stringify({ at: Date.now(), reason }));
}

function run(job) {
  return new Promise((resolve) => {
    const started = Date.now();
    const proc = spawn(BLENDER, commandFor(job), { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (c) => (out += c));
    proc.stderr.on("data", () => {});
    proc.on("exit", (code) => {
      const ms = Date.now() - started;
      const drift = /PALETTE_DRIFT/.test(out);
      if (code === 0) {
        console.log(`  ${job.name} re-exported in ${ms}ms${drift ? "  [PALETTE_DRIFT]" : ""}`);
        if (drift) {
          // The palette is write-once, so a changed material set means the
          // shipped colours and the blend disagree.
          const line = out.split("\n").find((l) => l.includes("PALETTE_DRIFT"));
          console.error("    " + (line ?? "").trim());
        }
      } else {
        // A blend saved mid-write, or art that breaks the exporter. Report it
        // and keep watching.
        console.error(`  ${job.name} FAILED (exit ${code})`);
        console.error("    " + out.trim().split("\n").slice(-4).join("\n    "));
      }
      resolve();
    });
  });
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.size) {
    const [key, job] = [...queue.entries()][0];
    queue.delete(key);
    await run(job);
    bump(job.name);
  }
  running = false;
}

function onChange(dir, file) {
  const job = jobFor(dir, file);
  if (!job) return;
  clearTimeout(pending.get(job.key));
  pending.set(
    job.key,
    setTimeout(() => {
      pending.delete(job.key);
      console.log(`changed: ${job.name}`);
      queue.set(job.key, job);
      void drain();
    }, DEBOUNCE_MS),
  );
}

function main() {
  if (!existsSync(HEXES)) {
    console.error(`no ${path.relative(REPO, HEXES)} to watch`);
    process.exit(1);
  }
  const tiles = readdirSync(HEXES).filter((f) => f.endsWith(".blend"));
  const sets = existsSync(PIECE_SETS)
    ? readdirSync(PIECE_SETS).filter((f) => f.endsWith(".blend"))
    : [];
  const families = readdirSync(ART).filter(
    (f) => f.endsWith(".blend") && f !== "board.blend" && f !== "robbers.blend",
  );
  bump("start");
  console.log(`blender: ${BLENDER}`);
  console.log(
    `watching ${tiles.length} tiles, ${sets.length} piece sets, ` +
      `${families.length} families and robbers.blend`,
  );
  watch(HEXES, (_e, f) => onChange(HEXES, f));
  if (existsSync(PIECE_SETS)) watch(PIECE_SETS, (_e, f) => onChange(PIECE_SETS, f));
  watch(ART, (_e, f) => onChange(ART, f));
  // Never resolves: this is a daemon.
}

main();
