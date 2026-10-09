"""Export every authored blend under art/ to .glb + manifest + palette.

    blender --background --factory-startup --python tools/blender/export_assets.py
    blender --background --factory-startup --python tools/blender/export_assets.py -- pieces chips

Writes:
  frontend/public/models/tiles/<resource>.glb   one file per terrain
  frontend/public/models/<family>.glb           chips, pieces, docks, ...
  frontend/public/models/palette.json           write-once, see spec
  frontend/src/lib/board3d/manifest.generated.ts

One blend, one asset: each shipped .glb is authored in the file named after it
(`art/pieces.blend` -> `pieces.glb`, `art/hexes/pasture.blend` ->
`tiles/sheep.glb`). This script opens each in turn.

Families named after `--` are re-exported alone (for the live watcher), which
skips the manifest and the palette: both describe the whole pipeline.

Tiles ship as named meshes, not one joined mesh: bpy.ops.object.join reorders
and dedupes material slots, which palette.json depends on. Merging by material
is the loader's job. Never bake colour into vertex colours, for the same reason.
"""

import json
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anchors  # noqa: E402
import assetmeta  # noqa: E402
import naming  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ART = os.path.join(REPO, "art")
HEXES = os.path.join(ART, "hexes")
# Culture piece sets: one blend per set, like art/hexes/. The stock set stays
# at `art/pieces.blend` and ships as `pieces.glb`.
PIECE_SETS = os.path.join(ART, "pieces")
MODELS = os.path.join(REPO, "frontend", "public", "models")
TILES = os.path.join(MODELS, "tiles")


def hex_blend(terrain):
    """The blend a terrain's tile is authored in."""
    return os.path.join(HEXES, f"{terrain.lower()}.blend")


def family_blend(family):
    """The blend a family is authored in."""
    return os.path.join(ART, f"{family}.blend")


#: How a piece set is named after `--`, and in `git status`: `pieces/cyclades`.
PIECE_SET_MARK = "pieces/"

# What a set ships. Not the robber: it belongs to nobody, and its one home is
# `pieces.glb`.
PIECE_SET_PREFIXES = ["Settlement_A", "City_A", "Road_A", "Road_B"]


def piece_set_blend(name):
    """The blend a culture piece set is authored in."""
    return os.path.join(PIECE_SETS, f"{name}.blend")


def piece_sets():
    """Every culture set on disk, in a stable order."""
    if not os.path.isdir(PIECE_SETS):
        return []
    return sorted(
        f[: -len(".blend")] for f in os.listdir(PIECE_SETS) if f.endswith(".blend")
    )

# Children parented to a hex that are not part of the tile. The blend parents
# staged chips and the robber onto whichever hex they sit on (Chip_05_1_body ->
# Hex_Pasture, Robber_body -> Hex_Desert), and beach strips onto their water
# hex. They ship separately and must not be merged into the tile.
TILE_CHILD_EXCLUDE = (
    "Chip_",
    "Beach_",
    "Connector_",
    "Robber_",
    # The per-resource trading posts are authored on the dock but ship apart:
    # one sea_port tile, five trades.
    "Dock_",
    # The ratio signs likewise: six are authored on the one port tile.
    "Hwedge_",
    anchors.REFERENCE_PREFIX,
)


def is_tile_child(name):
    return not name.startswith(TILE_CHILD_EXCLUDE)


def ensure_object_mode():
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def clear_selection():
    ensure_object_mode()
    for obj in bpy.context.selected_objects:
        obj.select_set(False)


def make_selectable(obj):
    """A hidden or unselectable object cannot be exported via use_selection."""
    obj.hide_set(False)
    obj.hide_select = False
    obj.hide_viewport = False


def descendants(obj):
    """obj plus every child, recursively."""
    out = [obj]
    for child in obj.children:
        out.extend(descendants(child))
    return out


def apply_modifiers(obj):
    """Apply BEVEL and friends so the exported mesh is final geometry."""
    if obj.type != "MESH" or not obj.modifiers:
        return
    # Chip bodies share one mesh datablock, and Blender will not apply a
    # modifier to multi-user data, so give each object its own copy first.
    if obj.data.users > 1:
        obj.data = obj.data.copy()
    ensure_object_mode()
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except RuntimeError as err:
            print("WARN modifier", obj.name, mod.name, err)


def to_mesh(obj):
    """Convert FONT (and other convertibles) to MESH in place."""
    if obj.type == "MESH":
        return
    clear_selection()
    make_selectable(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.convert(target="MESH")
    except RuntimeError as err:
        print("WARN convert", obj.name, err)


def parent_names():
    """name -> parent name for every object in the blend."""
    return {o.name: (o.parent.name if o.parent else None) for o in bpy.data.objects}


def is_hex_name(name):
    return naming.hex_terrain(name) is not None


def anchor_of(root, parents, staged=True):
    """World XY the item is moved onto, and where to set it down afterwards."""
    rule = anchors.rule_for(root.name, staged)
    if rule == anchors.ROOT:
        t = root.matrix_world.translation
        return (t.x, t.y), (0.0, 0.0)
    if rule == anchors.HEX_PARENT:
        name = anchors.hex_ancestor(root.name, parents, is_hex_name)
        if name is None:
            raise SystemExit(f"ANCHOR {root.name} wants a Hex_* parent and has none")
        t = bpy.data.objects[name].matrix_world.translation
        return (t.x, t.y), (0.0, 0.0)
    return rule, (0.0, 0.0)


def unscale_of(root_name, parents):
    """Matrix that divides out a water tile's lattice-cell scale, if any.

    Identity for everything on land and everything off the board. See
    `anchors.scale_cancel_for` for why the water is authored enlarged.
    """
    hexname = anchors.hex_ancestor(root_name, parents, is_hex_name)
    if hexname is None:
        return Matrix.Identity(4)
    cancel = anchors.scale_cancel_for(naming.hex_terrain(hexname))
    if cancel == 1.0:
        return Matrix.Identity(4)
    pivot = bpy.data.objects[hexname].matrix_world.translation.copy()
    return Matrix.Translation(pivot) @ Matrix.Scale(cancel, 4) @ Matrix.Translation(-pivot)


def item_xy_center(objs):
    """XY centre of the world bounding box of `objs`, ignoring non-meshes."""
    pts = [obj.matrix_world @ Vector(c) for obj in objs if obj.type == "MESH" for c in obj.bound_box]
    if not pts:
        return None
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)


def recenter(objects, staged=True):
    """Move every item in `objects` onto the origin. Returns undo state.

    Otherwise each family exports at its showcase position and the renderer
    adds its placement on top. See anchors.py.
    """
    parents = parent_names()
    by_name = {o.name: o for o in objects}
    members = {}
    for obj in objects:
        root = obj.name
        while parents.get(root) in by_name:
            root = parents[root]
        members.setdefault(root, []).append(obj)

    saved = [(o, o.matrix_basis.copy()) for o in objects]
    # Resolve every anchor before moving anything: an anchor may be read off
    # another object, and a half-applied pass would read a moved one.
    moves = {}
    for root_name in anchors.roots(parents, [o.name for o in objects]):
        root = by_name[root_name]
        (ax, ay), (px, py) = anchor_of(root, parents, staged)
        angle = anchors.turn_for(root_name, staged)
        if anchors.is_upright(root_name):
            angle -= root.matrix_world.to_euler("XYZ").z
        # Undo the water tiles' lattice-cell scale, then subtract the anchor,
        # turn to the reference pose, and set the item down.
        #
        # The scale is undone about the hex's own origin, the point it was
        # scaled about; undoing it about the world origin would also scale the
        # tile's heights.
        moves[root_name] = (
            Matrix.Translation(Vector((px, py, 0.0)))
            @ Matrix.Rotation(angle, 4, "Z")
            @ Matrix.Translation(Vector((-ax, -ay, 0.0)))
            @ unscale_of(root_name, parents)
        )
    for root_name, move in moves.items():
        root = by_name[root_name]
        root.matrix_world = move @ root.matrix_world
    bpy.context.view_layer.update()

    for root_name in moves:
        center = item_xy_center(members[root_name])
        if center is None:
            continue
        if max(abs(center[0]), abs(center[1])) > anchors.MAX_RESIDUAL:
            raise SystemExit(
                f"ANCHOR {root_name} still {center[0]:.3f},{center[1]:.3f} from the origin "
                f"after recentring -- its anchor rule is wrong"
            )
    return saved


def restore(saved):
    for obj, basis in saved:
        obj.matrix_basis = basis
    bpy.context.view_layer.update()


#: Every material name that actually appears in a shipped .glb, accumulated as
#: the files are written. See `write_palette` for why the palette needs it.
EMITTED_MATERIALS = set()


def materials_in_glb(path):
    """The material names inside a written .glb.

    Read from the file rather than the Blender objects: a material can be in
    `bpy.data.materials` without any exported object using it.
    """
    with open(path, "rb") as handle:
        handle.seek(12)
        length = int.from_bytes(handle.read(4), "little")
        handle.seek(20)
        doc = json.loads(handle.read(length).decode("utf-8"))
    return {m["name"] for m in doc.get("materials", []) if "name" in m}


def export_glb(objects, path, staged=True):
    """Export exactly `objects` (and nothing else) to `path`, item-centred.

    `staged=False` says the art was authored at the origin and square, so the
    showcase board's anchor and yaw corrections do not apply. See anchors.py.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    clear_selection()
    for obj in objects:
        make_selectable(obj)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    saved = recenter(objects, staged)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        # Nothing is textured (every material is a flat Principled colour), so
        # UV sets are dropped. They would also block `mergeGeometries`, which
        # needs matching attributes, and split one draw call into one per part.
        export_texcoords=False,
    )
    # Strip the exporter's signature here so a fresh export is byte-identical
    # to the committed file (verify-split compares them).
    assetmeta.strip_path(path)
    EMITTED_MATERIALS.update(materials_in_glb(path))
    # The blend is a showcase and later exports read anchors off it, so put
    # every object back where the artist left it.
    restore(saved)


def export_tiles():
    """One .glb per terrain: the hex, its props merged in, and its socket."""
    written = {}
    for obj in list(bpy.data.objects):
        terrain = naming.hex_terrain(obj.name)
        if terrain is None:
            continue
        group = [o for o in descendants(obj) if is_tile_child(o.name)]
        meshes = [o for o in group if o.type in {"MESH", "FONT"}]
        sockets = [o for o in group if naming.socket_terrain(o.name)]
        for mesh in meshes:
            to_mesh(mesh)
            apply_modifiers(mesh)
        resource = naming.TERRAIN_TO_RESOURCE[terrain]
        path = os.path.join(TILES, f"{resource}.glb")
        export_glb(meshes + sockets, path)
        written[resource] = {
            "terrain": terrain,
            "meshes": len(meshes),
            "sockets": [s.name for s in sockets],
        }
        print("TILE", resource, len(meshes), "meshes")
    return written


# Objects excluded from every export: the six pre-colored duplicate sets (they
# cannot cover 10 seats and do not match the frontend palette), the viewport-
# only mirror geometry (see anchors.is_reference), plus the scene's own camera
# and light.
def is_excluded(name):
    return (
        name.startswith("Player_")
        or anchors.is_reference(name)
        or name in {"Camera", "Light"}
    )


def export_chips():
    """All number chips in one file, one node group per (number, variant)."""
    groups = {}
    for obj in list(bpy.data.objects):
        parsed = naming.parse_chip(obj.name)
        if parsed is None:
            continue
        number, variant, _part = parsed
        groups.setdefault((number, variant), []).append(obj)

    exported = []
    for (number, variant), objs in sorted(groups.items()):
        for obj in objs:
            to_mesh(obj)
            apply_modifiers(obj)
        exported.extend(objs)
        print("CHIP", number, variant, len(objs), "parts")

    blank = [o for o in bpy.data.objects if o.name.startswith("Chip_blank")]
    for obj in blank:
        to_mesh(obj)
        apply_modifiers(obj)
    exported.extend(blank)

    export_glb(exported, os.path.join(MODELS, "chips.glb"))

    # Variant count per number, counted: 2 and 12 have only one variant.
    variants = {}
    for number, variant in groups:
        variants[number] = max(variants.get(number, 0), variant)
    return variants


def export_group(prefixes, filename, staged=True):
    """Export every object whose name starts with any of `prefixes`."""
    objs = [
        o
        for o in bpy.data.objects
        if not is_excluded(o.name) and any(o.name.startswith(p) for p in prefixes)
    ]
    if not objs:
        print("WARN empty group", filename)
        return []
    for obj in objs:
        to_mesh(obj)
        apply_modifiers(obj)
    export_glb(objs, os.path.join(MODELS, filename), staged)
    print("GROUP", filename, len(objs), "objects")
    return [o.name for o in objs]


def export_piece_set(name):
    """One culture set: `art/pieces/<set>.blend` -> `models/pieces/<set>.glb`.

    Same object names as the stock set (everything subsets by the prefixes in
    `pieceArt.PIECE_PREFIX`), but authored at the origin and square, hence
    `staged=False`. See anchors.py.
    """
    written = export_group(
        PIECE_SET_PREFIXES, os.path.join("pieces", f"{name}.glb"), staged=False
    )
    print("PIECE_SET", name, len(written), "objects")
    return written


MANIFEST = os.path.join(REPO, "frontend", "src", "lib", "board3d", "manifest.generated.ts")
PALETTE = os.path.join(MODELS, "palette.json")

# Resources the engine defines but the blend has no art for. The loader
# substitutes the mapped tile. See engine/board/resource_json.go:12-21.
RESOURCE_FALLBACK = {"fog": "sea"}


def socket_local(terrain):
    """Local-space offset of a terrain's chip socket, or None."""
    hexobj = bpy.data.objects.get(f"Hex_{terrain}")
    token = bpy.data.objects.get(f"Token_{terrain}")
    if hexobj is None or token is None:
        return None
    delta = token.matrix_world.translation - hexobj.matrix_world.translation
    # Blender is Z-up, glTF/three.js is Y-up: (x, y, z) -> (x, z, -y).
    return [round(delta.x, 4), round(delta.z, 4), round(-delta.y, 4)]


#: Standing slots a tile carries for pieces placed ON it rather than on its
#: corners or edges: `LairSlot_<n>` on the goldfield (crews storming its lair)
#: and `FarmSlot_<n>` on the spice farm (each seat's landed crew). Plain empties
#: parented to the hex, z at the figure's base height. They do not ship as
#: geometry; the manifest carries them in the socket's frame, in slot order,
#: for `layers/explorers.ts`.
SLOT_PREFIXES = ("LairSlot_", "FarmSlot_")


def slots_local(terrain):
    """Local-space slot positions of a terrain, in slot order, or None."""
    hexobj = bpy.data.objects.get(f"Hex_{terrain}")
    if hexobj is None:
        return None
    found = []
    for obj in descendants(hexobj):
        for prefix in SLOT_PREFIXES:
            if obj.name.startswith(prefix) and obj.name[len(prefix) :].isdigit():
                found.append((int(obj.name[len(prefix) :]), obj))
    if not found:
        return None
    found.sort()
    base = hexobj.matrix_world.translation
    out = []
    for _, obj in found:
        delta = obj.matrix_world.translation - base
        out.append([round(delta.x, 4), round(delta.z, 4), round(-delta.y, 4)])
    return out


def write_manifest(sockets, numbers, materials, slots=None):
    """`sockets` is resource -> socket offset, `materials` every material name."""
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    entries = {}
    for resource, socket in sorted(sockets.items()):
        entries[resource] = {
            "resource": resource,
            "file": f"tiles/{resource}.glb",
            "socket": socket,
        }
        if slots and slots.get(resource):
            entries[resource]["slots"] = slots[resource]
    chips = [{"number": n, "variants": v} for n, v in sorted(numbers.items())]
    tint_slots = sorted(m for m in materials if naming.is_tint_material(m))
    body = f"""// GENERATED by tools/blender/export_assets.py -- do not edit.
// Re-run `make export-assets` after changing anything under art/.
import {{ COMPOSED_TILES }} from "./manifest.composed.generated";

export interface TileEntry {{
  resource: string;
  file: string;
  socket: [number, number, number] | null;
  /**
   * Standing slots on the tile, in slot order and in the socket's frame
   * (`LairSlot_<n>` / `FarmSlot_<n>` empties, see SLOT_PREFIXES in the
   * exporter). Absent on every tile that has none.
   */
  slots?: [number, number, number][];
}}

export interface ChipEntry {{
  number: number;
  variants: number;
}}

/** Hex circumradius in blend units. */
export const HEX_SIZE = 3.0;

/** The tiles exported from a blend under art/hexes/. */
const EXPORTED_TILES: Record<string, TileEntry> = {json.dumps(entries, indent=2)};

/**
 * Every tile: the exported ones above, and the recipe-built ones
 * (`make compose-tiles`, art/recipes/), which the composer writes into their
 * own generated file so that neither generator writes the other's.
 */
export const TILES: Record<string, TileEntry> = {{ ...EXPORTED_TILES, ...COMPOSED_TILES }};

export const CHIPS: ChipEntry[] = {json.dumps(chips, indent=2)};

/** Material names the runtime recolors per seat. */
export const TINT_SLOTS = {json.dumps(tint_slots)} as const;

/** Engine resources with no art; render the mapped tile instead. */
export const RESOURCE_FALLBACK: Record<string, string> = {json.dumps(RESOURCE_FALLBACK, indent=2)};
"""
    with open(MANIFEST, "w") as handle:
        handle.write(body)
    print("MANIFEST", MANIFEST)


def palette_of_open_blend():
    """Principled colour/roughness/metalness for every material now loaded."""
    current = {}
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        rgba = bsdf.inputs["Base Color"].default_value
        current[mat.name] = {
            "color": [round(rgba[0], 4), round(rgba[1], 4), round(rgba[2], 4)],
            "roughness": round(bsdf.inputs["Roughness"].default_value, 4),
            "metalness": round(bsdf.inputs["Metallic"].default_value, 4),
        }
    return current


def write_palette(current):
    """Write the default palette once. Never clobber hand edits.

    `current` is the union over every blend in the pipeline, intersected with
    the materials that actually shipped: `palette_of_open_blend` reads
    `bpy.data.materials`, which includes materials no exported object wears.
    `frontend/src/lib/board3d/palette.test.ts` checks the committed file.
    """
    current = {k: v for k, v in current.items() if k in EMITTED_MATERIALS}
    if os.path.exists(PALETTE):
        with open(PALETTE) as handle:
            existing = json.load(handle)
        added = sorted(set(current) - set(existing))
        removed = sorted(set(existing) - set(current))
        if added or removed:
            print("PALETTE_DRIFT added=", added, "removed=", removed)
        else:
            print("PALETTE_UNCHANGED", len(existing), "materials")
        return

    with open(PALETTE, "w") as handle:
        json.dump(current, handle, indent=1, sort_keys=True)
    print("PALETTE_WRITTEN", len(current), "materials")


# family -> the object-name prefixes `art/<family>.blend` ships as
# `<family>.glb`. `chips` is not a prefix export: see `export_chips`.
FAMILIES = {
    "pieces": ["Settlement_A", "City_A", "Road_A", "Road_B", "Robber_"],
    "knights": ["Knight_"],
    "metros": ["Metro_"],
    "ships": ["Ship_"],
    # The ring only: the renderer instances one prefab ring per walled vertex
    # (WALL_PREFIX in frontend/src/lib/board3d/layers/knights.ts).
    "walls": ["Wall_segment_ring"],
    # No "dice" entry: `art/dice.blend` is kept as authored art, but the dice
    # are drawn in code (frontend/src/components/board/Die.tsx). Re-add it only
    # with something that loads it.
    # The card slab, shared by every card face that depicts a card. A deck is
    # the slab instanced at offsets.
    "cards": ["Card_"],
    # The three city-improvement props (book, scales, crown), one per track.
    # Their own file: never on the board, never seat-tinted (Mat_Improve_*),
    # used only by the shop tile, so the board never downloads them.
    "improvements": ["Improve_"],
    # The merchant is a Knights board piece on a land hex.
    "trader": ["Trader_"],
    # A second merchant candidate, `Trader2_*`, that nothing draws. The
    # prefixes do not overlap ("Trader2_" does not start with "Trader_"). See
    # `TRADER_CANDIDATE` in frontend/src/lib/board3d/loader.ts.
    "trader_v2": ["Trader2_"],
    # Caravans. A camel sits on an edge, authored along +x with the edge
    # midpoint at the origin (the road convention `edgeRotationY` expects).
    # Neutral, not seat-tinted.
    #
    # `Raft_` is the punt a camel rides on a sea path (Caravans with Islands),
    # in the camel's frame: deck top at 0.245 under the camel's feet at 0.25,
    # bow along +x. Not `Camel_raft_`, or it would be drawn under every camel.
    "camels": ["Camel_", "Raft_"],
    # Fishermen. The weir marker, authored at the origin. It has a landward
    # face, so the renderer turns it to the ground's bearing
    # (`layers/fishermen.ts`).
    #
    # `Fishground_` is the fishing ground's water overlay (shallows whose rim
    # dips under the waterline, a sand bar, rocks, fins), drawn once per ground
    # at the sea hex centre, scale 1, base at `SURFACE.sea`. The sand bar is on
    # blend +y (glTF -z, the WEIR_FACES convention), the landward side.
    "fishing": ["Weir_", "Fishground_"],
    # Caravans: the waypost pair marking a spoke before its first camel. It
    # takes the camel's slot, so it is authored the same way.
    #
    # Mirror-symmetric in x and z: `edgeRotationY` gives an axis, not a
    # bearing, so a directional cue would point the wrong way on about half
    # the spokes.
    "spokes": ["Spoke_"],
    # One file, five trades; the renderer picks the subset per harbour.
    "docks": ["Dock_"],
    # The ratio signs ship apart from the dock: every harbour draws a sign,
    # only a 2:1 draws a dock.
    "signs": ["Hwedge_"],
    "beach": ["Beach_", "Connector_beach"],
    # Raiders. The mounted rider on a road, authored along +x with the edge
    # midpoint at the origin. Seat-tinted. `Rider_`, because Knights owns
    # `Knight_`. Generated by `tools/blender/gen/riders.py`; do not model in
    # the blend.
    "riders": ["Rider_"],
    # Wagons. A player-owned vertex piece, so only `Seat_*` slots. Authored at
    # the origin facing +x, base at z = 0 (ROOT, no AUTHORED_TURN).
    # `art/wagons.blend` is generated by `tools/blender/gen/wagons.py`.
    "wagons": ["Wagon_"],
    # Rivers. A bridge is a road across a river: one edge, one owner, authored
    # along +x with the edge midpoint at the origin, seat-tinted. Generated by
    # `tools/blender/gen/bridges.py`; do not model in art/bridges.blend.
    "bridges": ["Bridge_"],
    # Explorers. Two ships, always drawn together: `Cargo_` is an edge piece
    # authored along +x with the edge midpoint at the origin; `Corsair_` is the
    # pirate, a hex-centre piece centred on the origin.
    #
    # Both are seat-tinted: the corsair belongs to the seat that moved it,
    # unlike the Islands pirate and the barbarian ship in ships.glb
    # (`loader.test.ts` pins this). Generated by `tools/blender/gen/vessels.py`.
    "vessels": ["Cargo_", "Corsair_"],
    # Explorers. The harbour quay (`Harbor_`) and the two cargo figures in its
    # basin (`Settler_`, `Crew_`), always drawn together, all seat-tinted. The
    # quay stands beside the player's own building on that vertex and has no
    # house of its own. Generated by `tools/blender/gen/harbors.py`.
    "harbors": ["Harbor_", "Settler_", "Crew_"],
    # Explorers, on the land. `Lair_` is the pirate lair token, a skull rock on
    # dark rubble with a black flag, standing on the goldfield's empty chip
    # socket until the lair falls. `Boarder_` is the crew figure that stands on
    # a hex rather than in a hold: three in a rank beside the lair take it, and
    # the same figure is the crew each seat lands on a spice farm. Seat-tinted
    # (`Seat_*`), authored at the size it is drawn at, front along +x, base at
    # z = 0. Not `Crew_`, which is the hold figure in harbors.glb. Modelled
    # live; there is no generator.
    "lairs": ["Lair_", "Boarder_"],
    # Explorers cargo. `Haul_` (fish haul) and `Spice_` (sack) are neutral;
    # `Marker_` (mission marker) is player-owned and wears `Seat_*`.
    # Generated by `tools/blender/gen/cargo.py`; do not model in the blend.
    "cargo": ["Haul_", "Spice_", "Marker_"],
    # The raider, shared by Raiders (up to three mustering on a coastal hex, and
    # the ones taken prisoner) and Wagons (one blocking a road edge). One
    # figure, two placements, so it ships once from one blend.
    #
    # Modelled live in the blend; there is no generator. Neutral:
    # `Mat_Barbarian_*`, no seat slot. Not `Ship_barbarian`, which is the
    # raiding fleet's marker in ships.glb.
    "barbarians": ["Barbarian_"],
    # Explorers. The cloud-bank kit that the unexplored region is built from:
    # five lobed billows (`Fog_billow_a`..`e`) and three flat floor pads
    # (`Fog_floor_a`..`c`), each one closed mesh, unit radius in plan, its
    # own origin the anchor. `layers/fog.ts` instances them on the placements
    # `planFog` / `planFogFloor` already make (uniform scale = the puff's
    # radius), picking a variant per placement off `fogHash`. Not a tile: no
    # `Hex_*`, no socket. Two materials, `Mat_Fog_cloud` (at or under the
    # mountains' snow, the brightest lit albedo the board ships) and the
    # cooler `Mat_Fog_cloud_belly` on the down-facing facets only.
    "fog": ["Fog_"],
}

#: Every family blend, chips included, in the order they are exported.
ORDER = ["chips"] + list(FAMILIES)


def wanted():
    """Families and piece sets named after `--`, or everything.

    A piece set is named `pieces/<set>` (its path under `art/` without the
    extension), distinct from the family `pieces` (`art/pieces.blend`).
    """
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    names = [a for a in argv if not a.startswith("-")]
    sets = piece_sets()
    unknown = [
        n
        for n in names
        if n not in ORDER
        and not (n.startswith(PIECE_SET_MARK) and n[len(PIECE_SET_MARK) :] in sets)
    ]
    if unknown:
        options = ORDER + [PIECE_SET_MARK + s for s in sets]
        raise SystemExit(f"unknown family {unknown}, expected any of {options}")
    return names


def open_blend(path):
    if not os.path.exists(path):
        raise SystemExit(f"MISSING {os.path.relpath(path, REPO)}")
    bpy.ops.wm.open_mainfile(filepath=path)


def main():
    named = wanted()
    only = [n for n in named if not n.startswith(PIECE_SET_MARK)]
    sets = [n[len(PIECE_SET_MARK) :] for n in named if n.startswith(PIECE_SET_MARK)]
    if not named:
        sets = piece_sets()

    # The palette and tint slots are accumulated across every blend. The first
    # file carrying a material wins; a disagreement between copies is reported,
    # since it means one was restyled alone.
    palette, materials = {}, set()

    def absorb(where):
        for name, entry in palette_of_open_blend().items():
            if name in palette and palette[name] != entry:
                print("PALETTE_CONFLICT", name, "differs in", where)
            palette.setdefault(name, entry)
        materials.update(m.name for m in bpy.data.materials)

    sockets, numbers, slots = {}, {}, {}
    if not only:
        for terrain in sorted(naming.TERRAIN_TO_RESOURCE):
            open_blend(hex_blend(terrain))
            for resource in export_tiles():
                # The socket (where the chip mounts) is read from the tile's
                # own file.
                sockets[resource] = socket_local(terrain)
                slots[resource] = slots_local(terrain)
            absorb(f"hexes/{terrain.lower()}")

    if not named or only:
        for family in only or ORDER:
            open_blend(family_blend(family))
            if family == "chips":
                numbers = export_chips()
            else:
                export_group(FAMILIES[family], f"{family}.glb")
            absorb(family)

    for name in sets:
        open_blend(piece_set_blend(name))
        export_piece_set(name)
        absorb(f"pieces/{name}")

    if named:
        # A subset has seen only its own materials, so it cannot write the
        # palette or the manifest.
        print("PARTIAL", named)
        return

    write_manifest(sockets, numbers, materials, slots)
    write_palette(palette)
    print("TILES_WRITTEN", len(sockets))
    print("CHIP_NUMBERS", sorted(numbers.items()))
    print("GROUPS_WRITTEN", len(FAMILIES))
    print("PIECE_SETS_WRITTEN", len(sets), sets)


# Guarded so the module can be imported (`export_tiles.py` drives
# `export_tiles` one blend at a time). Blender runs `--python` as `__main__`.
if __name__ == "__main__":
    main()
