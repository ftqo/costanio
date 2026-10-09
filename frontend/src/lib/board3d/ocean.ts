// The water: what is under it, and how it moves.
//
// A water tile ships as two meshes. `Hex_*` is the hull, an opaque prism whose
// flat top face sits at 0.150, and `*_waves` is the sculpted surface sheet
// spanning 0.145..0.205. The deepest baked troughs dip below the hull's top, so
// the lighter hull (Mat_Ocean) shows through the water in patches. Sinking the
// whole tile doesn't help since it moves both; `sinkOceanHull` separates them.
//
// With the hull out of the way there is room for a swell, added in the vertex
// shader from a world-space wave function. It is done at runtime so the art
// stays untouched and the numbers sit next to the constants they must clear.
//
// The parameters are the "North sea" look, picked by comparing many candidates
// on a live board: four short sine trains over a sheet flattened to 0.45 of the
// art's relief, at roughness 0.16 and envMap intensity 2.

import * as THREE from "three";
import type { LoadedAsset } from "./loader";
import { oceanSky } from "./oceanEnv";
import { LATTICE_SCALE } from "./coords";
import {
  APOTHEM as BEACH_APOTHEM,
  BEACH_FOOT_Y,
  TOP_Y as BEACH_DRY_Y,
  WATER_Y as BEACH_TOE_Y,
} from "./beachGeometry";
import { BOARD_LOOKS, type BoardLook } from "./boardTheme";
import { currentBoardLook } from "@/lib/boardPostFx";

/** The hull: the tile's solid body. Never meant to be seen through the water. */
export const OCEAN_HULL_MATERIAL = "Mat_Ocean";
/** The surface that sits in it. */
export const OCEAN_WATER_MATERIAL = "Mat_Ocean_water";

/**
 * The scale a water tile is drawn at (not 1).
 *
 * A sea tile fills a whole lattice cell (see `LATTICE_SCALE`) and the instance
 * scale is uniform, so art heights are 4.78% larger on the board than in the
 * file. Measurements below stay in art units and the scale is applied once,
 * here.
 */
export const OCEAN_ART_SCALE = LATTICE_SCALE;

/**
 * Heights measured off `frontend/public/models/tiles/sea.glb`, in art units.
 * Sea and sea_port share the same wave mesh and hull, so one set covers both.
 */
export const OCEAN_ART_HEIGHTS = {
  /** The hull's flat top face. */
  hullTop: 0.15,
  /** The deepest baked trough, below the hull top (the cause of the rim). */
  min: 0.145,
  /** The highest baked crest. */
  max: 0.205,
  /** The mean of the baked surface, area-unweighted over its vertices. */
  mean: 0.177,
} as const;

export const OCEAN_HULL_TOP_Y = OCEAN_ART_HEIGHTS.hullTop * OCEAN_ART_SCALE;
/** The deepest baked trough, below the hull top (the cause of the rim). */
export const OCEAN_BAKED_MIN_Y = OCEAN_ART_HEIGHTS.min * OCEAN_ART_SCALE;
/** The highest baked crest. */
export const OCEAN_BAKED_MAX_Y = OCEAN_ART_HEIGHTS.max * OCEAN_ART_SCALE;
/** The mean of the baked surface, area-unweighted over its vertices. */
export const OCEAN_BAKED_MEAN_Y = OCEAN_ART_HEIGHTS.mean * OCEAN_ART_SCALE;

/**
 * Gap left between the highest crest the sea can reach and the top of the sand.
 *
 * `TOP_Y` (0.250) is the land's height and the head of the beach's slope;
 * water above it would stand on the island. A clearance rather than a bare `<`
 * because surfaces meeting exactly depth-fight. Applied to world heights (see
 * `OCEAN_ART_SCALE`).
 */
export const SHORE_CLEARANCE = 0.01;

/**
 * The highest the water may ever be, anywhere.
 *
 * The tightest fence on the swell. It is the sand, not the pier: `PIER_DECK_Y`
 * is 0.283 and this is 0.205, so clearing the dry band clears the harbours.
 * Derived from `beachGeometry.ts` so recutting the coast moves it too. A
 * ceiling, not a target; the chosen amplitude stays well under it.
 */
export const OCEAN_CREST_CEILING = BEACH_DRY_Y - SHORE_CLEARANCE;

/**
 * How much of the art's own sculpted relief survives on the wave sheet.
 *
 * 1 is the sheet as baked. At 0.45 the baked bumps no longer compete with the
 * four short swell trains, the art's texture still reads, and both crests and
 * troughs move toward the mean, which leaves room for more swell (0.03 here
 * versus 0.046 on the full sheet).
 *
 * Applied to height and to the authored normals together (see
 * `DISPLACE_SURFACE` and `NORMAL_TILT`); flattening only one leaves a
 * patchwork of lit and unlit triangles on flat geometry.
 *
 * The sheet is flattened toward `OCEAN_FLAT_Y`, where the baked mean already
 * sits after `WAVE_DROP`, so `SURFACE.sea` does not depend on this value.
 */
export const BAKED_RELIEF = 0.45;

export const WAVE_DROP = OCEAN_BAKED_MEAN_Y - BEACH_TOE_Y;

/**
 * The wave sheet's highest and lowest points once sunk and flattened, before
 * any swell. Derived because `WAVE_DROP` and `BAKED_RELIEF` both move them: at
 * 0.45 they are 0.143 and 0.115 (the full sheet was 0.159 and 0.096).
 */
export const BAKED_CREST_Y =
  BEACH_TOE_Y + BAKED_RELIEF * (OCEAN_BAKED_MAX_Y - WAVE_DROP - BEACH_TOE_Y);
export const BAKED_TROUGH_Y =
  BEACH_TOE_Y + BAKED_RELIEF * (OCEAN_BAKED_MIN_Y - WAVE_DROP - BEACH_TOE_Y);

/**
 * How much room there is above the sheet's crests, under the dry sand. 0.062.
 * Negative before the sheet was flattened (the baked crests at 0.215 stood
 * above the 0.205 ceiling).
 */
export const WAVE_RISE = OCEAN_CREST_CEILING - BAKED_CREST_Y;

/**
 * ...and how much there is below the sheet's troughs, above the sand's foot.
 * 0.065. Within a few thousandths of the ceiling's room at `BAKED_RELIEF`
 * 0.45, so `Math.min` below picks the binding one.
 */
export const WAVE_FALL = BAKED_TROUGH_Y - BEACH_FOOT_Y;

/**
 * The largest swell that fits between the two clearances. A bound, not the
 * setting: `ocean.test.ts` asserts `WAVE_AMPLITUDE` fits inside it, so a coast
 * recut too shallow for the chosen amplitude fails there.
 */
export const WAVE_MAX_AMPLITUDE = Math.min(WAVE_RISE, WAVE_FALL);

/**
 * Half the swell's peak-to-trough travel, in world units. Chosen by eye.
 *
 * Spending the whole of `WAVE_MAX_AMPLITUDE` made a large wave dominate the
 * small ones. 0.03 suits the four short trains over the flattened sheet (see
 * `BAKED_RELIEF` and `WAVE_TRAINS`), where the swell is texture rather than
 * shape.
 *
 * Peak to trough it is 0.06, against the flattened sheet's 0.028 of relief, and
 * its peak tilt is 3.2 degrees. That is a little under half the 0.062 bound.
 */
export const WAVE_AMPLITUDE = 0.03;

/**
 * Where the water sits on average once the sheet is sunk and the swell added.
 *
 * `BEACH_TOE_Y` exactly, by construction: everything touching the sea is cut
 * against this height. `WAVE_DROP` lands it here, and the symmetric swell
 * doesn't move it.
 */
export const OCEAN_MEAN_Y = OCEAN_BAKED_MEAN_Y - WAVE_DROP;

/**
 * The height the sea settles at once the swell has been faded out: the mean
 * waterline. `SURFACE.sea` is this number and the beach's seaward lip is dug
 * for it, so far flat water matches the average of the near water.
 */
export const OCEAN_FLAT_Y = OCEAN_MEAN_Y;

/**
 * The lowest the surface can ever be, at the bottom of the deepest trough.
 *
 * The flattened sheet's own floor, less the swell's full downward half: 0.085,
 * which is 0.035 clear of the sand's foot (see `SHORE_FOOT_CLEARANCE`).
 */
export const OCEAN_MIN_Y = BAKED_TROUGH_Y - WAVE_AMPLITUDE;

/**
 * The highest it can ever be: 0.173, which is 0.032 under `OCEAN_CREST_CEILING`
 * and 0.042 under the dry sand.
 *
 * Anything sitting on the water has to clear it: `Board3D` seats the Explorers
 * chips on it, and the shoal's props are modelled above it.
 */
export const OCEAN_MAX_Y = BAKED_CREST_Y + WAVE_AMPLITUDE;

/**
 * How much sand there is under the deepest trough the sea can reach.
 *
 * The beach ends at `BEACH_FOOT_Y` and drops as a wall below it, so a deeper
 * trough would expose a bright band of sand round the island. Must be positive;
 * at the chosen amplitude it is 0.035. Derived so raising the amplitude fails
 * here instead of on screen.
 */
export const SHORE_FOOT_CLEARANCE = OCEAN_MIN_Y - BEACH_FOOT_Y;

/**
 * A harbour pier's walking surface, measured off sea_port.glb (0.270 in art
 * units, drawn at `OCEAN_ART_SCALE` like the rest of the tile).
 *
 * Not the binding ceiling (the sand at 0.250 is 0.033 below it), but it takes
 * over if the beach profile is recut higher. The deck's underside is at 0.173,
 * below the baked crests, so water lapping under the pier is expected; washing
 * over the top is not.
 */
export const PIER_DECK_Y = 0.27 * OCEAN_ART_SCALE;

/**
 * How far the pier's landward end stops short of the lattice line, in world
 * units.
 *
 * Measured off sea_port.glb: the deck spans x -2.573..0.624 about the tile
 * centre in art units, so its shore end lands 0.027 inside the water hex's rim.
 * That end must land on sand, which it does because the ribbon runs 0.08 back
 * past the line. Held in `ocean.test.ts`.
 */
export const PIER_SHORE_GAP = BEACH_APOTHEM - 2.573 * OCEAN_ART_SCALE;

/**
 * Gap left between the hull's top face and the deepest the water can reach.
 * Generous: at whole-board framing distance the depth buffer can't separate
 * surfaces a thousandth apart.
 */
export const HULL_CLEARANCE = 0.05;

/**
 * How far the hull drops so it stays under the water at every point. Derived
 * from `OCEAN_MIN_Y`, so it follows any retune of the amplitude.
 */
export const HULL_SINK = OCEAN_HULL_TOP_Y - OCEAN_MIN_Y + HULL_CLEARANCE;

/**
 * ...and the same drop in art units. `sinkOceanHull` moves a node inside the
 * asset, which is then instanced at `OCEAN_ART_SCALE`, so this is the one place
 * that divides by it.
 */
export const HULL_SINK_LOCAL = HULL_SINK / OCEAN_ART_SCALE;

/**
 * The wave sheet's vertex spacing in the art, in art units.
 *
 * Measured off `frontend/public/models/tiles/sea.glb`: 173 distinct XZ points
 * per hex on a regular triangular lattice, nearest-neighbour distance 0.4330
 * (halved at the rim seams). Every wavelength below has to clear it; re-measure
 * if the sheet is remodelled.
 */
export const OCEAN_ART_VERTEX_PITCH = 0.433;

/**
 * ...and in world units. A sea tile is drawn at `LATTICE_SCALE` (see
 * `coords.ts`), so distances on the sheet come out 4.8% larger.
 */
export const OCEAN_VERTEX_PITCH = OCEAN_ART_VERTEX_PITCH * LATTICE_SCALE;

/**
 * How many vertices a train needs per wavelength.
 *
 * Two (Nyquist) aliases into a longer wave that crawls as the camera moves;
 * three reconstructs as a beating triangle wave. Six is where linear
 * interpolation stops showing a corner at the crest. This is why `WAVE_TRAINS`
 * holds only long-ish water; shorter waves live in `DETAIL_TRAINS`, sampled
 * per pixel.
 */
export const OCEAN_SAMPLES_PER_WAVE = 6;

/** The shortest wavelength the wave sheet can carry. Roughly half a hex. */
export const OCEAN_MIN_WAVELENGTH = OCEAN_SAMPLES_PER_WAVE * OCEAN_VERTEX_PITCH;

/**
 * How often the swell's clock advances, in frames per second.
 *
 * Kept here, not beside the ticker (`OCEAN_FRAME_MS` in `Board3D.tsx` is
 * derived from it), because it is a sampling rate that bounds the wave speeds.
 * `OCEAN_MAX_PHASE_STEP` and its test tie the two together.
 */
export const OCEAN_CLOCK_HZ = 30;

/**
 * The most phase a train may advance between two frames of the water, in
 * radians.
 *
 * Beyond this a crest jumps instead of travelling. The temporal twin of
 * `OCEAN_SAMPLES_PER_WAVE`: that bounds wavelength against vertex pitch, this
 * bounds speed against frame pitch. A fifth of a radian is about 31 frames per
 * period, a one-second roll at 30 Hz. The shortest trains bind first.
 */
export const OCEAN_MAX_PHASE_STEP = 0.2;

/** The fastest a train may travel before it strobes against the clock. */
export const OCEAN_MAX_WAVE_SPEED = OCEAN_MAX_PHASE_STEP * OCEAN_CLOCK_HZ;

/**
 * The constant in the deep-water dispersion relation, in world units per
 * second squared: `omega = sqrt(OCEAN_GRAVITY * k)`.
 *
 * Long waves outrun short ones by the square root of the wavelength; trains
 * with hand-picked speeds read as separate sheets sliding over each other.
 * Deriving speeds from wavelengths avoids that.
 *
 * Not 9.81, since a hex is 5.2 units across. Chosen by eye, bounded by
 * `OCEAN_MAX_WAVE_SPEED` on the shortest train: at 1.6, `DETAIL_TRAINS`' 0.45
 * runs at 0.158 radians a frame, 79% of the ceiling. 0.36 looked like a lava
 * lamp and 2.55 like chop. At 1.6 the swell rolls in 5.4, 4.1 and 3.4 seconds,
 * the finest detail in 1.3, and a crest crosses a hex in 3.8.
 */
export const OCEAN_GRAVITY = 1.6;

/** The angular frequency deep water gives a wave of this length. */
export function waveSpeedFor(wavelength: number): number {
  return Math.sqrt((OCEAN_GRAVITY * 2 * Math.PI) / wavelength);
}

/**
 * One sinusoidal train in the swell.
 *
 * Several are superposed because one sine reads as a corrugated roof.
 * Directions and wavelengths that don't divide evenly push the repeat out of
 * sight.
 */
export interface WaveTrain {
  /** Unit direction of travel in world XZ. */
  dir: readonly [number, number];
  /** Radians of phase per world unit travelled: 2*pi / wavelength. */
  freq: number;
  /** Radians of phase per second. */
  speed: number;
  /** Share of the swell. The weights sum to 1, so the sum stays in [-1, 1]. */
  weight: number;
}

/** A train, written the way it is chosen: by wavelength, not by wavenumber. */
function train(wavelength: number, dir: readonly [number, number], weight: number): WaveTrain {
  return { dir, freq: (2 * Math.PI) / wavelength, speed: waveSpeedFor(wavelength), weight };
}

/** The wavelength a train carries, in world units. */
export function waveLength(w: WaveTrain): number {
  return (2 * Math.PI) / w.freq;
}

/**
 * The swell: everything the geometry carries. Four trains of short water.
 *
 * Each clears `OCEAN_MIN_WAVELENGTH` (2.78; the fourth train sits on it at 6.13
 * samples a period). Below that the result is noise that crawls with the
 * camera.
 *
 * Wavelengths 4.3, 3.5, 3.0 and 2.78, close enough together that they read as
 * one disturbed surface rather than separate waves.
 *
 * Crest lines are at 25, 128, 65 and 97 degrees: the closest pair is 31 apart
 * and none is within 5 of a lattice axis. Nearly parallel trains beat into a
 * coarse moire, and a train near a lattice axis puts its crests along the tile
 * seams.
 *
 * No small common multiple, so the repeat is far outside any board. Weights sum
 * to 1, which is the bound `WAVE_AMPLITUDE` relies on.
 *
 * Shading is mostly `DETAIL_TRAINS`' job (3.2 degrees of tilt here against
 * 10.3 there): per-fragment slope costs no height headroom.
 */
export const WAVE_TRAINS: readonly WaveTrain[] = [
  train(4.3, [0.906308, 0.422618], 0.28),
  train(3.5, [-0.615661, 0.788011], 0.27),
  train(3.0, [-0.422618, -0.906308], 0.25),
  train(2.78, [0.121869, -0.992546], 0.2),
];

/**
 * One short train that exists only as a slope, evaluated per fragment.
 *
 * Shading depends on slope, not height, so wavelengths too short for the vertex
 * sheet are drawn in the fragment shader at screen resolution. They add no
 * height, so they cost nothing against the fences (see `WAVE_AMPLITUDE`), and
 * `oceanSlope` stays the true gradient of `oceanWave`.
 */
export interface DetailTrain {
  /** Unit direction of travel in world XZ. */
  dir: readonly [number, number];
  /** Radians of phase per world unit travelled: 2*pi / wavelength. */
  freq: number;
  /** Radians of phase per second. */
  speed: number;
  /** Peak tilt this train adds, as a gradient (rise over run). */
  slope: number;
}

function detail(wavelength: number, dir: readonly [number, number], slope: number): DetailTrain {
  return { dir, freq: (2 * Math.PI) / wavelength, speed: waveSpeedFor(wavelength), slope };
}

/**
 * The fine structure on the water: a fifth of a hex down to a twelfth of one.
 *
 * Three trains shorter than the sheet can carry, adding about 10.3 degrees of
 * peak tilt for three cosines a fragment. Amplitudes (0.080/0.060/0.042) were
 * tuned by eye: much smaller is invisible against the smooth sky reflection,
 * much larger reads as a pond.
 *
 * Crest lines are 57, 48 and 75 degrees apart so they don't beat.
 *
 * Each fades out as the pixel grows past a fifth of its wavelength (see
 * `oceanDetailGLSL`); a sub-pixel wave aliases into crawling static.
 *
 * No height, as above. The shortest, at 0.38, sets the clock: 5.14 radians a
 * second, 0.171 a frame at 30 Hz, 86% of `OCEAN_MAX_PHASE_STEP`.
 */
export const DETAIL_TRAINS: readonly DetailTrain[] = [
  detail(1.0, [0.788011, 0.615661], 0.08),
  detail(0.6, [0.087156, -0.996195], 0.06),
  detail(0.38, [-0.984808, 0.173648], 0.042),
];

/**
 * How wide a pixel may get, as a fraction of a wavelength, before the train it
 * carries starts fading, and where it is gone. `0.2` is five pixels a wave;
 * `0.45` is just under Nyquist.
 */
export const DETAIL_FADE = { begin: 0.2, end: 0.45 } as const;

/**
 * The swell's height at a world-space point and time, in world units.
 *
 * A function of world position so neighbouring tiles agree along shared edges;
 * in tile-local space every seam would tear.
 *
 * The constant `WAVE_DROP` pins the mean to sea level, and the swell rides
 * symmetrically about it within `WAVE_AMPLITUDE`.
 *
 * This is the offset a floating rigid body takes, and `oceanSlope` is its
 * gradient. Surface vertices follow `oceanSurfaceY` instead, because
 * `BAKED_RELIEF` flattens the sheet first.
 */
export function oceanWave(x: number, z: number, t: number): number {
  return WAVE_AMPLITUDE * oceanUnit(x, z, t) - WAVE_DROP;
}

/**
 * Where a vertex of the wave sheet actually ends up, in world units.
 *
 * The CPU twin of `DISPLACE_SURFACE`. It takes `bakedY` because the shader
 * reads it off the vertex; `ocean.test.ts` sweeps it across
 * `OCEAN_BAKED_MIN_Y .. OCEAN_BAKED_MAX_Y` to prove the fences for the whole
 * sheet. The sheet is flattened toward `OCEAN_FLAT_Y` by `BAKED_RELIEF` and the
 * swell rides on top.
 */
export function oceanSurfaceY(bakedY: number, x: number, z: number, t: number): number {
  const base = OCEAN_FLAT_Y + BAKED_RELIEF * (bakedY - WAVE_DROP - OCEAN_FLAT_Y);
  return base + WAVE_AMPLITUDE * oceanUnit(x, z, t);
}

/**
 * The swell before amplitude and sink: strictly -1 to 1, zero at the mean.
 * The crest ramp rides on it (see `oceanCrestGLSL`), and "the weights sum to
 * one" is the statement that this stays in range.
 */
export function oceanUnit(x: number, z: number, t: number): number {
  let h = 0;
  for (const w of WAVE_TRAINS) {
    h += w.weight * Math.sin((x * w.dir[0] + z * w.dir[1]) * w.freq + t * w.speed);
  }
  return h;
}

/** The gradient of `oceanWave` in x and z. What tilts the surface normal. */
export function oceanSlope(x: number, z: number, t: number): [number, number] {
  let gx = 0;
  let gz = 0;
  for (const w of WAVE_TRAINS) {
    const d = w.weight * w.freq * Math.cos((x * w.dir[0] + z * w.dir[1]) * w.freq + t * w.speed);
    gx += d * w.dir[0];
    gz += d * w.dir[1];
  }
  return [WAVE_AMPLITUDE * gx, WAVE_AMPLITUDE * gz];
}

/**
 * How much of a detail train survives at a given pixel footprint.
 *
 * `pixel` is the world distance one screen pixel covers, which the shader gets
 * from `fwidth`. A smoothstep complement, so there is no visible ring where a
 * hard threshold would land.
 */
export function detailFade(wavelength: number, pixel: number): number {
  const t = Math.min(
    1,
    Math.max(
      0,
      (pixel - wavelength * DETAIL_FADE.begin) /
        (wavelength * (DETAIL_FADE.end - DETAIL_FADE.begin)),
    ),
  );
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The detail trains' contribution to the gradient, in world units per unit.
 * Kept out of `oceanSlope`, which must stay the gradient of `oceanWave` (the
 * vertex shader tilts normals by it). Added per fragment on top.
 */
export function oceanDetailSlope(x: number, z: number, t: number, pixel: number): [number, number] {
  let gx = 0;
  let gz = 0;
  for (const d of DETAIL_TRAINS) {
    const a =
      d.slope *
      detailFade((2 * Math.PI) / d.freq, pixel) *
      Math.cos((x * d.dir[0] + z * d.dir[1]) * d.freq + t * d.speed);
    gx += a * d.dir[0];
    gz += a * d.dir[1];
  }
  return [gx, gz];
}

/**
 * The band the swell dies out over, as radii from the board's centre.
 *
 * Inside `inner` the water is fully alive; outside `outer` it is flat at
 * `OCEAN_FLAT_Y` and the annulus (see `oceanAnnulusGeometry`) takes over.
 * Displacement, height and normal tilt fade together so the two surfaces meet
 * invisibly. Centred on the lattice origin where `oceanHexes` lays its rings;
 * chosen in `scene.ts`.
 */
export interface OceanFadeBand {
  inner: number;
  outer: number;
}

/** A band so far out that nothing is faded; the default before a board sets one. */
export const OCEAN_FADE_OFF: OceanFadeBand = { inner: 1e6, outer: 2e6 };

/**
 * How much of the swell survives at a world point: 1 near the island, 0 past
 * the band, smoothstepped between. A linear ramp would leave two visible
 * circles where its slope changes.
 */
export function oceanFade(x: number, z: number, band: OceanFadeBand): number {
  const span = band.outer - band.inner;
  if (!(span > 0)) return Math.hypot(x, z) < band.outer ? 1 : 0;
  const t = Math.min(1, Math.max(0, (Math.hypot(x, z) - band.inner) / span));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * How an asset rides the swell.
 *
 * `surface` displaces every vertex, so the mesh is the water. `float` moves the
 * whole instance by the swell at its origin, so a rigid body rides it. Nothing
 * floats today; the mode is kept for future floating props.
 */
export type WaveMode = "surface" | "float";

/**
 * Which materials the water moves, and how. Keyed by material because that is
 * what the shader is attached to.
 */
export const WAVE_MODES: Readonly<Record<string, WaveMode>> = {
  [OCEAN_WATER_MATERIAL]: "surface",
};

const glslNumber = (n: number): string => n.toFixed(6);

/**
 * The swell as GLSL, generated from WAVE_TRAINS so the shader and `oceanWave`
 * (which the tests check) cannot diverge.
 */
export function oceanWaveGLSL(): string {
  const height = WAVE_TRAINS.map(
    (w) =>
      `  h += ${glslNumber(w.weight)} * sin(dot(p, vec2(${glslNumber(w.dir[0])}, ${glslNumber(
        w.dir[1],
      )})) * ${glslNumber(w.freq)} + uOceanTime * ${glslNumber(w.speed)});`,
  ).join("\n");
  const slope = WAVE_TRAINS.map(
    (w) =>
      `  g += ${glslNumber(w.weight * w.freq)} * cos(dot(p, vec2(${glslNumber(
        w.dir[0],
      )}, ${glslNumber(w.dir[1])})) * ${glslNumber(w.freq)} + uOceanTime * ${glslNumber(
        w.speed,
      )}) * vec2(${glslNumber(w.dir[0])}, ${glslNumber(w.dir[1])});`,
  ).join("\n");

  return `
uniform float uOceanTime;
uniform vec2 uOceanFade;

float costanOceanUnit(vec2 p) {
  float h = 0.0;
${height}
  return h;
}

float costanOceanWave(vec2 p) {
  return ${glslNumber(WAVE_AMPLITUDE)} * costanOceanUnit(p) - ${glslNumber(WAVE_DROP)};
}

vec2 costanOceanSlope(vec2 p) {
  vec2 g = vec2(0.0);
${slope}
  return ${glslNumber(WAVE_AMPLITUDE)} * g;
}

float costanOceanFade(vec2 p) {
  return 1.0 - smoothstep(uOceanFade.x, uOceanFade.y, length(p));
}
`;
}

/**
 * What the vertex stage hands the fragment stage. Declared in both, once.
 *
 * Kept to three, since each costs bandwidth on every sea vertex: world
 * position (detail trains are world-space to avoid seams), the fade, and the
 * unit swell height, which the fragment stage could not recover without
 * re-evaluating the trains. Surface only.
 */
export const OCEAN_VARYINGS_GLSL = `
varying vec2 vOceanAt;
varying float vOceanFade;
varying float vOceanUnit;
`;

/**
 * The detail trains as GLSL, generated from DETAIL_TRAINS.
 *
 * `px` is the world width of a pixel, from `fwidth`. Each train's fade is
 * folded into its amplitude instead of a branch: divergent branches around a
 * derivative are undefined.
 */
export function oceanDetailGLSL(): string {
  const trains = DETAIL_TRAINS.map((d) => {
    const lambda = (2 * Math.PI) / d.freq;
    const dir = `vec2(${glslNumber(d.dir[0])}, ${glslNumber(d.dir[1])})`;
    return `  g += ${glslNumber(d.slope)} * (1.0 - smoothstep(${glslNumber(
      lambda * DETAIL_FADE.begin,
    )}, ${glslNumber(lambda * DETAIL_FADE.end)}, px)) * cos(dot(p, ${dir}) * ${glslNumber(
      d.freq,
    )} + uOceanTime * ${glslNumber(d.speed)}) * ${dir};`;
  }).join("\n");

  return `
uniform float uOceanTime;
uniform float uOceanCrest;

vec2 costanOceanDetail(vec2 p, float px) {
  vec2 g = vec2(0.0);
${trains}
  return g;
}
`;
}

/**
 * The block that runs before three's own normal and position chunks.
 *
 * `oceanModel` includes the instance transform, where a tile's position lives
 * (`modelMatrix` alone is the identity here). `oceanScale` divides it back out
 * because the vertex is moved in local space and a sea tile is drawn at
 * LATTICE_SCALE.
 */
function preamble(mode: WaveMode): string {
  const at =
    mode === "surface"
      ? `  vec4 oceanWorld = oceanModel * vec4(position, 1.0);
  vec2 oceanAt = oceanWorld.xz;`
      : // The instance's own origin, so a boat translates instead of
        // deforming.
        `  vec2 oceanAt = oceanModel[3].xz;`;
  return `
#ifdef USE_INSTANCING
  mat4 oceanModel = modelMatrix * instanceMatrix;
#else
  mat4 oceanModel = modelMatrix;
#endif
  float oceanScale = max(length(oceanModel[1].xyz), 1e-4);
${at}
  float oceanF = costanOceanFade(oceanAt);
${
  mode === "surface"
    ? // Evaluated once and carried: displacement, crest ramp and the
      // fragment stage all need it.
      `  float oceanUnit = costanOceanUnit(oceanAt);
  vOceanAt = oceanAt;
  vOceanFade = oceanF;
  vOceanUnit = oceanUnit;
`
    : ""
}`;
}

/**
 * Tilting the authored normal by the swell's own slope.
 *
 * Without it the displaced surface shades as if flat. Adding the in-plane
 * offset is the small-angle form of the rotation, exact enough at these slopes,
 * and keeps the art's faceting. The transpose carries the world-space tilt into
 * object space; dividing by the scale undoes the one it brings.
 *
 * Past the fade band the authored faceting is also faded out, since flat
 * geometry with baked normals shows lit and unlit facets against the annulus's
 * single normal.
 *
 * The flat target is the object-space direction that points up in the world,
 * signed to the face's own hemisphere. The sheet's top face renders as a back
 * face (it needs `DoubleSide`; three negates the normal, and the authored
 * normals point down so the negation lands them up). A literal
 * `vec3(0, 1, 0)` would shade the far water from below.
 *
 * The tilt is signed by the same `oceanFacing`. For a sheet wound down, every
 * component of the height-field normal `(-dh/dx, 1, -dh/dz)` negates;
 * unsigned, crests would shade as troughs. Reading the sign off the mesh keeps
 * this correct if the sheet is re-exported the other way up.
 */
const NORMAL_TILT = `
  vec2 oceanG = costanOceanSlope(oceanAt);
  vec3 oceanUp = normalize(transpose(mat3(oceanModel)) * vec3(0.0, 1.0, 0.0));
  float oceanFacing = dot(objectNormal, oceanUp) < 0.0 ? -1.0 : 1.0;
  vec3 oceanFlat = oceanFacing * oceanUp;
  // The authored faceting is faded by the same fraction as the relief (see
  // \`BAKED_RELIEF\` and \`DISPLACE_SURFACE\`). Flattened geometry that kept its
  // sculpted normals would shade as a patchwork of lit and unlit triangles.
  vec3 oceanBaked = normalize(mix(oceanFlat, normalize(objectNormal), ${glslNumber(BAKED_RELIEF)}));
  vec3 oceanTilt = oceanFacing * (transpose(mat3(oceanModel)) * vec3(-oceanG.x, 0.0, -oceanG.y)) / oceanScale;
  objectNormal = normalize(mix(
    oceanFlat,
    normalize(oceanBaked + oceanTilt),
    oceanF
  ));
`;

/**
 * The surface's displacement: the swell near the island, a plane far from it.
 *
 * `oceanWorld.y` is where the baked relief put this vertex, so the far half of
 * the mix cancels it and lands the vertex on `OCEAN_FLAT_Y`; otherwise the
 * annulus would meet a rippled edge.
 */
const DISPLACE_SURFACE = `
  float oceanBaseY = mix(${glslNumber(OCEAN_FLAT_Y)}, oceanWorld.y - ${glslNumber(
    WAVE_DROP,
  )}, ${glslNumber(BAKED_RELIEF)});
  float oceanY = oceanBaseY + ${glslNumber(WAVE_AMPLITUDE)} * oceanUnit;
  transformed.y += mix(${glslNumber(OCEAN_FLAT_Y)} - oceanWorld.y, oceanY - oceanWorld.y, oceanF) / oceanScale;
`;

/** A boat rides the swell where there is one, and rests where there is not. */
const DISPLACE_FLOAT = `
  transformed.y += oceanF * costanOceanWave(oceanAt) / oceanScale;
`;

/**
 * The detail trains, put on the normal a fragment at a time.
 *
 * After `normal_fragment_maps`, where `normal` is in view space and three has
 * already applied `faceDirection`, so there is no sign to get wrong. It is a
 * computed normal map (the sheet has no UVs).
 *
 * `fwidth` of the world position gives the pixel width each train fades
 * against. `viewMatrix` carries the world-space tilt into view space; adding
 * and renormalising is the small-angle rotation, as in the vertex stage.
 *
 * Multiplied by the fade so the detail dies where the swell does. The annulus
 * is a clone of this material and `Material.copy` drops `onBeforeCompile` (see
 * `annulusMaterial`), so it has no detail term; anything left here would show
 * as a ring at the join.
 */
const DETAIL_NORMAL = `
  {
    float oceanPx = max(length(fwidth(vOceanAt)), 1e-5);
    vec2 oceanDG = vOceanFade * costanOceanDetail(vOceanAt, oceanPx);
    normal = normalize(normal + (viewMatrix * vec4(-oceanDG.x, 0.0, -oceanDG.y, 0.0)).xyz);
  }
`;

/**
 * The crest ramp: the swell's own height, as a tint on the water under it.
 *
 * The one wave cue that doesn't depend on the camera. Seen from overhead every
 * facet returns about the same light, and at night the water is rough (0.82,
 * see `applyWaterLook`) and dimly lit, so shading alone shows little.
 *
 * `vOceanUnit` is -1 to 1 with zero at the mean, so the ramp is symmetric about
 * the sea's colour and independent of the amplitude. `max` guards against a
 * theme strength going negative (black water).
 */
const CREST_COLOR = `
  diffuseColor.rgb *= max(0.0, 1.0 + uOceanCrest * vOceanFade * vOceanUnit);
`;

/** The two vertex injections, as three.js chunk name -> code appended after it. */
export function oceanWaveChunks(mode: WaveMode): Record<string, string> {
  return {
    "#include <beginnormal_vertex>": preamble(mode) + (mode === "surface" ? NORMAL_TILT : ""),
    "#include <begin_vertex>": mode === "surface" ? DISPLACE_SURFACE : DISPLACE_FLOAT,
  };
}

/**
 * The fragment injections. Surface only: neither the detail normal nor the
 * crest tint means anything on a hull.
 */
export function oceanFragmentChunks(mode: WaveMode): Record<string, string> {
  if (mode !== "surface") return {};
  return {
    "#include <color_fragment>": CREST_COLOR,
    "#include <normal_fragment_maps>": DETAIL_NORMAL,
  };
}

/**
 * Every wave clock currently on a material, and the time they all read.
 * Module-level because `loadAsset` caches materials for the life of the tab.
 */
const clocks = new Set<{ value: number }>();
let clockNow = 0;

/** Advance the water. Called by the board's animation loop, in seconds. */
export function setOceanTime(seconds: number): void {
  clockNow = seconds;
  for (const c of clocks) c.value = seconds;
}

export function oceanTime(): number {
  return clockNow;
}

/**
 * The fade band, on every water material at once.
 *
 * Module-level like the clock. Two boards mounted at once (the preview route
 * beside a game) share it and the last one built wins, which is acceptable
 * because an off-screen board isn't drawing.
 */
const fades = new Set<{ value: THREE.Vector2 }>();
let fadeNow: OceanFadeBand = OCEAN_FADE_OFF;

/** Where the swell dies out. Called once per board build. */
export function setOceanFade(band: OceanFadeBand): void {
  fadeNow = band;
  for (const f of fades) f.value.set(band.inner, band.outer);
}

export function currentOceanFade(): OceanFadeBand {
  return fadeNow;
}

/**
 * How hard the crest ramp is pushed, on every water material at once. A
 * uniform, so a theme switch moves a float rather than recompiling.
 */
const crests = new Set<{ value: number }>();
let crestNow = BOARD_LOOKS.light.water.crest;

/** How hard crests are tinted. Set from the look; see `applyWaterLook`. */
export function setOceanCrest(strength: number): void {
  crestNow = strength;
  for (const c of crests) c.value = strength;
}

export function oceanCrest(): number {
  return crestNow;
}

const waved = new WeakSet<THREE.Material>();

/**
 * Put the swell on a material. Idempotent: materials are cached and shared,
 * so this runs again on every board build.
 */
export function applyOceanWave(material: THREE.Material, mode: WaveMode): boolean {
  if (waved.has(material)) return false;
  waved.add(material);

  const clock = { value: clockNow };
  clocks.add(clock);
  const fade = { value: new THREE.Vector2(fadeNow.inner, fadeNow.outer) };
  fades.add(fade);
  const crest = { value: crestNow };
  const chunks = oceanWaveChunks(mode);
  const fragments = oceanFragmentChunks(mode);
  const varyings = mode === "surface" ? OCEAN_VARYINGS_GLSL : "";
  if (mode === "surface") crests.add(crest);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOceanTime = clock;
    shader.uniforms.uOceanFade = fade;
    let src = oceanWaveGLSL() + varyings + shader.vertexShader;
    for (const [include, code] of Object.entries(chunks))
      src = src.replace(include, include + code);
    shader.vertexShader = src;

    if (!Object.keys(fragments).length) return;
    shader.uniforms.uOceanCrest = crest;
    let frag = oceanDetailGLSL() + varyings + shader.fragmentShader;
    for (const [include, code] of Object.entries(fragments)) {
      frag = frag.replace(include, include + code);
    }
    shader.fragmentShader = frag;
  };
  // Without this, three finds a cached program by the material's parameters
  // and gives the water and the boats each other's program.
  material.customProgramCacheKey = () => `costan-ocean-${mode}`;
  material.needsUpdate = true;
  return true;
}

/**
 * Whether a mesh belongs in the shadow pass. The sea does not.
 *
 * Three's shadow depth material never sees `onBeforeCompile`, so the shadow map
 * would use the undisplaced surface and troughs would shadow themselves. The
 * swell is too shallow to self-shadow and the island's shadow doesn't reach
 * the sea, so leaving it out costs nothing. The buried hull goes too.
 */
export function seaCastsShadow(mesh: THREE.Mesh): boolean {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return !mats.some((m) => m.name === OCEAN_WATER_MATERIAL || m.name === OCEAN_HULL_MATERIAL);
}

const sunk = new WeakSet<THREE.Object3D>();

/**
 * Drop the hull clear of the water, leaving everything else where it is.
 *
 * Only the hull may move. As exported, the hull, wave sheet, pier and shoal
 * bank are siblings under `Hex_*`, so the compensating lift for children never
 * runs; it is there in case a re-export parents them to the hull. The test
 * `dressOcean leaves a shoal's own props at their authored height` covers it.
 */
export function sinkOceanHull(asset: LoadedAsset): boolean {
  const hulls = asset.byMaterial.get(OCEAN_HULL_MATERIAL);
  if (!hulls?.length) return false;

  let moved = false;
  for (const hull of hulls) {
    if (sunk.has(hull)) continue;
    sunk.add(hull);
    hull.position.y -= HULL_SINK_LOCAL;
    for (const child of hull.children) child.position.y += HULL_SINK_LOCAL;
    moved = true;
  }
  if (moved) asset.scene.updateMatrixWorld(true);
  return moved;
}

/**
 * A water tile cut in two: its wave sheet, and everything else it carries.
 *
 * For harbour tiles, which turn to point the pier at land (`dockAngle`) and so
 * differ from the `TILE_ROTATION_Y` other tiles take. The swell is world-space
 * and doesn't care, but the baked relief turns with the mesh and would show a
 * crease at the tile edge. Splitting lets the sheet be instanced at the common
 * rotation and the rest at the harbour's; `instanceAsset` can't do that to one
 * asset. Geometry and materials are shared by reference.
 */
export function splitOceanSurface(asset: LoadedAsset): { surface: LoadedAsset; rest: LoadedAsset } {
  const water = new Set(asset.byMaterial.get(OCEAN_WATER_MATERIAL) ?? []);
  const halves = {
    surface: { scene: new THREE.Group(), byMaterial: new Map<string, THREE.Mesh[]>() },
    rest: { scene: new THREE.Group(), byMaterial: new Map<string, THREE.Mesh[]>() },
  };

  asset.scene.updateMatrixWorld(true);
  asset.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const half = water.has(mesh) ? halves.surface : halves.rest;
    // Flattened rather than reparented: the sink is in the hull's transform and
    // the compensating lift in its children's, so a sheet taken out without its
    // inherited matrix would land HULL_SINK too high.
    const copy = new THREE.Mesh(mesh.geometry, mesh.material);
    copy.name = mesh.name;
    copy.applyMatrix4(mesh.matrixWorld);
    half.scene.add(copy);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const key = mat.name || "unnamed";
      half.byMaterial.set(key, [...(half.byMaterial.get(key) ?? []), copy]);
    }
  });

  return halves;
}

/** The materials an asset shipped under `name`. */
function materialsNamed(asset: LoadedAsset, name: string): THREE.Material[] {
  const out = new Set<THREE.Material>();
  for (const mesh of asset.byMaterial.get(name) ?? []) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) if (mat.name === name) out.add(mat);
  }
  return [...out];
}

/**
 * Give the water surface a sky to reflect, and nothing else on the board.
 *
 * `scene.environment` would relight every palette.json material; this reaches
 * only `Mat_Ocean_water` (the sunken hull is skipped). Returns how many
 * materials it dressed.
 *
 * The envMap changes the shader's defines, but three's program key includes
 * envMap and only appends `customProgramCacheKey`, so caching still works.
 */
export function reflectSky(asset: LoadedAsset, look: BoardLook = BOARD_LOOKS.light): number {
  const sky = oceanSky(look);
  let dressed = 0;
  for (const material of materialsNamed(asset, OCEAN_WATER_MATERIAL)) {
    const standard = material as THREE.MeshStandardMaterial;
    if (standard.envMap === sky) continue; // Materials are cached and shared.
    standard.envMap = sky;
    standard.envMapIntensity = look.envIntensity;
    standard.needsUpdate = true;
    dressed++;
  }
  return dressed;
}

/**
 * Repaint the water for a look, in place.
 *
 * `loader.ts` caches by file and dresses each material once, so re-dressing two
 * named materials is cheaper than a second palette. `roughness` matters most:
 * at the day's 0.18 the surface is nearly a mirror, and its direct specular
 * glitter is the only thing visible on a night sea.
 */
export function applyWaterLook(asset: LoadedAsset, look: BoardLook): number {
  // Global like the clock and band: crest strength is a uniform, and all
  // water on the board is the same sea.
  setOceanCrest(look.water.crest);
  let dressed = 0;
  for (const material of materialsNamed(asset, OCEAN_WATER_MATERIAL)) {
    const standard = material as THREE.MeshStandardMaterial;
    standard.color.setRGB(...look.water.color, THREE.LinearSRGBColorSpace);
    standard.roughness = look.water.roughness;
    dressed++;
  }
  for (const material of materialsNamed(asset, OCEAN_HULL_MATERIAL)) {
    const standard = material as THREE.MeshStandardMaterial;
    standard.color.setRGB(...look.hull.color, THREE.LinearSRGBColorSpace);
    dressed++;
  }
  return dressed;
}

/**
 * How many sides the flat sea is cut into. At 96 the chord sags 0.05% of the
 * radius, under a pixel, for 192 triangles.
 */
export const OCEAN_ANNULUS_SEGMENTS = 96;

/**
 * The flat sea beyond the near field: one ring, lying in the y = 0 plane.
 *
 * Past `inner` a sea hex covers a few pixels and its tessellation buys only
 * aliasing, so the hexes stop, the swell fades out (see `oceanFade`), and this
 * continues the same material to the horizon.
 *
 * Placed at `OCEAN_FLAT_Y`, where the faded hexes land, so they are coplanar
 * where they overlap. They have to overlap (hexagons against a circle);
 * `annulusMaterial` settles the depth fight.
 */
export function oceanAnnulusGeometry(
  inner: number,
  outer: number,
  segments = OCEAN_ANNULUS_SEGMENTS,
): THREE.BufferGeometry {
  const ring = new THREE.RingGeometry(inner, Math.max(inner, outer), segments, 1);
  // Authored in XY facing +z; the sea lies in XZ facing +y.
  ring.rotateX(-Math.PI / 2);
  return ring;
}

/**
 * How hard the annulus is pushed behind the water it overlaps.
 *
 * Polygon offset moves depth, not geometry, so there is no step at the join.
 * Sinking the ring instead would need a drop that shows as a ledge when the
 * camera flies low. `factor` matters more than `units` because the ring's
 * depth slope is huge from a low orbit.
 */
export const ANNULUS_DEPTH_OFFSET = { factor: 2, units: 8 } as const;

const annulusMaterials = new WeakMap<THREE.Material, THREE.Material>();

/**
 * The sea's own material, set to lose every depth fight it is in.
 *
 * The annulus and the outer sea hexes are the same water at the same height,
 * so their overlap z-fights. Pushing the ring back lets the hexes win, which
 * is right: inside the fade band they are not flat.
 *
 * A clone so the sea tiles keep normal depth behaviour, cached per source so
 * rebuilds don't leak materials. Colour, sky, shader and uniforms are shared
 * by reference.
 */
export function annulusMaterial(water: THREE.Material): THREE.Material {
  const cached = annulusMaterials.get(water);
  if (cached) return cached;
  const flat = water.clone();
  // Keep the name: `seaCastsShadow` reads it to keep the ring out of the
  // shadow pass.
  flat.userData = { ...flat.userData, costanOceanAnnulus: true };
  flat.polygonOffset = true;
  flat.polygonOffsetFactor = ANNULUS_DEPTH_OFFSET.factor;
  flat.polygonOffsetUnits = ANNULUS_DEPTH_OFFSET.units;
  annulusMaterials.set(water, flat);
  return flat;
}

/**
 * Repaint every piece of water already in a scene for a look.
 *
 * The theme-switch path (`dressOcean` is the load path, and `loadAsset` dresses
 * only once). Materials are shared with the cache, so walking the scene also
 * updates later boards, and it reaches the annulus clone, which keeps its name.
 */
export function applyOceanLook(root: THREE.Object3D, look: BoardLook): void {
  const sky = oceanSky(look);
  setOceanCrest(look.water.crest);
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of list) {
      if (seen.has(m)) continue;
      seen.add(m);
      const standard = m as THREE.MeshStandardMaterial;
      if (m.name === OCEAN_WATER_MATERIAL) {
        standard.color.setRGB(...look.water.color, THREE.LinearSRGBColorSpace);
        standard.roughness = look.water.roughness;
        if (standard.envMap !== sky) {
          standard.envMap = sky;
          // The envMap is part of the program's cache key, so swapping skies
          // needs a recompile; colour and roughness are uniforms and do not.
          standard.needsUpdate = true;
        }
        standard.envMapIntensity = look.envIntensity;
      } else if (m.name === OCEAN_HULL_MATERIAL) {
        standard.color.setRGB(...look.hull.color, THREE.LinearSRGBColorSpace);
      }
    }
  });
}

/**
 * Everything the water needs doing to a freshly loaded asset. A no-op for
 * assets with no sea.
 *
 * `look` defaults to the live look (style and theme via `currentBoardLook`),
 * since `loadAsset` calls this without knowing the theme.
 */
export function dressOcean(asset: LoadedAsset, look: BoardLook = currentBoardLook()): void {
  sinkOceanHull(asset);
  reflectSky(asset, look);
  applyWaterLook(asset, look);
  for (const [name, mode] of Object.entries(WAVE_MODES)) {
    for (const material of materialsNamed(asset, name)) applyOceanWave(material, mode);
  }
}
