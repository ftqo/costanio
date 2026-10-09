"""Photograph the three knights, both sword states, at board scale.

    blender art/board.blend --background --python tools/blender/render_knight_sword.py \
        -- art/prototypes/knight-sword

`art/board.blend` is the linked assembly of the eleven per-tile files (`make
board`); the knights are appended from `art/knights.blend`.

Judge changes to the sword's proportions on this output, which matches the
game:

- The rig: 32 degrees of vertical FOV (`CAMERA_FOV_DEG`) and 56 degrees of
  elevation (`CAMERA_TILT_DEG`). Verticals draw at 56% of their length, which
  an orthographic elevation hides.
- The scale: knights are cloned onto real lattice vertices at
  `MODULE_SCALE.knight` = 2.0, beside hexes, chips and roads.
- Three zooms and two azimuths: `board` frames roughly a whole board, `play`
  is where a player sits, `close` shows the hand and grip. The crossguard is
  in the figure's fixed plane, so it goes from broadside to edge-on as the
  board orbits.

Writes `<state>_<zoom>_az<n>.jpg` into the directory named after `--`. JPEG at
quality 90 keeps the thirteen-frame set under 2MB (PNG would be about 30MB per
pass in history).
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

#: Drawn size of a knight, from `frontend/src/lib/board3d/pieceArt.ts`.
PIECE_SCALE = 2.0

#: Where a piece stands: `SURFACE.gutter`, the gap fill's top face.
GUTTER_Z = 0.22

#: The shipping camera, from `frontend/src/lib/board3d/scene.ts`.
FOV_DEG = 32.0
ELEVATION_DEG = 56.0

#: Circumradius the lattice is laid out at (`lattice.LATTICE_SIZE`), restated
#: here so this script needs nothing but bpy.
LATTICE_SIZE = 3.0 + 0.25 / math.sqrt(3.0)

LEVELS = ("basic", "strong", "mighty")

#: Distances to shoot from, and what each is for. See the docstring.
ZOOMS = {"board": 46.0, "play": 22.0, "close": 9.0}

#: Ground-plane bearings to shoot from, in degrees. Two, because the sword's
#: plane is fixed in the model and the board orbits.
AZIMUTHS = (-90.0, -25.0)


def _outdir():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if not argv:
        raise SystemExit("usage: ... --python render_knight_sword.py -- OUTDIR")
    os.makedirs(argv[0], exist_ok=True)
    return argv[0]


def _vertex_xy(angle_deg):
    """A lattice vertex of the hex at the origin. See `edit_geometry`'s ring."""
    a = math.radians(angle_deg)
    return LATTICE_SIZE * math.cos(a), LATTICE_SIZE * math.sin(a)


#: Three vertices of the origin hex: a real junction of three land tiles on the
#: showcase board, so each knight has tile art and a number chip beside it.
SPOTS = [_vertex_xy(a) for a in (330, 30, 90)]


def _light(scene):
    """Sun over the camera's shoulder plus a fill, so the blade is lit."""
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


def _place(state):
    """One knight per spot, drawn at piece scale, holding `state`'s sword."""
    scene = bpy.context.scene
    made = []
    for level, (x, y) in zip(LEVELS, SPOTS):
        body = bpy.data.objects[f"Knight_{level}"]
        sword = bpy.data.objects[f"Knight_sword_{level}_{state}"]
        at = Matrix.Translation((x, y, GUTTER_Z)) @ Matrix.Diagonal(
            (PIECE_SCALE, PIECE_SCALE, PIECE_SCALE, 1.0)
        )
        clone = body.copy()
        clone.data = body.data
        scene.collection.objects.link(clone)
        clone.parent = None
        clone.matrix_world = at
        held = sword.copy()
        held.data = sword.data
        scene.collection.objects.link(held)
        held.hide_render = False
        held.parent = clone
        held.matrix_parent_inverse = clone.matrix_world.inverted()
        # The blend authors a sword at its grip, as a child of its knight, so its
        # own local transform is exactly the offset that puts it in the hand.
        held.matrix_world = clone.matrix_world @ sword.matrix_local
        made.extend([clone, held])
    return made


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


#: Where the knights are authored, one blend one asset.
KNIGHTS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "art",
    "knights.blend",
)


def _append_knights():
    """Append (not link) every Knight_* object from art/knights.blend.

    Appended rather than linked because `_place` copies the bodies and re-parents
    the swords, and linked data is read-only. A no-op if the open file already
    carries them.
    """
    if any(o.name.startswith("Knight_") for o in bpy.data.objects):
        return
    with bpy.data.libraries.load(KNIGHTS) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith("Knight_")]
    loaded = [o for o in dst.objects if o is not None]
    for obj in loaded:
        bpy.context.scene.collection.objects.link(obj)
    print("APPENDED", len(loaded), "knight objects from", KNIGHTS)


def main():
    out = _outdir()
    _append_knights()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    # 1200 wide is enough to judge a silhouette against a hex.
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 740
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    _light(scene)

    # Hide the swords staged in the blend; only the clones below are shown.
    for obj in bpy.data.objects:
        if obj.name.startswith("Knight_sword_"):
            obj.hide_render = True

    target = (
        sum(p[0] for p in SPOTS) / 3.0,
        sum(p[1] for p in SPOTS) / 3.0,
        GUTTER_Z + 0.7,
    )
    for state, label in (("dark", "atease"), ("gold", "raised")):
        made = _place(state)
        for zoom, dist in ZOOMS.items():
            for i, az in enumerate(AZIMUTHS):
                _shoot(os.path.join(out, f"{label}_{zoom}_az{i}"), target, dist, az)
        for obj in made:
            bpy.data.objects.remove(obj, do_unlink=True)

    # And the bodies alone, as `thumbnail.ts` and `ghostMesh.ts` draw them (the
    # `Knight_basic` prefix does not match `Knight_sword_basic`).
    made = _place("dark")
    for obj in made:
        if obj.name.startswith("Knight_sword_"):
            obj.hide_render = True
    _shoot(os.path.join(out, "swordless_close_az0"), target, 9.0, AZIMUTHS[0])
    for obj in made:
        bpy.data.objects.remove(obj, do_unlink=True)


main()
