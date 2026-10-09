// glTF loading, caching, and material grouping.
//
// Tiles ship as named meshes rather than one joined mesh, because
// bpy.ops.object.join reorders and dedupes material slots, and palette.json
// depends on those slots. byMaterial lets each layer build one InstancedMesh
// per material instead of one per source object.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { TILES, RESOURCE_FALLBACK } from "./manifest.generated";
import { applyPalette, loadPalette, type Palette } from "./palette";
import { dressOcean } from "./ocean";
import { RIVER_BOARD_TILES, RIVER_MODULE_TILES, riverTileFiles } from "./layers/rivers";
import { TRADE_TILES, tradeTileFiles } from "./layers/wagons";
import type { FullView } from "@/lib/types";

export interface LoadedAsset {
  scene: THREE.Group;
  byMaterial: Map<string, THREE.Mesh[]>;
}

const MODELS_BASE = "/models/";

/**
 * A GLTFLoader with the meshopt decoder registered.
 *
 * Every .glb under public/models is meshopt-compressed by
 * `npm run models:compress`, so a plain GLTFLoader cannot read any of them.
 * Exported so tests that parse the shipped files use the same loader. The
 * decoder is the wasm blob three.js ships; `setMeshoptDecoder` waits for it.
 */
export function newGLTFLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

/** Resolve a wire resource string to its tile file, honouring the fallback. */
export function tileFileFor(res: string): string | null {
  const direct = TILES[res];
  if (direct) return direct.file;
  const fallback = RESOURCE_FALLBACK[res];
  const mapped = fallback ? TILES[fallback] : undefined;
  return mapped ? mapped.file : null;
}

const cache = new Map<string, Promise<LoadedAsset>>();

export function clearAssetCache(): void {
  cache.clear();
}

/**
 * Turn a compressed model's integer vertex attributes back into floats.
 *
 * `npm run models:compress` quantises positions to normalised 16-bit integers
 * with a scale on the node. `instancing.ts` bakes transforms into vertices
 * (`applyMatrix4` writes back into the attribute's array), and into an
 * Int16Array that truncates. Converting once here keeps all downstream
 * geometry float32; the download saving is already made by this point.
 */
function dequantize(geometry: THREE.BufferGeometry): void {
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    if (attr.array instanceof Float32Array) continue;
    const out = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) {
      for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
  }
}

export function loadAsset(file: string, palette: Palette): Promise<LoadedAsset> {
  const hit = cache.get(file);
  if (hit) return hit;

  const job = new Promise<LoadedAsset>((resolve, reject) => {
    newGLTFLoader().load(
      MODELS_BASE + file,
      (gltf) => {
        const byMaterial = new Map<string, THREE.Mesh[]>();
        gltf.scene.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          dequantize(mesh.geometry);
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            if (mat instanceof THREE.MeshStandardMaterial) applyPalette(mat, palette);
            const key = mat.name || "unnamed";
            const list = byMaterial.get(key) ?? [];
            list.push(mesh);
            byMaterial.set(key, list);
          }
        });
        const asset = { scene: gltf.scene, byMaterial };
        // Every file passes through here exactly once (the asset is cached
        // for the tab). No-op for assets with no sea in them.
        dressOcean(asset);
        resolve(asset);
      },
      undefined,
      reject,
    );
  });

  cache.set(file, job);
  // Don't cache a failure: the lobby warms this cache, and a cached rejection
  // would leave the file broken for the rest of the session.
  void job.catch(() => cache.delete(file));
  return job;
}

/** Models every board draws, on top of the per-resource tiles. */
const COMMON_MODELS = [
  "beach.glb",
  "chips.glb",
  "docks.glb",
  "signs.glb",
  "pieces.glb",
  "ships.glb",
  "trader.glb",
];

/**
 * An alternative merchant stall that nothing draws.
 *
 * `trader.glb` is the funfair kiosk in use. `trader_v2.glb` is the same stall
 * rebuilt in the house style (`Trader2_merchant_*`, five materials, 1.095 tall,
 * level with a knight). It is in no `*_MODELS` list, so no board fetches it;
 * naming it here satisfies `loader.test.ts`'s check that every shipped model is
 * named in hand-written source.
 *
 * To use it, swap it for `trader.glb` in `COMMON_MODELS` and set
 * `MERCHANT_PREFIX` (`layers/knights.ts`) to `"Trader2_merchant"`. It follows
 * the same contract: base at y = 0, on a hex centre at `MODULE_SCALE.merchant`,
 * clear of the chip socket.
 */
export const TRADER_CANDIDATE = "trader_v2.glb";

/** Models only a Knights game draws. */
const KNIGHTS_MODELS = ["knights.glb", "walls.glb", "metros.glb"];

/**
 * Models only a Caravans game draws: the camels that walk the routes, and the
 * wayposts that mark where a route will start before its first camel exists.
 */
export const CARAVANS_MODELS = ["camels.glb", "spokes.glb"];

/**
 * Models only a Fishermen game draws: the weir that marks a fishing ground's
 * corners, and the shallows (`Fishground_*`) under its chip, in one file.
 */
export const FISHERMEN_MODELS = ["fishing.glb"];

/**
 * Models only a Raiders game draws, instanced by `layers/raiders.ts`.
 *
 * Kept out of `COMMON_MODELS` so `boardModelFiles` (the lobby prefetch) does
 * not download them for other rulesets. The barbarian warrior is shared with
 * Wagons; `Ship_barbarian` in ships.glb is unrelated (the raiding fleet's
 * marker).
 */
export const RAIDERS_MODELS = [
  // The mounted rider that patrols a road its owner built. `Rider_*`, not
  // `Knight_*`: the Knights expansion owns that prefix.
  "riders.glb",
  // The barbarian warrior. Neutral art: a raider belongs to nobody.
  "barbarians.glb",
];

/**
 * Models only a Wagons game draws.
 *
 * The wagon is a seat-tinted vertex piece (loaded through `tintableAsset`).
 * Several can share a junction with a settlement; `layers/wagons.ts` rings
 * them. The barbarian is shared with Raiders; `boardModelFiles` dedupes it.
 */
export const WAGONS_MODELS = ["wagons.glb", "barbarians.glb"];

/**
 * Models only a Rivers game draws: the bridge.
 *
 * Gated on the ruleset so base games don't download it. The river tiles are
 * gated separately through `MODULE_TILES`.
 */
export const RIVERS_MODELS = ["bridges.glb"];

/**
 * Models only an Explorers game draws.
 *
 * `vessels.glb`: the cargo ship (`Cargo_*`, on a sea edge) and the corsair
 * (`Corsair_*`, the scenario's robber on a hex centre). Both are seat-tinted,
 * because the player who moved the corsair owns it while it sits there.
 * `harbors.glb`: the quay (`Harbor_*`) and the two cargo figures its basin
 * carries (`Settler_*`, `Crew_*`), also seat-tinted. That file has no building:
 * the 2 VP harbour uses the player's equipped piece set.
 *
 * Drawn by `layers/explorers.ts`. Geometry is measured in `vesselArt.test.ts`,
 * `harborArt.test.ts` and `cargoArt.test.ts`.
 */
export const EXPLORERS_MODELS = [
  // The cargo ship and the corsair.
  "vessels.glb",
  // The harbour quay and the two cargo figures its basin holds. The quay is an
  // add-on beside the building on that vertex, never a replacement; the art
  // starts half a unit out along its own +x. See `harborArt.test.ts`.
  "harbors.glb",
  // The fish haul and spice sack a ship carries (neutral), and the mission
  // marker, which nothing draws: a mission track is a UI panel, so
  // `planMarkers` plans nothing.
  "cargo.glb",
  // The unexplored cloud: five billows and three floor pads, instanced over
  // every fogged hex by `layers/fog.ts` (`FOG_MODEL`, `fogKitMeshes`).
  "fog.glb",
  // The pirate lair on an uncaptured gold field (`Lair_*`, neutral) and the
  // crew figure that stands on a hex (`Boarder_*`, seat-tinted). See
  // `planLairs` and `planHexCrews` in `layers/explorers.ts`.
  "lairs.glb",
];

/**
 * The manifest key of the Raiders castle tile.
 *
 * `layers/raiders.ts` selects it by hex, as `layers/caravans.ts` does for the
 * oasis, because no resource names it: the tile underneath keeps its resource
 * and chip, which the client hides. Exported so `loader.test.ts` finds the key
 * named in hand-written source.
 */
export const CASTLE_TILE = "castle";

/**
 * The Explorers tiles, by manifest key.
 *
 * `layers/explorers.ts` repaints these by hex key, since no resource reaches
 * them (a gold field is `gold` on the wire, a shoal `sea`, a spice farm
 * `none`). This list keeps them out of every prefetch but an Explorers game's,
 * and names them for `loader.test.ts`'s reachability check.
 *
 *   goldfield   ochre placer country; a pirate lair mounts on its chip socket
 *   sea_shoal   open water with a bank in it; a fish haul lands at its middle
 *   spice       a village round a cleared pad the spice sacks stack on
 *   sea_council the Council: a walled town on a rock in open water, its two
 *               quays yawed onto the engine's anchor corners (`councilYaw`).
 *               Known from the first frame, not revealed.
 *
 * There is no face-down tile. An unrevealed hex is masked to the wire-only
 * `fog` resource (`MaskBoard`, `engine/module.go`) and drawn as the blank
 * `generic` slab with a cloud bank (`layers/fog.ts`).
 */
export const EXPLORERS_TILES = ["goldfield", "sea_shoal", "spice", "sea_council"] as const;

/**
 * Tiles only one module's boards can carry, and the module that carries them.
 *
 * Some are derived terrain no resource names (the oasis, the castle, the
 * Explorers tiles); the lake is an ordinary resource only Fishermen uses.
 * Listing them here keeps them out of every other ruleset's prefetch. The
 * Rivers tiles matter most: about 138 KB each, 6.5 MB in all.
 *
 * Prefetch only: `tileFileFor` still resolves any of these for a board that
 * carries one.
 */
const MODULE_TILES: Record<string, string> = {
  oasis: "caravans",
  lake: "fishermen",
  [CASTLE_TILE]: "raiders",
  ...Object.fromEntries(EXPLORERS_TILES.map((res) => [res, "explorers"])),
  // The forty-eight Wagons market towns (`TRADE_TILES`). A board draws three,
  // so they are fetched per board like the river channels (`PER_BOARD_TILES`).
  ...Object.fromEntries(TRADE_TILES.map((res) => [res, "wagons"])),
  ...RIVER_MODULE_TILES,
};

/**
 * Every model file a game of this ruleset can need, minus the ones that depend
 * on the board.
 *
 * Listed rather than derived because the board isn't generated yet when the
 * lobby asks. The river channels are the exception: they total 6.5 MB and a
 * board draws a handful, so only the marsh is prefetched
 * (`RIVER_PREFETCH_TILES`) and `boardTileFiles` fetches the rest once the
 * board is known. Every river key stays in `MODULE_TILES`, which keeps them off
 * other rulesets.
 */
export function boardModelFiles(ruleset: string): string[] {
  const parts = (ruleset || "base").split("+");
  const files = Object.entries(TILES)
    .filter(([res]) => !MODULE_TILES[res] || parts.includes(MODULE_TILES[res]))
    .filter(([res]) => !PER_BOARD_TILES.has(res))
    .map(([, t]) => t.file);
  files.push(...COMMON_MODELS);
  if (parts.includes("cak")) files.push(...KNIGHTS_MODELS);
  if (parts.includes("caravans")) files.push(...CARAVANS_MODELS);
  if (parts.includes("fishermen")) files.push(...FISHERMEN_MODELS);
  if (parts.includes("raiders")) files.push(...RAIDERS_MODELS);
  if (parts.includes("wagons")) files.push(...WAGONS_MODELS);
  if (parts.includes("explorers")) files.push(...EXPLORERS_MODELS);
  if (parts.includes("rivers")) files.push(...RIVERS_MODELS);
  // Deduped: the barbarian warrior is in both RAIDERS_MODELS and
  // WAGONS_MODELS. loader.test.ts asserts no duplicates for every ruleset.
  return [...new Set(files)];
}

/**
 * The tiles fetched per board, keyed by manifest key. See `boardModelFiles`.
 * A Set because it is tested once per manifest entry.
 */
const PER_BOARD_TILES = new Set<string>([...RIVER_BOARD_TILES, ...TRADE_TILES]);

/**
 * The model files this board needs on top of its ruleset's prefetch: the river
 * channels and trade towns it draws. Empty for a board with neither.
 */
export function boardTileFiles(view: FullView): string[] {
  return [...new Set([...riverTileFiles(view), ...tradeTileFiles(view)])];
}

/**
 * Warm the cache for the files this board draws.
 *
 * Only batches requests `Board3D` would make anyway through `loadAsset`; the
 * cache is keyed by file. Failures are swallowed, as in `preloadBoardModels`.
 */
export async function preloadBoardTiles(view: FullView): Promise<void> {
  const files = boardTileFiles(view);
  if (files.length === 0) return;
  const palette = await loadPalette().catch(() => null);
  if (!palette) return;
  await Promise.allSettled(files.map((f) => loadAsset(f, palette)));
}

/**
 * Fetch, parse and cache the board's models ahead of the board itself.
 *
 * Called from the lobby so starting a game lands on a painted board. The
 * board's own `loadAsset` calls then hit the cache. Failures are swallowed;
 * the board still loads (or reports) each file itself.
 */
export async function preloadBoardModels(ruleset: string): Promise<void> {
  const palette = await loadPalette().catch(() => null);
  if (!palette) return;
  await Promise.allSettled(boardModelFiles(ruleset).map((f) => loadAsset(f, palette)));
}

/**
 * The material an asset shipped under `name`, or null.
 *
 * The beach is generated geometry but borrows Mat_Shore_sand and
 * Mat_Shore_wetsand from beach.glb, so palette.json still controls it.
 */
export function materialNamed(asset: LoadedAsset, name: string): THREE.Material | null {
  const meshes = asset.byMaterial.get(name);
  if (!meshes?.length) return null;
  for (const mesh of meshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) if (mat.name === name) return mat;
  }
  return null;
}

/**
 * The lowest point of an asset's geometry, in its own space; what a piece is
 * seated by (see seating.ts). Read off the art because families differ: pieces
 * and chips start at 0.25, knights, metropolises, walls, ships and the
 * merchant at 0.
 */
export function assetBaseY(asset: LoadedAsset): number {
  return assetSpanY(asset)[0];
}

/**
 * The centre of an asset's footprint, in its own space. A subset is not
 * necessarily centred, so placements subtract this to put the middle of the
 * thing at the point.
 */
export function assetCentreXZ(asset: LoadedAsset): [number, number] {
  asset.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(asset.scene);
  if (!Number.isFinite(box.min.x)) return [0, 0];
  return [(box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2];
}

/** The lowest and highest points of an asset's geometry, in its own space. */
export function assetSpanY(asset: LoadedAsset): [number, number] {
  asset.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(asset.scene);
  return Number.isFinite(box.min.y) ? [box.min.y, box.max.y] : [0, 0];
}

/**
 * Extract the nodes of one item from a shared asset. chips.glb holds every
 * number and signs.glb every harbour ratio, so layers select by name prefix
 * (`Chip_06_1`, `Hwedge_wood`) rather than loading a file per item.
 *
 * Geometry and materials are shared with the cached asset; only the node
 * wrappers are new.
 */
export function subsetByPrefix(asset: LoadedAsset, prefix: string): LoadedAsset {
  const scene = new THREE.Group();
  const byMaterial = new Map<string, THREE.Mesh[]>();
  asset.scene.updateMatrixWorld(true);
  asset.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.name.startsWith(prefix)) return;
    const copy = new THREE.Mesh(mesh.geometry, mesh.material);
    copy.name = mesh.name;
    copy.applyMatrix4(mesh.matrixWorld);
    scene.add(copy);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const key = mat.name || "unnamed";
      byMaterial.set(key, [...(byMaterial.get(key) ?? []), copy]);
    }
  });
  return { scene, byMaterial };
}

/**
 * The same cut, from several prefixes at once, for pieces drawn from more than
 * one node (a ghost knight is a body plus its sword). A single string is
 * forwarded unchanged.
 *
 * The parts are named rather than cut on a broader prefix like `Knight_`, which
 * would collect every tier's bodies and swords.
 */
export function subsetByPrefixes(
  asset: LoadedAsset,
  prefixes: string | readonly string[],
): LoadedAsset {
  if (typeof prefixes === "string") return subsetByPrefix(asset, prefixes);
  if (prefixes.length === 1) return subsetByPrefix(asset, prefixes[0]);
  const scene = new THREE.Group();
  const byMaterial = new Map<string, THREE.Mesh[]>();
  for (const prefix of prefixes) {
    const part = subsetByPrefix(asset, prefix);
    // `subsetByPrefix` already baked each node's world matrix into a fresh
    // mesh, so the children can be re-parented as is.
    for (const child of [...part.scene.children]) scene.add(child);
    for (const [key, meshes] of part.byMaterial) {
      byMaterial.set(key, [...(byMaterial.get(key) ?? []), ...meshes]);
    }
  }
  return { scene, byMaterial };
}
