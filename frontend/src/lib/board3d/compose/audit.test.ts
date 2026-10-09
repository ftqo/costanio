// Each audit check is shown to fire on a tile built with the defect, so a
// clean report on the shipped tiles (compose.audit.test.ts) means something.
import { describe, expect, test } from "vitest";
import { auditTile, baseProps, counts } from "./audit";
import { BORDER_APOTHEM } from "./fields";
import { clonePart, translatePrims, type Part, type TileModel } from "./model";
import { bar, baseTile, box, pool, sheet, shaped } from "./testkit";

/** `base` as though a composer had written it, every part renamed into the composed terrain, then `edit`ed. */
function composed(base: TileModel, edit: (parts: Part[]) => Part[] = (p) => p): TileModel {
  const parts = base.parts.map((p) =>
    clonePart(
      p,
      p.name === base.root ? "Hex_Trade_Test_W" : p.name.replace(/^Test_/, "Trade_Test_W_"),
    ),
  );
  return { ...base, root: "Hex_Trade_Test_W", parts: edit(parts) };
}
const audit = (model: TileModel, base: TileModel) => auditTile(model, base, baseProps(base));
const named = (parts: Part[], name: string) => parts.find((p) => p.name === name)!;

describe("audit", () => {
  test("an unchanged tile is clean", () => {
    const base = baseTile([
      pool("Test_pool", -1.5, 1.0, 0.3),
      { name: "Test_rock", prims: [box("Mat_T_prop", 1, 1, 0.2, 0.2, 0.3)] },
    ]);
    expect(counts(audit(composed(base), base))).toEqual({
      a: 0,
      b: 0,
      c: 0,
      d: 0,
      e: 0,
      f: 0,
      g: 0,
      h: 0,
    });
  });

  test("(h) flags a prop across an edge midpoint", () => {
    // Mid-edge on the +x edge, 2.55 out: inside the circumradius (3.0) and the
    // art apothem (2.598), but still on the chamfer beside the roads. A radial
    // rule would pass it.
    const base = baseTile([
      { name: "Test_rock", prims: [box("Mat_T_prop", 2.0, 0, 0.2, 0.2, 0.3)] },
    ]);
    const a = audit(
      composed(base, (ps) => {
        translatePrims(named(ps, "Trade_Test_W_rock").prims, 0.45, 0, 0);
        return ps;
      }),
      base,
    );
    expect(a.border.map((b) => b.part)).toEqual(["Trade_Test_W_rock"]);
    expect(a.border[0].over).toBeCloseTo(2.55 - BORDER_APOTHEM, 3);
    // The same rock at a corner, 2.75 out radially, is inside: the hexagon is
    // wider there.
    const corner = baseTile([
      { name: "Test_rock", prims: [box("Mat_T_prop", 0, -2.7, 0.1, 0.2, 0.3)] },
    ]);
    expect(audit(composed(corner), corner).border).toEqual([]);
  });

  test("(h) river water may cross only in its mouth notch", () => {
    const water = (name: string, cx: number, cz: number) => ({
      name,
      prims: [sheet("Mat_River_water", 0.19, 0.08, 2, cx, cz)],
    });
    const base = baseTile([water("Test_water", 2.52, 0), water("Test_rock", 2.52, 0)]);
    const a = audit(composed(base), base);
    expect(a.border.map((b) => b.part)).toEqual(["Trade_Test_W_rock"]);
    const wide = baseTile([water("Test_water", 2.52, 0.4)]);
    expect(audit(composed(wide), wide).border.map((b) => b.part)).toEqual(["Trade_Test_W_water"]);
  });

  test("(a) flags a pool lifted off its bank", () => {
    const base = baseTile([pool("Test_pool", -1.5, 1.0, 0.3)]);
    const a = audit(
      composed(base, (ps) => {
        translatePrims(named(ps, "Trade_Test_W_pool").prims, 0, 0.08, 0);
        return ps;
      }),
      base,
    );
    expect(a.waterFloat.map((w) => w.kind)).toContain("water");
  });

  test("(a) flags a pool draped over a slope", () => {
    const base = baseTile([pool("Test_pool", -1.5, 1.0, 0.3)]);
    const a = audit(
      composed(base, (ps) => {
        for (const q of named(ps, "Trade_Test_W_pool").prims)
          for (let i = 0; i < q.pos.length; i += 3) q.pos[i + 1] += 0.05 * (q.pos[i] + 1.5);
        return ps;
      }),
      base,
    );
    expect(a.waterFloat.map((w) => w.kind)).toContain("level");
  });

  test("(a, b) flags floating and pierced paving", () => {
    const base = shaped(baseTile(), (x) => (Math.abs(x - 1) < 0.2 ? 0.34 : 0.3));
    const pave = (y: number): Part => ({
      name: "Trade_Test_W_town_paving_01",
      prims: [sheet("Mat_Pave", y, 0.5, 8, 1, 0)],
    });
    const floating = audit(
      composed(base, (ps) => [...ps, pave(0.36)]),
      base,
    );
    expect(floating.waterFloat.map((w) => w.kind)).toContain("drape");
    const pierced = audit(
      composed(base, (ps) => [...ps, pave(0.305)]),
      base,
    );
    expect(pierced.pierce.length).toBe(1);
    expect(pierced.pierce[0].max).toBeCloseTo(0.035, 3);
  });

  test("(e) flags a hovering prop", () => {
    const base = baseTile([{ name: "Test_rock", prims: [box("Mat_T_prop", 1, 1, 0.2, 0.2, 0.3)] }]);
    const a = audit(
      composed(base, (ps) => {
        translatePrims(named(ps, "Trade_Test_W_rock").prims, 0, 0.05, 0);
        return ps;
      }),
      base,
    );
    expect(a.hover.map((h) => h.part)).toEqual(["rock"]);
  });

  test("(c) flags a house sunk to its roof", () => {
    const base = baseTile([{ name: "Test_hut", prims: [box("Mat_T_prop", 1, 1, 0.3, 0.4, 0.3)] }]);
    const a = audit(
      composed(base, (ps) => {
        translatePrims(named(ps, "Trade_Test_W_hut").prims, 0, -0.2, 0);
        return ps;
      }),
      base,
    );
    expect(a.orphans.map((o) => o.why)).toEqual([expect.stringMatching(/^sunk/)]);
  });

  test("(c) flags partial parts and half-removed groups", () => {
    const base = baseTile([
      { name: "Test_crate", prims: [box("Mat_T_prop", 1, 1, 0.3, 0.3, 0.3)] },
      {
        name: "Test_sedge",
        prims: [
          bar("Mat_T_prop", -1, -0.98, 1, 1.02, 0.2, 0.3),
          bar("Mat_T_prop", -0.96, -0.94, 1, 1.02, 0.2, 0.3),
        ],
      },
    ]);
    const a = audit(
      composed(base, (ps) => {
        const crate = named(ps, "Trade_Test_W_crate");
        crate.prims = crate.prims.map((q) => ({
          ...q,
          pos: q.pos.slice(0, q.pos.length - 18),
          nrm: q.nrm.slice(0, q.nrm.length - 18),
        }));
        const sedge = named(ps, "Trade_Test_W_sedge");
        return [
          ...ps.filter((p) => p !== sedge),
          {
            name: "Trade_Test_W_sedge_01",
            prims: [bar("Mat_T_prop", -1, -0.98, 1, 1.02, 0.2, 0.3)],
          },
        ];
      }),
      base,
    );
    const why = a.orphans.map((o) => o.why);
    expect(why.some((w) => w.startsWith("fragment"))).toBe(true);
    expect(why.some((w) => w.startsWith("group"))).toBe(true);
  });

  test("(d) flags props inside another or on paving", () => {
    const base = baseTile([
      { name: "Test_barn", prims: [box("Mat_T_prop", 1, 1, 0.5, 0.5, 0.3)] },
      { name: "Test_sheep", prims: [box("Mat_T_prop", -1, -0.5, 0.1, 0.1, 0.3)] },
    ]);
    const inside = audit(
      composed(base, (ps) => {
        translatePrims(named(ps, "Trade_Test_W_sheep").prims, 2, 0, 1.5);
        return ps;
      }),
      base,
    );
    expect(inside.clashes.map((c) => `${c.a} in ${c.b}`)).toContain("sheep in barn");
    const onPaving = audit(
      composed(base, (ps) => [
        ...ps,
        {
          name: "Trade_Test_W_town_paving_01",
          prims: [sheet("Mat_Pave", 0.302, 0.2, 2, -1, -0.5)],
        },
      ]),
      base,
    );
    expect(onPaving.clashes.map((c) => c.b)).toContain("town_paving_01");
  });

  test("(f) classifies a ground sheet as an overlay by shape", () => {
    const base = baseTile();
    const drape = audit(
      composed(base, (ps) => [
        ...ps,
        { name: "Trade_Test_W_town_paving_01", prims: [sheet("Mat_Pave", 0.304, 0.3, 4, 1, 0)] },
      ]),
      base,
    );
    expect(drape.overlays.map((o) => o.part)).toEqual(["town_paving_01"]);
    const rug = audit(
      composed(base, (ps) => [
        ...ps,
        { name: "Trade_Test_W_town_rug", prims: [sheet("Mat_Pave", 0.305, 0.3, 4, 1, 0)] },
      ]),
      base,
    );
    expect(rug.overlays.map((o) => o.part)).toEqual(["town_rug"]);
    // A stone standing on the ground is not a sheet.
    const stone = audit(
      composed(base, (ps) => [
        ...ps,
        { name: "Trade_Test_W_town_kerb_01", prims: [box("Mat_Pave", 1, 0, 0.08, 0.05, 0.28)] },
      ]),
      base,
    );
    expect(stone.overlays).toEqual([]);
  });

  test("(g) flags specks, pinholes and props on paint", () => {
    // Paint the ground triangles whose centres pass `at`, in Mat_Pave.
    const paint = (ps: Part[], at: (x: number, z: number) => boolean) => {
      const g = named(ps, "Trade_Test_W_ground");
      const keep: number[] = [],
        pave: number[] = [];
      for (const q of g.prims)
        for (let i = 0; i < q.pos.length; i += 9) {
          const cx = (q.pos[i] + q.pos[i + 3] + q.pos[i + 6]) / 3,
            cz = (q.pos[i + 2] + q.pos[i + 5] + q.pos[i + 8]) / 3;
          (at(cx, cz) ? pave : keep).push(...q.pos.subarray(i, i + 9));
        }
      g.prims = [
        {
          material: "Mat_T_ground",
          pos: new Float32Array(keep),
          nrm: new Float32Array(keep.length),
        },
        { material: "Mat_Pave", pos: new Float32Array(pave), nrm: new Float32Array(pave.length) },
      ];
      return ps;
    };
    const town = (ps: Part[]) => [
      ...ps,
      { name: "Trade_Test_W_town_house_01", prims: [box("Mat_Town", -2, -2, 0.3, 0.3, 0.3)] },
    ];
    const base = baseTile([
      { name: "Test_rock", prims: [box("Mat_T_prop", 1.02, 0.02, 0.1, 0.1, 0.3)] },
    ]);
    // A clean patch: 0.6 m square, no rock on it.
    const clean = audit(
      composed(base, (ps) =>
        town(
          paint(
            ps.filter((p) => p.name !== "Trade_Test_W_rock"),
            (x, z) => Math.abs(x + 1) < 0.3 && Math.abs(z) < 0.3,
          ),
        ),
      ),
      base,
    );
    expect(clean.paint).toEqual([]);
    expect(clean.painted.patches).toEqual([32]);
    // One triangle's worth on its own is a speck.
    const speck = audit(
      composed(base, (ps) =>
        town(
          paint(
            ps.filter((p) => p.name !== "Trade_Test_W_rock"),
            (x, z) => Math.hypot(x + 1.0, z + 0.1) < 0.02,
          ),
        ),
      ),
      base,
    );
    expect(speck.paint.map((p) => p.kind)).toEqual(["speck"]);
    // A square with one cell left bare is a pinhole.
    const holed = audit(
      composed(base, (ps) =>
        town(
          paint(
            ps.filter((p) => p.name !== "Trade_Test_W_rock"),
            (x, z) =>
              Math.abs(x + 1) < 0.3 && Math.abs(z) < 0.3 && Math.hypot(x + 1.0, z + 0.1) >= 0.02,
          ),
        ),
      ),
      base,
    );
    expect(holed.paint.map((p) => p.kind)).toEqual(["pinhole"]);
    // The rock at (1, 0) on a painted square stands on the paint.
    const onPaint = audit(
      composed(base, (ps) => town(paint(ps, (x, z) => Math.abs(x - 1) < 0.3 && Math.abs(z) < 0.3))),
      base,
    );
    expect(onPaint.paint.map((p) => `${p.kind} ${p.where}`)).toEqual(["on-paint rock"]);
  });
});
