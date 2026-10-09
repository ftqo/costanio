// Draw the board once; replay it while only the water moves.
//
// The swell is the only thing on an idle board that animates, and the sea is
// 4 meshes out of about 243, so re-rendering the whole scene at 30Hz to move
// it is wasteful. The board is rendered into a target and kept. Each frame:
//
//   1. composite the cached target back into the canvas, colour and depth
//   2. draw the water and the transparent marks over it, depth-tested against
//      the restored depth
//
// Only a frame that changes something other than the water pays for step 0,
// re-rendering the board into the target. `Board3D`'s ticker draws that line:
// `invalidate()` means something changed, a bare subscriber tick does not.
//
// Depth is restored via `gl_FragDepth` from the target's depth texture, so the
// water occludes and is occluded (ships, docks, coast) exactly as in one pass.
//
// Tone mapping and colour space: three applies neither when rendering to a
// target (`getParameters` forces NoToneMapping off-screen), so the target holds
// linear, un-tone-mapped colour and the composite applies both using three's own
// chunks, tracking `renderer.toneMapping`.
//
// Half float: the target holds values above 1, which 8-bit would clip before
// tone mapping (and band the darks).
//
// Two paths, chosen by the look:
//
//   direct   no grade and no bloom (`classic`). Composite to the canvas, tone
//            mapped on the way out, then the water over it. No extra
//            full-screen pass.
//   graded   the composite and the water both go into a second half-float
//            target, still linear, and a final pass blooms, grades and tone
//            maps that to the canvas. See `postfx.ts`.
//
// The water must be inside the graded target: its glitter is what the bloom
// works with, and grading only the board would make the two drift apart.
// `full` still decides redraw versus replay, so an idle graded board pays for
// the water, the bloom pyramid and the grade, not 450 draw calls.
import * as THREE from "three";
import { createPostFx, type PostFx } from "./postfx";
import { isIdentityGrade, type BoardLook } from "./boardTheme";
import type { WarmPass } from "./warmPrograms";
import {
  BOARD_LIGHT_LAYER,
  OCEAN_LAYER,
  OVERLAY_LAYER,
  TINTED_LAYER,
  TINTED_LIGHT_LAYER,
} from "./scene";

/** Layers holding the lights. Every pass enables these, so lighting is shared. */
const LIGHT_LAYERS = [BOARD_LIGHT_LAYER, TINTED_LIGHT_LAYER];

/** What the cached pass draws: the opaque board, and nothing that moves. */
const BOARD_LAYERS = [0, TINTED_LAYER, ...LIGHT_LAYERS];

/** What the live pass draws: the water, and the transparent marks over it. */
const LIVE_LAYERS = [OCEAN_LAYER, OVERLAY_LAYER, ...LIGHT_LAYERS];

function only(camera: THREE.Camera, layers: readonly number[]): void {
  camera.layers.disableAll();
  for (const l of layers) camera.layers.enable(l);
}

/**
 * Restore a cached frame's colour and depth, then tone map on the way out.
 *
 * GLSL3 for `gl_FragDepth`, which GLSL1 can only reach through an extension.
 * three defines `gl_FragColor` as the declared output under GLSL3, so its own
 * chunks below still compile.
 */
function compositeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      tColour: { value: null as THREE.Texture | null },
      tDepth: { value: null as THREE.Texture | null },
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      // three declares this for its own materials under GLSL3 but not for a
      // ShaderMaterial, and the chunks below use \`gl_FragColor\`, which GLSL3
      // removed. These are the two lines three's own prefix uses.
      layout(location = 0) out highp vec4 pc_fragColor;
      #define gl_FragColor pc_fragColor
      uniform sampler2D tColour;
      uniform sampler2D tDepth;
      in vec2 vUv;
      void main() {
        gl_FragColor = texture(tColour, vUv);
        // The board's depth, put back verbatim. Everything drawn after this
        // tests against the real scene rather than against an empty buffer.
        gl_FragDepth = texture(tDepth, vUv).r;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    // The quad sits at a fixed clip depth, so the test decides nothing, but it
    // must stay enabled: disabling the depth test also disables depth writes.
    depthTest: true,
    depthWrite: true,
    depthFunc: THREE.AlwaysDepth,
    // Replaces the canvas rather than blending. With alpha on, the board's own
    // transparency has to reach the page behind the canvas.
    blending: THREE.NoBlending,
    toneMapped: true,
  });
}

export interface OceanPass {
  /**
   * Draw a frame.
   *
   * `full` re-renders the board into the cache first; otherwise the cached
   * board is replayed and only the water and the marks over it are drawn. The
   * first call is always full.
   */
  render(full: boolean): void;
  /** Drop the cache: the next frame is a full one whatever it asks for. */
  invalidate(): void;
  /**
   * How `render` draws the scene: each pass's layers and target, for
   * compiling programs ahead of the draw (see `warmPrograms`).
   */
  passes(): WarmPass[];
  /**
   * The scene's linear radiance distribution, for choosing a bloom threshold.
   *
   * Guessing is error-prone (albedo times intensity misses the BRDF's 1/pi and
   * overshoots about threefold), and a threshold above the scene's maximum
   * gives no bloom at all. Costs a full render plus a stalling `readPixels`;
   * called only from the dev rig, `window.__board3d.sampleRadiance()`.
   */
  sampleRadiance(): {
    pixels: number;
    p50: number;
    p90: number;
    p99: number;
    p999: number;
    max: number;
    fractionOver: Record<number, number>;
  };
  /**
   * Follow a look change, possibly switching paths. A method so the viewer can
   * change style mid-game without tearing the board down.
   */
  setLook(look: BoardLook): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export function createOceanPass(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  look: BoardLook,
): OceanPass {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const make = (w: number, h: number) => {
    const depth = new THREE.DepthTexture(w, h);
    // 24 bits, read back as a float in [0,1] and written to gl_FragDepth. The
    // 16-bit default makes the coastline crawl against the water.
    depth.type = THREE.UnsignedInt248Type;
    depth.format = THREE.DepthStencilFormat;
    const target = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: true,
      depthTexture: depth,
      // Matched to the canvas, which asks for antialias, so the cached board
      // doesn't alias under antialiased water. 4 because 8 gave identical
      // output (the driver clamps).
      //
      // Silhouette edges differ slightly from a direct render (about 2% of
      // pixels by more than 8/255, on coast and prop outlines): the canvas
      // resolves after tone mapping and sRGB encoding, this target resolves in
      // linear space before them. Linear is the more correct of the two.
      samples: 4,
    });
    return target;
  };

  /**
   * The composed frame, in linear light, when a look grades or blooms.
   *
   * Same recipe as the board's cache (half float, MSAA, a depth buffer for the
   * water's depth test) but no depth texture, since nothing reads this depth
   * back. Built lazily, so `classic` never allocates it.
   */
  const makeScene = (w: number, h: number) =>
    new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: true,
      samples: 0,
    });

  let target = make(size.x, size.y);
  let sceneTarget: THREE.WebGLRenderTarget | null = null;
  let postfx: PostFx | null = null;
  let cached = false;
  let current = look;
  /** Whether this look needs the second target at all. See the header. */
  let graded = !isIdentityGrade(look.grade) || look.bloom !== null;

  const material = compositeMaterial();
  // A single triangle rather than a quad: no seam down the diagonal.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  // Its own camera: the vertex shader emits clip space, and passing the
  // board's would leave three holding render state built for it.
  const quadCamera = new THREE.Camera();

  /** Everything the graded path needs, allocated the first time one is asked for. */
  const ensureGraded = () => {
    if (!sceneTarget) sceneTarget = makeScene(target.width, target.height);
    if (!postfx) {
      postfx = createPostFx(renderer, target.width, target.height, current.grade, current.bloom);
    }
    return { sceneTarget, postfx };
  };

  return {
    render(full: boolean) {
      const wanted = full || !cached;
      const autoClear = renderer.autoClear;

      if (wanted) {
        only(camera, BOARD_LAYERS);
        renderer.setRenderTarget(target);
        renderer.autoClear = true;
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        cached = true;
      }

      material.uniforms.tColour.value = target.texture;
      material.uniforms.tDepth.value = target.depthTexture;

      // The direct path. The composite material tone maps here because the
      // canvas is bound; on the graded path the same material compiles without
      // a tone mapper because a render target is bound (`getParameters` forces
      // NoToneMapping off-screen). That keeps it to one material.
      if (!graded) {
        renderer.autoClear = true;
        renderer.clear();
        renderer.autoClear = false;
        renderer.render(quadScene, quadCamera);

        only(camera, LIVE_LAYERS);
        renderer.render(scene, camera);

        renderer.autoClear = autoClear;
        return;
      }

      const fx = ensureGraded();

      // Compose board + water into the linear target.
      renderer.setRenderTarget(fx.sceneTarget);
      renderer.autoClear = true;
      renderer.clear();
      renderer.autoClear = false;
      renderer.render(quadScene, quadCamera);
      only(camera, LIVE_LAYERS);
      renderer.render(scene, camera);

      // Blur the bright parts. Leaves a mip bound as the render target, so the
      // grade re-binds the canvas explicitly.
      const glow = fx.postfx.bloom(fx.sceneTarget.texture);

      renderer.setRenderTarget(null);
      renderer.autoClear = true;
      renderer.clear();
      renderer.autoClear = false;
      fx.postfx.grade(fx.sceneTarget.texture, glow);

      renderer.autoClear = autoClear;
    },
    invalidate() {
      cached = false;
    },
    passes() {
      return [
        { layers: BOARD_LAYERS, target },
        { layers: LIVE_LAYERS, target: graded ? ensureGraded().sceneTarget : null },
      ];
    },
    sampleRadiance() {
      // A small float target: `readRenderTargetPixels` into a Float32Array is
      // simple for float, and a diagnostic needs neither MSAA nor full
      // resolution. 320x180 is 57,600 samples, plenty for a percentile.
      const w = 320;
      const h = 180;
      const probe = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.FloatType,
        depthBuffer: true,
      });
      const autoClear = renderer.autoClear;
      only(camera, [...BOARD_LAYERS, OCEAN_LAYER, OVERLAY_LAYER]);
      renderer.setRenderTarget(probe);
      renderer.autoClear = true;
      renderer.render(scene, camera);
      const buf = new Float32Array(w * h * 4);
      renderer.readRenderTargetPixels(probe, 0, 0, w, h, buf);
      renderer.setRenderTarget(null);
      renderer.autoClear = autoClear;
      probe.dispose();
      cached = false;

      // The brightest channel, which is what the bright pass keys on.
      const peaks: number[] = [];
      for (let i = 0; i < w * h; i++) {
        const a = buf[i * 4 + 3];
        if (a <= 0.01) continue; // transparent page, not scene
        peaks.push(Math.max(buf[i * 4], Math.max(buf[i * 4 + 1], buf[i * 4 + 2])));
      }
      peaks.sort((x, y) => x - y);
      const at = (q: number) =>
        peaks[Math.min(peaks.length - 1, Math.floor(peaks.length * q))] ?? 0;
      const over = (t: number) => peaks.filter((p) => p > t).length / (peaks.length || 1);
      return {
        pixels: peaks.length,
        p50: at(0.5),
        p90: at(0.9),
        p99: at(0.99),
        p999: at(0.999),
        max: peaks[peaks.length - 1] ?? 0,
        fractionOver: { 1: over(1), 1.5: over(1.5), 2: over(2), 3: over(3), 4: over(4) },
      };
    },
    setLook(next: BoardLook) {
      current = next;
      graded = !isIdentityGrade(next.grade) || next.bloom !== null;
      postfx?.setLook(next.grade, next.bloom);
      // Targets are kept when a look stops needing them, since styles get
      // toggled back and forth; they are freed on `dispose`.
    },
    setSize(width: number, height: number) {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      if (target.width === w && target.height === h) return;
      // Rebuilt rather than resized: setSize leaves the depth texture at the
      // old size, and mismatched attachments make an incomplete framebuffer.
      target.dispose();
      target = make(w, h);
      // No depth texture here, so `setSize` would be safe, but a half-float
      // MSAA target is rebuilt anyway; resizing those has upset drivers, and
      // the cost is the same.
      if (sceneTarget) {
        sceneTarget.dispose();
        sceneTarget = makeScene(w, h);
      }
      postfx?.setSize(w, h);
      cached = false;
    },
    dispose() {
      target.dispose();
      sceneTarget?.dispose();
      postfx?.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
