// Photograph every recipe-built tile beside the tile it is built on, in the
// game's own renderer, at close and at game zoom, and lay each ground's set
// out as one review sheet.
//
//     make compose-review                       # serves, shoots, writes sheets
//     node dev/compose-review.mjs --url http://127.0.0.1:7281 --out DIR [--only hills] [--log compose-log.json]
//
// One board per ground. The base tile sits at the centre and each seaward
// direction's variant sits on the ring-2 corner hex that points that way, so
// every town faces the sea it was composed for, with the board's real coast,
// gutter and neighbours round it.
//
// Game zoom is the audit's game camera: 79.7 from the target at 56 degrees of
// elevation, 32 degrees of vertical field of view, cropped to the hex.
//
// Needs playwright-core's bundled Chromium; the page is
// dev/compose-review.html, served by Vite from frontend/.
import { chromium } from "playwright-core";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const args = process.argv.slice(2);
const argOf = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const URL_BASE = argOf("--url", "http://127.0.0.1:7281");
const OUT = path.resolve(argOf("--out", path.join(REPO, ".compose-review")));
const ONLY = argOf("--only", null);
const LOG = argOf("--log", null);
const log = LOG && existsSync(LOG) ? JSON.parse(await readFile(LOG, "utf8")) : {};

const DIRS = { e: [1, 0], se: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [0, -1], ne: [1, -1] };
const ORDER = ["e", "se", "sw", "w", "nw", "ne"];

const recipesDir = path.join(REPO, "art", "recipes");
const parts = JSON.parse(await readFile(path.join(recipesDir, "parts.json"), "utf8"));
const recipes = [];
for (const f of (await readdir(recipesDir)).sort()) {
  if (!f.endsWith(".json") || f === "parts.json") continue;
  const key = f.slice(0, -5);
  const [kind, ground, ...rest] = key.split("_");
  recipes.push({ key, kind, ground, variant: rest.join("_") });
}
// --only filters by KEY (`trade_hills`, `river_forest_e_w`, `hills`).
const want = (key) => !ONLY || new RegExp(ONLY).test(key);
const grounds = [...new Set(recipes.filter((r) => r.kind === "trade" && want(r.key)).map((r) => r.ground))];

function chromePath() {
  const root = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const dirs = readdirSync(root).filter((d) => d.startsWith("chromium-")).sort();
  for (const d of dirs.reverse()) {
    const exe = path.join(root, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (existsSync(exe)) return exe;
  }
  throw new Error("no playwright Chromium under " + root);
}

await mkdir(path.join(OUT, "shots"), { recursive: true });
const browser = await chromium.launch({ executablePath: chromePath(), args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGEERR", e.message));
page.on("console", (m) => m.type() === "error" && console.log("ERR", m.text().slice(0, 300)));

/** Load one board with `slots` repainted, and shoot each slot at both zooms. */
async function shoot(tag, slots) {
  const tiles = Object.fromEntries(slots.map((s) => [s.hex.join(","), s.res]));
  await page.goto(`${URL_BASE}/dev/compose-review.html?tiles=${encodeURIComponent(JSON.stringify(tiles))}`);
  await page.waitForSelector("body[data-board-ready='1']", { timeout: 180000 });
  await page.addStyleTag({ content: "button,[role=button]{display:none!important}" });
  await page.mouse.move(1279, 799);
  await page.waitForTimeout(1500);
  const out = [];
  for (const s of slots) {
    const w = await page.evaluate(([q, r]) => window.COMPOSE.hexToWorld(q, r), s.hex);
    const stem = path.join(OUT, "shots", `${tag}__${s.res}`);
    await page.evaluate(([t]) => { window.COMPOSE.pose([t[0], 0.4, t[2]], 11, 42, 28, 32); window.COMPOSE.draw(); }, [w]);
    await page.waitForTimeout(250);
    await page.evaluate(() => window.COMPOSE.draw());
    await page.screenshot({ path: `${stem}__close.jpg`, type: "jpeg", quality: 85, clip: { x: 240, y: 100, width: 800, height: 600 } });
    await page.evaluate(([t]) => { window.COMPOSE.setCamera([t[0], 66.0856, t[2] + 44.5753], [t[0], 0, t[2]], 32); window.COMPOSE.draw(); }, [w]);
    await page.waitForTimeout(250);
    const [sx, sy] = await page.evaluate(([t]) => { window.COMPOSE.draw(); return window.COMPOSE.project(t); }, [w]);
    const GW = 360, GH = 240;
    const cx = Math.round(Math.min(Math.max(sx - GW / 2, 0), 1280 - GW)), cy = Math.round(Math.min(Math.max(sy - GH / 2, 0), 800 - GH));
    await page.screenshot({ path: `${stem}__game.jpg`, type: "jpeg", quality: 90, clip: { x: cx, y: cy, width: GW, height: GH } });
    out.push({ label: s.label, note: noteFor(s.key), close: `${stem}__close.jpg`, game: `${stem}__game.jpg` });
    console.log("  ", tag, s.label);
  }
  return out;
}

function noteFor(key) {
  const l = key && log[key];
  if (!l) return "";
  return `kept ${l.kept}, dropped ${l.dropped.length}` +
    (l.heroes?.length ? `, heroes ${l.heroes.map((h) => `${h.hero}${h.stays ? "" : " moved"}${h.collides ? ` (COLLIDES: ${h.collides})` : ""}`).join(", ")}` : "") +
    (l.culled?.length ? `, culled ${l.culled.length}` : "");
}

const cells = {}; // ground -> [{label, close, game}]
for (const ground of grounds) {
  const baseRes = path.basename(parts.grounds[ground].file, ".glb");
  const slots = [{ label: `${ground}: shipped tile`, res: baseRes, hex: [0, 0], key: null }];
  for (const d of ORDER) {
    const r = recipes.find((x) => x.key === `trade_${ground}_${d}` && want(x.key));
    if (r) slots.push({ label: r.key, res: r.key, hex: [2 * DIRS[d][0], 2 * DIRS[d][1]], key: r.key });
  }
  if (slots.length > 1) cells[ground] = await shoot(`trade_${ground}`, slots);
}

// Rivers: every composed channel beside the hand-made pasture tile of the same
// shape, which it is built from.
const rivers = recipes.filter((r) => r.kind === "river" && want(r.key));
const riverGrounds = [...new Set(rivers.map((r) => r.ground))];
const riverShapes = [...new Set(rivers.map((r) => r.variant))];
const riverRows = {}; // shape -> cells
for (const shape of riverShapes) {
  if (!riverGrounds.length) break;
  const slots = [{ label: `river_pasture_${shape} (hand-made)`, res: `river_pasture_${shape}`, hex: [0, 0], key: null }];
  riverGrounds.forEach((g, i) => {
    const key = `river_${g}_${shape}`;
    if (rivers.some((r) => r.key === key)) slots.push({ label: key, res: key, hex: [2 * DIRS[ORDER[i * 3]][0], 2 * DIRS[ORDER[i * 3]][1]], key });
  });
  riverRows[shape] = await shoot(`river_${shape}`, slots);
}
await page.close();

const b64 = async (f) => (await readFile(f)).toString("base64");
async function sheet(file, title, columns, rows) {
  const p = await browser.newPage({ viewport: { width: 8 + columns.length * 308, height: 400 } });
  const html = [];
  for (const row of rows) {
    for (const c of row) {
      html.push(c.img
        ? `<div class="c"><img src="data:image/jpeg;base64,${await b64(c.img)}"><div class="l">${c.label ?? ""}</div><div class="n">${c.note ?? ""}</div></div>`
        : `<div class="c"></div>`);
    }
  }
  await p.setContent(`<html><body style="margin:0;background:#1b1f26;color:#e8e8e8;font:12px -apple-system,Helvetica,sans-serif">
    <div style="padding:8px 8px 0;font-size:15px;font-weight:600">${title}</div>
    <div style="display:grid;grid-template-columns:repeat(${columns.length},300px);gap:8px;padding:8px">${html.join("")}</div>
    <style>.c img{display:block;width:300px;border-radius:3px}.l{padding:3px 2px 0;color:#e8e8e8;font-weight:600}.n{padding:0 2px;color:#aab1bb;font-size:11px}</style></body></html>`);
  await p.waitForTimeout(200);
  await p.screenshot({ path: file, type: "jpeg", quality: 84, fullPage: true });
  await p.close();
  console.log(file);
}

for (const g of Object.keys(cells)) {
  const cs = cells[g];
  await sheet(path.join(OUT, `sheet_trade_${g}.jpg`),
    `Trade towns on ${g}: the shipped tile, then each seaward direction (E, SE, SW, W, NW, NE), each on the corner hex that faces that way. Top: close. Bottom: game zoom.`,
    cs, [cs.map((c) => ({ img: c.close, label: c.label, note: c.note })), cs.map((c) => ({ img: c.game, label: c.label }))]);
}
const tg = Object.keys(cells);
if (tg.length > 1) {
  await sheet(path.join(OUT, "sheet_trade_all_game.jpg"),
    "Every composed trade town at game zoom, one row per ground: the shipped tile, then E, SE, SW, W, NW, NE.",
    cells[tg[0]], tg.map((g) => cells[g].map((c) => ({ img: c.game, label: c.label }))));
}
const rs = Object.keys(riverRows);
if (rs.length) {
  const cols = riverRows[rs[0]];
  await sheet(path.join(OUT, "sheet_river_close.jpg"),
    "Composed rivers, close: the hand-made pasture channel of each shape, then the same channel composed into each ground.",
    cols, rs.map((s) => riverRows[s].map((c) => ({ img: c.close, label: c.label, note: c.note }))));
  await sheet(path.join(OUT, "sheet_river_game.jpg"),
    "Composed rivers at game zoom: the hand-made pasture channel of each shape, then the same channel composed into each ground.",
    cols, rs.map((s) => riverRows[s].map((c) => ({ img: c.game, label: c.label }))));
}
await writeFile(path.join(OUT, "index.json"), JSON.stringify({ trade: cells, river: riverRows }, null, 1));
await browser.close();
