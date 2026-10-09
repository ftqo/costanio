// Every recipe-built tile as it ships (the compressed `.glb` under
// public/models/tiles), audited against its base tile: no floating water, no
// ground through anything, no orphaned parts, no prop inside another, nothing
// hovering, no sheet over the ground, and paint in whole patches with no
// specks or holes. `make compose-audit` prints the same numbers per tile and
// per ground.
//
// No exceptions: the paving is the ground's own triangles (paint.ts), so there
// are no drapes left to float.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { auditTile, baseProps, type BaseProps } from "./audit";
import { readModel } from "./io";
import type { TileModel } from "./model";
import type { Parts } from "./recipe";

const REPO = path.resolve(__dirname, "../../../../..");
const TILES = path.join(REPO, "frontend", "public", "models", "tiles");
const parts = JSON.parse(
  readFileSync(path.join(REPO, "art", "recipes", "parts.json"), "utf8"),
) as Parts;
const keys = readdirSync(path.join(REPO, "art", "recipes"))
  .filter((f) => f.endsWith(".json") && f !== "parts.json")
  .map((f) => f.slice(0, -5))
  .sort();

const bases = new Map<string, Promise<{ model: TileModel; info: BaseProps }>>();
function baseOf(file: string) {
  let b = bases.get(file);
  if (!b) {
    b = readModel(path.join(REPO, file)).then((model) => ({ model, info: baseProps(model) }));
    bases.set(file, b);
  }
  return b;
}

describe("every composed tile, as it ships", () => {
  test("ships 48 trade towns and 20 rivers", () => {
    expect(keys.filter((k) => k.startsWith("trade_"))).toHaveLength(48);
    expect(keys.filter((k) => k.startsWith("river_"))).toHaveLength(20);
  });

  test.each(keys)("%s", async (key) => {
    const ground = /^(?:trade|river)_([a-z]+)_/.exec(key)![1];
    const base = await baseOf(parts.grounds[ground].file);
    const a = auditTile(await readModel(path.join(TILES, `${key}.glb`)), base.model, base.info);
    // None of any of them.
    expect(a.waterFloat, "floating water or paving").toEqual([]);
    expect(a.pierce, "ground through the paving").toEqual([]);
    expect(a.orphans, "orphaned or sunk parts").toEqual([]);
    expect(a.clashes, "props inside props").toEqual([]);
    expect(a.hover, "hovering parts").toEqual([]);
    expect(a.overlays, "a sheet laid over the ground").toEqual([]);
    expect(a.paint, "specks, pinholes, props on the paint").toEqual([]);
    if (key.startsWith("trade_")) {
      // A town paints its ground, in whole patches, and sets kerb stones.
      expect(a.painted.tris).toBeGreaterThan(key.startsWith("trade_lake_") ? 20 : 150);
      expect(Math.min(...a.painted.patches)).toBeGreaterThanOrEqual(3);
      const model = await readModel(path.join(TILES, `${key}.glb`));
      expect(model.parts.some((p) => /_town_kerb_\d\d$/.test(p.name))).toBe(true);
    }
  });
});
