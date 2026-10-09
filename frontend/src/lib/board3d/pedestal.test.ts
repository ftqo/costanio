import { describe, expect, it } from "vitest";
import {
  BREATHE_DEPTH,
  columnGeometry,
  columnMaterial,
  fadeAt,
  FADE_IN_MS,
  FADE_OUT_MS,
  moteSpec,
  motePositions,
  motesGeometry,
  motesMaterial,
  MOTE_DRIFT,
  MOTE_SWARM,
  PEDESTAL_PARTS,
  pedestalClock,
  pedestalFade,
  pedestalGain,
  PEDESTAL_ALPHA,
  PEDESTAL_COLOR,
  PEDESTAL_REST,
  PEDESTAL_SIZE,
  poolGeometry,
  restingForCount,
  REST_FEW,
  REST_MANY,
  poolMaterial,
  rimAlpha,
  rimGeometry,
  rimMaterial,
  seedOf,
} from "./pedestal";
import { MARKER_COLOR, type MarkerKind } from "./markers";

const KINDS: MarkerKind[] = ["vertex", "edge", "hex"];

const spotsAt = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ position: [i, 0, -i] as [number, number, number] }));

describe("the mark's identity", () => {
  it("is the pip's own gold", () => {
    // "Gold means the board is offering you this" is one colour in both styles.
    expect(PEDESTAL_COLOR).toBe(MARKER_COLOR);
  });

  it("stands where the pip stood, near enough not to appear to move", () => {
    for (const kind of KINDS) expect(PEDESTAL_SIZE[kind].pool).toBeGreaterThan(0);
    // The hex is the tile-wide one and the other two are corner-sized: an
    // ordering, not a magic number.
    expect(PEDESTAL_SIZE.hex.pool).toBeGreaterThan(PEDESTAL_SIZE.vertex.pool * 2);
    expect(PEDESTAL_SIZE.edge.pool).toBeLessThan(PEDESTAL_SIZE.vertex.pool);
  });

  it("gives the small spots more brightness than the big one", () => {
    // The knight case: two isolated pools on bright terrain have no crowd to
    // add up with, so they need depth where a tile-wide wash has area.
    expect(PEDESTAL_ALPHA.vertex.pool).toBeGreaterThan(PEDESTAL_ALPHA.hex.pool * 2);
    expect(PEDESTAL_ALPHA.edge.pool).toBeGreaterThan(PEDESTAL_ALPHA.hex.pool);
  });

  it("keeps the column under the piece it is offering", () => {
    // A column taller than the pieces (shortest about 1.5 units) reads as a
    // beam, not a marked spot.
    for (const kind of KINDS) expect(PEDESTAL_SIZE[kind].height).toBeLessThan(1.5);
  });
});

describe("pedestalGain", () => {
  it("is 1 for a caller that named no resting brightness", () => {
    expect(pedestalGain(undefined)).toBe(1);
  });

  it("is the ratio to the brightness the alphas were written for", () => {
    expect(pedestalGain(PEDESTAL_REST)).toBeCloseTo(1);
    expect(pedestalGain(PEDESTAL_REST / 2)).toBeCloseTo(0.5);
    expect(pedestalGain(PEDESTAL_REST * 2)).toBeCloseTo(2);
  });

  it("never goes negative, whatever a caller passes", () => {
    // A negative opacity is a material three won't draw, so the pedestals
    // would just vanish.
    expect(pedestalGain(-1)).toBe(0);
  });

  it("moves every part together, so the mark keeps its proportions", () => {
    const clock = pedestalClock();
    const fade = pedestalFade(1);
    const quiet = PEDESTAL_REST / 2;
    expect(poolMaterial("vertex", clock, fade, quiet).opacity).toBeCloseTo(
      PEDESTAL_ALPHA.vertex.pool / 2,
    );
    // The rim is on a different dial; see rimAlpha.
    expect(rimMaterial("vertex", clock, fade, quiet).opacity).toBeCloseTo(
      rimAlpha("vertex", quiet),
    );
    expect(columnMaterial("vertex", clock, fade, quiet).opacity).toBeCloseTo(
      PEDESTAL_ALPHA.vertex.column / 2,
    );
    expect(motesMaterial("vertex", MOTE_SWARM.vertex, clock, fade, quiet).opacity).toBeCloseTo(
      PEDESTAL_ALPHA.vertex.motes / 2,
    );
  });
});

describe("fadeAt", () => {
  it("starts at nothing and ends at everything", () => {
    expect(fadeAt(0, FADE_IN_MS)).toBe(0);
    expect(fadeAt(-50, FADE_IN_MS)).toBe(0);
    expect(fadeAt(FADE_IN_MS, FADE_IN_MS)).toBe(1);
    expect(fadeAt(FADE_IN_MS * 5, FADE_IN_MS)).toBe(1);
  });

  it("eases in and out rather than ramping", () => {
    // Smoothstep, so it reads as appearing rather than as a dimmer turning.
    const q = fadeAt(FADE_IN_MS * 0.25, FADE_IN_MS);
    const h = fadeAt(FADE_IN_MS * 0.5, FADE_IN_MS);
    expect(h).toBeCloseTo(0.5);
    expect(q).toBeLessThan(0.25);
  });

  it("never leaves the 0..1 range it multiplies alpha by", () => {
    for (let t = -100; t <= FADE_IN_MS + 100; t += 7) {
      const v = fadeAt(t, FADE_IN_MS);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("goes away quicker than it arrives", () => {
    // Going away answers a question already settled; a mark that lingers looks
    // like the board didn't notice.
    expect(FADE_OUT_MS).toBeLessThan(FADE_IN_MS);
  });

  it("is the field's own dial, shared like the clock", () => {
    // One number a frame turns the whole field, however many spots are in it.
    const clock = pedestalClock();
    const fade = pedestalFade();
    expect(fade.value).toBe(0);
    const shaders = [
      poolMaterial("vertex", clock, fade),
      rimMaterial("vertex", clock, fade),
      columnMaterial("vertex", clock, fade),
      motesMaterial("vertex", MOTE_SWARM.vertex, clock, fade),
    ].map((m) => {
      const shader = {
        uniforms: {} as Record<string, unknown>,
        vertexShader: "#include <common>\n#include <begin_vertex>\n#include <project_vertex>\n",
        fragmentShader:
          "#include <common>\n#include <dithering_fragment>\n#include <premultiplied_alpha_fragment>\n",
      };
      m.onBeforeCompile?.(shader as never, null as never);
      return shader;
    });
    for (const s of shaders) expect(s.uniforms.uCostanFade).toBe(fade);
  });
});

describe("restingForCount", () => {
  it("is bright for a few spots and dim for many", () => {
    // Two corners on a bright field need finding; sixty are unmissable and only
    // have to read as a set.
    expect(restingForCount(2)).toBe(REST_FEW);
    expect(restingForCount(60)).toBe(REST_MANY);
    expect(REST_FEW).toBeGreaterThan(REST_MANY);
  });

  it("never gets louder than a few or quieter than many", () => {
    // Flat outside the ends: one spot is no louder than two, and past forty
    // dimming further only makes the field harder to see.
    expect(restingForCount(0)).toBe(REST_FEW);
    expect(restingForCount(1)).toBe(REST_FEW);
    expect(restingForCount(400)).toBe(REST_MANY);
  });

  it("moves monotonically between the two", () => {
    let last = Infinity;
    for (let n = 0; n <= 60; n++) {
      const v = restingForCount(n);
      expect(v).toBeLessThanOrEqual(last + 1e-9);
      last = v;
    }
  });
});

describe("the rim's darkness", () => {
  it("never outruns the light it is edging", () => {
    // As a share of the pool, the rim can't make a louder setting read darker
    // (as a separately scaled dark ring around a saturated pool did).
    for (const kind of KINDS) {
      for (const resting of [undefined, 0.1, PEDESTAL_REST, PEDESTAL_REST * 3]) {
        expect(rimAlpha(kind, resting)).toBeLessThan(
          PEDESTAL_ALPHA[kind].pool * pedestalGain(resting),
        );
      }
    }
  });

  it("stops getting darker once the mark is loud", () => {
    // Past the ceiling the extra loudness goes into the glow.
    expect(rimAlpha("vertex", PEDESTAL_REST * 4)).toBe(rimAlpha("vertex", PEDESTAL_REST * 8));
  });

  it("still fades away with a very quiet mark", () => {
    // A full-strength ring around a faint glow is a dark donut.
    expect(rimAlpha("vertex", 0.02)).toBeLessThan(rimAlpha("vertex", PEDESTAL_REST));
  });
});

describe("the materials", () => {
  it("draw as UI in the scene, never as surfaces in it", () => {
    const clock = pedestalClock();
    const fade = pedestalFade(1);
    for (const kind of KINDS) {
      for (const m of [poolMaterial(kind, clock, fade), columnMaterial(kind, clock, fade)]) {
        // Never in shadow, never hidden by the piece it offers, never graded
        // with the scene.
        expect(m.depthTest).toBe(false);
        expect(m.depthWrite).toBe(false);
        expect(m.toneMapped).toBe(false);
        expect(m.transparent).toBe(true);
      }
    }
  });

  it("makes the rim paint and everything else light", () => {
    const clock = pedestalClock();
    const fade = pedestalFade(1);
    // The one part that can go darker than the ground, which additive blending
    // can't. See RIM_COLOR.
    expect(rimMaterial("vertex", clock, fade).blending).not.toBe(
      poolMaterial("vertex", clock, fade).blending,
    );
    expect(rimMaterial("vertex", clock, fade).color.getHex()).not.toBe(PEDESTAL_COLOR);
  });

  it("gives each patched program its own cache key", () => {
    // Without one, three matches identically configured basic materials by
    // their parameters and hands one the other's shader.
    const clock = pedestalClock();
    const fade = pedestalFade(1);
    const keys = new Set<string>();
    for (const kind of KINDS) {
      keys.add(poolMaterial(kind, clock, fade).customProgramCacheKey());
      keys.add(rimMaterial(kind, clock, fade).customProgramCacheKey());
      keys.add(columnMaterial(kind, clock, fade).customProgramCacheKey());
      keys.add(motesMaterial(kind, MOTE_SWARM[kind], clock, fade).customProgramCacheKey());
    }
    expect(keys.size).toBe(KINDS.length * 4);
  });

  it("starts every injected snippet on its own line", () => {
    // A varying prepended without a trailing newline runs into the shader's
    // first `#include` and fails to compile; directives must begin a line.
    const clock = pedestalClock();
    const fade = pedestalFade(1);
    const seen: string[] = [];
    for (const build of [poolMaterial, rimMaterial, columnMaterial]) {
      const m = build("vertex", clock, fade);
      const shader = {
        uniforms: {} as Record<string, unknown>,
        vertexShader: "#include <common>\nvoid main() {\n#include <project_vertex>\n}",
        fragmentShader: "#include <common>\nvoid main() {\n#include <dithering_fragment>\n}",
      };
      m.onBeforeCompile?.(shader as never, null as never);
      seen.push(shader.vertexShader, shader.fragmentShader);
    }
    for (const src of seen) {
      for (const line of src.split("\n")) {
        const at = line.indexOf("#include");
        if (at < 0) continue;
        expect(line.slice(0, at).trim()).toBe("");
      }
    }
  });

  it("hands every material the same clock object", () => {
    // One uniform write a frame for the whole field, which only holds if they
    // share the object.
    const clock = pedestalClock();
    const fade = pedestalFade(1);
    const shaders = [
      poolMaterial("vertex", clock, fade),
      columnMaterial("vertex", clock, fade),
    ].map((m) => {
      const shader = {
        uniforms: {} as Record<string, unknown>,
        vertexShader: "#include <common>\n#include <project_vertex>\n",
        fragmentShader: "#include <common>\n#include <dithering_fragment>\n",
      };
      m.onBeforeCompile?.(shader as never, null as never);
      return shader;
    });
    for (const s of shaders) expect(s.uniforms.uCostanTime).toBe(clock);
  });
});

describe("the motes", () => {
  it("puts one per spot per count, all at their spot", () => {
    const spots = spotsAt(4);
    const { positions, seeds } = motePositions(spots, 3);
    expect(seeds).toHaveLength(12);
    expect(positions).toHaveLength(36);
    // Motes 0, 1 and 2 belong to spot 0 and start from it; the shader moves
    // them apart.
    for (let k = 0; k < 3; k++) expect(positions[k * 3]).toBe(spots[0].position[0]);
  });

  it("never flies two motes of a spot together", () => {
    // Golden-ratio seeds: consecutive motes land far apart in phase even at a
    // count of 2.
    const { seeds } = motePositions(spotsAt(1), 3);
    const sorted = [...seeds].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(0.2);
  });

  it("gives neighbouring spots different phases", () => {
    // Otherwise every spot runs the same flight and the field pulses as one.
    const { seeds } = motePositions(spotsAt(3), 2);
    expect(seeds[0]).not.toBeCloseTo(seeds[2]);
    expect(seeds[2]).not.toBeCloseTo(seeds[4]);
  });

  it("is deterministic, like everything else this board draws", () => {
    expect(seedOf(5)).toBe(seedOf(5));
    expect(motePositions(spotsAt(2), 2).seeds).toEqual(motePositions(spotsAt(2), 2).seeds);
  });

  it("carries the seed to the shader as an attribute", () => {
    const g = motesGeometry(spotsAt(2), MOTE_SWARM.vertex);
    expect(g.getAttribute("aCostanSeed").count).toBe(2 * MOTE_SWARM.vertex.count);
    expect(g.getAttribute("position").count).toBe(2 * MOTE_SWARM.vertex.count);
  });

  it("gives a corner a swarm and a tile its dust", () => {
    // A vertex has no room for a pool, so the motion is the mark: more motes,
    // bigger, and orbiting.
    expect(MOTE_SWARM.vertex.count).toBeGreaterThan(MOTE_DRIFT.vertex.count * 2);
    expect(MOTE_SWARM.vertex.size).toBeGreaterThan(MOTE_DRIFT.vertex.size * 1.8);
    // Past one full turn per flight, so it reads as an orbit rather than a
    // wandering rising line.
    expect(MOTE_SWARM.vertex.spin).toBeGreaterThan(1);
    expect(MOTE_DRIFT.vertex.spin).toBeLessThan(1);
  });

  it("picks the spec off the style", () => {
    expect(moteSpec("swarm", "vertex")).toBe(MOTE_SWARM.vertex);
    expect(moteSpec("pedestal", "hex")).toBe(MOTE_DRIFT.hex);
  });
});

describe("which parts a style draws", () => {
  it("strips a corner back to nothing but its swarm", () => {
    // A pool and rim shrunk to a corner's size read as a smudge with a dark
    // speck, so `swarm` doesn't draw them.
    expect(PEDESTAL_PARTS.swarm.vertex).toEqual({ pool: false, rim: false, column: false });
    expect(PEDESTAL_PARTS.swarm.edge).toEqual({ pool: false, rim: false, column: false });
  });

  it("leaves the hex unchanged", () => {
    expect(PEDESTAL_PARTS.swarm.hex.pool).toBe(true);
    expect(PEDESTAL_PARTS.swarm.hex.rim).toBe(true);
    expect(PEDESTAL_PARTS.pedestal.hex.pool).toBe(true);
  });

  it("never stands a column on a tile", () => {
    // Tile-sized, it is a chimney that buries the tile.
    expect(PEDESTAL_PARTS.pedestal.hex.column).toBe(false);
    expect(PEDESTAL_PARTS.swarm.hex.column).toBe(false);
  });
});

describe("the geometry", () => {
  it("lays pool and rim flat and stands the column on them", () => {
    for (const kind of KINDS) {
      const pool = poolGeometry(kind);
      pool.computeBoundingBox();
      // Flat: no height at all.
      expect(pool.boundingBox!.max.y - pool.boundingBox!.min.y).toBeCloseTo(0);

      const rim = rimGeometry(kind);
      rim.computeBoundingBox();
      expect(rim.boundingBox!.max.y - rim.boundingBox!.min.y).toBeCloseTo(0);

      const column = columnGeometry(kind);
      column.computeBoundingBox();
      // Standing on the spot rather than centred through it, or half the light
      // is under the board.
      expect(column.boundingBox!.min.y).toBeCloseTo(0);
      expect(column.boundingBox!.max.y).toBeCloseTo(PEDESTAL_SIZE[kind].height);
    }
  });

  it("keeps the rim inside the pool it edges", () => {
    for (const kind of KINDS) {
      const pool = poolGeometry(kind);
      const rim = rimGeometry(kind);
      pool.computeBoundingSphere();
      rim.computeBoundingSphere();
      expect(rim.boundingSphere!.radius).toBeLessThanOrEqual(pool.boundingSphere!.radius + 1e-6);
    }
  });
});

describe("the breathe", () => {
  it("stays a shimmer rather than a blink", () => {
    // Sixty spots blinking is an alarm. Shallow depth keeps the motion
    // peripheral.
    expect(BREATHE_DEPTH).toBeGreaterThan(0);
    expect(BREATHE_DEPTH).toBeLessThan(0.35);
  });
});
