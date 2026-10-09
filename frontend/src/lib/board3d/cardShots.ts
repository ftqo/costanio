// A recorded study: the resource icons baked from dock cargo props. It failed
// on icon size, and the shipped icons are baked from purpose-built props in
// iconShots.ts instead. These shots are kept as the record of which prop,
// which angle and what exposure.
//
// The dev-card back (DEV_DECK_SHOT, in thumbnail.ts) showed a neutral subject
// can be composed here, rendered through the shop rig and baked to
// `public/assets/`. Every resource exists as a dock cargo prop (`docks.glb`:
// log crib, bricks, flock, fleeces, grain sacks, sheaves, ore; `trader.glb`:
// coins).
//
// ## Icon sizes
//
// The `icon` slots are authored 96x96 (see assets.ts) and drawn at:
//
//   13px  cost chips in the location action menu, on a bare panel (no well,
//         so the glyph carries the whole identity)
//   18px  the flying resource cards, and the harbour badges on the 2D board
//   26px  ResCard: the hand shelf, both trade lanes, the discard box and every
//         build recipe. The most common size, and the only one with a light
//         well behind it
//   36px  the artist grid tile; 70px the artist slot dialog
//
// The slot is square, not the card slot's 256x340. The framing solve uses the
// frame's aspect, so `renderShopThumbnails` must be told the size (see
// ThumbnailOptions.size).
//
// ## Why the cargo renders failed
//
// The SVG glyphs are single silhouettes with a uniform 4.5-unit `#1c2b4a`
// outline and two or three flat fills. The outline survives resampling to
// 13px and keeps the five resources distinct.
//
// A render has no outline; its form is small value differences between facets,
// which downsampling destroys. At 13px the six bakes become similar lumps
// (wood, brick and wheat brown, ore and sheep grey). Against the SVGs at 13, 18
// and 26px on light, hover and dark panels, the SVG won every slot at 13px,
// most at 18px, and lost only at 26px and above for wood (arguably brick and
// wheat). `assets.ts` has one slot per icon with no size variants, so shipping
// only the winners would mix photos and glyphs in the same views.
//
// Two also fail outright:
//
//   - sheep. No single sheep exists in the art. `Dock_sheep_flock` is several
//     animals in one mesh (a grey splinter), and `Dock_sheep_fleeces` looks
//     like the ore chunk.
//   - coin. `Mat_Trader_merchant_coins` is metalness 1.0 at roughness 0.25,
//     and the shot rig has no environment map (the board scopes its envMap to
//     the water; see oceanEnv.ts), so it renders black. Adding an IBL would
//     also regrade the signed-off shop tiles and dev deck.
//
// `icon_cloth` and `icon_paper` have no geometry in the shipped models.
//
// ## Baking recipe
//
// What works instead is a prop modelled for the icon: one object with a
// distinct silhouette at a dozen pixels and an outline (iconShots.ts, baked
// with `make bake-icons`). The manual recipe for these shots:
//
//   1. `npm run dev`, on a page whose module script calls
//      `renderShopThumbnails(anyColour, { shots: ICON_SHOTS, pixelRatio: 2,
//      size: { w: 96, h: 96 } })` (any seat colour; cargo has no seat slots).
//   2. Draw each data URL onto a 96x96 canvas (the render is 192x192 at
//      pixelRatio 2, so this is the 2x downsample) and `toBlob("image/png")`.
//   3. `cwebp -lossless -exact in.png -o icon_wood.webp`: lossless for the
//      hard-edged flat shading, `-exact` because transparent pixels carry
//      colour that lossy alpha smears into the silhouette. `cwebp` is not in
//      the flake; `nix shell nixpkgs#libwebp`.
//   4. Put them in `public/assets/` and set each slot's `ext` to `webp` in
//      `public/assets/manifest.json`. assetsManifest.test.ts checks every key
//      resolves to a file of its declared ext.
import type { PieceShot } from "./thumbnail";

/** The `icon` slot's authored size, and the aspect these shots are framed for. */
export const ICON_W = 96;
export const ICON_H = 96;

/**
 * One prop per resource, from the cargo study above. Not what the manifest's
 * icon slots ship.
 *
 * Chosen by rendering all 26 nodes of `docks.glb` at eight yaws and picking,
 * per resource, one that reads as a single compact object (which rules out the
 * 2.7-unit row of wheat sheaves, the ore spoil and the wood boom). `fill` is
 * ~0.92 rather than the shop tiles' 0.6-0.7 because an icon has no card around
 * it; `exposure` is cut most for pale subjects (wool, grain sacks, ore) for the
 * reason PieceShot.exposure gives.
 */
export const ICON_SHOTS: PieceShot[] = [
  {
    // The crib, not `Dock_wood_stack`: the stack lies flat and frames as a
    // brown rectangle, while the crib is cross-piled and shows end grain.
    slot: "icon_wood",
    parts: [{ file: "docks.glb", prefix: "Dock_wood_crib" }],
    yawDeg: 45,
    fill: 0.92,
    exposure: 1.0, // Bark is 0.27 albedo; the rig is already right for it.
  },
  {
    slot: "icon_brick",
    parts: [{ file: "docks.glb", prefix: "Dock_brick_stacks" }],
    yawDeg: 0,
    fill: 0.92,
    exposure: 0.7,
  },
  {
    // The weakest of the six even at 96px; there is no single sheep in the art.
    slot: "icon_sheep",
    parts: [{ file: "docks.glb", prefix: "Dock_sheep_flock" }],
    yawDeg: 270,
    fill: 0.9,
    exposure: 0.75,
  },
  {
    // Sacks rather than sheaves, so it reads as grain in a bag, unlike the
    // SVG's ear of wheat.
    slot: "icon_wheat",
    parts: [{ file: "docks.glb", prefix: "Dock_wheat_sacks" }],
    yawDeg: 135,
    fill: 0.92,
    exposure: 0.55,
  },
  {
    slot: "icon_ore",
    parts: [{ file: "docks.glb", prefix: "Dock_ore_load" }],
    yawDeg: 0,
    fill: 0.94,
    exposure: 0.5,
  },
  {
    // Renders black (fully metallic with no environment map).
    slot: "icon_coin",
    parts: [{ file: "trader.glb", prefix: "Trader_merchant_coins" }],
    yawDeg: 0,
    fill: 0.9,
    exposure: 1.0,
  },
];
