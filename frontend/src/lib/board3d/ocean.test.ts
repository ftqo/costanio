import { test, expect, beforeEach } from "vitest";
import * as THREE from "three";
import {
  HULL_SINK,
  BAKED_CREST_Y,
  BAKED_RELIEF,
  BAKED_TROUGH_Y,
  OCEAN_BAKED_MAX_Y,
  OCEAN_BAKED_MEAN_Y,
  OCEAN_BAKED_MIN_Y,
  OCEAN_HULL_MATERIAL,
  OCEAN_HULL_TOP_Y,
  OCEAN_MAX_Y,
  OCEAN_MEAN_Y,
  OCEAN_MIN_Y,
  OCEAN_WATER_MATERIAL,
  PIER_DECK_Y,
  SHORE_CLEARANCE,
  SHORE_FOOT_CLEARANCE,
  OCEAN_ART_SCALE,
  OCEAN_ART_HEIGHTS,
  HULL_SINK_LOCAL,
  PIER_SHORE_GAP,
  OCEAN_CREST_CEILING,
  WAVE_RISE,
  WAVE_DROP,
  WAVE_FALL,
  WAVE_AMPLITUDE,
  WAVE_MAX_AMPLITUDE,
  WAVE_MODES,
  WAVE_TRAINS,
  OCEAN_FADE_OFF,
  OCEAN_FLAT_Y,
  OCEAN_ANNULUS_SEGMENTS,
  OCEAN_ART_VERTEX_PITCH,
  OCEAN_VERTEX_PITCH,
  OCEAN_SAMPLES_PER_WAVE,
  OCEAN_MIN_WAVELENGTH,
  OCEAN_GRAVITY,
  OCEAN_CLOCK_HZ,
  OCEAN_MAX_PHASE_STEP,
  OCEAN_MAX_WAVE_SPEED,
  DETAIL_TRAINS,
  DETAIL_FADE,
  annulusMaterial,
  applyOceanWave,
  applyWaterLook,
  currentOceanFade,
  detailFade,
  dressOcean,
  oceanAnnulusGeometry,
  oceanCrest,
  oceanDetailGLSL,
  oceanDetailSlope,
  oceanFade,
  oceanFragmentChunks,
  oceanUnit,
  setOceanCrest,
  setOceanFade,
  oceanSlope,
  oceanSurfaceY,
  oceanTime,
  oceanWave,
  oceanWaveChunks,
  oceanWaveGLSL,
  reflectSky,
  seaCastsShadow,
  setOceanTime,
  sinkOceanHull,
  splitOceanSurface,
  waveLength,
} from "./ocean";
import { OCEAN_ENV_INTENSITY, oceanSky } from "./oceanEnv";
import { BOARD_LOOKS } from "./boardTheme";
import { LATTICE_SCALE } from "./coords";
import {
  BEACH_FOOT_Y,
  BEACH_REACH,
  BEACH_SHAPE,
  BEACH_TUCK,
  BEACH_WET_TOP_Y,
  beachProfileU,
  beachProfileY,
  TOP_Y,
  WATER_Y,
} from "./beachGeometry";
import { SHORE_SMOOTH } from "./shoreCurve";
import type { LoadedAsset } from "./loader";

beforeEach(() => {
  setOceanTime(0);
  setOceanFade(OCEAN_FADE_OFF);
});

/** A stand-in for a loaded water tile: hull, with the wave sheet parented to it. */
function waterAsset(extra: string[] = []): LoadedAsset & { hull: THREE.Mesh; waves: THREE.Mesh } {
  const scene = new THREE.Group();
  const byMaterial = new Map<string, THREE.Mesh[]>();
  const mesh = (name: string, material: string) => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name }));
    m.material.name = material;
    m.name = name;
    byMaterial.set(material, [...(byMaterial.get(material) ?? []), m]);
    return m;
  };
  const hull = mesh("Hex_Ocean", OCEAN_HULL_MATERIAL);
  hull.position.y = -0.05;
  const waves = mesh("Ocean_waves", OCEAN_WATER_MATERIAL);
  waves.position.y = 0.05;
  hull.add(waves);
  for (const name of extra) {
    const child = mesh(`Port_${name}`, `Mat_Port_${name}`);
    hull.add(child);
  }
  scene.add(hull);
  scene.updateMatrixWorld(true);
  return { scene, byMaterial, hull, waves };
}

test("the hull's top face sits below the deepest trough", () => {
  // The shipped tile has its hull top at 0.150 and baked troughs at 0.145, so
  // an unsunk hull shows through in every trough. Sink and amplitude are both
  // derived from these numbers, so this holds however either is retuned.
  expect(OCEAN_BAKED_MIN_Y).toBeLessThan(OCEAN_HULL_TOP_Y);
  expect(OCEAN_HULL_TOP_Y - HULL_SINK).toBeLessThan(OCEAN_MIN_Y);
  // ...by enough for the depth buffer to separate them at whole-board framing.
  expect(OCEAN_MIN_Y - (OCEAN_HULL_TOP_Y - HULL_SINK)).toBeGreaterThan(0.02);
});

test("the swell stays inside the range its limits were chosen against", () => {
  let lowest = Infinity;
  let highest = -Infinity;
  for (let t = 0; t < 40; t += 0.37) {
    for (let x = -30; x <= 30; x += 0.31) {
      for (let z = -30; z <= 30; z += 0.53) {
        const h = oceanWave(x, z, t);
        lowest = Math.min(lowest, h);
        highest = Math.max(highest, h);
      }
    }
  }
  // The sheet is sunk by WAVE_DROP and the swell rides symmetrically on that.
  expect(highest).toBeLessThanOrEqual(WAVE_AMPLITUDE - WAVE_DROP);
  expect(lowest).toBeGreaterThanOrEqual(-WAVE_AMPLITUDE - WAVE_DROP);
  // Both ends are reached, measured on the surface a vertex really lands on:
  // `BAKED_RELIEF` flattens the sheet toward the mean first, so the extremes
  // are the flattened crest and trough.
  let top = -Infinity;
  let bottom = Infinity;
  for (let t = 0; t < 40; t += 0.37) {
    for (let x = -30; x <= 30; x += 0.31) {
      for (let z = -30; z <= 30; z += 0.53) {
        top = Math.max(top, oceanSurfaceY(OCEAN_BAKED_MAX_Y, x, z, t));
        bottom = Math.min(bottom, oceanSurfaceY(OCEAN_BAKED_MIN_Y, x, z, t));
      }
    }
  }
  expect(top).toBeCloseTo(OCEAN_MAX_Y, 2);
  expect(bottom).toBeCloseTo(OCEAN_MIN_Y, 2);
});

test("no wave ever runs up onto the dry sand", () => {
  // The ceiling. The light sand band lies flat at TOP_Y and the dark one
  // shelves down to WATER_Y; water at or above TOP_Y stands on the dry apron.
  // Asserted both ways: the ceiling is the sand's, and the crest stays under
  // it. An inequality, because the amplitude is chosen (see WAVE_AMPLITUDE),
  // not derived to land on the ceiling.
  expect(OCEAN_CREST_CEILING).toBe(TOP_Y - SHORE_CLEARANCE);
  expect(OCEAN_MAX_Y).toBeLessThanOrEqual(OCEAN_CREST_CEILING);
  expect(OCEAN_MAX_Y).toBeLessThan(TOP_Y);
  expect(TOP_Y - OCEAN_MAX_Y).toBeGreaterThanOrEqual(SHORE_CLEARANCE - 1e-12);
  // ...with real headroom, stated against the clearance rather than pinned,
  // since the beach crest and the amplitude are both tuned by eye.
  expect(OCEAN_CREST_CEILING - OCEAN_MAX_Y).toBeGreaterThan(SHORE_CLEARANCE);
});

test("the swell's whole travel lands on sand, up and back down", () => {
  // The same check against the beach's own profile: where the waterline lands
  // on the coast. The crest lands at 0.16 of the way across and the trough at
  // 0.68, so the wash sweeps half the beach with sand at both ends. Measured as
  // fractions of the reach, which is itself a tuning knob.
  const up = beachProfileU(OCEAN_MAX_Y);
  const rest = beachProfileU(OCEAN_MEAN_Y);
  const down = beachProfileU(OCEAN_MIN_Y);
  expect(up).toBeGreaterThan(0); // it never reaches the crest itself
  expect(down).toBeLessThan(1); // and never reaches the foot either
  expect(up).toBeLessThan(rest);
  expect(rest).toBeLessThan(down);
  expect(down - up, "the wash travels").toBeGreaterThan(0.25);
  expect(rest - up, "up from the mean").toBeGreaterThan(0.1);
  expect(down - rest, "down from the mean").toBeGreaterThan(0.1);

  // The band a player typically sees is the RMS one, narrower than the
  // extremes above (which need all trains to agree). With four trains it is
  // 0.36 of the amplitude: the RMS of independent sines is the root of the sum
  // of squared weights. It comes out at about a tenth of the sand's width.
  const rms = Math.sqrt(WAVE_TRAINS.reduce((a, w) => a + w.weight ** 2, 0) / 2);
  const swash =
    beachProfileU(OCEAN_MEAN_Y - WAVE_AMPLITUDE * rms) -
    beachProfileU(OCEAN_MEAN_Y + WAVE_AMPLITUDE * rms);
  expect(rms).toBeCloseTo(0.36, 2);
  expect(swash, "the wet line moves").toBeGreaterThan(0.03);
  expect(swash, "the wet line stays within the beach").toBeLessThan(0.2);

  // The mean waterline is the beach's own `WATER_Y`, by construction: it is
  // `SURFACE.sea` and the board is cut against it.
  expect(OCEAN_MEAN_Y).toBeCloseTo(WATER_Y, 12);
  expect(beachProfileY(beachProfileU(OCEAN_MEAN_Y))).toBeCloseTo(OCEAN_MEAN_Y, 9);
});

test("the deepest trough still has sand under it", () => {
  // The floor. The sand ends at BEACH_FOOT_Y and drops as a wall below it, so
  // a trough below the foot would expose a bright band of sand round the
  // island. Written as an identity so it needn't change when the water is
  // retuned.
  expect(BEACH_FOOT_Y).toBeLessThan(OCEAN_MIN_Y);
  expect(SHORE_FOOT_CLEARANCE).toBeCloseTo(OCEAN_MIN_Y - BEACH_FOOT_Y, 12);
  expect(SHORE_FOOT_CLEARANCE).toBeCloseTo(BAKED_TROUGH_Y - WAVE_AMPLITUDE - BEACH_FOOT_Y, 12);
  // ...and the flattened sheet is what that trough belongs to, not the art's.
  expect(BAKED_TROUGH_Y).toBeCloseTo(
    OCEAN_FLAT_Y + BAKED_RELIEF * (OCEAN_BAKED_MIN_Y - WAVE_DROP - OCEAN_FLAT_Y),
    12,
  );
  expect(SHORE_FOOT_CLEARANCE).toBeGreaterThan(0.01);
});

test("every point of the sea, sampled, stays under the dry sand", () => {
  // The analytic bound above relies on `oceanUnit` staying in -1..1, a property
  // of the weights, so sample the real function too: the baked relief plus the
  // swell (see DISPLACE_SURFACE), with the relief never above OCEAN_BAKED_MAX_Y.
  let highest = -Infinity;
  for (let t = 0; t < 40; t += 0.37) {
    for (let x = -30; x <= 30; x += 0.31) {
      for (let z = -30; z <= 30; z += 0.53) {
        highest = Math.max(highest, OCEAN_BAKED_MAX_Y + oceanWave(x, z, t));
      }
    }
  }
  expect(highest).toBeLessThan(TOP_Y);
  expect(highest).toBeLessThanOrEqual(OCEAN_CREST_CEILING + 1e-12);
});

test("no wave ever washes over a harbour pier", () => {
  // No longer the binding limit (the sand at 0.250 is 0.033 below the deck),
  // but it takes over if the coast's profile is recut higher.
  expect(OCEAN_MAX_Y).toBeLessThan(PIER_DECK_Y);
  expect(OCEAN_CREST_CEILING).toBeLessThan(PIER_DECK_Y);
  // The deck is art, drawn at the tile's scale; 0.270 off the .glb would be
  // 4.8% low.
  expect(PIER_DECK_Y).toBeCloseTo(0.27 * OCEAN_ART_SCALE, 12);
});

test("the pier still comes down on sand at the height it always did", () => {
  // The deck's landward end stops 0.027 short of the lattice line, where the
  // ribbon's crest is, and the ribbon runs BEACH_TUCK further back under the
  // gutter, so the ramp lands on sand rather than on the seam.
  expect(PIER_SHORE_GAP).toBeGreaterThan(0);
  expect(PIER_SHORE_GAP).toBeLessThan(BEACH_TUCK);
  expect(beachProfileY(PIER_SHORE_GAP / BEACH_REACH)).toBeCloseTo(TOP_Y, 2);

  // The deck's underside ramps from 0.283 at the shore down to 0.173; the
  // ribbon has fallen to 0.216 by 0.24 out and keeps falling, so the sand stays
  // under the planks.
  const underside = (t: number) => 0.283 - (0.11 * t) / 3.35;
  for (let t = 0.1; t < BEACH_REACH; t += 0.05) {
    expect(beachProfileY(t / BEACH_REACH), `sand under the deck at ${t}`).toBeLessThan(
      underside(t),
    );
  }
});

test("the art's own heights are art heights, and the board scales them", () => {
  // A sea tile fills a whole lattice cell and its instance scale is uniform,
  // so heights measured in the .glb must be scaled. Unscaled, `TOP_Y - 0.01`
  // is really `TOP_Y - 0.0002`: the crest meets the dry sand and depth-fights.
  expect(OCEAN_ART_SCALE).toBeCloseTo(LATTICE_SCALE, 12);
  expect(OCEAN_ART_SCALE).toBeGreaterThan(1);
  expect(OCEAN_BAKED_MAX_Y).toBeCloseTo(OCEAN_ART_HEIGHTS.max * OCEAN_ART_SCALE, 12);

  // What the unscaled arithmetic would draw.
  const drawnCrest = OCEAN_ART_HEIGHTS.max * OCEAN_ART_SCALE + 0.035;
  expect(drawnCrest).toBeCloseTo(0.2499, 4);
  expect(TOP_Y - drawnCrest, "unscaled clearance").toBeLessThan(0.001);
  // And what it draws now: 0.032 of sand above the highest possible crest. The
  // clearance is a floor under the headroom, not the headroom itself.
  expect(TOP_Y - OCEAN_MAX_Y).toBeGreaterThan(2 * SHORE_CLEARANCE);
});

test("the two clearances bound the amplitude", () => {
  // The amplitude is picked by eye; spending every thousandth of the
  // clearances made the swell overwhelm the detail trains. The clearances are
  // limits.
  expect(WAVE_AMPLITUDE).toBeGreaterThan(0);

  // The budget is still derived: the most swell that fits is the smaller of
  // the room above the flattened crests and the room below the troughs.
  expect(WAVE_RISE).toBeCloseTo(OCEAN_CREST_CEILING - BAKED_CREST_Y, 12);
  expect(WAVE_FALL).toBeCloseTo(BAKED_TROUGH_Y - BEACH_FOOT_Y, 12);
  expect(WAVE_DROP).toBeCloseTo(OCEAN_BAKED_MEAN_Y - WATER_Y, 12);
  expect(WAVE_MAX_AMPLITUDE).toBeCloseTo(Math.min(WAVE_RISE, WAVE_FALL), 12);
  // Both fences are positive once the sheet is flattened to `BAKED_RELIEF`
  // (crests down to 0.143), so the binding one is the smaller, not the sum.
  expect(WAVE_RISE).toBeGreaterThan(0);
  expect(WAVE_FALL).toBeGreaterThan(0);
  // ...and within a few thousandths of each other, since flattening narrows
  // both.
  expect(Math.abs(WAVE_RISE - WAVE_FALL)).toBeLessThan(0.005);
  // About 0.062 at `BAKED_RELIEF` 0.45, comfortably above the chosen
  // amplitude.
  expect(WAVE_MAX_AMPLITUDE).toBeGreaterThan(0);
  expect(WAVE_MAX_AMPLITUDE).toBeGreaterThan(WAVE_AMPLITUDE);

  // The chosen number is inside the derived one, so a beach recut shallower
  // fails here rather than quietly making 0.03 illegal.
  expect(WAVE_AMPLITUDE).toBeLessThanOrEqual(WAVE_MAX_AMPLITUDE);
  expect(OCEAN_MAX_Y).toBeLessThanOrEqual(OCEAN_CREST_CEILING);

  // ...and the floor's bound, the slacker of the two: the trough may fall to
  // BEACH_FOOT_Y and no further, which allows 0.096.
  expect(WAVE_FALL).toBeGreaterThanOrEqual(WAVE_AMPLITUDE);

  // The sink must be positive, or the mean misses the board's sea level.
  expect(WAVE_DROP).toBeGreaterThan(0);
});

test("the mean water line stays where the coastline expects the sea", () => {
  // An input, not a fence: `WATER_Y` is `SURFACE.sea` (where ships float, where
  // the annulus lies, what the board is cut against), and the downward half of
  // the swell is whatever puts the mean exactly there.
  expect(OCEAN_MEAN_Y).toBeCloseTo(WATER_Y, 12);
  expect(WAVE_DROP).toBeGreaterThan(0);
  expect(OCEAN_MEAN_Y).toBeCloseTo(OCEAN_BAKED_MEAN_Y - WAVE_DROP, 12);
  // Independent of the amplitude: sinking by a constant means retuning the
  // waves can't move the height ships float at.
  expect(OCEAN_MEAN_Y).toBeGreaterThan(OCEAN_MIN_Y);
  expect(OCEAN_MEAN_Y).toBeLessThan(OCEAN_MAX_Y);
});

test("the swell stays subtle", () => {
  // A cap on the swell's own peak-to-trough: a larger swell read as a second,
  // separate wave under the detail trains.
  expect(2 * WAVE_AMPLITUDE).toBeLessThanOrEqual(0.07);

  // Under the baked relief as cut: the swell adds less shape than the art.
  const baked = OCEAN_BAKED_MAX_Y - OCEAN_BAKED_MIN_Y;
  expect(2 * WAVE_AMPLITUDE).toBeLessThan(baked);

  // But more than the relief as drawn: `BAKED_RELIEF` leaves 0.028 of range and
  // the swell's 0.06 is over twice that, so the short trains are the texture.
  expect(BAKED_RELIEF * baked).toBeLessThan(2 * WAVE_AMPLITUDE);
  expect(OCEAN_MAX_Y - OCEAN_MIN_Y).toBeCloseTo(BAKED_RELIEF * baked + 2 * WAVE_AMPLITUDE, 12);
  expect(OCEAN_MAX_Y - OCEAN_MIN_Y).toBeGreaterThan(BAKED_RELIEF * baked);
});

test("the swell is a function of world position, so neighbouring tiles agree", () => {
  // Two tiles a lattice apart evaluate the same world point and must agree, or
  // the shared edge tears. Guards against tile-local evaluation.
  const shared: [number, number] = [7.3, -4.1];
  expect(oceanWave(shared[0], shared[1], 3)).toBe(oceanWave(shared[0], shared[1], 3));
  // So the shader must get a world position; `position` alone is local.
  const chunks = oceanWaveChunks("surface");
  const preamble = chunks["#include <beginnormal_vertex>"];
  expect(preamble).toContain("modelMatrix * instanceMatrix");
  expect(preamble).toContain("oceanModel * vec4(position, 1.0)");
});

test("a boat takes the swell at its own origin, and keeps its normals", () => {
  const float = oceanWaveChunks("float");
  // The instance's translation column: one height for the whole boat, so it
  // rides the water rather than being bent by it.
  expect(float["#include <beginnormal_vertex>"]).toContain("oceanModel[3].xz");
  expect(float["#include <beginnormal_vertex>"]).not.toContain("objectNormal");
  // It moves by the faded swell only. The surface's flattening term would sink
  // a boat to the waterline.
  const displace = float["#include <begin_vertex>"];
  expect(displace).toContain("transformed.y += oceanF * costanOceanWave(oceanAt)");
  expect(displace).not.toContain("oceanWorld");
});

test("the surface tilts its normals, or the extra amplitude does not shade", () => {
  const surface = oceanWaveChunks("surface");
  expect(surface["#include <beginnormal_vertex>"]).toContain("objectNormal = normalize");
  expect(surface["#include <beginnormal_vertex>"]).toContain("costanOceanSlope");
});

test("the shader is generated from the same trains the maths uses", () => {
  const glsl = oceanWaveGLSL();
  expect(glsl).toContain("uniform float uOceanTime;");
  for (const w of WAVE_TRAINS) {
    expect(glsl).toContain(w.freq.toFixed(6));
    expect(glsl).toContain(w.speed.toFixed(6));
    expect(glsl).toContain(w.dir[0].toFixed(6));
  }
  // One sine per train and no more, so a train cannot be dropped silently.
  expect(glsl.match(/sin\(/g) ?? []).toHaveLength(WAVE_TRAINS.length);
  expect(glsl.match(/cos\(/g) ?? []).toHaveLength(WAVE_TRAINS.length);
});

test("the tuned sea fits the beach", () => {
  // The chosen water (see the header of `ocean.ts`), pinned so a retune is a
  // conscious change: four short sine trains, a sheet flattened to 0.45, and
  // an amplitude of 0.03.
  expect(WAVE_AMPLITUDE).toBe(0.03);
  expect(BAKED_RELIEF).toBe(0.45);
  expect(WAVE_TRAINS).toHaveLength(4);
  expect(WAVE_TRAINS.map((w) => Number(waveLength(w).toFixed(2)))).toEqual([4.3, 3.5, 3.0, 2.78]);
  expect(WAVE_TRAINS.map((w) => w.weight)).toEqual([0.28, 0.27, 0.25, 0.2]);
  expect(DETAIL_TRAINS).toHaveLength(3);
  expect(DETAIL_TRAINS.map((d) => Number(((2 * Math.PI) / d.freq).toFixed(2)))).toEqual([
    1.0, 0.6, 0.38,
  ]);
  expect(DETAIL_TRAINS.map((d) => d.slope)).toEqual([0.08, 0.06, 0.042]);

  // ...and the beach it was chosen against. If one of these moves, the sea was
  // judged against a different coast.
  expect([TOP_Y, BEACH_FOOT_Y, BEACH_REACH, BEACH_SHAPE, BEACH_TUCK, BEACH_WET_TOP_Y]).toEqual([
    0.215, 0.05, 1.6, 0.9, 0.03, 0.15,
  ]);
  expect(SHORE_SMOOTH).toBe(1.4);
});

test("the sheet stays inside the fence at every point and time", () => {
  // The fence proved over the surface: `oceanSurfaceY` is the twin of
  // `DISPLACE_SURFACE`, and sweeping `bakedY` across the sheet's measured range
  // covers every vertex. Sampling also catches a train weight that breaks the
  // sum.
  let highest = -Infinity;
  let lowest = Infinity;
  for (let t = 0; t < 40; t += 0.37) {
    for (let x = -30; x <= 30; x += 0.29) {
      for (let z = -30; z <= 30; z += 0.47) {
        for (const baked of [OCEAN_BAKED_MIN_Y, OCEAN_BAKED_MEAN_Y, OCEAN_BAKED_MAX_Y]) {
          const y = oceanSurfaceY(baked, x, z, t);
          highest = Math.max(highest, y);
          lowest = Math.min(lowest, y);
        }
      }
    }
  }
  expect(highest).toBeLessThanOrEqual(OCEAN_CREST_CEILING);
  expect(highest).toBeLessThan(TOP_Y);
  expect(lowest).toBeGreaterThan(BEACH_FOOT_Y);
  // ...and the mean stays where the board is cut, at every relief mix, because
  // the sheet is flattened toward it.
  expect(
    oceanSurfaceY(OCEAN_BAKED_MEAN_Y, 0, 0, 0) - WAVE_AMPLITUDE * oceanUnit(0, 0, 0),
  ).toBeCloseTo(WATER_Y, 12);
});

test("the trains sum to one, which is what bounds the amplitude", () => {
  expect(WAVE_TRAINS.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1, 9);
  for (const w of WAVE_TRAINS) {
    expect(Math.hypot(w.dir[0], w.dir[1])).toBeCloseTo(1, 3);
  }
});

test("the vertex pitch is the art's, at the sea's draw scale", () => {
  // A sea tile is drawn a whole lattice cell wide, so the sampling spacing
  // differs from the art's; every wavelength is fenced against it.
  expect(OCEAN_VERTEX_PITCH).toBeCloseTo(OCEAN_ART_VERTEX_PITCH * LATTICE_SCALE, 12);
  expect(OCEAN_VERTEX_PITCH).toBeCloseTo(0.4538, 3);
  expect(OCEAN_MIN_WAVELENGTH).toBeCloseTo(OCEAN_SAMPLES_PER_WAVE * OCEAN_VERTEX_PITCH, 12);
});

test("every swell train is one the mesh can carry", () => {
  // Every train needs at least six samples a period; fewer is aliasing that
  // crawls with the camera.
  for (const w of WAVE_TRAINS) {
    const lambda = waveLength(w);
    expect(lambda, `train ${lambda}`).toBeGreaterThanOrEqual(OCEAN_MIN_WAVELENGTH);
    expect(lambda / OCEAN_VERTEX_PITCH).toBeGreaterThanOrEqual(OCEAN_SAMPLES_PER_WAVE);
  }
});

test("the detail layer carries most of the water's slope", () => {
  // Slope is what shades. It is budgeted on the detail layer, which costs no
  // height headroom, and measured through `oceanDetailSlope` (the fragment
  // shader's path) at a pixel fine enough that nothing has faded.
  let peak = 0;
  for (let x = -6; x <= 6; x += 0.11) {
    for (let z = -6; z <= 6; z += 0.13) {
      const [gx, gz] = oceanDetailSlope(x, z, 1.3, 1e-4);
      peak = Math.max(peak, Math.hypot(gx, gz));
    }
  }
  // 6.5 degrees as tuned.
  expect((Math.atan(peak) * 180) / Math.PI).toBeGreaterThan(4);
  // Its ceiling is the three trains' slopes added, which they reach only where
  // all three agree: 8.9 degrees.
  const bound = DETAIL_TRAINS.reduce((s, d) => s + d.slope, 0);
  expect(peak).toBeLessThanOrEqual(bound + 1e-12);
  expect((Math.atan(bound) * 180) / Math.PI).toBeGreaterThan(5);

  // ...and the swell's own slope is a fraction of it: the swell is the shape,
  // the detail is the shading.
  const swell = WAVE_AMPLITUDE * WAVE_TRAINS.reduce((s, w) => s + w.weight * w.freq, 0);
  expect((Math.atan(swell) * 180) / Math.PI).toBeLessThan(4);
  expect(bound / swell, "the detail carries the shading").toBeGreaterThan(2.5);
});

test("the trains travel at the speed water of their length travels at", () => {
  // Deep-water dispersion, omega = sqrt(g k). Hand-picked speeds read as
  // separate sheets sliding over each other.
  for (const w of [...WAVE_TRAINS, ...DETAIL_TRAINS]) {
    expect(w.speed).toBeCloseTo(Math.sqrt(OCEAN_GRAVITY * w.freq), 9);
    // Long outruns short, in phase velocity (what you watch).
    expect(w.speed / w.freq).toBeLessThan(2);
  }
});

test("no train outruns the clock that samples it", () => {
  // The temporal half of OCEAN_SAMPLES_PER_WAVE: no train may advance more
  // than OCEAN_MAX_PHASE_STEP per frame. The bound is derived from the clock.
  for (const w of [...WAVE_TRAINS, ...DETAIL_TRAINS]) {
    expect(w.speed / OCEAN_CLOCK_HZ).toBeLessThanOrEqual(OCEAN_MAX_PHASE_STEP);
    expect(w.speed).toBeLessThanOrEqual(OCEAN_MAX_WAVE_SPEED);
  }
});

test("the clock's ceiling belongs to the shortest train, not the swell", () => {
  // Dispersion puts the highest frequency on the shortest wave, so raising
  // OCEAN_GRAVITY hits the clock on the finest ripple first, at any gravity.
  // Headroom is not asserted: how fast looks right is a judgement.
  const fastest = [...WAVE_TRAINS, ...DETAIL_TRAINS].reduce((a, b) => (a.speed > b.speed ? a : b));
  // Not `waveLength`, which takes a WaveTrain: this is the union of both tables.
  expect((2 * Math.PI) / fastest.freq).toBeCloseTo(0.38, 6);
  const byLength = [...WAVE_TRAINS].sort((a, b) => waveLength(b) - waveLength(a));
  for (let i = 1; i < byLength.length; i++) {
    expect(byLength[i - 1].speed / byLength[i - 1].freq).toBeGreaterThan(
      byLength[i].speed / byLength[i].freq,
    );
  }
});

test("no two trains in a stack run nearly along the same crest line", () => {
  // Two nearly parallel sines beat at a wavelength neither has, and read as a
  // corrugated roof. Measured as lines: a train and its reverse are the same.
  const lineAngle = (dir: readonly [number, number]) =>
    ((Math.atan2(dir[1], dir[0]) * 180) / Math.PI + 360) % 180;
  for (const stack of [WAVE_TRAINS, DETAIL_TRAINS]) {
    for (let i = 0; i < stack.length; i++) {
      for (let j = i + 1; j < stack.length; j++) {
        const raw = Math.abs(lineAngle(stack[i].dir) - lineAngle(stack[j].dir));
        expect(Math.min(raw, 180 - raw), `${i} vs ${j}`).toBeGreaterThan(30);
      }
    }
    // ...and nothing parallel to a lattice axis, which would line crests up
    // with the tile seams.
    for (const w of stack) {
      for (const axis of [0, 30, 60, 90, 120, 150]) {
        expect(Math.abs(lineAngle(w.dir) - axis)).toBeGreaterThan(4);
      }
    }
  }
});

test("the detail trains are exactly those the mesh cannot carry", () => {
  // Detail trains are sampled per pixel, so they hold wavelengths too short
  // for the mesh. One long enough for the mesh belongs in the mesh.
  for (const d of DETAIL_TRAINS) {
    expect((2 * Math.PI) / d.freq).toBeLessThan(OCEAN_MIN_WAVELENGTH);
    expect(Math.hypot(d.dir[0], d.dir[1])).toBeCloseTo(1, 3);
    expect(d.slope).toBeGreaterThan(0);
  }
});

test("the detail adds no height", () => {
  // Every limit on the water (pier deck, beach lip) is a height limit; a
  // slope-only term spends none of it. So `DETAIL_TRAINS` must not appear in
  // `oceanWave`, and `oceanSlope` stays its true gradient (boats sit on it).
  const before = oceanWave(3.1, -2.4, 5);
  const [gx, gz] = oceanSlope(3.1, -2.4, 5);
  const [dx, dz] = oceanDetailSlope(3.1, -2.4, 5, 0.01);
  expect(Math.hypot(dx, dz)).toBeGreaterThan(0.001); // it is doing something
  expect(oceanWave(3.1, -2.4, 5)).toBe(before);
  const h = 1e-5;
  expect(gx).toBeCloseTo((oceanWave(3.1 + h, -2.4, 5) - oceanWave(3.1 - h, -2.4, 5)) / (2 * h), 5);
  expect(gz).toBeCloseTo((oceanWave(3.1, -2.4 + h, 5) - oceanWave(3.1, -2.4 - h, 5)) / (2 * h), 5);
});

test("a detail train fades out before it can alias", () => {
  // A sub-pixel wave doesn't vanish, it aliases into crawling static.
  for (const d of DETAIL_TRAINS) {
    const lambda = (2 * Math.PI) / d.freq;
    expect(detailFade(lambda, lambda * 0.05)).toBe(1); // plenty of pixels: full strength
    expect(detailFade(lambda, lambda * 0.5)).toBe(0); // past Nyquist: gone
    expect(detailFade(lambda, lambda * 0.325)).toBeCloseTo(0.5, 6);
  }
  // Smoothstepped, so there is no ring on the water where the threshold lands
  // (as with `oceanFade`).
  const slope = (px: number) => (detailFade(1, px + 1e-4) - detailFade(1, px - 1e-4)) / 2e-4;
  const middle = Math.abs(slope((DETAIL_FADE.begin + DETAIL_FADE.end) / 2));
  expect(Math.abs(slope(DETAIL_FADE.begin + 1e-3))).toBeLessThan(middle * 0.05);
  expect(Math.abs(slope(DETAIL_FADE.end - 1e-3))).toBeLessThan(middle * 0.05);
  // Monotone: more pixels never means less wave.
  let last = 1;
  for (let px = 0; px < 0.6; px += 0.01) {
    const here = detailFade(1, px);
    expect(here).toBeLessThanOrEqual(last + 1e-12);
    last = here;
  }
});

test("the slope matches the height it is supposed to be the gradient of", () => {
  // A gradient that doesn't match the displacement shades some other water.
  const h = 1e-4;
  for (const [x, z, t] of [
    [0, 0, 0],
    [3.2, -1.7, 2.5],
    [-8.4, 6.1, 11],
  ]) {
    const [gx, gz] = oceanSlope(x, z, t);
    expect(gx).toBeCloseTo((oceanWave(x + h, z, t) - oceanWave(x - h, z, t)) / (2 * h), 6);
    expect(gz).toBeCloseTo((oceanWave(x, z + h, t) - oceanWave(x, z - h, t)) / (2 * h), 6);
  }
});

test("the water moves", () => {
  const still = oceanWave(2, 3, 0);
  expect(oceanWave(2, 3, 2)).not.toBeCloseTo(still, 4);
});

// --- the fade, and the flat sea past it ----------------------------------

const band = { inner: 30, outer: 40 };

test("the swell is whole near the island and gone past the band", () => {
  expect(oceanFade(0, 0, band)).toBe(1);
  expect(oceanFade(29.9, 0, band)).toBe(1);
  expect(oceanFade(0, 40.1, band)).toBe(0);
  // The annulus starts at `outer`, so the water there must be exactly flat;
  // any residue is a step between the surfaces.
  expect(oceanFade(40, 0, band)).toBe(0);
});

test("the fade is radial and monotone, so it leaves no ring on the water", () => {
  let last = 1;
  for (let r = 28; r <= 42; r += 0.25) {
    const here = oceanFade(r * Math.cos(0.7), r * Math.sin(0.7), band);
    expect(here, `r=${r}`).toBeLessThanOrEqual(last + 1e-12);
    // The same radius fades the same in every direction.
    expect(oceanFade(r, 0, band)).toBeCloseTo(here, 9);
    last = here;
  }
});

test("the fade has no corner at either end of the band", () => {
  // A linear ramp shows two circles where its slope breaks; smoothstep is flat
  // at both ends.
  const slope = (r: number) => (oceanFade(r + 1e-3, 0, band) - oceanFade(r - 1e-3, 0, band)) / 2e-3;
  expect(Math.abs(slope(band.inner + 0.05))).toBeLessThan(0.005);
  expect(Math.abs(slope(band.outer - 0.05))).toBeLessThan(0.005);
  // And it genuinely falls in the middle.
  expect(oceanFade(35, 0, band)).toBeCloseTo(0.5, 6);
});

test("a degenerate band is a hard edge rather than a division by zero", () => {
  const flat = { inner: 20, outer: 20 };
  expect(oceanFade(19, 0, flat)).toBe(1);
  expect(oceanFade(21, 0, flat)).toBe(0);
});

test("the default band leaves every board's water alive", () => {
  // Nothing has told the ocean about a board yet, so nothing may be faded.
  expect(currentOceanFade()).toBe(OCEAN_FADE_OFF);
  expect(oceanFade(500, 500, OCEAN_FADE_OFF)).toBe(1);
});

test("the shader fades on the same rule the maths does", () => {
  const glsl = oceanWaveGLSL();
  expect(glsl).toContain("uniform vec2 uOceanFade;");
  // smoothstep(inner, outer, r) is 0 -> 1; the fade is its complement.
  expect(glsl).toContain("1.0 - smoothstep(uOceanFade.x, uOceanFade.y, length(p))");
});

test("the faded surface is driven flat, not merely stilled", () => {
  // Fading the swell alone leaves the art's 0.06 of baked relief. The mix
  // cancels the baked height and lands the vertex on OCEAN_FLAT_Y.
  const surface = oceanWaveChunks("surface");
  expect(surface["#include <begin_vertex>"]).toContain(
    `mix(${OCEAN_FLAT_Y.toFixed(6)} - oceanWorld.y, oceanY - oceanWorld.y, oceanF)`,
  );
  // ...and the live branch is the flattened sheet plus the swell, the GLSL
  // twin of `oceanSurfaceY`, both read off the same constants.
  expect(surface["#include <begin_vertex>"]).toContain(
    `mix(${OCEAN_FLAT_Y.toFixed(6)}, oceanWorld.y - ${WAVE_DROP.toFixed(
      6,
    )}, ${BAKED_RELIEF.toFixed(6)})`,
  );
  expect(surface["#include <begin_vertex>"]).toContain(
    `oceanBaseY + ${WAVE_AMPLITUDE.toFixed(6)} * oceanUnit`,
  );
  // ...using the height the preamble already computed (the crest ramp needs
  // the unscaled form anyway).
  expect(surface["#include <beginnormal_vertex>"]).toContain(
    "float oceanUnit = costanOceanUnit(oceanAt);",
  );
  // ...and the normal fades too: flat geometry with baked facets shows a
  // boundary against the annulus's single normal.
  expect(surface["#include <beginnormal_vertex>"]).toContain("oceanF");
});

test("the flattened normal keeps the authored winding", () => {
  // The sheet's top face is wound back (FrontSide makes the water vanish), and
  // three negates a back-facing normal. A literal (0, 1, 0) target would be
  // negated too and shade the far water from below. The target is world up in
  // object space, flipped into the authored normal's hemisphere.
  const normal = oceanWaveChunks("surface")["#include <beginnormal_vertex>"];
  expect(normal).toContain("transpose(mat3(oceanModel)) * vec3(0.0, 1.0, 0.0)");
  expect(normal).toContain("dot(objectNormal, oceanUp) < 0.0 ? -1.0 : 1.0");
  expect(normal).toContain("vec3 oceanFlat = oceanFacing * oceanUp;");
  // And the flat target is what the fade lands on, not the tilted one.
  expect(normal).toContain("mix(\n    oceanFlat,");
});

test("the tilt is signed the same way the flattening is", () => {
  // A height field's normal is (-dh/dx, 1, -dh/dz); wound the other way up
  // every component negates, in-plane pair included. Without the sign, after
  // three's DoubleSide flip every crest shades as a trough. Symmetric sines
  // hide this; the crest ramp would not.
  const normal = oceanWaveChunks("surface")["#include <beginnormal_vertex>"];
  expect(normal).toContain(
    "vec3 oceanTilt = oceanFacing * (transpose(mat3(oceanModel)) * vec3(-oceanG.x, 0.0, -oceanG.y)) / oceanScale;",
  );
  expect(normal).toContain("normalize(oceanBaked + oceanTilt)");
  // The authored faceting fades by the same fraction as the relief, or the
  // flattened sheet keeps the normals of bumps it no longer has.
  expect(normal).toContain(`mix(oceanFlat, normalize(objectNormal), ${BAKED_RELIEF.toFixed(6)})`);
  // One sign, read off the mesh, used by both branches, so a sheet re-exported
  // the other way up stays correct.
  expect(normal.match(/oceanFacing/g) ?? []).toHaveLength(3);
});

test("the detail normal is generated from the same trains the maths uses", () => {
  const glsl = oceanDetailGLSL();
  expect(glsl).toContain("uniform float uOceanTime;");
  expect(glsl).toContain("uniform float uOceanCrest;");
  for (const d of DETAIL_TRAINS) {
    expect(glsl).toContain(d.freq.toFixed(6));
    expect(glsl).toContain(d.speed.toFixed(6));
    expect(glsl).toContain(d.slope.toFixed(6));
    // Its own fade, folded into the amplitude rather than branched on: a
    // divergent branch around a derivative is undefined.
    const lambda = (2 * Math.PI) / d.freq;
    expect(glsl).toContain(
      `smoothstep(${(lambda * DETAIL_FADE.begin).toFixed(6)}, ${(lambda * DETAIL_FADE.end).toFixed(6)}, px)`,
    );
  }
  // Slope only. A sine here would be height, and height is fenced.
  expect(glsl.match(/cos\(/g) ?? []).toHaveLength(DETAIL_TRAINS.length);
  expect(glsl).not.toContain("sin(");
});

test("the detail is added after three applies face direction", () => {
  // After `normal_fragment_maps`: `normal` is in view space and `faceDirection`
  // is applied, so it points out of the water either way the sheet is wound.
  // Any earlier and it inherits NORMAL_TILT's sign problem.
  const frag = oceanFragmentChunks("surface");
  const detail = frag["#include <normal_fragment_maps>"];
  expect(detail).toContain("fwidth(vOceanAt)");
  expect(detail).toContain("costanOceanDetail(vOceanAt, oceanPx)");
  // World-space tilt carried into view space, small-angle, like the vertex one.
  expect(detail).toContain("viewMatrix * vec4(-oceanDG.x, 0.0, -oceanDG.y, 0.0)");
  // Faded with everything else, or there is a ring of ripple at the join with
  // the annulus, a clone with no ocean shader.
  expect(detail).toContain("vOceanFade * costanOceanDetail");
});

test("the crest ramp rides the swell's own height, and dies with it", () => {
  // The only wave cue that survives a straight-down camera (every facet
  // returns the same light) and night roughness 0.82 (no specular).
  const crest = oceanFragmentChunks("surface")["#include <color_fragment>"];
  expect(crest).toContain("diffuseColor.rgb *=");
  expect(crest).toContain("uOceanCrest * vOceanFade * vOceanUnit");
  // Never negative, whatever a theme asks for. A negative factor is black water.
  expect(crest).toContain("max(0.0,");
  // vOceanUnit is the swell before amplitude and sink, so the ramp is
  // symmetric about the sea's colour and independent of the amplitude.
  for (let t = 0; t < 20; t += 0.7) {
    for (let x = -12; x <= 12; x += 1.3) {
      const u = oceanUnit(x, x * 0.7 - 3, t);
      expect(Math.abs(u)).toBeLessThanOrEqual(1 + 1e-12);
      expect(oceanWave(x, x * 0.7 - 3, t)).toBeCloseTo(WAVE_AMPLITUDE * u - WAVE_DROP, 12);
    }
  }
});

test("both themes ask for a crest ramp, and the dark one asks harder", () => {
  expect(BOARD_LOOKS.light.water.crest).toBeGreaterThan(0);
  // Night has no specular to shape the water, so the height ramp does more.
  expect(BOARD_LOOKS.dark.water.crest).toBeGreaterThan(BOARD_LOOKS.light.water.crest);
  // ...and neither may push the multiplier negative on the trough side.
  for (const look of [BOARD_LOOKS.light, BOARD_LOOKS.dark]) {
    expect(look.water.crest).toBeLessThan(1);
  }
});

test("the crest strength reaches the shader as a uniform, not a recompile", () => {
  // A uniform, so switching day to night doesn't recompile.
  const material = new THREE.MeshStandardMaterial({ name: `crest-${Math.random()}` });
  applyOceanWave(material, "surface");
  const shader = {
    uniforms: {} as Record<string, { value: number }>,
    vertexShader: SHADER_STUB,
    fragmentShader: FRAGMENT_STUB,
  };
  material.onBeforeCompile?.(shader as never, null as never);
  setOceanCrest(0.42);
  expect(shader.uniforms.uOceanCrest.value).toBe(0.42);
  expect(oceanCrest()).toBe(0.42);
  // ...and a look sets it.
  setOceanCrest(0);
  applyWaterLook(waterAsset(), BOARD_LOOKS.dark);
  expect(oceanCrest()).toBe(BOARD_LOOKS.dark.water.crest);
});

test("the fragment work reaches the fragment shader, and only the surface's", () => {
  const material = new THREE.MeshStandardMaterial({ name: `frag-${Math.random()}` });
  applyOceanWave(material, "surface");
  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: SHADER_STUB,
    fragmentShader: FRAGMENT_STUB,
  };
  material.onBeforeCompile?.(shader as never, null as never);
  expect(shader.fragmentShader).toContain("vec2 costanOceanDetail(vec2 p, float px)");
  expect(shader.fragmentShader).toContain("#include <normal_fragment_maps>");
  expect(shader.fragmentShader).toContain("#include <color_fragment>");
  // The varyings are declared on both sides, or nothing links.
  for (const decl of [
    "varying vec2 vOceanAt;",
    "varying float vOceanFade;",
    "varying float vOceanUnit;",
  ]) {
    expect(shader.vertexShader).toContain(decl);
    expect(shader.fragmentShader).toContain(decl);
  }
  // A boat gets none of it, varyings included.
  const boat = new THREE.MeshStandardMaterial({ name: `boat-${Math.random()}` });
  applyOceanWave(boat, "float");
  const boatShader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: SHADER_STUB,
    fragmentShader: FRAGMENT_STUB,
  };
  boat.onBeforeCompile?.(boatShader as never, null as never);
  expect(boatShader.fragmentShader).toBe(FRAGMENT_STUB);
  expect(boatShader.vertexShader).not.toContain("vOceanAt");
  expect(oceanFragmentChunks("float")).toEqual({});
});

test("a boat's shader is not given the surface's normal work", () => {
  // `float` rides as a rigid body; its normals aren't bent, and the chunk that
  // would carry it isn't there.
  expect(oceanWaveChunks("float")["#include <beginnormal_vertex>"]).not.toContain("oceanFlat");
});

test("the flat sea sits at the mean waterline", () => {
  expect(OCEAN_FLAT_Y).toBe(OCEAN_MEAN_Y);
  expect(OCEAN_FLAT_Y).toBeGreaterThan(OCEAN_MIN_Y);
  expect(OCEAN_FLAT_Y).toBeLessThan(OCEAN_MAX_Y);
});

test("the annulus is a ring in the board's plane, and it is nearly free", () => {
  const ring = oceanAnnulusGeometry(40, 160);
  const pos = ring.getAttribute("position");
  expect(pos.count).toBeGreaterThan(0);
  for (let i = 0; i < pos.count; i++) {
    // Flat: the placement supplies the height.
    expect(pos.getY(i)).toBeCloseTo(0, 9);
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    // Float32 attributes, so the tolerance is the buffer's.
    expect(r).toBeGreaterThanOrEqual(40 - 1e-4);
    expect(r).toBeLessThanOrEqual(160 + 1e-4);
  }
  // Facing up, or the sea is lit from underneath.
  const n = ring.getAttribute("normal");
  for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeCloseTo(1, 6);
  // It replaces hundreds of thousands of triangles.
  expect((ring.getIndex()?.count ?? 0) / 3).toBe(OCEAN_ANNULUS_SEGMENTS * 2);
});

test("the annulus's chord never cuts a visible corner off the horizon", () => {
  // A circle drawn as a polygon; the sag must be under a pixel at viewing
  // distance.
  const sag = 1 - Math.cos(Math.PI / OCEAN_ANNULUS_SEGMENTS);
  expect(sag).toBeLessThan(0.001);
});

test("the ring is set to lose the depth fight it is always in", () => {
  // The annulus and the outer sea hexes are the same water at the same height,
  // so their overlap z-fights. Pushing the ring back lets the hexes win, which
  // is right: inside the fade band they are not flat.
  const water = new THREE.MeshStandardMaterial({ name: OCEAN_WATER_MATERIAL });
  const ring = annulusMaterial(water);
  expect(ring.polygonOffset).toBe(true);
  // Positive: away from the camera, so the hexes win wherever they exist.
  expect(ring.polygonOffsetFactor).toBeGreaterThan(0);
  expect(ring.polygonOffsetUnits).toBeGreaterThan(0);
  // Depth only. A sunk ring would show a ledge at the join from close up.
  expect(ring).not.toBe(water);
  expect(water.polygonOffset).toBe(false);
});

test("the ring keeps the water's name, so it keeps the water's shadow rules", () => {
  // A renamed clone reads as "not sea" to `seaCastsShadow` and would cast
  // shadows.
  const water = new THREE.MeshStandardMaterial({ name: OCEAN_WATER_MATERIAL });
  const ring = annulusMaterial(water);
  expect(ring.name).toBe(OCEAN_WATER_MATERIAL);
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), ring);
  expect(seaCastsShadow(mesh)).toBe(false);
  // ...and is still identifiable in the scene graph.
  expect(ring.userData.costanOceanAnnulus).toBe(true);
});

test("the water itself keeps fighting normally", () => {
  // A clone, because the sea tiles overlap each other, the beach and the
  // piers, and biasing all of that would cause new problems.
  const water = new THREE.MeshStandardMaterial({ name: OCEAN_WATER_MATERIAL });
  annulusMaterial(water);
  expect(water.polygonOffset).toBe(false);
});

test("one ring material per water material, however many boards are built", () => {
  // Boards rebuild on every content commit and the sea's material is cached
  // for the tab, so a fresh clone per build would leak.
  const water = new THREE.MeshStandardMaterial({ name: OCEAN_WATER_MATERIAL });
  expect(annulusMaterial(water)).toBe(annulusMaterial(water));
});

test("the ring inherits the water's colour and its sky, by reference", () => {
  // A clone shares the envMap object, so the two always reflect the same sky.
  const water = new THREE.MeshStandardMaterial({ name: OCEAN_WATER_MATERIAL });
  water.color.setHex(0x123456);
  water.envMap = new THREE.Texture();
  const ring = annulusMaterial(water) as THREE.MeshStandardMaterial;
  expect(ring.color.getHex()).toBe(0x123456);
  expect(ring.envMap).toBe(water.envMap);
});

test("a band set on the ocean reaches the materials already dressed", () => {
  // Materials outlive any one board, so the band is pushed onto them rather
  // than read at build time.
  const material = new THREE.MeshStandardMaterial({ name: `fade-${Math.random()}` });
  applyOceanWave(material, "surface");
  const shader = {
    uniforms: {} as Record<string, { value: THREE.Vector2 }>,
    vertexShader: "",
    fragmentShader: "",
  };
  material.onBeforeCompile?.(shader as never, null as never);
  setOceanFade({ inner: 12, outer: 34 });
  expect(shader.uniforms.uOceanFade.value.x).toBe(12);
  expect(shader.uniforms.uOceanFade.value.y).toBe(34);
  expect(currentOceanFade()).toEqual({ inner: 12, outer: 34 });
});

test("sinking the hull leaves everything parented to it where it was", () => {
  // Lowering the tile as a unit doesn't help: the wave sheet and a harbour's
  // pier are children of the hull and move with it.
  const asset = waterAsset(["deck", "frame"]);
  const before = new THREE.Vector3();
  asset.waves.getWorldPosition(before);
  const deck = asset.hull.children.find((c) => c.name === "Port_deck")!;
  const deckBefore = new THREE.Vector3();
  deck.getWorldPosition(deckBefore);

  expect(sinkOceanHull(asset)).toBe(true);
  asset.scene.updateMatrixWorld(true);

  expect(asset.hull.position.y).toBeCloseTo(-0.05 - HULL_SINK_LOCAL, 9);
  const after = new THREE.Vector3();
  asset.waves.getWorldPosition(after);
  expect(after.y).toBeCloseTo(before.y, 9);
  deck.getWorldPosition(after);
  expect(after.y).toBeCloseTo(deckBefore.y, 9);
});

test("dressOcean leaves a shoal's own props at their authored height", () => {
  // The layout the exporter actually produces: `Hex_*` is an empty with the
  // hull, the wave sheet and any dressing as siblings under it, so the sink
  // moves a leaf. A shoal's bars, standing on the hull, must not follow it
  // down.
  const scene = new THREE.Group();
  const root = new THREE.Group();
  root.name = "Hex_Shoal";
  const byMaterial = new Map<string, THREE.Mesh[]>();
  const mesh = (name: string, material: string, y: number) => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    m.material.name = material;
    m.name = name;
    m.position.y = y;
    byMaterial.set(material, [...(byMaterial.get(material) ?? []), m]);
    root.add(m);
    return m;
  };
  const hull = mesh("Hex_Shoal_hull", OCEAN_HULL_MATERIAL, 0);
  const waves = mesh("Shoal_waves", OCEAN_WATER_MATERIAL, 0);
  const bars = mesh("Shoal_bars", "Mat_Shore_sand", 0.18);
  scene.add(root);
  scene.updateMatrixWorld(true);

  const asset: LoadedAsset = { scene, byMaterial };
  dressOcean(asset);
  scene.updateMatrixWorld(true);

  expect(hull.children, "the hull is a leaf, as exported").toHaveLength(0);
  expect(hull.position.y).toBeCloseTo(-HULL_SINK_LOCAL, 9);
  // Siblings, so neither the sheet nor the bank moved with it.
  expect(waves.position.y).toBe(0);
  expect(bars.position.y).toBe(0.18);
});

test("sinking twice sinks once", () => {
  const asset = waterAsset();
  expect(sinkOceanHull(asset)).toBe(true);
  expect(sinkOceanHull(asset)).toBe(false);
  expect(asset.hull.position.y).toBeCloseTo(-0.05 - HULL_SINK_LOCAL, 9);
});

test("an asset with no sea in it is left alone", () => {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
  mesh.material.name = "Mat_Shore_sand";
  mesh.position.y = 1;
  scene.add(mesh);
  const asset: LoadedAsset = { scene, byMaterial: new Map([["Mat_Shore_sand", [mesh]]]) };
  dressOcean(asset);
  expect(mesh.position.y).toBe(1);
  expect(mesh.material.customProgramCacheKey()).not.toContain("costan-ocean");
});

test("dressing a water tile sinks it and puts the swell on the surface", () => {
  const asset = waterAsset();
  dressOcean(asset);
  expect(asset.hull.position.y).toBeCloseTo(-0.05 - HULL_SINK_LOCAL, 9);
  // The surface animates; the hull it sits in does not.
  expect((asset.waves.material as THREE.Material).customProgramCacheKey?.()).toBe(
    "costan-ocean-surface",
  );
  expect((asset.hull.material as THREE.Material).customProgramCacheKey?.()).not.toBe(
    "costan-ocean-surface",
  );
});

test("the surface gets a sky to reflect and the rest of the tile does not", () => {
  // `scene.environment` would relight all 242 palette.json materials. Only the
  // water surface gets the sky: the hull is sunk and a pier is not wet.
  const asset = waterAsset(["deck", "frame"]);
  expect(reflectSky(asset)).toBe(1);

  const water = asset.waves.material as THREE.MeshStandardMaterial;
  expect(water.envMap).toBe(oceanSky());
  expect(water.envMapIntensity).toBe(OCEAN_ENV_INTENSITY);
  expect((asset.hull.material as THREE.MeshStandardMaterial).envMap).toBeNull();
});

test("a tile with no water in it reflects nothing", () => {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
  mesh.material.name = "Mat_Shore_sand";
  scene.add(mesh);
  const asset: LoadedAsset = { scene, byMaterial: new Map([["Mat_Shore_sand", [mesh]]]) };
  expect(reflectSky(asset)).toBe(0);
  expect(mesh.material.envMap).toBeNull();
});

test("reflecting twice reflects once", () => {
  // Materials are cached and shared, so this is reached again on every build.
  const asset = waterAsset();
  expect(reflectSky(asset)).toBe(1);
  expect(reflectSky(asset)).toBe(0);
});

test("dressing a water tile hands the surface its sky", () => {
  const asset = waterAsset();
  dressOcean(asset);
  expect((asset.waves.material as THREE.MeshStandardMaterial).envMap).toBe(oceanSky());
});

test("only the water surface rides the swell", () => {
  // Nothing floats on the sea now, so the surface is the only thing the swell
  // moves.
  expect(WAVE_MODES[OCEAN_WATER_MATERIAL]).toBe("surface");
  expect(Object.keys(WAVE_MODES)).toEqual([OCEAN_WATER_MATERIAL]);
});

test("the clock reaches the shader, and reaches it once per material", () => {
  const material = new THREE.MeshStandardMaterial();
  expect(applyOceanWave(material, "surface")).toBe(true);
  expect(applyOceanWave(material, "surface")).toBe(false);

  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: SHADER_STUB,
    fragmentShader: FRAGMENT_STUB,
  };
  material.onBeforeCompile(shader as never, null as never);
  const clock = shader.uniforms.uOceanTime as { value: number };
  expect(clock.value).toBe(0);
  setOceanTime(12.5);
  expect(clock.value).toBe(12.5);
  expect(oceanTime()).toBe(12.5);

  // Both injections landed, and three's own chunks survived them.
  expect(shader.vertexShader).toContain("#include <beginnormal_vertex>");
  expect(shader.vertexShader).toContain("#include <begin_vertex>");
  expect(shader.vertexShader).toContain("float costanOceanWave(vec2 p)");
  expect(shader.vertexShader.indexOf("float costanOceanWave")).toBeLessThan(
    shader.vertexShader.indexOf("void main"),
  );
});

test("only the water is excluded from the shadow pass", () => {
  // Three's shadow depth material never sees the displacement, so the surface
  // would shadow itself in broad bands cut off at the shadow frustum.
  const asset = waterAsset();
  expect(seaCastsShadow(asset.waves)).toBe(false);
  expect(seaCastsShadow(asset.hull)).toBe(false);

  const tree = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
  tree.material.name = "Mat_Forest_leaf";
  expect(seaCastsShadow(tree)).toBe(true);
});

const SHADER_STUB = `void main() {
  #include <beginnormal_vertex>
  #include <begin_vertex>
}`;

const FRAGMENT_STUB = `void main() {
  #include <color_fragment>
  #include <normal_fragment_begin>
  #include <normal_fragment_maps>
}`;

test("splitting a harbour tile separates the wave sheet from the dock", () => {
  // Lets the water face one way and the pier another. Both hang off the hull,
  // so the split is by material, not by depth or name.
  const asset = waterAsset(["deck", "frame"]);
  dressOcean(asset);
  const { surface, rest } = splitOceanSurface(asset);

  expect(surface.scene.children.map((c) => c.name)).toEqual(["Ocean_waves"]);
  expect(rest.scene.children.map((c) => c.name).sort()).toEqual([
    "Hex_Ocean",
    "Port_deck",
    "Port_frame",
  ]);
  // Nothing may be dropped: a mesh in neither half stops being drawn.
  expect(surface.scene.children.length + rest.scene.children.length).toBe(4);
  expect(surface.byMaterial.get(OCEAN_WATER_MATERIAL)).toHaveLength(1);
  expect(rest.byMaterial.has(OCEAN_WATER_MATERIAL)).toBe(false);
});

test("the split keeps the sheet at the height sinking the hull left it at", () => {
  // The sink is in the hull's transform and the lift back in the sheet's, so
  // a sheet taken out without its inherited matrix lands HULL_SINK too high.
  const asset = waterAsset(["deck"]);
  const before = new THREE.Vector3();
  asset.waves.getWorldPosition(before);
  dressOcean(asset);

  const { surface, rest } = splitOceanSurface(asset);
  surface.scene.updateMatrixWorld(true);
  rest.scene.updateMatrixWorld(true);
  const after = new THREE.Vector3();
  surface.scene.children[0].getWorldPosition(after);
  expect(after.y).toBeCloseTo(before.y, 9);

  const hull = rest.scene.children.find((c) => c.name === "Hex_Ocean")!;
  hull.getWorldPosition(after);
  expect(after.y).toBeCloseTo(-0.05 - HULL_SINK_LOCAL, 9);
});

test("the split shares the water's material, so the swell survives it", () => {
  // A copy would miss `applyOceanWave`'s WeakSet and draw a flat, still hexagon
  // of sea.
  const asset = waterAsset();
  dressOcean(asset);
  const { surface } = splitOceanSurface(asset);
  const copy = surface.scene.children[0] as THREE.Mesh;
  expect(copy.material).toBe(asset.waves.material);
  expect(copy.geometry).toBe(asset.waves.geometry);
  expect(applyOceanWave(copy.material as THREE.Material, "surface")).toBe(false);
});
