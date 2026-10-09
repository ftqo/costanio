import { test, expect } from "vitest";
import * as THREE from "three";
import { KEY_DIR } from "./scene";
import { OCEAN_ENV_INTENSITY, oceanSky, skyEquirect, skyRadiance } from "./oceanEnv";

const luma = ([r, g, b]: [number, number, number]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The unit direction at azimuth `deg` (CCW from +x) and elevation `elev` degrees. */
function dir(deg: number, elev: number): [number, number, number] {
  const a = (deg * Math.PI) / 180;
  const e = (elev * Math.PI) / 180;
  return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
}

test("the sky is brightest at the sun, and the sun is where the key light is", () => {
  const atSun = luma(skyRadiance(KEY_DIR.x, KEY_DIR.y, KEY_DIR.z));
  // Same elevation, but a quarter turn and a half turn away around the sky.
  const elev = (Math.asin(KEY_DIR.y) * 180) / Math.PI;
  const azimuth = (Math.atan2(KEY_DIR.z, KEY_DIR.x) * 180) / Math.PI;
  expect(atSun).toBeGreaterThan(luma(skyRadiance(...dir(azimuth + 90, elev))));
  expect(atSun).toBeGreaterThan(luma(skyRadiance(...dir(azimuth + 180, elev))));
});

test("every direction has some sky in it", () => {
  // A mirror reflection off flat water at the board camera's elevation lands
  // in the upper hemisphere at every azimuth, and none of those may be black.
  // Asserted relatively, plus a floor meaning only "not black", so a darker
  // sky tint doesn't fail it.
  const around = [];
  for (let deg = 0; deg < 360; deg += 15) {
    const here = luma(skyRadiance(...dir(deg, 56)));
    expect(Number.isFinite(here)).toBe(true);
    expect(here).toBeGreaterThan(0.01); // not black
    around.push(here);
  }
  // Measured against the median, not the max: at a fixed elevation the base
  // sky is the same at every azimuth, so the max is just wherever the sun is.
  const sorted = [...around].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  expect(Math.min(...around)).toBeGreaterThan(median * 0.9);
});

test("the sun's glow is wide enough to be seen from most of the orbit", () => {
  // The sun must be broad, not merely present, or the glint shows from one
  // side only. Measured against the sky a half turn away at the same
  // elevation, the darkest the gradient gets at that height.
  const elev = (Math.asin(KEY_DIR.y) * 180) / Math.PI;
  const azimuth = (Math.atan2(KEY_DIR.z, KEY_DIR.x) * 180) / Math.PI;
  const away = luma(skyRadiance(...dir(azimuth + 180, elev)));
  const lit = (off: number) => luma(skyRadiance(...dir(azimuth + off, elev))) > away * 1.05;
  expect(lit(30)).toBe(true);
  expect(lit(-30)).toBe(true);
});

test("the horizon is brighter than the zenith and the sea darker than both", () => {
  // The gradient makes the reflection change as the camera tilts; a flat sky
  // would leave the water flat.
  const zenith = luma(skyRadiance(0, 1, 0));
  const horizon = luma(skyRadiance(...dir(90, 0)));
  const below = luma(skyRadiance(0, -1, 0));
  expect(horizon).toBeGreaterThan(zenith);
  expect(zenith).toBeGreaterThan(below);
});

test("the sky crosses its own horizon without a seam", () => {
  // A step in the environment reads as a hard line drawn across the water.
  const above = luma(skyRadiance(...dir(90, 1)));
  const below = luma(skyRadiance(...dir(90, -1)));
  expect(Math.abs(above - below)).toBeLessThan(0.05);
});

test("the equirect puts the sun where three samples it", () => {
  // three's `equirectUv` is u = atan2(z, x)/2pi + 0.5 and v = asin(y)/pi + 0.5,
  // and a DataTexture is not flipped on upload, so row 0 points down. The
  // nearly symmetric gradient wouldn't show a flip; the sun does.
  const w = 128;
  const h = 64;
  const data = skyEquirect(w, h);
  const at = (row: number, col: number) => {
    const i = (row * w + (((col % w) + w) % w)) * 4;
    return luma([data[i], data[i + 1], data[i + 2]]);
  };

  const sunRow = Math.floor((Math.asin(KEY_DIR.y) / Math.PI + 0.5) * h);
  const sunCol = Math.floor((Math.atan2(KEY_DIR.z, KEY_DIR.x) / (Math.PI * 2) + 0.5) * w);
  // Above the equator: the sun is in the sky, not under the sea.
  expect(sunRow).toBeGreaterThan(h / 2);

  // Right column, so the azimuth is not mirrored.
  expect(at(sunRow, sunCol)).toBeGreaterThan(at(sunRow, sunCol + w / 2));
  // Right row, so `v` is not upside down. Compared against the mirrored row
  // below the equator, where a flipped upload would put the sun and where the
  // gradient is darkest.
  expect(at(sunRow, sunCol)).toBeGreaterThan(at(h - 1 - sunRow, sunCol));
});

test("every pixel is a usable radiance", () => {
  const data = skyEquirect(32, 16);
  for (let i = 0; i < data.length; i++) {
    expect(Number.isFinite(data[i])).toBe(true);
    expect(data[i]).toBeGreaterThanOrEqual(0);
  }
  // Alpha, which three still reads even though nothing here is transparent.
  for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(1);
});

test("the texture is handed over as a linear equirect, built once", () => {
  const sky = oceanSky();
  // Equirect rather than a hand-run PMREM: three converts it per renderer and
  // caches the result, so a remount can't reflect a dead context's texture.
  expect(sky.mapping).toBe(THREE.EquirectangularReflectionMapping);
  // Radiance, not colour. Decoding this as sRGB would darken the whole sky.
  expect(sky.colorSpace).toBe(THREE.LinearSRGBColorSpace);
  expect(sky.type).toBe(THREE.FloatType);
  // Azimuth wraps; elevation must not, or the poles bleed into each other.
  expect(sky.wrapS).toBe(THREE.RepeatWrapping);
  expect(sky.wrapT).toBe(THREE.ClampToEdgeWrapping);
  expect(oceanSky()).toBe(sky);
});

test("the water shows more of the sky than Fresnel alone would give it", () => {
  // At the default camera's elevation Schlick gives about 0.04, too little to
  // read. See the constant's doc comment.
  expect(OCEAN_ENV_INTENSITY).toBeGreaterThan(1);
});
