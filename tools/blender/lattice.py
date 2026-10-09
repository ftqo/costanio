"""The renderer's generated geometry, restated in Blender coordinates.

Imports no bpy, so it unit-tests without Blender.

Everything here mirrors the TypeScript under `frontend/src/lib/board3d/`,
which builds this geometry at runtime; nothing here is exported. It puts the
lattice gap, the beach and the harbour token into the Blender viewport so
terrain art is authored against the board that ships.

`test_lattice.py` reads the numbers back out of the TypeScript and fails if
they disagree. Change a constant there, not here.

## Coordinates

The renderer is Y-up with the board in the XZ plane; Blender is Z-up with the
board in XY. The glTF exporter maps Blender (x, y, z) -> glTF (x, z, -y), so
going the other way a renderer point (x, y, z) is Blender (x, -z, y). Edge 0
is the +x edge in both, and a renderer rotation about +Y by `t` is a Blender
rotation about +Z by the same `t` (the handednesses cancel with the axis
flip), so `anchors.turn_for` uses the renderer's `-pi/3 * edge` unchanged.
"""

import math

SQRT3 = math.sqrt(3.0)

# --- coords.ts -------------------------------------------------------------

#: Hex circumradius the tile art is drawn at. Mirrors manifest.generated.ts.
HEX_SIZE = 3.0

#: Gutter between one tile's rim and the next. Mirrors coords.ts LATTICE_GAP.
LATTICE_GAP = 0.25

#: Circumradius the lattice is laid out at, as against the art's own size.
LATTICE_SIZE = HEX_SIZE + LATTICE_GAP / SQRT3

#: Factor the water tiles are drawn at, so the sea fills its whole cell.
LATTICE_SCALE = LATTICE_SIZE / HEX_SIZE

#: Terrains the renderer draws as water, and so scales by LATTICE_SCALE.
#:
#: `Shore` and `Port` are sea tiles with dressing on them, not land: the
#: renderer maps both to `sea_*` resources and `isWaterTile` is true for all
#: three. A land tile keeps its authored size and gets a gutter; these do not.
#:
#: `Shoal` is the third: open water with a bank, built on the ocean's own hull
#: and wave sheet (appended from `art/hexes/ocean.blend`). It maps to
#: `sea_shoal`; `test_lattice` holds every terrain in this set to a resource
#: the renderer's WATER set calls water.
#:
#: `Council` is the fourth: the Explorers Council hex, a walled town on a rock
#: in open water, built on the same appended hull and sheet.
WATER_TERRAINS = frozenset({"Ocean", "Port", "Shoal", "Council"})


def axial_to_xy(q, r, size=LATTICE_SIZE):
    """Pointy-top axial hex centre in Blender XY.

    `hexToWorld` gives renderer (x, 0, z) = (size*sqrt3*(q + r/2), 0,
    size*1.5*r), and Blender y is the negative of renderer z.
    """
    return (size * SQRT3 * (q + r / 2.0), -size * 1.5 * r)


def xy_to_axial(x, y, size=HEX_SIZE):
    """Inverse of `axial_to_xy`, for reading a showcase hex's authored cell."""
    r = -y / (size * 1.5)
    q = x / (size * SQRT3) - r / 2.0
    return (q, r)


#: Axial neighbour offsets, indexed by edge. Mirrors coords.ts DIRS.
DIRS = ((1, 0), (0, 1), (-1, 1), (-1, 0), (0, -1), (1, -1))


def neighbor(q, r, direction):
    dq, dr = DIRS[direction % 6]
    return (q + dq, r + dr)


def edge_turn(direction):
    """Rotation about +Z that carries edge-0 art onto edge `direction`.

    The renderer's `edgeAngleY`, unchanged (see the coordinates note above).
    """
    return (-math.pi / 3.0) * (direction % 6)


# --- gapGeometry.ts --------------------------------------------------------

#: Hex centre to the middle of the tile art's own edge.
TILE_APOTHEM = HEX_SIZE * SQRT3 / 2.0

#: Hex centre to the middle of its lattice edge: the midline down the gap.
LATTICE_APOTHEM = LATTICE_SIZE * SQRT3 / 2.0

#: How far the fill reaches back under its own tile, to hide the seam.
GAP_UNDERLAP = 0.06

#: Inner boundary of the fill, as a fraction of the tile hexagon.
GAP_INNER_SCALE = (TILE_APOTHEM - GAP_UNDERLAP) / TILE_APOTHEM

#: A land tile's own top face: `SURFACE.land` in seating.ts, the height every
#: piece on land stands on. A field of `SURFACE` rather than a bare const, so
#: `test_lattice` cannot read it back.
TILE_TOP_Z = 0.25

#: Top of the sand: just under the tile's top face, and above the beach's crest
#: (`BEACH_TOP_Z`, 0.215) so the gutter still shows where a coast runs past it.
GAP_SAND_Z = 0.22

#: Underside, matching the tile slab's own bottom face.
GAP_BOTTOM_Z = -0.25


def gap_strip():
    """One tile's half of the gap along edge 0, as (verts, faces).

    Half, not the whole gap: only land tiles have one. Between two land tiles
    the two halves make the whole; at the coast the water is drawn a full
    lattice cell wide and meets the land's half on the midline.
    """
    xi = TILE_APOTHEM * GAP_INNER_SCALE
    yi = (HEX_SIZE / 2.0) * GAP_INNER_SCALE
    xo = LATTICE_APOTHEM
    yo = LATTICE_SIZE / 2.0
    # Wound counter-clockwise in XY so the top face's normal is +Z. The
    # renderer's polygon is given in (x, z) and Blender y is -z, hence the
    # order reversing relative to gapGeometry.ts.
    top = [(xi, -yi), (xo, -yo), (xo, yo), (xi, yi)]
    return prism(top, GAP_SAND_Z, GAP_BOTTOM_Z)


# --- beachGeometry.ts ------------------------------------------------------

#: A water hex's centre to the middle of an edge. LATTICE_SIZE, not HEX_SIZE:
#: the beach is built in the water tile's frame and that tile fills its cell.
BEACH_APOTHEM = LATTICE_SIZE * SQRT3 / 2.0

#: The pale apron: dry sand, level with the land, before the shelf starts.
BEACH_DRY_WIDTH = 0.7975

#: The shelf: wet sand, from the land's height down to the waterline. Its width
#: sets its slope, the fall being fixed at both ends (see beachGeometry.ts;
#: test_beach_bands pins the two together).
BEACH_WET_WIDTH = 0.605

#: How far the sand reaches from the shoreline out into the water. Derived
#: from the two bands.
BEACH_WIDTH = BEACH_DRY_WIDTH + BEACH_WET_WIDTH

#: The crest, mirroring beachGeometry.ts TOP_Y. Not the land's 0.25: the beach
#: starts a thousandth under the sand in the gutter (0.22) so that the gutter
#: and the tile rims stay visible where the coast runs past them.
BEACH_TOP_Z = 0.215
BEACH_WATER_Z = 0.13
BEACH_BOTTOM_Z = -0.06

#: One facet across a corner: a single straight chamfer, not a curve, to
#: match the faceted board.
BEACH_CORNER_FACETS = 1

BEACH_KINDS = ("dry", "wet")


def beach_span(kind):
    """How far out from the shoreline a sand band runs."""
    if kind == "dry":
        return (0.0, BEACH_DRY_WIDTH)
    if kind == "wet":
        return (BEACH_DRY_WIDTH, BEACH_WIDTH)
    raise ValueError(f"unknown sand kind {kind!r}")


def beach_height(t):
    """Surface height at distance `t` out from the shoreline."""
    if t <= BEACH_DRY_WIDTH:
        return BEACH_TOP_Z
    shelf = (t - BEACH_DRY_WIDTH) / BEACH_WET_WIDTH
    return BEACH_TOP_Z + (BEACH_WATER_Z - BEACH_TOP_Z) * shelf


def beach_strip(kind):
    """The strip for edge 0 of a water hex, with land beyond it."""
    near_t, far_t = beach_span(kind)
    half = LATTICE_SIZE / 2.0
    near = BEACH_APOTHEM - near_t
    far = BEACH_APOTHEM - far_t
    top = [
        (near, half, beach_height(near_t)),
        (near, -half, beach_height(near_t)),
        (far, -half, beach_height(far_t)),
        (far, half, beach_height(far_t)),
    ]
    return sloped_prism(top, BEACH_BOTTOM_Z)


def beach_connector(kind):
    """The wedge at corner 0, the vertex between edge 0 and edge 1.

    Where the coast turns a convex corner the two strips meeting there are cut
    square across their ends, and offsetting the corner outwards leaves a
    60-degree wedge between them. This is that wedge.
    """
    near_t, far_t = beach_span(kind)
    # Corner 0 in Blender XY. The renderer's apex is (APOTHEM, LATTICE_SIZE/2)
    # in (x, z), so its y is the negative of that half-edge.
    apex = (BEACH_APOTHEM, -LATTICE_SIZE / 2.0)
    start = 2.0 * math.pi / 3.0
    sweep = math.pi / 3.0

    def at(angle, radius):
        # The renderer measures its angles from +x toward +z; +z is -y here,
        # so the same angle sweeps the other way round in Blender.
        return (
            apex[0] + math.cos(angle) * radius,
            apex[1] - math.sin(angle) * radius,
            beach_height(radius),
        )

    outer = []
    inner = []
    for i in range(BEACH_CORNER_FACETS + 1):
        angle = start + sweep * i / BEACH_CORNER_FACETS
        outer.append(at(angle, far_t))
        inner.append(at(angle, near_t))
    # A dry wedge reaches the vertex itself, so its inner edge collapses to a
    # single point rather than a sliver of degenerate triangles.
    if near_t == 0.0:
        ring = [(apex[0], apex[1], beach_height(0.0))]
    else:
        ring = list(reversed(inner))
    return sloped_prism(outer + ring, BEACH_BOTTOM_Z)


def solve_coastline(land):
    """Every beach strip and corner for a set of land hexes.

    Mirrors `solveCoastline`. `land` is an iterable of (q, r). Returns
    (strips, corners) where a strip is (hex, edge) and a corner is
    (hex, corner), both keyed on the water hex that owns them.

    As in the renderer, anything that is not land is water, since a board's
    tile list does not reliably include the sea around its coast.
    """
    land = set(land)
    coast = set()
    for q, r in land:
        for direction in range(6):
            n = neighbor(q, r, direction)
            if n not in land:
                coast.add(n)

    strips = []
    corners = []
    for hexc in sorted(coast, key=lambda h: (h[1], h[0])):
        coastal = [neighbor(hexc[0], hexc[1], d) in land for d in range(6)]
        for direction in range(6):
            if coastal[direction]:
                strips.append((hexc, direction))
        # A connector fills the wedge at a convex vertex (one land hex, two
        # water). Claiming only the end of a coastal run fills each such vertex
        # exactly once.
        for i in range(6):
            if coastal[i] and not coastal[(i + 1) % 6]:
                corners.append((hexc, i))
    return strips, corners


# --- the harbour ratio sign -------------------------------------------------
#
# The six signs are modelled from these constants, and the blend ships them in
# signs.glb.

#: Fraction of the full hex wedge the trade token is drawn at.
#:
#: Large enough for the trade ratio text to be readable.
TOKEN_SCALE = 0.385

#: Where the wedge's centre sits along the pier, which runs along -x.
#:
#: Placed so the wedge's base stays off the beach.
TOKEN_ALONG_PIER = -1.12

TOKEN_TOP_Z = 0.34
TOKEN_BOTTOM_Z = 0.28


def harbor_token():
    """The trade token, in the dock's own frame. A placeholder, as in the TS."""
    half = (HEX_SIZE / 2.0) * TOKEN_SCALE
    height = TILE_APOTHEM * TOKEN_SCALE
    base = TOKEN_ALONG_PIER - height / 2.0
    apex = TOKEN_ALONG_PIER + height / 2.0
    top = [(base, half), (apex, 0.0), (base, -half)]
    return prism(top, TOKEN_TOP_Z, TOKEN_BOTTOM_Z)


# --- reference sea plate ---------------------------------------------------

#: Top face of the reference sea plate.
#:
#: The blend ships one Ocean hex; the renderer instances it over every cell
#: the board does not name. The mirror lays a bare plate at the sea surface on
#: each water cell it touches, so the beaches do not hang in the void.
SEA_PLATE_TOP_Z = 0.05
SEA_PLATE_BOTTOM_Z = -0.25


def sea_plate():
    """A flat hexagon filling one lattice cell, pointy-top."""
    top = []
    for i in range(6):
        # Corner i of a pointy-top hex, counting from the North corner. North
        # is -z in the renderer, which is +y here.
        a = math.pi / 3.0 * i
        top.append((LATTICE_SIZE * math.sin(a), LATTICE_SIZE * math.cos(a)))
    return prism(top, SEA_PLATE_TOP_Z, SEA_PLATE_BOTTOM_Z)


# --- mesh construction -----------------------------------------------------


def prism(top, top_z, bottom_z):
    """Extrude a flat polygon down to a flat bottom.

    `top` is a simple polygon of (x, y) in either winding. Returns
    (verts, faces) ready for `Mesh.from_pydata`, with n-gons rather than
    triangles, which keeps the mesh legible in the viewport.
    """
    return sloped_prism([(x, y, top_z) for x, y in top], bottom_z)


def signed_area(top):
    """Twice the signed area of `top` in XY. Positive means counter-clockwise."""
    total = 0.0
    for i, (x, y) in enumerate([(p[0], p[1]) for p in top]):
        nx, ny = top[(i + 1) % len(top)][0], top[(i + 1) % len(top)][1]
        total += x * ny - nx * y
    return total


def sloped_prism(top, bottom_z):
    """As `prism`, but each top vertex carries its own height.

    The winding is normalised: the TypeScript relies on `THREE.DoubleSide`
    and passes polygons in either order.
    """
    if signed_area(top) < 0:
        top = list(reversed(top))
    n = len(top)
    verts = [(x, y, z) for x, y, z in top]
    verts += [(x, y, bottom_z) for x, y, _ in top]
    # Top CCW (+Z normal), bottom the same ring reversed (-Z), and each side
    # wound against its top edge so its normal points out of the solid.
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((j, i, n + i, n + j))
    return verts, faces
