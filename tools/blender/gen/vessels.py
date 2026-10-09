"""The Explorers vessels: the cargo ship and the corsair.

    blender --background --factory-startup --python tools/blender/gen/vessels.py

Writes `art/vessels.blend`, which ships as `vessels.glb`. Generated: edit here
and re-run; do not model in the blend, the next run overwrites it.

## The two pieces

`Cargo_*`, the cargo ship. An edge piece on a sea edge, authored along +x with
the edge midpoint at the origin and its base at z=0 (the road convention
`edgeRotationY` expects, as the Islands route ship in `art/ships.blend`).

It shares the route ship's hull language (flat-bottomed chine, 0.20 deck
height, one mast) and adds an open hold: a 0.34 x 0.18 recess whose floor sits
0.06 above the base, sized for one settler or two crew from the harbour set.

Two may sit on one sea edge, so the beam is 0.28 (route ship 0.32, Islands
pirate 0.45) and the pair is drawn at y = +/-0.17, leaving 0.06 of water
between hulls. See `SIDE_BY_SIDE_Y`.

The mast is forward of the hold and its sail furled, so nothing covers the
hold at 56 degrees of elevation.

`Corsair_*`, the pirate ship. A hex-centre piece (Explorers' robber) centred
on the origin, base at z=0. Player-coloured: in Explorers the seat that moved
it owns it.

Two constraints shape it:

1. It must not stand in the number chip. A chip mounts at (0, +1.5) with a
   keep-clear radius of 1.05, so nothing may reach y = +0.45. The widest point
   is y = 0.29 (hull beam 0.58, sails 0.46), 1.21 from the socket. Authored
   along +y, a 1.2-long ship would cross the chip.
2. It must differ from the Islands pirate in `art/ships.blend` (1.40 x 0.45,
   one mast, one solid square sail, 0.79 tall). This one is shorter and
   beamier (1.20 x 0.58), lower (0.19 against 0.26), open-decked, with two
   masts and dark sails ragged at the hem (only outline survives at play
   distance).

## House style

Low-poly, flat-shaded, one material per part, `Seat_*` only (both pieces are
player-owned): `Seat_Body` is the hull and spars, `Seat_Shade` the hold's
recess, the cargo ship's mast and the corsair's canvas, `Seat_Detail` the one
accent (the hold's coaming, the furled sail, the corsair's flag).
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))  # tools/blender/gen
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
PIECES = os.path.join(REPO, "art", "pieces.blend")
OUT = os.path.join(REPO, "art", "vessels.blend")

BODY, SHADE, DETAIL = "Seat_Body", "Seat_Shade", "Seat_Detail"

# --- the cargo ship's contract ------------------------------------------
#
# Named because some are asserted on the shipped .glb
# (frontend/src/lib/board3d/vesselArt.test.ts) and the hold floor is what the
# harbour figures are modelled against.

CARGO_LENGTH = 1.10  # bow to transom, along +x
CARGO_BEAM = 0.28  # at the widest, and the ceiling for a side-by-side pair
CARGO_DECK_Z = 0.20  # the route ship's deck height exactly
HOLD_X, HOLD_Y = 0.34, 0.18  # the recess in the deck
HOLD_FLOOR_Z = 0.06  # where a settler standing in the hold puts its feet

#: Where the pair of cargo ships allowed on one sea edge is drawn, across it.
#: 0.34 apart with a 0.28 beam leaves 0.06 of water between the hulls.
SIDE_BY_SIDE_Y = 0.17

# --- the corsair's contract ---------------------------------------------

CORSAIR_LENGTH = 1.20
CORSAIR_BEAM = 0.58
CORSAIR_SHEER_Z = 0.19  # top of the bulwark; the Islands pirate's is 0.26
CORSAIR_DECK_Z = 0.10  # the open deck inside it
CORSAIR_HEIGHT = 0.90  # masthead flag, and the whole piece

#: Chip socket, in a hex-centred piece's frame, and the radius nothing may
#: enter (from `tools/blender/hexcontract.py`); why the corsair lies along +x.
SOCKET_Y, SOCKET_KEEPOUT = 1.5, 1.05


def clear():
    """Empty the factory-startup scene: no cube, no camera, no lamp."""
    for coll in (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.collections,
    ):
        for item in list(coll):
            coll.remove(item)


def seat_materials():
    """Append the three shared tint slots from art/pieces.blend.

    Appended rather than recreated, so the exporter never sees two
    disagreeing copies (PALETTE_CONFLICT).
    """
    with bpy.data.libraries.load(PIECES, link=False) as (src, dst):
        dst.materials = [n for n in src.materials if n.startswith("Seat_")]
    found = {m.name: m for m in bpy.data.materials if m.name.startswith("Seat_")}
    missing = [n for n in (BODY, SHADE, DETAIL) if n not in found]
    if missing:
        raise SystemExit(f"art/pieces.blend has no {missing}")
    return found


def part(collection, name, verts, faces, material):
    """One flat-shaded object, one material slot, linked into `collection`."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    mesh.validate()
    mesh.materials.append(material)
    # Every face flat: these are faceted pieces.
    for poly in mesh.polygons:
        poly.use_smooth = False
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


# --- geometry helpers ---------------------------------------------------


def box(x0, x1, y0, y1, z0, z1, y0_top=None, y1_top=None):
    """A six-faced box, optionally tapered in y toward the top."""
    a = y0 if y0_top is None else y0_top
    b = y1 if y1_top is None else y1_top
    verts = [
        (x0, y0, z0),
        (x1, y0, z0),
        (x1, y1, z0),
        (x0, y1, z0),
        (x0, a, z1),
        (x1, a, z1),
        (x1, b, z1),
        (x0, b, z1),
    ]
    faces = [
        (3, 2, 1, 0),  # bottom, facing -z
        (4, 5, 6, 7),  # top
        (0, 1, 5, 4),  # -y
        (2, 3, 7, 6),  # +y
        (1, 2, 6, 5),  # +x
        (3, 0, 4, 7),  # -x
    ]
    return verts, faces


def extrude_profile(profile, thickness, axis="y"):
    """A closed 2D profile swept a little way along `axis`.

    `profile` is a list of (x, z) wound counter-clockwise in the x-z plane as
    drawn with x right and z up, which puts the near cap's normal on -y.
    Returns the two caps plus one quad per profile edge: a flat plate with a
    shaped outline (the bow stem, the masthead flag).
    """
    n = len(profile)
    half = thickness / 2.0
    if axis != "y":
        raise ValueError("only the y sweep is used here")
    verts = [(u, -half, v) for u, v in profile] + [(u, half, v) for u, v in profile]
    faces = [tuple(range(n)), tuple(range(n, 2 * n))[::-1]]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, i + n, j + n, j))
    return verts, faces


def plate(profile, thickness):
    """A closed 2D profile in the y-z plane, swept a little way along x.

    For the sails, which lie across the beam. `profile` is (y, z) wound
    counter-clockwise as drawn with y right and z up. A sail is one sheet wider
    than it is tall, with its raggedness in the hem (`ragged_sail`).
    """
    n = len(profile)
    half = thickness / 2.0
    verts = [(-half, u, v) for u, v in profile] + [(half, u, v) for u, v in profile]
    faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j + n, i + n))
    return verts, faces


def ragged_sail(width, top, hems):
    """A sail plate: a straight head, and a hem torn into `len(hems)` steps."""
    half = width / 2.0
    step = width / (len(hems) - 1)
    bottom = [(-half + i * step, z) for i, z in enumerate(hems)]
    return bottom + [(half, top), (-half, top)]


def prism(centre, radius, half_len, sides):
    """A faceted rod lying along y: the furled sail bundle."""
    cx, cy, cz = centre
    rings = []
    for end in (-half_len, half_len):
        ring = []
        for i in range(sides):
            a = 2.0 * math.pi * (i + 0.5) / sides
            ring.append((cx + radius * math.cos(a), cy + end, cz + radius * math.sin(a)))
        rings.append(ring)
    verts = rings[0] + rings[1]
    faces = [tuple(range(sides)), tuple(range(sides, 2 * sides))[::-1]]
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, i + sides, j + sides, j))
    return verts, faces


def hull_shell(deck, keel, deck_z, inner, inner_z=None):
    """The shared hull: a bottom, a run of side plates, and a top ring.

    `deck` is the sheer line as an outline wound counter-clockwise seen from
    above, `keel` the matching loop at z = 0, `inner` the loop the top ring
    closes onto (the hold's coaming for the cargo ship, the inboard face of
    the bulwark for the corsair). With `inner_z` given, the ring is followed by
    an inboard wall dropping to that height and a deck floor there (the
    corsair's open deck).
    """
    n = len(deck)
    verts = [(x, y, 0.0) for x, y in keel]
    verts += [(x, y, deck_z) for x, y in deck]
    verts += [(x, y, deck_z) for x, y in inner]
    K, D, I = 0, n, 2 * n

    faces = [tuple(range(K, K + n))[::-1]]  # the bottom, facing -z
    for i in range(n):
        j = (i + 1) % n
        faces.append((K + i, K + j, D + j, D + i))  # side plates, facing out
        faces.append((D + i, D + j, I + j, I + i))  # the top ring, facing up

    if inner_z is not None:
        F = len(verts)
        verts += [(x, y, inner_z) for x, y in inner]
        for i in range(n):
            j = (i + 1) % n
            faces.append((I + i, I + j, F + j, F + i))  # inboard wall, facing in
        faces.append(tuple(range(F, F + n)))  # the deck floor
    return verts, faces


def tub(rect, rim_z, floor_z):
    """A rectangular recess: four inward walls and a floor.

    `rect` is the opening wound counter-clockwise seen from above, so the walls
    face into the hold.
    """
    n = len(rect)
    verts = [(x, y, rim_z) for x, y in rect] + [(x, y, floor_z) for x, y in rect]
    faces = [tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j + n, i + n))
    return verts, faces


def ring_wall(outer, inner, z0, z1):
    """A raised lip standing on a deck: outboard face, top, inboard face.

    No bottom: it sits on solid deck, and a floor would be coplanar with it.
    """
    n = len(outer)
    verts = [(x, y, z0) for x, y in outer]
    verts += [(x, y, z1) for x, y in outer]
    verts += [(x, y, z1) for x, y in inner]
    verts += [(x, y, z0) for x, y in inner]
    O0, O1, I1, I0 = 0, n, 2 * n, 3 * n
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((O0 + i, O0 + j, O1 + j, O1 + i))  # outboard
        faces.append((O1 + i, O1 + j, I1 + j, I1 + i))  # top
        faces.append((I1 + i, I1 + j, I0 + j, I0 + i))  # inboard
    return verts, faces


def scaled(loop, sx, sy):
    return [(x * sx, y * sy) for x, y in loop]


def rect_loop(hx, hy):
    """A rectangle wound counter-clockwise seen from above."""
    return [(hx, -hy), (hx, hy), (-hx, hy), (-hx, -hy)]


# --- the cargo ship -----------------------------------------------------

# The sheer line. Thirteen points: a pointed bow, a long parallel middle body
# and a square transom (unlike the route ship's wedge).
CARGO_DECK = [
    (0.550, 0.000),
    (0.455, 0.085),
    (0.300, 0.128),
    (0.060, 0.140),
    (-0.230, 0.138),
    (-0.470, 0.122),
    (-0.550, 0.085),
    (-0.550, -0.085),
    (-0.470, -0.122),
    (-0.230, -0.138),
    (0.060, -0.140),
    (0.300, -0.128),
    (0.455, -0.085),
]

# The chine, at z = 0. Pulled in and shortened so the topsides flare.
CARGO_KEEL = [(x * 0.82 - 0.02, y * 0.50) for x, y in CARGO_DECK]

# Where each sheer point lands on the hold's rim, so the deck between them is
# thirteen quads. Hand-written: a radial projection would skip the
# rectangle's corners and leave a hole.
_HX, _HY = HOLD_X / 2.0, HOLD_Y / 2.0
CARGO_HOLD_RIM = [
    (_HX, 0.0),
    (_HX, _HY),
    (0.10, _HY),
    (0.00, _HY),
    (-0.10, _HY),
    (-_HX, _HY),
    (-_HX, 0.045),
    (-_HX, -0.045),
    (-_HX, -_HY),
    (-0.10, -_HY),
    (0.00, -_HY),
    (0.10, -_HY),
    (_HX, -_HY),
]

MAST_X = 0.26  # forward of the hold, so nothing stands over the cargo


def build_cargo(mats):
    coll = bpy.data.collections.new("Cargo")
    bpy.context.scene.collection.children.link(coll)

    verts, faces = hull_shell(CARGO_DECK, CARGO_KEEL, CARGO_DECK_Z, CARGO_HOLD_RIM)
    part(coll, "Cargo_hull", verts, faces, mats[BODY])

    # The hold itself. Its walls stop at the deck and the coaming carries on
    # from there, so the recess is continuous from rim to floor.
    verts, faces = tub(rect_loop(_HX, _HY), CARGO_DECK_Z, HOLD_FLOOR_Z)
    part(coll, "Cargo_hold", verts, faces, mats[SHADE])

    # The coaming: a light lip round the opening, so the hold reads as a hold
    # from above rather than a dark patch.
    verts, faces = ring_wall(
        rect_loop(_HX + 0.025, _HY + 0.025), rect_loop(_HX, _HY), CARGO_DECK_Z, 0.235
    )
    part(coll, "Cargo_coaming", verts, faces, mats[DETAIL])

    verts, faces = box(MAST_X - 0.024, MAST_X + 0.024, -0.024, 0.024, CARGO_DECK_Z, 0.570)
    part(coll, "Cargo_mast", verts, faces, mats[SHADE])

    # Furled, not set, so it does not cover the hold. One fat roll crossing the
    # mast just below its head (a thin yard plus a roll reads as a cross).
    verts, faces = prism((MAST_X, 0.0, 0.500), 0.040, 0.125, 8)
    part(coll, "Cargo_sail", verts, faces, mats[DETAIL])

    # The stern castle, aft of the hold: shows which end is which from behind.
    verts, faces = box(-0.520, -0.340, -0.095, 0.095, CARGO_DECK_Z, 0.340, -0.075, 0.075)
    part(coll, "Cargo_castle", verts, faces, mats[SHADE])

    # The stem, stopping at x = 0.50 rather than the bow tip, where a post
    # would overhang the water.
    verts, faces = extrude_profile(
        [(0.260, 0.200), (0.500, 0.200), (0.500, 0.320), (0.370, 0.265)], 0.044
    )
    part(coll, "Cargo_prow", verts, faces, mats[SHADE])


# --- the corsair --------------------------------------------------------

CORSAIR_SHEER = [
    (0.600, 0.000),
    (0.500, 0.150),
    (0.330, 0.262),
    (0.050, 0.290),
    (-0.250, 0.285),
    (-0.500, 0.250),
    (-0.600, 0.175),
    (-0.600, -0.175),
    (-0.500, -0.250),
    (-0.250, -0.285),
    (0.050, -0.290),
    (0.330, -0.262),
    (0.500, -0.150),
]
CORSAIR_KEEL = [(x * 0.80 - 0.02, y * 0.45) for x, y in CORSAIR_SHEER]

# The inboard face of the bulwark: the sheer line brought in by 0.05 at the
# extremes of each axis. Anisotropic: a uniform inset would miter into a spike
# at the bow.
CORSAIR_INNER = scaled(CORSAIR_SHEER, 1.0 - 0.05 / 0.600, 1.0 - 0.05 / 0.290)

#: (name, mast x, mast half-width, masthead z, sail width, sail head z, hem)
#:
#: The hem carries the raggedness, since only the outline reads against the
#: sea. Six uneven steps with 0.14 of throw (a regular sawtooth reads as
#: decoration).
CORSAIR_MASTS = (
    ("main", -0.100, 0.028, 0.860, 0.520, 0.700, (0.44, 0.30, 0.46, 0.32, 0.42, 0.36)),
    ("fore", 0.280, 0.026, 0.660, 0.400, 0.560, (0.34, 0.24, 0.36, 0.26, 0.32, 0.28)),
)


def build_corsair(mats):
    coll = bpy.data.collections.new("Corsair")
    bpy.context.scene.collection.children.link(coll)

    verts, faces = hull_shell(
        CORSAIR_SHEER,
        CORSAIR_KEEL,
        CORSAIR_SHEER_Z,
        CORSAIR_INNER,
        inner_z=CORSAIR_DECK_Z,
    )
    part(coll, "Corsair_hull", verts, faces, mats[BODY])

    # The aftercastle, standing on the open deck: this sheer steps, unlike the
    # Islands pirate's.
    verts, faces = box(-0.520, -0.240, -0.170, 0.170, CORSAIR_DECK_Z, 0.360, -0.140, 0.140)
    part(coll, "Corsair_castle", verts, faces, mats[BODY])

    for name, x, half, head, width, top, hem in CORSAIR_MASTS:
        # Spars in the hull's colour, so the rig has structure against the
        # dark canvas.
        verts, faces = box(x - half, x + half, -half, half, CORSAIR_DECK_Z, head)
        part(coll, f"Corsair_mast_{name}", verts, faces, mats[BODY])
        verts, faces = box(x - half, x + half, -width / 2 - 0.02, width / 2 + 0.02, top, top + 0.03)
        part(coll, f"Corsair_yard_{name}", verts, faces, mats[BODY])
        # Thicker than the mast, so the canvas hides the spar it hangs on.
        verts, faces = plate(ragged_sail(width, top, hem), 0.070)
        for i, (vx, vy, vz) in enumerate(verts):
            verts[i] = (vx + x, vy, vz)
        part(coll, f"Corsair_sail_{name}", verts, faces, mats[SHADE])

    # The one accent, at the main masthead and streaming aft. It is also the
    # top of the piece: CORSAIR_HEIGHT is this flag's upper edge.
    verts, faces = extrude_profile(
        [(-0.100, 0.800), (-0.100, CORSAIR_HEIGHT), (-0.340, 0.855)], 0.024
    )
    part(coll, "Corsair_flag", verts, faces, mats[DETAIL])


def measure():
    """Print the envelope, and fail rather than write art that breaks it.

    Checks the constants at the top of this file when the blend is written,
    so a later profile edit cannot slide past them.
    """
    spans = {}
    for prefix in ("Cargo_", "Corsair_"):
        objs = [o for o in bpy.data.objects if o.name.startswith(prefix)]
        pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
        lo = [min(p[i] for p in pts) for i in range(3)]
        hi = [max(p[i] for p in pts) for i in range(3)]
        spans[prefix] = (lo, hi)
        print(
            f"{prefix} parts={len(objs)} faces={sum(len(o.data.polygons) for o in objs)} "
            f"x[{lo[0]:.3f},{hi[0]:.3f}] y[{lo[1]:.3f},{hi[1]:.3f}] z[{lo[2]:.3f},{hi[2]:.3f}]"
        )
        if lo[2] != 0.0:
            raise SystemExit(f"{prefix} does not stand on z = 0 (base {lo[2]:.4f})")

    def check(label, got, want, tol=1e-6):
        if abs(got - want) > tol:
            raise SystemExit(f"{label}: {got:.4f}, expected {want:.4f}")

    (clo, chi), (plo, phi) = spans["Cargo_"], spans["Corsair_"]
    check("cargo length", chi[0] - clo[0], CARGO_LENGTH)
    check("cargo beam", chi[1] - clo[1], CARGO_BEAM)
    check("cargo is off the edge midpoint", clo[0] + chi[0], 0.0)
    if chi[1] - clo[1] > 2 * SIDE_BY_SIDE_Y - 0.02:
        raise SystemExit("two cargo ships would touch at SIDE_BY_SIDE_Y")

    hold = bpy.data.objects["Cargo_hold"]
    hpts = [hold.matrix_world @ v.co for v in hold.data.vertices]
    check("hold length", max(p[0] for p in hpts) - min(p[0] for p in hpts), HOLD_X)
    check("hold width", max(p[1] for p in hpts) - min(p[1] for p in hpts), HOLD_Y)
    check("hold floor", min(p[2] for p in hpts), HOLD_FLOOR_Z)

    check("corsair length", phi[0] - plo[0], CORSAIR_LENGTH)
    check("corsair beam", phi[1] - plo[1], CORSAIR_BEAM)
    check("corsair height", phi[2] - plo[2], CORSAIR_HEIGHT)
    check("corsair is off centre", plo[0] + phi[0], 0.0)

    pts = [
        o.matrix_world @ v.co
        for o in bpy.data.objects
        if o.name.startswith("Corsair_")
        for v in o.data.vertices
    ]
    near = min(math.hypot(p[0], SOCKET_Y - p[1]) for p in pts)
    print(f"  corsair nearest approach to the chip socket: {near:.3f} (keep out {SOCKET_KEEPOUT})")
    if near <= SOCKET_KEEPOUT:
        raise SystemExit("the corsair stands in the number chip")


def main():
    clear()
    mats = seat_materials()
    build_cargo(mats)
    build_corsair(mats)
    measure()
    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print("WROTE", OUT)


if __name__ == "__main__":
    main()
    sys.exit(0)
