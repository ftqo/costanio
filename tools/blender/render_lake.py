"""Photograph the lake hex: beside its neighbours, alone, on the board, hero.

Two invocations: some frames need the linked showcase board, and the pairs
need a scene assembled here, since the desert, oasis and lake all sit on cell
(1, 0) in `make board`.

    # the pairs, the tile alone and the hero (no input blend)
    blender --background --factory-startup --python tools/blender/render_lake.py \
        -- art/prototypes/lake [OASIS_BLEND]

    # the tile in its place among real neighbours
    make board
    blender art/board.blend --background --python tools/blender/render_lake.py \
        -- art/prototypes/lake

`OASIS_BLEND` defaults to `art/hexes/oasis.blend`; pass another copy (from
another branch, say) to pair against that instead.

Same rig as `render_oasis.py`, `render_castle.py` and `render_knight_sword.py`:
32 degrees of vertical FOV at 56 degrees of elevation. What is judged here is
depth and the border (5.5cm of bank from 0.245 to 0.190, 6.9cm of rim from
0.290 to 0.2205), which other views misrepresent.

Frames:

  pair_pasture.jpg  the lake beside the pasture, whose ground and rim it wears
  pair_desert.jpg   the lake beside the desert it replaces on a Fishermen board
  pair_oasis.jpg    the lake beside the oasis, the other water-in-a-recess tile
                    (it must not look like this)
  lake_slab_az{0,140}.jpg   the tile alone, two bearings (the names the
                    directory already carries)
  lake_on_board_az{0,140}.jpg   in its place on the showcase board
  hero.png          the tile alone on flat neutral grey at 1024
"""

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lattice  # noqa: E402

FOV_DEG = 32.0
ELEVATION_DEG = 56.0
AZIMUTHS = {"az0": -90.0, "az140": 140.0}

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HEXES = os.path.join(REPO, "art", "hexes")

#: Staged on top of the lake in `make board` and hidden for every board frame.
OVERLAPPING = ("Hex_Desert", "Hex_Oasis")

#: Objects that are staging rather than tile art, exactly as the exporter drops
#: them: number chips, the robber, the generated `Ref_*` mirrors.
NOT_ART = ("Ref_", "Chip_", "Robber_", "Connector_", "Beach_", "Dock_", "Hwedge_")


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if not argv:
        raise SystemExit("usage: ... -- OUTDIR [OASIS_BLEND]")
    os.makedirs(argv[0], exist_ok=True)
    oasis = argv[1] if len(argv) > 1 else os.path.join(HEXES, "oasis.blend")
    return argv[0], oasis


def _light(scene, sky=(0.28, 0.36, 0.46, 1), strength=0.7):
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
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = sky
    bg.inputs[1].default_value = strength


def _shoot(path, target, dist, azimuth_deg):
    scene = bpy.context.scene
    data = bpy.data.cameras.new("Cam")
    data.sensor_fit = "VERTICAL"
    data.angle_y = math.radians(FOV_DEG)
    cam = bpy.data.objects.new("Cam", data)
    scene.collection.objects.link(cam)
    az, el = math.radians(azimuth_deg), math.radians(ELEVATION_DEG)
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


def _root(obj):
    while obj.parent is not None:
        obj = obj.parent
    return obj


# --- assembling a scene from tile blends ------------------------------------


def bring_tile(path, terrain, cell):
    """Append `Hex_<terrain>` and its art from `path`, onto lattice `cell`.

    Appended rather than linked so the three tiles can be moved (a linked
    object's transform belongs to the library).
    """
    root_name = f"Hex_{terrain}"
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = list(src.objects)
    brought = [o for o in bpy.data.objects if o.users_collection == ()]
    scene = bpy.context.scene
    keep = []
    for obj in brought:
        root = _root(obj)
        if root.name != root_name or obj.name.startswith(NOT_ART):
            continue
        scene.collection.objects.link(obj)
        keep.append(obj)
    for obj in brought:
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    root = bpy.data.objects[root_name]
    x, y = lattice.axial_to_xy(*cell)
    root.location = (x, y, 0.0)
    return root


def studio(out, oasis_blend):
    """The pairs, the tile alone, and the hero: a scene built from three blends."""
    scene = bpy.context.scene
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    lake = bring_tile(os.path.join(HEXES, "lake.blend"), "Lake", (0, 0))
    desert = bring_tile(os.path.join(HEXES, "desert.blend"), "Desert", (1, 0))
    oasis = bring_tile(oasis_blend, "Oasis", (0, -1))
    pasture = bring_tile(os.path.join(HEXES, "pasture.blend"), "Pasture", (-1, 1))

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 800
    _light(scene)

    def hide(root, yes):
        for obj in bpy.data.objects:
            if _root(obj) is root:
                obj.hide_render = yes

    # Each pair is aimed at the midpoint of the two tiles, from the bearing
    # that puts them side by side rather than one behind the other.
    neighbours = (desert, oasis, pasture)
    for name, other, az in (
        ("pair_pasture", pasture, 150.0),
        ("pair_desert", desert, -90.0),
        ("pair_oasis", oasis, -30.0),
    ):
        for tile in neighbours:
            hide(tile, tile is not other)
        mid = (lake.location + other.location) / 2.0
        _shoot(os.path.join(out, name), (mid.x, mid.y - 0.4, 0.30), 16.5, az)

    for tile in neighbours:
        hide(tile, True)
    loc = lake.matrix_world.translation
    # The water is south of the tile centre (the chip socket owns the north),
    # so every frame is aimed at the lake rather than at the hex's own middle.
    water = (loc.x, loc.y - 0.55, 0.28)
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 800
    for name, az in AZIMUTHS.items():
        _shoot(os.path.join(out, f"lake_slab_{name}"), water, 11.0, az)

    # The hero: 1024 square, flat neutral grey, three-quarter. RGB at full
    # compression, far smaller than the default.
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 100
    # A dark neutral backdrop; a bright one washes the tile to pastel.
    _light(scene, sky=(0.20, 0.20, 0.21, 1), strength=1.0)
    _shoot(os.path.join(out, "hero"), (loc.x, loc.y - 0.40, 0.34), 10.5, -55.0)


def on_board(out):
    """The tile where it will be drawn, among the neighbours it sits beside."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92
    scene.view_settings.view_transform = "Standard"

    for obj in bpy.data.objects:
        if obj.name.startswith("Ref_"):
            obj.hide_render = True
        if _root(obj).name in OVERLAPPING:
            obj.hide_render = True

    hexobj = bpy.data.objects.get("Hex_Lake")
    if hexobj is None:
        raise SystemExit("no Hex_Lake in this blend -- run `make board` first")
    loc = hexobj.matrix_world.translation
    water = (loc.x, loc.y - 0.55, 0.30)

    scene.render.resolution_x = 1400
    scene.render.resolution_y = 900
    _light(scene)
    for name, az in AZIMUTHS.items():
        _shoot(os.path.join(out, f"lake_on_board_{name}"), water, 13.5, az)


def main():
    out, oasis_blend = _args()
    if bpy.data.filepath:
        on_board(out)
    else:
        studio(out, oasis_blend)


main()
