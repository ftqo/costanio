// The composer's rules, on geometry small enough to reason about by hand.
//
// Every tile here is synthetic: a flat ground sheet, a slab, a rim, and box
// props as needed. These test the rules (a prop the town lands on goes, a kept
// one never floats, nothing stands in the chip's disc, a mirrored layout is
// not inside out, the same inputs write the same bytes), not shipped art;
// `make compose-tiles --check`, the hex contract and the review sheets cover
// the art.
import { describe, expect, test } from "vitest";
import { BORDER_APOTHEM, KeepOut, HeightField, clustersOf, hexApothem } from "./fields";
import { BORDER_CLEAR, keepInside, placedPoints, stay } from "./place";
import {
  faceNormal,
  mirrorPrimsX,
  rotatePrimsY,
  boxOfPrims,
  type Part,
  type Prim,
  type TileModel,
} from "./model";
import {
  placeBearing,
  fileBearing,
  parseRecipe,
  partRole,
  terrainForKey,
  type Parts,
  type SpotsFile,
  type Direction,
} from "./recipe";
import { placeLayout, CHIP_CLAMP_Y, CHIP_KEEP, CHIP_XZ, TRI_BUDGET } from "./trade";
import { MARGIN_TOP, composeRiver, rimMaterialMap } from "./river";
import { modelToGlb } from "./io";

import { sheet, box, baseTile, townLayout, trade, part, shaped, ys } from "./testkit";

// ------------------------------------------------------------- keep-out --

describe("the keep-out field", () => {
  const square = sheet("m", 0, 0.5, 4);
  const k = new KeepOut().add([square]).finish((x) => x);

  test("is zero on the footprint and grows with distance off it", () => {
    expect(k.at(0, 0)).toBe(0);
    expect(k.at(0.45, 0.45)).toBe(0);
    // 1.0 from the square's edge along an axis, good to the chamfer's 4%.
    expect(k.at(1.5, 0)).toBeGreaterThan(0.95);
    expect(k.at(1.5, 0)).toBeLessThan(1.06);
    expect(k.at(-2, 0)).toBeGreaterThan(k.at(-1, 0));
  });

  test("carries the nearest covered cell's value outward", () => {
    // value = x: to the east of the square the nearest cell is its east edge.
    expect(k.nearestValue(2, 0)).toBeCloseTo(0.49, 1);
    expect(k.nearestValue(-2, 0)).toBeCloseTo(-0.49, 1);
  });

  test("an empty field is far everywhere", () => {
    expect(new KeepOut().finish().at(0, 0)).toBeGreaterThan(10);
  });
});

describe("loose parts", () => {
  test("split a node into its separate bodies and merge the ones that touch", () => {
    const a = box("m", -1, 0, 0.2, 0.2, 0.3),
      b = box("m", 1, 0, 0.2, 0.2, 0.3);
    const roof = box("m", 1, 0, 0.2, 0.1, 0.5); // sits on b
    const cs = clustersOf("Test_sheep", [
      {
        material: "m",
        pos: new Float32Array([...a.pos, ...b.pos, ...roof.pos]),
        nrm: new Float32Array([...a.nrm, ...b.nrm, ...roof.nrm]),
      },
    ]);
    expect(cs.map((c) => c.id).sort()).toEqual(["Test_sheep@-1.0,0.0", "Test_sheep@1.0,0.0"]);
  });
});

// ---------------------------------------------------- props and reseating --

describe("base props", () => {
  const under = { name: "Test_barn", prims: [box("Mat_T_prop", 1.3, 0.3, 0.3, 0.3, 0.3)] };
  const clear = { name: "Test_tree", prims: [box("Mat_T_prop", -1.5, 0.5, 0.2, 0.5, 0.3)] };

  test("a part the town lands on is dropped, one clear of it is kept", () => {
    const { model, log } = trade({ base: baseTile([under, clear]) });
    expect(log.dropped).toEqual(["Test_barn@1.3,0.3"]);
    expect(part(model, "Trade_Test_W_barn")).toBeUndefined();
    expect(part(model, "Trade_Test_W_tree")).toBeDefined();
  });

  test("a part keeps its authored number however many of its node survive", () => {
    // Two trees in one node; the town lands on one. The survivor is still
    // `_tree_01`-style numbered, so a name means the same on every tile.
    const trees = {
      name: "Test_tree",
      prims: [
        box("Mat_T_prop", 1.3, 0.3, 0.2, 0.5, 0.3),
        box("Mat_T_prop", -1.5, 0.5, 0.2, 0.5, 0.3),
      ],
    };
    const { model } = trade({ base: baseTile([trees, under]) });
    expect(model.parts.map((p) => p.name).filter((n) => n.includes("tree"))).toEqual([
      "Trade_Test_W_tree_01",
    ]);
    expect(part(model, "Trade_Test_W_barn")).toBeUndefined();
  });

  test("recipe overrides keep and drop by name, and a stale one is an error", () => {
    const kept = trade({ base: baseTile([under, clear]), keep: ["Test_barn"] });
    expect(part(kept.model, "Trade_Test_W_barn")).toBeDefined();
    const dropped = trade({ base: baseTile([under, clear]), drop: ["Test_tree@-1.5,0.5"] });
    expect(part(dropped.model, "Trade_Test_W_tree")).toBeUndefined();
    expect(() => trade({ base: baseTile([under, clear]), drop: ["Test_gone"] })).toThrow(
      /picks nothing/,
    );
  });

  test("re-seats a kept prop on the ground", () => {
    // Base ground at 0.30, the pads at 0.25: the ground near the town drops, and
    // a prop standing in the feather band has to come down with it.
    const near = { name: "Test_rock", prims: [box("Mat_T_prop", 0.05, 0, 0.1, 0.2, 0.3)] };
    const { model } = trade({ base: baseTile([near]) });
    const rock = part(model, "Trade_Test_W_rock")!;
    const G = new HeightField(part(model, "Trade_Test_W_ground")!.prims);
    const b = boxOfPrims(rock.prims);
    const groundUnder = Math.min(
      ...[
        [b[0], b[2]],
        [b[3], b[2]],
        [b[0], b[5]],
        [b[3], b[5]],
      ].map(([x, z]) => G.y(x, z, 9)),
    );
    expect(b[1]).toBeLessThan(0.3); // it moved
    expect(b[1]).toBeCloseTo(groundUnder, 2); // and sits on the lowest ground under it
  });

  test("the ground takes the pad's height inside it and keeps its own far away", () => {
    const { model } = trade();
    const G = new HeightField(part(model, "Trade_Test_W_ground")!.prims);
    expect(G.y(1.3, 0, 9)).toBeCloseTo(0.25, 3);
    expect(G.y(-2, 1, 9)).toBeCloseTo(0.3, 5);
  });
});

// ------------------------------------------------------------- the town --

describe("the town", () => {
  test("seats a rigid part at the lowest ground under its footprint", () => {
    const { model } = trade();
    const house = part(model, "Trade_Test_W_town_house_01")!;
    expect(boxOfPrims(house.prims)[1]).toBeCloseTo(0.25, 3);
  });

  test("paints paving into the ground instead of shipping a sheet", () => {
    const { model, log } = trade();
    expect(part(model, "Trade_Test_W_town_paving_01")).toBeUndefined();
    expect(log.painted.spoke).toBeGreaterThan(0);
    const G = new HeightField(part(model, "Trade_Test_W_ground")!.prims);
    // The strip at (1.3, 0.6) is the ground's own triangles now, at the pad's
    // height, in its own colour (or the odd stone); far from it, grass.
    const at = G.sample(1.27, 0.57)!;
    expect(["Mat_Pave", "Mat_Castle_stone"]).toContain(at.material);
    expect(at.y).toBeCloseTo(0.25, 3);
    expect(G.sample(-1.5, -0.5)!.material).toBe("Mat_T_ground");
  });

  test("replaces the yard placeholder with the ground's yard material", () => {
    const yard = {
      name: "Town_W_yardfloor",
      prims: [sheet("Mat_Trade_yard", 0.251, 0.1, 2, 1.8, 0)],
    };
    const ground = { heroes: {}, spots: {}, yard_material: "Mat_T_yard" };
    const { model } = trade({ layout: townLayout([yard]), ground });
    expect(part(model, "Trade_Test_W_town_yardfloor")).toBeUndefined();
    const G = new HeightField(part(model, "Trade_Test_W_ground")!.prims);
    expect(G.sample(1.77, -0.03)!.material).toBe("Mat_T_yard");
    expect([...model.materials.keys()]).not.toContain("Mat_Trade_yard");
    expect(() => trade({ layout: townLayout([yard]) })).toThrow(/yard_material/);
  });

  test("a layout with no bed is refused rather than guessed at", () => {
    const layout = townLayout();
    layout.parts = layout.parts.filter((p) => p.name !== "Town_W_bed");
    expect(() => trade({ layout })).toThrow(/no bed/);
  });

  test("rejects a tile over the triangle budget", () => {
    const heavy = { name: "Town_W_crates", prims: [sheet("Mat_Town", 0.3, 0.2, 44, 1.8, 0.5)] };
    expect(2 * 44 * 44).toBeGreaterThan(TRI_BUDGET);
    expect(() => trade({ layout: townLayout([heavy]) })).toThrow(/budget/);
  });
});

// ------------------------------------------------------------- the chip --

describe("the chip's keep-clear", () => {
  // One big pad over the chip, raised to 0.6 by the offset.
  const chipBed = { name: "Town_W_bed", prims: [sheet("Mat_Bed", 0.25, 1.6, 20, 0, -1.2)] };
  const chipLayout = (): TileModel => ({
    ...townLayout(),
    parts: [chipBed, ...townLayout().parts.filter((p) => p.name !== "Town_W_bed")],
  });

  test("ground raised toward the bed is clamped under the chip", () => {
    const { model } = trade({ layout: chipLayout(), offset: 0.3 });
    const g = part(model, "Trade_Test_W_ground")!;
    let inside = 0;
    for (const p of g.prims) {
      for (let i = 0; i < p.pos.length; i += 3) {
        if (Math.hypot(p.pos[i] - CHIP_XZ[0], p.pos[i + 2] - CHIP_XZ[1]) >= CHIP_KEEP) continue;
        inside++;
        expect(p.pos[i + 1]).toBeLessThanOrEqual(Math.max(0.3, CHIP_CLAMP_Y) + 1e-6);
      }
    }
    expect(inside).toBeGreaterThan(20);
    // and outside the disc the bed's height stands
    expect(new HeightField(g.prims).y(1.2, 0.2, 0)).toBeGreaterThan(0.5);
  });

  test("paving painted inside the disc stays under the chip's underside", () => {
    const pave = { name: "Town_W_plaza", prims: [sheet("Mat_Pave", 0.256, 0.3, 4, 0, -1.4)] };
    const { model, log } = trade({
      layout: { ...chipLayout(), parts: [...chipLayout().parts, pave] },
      offset: 0.3,
    });
    expect(log.painted.plaza).toBeGreaterThan(0);
    const g = part(model, "Trade_Test_W_ground")!;
    let stones = 0;
    for (const p of g.prims) {
      if (!/^Mat_Castle_stone/.test(p.material)) continue;
      for (let i = 0; i < p.pos.length; i += 3) {
        if (Math.hypot(p.pos[i] - CHIP_XZ[0], p.pos[i + 2] - CHIP_XZ[1]) >= CHIP_KEEP) continue;
        stones++;
        expect(p.pos[i + 1]).toBeLessThanOrEqual(CHIP_CLAMP_Y + 1e-6);
      }
    }
    expect(stones).toBeGreaterThan(0);
  });

  test("a building turned into the disc is culled", () => {
    const intruder = {
      name: "Town_W_house_02",
      prims: [box("Mat_Town", 0, -1.2, 0.3, 0.4, 0.25)],
      origin: [0, 0.25, -1.2] as [number, number, number],
    };
    const { model, log } = trade({ layout: townLayout([intruder]) });
    expect(log.culled).toEqual(["Town_W_house_02"]);
    expect(part(model, "Trade_Test_W_town_house_02")).toBeUndefined();
  });
});

// ------------------------------------------------ rotation and mirroring --

describe("turning a layout", () => {
  // The contract's table (naming.TRADE_LAYOUT): each direction's family,
  // rotation and mirror. A W layout's seaward half faces file bearing 0.
  const TABLE: Record<Direction, [string, number, boolean]> = {
    w: ["W", 0, false],
    e: ["W", 0, true],
    nw: ["W", 300, false],
    ne: ["W", 300, true],
    sw: ["SW", 0, false],
    se: ["SW", 0, true],
  };
  test.each(Object.entries(TABLE))(
    "%s: the layout's seaward bearing lands on the direction's",
    (dir, [fam, rotate, mirror]) => {
      const authored = fileBearing(fam === "W" ? "w" : "sw");
      expect(placeBearing(authored, { rotate, mirror })).toBe(fileBearing(dir as Direction));
    },
  );

  test("a rotation turns positions, normals and origins together", () => {
    const layout = townLayout();
    const [, house] = placeLayout(layout, { rotate: 90, mirror: false });
    // makeRotationY(90) takes +x to -z.
    expect(house.origin![0]).toBeCloseTo(0, 6);
    expect(house.origin![2]).toBeCloseTo(-1.3, 6);
    const b = boxOfPrims(house.prims);
    expect((b[2] + b[5]) / 2).toBeCloseTo(-1.3, 5);
  });

  test("a mirror reflects x and keeps every triangle facing out", () => {
    const p = box("m", 1, 0.5, 0.4, 0.4, 0);
    const before = [...p.pos];
    mirrorPrimsX([p]);
    expect(Math.min(...[...p.pos].filter((_, i) => i % 3 === 0))).toBeCloseTo(-1.2, 6);
    for (let t = 0; t < p.pos.length / 9; t++) {
      const n = faceNormal(p.pos, t);
      const stored = [p.nrm[t * 9], p.nrm[t * 9 + 1], p.nrm[t * 9 + 2]];
      expect(n[0] * stored[0] + n[1] * stored[1] + n[2] * stored[2]).toBeCloseTo(1, 5);
    }
    mirrorPrimsX([p]);
    expect([...p.pos]).toEqual(before);
  });

  test("rotatePrimsY matches three.js makeRotationY", () => {
    const p: Prim = {
      material: "m",
      pos: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0]),
      nrm: new Float32Array(9),
    };
    rotatePrimsY([p], 90);
    expect(p.pos[0]).toBeCloseTo(0, 6);
    expect(p.pos[2]).toBeCloseTo(-1, 6);
    expect(p.pos[3]).toBeCloseTo(1, 6);
  });

  test("a mirrored town is on the other side of the tile", () => {
    const { model } = trade({ placement: { rotate: 0, mirror: true } });
    const b = boxOfPrims(part(model, "Trade_Test_W_town_house_01")!.prims);
    expect((b[0] + b[3]) / 2).toBeCloseTo(-1.3, 4);
  });
});

// ---------------------------------------------------------------- heroes --

describe("heroes", () => {
  const kiln = { name: "Test_kiln", prims: [box("Mat_T_prop", 1.3, 0.3, 0.3, 0.6, 0.3)] };
  const spec = {
    nodes: ["Test_kiln"],
    anchor: { file: [1.3, 0.3] as [number, number] },
    select_r: null,
    footprint_r: 0.2,
  };
  const ground = (spot: [number, number], yaw = 0) => ({
    heroes: { kiln: spec },
    spots: { W: { kiln: { file: spot, yaw, scale: 1 } } },
  });

  test("a hero the town lands on goes to its spot rather than being dropped", () => {
    const { model, log } = trade({ base: baseTile([kiln]), ground: ground([-1.2, 0.8]) });
    expect(log.dropped).toEqual([]);
    expect(log.heroes).toEqual([{ hero: "kiln", spot: "kiln", parts: 1, stays: false }]);
    const b = boxOfPrims(part(model, "Trade_Test_W_kiln")!.prims);
    expect((b[0] + b[3]) / 2).toBeCloseTo(-1.2, 4);
    expect((b[2] + b[5]) / 2).toBeCloseTo(0.8, 4);
    expect(b[1]).toBeCloseTo(0.3, 3); // on the ground there
  });

  test("a moved hero drops kept props under its new footprint only", () => {
    const under = { name: "Test_bush", prims: [box("Mat_T_prop", -1.1, 0.8, 0.1, 0.1, 0.3)] };
    const beside = { name: "Test_rock", prims: [box("Mat_T_prop", -1.8, 0.8, 0.1, 0.1, 0.3)] };
    const r = trade({ base: baseTile([kiln, under, beside]), ground: ground([-1.2, 0.8]) });
    expect(r.log.dropped).toEqual(["Test_bush@-1.1,0.8"]);
    expect(part(r.model, "Trade_Test_W_rock")).toBeDefined();
  });

  test("steps a spot off the town by the smallest clearing step", () => {
    // The house stands at (1.3, 0), 0.4 wide: a kiln (0.3 wide) sent to
    // (1.35, 0.3) has its corners inside it, and a short step takes it out.
    const h = trade({ base: baseTile([kiln]), ground: ground([1.35, 0.3]) });
    const log = h.log.heroes[0];
    expect(log.collides).toBeUndefined();
    expect(log.pushed).toBeGreaterThan(0);
    expect(log.pushed).toBeLessThanOrEqual(0.6);
    const b = boxOfPrims(part(h.model, "Trade_Test_W_kiln")!.prims);
    // clear of the house (x 1.1..1.5, z -0.2..0.2) by the contract's 0.08
    const gap = Math.max(b[0] - 1.5, 1.1 - b[3], b[2] - 0.2, -0.2 - b[5]);
    expect(gap).toBeGreaterThan(0.08 - 0.035);
  });

  test("reports an unsavable spot and uses its clear _alt", () => {
    // Dead centre of the chip's disc: 0.6 of stepping cannot leave it.
    const g = ground([0, -1.5]);
    expect(trade({ base: baseTile([kiln]), ground: g }).log.heroes[0].collides).toBe("chip");
    const alt = {
      ...g,
      spots: {
        W: { ...g.spots.W, kiln_alt: { file: [-1, -0.2] as [number, number], yaw: 0, scale: 1 } },
      },
    };
    const h = trade({ base: baseTile([kiln]), ground: alt }).log.heroes[0];
    expect(h.spot).toBe("kiln_alt");
    expect(h.collides).toBeUndefined();
    expect(h.pushed).toBeUndefined();
  });

  test("reports a spot outside the rim's inner edge", () => {
    expect(hexApothem(3.1, 0)).toBeGreaterThan(2.36 + 0.6);
    expect(trade({ base: baseTile([kiln]), ground: ground([3.1, 0]) }).log.heroes[0].collides).toBe(
      "rim",
    );
  });

  test("a hero with no spot for this direction is left to the ordinary rule", () => {
    const r = trade({ base: baseTile([kiln]), ground: { heroes: { kiln: spec }, spots: {} } });
    expect(r.log.heroes).toEqual([
      { hero: "kiln", spot: "-", parts: 0, stays: false, unplaced: true },
    ]);
    expect(r.log.dropped).toEqual(["Test_kiln@1.3,0.3"]); // the town lands on it
  });
});

// ----------------------------------------------------------------- rivers --

describe("rivers", () => {
  const template = (): TileModel => ({
    root: "Hex_River_Tpl_E_W_A",
    parts: [
      { name: "Hex_River_Tpl_E_W_A", prims: [sheet("Mat_Tpl", 0.22, 2.9, 2)] },
      {
        name: "River_Tpl_E_W_A_ground",
        prims: [sheet("Mat_Tpl_grass", 0.3), sheet("Mat_Tpl_mud", 0.2, 0.3, 2)],
      },
      { name: "River_Tpl_E_W_A_rim", prims: [sheet("Mat_Tpl_rim", 0.23, 2.9, 4)] },
      { name: "River_Tpl_E_W_A_water", prims: [sheet("Mat_River_water", 0.19, 0.3, 6)] },
      { name: "River_Tpl_E_W_A_sheep_01", prims: [box("Mat_Tpl_wool", 1, 1, 0.2, 0.2, 0.3)] },
    ],
    socket: { name: "Token_River_Tpl_E_W_A", translation: [0, 0.26, -1.5], rotation: [0, 0, 0, 1] },
    materials: new Map(
      [
        "Mat_Tpl",
        "Mat_Tpl_grass",
        "Mat_Tpl_mud",
        "Mat_Tpl_rim",
        "Mat_River_water",
        "Mat_Tpl_wool",
      ].map((m) => [
        m,
        { name: m, baseColor: [1, 1, 1, 1], roughness: 1, metallic: 0, doubleSided: false },
      ]),
    ),
  });
  const tplBase = (): TileModel => ({
    ...baseTile(),
    root: "Hex_Tpl",
    parts: [{ name: "Tpl_rim", prims: [sheet("Mat_Tpl_rim", 0.23, 2.9, 4)] }],
  });
  const run = (props: Part[] = []) =>
    composeRiver({
      base: baseTile(props),
      template: template(),
      templateBase: tplBase(),
      terrain: "River_Test_E_W_A",
      swap: { Mat_Tpl_mud: "Mat_T_prop" },
      shape: "e_w_a",
    });

  test("the rim map pairs the two families' borders face for face", () => {
    expect(rimMaterialMap(tplBase(), baseTile())).toEqual({ Mat_Tpl_rim: "Mat_T_rim" });
  });

  test("keeps the channel and drops the template's props and terrain", () => {
    const { model } = run();
    const names = model.parts.map((p) => p.name);
    expect(names).toContain("River_Test_E_W_A_water");
    expect(names).not.toContain("River_Test_E_W_A_sheep_01");
    expect([...model.materials.keys()].sort()).toEqual([
      "Mat_River_water",
      "Mat_T_ground",
      "Mat_T_prop",
      "Mat_T_rim",
      "Mat_T_slab",
    ]);
  });

  test("a base prop in the water is dropped and one on the bank kept", () => {
    const wet = { name: "Test_stump", prims: [box("Mat_T_prop", 0, 0, 0.1, 0.2, 0.3)] };
    const dry = { name: "Test_tree", prims: [box("Mat_T_prop", -1.8, 1, 0.1, 0.2, 0.3)] };
    const { log } = run([wet, dry]);
    expect(log.dropped).toEqual(["Test_stump@0.0,0.0"]);
    expect(log.kept).toBe(1);
  });

  // A FACETED template (the river cut into the ground's own lattice): one
  // sheet split into ground, channel and margin by distance from the
  // centreline z = 1, every corner at one height from one cross-section.
  const faceted = (): TileModel => {
    const full = sheet("x", 0);
    const section = (z: number) => {
      const d = Math.abs(z - 1);
      if (d <= 0.15) return 0.1;
      if (d <= 0.3) return 0.1 + ((d - 0.15) / 0.15) * 0.093;
      if (d <= 0.45) return 0.193 + ((d - 0.3) / 0.15) * 0.107;
      return 0.3;
    };
    const buckets = new Map<string, number[]>();
    let n = 0;
    for (let i = 0; i < full.pos.length; i += 9) {
      const cz = (full.pos[i + 2] + full.pos[i + 5] + full.pos[i + 8]) / 3;
      const d = Math.abs(cz - 1);
      const [part, mat] =
        d < 0.45
          ? ["channel", d < 0.3 ? "Mat_Tpl_mud" : "Mat_Tpl_grass"]
          : d < 0.75
            ? ["margin", n++ % 2 ? "Mat_Tpl_mud" : "Mat_Tpl_grass_dk"]
            : ["ground", "Mat_Tpl_grass"];
      const tri = [...full.pos.subarray(i, i + 9)];
      for (let k = 1; k < 9; k += 3) tri[k] = section(tri[k + 1]);
      const key = `${part}|${mat}`;
      buckets.set(key, [...(buckets.get(key) ?? []), ...tri]);
    }
    const prims = (part: string) =>
      [...buckets]
        .filter(([k]) => k.startsWith(`${part}|`))
        .map(([k, pos]) => ({
          material: k.split("|")[1],
          pos: new Float32Array(pos),
          nrm: new Float32Array(pos.length),
        }));
    const t = template();
    t.materials.set("Mat_Tpl_grass_dk", {
      ...t.materials.get("Mat_Tpl_grass")!,
      name: "Mat_Tpl_grass_dk",
    });
    t.parts = [
      t.parts[0],
      { name: "River_Tpl_E_W_A_ground", prims: prims("ground") },
      t.parts[2],
      { name: "River_Tpl_E_W_A_channel", prims: prims("channel") },
      { name: "River_Tpl_E_W_A_margin", prims: prims("margin") },
      {
        // the water along the whole river, 0.3 either side of its line
        name: "River_Tpl_E_W_A_water",
        prims: [-2.4, -1.8, -1.2, -0.6, 0, 0.6, 1.2, 1.8, 2.4].map((x) =>
          sheet("Mat_River_water", 0.193, 0.3, 4, x, 1),
        ),
      },
    ];
    return t;
  };
  const runFaceted = (ground: (x: number, z: number) => number) =>
    composeRiver({
      base: shaped(baseTile(), ground),
      template: faceted(),
      templateBase: tplBase(),
      terrain: "River_Test_E_W_A",
      swap: { Mat_Tpl_mud: "Mat_T_prop" },
      margin: { Mat_Tpl_mud: "Mat_T_prop", Mat_Tpl_grass_dk: "Mat_T_yard" },
      shape: "e_w_a",
    });
  /** Every corner's heights across the named parts, by plan position. */
  const corners = (m: TileModel, parts: RegExp) => {
    const out = new Map<string, Set<number>>();
    for (const p of m.parts)
      if (parts.test(p.name))
        for (const q of p.prims)
          for (let i = 0; i < q.pos.length; i += 3) {
            const k = `${q.pos[i].toFixed(3)},${q.pos[i + 2].toFixed(3)}`;
            out.set(k, (out.get(k) ?? new Set()).add(Math.round(q.pos[i + 1] * 1e5)));
          }
    return out;
  };

  test("faceted channel takes base turf and family bank and margin", () => {
    const { model } = runFaceted(() => 0.3);
    const mats = (name: string) =>
      new Set(part(model, `River_Test_E_W_A_${name}`)!.prims.map((q) => q.material));
    expect(mats("channel")).toEqual(new Set(["Mat_T_prop", "Mat_T_ground"]));
    expect(mats("margin")).toEqual(new Set(["Mat_T_prop", "Mat_T_yard"]));
    expect(mats("ground")).toEqual(new Set(["Mat_T_ground"]));
  });

  test("faceted channel keeps the water section and never splits a corner", () => {
    const { model } = runFaceted((x) => 0.3 + 0.1 * Math.max(0, x));
    // One height per corner across the ground, the channel and the margin.
    for (const [k, ys] of corners(model, /_(ground|channel|margin)$/))
      expect(ys.size, `corner ${k} has ${ys.size} heights`).toBe(1);
    const G = new HeightField(
      model.parts.filter((p) => /_(ground|channel|margin)$/.test(p.name)).flatMap((p) => p.prims),
    );
    // The bed and the waterline are the template's to the millimetre...
    // (at lattice corners: d 0.05 on the bed, d 0.2 on the bank)
    expect(G.y(1.5, 1.05, 0)).toBeCloseTo(0.1, 3);
    expect(G.y(1.5, 1.2, 0)).toBeCloseTo(0.1 + (0.05 / 0.15) * 0.093, 3);
    // ...and a metre from the water the ground is the base's, ramp and all.
    expect(G.y(1.5, -0.6, 0)).toBeCloseTo(0.45, 2);
  });

  test("keeps the wet margin above the waterline on a low base", () => {
    const { model } = runFaceted(() => 0.1);
    for (const y of ys(part(model, "River_Test_E_W_A_margin"))) expect(y).toBeGreaterThan(0.22);
  });

  test("turns a margin lifted too high back into turf", () => {
    const { model } = runFaceted(() => 0.7);
    const my = ys(part(model, "River_Test_E_W_A_margin"));
    for (const y of my) expect(y).toBeLessThan(MARGIN_TOP);
    const low = faceted().parts.find((p) => p.name.endsWith("_margin"))!;
    const n = (p: Part | undefined) => (p ? p.prims.reduce((a, q) => a + q.pos.length / 9, 0) : 0);
    expect(n(part(model, "River_Test_E_W_A_margin"))).toBeLessThan(n(low));
    // Nothing is lost: the ground took them.
    const all = (m: TileModel) =>
      n(m.parts.find((p) => p.name.endsWith("_ground"))) +
      n(m.parts.find((p) => p.name.endsWith("_margin")));
    expect(all(model)).toBe(n(faceted().parts.find((p) => p.name.endsWith("_ground"))) + n(low));
  });

  test("rejects a template material the swap does not cover", () => {
    const t = template();
    t.parts.push({
      name: "River_Tpl_E_W_A_reeds_01",
      prims: [box("Mat_Tpl_wool", 0.4, 0.4, 0.05, 0.1, 0.2)],
    });
    const run2 = (swap: Record<string, string>) =>
      composeRiver({
        base: baseTile(),
        template: t,
        templateBase: tplBase(),
        terrain: "River_Test_E_W_A",
        swap,
        shape: "e_w_a",
      });
    expect(() => run2({ Mat_Tpl_mud: "Mat_T_prop" })).toThrow(
      /template materials survived: Mat_Tpl_wool/,
    );
    expect(() => run2({ Mat_Tpl_mud: "Mat_T_prop", Mat_Tpl_wool: "Mat_T_prop" })).not.toThrow();
  });
});

// ------------------------------------------------------------ determinism --

describe("determinism", () => {
  test("the same inputs write the same bytes", async () => {
    const props = [
      { name: "Test_barn", prims: [box("Mat_T_prop", 1.3, 0.3, 0.3, 0.3, 0.3)] },
      { name: "Test_tree", prims: [box("Mat_T_prop", -1.5, 0.5, 0.2, 0.5, 0.3)] },
    ];
    const a = await modelToGlb(
      trade({ base: baseTile(props), placement: { rotate: 300, mirror: true } }).model,
    );
    const b = await modelToGlb(
      trade({ base: baseTile(props), placement: { rotate: 300, mirror: true } }).model,
    );
    expect(a.length).toBeGreaterThan(1000);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

// ---------------------------------------------------------------- recipes --

describe("recipes", () => {
  const parts: Parts = { grounds: { hills: { terrain: "Hills", file: "x.glb" } } };
  test("the key names the tile, and the file only its fixes", () => {
    expect(parseRecipe("trade_hills_nw", {}, parts)).toMatchObject({
      kind: "trade",
      ground: "hills",
      variant: "nw",
    });
    expect(parseRecipe("river_hills_e_w_a", { drop: ["a"] }, parts)).toMatchObject({
      kind: "river",
      variant: "e_w_a",
      drop: ["a"],
    });
    expect(terrainForKey("trade_hills_nw")).toBe("Trade_Hills_NW");
    expect(terrainForKey("river_forest_e_w_a")).toBe("River_Forest_E_W_A");
  });
  test("anything malformed is refused, naming the file", () => {
    expect(() => parseRecipe("trade_hills_nw", { dir: "w" }, parts)).toThrow(
      /trade_hills_nw: unknown field "dir"/,
    );
    expect(() => parseRecipe("trade_moon_nw", {}, parts)).toThrow(/no ground "moon"/);
    expect(() => parseRecipe("trade_hills_up", {}, parts)).toThrow(/not a direction/);
    expect(() => parseRecipe("river_hills_e_w", {}, parts)).toThrow(/not a channel shape/);
    expect(() => parseRecipe("trade_hills_nw", { nudge: { a: [1] } }, parts)).toThrow(/\[dx, dz\]/);
  });
  test("a part's role is the contract's table first, then its part word", () => {
    const spots: SpotsFile = { version: 1, grounds: {}, parts: { Town_W_odd: { role: "fixed" } } };
    expect(partRole("Town_W_odd", spots)).toBe("fixed");
    expect(partRole("Town_W_bed")).toBe("bed");
    expect(partRole("Town_SW_paving_03")).toBe("paint");
    // The contract's own word for it reads as the composer's.
    const listed: SpotsFile = { version: 1, grounds: {}, parts: { Town_W_odd: { role: "drape" } } };
    expect(partRole("Town_W_odd", listed)).toBe("paint");
    expect(partRole("LakeTown_NE_deck")).toBe("fixed");
    expect(partRole("Town_W_house_07")).toBe("rigid");
  });
});

// --------------------------------------------------- the contract's rules --

describe("pads", () => {
  test("each bed island flattens to the median of the base ground under it", () => {
    // A base ground sloping in x: y = 0.3 + 0.1 x. Two pads, one each side.
    const slope = sheet("Mat_T_ground", 0);
    for (let i = 0; i < slope.pos.length; i += 3) slope.pos[i + 1] = 0.3 + 0.1 * slope.pos[i];
    const base = baseTile();
    base.parts[1] = { name: "Test_ground", prims: [slope] };
    // (no paving here: the ground beside paving is set to the paving's
    // surface, a different rule)
    const layout = townLayout();
    layout.parts = layout.parts.filter((p) => !/paving/.test(p.name));
    layout.parts[0] = {
      name: "Town_W_bed",
      prims: [sheet("Mat_Bed", 0.25, 0.2, 4, -1.5, 1), sheet("Mat_Bed", 0.25, 0.2, 4, 1.5, 1)],
    };
    const { model } = trade({ base, layout, offset: 0 });
    const G = new HeightField(part(model, "Trade_Test_W_ground")!.prims);
    // Flat on each pad, at that pad's own median, so the town steps with the slope.
    expect(G.y(-1.55, 1, 0)).toBeCloseTo(0.15, 2);
    expect(G.y(-1.45, 1, 0)).toBeCloseTo(0.15, 2);
    expect(G.y(1.45, 1, 0)).toBeCloseTo(0.45, 2);
  });

  test("clamps ground under paving inside the chip's disc", () => {
    const bedOverChip = { name: "Town_W_bed", prims: [sheet("Mat_Bed", 0.25, 1.6, 20, 0, -1.2)] };
    const pave = { name: "Town_W_plaza", prims: [sheet("Mat_Pave", 0.256, 0.3, 4, 0, -1.4)] };
    const layout = { ...townLayout(), parts: [bedOverChip, pave] };
    const { model } = trade({ layout, offset: -0.03 });
    const G = new HeightField(part(model, "Trade_Test_W_ground")!.prims);
    expect(G.y(0, -1.4, 9)).toBeLessThanOrEqual(0.24 + 1e-6);
    expect(G.sample(0.02, -1.37)!.material).toMatch(/^Mat_Castle_stone/);
    expect(part(model, "Trade_Test_W_town_plaza")).toBeUndefined();
  });
});

describe("the ground's keep rules", () => {
  const prop = (name: string, x: number, z: number, h = 0.2) => ({
    name,
    prims: [box("Mat_T_prop", x, z, 0.2, h, 0.3)],
  });
  const ground = (keep: Record<string, unknown>, extra: object = {}) => ({
    heroes: {},
    spots: {},
    keep,
    ...extra,
  });

  test("drop_always and never_drop beat the mask both ways", () => {
    const base = baseTile([prop("Test_jetty", -1.5, 0.5), prop("Test_water", 1.3, 0)]);
    const { model } = trade({
      base,
      ground: ground({ drop_always: ["Test_jetty"], never_drop: ["Test_water"] }),
    });
    expect(part(model, "Trade_Test_W_jetty")).toBeUndefined();
    const water = part(model, "Trade_Test_W_water")!;
    expect(boxOfPrims(water.prims)[1]).toBeCloseTo(0.3, 6); // exactly where authored
  });

  test("clip_nodes keeps what the town does not cover", () => {
    const dune = { name: "Test_ripples", prims: [sheet("Mat_T_prop", 0.31, 0.6, 12, 0.9, 0)] };
    const clipped = trade({
      base: baseTile([dune]),
      ground: ground({ clip_nodes: ["Test_ripples"] }),
    });
    const kept = part(clipped.model, "Trade_Test_W_ripples")!;
    expect(clipped.log.dropped).toEqual([]);
    const n = kept.prims.reduce((a, p) => a + p.pos.length / 9, 0);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(2 * 12 * 12);
    expect(part(trade({ base: baseTile([dune]) }).model, "Trade_Test_W_ripples")).toBeUndefined();
  });

  test("budget_drop_order drops whole nodes in order until the tile fits", () => {
    const heavy = { name: "Test_scrub", prims: [sheet("Mat_T_prop", 0.35, 0.3, 30, -1.5, -0.2)] }; // 1800 tris
    const light = prop("Test_bones", -1.6, 1.2);
    const base = baseTile([heavy, light]);
    expect(() => trade({ base })).toThrow(/budget/);
    const r = trade({ base, ground: ground({ budget_drop_order: ["Test_bones", "Test_scrub"] }) });
    expect(r.log.budgetDropped).toEqual(["Test_bones", "Test_scrub"]);
    expect(r.log.tris).toBeLessThan(TRI_BUDGET);
  });

  test("min_<what> is an error when too few survive", () => {
    const trees = [prop("Test_conifers", -1.5, 0.5), prop("Test_conifers", 1.3, 0)];
    const base = baseTile([{ name: "Test_conifers", prims: trees.flatMap((t) => t.prims) }]);
    expect(() => trade({ base, ground: ground({ min_conifers: 2 }) })).toThrow(
      /min_conifers is 2, and only 1 survive/,
    );
    expect(() => trade({ base, ground: ground({ min_conifers: 1 }) })).not.toThrow();
  });
});

describe("hero modes", () => {
  const boatAt = (x: number) => ({
    name: "Test_boat",
    prims: [box("Mat_T_prop", x, 1, 0.2, 0.1, 0.19)],
  });
  const spec = (flags: object) => ({
    nodes: ["Test_boat"],
    anchor: { file: [1.3, 1] as [number, number] },
    select_r: null,
    footprint_r: 0.1,
    ...flags,
  });
  const ground = (flags: object) => ({
    heroes: { boat: spec(flags) },
    spots: { W: { boat: { file: [-1.3, 1] as [number, number], yaw: 0, scale: 1 } } },
  });

  test("a fixed hero keeps its authored height wherever it moves", () => {
    const { model } = trade({ base: baseTile([boatAt(1.3)]), ground: ground({ fixed: true }) });
    const b = boxOfPrims(part(model, "Trade_Test_W_boat")!.prims);
    expect((b[0] + b[3]) / 2).toBeCloseTo(-1.3, 4);
    expect(b[1]).toBeCloseTo(0.19, 5);
  });

  test("a ground-bound hero never moves, and paving over it is clipped", () => {
    const pond = { name: "Test_pond", prims: [box("Mat_T_prop", 1.3, 0.6, 0.3, 0.02, 0.3)] };
    const g = {
      heroes: {
        pond: {
          nodes: ["Test_pond"],
          anchor: { file: [1.3, 0.6] as [number, number] },
          select_r: null,
          footprint_r: 0.2,
          ground_bound: true,
        },
      },
      spots: {
        W: { pond: { file: [1.3, 0.6] as [number, number], yaw: 0, scale: 1, stays: true } },
      },
      keep: { clip_paving_over: ["pond"] },
    };
    const { model, log } = trade({ base: baseTile([pond]), ground: g });
    expect(log.heroes[0]).toMatchObject({ hero: "pond", stays: true });
    expect(log.heroes[0].collides).toBeUndefined();
    // The paving strip at z 0.5..0.7 crosses the pond at x 1.3: it is clipped
    // there, and nothing is painted on the pond's own ground.
    expect(log.clipped).toContain("Town_W_paving_01");
    const G = new HeightField(part(model, "Trade_Test_W_ground")!.prims);
    for (const [x, z] of [
      [1.27, 0.57],
      [1.33, 0.63],
      [1.2, 0.6],
    ])
      expect(G.sample(x, z)!.material).toBe("Mat_T_ground");
  });

  test("a part claimed by one hero is not moved again by the next", () => {
    const kilnAndShed = { name: "Test_kiln", prims: [box("Mat_T_prop", 1.3, 0.3, 0.3, 0.6, 0.3)] };
    const s = {
      nodes: ["Test_kiln"],
      anchor: { file: [1.3, 0.3] as [number, number] },
      select_r: null,
      footprint_r: 0.2,
    };
    const g = {
      heroes: { kiln: s, shed: s },
      spots: {
        W: {
          kiln: { file: [-1.2, 0.8] as [number, number], yaw: 0, scale: 1 },
          shed: { file: [-1.2, -0.2] as [number, number], yaw: 0, scale: 1 },
        },
      },
    };
    expect(() => trade({ base: baseTile([kilnAndShed]), ground: g })).toThrow(
      /hero shed .* selects no part/,
    );
  });
});

describe("the border keep-out", () => {
  const placed = (cx: number, cz: number) => {
    const [c] = clustersOf("Test_rock", [box("Mat_T_prop", cx, cz, 0.3, 0.3, 0.3)]);
    return stay(c, 0);
  };
  const reach = (p: ReturnType<typeof placed>) =>
    Math.max(...[...placedPoints(p)].map(([x, , z]) => hexApothem(x, z)));

  test("a body over the middle of an edge is walked back inside it", () => {
    // 2.55 out on the +x edge: inside the circumradius, on the chamfer.
    const p = placed(2.4, 0);
    expect(reach(p)).toBeGreaterThan(BORDER_APOTHEM);
    const moved = keepInside([p]);
    expect(moved).toBeCloseTo(2.55 - (BORDER_APOTHEM - BORDER_CLEAR), 4);
    expect(reach(p)).toBeCloseTo(BORDER_APOTHEM - BORDER_CLEAR, 4);
    expect(p.sz).toBe(0);
  });

  test("a body over a corner takes both edges' push", () => {
    const p = placed(1.2, -2.1);
    keepInside([p]);
    expect(reach(p)).toBeLessThanOrEqual(BORDER_APOTHEM - BORDER_CLEAR + 1e-6);
  });

  test("a group moves as one, and a body already inside does not move at all", () => {
    const a = placed(2.4, 0),
      b = placed(1.8, 0);
    keepInside([a, b]);
    expect(a.sx).toBe(b.sx);
    const inside = placed(1.0, 0.5);
    expect(keepInside([inside])).toBe(0);
    expect([inside.sx, inside.sz]).toEqual([0, 0]);
  });
});
