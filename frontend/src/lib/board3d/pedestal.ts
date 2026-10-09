// A legal spot drawn as light on the board rather than a decal on it.
//
// The pip (markers.ts) is a flat yellow disc: unmistakable, but it reads as a
// sticker, and from a low camera as an ellipse. The pedestal has three parts:
//
//   The pool. A soft round spill on the ground, brightest at the middle. Marks
//   the exact spot, sits under pieces and terrain, and survives at distance.
//
//   The column. A short open cylinder on the pool, fading as it rises. Its
//   height keeps it visible from a low camera and over hills.
//
//   The motes. A few points drifting up and fading. Motion marks the spot as
//   offered rather than scenery (the board has plenty of static gold), and it
//   registers in peripheral vision.
//
// All additive with depth testing off, like the pip: UI in the scene, never in
// shadow, visible through the piece in front. Additive so overlapping pools
// brighten instead of muddying.
//
// The animation is one shared clock uniform; each material derives its phase
// from world position, so there is no per-instance attribute or per-frame CPU
// work. The motes are `THREE.Points`, billboarded by the hardware.
import * as THREE from "three";
import { LATTICE_SIZE } from "./coords";
import type { MarkerKind } from "./markers";
import { MARKER_COLOR } from "./markers";

/** The pip's gold (owned by markers.ts), so "on offer" is one colour everywhere. */
export const PEDESTAL_COLOR = MARKER_COLOR;

/**
 * How big each part is, per kind of spot.
 *
 * `pool` is close to the pip's radius so switching styles doesn't move a spot.
 * `height` is the column in world units, capped below the pieces (1.5 to 2.25
 * tall) or it reads as a beam.
 *
 * The hex (robber) is mostly pool spread over the tile, with the column a low
 * glow at the middle so the number chip stays readable.
 */
export const PEDESTAL_SIZE = {
  vertex: { pool: LATTICE_SIZE * 0.26, height: LATTICE_SIZE * 0.34 },
  edge: { pool: LATTICE_SIZE * 0.21, height: LATTICE_SIZE * 0.26 },
  hex: { pool: LATTICE_SIZE * 0.82, height: LATTICE_SIZE * 0.12 },
} as const satisfies Record<MarkerKind, { pool: number; height: number }>;

/**
 * How bright each part sits, before the breathe. Per kind.
 *
 * Additive light only adds what the ground leaves room for. A hex pool covers
 * most of a tile and reads at low alpha; a vertex pool is small and on bright
 * wheat or sand vanished at the same alpha. Sixty overlapping settlement pools
 * hid this by accumulating; two knight pools alone did not.
 */
export const PEDESTAL_ALPHA = {
  vertex: { pool: 0.85, column: 0.5, motes: 0.95 },
  edge: { pool: 0.8, column: 0.45, motes: 0.9 },
  // The hex keeps gentler numbers: stronger turns a tile-wide wash into a
  // spotlight that buries the tile.
  hex: { pool: 0.32, column: 0.16, motes: 0.7 },
} as const satisfies Record<MarkerKind, { pool: number; column: number; motes: number }>;

/**
 * The rim's share of the pool, and its ceiling.
 *
 * The pool is additive and saturates on bright terrain, while the rim is
 * normal-blended near-black paint with full range. Scaling both by the same
 * gain made a louder setting read darker. As a capped fraction of the pool,
 * the rim never outruns the light it edges.
 */
const RIM_SHARE = 0.3;
const RIM_CEILING = 0.26;

/** How dark the rim sits for a kind at a given resting brightness. */
export function rimAlpha(kind: MarkerKind, resting: number | undefined): number {
  return Math.min(RIM_CEILING, PEDESTAL_ALPHA[kind].pool * pedestalGain(resting) * RIM_SHARE);
}

/**
 * The resting brightness `PEDESTAL_ALPHA` is written for.
 *
 * `restingMarkers` is one "how plainly" dial across both styles; the pedestal
 * applies a gain of `resting / PEDESTAL_REST` to every part, keeping its
 * proportions. The right loudness depends on how many spots there are (see
 * `restingForCount`).
 */
export const PEDESTAL_REST = 0.42;

/** The gain a resting brightness asks for, with 1 for a caller that named none. */
export function pedestalGain(resting: number | undefined): number {
  return resting === undefined ? 1 : Math.max(0, resting) / PEDESTAL_REST;
}

/**
 * How bright the mark under the pointer is.
 *
 * Above the loudest resting value so it wins against a field of resting marks.
 * Same pool and rim, brighter, without the column and motes: the spot has
 * already been found.
 */
export const PEDESTAL_HOVER_REST = PEDESTAL_REST * 1.8;

/**
 * How loud a few spots want to be, and how loud many do. Two knight corners
 * must be found on a bright field; sixty setup corners only need to read as a
 * set. Set by eye.
 */
export const REST_FEW = 0.42;
export const REST_MANY = 0.24;

/** Where the two ends are measured. Below `FEW` and above `MANY` it flattens. */
const FEW = 6;
const MANY = 40;

/**
 * The resting brightness a set of `n` spots asks for.
 *
 * Under half a dozen the mark is being searched for; past forty the player is
 * choosing among them. Flat outside the two ends: one spot is no louder than
 * two, and dimming past forty only makes the field harder to see.
 */
export function restingForCount(n: number): number {
  if (n <= FEW) return REST_FEW;
  if (n >= MANY) return REST_MANY;
  return REST_FEW + ((REST_MANY - REST_FEW) * (n - FEW)) / (MANY - FEW);
}

/**
 * The rim: a thin dark ring at the pool's edge, the one part that isn't light.
 *
 * Additive gold on pale terrain washes toward white. Like the pip's
 * `OUTLINE_COLOR`, the dark ring supplies the contrast, and it makes the mark
 * read as a socket the column stands in.
 */
const RIM_COLOR = 0x1c2b4a;

/**
 * How far the breathe swings, as a fraction of the resting alpha. Small: it
 * should register peripherally, not blink, or sixty candidates become an alarm.
 */
export const BREATHE_DEPTH = 0.22;

/** Milliseconds per breath. A mote's flight is its own, per MoteSpec. */
export const BREATHE_MS = 2600;

/** The clock every pedestal material shares. One object, one write per frame. */
export interface PedestalClock {
  value: number;
}

export function pedestalClock(): PedestalClock {
  return { value: 0 };
}

/**
 * A whole field of marks, coming up or going away.
 *
 * A second shared uniform beside the clock: one number a frame fades the whole
 * field. Marks appearing or vanishing between two frames read as a fault, and
 * arming a mode lights a dozen spots at once.
 *
 * A fading-out field has already been detached from the effect that built it,
 * so it has to outlive its teardown and dispose itself. See Board3D's
 * `fadingMarkers`.
 */
export interface PedestalFade {
  value: number;
}

export function pedestalFade(from = 0): PedestalFade {
  return { value: from };
}

/** How long a field takes to come up, and to go away. */
export const FADE_IN_MS = 220;
export const FADE_OUT_MS = 180;

/**
 * Out is quicker than in: going away answers a question already settled (the
 * piece is placed, the mode disarmed), and a lingering mark looks unnoticed.
 */
export function fadeAt(elapsedMs: number, ms: number): number {
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= ms) return 1;
  const t = elapsedMs / ms;
  // Smoothstep: no hard start or stop.
  return t * t * (3 - 2 * t);
}

/**
 * The breathe, with no per-instance data.
 *
 * The phase comes from the spot's world position, so neighbouring pedestals
 * are out of step and the field shimmers. The multipliers are irrational-ish so
 * the pattern doesn't form stripes on the hex lattice.
 */
const BREATHE_GLSL = `
float costanBreathe(vec3 at, float t, float depth) {
  float phase = at.x * 0.63 + at.z * 0.47;
  return 1.0 - depth + depth * (0.5 + 0.5 * sin(t * ${(Math.PI * 2000) / BREATHE_MS} + phase));
}
`;

/**
 * The world point a fragment belongs to, added as a varying.
 *
 * `instanceMatrix` exists only when three compiles for an InstancedMesh, which
 * is every real use but not the tests, so the guard is needed.
 *
 * The trailing newline matters: these are prepended to a shader starting with
 * `#include <common>`, and a directive must begin its own line or the program
 * fails with "'#' : invalid character".
 */
const WORLD_VARYING = `varying vec3 vCostanWorld;\n`;
/** Declared beside the clock in every fragment shader that reads it. */
const FADE_UNIFORM = `uniform float uCostanFade;\n`;
const WORLD_VERTEX = `
  #ifdef USE_INSTANCING
    vCostanWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vCostanWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif
`;

/**
 * A material that is light rather than paint.
 *
 * Additive blending with `depthWrite` and `depthTest` off: no visible edge where
 * the mark meets the board, and no piece can hide it. `toneMapped: false` so UI
 * isn't graded or bloomed with the scene (see postfx.ts).
 */
function glowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: PEDESTAL_COLOR,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

/** The pool: a disc on the ground, brightest at its middle. */
export function poolGeometry(kind: MarkerKind): THREE.BufferGeometry {
  // Enough segments for a smooth circle at hex-pool size.
  const g = new THREE.CircleGeometry(PEDESTAL_SIZE[kind].pool, kind === "hex" ? 48 : 28);
  // CircleGeometry is authored in XY; the board is XZ.
  g.rotateX(-Math.PI / 2);
  return g;
}

export function poolMaterial(
  kind: MarkerKind,
  clock: PedestalClock,
  fade: PedestalFade,
  resting?: number,
): THREE.MeshBasicMaterial {
  const m = glowMaterial();
  m.opacity = PEDESTAL_ALPHA[kind].pool * pedestalGain(resting);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCostanTime = clock;
    shader.uniforms.uCostanFade = fade;
    shader.vertexShader = (WORLD_VARYING + shader.vertexShader).replace(
      "#include <project_vertex>",
      WORLD_VERTEX + "#include <project_vertex>",
    );
    shader.fragmentShader = (
      `uniform float uCostanTime;\n` +
      FADE_UNIFORM +
      WORLD_VARYING +
      BREATHE_GLSL +
      shader.fragmentShader
    ).replace(
      "#include <dithering_fragment>",
      `
      {
        // CircleGeometry's uv is 0..1 with the centre at 0.5, so this is the
        // fragment's distance from the middle as a fraction of the radius.
        float r = clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0);
        // Squared falloff for the spill, plus a tight core term on top.
        // The spill alone washes out on pale terrain; the core gives the mark
        // a bright middle. As an eighth power it is gone well before the rim,
        // so it adds no edge.
        float edge = 1.0 - r;
        float fall = edge * edge + 0.75 * pow(edge, 8.0);
        gl_FragColor.a *= fall * costanBreathe(vCostanWorld, uCostanTime, ${BREATHE_DEPTH}) * uCostanFade;
      }
      #include <dithering_fragment>`,
    );
  };
  // Without this, three matches materials by parameters and hands one patched
  // material another's shader.
  m.customProgramCacheKey = () => `costan-pedestal-pool-${kind}`;
  // `vUv` is declared only when three thinks something uses it. USE_UV, not
  // USE_MAP: USE_MAP also declares `vMapUv` and samples a `map` this material
  // doesn't have, which fails to compile.
  m.defines = { ...(m.defines ?? {}), USE_UV: "" };
  return m;
}

/** The rim: a thin ring sitting just inside the pool's edge. */
export function rimGeometry(kind: MarkerKind): THREE.BufferGeometry {
  const r = PEDESTAL_SIZE[kind].pool;
  const g = new THREE.RingGeometry(r * 0.82, r * 0.98, kind === "hex" ? 48 : 28);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * The rim is drawn as paint, with normal blending, so it can go darker than
 * what is behind it. It breathes with the rest so the mark stays one piece.
 */
export function rimMaterial(
  kind: MarkerKind,
  clock: PedestalClock,
  fade: PedestalFade,
  resting?: number,
): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: RIM_COLOR,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  m.opacity = rimAlpha(kind, resting);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCostanTime = clock;
    shader.uniforms.uCostanFade = fade;
    shader.vertexShader = (WORLD_VARYING + shader.vertexShader).replace(
      "#include <project_vertex>",
      WORLD_VERTEX + "#include <project_vertex>",
    );
    shader.fragmentShader = (
      `uniform float uCostanTime;\n` +
      FADE_UNIFORM +
      WORLD_VARYING +
      BREATHE_GLSL +
      shader.fragmentShader
    ).replace(
      "#include <dithering_fragment>",
      `
      gl_FragColor.a *= costanBreathe(vCostanWorld, uCostanTime, ${BREATHE_DEPTH}) * uCostanFade;
      #include <dithering_fragment>`,
    );
  };
  m.customProgramCacheKey = () => `costan-pedestal-rim-${kind}`;
  return m;
}

/**
 * The column: an open tube standing on the pool, fading out as it rises.
 * Open-ended and double-sided, so the far wall shows through the near one and
 * reads as a volume of light rather than a pipe.
 */
export function columnGeometry(kind: MarkerKind): THREE.BufferGeometry {
  const { pool, height } = PEDESTAL_SIZE[kind];
  // Slightly inside the pool's rim, so the pool reads as the wider base.
  const g = new THREE.CylinderGeometry(pool * 0.62, pool * 0.78, height, 20, 1, true);
  // CylinderGeometry is centred on its middle; stand it on the spot.
  g.translate(0, height / 2, 0);
  return g;
}

export function columnMaterial(
  kind: MarkerKind,
  clock: PedestalClock,
  fade: PedestalFade,
  resting?: number,
): THREE.MeshBasicMaterial {
  const m = glowMaterial();
  m.opacity = PEDESTAL_ALPHA[kind].column * pedestalGain(resting);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCostanTime = clock;
    shader.uniforms.uCostanFade = fade;
    shader.vertexShader = (WORLD_VARYING + shader.vertexShader).replace(
      "#include <project_vertex>",
      WORLD_VERTEX + "#include <project_vertex>",
    );
    shader.fragmentShader = (
      `uniform float uCostanTime;\n` +
      FADE_UNIFORM +
      WORLD_VARYING +
      BREATHE_GLSL +
      shader.fragmentShader
    ).replace(
      "#include <dithering_fragment>",
      `
      {
        // A cylinder's v runs 0 at the bottom to 1 at the top.
        float up = clamp(vUv.y, 0.0, 1.0);
        // Cubed rather than squared: the column must fade out well before its
        // top edge, or the rim shows as a bright ring in the air.
        float fall = (1.0 - up) * (1.0 - up) * (1.0 - up);
        gl_FragColor.a *= fall * costanBreathe(vCostanWorld, uCostanTime, ${BREATHE_DEPTH}) * uCostanFade;
      }
      #include <dithering_fragment>`,
    );
  };
  m.customProgramCacheKey = () => `costan-pedestal-column-${kind}`;
  m.defines = { ...(m.defines ?? {}), USE_UV: "" };
  return m;
}

/**
 * How a spot's motes behave: how many, how big, and how far they roam.
 *
 * A hex has a tile-wide pool, and its motes are dust in it. A vertex or edge
 * has no room for a pool (a shrunk one reads as a smudge), so motion becomes
 * the mark: more motes, bigger, orbiting the spot.
 */
export interface MoteSpec {
  /** How many per spot. */
  count: number;
  /** Sprite size in world units. */
  size: number;
  /** How far from the spot's axis they circle. */
  orbit: number;
  /** Turns around that axis per flight. Zero is a drift, not an orbit. */
  spin: number;
  /** How high the flight goes. */
  rise: number;
  /** Seconds for one flight. */
  flightMs: number;
}

/**
 * The calm one: dust in a pool of light. What a hex wants.
 *
 * `size` is in world units and three scales it by
 * `viewportHeight / 2 / distance`. The camera sits about 100 units out, so a
 * mote of 0.2 is two or three pixels and its bright core under one. Sizes are
 * set from their on-screen size at the opening camera, so they look large in
 * world units.
 */
export const MOTE_DRIFT: Record<MarkerKind, MoteSpec> = {
  vertex: {
    count: 3,
    size: LATTICE_SIZE * 0.38,
    orbit: LATTICE_SIZE * 0.06,
    spin: 0.35,
    rise: LATTICE_SIZE * 0.34,
    flightMs: 3200,
  },
  edge: {
    count: 2,
    size: LATTICE_SIZE * 0.3,
    orbit: LATTICE_SIZE * 0.05,
    spin: 0.35,
    rise: LATTICE_SIZE * 0.26,
    flightMs: 3200,
  },
  hex: {
    count: 7,
    size: LATTICE_SIZE * 0.62,
    orbit: LATTICE_SIZE * 0.5,
    spin: 0.4,
    rise: LATTICE_SIZE * 0.34,
    flightMs: 3600,
  },
};

/**
 * The busy one: a swarm circling the spot. What a corner wants.
 *
 * At 1.6 turns a flight, a mote makes most of a circuit, so it reads as an
 * orbit. Sizes are about three times the drift's so motes survive at the far
 * edge of the board. The hex orbit is wide and slow; a tight fast one at a
 * tile's middle would look like an object.
 */
export const MOTE_SWARM: Record<MarkerKind, MoteSpec> = {
  vertex: {
    count: 14,
    size: LATTICE_SIZE * 1.0,
    orbit: LATTICE_SIZE * 0.3,
    spin: 2.0,
    rise: LATTICE_SIZE * 0.45,
    flightMs: 2400,
  },
  edge: {
    count: 10,
    size: LATTICE_SIZE * 0.82,
    orbit: LATTICE_SIZE * 0.25,
    spin: 1.9,
    rise: LATTICE_SIZE * 0.36,
    flightMs: 2400,
  },
  hex: {
    count: 12,
    size: LATTICE_SIZE * 0.9,
    orbit: LATTICE_SIZE * 0.6,
    spin: 0.8,
    rise: LATTICE_SIZE * 0.45,
    flightMs: 4200,
  },
};

export function seedOf(i: number): number {
  // The golden ratio's fractional part, a low-discrepancy sequence:
  // consecutive motes land far apart in phase however few there are.
  return (i * 0.6180339887498949) % 1;
}

export function motePositions(
  spots: readonly { position: [number, number, number] }[],
  per: number,
): { positions: Float32Array; seeds: Float32Array } {
  const n = spots.length * per;
  const positions = new Float32Array(n * 3);
  const seeds = new Float32Array(n);
  let at = 0;
  for (let s = 0; s < spots.length; s++) {
    for (let k = 0; k < per; k++) {
      positions[at * 3] = spots[s].position[0];
      positions[at * 3 + 1] = spots[s].position[1];
      positions[at * 3 + 2] = spots[s].position[2];
      // Offset by spot index as well as mote index, or every spot runs the same
      // flight.
      seeds[at] = seedOf(at + s * 7);
      at++;
    }
  }
  return { positions, seeds };
}

/**
 * The motes, as one point cloud over every spot of a kind.
 *
 * `THREE.Points` sprites are billboarded by the hardware, so there is no
 * per-mote matrix or CPU work. The whole flight runs in the shader from the
 * shared clock and a per-mote seed. `seedOf` is deterministic (a golden-ratio
 * walk), which spreads motes better than random at these counts.
 */
export function motesGeometry(
  spots: readonly { position: [number, number, number] }[],
  spec: MoteSpec,
): THREE.BufferGeometry {
  const { positions, seeds } = motePositions(spots, spec.count);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("aCostanSeed", new THREE.BufferAttribute(seeds, 1));
  return g;
}

export function motesMaterial(
  kind: MarkerKind,
  spec: MoteSpec,
  clock: PedestalClock,
  fade: PedestalFade,
  resting?: number,
): THREE.PointsMaterial {
  const m = new THREE.PointsMaterial({
    color: PEDESTAL_COLOR,
    // World units, because `sizeAttenuation` is on: motes shrink with distance
    // like everything else.
    size: spec.size,
    sizeAttenuation: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    opacity: PEDESTAL_ALPHA[kind].motes * pedestalGain(resting),
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCostanTime = clock;
    shader.uniforms.uCostanFade = fade;
    shader.vertexShader = (
      `
      uniform float uCostanTime;
      attribute float aCostanSeed;
      varying float vCostanLife;
      ` +
      "\n" +
      shader.vertexShader
    ).replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>
      {
        // One flight, looping, offset per mote. fract() wraps a mote at the
        // top back to the bottom with no bookkeeping.
        float life = fract(uCostanTime * ${(1000 / spec.flightMs).toFixed(6)} + aCostanSeed);
        vCostanLife = life;

        // Start angle and direction, both from the seed: a spot's motes are
        // spread around the ring and about half orbit the other way, so the
        // swarm does not read as a solid turning ring.
        float phase = aCostanSeed * 6.2831853;
        float dir = aCostanSeed < 0.5 ? 1.0 : -1.0;
        float angle = phase + dir * life * 6.2831853 * ${spec.spin.toFixed(3)};

        // The radius varies over the flight (in close, wide, back in); a fixed
        // radius looks mechanical.
        float wide = 0.55 + 0.45 * sin(life * 6.2831853 + phase);
        float radius = ${spec.orbit.toFixed(4)} * wide;

        transformed.x += cos(angle) * radius;
        transformed.z += sin(angle) * radius;
        // Rise with a small bob, so the path is not a straight line.
        transformed.y += life * ${spec.rise.toFixed(4)} +
          sin(life * 12.566370 + phase) * ${(spec.rise * 0.12).toFixed(4)};
      }
      `,
    );
    shader.fragmentShader = (
      `varying float vCostanLife;\n` +
      FADE_UNIFORM +
      shader.fragmentShader
    ).replace(
      "#include <premultiplied_alpha_fragment>",
      `
      {
        // Fade in and out over the flight, so a mote never pops.
        float fade = sin(vCostanLife * 3.1415926);
        // A round, soft sprite out of a square point. gl_PointCoord is 0..1
        // across the sprite, so this is its distance from the middle.
        float r = length(gl_PointCoord - 0.5) * 2.0;
        // Not named dot(): shadowing a GLSL built-in makes the shader draw
        // nothing.
        float core = clamp(1.0 - r, 0.0, 1.0);
        // A bright centre inside the soft edge, as in the pool, so each mote
        // reads as a distinct speck rather than haze.
        gl_FragColor.a *= fade * (core * core * 0.55 + pow(core, 6.0) * 0.85) * uCostanFade;
      }
      #include <premultiplied_alpha_fragment>`,
    );
  };
  m.customProgramCacheKey = () => `costan-pedestal-motes-${kind}-${spec.spin}-${spec.count}`;
  return m;
}

/**
 * Which parts a style draws for a kind of spot.
 *
 * Pool and rim need area, so they make a hex read. At a vertex they shrink to a
 * smudge, so `swarm` drops them there and draws only motes. No hex draws the
 * column: a tile-sized tube of light buries the tile.
 */
export const PEDESTAL_PARTS = {
  pedestal: {
    vertex: { pool: true, rim: true, column: true },
    edge: { pool: true, rim: true, column: true },
    hex: { pool: true, rim: true, column: false },
  },
  swarm: {
    // Only the swarm; pool, rim and column all hurt at this size.
    vertex: { pool: false, rim: false, column: false },
    edge: { pool: false, rim: false, column: false },
    // The hex keeps what already works.
    hex: { pool: true, rim: true, column: false },
  },
} as const satisfies Record<
  string,
  Record<MarkerKind, { pool: boolean; rim: boolean; column: boolean }>
>;

/** The motes a style flies at a kind of spot. */
export function moteSpec(style: "pedestal" | "swarm", kind: MarkerKind): MoteSpec {
  return style === "swarm" ? MOTE_SWARM[kind] : MOTE_DRIFT[kind];
}

/**
 * Where each part is drawn relative to everything else.
 *
 * Above the board's own draw order (see markers.ts MARKER_RENDER_ORDER), then
 * pool, rim, column, motes. With `depthTest` off they draw strictly in this
 * order: the rim goes over the pool as the socket's edge, and the motes last
 * so no column overwrites them.
 */
export const PEDESTAL_RENDER_ORDER = { pool: 0, rim: 1, column: 2, motes: 3 } as const;
