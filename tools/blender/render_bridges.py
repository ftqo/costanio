"""Photograph the Rivers bridge: on the board beside a road, and on its own.

    # the board shots, next to a road and a settlement in the same seat colour
    blender art/board.blend --background --python tools/blender/render_bridges.py \
        -- art/prototypes/bridges board

    # the studio still the review gallery embeds
    blender art/bridges.blend --background --python tools/blender/render_bridges.py \
        -- art/prototypes/bridges hero

The board shot decides whether a bridge is told apart from a road: at 56
degrees of elevation verticals draw at 56% of their length (see
`art/README.md`). It composes a bridge on one edge, a road on the next, and a
settlement on their shared vertex, all in one seat colour, through the
shipping rig.

The pieces are appended from two blends (`art/pieces.blend` and
`art/bridges.blend`), and Blender renames the second copy of each seat
material, so `_unify_seat_materials` merges them back to show one player's
pieces.

Board frames are JPEG (see `art/README.md`); `hero.png` is PNG, a small studio
frame on a flat background.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PIECES = os.path.join(REPO, "art", "pieces.blend")
BRIDGES = os.path.join(REPO, "art", "bridges.blend")

#: The shipping camera, from `frontend/src/lib/board3d/scene.ts`.
FOV_DEG = 32.0
ELEVATION_DEG = 56.0

#: Where a piece stands: `SURFACE.gutter`, the gap fill's top face.
GUTTER_Z = 0.22

#: The plane a piece modelled ON a tile is authored from, which is what
#: `seatY(surface, baseY, scale)` subtracts. See `seating.ts`.
PIECE_BASE_Z = 0.25

#: Drawn sizes, from `frontend/src/lib/board3d/pieceArt.ts`. The bridge takes the
#: road's factor, since it spans an edge too.
ROAD_SCALE = 1.15
SETTLEMENT_SCALE = 2.0
BRIDGE_SCALE = ROAD_SCALE

#: Circumradius the lattice is laid out at (`lattice.LATTICE_SIZE`), restated
#: here so this script needs nothing but bpy.
LATTICE_SIZE = 3.0 + 0.25 / math.sqrt(3.0)

#: The showcase pieces' authored staging, from `tools/blender/anchors.py`:
#: undo the yaw, then subtract the lattice feature each sat on.
LCOL = 3.0 * math.sqrt(3.0) * (LATTICE_SIZE / 3.0)
LHEX = LATTICE_SIZE
STAGED = {
    "Settlement_A": (-math.radians(20.0), (LCOL, LHEX)),
    "Road_A": (-math.pi / 6.0, (LCOL * 0.75, LHEX * 0.75)),
}

ZOOMS = {"play": 20.0, "close": 8.0}

#: Ground-plane bearings to shoot from, in degrees. The bridge is staged on an
#: edge along +y, so 0 is square onto the arch (the usual -90 looks down its
#: length); -45 is the junction from the corner, as a player sees most of them.
AZIMUTHS = (0.0, -45.0)

#: The three board frames, as (filename, zoom, azimuth).
SHOTS = (
    ("play_az0", "play", AZIMUTHS[0]),
    ("play_az1", "play", AZIMUTHS[1]),
    ("close_az0", "close", AZIMUTHS[0]),
)


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if len(argv) < 2 or argv[1] not in {"board", "hero"}:
        raise SystemExit("usage: ... --python render_bridges.py -- OUTDIR {board|hero}")
    os.makedirs(argv[0], exist_ok=True)
    return argv[0], argv[1]


def _corner(angle_deg):
    """A lattice vertex of the hex at the origin."""
    a = math.radians(angle_deg)
    return Vector((LATTICE_SIZE * math.cos(a), LATTICE_SIZE * math.sin(a), 0.0))


def _append(path, prefix):
    """Append (not link) every object named `prefix*` from `path`.

    Appended because `_place` copies and re-poses them, and linked data is
    read-only. A no-op if the open file already carries them.
    """
    if any(o.name.startswith(prefix) for o in bpy.data.objects):
        return
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith(prefix)]
    for obj in [o for o in dst.objects if o is not None]:
        bpy.context.scene.collection.objects.link(obj)
        obj.hide_render = True  # only the clones below are in the shot


def _unify_seat_materials():
    """Collapse `Seat_Body.001` and friends back onto the original.

    Two blends each carry the three shared seat slots, and the second appended
    arrives renamed. See the module docstring.
    """
    for mesh in bpy.data.meshes:
        for slot in mesh.materials:
            if slot is None or "." not in slot.name:
                continue
            base = bpy.data.materials.get(slot.name.rsplit(".", 1)[0])
            if base is not None:
                mesh.materials[mesh.materials.find(slot.name)] = base


def _home(obj):
    """The matrix that brings a staged showcase piece to its reference pose.

    Exactly what `export_assets.recenter` does on the way out: cancel the yaw the
    composition left the piece at, then subtract the lattice feature it was
    modelled on. Anything not in `STAGED` (such as the bridge) gets the
    identity.
    """
    for prefix, (turn, (ax, ay)) in STAGED.items():
        if obj.name.startswith(prefix):
            return Matrix.Rotation(turn, 4, "Z") @ Matrix.Translation(Vector((-ax, -ay, 0.0)))
    return Matrix.Identity(4)


def _place(names, at, yaw_deg, scale):
    """Clone `names` onto `at`, turned and drawn the way the renderer would.

    `seatY(surface, baseY, scale) = surface - scale * baseY` is the z of the
    placement, so the foot lands on the gutter at any scale.
    """
    z = GUTTER_Z - scale * PIECE_BASE_Z
    put = (
        Matrix.Translation(Vector((at.x, at.y, z)))
        @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z")
        @ Matrix.Diagonal((scale, scale, scale, 1.0))
    )
    made = []
    for name in names:
        src = bpy.data.objects[name]
        clone = src.copy()
        clone.data = src.data
        clone.hide_render = False
        bpy.context.scene.collection.objects.link(clone)
        clone.parent = None
        clone.matrix_world = put @ _home(src) @ src.matrix_world
        made.append(clone)
    return made


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


def _light(sky, strength):
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
    bg.inputs[0].default_value = sky
    bg.inputs[1].default_value = strength


def _render_settings(width, height, fmt, quality=90):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = fmt
    if fmt == "JPEG":
        scene.render.image_settings.quality = quality
    if fmt == "PNG":
        # Full compression: the frame is committed, and lossless deflate at
        # 100 is about two thirds the default's size.
        scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = "Standard"


def board(out):
    """The comparison frame: a bridge, a road and a settlement, one seat.

    The two edges share the vertex the settlement stands on, so the three
    pieces meet at one junction as in a game.
    """
    _append(PIECES, "Settlement_A")
    _append(PIECES, "Road_A")
    _append(BRIDGES, "Bridge_")
    _unify_seat_materials()
    _render_settings(1200, 740, "JPEG")
    _light((0.28, 0.36, 0.46, 1), 0.7)

    junction = _corner(30)
    # The midpoints of the two edges of the origin hex that meet at `junction`.
    # A road-shaped piece is authored along +x, so the edge's own bearing is the
    # yaw it is placed at: 90 degrees for the 330-30 edge, which runs along +y,
    # and 150 for the 30-90 edge.
    bridge_at = (_corner(330) + _corner(30)) / 2.0
    road_at = (_corner(30) + _corner(90)) / 2.0

    made = []
    made += _place(
        ["Bridge_span", "Bridge_rails", "Bridge_abutments"], bridge_at, 90.0, BRIDGE_SCALE
    )
    made += _place(["Road_A_wall", "Road_A_trim"], road_at, 150.0, ROAD_SCALE)
    made += _place(
        ["Settlement_A_wall", "Settlement_A_roof", "Settlement_A_trim"],
        junction,
        0.0,
        SETTLEMENT_SCALE,
    )
    print("PLACED", len(made), "objects")

    # Aim at the junction where the three pieces meet.
    target = (junction.x, junction.y, GUTTER_Z + 0.30)
    for name, zoom, az in SHOTS:
        _shoot(os.path.join(out, name), target, ZOOMS[zoom], az)


def hero(out):
    """One clean studio still of the piece alone, for the review gallery.

    A low three-quarter view rather than the board's 56 degrees, for seeing
    the arch, parapets and abutments as shapes. Size is judged on the board
    frames.
    """
    _render_settings(1024, 1024, "PNG")
    _light((0.42, 0.42, 0.44, 1), 1.0)

    # A ground for it to stand on and cast onto, at the piece plane so the
    # abutments sit on it rather than floating over it.
    ground = bpy.data.meshes.new("Ground")
    ground.from_pydata(
        [(-8, -8, PIECE_BASE_Z), (8, -8, PIECE_BASE_Z), (8, 8, PIECE_BASE_Z), (-8, 8, PIECE_BASE_Z)],
        [],
        [(0, 1, 2, 3)],
    )
    mat = bpy.data.materials.new("Mat_Hero_ground")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.38, 0.38, 0.4, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    ground.materials.append(mat)
    bpy.context.scene.collection.objects.link(bpy.data.objects.new("Ground", ground))

    # 22 degrees of elevation and nearly broadside, so the 0.20 x 0.84 arch
    # opening shows daylight through it.
    _shoot(os.path.join(out, "hero"), (0.0, 0.0, PIECE_BASE_Z + 0.16), 3.4, -68.0, 22.0)


def main():
    out, mode = _args()
    (board if mode == "board" else hero)(out)


if __name__ == "__main__":
    main()
