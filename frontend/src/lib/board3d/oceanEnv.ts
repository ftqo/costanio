// The sky the water reflects.
//
// Without an environment the sea's only specular is one GGX lobe from the key
// light (KEY_DIR, azimuth -35.5, elevation 52), so the glint is visible from a
// narrow arc of the orbit and absent from about four fifths of it. Moving or
// camera-following the light would shift the island's shading and shadows, so
// instead the water gets a sky to reflect.
//
// The sky is a small procedural equirect gradient with a sun, generated at run
// time rather than shipping an HDR. With an envMap:
//
//   - The reflection turns with the camera, so there is sky in it at every
//     azimuth.
//   - Fresnel shows: MeshStandardMaterial's Schlick (F0 = 0.04) applies
//     everywhere, so grazing angles brighten and steep ones stay dark.
//   - metalness is 0, so this adds specular only; palette.json still owns the
//     diffuse colour.
//
// Not `scene.environment`, which would light all 242 palette.json materials
// and undo the flat-shaded look. The texture goes on `Mat_Ocean_water` only.
import * as THREE from "three";
import { KEY_DIR } from "./scene";
import { hexToLinear, scaleRGB, type RGB } from "./seaColor";
import { BOARD_LOOKS, type BoardLook } from "./boardTheme";

export type { RGB };

/**
 * How much of the sky the water shows.
 *
 * Above 1 on purpose: at the default 56-degree camera, Schlick gives about
 * 0.04, which is too little to read. The multiplier keeps the Fresnel fall-off
 * (grazing angles still brighten relative to steep ones). Tuned by eye; much
 * higher and the sea goes pale and the tone mapper flattens it.
 */
export const OCEAN_ENV_INTENSITY = 2.0;

/**
 * The gradient stops for a look, derived from its one sky colour: brighter
 * toward the horizon, deeper overhead, dark below. Only brightness varies, so a
 * night sky is one colour.
 *
 * Memoised per look because `skyEquirect` asks once per pixel and the
 * conversion is a pow() per channel.
 */
interface SkyStops {
  zenith: RGB;
  horizon: RGB;
  nadir: RGB;
  sun: RGB;
}

const stopsCache = new WeakMap<BoardLook, SkyStops>();

function skyStops(look: BoardLook): SkyStops {
  const hit = stopsCache.get(look);
  if (hit) return hit;
  const base = hexToLinear(look.skyHex);
  const made: SkyStops = {
    zenith: scaleRGB(base, 0.3),
    horizon: scaleRGB(base, 1.0),
    // Below the horizon: dark, so troughs don't fill in and the crests carry
    // the light.
    nadir: scaleRGB(base, 0.06),
    sun: look.sunRadiance,
  };
  stopsCache.set(look, made);
  return made;
}

/**
 * The body's angular size, and how far past its disc the glow reaches, both as
 * cosines of a half-angle.
 *
 * Per look: this is what makes a moon different from a dim sun. The sun is
 * broad and soft (14 degrees, out by 40), because PMREM turns a hard disc into
 * a clipped blob and daylight wants a bright region around KEY_DIR. A moon is
 * small, since a broad body reflects as an even wash. See `sunAngleDeg` in
 * `boardTheme.ts` for the numbers.
 */
function sunCosines(look: BoardLook): { disc: number; falloff: number } {
  return {
    disc: Math.cos((look.sunAngleDeg * Math.PI) / 180),
    falloff: Math.cos((look.sunFalloffDeg * Math.PI) / 180),
  };
}

/** Smoothstep, the usual one. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * The sky's linear radiance in a direction. `dir` must be unit length. Pure,
 * so the gradient is testable without WebGL.
 *
 * The ramp above the horizon is linear in `y`. The sampled range is already
 * high (a mirror reflection at the default camera lands near y = 0.83, spread
 * to about 0.4..1.0 by the swell), so curving it would change little there and
 * would put an infinite slope at the horizon, a bright seam at grazing angles.
 */
export function skyRadiance(
  x: number,
  y: number,
  z: number,
  look: BoardLook = BOARD_LOOKS.light,
): RGB {
  const { zenith, horizon, nadir, sun } = skyStops(look);
  const sky =
    y >= 0
      ? mix(horizon, zenith, Math.min(1, y))
      : // Below the horizon, fade rather than cut; a seam in the environment
        // shows as a seam in the reflection.
        mix(horizon, nadir, smoothstep(0, 0.35, -y));

  const { disc, falloff } = sunCosines(look);
  const toSun = x * KEY_DIR.x + y * KEY_DIR.y + z * KEY_DIR.z;
  if (toSun <= falloff) return sky;
  const glow = smoothstep(falloff, disc, toSun);
  return [sky[0] + sun[0] * glow, sky[1] + sun[1] * glow, sky[2] + sun[2] * glow];
}

/**
 * The sky as equirectangular RGBA float pixels, row 0 pointing straight down.
 *
 * The mapping matches three's `equirectUv`: `u = atan2(z, x) / 2pi + 0.5`
 * and `v = asin(y) / pi + 0.5`. A DataTexture is not flipped on upload, so row
 * `j` is `v = (j + 0.5) / height`, bottom first. The test pins the sun's row,
 * since a flip doesn't show in the near-symmetric gradient.
 */
export function skyEquirect(
  width: number,
  height: number,
  look: BoardLook = BOARD_LOOKS.light,
): Float32Array {
  const data = new Float32Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    const elevation = ((j + 0.5) / height - 0.5) * Math.PI;
    const y = Math.sin(elevation);
    const r = Math.cos(elevation);
    for (let i = 0; i < width; i++) {
      const azimuth = ((i + 0.5) / width - 0.5) * Math.PI * 2;
      const [red, green, blue] = skyRadiance(r * Math.cos(azimuth), y, r * Math.sin(azimuth), look);
      const at = (j * width + i) * 4;
      data[at] = red;
      data[at + 1] = green;
      data[at + 2] = blue;
      data[at + 3] = 1;
    }
  }
  return data;
}

/**
 * Resolution of the generated sky.
 *
 * 512x256 is 1.4 pixels per degree, so the 5-degree moon is a seven-pixel disc
 * with a twenty-pixel glow, enough for PMREM to filter (128x64 aliased it to a
 * speck). 2 MB of float RGBA per look, built once and cached by `look.id`; only
 * looks a viewer sees are built.
 */
const SKY_WIDTH = 512;
const SKY_HEIGHT = 256;

/**
 * Keyed by `look.id` rather than by the look object, so a rebuilt look object
 * (a tuning panel, a test) still reuses the same sky and its PMREM.
 */
const skies = new Map<string, THREE.DataTexture>();

/**
 * The sky texture for a look, built once and shared.
 *
 * A plain equirect rather than a PMREM cube: `WebGLCubeUVMaps` converts an
 * `EquirectangularReflectionMapping` texture itself and caches per renderer, so
 * remounts and multiple boards each get a valid copy. A hand-run
 * `PMREMGenerator` result is bound to one context and goes black in another.
 */
export function oceanSky(look: BoardLook = BOARD_LOOKS.light): THREE.DataTexture {
  const hit = skies.get(look.id);
  if (hit) return hit;
  const sky = new THREE.DataTexture(
    skyEquirect(SKY_WIDTH, SKY_HEIGHT, look),
    SKY_WIDTH,
    SKY_HEIGHT,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  sky.mapping = THREE.EquirectangularReflectionMapping;
  // The data is radiance, not colour: it must not be decoded as sRGB.
  sky.colorSpace = THREE.LinearSRGBColorSpace;
  sky.minFilter = THREE.LinearFilter;
  sky.magFilter = THREE.LinearFilter;
  // Azimuth wraps and elevation does not.
  sky.wrapS = THREE.RepeatWrapping;
  sky.wrapT = THREE.ClampToEdgeWrapping;
  sky.needsUpdate = true;
  skies.set(look.id, sky);
  return sky;
}
