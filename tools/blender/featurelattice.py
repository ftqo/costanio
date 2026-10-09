"""Ground features drawn on the tile's own lattice, and the rule that holds them there.

Imports no bpy, so it unit-tests without Blender.
`check_hexes.py` does the measuring; this module decides what passes, and the
edit scripts that cut a feature into a tile use the same functions to build it.

## The rule

Every land tile's ground is one faceted triangle lattice (the shared 631-point
grid, 3/14 apart, its edges at 30, 90 and 150 degrees in plan; the marsh has
its own 0.204 grid in the same three directions). A ground feature (a pond,
lake, marsh pool, creek, sand bar, yard) is a set of that lattice's own
triangles, so its outline is a staircase of lattice edges.

The rule forbids:

  * a smooth or free-form polygon laid over the ground;
  * a sheet whose edge is wherever the terrain cuts it (a water level crossing
    sloping facets draws a smooth contour);
  * a line clipped across the lattice at its own angle.

A water body is measured by its plan boundary: the edges of its upward faces
that only one of its faces uses. At least `MIN_ON_DIRECTION` of that length
must run along a lattice direction, and at least `MIN_ON_VERTEX` of its
vertices must sit on a ground vertex. A vertical lip at the bank is not part of
the plan boundary, so whole triangles flat at the water level with a small
step down to the bank pass.

## Carving a basin

`carve_basin` is the construction the rule describes, shared by the edit
scripts and the generators: pick a set of ground triangles, lower their
vertices so every one of them is under the water level (the ones on the edge
by a lip, the ones inside into a bowl), and lay the water on exactly those
triangles. The ground under each water triangle is the same three corners,
lower, so it cannot come up through the sheet.
"""

import math
import re

#: The three lattice directions in plan, in degrees modulo 180.
LATTICE_DIRECTIONS = (30.0, 90.0, 150.0)

#: A sea tile's lattice is its wave sheet's, which is the land lattice turned
#: 30 degrees: its edges run at 0, 60 and 120. (The sheet fills a whole cell,
#: so its rows are laid along the cell's flat top rather than its point.)
WATER_LATTICE_DIRECTIONS = (0.0, 60.0, 120.0)

#: How far off a lattice direction an edge may run and still count as on it.
#: Two degrees: generous for float noise, too tight for a polygon drawn at its
#: own angles.
DIRECTION_TOL_DEG = 2.0

#: How far a boundary vertex may sit from a ground vertex and still be on it.
VERTEX_TOL = 0.003

#: The share of a feature's boundary that has to be on the lattice. Not 1.0:
#: features are clipped at a chip or border in places.
MIN_ON_DIRECTION = 0.95
MIN_ON_VERTEX = 0.95

#: A face is a surface (part of the plan) when its normal is at least this
#: close to vertical. A lip or a cutbank is not. Winding is not trusted (tiles
#: export double-sided), so a surface is also one nothing else in the same part
#: covers from above (the castle's motte has a cap under the ground).
SURFACE_NZ = 0.5

#: Materials that are a water surface. Mirrors the composer's
#: `WATER_MATERIAL` (frontend/src/lib/board3d/compose/water.ts) plus the two
#: still waters it does not move (the oasis's and the goldfield creek's).
WATER_MATERIAL = re.compile(
    r"^Mat_(Swamp_pool|Pasture_water(_dk)?|Lake_water|Lake_shoal|Lake_deep|"
    r"River_water(_dk)?|Oasis_water|Gold_water)$"
)

#: A connected patch of water smaller than this in plan is a trough's or a
#: well's, not a body of water, and is not held to the rule. The composer
#: uses the same number for the same question (`WATER_BODY_AREA`).
WATER_BODY_AREA = 0.05

#: Water that belongs to a built prop rather than to the ground: the spice
#: village's well, the hay rack's trough, the gold mine's sluice. Not held to
#: the rule.
PROP_WATER_SUFFIXES = ("_well", "_hayrack", "_workings", "_sluice")

#: Named ground features that are not water but are held to the same rule:
#: an object whose name ends in one of these is a patch of the ground laid
#: over the ground, and its plan outline has to be a lattice staircase too.
FEATURE_SUFFIXES = ("_bars", "_track", "_motte", "_pad", "_ripples")

#: Tiles the rule does not apply to yet, each with its reason.
EXEMPT = {
    # Empty. River tiles are cut on the lattice too (art/README.md, "The
    # waterline is lattice edges, not a contour"); their pinned mouth seam is
    # handled by `MOUTH_SEAM` below.
}


#: The parts that together are a land tile's lattice. Most tiles draw their
#: ground as one `_ground` mesh; a basin tile splits it into bed and bank
#: rings, and a river tile into four: `_ground` (the dry field), `_channel`
#: (the cut, whose waterline ring the water's corners sit on), `_margin` (the
#: wet turf beside it) and `_fan` (the shingle at each mouth, the channel's
#: own triangles lifted 2 mm). A river's water corners are channel vertices.
LATTICE_PARTS = ("_ground", "_sand", "_bed", "_bank", "_channel", "_margin", "_fan")

#: The mouth seam, the one place a river's outline may leave the lattice's
#: directions. Two river hexes meet mouth to mouth across the gutter, so at
#: each mouth the ring-14 points are pinned to 0, +-0.30 and +-0.35 along the
#: edge (`hexcontract.MOUTH_HALF_WIDTH`), and 0.30 is not a multiple of the
#: 0.214 step. The edges from the +-0.30 corners back to ring 13 run at their
#: own angle; each has an end past the border line inside the mouth notch
#: (under the rim and gutter sand), so it is excluded from the direction
#: share. An edge with both ends inside the border is always held.
#: `test_featurelattice.TheMouthSeam` checks the exclusion stays local.
MOUTH_SEAM_TOL = 1e-3


def _hex_apothem(x, y):
    return max(x * math.cos(math.pi / 3.0 * k) + y * math.sin(math.pi / 3.0 * k) for k in range(6))


def _mouth_offset(x, y):
    k = max(range(6), key=lambda i: x * math.cos(math.pi / 3.0 * i) + y * math.sin(math.pi / 3.0 * i))
    t = math.pi / 3.0 * k
    return abs(-x * math.sin(t) + y * math.cos(t))


def in_mouth_notch(p, border=None, half=None):
    """Whether plan point p stands past the border line inside a mouth notch."""
    import hexcontract  # the border and the notch are the contract's numbers

    border = hexcontract.BORDER_APOTHEM if border is None else border
    half = hexcontract.MOUTH_HALF_WIDTH if half is None else half
    return (
        _hex_apothem(p[0], p[1]) > border + MOUTH_SEAM_TOL
        and _mouth_offset(p[0], p[1]) <= half + MOUTH_SEAM_TOL
    )


def mouth_seam(a, b):
    """A boundary edge that is the pinned mouth seam (see MOUTH_SEAM_TOL)."""
    return in_mouth_notch(a) or in_mouth_notch(b)


def exempt_reason(terrain):
    for prefix, why in EXEMPT.items():
        if terrain.startswith(prefix):
            return why
    return None


# --- the shared lattice ------------------------------------------------------

#: Spacing of the shared ground lattice: the art circumradius over 14 rings.
LATTICE_STEP = 3.0 / 14.0
LATTICE_RINGS = 14
#: Ring 14 is pulled in onto the rim's inner edge, the border line.
LATTICE_OUTER_APOTHEM = 2.4731


def shared_lattice(step=LATTICE_STEP, rings=LATTICE_RINGS, outer_apothem=LATTICE_OUTER_APOTHEM):
    """The 631 points every shipped land ground is drawn on, keyed by (i, j).

    Axial coordinates on a lattice whose edges run at 30, 90 and 150 degrees:
    (i, j) is at x = i*step*cos30, y = j*step + i*step/2. The outermost ring
    is scaled onto the rim's inner edge, as the base tiles were drawn.
    """
    pts = {}
    ring_apothem = rings * step * math.sqrt(3.0) / 2.0
    for i in range(-rings, rings + 1):
        for j in range(-rings, rings + 1):
            k = -i - j
            if max(abs(i), abs(j), abs(k)) > rings:
                continue
            x = i * step * math.sqrt(3.0) / 2.0
            y = j * step + i * step / 2.0
            if max(abs(i), abs(j), abs(k)) == rings:
                f = outer_apothem / ring_apothem
                x, y = x * f, y * f
            pts[(i, j)] = (x, y)
    return pts


def shared_lattice_triangles(pts):
    """The lattice's triangles as tuples of (i, j) keys, wound counter-clockwise."""
    tris = []
    span = max(max(abs(i), abs(j)) for i, j in pts) + 1
    for i in range(-span, span + 1):
        for j in range(-span, span + 1):
            for a, b, c in (
                ((i, j), (i + 1, j), (i, j + 1)),
                ((i + 1, j), (i + 1, j + 1), (i, j + 1)),
            ):
                if a in pts and b in pts and c in pts:
                    tris.append(_ccw(pts, (a, b, c)))
    return tris


def _ccw(pts, tri):
    (ax, ay), (bx, by), (cx, cy) = (pts[k] for k in tri)
    if (bx - ax) * (cy - ay) - (cx - ax) * (by - ay) < 0:
        return (tri[0], tri[2], tri[1])
    return tri


# --- plan geometry -------------------------------------------------------------


def plan_area(a, b, c):
    return abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2.0


def normal_z(a, b, c):
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    return 0.0 if length == 0.0 else abs(nz) / length


def _key(p, q=1e-3):
    return (round(p[0] / q), round(p[1] / q))


def _covers(t, x, y):
    a, b, c = t
    d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(d) < 1e-12:
        return None
    l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d
    l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d
    l3 = 1.0 - l1 - l2
    if min(l1, l2, l3) < -1e-6:
        return None
    return l1 * a[2] + l2 * b[2] + l3 * c[2]


def surfaces(tris, cell=0.25):
    """The faces of `tris` seen from above, each a triple of (x, y, z)."""
    flat = [t for t in tris if normal_z(*t) >= SURFACE_NZ and plan_area(*t) > 1e-9]
    grid = {}
    for n, t in enumerate(flat):
        xs, ys = [p[0] for p in t], [p[1] for p in t]
        for bx in range(math.floor(min(xs) / cell), math.floor(max(xs) / cell) + 1):
            for by in range(math.floor(min(ys) / cell), math.floor(max(ys) / cell) + 1):
                grid.setdefault((bx, by), []).append(n)
    out = []
    for n, t in enumerate(flat):
        cx = sum(p[0] for p in t) / 3.0
        cy = sum(p[1] for p in t) / 3.0
        cz = sum(p[2] for p in t) / 3.0
        hidden = False
        for m in grid.get((math.floor(cx / cell), math.floor(cy / cell)), ()):
            if m == n:
                continue
            z = _covers(flat[m], cx, cy)
            if z is not None and z > cz + 1e-3:
                hidden = True
                break
        if not hidden:
            out.append(t)
    return out


def components(tris):
    """Split triangles into plan-connected patches (sharing a corner counts)."""
    parent = list(range(len(tris)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    seen = {}
    for n, t in enumerate(tris):
        for p in t:
            k = _key(p)
            if k in seen:
                a, b = find(seen[k]), find(n)
                if a != b:
                    parent[a] = b
            else:
                seen[k] = n
    groups = {}
    for n in range(len(tris)):
        groups.setdefault(find(n), []).append(tris[n])
    return list(groups.values())


def boundary(tris):
    """Plan edges used by exactly one of `tris`, as ((x, y), (x, y)) pairs.

    Edges are matched on millimetre-rounded plan coordinates, so welded and
    unwelded sheets give the same answer.
    """
    count, seg = {}, {}
    for t in tris:
        for u, v in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            ku, kv = _key(u), _key(v)
            if ku == kv:
                continue
            e = (ku, kv) if ku < kv else (kv, ku)
            count[e] = count.get(e, 0) + 1
            seg[e] = ((u[0], u[1]), (v[0], v[1]))
    return [seg[e] for e, n in count.items() if n == 1]


def on_direction(a, b, directions=LATTICE_DIRECTIONS, tol=DIRECTION_TOL_DEG):
    ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0
    return any(min(abs(ang - d), 180.0 - abs(ang - d)) <= tol for d in directions)


class PointSet:
    """Plan points, looked up within a tolerance through a bucket grid."""

    def __init__(self, points, tol=VERTEX_TOL):
        self.tol = tol
        self.cell = max(tol * 4.0, 1e-3)
        self.buckets = {}
        for x, y in points:
            k = (math.floor(x / self.cell), math.floor(y / self.cell))
            self.buckets.setdefault(k, []).append((x, y))

    def __contains__(self, p):
        cx, cy = math.floor(p[0] / self.cell), math.floor(p[1] / self.cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for x, y in self.buckets.get((cx + dx, cy + dy), ()):
                    if abs(x - p[0]) <= self.tol and abs(y - p[1]) <= self.tol:
                        return True
        return False


def alignment(tris, lattice_points, directions=LATTICE_DIRECTIONS, seam=False):
    """(share of boundary length on a lattice direction, share of boundary
    vertices on a lattice point, boundary length) for one feature. With
    `seam`, a land tile's pinned mouth seam is left out of the direction
    share (see MOUTH_SEAM_TOL)."""
    if not isinstance(lattice_points, PointSet):
        lattice_points = PointSet(lattice_points)
    segs = boundary(tris)
    verts = {_key(p): p for s in segs for p in s}
    if seam:
        segs = [(a, b) for a, b in segs if not mouth_seam(a, b)]
    total = sum(math.dist(a, b) for a, b in segs)
    if total <= 0.0:
        return 1.0, 1.0, 0.0
    on = sum(math.dist(a, b) for a, b in segs if on_direction(a, b, directions))
    hit = sum(1 for p in verts.values() if p in lattice_points)
    return on / total, hit / max(1, len(verts)), total


def _prop_water(name):
    # A composed tile numbers its copies (`Trade_Pasture_NW_hayrack_02`).
    base = re.sub(r"_\d+$", "", name)
    return base.endswith(PROP_WATER_SUFFIXES)


def water_bodies(parts):
    """Every body of water among `parts`, as (name, [surface triangles]).

    `parts` is an iterable of (name, [(tri, material), ...]) with each tri a
    triple of (x, y, z). A part's water surfaces are split into connected
    patches and a patch under `WATER_BODY_AREA` is dropped (a trough).
    """
    out = []
    for name, faces in parts:
        if _prop_water(name):
            continue
        wet = surfaces([t for t, mat in faces if mat and WATER_MATERIAL.match(mat)])
        for patch in components(wet):
            if sum(plan_area(*t) for t in patch) >= WATER_BODY_AREA:
                out.append((name, patch))
    return out


def ground_features(parts):
    """Named non-water ground features (FEATURE_SUFFIXES), as (name, surfaces)."""
    out = []
    for name, faces in parts:
        if re.sub(r"_\d+$", "", name).endswith(FEATURE_SUFFIXES):
            patch = surfaces([t for t, _mat in faces])
            if sum(plan_area(*t) for t in patch) >= WATER_BODY_AREA:
                out.append((name, patch))
    return out


def violations(terrain, parts, lattice_points, directions=LATTICE_DIRECTIONS):
    """Every feature on `terrain` whose outline is off its lattice, as strings."""
    if exempt_reason(terrain):
        return []
    points = PointSet(lattice_points)
    out = []
    for kind, found in (("water", water_bodies(parts)), ("feature", ground_features(parts))):
        for name, tris in found:
            on_dir, on_vert, length = alignment(
                tris, points, directions, seam=directions == LATTICE_DIRECTIONS
            )
            if on_dir < MIN_ON_DIRECTION - 1e-9 or on_vert < MIN_ON_VERTEX - 1e-9:
                out.append(
                    f"{name}: {kind} outline is off the ground lattice: {on_dir:.2f} of "
                    f"{length:.2f} boundary on the "
                    f"{'/'.join(str(int(d)) for d in directions)} degree edges (need {MIN_ON_DIRECTION:.2f}), "
                    f"{on_vert:.2f} of corners on a ground vertex (need {MIN_ON_VERTEX:.2f}); "
                    f"see featurelattice.carve_basin"
                )
    return out


# --- building a basin ------------------------------------------------------------


def _hash01(*vals):
    """A deterministic value in [0, 1) from a few numbers (no RNG state)."""
    h = 2166136261
    for v in vals:
        for byte in repr(round(v, 4)).encode():
            h = ((h ^ byte) * 16777619) & 0xFFFFFFFF
    return h / 4294967296.0


def region_from_polygons(verts, tris, inside):
    """The triangles whose plan centroid `inside(x, y)` says is in the feature."""
    out = set()
    for n, t in enumerate(tris):
        cx = sum(verts[i][0] for i in t) / 3.0
        cy = sum(verts[i][1] for i in t) / 3.0
        if inside(cx, cy):
            out.add(n)
    return out


def edge_neighbours(tris):
    """For each triangle, the triangles sharing an edge with it."""
    by_edge = {}
    for n, t in enumerate(tris):
        for u, v in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            by_edge.setdefault((min(u, v), max(u, v)), []).append(n)
    nb = [[] for _ in tris]
    for ns in by_edge.values():
        for a in ns:
            for b in ns:
                if a != b:
                    nb[a].append(b)
    return nb


def tidy_region(tris, region, allowed=None, passes=3):
    """Fill one-triangle notches and drop one-triangle spurs.

    A rasterised outline has both: a notch is a triangle outside with two of
    its three edge neighbours inside (a V bitten out of the shore), a spur a
    triangle inside with at most one neighbour inside (a single tooth). Either
    reads as noise at the board's zoom rather than as a staircase.
    """
    nb = edge_neighbours(tris)
    region = set(region)
    for _ in range(passes):
        changed = False
        for n in range(len(tris)):
            inside = sum(1 for m in nb[n] if m in region)
            if n in region and inside <= 1:
                region.discard(n)
                changed = True
            elif n not in region and inside >= 2 and (allowed is None or n in allowed):
                region.add(n)
                changed = True
        if not changed:
            break
    return region


def region_rings(tris, region):
    """(boundary vertices, interior vertices, vertex depth) of a region.

    A vertex is on the boundary when a triangle outside the region also uses
    it. Depth counts lattice steps in from the boundary (boundary = 0).
    """
    inside_v, outside_v = set(), set()
    for n, t in enumerate(tris):
        (inside_v if n in region else outside_v).update(t)
    edge = inside_v & outside_v
    adj = {}
    for n in region:
        t = tris[n]
        for u in t:
            adj.setdefault(u, set()).update(v for v in t if v != u)
    depth = {v: 0 for v in edge}
    frontier = list(edge)
    while frontier:
        nxt = []
        for u in frontier:
            for v in adj.get(u, ()):
                if v not in depth and v in inside_v:
                    depth[v] = depth[u] + 1
                    nxt.append(v)
        frontier = nxt
    for v in inside_v:
        depth.setdefault(v, 1)
    return edge, inside_v - edge, depth


def shore_ring(tris, region, edge):
    """Vertices one step outside the region: the bank's top."""
    out = set()
    for n, t in enumerate(tris):
        if n in region:
            continue
        if any(v in edge for v in t):
            out.update(v for v in t if v not in edge)
    inside = set()
    for n in region:
        inside.update(tris[n])
    return out - inside


def carve_basin(
    verts,
    tris,
    region,
    level=None,
    margin=0.004,
    lip=0.004,
    bowl=(0.018, 0.030, 0.040),
    floor=None,
    locked=(),
    raise_shore=False,
):
    """Cut a level basin into a triangle ground, in place.

    `verts` is a list of mutable [x, y, z]; `tris` a list of vertex-index
    triples; `region` the set of triangle indices the water covers. Returns a
    dict with the water `level`, the `edge` (boundary) and `inner` vertex sets
    and each vertex's `depth` in lattice steps.

    The level, unless given, is `margin` under the lowest vertex of the ring
    just outside the region, so the bank stands clear of the water all the way
    round and nothing floats. Every boundary vertex goes to `lip` under the
    level (or stays lower), every interior one to `bowl[depth-1]` under it:
    each water triangle then has all three of its ground corners below the
    sheet. `floor` is a
    height nothing is taken under (the slab's top, where it is not cut), and
    `locked` vertices are never moved (the ring shared with the rim).
    `level` may also be a function of the vertex index, for water that runs
    downhill (the goldfield's creek): the sheet is then a tilted triangle per
    lattice triangle, each still above all three of its ground corners.

    With a given `level` and `raise_shore`, any vertex of the ring outside
    that stands under `level + margin` is lifted to it instead: the bank is
    tucked up round a pool whose level is fixed (the marsh's sit a few
    centimetres over the slab, with no room to take the level down).
    """
    edge, inner, depth = region_rings(tris, region)
    locked = set(locked)
    if level is None:
        ring = shore_ring(tris, region, edge)
        if not ring:
            raise ValueError("a basin needs ground round it")
        level = min(verts[v][2] for v in ring) - margin
    at = level if callable(level) else (lambda v: level)  # noqa: E731
    if raise_shore:
        for v in shore_ring(tris, region, edge):
            if v not in locked and verts[v][2] < at(v) + margin:
                verts[v][2] = at(v) + margin
    for v, d in depth.items():
        if v in locked:
            continue
        want = at(v) - (lip if d == 0 else bowl[min(d, len(bowl)) - 1])
        z = min(verts[v][2], want)
        if floor is not None:
            z = max(z, floor)
        verts[v][2] = z
    bad = [v for v in depth if verts[v][2] >= at(v) - 1e-6]
    if bad:
        raise ValueError(
            f"{len(bad)} basin vertices cannot go under the water "
            f"(floor {floor}, locked {len(locked & set(bad))})"
        )
    return {"level": level, "edge": edge, "inner": inner, "depth": depth}


def water_tone(verts, tri, depth, seed=0.0):
    """0 deep, 1 open water, 2 shallows: the mosaic, triangle by triangle.

    Read off how many of the triangle's corners are inside the edge (all three
    is deep, none is shallows), then one triangle in five is nudged a tone
    either way so the tones do not form concentric bands.
    """
    inner = sum(1 for v in tri if depth.get(v, 0) > 0)
    deep = sum(1 for v in tri if depth.get(v, 0) > 1)
    tone = 0 if deep >= 2 else (1 if inner >= 2 else 2)
    cx = sum(verts[v][0] for v in tri) / 3.0
    cy = sum(verts[v][1] for v in tri) / 3.0
    r = _hash01(cx, cy, seed)
    if r < 0.12:
        tone = min(2, tone + 1)
    elif r < 0.22:
        tone = max(0, tone - 1)
    return tone


def water_sheet(verts, tris, region, level, depth, seed=0.0, lip_to=None):
    """The water: every region triangle, flat at `level`, three vertices each.

    Returns (positions, faces, tones, lips): `lips` are the vertical quads
    from the sheet's edge down to the bank vertex under it, one per boundary
    edge (a step of `lip` or so, which is what the bank reads as at the
    board's zoom). A triangle owns its three corners, so the exporter writes
    exactly three per triangle and never welds across a tone change.
    """
    at = level if callable(level) else (lambda v: level)  # noqa: E731
    pos, faces, tones = [], [], []
    for n in sorted(region):
        t = tris[n]
        base = len(pos)
        for v in t:
            pos.append((verts[v][0], verts[v][1], at(v)))
        a, b, c = pos[base], pos[base + 1], pos[base + 2]
        if (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]) < 0:
            faces.append((base, base + 2, base + 1))
        else:
            faces.append((base, base + 1, base + 2))
        tones.append(water_tone(verts, t, depth, seed))
    lips = []
    count = {}
    for n in region:
        t = tris[n]
        for u, v in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            e = (min(u, v), max(u, v))
            count[e] = count.get(e, 0) + 1
    for (u, v), k in count.items():
        if k != 1:
            continue
        pu, pv = verts[u], verts[v]
        lips.append(
            (
                (pu[0], pu[1], at(u)),
                (pv[0], pv[1], at(v)),
                (pv[0], pv[1], pv[2] if lip_to is None else lip_to),
                (pu[0], pu[1], pu[2] if lip_to is None else lip_to),
            )
        )
    return pos, faces, tones, lips


def bank_triangles(tris, region, edge):
    """Triangles outside the region with a corner on its edge: the bank."""
    return {n for n, t in enumerate(tris) if n not in region and any(v in edge for v in t)}


def region_outline(verts, tris, region):
    """The outer boundary of a region as one closed loop of vertex indices.

    For cutting the slab's top face under a basin: every vertex on it is a
    vertex of the ground, so the hole's edge is hidden under the lattice's own
    triangles. Raises if the region has a hole or two pieces.
    """
    count = {}
    for n in region:
        t = tris[n]
        for u, v in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            e = (min(u, v), max(u, v))
            count[e] = count.get(e, 0) + 1
    nxt = {}
    for (u, v), k in count.items():
        if k == 1:
            nxt.setdefault(u, []).append(v)
            nxt.setdefault(v, []).append(u)
    if any(len(ns) != 2 for ns in nxt.values()):
        raise ValueError("the region's outline pinches at a vertex")
    start = next(iter(nxt))
    loop, prev, cur = [start], None, start
    while True:
        a, b = nxt[cur]
        step = b if a == prev else a
        if step == start:
            break
        loop.append(step)
        prev, cur = cur, step
    if len(loop) != len(nxt):
        raise ValueError("the region's outline is more than one loop")
    return loop


def lattice_ground(z_of, **kw):
    """The shared lattice sampled from a height function: (verts, tris, keys).

    `verts` are mutable [x, y, z]; `tris` vertex-index triples wound
    counter-clockwise; `keys` the (i, j) of each vertex, so a caller can tell
    ring 14 (the rim's) from the rest.
    """
    pts = shared_lattice(**kw)
    keys = sorted(pts)
    index = {k: i for i, k in enumerate(keys)}
    verts = [[pts[k][0], pts[k][1], z_of(*pts[k])] for k in keys]
    tris = [tuple(index[k] for k in t) for t in shared_lattice_triangles(pts)]
    return verts, tris, keys


def lattice_ring(key):
    i, j = key
    return max(abs(i), abs(j), abs(i + j))


def height_at(verts, tris, x, y):
    """The surface height over (x, y), or None off the triangles."""
    for t in tris:
        z = _covers(tuple(verts[i] for i in t), x, y)
        if z is not None:
            return z
    return None


#: How far the ground may stand over a water sheet's own vertex before it is
#: cutting through it. A millimetre is float noise; more is a waterline drawn
#: by the terrain.
CUT_TOL = 0.001


def ground_through(water, ground, cell=0.25):
    """Where the ground comes up through the water: (count, worst height).

    `water` and `ground` are lists of triangles of (x, y, z). Each water
    triangle is sampled at its corners (pulled 2% toward its centre, so a
    shared bank edge does not count) and its centroid, and the ground under
    each sample must be under the sheet there. A basin cut from the lattice
    passes by construction; a level sheet over sloping ground fails.
    """
    grid = {}
    for n, t in enumerate(ground):
        xs, ys = [p[0] for p in t], [p[1] for p in t]
        for bx in range(math.floor(min(xs) / cell), math.floor(max(xs) / cell) + 1):
            for by in range(math.floor(min(ys) / cell), math.floor(max(ys) / cell) + 1):
                grid.setdefault((bx, by), []).append(n)
    count, worst = 0, 0.0
    for t in water:
        cx = sum(p[0] for p in t) / 3.0
        cy = sum(p[1] for p in t) / 3.0
        for u, v, w in ((1 / 3, 1 / 3, 1 / 3), (0.96, 0.02, 0.02), (0.02, 0.96, 0.02), (0.02, 0.02, 0.96)):
            x = u * t[0][0] + v * t[1][0] + w * t[2][0]
            y = u * t[0][1] + v * t[1][1] + w * t[2][1]
            zw = u * t[0][2] + v * t[1][2] + w * t[2][2]
            for n in grid.get((math.floor(x / cell), math.floor(y / cell)), ()):
                zg = _covers(ground[n], x, y)
                if zg is not None and zg > zw + CUT_TOL:
                    count += 1
                    worst = max(worst, zg - zw)
                    break
    return count, worst
