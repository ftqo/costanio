"""Photograph the Explorers vessels, in the studio and on the board.

    # the gallery still: both ships, three-quarter, neutral grey
    blender art/vessels.blend --background --factory-startup \
        --python tools/blender/render_vessels.py -- art/prototypes/vessels hero

    # the board stills, through the game's camera
    blender art/board.blend --background --factory-startup \
        --python tools/blender/render_vessels.py -- art/prototypes/vessels board

The board stills use the rig of `render_docks.py` and `render_knight_sword.py`:
32 degrees of vertical FOV and 56 degrees of elevation, where verticals draw at
56% of their length.

They stage:

- the cargo ship on a sea edge next to an Islands route ship, to judge size;
- the pair of cargo ships the rules allow on one edge, at the offset
  `vessels.SIDE_BY_SIDE_Y` claims is enough;
- the corsair standing on a sea hex centre, where its own silhouette has to be
  distinguishable from the Islands pirate's at a glance.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VESSELS = os.path.join(REPO, "art", "vessels.blend")
SHIPS = os.path.join(REPO, "art", "ships.blend")

FOV_DEG = 32.0
ELEVATION_DEG = 56.0

#: Where the pair goes, across its edge. Restated from
#: `tools/blender/gen/vessels.py`, which imports bpy at load.
SIDE_BY_SIDE_Y = 0.17


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if len(argv) < 2:
        raise SystemExit("usage: ... -- OUTDIR {hero|board}")
    out = argv[0] if os.path.isabs(argv[0]) else os.path.join(REPO, argv[0])
    os.makedirs(out, exist_ok=True)
    return out, argv[1]


def _append(path, prefixes):
    """Append every object under `prefixes` from another blend, once."""
    have = [o for o in bpy.data.objects if o.name.startswith(tuple(prefixes))]
    if have:
        return have
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith(tuple(prefixes))]
    loaded = [o for o in dst.objects if o is not None]
    for obj in loaded:
        bpy.context.scene.collection.objects.link(obj)
    return loaded


def _clone(prefix, where, yaw=0.0, tag=""):
    """Copy every part of one piece to `where`, turned by `yaw` radians."""
    made = []
    for src in [o for o in bpy.data.objects if o.name.startswith(prefix) and "__" not in o.name]:
        obj = src.copy()
        obj.data = src.data
        obj.name = f"{src.name}__{tag}"
        bpy.context.scene.collection.objects.link(obj)
        obj.location = Vector(where)
        obj.rotation_euler = (0.0, 0.0, yaw)
        obj.hide_render = False
        made.append(obj)
    if not made:
        raise SystemExit(f"nothing named {prefix}* to clone")
    return made


def _light(scene, warm=True):
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
    bg.inputs[0].default_value = (0.28, 0.36, 0.46, 1) if warm else (0.30, 0.30, 0.31, 1)
    bg.inputs[1].default_value = 0.7 if warm else 1.1


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


def _top_of(name):
    """World-space top of an object's geometry, for seating a piece on it."""
    obj = bpy.data.objects[name]
    mat = obj.matrix_world
    return max((mat @ v.co).z for v in obj.data.vertices)


# --- the gallery still --------------------------------------------------


def hero(out):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.image_settings.file_format = "PNG"
    # Maximum deflate; the default is far larger.
    scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = "Standard"
    _light(scene, warm=False)

    # A neutral ground, so the pieces cast shadows and a base that does not sit
    # flat shows.
    mesh = bpy.data.meshes.new("Ground")
    mesh.from_pydata(
        [(-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0)], [], [(0, 1, 2, 3)]
    )
    mat = bpy.data.materials.new("Mat_Hero_ground")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
        0.34,
        0.34,
        0.35,
        1.0,
    )
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    mesh.materials.append(mat)
    scene.collection.objects.link(bpy.data.objects.new("Ground", mesh))

    # Apart, along the axis the camera looks across, so neither hides the other.
    for obj in bpy.data.objects:
        if obj.name.startswith("Cargo_"):
            obj.location = (0.0, -0.62, 0.0)
        elif obj.name.startswith("Corsair_"):
            obj.location = (0.0, 0.62, 0.0)

    _shoot(os.path.join(out, "hero"), (0.0, 0.0, 0.32), 4.1, 38.0, elevation_deg=26.0)


# --- the board stills ---------------------------------------------------


def board(out):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 800
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92
    scene.view_settings.view_transform = "Standard"
    _light(scene)

    for obj in bpy.data.objects:
        if obj.name.startswith("Ref_"):
            obj.hide_render = True

    _append(VESSELS, ("Cargo_", "Corsair_"))
    _append(SHIPS, ("Ship_route",))
    # The staged originals sit at the origin; only the clones below are shown.
    for obj in bpy.data.objects:
        if obj.name.startswith(("Cargo_", "Corsair_", "Ship_")):
            obj.hide_render = True

    ocean = bpy.data.objects["Hex_Ocean"].matrix_world.translation
    shore = bpy.data.objects["Hex_Shore"].matrix_world.translation
    water = _top_of("Hex_Ocean")
    print(f"water plane z={water:.4f}")

    # The edge these two hexes share. Their centres are LCOL apart in +x, so the
    # edge runs along y and a piece authored along +x is turned a quarter turn
    # onto it.
    edge = ((ocean.x + shore.x) / 2.0, (ocean.y + shore.y) / 2.0)
    yaw = math.pi / 2.0
    # The ship's own +y is across the edge; after the quarter turn that is world
    # -x, which is what carries the side-by-side offset.
    across = (-1.0, 0.0)

    def at(offset):
        return (edge[0] + across[0] * offset, edge[1] + across[1] * offset, water)

    # Frame A: the cargo ship beside the Islands route ship, on one edge, with
    # the corsair on the hex behind them.
    _clone("Cargo_", at(-SIDE_BY_SIDE_Y), yaw, "a")
    _clone("Ship_route", at(SIDE_BY_SIDE_Y), yaw, "route")
    _clone("Corsair_", (ocean.x, ocean.y, water), 0.0, "c")
    target = ((edge[0] + ocean.x) / 2.0, (edge[1] + ocean.y) / 2.0, water + 0.4)
    for az in (215.0, 270.0):
        _shoot(os.path.join(out, f"board_scale_az{int(az)}"), target, 11.0, az)
    # And once from play distance, aimed at the harbour so there is land in
    # the frame.
    port = bpy.data.objects["Hex_Port"].matrix_world.translation
    _shoot(
        os.path.join(out, "board_scale_wide"),
        ((edge[0] + port.x) / 2.0, (edge[1] + port.y) / 2.0, water),
        23.0,
        235.0,
    )

    # Frame B: the pair the rules allow, at the offset the art is sized for.
    for obj in [o for o in bpy.data.objects if o.name.endswith(("__a", "__route"))]:
        bpy.data.objects.remove(obj, do_unlink=True)
    _clone("Cargo_", at(-SIDE_BY_SIDE_Y), yaw, "p0")
    _clone("Cargo_", at(SIDE_BY_SIDE_Y), yaw, "p1")
    _shoot(os.path.join(out, "board_pair_az215"), (edge[0], edge[1], water + 0.3), 7.0, 215.0)


def main():
    out, mode = _args()
    if mode == "hero":
        hero(out)
    elif mode == "board":
        board(out)
    else:
        raise SystemExit(f"unknown mode {mode}")


if __name__ == "__main__":
    main()
