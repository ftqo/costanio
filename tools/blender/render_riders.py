"""Photograph the Raiders rider: on the board, and on its own.

    # the vignette: settlement, road, rider, all one seat colour
    blender art/board.blend --background \
        --python tools/blender/render_riders.py -- art/prototypes/riders

    # the hero shot the review gallery embeds
    blender art/riders.blend --background \
        --python tools/blender/render_riders.py -- art/prototypes/riders --hero

The board frames decide whether the art is right. `art/board.blend` is the
linked assembly of the per-tile files (`make board`); the rider and the
pieces are appended from `art/riders.blend` and `art/pieces.blend`. The rig is
the game's: 32 degrees of vertical FOV and 56 degrees of elevation
(`frontend/src/lib/board3d/scene.ts`), where verticals draw at 56% of their
length (see art/README.md).

The vignette is a chain: a settlement on a vertex, a road out of it, and the
rider on the next edge, all in the same `Seat_*` slots, to check the rider
reads as one player's piece beside their others.

The hero frame (three-quarter, neutral ground, no board) is for the review
gallery only; do not size a piece on it.

Board frames are JPEG (see art/README.md); the hero is PNG.

Six board frames are written, three of them committed (`play_az0`,
`play_az1`, `close_az1`).
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RIDERS = os.path.join(REPO, "art", "riders.blend")
PIECES = os.path.join(REPO, "art", "pieces.blend")

#: The shipping camera, from `frontend/src/lib/board3d/scene.ts`.
FOV_DEG = 32.0
ELEVATION_DEG = 56.0

#: Where a piece stands: `SURFACE.gutter`, the gap fill's top face.
GUTTER_Z = 0.22

#: Circumradius the lattice is laid out at (`lattice.LATTICE_SIZE`), restated
#: here so this script needs nothing but bpy.
LATTICE_SIZE = 3.0 + 0.25 / math.sqrt(3.0)

#: What the rider is drawn at in these frames: not a shipped constant (there is
#: no `MODULE_SCALE` entry yet), chosen between the knight's drawn 1.1 of height
#: and the camel's 1.15. The layer that draws riders should measure its own.
RIDER_SCALE = 1.4

#: The vignette, in lattice coordinates.
#:
#: One all-land junction: where Mountains (0, 0), Desert and Fields meet. The
#: settlement stands on it, a road runs south off it, and the rider is on the
#: next edge round, heading north-east. Re-staged here because
#: `Settlement_A`'s authored vertex is coastal.
APOTHEM = LATTICE_SIZE * math.sqrt(3.0) / 2.0
JUNCTION = (APOTHEM, LATTICE_SIZE / 2.0)
ROAD_MID = (APOTHEM, 0.0)
ROAD_YAW = -math.pi / 2.0
RIDER_MID = (APOTHEM * 1.5, LATTICE_SIZE * 0.75)
RIDER_YAW = math.pi / 6.0

#: Drawn sizes, from `frontend/src/lib/board3d/pieceArt.ts` PIECE_SCALE.
SETTLEMENT_SCALE = 2.0
ROAD_SCALE = 1.15

#: Where each piece's authored anchor is and which way it was staged, from
#: `tools/blender/anchors.py` (RULES and AUTHORED_TURN). The exporter cancels
#: both; this restates them because the frames append from the blend.
LCOL = 3.0 * math.sqrt(3.0) * (LATTICE_SIZE / 3.0)
LHEX = LATTICE_SIZE
SETTLEMENT_ANCHOR = (LCOL, LHEX)
SETTLEMENT_TURN = math.radians(20.0)
ROAD_ANCHOR = (LCOL * 0.75, LHEX * 0.75)
ROAD_TURN = math.pi / 6.0

#: Where a piece modelled ON a tile has its base: `pieces.blend` puts the
#: settlement and the road at z = 0.25. The rider is at 0, like the knights.
TILE_PIECE_BASE_Z = 0.25

#: Distances to shoot the board from, and what each is for. `board` frames most
#: of the island, `play` is where a player actually sits, `close` is for judging
#: the joint between the piece and the tile it stands on.
ZOOMS = {"board": 30.0, "play": 15.0, "close": 7.0}

#: Ground-plane bearings. Two, since the shield is on one side only.
AZIMUTHS = (-90.0, -20.0)


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if not argv:
        raise SystemExit("usage: ... --python render_riders.py -- OUTDIR [--hero]")
    os.makedirs(argv[0], exist_ok=True)
    return argv[0], "--hero" in argv[1:]


def _append(path, prefixes):
    """Append (not link) every object whose name starts with any of `prefixes`.

    Appended rather than linked because the frames clone and re-place these, and
    linked data is read-only. A no-op for anything the open file already carries.
    """
    have = [o.name for o in bpy.data.objects]
    want = [p for p in prefixes if not any(n.startswith(p) for n in have)]
    if not want:
        return []
    with bpy.data.libraries.load(path) as (src, dst):
        dst.objects = [n for n in src.objects if any(n.startswith(p) for p in want)]
    loaded = [o for o in dst.objects if o is not None]
    for obj in loaded:
        bpy.context.scene.collection.objects.link(obj)
    print("APPENDED", len(loaded), "from", os.path.basename(path))
    return loaded


#: Sun and fill for the board frames: over the shoulder of a camera at az -90.
BOARD_SUNS = (("Sun", 4.0, (48.0, 0.0, -35.0)), ("Fill", 1.4, (65.0, 0.0, 150.0)))

#: And for the hero, whose camera is at az +55 (shield toward the lens). The
#: board rig would wash the ground out at that bearing, so the sun comes round
#: and drops to 2.6.
HERO_SUNS = (("Sun", 2.6, (48.0, 0.0, 25.0)), ("Fill", 1.0, (62.0, 0.0, 190.0)))


def _lights(scene, sky=(0.28, 0.36, 0.46), strength=0.7, suns=BOARD_SUNS):
    for obj in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(obj, do_unlink=True)
    for name, energy, euler in suns:
        data = bpy.data.lights.new(name, type="SUN")
        data.energy = energy
        data.angle = math.radians(6)
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.rotation_euler = tuple(math.radians(d) for d in euler)
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*sky, 1)
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


def _stage(prefixes, anchor, authored_yaw, base_z, target, yaw, scale):
    """Clone a piece onto a lattice feature, seated on the gutter.

    `anchor` and `authored_yaw` undo the staged pose (`anchors.RULES` /
    `AUTHORED_TURN`), and the z term is `seating.seat` written out: solve
    `gutter = z + scale * base` so the piece stands on the gap fill.
    """
    scene = bpy.context.scene
    where = (
        Matrix.Translation((target[0], target[1], GUTTER_Z - base_z * scale))
        @ Matrix.Rotation(yaw - authored_yaw, 4, "Z")
        @ Matrix.Diagonal((scale, scale, scale, 1.0))
        @ Matrix.Translation((-anchor[0], -anchor[1], 0.0))
    )
    made = []
    for obj in [o for o in bpy.data.objects if o.name.startswith(tuple(prefixes))]:
        if obj.name.endswith(".staged"):
            continue
        clone = obj.copy()
        clone.data = obj.data
        clone.name = obj.name + ".staged"
        scene.collection.objects.link(clone)
        clone.matrix_world = where @ obj.matrix_world
        made.append(clone)
    return made


def _board(out):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 740
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    scene.view_settings.view_transform = "Standard"
    _lights(scene)

    _append(RIDERS, ["Rider_"])
    _append(PIECES, ["Settlement_A", "Road_A"])

    staged = []
    staged += _stage(
        ["Settlement_A"], SETTLEMENT_ANCHOR, SETTLEMENT_TURN, TILE_PIECE_BASE_Z,
        JUNCTION, 0.0, SETTLEMENT_SCALE,
    )
    staged += _stage(
        ["Road_A"], ROAD_ANCHOR, ROAD_TURN, TILE_PIECE_BASE_Z,
        ROAD_MID, ROAD_YAW, ROAD_SCALE,
    )
    staged += _stage(["Rider_"], (0.0, 0.0), 0.0, 0.0, RIDER_MID, RIDER_YAW, RIDER_SCALE)

    # Only the staged copies are photographed; hide the originals.
    for obj in bpy.data.objects:
        appended = obj.name.startswith(("Rider_", "Settlement_A", "Road_A"))
        obj.hide_render = appended and not obj.name.endswith(".staged")

    target = (
        (JUNCTION[0] + ROAD_MID[0] + RIDER_MID[0]) / 3.0,
        (JUNCTION[1] + ROAD_MID[1] + RIDER_MID[1]) / 3.0,
        GUTTER_Z + 0.4,
    )
    for zoom, dist in ZOOMS.items():
        for i, az in enumerate(AZIMUTHS):
            _shoot(os.path.join(out, f"{zoom}_az{i}"), target, dist, az)
    print("STAGED", len(staged), "objects")


def _hero(out):
    """The rider alone, three-quarter, on neutral grey. 1024 square."""
    import bmesh

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.image_settings.file_format = "PNG"
    # RGB and full deflate, far smaller than the default.
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = "Standard"
    _lights(scene, sky=(0.52, 0.53, 0.55), strength=1.0, suns=HERO_SUNS)

    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=8.0)
    mesh = bpy.data.meshes.new("Ground")
    bm.to_mesh(mesh)
    bm.free()
    mat = bpy.data.materials.new("Ground")
    mat.use_nodes = True
    ground = mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"]
    ground.default_value = (0.42, 0.42, 0.44, 1)
    mesh.materials.append(mat)
    scene.collection.objects.link(bpy.data.objects.new("Ground", mesh))

    # az +55 puts the shield toward the lens and the lance behind it, so the
    # piece reads as a mounted figure.
    _shoot(os.path.join(out, "hero"), (0.0, 0.0, 0.34), 2.05, 55.0, elevation_deg=26.0)


def main():
    out, hero = _args()
    if hero:
        _hero(out)
    else:
        _board(out)


main()
