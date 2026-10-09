// Seat colours -> three.js materials, via the same resolver and tone derivation
// as the 2D UI, so pieces look the same everywhere. The carrier is the material
// name: Seat_Body/Shade/Detail.
//
// Custom colours and colorblind mode are just different inputs to
// resolveCssColorToHex.
import * as THREE from "three";
import { resolveCssColorToHex } from "@/lib/colorResolve";
import { deriveSeatTones } from "@/lib/color";
import { TINT_SLOTS } from "./manifest.generated";

/**
 * A seat's three tones, keyed by the material name each one paints.
 *
 * A type alias, not an interface: an alias gets an implicit index signature, so
 * it is assignable to the `Record<string, Color>` used as a per-instance colour
 * lookup by `instanceAsset` (see Placement.tint).
 */
export type SeatTint = {
  Seat_Body: THREE.Color;
  Seat_Shade: THREE.Color;
  Seat_Detail: THREE.Color;
};

const cache = new Map<string, SeatTint>();

/**
 * A THREE.Color from an sRGB hex. setStyle must be told the input is sRGB, or
 * every seat colour comes out darker in three's linear working space.
 */
function srgb(hex: string): THREE.Color {
  return new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
}

export function seatTint(color: string): SeatTint {
  const hit = cache.get(color);
  if (hit) return hit;

  // `color` may be a var(--color-*), a custom player hex, or a CVD palette
  // entry. resolveCssColorToHex normalises all three.
  const hex = resolveCssColorToHex(color);
  const { shade, detail } = deriveSeatTones(hex);
  const tint: SeatTint = {
    Seat_Body: srgb(hex),
    Seat_Shade: srgb(shade),
    Seat_Detail: srgb(detail),
  };
  cache.set(color, tint);
  return tint;
}

export function isTintSlot(materialName: string): boolean {
  return (TINT_SLOTS as readonly string[]).includes(materialName);
}

/** Colorblind mode swaps every seat's color; drop memoised tints on toggle. */
export function clearTintCache(): void {
  cache.clear();
}
