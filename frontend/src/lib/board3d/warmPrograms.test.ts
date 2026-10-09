import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { gpuFinished, warmPrograms } from "./warmPrograms";

/** A program that reports ready after `polls` checks. */
function program(polls = 0) {
  let left = polls;
  return {
    isReady: vi.fn(() => left-- <= 0),
    getUniforms: vi.fn(),
  };
}

/**
 * Just enough renderer: `compile` records what it was asked for and adds one
 * program per material it has not seen.
 */
function fakeRenderer(parallel: boolean, polls = 0) {
  const programs: ReturnType<typeof program>[] = [];
  const seen = new Set<THREE.Material>();
  let target: THREE.WebGLRenderTarget | null = null;
  const calls: { target: THREE.WebGLRenderTarget | null; mask: number; nodes: THREE.Object3D[] }[] =
    [];
  const props = new WeakMap<object, { programs?: true }>();
  const renderer = {
    info: { programs },
    properties: {
      get: (o: object) => {
        if (!props.has(o)) props.set(o, {});
        return props.get(o);
      },
    },
    extensions: { has: (name: string) => parallel && name === "KHR_parallel_shader_compile" },
    getRenderTarget: () => target,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => {
      target = t;
    },
    compile: (list: THREE.Object3D, camera: THREE.Camera) => {
      const nodes: THREE.Object3D[] = [];
      list.traverse((n) => nodes.push(n));
      calls.push({ target, mask: camera.layers.mask, nodes });
      for (const n of nodes) {
        const m = (n as THREE.Mesh).material as THREE.Material;
        props.set(m, { programs: true });
        if (seen.has(m)) continue;
        seen.add(m);
        programs.push(program(polls));
      }
    },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, programs, calls };
}

const mesh = (layer = 0) => {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  m.layers.set(layer);
  return m;
};

describe("warmPrograms", () => {
  it("compiles each pass's layers into its target and restores the state", async () => {
    const { renderer, calls } = fakeRenderer(true);
    const camera = new THREE.PerspectiveCamera();
    camera.layers.set(5);
    const board = new THREE.WebGLRenderTarget(1, 1);
    const bound = new THREE.WebGLRenderTarget(1, 1);
    renderer.setRenderTarget(bound);
    const a = mesh(0);
    const b = mesh(2);
    await warmPrograms(
      renderer,
      new THREE.Scene(),
      camera,
      [a, b],
      [
        { layers: [0, 1], target: board },
        { layers: [2], target: null },
      ],
    );
    expect(calls.map((c) => [c.target, c.nodes])).toEqual([
      [board, [a]],
      [null, [b]],
    ]);
    expect(camera.layers.mask).toBe(1 << 5);
    expect(renderer.getRenderTarget()).toBe(bound);
  });

  it("waits until the driver reports every new program linked", async () => {
    const { renderer, programs } = fakeRenderer(true, 2);
    await warmPrograms(
      renderer,
      new THREE.Scene(),
      new THREE.Camera(),
      [mesh(), mesh()],
      [{ target: null }],
    );
    expect(programs).toHaveLength(2);
    for (const p of programs) {
      expect(p.isReady()).toBe(true);
      // Never the blocking path when the driver can say.
      expect(p.getUniforms).not.toHaveBeenCalled();
    }
  });

  it("without parallel compile, links one node's programs per task", async () => {
    const { renderer, programs, calls } = fakeRenderer(false);
    const shared = new THREE.MeshBasicMaterial();
    const a = mesh();
    const b = new THREE.Mesh(new THREE.BufferGeometry(), shared);
    const c = new THREE.Mesh(new THREE.BufferGeometry(), shared);
    await warmPrograms(
      renderer,
      new THREE.Scene(),
      new THREE.Camera(),
      [a, b, c],
      [{ target: null }],
    );
    expect(calls).toHaveLength(3);
    expect(programs).toHaveLength(2);
    for (const p of programs) expect(p.getUniforms).toHaveBeenCalledTimes(1);
  });

  it("skips nodes whose materials already have a program", async () => {
    const { renderer, calls } = fakeRenderer(true);
    const a = mesh();
    const b = mesh();
    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    await warmPrograms(renderer, scene, camera, [a], [{ target: null }]);
    await warmPrograms(renderer, scene, camera, [a, b], [{ target: null }]);
    expect(calls.map((c) => c.nodes)).toEqual([[a], [b]]);
  });

  it("stops when cancelled", async () => {
    const { renderer, programs } = fakeRenderer(false);
    let n = 0;
    await warmPrograms(
      renderer,
      new THREE.Scene(),
      new THREE.Camera(),
      [mesh(), mesh(), mesh()],
      [{ target: null }],
      () => n++ > 0,
    );
    expect(programs).toHaveLength(1);
  });

  it("does nothing on a renderer without a program list", async () => {
    const renderer = { info: {} } as unknown as THREE.WebGLRenderer;
    await expect(
      warmPrograms(renderer, new THREE.Scene(), new THREE.Camera(), [mesh()], [{ target: null }]),
    ).resolves.toBeUndefined();
  });
});

describe("gpuFinished", () => {
  it("polls the fence until it signals, then frees it", async () => {
    const results = [0x911b, 0x911b, 0x911a]; // TIMEOUT_EXPIRED twice, then ALREADY_SIGNALED
    const sync = {};
    const gl = {
      SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
      TIMEOUT_EXPIRED: 0x911b,
      fenceSync: vi.fn(() => sync),
      flush: vi.fn(),
      clientWaitSync: vi.fn(() => results.shift()),
      deleteSync: vi.fn(),
    };
    await gpuFinished(gl as unknown as WebGL2RenderingContext);
    expect(gl.clientWaitSync).toHaveBeenCalledTimes(3);
    expect(gl.deleteSync).toHaveBeenCalledWith(sync);
  });

  it("returns at once without fences", async () => {
    const gl = { fenceSync: () => null, flush: vi.fn() };
    await expect(gpuFinished(gl as unknown as WebGL2RenderingContext)).resolves.toBeUndefined();
  });
});
