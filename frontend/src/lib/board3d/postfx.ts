// Bloom and colour grading, for the styles that ask for them.
//
// Cheap here because the board already renders into a half-float,
// pre-tone-mapping target (see `oceanPass.ts`), which holds linear radiance
// above 1.0 unclipped. So `threshold` is a real radiance: a style can bloom
// only the sun (threshold above 1) or lit windows too (below it).
//
// The chain is dual Kawase: downsample to a pyramid with a 5-tap filter,
// then upsample with a 9-tap tent, adding as it goes. At 1920x1080 the whole
// pyramid is about a third of one full-resolution pass in shaded pixels.
//
// Nothing here is board-specific: texture in, texture out.
import * as THREE from "three";
import { isIdentityGrade, type BoardBloom, type BoardGrade, type BoardLook } from "./boardTheme";
import { hexToLinear, type RGB } from "./seaColor";

/**
 * How many levels the pyramid gets. Five: the last mip of a 1080p frame is
 * 60x34, and below that the blur is a flat wash. `radius` in `BoardBloom`
 * chooses how much of the pyramid contributes.
 */
export const BLOOM_LEVELS = 5;

/**
 * The pyramid's dimensions, halving each time and never reaching zero. Pure,
 * and tested: an off-by-one is a half-pixel drift per level.
 */
export function bloomMipSizes(
  width: number,
  height: number,
  levels = BLOOM_LEVELS,
): Array<{ width: number; height: number }> {
  const out: Array<{ width: number; height: number }> = [];
  let w = width;
  let h = height;
  for (let i = 0; i < levels; i++) {
    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
    out.push({ width: w, height: h });
    // Once a level is 1x1, further levels add nothing.
    if (w === 1 && h === 1) break;
  }
  return out;
}

/**
 * How much of a pixel survives the threshold, given its brightest channel.
 *
 * A soft knee: a hard cut makes the bloom edge a contour that crawls as the
 * sun's reflection moves across a wave. The knee is a quadratic ramp over the
 * half-stop below the threshold.
 *
 * Returns a fraction of the pixel's own colour to keep, which preserves hue
 * (a warm highlight doesn't bloom white).
 */
export function bloomContribution(luma: number, threshold: number): number {
  if (luma <= 0) return 0;
  const knee = threshold * 0.5;
  const soft = Math.min(Math.max(luma - threshold + knee, 0), 2 * knee);
  const kneed = knee > 0 ? (soft * soft) / (4 * knee) : 0;
  return Math.max(0, Math.max(kneed, luma - threshold)) / luma;
}

/**
 * The grade, in JavaScript, matching the shader below line for line.
 *
 * The fog fades the far water to the page's colour (see `oceanRadius`), but
 * the page is a DOM background and isn't graded with the water, so a grade
 * would leave a bright rim around the ocean. So the page is graded here on the
 * CPU and `Board3D` paints the board's host with the result.
 *
 * Keeping two implementations in step: `classic` grades nothing, so
 * `gradedPageHex` must return its page hex unchanged, and a test checks that.
 */
export function applyGradeLinear(rgb: RGB, grade: BoardGrade): RGB {
  const c: RGB = [rgb[0] * grade.exposure, rgb[1] * grade.exposure, rgb[2] * grade.exposure];
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const sat: RGB = [
    l + (c[0] - l) * grade.saturation,
    l + (c[1] - l) * grade.saturation,
    l + (c[2] - l) * grade.saturation,
  ];
  const t = Math.min(1, Math.max(0, l));
  const out: RGB = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const tint = grade.shadowTint[i] + (grade.highlightTint[i] - grade.shadowTint[i]) * t;
    out[i] = Math.max(0, sat[i] * tint + grade.lift[i] * (1 - t));
  }
  return out;
}

/**
 * Khronos PBR Neutral, which is what `THREE.NeutralToneMapping` is.
 *
 * Transcribed from three's chunk, not approximated, since the board uses
 * Neutral to keep the flat-shaded art's midtone colour and an approximation
 * would put the page off the sea exactly there. Assumes
 * `toneMappingExposure` is 1, which `Board3D` sets; the grade's `exposure` is
 * the per-style version.
 */
export function neutralToneMap(rgb: RGB): RGB {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;
  const c: RGB = [rgb[0], rgb[1], rgb[2]];
  const x = Math.min(c[0], Math.min(c[1], c[2]));
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c[0] -= offset;
  c[1] -= offset;
  c[2] -= offset;
  const peak = Math.max(c[0], Math.max(c[1], c[2]));
  if (peak < startCompression) return c;
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  const scale = newPeak / peak;
  c[0] *= scale;
  c[1] *= scale;
  c[2] *= scale;
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return [c[0] + (newPeak - c[0]) * g, c[1] + (newPeak - c[1]) * g, c[2] + (newPeak - c[2]) * g];
}

/** Linear to an sRGB hex string, the inverse of `hexToLinear`. */
export function linearToHex(rgb: RGB): string {
  const to = (v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    const s = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(s * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}

/**
 * What the page must be painted for this look, so the horizon still dissolves.
 *
 * The page colour, into linear, through the same grade and tone mapper as the
 * water, and back to a hex for CSS. Bloom isn't modelled: every style's
 * threshold is above its page colour's brightest channel, and a test pins
 * that.
 */
export function gradedPageHex(look: BoardLook): string {
  if (isIdentityGrade(look.grade)) return look.pageHex;
  return linearToHex(neutralToneMap(applyGradeLinear(hexToLinear(look.pageHex), look.grade)));
}

/** The three's-chunk preamble every pass below shares. See `oceanPass.ts`. */
const GLSL3_PREAMBLE = /* glsl */ `
  precision highp float;
  layout(location = 0) out highp vec4 pc_fragColor;
  #define gl_FragColor pc_fragColor
`;

const FULLSCREEN_VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    // These run in linear light between scene and canvas; tone mapping happens
    // once, in the grade, since earlier passes still need values above 1.
    toneMapped: false,
  });
}

/** Threshold and halve, in one pass, straight off the HDR scene. */
function brightMaterial(): THREE.ShaderMaterial {
  return pass(
    /* glsl */ `
    ${GLSL3_PREAMBLE}
    uniform sampler2D tSource;
    uniform vec2 uHalfPixel;
    uniform float uThreshold;
    in vec2 vUv;

    vec3 sampleBox(vec2 uv) {
      vec3 sum = texture(tSource, uv).rgb * 4.0;
      sum += texture(tSource, uv - uHalfPixel).rgb;
      sum += texture(tSource, uv + uHalfPixel).rgb;
      sum += texture(tSource, uv + vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
      sum += texture(tSource, uv - vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
      return sum / 8.0;
    }

    void main() {
      vec3 c = sampleBox(vUv);
      // The brightest channel, not the luminance: a saturated blue window has
      // low luminance but is still a light source.
      float l = max(c.r, max(c.g, c.b));
      float knee = uThreshold * 0.5;
      float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
      soft = knee > 0.0 ? (soft * soft) / (4.0 * knee) : 0.0;
      float keep = max(0.0, max(soft, l - uThreshold)) / max(l, 1e-5);
      gl_FragColor = vec4(c * keep, 1.0);
    }
  `,
    {
      tSource: { value: null as THREE.Texture | null },
      uHalfPixel: { value: new THREE.Vector2() },
      uThreshold: { value: 1 },
    },
  );
}

/** Dual Kawase down: 5 taps, halving. */
function downMaterial(): THREE.ShaderMaterial {
  return pass(
    /* glsl */ `
    ${GLSL3_PREAMBLE}
    uniform sampler2D tSource;
    uniform vec2 uHalfPixel;
    in vec2 vUv;
    void main() {
      vec3 sum = texture(tSource, vUv).rgb * 4.0;
      sum += texture(tSource, vUv - uHalfPixel).rgb;
      sum += texture(tSource, vUv + uHalfPixel).rgb;
      sum += texture(tSource, vUv + vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
      sum += texture(tSource, vUv - vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
      gl_FragColor = vec4(sum / 8.0, 1.0);
    }
  `,
    {
      tSource: { value: null as THREE.Texture | null },
      uHalfPixel: { value: new THREE.Vector2() },
    },
  );
}

/**
 * Dual Kawase up: 8 taps in a tent, added to whatever the target already holds.
 *
 * Additive, so the pyramid accumulates with no temporary targets: each level is
 * added into the one above, and the top ends up with the sum of every blur
 * radius. `uScale` is the style's `radius` and decides how much the wide
 * levels contribute.
 */
function upMaterial(): THREE.ShaderMaterial {
  const m = pass(
    /* glsl */ `
    ${GLSL3_PREAMBLE}
    uniform sampler2D tSource;
    uniform vec2 uHalfPixel;
    uniform float uScale;
    in vec2 vUv;
    void main() {
      vec3 sum = texture(tSource, vUv + vec2(-uHalfPixel.x * 2.0, 0.0)).rgb;
      sum += texture(tSource, vUv + vec2(-uHalfPixel.x, uHalfPixel.y)).rgb * 2.0;
      sum += texture(tSource, vUv + vec2(0.0, uHalfPixel.y * 2.0)).rgb;
      sum += texture(tSource, vUv + vec2(uHalfPixel.x, uHalfPixel.y)).rgb * 2.0;
      sum += texture(tSource, vUv + vec2(uHalfPixel.x * 2.0, 0.0)).rgb;
      sum += texture(tSource, vUv + vec2(uHalfPixel.x, -uHalfPixel.y)).rgb * 2.0;
      sum += texture(tSource, vUv + vec2(0.0, -uHalfPixel.y * 2.0)).rgb;
      sum += texture(tSource, vUv + vec2(-uHalfPixel.x, -uHalfPixel.y)).rgb * 2.0;
      gl_FragColor = vec4(sum / 12.0 * uScale, 1.0);
    }
  `,
    {
      tSource: { value: null as THREE.Texture | null },
      uHalfPixel: { value: new THREE.Vector2() },
      uScale: { value: 1 },
    },
  );
  m.blending = THREE.AdditiveBlending;
  return m;
}

/**
 * The last pass: scene plus bloom, graded, tone mapped, encoded, to the canvas.
 *
 * Alpha is carried through unchanged; bloom doesn't add to it. The canvas is
 * transparent over the page and the fog fades the far water to the page's
 * colour (see `oceanRadius`), so raising alpha would put a halo over the page
 * above the horizon.
 */
function gradeMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      tScene: { value: null as THREE.Texture | null },
      tBloom: { value: null as THREE.Texture | null },
      uBloomStrength: { value: 0 },
      uExposure: { value: 1 },
      uSaturation: { value: 1 },
      uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
      uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
      uLift: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */ `
      ${GLSL3_PREAMBLE}
      uniform sampler2D tScene;
      uniform sampler2D tBloom;
      uniform float uBloomStrength;
      uniform float uExposure;
      uniform float uSaturation;
      uniform vec3 uShadowTint;
      uniform vec3 uHighlightTint;
      uniform vec3 uLift;
      in vec2 vUv;

      void main() {
        vec4 scene = texture(tScene, vUv);
        vec3 c = scene.rgb + texture(tBloom, vUv).rgb * uBloomStrength;

        // The order matters and is the order BoardGrade documents. Lifting
        // before saturating turns a milky black into a coloured one; saturating
        // after tinting pulls the tint straight back out.
        c *= uExposure;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation);
        float t = clamp(l, 0.0, 1.0);
        c *= mix(uShadowTint, uHighlightTint, t);
        c += uLift * (1.0 - t);

        gl_FragColor = vec4(max(c, 0.0), scene.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
    // Replaces the canvas rather than blending: the board's own transparency
    // has to reach the page.
    blending: THREE.NoBlending,
    // True so three injects the real tone mapper: the chunk follows
    // `renderer.toneMapping`, which reads NoToneMapping while a render target
    // is bound. This is the only pass that compresses values above 1.
    toneMapped: true,
  });
  return m;
}

/** A screen-covering triangle. One vertex fewer than a quad and no diagonal. */
function fullscreenGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  return g;
}

export interface PostFx {
  /**
   * Blur the bright parts of `source` into the returned texture, or null when
   * the current look does not bloom.
   */
  bloom(source: THREE.Texture): THREE.Texture | null;
  /** Draw `scene` (plus any bloom) to whatever target is currently bound. */
  grade(scene: THREE.Texture, bloom: THREE.Texture | null): void;
  setLook(grade: BoardGrade, bloom: BoardBloom | null): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export function createPostFx(
  renderer: THREE.WebGLRenderer,
  width: number,
  height: number,
  grade: BoardGrade,
  bloom: BoardBloom | null,
): PostFx {
  const geometry = fullscreenGeometry();
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(geometry, gradeMaterial());
  quad.frustumCulled = false;
  quadScene.add(quad);
  // Its own camera: the vertex shader emits clip space, and passing the
  // board's would leave three holding render state built for it.
  const quadCamera = new THREE.Camera();

  const bright = brightMaterial();
  const down = downMaterial();
  const up = upMaterial();
  const gradeMat = quad.material;

  /**
   * Read a uniform's value at a type.
   *
   * `THREE.IUniform.value` is `any`, so these two helpers are the one place the
   * unchecked access happens. They assert the type matches the shader's
   * declaration, which TypeScript can't check.
   */
  const vec2Of = (u: THREE.IUniform) => u.value as THREE.Vector2;
  const vec3Of = (u: THREE.IUniform) => u.value as THREE.Vector3;

  let mips: THREE.WebGLRenderTarget[] = [];
  let currentGrade = grade;
  let currentBloom = bloom;

  const makeMips = (w: number, h: number) => {
    for (const m of mips) m.dispose();
    mips = bloomMipSizes(w, h).map(
      (size) =>
        new THREE.WebGLRenderTarget(size.width, size.height, {
          type: THREE.HalfFloatType,
          // No depth, stencil or MSAA: this blurs an already resolved image.
          depthBuffer: false,
          stencilBuffer: false,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          // Clamp: REPEAT would wrap the tent filter and drag glow across edges.
          wrapS: THREE.ClampToEdgeWrapping,
          wrapT: THREE.ClampToEdgeWrapping,
        }),
    );
  };

  const draw = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  };

  /** Half a texel of whatever is being sampled, which is what the taps step by. */
  const halfPixel = (t: { width: number; height: number }, into: THREE.Vector2) =>
    into.set(0.5 / t.width, 0.5 / t.height);

  makeMips(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));

  return {
    bloom(source) {
      if (!currentBloom || mips.length === 0) return null;
      const autoClear = renderer.autoClear;
      renderer.autoClear = true;

      bright.uniforms.tSource.value = source;
      bright.uniforms.uThreshold.value = currentBloom.threshold;
      // The source is full resolution; the first mip is half of it.
      halfPixel(
        { width: mips[0].width * 2, height: mips[0].height * 2 },
        vec2Of(bright.uniforms.uHalfPixel),
      );
      draw(bright, mips[0]);

      for (let i = 1; i < mips.length; i++) {
        down.uniforms.tSource.value = mips[i - 1].texture;
        halfPixel(mips[i - 1], vec2Of(down.uniforms.uHalfPixel));
        draw(down, mips[i]);
      }

      // Back up the pyramid, adding. autoClear is off from here so each level
      // isn't wiped before it accumulates.
      renderer.autoClear = false;
      up.uniforms.uScale.value = currentBloom.radius;
      for (let i = mips.length - 1; i > 0; i--) {
        up.uniforms.tSource.value = mips[i].texture;
        halfPixel(mips[i], vec2Of(up.uniforms.uHalfPixel));
        draw(up, mips[i - 1]);
      }

      renderer.autoClear = autoClear;
      return mips[0].texture;
    },

    grade(scene, bloomTexture) {
      gradeMat.uniforms.tScene.value = scene;
      gradeMat.uniforms.tBloom.value = bloomTexture;
      gradeMat.uniforms.uBloomStrength.value =
        bloomTexture && currentBloom ? currentBloom.strength : 0;
      gradeMat.uniforms.uExposure.value = currentGrade.exposure;
      gradeMat.uniforms.uSaturation.value = currentGrade.saturation;
      vec3Of(gradeMat.uniforms.uShadowTint).set(...currentGrade.shadowTint);
      vec3Of(gradeMat.uniforms.uHighlightTint).set(...currentGrade.highlightTint);
      vec3Of(gradeMat.uniforms.uLift).set(...currentGrade.lift);
      // A null bloom texture leaves the sampler unbound, a validation error on
      // some drivers even at zero strength.
      if (!bloomTexture && mips.length > 0) gradeMat.uniforms.tBloom.value = mips[0].texture;
      quad.material = gradeMat;
      renderer.render(quadScene, quadCamera);
    },

    setLook(nextGrade, nextBloom) {
      currentGrade = nextGrade;
      currentBloom = nextBloom;
    },

    setSize(w, h) {
      const next = { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
      const first = bloomMipSizes(next.width, next.height)[0];
      // Compared on both dimensions against the first mip, not a remembered
      // size: the pyramid floors at 1 per axis, so different canvas sizes can
      // share mips.
      if (mips.length > 0 && mips[0].width === first.width && mips[0].height === first.height) {
        return;
      }
      makeMips(next.width, next.height);
    },

    dispose() {
      for (const m of mips) m.dispose();
      mips = [];
      geometry.dispose();
      bright.dispose();
      down.dispose();
      up.dispose();
      gradeMat.dispose();
    },
  };
}
