// The thumbnail renderer's lifetime: one WebGL context kept between batches,
// a private one for a batch that overlaps, and nothing left once idle.
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";

const fake = vi.hoisted(() => {
  class FakeRenderer {
    static made: FakeRenderer[] = [];
    lost = false;
    disposed = 0;
    renders = 0;
    shadowMap = { enabled: false, type: 0 };
    outputColorSpace = "";
    toneMapping = 0;
    toneMappingExposure = 1;
    domElement = { toBlob: (cb: (b: Blob) => void) => cb(new Blob(["png"])) };
    constructor() {
      FakeRenderer.made.push(this);
    }
    setPixelRatio() {}
    setSize() {}
    setClearAlpha() {}
    render() {
      this.renders++;
    }
    getContext() {
      return { isContextLost: () => this.lost };
    }
    dispose() {
      this.disposed++;
    }
    forceContextLoss() {
      this.lost = true;
    }
  }
  return { FakeRenderer };
});

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: fake.FakeRenderer,
}));
vi.mock("./palette", () => ({ loadPalette: async () => ({}) }));
vi.mock("./warmPrograms", () => ({
  warmPrograms: async () => {},
  gpuFinished: async () => {},
}));
vi.mock("./loader", () => ({
  loadAsset: async () => {
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    mesh.name = "Box_1";
    scene.add(mesh);
    return { scene, byMaterial: new Map() };
  },
}));

import {
  renderShotBlobs,
  __disposeShotRenderer,
  SHOT_RENDERER_IDLE_MS,
  type PieceShot,
} from "./thumbnail";

const SHOTS: PieceShot[] = [
  { slot: "a", parts: [{ file: "x.glb", prefix: "Box" }], yawDeg: 0, fill: 0.6 },
  { slot: "b", parts: [{ file: "x.glb", prefix: "Box" }], yawDeg: 30, fill: 0.6 },
];
const made = () => fake.FakeRenderer.made;

beforeEach(() => {
  vi.useFakeTimers();
  made().length = 0;
});
afterEach(() => {
  __disposeShotRenderer();
  vi.useRealTimers();
});

test("batches one after another share one renderer, freed once idle", async () => {
  const first = await renderShotBlobs(["#d23c3c"], { shots: SHOTS });
  const second = await renderShotBlobs(["#2f6fd6"], { shots: SHOTS, size: { w: 96, h: 96 } });
  expect(Object.keys(first.get("#d23c3c") ?? {})).toEqual(["a", "b"]);
  expect(Object.keys(second.get("#2f6fd6") ?? {})).toEqual(["a", "b"]);
  expect(made()).toHaveLength(1);
  expect(made()[0].renders).toBe(4);

  // Kept through the gap between batches, then handed back.
  vi.advanceTimersByTime(SHOT_RENDERER_IDLE_MS - 1);
  expect(made()[0].lost).toBe(false);
  vi.advanceTimersByTime(1);
  expect(made()[0].lost).toBe(true);
  expect(made()[0].disposed).toBe(1);
});

test("a batch inside the idle window keeps the renderer alive", async () => {
  await renderShotBlobs(["#d23c3c"], { shots: SHOTS });
  vi.advanceTimersByTime(SHOT_RENDERER_IDLE_MS - 1);
  await renderShotBlobs(["#2f6fd6"], { shots: SHOTS });
  vi.advanceTimersByTime(SHOT_RENDERER_IDLE_MS - 1);
  expect(made()).toHaveLength(1);
  expect(made()[0].lost).toBe(false);
});

test("an overlapping batch gets its own renderer and frees it when done", async () => {
  const [a, b] = await Promise.all([
    renderShotBlobs(["#d23c3c"], { shots: SHOTS }),
    renderShotBlobs(["#2f6fd6"], { shots: SHOTS }),
  ]);
  expect(a.size).toBe(1);
  expect(b.size).toBe(1);
  expect(made()).toHaveLength(2);
  // The private one is gone at once; the shared one waits out the idle time.
  expect(made()[1].lost).toBe(true);
  expect(made()[0].lost).toBe(false);

  // The next batch is back on the shared renderer.
  await renderShotBlobs(["#e8b63a"], { shots: SHOTS });
  expect(made()).toHaveLength(2);
  expect(made()[0].renders).toBe(4);
});

test("a lost context is replaced rather than drawn on", async () => {
  await renderShotBlobs(["#d23c3c"], { shots: SHOTS });
  made()[0].lost = true;
  await renderShotBlobs(["#2f6fd6"], { shots: SHOTS });
  expect(made()).toHaveLength(2);
  expect(made()[0].disposed).toBe(1);
  expect(made()[1].renders).toBe(2);
});
