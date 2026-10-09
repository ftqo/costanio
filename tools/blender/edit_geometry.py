"""Pure math for the scripts that shape board geometry.

Imports no bpy, so it unit-tests without Blender (like anchors.py and
naming.py). Callers do the bpy work and call here for the numbers.
`robber_kit` and `render_knight_sword` read from this file.
"""

import math

import lattice

# The 12 lattice points a hex tile's own footprint must keep clear: the 6
# vertices buildings sit on and the 6 edge midpoints roads sit on. Both rings
# are regular hexagons sharing the tile's centre, offset 30 degrees from each
# other: vertices at 30/90/150/210/270/330, edge midpoints at
# 0/60/120/180/240/300.
#
# LATTICE_SIZE, not HEX_SIZE: pieces sit on the lattice, which is spread wider
# than the tile art by the gutter, so a settlement stands 3.144 from its tile's
# centre, outside the tile's own corner at 3.0.
_VERTEX_R = lattice.LATTICE_SIZE
_EDGE_MID_R = lattice.LATTICE_APOTHEM
_VERTEX_ANGLES = (30, 90, 150, 210, 270, 330)
_EDGE_MID_ANGLES = (0, 60, 120, 180, 240, 300)


def polar_to_xy(r, angle_deg):
    """(r, angle) in degrees CCW from +X -> (x, y). Matches atan2(y, x)."""
    a = math.radians(angle_deg)
    return r * math.cos(a), r * math.sin(a)


def angle_deg(x, y):
    """(x, y) -> angle in degrees CCW from +X, normalised to [0, 360)."""
    return math.degrees(math.atan2(y, x)) % 360.0


CONSTRAINT_POINTS = tuple(
    [polar_to_xy(_VERTEX_R, a) for a in _VERTEX_ANGLES]
    + [polar_to_xy(_EDGE_MID_R, a) for a in _EDGE_MID_ANGLES]
)


def nearest_constraint_distance(x, y):
    """Distance from (x, y), in a hex-centred local frame, to the nearest
    vertex or edge-midpoint, the nearest point a settlement, city or road
    could occupy."""
    return min(math.hypot(x - cx, y - cy) for cx, cy in CONSTRAINT_POINTS)


# The number chip is the thirteenth thing a tile's art must keep clear of, a
# disc rather than a point, mounted flat on `Token_<Terrain>`.
#
# Radius: every `Chip_*_body` is exactly 1.0 about its origin, plus a margin
# so props do not graze the rim.
CHIP_RADIUS = 1.0
CHIP_MARGIN = 0.05

# Underside of a mounted chip. Geometry below this is hidden by the chip
# anyway; geometry above it is what pokes through its face.
CHIP_UNDERSIDE_Z = 0.25


def inside_chip(x, y, socket_xy, radius=CHIP_RADIUS + CHIP_MARGIN):
    """True if (x, y) falls under the chip mounted at `socket_xy`."""
    return math.hypot(x - socket_xy[0], y - socket_xy[1]) <= radius


def clears_constraints(points_xy, margin, socket_xy=None):
    """True if every point clears every vertex and edge midpoint and, given
    `socket_xy`, the number chip's whole disc as well. Pass the socket
    whenever you have one; the north point is both a bare spot and the chip's.
    """
    for x, y in points_xy:
        if nearest_constraint_distance(x, y) < margin:
            return False
        if socket_xy is not None and inside_chip(x, y, socket_xy):
            return False
    return True


def smoothstep(t):
    """Hermite smoothstep, clamped to [0, 1]."""
    t = min(1.0, max(0.0, t))
    return t * t * (3.0 - 2.0 * t)


def ground_cap(r, inner, outer, target, ceiling):
    """The maximum height allowed at radius `r` from a flatten centre.

    `target` inside `inner`, relaxing smoothly out to `ceiling` (intended to
    sit above every real height in range) by `outer`, unrestricted beyond.
    A `ceiling` above the surface's true max leaves no visible step at `outer`.
    """
    if r <= inner:
        return target
    if r >= outer:
        return math.inf
    t = (r - inner) / (outer - inner)
    return target + (ceiling - target) * smoothstep(t)


def capped_height(orig_z, r, inner, outer, target, ceiling):
    """`orig_z`, clamped down to `ground_cap(r, ...)`, never raised. Idempotent."""
    return min(orig_z, ground_cap(r, inner, outer, target, ceiling))


def max_clearing_scale(points_xy, margin, cap=1.6, step=0.005, socket_xy=None, floor=0.0):
    """Largest radial scale s in (0, cap] such that scaling every point in
    `points_xy` by s (about the origin) still clears every constraint by at
    least `margin`.

    Used to push a duplicated clump as far toward the hex edge as it can go
    without infringing on a vertex or edge midpoint: start from `cap` (an
    enlargement, not just a shrink) and back off until it clears. Returns
    None if nothing at or above `floor` clears.

    `floor` stops the search from "clearing" by collapsing the clump onto the
    tile centre (the chip blocks the only radius out to the north point).
    """
    s = cap
    while s >= floor and s > 0:
        if clears_constraints([(x * s, y * s) for x, y in points_xy], margin, socket_xy):
            return round(s, 4)
        s -= step
    return None


def largest_gap(angles_deg):
    """The widest empty arc in a set of angles on a circle.

    Returns (start, end, size): with the angles sorted ascending, the gap
    after the largest jump between consecutive angles (wrapping past 360).
    Used at design time to find where a family of objects leaves a hex's
    points bare.
    """
    if len(angles_deg) < 2:
        raise ValueError("need at least two angles to find a gap")
    xs = sorted(a % 360.0 for a in angles_deg)
    best = (xs[-1], xs[0] + 360.0, xs[0] + 360.0 - xs[-1])
    for a, b in zip(xs, xs[1:]):
        if b - a > best[2]:
            best = (a, b, b - a)
    start, end, size = best
    return start, end % 360.0, size


# --- Doorways ---------------------------------------------------------------
# A player's settlement and city each carry one `Seat_Detail` panel on a wall
# face: the door. It is a box, four corners on the ground and four above them,
# set into the face so a sliver of it stands proud of the wall.
#
# Its corners are computed from the wall, so resizing is idempotent.


def face_frame(a, b, interior):
    """Unit vectors for the wall face running from `a` to `b`, in the ground plane.

    Returns `(u, n)`: `u` runs along the face a -> b, `n` is perpendicular to it
    and points away from `interior` (a point inside the building), i.e. out of
    the wall, regardless of face winding.
    """
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy)
    if length == 0:
        raise ValueError("degenerate wall face: a == b")
    u = (dx / length, dy / length)
    n = (u[1], -u[0])
    # Interior relative to a point on the face; flip n if it points inward.
    ix, iy = interior[0] - ax, interior[1] - ay
    if ix * n[0] + iy * n[1] > 0:
        n = (-n[0], -n[1])
    return u, n


def project_on_face(a, u, point):
    """How far along `u` from `a` the given point lies."""
    return (point[0] - a[0]) * u[0] + (point[1] - a[1]) * u[1]


def doorway_corners(a, b, interior, u_center, width, protrude, inset):
    """The four ground-plane corners of a door panel set into face `a` -> `b`.

    `u_center` is the door's centre measured along the face from `a`; `width` is
    how wide it spans; `protrude` how far its outer skin stands out of the wall
    plane and `inset` how far the back of the panel is buried in the wall, so
    its edges catch light instead of z-fighting.

    Returns a dict keyed by `(u_sign, n_sign)`, each in `{-1, +1}`: the corner
    on that side of the door's centre and of its own middle, so a caller can
    match existing vertices whatever their storage order.
    """
    if width <= 0:
        raise ValueError("door width must be positive")
    if protrude + inset <= 0:
        raise ValueError("door must have some thickness")
    u, n = face_frame(a, b, interior)
    out = {}
    for us in (-1, 1):
        for ns in (-1, 1):
            along = u_center + us * width / 2.0
            across = protrude if ns > 0 else -inset
            out[(us, ns)] = (
                a[0] + u[0] * along + n[0] * across,
                a[1] + u[1] * along + n[1] * across,
            )
    return out


# --- Material slot remapping ------------------------------------------------
#
# Retinting renames the material each face points at. Two source slots can
# land on one target (a knight's shield and crest both become `Seat_Detail`),
# and duplicate slots export as two primitives, an extra draw call per piece.
# So the remap rebuilds the slot list too: targets in first-appearance order,
# deduped, faces repointed. The output is stable, so a script can compare and
# skip the rebuild.


def remap_material_slots(slots, face_slots, mapping):
    """Rename a mesh's material slots, collapsing any that collide.

    `slots` is the mesh's material names in slot order, `face_slots` the slot
    index each face uses, and `mapping` the renames to apply (a name absent
    from it keeps its own name). Returns `(new_slots, new_face_slots)`.

    Slots no face uses are dropped (`Knight_basic` has an unused crest slot).

    Idempotent: feeding the output back in with the same mapping returns it
    unchanged. A mapping whose targets are also keys is rejected.
    """
    for target in set(mapping.values()):
        if target in mapping and mapping[target] != target:
            raise ValueError(f"mapping chains through {target!r}")

    order = []
    for index in face_slots:
        if not 0 <= index < len(slots):
            raise IndexError(f"face points at slot {index} of {len(slots)}")
        name = mapping.get(slots[index], slots[index])
        if name not in order:
            order.append(name)

    at = {name: n for n, name in enumerate(order)}
    return order, [at[mapping.get(slots[i], slots[i])] for i in face_slots]


# --- The knight's sword -----------------------------------------------------
#
# A knight's sword has two poses: point-down dull steel at ease, point-up gold
# when activated. Both are baked, one object each, because under
# `prefers-reduced-motion` the renderer's ticker never runs, so a pose function
# would never apply the resting orientation.
#
# The geometry is generated because it is a family: three bodies of different
# heights carry the same sword scaled to them, and the hand, arm and resting
# pose are solved to fit the sword.
#
# The blade length is the input (a fixed fraction of the knight's height).
# `sword_reach_for_blade` turns it into a reach, and `sword_grip_z` says where
# the hand must be for that blade to hang point-down clear of the ground, which
# puts the grip at chest-to-shoulder height. The hand reaches outboard of the
# plinth (`sword_grip_x_limit`); more lean throws the point further over a
# neighbouring tile (`sword_rest_tip`). The edit script picks the angle.
#
# At `BLADE_FRACTION` 1.0 the reach exceeds the grip height (about 1.11x), so
# the blade cannot hang plumb: `grip_z = tip_clearance + reach *
# |cos(rest_tilt)|` must be solvable with `grip_z` on the body, which caps how
# near vertical it can be. Two consequences:
#
# - The point's outreach depends on the lean alone (`out = reach * sin(tilt) +
#   |grip_x|`), so it is minimised by the lowest `tip_clearance`, which allows
#   the highest grip and the most plumb blade.
# - Past about 135 degrees the pommel, not the guard, is the hilt's innermost
#   point, so the limit is solved over the whole hilt (`sword_hilt_inboard`).


def _prism(verts, faces, z0, z1, hx0, hy0, hx1, hy1):
    """A tapered box from z0 to z1, appended to `verts`/`faces`.

    Half-extents are per end, so `hx1 < hx0` narrows it. Winding is outward.
    """
    n = len(verts)
    verts.extend(
        [
            (-hx0, -hy0, z0),
            (hx0, -hy0, z0),
            (hx0, hy0, z0),
            (-hx0, hy0, z0),
            (-hx1, -hy1, z1),
            (hx1, -hy1, z1),
            (hx1, hy1, z1),
            (-hx1, hy1, z1),
        ]
    )
    faces.extend(
        [
            (n + 0, n + 3, n + 2, n + 1),
            (n + 4, n + 5, n + 6, n + 7),
            (n + 0, n + 1, n + 5, n + 4),
            (n + 1, n + 2, n + 6, n + 5),
            (n + 2, n + 3, n + 7, n + 6),
            (n + 3, n + 0, n + 4, n + 7),
        ]
    )


def _point(verts, faces, z0, z1, hx, hy):
    """A pyramid from a rectangle at z0 to a single apex at z1."""
    n = len(verts)
    verts.extend(
        [
            (-hx, -hy, z0),
            (hx, -hy, z0),
            (hx, hy, z0),
            (-hx, hy, z0),
            (0.0, 0.0, z1),
        ]
    )
    faces.extend(
        [
            (n + 0, n + 3, n + 2, n + 1),
            (n + 0, n + 1, n + 4),
            (n + 1, n + 2, n + 4),
            (n + 2, n + 3, n + 4),
            (n + 3, n + 0, n + 4),
        ]
    )


#: Fraction of the blade taken up by the point, and how far the edges have
#: closed in by the time the point begins. Shape only; neither changes the
#: reach. A fifth of the blade, so the point reads as a triangle at board zoom.
SWORD_TIP_FRACTION = 0.22
SWORD_TAPER = 0.50

#: Every dimension of the sword except its length, at `girth` 1.0.
#:
#: A knight is about a tenth of the frame's height at play distance, so thinner
#: parts vanish. `guard_w` is 2.15x `blade_w` so the crossguard reads from any
#: azimuth; the silhouette (wide bar, long taper, knob below) says "sword".
SWORD_PROPORTIONS = {
    "handle": 0.083,
    "handle_w": 0.039,
    "guard_h": 0.030,
    "guard_w": 0.172,
    # Square in plan, not a bar: the camera orbits the board (see
    # `SWORD_FLIP_AXIS_Y`), and a bar guard seen edge-on disappears.
    "guard_d": 0.172,
    "blade_w": 0.080,
    "blade_t": 0.032,
    "pommel_h": 0.035,
    "pommel_w": 0.055,
}


def sword_parts(girth=1.0):
    """`SWORD_PROPORTIONS` scaled by `girth`.

    Shared by the mesh and the length solves so they agree.
    """
    return {k: v * girth for k, v in SWORD_PROPORTIONS.items()}


def sword_reach_for_blade(blade, girth=1.0):
    """The reach a sword needs for a blade of length `blade`.

    The input of the family. The blade (guard to point) is chosen; `reach`
    (grip to point) is what the pose and mesh are expressed in.
    """
    if blade <= 0.0:
        raise ValueError(f"blade {blade} is not a length")
    p = sword_parts(girth)
    return blade + p["guard_h"] + p["handle"] / 2.0


def sword_blade_length(reach, girth=1.0):
    """Inverse of `sword_reach_for_blade`: the blade inside a given reach."""
    p = sword_parts(girth)
    return reach - p["guard_h"] - p["handle"] / 2.0


def sword_mesh(reach, girth=1.0):
    """A stylised sword: grip at the origin, blade along +z.

    Returns `(verts, faces)` in the sword's own frame, with the origin at the
    middle of the handle, where the hand closes and the raise animation turns.
    Below the origin (handle tail, pommel) is what shows above the hand when
    the blade points down.

    `reach` is the distance from the origin to the point; the resting tilt is
    measured against it. `girth` scales the cross-section and the handle.

    A pure function of its arguments, so an edit script can compare against
    the blend instead of rewriting it.
    """
    p = sword_parts(girth)
    handle = p["handle"]
    handle_w = p["handle_w"]
    guard_h = p["guard_h"]
    guard_w = p["guard_w"]
    guard_d = p["guard_d"]
    blade_w = p["blade_w"]
    blade_t = p["blade_t"]
    pommel_h = p["pommel_h"]
    pommel_w = p["pommel_w"]

    blade = sword_blade_length(reach, girth)
    if blade <= 0.0:
        raise ValueError(f"reach {reach} leaves no blade at girth {girth}")

    verts, faces = [], []
    half = handle / 2.0
    _prism(verts, faces, -half - pommel_h, -half, pommel_w / 2, pommel_w / 2, pommel_w / 2, pommel_w / 2)
    _prism(verts, faces, -half, half, handle_w / 2, handle_w / 2, handle_w / 2, handle_w / 2)
    _prism(verts, faces, half, half + guard_h, guard_w / 2, guard_d / 2, guard_w / 2, guard_d / 2)
    edge = half + guard_h
    shoulder = edge + blade * (1.0 - SWORD_TIP_FRACTION)
    _prism(
        verts,
        faces,
        edge,
        shoulder,
        blade_w / 2,
        blade_t / 2,
        blade_w * SWORD_TAPER / 2,
        blade_t * SWORD_TAPER / 2,
    )
    _point(verts, faces, shoulder, edge + blade, blade_w * SWORD_TAPER / 2, blade_t * SWORD_TAPER / 2)
    return verts, faces


def _rest_drop(rest_tilt_deg):
    """How much of a reach becomes downward drop at `rest_tilt_deg`."""
    drop = -math.cos(math.radians(rest_tilt_deg))
    if drop <= 0.0:
        raise ValueError(f"rest tilt {rest_tilt_deg} does not point the blade down")
    return drop


def sword_grip_z(reach, rest_tilt_deg, tip_clearance):
    """How high the hand has to be to hold a sword of this length point-down.

    The resting sword is turned `rest_tilt_deg` off vertical about the grip,
    so its point ends `reach * |cos|` below the hand; requiring the point to
    stop `tip_clearance` above the ground fixes the hand height.
    """
    if reach <= 0.0:
        raise ValueError(f"reach {reach} is not a length")
    return tip_clearance + reach * _rest_drop(rest_tilt_deg)


def sword_rest_tip(grip_x, grip_z, reach, rest_tilt_deg):
    """Where the resting point lands, as `(x, z)` in the knight's own frame.

    The lean is outward, away from the body, which is -x on all three bodies
    (the shield is on +x). Callers check that the point falls outboard of the
    plinth and does not lie across the neighbouring tile's art.
    """
    lean = math.radians(rest_tilt_deg)
    return (grip_x - reach * math.sin(lean), grip_z - reach * _rest_drop(rest_tilt_deg))


def sword_hilt_inboard(rest_tilt_deg, girth=1.0):
    """How far the resting hilt reaches back toward the body, past the grip.

    The hilt is the pommel, handle and crossguard. Which is innermost depends
    on the lean (guard and pommel trade places around 135 degrees), so this is
    a max over all of them.

    The blade never needs checking: its vertices are at `z > 0` and no wider
    than the guard, so with `sin > 0` each rotated x (`|cos| * x - sin * z`) is
    less than the guard vertex below it. So this depends on lean and girth only.
    """
    _rest_drop(rest_tilt_deg)
    p = sword_parts(girth)
    half = p["handle"] / 2.0
    hilt = (
        (p["pommel_w"] / 2.0, -half - p["pommel_h"], -half),
        (p["handle_w"] / 2.0, -half, half),
        (p["guard_w"] / 2.0, half, half + p["guard_h"]),
    )
    lean = math.radians(rest_tilt_deg)
    cos, sin = math.cos(lean), math.sin(lean)
    return max(
        side * hx * cos - z * sin
        for hx, z0, z1 in hilt
        for side in (-1.0, 1.0)
        for z in (z0, z1)
    )


def sword_grip_x_limit(body_edge_x, rest_tilt_deg, girth=1.0, margin=0.012):
    """How far out the hand must reach for the hilt to clear the body.

    Returns the largest (i.e. least negative) `grip_x` that keeps every part of
    the resting hilt `margin` clear of a body whose own -x edge at hand height is
    `body_edge_x`.

    At shoulder height the guard would bury itself in the chest, so all three
    bodies get an outstretched arm stub.
    """
    return body_edge_x - sword_hilt_inboard(rest_tilt_deg, girth) - margin


def box_mesh(x0, x1, y_half, z0, z1):
    """An axis-aligned box, as `(verts, faces)` in the frame it is given in.

    Used for the arm stubs; pure, like `sword_mesh`, so an edit script can
    compare and skip the write.
    """
    verts, faces = [], []
    mid = (x0 + x1) / 2.0
    half = abs(x1 - x0) / 2.0
    _prism(verts, faces, z0, z1, half, y_half, half, y_half)
    return [(v[0] + mid, v[1], v[2]) for v in verts], faces
