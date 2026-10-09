"""Generate `art/riders.blend`: the Raiders rider, a mounted edge piece.

    blender --background --factory-startup \
        --python tools/blender/gen/riders.py

The blend is an output of this script: do not model in it, the next run
overwrites it. Change a number here, re-run, then `make export-assets`.

## The piece

A horse and rider in profile, moving along an edge. Player-owned, so it wears
only the shared `Seat_*` slots: `Seat_Body` for the horse and the rider's
tunic, `Seat_Shade` for legs, mane, tail and tack, `Seat_Detail` for shield,
helm and lance (see art/README.md on seat slots).

`Rider_*`, not `Knight_*`: Knights owns that prefix, and the exporter and
loader subset by prefix.

## Authoring frame

Authored along +x with the edge midpoint at the origin (the road convention
`edgeRotationY` expects). Like the camel it faces +x (nose at +x), so a
renderer needs a bearing, not just an axis. `riderArt.test.ts` measures both
off the shipped glb.

Base at z = 0, like the knights; `seating.seat` reads the base off the art.

## Size

Between the knight (0.55 tall) and the camel (0.972 above its base): 0.9016
long, 0.2650 across the edge, 0.7537 tall to the lance tip. About half the
road footprint (1.8 x 0.25), so it does not crowd the settlements at the ends
of its edge.

218 polygons in 10 parts (440 triangles after export), within the 100-250
house budget. Flat-shaded, one material per object (art/README.md).
`riderArt.test.ts` measures it off the shipped file.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ART = os.path.join(REPO, "art")
PIECES = os.path.join(ART, "pieces.blend")
OUT = os.path.join(ART, "riders.blend")

#: The collection every part lands in, and the name prefix the exporter and the
#: loader both subset by.
COLLECTION = "Rider"
PREFIX = "Rider_"

#: The three shared seat slots, appended from `art/pieces.blend` rather than
#: recreated, which would cause a PALETTE_CONFLICT.
SEAT_SLOTS = ("Seat_Body", "Seat_Shade", "Seat_Detail")


# --- geometry helpers ------------------------------------------------------
#
# Everything is built from oriented rectangular bars (barrel, legs, neck,
# lance). `bar` takes a centre line in the XZ plane and a half-width in y.


def _bar(bm, p0, p1, w0, h0, w1=None, h1=None, dy=0.0):
    """A rectangular bar whose axis runs p0 -> p1 in the XZ plane.

    `w` is the half-width across y, `h` the half-thickness perpendicular to the
    axis within XZ. The `1` values default to the `0` ones, so a prism is one
    call and a taper is one call with two more numbers. `dy` slides the whole
    bar sideways (a leg onto its own side).

    Six faces, eight vertices, none degenerate: a taper to exactly zero would
    collapse two quads, so the lance's point stops just short.
    """
    w1 = w0 if w1 is None else w1
    h1 = h0 if h1 is None else h1
    a, b = Vector(p0), Vector(p1)
    axis = (b - a).normalized()
    # Perpendicular to the axis, inside the XZ plane. The bar has no roll, so
    # this plus +y is a full frame.
    perp = Vector((-axis.z, 0.0, axis.x))
    side = Vector((0.0, 1.0, 0.0))
    off = side * dy

    def cap(centre, w, h):
        return [
            bm.verts.new(centre + off - perp * h - side * w),
            bm.verts.new(centre + off + perp * h - side * w),
            bm.verts.new(centre + off + perp * h + side * w),
            bm.verts.new(centre + off - perp * h + side * w),
        ]

    lo, hi = cap(a, w0, h0), cap(b, w1, h1)
    bm.faces.new(lo)
    bm.faces.new(hi)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))


def _box(bm, x0, x1, y0, y1, z0, z1):
    """An axis-aligned box. Six faces, for the parts that are simply blocks."""
    lo = [
        bm.verts.new((x0, y0, z0)),
        bm.verts.new((x1, y0, z0)),
        bm.verts.new((x1, y1, z0)),
        bm.verts.new((x0, y1, z0)),
    ]
    hi = [
        bm.verts.new((x0, y0, z1)),
        bm.verts.new((x1, y0, z1)),
        bm.verts.new((x1, y1, z1)),
        bm.verts.new((x0, y1, z1)),
    ]
    bm.faces.new(lo)
    bm.faces.new(hi)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))


def _disc_y(bm, cx, cz, rx, rz, y0, y1, sides=6):
    """A polygon in the XZ plane extruded along +y: the round shield.

    `sides + 2` faces. Six sides is enough at the size a piece is drawn.
    """
    ring0, ring1 = [], []
    for i in range(sides):
        t = math.tau * (i / sides) + math.tau / (2 * sides)
        x, z = cx + rx * math.cos(t), cz + rz * math.sin(t)
        ring0.append(bm.verts.new((x, y0, z)))
        ring1.append(bm.verts.new((x, y1, z)))
    bm.faces.new(ring0)
    bm.faces.new(ring1)
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))


def _part(name, material, build):
    """One flat sibling object, one material, every polygon flat-shaded."""
    bm = bmesh.new()
    build(bm)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = False
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    # The object origin stays at the world origin: `Rider_` falls back to
    # ROOT, which subtracts the object's origin on export.
    bpy.data.collections[COLLECTION].objects.link(obj)
    return obj


# --- the animal ------------------------------------------------------------
#
# A side elevation in absolute z: x forward (nose at +x), z up, y the narrow
# axis. Judged through the game camera between a knight (0.55) and a camel
# (0.972).
#
# The horse's back sits at 0.467 of a 0.754 piece and the helm at 0.708, so the
# rider has enough height above the withers to read as a rider at 56 degrees.


def _horse_body(bm):
    # Barrel, haunch, chest: three overlapping tapers, deeper at the rump than
    # the shoulder.
    _bar(bm, (-0.195, 0, 0.375), (0.155, 0, 0.372), 0.108, 0.092, 0.100, 0.085)
    _bar(bm, (-0.295, 0, 0.380), (-0.145, 0, 0.376), 0.115, 0.098, 0.110, 0.096)
    _bar(bm, (0.095, 0, 0.372), (0.215, 0, 0.362), 0.100, 0.086, 0.086, 0.078)


#: Each leg as (x at the shoulder, x at the hoof, side). A walking pose: the
#: near foreleg and the off hind leg are forward, the other two trailing.
LEGS = (
    (0.145, 0.180, 0.082),
    (0.145, 0.112, -0.082),
    (-0.230, -0.272, 0.082),
    (-0.230, -0.192, -0.082),
)


def _horse_legs(bm):
    for top_x, foot_x, dy in LEGS:
        _bar(bm, (top_x, 0, 0.300), (foot_x, 0, 0.048), 0.030, 0.032, 0.022, 0.024, dy=dy)
        _bar(bm, (foot_x, 0, 0.048), (foot_x, 0, 0.000), 0.034, 0.034, 0.036, 0.036, dy=dy)


def _horse_neck(bm):
    # The base is sunk into the chest so no gap shows under the neck.
    _bar(bm, (0.135, 0, 0.360), (0.300, 0, 0.545), 0.072, 0.085, 0.048, 0.058)


def _horse_head(bm):
    _bar(bm, (0.285, 0, 0.565), (0.400, 0, 0.535), 0.048, 0.048, 0.040, 0.042)
    _bar(bm, (0.380, 0, 0.538), (0.442, 0, 0.528), 0.036, 0.034, 0.032, 0.030)
    for dy in (0.026, -0.026):
        _bar(bm, (0.300, 0, 0.595), (0.312, 0, 0.640), 0.013, 0.013, 0.005, 0.006, dy=dy)


def _horse_mane(bm):
    # Crest along the neck, forelock between the ears, tail off the croup. One
    # object because one object is one material, and all three are Seat_Shade.
    _bar(bm, (0.150, 0, 0.420), (0.302, 0, 0.600), 0.022, 0.030, 0.018, 0.026)
    _bar(bm, (0.305, 0, 0.605), (0.340, 0, 0.570), 0.016, 0.022, 0.010, 0.016)
    _bar(bm, (-0.285, 0, 0.440), (-0.440, 0, 0.270), 0.030, 0.035, 0.018, 0.020)


def _saddle(bm):
    _bar(bm, (-0.125, 0, 0.435), (0.055, 0, 0.430), 0.121, 0.045, 0.115, 0.042)
    _bar(bm, (-0.085, 0, 0.478), (0.028, 0, 0.478), 0.100, 0.022, 0.096, 0.020)


def _rider_torso(bm):
    # Seated, leaning slightly into the movement. The arms differ: the near
    # arm carries the shield low across the body, the off arm is raised to the
    # lance.
    _bar(bm, (-0.038, 0, 0.495), (-0.010, 0, 0.648), 0.068, 0.050, 0.076, 0.046)
    _bar(bm, (-0.018, 0, 0.626), (-0.005, 0, 0.660), 0.088, 0.044, 0.084, 0.040)
    for dy in (0.080, -0.080):
        # Thigh, then the boot below it, set slightly further out so the leg
        # falls past the barrel and the rider reads as astride.
        boot = dy + math.copysign(0.004, dy)
        _bar(bm, (-0.015, 0, 0.508), (0.078, 0, 0.462), 0.028, 0.032, 0.024, 0.028, dy=dy)
        _bar(bm, (0.078, 0, 0.462), (0.086, 0, 0.388), 0.022, 0.024, 0.020, 0.022, dy=boot)
    _bar(bm, (0.005, 0, 0.638), (0.060, 0, 0.578), 0.022, 0.024, 0.018, 0.020, dy=0.084)
    _bar(bm, (-0.004, 0, 0.632), (0.030, 0, 0.668), 0.022, 0.024, 0.018, 0.020, dy=-0.088)


def _rider_helm(bm):
    _bar(bm, (-0.008, 0, 0.660), (-0.004, 0, 0.708), 0.046, 0.044, 0.040, 0.038)
    # Visor, and a crest over the crown, which marks the head at board
    # distance.
    _bar(bm, (0.030, 0, 0.686), (0.048, 0, 0.680), 0.018, 0.018, 0.014, 0.014)
    _bar(bm, (-0.018, 0, 0.708), (0.008, 0, 0.735), 0.012, 0.014, 0.008, 0.010)


def _rider_shield(bm):
    _disc_y(bm, 0.058, 0.585, 0.075, 0.085, 0.106, 0.128, sides=6)
    _box(bm, 0.044, 0.072, 0.126, 0.144, 0.571, 0.599)


#: The lance: butt low behind the hip, point high in front, passing through the
#: raised hand. The tallest part, nearly upright, which makes the rider legible
#: at board distance.
LANCE_BUTT = Vector((-0.055, 0.0, 0.462))
LANCE_TIP = Vector((0.082, 0.0, 0.752))
LANCE_DY = -0.100


def _rider_lance(bm):
    neck = LANCE_BUTT.lerp(LANCE_TIP, 0.88)
    _bar(bm, LANCE_BUTT, neck, 0.012, 0.012, 0.010, 0.010, dy=LANCE_DY)
    _bar(bm, neck, LANCE_TIP, 0.017, 0.017, 0.004, 0.004, dy=LANCE_DY)


#: Part name -> (seat slot, builder). Flat siblings, in the order they are
#: created; there is no parenting in this file, so every part is its own export
#: root and each is recentred by its own (world) origin.
PARTS = (
    ("Rider_horse_body", "Seat_Body", _horse_body),
    ("Rider_horse_neck", "Seat_Body", _horse_neck),
    ("Rider_horse_head", "Seat_Body", _horse_head),
    ("Rider_horse_legs", "Seat_Shade", _horse_legs),
    ("Rider_horse_mane", "Seat_Shade", _horse_mane),
    ("Rider_saddle", "Seat_Shade", _saddle),
    ("Rider_torso", "Seat_Body", _rider_torso),
    ("Rider_helm", "Seat_Detail", _rider_helm),
    ("Rider_shield", "Seat_Detail", _rider_shield),
    ("Rider_lance", "Seat_Detail", _rider_lance),
)


# --- assembly --------------------------------------------------------------


def _empty_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)


def _append_seat_slots():
    """Append the three shared tint materials out of `art/pieces.blend`."""
    if not os.path.exists(PIECES):
        raise SystemExit(f"MISSING {PIECES}")
    with bpy.data.libraries.load(PIECES) as (src, dst):
        missing = [n for n in SEAT_SLOTS if n not in src.materials]
        if missing:
            raise SystemExit(f"pieces.blend has no {missing}")
        dst.materials = list(SEAT_SLOTS)
    return {m.name: m for m in dst.materials if m is not None}


def main():
    _empty_scene()
    slots = _append_seat_slots()
    coll = bpy.data.collections.new(COLLECTION)
    # Linked into the scene collection: `export_assets` calls `obj.select_set`,
    # which throws for an object outside the view layer.
    bpy.context.scene.collection.children.link(coll)

    faces = 0
    for name, slot, build in PARTS:
        # The exporter and loader select by this prefix.
        if not name.startswith(PREFIX):
            raise SystemExit(f"{name} is not a {PREFIX}* part")
        obj = _part(name, slots[slot], build)
        faces += len(obj.data.polygons)
        print(f"PART {name} {slot} faces={len(obj.data.polygons)}")
    print("RIDER faces", faces, "in", len(PARTS), "parts")

    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print("WROTE", OUT)


if __name__ == "__main__":
    main()
    sys.exit(0)
