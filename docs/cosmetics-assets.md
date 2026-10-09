# Cosmetics: SVG asset manifest

The build-list for artists. Every entry maps 1:1 to a catalog `item_id` in
[`cosmetics.md`](cosmetics.md) (and the Go `cosmetics.Catalog`). Filenames **are**
the item id: `frame.laurel` → `frame.laurel.svg`. Ship the v1 set first; v2 is
art-heavy and gated behind a frontend that renders the live board.

> **Legal:** all art is original. Do not trace, recolor, or pastiche any existing
> game's artwork, board trade dress, piece silhouettes, fonts, or iconography.
> Generic functional motifs (a road, a little house, a die, wheat, a sheep) are
> fine; a specific protected look is not. When unsure, invent.

## 1. Global delivery spec

Applies to every SVG unless an entry overrides it.

- **Format:** plain optimized SVG (run through SVGO). No embedded raster
  (`<image>`), no external fonts (convert any text to paths). No scripts.
- **Coordinate system:** authored on the stated `viewBox`; art must fill it edge
  to edge with the documented safe-area padding. No baked-in `width`/`height` (the
  client sizes via CSS).
- **Color:** where an asset is meant to **tint to the player/seat color**, paint
  those shapes with `fill="currentColor"` (or `stroke="currentColor"`) so the
  client can recolor via CSS `color`. Decorative fixed colors are literal hex.
- **Strokes:** prefer `vector-effect="non-scaling-stroke"` on outlines meant to
  stay crisp at small sizes.
- **Weight:** target < 8 KB per file after SVGO (frames/emotes), < 20 KB for the
  detailed board/piece art.
- **Naming:** exactly the `item_id` plus `.svg`. Variants use a suffix:
  `emote.cheers.svg`, and (if animated later) `emote.cheers.anim.svg`.
- **Deliverable:** one PR (or zip) per slot, plus a single contact sheet PNG per
  slot for quick review.

## 2. Slots, sizes, and counts at a glance

> **Slot status.** The equip slots that exist in code (`cosmetics.Slot`) are
> `dice`, `pieces`, `board`, `color`, `decoration` and `robber`. There is no
> `frame` slot and no `emote` slot, so §4 and §5 below are unbuilt proposals:
> the art has nowhere to be equipped until those slots are added to
> `cosmetics/catalog.go`. Everything else here maps to a real catalog entry.

| Slot | Asset | viewBox | tint? | in catalog? | Count |
|---|---|---|---|---|---|
| frame | ring around a round avatar | `0 0 128 128` | no | ❌ proposal, no slot | 5 |
| emote | square reaction sticker | `0 0 96 96` | no | ❌ proposal, no slot | 5 |
| dice | two-die face set | `0 0 64 64` ×6 faces | optional | ✅ | 2 sets |
| pieces | road/settlement/city set | per-piece (below) | **yes** | ✅ | 4 sets |
| board | hex-tile + frame theme | per-tile (below) | partial | ✅ | 2 sets |
| robber | 3D model, not SVG (§8a) | – | no | ✅ | 7 |
| decoration | role-gated name sparkle | – | no | ✅ | 4 |

Colors are not art; see §9.

## 4. Avatar frames (proposal, no slot yet), `0 0 128 128`

A decorative ring composited **around** a circular avatar. The center must be
fully transparent: avatar art shows through a centered circle of **96 px**
diameter (16 px ring margin all around). Frames are full-color and do **not** tint
to seat color (they're identity, not team). Design so the ring reads at 40 px.

| item_id | Name | Tier | Brief |
|---|---|---|---|
| `frame.laurel` | Laurel | 200 Pips | Two laurel branches meeting at the base. |
| `frame.timber` | Timberframe | 250 Pips | Stylized notched-log ring, warm browns. |
| `frame.cobalt` | Cobalt | 300 Pips | Faceted enamel ring, blues. |
| `frame.gilded` | Gilded | 400 Pips | Ornate gold filigree. |
| `frame.aurora` | Aurora | **supporter-exclusive** | Animated-friendly gradient ribbon (deliver a static layer + a separate gradient-stops layer so it can shimmer in CSS). |

## 5. Victory emotes (proposal, no slot yet), `0 0 96 96`

Square reaction stickers shown on the post-game / in a reaction tray. Full color,
bold silhouette, readable at 48 px. Center the subject with ~8 px safe padding.
Build each on **2–4 grouped layers** (`<g id="...">`) so a later pass can animate
them in CSS without a redraw.

| item_id | Name | Tier | Brief |
|---|---|---|---|
| `emote.cheers` | Cheers | 100 Pips | Two mugs clinking. |
| `emote.facepalm` | Facepalm | 150 Pips | A generic round character, palm to face. |
| `emote.dice-kiss` | Lucky Kiss | 200 Pips | A hand blowing a kiss to a die (generic pip die, not branded). |
| `emote.robber-wink` | Robber Wink | 250 Pips | A masked-bandit face winking (generic, original design). |
| `emote.crown` | Coronation | **supporter-exclusive** | A crown descending with sparkle layer. |

## 6. Dice skins (v2), `0 0 64 64`, six faces each

A **die face set**: deliver faces 1–6 as `dice.<name>.1.svg` … `.6.svg` on a
`0 0 64 64` grid, plus a `dice.<name>.svg` contact tile showing all six. The pip
layout must match standard dice (so a 6 is unambiguous). Pips may use
`currentColor` if you want them to pick up an accent; the die body is fixed color.
Visual only: these never touch the provably-fair dice logic.

| item_id | Name | Tier | Brief |
|---|---|---|---|
| `dice.bone` | Bone Dice | 300 Pips | Aged ivory body, carved pips. |
| `dice.gem` | Gem Dice | 500 Pips | Translucent faceted body, glow pips. |

## 7. Piece skin sets (v2), tinted to seat color

A coordinated set of the three build pieces. **All three tint to the player's seat
color** via `currentColor` for the main body, with fixed-color detailing allowed.
Deliver one SVG per piece; keep silhouettes distinct at 24 px (the board renders
them small).

| Piece | file | viewBox | Notes |
|---|---|---|---|
| Road | `pieces.<name>.road.svg` | `0 0 48 16` | Horizontal bar motif; tiles/rotates on edges. |
| Settlement | `pieces.<name>.settlement.svg` | `0 0 32 32` | Small house silhouette (generic, original design). |
| City | `pieces.<name>.city.svg` | `0 0 40 32` | Larger structure, clearly a step up from settlement. |

Sets: `pieces.driftwood` (600 Pips, weathered-plank look), `pieces.obsidian`
(800 Pips, sleek black-glass with seat-color edge glow).

## 8. Board / tile themes (v2)

A full reskin of the hex tiles and board frame. The biggest job; scope last.

- **Six resource tiles** + **sea** + **desert**, each a pointy-top hex on
  `0 0 100 116` (matches the engine's pointy-top geometry; art bleeds 4 px past the
  hex edge for seamless tiling). Files: `board.<name>.wood.svg`, `.brick.svg`,
  `.sheep.svg`, `.wheat.svg`, `.ore.svg`, `.gold.svg`, `.desert.svg`, `.sea.svg`.
- **Number token** background: `board.<name>.token.svg` (`0 0 48 48`), with the
  number/pips drawn by the client; supply only the disc/frame.
- The tile resource icon may use `currentColor` for a subtle accent but should be
  legible on its own.

Sets: `board.parchment` (600 Pips, hand-drawn map aesthetic), `board.aurora`
(1000 Pips, luminous night-palette).

## 8a. Robber models (3D, `robber.*`)

The first art-backed slot to ship. Seven designs and two chromas,
**350–2400 Pips**: Brigand 350 and Sentinel 400 are the entry pair, the other
five run three to five times that, and the crystal's two extra colourways sit
at the crystal's own 2400. The stock robber is free and is not a catalog row at
all (`robber_skin: ""`).

A chroma ships no art: it names its design's glb and carries three linear RGB
colours in `frontend/src/lib/robbers.ts`, applied at load. A colourway that
needs its own mesh is a design, not a chroma.

Unlike everything else in this document these are **glb models, not SVGs**, and
they are the only cosmetic drawn on the board. What the table sees is the skin of
whoever most recently moved the robber (see `docs/cosmetics.md` §4.5).

**Deliverable per skin (all four required):**

| Thing | Where |
|---|---|
| Model | `frontend/public/models/robbers/<name>.glb`, nodes prefixed `Robber_`, material `Mat_Robber` |
| Store tile | `frontend/public/cosmetics/robbers/<name>.webp`, 256×340 |
| Client registry | an entry in `frontend/src/lib/robbers.ts` |
| Catalog row | `{ID: "robber.<name>", Slot: SlotRobber, …}` in `cosmetics/catalog.go` |

`frontend/src/lib/robbers.assets.test.ts` fails if any of the four is missing, and
also measures the shipped glb: a skin must sit inside the stock robber's envelope
(**1.5 tall × 0.9 across**, ±10%), because `flip.ts`'s lift and `markerMotion`'s
travel bounds are computed from those numbers: a taller robber clips through the
tile it turns over and a wider one overhangs the number chip.

The seven shipping today are built by `tools/robbers/export_skins.py` from the
lathe profiles in `tools/blender/robber_designs.py`, without Blender (the
profiles are pure Python and `robber_kit` is arithmetic). A design hand-modelled
in `art/pieces.blend` instead would go through `export_assets.py` with an entry
per skin (`"robbers/<name>.glb": ["Robber_"]`).

Authoring notes: centred on its own origin with no authored yaw (`anchors.py`
already exempts the robber, and `planRobber` places it at the tile centre);
budget ~150 KB per file (the seven shipping run 10–23 KB).

**No baked tiles.** The store draws these live: one WebGL context for the page,
a still rendered per card on the client, and the model turning in whichever card
is hovered (`components/CosmeticGallery.tsx`). A robber is bought for its
silhouette, which a single fixed photograph shows poorly. A client with no WebGL
sees a chroma's three slot colours instead.

## 9. Colors (no art needed)

The palette is data, not SVG: the client renders a swatch from the hex.
**No deliverable here** unless we later want decorative "foil" overlays for
supporter colors (a separate, optional ask).

The palette is the **4-level RGB cube**: every color's R, G, and B is one of
`0x00 0x55 0xAA 0xFF` (0, 85, 170, 255), giving exactly **4³ = 64** colors. Ten are
free; the other 54 are supporter-unlocked.

**Free (10), the named cube colors:** Black `#000000`, White `#ffffff`,
Red `#ff0000`, Orange `#ffaa00`, Yellow `#ffff00`, Green `#00ff00`,
Cyan `#00ffff`, Blue `#0000ff`, Purple `#aa00ff`, Magenta `#ff00ff`.

**Supporter (54):** the remaining cube colors, all other `#RRGGBB` where each of
RR, GG, BB ∈ {`00`, `55`, `aa`, `ff`}. Their ids are `color.<hex>` (e.g.
`color.0055aa`).

## 10. Build order (recommended)

The frames (5) and emotes (5) in §4/§5 cannot be sold today: neither has an
equip slot. Add `SlotFrame`/`SlotEmote` to `cosmetics/catalog.go` first, or
build against the slots that exist:

1. **Dice** (2 sets) and **pieces** (4 sets): real catalog entries today.
2. **Board** (2 sets): the biggest job, scope last.
3. **Frames** (5) and **emotes** (5): once the slots land.

Colors ship free with the backend and need no art; robbers are glb models, not
SVGs (§8a), and seven already ship.
