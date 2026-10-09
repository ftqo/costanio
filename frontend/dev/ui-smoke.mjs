// Create a table for a ruleset through the UI, start it, and photograph it.
//
//     make ui-smoke                       # the default list
//     UI_SMOKE_RULESETS=explorers node frontend/dev/ui-smoke.mjs
//
// Through the UI rather than the API because the lobby creates every table as
// `base` with a map inlined and patches the ruleset afterwards; only the real
// flow exercises that path, and other checks never click a switch or draw a
// board.
//
// `./dev.sh` must already be up (FE 6767, BE 6769). Exits non-zero on a browser
// console error, a refused toggle, or a ruleset the server did not settle on.
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = new Map(readFileSync(path.join(FRONTEND, "../engine/ruletest/testdata/target_vp.txt"), "utf8").trim().split("\n").map(line => {
  const [ruleset, target] = line.split(/\s+/);
  return [ruleset, Number(target)];
}));
const OUT = process.env.UI_SMOKE_OUT ?? path.join(FRONTEND, "..", ".ui-smoke");
const FE = process.env.UI_SMOKE_FE ?? "http://localhost:6767";
const PLAY_MS = Number(process.env.UI_SMOKE_PLAY_MS ?? 12_000);

// One per shelf: the two established expansions, each beta scenario, the
// standalone, and its one pairing. Not every valid ruleset: this runs a browser
// per table, and the full sweep lives in Go (sim.TestEveryRulesetFinishes,
// lobby.TestEveryValidRulesetCanBeStarted).
const DEFAULT_RULESETS = [
  "base",
  "base+cak",
  "base+islands",
  "base+fishermen",
  "base+caravans",
  "base+harbormaster",
  "base+rivers",
  "base+raiders",
  "base+cak+islands+raiders",
  "base+wagons",
  "explorers",
  "cak+explorers",
];

/** Module name -> the picker key the shelf tags its card with. */
const PICKER_KEY = {
  cak: "cak",
  islands: "islands",
  fishermen: "fishermen",
  caravans: "caravans",
  harbormaster: "harbormaster",
  rivers: "rivers",
  raiders: "raiders",
  wagons: "wagons",
  explorers: "explorers",
};

const modulesOf = (rs) => rs.split("+").filter((p) => p && p !== "base");

async function smoke(page, ruleset, errors) {
  console.log(`\n== ${ruleset}`);
  await page.goto(`${FE}/play`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: /new table|create/i })
    .first()
    .click();
  // The dev user is still seated at the previous ruleset's table, so the
  // abandon guard asks before making another. Answer it, as a host would.
  const leave = page.getByRole("button", { name: /leave .*continue/i }).first();
  if (await leave.isVisible().catch(() => false)) {
    await leave.click();
  }
  await page.waitForURL(/\/lobby/, { timeout: 20_000 });
  await page.waitForTimeout(1_200);


  // Explorers first when present: it is a standalone, and turning it on greys
  // out every switch but its companion.
  const mods = modulesOf(ruleset).sort((a, b) => (a === "explorers" ? -1 : b === "explorers" ? 1 : 0));
  for (const m of mods) {
    // Choosing an Islands map remounts the shelf and closes its scenarios.
    const scenarios = page.locator("[data-scenarios-toggle]");
    if (await scenarios.isVisible().catch(() => false)) {
      if ((await scenarios.getAttribute("aria-expanded")) !== "true") await scenarios.click();
      await page.waitForTimeout(300);
    }

    const sw = page.locator(`[data-expansion="${PICKER_KEY[m]}"] button`).first();
    if (await sw.isDisabled()) throw new Error(`${ruleset}: the ${m} switch is greyed out`);
    await sw.click();
    await page.waitForTimeout(900);
    // Islands on a sea-less map opens a map chooser ("Islands needs open
    // sea...") rather than applying; choose a map, as a host would.
    const chooser = page.getByText(/needs open sea/i).first();
    if (await chooser.isVisible().catch(() => false)) {
      const maps = page.locator("[data-gallery-map]");
      const n = await maps.count();
      if (n === 0) throw new Error(`${ruleset}: the map chooser opened and offered nothing`);
      await maps.first().click();
      await page.waitForTimeout(1_200);
    }
  }

  const settled = await page.evaluate(async () => {
    const id = new URLSearchParams(location.search).get("g");
    const j = await (await fetch(`/api/games/${id}`, { credentials: "include" })).json();
    return { id, ruleset: j.game?.config?.ruleset, target: j.game?.config?.target_vp };
  });
  // Canonical spelling: "base" only when there are no modules, and modules sorted.
  const want = mods.length ? (ruleset.startsWith("base") ? ruleset : mods.slice().sort().join("+")) : "base";
  if (settled.ruleset !== want) {
    throw new Error(`${ruleset}: server settled on ${JSON.stringify(settled)}`);
  }
  if (settled.target !== TARGETS.get(want)) {
    throw new Error(`${ruleset}: target ${settled.target}, engine default ${TARGETS.get(want)}`);
  }
  console.log(`   ruleset=${settled.ruleset} target=${settled.target}`);

  for (let i = 0; i < 3; i++) {
    const add = page
      .getByRole("button", { name: /add bot|bot/i })
      .first();
    if (await add.isVisible().catch(() => false)) {
      await add.click();
      await page.waitForTimeout(500);
    }
  }
  await page
    .getByRole("button", { name: /^start/i })
    .first()
    .click();
  await page.waitForURL(/\/game/, { timeout: 30_000 });
  await page.waitForTimeout(PLAY_MS);
  const file = path.join(OUT, `${ruleset.replace(/\+/g, "_")}.png`);
  await page.screenshot({ path: file });
  console.log(`   shot ${path.basename(file)}  errors so far: ${errors.length}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const rulesets = (process.env.UI_SMOKE_RULESETS ?? DEFAULT_RULESETS.join(",")).split(",");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  await page.goto(`${FE}/auth/dev`, { waitUntil: "domcontentloaded" });

  const failed = [];
  for (const rs of rulesets) {
    try {
      await smoke(page, rs.trim(), errors);
    } catch (e) {
      console.log(`   FAILED: ${e.message}`);
      failed.push(`${rs}: ${e.message}`);
    }
  }
  await browser.close();

  console.log("\n---");
  if (failed.length) {
    console.log(`${failed.length} ruleset(s) failed:`);
    for (const f of failed) console.log(`  ${f}`);
  }
  if (errors.length) {
    console.log(`${errors.length} browser error(s):`);
    for (const e of [...new Set(errors)].slice(0, 20)) console.log(`  ${e}`);
  }
  if (failed.length || errors.length) process.exitCode = 1;
  else console.log("all rulesets created, started and rendered with no browser errors.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
