"""Photograph the castle hex: beside the tiles it is family with, and alone.

    blender --background --factory-startup \
        --python tools/blender/render_castle.py -- OUTDIR [pairs|board|hero]

Self-contained: it appends the per-tile blends itself rather than reading
`art/board.blend`, so it never photographs a stale `make board` assembly.

Three subjects:

  * `pairs`: the castle beside the shipped pasture it is built on, and beside
             the hills and mountains it sits next to, to check it reads as
             the same board.
  * `board`: the castle on a real lattice with a settlement on its north
             vertex and a road down its north-west edge. The compound is
             pushed south to clear the chip socket; this checks the six edges
             still look buildable.
  * `hero`:  the tile alone, three-quarter, flat neutral grey, 1024 square,
             for the review gallery.

The rig is `render_hexes.py`'s: 32 degrees of vertical FOV and 56 degrees of
elevation, where verticals draw at 56% of their length.

Colours come from `frontend/public/models/palette.json`, which the client
applies at load, not from the blends.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anchors  # noqa: E402
import lattice  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HEXES = os.path.join(REPO, "art", "hexes")
PIECES = os.path.join(REPO, "art", "pieces.blend")
PALETTE = os.path.join(REPO, "frontend", "public", "models", "palette.json")

FOV_DEG = 32.0
ELEVATION_DEG = 56.0

#: The castle beside each tile it must match. Pasture first, since the castle
#: is the pasture with a keep on it.
PAIRS = [("pasture", "Pasture"), ("hills", "Hills"), ("mountains", "Mountains")]


def clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def palette():
    with open(PALETTE) as handle:
        return json.load(handle)


def apply_palette():
    colours = palette()
    for mat in bpy.data.materials:
        entry = colours.get(mat.name)
        if entry is None or mat.node_tree is None:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        bsdf.inputs["Base Color"].default_value = (*entry["color"], 1.0)
        bsdf.inputs["Roughness"].default_value = entry["roughness"]
        bsdf.inputs["Metallic"].default_value = entry["metalness"]


def append_tile(terrain, position, turn=0.0):
    """Bring one tile's objects in and stand its slab on `position`."""
    path = os.path.join(HEXES, f"{terrain.lower()}.blend")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = list(src.objects)
    root = None
    for obj in dst.objects:
        if obj is None:
            continue
        bpy.context.scene.collection.objects.link(obj)
        if obj.name.startswith("Hex_"):
            root = obj
    if root is None:
        raise SystemExit(f"{terrain}: no Hex_* root in {path}")
    root.matrix_world = Matrix.Translation(Vector(position)) @ Matrix.Rotation(turn, 4, "Z")
    # Drop the staged number chips parked on the tiles.
    for obj in list(bpy.data.objects):
        if obj.name.startswith(("Chip_", "Ref_")):
            bpy.data.objects.remove(obj, do_unlink=True)
    return root


def append_prefix(blend, prefixes):
    with bpy.data.libraries.load(blend, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith(tuple(prefixes))]
    out = []
    for obj in dst.objects:
        if obj is None:
            continue
        bpy.context.scene.collection.objects.link(obj)
        out.append(obj)
    return out


def canonical(name):
    """One piece from `art/pieces.blend`, brought home to its reference pose.

    The pieces are modelled in place on the showcase board; this uses the
    exporter's `anchors` table to undo that, as the exporter does.
    """
    objs = append_prefix(PIECES, [name])
    ax, ay = anchors.RULES[name]
    move = Matrix.Rotation(anchors.AUTHORED_TURN[name], 4, "Z") @ Matrix.Translation(
        Vector((-ax, -ay, 0.0))
    )
    for obj in objs:
        obj.matrix_world = move @ obj.matrix_world
    return objs


def gutter(cells, material):
    """The sand the renderer fills the lattice gap with, as one mesh.

    `gapGeometry.ts` builds this at runtime; without it the tiles float apart.
    """
    verts, faces = lattice.gap_strip()
    out_v, out_f = [], []
    for q, r in cells:
        cx, cy = lattice.axial_to_xy(q, r)
        for d in range(6):
            rot = Matrix.Rotation(lattice.edge_turn(d), 4, "Z")
            base = len(out_v)
            for v in verts:
                p = rot @ Vector(v)
                out_v.append((p.x + cx, p.y + cy, p.z))
            out_f.extend(tuple(base + i for i in f) for f in faces)
    mesh = bpy.data.meshes.new("Gutter")
    mesh.from_pydata(out_v, [], out_f)
    mesh.materials.append(material)
    for poly in mesh.polygons:
        poly.use_smooth = False
    mesh.update()
    obj = bpy.data.objects.new("Gutter", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def sand_material():
    entry = palette()["Mat_Path"]
    mat = bpy.data.materials.new("Mat_Path")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*entry["color"], 1.0)
    bsdf.inputs["Roughness"].default_value = entry["roughness"]
    return mat


def backdrop(z, size, colour):
    mesh = bpy.data.meshes.new("Backdrop")
    mesh.from_pydata(
        [(-size, -size, z), (size, -size, z), (size, size, z), (-size, size, z)],
        [],
        [(0, 1, 2, 3)],
    )
    mat = bpy.data.materials.new("Mat_Backdrop")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.95
    mesh.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = False
    mesh.update()
    obj = bpy.data.objects.new("Backdrop", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def light(sky, strength=0.7):
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
        bpy.context.scene.collection.objects.link(obj)
        obj.rotation_euler = tuple(math.radians(d) for d in euler)
    bg = bpy.context.scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*sky, 1)
    bg.inputs[1].default_value = strength


def setup(width, height, fmt="JPEG"):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = fmt
    if fmt == "JPEG":
        scene.render.image_settings.quality = 92
    else:
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.color_depth = "8"
        scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = "Standard"
    return scene


def shoot(path, target, dist, azimuth_deg, elevation_deg=ELEVATION_DEG):
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


# --- the three subjects -----------------------------------------------------


def render_pairs(out):
    for tag, neighbour in PAIRS:
        clear()
        append_tile(neighbour, (-3.4, 0.0, 0.0))
        append_tile("Castle", (3.4, 0.0, 0.0))
        apply_palette()
        backdrop(-0.26, 40.0, (0.42, 0.43, 0.45))
        light((0.44, 0.46, 0.50))
        setup(1500, 800)
        shoot(os.path.join(out, f"pair_{tag}"), (0.0, 0.15, 0.35), 15.5, 270.0)


def render_board(out):
    """The castle in a lattice, with a settlement and a road on its edges."""
    clear()
    cells = {
        (0, 0): "Castle",
        (1, 0): "Pasture",
        (0, -1): "Hills",
        (1, -1): "Fields",
        (-1, 0): "Mountains",
        (0, 1): "Forest",
        (-1, 1): "Gold",
        (1, 1): "Desert",
    }
    for cell, terrain in cells.items():
        x, y = lattice.axial_to_xy(*cell)
        append_tile(terrain, (x, y, 0.0))
    gutter(list(cells), sand_material())

    # The castle's own north vertex, and the edge running north-west out of it.
    # `anchors.LCOL`/`LHEX` are lattice quantities, so the vertex is the hex
    # centre plus one lattice hex-step north.
    cx, cy = lattice.axial_to_xy(0, 0)
    vertex = Vector((cx, cy + anchors.LHEX, 0.250))
    for obj in canonical("Settlement_A"):
        obj.matrix_world = Matrix.Translation(vertex) @ obj.matrix_world
    edge = Vector((cx - anchors.LCOL / 2, cy + anchors.LHEX / 2, 0.250))
    for obj in canonical("Road_A"):
        obj.matrix_world = (
            Matrix.Translation(edge) @ Matrix.Rotation(math.radians(120), 4, "Z")
        ) @ obj.matrix_world

    apply_palette()
    light((0.28, 0.36, 0.46))
    setup(1400, 900)
    shoot(os.path.join(out, "castle_tile"), (cx, cy, 0.55), 12.5, -90.0)
    shoot(os.path.join(out, "castle_tile_az1"), (cx, cy, 0.55), 12.5, -25.0)
    shoot(os.path.join(out, "castle_play"), (cx, cy, 0.55), 20.0, -90.0)
    shoot(os.path.join(out, "castle_pieces"), (cx - 0.7, cy + 1.4, 0.5), 7.5, -115.0)


def render_hero(out):
    clear()
    append_tile("Castle", (0.0, 0.0, 0.0))
    apply_palette()
    backdrop(-0.26, 40.0, (0.20, 0.20, 0.21))
    # A dark neutral backdrop: a bright one adds enough ambient to wash the
    # tile to pastel.
    light((0.20, 0.20, 0.21), strength=1.0)
    setup(1024, 1024, fmt="PNG")
    shoot(os.path.join(out, "hero"), (0.0, 0.0, 0.6), 11.0, -55.0)


SUBJECTS = {"pairs": render_pairs, "board": render_board, "hero": render_hero}


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not argv:
        raise SystemExit(f"usage: ... -- OUTDIR [{'|'.join(SUBJECTS)}]")
    out = argv[0]
    os.makedirs(out, exist_ok=True)
    for name in argv[1:] or list(SUBJECTS):
        if name not in SUBJECTS:
            raise SystemExit(f"unknown subject {name!r}, expected {list(SUBJECTS)}")
        SUBJECTS[name](out)


main()
