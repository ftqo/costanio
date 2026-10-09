"""The three Explorers cargo pieces, as pure geometry.

Imports no bpy, so the shapes unit-test without Blender. The bpy half is
`gen/cargo.py`, which turns these vertex lists into objects with materials and
saves `art/cargo.blend`.

Everything is built in Blender space, Z up, with the piece's contact point at
z = 0 and its origin on the world origin: the export pose (`anchors.rule_for`
returns ROOT for all three prefixes). The renderer seats a piece off its own
base (`board3d/seating.ts`), so the base sits at exactly 0.

Three pieces, three prefixes, one file:

  `Haul_*`    the fish haul. A neutral "large" cargo piece: two chunky fish
              lashed head to tail, lying flat, 0.326 x 0.163 x 0.138, so it
              drops into a 0.34 x 0.18 hold recess with 0.007 of clearance
              along it and 0.009 across. It also sits on a sea hex, so the body
              is a bright silver-blue against `Mat_Ocean` (0.012, 0.06, 0.26).
  `Spice_*`   the spice sack. A neutral "small" cargo piece: 0.14 across and
              0.164 tall with a cinched neck, so two sit side by side across
              the same 0.18 hold. It also piles up on a spice village hex
              (see `SACK_PITCH` and `SACK_TIER`).
  `Marker_*`  the mission marker. Player-owned, so it wears only the shared
              seat slots: `Seat_Body` on the face, `Seat_Shade` on the rim.
              0.2 across, 0.08 thick, bevelled top and bottom, and it stacks
              at exactly its own thickness (`MARKER_STACK`).

House style: low-poly, chunky, flat-shaded, colour by material only. No lathe
finer than 12 sides; at 56 degrees of elevation a 0.32 piece is a thumbnail
and only its outline survives.
"""

import math

import robber_kit as kit

TAU = math.tau

# --- the fish haul ---------------------------------------------------------

#: Overall envelope, and the hold recess it drops into (`art/vessels`), so a
#: change to either side fails a test.
HAUL_LEN = 0.32
HAUL_WIDE = 0.16
HOLD_RECESS = (0.34, 0.18)

#: Sections of one fish, as (fraction of body length from the tail, half-width,
#: half-height). Widest a little behind mid-body so it reads as a fish.
#:
#: Four sections, so the detail is a step in the profile rather than a smooth
#: spindle. The head is a blunt ring (a point reads as an arrowhead); the tail
#: root is a point, hidden by the tail fin.
FISH_SECTIONS = (
    (0.00, 0.000, 0.000),
    (0.32, 0.031, 0.049),
    (0.66, 0.036, 0.058),
    (1.00, 0.011, 0.019),
)

#: The section outline, as unit (y, z) offsets scaled by (half-width,
#: half-height). Flat underneath, so it rests on its belly, and ridged on top:
#: the crest at `FISH_CREST` stands in for a dorsal fin.
FISH_CREST = 1.30
FISH_PROFILE = (
    (1.00, 0.10),
    (0.00, FISH_CREST),
    (-1.00, 0.10),
    (-0.60, -0.80),
    (0.60, -0.80),
)

FISH_LEN = 0.28  #: nose to tail root, before the tail fin
FISH_TAIL_X = 0.13  #: where the tail root sits, on the fish's own side of x=0
FISH_OFFSET_Y = 0.038  #: half the gap between the two fish

#: The lowest point of `FISH_PROFILE`, so the belly of the widest section can
#: be put on z = 0 exactly rather than near it.
_BELLY = max(-z for _, z in FISH_PROFILE)
FISH_MAX_HH = max(hh for _, _, hh in FISH_SECTIONS)
FISH_AXIS_Z = _BELLY * FISH_MAX_HH

#: One lashing, at x = 0 where both fish are fattest. The silhouette has room
#: for about four dark shapes at this size; it carries three (two tails, one
#: cord).
LASH_X = 0.0
LASH_THICK = 0.010

#: The cord's thickness, as a distance from the bodies it is tied round.
#:
#: A distance rather than a ratio: scaling outward would fatten it most at the
#: ends, where the 0.18 recess has least room.
LASH_STANDOFF = 0.010

#: Where the cord's two ends stop. Just inside the widest point (0.97) and low
#: on the flank, so the ends tuck under the bundle instead of standing off it.
LASH_TUCK = 0.97
LASH_HEM = 0.016

# --- the spice sack --------------------------------------------------------

SACK_SIDES = 8

#: (radius, z) up the sack: a fat base, a cinch at 0.114, and a gathered tuft
#: above it. The cinch is what makes it read as a sack. Five rings (base,
#: belly, cinch, tuft, top), one edge per feature, with hard steps.
SACK_PROFILE = (
    (0.048, 0.000),
    (0.070, 0.058),
    (0.026, 0.114),
    (0.046, 0.152),
    (0.028, 0.164),
)

#: The cord at the neck: a ring pinched onto it, as (radius, z).
#:
#: A three-point lathe whose caps (radius 0.026) sit inside the sack at both
#: heights (0.034 at z = 0.104, 0.031 at z = 0.124), so they are never seen and
#: the cord bites into the neck.
TIE_PROFILE = ((0.026, 0.104), (0.044, 0.114), (0.026, 0.124))

#: How a pile of 2-4 sacks is laid out, for whoever draws the spice village.
#:
#: `SACK_PITCH` is centre to centre in the plane: 0.125 against a 0.140-wide
#: sack, so neighbours interpenetrate by 0.015 and lean on each other the way
#: burlap does. Two sit at +/- SACK_PITCH/2 on one axis; three make a triangle
#: of that side; the fourth goes in the middle of the three, lifted by
#: `SACK_TIER`. That rise is above the lower sacks' widest ring (0.058) and
#: below their cinch (0.114), so the top sack settles into the valley instead
#: of balancing on three shoulders. A pile of four stands 0.276 tall.
SACK_PITCH = 0.125
SACK_TIER = 0.112

# --- the mission marker ----------------------------------------------------

MARKER_SIDES = 12

#: The rim, in `Seat_Shade`: a straight side between two 0.014 bevels, so a
#: stack reads as separate markers.
MARKER_RIM = ((0.086, 0.000), (0.100, 0.012), (0.100, 0.062), (0.086, 0.074))

#: The face, in `Seat_Body`, sunk 0.002 into the rim's top cap so the two
#: never share a plane in the depth buffer (as `Chip_*_face` overlaps
#: `Chip_*_body` by 0.005).
MARKER_FACE = ((0.076, 0.072), (0.080, 0.076), (0.068, 0.080))

#: Marker to marker in a stack: exactly the piece's height, so no gap or
#: overlap compounds up the stack.
MARKER_STACK = 0.080


def _fish_body(direction):
    """One fish, lofted from `FISH_SECTIONS`. `direction` +1 puts the nose at +x."""
    tail_x = -direction * FISH_TAIL_X
    y0 = direction * FISH_OFFSET_Y
    rings = []
    for fraction, half_w, half_h in FISH_SECTIONS:
        x = tail_x + direction * fraction * FISH_LEN
        if half_w <= 1e-9:
            rings.append([(x, y0, FISH_AXIS_Z)])
            continue
        rings.append(
            [(x, y0 + uy * half_w, FISH_AXIS_Z + uz * half_h) for uy, uz in FISH_PROFILE]
        )
    return loft(rings)


def _fish_fins(direction):
    """The tail of one fish. `Mat_Haul_fin`, and the only fin left on the piece.

    It sets the haul's overall length, so `HAUL_LEN` moves with it.
    """
    tail_x = -direction * FISH_TAIL_X
    y0 = direction * FISH_OFFSET_Y
    z = FISH_AXIS_Z

    # A forked flat blade hanging off the tail root, notched back toward the
    # body so it reads as two lobes and not as a paddle. The lower lobe stops at
    # z = 0.0014, just clear of the floor the haul rests on.
    return slab(
        [
            (tail_x + direction * 0.005, z),
            (tail_x - direction * 0.033, z + 0.052),
            (tail_x - direction * 0.016, z),
            (tail_x - direction * 0.033, z - 0.045),
        ],
        y0 - 0.006,
        y0 + 0.006,
    )


def _section_at(direction, x):
    """One fish's `(half-width, half-height)` where the plane `x` cuts it."""
    tail_x = -direction * FISH_TAIL_X
    f = min(max(direction * (x - tail_x) / FISH_LEN, 0.0), 1.0)
    for (f0, w0, h0), (f1, w1, h1) in zip(FISH_SECTIONS, FISH_SECTIONS[1:]):
        if f <= f1:
            t = (f - f0) / (f1 - f0)
            return w0 + t * (w1 - w0), h0 + t * (h1 - h0)
    return 0.0, 0.0


def _lash(at_x):
    """One cord loop over the bundle, at `at_x`, drawn to the local sections."""
    x0, x1 = at_x - LASH_THICK, at_x + LASH_THICK
    (wa, ha), (wb, hb) = _section_at(1, at_x), _section_at(-1, at_x)
    top_a = FISH_AXIS_Z + FISH_CREST * ha
    top_b = FISH_AXIS_Z + FISH_CREST * hb
    right = FISH_OFFSET_Y + wa
    left = -(FISH_OFFSET_Y + wb)

    # Over the two backs and down the two flanks. The middle point dips into
    # the crease between the fish; the two beside it sit on the crests
    # (`left * 0.55` is a fish's centre line), or the cord is buried.
    path = (
        (left * LASH_TUCK, LASH_HEM),
        (left, FISH_AXIS_Z * 0.85),
        (left * 0.55, top_b),
        (0.0, min(top_a, top_b) - 0.012),
        (right * 0.55, top_a),
        (right, FISH_AXIS_Z * 0.85),
        (right * LASH_TUCK, LASH_HEM),
    )
    # The far wall is the same path pushed a fixed distance away from the
    # bundle's axis, so the cord keeps an even thickness all the way round.
    grown = []
    for y, z in path:
        dy, dz = y, z - FISH_AXIS_Z
        away = math.hypot(dy, dz) or 1.0
        grown.append(
            (y + LASH_STANDOFF * dy / away, z + LASH_STANDOFF * dz / away)
        )

    # One closed cross-section extruded across x: 2n + 2 faces rather than
    # 4(n-1) + 2 for four stitched walls.
    loop = list(path) + list(reversed(grown))
    n = len(loop)
    verts = [(x, y, z) for x in (x0, x1) for y, z in loop]
    faces = [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    faces.append(tuple(range(n)))
    faces.append(tuple(range(n, 2 * n)))
    return verts, faces


def haul_fish(direction):
    """One fish body. `direction` +1 for the nose at +x, -1 for the mirror."""
    return _fish_body(direction)


def haul_fins():
    """Every fin on the haul, in one mesh."""
    return merge([_fish_fins(1), _fish_fins(-1)])


def haul_lash():
    """The cord round the bundle."""
    return _lash(LASH_X)


def spice_sack():
    """The burlap body, base to tuft."""
    return kit.lathe(SACK_PROFILE, sides=SACK_SIDES)


def spice_tie():
    """The cord at the cinch: a ring pinched onto the neck, not a bead."""
    return kit.lathe(TIE_PROFILE, sides=SACK_SIDES)


def marker_rim():
    """The bevelled body of the marker, in `Seat_Shade`."""
    return kit.lathe(MARKER_RIM, sides=MARKER_SIDES)


def marker_face():
    """The top plate, in `Seat_Body`."""
    return kit.lathe(MARKER_FACE, sides=MARKER_SIDES)


#: Every part of the family: object name -> (builder, material). The exporter
#: cuts `cargo.glb` on these three prefixes and `loader.test.ts` pins which may
#: carry a seat slot.
PARTS = (
    ("Haul_fish_a", lambda: haul_fish(1), "Mat_Haul_body"),
    ("Haul_fish_b", lambda: haul_fish(-1), "Mat_Haul_body"),
    ("Haul_fins", haul_fins, "Mat_Haul_fin"),
    ("Haul_lash", haul_lash, "Mat_Haul_fin"),
    ("Spice_sack", spice_sack, "Mat_Spice_sack"),
    ("Spice_tie", spice_tie, "Mat_Spice_tie"),
    ("Marker_rim", marker_rim, "Seat_Shade"),
    ("Marker_face", marker_face, "Seat_Body"),
)

#: Authored colours for the two neutral pieces. The seat slots are copied from
#: `art/pieces.blend` rather than recreated, to avoid a `PALETTE_CONFLICT`.
MATERIALS = {
    # Bright enough to read on `Mat_Ocean` (0.012, 0.06, 0.26) and dark enough
    # not to blow out to white in sun: luma 0.530 against the water's 0.064
    # (`cargoArt.test.ts` demands 4x), with the fin's 0.297 a step below.
    "Mat_Haul_body": {"color": (0.46, 0.54, 0.64), "roughness": 0.45, "metalness": 0.0},
    # The fins and the cord. Darker, but well above the water's value.
    "Mat_Haul_fin": {"color": (0.20, 0.31, 0.45), "roughness": 0.60, "metalness": 0.0},
    "Mat_Spice_sack": {"color": (0.78, 0.63, 0.40), "roughness": 0.90, "metalness": 0.0},
    "Mat_Spice_tie": {"color": (0.28, 0.19, 0.12), "roughness": 0.85, "metalness": 0.0},
}

#: Where each piece is parked in the blend, side by side. Applied as an object
#: location, never baked into the mesh: `anchors.ROOT` subtracts it on export.
LAYOUT = {"Haul_": (0.0, 0.0), "Spice_": (0.42, 0.0), "Marker_": (0.72, 0.0)}


# --- primitives ------------------------------------------------------------
#
# The lathe, prism and transforms come from `robber_kit`. Added here: a loft
# between non-circular rings (the fish) and an extrusion across +y (fins and
# cord, which lie in the fish's own plane).
#
# Every mesh returned is a closed manifold, so `gen/cargo.py` can recalculate
# normals in one pass.


def loft(rings):
    """Bridge a list of equal-length rings, bottom to top. Ends may be a point.

    Each ring is a list of `(x, y, z)`. A ring of length 1 is an apex and gets
    a fan rather than a band, which is how a fish's nose and tail root close.
    """
    verts, index = [], []
    for ring in rings:
        index.append(list(range(len(verts), len(verts) + len(ring))))
        verts += list(ring)

    faces = []
    for lo, hi in zip(index, index[1:]):
        if len(lo) == 1 and len(hi) == 1:
            continue
        if len(lo) == 1:
            faces += [(lo[0], hi[k], hi[(k + 1) % len(hi)]) for k in range(len(hi))]
        elif len(hi) == 1:
            faces += [(lo[k], lo[(k + 1) % len(lo)], hi[0]) for k in range(len(lo))]
        else:
            n = len(lo)
            faces += [(lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k]) for k in range(n)]
    if len(index[0]) > 1:
        faces.append(tuple(index[0]))
    if len(index[-1]) > 1:
        faces.append(tuple(index[-1]))
    return verts, faces


def slab(polygon, y0, y1):
    """Extrude a polygon of `(x, z)` points across +y, from y0 to y1.

    `robber_kit.prism` extrudes along +z; a fin is drawn in the fish's side
    view and given thickness across the fish.
    """
    n = len(polygon)
    verts = [(x, y, z) for y in (y0, y1) for x, z in polygon]
    faces = [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    faces.append(tuple(range(n)))
    faces.append(tuple(range(n, 2 * n)))
    return verts, faces


def merge(meshes):
    """Concatenate `(verts, faces)` pairs into one, reindexing as it goes."""
    verts, faces = [], []
    for part_verts, part_faces in meshes:
        offset = len(verts)
        verts += list(part_verts)
        faces += [tuple(i + offset for i in face) for face in part_faces]
    return verts, faces


def bounds(verts):
    """`(lo, hi)` of a vertex list, as two `(x, y, z)` tuples."""
    return (
        tuple(min(v[i] for v in verts) for i in range(3)),
        tuple(max(v[i] for v in verts) for i in range(3)),
    )
