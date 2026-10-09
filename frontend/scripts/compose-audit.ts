// Audit every recipe-built tile as it ships: the defects `compose/audit.ts`
// counts, per tile and per ground.
//
//     make compose-audit                         # table, exit 1 on any defect
//     node scripts/compose-audit.ts --json FILE  # also write the numbers
//     node scripts/compose-audit.ts --only swamp
//
// `compose.audit.test.ts` holds the same numbers at zero; this is the
// readable form, and what a review page's defect summary is built from.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readModel } from "../src/lib/board3d/compose/io.ts";
import { auditTile, baseProps, counts, type TileAudit } from "../src/lib/board3d/compose/audit.ts";
import type { Parts } from "../src/lib/board3d/compose/recipe.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const args = process.argv.slice(2);
const argOf = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const only = argOf("--only");
const jsonOut = argOf("--json");
const tilesDir = argOf("--tiles") ?? path.join(REPO, "frontend", "public", "models", "tiles");

const parts = JSON.parse(
  await readFile(path.join(REPO, "art", "recipes", "parts.json"), "utf8"),
) as Parts;
const keys = (await readdir(path.join(REPO, "art", "recipes")))
  .filter((f) => f.endsWith(".json") && f !== "parts.json")
  .map((f) => f.slice(0, -5))
  .filter((k) => !only || new RegExp(only).test(k))
  .sort();

const baseCache = new Map<
  string,
  Promise<{ model: Awaited<ReturnType<typeof readModel>>; info: ReturnType<typeof baseProps> }>
>();
const baseOf = (file: string) => {
  let p = baseCache.get(file);
  if (!p) {
    p = readModel(path.join(REPO, file)).then((model) => ({ model, info: baseProps(model) }));
    baseCache.set(file, p);
  }
  return p;
};

const results: Record<string, TileAudit & { ground: string; counts: ReturnType<typeof counts> }> =
  {};
const byGround = new Map<string, Record<string, number>>();
let total = 0;
for (const key of keys) {
  const [, kind, ground] = /^(trade|river)_([a-z]+)_/.exec(key)!;
  const base = await baseOf(parts.grounds[ground].file);
  const model = await readModel(path.join(tilesDir, `${key}.glb`));
  const a = auditTile(model, base.model, base.info);
  const c = counts(a);
  results[key] = { ...a, ground, counts: c };
  const g = `${kind} ${ground}`;
  const row = byGround.get(g) ?? {
    tiles: 0,
    a: 0,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
    f: 0,
    g: 0,
    h: 0,
    bad: 0,
    painted: 0,
    patches: 0,
  };
  row.tiles++;
  for (const k of ["a", "b", "c", "d", "e", "f", "g", "h"] as const) row[k] += c[k];
  row.painted += a.painted.tris;
  row.patches += a.painted.patches.length;
  const n = c.a + c.b + c.c + c.d + c.e + c.f + c.g + c.h;
  if (n) row.bad++;
  total += n;
  byGround.set(g, row);
  const detail = [
    ...a.waterFloat.map((w) =>
      w.kind === "water"
        ? `a:${w.part} edge ${(w.measure * 100).toFixed(0)}cm max ${w.max.toFixed(3)}`
        : w.kind === "level"
          ? `a:${w.part} not level by ${w.measure.toFixed(3)}`
          : `a:${w.part} ${(w.measure * 1e4).toFixed(0)}cm2 max ${w.max.toFixed(3)}`,
    ),
    ...a.pierce.map((p) => `b:${p.part} ${(p.frac * 100).toFixed(1)}% max ${p.max.toFixed(3)}`),
    ...a.orphans.map((o) => `c:${o.part} (${o.why})`),
    ...a.clashes.map((x) => `d:${x.a} in ${x.b}`),
    ...a.hover.map((h) => `e:${h.part} +${h.gap.toFixed(3)}`),
    ...a.overlays.map((o) => `f:${o.part} (${o.why})`),
    ...a.paint.map((p) => `g:${p.kind} ${p.where} (${p.tris})`),
    ...a.border.map((b) => `h:${b.part} ${b.over.toFixed(3)} past the border`),
  ];
  const paint = a.painted.tris
    ? `  painted ${a.painted.tris} in [${a.painted.patches.join(",")}]`
    : "";
  console.log(
    `${key.padEnd(24)} a${c.a} b${c.b} c${c.c} d${c.d} e${c.e} f${c.f} g${c.g} h${c.h}${paint}${detail.length ? "  " + detail.join("; ") : ""}`,
  );
}
console.log(
  "\nground              tiles  a(water) b(pierce) c(orphan) d(clash) e(hover) f(overlay) g(paint) h(border)  painted patches  tiles-with-any",
);
for (const [g, r] of [...byGround].sort()) {
  console.log(
    `${g.padEnd(20)}${String(r.tiles).padStart(5)} ${String(r.a).padStart(9)} ${String(r.b).padStart(9)} ${String(r.c).padStart(9)} ${String(r.d).padStart(8)} ${String(r.e).padStart(8)} ${String(r.f).padStart(10)} ${String(r.g).padStart(8)} ${String(r.h).padStart(9)} ${String(r.painted).padStart(8)} ${String(r.patches).padStart(7)} ${String(r.bad).padStart(15)}`,
  );
}
if (jsonOut) await writeFile(jsonOut, JSON.stringify(results, null, 1));
process.exit(total ? 1 : 0);
