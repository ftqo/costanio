"""Generate `art/bridges.blend`: the Rivers bridge, a player-owned edge piece.

    blender --background --factory-startup \
        --python tools/blender/gen/bridges.py

The blend is an output of this script: do not model in it, the next run
overwrites it. Change the numbers here, re-run, then `make export-assets`.

A bridge takes a road's slot (one edge, one owner), so it follows the road's
contract: along +x, edge midpoint at the origin, base on the piece plane at
z = 0.250, laid by `edgeRotationY`. At 56 degrees of elevation verticals are
foreshortened to 56%, so it is told apart from a road by silhouette rather than
height:

  * a solid span with an arch cut through it: humped to 0.30 above the plane
    at the crown, flat on the ground outboard of the springings, open
    underneath in the middle. The spandrel (masonry between arch and roadway)
    is what makes it read as a bridge rather than a bent plank.
  * two parapets along the roadway's edges, in Seat_Detail against the span's
    Seat_Body: a material outline that reads at the far end of the board.
  * squat abutment blocks at each end, wider than the span and tall enough to
    cap the parapets.

`Road_A` is a `Seat_Body` bar 1.86 x 0.21 x 0.13 (z 0.250 to 0.380) between two
`Seat_Detail` end blocks 0.10 long and 0.25 wide (to 0.410), 1.96 long overall.
The bridge is also 1.96 long (82 faces), and its roadway meets the road's top
face (0.380) at the ends.

Only the three shared seat slots, appended from `art/pieces.blend` rather than
recreated (a hand-made copy would cause a `PALETTE_CONFLICT`).
"""

import math
import os
import sys

import bmesh
import bpy

#: tools/blender/gen/bridges.py -> the repo root, four levels up.
REPO = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
PIECES = os.path.join(REPO, "art", "pieces.blend")
OUT = os.path.join(REPO, "art", "bridges.blend")

#: Top face of a land tile, and the plane every piece modelled ON a tile stands
#: on. See `seating.ts` and `loader.assetBaseY`, which reads the base off the art.
PLANE = 0.250

#: Half the piece's overall length. The road's end blocks reach 0.98, so the
#: bridge is the same 1.96 from tip to tip and drops into the same slot.
HALF = 0.98

#: Half-length of the arched span. Its ends are buried inside the abutments.
DECK_HALF = 0.90

#: Half-widths. The span matches the road's end blocks (0.25 wide); the
#: abutments are wider so they read as footings the span lands on.
DECK_HALF_W = 0.125
ABUT_HALF_W = 0.150

#: The roadway at its ends, level with the road it continues, and at its crown.
DECK_END_TOP = 0.380
DECK_RISE = 0.170  # crown top = 0.550, i.e. 0.300 above the piece plane

#: The arch opening. The span is one extruded side profile: humped on top, flat
#: on the ground outboard of the springings, with an elliptical opening cut
#: between them.
ARCH_HALF = 0.420  # half the opening's span, so the feet are 0.48 long each
ARCH_RISE = 0.200  # crown of the opening; 0.10 of masonry between it and the roadway

#: The parapet, measured from the roadway's own top face at each station.
RAIL_SINK = 0.020  # how far its foot is buried in the deck, so no seam shows
RAIL_HEIGHT = 0.065
RAIL_HALF_W_OUTER = 0.125  # flush with the span's edge
RAIL_HALF_W_INNER = 0.088

#: The abutments. Tall enough to cap the parapet ends (0.445 at x = +/-0.90),
#: short enough along x that the span springs from the block face.
ABUT_INNER_X = 0.840
ABUT_TOP = 0.460

#: Segments along the deck and around the arch opening (low-poly house style).
SEGMENTS = 6
ARCH_SEGMENTS = 6


def deck_top(x):
    """The roadway at `x`, as a cosine hump over [-DECK_HALF, DECK_HALF].

    A cosine: flat at the crown, steepest at the springing, and no radius to
    keep in agreement with the span.
    """
    return DECK_END_TOP + DECK_RISE * math.cos(math.pi * 0.5 * x / DECK_HALF)


def stations():
    """The x positions the ribbons are built on, ends included."""
    return [-DECK_HALF + 2.0 * DECK_HALF * i / SEGMENTS for i in range(SEGMENTS + 1)]


def ribbon(bm, profile):
    """Sweep a rectangular cross-section along x and close both ends.

    `profile(x)` returns `(y0, y1, z0, z1)`. Four verts per station, four quads
    per gap, plus one cap at each end: 4 * SEGMENTS + 2 faces for the whole
    swept solid.
    """
    rings = []
    for x in stations():
        y0, y1, z0, z1 = profile(x)
        rings.append(
            [
                bm.verts.new((x, y0, z0)),
                bm.verts.new((x, y1, z0)),
                bm.verts.new((x, y1, z1)),
                bm.verts.new((x, y0, z1)),
            ]
        )
    for a, b in zip(rings, rings[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])


def box(bm, x0, x1, y0, y1, z0, z1):
    """One axis-aligned block: 8 verts, 6 faces."""
    lo = [
        bm.verts.new((x0, y0, z0)),
        bm.verts.new((x1, y0, z0)),
        bm.verts.new((x1, y1, z0)),
        bm.verts.new((x0, y1, z0)),
    ]
    hi = [bm.verts.new((v.co.x, v.co.y, z1)) for v in lo]
    bm.faces.new(lo)
    bm.faces.new(hi)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))


def build(name, material, emit):
    """One part: a mesh object at the world origin wearing exactly `material`.

    The origin stays at (0, 0, 0) and the geometry carries the pose, since
    `anchors.ROOT` subtracts the origin on export.
    """
    bm = bmesh.new()
    emit(bm)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    # Every face outward, computed rather than trusting the winding above.
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    # Flat shading, set explicitly: a mesh that ever passed through a
    # shade-smooth operator keeps it.
    for poly in mesh.polygons:
        poly.use_smooth = False
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (0.0, 0.0, 0.0)
    return obj


def span_profile():
    """The bridge's side elevation, as a closed loop of (x, z), anticlockwise.

    Sixteen points: six facets over the roadway, six round the opening, and
    the two solid feet between them.
    """
    loop = [(x, deck_top(x)) for x in stations()]  # roadway, left to right
    loop.append((DECK_HALF, PLANE))  # down the right end face
    for i in range(ARCH_SEGMENTS + 1):  # the opening, right to left
        a = math.pi * i / ARCH_SEGMENTS
        loop.append((ARCH_HALF * math.cos(a), PLANE + ARCH_RISE * math.sin(a)))
    loop.append((-DECK_HALF, PLANE))  # out along the left foot
    return loop


def span(bm):
    """The masonry: one side profile extruded across the piece's width.

    An n-gon at each end and one quad per profile edge: 2 + 16 faces. The end
    caps are concave; Blender's exporter triangulates them by ear clipping, and
    `bridgeArt.test.ts` counts the resulting triangles.
    """
    loop = span_profile()
    near = [bm.verts.new((x, -DECK_HALF_W, z)) for x, z in loop]
    far = [bm.verts.new((x, DECK_HALF_W, z)) for x, z in loop]
    for i in range(len(loop)):
        j = (i + 1) % len(loop)
        bm.faces.new((near[i], near[j], far[j], far[i]))
    bm.faces.new(near)
    bm.faces.new(far)


def rails(bm):
    """Both parapets in one object, the way `Road_A_trim` holds both end blocks."""
    for sign in (-1.0, 1.0):
        inner = sign * RAIL_HALF_W_INNER
        outer = sign * RAIL_HALF_W_OUTER

        def profile(x, inner=inner, outer=outer):
            top = deck_top(x)
            return min(inner, outer), max(inner, outer), top - RAIL_SINK, top + RAIL_HEIGHT

        ribbon(bm, profile)


def abutments(bm):
    for sign in (-1.0, 1.0):
        x0, x1 = sorted((sign * ABUT_INNER_X, sign * HALF))
        box(bm, x0, x1, -ABUT_HALF_W, ABUT_HALF_W, PLANE, ABUT_TOP)


#: part name -> (seat slot, geometry).
#:
#: The split from art/README.md: Body is the mass, Shade is plinths and what
#: sits behind, Detail is the one accent. Abutments are plinths (Shade) and
#: parapets the accent (Detail), whose light line draws the outline at a
#: distance.
PARTS = (
    ("Bridge_span", "Seat_Body", span),
    ("Bridge_rails", "Seat_Detail", rails),
    ("Bridge_abutments", "Seat_Shade", abutments),
)


def seat_materials():
    """Append Seat_Body / Seat_Shade / Seat_Detail from art/pieces.blend.

    Appended, not linked: the exporter opens this file on its own. Not
    recreated either (see the module docstring).
    """
    want = sorted({slot for _, slot, _ in PARTS})
    with bpy.data.libraries.load(PIECES, link=False) as (src, dst):
        missing = [n for n in want if n not in src.materials]
        if missing:
            raise SystemExit(f"MISSING {missing} in {PIECES}")
        dst.materials = want
    return {m.name: m for m in dst.materials if m is not None}


def clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)


def main():
    clear()
    mats = seat_materials()
    coll = bpy.data.collections.new("Bridge")
    bpy.context.scene.collection.children.link(coll)
    for name, slot, emit in PARTS:
        obj = build(name, mats[slot], emit)
        coll.objects.link(obj)
        print(
            "PART", name, slot,
            len(obj.data.vertices), "verts", len(obj.data.polygons), "faces",
        )
    faces = sum(len(o.data.polygons) for o in bpy.data.objects)
    print("BRIDGE", len(bpy.data.objects), "parts", faces, "faces")
    bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
    print("WROTE", OUT)


if __name__ == "__main__":
    sys.exit(main())
