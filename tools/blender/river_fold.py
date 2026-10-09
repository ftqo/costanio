"""Pure math for the river channel's swept ribbon, and for the fold in it.

Imports no bpy, so it unit-tests without Blender (like `edit_geometry.py`,
`anchors.py` and `naming.py`). Callers do the bpy work and call here for the
numbers.

## A river tile's water

`River_<Family>_<Shape>_water` is a structured grid: `S` stations down the
channel, five columns across, `(S-1) * 4` quads. Column 2 is the centreline;
the other four sit on the same straight rib through it, at signed offsets that
are the same at every station the art did not clamp:

    +0.300   +0.130    0.000   -0.130   -0.300
      col0     col1     col2     col3     col4
    |  light  |     dark      |  light  |          0.60 bank to bank

`_channel` is the same grid nine columns wide (the trough, +-0.350 at the
slab's top face and down through +-0.308, +-0.238 and +-0.141 to the bed) on
the same stations and ribs. So everything below handles a grid of any odd
width.

## The fold

Two consecutive ribs cross, unless parallel, at some distance `t` from the
centreline: the local radius of curvature. A column further out than `t` on
that side has its two stations in the wrong order, so the quad between them
is a bowtie and its neighbours overlap, giving two exactly coplanar layers of
water (a depth fight). On the tiles as shipped this happened only in the
outer lanes (between +-0.130 and +-0.300), at bends with radius under 0.300.

## The repair

`unfold` has two knobs and uses the gentler one first.

  * The rib frame turns more slowly. Only the centreline is the art; spreading
    a sharp corner's turn over three ribs pushes the crossing out past the bank
    without narrowing anything. Bounded by `RIB_TURN_MAX` between neighbours
    and `RIB_ROTATE_MAX` from the authored rib.
  * Then the columns come in along their own rib, by a per-station, per-side
    factor in [`FLOOR`, 1].

Neither knob moves a vertex further from the centreline: clamping shortens the
offset and rotating keeps the radius about `C[i]`. So the repaired water stays
inside the corridor the original occupied, and cannot cross its bed, the chip's
keep-clear or the tile boundary. Stations 0 and S-1 are frozen, so both mouths
keep 0.60 on the edge midpoint.

`unfold` does not move the centreline: the tightest bends still narrow the
water (to 0.335 at worst on the hills). Moving the centreline would open gaps,
because `_channel`'s lip is coincident with the holes in `_ground` and the slab.
"""

import math

#: How far a rib may turn from the one before it, in degrees.
#:
#: Ribs `L` apart turning by `d` cross at about `L / d` radians: at the 0.154
#: station spacing, 30 degrees puts the crossing at 0.294, just under the 0.300
#: bank. Tighter shears the cross section; looser makes the clamp bite harder.
#: At 30 every tile comes out clean with the narrowest station over half width.
RIB_TURN_MAX = 30.0

#: How far a rib may be turned from where it was authored, in degrees.
#:
#: Past this the lanes read as a shear rather than a cross section. Some hills
#: and swamp bends reach it; the mountains peak at 9.3 degrees.
RIB_ROTATE_MAX = 25.0

#: How far inside the rib crossing the outermost column is allowed to sit.
#:
#: At exactly the crossing the two stations' columns coincide and the quad
#: between them has zero area, which a flat-shaded mesh draws as a crack.
SAFETY = 0.85

#: The narrowest a station may be pulled to, as a fraction of its own offsets.
#:
#: 0.55 leaves 0.33 of water against the kit's 0.60. Nothing on disk reaches it
#: after rib smoothing; `unfold` reports what it could not fix rather than
#: narrowing further.
FLOOR = 0.55

#: How many stations apart two quads may be and still be tested for overlap.
#:
#: The fold is local (at most four stations on any shipped tile) and the test
#: is quadratic, so a window keeps it cheap. Twice the worst case seen.
WINDOW = 8


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def _add(a, b):
    return (a[0] + b[0], a[1] + b[1])


def _mul(a, s):
    return (a[0] * s, a[1] * s)


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def _cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def _unit(a):
    length = math.hypot(a[0], a[1])
    return (a[0] / length, a[1] / length) if length else (0.0, 0.0)


def grid_shape(vertex_count, quad_count):
    """The (stations, columns) a flat vertex list is a grid of, or None.

    A river tile's water and channel are written as `stations * columns`
    vertices in row-major order with `(stations - 1) * (columns - 1)` quads,
    which has exactly one odd-width solution for every mesh on disk. Anything
    else (such as the headwater tiles' tarns) is refused.
    """
    found = None
    for columns in range(3, 16, 2):
        if vertex_count % columns:
            continue
        stations = vertex_count // columns
        if stations < 3:
            continue
        if (stations - 1) * (columns - 1) != quad_count:
            continue
        if found is not None:
            return None
        found = (stations, columns)
    return found


def same_cycle(got, want):
    """Are these the same corners in the same ring, either way round?

    A quad's loop has no canonical first corner, and mirrored tiles carry
    reversed winding.
    """
    if len(got) != len(want) or set(got) != set(want):
        return False
    n = len(want)
    for turned in (want, want[::-1]):
        start = turned.index(got[0])
        if all(got[k] == turned[(start + k) % n] for k in range(n)):
            return True
    return False


def ribbon_row(polygons, i, columns):
    """Do the quads of station `i` read as a row of a `columns`-wide grid?"""
    for j in range(columns - 1):
        k = i * (columns - 1) + j
        if k >= len(polygons):
            return False
        want = [
            i * columns + j,
            i * columns + j + 1,
            (i + 1) * columns + j + 1,
            (i + 1) * columns + j,
        ]
        if not same_cycle(list(polygons[k]), want):
            return False
    return True


def leading_ribbon(polygons):
    """The (stations, columns) of the swept ribbon a mesh starts with, or None.

    A headwater's water is a reach, then a throat, then a tarn with rivulets.
    The reach is written first in the same row-major order as a two-mouth
    tile's sheet, so it can be repaired without touching the tarn.
    """
    best = None
    for columns in range(3, 16, 2):
        stations = 1
        while ribbon_row(polygons, stations - 1, columns):
            stations += 1
        if stations >= 3 and (best is None or stations > best[0]):
            best = (stations, columns)
    return best


def rib_frame(rows):
    """Take a station grid apart into centreline, rib, offsets and residuals.

    `rows` is a list of stations, each a list of an ODD number of (x, y)
    points, the middle one the centreline. Returns
    `(centre, unit, offsets, residual)`, where `unit[i]` is the rib's direction
    (pointing at column 0), `offsets[i][j]` is the signed distance along it and
    `residual[i][j]` is whatever is left over.

    The residual is carried so a station that is only nearly collinear is not
    silently straightened (it measures 0.0000 on the shipped tiles).
    """
    centre = [r[len(r) // 2] for r in rows]
    unit = [_unit(_sub(r[0], r[-1])) for r in rows]
    offsets = [
        [_dot(_sub(rows[i][j], centre[i]), unit[i]) for j in range(len(rows[i]))]
        for i in range(len(rows))
    ]
    residual = [
        [
            _sub(_sub(rows[i][j], centre[i]), _mul(unit[i], offsets[i][j]))
            for j in range(len(rows[i]))
        ]
        for i in range(len(rows))
    ]
    return centre, unit, offsets, residual


def rib_angles(unit):
    """The rib directions as one continuous run of angles.

    Unwrapped, so a channel that turns through south does not read as a
    360-degree jump that the smoothing would then try to average away.
    """
    angles = [math.atan2(u[1], u[0]) for u in unit]
    for i in range(1, len(angles)):
        while angles[i] - angles[i - 1] > math.pi:
            angles[i] -= 2 * math.pi
        while angles[i] - angles[i - 1] < -math.pi:
            angles[i] += 2 * math.pi
    return angles


def smooth_ribs(angles, turn_max=RIB_TURN_MAX, rotate_max=RIB_ROTATE_MAX, rounds=4000):
    """Spread each corner's rib turn over its neighbours.

    Only stations whose own turn is over `turn_max` move, so a straight reach
    is returned untouched; the first and last never move at all, because those
    two ribs are the mouths and are perpendicular to the tile edge by contract.
    Each rib is held within `rotate_max` of where it was authored, so this
    converges to whatever it can reach rather than to a circle.
    """
    turn = math.radians(turn_max)
    cap = math.radians(rotate_max)
    start = list(angles)
    current = list(angles)
    n = len(current)
    for _ in range(rounds):
        if all(abs(current[i + 1] - current[i]) <= turn for i in range(n - 1)):
            break
        nxt = list(current)
        for i in range(1, n - 1):
            here = max(
                abs(current[i] - current[i - 1]), abs(current[i + 1] - current[i])
            )
            if here <= turn:
                continue
            relaxed = 0.5 * current[i] + 0.25 * (current[i - 1] + current[i + 1])
            nxt[i] = max(start[i] - cap, min(start[i] + cap, relaxed))
        if nxt == current:
            break
        current = nxt
    return current


def crossing_limits(centre, unit):
    """Where each station's rib crosses its neighbours', per side.

    Returns `(plus, minus)`: `plus[i]` is the smallest positive distance along
    `unit[i]` at which rib `i` meets rib `i-1` or `i+1` (`inf` when neither
    crosses on that side), and `minus[i]` the largest negative one (`-inf`).
    No column may sit outside them without folding the sheet.
    """
    n = len(centre)
    plus, minus = [], []
    for i in range(n):
        p, m = math.inf, -math.inf
        for k in (i - 1, i + 1):
            if k < 0 or k >= n:
                continue
            den = _cross(unit[i], unit[k])
            if abs(den) < 1e-9:
                continue  # parallel ribs never cross
            t = _cross(_sub(centre[k], centre[i]), unit[k]) / den
            if t > 0:
                p = min(p, t)
            else:
                m = max(m, t)
        plus.append(p)
        minus.append(m)
    return plus, minus


def clamp_factors(centre, unit, offsets, safety=SAFETY, floor=FLOOR):
    """The per-station, per-side narrowing that keeps every column inside its
    own rib crossing.

    Returns one `[minus_side, plus_side]` pair per station, each in
    `[floor, 1]`. Stations 0 and S-1 are always `[1, 1]`: they are the mouths,
    and every family is held to 0.60 there.
    """
    n = len(centre)
    plus, minus = crossing_limits(centre, unit)
    factors = [[1.0, 1.0] for _ in range(n)]
    last = len(offsets[0]) - 1
    for i in range(1, n - 1):
        if offsets[i][0] > 1e-9 and plus[i] < math.inf:
            factors[i][1] = min(1.0, max(floor, safety * plus[i] / offsets[i][0]))
        if offsets[i][last] < -1e-9 and minus[i] > -math.inf:
            factors[i][0] = min(1.0, max(floor, safety * minus[i] / offsets[i][last]))
    return factors


def place(centre, unit, offsets, residual, factors):
    """Rebuild the grid from a frame and a set of narrowing factors."""
    rows = []
    for i in range(len(centre)):
        row = []
        for j in range(len(offsets[i])):
            o = offsets[i][j]
            f = factors[i][1] if o > 0 else factors[i][0]
            row.append(_add(_add(centre[i], _mul(unit[i], o * f)), residual[i][j]))
        rows.append(row)
    return rows


def _shrink(tri, f=0.90):
    cx = sum(p[0] for p in tri) / 3.0
    cy = sum(p[1] for p in tri) / 3.0
    return [(cx + (p[0] - cx) * f, cy + (p[1] - cy) * f) for p in tri]


def _area(tri):
    return (
        abs(
            (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1])
            - (tri[2][0] - tri[0][0]) * (tri[1][1] - tri[0][1])
        )
        / 2.0
    )


def _separated(a, b):
    """Separating-axis test on two triangles, in the plane."""
    for poly in (a, b):
        for i in range(3):
            p, q = poly[i], poly[(i + 1) % 3]
            axis = (-(q[1] - p[1]), q[0] - p[0])
            amin = min(_dot(v, axis) for v in a)
            amax = max(_dot(v, axis) for v in a)
            bmin = min(_dot(v, axis) for v in b)
            bmax = max(_dot(v, axis) for v in b)
            if amax <= bmin or bmax <= amin:
                return True
    return False


def overlapping_pairs(rows, window=WINDOW):
    """Triangle pairs of the grid that cover the same ground in plan.

    Each triangle is shrunk 10% about its centroid first, so quads sharing a
    rib or lane boundary do not count.

    Returns `[((station, lane), (station, lane)), ...]` in the triangulation
    the exporter writes: each quad as `(a, b, c)` and `(a, c, d)`.
    """
    n = len(rows)
    m = len(rows[0])
    tris = []
    for i in range(n - 1):
        for j in range(m - 1):
            a, b, c, d = rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]
            tris.append(((i, j), [a, b, c]))
            tris.append(((i, j), [a, c, d]))
    hits = []
    for x in range(len(tris)):
        (ix, _), first = tris[x]
        shrunk = _shrink(first)
        if _area(shrunk) < 1e-9:
            continue
        for y in range(x + 1, len(tris)):
            (iy, _), second = tris[y]
            if iy - ix > window:
                break
            other = _shrink(second)
            if _area(other) < 1e-9:
                continue
            if not _separated(shrunk, other):
                hits.append((tris[x][0], tris[y][0]))
    return hits


def unfold(
    rows,
    turn_max=RIB_TURN_MAX,
    rotate_max=RIB_ROTATE_MAX,
    safety=SAFETY,
    floor=FLOOR,
    damp=0.96,
    rounds=40,
):
    """Turn the ribs gently and pull the columns in until the sheet stops
    lying on top of itself.

    Returns `(rows, factors, angles, leftover)`: the repaired grid, the factor
    applied at each station and side, the rib angles it settled on, and how
    many overlapping triangle pairs are still there (0 on every tile on disk).

    `clamp_factors` handles adjacent ribs; the loop afterwards narrows only the
    stations an actual overlap names (a ribbon can curl back two or three
    stations later).

    A grid with no overlap is returned verbatim, so the driver is safe to run
    over the whole set and idempotent.
    """
    n = len(rows)
    if not overlapping_pairs(rows, window=WINDOW):
        return [list(row) for row in rows], [[1.0, 1.0] for _ in rows], rib_angles(
            rib_frame(rows)[1]
        ), 0
    centre, unit, offsets, residual = rib_frame(rows)
    angles = smooth_ribs(rib_angles(unit), turn_max, rotate_max)
    unit = [(math.cos(a), math.sin(a)) for a in angles]
    factors = clamp_factors(centre, unit, offsets, safety, floor)
    current = place(centre, unit, offsets, residual, factors)
    for _ in range(rounds):
        hits = overlapping_pairs(current)
        if not hits:
            return current, factors, angles, 0
        for pair in hits:
            for i, j in pair:
                # Which side of the centreline this lane is on. A lane spans
                # columns j and j+1, and only the outer of the two can be past
                # a crossing, so the sign of the wider offset is the side.
                inner, outer = offsets[i][j], offsets[i][j + 1]
                wider = inner if abs(inner) > abs(outer) else outer
                side = 1 if wider > 0 else 0
                for station in (i, i + 1):
                    if station in (0, n - 1):
                        continue
                    factors[station][side] = max(floor, factors[station][side] * damp)
        current = place(centre, unit, offsets, residual, factors)
    return current, factors, angles, len(overlapping_pairs(current))
