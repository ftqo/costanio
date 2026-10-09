"""Photograph every land hex through the game's camera.

    blender art/board.blend --background --python render_hexes.py -- OUTDIR [tag]

`art/board.blend` is the linked assembly of the eleven per-tile files, written
by `make board`. Re-run that first if a tile has changed under it.

Same rig as render_knight_sword.py: 32 deg vertical FOV, 56 deg elevation. Two
zooms (`tile` frames one hex, `play` is roughly where a player sits) and two
bearings, since a silhouette that reads broadside can vanish edge-on.

Writes `<terrain>_<zoom>_az<n>[_<tag>].jpg`.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

FOV_DEG = 32.0
ELEVATION_DEG = 56.0
ZOOMS = {"tile": 11.0, "play": 20.0}
AZIMUTHS = (-90.0, -25.0)


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if not argv:
        raise SystemExit("usage: ... -- OUTDIR [tag]")
    os.makedirs(argv[0], exist_ok=True)
    return argv[0], (argv[1] if len(argv) > 1 else "")


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
    out, tag = _args()
    suffix = f"_{tag}" if tag else ""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 800
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    _light(scene)

    # Hide Ref_* mirror geometry (the exporter drops it).
    for obj in bpy.data.objects:
        if obj.name.startswith("Ref_"):
            obj.hide_render = True

    hexes = sorted(
        (o for o in bpy.data.objects if o.name.startswith("Hex_") and o.type == "MESH"),
        key=lambda o: o.name,
    )
    for hx in hexes:
        terrain = hx.name[len("Hex_"):]
        loc = hx.matrix_world.translation
        target = (loc.x, loc.y, 0.55)
        for zoom, dist in ZOOMS.items():
            for i, az in enumerate(AZIMUTHS):
                _shoot(os.path.join(out, f"{terrain}_{zoom}_az{i}{suffix}"), target, dist, az)


main()
