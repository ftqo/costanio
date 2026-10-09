"""Photograph the twenty robber prototypes on the real board.

    blender art/board.blend --background --python tools/blender/render_robbers.py \
        -- art/prototypes/robbers
    # or: make robbers

Runs against `art/board.blend` (the per-tile files linked by `make board`),
because a robber is judged by whether a player can tell at a glance which hex
is blocked, from 56 degrees of elevation, next to a number chip. The rig is
`render_knight_sword.py`'s.

The designs are rebuilt from `robber_designs.py` into the linked board, at
`ROBBER_SCALE`, standing on tile faces.

Three sets of frames land in the output directory:

- `set_az<n>.jpg`: all twenty on the board at once, two bearings, to cut the
  set down.
- `play_<name>.jpg`: each design alone on the same hex at the distance a
  player sits.
- `finish_<name>.jpg`: the base robber in each of `build_robbers.FINISHES`.

JPEG, for the reason given in `render_knight_sword.py`.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_robbers as br  # noqa: E402
import robber_designs as rd  # noqa: E402

#: Drawn size of a robber, from `frontend/src/lib/board3d/pieceArt.ts`.
PIECE_SCALE = 1.5

#: `SURFACE.land` in `seating.ts`: a tile's own face, where the robber
#: stands when its hex has no chip.
LAND_Z = 0.25

#: The shipping camera, from `scene.ts`.
FOV_DEG = 32.0
ELEVATION_DEG = 56.0

ZOOMS = {"board": 30.0, "play": 14.0, "close": 8.0}
AZIMUTHS = (-90.0, -25.0)


def args():
    """`-- OUTDIR [stage ...]`, where a stage is set|play|study|finish|sheet.

    Naming stages re-shoots part of the set, which is faster when iterating on
    one design.
    """
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if not argv:
        raise SystemExit("usage: ... --python render_robbers.py -- OUTDIR [stage ...]")
    os.makedirs(argv[0], exist_ok=True)
    return argv[0], set(argv[1:]) or {"set", "play", "study", "finish", "sheet"}


def light(scene):
    """The knight-sword rig's lighting, unchanged, so the two sets compare."""
    for obj in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(obj, do_unlink=True)
    for name, energy, euler in (("Sun", 4.0, (48.0, 0.0, -35.0)), ("Fill", 1.4, (65.0, 0.0, 150.0))):
        data = bpy.data.lights.new(name, type="SUN")
        data.energy = energy
        data.angle = math.radians(6)
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.rotation_euler = tuple(math.radians(d) for d in euler)
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.28, 0.36, 0.46, 1)
    bg.inputs[1].default_value = 0.7


def chip_top(hexobj):
    """Where a piece stands on this tile: on the number chip if it has one.

    `robberOnChip` is the rule: onto the chip where there is one, onto the tile
    face otherwise.
    """
    for child in hexobj.children:
        if child.name.startswith("Chip_") and child.name.endswith("_body") and child.type == "MESH":
            ws = [child.matrix_world @ v.co for v in child.data.vertices]
            cx = (min(v.x for v in ws) + max(v.x for v in ws)) / 2.0
            cy = (min(v.y for v in ws) + max(v.y for v in ws)) / 2.0
            return (cx, cy), max(v.z for v in ws)
    x, y, _ = hexobj.matrix_world.translation
    return (x, y), LAND_Z


def hex_spots():
    """Land tiles of the showcase board, near the middle first.

    Ordered by distance from the board's centre so a lineup fills the middle of
    the frame rather than the corners, whatever the blend's hex count is.
    """
    spots = []
    for obj in bpy.data.objects:
        if not obj.name.startswith("Hex_"):
            continue
        if any(t in obj.name for t in ("Ocean", "Shore", "Port")):
            continue
        xy, z = chip_top(obj)
        spots.append((math.hypot(*xy), (xy[0], xy[1], z)))
    return [spot for _, spot in sorted(spots)]


def place(name, at, finish="matte"):
    """Build a design into the open board at a spot, at piece scale."""
    obj = br.make(name, rd.build(name), finish=finish, suffix=f"_{finish}_{at[0]:.2f}_{at[1]:.2f}")
    obj.matrix_world = Matrix.Translation(at) @ Matrix.Diagonal(
        (PIECE_SCALE, PIECE_SCALE, PIECE_SCALE, 1.0)
    )
    return obj


def shoot(path, target, dist, azimuth_deg):
    scene = bpy.context.scene
    data = bpy.data.cameras.new("Cam")
    data.sensor_fit = "VERTICAL"
    data.angle_y = math.radians(FOV_DEG)
    cam = bpy.data.objects.new("Cam", data)
    scene.collection.objects.link(cam)
    az, el = math.radians(azimuth_deg), math.radians(ELEVATION_DEG)
    cam.location = Vector(target) + Vector(
        (math.cos(el) * math.cos(az) * dist, math.cos(el) * math.sin(az) * dist, math.sin(el) * dist)
    )
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    print("WROTE", path + ".jpg")


def clear(objs):
    for obj in objs:
        bpy.data.objects.remove(obj, do_unlink=True)


def main():
    out, stages = args()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 980
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    scene.view_settings.view_transform = "Standard"
    light(scene)

    # Hide the blend's own staged robber.
    for obj in bpy.data.objects:
        if obj.name.startswith("Robber_"):
            obj.hide_render = True

    spots = hex_spots()
    if not spots:
        raise SystemExit("no land tiles in this blend")

    # 1. The set on the board, in batches of however many land tiles the
    #    showcase board has (one hex per terrain), so every piece stands on
    #    real tile art beside a real chip.
    centre = (
        sum(s[0] for s in spots) / len(spots),
        sum(s[1] for s in spots) / len(spots),
        LAND_Z + 0.8,
    )
    home = spots[0]
    target = (home[0], home[1], home[2] + 0.6)
    for b in range(0, len(rd.ORDER) if "set" in stages else 0, len(spots)):
        batch = rd.ORDER[b : b + len(spots)]
        lineup = [place(name, spots[i]) for i, name in enumerate(batch)]
        for i, az in enumerate(AZIMUTHS):
            shoot(os.path.join(out, f"set{b // len(spots) + 1}_az{i}"), centre, ZOOMS["board"], az)
        clear(lineup)

    # 2. Each design alone, where a player sits, in the shipping near-black.
    for name in ["classic"] + rd.ORDER if "play" in stages else []:
        obj = place(name, home)
        shoot(os.path.join(out, f"play_{name}"), target, ZOOMS["play"], AZIMUTHS[1])
        clear([obj])

    # 3. Each design close, in clay (near-black hides all but the outline),
    #    from two bearings, since many are not rotationally symmetric.
    for name in ["classic"] + rd.ORDER if "study" in stages else []:
        obj = place(name, home, finish="clay")
        for i, az in enumerate(AZIMUTHS):
            shoot(os.path.join(out, f"study_{name}_az{i}"), target, ZOOMS["close"], az)
        clear([obj])

    # 4. One geometry, every finish.
    for finish in br.FINISHES if "finish" in stages else []:
        obj = place("classic", home, finish=finish)
        shoot(os.path.join(out, f"finish_{finish}"), target, ZOOMS["close"], AZIMUTHS[1])
        clear([obj])

    # 5. The contact sheet, last because it hides the board to shoot.
    if "sheet" in stages:
        sheet(os.path.join(out, "sheet"))


def label(text, at):
    """A design's name on the ground under it, turned to face the camera."""
    curve = bpy.data.curves.new(f"Label_{text}", type="FONT")
    curve.body = text
    curve.size = 0.42
    curve.align_x = "CENTER"
    obj = bpy.data.objects.new(f"Label_{text}", curve)
    bpy.context.scene.collection.objects.link(obj)
    # Tilted by the camera's elevation so it faces the camera.
    obj.rotation_euler = (math.radians(90.0 - ELEVATION_DEG), 0.0, 0.0)
    obj.location = at
    mat = br.material("Sheet_Label", {"color": (0.10, 0.10, 0.11), "metallic": 0.0, "roughness": 0.9})
    curve.materials.append(mat)
    return obj


def sheet(path):
    """All twenty-one in a labelled grid, in clay, at the board's elevation.

    The frame to choose from: every candidate side by side at the same size
    and light.

    Orthographic, so the grid has no perspective size differences, but at the
    game's elevation so tall pieces are foreshortened as in play.
    """
    scene = bpy.context.scene
    for obj in bpy.data.objects:
        # Keep the lights.
        if obj.type != "LIGHT":
            obj.hide_render = True

    names = ["classic"] + rd.ORDER
    cols, col_pitch, row_pitch = 6, 2.5, 3.4
    made = []
    floor_mesh = bpy.data.meshes.new("Sheet_Floor")
    floor_mesh.from_pydata(
        [(-40.0, -40.0, 0.0), (40.0, -40.0, 0.0), (40.0, 40.0, 0.0), (-40.0, 40.0, 0.0)], [], [(0, 1, 2, 3)]
    )
    floor_mesh.materials.append(
        br.material("Sheet_Floor", {"color": (0.68, 0.70, 0.72), "metallic": 0.0, "roughness": 0.9})
    )
    floor = bpy.data.objects.new("Sheet_Floor", floor_mesh)
    scene.collection.objects.link(floor)
    made.append(floor)

    xs, ys = [], []
    for i, name in enumerate(names):
        x = col_pitch * (i % cols - (cols - 1) / 2.0)
        y = -row_pitch * (i // cols)
        xs.append(x)
        ys.append(y)
        made.append(place(name, (x, y, 0.0), finish="clay"))
        made.append(label(name, (x, y - 0.95, 0.02)))

    data = bpy.data.cameras.new("Sheet")
    data.type = "ORTHO"
    data.ortho_scale = col_pitch * cols + 1.2
    cam = bpy.data.objects.new("Sheet", data)
    scene.collection.objects.link(cam)
    made.append(cam)
    centre = Vector(((min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0 - 0.4, 1.0))
    el = math.radians(ELEVATION_DEG)
    cam.location = centre + Vector((0.0, -math.cos(el) * 40.0, math.sin(el) * 40.0))
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.resolution_x = 2000
    scene.render.resolution_y = 1500
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("WROTE", path + ".jpg")
    clear(made)


main()
