// palette.json overrides glTF material factors at load, so restyling is a
// diffable file plus a page reload rather than a Blender round-trip. The
// exporter writes it once and never clobbers hand edits.
import * as THREE from "three";

export interface PaletteEntry {
  color: [number, number, number];
  roughness: number;
  metalness: number;
  /**
   * Self-lit colour, linear, for a surface that is a light source: a window
   * with a lamp behind it, a brazier, a sign.
   *
   * Optional; no exported entry uses it yet. The `vibrant` and `mist` styles
   * are built to use it.
   *
   * Values above 1 are allowed: the scene renders into a half-float target
   * (see `oceanPass.ts`), so 2.0 exceeds the bloom threshold and bleeds.
   *
   * Not for a seat-tinted slot: `tintableAsset` clones those and the clones
   * aren't registered here, so a later boost wouldn't reach them. A player's
   * glowing building needs its own named material.
   */
  emissive?: [number, number, number];
  /** Scales `emissive`. Defaults to 1. The style's boost multiplies this. */
  emissiveIntensity?: number;
}

export type Palette = Record<string, PaletteEntry>;

/**
 * Materials that came out of the palette self-lit, and the intensity the
 * palette authored for each.
 *
 * The authored value is kept because the live one is overwritten on every
 * style change, and rescaling in place would compound. Same pattern as
 * `crests` and `fades` in `ocean.ts`: cached materials outlive any board. A
 * plain Map, since the entries live as long as the tab anyway.
 */
const glowing = new Map<THREE.MeshStandardMaterial, number>();

let emissiveBoost = 0;

/**
 * Scale every self-lit material by `k`, and remember it for ones loaded later.
 *
 * Called by `Board3D` on every look change. 0 turns the glow off, which is
 * what `classic` asks for. `emissiveIntensity` is a uniform, so this doesn't
 * recompile: three keys its program on `emissiveMap`, not on the colour.
 */
export function setEmissiveBoost(k: number): void {
  emissiveBoost = k;
  for (const [material, authored] of glowing) material.emissiveIntensity = authored * k;
}

export function currentEmissiveBoost(): number {
  return emissiveBoost;
}

/** How many self-lit materials the palette has produced. For the tests. */
export function glowingMaterialCount(): number {
  return glowing.size;
}

/**
 * Values come straight from Blender's Principled Base Color, which is already
 * linear (three's working space), so they are set directly rather than through
 * setStyle's sRGB conversion.
 */
export function applyPalette(material: THREE.MeshStandardMaterial, palette: Palette): boolean {
  const entry = material.name ? palette[material.name] : undefined;
  if (!entry) return false;
  material.color.setRGB(entry.color[0], entry.color[1], entry.color[2], THREE.LinearSRGBColorSpace);
  material.roughness = entry.roughness;
  material.metalness = entry.metalness;
  if (entry.emissive) {
    material.emissive.setRGB(...entry.emissive, THREE.LinearSRGBColorSpace);
    const authored = entry.emissiveIntensity ?? 1;
    glowing.set(material, authored);
    // The live boost, not the authored value, so a late-loading asset arrives
    // already correct.
    material.emissiveIntensity = authored * emissiveBoost;
  }
  return true;
}

/**
 * Cached per URL, the way `loadAsset` caches models.
 *
 * The board rebuilds on every view change and this sits at the head of that
 * rebuild; uncached it re-fetched on every roll and delayed the first board.
 * The promise is cached so concurrent callers share one request, and a failure
 * is forgotten (as in `loader.ts`).
 */
const palettes = new Map<string, Promise<Palette>>();

export async function loadPalette(url = "/models/palette.json"): Promise<Palette> {
  const hit = palettes.get(url);
  if (hit) return hit;
  const job = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`palette: ${res.status} ${res.statusText}`);
    return (await res.json()) as Palette;
  })();
  palettes.set(url, job);
  void job.catch(() => palettes.delete(url));
  return job;
}
