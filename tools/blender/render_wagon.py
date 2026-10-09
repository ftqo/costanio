"""Photograph the Wagons wagon: on the board, and on its own.

    blender art/board.blend --background --python tools/blender/render_wagon.py \
        -- art/prototypes/wagon
    blender art/wagons.blend --background --python tools/blender/render_wagon.py \
        -- art/prototypes/wagon --hero

The board pass checks that a wagon and a settlement sharing a vertex read as
two objects, with the game's camera (32 degrees of vertical FOV, 56 of
elevation), at drawn size, and in the same seat colour.

`--hero` is the gallery shot: the piece alone, three-quarter, on neutral grey,
at 1024 px.

The settlement and road come from `art/pieces.blend` and the wagon from
`art/wagons.blend`. Pieces are brought to their canonical pose with
`anchors.py`, the exporter's table, since the settlement is authored on a
showcase vertex 20 degrees off square.

Board frames are JPEG (see `render_knight_sword.py`); `hero.png` is PNG.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anchors  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PIECES = os.path.join(REPO, "art", "pieces.blend")
WAGONS = os.path.join(REPO, "art", "wagons.blend")

#: The shipping camera, from `frontend/src/lib/board3d/scene.ts`.
FOV_DEG = 32.0
ELEVATION_DEG = 56.0

#: Where a piece stands: `SURFACE.gutter`, the gap fill's top face.
GUTTER_Z = 0.22

#: Lattice circumradius (`lattice.LATTICE_SIZE`), restated so this script
#: needs nothing but bpy and anchors.
LATTICE_SIZE = 3.0 + 0.25 / math.sqrt(3.0)

#: Drawn sizes, from `frontend/src/lib/board3d/pieceArt.ts`.
SETTLEMENT_SCALE = 2.0
CITY_SCALE = 2.58
ROAD_SCALE = 1.15

#: `MODULE_SCALE.wagon`, judged in these frames against a settlement and a road
#: at their drawn sizes (at 1, a 0.45-tall wagon hid behind a 0.80-tall house).
WAGON_SCALE = 1.5

#: The ring for several wagons on one vertex, from `gen/wagons.py`, in authored
#: units scaled with the piece (as `layers/wagons.ts` does).
RING = {2: 0.22, 3: 0.38, 4: 0.47}

#: `board` is the widest a player sees the board, `play` is where they sit,
#: `close` shows a wagon and the house sharing its junction.
ZOOMS = {"board": 26.0, "play": 17.0, "close": 8.0}
AZIMUTHS = (-90.0, -35.0)


def _args():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if not argv:
        raise SystemExit("usage: ... --python render_wagon.py -- OUTDIR [--hero|--scales]")
    os.makedirs(argv[0], exist_ok=True)
    mode = "hero" if "--hero" in argv else "scales" if "--scales" in argv else "board"
    return argv[0], mode


def _vertex(angle_deg):
    a = math.radians(angle_deg)
    return Vector((LATTICE_SIZE * math.cos(a), LATTICE_SIZE * math.sin(a), 0.0))


def _append(path, prefix):
    """Append (not link) every object named `prefix*` from another blend."""
    have = [o for o in bpy.data.objects if o.name.startswith(prefix)]
    if have:
        return have
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith(prefix)]
    loaded = [o for o in dst.objects if o is not None]
    for obj in loaded:
        bpy.context.scene.collection.objects.link(obj)
        obj.hide_render = True  # only the clones below are photographed
    return loaded


def _canonical(obj):
    """The matrix that brings a staged piece home to its reference pose.

    `recenter`'s move for one root: subtract the lattice anchor the piece was
    composed on, then cancel its composition yaw (see anchors.AUTHORED_TURN).
    """
    rule = anchors.rule_for(obj.name)
    if rule == anchors.ROOT:
        ax, ay = obj.matrix_world.translation.x, obj.matrix_world.translation.y
    else:
        ax, ay = rule
    return Matrix.Rotation(anchors.turn_for(obj.name), 4, "Z") @ Matrix.Translation(
        Vector((-ax, -ay, 0.0))
    )


def _drop(prefix, source, at, scale, base_z, yaw=0.0):
    """Clone one piece onto `at`, drawn at `scale`, seated on the gutter.

    `base_z` is the art's own lowest point: `seatY` solves
    `surface = z + scale * base` for where the origin goes, so a settlement
    (authored at 0.25) and a wagon (authored at 0) stand on the same ground.
    """
    made = []
    z = GUTTER_Z - scale * base_z
    place = (
        Matrix.Translation(Vector((at.x, at.y, z)))
        @ Matrix.Rotation(yaw, 4, "Z")
        @ Matrix.Diagonal((scale, scale, scale, 1.0))
    )
    for obj in source:
        if not obj.name.startswith(prefix):
            continue
        clone = obj.copy()
        clone.data = obj.data
        bpy.context.scene.collection.objects.link(clone)
        clone.parent = None
        clone.hide_render = False
        clone.matrix_world = place @ _canonical(obj) @ obj.matrix_world
        made.append(clone)
    if not made:
        raise SystemExit(f"nothing named {prefix} to place")
    return made


def _light(scene, sky=(0.28, 0.36, 0.46, 1.0), strength=0.7):
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
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = sky
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


def _base_z(objs, prefix):
    """The lowest authored point of the named art, in its own blend."""
    zs = [
        (obj.matrix_world @ v.co).z
        for obj in objs
        if obj.name.startswith(prefix) and obj.type == "MESH"
        for v in obj.data.vertices
    ]
    return min(zs)


def board(out):
    """Three frames: the junction, the pair sharing one, and the near view."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 740
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    scene.view_settings.view_transform = "Standard"
    _light(scene)

    pieces = _append(PIECES, "Settlement_A") + _append(PIECES, "Road_A")
    wagon = _append(WAGONS, "Wagon_")
    house_z = _base_z(pieces, "Settlement_A")
    road_z = _base_z(pieces, "Road_A")
    wagon_z = _base_z(wagon, "Wagon_")

    # Two adjacent corners of the hex at the origin and the edge between them:
    # a real junction of three land tiles on the showcase board, so the piece
    # has tile art, a number chip and a gutter beside it.
    east, north = _vertex(30.0), _vertex(90.0)
    edge_mid = (east + north) / 2.0
    edge_yaw = math.atan2(north.y - east.y, north.x - east.x)
    target = (edge_mid.x, edge_mid.y, GUTTER_Z + 0.45)

    def frame(label, layout, dist, az):
        made = []
        for spec in layout:
            made.extend(_drop(*spec))
        _shoot(os.path.join(out, label), target, dist, az)
        for obj in made:
            bpy.data.objects.remove(obj, do_unlink=True)

    house = ("Settlement_A", pieces, east, SETTLEMENT_SCALE, house_z)
    road = ("Road_A", pieces, edge_mid, ROAD_SCALE, road_z, edge_yaw)

    # One wagon on the next junction along, facing down the road.
    solo = ("Wagon_", wagon, north, WAGON_SCALE, wagon_z, edge_yaw + math.pi)
    for zoom, dist in (("board", ZOOMS["board"]), ("play", ZOOMS["play"])):
        frame(f"junction_{zoom}", [house, road, solo], dist, AZIMUTHS[0])
    frame("junction_close", [house, road, solo], ZOOMS["close"], AZIMUTHS[1])

    # Several wagons on one vertex, ringed at the radii `gen/wagons.py`
    # derives, each facing outward.
    ring = []
    for i in range(3):
        bearing = math.radians(90.0 * i)
        at = north + Vector(
            (
                RING[3] * WAGON_SCALE * math.cos(bearing),
                RING[3] * WAGON_SCALE * math.sin(bearing),
                0.0,
            )
        )
        ring.append(("Wagon_", wagon, at, WAGON_SCALE, wagon_z, bearing))
    frame("ring_play", [house, road, *ring], ZOOMS["play"], AZIMUTHS[0])


def scales(out):
    """The same junction at three candidate factors, one variable changed.

    The frame `MODULE_SCALE.wagon` was decided on: two wagons on a junction a
    settlement already stands on (the hard case).

    Three frames at one camera rather than three scales in one frame, since
    nearer pieces look bigger.
    """
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 740
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    scene.view_settings.view_transform = "Standard"
    _light(scene)

    pieces = _append(PIECES, "Settlement_A") + _append(PIECES, "Road_A")
    wagon = _append(WAGONS, "Wagon_")
    house_z = _base_z(pieces, "Settlement_A")
    road_z = _base_z(pieces, "Road_A")
    wagon_z = _base_z(wagon, "Wagon_")

    east, north = _vertex(30.0), _vertex(90.0)
    edge_mid = (east + north) / 2.0
    edge_yaw = math.atan2(north.y - east.y, north.x - east.x)

    for factor in (1.0, 1.5, 2.0):
        made = _drop("Settlement_A", pieces, north, SETTLEMENT_SCALE, house_z)
        made += _drop("Road_A", pieces, edge_mid, ROAD_SCALE, road_z, edge_yaw)
        # The pair ring, in authored units scaled with the piece, as
        # `layers/wagons.ts` applies.
        for bearing in (0.0, math.pi):
            at = north + Vector(
                (
                    RING[2] * factor * math.cos(bearing),
                    RING[2] * factor * math.sin(bearing),
                    0.0,
                )
            )
            made += _drop("Wagon_", wagon, at, factor, wagon_z, bearing)
        label = f"junction_scale_{str(factor).replace('.', '')}"
        _shoot(os.path.join(out, label), (north.x, north.y, GUTTER_Z + 0.4), 9.0, AZIMUTHS[0])
        for obj in made:
            bpy.data.objects.remove(obj, do_unlink=True)

    # And the setup position: a wagon starts on the player's round-2 city's
    # intersection (docs/rules/wagons.md), and `planWagons` puts a lone wagon
    # at radius 0, inside a city drawn at 2.58 (reaching 0.76). No scale fixes
    # that; a radius for the n = 1 case would.
    city = _append(PIECES, "City_A")
    made = _drop("City_A", city, north, CITY_SCALE, _base_z(city, "City_A"))
    made += _drop("Wagon_", wagon, north, WAGON_SCALE, wagon_z, edge_yaw)
    _shoot(os.path.join(out, "city_setup"), (north.x, north.y, GUTTER_Z + 0.4), 9.0, AZIMUTHS[0])
    for obj in made:
        bpy.data.objects.remove(obj, do_unlink=True)


def hero(out):
    """The gallery frame: the piece alone, three-quarter, on neutral grey."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.image_settings.file_format = "PNG"
    # No alpha and maximum deflate.
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.compression = 100
    scene.view_settings.view_transform = "Standard"
    _light(scene, sky=(0.42, 0.42, 0.44, 1.0), strength=1.0)

    # A grey floor for the wheels to stand on and cast onto.
    floor_mesh = bpy.data.meshes.new("Floor")
    floor_mesh.from_pydata(
        [(-4, -4, 0), (4, -4, 0), (4, 4, 0), (-4, 4, 0)], [], [(0, 1, 2, 3)]
    )
    grey = bpy.data.materials.new("HeroFloor")
    grey.use_nodes = True
    grey.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
        0.36,
        0.36,
        0.38,
        1.0,
    )
    grey.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
    floor_mesh.materials.append(grey)
    floor = bpy.data.objects.new("Floor", floor_mesh)
    scene.collection.objects.link(floor)

    wagon = [o for o in bpy.data.objects if o.name.startswith("Wagon_")]
    if not wagon:
        raise SystemExit("open art/wagons.blend for the hero pass")
    hi = max((obj.matrix_world @ v.co).z for obj in wagon for v in obj.data.vertices)
    # A three-quarter view: high enough to show the arch's top, low enough to
    # keep the wheels and the tongue in profile.
    _shoot(os.path.join(out, "hero"), (0.02, 0.0, hi * 0.55), 1.55, -38.0, 26.0)


def main():
    out, mode = _args()
    {"hero": hero, "scales": scales, "board": board}[mode](out)


main()
