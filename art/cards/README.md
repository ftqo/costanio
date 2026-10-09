# Card art

Every drawn card face in the game (development, progress and scenario cards) is
a low-poly Blender still-life, rendered untitled. The game draws the card's
title at runtime, in the player's language, over the picture.

## Layout

| Path | What it is |
|---|---|
| `cards.json` | One entry per card: `id`, display name, deck, rule text, and the brief the picture was staged from (focal object, scene, light, the small "nod" to the rule). An `art` field means the card shares another card's picture. |
| `scenes/<id>.blend` | The scene for card `<id>`: geometry, materials, lights, camera and render settings. This is the source of truth. |
| `scenes/lowpoly_kit.py` | Shared helpers for building scenes (materials, primitives, a horse, a rider, hex-angle roads, walls, the render rig, a sun solver). `exec` it inside Blender. |
| `masters/<id>.webp` | The finished 1000x1400 untitled render. Tracked through Git LFS. |
| `tools/vignette.py` | The edge-frame pass applied to every render. |
| `tools/title.py` | Draws a title onto a render, as a proof that the bottom band can hold type. Its output is never an asset. Its constants are the spec the frontend title layer reproduces. |
| `tools/probe.py` | Luminance probe for a rendered PNG (whole frame, bottom band, or a rectangle). |
| `tools/cardkit.py` | Small modelling helpers (`mat`, `box`, `cyl`, `lathe`, `joinall`, lights). |
| `tools/fonts/` | Gelasio Bold (SIL OFL), the Latin title face `title.py` uses. |

`<id>` is always the card's `id` in `cards.json`. Two slots can share one
picture: `road_building` feeds both the development card and the science
progress card.

## Making or changing a card

1. Open `scenes/<id>.blend` (or start a new one with that name) and work in it.
   Save often; re-render from the saved file before judging, because a render
   from unsaved session state is not reproducible.
2. Render at 1000x1400 (settings below) to `out/<id>_raw.png`, relative to
   `art/cards/`. `out/` is scratch and is not tracked.
3. Apply the frame:

   ```
   cd art/cards
   blender --background --python tools/vignette.py -- out/<id>_raw.png out/<id>.png
   ```

4. Convert `out/<id>.png` to `masters/<id>.webp` at 1000x1400.
5. Land it in the game: add `<id>:<slot>` to the map in
   `tools/cards/encode_faces.sh` if the slot is new, run `make card-faces`, and
   make sure the slot carries `"untitled": true` in
   `frontend/public/assets/manifest.json`.

**A landing needs all three to agree**: the master exists, the slot is in
`encode_faces.sh`'s map, and the manifest flag is set. A master without the
flag ships a card with no title; the flag without the master ships a title drawn
over old art. `make card-faces` followed by `git status` is the cheap audit: any
slot file that changes when you did not touch its master was stale.

Slot ids are `progress_<id>` for progress cards, `devcard_<name>` for the base
development cards, and `raiders_<name>` for the Raiders deck.

## Render settings

```
engine                CYCLES, device GPU
compute devices       Metal only, with MetalRT on (on the Cycles addon
                      preferences, not on scene.cycles)
caustics              reflective and refractive off
bounces               max 8-10, glossy 4, diffuse 4 (6 for a deep interior),
                      transmission 4-6, volume 1; pin them, never inherit
resolution            1000 x 1400, PNG
view transform        AgX, look "AgX - Base Contrast"
exposure, gamma       pinned explicitly (0.0 and 1.0 unless a card says otherwise)
denoising             on
depth of field        off
```

Iterate at 55-60% resolution and ~140 samples; judge at 100% and ~300 samples,
always on the PNG and never on the viewport.

## The look

- **Low poly, flat shading, solid colour.** No textures, no smooth normals.
  Round things get more sides, not softer shading.
- **Build the real place.** A forge, a quarry, a warehouse: architecture is what
  makes the light believable. Only what the camera sees needs building.
- **One idea per card, and it dominates.** The subject should own about a third
  of the frame height.
- **Silhouette rule.** Lit subject on dark ground, or dark subject on lit ground.
- **Roads are straight.** This is a hex-lattice game: roads are straight
  segments meeting at hard angles.
- **Materials.** `Specular IOR Level` 0.12-0.14 on non-metals, roughness
  0.85-0.98; metals 0.25-0.60. Coloured glass is a coloured Transparent BSDF
  plus a small Emission mix, not transmission 1.0.
- **Bright, with depth.** Default to daylight; keep a clear key direction, real
  shadows, three readable depth layers and a small saturated accent.
  `alchemist` is the reference for a card that feels alive.
- **The bottom fifth stays quiet**: nothing important, nothing bright, nothing
  cropped. The title is drawn there at runtime, and the band has to hold white
  type on its own, without relying on the scrim. The reserved band is fixed.

Each deck has a **tell** and a **colour family**:

| Deck | Tell | Colour family |
|---|---|---|
| Development | More open ground than the other decks | Warm neutrals: honey, straw, ochre, warm stone |
| Trade | A way *through* the frame: a quay, a bay door, a road out | Pinks and warm corals through to clean warm daylight |
| Politics | Somebody just gone from the frame | Cool blues, slate, silver, steel |
| Science | The machine or the idea doing visible work | Greens and papyrus through to clear bright daylight |

Tint the fill and the sky, never the key's landing pool.

## Traps

- **Metal only, MetalRT on.** A background render that silently falls back to
  the CPU BVH renders coincident coplanar faces pure black; ticking both CPU and
  Metal devices gives a half-wrong hybrid image. Better still, never build
  coincident coplanar faces: stand parts a few millimetres proud.
- **`blender --background` exits 0 even when the script raises.** Check that the
  output file exists and its mtime moved; never trust the exit code.
- **A background render starts from the default startup file**, default cube and
  1000 W point light included. Wipe the scene first (`lowpoly_kit.wipe()`).
- **`image.pixels` is raw sRGB in Blender 5**, whatever the colour space
  setting says. Decode before computing luminance (`tools/probe.py` does).
- **Flat is usually ambient.** Split the world into two Background shaders mixed
  on `Is Camera Ray`: one strength for what the camera sees, a much lower one
  for every other ray. Cut ambient before touching anything else.
- **Over-filled looks underlit.** Too many fills lift every shadow the key cut;
  fewer fills and a stronger key separate subject from ground.
- **An area light emits along its local -Z.** A fill that does nothing is usually
  pointing out through a wall.
- **Area-light energy is total watts over the panel.** A big soft fill needs
  thousands of watts, not tens.
- **AgX whitens a saturated emission at high strength.** Use lower strength and
  more saturation.
- **Every window needs something built outside it**, or it returns the world
  background as a flat lightbox. Seal wall heads and gables against sky leaks.
- **Map the sky ramp across the elevation slice the camera actually sees**
  (`Map Range` from `sin(el_lo)` to `sin(el_hi)` into the `ColorRamp`), and
  place clouds by elevation angle rather than altitude.
- **A light shaft only glows aimed roughly at the camera** (forward scatter);
  for a beam travelling away from the lens, use backscatter. Scatter dust motes
  inside the real beam prism.
- **`world_to_camera_view` needs `view_layer.update()` and the final resolution**
  set first, or every screen position it returns is wrong.
