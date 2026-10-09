"""Photograph the oasis hex: alone, on the board, and as a hero.

    make board
    blender art/board.blend --background --python tools/blender/render_oasis.py \
        -- art/prototypes/oasis

`art/board.blend` is the linked assembly `make board` writes; it must have been
built at least once.

Same rig as `render_castle.py`, `render_docks.py` and `render_knight_sword.py`:
32 degrees of vertical FOV at 56 degrees of elevation. What is judged is depth:
5.5cm of bank between the ground at 0.245 and the water at 0.190.

Four frames plus a hero:

  oasis_slab_az{0,140}.jpg    the tile alone, two bearings
  oasis_on_desert_az{0,140}.jpg   the same tile in its place on the board,
                              among the neighbours it will be drawn beside
  hero.png                    the tile alone on flat neutral grey at 1024

`oasis_board_render.jpg` beside them comes from `frontend/dev/board-shot.mjs` (the
three.js renderer), run with `frontend/dev/board-shots.tsx` temporarily given a
Caravans view, which shows `palette.json`'s colours and the gutter sand. That
patch is not committed.

The desert and the lake are hidden for the board frames: all three are staged
on cell (1, 0) in `make board`.
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

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: Staged on top of the oasis in `make board` and hidden for every frame here.
OVERLAPPING = ("Hex_Desert", "Hex_Lake")


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if not argv:
        raise SystemExit("usage: ... -- OUTDIR")
    os.makedirs(argv[0], exist_ok=True)
    return argv[0]


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


def main():
    out = _args()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92
    scene.view_settings.view_transform = "Standard"

    # Hide Ref_* mirror geometry (the exporter drops it).
    for obj in bpy.data.objects:
        if obj.name.startswith("Ref_"):
            obj.hide_render = True
        if _root(obj).name in OVERLAPPING:
            obj.hide_render = True

    hexobj = bpy.data.objects.get("Hex_Oasis")
    if hexobj is None:
        raise SystemExit("no Hex_Oasis in this blend -- run `make board` first")
    loc = hexobj.matrix_world.translation
    # The pond is south of the tile centre (the chip socket owns the north), so
    # every frame is aimed at the water rather than at the hex's own middle.
    pond = (loc.x, loc.y - 0.85, 0.30)

    scene.render.resolution_x = 1100
    scene.render.resolution_y = 800
    _light(scene)
    for name, az in AZIMUTHS.items():
        _shoot(os.path.join(out, f"oasis_on_desert_{name}"), pond, 13.5, az)

    # The pair: the oasis beside the desert it derives from, sharing a gutter,
    # so the two borders can be compared. The desert shares the oasis's cell
    # in `make board`, so it is moved one cell east here.
    desert = bpy.data.objects.get("Hex_Desert")
    if desert is not None:
        for obj in bpy.data.objects:
            if _root(obj).name == "Hex_Desert":
                obj.hide_render = False
        dx, dy = lattice.axial_to_xy(2, 0)
        desert.matrix_world.translation = Vector((dx, dy, desert.matrix_world.translation.z))
        bpy.context.view_layer.update()
        seam = ((loc.x + dx) / 2.0, (loc.y + dy) / 2.0, 0.25)
        _shoot(os.path.join(out, "pair_desert"), seam, 12.0, -90.0)
        for obj in bpy.data.objects:
            if _root(obj).name == "Hex_Desert":
                obj.hide_render = True

    # The tile alone. Hide everything not parented to Hex_Oasis, of every type
    # (chip numerals are FONT objects).
    for obj in bpy.data.objects:
        if obj.type in {"CAMERA", "LIGHT"}:
            continue
        obj.hide_render = obj.hide_render or _root(obj).name != "Hex_Oasis"
    for name, az in AZIMUTHS.items():
        _shoot(os.path.join(out, f"oasis_slab_{name}"), pond, 11.0, az)

    # The hero: 1024 square, flat neutral grey, three-quarter.
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.image_settings.file_format = "PNG"
    # RGB at full compression, far smaller than the default.
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 100
    # A dark neutral backdrop; see render_castle.py.
    _light(scene, sky=(0.20, 0.20, 0.21, 1), strength=1.0)
    _shoot(os.path.join(out, "hero"), (loc.x, loc.y - 0.55, 0.36), 10.5, -55.0)


main()
