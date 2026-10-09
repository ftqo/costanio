"""Photograph the river tiles: the family line-up, and a river on a board.

    blender --background --factory-startup \
        --python tools/blender/render_rivers.py -- OUTDIR
            [hero|family|family_mountains|family_hills|family_pasture
             |family_swamp|family_all|board|detail]

Four subjects:

  * `hero`:   every tile in one row on a neutral ground, to judge the family
              as a set (each tile must be distinguishable).
  * `family`: the same tiles through the game's lens, from the side the
              number is on, with a chip on every socket, to check the channel
              does not cover the number.
  * `board`:  a river from the mountains into the swamp across a real lattice
              joint, with the gutter sand and a road where a bridge will go,
              to check the channel meets the edge midpoint (the contract with
              `art/bridges`).
  * `detail`: one straight and one bend at tile zoom, for the banks, plus
              each mirrored bend beside the bend it is drawn from.

The rig is `render_docks.py`/`render_knight_sword.py`'s: 32 degrees of vertical
FOV and 56 degrees of elevation.

The tiles are appended rather than linked, since this scene moves them onto
its own cells.
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
import naming  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HEXES = os.path.join(REPO, "art", "hexes")
PALETTE = os.path.join(REPO, "frontend", "public", "models", "palette.json")

FOV_DEG = 32.0
ELEVATION_DEG = 56.0

#: The chip every family sheet stands on every socket.
#:
#: A real chip, so the sheet shows whether the number is readable. It is 2.0
#: across, the disc `hexcontract.CHIP_RADIUS` and `riverArt.test.ts` measure
#: against.
CHIP_PREFIX = "Chip_08_1_"

#: The re-cut mountains: nine shapes, two straight variants, six headwaters.
#:
#: Named for the sorted compass pair of the two mouths. Ordered straights first
#: (the two east-west variants side by side), then bends in mirror pairs, then
#: the headwaters.
FAMILY_MOUNTAINS = [
    "River_Mountains_E_W_A", "River_Mountains_E_W_B",
    "River_Mountains_NE_SW", "River_Mountains_NW_SE",
    "River_Mountains_NE_W", "River_Mountains_E_NW",
    "River_Mountains_E_SW", "River_Mountains_W_SE",
    "River_Mountains_NE_SE", "River_Mountains_NW_SW",
    "River_Mountains_Src_E", "River_Mountains_Src_W",
    "River_Mountains_Src_NE", "River_Mountains_Src_NW",
    "River_Mountains_Src_SE", "River_Mountains_Src_SW",
]

#: The hills family re-cut, in the same reading order.
#:
#: Ten: no plain `River_Hills_E_W` (the east-west straight ships as two
#: meanders) and no headwaters (a source hex is always mountains).
FAMILY_HILLS = [
    "River_Hills_E_W_A", "River_Hills_E_W_B",
    "River_Hills_NE_SW", "River_Hills_NW_SE",
    "River_Hills_NE_W", "River_Hills_E_NW",
    "River_Hills_E_SW", "River_Hills_W_SE",
    "River_Hills_NE_SE", "River_Hills_NW_SW",
]

#: The pasture family re-cut, in the same reading order.
#:
#: Ten, for the hills' two reasons.
FAMILY_PASTURE = [
    "River_Pasture_E_W_A", "River_Pasture_E_W_B",
    "River_Pasture_NE_SW", "River_Pasture_NW_SE",
    "River_Pasture_NE_W", "River_Pasture_E_NW",
    "River_Pasture_E_SW", "River_Pasture_W_SE",
    "River_Pasture_NE_SE", "River_Pasture_NW_SW",
]

#: The swamp family re-cut, in the same reading order, and the only one of the
#: four whose tiles a board selects today: a river ends on a marsh.
FAMILY_SWAMP = [
    "River_Swamp_E_W_A", "River_Swamp_E_W_B",
    "River_Swamp_NE_SW", "River_Swamp_NW_SE",
    "River_Swamp_NE_W", "River_Swamp_E_NW",
    "River_Swamp_E_SW", "River_Swamp_W_SE",
    "River_Swamp_NE_SE", "River_Swamp_NW_SW",
]

#: Every re-cut tile, all forty-seven, on one sheet, to check four terrains and
#: nine shapes read as one river. The channel is identical on all of them
#: (`riverArt.test.ts`); the line differs by family (the mountains sweep, the
#: hills kink, the pasture meanders, the marsh crawls).
FAMILY_ALL = FAMILY_MOUNTAINS + FAMILY_HILLS + FAMILY_PASTURE + FAMILY_SWAMP


def clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def palette():
    with open(PALETTE) as handle:
        return json.load(handle)


def apply_palette():
    """Paint every material the colour the client will paint it.

    `palette.json` overrides the blends' authoring colours at load time.
    """
    colours = palette()
    for mat in bpy.data.materials:
        entry = colours.get(mat.name)
        if entry is None or not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        bsdf.inputs["Base Color"].default_value = (*entry["color"], 1.0)
        bsdf.inputs["Roughness"].default_value = entry["roughness"]
        bsdf.inputs["Metallic"].default_value = entry["metalness"]


def append_tile(terrain, position, turn=0.0):
    """Bring one tile's objects in and stand it on `position`."""
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
    root.matrix_world = Matrix.Translation(Vector(position)) @ Matrix.Rotation(
        turn, 4, "Z"
    )
    return root


def append_prefix(blend, prefixes):
    """Append the objects of `blend` whose names start with any of `prefixes`."""
    path = os.path.join(REPO, "art", blend)
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith(tuple(prefixes))]
    out = []
    for obj in dst.objects:
        if obj is None:
            continue
        bpy.context.scene.collection.objects.link(obj)
        out.append(obj)
    return out


def canonical_road():
    """`Road_A_*` in its reference pose: along +x, midpoint at the origin.

    The blend's copy lies 30 degrees across a showcase edge; this uses the
    exporter's `anchors` table to bring it home.
    """
    objs = append_prefix("pieces.blend", ["Road_A"])
    ax, ay = anchors.RULES["Road_A"]
    turn = anchors.AUTHORED_TURN["Road_A"]
    move = Matrix.Rotation(turn, 4, "Z") @ Matrix.Translation(Vector((-ax, -ay, 0.0)))
    for obj in objs:
        obj.matrix_world = move @ obj.matrix_world
    return objs


def gutter(cells, material):
    """The sand the renderer fills the lattice gap with, as one mesh.

    `gapGeometry.ts` builds this at runtime; `lattice.gap_strip` mirrors it
    (checked by `test_lattice.py`).
    """
    verts, faces = lattice.gap_strip()
    out_v, out_f = [], []
    for q, r in cells:
        cx, cy = lattice.axial_to_xy(q, r)
        for d in range(6):
            a = lattice.edge_turn(d)
            rot = Matrix.Rotation(a, 4, "Z")
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
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.image_settings.file_format = fmt
    if fmt == "JPEG":
        scene.render.image_settings.quality = 92
    else:
        # Full compression: the frame is 2560 wide and committed.
        scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = "Standard"
    return scene


def shoot(path, target, dist, azimuth_deg, elevation_deg=ELEVATION_DEG, fov=FOV_DEG,
          ortho=None):
    scene = bpy.context.scene
    data = bpy.data.cameras.new("Cam")
    data.sensor_fit = "VERTICAL"
    data.angle_y = math.radians(fov)
    if ortho is not None:
        # The line-up only: a 60-unit row through the game's lens would show
        # the end tiles from 60 degrees off.
        data.type = "ORTHO"
        data.sensor_fit = "HORIZONTAL"
        data.ortho_scale = ortho
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


# --- the subjects -----------------------------------------------------------

def place(objs, move):
    """Apply `move` to a group of objects, baking it into the meshes.

    Every mesh keeps its own geometry and drops back to the identity, so nothing
    depends on a parent link that may or may not have come along with the
    append. The numeral is a FONT object with no vertices to move and is placed
    by its object transform instead.
    """
    for obj in objs:
        world = obj.matrix_world.copy()
        obj.parent = None
        if obj.type == "MESH":
            obj.data.transform(move @ world)
            obj.data.update()
            obj.matrix_world = Matrix.Identity(4)
        else:
            obj.matrix_world = move @ world


def append_chip_at(position):
    """Stand a number chip on the socket at `position`.

    Placed off its own measured bounds and baked: a chip in `art/chips.blend`
    is parented through a tile that is not appended here, so its mesh
    coordinates are local to that chain.
    """
    chip = append_prefix("chips.blend", [CHIP_PREFIX])
    if not chip:
        raise SystemExit(f"no {CHIP_PREFIX}* in art/chips.blend")
    bpy.context.view_layer.update()
    place(chip, Matrix.Identity(4))
    body = next((o for o in chip if o.name.endswith("_body")), None)
    if body is None:
        raise SystemExit(f"no {CHIP_PREFIX}body in art/chips.blend")
    vs = [v.co for v in body.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    place(
        chip,
        Matrix.Translation(
            Vector(
                (
                    position[0] - (lo.x + hi.x) / 2.0,
                    position[1] - (lo.y + hi.y) / 2.0,
                    position[2] - lo.z,
                )
            )
        ),
    )
    return chip


def _family_sheet(out, terrains, name, cols=5, cell=(620, 520)):
    cell_w, cell_h = cell
    frames = []
    for terrain in terrains:
        clear()
        root = append_tile(terrain, (0.0, 0.0, 0.0))
        # Update the depsgraph after placing the tile, or the socket reads
        # (0, 0, 0).
        bpy.context.view_layer.update()
        socket = next(
            (o for o in root.children if naming.socket_terrain(o.name)),
            None,
        )
        if socket is None:
            raise SystemExit(f"{terrain}: no Token_* socket to stand a chip on")
        append_chip_at(socket.matrix_world.translation)
        apply_palette()
        backdrop(-0.26, 20.0, (0.42, 0.43, 0.45))
        light((0.44, 0.46, 0.50))
        setup(cell_w, cell_h, fmt="PNG")
        path = os.path.join(out, f"_family_{terrain.lower()}")
        shoot(path, (0.0, -0.10, 0.30), 11.5, 90.0)
        frames.append(path + ".png")
    stitch(os.path.join(out, name), frames, cols, cell_w, cell_h)
    for f in frames:
        os.remove(f)


def stitch(path, frames, cols, cell_w, cell_h):
    """Lay the rendered cells out as one sheet, top row first."""
    import numpy

    rows = (len(frames) + cols - 1) // cols
    sheet = numpy.zeros((rows * cell_h, cols * cell_w, 4), dtype=numpy.float32)
    sheet[:, :, 3] = 1.0
    for i, frame in enumerate(frames):
        img = bpy.data.images.load(frame)
        px = numpy.array(img.pixels[:], dtype=numpy.float32).reshape(cell_h, cell_w, 4)
        if i == 0:
            # Fill the empty cells with the sky colour read off a corner (the
            # view transform makes a hand-picked grey wrong).
            sheet[:, :, :3] = px[0, 0, :3]
        r, c = divmod(i, cols)
        # Blender's buffers run bottom-up, so row 0 of the sheet is the bottom
        # row of cells.
        top = (rows - 1 - r) * cell_h
        sheet[top:top + cell_h, c * cell_w:(c + 1) * cell_w] = px
        bpy.data.images.remove(img)
    out = bpy.data.images.new("family", cols * cell_w, rows * cell_h, alpha=True)
    out.pixels = sheet.reshape(-1)
    out.file_format = "PNG"
    out.filepath_raw = path
    out.save()
    bpy.data.images.remove(out)
    print("WROTE", path)


def render_board(out):
    """A river out of the mountains and into the swamp, with a road on the joint.

    Two straight channels on cells (0, 0) and (1, 0). Edge 0 of the first is
    edge 3 of the second, and both authored channels open on exactly that pair,
    so the two mouths line up across the gutter with no rotation.
    """
    clear()
    cells = {
        (0, 0): "River_Mountains_E_W_A",
        (1, 0): "River_Swamp_E_W_A",
        (0, -1): "River_Hills_NE_W",
        (1, -1): "Pasture",
        (2, 0): "River_Pasture_E_W_B",
        (0, 1): "Forest",
        (1, 1): "Fields",
        (-1, 0): "Mountains",
    }
    turns = {(0, -1): lattice.edge_turn(2)}
    for cell, terrain in cells.items():
        x, y = lattice.axial_to_xy(*cell)
        append_tile(terrain, (x, y, 0.0), turns.get(cell, 0.0))

    sand = palette()["Mat_Path"]
    mat = bpy.data.materials.new("Mat_Path")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*sand["color"], 1.0)
    bsdf.inputs["Roughness"].default_value = sand["roughness"]
    gutter(list(cells), mat)

    # The road on the shared edge, where the bridge will stand. The lattice edge
    # midpoint is halfway between two cell centres, which is the middle of the
    # gutter rather than the middle of either tile's own edge.
    ax, ay = lattice.axial_to_xy(0, 0)
    bx, by = lattice.axial_to_xy(1, 0)
    seat = Matrix.Translation(Vector(((ax + bx) / 2, (ay + by) / 2, 0.250)))
    for obj in canonical_road():
        obj.matrix_world = seat @ obj.matrix_world

    apply_palette()
    light((0.28, 0.36, 0.46))
    setup(1400, 900)
    mid = ((ax + bx) / 2, (ay + by) / 2, 0.30)
    shoot(os.path.join(out, "board_crossing_tile"), mid, 13.0, 262.0)
    shoot(os.path.join(out, "board_crossing_play"), mid, 24.0, 300.0)
    shoot(os.path.join(out, "board_crossing_low"), mid, 11.0, 200.0, elevation_deg=34.0)


#: Each new tile beside the shipped tile it is a variant of, to check it reads
#: as the same terrain. All nine are paired.
#:
#: The last four pair a mirror against the bend it is drawn from: the same river
#: run the other way, with handed props (the barn's door, the kiln's mouth) not
#: mirrored.
PAIRS = [
    ("swamp", "Pasture", "Swamp"),
    # A mirror against the bend it is drawn from. Check the handed props (the
    # kiln's mouth, the barn's door, the sedge), placed by hand rather than
    # reflected.
    ("mirror_hills_recut", "River_Hills_NE_SW", "River_Hills_NW_SE"),
    ("mirror_pasture_recut", "River_Pasture_NE_SW", "River_Pasture_NW_SE"),
    ("mirror_swamp_recut", "River_Swamp_NE_SW", "River_Swamp_NW_SE"),
    # And each re-cut family against the plain terrain it shares its ground,
    # rim, props and palette with, as a player sees them side by side.
    ("recut_hills", "Hills", "River_Hills_E_W_A"),
    ("recut_hills_bend", "Hills", "River_Hills_E_SW"),
    ("recut_pasture", "Pasture", "River_Pasture_E_W_A"),
    ("recut_pasture_bend", "Pasture", "River_Pasture_E_SW"),
    ("recut_swamp", "Swamp", "River_Swamp_E_W_A"),
    ("recut_swamp_bend", "Swamp", "River_Swamp_E_SW"),
    ("recut_mountains", "Mountains", "River_Mountains_E_W_A"),
    ("recut_mountains_bend", "Mountains", "River_Mountains_E_SW"),
    ("recut_mountains_src", "Mountains", "River_Mountains_Src_NE"),
]



def render_detail(out):
    """Each variant at tile zoom, beside the shipped tile it derives from."""
    for tag, left, right in PAIRS:
        clear()
        append_tile(left, (-3.4, 0.0, 0.0))
        append_tile(right, (3.4, 0.0, 0.0))
        apply_palette()
        backdrop(-0.26, 40.0, (0.42, 0.43, 0.45))
        light((0.44, 0.46, 0.50))
        setup(1500, 780)
        shoot(os.path.join(out, f"pair_{tag}"), (0.0, 0.15, 0.30), 15.5, 270.0)


def render_family_mountains(out):
    """The re-cut mountains, all sixteen, judged the way the shipped ten are.

    Same rig as `family`: from +y (the number's side after the half turn
    every tile takes), with a real chip on every socket, to check that the six
    shapes running past the chip do not cover it.

    All sixteen (including the straight variants and headwaters), judged as a
    set.
    """
    _family_sheet(out, FAMILY_MOUNTAINS, "family_mountains.png", cols=5)


def render_family_hills(out):
    """The re-cut hills, all ten, through the same lens as the other two sheets.

    From +y, with a real chip on every socket. The hills channel is a sharp
    zigzag, the line most likely to double back into its own bank or touch the
    tile edge away from a mouth, which this whole-tile view shows.
    """
    _family_sheet(out, FAMILY_HILLS, "family_hills.png", cols=5)


def render_family_swamp(out):
    """The re-cut swamp, all ten, through the same lens as the other sheets.

    From +y. On the marsh no chit is printed and the robber starts there, so
    the chip stands in for the robber's clearance.

    The marsh is the flattest and darkest terrain, so this also checks the
    channel (0.60 of water, about 12 CSS px at board zoom) reads against the
    bog.
    """
    _family_sheet(out, FAMILY_SWAMP, "family_swamp.png", cols=5)


def render_family_all(out):
    """All forty-seven re-cut tiles on one sheet: four families, nine shapes.

    Smaller cells than the per-family sheets: at 420 across, a tile is about
    its size on a board at zoom 0, where a family that drifted stands out.
    """
    _family_sheet(out, FAMILY_ALL, "family_all.png", cols=7, cell=(420, 350))


def render_family_pasture(out):
    """The re-cut pasture, all ten, through the same lens as the other sheets.

    From +y, with a real chip on every socket. The pasture is the most heavily
    dressed terrain (barn, haystack, gate, walled field, hedge, pond, flock),
    so this also checks that no prop ended up in the channel.
    """
    _family_sheet(out, FAMILY_PASTURE, "family_pasture.png", cols=5)


SUBJECTS = {
    "family_mountains": render_family_mountains,
    "family_hills": render_family_hills,
    "family_pasture": render_family_pasture,
    "family_swamp": render_family_swamp,
    "family_all": render_family_all,
    "board": render_board,
    "detail": render_detail,
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not argv:
        raise SystemExit("usage: ... -- OUTDIR [family_all|board|detail ...]")
    out = argv[0]
    os.makedirs(out, exist_ok=True)
    wanted = argv[1:] or list(SUBJECTS)
    missing = [t for t in FAMILY_ALL
               if t not in naming.TERRAIN_TO_RESOURCE]
    if missing:
        raise SystemExit(f"unregistered terrains {missing}")
    for name in wanted:
        if name not in SUBJECTS:
            raise SystemExit(f"unknown subject {name!r}, expected {list(SUBJECTS)}")
        SUBJECTS[name](out)


main()
