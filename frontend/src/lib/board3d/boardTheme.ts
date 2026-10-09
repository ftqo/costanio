// The board's looks, and everything that differs between them.
//
// The board has a night look so a full-viewport sunlit sea is not the
// brightest thing on a dark screen. Night is not the day dimmed: what reads as
// night is a cool cast and no hard sun. The looks differ in the water colour,
// its roughness, the reflected sky, what is in that sky, the lights, and
// whether anything casts a shadow.
//
// A look is picked on two axes:
//
//   mode    light or dark. Follows the site theme, not a player setting.
//   postFx  the player's setting. Off is the plain board; on adds a colour
//           grade, bloom and fireflies, and renders through the HDR path in
//           `oceanPass.ts`.
//
// so the table below is 2x2, indexed by `boardLook(mode, postFx)`.
//
// Post-processing is off by default because of cost. On an M3 Max at 2560x1440
// the water-only frame (run ~30 times a second while a board is open) costs
// 0.83ms without it and 4.14ms with it, and the cost scales with pixels, so
// integrated GPUs fare worse. See `docs/board-postfx.md`.
//
// `pageHex` is not on the post-fx axis. The fog fades to it and it must equal
// the page colour or the sea shows a rim (see `oceanRadius` and the test
// against index.css). `PAGE_HEX` is per mode and no look spec can set it. The
// grade would break the same invariant, which `gradedPageHex` handles.
//
// This module holds values only. `boardMode` and `onBoardModeChange` read the
// DOM, `boardPostFx.ts` owns the second axis, and `Board3D` applies changes.
import type { RGB } from "./seaColor";

export type BoardMode = "light" | "dark";

/**
 * Whether post-processing is on for a viewer who has never set it. Off; see
 * the header.
 */
export const DEFAULT_BOARD_POSTFX = false;

/**
 * The colour grade, applied once at the end of the frame.
 *
 * A look value rather than shader code, so the pass can ask whether it is the
 * identity and skip the HDR path entirely (see `isIdentityGrade`).
 *
 * The shader applies exposure, saturation, tint, then lift. Lifting before
 * saturating would colour the blacks, and saturating after tinting would undo
 * the tint.
 */
export interface BoardGrade {
  /** Multiplier before tone mapping. 1 is untouched. */
  exposure: number;
  /** 1 is untouched, 0 is greyscale, above 1 pushes the authored hues. */
  saturation: number;
  /**
   * Split tone: the tints multiply the colour, blended by luminance (shadows
   * get `shadowTint`, highlights `highlightTint`). Warm highlights over cool
   * shadows is most of what reads as graded.
   */
  shadowTint: RGB;
  highlightTint: RGB;
  /**
   * Added to the darks only, fading out by luminance. Gives haze its milky
   * black instead of crushed shadows.
   */
  lift: RGB;
}

const NO_GRADE: BoardGrade = {
  exposure: 1,
  saturation: 1,
  shadowTint: [1, 1, 1],
  highlightTint: [1, 1, 1],
  lift: [0, 0, 0],
};

/** Whether a grade would change any pixel. See `NO_GRADE`. */
export function isIdentityGrade(g: BoardGrade): boolean {
  const one = (c: RGB) => c[0] === 1 && c[1] === 1 && c[2] === 1;
  const zero = (c: RGB) => c[0] === 0 && c[1] === 0 && c[2] === 0;
  return (
    g.exposure === 1 &&
    g.saturation === 1 &&
    one(g.shadowTint) &&
    one(g.highlightTint) &&
    zero(g.lift)
  );
}

/**
 * Bloom, or null for a look that does not glow.
 *
 * `threshold` is linear, pre-tone-mapping radiance. The board renders into a
 * half-float target that holds values above 1 (see `oceanPass.ts`).
 */
export interface BoardBloom {
  /**
   * Linear radiance a pixel must exceed to contribute.
   *
   * Measure it with `oceanPass.sampleRadiance()`, which reports the scene's
   * distribution in these units; each look records the numbers its threshold
   * came from. Estimating albedo times light intensity is about three times
   * too high (it drops the diffuse BRDF's 1/pi) and puts the threshold above
   * the whole scene, giving no bloom.
   *
   * For scale: the brightest daylight pixel is about 1.3 and the median under
   * 0.8.
   */
  threshold: number;
  /** How much of the blurred result is added back. */
  strength: number;
  /** 0..1, how far up the mip chain the glow is spread. */
  radius: number;
}

/**
 * Fireflies over the island. Placed over land, one hex at a time, never over
 * open water (see `atmosphere.ts`).
 */
export interface BoardMotes {
  color: RGB;
  count: number;
  /** World-unit size of one mote at unit distance. */
  size: number;
  /** How fast they rise and mill about, world units per second. */
  drift: number;
}

export interface BoardLook {
  /**
   * Stable identity for this (style, mode) pair, a cache key for anything
   * built per look (above all the sky texture: 128 KB of float radiance plus a
   * PMREM conversion).
   */
  id: string;
  mode: BoardMode;
  /** Whether this is the post-processed look. See `DEFAULT_BOARD_POSTFX`. */
  postFx: boolean;
  /**
   * The page behind the canvas and the colour the fog fades to. One value
   * because the sea ends where fog has faded it to the page colour (see
   * `oceanRadius`); two values would show a rim around the ocean.
   *
   * Comes from `PAGE_HEX`; no style sets it.
   */
  pageHex: string;
  /** The sky the water reflects. Never drawn; there is no sky geometry. */
  skyHex: string;
  /** What is in that sky: a sun by day, a moon at night. Linear radiance. */
  sunRadiance: RGB;
  /**
   * The body's size and how far its glow reaches, in degrees.
   *
   * Per look because a moon is not a small sun. The sun is broad and soft (14
   * degrees, fading by 40) so its reflection is a wash over the sea. A moon is
   * small and bright, so its reflection is a defined path that comes and goes
   * as the board turns. The radiance rises as the disc shrinks, and the total
   * light is still a fraction of the sun's.
   */
  sunAngleDeg: number;
  sunFalloffDeg: number;
  /** How much of the sky the water shows. See `OCEAN_ENV_INTENSITY`. */
  envIntensity: number;
  /**
   * The key light. `hex` tints it, which only night uses: tinting one light
   * makes the 242 authored materials read as moonlit without re-authoring them.
   */
  key: { hex: number; intensity: number; castShadow: boolean };
  ambient: { hex: number; intensity: number };
  /** The flatter rig the seat-tinted pieces take. */
  tinted: { softIntensity: number; ambientIntensity: number };
  /**
   * The two water materials, overriding palette.json.
   *
   * Only these two vary by theme, which keeps switching cheap: `loader.ts`
   * caches assets by file and dresses each material once, so these two are
   * re-dressed in place by name. See `applyWaterLook`.
   *
   * `crest` is how much the swell's height brightens the water (crests
   * lighter, troughs darker), as a multiple of the base colour. It is the only
   * wave cue visible from directly overhead, where every facet returns the
   * same light. See `oceanCrestGLSL`.
   */
  water: { color: RGB; roughness: number; crest: number };
  /** The hull under the surface. Always darker than the water above it. */
  hull: { color: RGB };
  grade: BoardGrade;
  bloom: BoardBloom | null;
  motes: BoardMotes | null;
  /**
   * Multiplier on palette.json's emissive, so lit windows are dark at noon and
   * bright at night without changing the art. 0 turns it off, as `classic`
   * does. See `setEmissiveBoost`.
   */
  emissive: number;
}

/**
 * The page colour per mode, out of reach of any style. Pinned against
 * `index.css` by `boardTheme.test.ts`; the fog fades to it and the ocean ends
 * where the two match.
 */
const PAGE_HEX: Record<BoardMode, string> = { light: "#1159c1", dark: "#05070d" };

/** Everything a style says, before `pageHex` and `id` are filled in. */
type LookSpec = Omit<BoardLook, "id" | "mode" | "postFx" | "pageHex">;

/**
 * Daylight: the values the board shipped with, so light mode looks as it
 * always did. `classic` grades nothing and has no bloom, as the reference the
 * other styles depart from.
 */
const CLASSIC_DAY: LookSpec = {
  skyHex: "#c2d4e6",
  sunRadiance: [0.95, 0.86, 0.72],
  sunAngleDeg: 14,
  sunFalloffDeg: 40,
  envIntensity: 2.0,
  key: { hex: 0xffffff, intensity: 1.5, castShadow: true },
  ambient: { hex: 0xffffff, intensity: 0.35 },
  tinted: { softIntensity: 0.35, ambientIntensity: 1.15 },
  // The water row in all four looks uses the chosen sea (see `ocean.ts`):
  // roughness 0.16 and a grey-green rather than tropical blue.
  //
  // This look uses the chosen numbers directly. The other three are scaled by
  // the same 0.889 so their relationships hold: night stays roughest (0.729,
  // which removes glitter from a point light) and moonlit stays at 0.489 so the
  // moon's path shows without glitter. Crest ramps are scaled by 0.9.
  //
  // A gentle crest ramp by day: the sun does most of the work, and a strong
  // ramp makes the sea look marbled.
  water: { color: [0.015, 0.069, 0.221], roughness: 0.16, crest: 0.144 },
  hull: { color: [0.02, 0.12, 0.33] },
  grade: NO_GRADE,
  bloom: null,
  motes: null,
  emissive: 0,
};

/**
 * Night.
 *
 * The island is a lit stage and the sea the dark around it, so the numbers,
 * resource art and seat colours stay legible; the darkness goes into the
 * water, sky and page rather than the tiles.
 *
 * `roughness` matters most. A near-mirror sea turns a single light into a
 * field of glitter, which at night is all you see. That glitter is direct
 * specular, so only roughness removes it.
 */
const CLASSIC_NIGHT: LookSpec = {
  skyHex: "#2b3a52",
  sunRadiance: [0.42, 0.47, 0.58],
  sunAngleDeg: 14,
  sunFalloffDeg: 40,
  envIntensity: 2.0,
  key: { hex: 0xb9c6dc, intensity: 2.1, castShadow: false },
  ambient: { hex: 0x8aa0c0, intensity: 0.88 },
  tinted: { softIntensity: 0.22, ambientIntensity: 0.95 },
  // Stronger than the day's: at this roughness there is no specular to shape
  // the water, so the height ramp is nearly the only wave cue. It multiplies a
  // near-black colour, so the effect stays subtle.
  water: { color: [0.00425, 0.011845, 0.028135], roughness: 0.729, crest: 0.306 },
  hull: { color: [0.002, 0.006, 0.02] },
  grade: NO_GRADE,
  bloom: null,
  motes: null,
  emissive: 0,
};

/**
 * Vibrant, by day.
 *
 * The art's flat colour is the design and the tone mapper preserves it
 * (`NeutralToneMapping`, see `Board3D`), so raising exposure and saturation
 * alone just makes it louder and blows out the resource art. The lift comes
 * from four things instead: a warm key against a cool ambient, a saturated sky
 * for the water to reflect, bloom on the reflected specular, and a strong crest
 * ramp. The grade is the smallest of the four.
 */
const VIBRANT_DAY: LookSpec = {
  // A real sky rather than near-white haze. Mostly only the water reflects it,
  // and half the screen is sea.
  skyHex: "#7cc6ef",
  // Above 1 and warm. The sun is the one thing allowed to exceed white, so it
  // crosses the bloom threshold.
  sunRadiance: [1.45, 1.18, 0.82],
  sunAngleDeg: 14,
  sunFalloffDeg: 40,
  envIntensity: 2.6,
  key: { hex: 0xffeed0, intensity: 1.8, castShadow: true },
  // Cool fill under a warm key; only the colours changed, so shadows stay
  // readable while lit faces go golden.
  ambient: { hex: 0xa6cdff, intensity: 0.42 },
  tinted: { softIntensity: 0.38, ambientIntensity: 1.18 },
  water: { color: [0.0175, 0.09775, 0.289], roughness: 0.124, crest: 0.27 },
  hull: { color: [0.02, 0.13, 0.36] },
  grade: {
    exposure: 1.04,
    saturation: 1.15,
    shadowTint: [0.94, 0.98, 1.08],
    highlightTint: [1.06, 1.01, 0.94],
    lift: [0, 0, 0],
  },
  // Measured with `oceanPass.sampleRadiance()`: p50 0.79, p90 0.92, p99 1.03,
  // max 1.29. The threshold sits just under p99, so the sunlit sand, beach and
  // the sun's reflection glow and the rest is untouched.
  bloom: { threshold: 0.95, strength: 0.7, radius: 0.7 },
  // Nothing in the air by day; fireflies are night only.
  motes: null,
  emissive: 0.55,
};

/**
 * Vibrant, by night.
 *
 * The board is the only light source: windows are lit (`emissive`), the bloom
 * threshold drops below 1 so they bleed, and the reflected sky goes violet so
 * the sea is a dark colour rather than black.
 */
const VIBRANT_NIGHT: LookSpec = {
  skyHex: "#3d3080",
  // The moon is the same sky body as the sun (`oceanEnv.ts` draws one body at
  // `KEY_DIR`, with shared `SUN_COS` and `SUN_FALLOFF_COS`), cool instead of
  // warm.
  //
  // The disc shrinks from 14 degrees to 3 (about the smallest that survives
  // blurring to the water's roughness in a 512-wide sky) and the radiance rises
  // to compensate: a twentieth of the area at three times the brightness. The
  // board is lit at a fraction of noon while the reflection stays visible. A
  // wider disc makes a sheen over the whole sea instead of a path.
  sunRadiance: [2.6, 2.9, 3.6],
  sunAngleDeg: 3,
  sunFalloffDeg: 9,
  envIntensity: 2.4,
  // The violet is in the sky, water and shadows, not the lights. Light reaches
  // all 234 authored materials, so a saturated violet rig shifts every terrain
  // the same way: forest greens go grey, desert goes pink, and terrains become
  // hard to tell apart, while tone-mapped highlights go near-white.
  //
  // So these are close to `classic`'s cool grey-blue, and the colour comes
  // from the grade's `shadowTint`, which only reaches the darks.
  key: { hex: 0xb2c0e8, intensity: 2.1, castShadow: false },
  ambient: { hex: 0x8496c0, intensity: 0.86 },
  tinted: { softIntensity: 0.24, ambientIntensity: 0.98 },
  // Roughness decides whether there is a moon path. At 0.74 the reflection is
  // a uniform wash. Lower, the environment's small moon shows as a broken path
  // on the swell when the board is turned toward it. Glitter stays away because
  // it comes from direct specular, which the night key is too dim to drive.
  water: { color: [0.00625, 0.0161, 0.0442], roughness: 0.489, crest: 0.378 },
  hull: { color: [0.002, 0.007, 0.024] },
  grade: {
    exposure: 1.0,
    // Saturation amplifies the existing hue (here the moonlight's) rather than
    // adding one.
    saturation: 1.18,
    // The style's violet lives here. Tints blend by luminance, so this reaches
    // the darks and leaves lit faces nearly alone; a night board is mostly
    // shadow, so the cast shows without repainting the terrain.
    shadowTint: [0.9, 0.94, 1.16],
    highlightTint: [1.06, 1.0, 0.97],
    lift: [0, 0, 0],
  },
  // Measured: p50 0.10, p90 0.36, p99 0.64, max 0.96. The same just-under-p99
  // rule lands far lower than the day, hence per-look thresholds. Stronger than
  // the day because nothing competes with it on a dark surround.
  bloom: { threshold: 0.6, strength: 1.0, radius: 0.85 },
  // Fireflies, warm against the violet night.
  //
  // `size` is in world units, set against the art: a sheep on the pasture tile
  // is 0.44 tall and a firefly is a bit over half that. Fewer and bigger reads
  // as insects; many small ones read as noise.
  //
  // The colour is above 1 so it crosses the 0.6 bloom threshold; at 1.0 they
  // barely changed the tiles they were added to.
  motes: { color: [2.6, 2.0, 0.9], count: 44, size: 0.25, drift: 0.28 },
  emissive: 1.7,
};

const SPECS: Record<"plain" | "post", Record<BoardMode, LookSpec>> = {
  plain: { light: CLASSIC_DAY, dark: CLASSIC_NIGHT },
  post: { light: VIBRANT_DAY, dark: VIBRANT_NIGHT },
};

function build(postFx: boolean, mode: BoardMode): BoardLook {
  const key = postFx ? "post" : "plain";
  return { ...SPECS[key][mode], id: `${key}:${mode}`, mode, postFx, pageHex: PAGE_HEX[mode] };
}

/**
 * All four looks, built once at import. Look objects are used as identities:
 * `oceanEnv` memoises its sky against the look and `atmosphere` compares spec
 * objects, so new objects per call would rebuild the sky and motes.
 */
const LOOKS = {
  plain: { light: build(false, "light"), dark: build(false, "dark") },
  post: { light: build(true, "light"), dark: build(true, "dark") },
};

/**
 * The board without post-processing. Many places (defaults, tests, the
 * thumbnail renderer) mean "the plain board" and use this name.
 */
export const BOARD_LOOKS: Record<BoardMode, BoardLook> = LOOKS.plain;

export function boardLook(mode: BoardMode, postFx: boolean = DEFAULT_BOARD_POSTFX): BoardLook {
  return (postFx ? LOOKS.post : LOOKS.plain)[mode];
}

/**
 * Which mode is current, read from the class `applyTheme` sets.
 *
 * `lib/theme.ts` toggles a class on `documentElement` and everything else
 * follows through CSS. WebGL has no cascade, so the board reads the class.
 *
 * Defaults to light where there is no DOM (tests, server rendering).
 */
export function boardMode(): BoardMode {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Call `cb` whenever the mode changes. Returns an unsubscribe.
 *
 * A MutationObserver on the class attribute, filtered to actual mode changes,
 * since the class list also changes for unrelated reasons.
 */
export function onBoardModeChange(cb: (mode: BoardMode) => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => {};
  }
  let last = boardMode();
  const obs = new MutationObserver(() => {
    const now = boardMode();
    if (now === last) return;
    last = now;
    cb(now);
  });
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
