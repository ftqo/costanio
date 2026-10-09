"""Generate `art/harbors.blend`: the Explorers harbour quay and its cargo.

    blender --background --factory-startup --python tools/blender/gen/harbors.py

Three prefixes, one file (as `art/knights.blend` ships knights and swords):
the figures are never drawn without the quay.

  `Harbor_*`  the quay. An add-on beside whatever building stands on the
              vertex, not a building of its own; its basin holds cargo.
  `Settler_*` the "large" cargo figure. One fills the basin.
  `Crew_*`    the "small" cargo figure. Two fit side by side in it.

Generated: do not model in the output, the next run overwrites it. Change the
constants below, re-run, then `make export-assets`.

The quay stands beside whatever the player's own piece set draws on the vertex
and never draws a house itself: piece sets (`frontend/src/lib/pieceSets.ts`)
replace buildings by node name, and a built-in house would ignore the player's
set and stay a settlement after a city upgrade. So the geometry starts at
QUAY_X0, a measured clearance (see CLEARANCE).

The basin is an interface: the cargo ship (`art/vessels.blend`) has a hold of
the same size with its floor at the same height, so one slot describes where a
cargo figure stands on a dock or a ship:

    slot        BASIN_X x BASIN_Y = 0.18 x 0.34, floor at z = BASIN_FLOOR_Z
    in harbour  centred at (BASIN_CX, 0) from the vertex the piece stands on

Two crew abreast set the 0.34 (two radii of `CREW_R` occupy 0.22). A settler is
wider than a crew member only at the hat, above the rim, so the 0.18 is set by
the settler's body.

Axes: the origin is the lattice vertex the building stands on, and +x is
seaward; nothing has a vertex at x < QUAY_X0. Yaw zero means water at +x (the
convention of `render_harbors.py` and the weir's `WEIR_FACES`); the layer turns
the quay toward open water. The near edge is perpendicular to +x and centred on
y = 0, so the closest approach to the origin is QUAY_X0 at every yaw.

Everything has its base at z = 0 and its object origin on the staging point
(`anchors.ROOT`, which the exporter subtracts). All parts of one item share one
origin, since each part is its own export root.
"""

import math
import os

import bmesh
import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
ART = os.path.join(REPO, "art")
PIECES = os.path.join(ART, "pieces.blend")
OUT = os.path.join(ART, "harbors.blend")

#: The one collection every part is a flat sibling in.
COLLECTION = "Harbors"

# --- how far seaward the deck has to start ---------------------------------
#
# CLEARANCE. The quay must miss every building any shipped piece set can put on
# the vertex, at its drawn size, at any yaw. Measured off the shipped .glbs;
# `harborArt.test.ts` re-measures them:
#
#     drawn radius = authored horizontal radius from the vertex x PIECE_SCALE
#
#                    settlement (x2.0)        city (x2.58)
#     pieces.glb          0.5032                  0.8341   <- the binding one
#     classic.glb         0.4960                  0.8016
#     cyclades.glb        0.4922                  0.7756
#
# Radius, because both the building and the quay turn independently. The quay
# is drawn at the settlement's factor (2.0), so QUAY_X0 x 2.0 must clear
# 0.8341. 0.50 puts the near edge one world unit out, clearing the stock city
# by 0.166, a visible gap.
QUAY_X0 = 0.50

# --- the quay --------------------------------------------------------------
#
# The deck extends seaward (+x). Nothing reaches back past QUAY_X0: a connector
# would need to know the height of a building it cannot know.
QUAY_X1 = 0.92  # 0.42 of deck
QUAY_Y = 0.275  # half-width: the deck is the widest thing here, at 0.55
QUAY_Z = 0.14  # deck height

#: The cargo slot, as offsets from the vertex the piece stands on.
BASIN_X = 0.18  # along x, set by a settler's body diameter plus clearance
BASIN_Y = 0.34  # along y, set by two crew abreast plus clearance
BASIN_CX = (QUAY_X0 + QUAY_X1) / 2.0  # centre; equidistant from both ends
BASIN_FLOOR_Z = 0.06  # where a cargo figure's base sits. Shared with the ship.

#: Two mooring bollards, at the seaward corners of the deck. Squat and in the
#: deck's `Seat_Shade`, so they are not mistaken for crew figures.
BOLLARD_R = 0.038
BOLLARD_Z = 0.180
BOLLARD_AT = ((0.875, 0.215), (0.875, -0.215))

# --- what makes a bare deck read as a harbour ------------------------------
#
# At 56 degrees of elevation a low slab reads as a paving stone, so two tall
# cues make it a harbour:
#
#   the derrick  a mast with a jib arm over the water and a hoist block. The
#                tallest part (0.46), in `Seat_Body`, so it shows whose harbour
#                this is. The arm keeps it from reading as a cargo figure.
#   the crates   two boxes at the landward corner, in `Seat_Detail`, which also
#                show which end the water is at.
MAST_AT = (0.575, 0.212)
MAST_R = 0.034
MAST_Z = 0.46
#: The jib, and the block hanging from its end. Both clear the basin's column
#: in y, so the hoist hangs just outside the basin.
JIB = (0.552, 0.855, 0.192, 0.232, 0.395, 0.445)
HOIST = (0.795, 0.835, 0.196, 0.228, 0.300, 0.395)
#: Landward corner, opposite the mast, and entirely landward of the basin.
CRATES = (
    (0.520, 0.615, -0.240, -0.145, QUAY_Z, QUAY_Z + 0.095),
    (0.530, 0.605, -0.130, -0.055, QUAY_Z, QUAY_Z + 0.075),
)

# --- the cargo figures -----------------------------------------------------
#
# Peg-people, eight-sided so a vertex lands on +x and the width below is the
# width across points, the number that has to fit the slot.
NGON = 8

SETTLER_H = 0.32
SETTLER_BODY_R = 0.065  # 0.13 across, inside BASIN_X with 0.05 to spare
SETTLER_BRIM_R = 0.080  # 0.16 across: the hat makes it read as large
SETTLER_HEAD_R = 0.046
#: How much the body narrows toward the shoulders. Kept mild; a strong taper
#: reads as a pawn or a lamp.
SETTLER_SHOULDER = 0.89

CREW_H = 0.22
CREW_BODY_R = 0.055  # 0.11 across; two of them are 0.22 inside BASIN_Y's 0.34
CREW_HEAD_R = 0.038
CREW_SHOULDER = 0.78

#: Where each item is staged in the blend. The exporter subtracts these.
STAGE = {"Harbor": (0.0, 0.0), "Settler": (1.4, 0.0), "Crew": (1.8, 0.0)}


# --------------------------------------------------------------------------
# geometry


def box(x0, x1, y0, y1, z0, z1):
    """An axis-aligned box as (verts, faces)."""
    verts = [
        (x0, y0, z0),
        (x1, y0, z0),
        (x1, y1, z0),
        (x0, y1, z0),
        (x0, y0, z1),
        (x1, y0, z1),
        (x1, y1, z1),
        (x0, y1, z1),
    ]
    faces = [
        (0, 1, 2, 3),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (2, 3, 7, 6),
        (3, 0, 4, 7),
    ]
    return verts, faces


def pocket(x0, x1, y0, y1, zb, zt, ax0, ax1, ay0, ay1, zf):
    """A slab with a rectangular recess in its top face. Fourteen faces.

    The basin, as one closed shell so no backfaces show from any bearing.
    """
    out_t = [(x0, y0, zt), (x1, y0, zt), (x1, y1, zt), (x0, y1, zt)]
    inn_t = [(ax0, ay0, zt), (ax1, ay0, zt), (ax1, ay1, zt), (ax0, ay1, zt)]
    floor = [(ax0, ay0, zf), (ax1, ay0, zf), (ax1, ay1, zf), (ax0, ay1, zf)]
    bot = [(x0, y0, zb), (x1, y0, zb), (x1, y1, zb), (x0, y1, zb)]
    verts = out_t + inn_t + floor + bot
    O, I, F, B = 0, 4, 8, 12
    faces = [tuple(B + i for i in (0, 1, 2, 3)), tuple(F + i for i in (0, 1, 2, 3))]
    for i in range(4):
        j = (i + 1) % 4
        faces.append((B + i, B + j, O + j, O + i))  # outer wall
        faces.append((O + i, O + j, I + j, I + i))  # top rim
        faces.append((I + i, I + j, F + j, F + i))  # pocket wall
    return verts, faces


def ngon(sides, r0, r1, z0, z1, cx=0.0, cy=0.0):
    """A prism or frustum with `sides` faces round it, a vertex on +x."""
    ring = [2.0 * math.pi * i / sides for i in range(sides)]
    low = [(cx + r0 * math.cos(a), cy + r0 * math.sin(a), z0) for a in ring]
    high = [(cx + r1 * math.cos(a), cy + r1 * math.sin(a), z1) for a in ring]
    verts = low + high
    faces = [tuple(range(sides)), tuple(range(sides, 2 * sides))]
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    return verts, faces


def merge(*parts):
    """Concatenate (verts, faces) pairs into one mesh's worth, reindexed."""
    verts, faces = [], []
    for pv, pf in parts:
        base = len(verts)
        verts.extend(pv)
        faces.extend(tuple(base + i for i in f) for f in pf)
    return verts, faces


# --------------------------------------------------------------------------
# blend plumbing


def wipe():
    """An empty file, whatever --factory-startup opened with."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.collections):
        bpy.data.collections.remove(block)


def seat_materials():
    """The three shared tint slots, copied from art/pieces.blend.

    Never recreated: `palette.json` is keyed on material name, and two blends
    disagreeing about a colour is a PALETTE_CONFLICT.
    """
    with bpy.data.libraries.load(PIECES, link=False) as (src, dst):
        dst.materials = [n for n in src.materials if n.startswith("Seat_")]
    out = {}
    for mat in dst.materials:
        if mat is None:
            continue
        out[mat.name] = mat
    for want in ("Seat_Body", "Seat_Shade", "Seat_Detail"):
        if want not in out:
            raise SystemExit(f"{PIECES} has no {want}")
    return out


def make(name, geom, material, at, collection):
    """One flat sibling object: mesh from `geom`, origin at `at`, flat-shaded."""
    verts, faces = geom
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bverts = [bm.verts.new(v) for v in verts]
    bm.verts.index_update()
    for face in faces:
        bm.faces.new([bverts[i] for i in face])
    bm.faces.ensure_lookup_table()
    # Authored windings are not trusted; recalculate normals.
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = False
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = (at[0], at[1], 0.0)
    collection.objects.link(obj)
    return obj


# --------------------------------------------------------------------------
# the three items


def harbor(mats, coll):
    at = STAGE["Harbor"]

    make(
        "Harbor_quay",
        pocket(
            QUAY_X0,
            QUAY_X1,
            -QUAY_Y,
            QUAY_Y,
            0.0,
            QUAY_Z,
            BASIN_CX - BASIN_X / 2.0,
            BASIN_CX + BASIN_X / 2.0,
            -BASIN_Y / 2.0,
            BASIN_Y / 2.0,
            BASIN_FLOOR_Z,
        ),
        mats["Seat_Shade"],
        at,
        coll,
    )

    posts = [
        ngon(NGON, BOLLARD_R, BOLLARD_R * 0.8, 0.0, BOLLARD_Z, cx, cy) for cx, cy in BOLLARD_AT
    ]
    make("Harbor_bollard", merge(*posts), mats["Seat_Shade"], at, coll)

    # The mast rises from the deck, not the ground, to keep geometry out of
    # the slab.
    mast = ngon(NGON, MAST_R, MAST_R * 0.85, QUAY_Z, MAST_Z, MAST_AT[0], MAST_AT[1])
    make("Harbor_derrick", merge(mast, box(*JIB), box(*HOIST)), mats["Seat_Body"], at, coll)

    make("Harbor_crate", merge(*(box(*c) for c in CRATES)), mats["Seat_Detail"], at, coll)


def settler(mats, coll):
    at = STAGE["Settler"]
    body_top = 0.185
    head_top = 0.258
    make(
        "Settler_body",
        ngon(NGON, SETTLER_BODY_R, SETTLER_BODY_R * SETTLER_SHOULDER, 0.0, body_top),
        mats["Seat_Body"],
        at,
        coll,
    )
    make(
        "Settler_head",
        ngon(NGON, SETTLER_HEAD_R, SETTLER_HEAD_R, body_top, head_top),
        mats["Seat_Shade"],
        at,
        coll,
    )
    # Brim then crown, in the trim colour: at board elevation the hat is the
    # part of a settler that shows, and a pale disc reads against the dark deck.
    brim = ngon(NGON, SETTLER_BRIM_R, SETTLER_BRIM_R, head_top - 0.004, head_top + 0.012)
    crown = ngon(NGON, SETTLER_HEAD_R + 0.006, SETTLER_HEAD_R, head_top + 0.012, SETTLER_H)
    make("Settler_hat", merge(brim, crown), mats["Seat_Detail"], at, coll)


def crew(mats, coll):
    at = STAGE["Crew"]
    body_top = 0.155
    make(
        "Crew_body",
        ngon(NGON, CREW_BODY_R, CREW_BODY_R * CREW_SHOULDER, 0.0, body_top),
        mats["Seat_Body"],
        at,
        coll,
    )
    # A sash at the waist rather than a hat, so the small figure carries all
    # three tint slots and is distinct from the settler. Flush with the body's
    # widest point so it does not widen the piece past the slot.
    make(
        "Crew_sash",
        ngon(NGON, CREW_BODY_R, CREW_BODY_R, 0.070, 0.095),
        mats["Seat_Shade"],
        at,
        coll,
    )
    make(
        "Crew_head",
        ngon(NGON, CREW_HEAD_R, CREW_HEAD_R, body_top, CREW_H),
        mats["Seat_Detail"],
        at,
        coll,
    )


def main():
    wipe()
    mats = seat_materials()
    coll = bpy.data.collections.new(COLLECTION)
    bpy.context.scene.collection.children.link(coll)
    harbor(mats, coll)
    settler(mats, coll)
    crew(mats, coll)

    faces = sum(len(o.data.polygons) for o in bpy.data.objects)
    print("HARBORS", len(bpy.data.objects), "objects", faces, "faces")
    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print("WROTE", OUT)


if __name__ == "__main__":
    main()
