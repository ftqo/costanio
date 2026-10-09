// Serve the board harness and photograph it headlessly, from two bearings.
//
//     node frontend/dev/board-shot.mjs [outdir]
//
// Usually run as `make board-shot`.
//
// A browser is needed because the gutter sand, coastline and harbour signs are
// built at runtime and palette.json overrides authored colours, none of which
// a Blender render shows.
//
// The opening pose is always azimuth 0, so other bearings are reached by
// orbiting with the real controls: OrbitControls turns a horizontal drag of
// `clientHeight` into a full turn.
//
// JPEG, not PNG: the sets are re-shot often and PNG was about 15x larger.
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

// Lives in `frontend/` so Node resolves `playwright-core` from
// `frontend/node_modules` (ESM resolves from the module's location).
const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.dirname(FRONTEND);
const OUT =
  process.argv[2] ?? process.env.BOARD_SHOT_OUT ?? path.join(REPO, "art", "prototypes", "board");

// The dev server's port. Overridable so several checkouts can shoot at once.
const PORT = Number(process.env.BOARD_SHOT_PORT ?? 6788);
const WIDTH = 1600;
const HEIGHT = 1000;

/** How long to let the models load before calling it a failure. */
const READY_TIMEOUT_MS = 60_000;

/**
 * Bearings to shoot, in degrees of orbit from the game's opening pose.
 *
 * Overridable, with the dolly, the pan and the number of swell instants, for
 * framing one part of the board. Unset, it takes the default three shots.
 *
 *   BOARD_SHOT_OUT=dir  BOARD_SHOT_BEARINGS=0,120  BOARD_SHOT_PAN=-260,-40 \
 *   BOARD_SHOT_ZOOMS=0,4  BOARD_SHOT_PHASES=2  node frontend/dev/board-shot.mjs
 *
 * `PAN` is a right-drag in pixels, applied once after the orbit (OrbitControls
 * pans along the ground plane; see `screenSpacePanning` in Board3D). `ZOOMS` are
 * wheel clicks in from the framed view, cumulative down the list. `PHASES` is
 * how many frames to take at each pose, `PHASE_MS` apart, to catch different
 * instants of the swell.
 */
const list = (name, fallback) =>
  (process.env[name] ?? fallback)
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v));

/**
 * Which board to photograph, and under which look.
 *
 * `BOARD_SHOT_FIXTURE` is a path the dev server serves (a file under
 * the frontend root, so `dev/board-shots.fog.board.json` is
 * `/dev/board-shots.fog.board.json`), and
 * `BOARD_SHOT_LOOK` is one of the four looks (`""`, `dark`, `post`,
 * `postdark`). Both go to the page as query params; see `board-shots.tsx`.
 *
 * A non-default look is added to the filename so looks do not overwrite each
 * other.
 */
const FIXTURE = process.env.BOARD_SHOT_FIXTURE ?? "";
// `BOARD_SHOT_VIEW` is a whole dumped frame view rather than a board, for
// modules whose pieces live in the view's `ext`. The page prefers it when both
// are set.
const VIEW = process.env.BOARD_SHOT_VIEW ?? "";
const LOOK = process.env.BOARD_SHOT_LOOK ?? "";
/**
 * What the photographed view claims to be playing.
 *
 * A module draws nothing unless the ruleset names it, so a scenario fixture
 * without this silently renders as a plain board. The page defaults to "base".
 */
const RULESET = process.env.BOARD_SHOT_RULESET ?? "";

const BEARINGS = list("BOARD_SHOT_BEARINGS", "0,120,240");
const ZOOMS = list("BOARD_SHOT_ZOOMS", "0");
const PAN = list("BOARD_SHOT_PAN", "0,0");
const PHASES = Math.max(1, Number(process.env.BOARD_SHOT_PHASES ?? 1));
const PHASE_MS = Number(process.env.BOARD_SHOT_PHASE_MS ?? 1500);

function startServer() {
  const proc = spawn(
    "npx",
    ["vite", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: FRONTEND, stdio: ["ignore", "pipe", "pipe"] },
  );
  return new Promise((resolve, reject) => {
    const fail = setTimeout(() => reject(new Error("vite did not start in 60s")), 60_000);
    const watch = (chunk) => {
      if (String(chunk).includes("ready in") || String(chunk).includes("Local:")) {
        clearTimeout(fail);
        resolve(proc);
      }
    };
    proc.stdout.on("data", watch);
    proc.stderr.on("data", (c) => process.stderr.write(c));
    proc.on("exit", (code) => {
      clearTimeout(fail);
      reject(new Error(`vite exited with ${code}`));
    });
  });
}

async function main() {
  // Wipe the directory so no stale frame survives a re-shoot.
  // `BOARD_SHOT_KEEP=1` keeps it, for shooting several looks into one directory.
  if (process.env.BOARD_SHOT_KEEP !== "1") await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const server = await startServer();
  const browser = await chromium.launch();
  let failure = null;
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      // 1.5, not 2: the shots are committed as plain blobs, and 2400x1500 is
      // plenty at about half the bytes.
      deviceScaleFactor: 1.5,
    });
    page.on("console", (m) => {
      if (m.type() === "error") console.error("  page error:", m.text());
    });

    const query = new URLSearchParams();
    if (FIXTURE) query.set("board", FIXTURE);
    if (RULESET) query.set("ruleset", RULESET);
    if (VIEW) query.set("view", VIEW);
    if (LOOK) query.set("look", LOOK);
    const url = `http://127.0.0.1:${PORT}/dev/board-shots.html${query.size ? `?${query}` : ""}`;
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => document.body.dataset.boardReady === "1", null, {
      timeout: READY_TIMEOUT_MS,
    });
    // Let the swell and chip materials settle after the first frame.
    await page.waitForTimeout(1500);

    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;

    /** A drag with the given button, in steps: the controls integrate movement. */
    const drag = async (dx, dy, button) => {
      await page.mouse.move(cx, cy);
      await page.mouse.down({ button });
      const steps = 24;
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps);
      }
      await page.mouse.up({ button });
      await page.waitForTimeout(900);
    };

    let turned = 0;
    for (const bearing of BEARINGS) {
      const delta = bearing - turned;
      // OrbitControls: a drag of clientHeight is one full turn.
      if (delta !== 0) await drag((delta / 360) * HEIGHT, 0, "left");
      turned = bearing;
      if (PAN[0] || PAN[1]) await drag(PAN[0], PAN[1], "right");

      let dollied = 0;
      for (const zoom of ZOOMS) {
        for (; dollied < zoom; dollied++) {
          await page.mouse.move(cx, cy);
          await page.mouse.wheel(0, -120);
          await page.waitForTimeout(250);
        }
        await page.waitForTimeout(500);
        for (let phase = 0; phase < PHASES; phase++) {
          if (phase > 0) await page.waitForTimeout(PHASE_MS);
          const parts = [];
          if (LOOK) parts.push(LOOK);
          parts.push(`bearing-${String(bearing).padStart(3, "0")}`);
          if (ZOOMS.length > 1 || zoom !== 0) parts.push(`z${zoom}`);
          if (PHASES > 1) parts.push(`p${phase}`);
          const file = path.join(OUT, `${parts.join("-")}.jpg`);
          await page.screenshot({ path: file, type: "jpeg", quality: 88 });
          console.log(`SHOT ${path.relative(REPO, file)}`);
        }
      }
    }
  } catch (err) {
    failure = err;
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
  if (failure) throw failure;
  console.log(
    `BOARD_SHOT ${BEARINGS.length * ZOOMS.length * PHASES} frames -> ${path.relative(REPO, OUT)}`,
  );
}

main().catch((err) => {
  console.error("board-shot:", err.message);
  process.exit(1);
});
