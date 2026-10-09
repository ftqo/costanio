import { test, expect, describe } from "vitest";
import * as THREE from "three";
import { availableGhostKinds, disposeGhosts, makeGhost, poseGhost, type Ghost } from "./ghostMesh";
import type { LoadedAsset } from "./loader";
import { seatY, SURFACE } from "./seating";
import { PIECE_SCALE, ROBBER_SCALE } from "./pieceArt";
import { edgeRotationY, vertexToWorld } from "./coords";
import type { PickTarget } from "./targets";
import type { FullView } from "@/lib/types";

/**
 * pieces.glb in miniature: the three base pieces and the robber, each one unit
 * tall and standing on 0.25 like the real art, so a seating error shows up as
 * a number.
 */
function pieces(): LoadedAsset {
  const scene = new THREE.Group();
  for (const name of ["Settlement_A_body", "City_A_body", "Road_A_bar", "Robber_body"]) {
    const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.75, 0);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ name: "Seat_Body" }));
    mesh.name = name;
    scene.add(mesh);
  }
  return { scene, byMaterial: new Map() };
}

const edge = { a: { q: 0, r: 0, side: 1 as const }, b: { q: 0, r: 1, side: 0 as const } };

const edgeTarget = (): PickTarget => ({
  kind: "edge",
  action: "edge",
  key: "edge:x",
  e: edge,
  pos: [3, 0.1, -4],
});

const vertexTarget = (): PickTarget => ({
  kind: "vertex",
  action: "vertex",
  key: "vertex:x",
  v: { q: 0, r: 0, side: 0 },
  pos: [3, 0.1, -4],
});

const hexTarget = (): PickTarget => ({
  kind: "hex",
  action: "hex",
  key: "hex:x",
  h: { q: 0, r: 0 },
  pos: [3, 0.1, -4],
});

const meshesOf = (ghost: Ghost): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  ghost.object.traverse((n) => {
    if ((n as THREE.Mesh).isMesh) out.push(n as THREE.Mesh);
  });
  return out;
};

describe("makeGhost", () => {
  test("cuts exactly the piece being previewed out of the shared file", () => {
    const ghost = makeGhost(pieces(), "settlement");
    expect(meshesOf(ghost).map((m) => m.name)).toEqual(["Settlement_A_body"]);
  });

  test("is gold, translucent and drawn over the board", () => {
    const material = makeGhost(pieces(), "city").material;
    expect(material.color.getHex()).toBe(0xffd23f);
    expect(material.opacity).toBeGreaterThan(0);
    expect(material.opacity).toBeLessThan(1);
    expect(material.transparent).toBe(true);
    // Overlay, not scenery: a city ghost has to be visible through the
    // settlement standing on the vertex it would replace.
    expect(material.depthTest).toBe(false);
    expect(meshesOf(makeGhost(pieces(), "city")).every((m) => m.renderOrder > 0)).toBe(true);
  });

  test("does not leak gold into the asset every real piece is drawn from", () => {
    // The source is the shared cache entry. Re-materialising it in place would
    // turn every player's settlements into ghosts.
    const asset = pieces();
    makeGhost(asset, "settlement");
    asset.scene.traverse((n) => {
      const mesh = n as THREE.Mesh;
      if (mesh.isMesh) expect((mesh.material as THREE.Material).type).toBe("MeshStandardMaterial");
    });
  });

  test("stands on the ground at the size it will really be built at", () => {
    // The seating rule: origin + scale * authored base lands on the surface.
    // Measuring the art after scaling it would float the ghost a quarter of a
    // hex up.
    const ghost = makeGhost(pieces(), "settlement");
    expect(ghost.object.scale.x).toBe(PIECE_SCALE.settlement);
    expect(ghost.y + PIECE_SCALE.settlement * 0.25).toBeCloseTo(SURFACE.gutter, 6);
  });

  test("starts parked out of sight", () => {
    // It is a prototype added to the scene once; a hover is what reveals it.
    expect(makeGhost(pieces(), "road").object.visible).toBe(false);
  });
});

describe("poseGhost", () => {
  test("lays a road along the edge it would span", () => {
    const ghost = makeGhost(pieces(), "road");
    poseGhost(ghost, edgeTarget());
    expect(ghost.object.rotation.y).toBeCloseTo(edgeRotationY(edge), 10);
    // The bar's own +x axis has to end up parallel to the edge; a sign error
    // breaks that.
    const [ax, , az] = vertexToWorld(edge.a);
    const [bx, , bz] = vertexToWorld(edge.b);
    const along = new THREE.Vector3(1, 0, 0).applyEuler(ghost.object.rotation);
    const run = new THREE.Vector3(bx - ax, 0, bz - az).normalize();
    expect(Math.abs(along.dot(run))).toBeCloseTo(1, 10);
  });

  test("leaves an upright piece unturned, wherever it is shown", () => {
    const ghost = makeGhost(pieces(), "settlement");
    poseGhost(ghost, vertexTarget());
    expect(ghost.object.rotation.y).toBe(0);
  });

  test("takes the target's footprint but its own height", () => {
    // The marker floats just above the ground; a piece stands on it.
    const ghost = makeGhost(pieces(), "settlement");
    poseGhost(ghost, vertexTarget());
    expect([ghost.object.position.x, ghost.object.position.z]).toEqual([3, -4]);
    expect(ghost.object.position.y).toBe(ghost.y);
  });

  test("a seat re-runs the seating sum against the spot's own ground", () => {
    // The robber climbs onto a number chip where the hex has one, so its
    // footing depends on the tile. Re-solved with `y + scale * base = surface`,
    // the rule the build used, rather than nudged by a hand-tuned offset.
    const ghost = makeGhost(pieces(), "robber");
    const chipTop = SURFACE.land + 0.12;
    poseGhost(ghost, hexTarget(), { surface: chipTop, dz: 1.5 });
    expect(ghost.object.position.y).toBeCloseTo(seatY(chipTop, 0.25, ROBBER_SCALE), 10);
    expect(ghost.object.position.y + ROBBER_SCALE * 0.25).toBeCloseTo(chipTop, 10);
    // The chip sits off the tile's centre and the robber goes with it.
    expect(ghost.object.position.z).toBeCloseTo(-4 + 1.5, 10);
  });

  test("no seat leaves the ghost where it was built, chip or no chip", () => {
    // A bare hex (the desert, where the robber starts) has no chip to climb.
    const ghost = makeGhost(pieces(), "robber");
    poseGhost(ghost, hexTarget(), null);
    expect(ghost.object.position.y).toBe(ghost.y);
    expect(ghost.object.position.z).toBe(-4);
  });
});

describe("availableGhostKinds", () => {
  // A view carrying only what this reads. `ext` is held empty while the
  // ruleset says otherwise, as in every real game when the board mounts.
  const view = (ruleset: string, ext: unknown = undefined) =>
    ({ config: { ruleset }, ext }) as unknown as FullView;

  test("a base game asks for no expansion art", () => {
    expect(availableGhostKinds(view("base"))).toEqual(["settlement", "city", "road", "robber"]);
  });

  test("every game gets the robber, which every ruleset has", () => {
    for (const rs of ["base", "base+islands", "base+cak"]) {
      expect(availableGhostKinds(view(rs)), rs).toContain("robber");
    }
  });

  test("each expansion adds only its own pieces", () => {
    const islands = availableGhostKinds(view("base+islands"));
    expect(islands).toContain("ship");
    expect(islands).toContain("pirate");
    expect(islands).not.toContain("knight");

    const knights = availableGhostKinds(view("base+cak"));
    expect(knights).toEqual(expect.arrayContaining(["knight", "wall", "merchant"]));
    expect(knights).not.toContain("ship");
  });

  test("the ruleset decides, not the module state", () => {
    // A module's ext is created by its first event, so a new game has
    // `ext: {}` however it was configured, and that is when the board mounts
    // and builds its ghosts (once). Reading `ext` here would drop every
    // Islands and Knights preview for the session.
    expect(availableGhostKinds(view("base+islands", {}))).toContain("ship");
    expect(availableGhostKinds(view("base+cak", {}))).toContain("knight");
    expect(availableGhostKinds(view("base+cak", {}))).toContain("merchant");
    expect(availableGhostKinds(view("base+islands+cak", {}))).toEqual(
      expect.arrayContaining(["ship", "pirate", "knight", "wall", "merchant"]),
    );
  });
});

test("disposing releases the material and empties the map", () => {
  // Geometry is shared with the cached asset and must survive; the material is
  // this ghost's alone and must be released, or each rebuild leaks one.
  const ghosts = new Map([["road" as const, makeGhost(pieces(), "road")]]);
  const geometry = meshesOf(ghosts.get("road")!)[0].geometry;
  let disposed = false;
  ghosts.get("road")!.material.addEventListener("dispose", () => {
    disposed = true;
  });
  disposeGhosts(ghosts);
  expect(disposed).toBe(true);
  expect(ghosts.size).toBe(0);
  expect(geometry.attributes.position).toBeTruthy();
});
