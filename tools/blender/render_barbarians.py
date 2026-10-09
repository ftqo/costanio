"""Photograph the raider: on the board, beside its family, and on its own.

    blender art/board.blend --background --factory-startup \
        --python tools/blender/render_barbarians.py -- art/prototypes/barbarians board
    blender art/barbarians.blend --background --factory-startup \
        --python tools/blender/render_barbarians.py -- art/prototypes/barbarians hero
    blender --background --factory-startup \
        --python tools/blender/render_barbarians.py -- art/prototypes/barbarians family

Three modes:

`board` stands the figure where the two expansions put it (three mustering on
a coastal hex, one across a road edge) beside a settlement, through the game's
rig: 32 degrees of vertical FOV and 56 degrees of elevation
(`frontend/src/lib/board3d/scene.ts`). At that elevation verticals draw at 56%
of their length, so size decisions are made here. The rig is borrowed from
`tools/blender/render_knight_sword.py`.

`family` stands the raider beside the knight, trader, settler and rider, each
at its own drawn scale, on flat grey through the same rig. Re-shoot it before
changing this piece.

`hero` is one figure, three-quarter view, neutral grey, for silhouette and
palette only, not size.

`BARBARIAN_SCALE` below must equal `MODULE_SCALE.raider` in the client
(`barbarianArt.test.ts` reads it from there), so the stills in
`art/prototypes/barbarians/` match a real board.

Board frames are JPEG (whole-board rasters would bloat history as PNG; see
`render_knight_sword.py`); the hero is PNG.
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

#: Where a piece stands. `SURFACE.gutter` is the gap fill's top face and
#: `SURFACE.land` a tile slab's (see `frontend/src/lib/board3d/seating.ts`).
#: A barbarian on a road edge stands in the gutter; three on a hex stand on the
#: tile, 0.03 higher.
GUTTER_Z = 0.22
LAND_Z = 0.25

#: Lattice circumradius (`lattice.LATTICE_SIZE`) and the apothem it generates,
#: restated so this script needs nothing but bpy.
LATTICE_SIZE = 3.0 + 0.25 / math.sqrt(3.0)
LATTICE_APOTHEM = LATTICE_SIZE * math.sqrt(3.0) / 2.0

#: Drawn size of a raider, and `MODULE_SCALE.raider` in the client. Authored
#: 0.92 tall, so this puts it at 1.29 on the board: a sixth taller than a drawn
#: knight (0.55 x MODULE_SCALE.knight = 1.10) and well short of the robber
#: (1.5 x 1.5 = 2.25).
BARBARIAN_SCALE = 1.4

#: The muster: three barbarians on one hex, as Raiders stacks them.
#:
#: Splayed on a small circle in a triangle, each facing outward, so the three
#: stay countable (a row reads as one object, a stack as a tower) and the axe
#: falls between neighbours.
#:
#: `MUSTER_SHIFT` pushes the group south of the hex centre to keep the axe out
#: of the chip's keep-clear disc ((0, +1.5), radius 1.05): the nearest reach is
#: 1.267 from the mount and the furthest corner 1.527 from the hex centre.
#: `barbarianArt.test.ts` recomputes both from the shipped .glb.
MUSTER_RADIUS = 0.45
MUSTER_SHIFT = (0.0, -0.60)
MUSTER_BEARINGS = (90.0, 210.0, 330.0)


MODES = ("board", "hero", "family")


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) < 2 or argv[1] not in MODES:
        raise SystemExit(
            "usage: ... --python render_barbarians.py -- OUTDIR " + "|".join(MODES)
        )
    os.makedirs(argv[0], exist_ok=True)
    return argv[0], argv[1]


def _append(blend, prefix):
    """Append (not link) every object named `prefix*` from `blend`.

    Appended because the frames clone and re-transform what they get, and
    linked data is read-only. A no-op if the open file already carries them, so
    `hero` mode works on `art/barbarians.blend` itself.
    """
    if any(o.name.startswith(prefix) for o in bpy.data.objects):
        return [o for o in bpy.data.objects if o.name.startswith(prefix)]
    with bpy.data.libraries.load(blend) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith(prefix)]
    loaded = [o for o in dst.objects if o is not None]
    for obj in loaded:
        bpy.context.scene.collection.objects.link(obj)
        obj.hide_render = True  # the staged copy; only clones are photographed
    print("APPENDED", len(loaded), prefix, "objects from", os.path.basename(blend))
    return loaded


def _clone(objs, matrix):
    """One copy of `objs` under `matrix`, sharing mesh data."""
    made = []
    for obj in objs:
        clone = obj.copy()
        clone.data = obj.data
        bpy.context.scene.collection.objects.link(clone)
        clone.parent = None
        clone.hide_render = False
        clone.matrix_world = matrix @ obj.matrix_world
        made.append(clone)
    return made


def _stand(objs, xy, surface, scale, yaw_deg):
    """A figure standing at `xy` on `surface`, at `scale`, turned `yaw_deg`.

    The art is authored with its feet at z = 0, so seating is just the surface
    (`seatY(surface, 0, scale)` is `surface`). `barbarianArt.test.ts` asserts
    the base plane.
    """
    return _clone(
        objs,
        Matrix.Translation((xy[0], xy[1], surface))
        @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z")
        @ Matrix.Diagonal((scale, scale, scale, 1.0)),
    )


def _hex_vertex(centre, angle_deg):
    a = math.radians(angle_deg)
    return centre[0] + LATTICE_SIZE * math.cos(a), centre[1] + LATTICE_SIZE * math.sin(a)


def _edge_midpoint(centre, angle_deg):
    a = math.radians(angle_deg)
    return centre[0] + LATTICE_APOTHEM * math.cos(a), centre[1] + LATTICE_APOTHEM * math.sin(a)


# --- the settlement, for scale -------------------------------------------
#
# Appended from `art/pieces.blend` and brought to its canonical pose as the
# exporter does: `Settlement_A` is composed on a showcase vertex at -20 degrees.
# The anchor and yaw are restated from `tools/blender/anchors.py` (RULES and
# AUTHORED_TURN) so this script stays bpy-only.
SETTLEMENT_ANCHOR = (math.sqrt(3.0) * LATTICE_SIZE, LATTICE_SIZE)
SETTLEMENT_TURN_DEG = -20.0
#: `PIECE_SCALE.settlement`, and the z the art is authored at (on a tile, not
#: at zero, so it needs a real `seatY`). Both from frontend/src/lib/board3d/.
SETTLEMENT_SCALE = 2.0
SETTLEMENT_BASE_Z = 0.25


def _settlement(objs, xy):
    canonical = Matrix.Rotation(math.radians(SETTLEMENT_TURN_DEG), 4, "Z") @ Matrix.Translation(
        (-SETTLEMENT_ANCHOR[0], -SETTLEMENT_ANCHOR[1], 0.0)
    )
    seat = GUTTER_Z - SETTLEMENT_SCALE * SETTLEMENT_BASE_Z
    return _clone(
        objs,
        Matrix.Translation((xy[0], xy[1], seat))
        @ Matrix.Diagonal((SETTLEMENT_SCALE,) * 3 + (1.0,))
        @ canonical,
    )


def _light(scene, background, strength):
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
    # `art/barbarians.blend` carries no world, so add one for the render.
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
        scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = background
    bg.inputs[1].default_value = strength


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


def _render_settings(scene, width, height, fmt, quality=90):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = fmt
    if fmt == "JPEG":
        scene.render.image_settings.quality = quality
    else:
        # RGB at full compression: no transparency to keep, and about a
        # quarter of the default's bytes for the same pixels.
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = "Standard"


# --- board mode -----------------------------------------------------------
#
# `Hex_Fields` at axial (0, 1) is coastal, with the harbour (`Hex_Port`) on
# (1, 1). Its southern vertex is shared with `Hex_Mountains` and `Hex_Desert`,
# so one frame gets a settlement on a three-tile junction, a road edge off it,
# and the muster on the hex above.
MUSTER_HEX = "Hex_Fields"
#: Bearing from the muster hex to the neighbouring hex whose shared edge the
#: lone barbarian blocks (south-west, toward `Hex_Mountains`), and the vertex
#: at the bottom of the muster hex, where the settlement goes.
BLOCK_EDGE_DEG = 240.0
SETTLEMENT_VERTEX_DEG = 270.0
ZOOMS = {"board": 34.0, "play": 12.5}
AZIMUTH = -100.0


def render_board(out):
    scene = bpy.context.scene
    _render_settings(scene, 1200, 740, "JPEG")
    _light(scene, (0.28, 0.36, 0.46, 1), 0.7)

    barbarian = _append(os.path.join(ART, "barbarians.blend"), "Barbarian_")
    settlement = _append(os.path.join(ART, "pieces.blend"), "Settlement_A")
    centre = tuple(bpy.data.objects[MUSTER_HEX].matrix_world.translation[:2])

    made = []
    # The muster: three on the hex, splayed on MUSTER_RADIUS and facing out.
    for bearing in MUSTER_BEARINGS:
        a = math.radians(bearing)
        xy = (
            centre[0] + MUSTER_SHIFT[0] + MUSTER_RADIUS * math.cos(a),
            centre[1] + MUSTER_SHIFT[1] + MUSTER_RADIUS * math.sin(a),
        )
        made += _stand(barbarian, xy, LAND_Z, BARBARIAN_SCALE, bearing)
    # The blocker: one across the road edge, on the gutter, facing the
    # neighbouring hex rather than lying along the edge.
    edge = _edge_midpoint(centre, BLOCK_EDGE_DEG)
    made += _stand(barbarian, edge, GUTTER_Z, BARBARIAN_SCALE, BLOCK_EDGE_DEG)
    made += _settlement(settlement, _hex_vertex(centre, SETTLEMENT_VERTEX_DEG))

    bpy.context.view_layer.update()
    target = (centre[0] - 0.5, centre[1] - 2.25, GUTTER_Z + 0.55)
    for zoom, dist in ZOOMS.items():
        _shoot(os.path.join(out, f"{zoom}_az0.jpg"), target, dist, AZIMUTH)
    for obj in made:
        bpy.data.objects.remove(obj, do_unlink=True)


# --- hero mode ------------------------------------------------------------
#
# One figure on flat grey, lit the same way, framed three-quarter from behind
# the axe side so the blade, haft and cloak are on the silhouette's edge
# (from elsewhere the haft hides behind the body). A lower elevation than the
# board rig, since this frame is for looking at the piece.
HERO_AZIMUTH = 125.0
HERO_ELEVATION = 24.0
HERO_DIST = 2.4


def render_hero(out):
    scene = bpy.context.scene
    _render_settings(scene, 1024, 1024, "PNG")
    _light(scene, (0.42, 0.42, 0.44, 1), 1.15)
    barbarian = _append(os.path.join(ART, "barbarians.blend"), "Barbarian_")
    for obj in barbarian:
        obj.hide_render = False
    bpy.context.view_layer.update()
    _shoot(
        os.path.join(out, "hero.png"),
        (0.05, -0.05, 0.46),
        HERO_DIST,
        HERO_AZIMUTH,
        HERO_ELEVATION,
    )


# --- family mode ----------------------------------------------------------
#
# The lineup, at drawn scale: every factor is the client's
# (`PIECE_SCALE`/`MODULE_SCALE` in `frontend/src/lib/board3d/pieceArt.ts`), so
# heights match the board.
#
# Each family's bounding box is centred on its mark with its lowest vertex on
# the ground, since the showcase blends place them far from the origin.
FAMILY = (
    ("harbors.blend", "Settler_", 1.15, "settler"),
    ("riders.blend", "Rider_", 1.15, "rider"),
    ("knights.blend", "Knight_basic", 2.0, "knight"),
    ("barbarians.blend", "Barbarian_", BARBARIAN_SCALE, "raider"),
    ("trader.blend", "Trader_merchant_", 1.5, "trader"),
)
FAMILY_PITCH = 1.4
FAMILY_AZIMUTH = -90.0


def _bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objs:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                lo[axis] = min(lo[axis], world[axis])
                hi[axis] = max(hi[axis], world[axis])
    return lo, hi


def render_family(out):
    scene = bpy.context.scene
    # This mode opens no blend, so clear the startup cube, camera and lamp.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    _render_settings(scene, 1500, 540, "JPEG")
    _light(scene, (0.42, 0.42, 0.44, 1), 1.0)

    x = 0.0
    for blend, prefix, scale, label in FAMILY:
        objs = _append(os.path.join(ART, blend), prefix)
        for obj in objs:
            obj.hide_render = False
        lo, hi = _bounds(objs)
        centre = Matrix.Translation(
            (-(lo[0] + hi[0]) / 2.0, -(lo[1] + hi[1]) / 2.0, -lo[2])
        )
        place = (
            Matrix.Translation((x, 0.0, 0.0))
            @ Matrix.Diagonal((scale,) * 3 + (1.0,))
            @ centre
        )
        for obj in objs:
            obj.matrix_world = place @ obj.matrix_world
        lo, hi = _bounds(objs)
        print("FAMILY", label, "drawn height", round(hi[2] - lo[2], 3))
        x += FAMILY_PITCH

    bpy.context.view_layer.update()
    span = x - FAMILY_PITCH
    _shoot(os.path.join(out, "family.jpg"), (span / 2.0, 0.0, 0.52), 7.6, FAMILY_AZIMUTH)


def main():
    out, mode = _args()
    {"board": render_board, "hero": render_hero, "family": render_family}[mode](out)


main()
