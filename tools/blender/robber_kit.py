"""Low-poly geometry primitives for the robber prototypes.

Imports no bpy, so the designs unit-test without Blender.

Everything builds `(verts, faces)` in Blender space, Z up, with the piece's
contact point at z=0 and its axis on the origin, like the shipped robber
(`Robber_body`'s origin is at its bottom and `planRobber` puts it at the tile
centre), so a prototype needs no re-anchor.

The piece is 1.5 tall in a 0.45 radius, about a finger tall on screen at the
board's camera, so only the silhouette survives. The primitives are coarse
(the base robber is a 10-sided lathe): spend polygons on outline, not surface.
"""

import math

TAU = math.tau

#: The base robber, measured off `Robber_body` in `art/pieces.blend` and
#: shifted so its contact point is z=0. Every design is judged against these.
BASE_HEIGHT = 1.5
BASE_RADIUS = 0.45

#: Sides the shipped robber is lathed at, so facet sizes match across the set.
SIDES = 10


def lathe(profile, sides=SIDES, phase=0.0):
    """Revolve a `(radius, z)` profile about +Z, bottom to top.

    A ring with radius 0 becomes a single vertex, so a profile that starts or
    ends at 0 gets a cone cap rather than a degenerate ring; one that does not
    gets a flat cap. Faces wind outward.
    """
    verts, rings = [], []
    for radius, z in profile:
        if radius <= 1e-9:
            rings.append([len(verts)])
            verts.append((0.0, 0.0, z))
            continue
        ring = []
        for k in range(sides):
            a = phase + TAU * k / sides
            ring.append(len(verts))
            verts.append((radius * math.cos(a), radius * math.sin(a), z))
        rings.append(ring)

    faces = []
    for lo, hi in zip(rings, rings[1:]):
        if len(lo) == 1 and len(hi) == 1:
            continue
        if len(lo) == 1:
            # Wound opposite to the top cap below, because this apex is under
            # its ring.
            faces += [(lo[0], hi[(k + 1) % sides], hi[k]) for k in range(sides)]
        elif len(hi) == 1:
            faces += [(lo[k], lo[(k + 1) % sides], hi[0]) for k in range(sides)]
        else:
            for k in range(sides):
                j = (k + 1) % sides
                faces.append((lo[k], lo[j], hi[j], hi[k]))
    if len(rings[0]) > 1:
        faces.append(tuple(reversed(rings[0])))
    if len(rings[-1]) > 1:
        faces.append(tuple(rings[-1]))
    return verts, faces


def cylinder(radius, z0, z1, sides=SIDES):
    return lathe([(radius, z0), (radius, z1)], sides=sides)


def blob(radius, at=(0.0, 0.0, 0.0), squash=1.0, sides=SIDES):
    """A cheap ovoid: five rings, tall enough to read and no more.

    Every rounded lump here is one: a bear's skull, a smoke puff, a stone.
    `squash` under 1 flattens it; the returned shape is `2*radius*squash` tall
    and sits with its bottom at `at`.
    """
    r = radius
    verts, faces = lathe(
        [(0.0, 0.0), (r * 0.66, r * 0.30), (r, r), (r * 0.72, r * 1.66), (0.0, r * 2.0)],
        sides=sides,
    )
    return translate(scale(verts, (1.0, 1.0, squash)), at), faces


def prism(polygon, z0, z1):
    """Extrude a CCW polygon of `(x, y)` from z0 to z1. Faces wind outward."""
    n = len(polygon)
    verts = [(x, y, z0) for x, y in polygon] + [(x, y, z1) for x, y in polygon]
    faces = []
    for k in range(n):
        j = (k + 1) % n
        faces.append((k, j, n + j, n + k))
    faces.append(tuple(reversed(range(n))))
    faces.append(tuple(range(n, 2 * n)))
    return verts, faces


def box(size, at=(0.0, 0.0, 0.0)):
    """Axis-aligned box of `size` centred on `at`."""
    sx, sy, sz = (s / 2.0 for s in size)
    poly = [(-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)]
    verts, faces = prism(poly, -sz, sz)
    return translate(verts, at), faces


def ngon(radius, sides, phase=0.0):
    """A regular polygon in XY, CCW, for `prism`."""
    return [
        (radius * math.cos(phase + TAU * k / sides), radius * math.sin(phase + TAU * k / sides))
        for k in range(sides)
    ]


def arc_tube(radius, tube, a0, a1, steps=12, sides=6):
    """A round bar bent through an arc in the XZ plane, centred on the origin.

    The padlock's shackle and the crow's claw are both this. Angles are
    measured from +X toward +Z, so `a0=0, a1=pi` is a half-hoop standing up.
    """
    verts, rings = [], []
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps
        cx, cz = radius * math.cos(a), radius * math.sin(a)
        # Sweep frame: the arc's own outward normal and +Y, which is constant
        # because the arc stays in one plane. No parallel transport needed.
        nx, nz = math.cos(a), math.sin(a)
        ring = []
        for k in range(sides):
            b = TAU * k / sides
            ring.append(len(verts))
            verts.append((cx + tube * nx * math.cos(b), tube * math.sin(b), cz + tube * nz * math.cos(b)))
        rings.append(ring)
    faces = []
    for lo, hi in zip(rings, rings[1:]):
        for k in range(sides):
            j = (k + 1) % sides
            faces.append((lo[k], lo[j], hi[j], hi[k]))
    faces.append(tuple(reversed(rings[0])))
    faces.append(tuple(rings[-1]))
    return verts, faces


# --- transforms ------------------------------------------------------------
#
# Each takes and returns a vertex list, so a part reads as a pipeline:
#   translate(rot_y(verts, 0.2), (0, 0, 0.6))


def translate(verts, delta):
    dx, dy, dz = delta
    return [(x + dx, y + dy, z + dz) for x, y, z in verts]


def scale(verts, factor, about=(0.0, 0.0, 0.0)):
    fx, fy, fz = factor if isinstance(factor, (tuple, list)) else (factor,) * 3
    ax, ay, az = about
    return [(ax + (x - ax) * fx, ay + (y - ay) * fy, az + (z - az) * fz) for x, y, z in verts]


def rot_z(verts, angle):
    c, s = math.cos(angle), math.sin(angle)
    return [(x * c - y * s, x * s + y * c, z) for x, y, z in verts]


def rot_y(verts, angle, about=(0.0, 0.0, 0.0)):
    """Tilt about +Y through `about`; every leaning piece here uses this."""
    c, s = math.cos(angle), math.sin(angle)
    ax, _, az = about
    out = []
    for x, y, z in verts:
        u, w = x - ax, z - az
        out.append((ax + u * c + w * s, y, az - u * s + w * c))
    return out


def rot_x(verts, angle, about=(0.0, 0.0, 0.0)):
    c, s = math.cos(angle), math.sin(angle)
    _, ay, az = about
    out = []
    for x, y, z in verts:
        v, w = y - ay, z - az
        out.append((x, ay + v * c - w * s, az + v * s + w * c))
    return out


def taper(verts, at_z, amount):
    """Pinch or splay a part in proportion to height above `at_z`.

    Used where a lathe's profile cannot say it: a slab that narrows as it
    rises, a plume that widens. `amount` is the fraction added per unit of z.
    """
    return [(x * (1 + amount * (z - at_z)), y * (1 + amount * (z - at_z)), z) for x, y, z in verts]


def jitter_radii(verts, seed, amount=0.06):
    """Knock a lathe off perfectly round, deterministically.

    Seeded from the vertex index rather than `random`, so the blend rebuilds
    identically.
    """
    out = []
    for i, (x, y, z) in enumerate(verts):
        k = math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453
        f = 1.0 + amount * (2.0 * (k - math.floor(k)) - 1.0)
        out.append((x * f, y * f, z))
    return out


def scallop(verts, at_z, lobes, depth, phase=0.0):
    """Wave the vertices sitting at `at_z` upward by up to `depth`.

    A hem (the wraith's robe, the toadstool's gill edge). Upward only, so the
    ring stays the floor at z=0 for seating and the envelope test.
    """
    out = []
    for x, y, z in verts:
        if abs(z - at_z) > 1e-6:
            out.append((x, y, z))
            continue
        lift = 0.5 * depth * (1.0 - math.cos(lobes * math.atan2(y, x) + phase))
        out.append((x, y, z + lift))
    return out


def merge(*parts):
    """Concatenate `(verts, faces)` pairs into one mesh, re-basing indices."""
    verts, faces = [], []
    for pv, pf in parts:
        off = len(verts)
        verts += list(pv)
        faces += [tuple(i + off for i in f) for f in pf]
    return verts, faces


# --- measurement -----------------------------------------------------------


def bounds(verts):
    """`(min, max)` per axis."""
    axes = list(zip(*verts))
    return tuple((min(a), max(a)) for a in axes)


def height(verts):
    (_, _), (_, _), (z0, z1) = bounds(verts)
    return z1 - z0


def max_radius(verts):
    return max(math.hypot(x, y) for x, y, _ in verts)


def footprint_radius(verts, within=0.06):
    """How wide the piece is where it meets the board.

    The shipped robber plants a 0.45 plinth; a design must too.
    """
    z0 = min(z for _, _, z in verts)
    low = [math.hypot(x, y) for x, y, z in verts if z <= z0 + within]
    return max(low) if low else 0.0


def silhouette_area(verts, slabs=48):
    """Approximate front-view area: the piece's visual weight, in square units.

    Sampled off vertices rather than rasterised, so it is an estimate, used
    only as a band check against the base robber.
    """
    (_, _), (_, _), (z0, z1) = bounds(verts)
    span = z1 - z0
    if span <= 0:
        return 0.0
    step = span / slabs
    widths = [0.0] * slabs
    for x, _, z in verts:
        i = min(slabs - 1, int((z - z0) / step))
        widths[i] = max(widths[i], abs(x))
    # A slab with no vertex in it inherits its neighbours.
    for i, w in enumerate(widths):
        if w == 0.0:
            near = [widths[j] for j in (i - 1, i + 1) if 0 <= j < slabs and widths[j] > 0]
            if near:
                widths[i] = sum(near) / len(near)
    return sum(2.0 * w * step for w in widths)
