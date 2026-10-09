// The resource icons as hero props, and what measuring them against the
// vectors showed.
//
// The props were modelled for the icon and are drawn with an outline (dock
// cargo, in `cardShots.ts`, is too small to read). One slot each, no size
// variants.
//
// ## Changing them
//
//   make bake-icons
//
// Rebuilds all eight from the props, reframes them, re-inks the contour and
// encodes the slot files. Edit geometry in `tools/blender/icons/props.py` or
// framing in `render_icons.py`, run it, and check the 384 px review renders in
// `art/prototypes/resource-icons/` (untracked output).
//
// The bake runs in Blender, not `renderShopThumbnails` (see the render
// script's docstring). The shots below are what the browser path would use;
// the list after the measurements says what that path lacks.
//
// `manifest.json` points all eight icon slots at `webp`, so these bakes are
// what the game draws. `cardShots.test.ts` asserts that.
//
// ## Measurements
//
// `tools/icons/measure.py` rasterises every icon as the app does (an `<img>`
// sized by CSS) at the four sizes an `icon` slot is drawn at, and compares all
// 28 pairs: silhouette RMS with paint forced to black, IoU, and ink-restricted
// CIELAB distance on the white ResCard well and the `#2a2e3c` dark panel.
//
// Worst pair (the two icons most easily confused), old glyphs vs props:
//
//                  sil RMS↑        IoU↓          ΔE(ink,white)↑  ΔE(ink,dark)↑
//   13 px  svg     21.0            .783          25.2            22.0
//          props   29.2  (+39 %)   .786          26.6  (+6 %)    23.2  (+5 %)
//   18 px  svg     19.7            .883          30.7            23.9
//          props   28.8  (+46 %)   .776 (+12 %)  26.1  (-15 %)   22.8  (-5 %)
//   26 px  svg     21.1            .870          36.4            28.5
//          props   32.5  (+54 %)   .807  (+7 %)  32.0  (-12 %)   25.7  (-10 %)
//   36 px  svg     21.9            .856          38.4            29.9
//          props   32.5  (+48 %)   .791  (+8 %)  31.7  (-17 %)   25.6  (-14 %)
//
// Ink coverage .394 -> .510. The props gain about half in shape at every size
// and lose 5-17 % of colour separation from 18 px up. That is structural: a
// lit surface spreads its pixels over a range of lightness, so two lit
// surfaces drift toward the same middle. No albedo change recovers it.
//
// 13 px is the only size where the props match or beat the glyphs on all four
// metrics, since colour is lost there for everyone. So there are no size
// variants (renders on cards, glyphs on chips): the harbour badge has no
// fixed pixel size to switch on, and a cosmetic pack with one variant would
// half-apply.
//
// Cloth vs coin at 13 px (cost chips, no colour field behind them): sil 37.7,
// IoU .639, ΔE 62.2 on white, ninth-worst of 28 on silhouette. The yarn ball
// breaks the circle in silhouette: oblate at 0.84, a loose end outside the
// outline and a tail below, mass off-centre.
//
// ## The contour
//
// With the frame filled, contour width costs drawing area. Same props, with /
// without the hull, worst pair:
//
//                          13 px          26 px      (with hull / without)
//   silhouette RMS↑        31.6 / 32.1    32.7 / 33.4
//   IoU↓                   .763 / .748    .778 / .757
//   ΔE(ink) white well↑    27.2 / 26.1    33.2 / 30.4
//   ΔE(ink) dark panel↑    23.6 / 27.0    27.9 / 31.1
//
// It is kept for separation from the background, which no pairwise metric
// measures. On the dark panel, `#1c2b4a` ink is close to `#2a2e3c`, so the
// hull adds a band all eight share; the old SVGs had the same property.
//
// Contour width must be a fraction of the frame. An inverted hull is a fixed
// world offset and each prop is framed to its own size, so a fixed 0.055 gave
// strokes from .0162 to .0251 of the frame (1.55x). `render_icons.py` takes
// the contour as a fraction of `ortho_scale` and solves frame and hull
// together; any card face that wants an outline should do the same.
//
// The metrics measure confusability, not whether a glyph says "wood".
import type { PieceShot } from "./thumbnail";

// What the browser rig would need before it could shoot these:
//
// 1. Back-face-only draw. The contour is an inverted hull (the prop's mesh
//    pushed out along its normals) and reads as a contour only with the near
//    half dropped. glTF has only a `doubleSided` bit, so `resicons.glb` ships
//    without the hull; the loader would build it with `side: THREE.BackSide`.
// 2. An environment. These props need none (the coin is gold albedo on a
//    dielectric), but the rig's missing envMap is what baked a metal coin
//    black, and adding an IBL would regrade the shop tiles and the dev deck.
// 3. A neutral view transform. The props carry their information in albedo
//    and the rig's grade is solved for saturated seat colours; the Blender
//    bake uses Standard for the same reason `DEV_DECK_SHOT` needs
//    `exposure: 0.5`.

/**
 * One hero prop per resource.
 *
 * `fill` is 0.97 for all: a 96 px icon has no card around it, and a larger
 * margin wastes ink. The Blender bake reaches it by measuring the rendered
 * alpha and correcting; a browser rig would need the same two passes rather
 * than an analytic fit off bounding boxes.
 *
 * `exposure` stays at 1: the grade is in the materials.
 */
export const HERO_ICON_SHOTS: PieceShot[] = [
  {
    // Three cross-piled logs, ends to camera. The sawn faces are the prop:
    // bone-coloured discs on near-black bark, the largest internal albedo
    // step in the set.
    slot: "icon_wood",
    parts: [{ file: "resicons.glb", prefix: "Res_wood" }],
    yawDeg: 0,
    fill: 0.97,
    exposure: 1.0,
  },
  {
    // One brick, three frogs sunk into the bed face: dark marks on a light
    // ground, the reverse of the end grain, so brick and wood stay distinct.
    slot: "icon_brick",
    parts: [{ file: "resicons.glb", prefix: "Res_brick" }],
    yawDeg: 0,
    fill: 0.97,
    exposure: 1.0,
  },
  {
    // One animal, not a flock. The legs punch holes through the silhouette,
    // which nothing else in the set does.
    slot: "icon_sheep",
    parts: [{ file: "resicons.glb", prefix: "Res_sheep" }],
    yawDeg: 0,
    fill: 0.97,
    exposure: 1.0,
  },
  {
    // A bound sheaf: fluted stalks, three turns of twine at a tight waist, a
    // crown that fans out to 2.7x the waist and is serrated along its top
    // edge. The serration must be on top, because the upper arc is what a
    // downsample keeps. (The flute is `sin` of a phase that must not be a
    // multiple of pi at the samples, or it vanishes.)
    slot: "icon_wheat",
    parts: [{ file: "resicons.glb", prefix: "Res_wheat" }],
    yawDeg: 0,
    fill: 0.97,
    exposure: 1.0,
  },
  {
    // Rock plus crystals: the only spiked outline, in the only cold hue.
    slot: "icon_ore",
    parts: [{ file: "resicons.glb", prefix: "Res_ore" }],
    yawDeg: 0,
    fill: 0.97,
    exposure: 1.0,
  },
  {
    // A wound ball with a loose end. A folded stack looked like the brick and
    // a drape read as a curtain; a ball of yarn is unmistakable. See the head
    // of this file for the cloth/coin check.
    slot: "icon_cloth",
    parts: [{ file: "resicons.glb", prefix: "Res_cloth" }],
    yawDeg: 0,
    fill: 0.97,
    exposure: 1.0,
  },
  {
    // A leaning stack of deckle-edged sheets; a scroll read as a pipe. Graded
    // down from bone to tanned parchment: at #e7dcc0 it sat 22.4 ΔE from the
    // fleece at 13 px, the worst colour pair, and the sheep cannot change.
    slot: "icon_paper",
    parts: [{ file: "resicons.glb", prefix: "Res_paper" }],
    yawDeg: 0,
    fill: 0.97,
    exposure: 1.0,
  },
  {
    // Metalness 0: with nothing to reflect a metal coin bakes black, while a
    // gold albedo on a dielectric reads gold anywhere.
    slot: "icon_coin",
    parts: [{ file: "resicons.glb", prefix: "Res_coin" }],
    yawDeg: 0,
    fill: 0.97,
    exposure: 1.0,
  },
];
