"""Photograph the Explorers cargo, alone and on the board.

    # the review hero: all three pieces, 3/4, neutral grey, 1024 square
    blender art/cargo.blend --background --factory-startup \
        --python tools/blender/render_cargo.py -- art/prototypes/cargo hero

    # on the real tiles, through the game's camera
    blender art/board.blend --background \
        --python tools/blender/render_cargo.py -- art/prototypes/cargo board

The hero is a studio shot for the review gallery. The board shots use the rig
of `render_docks.py` and `render_knight_sword.py` (32 degrees of vertical FOV
at 56 degrees of elevation), where verticals draw at 56% of their length.

Each board frame is shot at the three `SCALES` (1.0, 2.5, 4.0) to check the
shape survives each distance. `MODULE_SCALE.cargoPiece` is 1.15, sized to the
ship's hold (0.34 x 0.18), the tighter host. The settlement in the land frames
is drawn at its `PIECE_SCALE`, 2.0.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
CARGO = os.path.join(REPO, "art", "cargo.blend")
PIECES = os.path.join(REPO, "art", "pieces.blend")

FOV_DEG = 32.0
ELEVATION_DEG = 56.0

#: Authored size, and a candidate hex-centre size. See the module docstring.
SCALES = {"hold": 1.0, "hex": 2.5, "shoal": 4.0}

#: How a pile of sacks is laid out, from `cargo_kit` (restated here).
SACK_PITCH = 0.125
SACK_TIER = 0.112
MARKER_STACK = 0.080


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if len(argv) < 2 or argv[1] not in {"hero", "board"}:
        raise SystemExit("usage: ... -- OUTDIR {hero|board}")
    os.makedirs(argv[0], exist_ok=True)
    return argv[0], argv[1]


def _light(scene, sky, strength):
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
    bg.inputs[0].default_value = (*sky, 1)
    bg.inputs[1].default_value = strength


def _scene(width, height, fmt="JPEG"):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = fmt
    if fmt == "JPEG":
        scene.render.image_settings.quality = 92
    else:
        # 8-bit RGB, fully compressed: the default is far larger, and this file
        # is not in LFS.
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.color_depth = "8"
        scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = "Standard"
    return scene


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


#: The authored parts, captured before anything is copied. Every source in
#: this file is hidden from the render and re-instanced; copies are named like
#: `Haul_fish_a.001`, so a prefix search would find them too.
SOURCES = {}


def _index(*prefixes):
    """Remember the authored parts under `prefixes` and hide them."""
    for obj in list(bpy.data.objects):
        if obj.type == "MESH" and obj.library is None and obj.name.startswith(prefixes):
            SOURCES.setdefault(obj.name, obj)
            obj.hide_render = True


def _copy(name, at, scale=1.0, turn=0.0):
    """One more instance of an authored part, placed. Shares the mesh data."""
    obj = SOURCES[name].copy()
    bpy.context.scene.collection.objects.link(obj)
    obj.location = at
    obj.scale = (scale, scale, scale)
    obj.rotation_euler = (0.0, 0.0, turn)
    # Explicitly, because the source it was copied from is hidden.
    obj.hide_render = False
    return obj


def _piece(prefix, at, scale=1.0, turn=0.0):
    """Every part of one piece, moved together. Returns the new objects."""
    return [_copy(name, at, scale, turn) for name in sorted(SOURCES) if name.startswith(prefix)]


def _append(path, prefixes):
    """Append (not link) every object under `prefixes` from another blend."""
    with bpy.data.libraries.load(path) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith(prefixes)]
    loaded = [o for o in dst.objects if o is not None]
    for obj in loaded:
        bpy.context.scene.collection.objects.link(obj)
    print("APPENDED", len(loaded), "from", os.path.relpath(path, REPO))
    return loaded


# --- the hero --------------------------------------------------------------


def hero(out):
    """All three pieces, side by side on a neutral ground, in one square frame."""
    scene = _scene(1024, 1024, fmt="PNG")
    _light(scene, sky=(0.42, 0.43, 0.45), strength=1.1)

    # A ground plane for the pieces to cast shadows onto.
    mesh = bpy.data.meshes.new("Ground")
    mesh.from_pydata(
        [(-4, -4, 0), (4, -4, 0), (4, 4, 0), (-4, 4, 0)], [], [(0, 1, 2, 3)]
    )
    mat = bpy.data.materials.new("Mat_Studio_ground")
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.34, 0.35, 0.36, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    mesh.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = False
    bpy.context.scene.collection.objects.link(bpy.data.objects.new("Ground", mesh))

    # The authored copies are parked apart by `cargo_kit.LAYOUT`; hide them and
    # compose the group from fresh copies.
    _index("Haul_", "Spice_", "Marker_")

    shown = []
    # The haul, turned a little off the axis so its length is not foreshortened
    # into a lump by the three-quarter view.
    shown += _piece("Haul_", (-0.30, 0.0, 0.0), turn=math.radians(14))
    # Two sacks, at the pitch a hold seats them at.
    for k in (-0.5, 0.5):
        shown += _piece("Spice_", (0.0, k * SACK_PITCH, 0.0), turn=math.radians(37 * k))
    # Three markers, stacked at exactly the piece height. Turned against each
    # other so the facets do not line up into one drum.
    for i in range(3):
        shown += _piece("Marker_", (0.30, 0.0, i * MARKER_STACK), turn=math.radians(11 * i))

    # Update the depsgraph first: a freshly linked copy's `matrix_world` is
    # stale until then.
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in shown for c in o.bound_box]
    lo = Vector((min(p[i] for p in pts) for i in range(3)))
    hi = Vector((max(p[i] for p in pts) for i in range(3)))
    # Aimed a little below the middle of the group, so the low haul is not
    # pushed into a corner.
    target = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z + 0.3 * (hi.z - lo.z)))
    radius = max(hi.x - lo.x, hi.y - lo.y) / 2
    dist = radius / math.tan(math.radians(FOV_DEG / 2)) * 1.15
    # 34 degrees rather than the board's 56, for form. Near-broadside so the
    # row of three reads across the frame.
    _shoot(os.path.join(out, "hero"), target, dist, azimuth_deg=256.0, elevation_deg=34.0)


# --- the board -------------------------------------------------------------

#: The two tiles the frames are staged on, and what goes there, read from the
#: linked assembly by name rather than position.
SEA_TILE = "Hex_Ocean"
LAND_TILE = "Hex_Pasture"


#: The lattice hex radius, from `lattice.LATTICE_SCALE * 3.0`. The settlement's
#: anchor in `anchors.RULES` is stated in exactly these units.
LHEX = 3.1443
#: The showcase yaw baked into `Settlement_A`'s mesh, which `anchors.
#: AUTHORED_TURN` cancels on export. Cancelled here too.
SETTLEMENT_ANCHOR = (5.4457, LHEX)
SETTLEMENT_TURN = -20.0
#: `pieceArt.PIECE_SCALE.settlement`, the authored base it lifts, and the
#: gutter it stands on (`gapGeometry.SAND_Y`). Drawn size, not authored.
SETTLEMENT_SCALE = 2.0
SETTLEMENT_BASE = 0.25
GUTTER_Z = 0.220


def _ground_at(x, y, fallback):
    """Where a downward ray lands, so props sit on sculpted terrain not through it."""
    hit, at, *_ = bpy.context.scene.ray_cast(
        bpy.context.view_layer.depsgraph, (x, y, 4.0), (0.0, 0.0, -1.0)
    )
    return at.z if hit else fallback


def _settlement(target):
    """The stock settlement, brought home to `target` and turned square.

    The same three steps as `export_assets.recenter` (subtract the anchor,
    cancel the authored yaw, set it down), since the mesh carries its showcase
    position and turn.
    """
    # Plus the drawn scale, taken about the anchor, and the lift `seating.ts`
    # would solve for: `surface = y + scale * baseY`.
    lift = GUTTER_Z - SETTLEMENT_SCALE * SETTLEMENT_BASE
    home = (
        Matrix.Translation(Vector((target[0], target[1], lift)))
        @ Matrix.Rotation(math.radians(SETTLEMENT_TURN), 4, "Z")
        @ Matrix.Scale(SETTLEMENT_SCALE, 4)
        @ Matrix.Translation(Vector((-SETTLEMENT_ANCHOR[0], -SETTLEMENT_ANCHOR[1], 0.0)))
    )
    out = []
    for name in sorted(SOURCES):
        if not name.startswith("Settlement_A"):
            continue
        obj = _copy(name, (0, 0, 0))
        obj.matrix_world = home @ SOURCES[name].matrix_world
        out.append(obj)
    return out


def board(out):
    scene = _scene(1200, 800)
    _light(scene, sky=(0.28, 0.36, 0.46), strength=0.7)
    for obj in bpy.data.objects:
        if obj.name.startswith("Ref_"):
            obj.hide_render = True

    _append(CARGO, ("Haul_", "Spice_", "Marker_"))
    _append(PIECES, ("Settlement_A",))
    _index("Haul_", "Spice_", "Marker_", "Settlement_A")
    bpy.context.view_layer.update()

    sea = bpy.data.objects[SEA_TILE].matrix_world.translation
    land = bpy.data.objects[LAND_TILE].matrix_world.translation
    # Measured: the sea tile has a lattice-cell scale and a -0.05 sink, and the
    # pasture's ground is sculpted.
    corner = (land.x, land.y + LHEX)  # the tile's north vertex
    # Clear of the number chip, a disc of radius 1.0 at (0, +1.5) keeping 1.05
    # clear.
    pile = (land.x + 1.35, land.y + 0.75)
    sea_z = _ground_at(sea.x, sea.y, 0.16)
    land_z = _ground_at(*pile, 0.25)

    for tag, scale in SCALES.items():
        staged = []
        # The haul on a fish shoal: dead centre of a sea hex.
        staged += _piece("Haul_", (sea.x, sea.y, sea_z), scale, turn=math.radians(20))

        # The settlement, as a scale reference: 0.45 across and 0.40 tall.
        staged += _settlement(corner)

        # Four sacks: three in a triangle and one in the valley between them,
        # which is the pile `cargo_kit` recommends.
        pitch = SACK_PITCH * scale
        for dx, dy in ((-0.5, -0.29), (0.5, -0.29), (0.0, 0.58)):
            staged += _piece(
                "Spice_",
                (pile[0] + dx * pitch, pile[1] + dy * pitch, land_z),
                scale,
                turn=math.radians(140 * dx + 40 * dy),
            )
        staged += _piece("Spice_", (pile[0], pile[1], land_z + SACK_TIER * scale), scale)

        # And a stack of markers beside them, whose height is hardest to judge
        # from a hero shot.
        for i in range(3):
            staged += _piece(
                "Marker_",
                (pile[0] + 0.5, pile[1] - 0.4, land_z + i * MARKER_STACK * scale),
                scale,
                turn=math.radians(11 * i),
            )

        for name, target, dist in (
            ("sea", (sea.x, sea.y, sea_z), 7.0),
            ("land", ((pile[0] + corner[0]) / 2, (pile[1] + corner[1]) / 2, land_z), 8.0),
        ):
            _shoot(os.path.join(out, f"{name}_{tag}"), target, dist, azimuth_deg=270.0)

        for obj in staged:
            bpy.data.objects.remove(obj, do_unlink=True)


def main():
    out, mode = _args()
    (hero if mode == "hero" else board)(os.path.join(REPO, out) if not os.path.isabs(out) else out)


main()
