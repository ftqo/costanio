"""Photograph a board piece: on its own, beside the pieces it stands among, and
the whole set in one frame.

    # the gallery frame: one piece, three-quarter, neutral grey, 1024 square
    blender --background --factory-startup \
        --python tools/blender/render_pieces.py -- art/prototypes/camels hero camel

    # the frame a change is decided on: the piece at its drawn size beside a
    # settlement, a road and a knight at theirs, through the board's own camera
    blender --background --factory-startup \
        --python tools/blender/render_pieces.py -- art/prototypes/camels pair camel

    # the survey: every piece in the set, all at drawn scale, one frame
    blender --background --factory-startup \
        --python tools/blender/render_pieces.py -- art/prototypes lineup

This opens no blend: it appends each piece from the file that ships it, to get
several families into one frame. `--factory-startup` keeps the startup cube
and lamp out.

The questions are comparative (does the wagon disappear beside the
settlement, is the trader a stall), so the pair rig is the board's: 32
degrees of vertical FOV at 56 of elevation
(`frontend/src/lib/board3d/scene.ts`), with every piece at the client's
factor (`PIECE_SCALE`/`MODULE_SCALE` in `frontend/src/lib/board3d/pieceArt.ts`).
A second frame at 28 degrees checks the silhouette, which 56 mostly hides.

Pieces are placed by their own bounding box (centred, lowest vertex on the
ground) rather than their object transform, since the showcase blends place
them far from the origin. `anchors.py` is not needed for a lineup.

Board and lineup frames are JPEG (see `render_knight_sword.py`); `hero.png` is
PNG, one small frame the gallery embeds.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ART = os.path.join(REPO, "art")

#: The shipping camera, from `frontend/src/lib/board3d/scene.ts`.
FOV_DEG = 32.0
ELEVATION_DEG = 56.0

#: Where a piece stands: `SURFACE.gutter`, the gap fill's top face. Everything
#: in these frames is on flat ground, so one plane serves for all of them.
GROUND_Z = 0.0

#: Lattice circumradius (`lattice.LATTICE_SIZE`), restated so this script needs
#: nothing but bpy.
LATTICE_SIZE = 3.0 + 0.25 / math.sqrt(3.0)

#: family -> (blend, object prefix, drawn scale, slot). The scale is the
#: client's own factor for that piece; see the module docstring. The slot is
#: where the piece stands on a board (edge, vertex or hex), used by `board`
#: mode.
PIECES = {
    "road": ("pieces.blend", "Road_A", 1.15, "edge"),
    "settlement": ("pieces.blend", "Settlement_A", 2.0, "vertex"),
    "city": ("pieces.blend", "City_A", 2.58, "vertex"),
    "robber": ("pieces.blend", "Robber_", 1.5, "hex"),
    "ship": ("ships.blend", "Ship_route", 1.15, "edge"),
    "knight": ("knights.blend", "Knight_basic", 2.0, "vertex"),
    "trader": ("trader.blend", "Trader_merchant", 1.5, "hex"),
    # The candidate stall, wired to nothing. See `TRADER_CANDIDATE` in
    # frontend/src/lib/board3d/loader.ts.
    "trader v2": ("trader_v2.blend", "Trader2_merchant", 1.5, "hex"),
    "bridge": ("bridges.blend", "Bridge_", 1.15, "edge"),
    "camel": ("camels.blend", "Camel_", 1.0, "edge"),
    "waypost": ("spokes.blend", "Spoke_", 1.0, "edge"),
    "wagon": ("wagons.blend", "Wagon_", 1.5, "vertex"),
    "rider": ("riders.blend", "Rider_", 1.15, "edge"),
    "cargo ship": ("vessels.blend", "Cargo_", 1.15, "edge"),
    "corsair": ("vessels.blend", "Corsair_", 1.5, "hex"),
    "raider": ("barbarians.blend", "Barbarian_", 1.4, "hex"),
    "quay": ("harbors.blend", "Harbor_", 2.0, "hex"),
    "settler": ("harbors.blend", "Settler_", 1.15, "hex"),
    "crew": ("harbors.blend", "Crew_", 1.15, "hex"),
    "fish haul": ("cargo.blend", "Haul_", 1.15, "hex"),
    "spice sack": ("cargo.blend", "Spice_", 1.15, "hex"),
    "mission": ("cargo.blend", "Marker_", 2.0, "hex"),
}

#: The survey, three rows of seven. Row order is roughly "shipped first": the
#: base game and Knights, then the pieces that stand on a path or in water,
#: then the small ones that sit in a hold.
LINEUP = (
    ("road", "settlement", "city", "ship", "knight", "trader", "trader v2", "robber"),
    ("bridge", "camel", "waypost", "wagon", "rider", "cargo ship", "corsair"),
    ("quay", "settler", "crew", "fish haul", "spice sack", "mission", "raider"),
)
LINEUP_PITCH = 1.5
LINEUP_ROW = 2.9

#: The pair frame's cast: a settlement and a road (most pieces share a junction
#: or edge with one) and a knight (the reference figure).
PAIR_CAST = ("settlement", "road", "knight")
PAIR_PITCH = 1.6


#: `before` mode: piece -> (its PIECES key, the drawn scale the OLD art had).
#:
#: The scale is listed because it may differ from the current one (the wagon's
#: art is unchanged but its factor went 1 -> 1.5).
BEFORE = {
    "camel": ("camel", 1.0),
    "wagon": ("wagon", 1.0),
    "haul": ("fish haul", 1.15),
    "sack": ("spice sack", 1.15),
    "trader": ("trader v2", 1.5),
    "raider": ("raider", 1.4),
}

#: `before` mode: the old art's object prefix, when it differs from the new
#: one's (`Trader_merchant` against `Trader2_merchant`; see `TRADER_CANDIDATE`
#: in frontend/src/lib/board3d/loader.ts).
BEFORE_PREFIX = {"trader": "Trader_merchant"}


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    modes = {"hero", "pair", "board", "lineup", "before"}
    if len(argv) < 2 or argv[1] not in modes:
        raise SystemExit(
            "usage: ... --python render_pieces.py -- OUTDIR "
            "hero|pair|board|lineup [FAMILY] | before PIECE OLD.glb"
        )
    if argv[1] != "lineup" and len(argv) < 3:
        raise SystemExit("that mode needs a piece name: " + ", ".join(sorted(PIECES)))
    if argv[1] == "before" and len(argv) < 4:
        raise SystemExit("before needs the OLD .glb: ... before camel /tmp/camels_old.glb")
    os.makedirs(argv[0], exist_ok=True)
    return argv[0], argv[1], (argv[2] if len(argv) > 2 else None), (argv[3] if len(argv) > 3 else None)


_LOADED = {}


def _source(name):
    """Append every object of one piece, once, hidden from every render."""
    if name not in _LOADED:
        blend, prefix = PIECES[name][:2]
        with bpy.data.libraries.load(os.path.join(ART, blend), link=False) as (src, dst):
            dst.objects = [n for n in src.objects if n.startswith(prefix)]
        objs = [o for o in dst.objects if o is not None and o.type == "MESH"]
        if not objs:
            raise SystemExit(f"nothing named {prefix} in {blend}")
        for obj in objs:
            bpy.context.scene.collection.objects.link(obj)
            obj.hide_render = True  # only the clones below are photographed
        _LOADED[name] = objs
    return _LOADED[name]


def _bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objs:
        for vert in obj.data.vertices:
            world = obj.matrix_world @ vert.co
            for axis in range(3):
                lo[axis] = min(lo[axis], world[axis])
                hi[axis] = max(hi[axis], world[axis])
    return lo, hi


_IMPORTED = {}


def _import_glb(path, prefix):
    """Every object named `prefix*` out of a shipped .glb, once, hidden.

    `before` mode's other half: the old art comes from the shipped .glb in git
    (Blender reads meshopt directly). It arrives Z-up and named as the loader
    sees it, and is placed by the same rule as the new half.
    """
    key = (path, prefix)
    if key not in _IMPORTED:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        objs = [
            o
            for o in bpy.data.objects
            if o not in before and o.type == "MESH" and o.name.startswith(prefix)
        ]
        if not objs:
            raise SystemExit(f"nothing named {prefix} in {path}")
        for obj in bpy.data.objects:
            if obj not in before:
                obj.hide_render = True
        _IMPORTED[key] = objs
    return _IMPORTED[key]


def _place(name, at, yaw=0.0):
    """Clone one piece onto `at`, at its drawn size, standing on the ground."""
    return _stage(_source(name), PIECES[name][2], at, yaw, name)


def _stage(objs, scale, at, yaw, label):
    """Clone `objs` onto `at` at `scale`, bbox centred, lowest vertex on 0."""
    lo, hi = _bounds(objs)
    home = Matrix.Translation(
        (-(lo.x + hi.x) / 2.0, -(lo.y + hi.y) / 2.0, -lo.z)
    )
    put = (
        Matrix.Translation((at[0], at[1], GROUND_Z))
        @ Matrix.Rotation(yaw, 4, "Z")
        @ Matrix.Diagonal((scale, scale, scale, 1.0))
        @ home
    )
    made = []
    for obj in objs:
        clone = obj.copy()
        clone.data = obj.data
        bpy.context.scene.collection.objects.link(clone)
        clone.parent = None
        clone.hide_render = False
        clone.matrix_world = put @ obj.matrix_world
        made.append(clone)
    print("PIECE", label, "drawn height", round((hi.z - lo.z) * scale, 3))
    return made


def _label(text, at):
    """The piece's name, lying on the ground beside it."""
    curve = bpy.data.curves.new(text, type="FONT")
    curve.body = text
    curve.align_x = "CENTER"
    curve.size = 0.16
    obj = bpy.data.objects.new(text, curve)
    obj.location = (at[0], at[1], 0.002)
    obj.data.materials.append(_material("LineupInk", (0.24, 0.24, 0.26)))
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _material(name, rgb, rough=0.95):
    made = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    made.use_nodes = True
    bsdf = made.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    return made


def _floor(size, rgb=(0.36, 0.36, 0.38)):
    mesh = bpy.data.meshes.new("Floor")
    mesh.from_pydata(
        [(-size, -size, 0), (size, -size, 0), (size, size, 0), (-size, size, 0)],
        [],
        [(0, 1, 2, 3)],
    )
    mesh.materials.append(_material("PieceFloor", rgb))
    obj = bpy.data.objects.new("Floor", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _light(sky=(0.42, 0.42, 0.44, 1.0), strength=1.0):
    scene = bpy.context.scene
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
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes["Background"]
    background.inputs[0].default_value = sky
    background.inputs[1].default_value = strength


def _settings(width, height, fmt, quality=90):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = fmt
    if fmt == "JPEG":
        scene.render.image_settings.quality = quality
    else:
        # No alpha and maximum deflate.
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = "Standard"


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


def _wipe():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    _LOADED.clear()


def hero(out, family):
    _wipe()
    _settings(1024, 1024, "PNG")
    _light()
    # Wide enough that the far edge stays outside a 32 degree frame at any of
    # the distances below.
    _floor(40.0)
    made = _place(family, (0.0, 0.0))
    lo, hi = _bounds(made)
    # Frame the bounding sphere, not the longest edge: in a square frame the
    # diagonal sets the distance. 1.12 is the margin.
    radius = (hi - lo).length / 2.0
    _shoot(
        os.path.join(out, "hero"),
        (0.0, 0.0, (lo.z + hi.z) / 2.0),
        1.12 * radius / math.tan(math.radians(FOV_DEG) / 2.0),
        -38.0,
        26.0,
    )


def pair(out, family):
    """The subject beside the cast, at 56 degrees and again at 28."""
    _wipe()
    _settings(1200, 560, "JPEG")
    _light()
    _floor(14.0)

    marks = [*PAIR_CAST, family]
    made = []
    for i, name in enumerate(marks):
        # No yaw: the camera sits at -y, so every piece (authored along +x) is
        # in profile.
        made.extend(_place(name, (i * PAIR_PITCH, 0.0)))
    lo, hi = _bounds(made)
    span = (lo.x + hi.x) / 2.0
    for label, elevation in (("pair_pieces", ELEVATION_DEG), ("pair_pieces_low", 28.0)):
        _shoot(os.path.join(out, label), (span, 0.0, 0.5), 7.2, -90.0, elevation)


def _hex_plate(centre, colour):
    """One plain tile: the lattice hexagon, flat, with a gutter round it.

    Plain rather than real terrain, since this frame is about size and
    spacing, and tile art would dominate.
    """
    apothem = LATTICE_SIZE * 0.94
    verts = [
        (
            centre[0] + apothem * math.cos(math.radians(60 * i)),
            centre[1] + apothem * math.sin(math.radians(60 * i)),
            0.0,
        )
        for i in range(6)
    ]
    mesh = bpy.data.meshes.new("Plate")
    mesh.from_pydata(verts, [], [tuple(range(6))])
    mesh.materials.append(_material("PiecePlate", colour))
    obj = bpy.data.objects.new("Plate", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def board(out, family):
    """Three of the piece where a board would put them, on plain tiles.

    A chain of camels down three edges, three raiders on one hex, a wagon and
    its neighbours at a junction: checks that three read as three.
    """
    _wipe()
    _settings(1400, 900, "JPEG")
    # Darker than the studio ground: two suns at Standard view transform blow
    # a pale plate out to white.
    _light(sky=(0.34, 0.36, 0.40, 1.0), strength=0.8)
    _floor(30.0, (0.30, 0.27, 0.21))

    slot = PIECES[family][3]
    step = Vector((LATTICE_SIZE * math.sqrt(3.0), 0.0, 0.0))
    centres = [Vector((0.0, 0.0, 0.0)), step, step * 0.5 + Vector((0.0, LATTICE_SIZE * 1.5, 0.0))]
    for centre in centres:
        _hex_plate(centre, (0.50, 0.45, 0.33))

    if slot == "hex":
        marks = [(c.x, c.y, 0.0) for c in centres]
    else:
        # The three edges the tiles share, which is where a caravan chain, a
        # road or a rider goes. `_place` turns each piece onto its edge's own
        # bearing, as `edgeRotationY` does.
        marks = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            mid = (centres[a] + centres[b]) / 2.0
            marks.append((mid.x, mid.y, math.atan2(*(centres[b] - centres[a]).yx)))
    for x, y, yaw in marks:
        _place(family, (x, y), yaw=yaw)

    mid = sum(centres, Vector()) / len(centres)
    _shoot(os.path.join(out, "board"), (mid.x, mid.y, 0.3), 12.0, -90.0)


def before(out, piece, old_glb):
    """What shipped and what replaced it, on two tiles, at one camera.

    Both halves get the same tile, reference pieces, light and camera; only
    the mesh and, where it moved, the drawn factor differ. Both are anchored
    by the same rule (bounding box centred on the mark, lowest vertex on the
    ground).
    """
    key, old_scale = BEFORE[piece]
    new_prefix = PIECES[key][1]
    old_prefix = BEFORE_PREFIX.get(piece, new_prefix)
    new_scale = PIECES[key][2]

    _wipe()
    _settings(1500, 780, "JPEG")
    _light(sky=(0.34, 0.36, 0.40, 1.0), strength=0.8)
    _floor(30.0, (0.30, 0.27, 0.21))

    step = LATTICE_SIZE * math.sqrt(3.0)
    for side, centre in (("before", -step / 2.0), ("after", step / 2.0)):
        _hex_plate((centre, 0.0), (0.50, 0.45, 0.33))
        # The cast, at the client's factors.
        _place("settlement", (centre - 1.25, 1.25))
        _place("knight", (centre + 1.25, 1.25))
        # An edge piece gets the road under it (straddling it sizes the piece;
        # see `MODULE_SCALE.camel`); others get the road beside them.
        _place("road", (centre, -0.55 if PIECES[key][3] == "edge" else 0.45))
        if side == "before":
            _stage(_import_glb(old_glb, old_prefix), old_scale, (centre, -0.55), 0.0, "old")
        else:
            _stage(_source(key), new_scale, (centre, -0.55), 0.0, "new")
        _label(side, (centre, -1.75))

    _shoot(os.path.join(out, piece), (0.0, -0.35, 0.35), 11.5, -90.0)


def lineup(out):
    _wipe()
    _settings(1800, 900, "JPEG")
    _light()
    _floor(20.0)

    for r, row in enumerate(LINEUP):
        y = (len(LINEUP) - 1 - r) * LINEUP_ROW
        # Centred on its own length, since rows differ in length.
        for c, name in enumerate(row):
            x = (c - (len(row) - 1) / 2.0) * LINEUP_PITCH
            _place(name, (x, y))
            _label(name, (x, y - 1.45))
    centre = ((len(LINEUP) - 1) * LINEUP_ROW) / 2.0
    _shoot(os.path.join(out, "pieces-lineup"), (0.0, centre - 0.75, 0.35), 18.5, -90.0, 42.0)


def main():
    out, mode, family, old_glb = _args()
    if mode == "lineup":
        lineup(out)
    elif mode == "before":
        if family not in BEFORE:
            raise SystemExit("unknown before/after piece: " + ", ".join(sorted(BEFORE)))
        before(out, family, old_glb)
    elif family not in PIECES:
        raise SystemExit("unknown piece: " + ", ".join(sorted(PIECES)))
    elif mode == "hero":
        hero(out, family)
    elif mode == "board":
        board(out, family)
    else:
        pair(out, family)


main()
