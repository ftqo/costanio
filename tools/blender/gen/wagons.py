"""Build `art/wagons.blend`: the Wagons expansion's covered wagon.

    blender --background --factory-startup \
        --python tools/blender/gen/wagons.py

The blend is an output of this file: do not model in it, the next run
overwrites it. A wagon is 153 flat faces built from two dozen numbers, which
can be reviewed as a diff.

The blend is not byte-reproducible (Blender stamps its path and window state),
but `make export-assets` produces an identical `wagons.glb`, because `assetmeta`
strips the rest. A dirty blend after a no-op regeneration is expected; a dirty
`.glb` means the shape moved.

## Requirements

A wagon is player-owned and stands on a vertex, the settlement's place, so the
two share a junction:

- It wears only `Seat_Body` / `Seat_Shade` / `Seat_Detail`, copied from
  `art/pieces.blend`: those are the runtime's recolour channel
  (`frontend/src/lib/board3d/loader.ts`). The canopy takes `Seat_Body`, since
  the arch's top is the largest face toward the camera at 56 degrees.
- Smaller than a settlement in footprint and bigger in silhouette: 0.551 x
  0.350 against 0.419 x 0.389, and 0.450 tall against 0.400, so it reads as a
  second object beside the house.
- It faces +x and is centred on the origin in XY, the vertex-piece convention
  (`tools/blender/anchors.py`; ROOT).
- Its base is z = 0, like the knights and metropolises. `assetBaseY` reads it
  off the art and `seating.seatY` solves for the lift.

## Several wagons on one junction

More than one wagon may stand on a vertex. The layer that draws them should
ring them: offsets in authored units, times `MODULE_SCALE.wagon`, bearings
evenly spaced, each wagon yawed to face outward along its bearing:

    n = 1   no offset; the wagon stands on the vertex
    n = 2   radius 0.22, bearings 90 and 270 degrees
    n = 3   radius 0.38, bearings 120 degrees apart
    n = 4   radius 0.47, bearings 90 degrees apart

`frontend/src/lib/board3d/wagonArt.test.ts` re-derives these from the shipped
file. Four is the binding case: two wagons on perpendicular bearings clear
each other when r > (length + width) / 2 = (0.551 + 0.350) / 2 = 0.4505. Three
is bounded by the circumscribed circle (0.652 across) at 120 degrees; two only
have to miss across their widths.

A four-wagon ring spans 1.49 authored units, 2.98 at a drawn scale of 2.0,
against 3.144 between two vertices, so four wagons on adjacent junctions would
touch. If that matters, use a smaller drawn scale for a crowded vertex; the
ring is already at its minimum.

## Face budget

153 quads and n-gons (351 triangles after export), inside the 100-250 a piece
is allowed: 49 on the canopy (eight facets across the arch, six spans along
it, odd stations pulled in 7% so the even ones read as four hoops) and 72 on
the four wheels and hubs.
"""

import math
import os
import sys

# `bpy` is imported only inside `build()`, so every dimension and mesh builder
# imports without Blender and is tested by `make test-tools`
# (tools/blender/test_wagons.py).

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
PIECES = os.path.join(REPO, "art", "pieces.blend")
OUT = os.path.join(REPO, "art", "wagons.blend")

PREFIX = "Wagon_"
COLLECTION = "Wagon"

# --- the numbers --------------------------------------------------------
#
# Every dimension of the piece, in Blender units on a board whose hex has
# circumradius 3.0.

#: The cart body. Flared: the top edge overhangs the floor, the way a board
#: bed sits proud of its frame.
BED_X = (-0.235, 0.175)
BED_Z = (0.165, 0.265)
BED_HALF_TOP = 0.118
BED_HALF_BOTTOM = 0.092

#: The frame under it, carrying the axles.
FRAME_X = (-0.215, 0.185)
FRAME_Z = (0.110, 0.165)
FRAME_HALF = 0.055

#: Wheels: rear tall, front short, both octagons standing on a flat.
WHEEL_SIDES = 8
WHEEL_HALF_Y = 0.140  # centre plane of a wheel, left and right
WHEEL_T = 0.035  # rim thickness
REAR = {"x": -0.145, "r": 0.115}
FRONT = {"x": 0.135, "r": 0.090}

#: Hubs, outboard of the rims: the widest part, so they set the footprint.
HUB_SIDES = 6
HUB_R = 0.038
HUB_OUT = 0.0175  # how far the hub stands proud of the rim's outer face

#: The canopy. Springs from the bed's top rail and stands inside it (bed 0.118
#: half-wide at the top, arch 0.105), leaving a ledge of the darker slot along
#: each side so bed and canopy read as separate.
CANOPY_X = (-0.245, 0.145)
CANOPY_SPANS = 6  # six spans -> four hoops at the even stations
CANOPY_FACETS = 8  # facets across the arch
CANOPY_HALF = 0.105
CANOPY_RISE = 0.185
CANOPY_Z0 = 0.265
#: How far the canvas sags between two hoops: 7% reads as four ribs at play
#: distance.
CANOPY_SAG = 0.07
#: Shaping exponent on the arch's height. 1.0 is a semi-ellipse; below 1 fills
#: the top out and steepens the sides, like canvas over hoops.
CANOPY_FULLNESS = 0.85

#: The dark of the open back. It is the rear cap itself (same rim, dished
#: forward into the wagon), so the back reads as open.
TAILCLOTH_DEPTH = 0.045

#: The tongue: a tapered shaft running out and down from under the bed, with
#: a yoke bar across its end. Short, because it sets the overall length and
#: must not reach the neighbouring edge's road.
TONGUE_X = (0.150, 0.300)
TONGUE_Z_BACK = (0.098, 0.128)
TONGUE_Z_FRONT = (0.062, 0.086)
TONGUE_HALF_BACK = 0.024
TONGUE_HALF_FRONT = 0.017
YOKE_X = (0.272, 0.300)
YOKE_HALF = 0.062
YOKE_Z = (0.058, 0.086)


# --- mesh helpers -------------------------------------------------------
#
# A mesh is (verts, faces) throughout, so parts compose by concatenation and
# nothing needs bmesh. Every face is authored wound outward.


def merge(*meshes):
    verts, faces = [], []
    for vs, fs in meshes:
        base = len(verts)
        verts.extend(vs)
        faces.extend([tuple(i + base for i in f) for f in fs])
    return verts, faces


def prism(bottom, top):
    """Two matched loops, wound the same way, closed into a solid.

    `bottom` must be counter-clockwise seen from the side `top` is offset
    toward, so the side quads and both caps face outward. `test_wagons.py`
    checks the signed volume of every closed component.
    """
    n = len(bottom)
    verts = list(bottom) + list(top)
    faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    faces.append(tuple(range(n - 1, -1, -1)))  # the `bottom` cap, facing away
    faces.append(tuple(range(n, 2 * n)))  # the `top` cap, facing the offset
    return verts, faces


def box(x, y_half, z, y_half_top=None):
    """An axis-aligned box, optionally flared: wider at the top than the base.

    `x` and `z` are (lo, hi) pairs; `y_half` is the half-width at the bottom.
    """
    top = y_half if y_half_top is None else y_half_top
    bottom_loop = [
        (x[0], -y_half, z[0]),
        (x[1], -y_half, z[0]),
        (x[1], y_half, z[0]),
        (x[0], y_half, z[0]),
    ]
    top_loop = [
        (x[0], -top, z[1]),
        (x[1], -top, z[1]),
        (x[1], top, z[1]),
        (x[0], top, z[1]),
    ]
    return prism(bottom_loop, top_loop)


def wedge(x, z_back, z_front, half_back, half_front):
    """A box whose far end is smaller and lower: the tongue's taper."""
    bottom_loop = [
        (x[0], -half_back, z_back[0]),
        (x[1], -half_front, z_front[0]),
        (x[1], half_front, z_front[0]),
        (x[0], half_back, z_back[0]),
    ]
    top_loop = [
        (x[0], -half_back, z_back[1]),
        (x[1], -half_front, z_front[1]),
        (x[1], half_front, z_front[1]),
        (x[0], half_back, z_back[1]),
    ]
    return prism(bottom_loop, top_loop)


def disc_ring(sides, radius, phase, cx, cz):
    """A regular polygon in the xz plane, counter-clockwise seen from +y.

    The angle runs backwards (`-2*pi*i/sides`): x cross z is -y, so the
    natural winding would be clockwise from +y.
    """
    return [
        (
            cx + radius * math.cos(phase - 2.0 * math.pi * i / sides),
            0.0,
            cz + radius * math.sin(phase - 2.0 * math.pi * i / sides),
        )
        for i in range(sides)
    ]


def _spun(ring, y_lo, y_hi):
    """Close a disc ring into a solid between two y planes, lower one first."""
    lo = [(x, y_lo, z) for x, _, z in ring]
    hi = [(x, y_hi, z) for x, _, z in ring]
    return prism(lo, hi)


def wheel(sides, radius, cx, y_centre, thickness):
    """An octagonal rim lying in the xz plane, standing on a flat.

    The phase puts a flat at the bottom, and the ring is dropped so its lowest
    point is exactly z = 0. The wheels are the only parts touching the ground,
    so this sets the piece's base.
    """
    phase = math.pi / sides - math.pi / 2.0  # flat down
    ring = disc_ring(sides, radius, phase, cx, 0.0)
    lift = -min(p[2] for p in ring)
    ring = [(x, y, z + lift) for x, y, z in ring]
    return _spun(ring, y_centre - thickness / 2.0, y_centre + thickness / 2.0)


def hub(sides, radius, cx, cz, y_a, y_b):
    """The cream boss on a wheel's outer face. Either side, either order."""
    ring = disc_ring(sides, radius, math.pi / 2.0, cx, cz)
    return _spun(ring, min(y_a, y_b), max(y_a, y_b))


def wheel_centre_z(sides, radius):
    """Where a `wheel`'s axle ends up once it has been stood on the ground."""
    phase = math.pi / sides - math.pi / 2.0
    ring = disc_ring(sides, radius, phase, 0.0, 0.0)
    return -min(p[2] for p in ring)


def arch_profile(factor):
    """One hoop's cross-section, from -y through the apex to +y.

    `factor` scales the whole section: 1.0 at a hoop, a little under it where
    the canvas sags between two.
    """
    pts = []
    for i in range(CANOPY_FACETS + 1):
        a = math.pi * (1.0 - i / CANOPY_FACETS)
        y = CANOPY_HALF * factor * math.cos(a)
        z = CANOPY_Z0 + CANOPY_RISE * factor * (math.sin(a) ** CANOPY_FULLNESS)
        pts.append((y, z))
    return pts


def canopy():
    """The arch: a swept shell, closed at the front.

    Even stations are hoops at full size, odd ones are sagged, so six spans
    show four ribs. The front cap is a single n-gon (the shell must be closed).
    The rear is closed by `tailcloth`, the same rim in the darker slot; see
    TAILCLOTH_DEPTH.
    """
    x0, x1 = CANOPY_X
    stations = []
    for s in range(CANOPY_SPANS + 1):
        x = x0 + (x1 - x0) * s / CANOPY_SPANS
        factor = 1.0 if s % 2 == 0 else 1.0 - CANOPY_SAG
        stations.append([(x, y, z) for y, z in arch_profile(factor)])

    verts, faces = [], []
    for ring in stations:
        verts.extend(ring)
    n = CANOPY_FACETS + 1
    for s in range(CANOPY_SPANS):
        a, b = s * n, (s + 1) * n
        for i in range(CANOPY_FACETS):
            faces.append((b + i, b + i + 1, a + i + 1, a + i))
    front = n * CANOPY_SPANS
    faces.append(tuple(range(front + n - 1, front - 1, -1)))  # front cap, +x
    return verts, faces


def tailcloth():
    """The open back: the rear hoop's own rim, dished forward to a point."""
    rim = arch_profile(1.0)
    x = CANOPY_X[0]
    verts = [(x, y, z) for y, z in rim]
    cy = sum(y for y, _ in rim) / len(rim)
    cz = sum(z for _, z in rim) / len(rim)
    verts.append((x + TAILCLOTH_DEPTH, cy, cz))
    apex = len(verts) - 1
    faces = [(i, i + 1, apex) for i in range(len(rim) - 1)]
    return verts, faces


# --- the parts ----------------------------------------------------------
#
# name -> (material slot, mesh). Flat siblings, one material each, exactly as
# `art/camels.blend` and `art/pieces.blend` are laid out.


def parts():
    rear_z = wheel_centre_z(WHEEL_SIDES, REAR["r"])
    front_z = wheel_centre_z(WHEEL_SIDES, FRONT["r"])

    wheels = merge(
        *[
            wheel(WHEEL_SIDES, spec["r"], spec["x"], side * WHEEL_HALF_Y, WHEEL_T)
            for spec in (REAR, FRONT)
            for side in (-1.0, 1.0)
        ]
    )
    hubs = merge(
        *[
            hub(
                HUB_SIDES,
                HUB_R,
                spec["x"],
                cz,
                side * (WHEEL_HALF_Y + WHEEL_T / 2.0) - side * 0.004,
                side * (WHEEL_HALF_Y + WHEEL_T / 2.0 + HUB_OUT),
            )
            for spec, cz in ((REAR, rear_z), (FRONT, front_z))
            for side in (-1.0, 1.0)
        ]
    )
    return {
        f"{PREFIX}bed": (
            "Seat_Shade",
            merge(
                box(BED_X, BED_HALF_BOTTOM, BED_Z, y_half_top=BED_HALF_TOP),
                box(FRAME_X, FRAME_HALF, FRAME_Z),
            ),
        ),
        f"{PREFIX}wheels": ("Seat_Shade", wheels),
        f"{PREFIX}canopy": ("Seat_Body", canopy()),
        f"{PREFIX}tailcloth": ("Seat_Shade", tailcloth()),
        f"{PREFIX}hubs": ("Seat_Detail", hubs),
        f"{PREFIX}tongue": (
            "Seat_Detail",
            merge(
                wedge(
                    TONGUE_X,
                    TONGUE_Z_BACK,
                    TONGUE_Z_FRONT,
                    TONGUE_HALF_BACK,
                    TONGUE_HALF_FRONT,
                ),
                box(YOKE_X, YOKE_HALF, YOKE_Z),
            ),
        ),
    }


# --- the blend ----------------------------------------------------------


def wipe(bpy):
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.collections):
        for item in list(block):
            block.remove(item)


def seat_materials(bpy):
    """Copy `Seat_*` in from `art/pieces.blend` rather than recreating them.

    A recreated slot could disagree with other files' colours, which the
    exporter reports as PALETTE_CONFLICT.
    """
    with bpy.data.libraries.load(PIECES, link=False) as (src, dst):
        dst.materials = [m for m in src.materials if m.startswith("Seat_")]
    loaded = {m.name: m for m in bpy.data.materials if m.name.startswith("Seat_")}
    missing = {"Seat_Body", "Seat_Shade", "Seat_Detail"} - set(loaded)
    if missing:
        raise SystemExit(f"{PIECES} has no {sorted(missing)}")
    return loaded


def build():
    import bpy  # noqa: PLC0415 -- see the note beside the imports at the top

    wipe(bpy)
    mats = seat_materials(bpy)
    collection = bpy.data.collections.new(COLLECTION)
    bpy.context.scene.collection.children.link(collection)

    total = 0
    for name, (slot, (verts, faces)) in sorted(parts().items()):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces)
        mesh.validate()
        # House style: every face flat.
        for poly in mesh.polygons:
            poly.use_smooth = False
        obj = bpy.data.objects.new(name, mesh)
        obj.data.materials.append(mats[slot])
        collection.objects.link(obj)
        total += len(mesh.polygons)
        print(f"PART {name:22s} {len(mesh.polygons):3d} faces  {slot}")
    print("FACES", total)

    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print("WROTE", OUT)


if __name__ == "__main__":
    build()
    sys.exit(0)
