// Measures how long the page's own UI stays unresponsive while the 3D board
// loads: long tasks, a CPU profile mapped through source maps, and the input
// delay of repeated clicks on the account menu button.
//
//     node frontend/dev/perf-probe.mjs [home|lobby|game ...]
//
// Needs a backend with dev auth and a `vite preview` of a `--sourcemap` build.
// PROBE_FE sets the frontend origin (default http://localhost:6767).
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { SourceMapConsumer } from "source-map";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FE = process.env.PROBE_FE ?? "http://localhost:6767";
// The build being served, for its source maps.
const DIST = process.env.PROBE_DIST ?? path.join(FRONTEND, "dist");
const WINDOW_MS = Number(process.env.PROBE_MS ?? 12_000);
const CLICK_EVERY_MS = 150;
// PROBE_CPU=4 slows the CPU 4x; PROBE_NET=10 caps download at 10 Mbit/s with 60ms latency.
const CPU = Number(process.env.PROBE_CPU ?? 1);
const NET = Number(process.env.PROBE_NET ?? 0);

function chromePath() {
  const root = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const exe = "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)) : [];
  dirs.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) if (existsSync(path.join(root, d, exe))) return path.join(root, d, exe);
  return undefined;
}

const INIT = () => {
  const w = window;
  w.__probe = { lt: [], ev: [], menu: [], other: [] };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__probe.lt.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const t = e.target;
        const onBtn = !!(t && t.closest && t.closest('[aria-label="Account menu"]'));
        w.__probe.ev.push({
          name: e.name,
          start: e.startTime,
          delay: e.processingStart - e.startTime,
          dur: e.duration,
          onBtn,
        });
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  } catch {}
  // Clicks on the account button, timestamped at input and at handling.
  document.addEventListener(
    "pointerdown",
    (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('[aria-label="Account menu"]'))
        w.__probe.menu.push({ input: e.timeStamp, handled: performance.now() });
      else {
        const d = (el) => el ? el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.split(/\s+/).slice(0, 4).join(".") : "") : "?";
        w.__probe.other.push({ input: Math.round(e.timeStamp), handled: Math.round(performance.now()), target: d(t), parent: d(t && t.parentElement) });
      }
    },
    true,
  );
};

async function mapProfile(profile) {
  const consumers = new Map();
  async function consumer(url) {
    if (consumers.has(url)) return consumers.get(url);
    let c = null;
    const m = /\/assets\/([^/?#]+\.js)/.exec(url);
    if (m) {
      const f = path.join(DIST, "assets", m[1] + ".map");
      if (existsSync(f)) c = await new SourceMapConsumer(JSON.parse(readFileSync(f, "utf8")));
    }
    consumers.set(url, c);
    return c;
  }
  const label = new Map();
  for (const n of profile.nodes) {
    const cf = n.callFrame;
    let name = cf.functionName || "(anon)";
    let where = cf.url ? cf.url.replace(/^.*\//, "") + ":" + cf.lineNumber : "";
    const c = cf.url ? await consumer(cf.url) : null;
    if (c && cf.lineNumber >= 0) {
      const p = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
      if (p.source) {
        where = p.source.replace(/^.*?(src|node_modules)\//, "$1/") + ":" + p.line;
        if (p.name && name.length <= 2) name = p.name + "?";
      }
    }
    label.set(n.id, `${name} ${where}`);
  }
  return label;
}

function analyse(profile, label, topN = 25) {
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const incl = new Map();
  const via = new Map();
  let t = profile.startTime;
  const busy = []; // contiguous non-idle runs
  let run = null;
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    t += (profile.timeDeltas[i] ?? 0);
    const id = profile.samples[i];
    const n = byId.get(id);
    const fn = n.callFrame.functionName;
    const idle = fn === "(idle)" || fn === "(program)" && false;
    if (fn === "(idle)") {
      if (run) { busy.push(run); run = null; }
      continue;
    }
    if (!run) run = { start: t / 1000, end: t / 1000, self: new Map(), incl: new Map() };
    run.end = t / 1000 + dt;
    const l = label.get(id);
    self.set(l, (self.get(l) ?? 0) + dt);
    // The nearest app frame above, so library time can be blamed on a caller.
    let app = null;
    for (let cur = parent.get(id); cur != null && !app; cur = parent.get(cur)) {
      const lc = label.get(cur);
      if (/ src\//.test(lc)) app = lc;
    }
    const k = l + "  <=  " + (app ?? "-");
    via.set(k, (via.get(k) ?? 0) + dt);
    run.self.set(l, (run.self.get(l) ?? 0) + dt);
    const seen = new Set();
    for (let cur = id; cur != null; cur = parent.get(cur)) {
      const lc = label.get(cur);
      if (seen.has(lc)) continue;
      seen.add(lc);
      incl.set(lc, (incl.get(lc) ?? 0) + dt);
      run.incl.set(lc, (run.incl.get(lc) ?? 0) + dt);
    }
    void idle;
  }
  if (run) busy.push(run);
  const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([l, v]) => `${v.toFixed(0).padStart(6)}ms  ${l}`);
  const t0 = profile.startTime / 1000;
  const long = busy.filter((b) => b.end - b.start > 50);
  return { self: top(self, topN), via: top(via, topN), incl: top(incl, topN), long: long.map((b) => ({ at: b.start - t0, dur: b.end - b.start, self: top(b.self, 6), incl: top(b.incl, 12) })) };
}

async function measure(browser, storageState, url, label, { verbose = true } = {}) {
  const ctx = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  page.on("console", (m) => {
    if (m.text().startsWith("[probe]")) console.log(m.text());
  });
  const cdp = await ctx.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  if (NET) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 60,
      downloadThroughput: (NET * 1024 * 1024) / 8,
      uploadThroughput: (5 * 1024 * 1024) / 8,
    });
  }
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Profiler.start");
  const t0 = Date.now();
  const nav = page.goto(url, { waitUntil: "commit" });
  await nav;
  const btn = page.locator('[aria-label="Account menu"]').filter({ visible: true }).first();
  await btn.waitFor({ state: "visible", timeout: 30_000 });
  const visibleAt = Date.now() - t0;
  const box = await btn.boundingBox();
  const clicks = [];
  while (Date.now() - t0 < WINDOW_MS) {
    const before = Date.now() - t0;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    clicks.push({ sentAt: before, ackAt: Date.now() - t0 });
    await new Promise((r) => setTimeout(r, CLICK_EVERY_MS));
  }
  const { profile } = await cdp.send("Profiler.stop");
  const probe = await page.evaluate(() => ({
    ...window.__probe,
    nav: performance.getEntriesByType("navigation")[0]?.toJSON(),
    gl: (() => {
      const c = document.createElement("canvas").getContext("webgl2");
      const ext = c && c.getExtension("WEBGL_debug_renderer_info");
      return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "?";
    })(),
    canvases: document.querySelectorAll("canvas").length,
  }));
  const res = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((r) => r.transferSize > 50_000 || r.duration > 300)
      .map((r) => ({ n: r.name.replace(/^.*\//, ""), start: Math.round(r.startTime), end: Math.round(r.responseEnd), kb: Math.round(r.transferSize / 1024) })),
  );
  await ctx.close();

  const lt = probe.lt;
  const totalLT = lt.reduce((a, b) => a + b.dur, 0);
  const longest = lt.reduce((a, b) => Math.max(a, b.dur), 0);
  const blocking = lt.reduce((a, b) => a + Math.max(0, b.dur - 50), 0);
  const lastLTEnd = lt.reduce((a, b) => Math.max(a, b.start + b.dur), 0);
  const btnEvents = probe.ev.filter((e) => e.onBtn && e.name === "pointerdown");
  const menuDelays = probe.menu.map((m) => ({ at: Math.round(m.input), delay: Math.round(m.handled - m.input) }));
  const maxDelay = menuDelays.reduce((a, b) => Math.max(a, b.delay), 0);
  // Interactive once every later click on the button is handled within 100ms.
  let tti = null;
  for (let i = menuDelays.length - 1; i >= 0; i--) {
    if (menuDelays[i].delay > 100) break;
    tti = menuDelays[i].at;
  }
  console.log(`\n===== ${label}: ${url}`);
  console.log(`renderer: ${probe.gl}; canvases at end: ${probe.canvases}`);
  console.log(`button visible (node clock): ${visibleAt}ms; clicks sent: ${clicks.length}`);
  console.log(`long tasks: ${lt.length}, total ${totalLT.toFixed(0)}ms, longest ${longest.toFixed(0)}ms, TBT ${blocking.toFixed(0)}ms, last ends at ${lastLTEnd.toFixed(0)}ms`);
  console.log(`long tasks: ${lt.map((l) => `${l.start.toFixed(0)}+${l.dur.toFixed(0)}`).join(" ")}`);
  console.log(`account-button click input delay (page ms -> delay): ${menuDelays.map((d) => `${d.at}:${d.delay}`).join(" ")}`);
  const others = probe.other;
  if (others.length) {
    console.log(`clicks that missed the button: ${others.length}, first at ${others[0].input}, last at ${others[others.length - 1].input}`);
    const kinds = new Map();
    for (const o of others) kinds.set(o.target + " < " + o.parent, (kinds.get(o.target + " < " + o.parent) ?? 0) + 1);
    for (const [k, v] of kinds) console.log(`   ${v}x ${k}`);
  }
  console.log(`max click delay ${maxDelay}ms; button responsive (<=100ms from then on) at ${tti ?? "never"}ms`);
  console.log(`event-timing pointerdown on button: ${btnEvents.map((e) => `${e.start.toFixed(0)}:${e.delay.toFixed(0)}/${e.dur.toFixed(0)}`).join(" ")}`);
  if (verbose) {
    console.log(`big/slow resources:`);
    for (const r of res) console.log(`  ${r.start}-${r.end}ms ${r.kb}kB ${r.n}`);
    const lab = await mapProfile(profile);
    const a = analyse(profile, lab);
    console.log(`-- top self time`);
    for (const l of a.self) console.log("  " + l);
    console.log(`-- top self time by nearest app caller`);
    for (const l of a.via) console.log("  " + l);
    console.log(`-- top inclusive time`);
    for (const l of a.incl) console.log("  " + l);
    console.log(`-- busy runs > 50ms (profile clock)`);
    for (const b of a.long) {
      console.log(`  @${b.at.toFixed(0)}ms for ${b.dur.toFixed(0)}ms`);
      for (const l of b.incl) console.log("     incl " + l);
      for (const l of b.self) console.log("     self " + l);
    }
  }
  return { label, totalLT, longest, blocking, maxDelay, tti, lastLTEnd };
}

async function makeGame(browser, storageState) {
  const ctx = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${FE}/play`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /new table|create/i }).first().click();
  // Still seated at the last table, the abandon guard asks first.
  const leave = page.getByRole("button", { name: /leave .*continue/i }).first();
  for (let i = 0; i < 100 && !/\/lobby/.test(page.url()); i++) {
    if (await leave.isVisible().catch(() => false)) await leave.click().catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.waitForURL(/\/lobby/, { timeout: 30_000 });
  const id = new URL(page.url()).searchParams.get("g");
  await page.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: /add bot/i }).first().click();
    await page.waitForTimeout(500);
  }
  await ctx.close();
  return id;
}

async function startGame(browser, storageState, id) {
  const ctx = await browser.newContext({ storageState });
  const r = await ctx.request.post(`${FE}/api/games/${id}/start`);
  if (!r.ok()) throw new Error(`start: ${r.status()} ${await r.text()}`);
  await ctx.close();
}

const which = process.argv.slice(2).length ? process.argv.slice(2) : ["home", "lobby", "game"];
const runs = Number(process.env.PROBE_RUNS ?? 1);
const browser = await chromium.launch({
  executablePath: chromePath(),
  // PROBE_GL=swiftshader renders on the CPU, a stand-in for a slow GPU driver.
  args: ["--use-gl=angle", "--enable-unsafe-swiftshader", ...(process.env.PROBE_GL ? [`--use-angle=${process.env.PROBE_GL}`] : [])],
});
const login = await browser.newContext();
await (await login.newPage()).goto(`${FE}/auth/dev`, { waitUntil: "load" });
const storageState = await login.storageState();
await login.close();

const results = [];
let gameId = null;
for (const w of which) {
  for (let i = 0; i < runs; i++) {
    const verbose = i === 0;
    if (w === "home") results.push(await measure(browser, storageState, `${FE}/`, "home", { verbose }));
    if (w === "lobby") {
      gameId = await makeGame(browser, storageState);
      results.push(await measure(browser, storageState, `${FE}/lobby?g=${gameId}`, "lobby", { verbose }));
    }
    if (w === "game") {
      if (!gameId) gameId = await makeGame(browser, storageState);
      await startGame(browser, storageState, gameId).catch((e) => console.log(String(e)));
      results.push(await measure(browser, storageState, `${FE}/game?g=${gameId}`, "game", { verbose }));
      gameId = null;
    }
  }
}
console.log("\n===== summary");
for (const r of results)
  console.log(
    `${r.label.padEnd(6)} longTasks=${r.totalLT.toFixed(0)}ms longest=${r.longest.toFixed(0)}ms TBT=${r.blocking.toFixed(0)}ms maxClickDelay=${r.maxDelay}ms buttonResponsiveAt=${r.tti ?? "never"}ms lastLongTaskEnd=${r.lastLTEnd.toFixed(0)}ms`,
  );
await browser.close();
