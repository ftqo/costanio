// The hero still-life resource art: which slot a good's picture comes from at
// each size.
//
// The picks live in resourceArt.json, read by the bake script
// (scripts/resource-art.mjs), which writes the webp files and pack manifest.
// At runtime the manifest decides: a slot resolves when the pack has its file,
// otherwise the good keeps its icon or glyph.
import { assetExt } from "./assets";

/**
 * The card-sized art for a good whose small icon is `iconSlot` (`icon_wheat`
 * -> `card_wheat`), or `iconSlot` itself when there is no card render. For the
 * places a picture is drawn big: the hand, the trade lanes, the pickers.
 */
export function cardArtSlot(iconSlot: string): string {
  if (!iconSlot.startsWith("icon_")) return iconSlot;
  const card = `card_${iconSlot.slice(5)}`;
  return assetExt(card) ? card : iconSlot;
}

/**
 * The small icon slot for a good by id (`rivercoin`, `gold`, `fish`, ...), or
 * null while the pack has no render for it, in which case the caller draws its
 * glyph.
 */
export function goodIconSlot(id: string): string | null {
  const slot = `icon_${id}`;
  return assetExt(slot) ? slot : null;
}
