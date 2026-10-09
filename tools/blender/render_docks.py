"""Photograph every trading post through the game's camera.

    blender art/hexes/port.blend --background --python render_docks.py -- OUTDIR [tag]

Same rig as `render_hexes.py` and `render_knight_sword.py`: 32 deg vertical FOV
and 56 deg of elevation. The pier reaches out along -x, so azimuth 180 looks
back down it from the seaward end; the other two are three-quarter and
broadside.

One frame per (trade, zoom, bearing), with everything but that trade's
dressing hidden (the blend carries all five posts and six ratio signs on one
pier; the exporter ships them apart).

Writes `<trade>_<zoom>_az<n>[_<tag>].jpg`.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

FOV_DEG = 32.0
ELEVATION_DEG = 56.0
ZOOMS = {"tile": 9.0, "play": 18.0}
AZIMUTHS = (180.0, 235.0, 270.0)
TRADES = ("wood", "brick", "sheep", "wheat", "ore", "generic")

# The ratio sign ships from signs.glb and covers a third of the deck, so hide it.
SHOW_SIGNS = False


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if not argv:
        raise SystemExit("usage: ... -- OUTDIR [tag] [trade,trade,...]")
    os.makedirs(argv[0], exist_ok=True)
    trades = tuple(argv[2].split(",")) if len(argv) > 2 else TRADES
    return argv[0], (argv[1] if len(argv) > 1 else ""), trades


def _light(scene):
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
    bg.inputs[0].default_value = (0.28, 0.36, 0.46, 1)
    bg.inputs[1].default_value = 0.7


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
    print("WROTE", path + ".jpg")


def main():
    out, tag, trades = _args()
    suffix = f"_{tag}" if tag else ""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 800
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92
    scene.view_settings.view_transform = "Standard"
    _light(scene)

    for obj in bpy.data.objects:
        if obj.name.startswith("Ref_"):
            obj.hide_render = True

    hexes = [o for o in bpy.data.objects if o.name == "Hex_Port"]
    if not hexes:
        raise SystemExit("no Hex_Port in this blend")
    loc = hexes[0].matrix_world.translation
    # Aim at the middle of the pier; the hex centre is its landward end.
    target = (loc.x - 0.7, loc.y, 0.5)

    dressing = [o for o in bpy.data.objects if o.name.startswith(("Dock_", "Hwedge_"))]
    for trade in trades:
        for obj in dressing:
            keep = obj.name.startswith(f"Dock_{trade}_")
            if SHOW_SIGNS and obj.name.startswith("Hwedge_"):
                keep = keep or trade in obj.name
            obj.hide_render = not keep
        for zoom, dist in ZOOMS.items():
            for i, az in enumerate(AZIMUTHS):
                _shoot(os.path.join(out, f"{trade}_{zoom}_az{i}{suffix}"), target, dist, az)


main()
