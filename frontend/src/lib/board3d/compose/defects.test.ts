// Defects found reviewing the composed trade towns, each on a small synthetic
// tile: floating water, ground through paving, orphaned parts, props inside
// each other, and hovering. Each test composes a tile and measures it with
// the same audit (`audit.ts`) that checks the shipped tiles.
import { describe, expect, test } from "vitest";
import { auditTile, baseProps, counts } from "./audit";
import { HeightField } from "./fields";
import { boxOfPrims, type Part, type TileModel } from "./model";
import { bar, baseTile, box, part, pool, shaped, sheet, townLayout, trade, ys } from "./testkit";
import { EVEN_CAP } from "./paint";
import { WATER_MATERIAL } from "./water";

const audit = (model: TileModel, base: TileModel) => auditTile(model, base, baseProps(base));

/** The water sheet's heights. */
const waterYs = (p: Part | undefined) =>
  p
    ? p.prims
        .filter((q) => WATER_MATERIAL.test(q.material))
        .flatMap((q) => [...q.pos].filter((_, i) => i % 3 === 1))
    : [];

/** A flat strip of drape faces over [x0, x1] x [z0, z1] in nx by nz cells. */
function ribbon(x0: number, x1: number, z0: number, z1: number, nx: number, nz: number, y: number) {
  const pos: number[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const ax = x0 + ((x1 - x0) * i) / nx,
        bx = x0 + ((x1 - x0) * (i + 1)) / nx;
      const az = z0 + ((z1 - z0) * j) / nz,
        bz = z0 + ((z1 - z0) * (j + 1)) / nz;
      pos.push(ax, y, az, ax, y, bz, bx, y, az, bx, y, az, ax, y, bz, bx, y, bz);
    }
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  return { material: "Mat_Pave", pos: new Float32Array(pos), nrm };
}

const poolHero = (anchor: [number, number], footprint = 0.4) => ({
  nodes: ["Test_pool"],
  anchor: { file: anchor },
  select_r: null,
  footprint_r: footprint,
  drape: true,
});

describe("water", () => {
  test("a moved pool is set level in a basin carved where it lands, on a slope", () => {
    // Ground rising 8 cm a metre to the west; the pool leaves its own spot
    // (x -1.5) for one 0.3 m further east and 1.6 south.
    const base = shaped(
      baseTile([pool("Test_pool", -1.5, 1.0, 0.3 - 0.08 * 1.5)]),
      (x) => 0.3 - 0.08 * x,
    );
    const { model, log } = trade({
      base,
      ground: {
        heroes: { pool1: poolHero([-1.5, 1.0]) },
        spots: { W: { pool1: { file: [-1.2, -0.6], yaw: 0, scale: 1 } } },
      },
    });
    expect(log.heroes[0].dropped).toBeUndefined();
    const water = waterYs(part(model, "Trade_Test_W_pool"));
    expect(water.length).toBeGreaterThan(0);
    // Level: one water line, not a sheet re-draped over the slope.
    expect(Math.max(...water) - Math.min(...water)).toBeLessThan(1e-4);
    // Contained: no edge of it stands clear of its bank.
    const a = audit(model, base);
    expect(a.waterFloat).toEqual([]);
    // And the water shows: the ground in the middle of it is under the water line.
    const G = new HeightField(part(model, "Trade_Test_W_ground")!.prims);
    expect(G.y(-1.2, -0.6, 9)).toBeLessThan(water[0]);
  });

  test("drops a pool no spot can hold level, with its lily", () => {
    // A 50% grade: carving a level basin there would move the ground far
    // more than MAX_CARVE.
    const lily = {
      name: "Test_lilies",
      prims: [sheet("Mat_Swamp_lily", 0.302, 0.05, 1, -1.5, 1.0)],
    };
    const base = shaped(baseTile([pool("Test_pool", -1.5, 1.0, 0.3), lily]), (x, z) =>
      z < 0 ? 0.3 + 0.5 * (x + 1.2) : 0.3,
    );
    const { model, log } = trade({
      base,
      ground: {
        heroes: { pool1: poolHero([-1.5, 1.0]) },
        spots: { W: { pool1: { file: [-1.2, -0.6], yaw: 0, scale: 1 } } },
      },
    });
    expect(log.heroes[0].dropped).toBe("slope");
    expect(part(model, "Trade_Test_W_pool")).toBeUndefined();
    expect(part(model, "Trade_Test_W_lilies")).toBeUndefined();
    expect(log.dropped.some((d) => d.includes("with its water"))).toBe(true);
  });

  test("a lily pad on a pool that moves goes with it and floats on its water", () => {
    const lily = {
      name: "Test_lilies",
      prims: [sheet("Mat_Swamp_lily", 0.302, 0.05, 1, -1.45, 1.05)],
    };
    const base = baseTile([pool("Test_pool", -1.5, 1.0, 0.3), lily]);
    const { model } = trade({
      base,
      ground: {
        heroes: { pool1: poolHero([-1.5, 1.0]) },
        spots: { W: { pool1: { file: [-1.2, -0.6], yaw: 0, scale: 1 } } },
      },
    });
    const l = part(model, "Trade_Test_W_lilies")!;
    const b = boxOfPrims(l.prims);
    expect((b[0] + b[3]) / 2).toBeCloseTo(-1.15, 3);
    expect((b[2] + b[5]) / 2).toBeCloseTo(-0.55, 3);
    const W = new HeightField(
      part(model, "Trade_Test_W_pool")!.prims.filter((q) => WATER_MATERIAL.test(q.material)),
    );
    const w = W.sample(-1.15, -0.55)!;
    expect(w).toBeTruthy();
    expect(b[1] - w.y).toBeGreaterThanOrEqual(-0.001);
    expect(b[1] - w.y).toBeLessThan(0.01);
    expect(counts(audit(model, base))).toEqual({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0 });
  });

  test("a pool the town reaches is dropped whole, never clipped open", () => {
    // Across the paving strip (z 0.5..0.7): a CLIP node, which a dune would
    // be cut for; a pool is a body of water and goes whole.
    const base = baseTile([pool("Test_pool", 1.3, 0.95, 0.3)]);
    const { model, log } = trade({
      base,
      ground: { heroes: {}, spots: {}, keep: { clip_nodes: ["Test_pool"] } },
    });
    expect(part(model, "Trade_Test_W_pool")).toBeUndefined();
    expect(log.clipped).toEqual([]);
    expect(log.dropped).toContain("Test_pool@1.3,0.9");
  });

  test("a punt whose water is gone is moored on the nearest pool's water", () => {
    const punt = {
      name: "Test_punt",
      prims: [bar("Mat_T_prop", -1.6, -1.4, 0.95, 1.05, 0.04, 0.3)],
    };
    const base = baseTile([pool("Test_pool", -1.5, 1.0, 0.3), punt]);
    const { model, log } = trade({
      base,
      ground: {
        heroes: {
          pool1: poolHero([-1.5, 1.0]),
          punt: {
            nodes: ["Test_punt"],
            anchor: { file: [-1.5, 1.0] },
            select_r: null,
            footprint_r: 0.12,
          },
        },
        spots: {
          W: {
            pool1: { file: [-1.2, -0.6], yaw: 0, scale: 1 },
            punt: { file: [-1.5, 1.0], yaw: 0, scale: 1, stays: true },
          },
        },
      },
    });
    expect(log.moored.length).toBe(1);
    const b = boxOfPrims(part(model, "Trade_Test_W_punt")!.prims);
    const W = new HeightField(
      part(model, "Trade_Test_W_pool")!.prims.filter((q) => WATER_MATERIAL.test(q.material)),
    );
    const w = W.sample((b[0] + b[3]) / 2, (b[2] + b[5]) / 2);
    expect(w).toBeTruthy();
    expect(Math.abs(b[1] - w!.y)).toBeLessThan(0.01);
  });
});

describe("paving", () => {
  test("paints paving on bumpy ground as a flat plaza and level road", () => {
    // Tussocks: 8 cm bumps under the plaza and the strip, and a strip long
    // enough to have a grade (x 1.1..1.4, z 0.95..2.1, 0.3 wide).
    const bumps = (x: number, z: number) => 0.3 + 0.08 * Math.sin(7 * x) * Math.cos(7 * z);
    const base = shaped(baseTile(), bumps);
    // (the plaza out of reach of the chip's ramp, which would tilt it)
    const plaza = { name: "Town_W_plaza", prims: [sheet("Mat_Pave", 0.256, 0.25, 6, 1.9, 0.5)] };
    // A spoke running out past the town's bed (which flattens the ground
    // under the town itself), 0.3 wide in 15 cm segments, over the bumps.
    const strip: Part = {
      name: "Town_W_paving_02",
      prims: [ribbon(1.1, 1.4, 0.95, 2.1, 2, 8, 0.254)],
    };
    const { model, log } = trade({ base, layout: townLayout([plaza, strip]), offset: 0 });
    const a = audit(model, base);
    // No sheet over the ground, nothing through it, nothing floating, and
    // the paint in whole patches with no holes.
    expect(a.overlays).toEqual([]);
    expect(a.pierce).toEqual([]);
    expect(a.waterFloat).toEqual([]);
    expect(a.paint).toEqual([]);
    expect(log.painted.plaza).toBeGreaterThan(0);
    expect(log.painted.spoke).toBeGreaterThan(0);
    const g = part(model, "Trade_Test_W_ground")!;
    const G = new HeightField(g.prims);
    // The plaza is its plane, not every bump: its points within the
    // evening's cap of its middle's.
    const mid = G.y(1.95, 0.45, 0);
    const stone = g.prims.filter((p) => /^Mat_Castle_stone/.test(p.material));
    for (const p of stone)
      for (let i = 0; i < p.pos.length; i += 3) {
        if (Math.hypot(p.pos[i] - 1.9, p.pos[i + 2] - 0.5) > 0.3) continue;
        expect(Math.abs(p.pos[i + 1] - mid)).toBeLessThanOrEqual(EVEN_CAP + 1e-4);
      }
    // The road is level across: at any station, its two edges within the
    // evening's reach of each other, over a ground that swings 16 cm.
    for (let z = 1.2; z <= 1.9; z += 0.1) {
      const l = G.y(1.08, z, 0),
        r = G.y(1.32, z, 0);
      expect(Math.abs(l - r)).toBeLessThanOrEqual(2 * EVEN_CAP + 0.005);
      expect(["Mat_Pave", "Mat_Castle_stone"]).toContain(G.sample(1.2, z)!.material);
    }
  });
});

describe("orphans and seating", () => {
  test("a tuft goes whole: the blade the town lands on takes its neighbour", () => {
    // Blade A reaches onto the paving (x 1.2..1.4); blade B lies 2 cm
    // beyond A's far end, 0.4 from the paving, and would survive alone.
    const tuft = {
      name: "Test_sedge",
      prims: [
        bar("Mat_T_prop", 1.35, 1.75, 0.6, 0.62, 0.2, 0.3),
        bar("Mat_T_prop", 1.77, 1.8, 0.6, 0.62, 0.2, 0.3),
      ],
    };
    const base = baseTile([tuft]);
    const { model, log } = trade({ base });
    expect(model.parts.filter((p) => p.name.startsWith("Trade_Test_W_sedge"))).toEqual([]);
    expect(log.dropped.some((d) => d.includes("with its group"))).toBe(true);
  });

  test("seats buildings and moved heroes on sloped ground", () => {
    // Authored on the flat at x -1.5; sent west onto ground rising 12 cm a
    // metre past x -1.8.
    const kiln = { name: "Test_kiln", prims: [box("Mat_T_prop", -1.5, 0.8, 0.3, 0.6, 0.3)] };
    const base = shaped(baseTile([kiln]), (x) => 0.3 + 0.12 * Math.max(0, -x - 1.8));
    const { model } = trade({
      base,
      ground: {
        heroes: {
          kiln: {
            nodes: ["Test_kiln"],
            anchor: { file: [-1.5, 0.8] },
            select_r: null,
            footprint_r: 0.25,
          },
        },
        spots: { W: { kiln: { file: [-2.0, -0.4], yaw: 0, scale: 1 } } },
      },
    });
    const a = audit(model, base);
    expect(a.hover).toEqual([]);
    expect(a.orphans).toEqual([]);
    // Its downhill foot is on the ground, not in it and not over it.
    const G = new HeightField(part(model, "Trade_Test_W_ground")!.prims);
    const k = part(model, "Trade_Test_W_kiln")!;
    const b = boxOfPrims(k.prims);
    expect(b[1] - G.y(b[3], (b[2] + b[5]) / 2, 9)).toBeCloseTo(0, 2);
    // And the house on the town's pad stands on it.
    const h = boxOfPrims(part(model, "Trade_Test_W_town_house_01")!.prims);
    expect(h[1] - G.y(1.3, 0, 9)).toBeCloseTo(0, 3);
  });

  test("a hero sent into an earlier one steps out of it", () => {
    const barn = { name: "Test_barn", prims: [box("Mat_T_prop", -1.5, 0.8, 0.5, 0.5, 0.3)] };
    const sheep = { name: "Test_sheep", prims: [box("Mat_T_prop", -1.8, -0.4, 0.15, 0.15, 0.3)] };
    const base = baseTile([barn, sheep]);
    const { model, log } = trade({
      base,
      ground: {
        heroes: {
          barn: {
            nodes: ["Test_barn"],
            anchor: { file: [-1.5, 0.8] },
            select_r: null,
            footprint_r: 0.35,
          },
          sheep: {
            nodes: ["Test_sheep"],
            anchor: { file: [-1.8, -0.4] },
            select_r: null,
            footprint_r: 0.1,
          },
        },
        spots: {
          W: {
            barn: { file: [-1.5, 0.8], yaw: 0, scale: 1, stays: true },
            sheep: { file: [-1.6, 0.9], yaw: 0, scale: 1 },
          },
        },
      },
    });
    const s = log.heroes.find((h) => h.hero === "sheep")!;
    expect(s.pushed).toBeGreaterThan(0);
    expect(s.collides).toBeUndefined();
    expect(audit(model, base).clashes).toEqual([]);
  });
});

describe("the pond", () => {
  const pondHero = {
    nodes: ["Test_pond"],
    anchor: { file: [1.3, 0.3] as [number, number] },
    select_r: null,
    footprint_r: 0.4,
    ground_bound: true,
  };
  const pond = { name: "Test_pond", prims: [sheet("Mat_Swamp_pool", 0.29, 0.25, 4, 1.3, 0.3)] };
  const ground = {
    heroes: { pond: pondHero },
    spots: { W: { pond: { file: [1.3, 0.3] as [number, number], yaw: 0, scale: 1, stays: true } } },
    keep: { clip_paving_over: ["pond"] },
  };

  test("a house in its water gives way, and its pad with it", () => {
    const { model, log } = trade({ base: baseTile([pond]), ground });
    expect(log.culled).toEqual(["Town_W_house_01 (gave way to the pond)"]);
    expect(part(model, "Trade_Test_W_town_house_01")).toBeUndefined();
    expect(part(model, "Trade_Test_W_pond")).toBeDefined();
  });

  test("a pond that would take more than two buildings gives way instead", () => {
    const hut = (n: number, x: number): Part => ({
      name: `Town_W_house_0${n}`,
      prims: [box("Mat_Town", x, 0.45, 0.12, 0.3, 0.25)],
      origin: [x, 0.25, 0.45],
    });
    const { model, log } = trade({
      base: baseTile([pond]),
      layout: townLayout([hut(2, 1.15), hut(3, 1.45)]),
      ground,
    });
    // house_01 at (1.3, 0) reaches the water too: three buildings
    expect(log.culled.some((c) => c.startsWith("pond (gave way to the town"))).toBe(true);
    expect(part(model, "Trade_Test_W_pond")).toBeUndefined();
    for (const n of [1, 2, 3]) expect(part(model, `Trade_Test_W_town_house_0${n}`)).toBeDefined();
  });

  test("drops a pond that would take the hall and fills its basin", () => {
    const hall = {
      name: "Town_W_hall",
      prims: [box("Mat_Town", 1.3, 0.45, 0.3, 0.6, 0.25)],
      origin: [1.3, 0.25, 0.45] as [number, number, number],
    };
    const { model, log } = trade({ base: baseTile([pond]), layout: townLayout([hall]), ground });
    expect(log.culled.some((c) => c.startsWith("pond (gave way to the town"))).toBe(true);
    expect(part(model, "Trade_Test_W_pond")).toBeUndefined();
    expect(part(model, "Trade_Test_W_town_hall")).toBeDefined();
    expect(part(model, "Trade_Test_W_town_house_01")).toBeDefined();
  });
});

describe("dunes", () => {
  test("melts a dune the town covers without cutting it open", () => {
    const dune = { name: "Test_ripples", prims: [sheet("Mat_T_prop", 0.34, 0.6, 12, 0.9, 0)] };
    const base = baseTile([dune]);
    const { model, log } = trade({
      base,
      ground: { heroes: {}, spots: {}, keep: { clip_nodes: ["Test_ripples"] } },
    });
    expect(log.clipped).toEqual(["Test_ripples@0.9,0.0"]);
    const d = part(model, "Trade_Test_W_ripples")!;
    const G = new HeightField(part(model, "Trade_Test_W_ground")!.prims);
    // On the paving strip the dune is under the ground.
    for (const p of d.prims)
      for (let i = 0; i < p.pos.length; i += 3)
        if (Math.abs(p.pos[i] - 1.3) < 0.1 && Math.abs(p.pos[i + 2] - 0.6) < 0.1)
          expect(p.pos[i + 1]).toBeLessThan(G.y(p.pos[i], p.pos[i + 2], 9));
    expect(audit(model, base).orphans).toEqual([]);
    expect(ys(d).length).toBeGreaterThan(0);
  });
});
