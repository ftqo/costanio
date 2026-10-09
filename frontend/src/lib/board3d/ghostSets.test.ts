// A ghost previews the piece a click would build, so it must come from the
// same file. Three cases: the set is fine, the set is not a drop-in, and the
// set is missing. In the last two the player must keep the ghost.
import { test, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { LoadedAsset } from "./loader";

const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./loader", async (orig) => {
  const real = await orig<typeof import("./loader")>();
  return { ...real, loadAsset: h.load };
});

import { loadGhosts } from "./ghostMesh";
import type { Palette } from "./palette";

/** An asset whose node names carry a tag, so a ghost can be traced to a file. */
function art(tag: string, names: string[]): LoadedAsset {
  const scene = new THREE.Group();
  for (const name of names) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.75, 0),
      new THREE.MeshStandardMaterial({ name: "Seat_Body" }),
    );
    mesh.name = `${name}_${tag}`;
    scene.add(mesh);
  }
  return { scene, byMaterial: new Map() };
}

const STOCK = ["Settlement_A", "City_A", "Road_A", "Robber_"];
const palette = {} as Palette;

/** The tag on the file a ghost's meshes came out of. */
function tagOf(object: THREE.Object3D): string {
  return (object.children[0]?.name ?? "").split("_").pop() ?? "";
}

beforeEach(() => {
  h.load.mockReset();
});

test("a set draws the buildings, and never the robber", async () => {
  h.load.mockImplementation((file: string) =>
    Promise.resolve(
      file === "pieces.glb"
        ? art("stock", STOCK)
        : art("set", ["Settlement_A", "City_A", "Road_A"]),
    ),
  );

  const ghosts = await loadGhosts(
    palette,
    ["settlement", "city", "road", "robber"],
    "#ff0000",
    "pieces/cyclades.glb",
  );

  for (const kind of ["settlement", "city", "road"] as const) {
    expect(tagOf(ghosts.get(kind)!.object), kind).toBe("set");
  }
  // Nobody owns the robber, so no set owns it either.
  expect(tagOf(ghosts.get("robber")!.object)).toBe("stock");
});

// A set that is not a drop-in: the file loads but the nodes are named
// something else. The set is lost; the preview must not be.
test("a set with misnamed nodes falls back to the stock art", async () => {
  h.load.mockImplementation((file: string) =>
    Promise.resolve(file === "pieces.glb" ? art("stock", STOCK) : art("set", ["House_01"])),
  );

  const ghosts = await loadGhosts(palette, ["settlement"], "#ff0000", "pieces/broken.glb");

  expect(ghosts.has("settlement")).toBe(true);
  expect(tagOf(ghosts.get("settlement")!.object)).toBe("stock");
});

test("a set that will not load falls back to the stock art", async () => {
  h.load.mockImplementation((file: string) =>
    file === "pieces.glb" ? Promise.resolve(art("stock", STOCK)) : Promise.reject(new Error("404")),
  );

  const ghosts = await loadGhosts(palette, ["settlement", "city"], "#ff0000", "pieces/gone.glb");

  expect(tagOf(ghosts.get("settlement")!.object)).toBe("stock");
  expect(tagOf(ghosts.get("city")!.object)).toBe("stock");
});

// The stock player is the common case and must not gain a second load or
// render.
test("no piece set asks for exactly the files it always did", async () => {
  h.load.mockImplementation(() => Promise.resolve(art("stock", STOCK)));

  await loadGhosts(palette, ["settlement", "city", "road", "robber"], "#ff0000");

  expect(h.load.mock.calls.map((c) => c[0])).toEqual(["pieces.glb"]);
});
