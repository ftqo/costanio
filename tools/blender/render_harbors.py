"""Photograph the Explorers harbour quay beside the buildings it has to sit next to.

    # the hero: the quay beside a stock settlement and beside a classic city
    blender --background --factory-startup --python tools/blender/render_harbors.py \
        -- hero art/prototypes/harbor

    # the board, through the game's camera, once per shipped piece set
    blender art/board.blend --background --python tools/blender/render_harbors.py \
        -- board art/prototypes/harbor

Both modes load the shipped .glb, not the blend, so items are in their
exported pose (anchor applied, composition yaw cancelled) and no copy of
`anchors.py`'s rules is needed. Run `make export-assets` first if the art has
moved.

Every frame draws the quay beside buildings from a real piece set, to check
it reads as a harbour next to each and clears a city (29% larger than a
settlement). The board mode renders the same shore once per set
(`pieces.glb`, `pieces/classic.glb`, `pieces/cyclades.glb`) from one camera.

The board rig is the game's, shared with `render_knight_sword.py` and
`render_docks.py`: 32 degrees of vertical FOV and 56 degrees of elevation,
where verticals draw at 56% of their length.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(REPO, "frontend", "public", "models")

# --- the shipping rig -------------------------------------------------------

FOV_DEG = 32.0
ELEVATION_DEG = 56.0

#: `SURFACE.gutter`: the gap fill's top face, where a vertex piece stands.
GUTTER_Z = 0.22

#: Drawn sizes, from `frontend/src/lib/board3d/pieceArt.ts`. The quay and its
#: cargo take the settlement's factor; the city's is 29% larger, which the
#: quay's stand-off distance must clear.
SETTLEMENT_SCALE = 2.0
CITY_SCALE = 2.58
SHIP_SCALE = 1.15

#: The cargo slot, from `tools/blender/gen/harbors.py`. In the quay's own local
#: frame, before its placement and scale.
BASIN = (0.71, 0.0, 0.06)
#: Half the gap between two crew standing abreast in it.
CREW_HALF = 0.085

#: Every shipped piece set, as (label, file), restated from
#: `frontend/src/lib/pieceSets.ts`.
SETS = (
    ("stock", "pieces.glb"),
    ("classic", "pieces/classic.glb"),
    ("cyclades", "pieces/cyclades.glb"),
)

# --- the board ------------------------------------------------------------
#
# `art/board.blend` is the linked assembly of the per-tile files (`make board`),
# laid out on the lattice. LHEX is `lattice.LATTICE_SIZE`, restated so this
# script needs nothing but bpy.
LHEX = 3.0 + 0.25 / math.sqrt(3.0)
LCOL = LHEX * math.sqrt(3.0)  # centre to centre in +x
LROW = LHEX * 1.5  # centre to centre in +y

#: `Hex_Fields` on the showcase board. Its eastern neighbour is `Hex_Port` and
#: its north-eastern one `Hex_Shore`; the vertices they share have land behind
#: and open water in front, as a harbour needs.
FIELDS = (LCOL / 2.0, LROW)

#: The northern of that pair, shared by Fields, Port and Shore. Gets the set's
#: settlement and a quay.
NORTH_AT = (FIELDS[0] + LCOL / 2.0, FIELDS[1] + LHEX / 2.0)
#: The southern one, on the same shore. Gets the set's city (the larger
#: building) and a quay.
SOUTH_AT = (NORTH_AT[0], NORTH_AT[1] - LHEX)
#: The edge between them; a route ship spans it.
SHIP_AT = (NORTH_AT[0], (NORTH_AT[1] + SOUTH_AT[1]) / 2.0)

#: The quay is authored along +x, and the water at these vertices lies 30
#: degrees off it, straight away from the land the buildings stand on.
HARBOR_YAW = math.radians(30.0)
#: The edge the ship spans runs north-south, so the hull turns onto it.
SHIP_YAW = math.radians(90.0)

#: One camera for all three set frames. Framed on the shore so both harbours,
#: a hex apart, are in view.
BOARD_DIST = 11.5
BOARD_AZ = -54.0


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) < 2 or argv[0] not in {"hero", "board"}:
        raise SystemExit("usage: ... -- (hero|board) OUTDIR")
    os.makedirs(argv[1], exist_ok=True)
    return argv[0], argv[1]


def _import(glb, prefixes):
    """Import a shipped .glb and hand back its objects, unparented and flat.

    The importer wraps a file in a scene empty and carries the Y-up-to-Z-up
    conversion on it, so the parents come off with the transform kept, leaving
    the exporter's pose in Blender's axes.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, glb))
    made = [o for o in bpy.data.objects if o not in before]
    for obj in made:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
    out = [o for o in made if o.type == "MESH" and o.name.startswith(tuple(prefixes))]
    for obj in made:
        if obj not in out:
            bpy.data.objects.remove(obj, do_unlink=True)
    if not out:
        raise SystemExit(f"{glb} has nothing named {prefixes}")
    for obj in out:
        obj.hide_render = True
    return out


def _base(objs):
    """The lowest z of a group, in world space.

    Not a constant: `pieces.glb` starts at 0.25 (modelled on the showcase
    board), while sets authored in their own files start at 0.
    """
    return min((o.matrix_world @ v.co).z for o in objs for v in o.data.vertices)


def _clone(objs, at, into):
    """A copy of `objs` with `at` applied on top of each one's own pose."""
    for obj in objs:
        copy = obj.copy()
        copy.data = obj.data
        # `obj.copy()` copies `hide_render` too, and the originals are hidden,
        # so unhide the copy.
        copy.hide_render = False
        bpy.context.scene.collection.objects.link(copy)
        copy.matrix_world = at @ obj.matrix_world
        into.append(copy)
    return into


def _piece(x, y, yaw, scale, base_z=0.0):
    """The placement matrix `seatY` + `edgeRotationY` produce, as a matrix."""
    z = GUTTER_Z - scale * base_z
    return (
        Matrix.Translation((x, y, z))
        @ Matrix.Rotation(yaw, 4, "Z")
        @ Matrix.Diagonal((scale, scale, scale, 1.0))
    )


def _light(scene, sky):
    for obj in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(obj, do_unlink=True)
    for name, energy, euler in (
        ("Sun", 4.0, (48.0, 0.0, -35.0)),
        ("Fill", 1.4, (65.0, 0.0, 150.0)),
    ):
        data = bpy.data.lights.new(name, type="SUN")
        data.energy = energy
        data.angle = math.radians(6)
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.rotation_euler = tuple(math.radians(d) for d in euler)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = sky
    bg.inputs[1].default_value = 0.7


def _shoot(path, target, dist, azimuth_deg, elevation_deg=ELEVATION_DEG):
    scene = bpy.context.scene
    data = bpy.data.cameras.new("Cam")
    data.sensor_fit = "VERTICAL"
    data.angle_y = math.radians(FOV_DEG)
    cam = bpy.data.objects.new("Cam", data)
    scene.collection.objects.link(cam)
    az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
    cam.location = Vector(target) + Vector(
        (
            math.cos(el) * math.cos(az) * dist,
            math.cos(el) * math.sin(az) * dist,
            math.sin(el) * dist,
        )
    )
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    print("WROTE", path)


def _load_harbor():
    """The three items of harbors.glb, each as its own list of parts."""
    parts = _import("harbors.glb", ("Harbor_", "Settler_", "Crew_"))

    def of(prefix):
        return [o for o in parts if o.name.startswith(prefix)]

    return of("Harbor_"), of("Settler_"), of("Crew_")


def _loaded_quay(quay, cargo, at, spots, into):
    """A quay placed at `at`, with a copy of `cargo` at each basin `spot`."""
    _clone(quay, at, into)
    for dx, dy in spots:
        slot = at @ Matrix.Translation((BASIN[0] + dx, BASIN[1] + dy, BASIN[2]))
        _clone(cargo, slot, into)
    return into


# --------------------------------------------------------------------------


def hero(out):
    """The quay on neutral grey, beside the two buildings that bound it.

    Top: a stock settlement, the piece the quay is drawn at the same scale as.
    Bottom: a classic city, drawn at 2.58, whose silhouette shows the gap
    clearly. Both basins loaded with a settler. 1024 square, PNG, for the
    review gallery.
    """
    scene = bpy.context.scene
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    quay, settler, _crew = _load_harbor()
    stock = _import("pieces.glb", ("Settlement_A",))
    classic = _import("pieces/classic.glb", ("City_A",))

    made = []
    # Far enough apart to read as two waterfronts, close enough to compare.
    gap = 3.6
    for y, building, scale in ((gap / 2.0, stock, SETTLEMENT_SCALE), (-gap / 2.0, classic, CITY_SCALE)):
        _clone(building, _piece(0.0, y, 0.0, scale, _base(building)), made)
        _loaded_quay(quay, settler, _piece(0.0, y, 0.0, SETTLEMENT_SCALE), [(0, 0)], made)

    ground = bpy.data.meshes.new("Ground")
    ground.from_pydata(
        [(-12, -12, GUTTER_Z), (12, -12, GUTTER_Z), (12, 12, GUTTER_Z), (-12, 12, GUTTER_Z)],
        [],
        [(0, 1, 2, 3)],
    )
    mat = bpy.data.materials.new("Mat_Hero_ground")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
        0.32,
        0.32,
        0.33,
        1.0,
    )
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    ground.materials.append(mat)
    for poly in ground.polygons:
        poly.use_smooth = False
    scene.collection.objects.link(bpy.data.objects.new("Ground", ground))

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    # 8-bit RGB and full compression; the default is far larger.
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = "Standard"
    _light(scene, (0.30, 0.30, 0.31, 1.0))
    # A three-quarter studio view rather than the board's 56 degrees, to see
    # the gap and the cargo. The board frames cover the game's elevation.
    _shoot(os.path.join(out, "hero"), (0.34, 0.0, 0.42), 9.8, -52.0, 30.0)


def board(out):
    """The same shore, once per shipped piece set, through the game's camera."""
    scene = bpy.context.scene
    quay, settler, crew = _load_harbor()
    ship = _import("ships.glb", ("Ship_route",))

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 740
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    _light(scene, (0.28, 0.36, 0.46, 1.0))

    target = (SHIP_AT[0] + 1.15, SHIP_AT[1] + 0.25, GUTTER_Z + 0.50)
    for label, glb in SETS:
        buildings = _import(glb, ("Settlement_A", "City_A"))
        settlement = [o for o in buildings if o.name.startswith("Settlement_A")]
        city = [o for o in buildings if o.name.startswith("City_A")]

        made = []
        # North: this set's settlement, with a quay carrying one settler.
        _clone(settlement, _piece(*NORTH_AT, 0.0, SETTLEMENT_SCALE, _base(settlement)), made)
        _loaded_quay(
            quay, settler, _piece(*NORTH_AT, HARBOR_YAW, SETTLEMENT_SCALE), [(0, 0)], made
        )
        # South: this set's city, on the same quay, carrying two crew.
        _clone(city, _piece(*SOUTH_AT, 0.0, CITY_SCALE, _base(city)), made)
        _loaded_quay(
            quay,
            crew,
            _piece(*SOUTH_AT, HARBOR_YAW, SETTLEMENT_SCALE),
            [(0, CREW_HALF), (0, -CREW_HALF)],
            made,
        )
        _clone(ship, _piece(*SHIP_AT, SHIP_YAW, SHIP_SCALE), made)

        _shoot(os.path.join(out, f"shore_{label}"), target, BOARD_DIST, BOARD_AZ)

        for obj in made + buildings:
            bpy.data.objects.remove(obj, do_unlink=True)


def main():
    mode, out = _args()
    (hero if mode == "hero" else board)(out)


main()
