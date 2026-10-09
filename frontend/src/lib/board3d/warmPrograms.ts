// Compile shader programs before the objects that need them are drawn, without
// holding the main thread while the driver compiles.
//
// three compiles a material's program on its first draw and then waits for the
// link (`WebGLProgram.getUniforms`), so the first frame of a new board stalls
// for every new program at once: up to seconds on a slow driver, during which
// no click on the page is handled. Here the programs are requested ahead of the
// draw, for each pass the object will be drawn in, and the caller commits the
// objects once they are ready.
//
// With KHR_parallel_shader_compile the driver links in the background and
// readiness is polled. Without it, waiting on a link blocks, so each new program
// is waited on in its own task and input runs between them.
import * as THREE from "three";

/** One way the objects will be drawn. Programs differ by render target. */
export interface WarmPass {
  /** Camera layers the pass draws. Omitted: the camera's layers as they are. */
  layers?: readonly number[];
  /** The bound target: null for the canvas. */
  target: THREE.WebGLRenderTarget | null;
}

/** The parts of three's `WebGLProgram` used here. */
interface Program {
  isReady(): boolean;
  getUniforms(): unknown;
}

const POLL_MS = 10;

/**
 * Wait before the next readiness check: soon at first, since a cached program
 * or a small render is ready within a task or two, then every POLL_MS.
 */
const backoff = (attempt: number) => Math.min(POLL_MS, attempt);
const MAX_WAIT_MS = 10_000;

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * What three draws, less what it has drawn before: nodes with a material this
 * renderer has never built a program for. A rebuilt board mostly reuses its
 * materials, and asking again costs a program key per mesh.
 */
function drawables(
  renderer: THREE.WebGLRenderer,
  objects: readonly THREE.Object3D[],
): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const isNew = (m: THREE.Material) =>
    !(renderer.properties.get(m) as { programs?: unknown }).programs;
  for (const o of objects) {
    o.traverse((n) => {
      const d = n as THREE.Mesh & { isSprite?: boolean; isPoints?: boolean; isLine?: boolean };
      if (!(d.isMesh || d.isSprite || d.isPoints || d.isLine)) return;
      const mats = Array.isArray(d.material) ? d.material : [d.material];
      if (mats.some((m) => m && isNew(m))) out.push(n);
    });
  }
  return out;
}

/**
 * Hands `renderer.compile` a fixed list of nodes. It traverses its first
 * argument for materials (and, when that is not the target scene, for lights,
 * which these nodes do not carry).
 */
function nodeList(nodes: readonly THREE.Object3D[]): THREE.Object3D {
  const list = new THREE.Object3D();
  list.traverse = (cb) => {
    for (const n of nodes) cb(n);
  };
  list.traverseVisible = () => {};
  return list;
}

/**
 * Request every program `objects` will need in `passes`, lit as `scene`, and
 * resolve once they are linked. The objects need not be in the scene yet.
 *
 * Leaves the renderer's target and the camera's layers as it found them
 * between tasks, so frames drawn meanwhile are unaffected. Never throws: a
 * failure only means the first draw compiles, as it would have anyway.
 */
export async function warmPrograms(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  objects: readonly THREE.Object3D[],
  passes: readonly WarmPass[],
  cancelled: () => boolean = () => false,
): Promise<void> {
  const programs = renderer.info?.programs as unknown as Program[] | null | undefined;
  if (!programs) return;
  const known = new Set(programs);

  /** Compile `nodes` in every pass; returns the programs this created. */
  const compile = (nodes: readonly THREE.Object3D[]): Program[] => {
    const target = renderer.getRenderTarget();
    const mask = camera.layers.mask;
    try {
      for (const pass of passes) {
        camera.layers.mask = mask;
        if (pass.layers) {
          camera.layers.disableAll();
          for (const l of pass.layers) camera.layers.enable(l);
        }
        const drawn = nodes.filter((n) => n.layers.test(camera.layers));
        if (!drawn.length) continue;
        renderer.setRenderTarget(pass.target);
        renderer.compile(nodeList(drawn), camera, scene);
      }
    } finally {
      camera.layers.mask = mask;
      renderer.setRenderTarget(target);
    }
    const added: Program[] = [];
    for (const p of programs) {
      if (known.has(p)) continue;
      known.add(p);
      added.push(p);
    }
    return added;
  };

  try {
    const nodes = drawables(renderer, objects);
    if (renderer.extensions.has("KHR_parallel_shader_compile")) {
      const fresh = compile(nodes);
      // Bounded: a lost context never reports a program ready.
      const start = performance.now();
      for (let i = 0; fresh.some((p) => !p.isReady()); i++) {
        if (cancelled() || performance.now() - start > MAX_WAIT_MS) return;
        await sleep(backoff(i));
      }
      return;
    }
    // No background compile: one node at a time, and a task boundary after
    // each one that needed a new program, which is where the wait lands.
    for (const node of nodes) {
      if (cancelled()) return;
      const added = compile([node]);
      if (!added.length) continue;
      for (const p of added) p.getUniforms();
      await nextTask();
    }
  } catch {
    // The draw compiles whatever is left.
  }
}

/**
 * Resolve once the GPU has finished everything submitted so far, polling a
 * fence rather than blocking. A readback (`toBlob`) issued before then waits
 * on the main thread for the whole render.
 *
 * Gives up after `maxMs`, after which a readback simply waits as before.
 */
export async function gpuFinished(gl: WebGL2RenderingContext, maxMs = 2000): Promise<void> {
  let sync: WebGLSync | null = null;
  try {
    sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) return;
    gl.flush();
    const start = performance.now();
    for (let i = 0; performance.now() - start < maxMs; i++) {
      const s = gl.clientWaitSync(sync, 0, 0);
      if (s !== gl.TIMEOUT_EXPIRED) return;
      await sleep(backoff(i));
    }
  } catch {
    // A lost context or no fence support: read back as before.
  } finally {
    if (sync) gl.deleteSync(sync);
  }
}
