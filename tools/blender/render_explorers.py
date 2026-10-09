"""Photograph the three Explorers tiles beside the tiles they are made of.

    blender --background --factory-startup \
        --python tools/blender/render_explorers.py -- OUTDIR [pairs|board|hero]

Three subjects:

  * `pairs`: each new tile next to the shipped tile it derives from, and next
             to a neighbour it must not be mistaken for, to check it reads as
             the same board.
  * `board`: the three among the shipped tiles on a real lattice, with the
             gutter sand the renderer builds at runtime.
  * `hero`:  the three in a row on neutral grey, for the review gallery.

There is no face-down tile: an unrevealed hex is masked to the wire-only `fog`
resource (`MaskBoard`) and drawn as sea with mist.

The rig is `render_hexes.py`/`render_rivers.py`'s: 32 degrees of vertical FOV
at 56 degrees of elevation.

## The sea as the runtime leaves it

`ocean.ts` drops the `Mat_Ocean` hull by `HULL_SINK` and displaces the
`Mat_Ocean_water` sheet around `OCEAN_MEAN_Y` (0.08 either side). The authored
blend shows neither and draws the sea 4.5cm too high, which matters for how
far the shoal's bank stands out. `settle_sea()` applies the mean state, using
`ocean.ts`'s numbers in this file's frame (a water tile is authored a lattice
cell wide and drawn at `LATTICE_SCALE`).

The tiles are appended rather than linked, since this scene moves them. A
water tile carries its lattice-cell scale on the root, so `_slide` moves it
without touching scale (setting `matrix_world` to a bare translation would
make the sea land-sized).
"""

import json
import math
import os
import re
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lattice  # noqa: E402
import naming  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HEXES = os.path.join(REPO, "art", "hexes")
PALETTE = os.path.join(REPO, "frontend", "public", "models", "palette.json")

_SUFFIX = re.compile(r"\.\d{3}$")

FOV_DEG = 32.0
ELEVATION_DEG = 56.0

EXPLORERS = ("Goldfield", "Shoal", "Spice")

#: Each new tile beside the shipped tile it is made of, and beside a neighbour.
#:
#: The goldfield must read as hills country and not the gold mine; the spice
#: village must sit on the pasture and not be mistaken for it; the shoal must
#: be sea and not the harbour.
PAIRS = [
    ("goldfield_hills", "Hills", "Goldfield"),
    ("goldfield_gold", "Gold", "Goldfield"),
    ("spice_pasture", "Pasture", "Spice"),
    ("spice_forest", "Forest", "Spice"),
    ("shoal_ocean", "Ocean", "Shoal"),
    ("shoal_port", "Port", "Shoal"),
]

# `ocean.ts`'s numbers, in the .glb's frame.
OCEAN_HULL_TOP_Y = 0.15
OCEAN_BAKED_MIN_Y = 0.145
OCEAN_BAKED_MEAN_Y = 0.177
OCEAN_MEAN_Y = 0.132
HULL_CLEARANCE = 0.05
OCEAN_MIN_Y = 0.020
HULL_SINK = (OCEAN_HULL_TOP_Y - OCEAN_MIN_Y + HULL_CLEARANCE) * lattice.LATTICE_SCALE
WAVE_SETTLE = (OCEAN_MEAN_Y - OCEAN_BAKED_MEAN_Y) * lattice.LATTICE_SCALE


def clear():
    """Empty the file between subjects, materials included.

    Leftover materials would make the next append create `Mat_X.001` copies,
    which have no palette.json entry and would render in authoring colours.
    """
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)


def palette():
    with open(PALETTE) as handle:
        return json.load(handle)


def apply_palette():
    """Paint every material the colour the client will paint it.

    `palette.json` overrides the blends' authoring colours at load time. A
    material with no entry yet keeps the blend's own and is listed on stderr.
    """
    colours = palette()
    unknown = []
    for mat in bpy.data.materials:
        # Two tiles in one frame share material names (the goldfield uses the
        # hills' materials), so Blender renames the second copy
        # `Mat_Hills_grass.001`. Strip the suffix for the lookup.
        key = _SUFFIX.sub("", mat.name)
        entry = colours.get(key)
        if entry is None:
            if key.startswith("Mat_"):
                unknown.append(key)
            continue
        if not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        bsdf.inputs["Base Color"].default_value = (*entry["color"], 1.0)
        bsdf.inputs["Roughness"].default_value = entry["roughness"]
        bsdf.inputs["Metallic"].default_value = entry["metalness"]
    if unknown:
        print("NOT IN palette.json (blend colour used):", sorted(set(unknown)))


def _slide(root, x, y):
    """Move a tile root to (x, y) without touching its z or its scale."""
    bpy.context.view_layer.update()
    here = root.matrix_world.translation
    root.matrix_world = Matrix.Translation(Vector((x - here.x, y - here.y, 0.0))) @ root.matrix_world
    bpy.context.view_layer.update()


def append_tile(terrain, position):
    """Bring one tile's objects in and stand it on `position`."""
    path = os.path.join(HEXES, f"{terrain.lower()}.blend")
    if not os.path.exists(path):
        raise SystemExit(f"no {os.path.relpath(path, REPO)}")
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = list(src.objects)
    root = None
    for obj in dst.objects:
        if obj is None:
            continue
        bpy.context.scene.collection.objects.link(obj)
        if obj.name == f"Hex_{terrain}":
            root = obj
    if root is None:
        raise SystemExit(f"{terrain}: no Hex_{terrain} in {path}")
    _slide(root, position[0], position[1])
    return root


def settle_sea():
    """Put every water tile where the runtime puts it. See the header."""
    for obj in list(bpy.data.objects):
        if obj.type != "MESH" or not obj.data.materials:
            continue
        names = {m.name for m in obj.data.materials if m}
        if names == {"Mat_Ocean"}:
            obj.location.z -= HULL_SINK
            for child in obj.children:
                child.location.z += HULL_SINK
        elif names == {"Mat_Ocean_water"}:
            obj.location.z += WAVE_SETTLE
    bpy.context.view_layer.update()


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


def path_material():
    sand = palette()["Mat_Path"]
    mat = bpy.data.materials.new("Mat_Path_render")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*sand["color"], 1.0)
    bsdf.inputs["Roughness"].default_value = sand["roughness"]
    return mat


def backdrop(z, size, colour):
    mesh = bpy.data.meshes.new("Backdrop")
    mesh.from_pydata(
        [(-size, -size, z), (size, -size, z), (size, size, z), (-size, size, z)], [], [(0, 1, 2, 3)]
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


def light(sky):
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
    bg.inputs[1].default_value = 0.7


def setup(width, height, fmt="JPEG"):
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.image_settings.file_format = fmt
    if fmt == "JPEG":
        scene.render.image_settings.quality = 92
    else:
        scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = "Standard"
    return scene


def shoot(path, target, dist, azimuth_deg, elevation_deg=ELEVATION_DEG, fov=FOV_DEG, ortho=None):
    scene = bpy.context.scene
    data = bpy.data.cameras.new("Cam")
    data.sensor_fit = "VERTICAL"
    data.angle_y = math.radians(fov)
    if ortho is not None:
        data.type = "ORTHO"
        data.sensor_fit = "HORIZONTAL"
        data.ortho_scale = ortho
    cam = bpy.data.objects.new("Cam", data)
    scene.collection.objects.link(cam)
    az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
    cam.location = Vector(target) + Vector(
        (math.cos(el) * math.cos(az) * dist, math.cos(el) * math.sin(az) * dist, math.sin(el) * dist)
    )
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    print("WROTE", path)


# --- the three subjects -----------------------------------------------------


def render_pairs(out):
    """Each new tile beside the shipped tile it is made of."""
    for tag, left, right in PAIRS:
        clear()
        append_tile(left, (-3.30, 0.0))
        append_tile(right, (3.30, 0.0))
        apply_palette()
        settle_sea()
        backdrop(-0.28, 40.0, (0.42, 0.43, 0.45))
        light((0.44, 0.46, 0.50))
        setup(1600, 850)
        shoot(os.path.join(out, f"pair_{tag}"), (0.0, 0.12, 0.28), 15.0, 270.0)


def render_board(out):
    """The three staged among the shipped tiles, on a real lattice."""
    clear()
    cells = {
        (0, 0): "Goldfield",
        (1, 0): "Hills",
        (0, -1): "Spice",
        (1, -1): "Pasture",
        (-1, 1): "Forest",
        (0, 1): "Fields",
        (2, -1): "Shoal",
        (2, 0): "Ocean",
    }
    for cell, terrain in cells.items():
        append_tile(terrain, lattice.axial_to_xy(*cell))
    gutter([c for c, t in cells.items() if t not in lattice.WATER_TERRAINS], path_material())
    apply_palette()
    settle_sea()
    light((0.28, 0.36, 0.46))
    setup(1600, 1000)
    mid = (lattice.axial_to_xy(0, 0)[0], lattice.axial_to_xy(0, 0)[1] - 0.6, 0.30)
    shoot(os.path.join(out, "board_az0"), mid, 20.0, 268.0)
    shoot(os.path.join(out, "board_az1"), mid, 15.0, 310.0)


def render_hero(out):
    """The three in a row on neutral grey, for the review gallery.

    The frame is sized from `EXPLORERS` (one pixels-per-unit and one margin),
    so a tile is the same size in the sheet however many the set holds.
    """
    clear()
    pitch = 6.55
    for i, terrain in enumerate(EXPLORERS):
        append_tile(terrain, ((i - (len(EXPLORERS) - 1) / 2.0) * pitch, 0.0))
    apply_palette()
    settle_sea()
    backdrop(-0.28, 90.0, (0.42, 0.43, 0.45))
    light((0.44, 0.46, 0.50))
    # A tile is 2 x TILE_APOTHEM wide on this bearing, plus a margin either
    # side. 3.15, 73.14 px/unit and 640 rows match the earlier ortho-28,
    # 2048-px sheet.
    ortho = (len(EXPLORERS) - 1) * pitch + 2.0 * lattice.TILE_APOTHEM + 3.15
    setup(int(round(ortho * 73.14 / 2)) * 2, 640, fmt="PNG")
    shoot(os.path.join(out, "hero"), (0.0, 0.10, 0.28), 60.0, 270.0, elevation_deg=51.0, ortho=ortho)


SUBJECTS = {"pairs": render_pairs, "board": render_board, "hero": render_hero}


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not argv:
        raise SystemExit("usage: ... -- OUTDIR [pairs|board|hero ...]")
    out = argv[0]
    os.makedirs(out, exist_ok=True)
    missing = [t for t in EXPLORERS if t not in naming.TERRAIN_TO_RESOURCE]
    if missing:
        raise SystemExit(f"unregistered terrains {missing}")
    for name in argv[1:] or list(SUBJECTS):
        if name not in SUBJECTS:
            raise SystemExit(f"unknown subject {name!r}, expected {list(SUBJECTS)}")
        SUBJECTS[name](out)


main()
