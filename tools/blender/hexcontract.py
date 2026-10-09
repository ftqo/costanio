"""The contract every hex tile follows, as numbers and rules.

Imports no bpy, so it unit-tests without Blender. `check_hexes.py` does the
measuring; this module decides what passes.

Every number here was measured off the per-tile blends. `make check-hexes`
re-measures and re-checks.

## The slab is the hex object

`Hex_<Terrain>` is the terrain slab itself, a mesh, not an empty. Its top face
is the ground the props stand on and its underside is the board's thickness.
Everything else on the tile is its child.
"""

import math

import lattice

#: Tiles the renderer draws as water. They fill a whole lattice cell and so get
#: no gutter, which is why every dimension below forks on this.
WATER = lattice.WATER_TERRAINS

# --- the slab --------------------------------------------------------------

#: Circumradius of the slab. Land is the art hexagon; water is the whole cell.
LAND_CIRCUMRADIUS = lattice.HEX_SIZE
WATER_CIRCUMRADIUS = lattice.LATTICE_SIZE

#: Top face. Land meets the sand filling the gutter, so it is the same height.
LAND_TOP_Z = lattice.GAP_SAND_Z
LAND_BOTTOM_Z = lattice.GAP_BOTTOM_Z

#: Water sits lower and is thinner (measured, not derived from land).
WATER_TOP_Z = 0.1596
WATER_BOTTOM_Z = -0.2596

# --- the number chip -------------------------------------------------------

#: The socket is a circle empty, `Token_<Terrain>`, at this height.
SOCKET_Z = 0.26

#: Where it sits relative to the tile centre, on every land tile that has one.
#:
#: The one exception is Generic, whose chip mounts dead centre because the tile
#: is a shop counter rather than a landscape and has no north point to keep.
SOCKET_OFFSET = (0.0, 1.5)
CENTRED_SOCKET_TERRAINS = frozenset({"Generic"})

#: The disc that sits on the socket, and the margin around it.
CHIP_RADIUS = 1.0
KEEP_CLEAR_RADIUS = 1.05

#: Nothing may reach above this inside the keep-clear radius: the chip's
#: underside. On a pointy-top hex the north point and the socket are the same
#: place.
CHIP_UNDERSIDE_Z = 0.25

# --- the rim ---------------------------------------------------------------

#: The chamfer runs from the art apothem inward by half the gutter, dropping to
#: the gutter's own height, so the board reads as terrain with paths through it
#: rather than as counters laid on sand.
CHAMFER_OUTER_EDGE = lattice.TILE_APOTHEM
CHAMFER_WIDTH = lattice.LATTICE_GAP / 2.0
CHAMFER_OUTER_HEIGHT = lattice.GAP_SAND_Z

#: Every land tile carries one, named `<Terrain>_rim`. The rules below are what
#: the shipped rims measure as.
RIM_SUFFIX = "_rim"

#: Three surfaces meet at 0.220 over the annulus below (the slab's sunk top,
#: the gutter sand under it, and the rim's outer edge). The rim may float this
#: far above the other two to win the z-fight; the shared-border tiles measure
#: 0.2205, `Generic` sits at 0.2200.
RIM_TIE_BREAK = 0.0005

#: The annulus the rim must cover opaquely, because over it the slab is
#: coplanar with the sand.
#:
#: It runs from one `lattice.GAP_UNDERLAP` (how far the gutter fill reaches
#: under its tile) inside the art apothem out to the apothem (`art/README.md`'s
#: 2.538).
RIM_ANNULUS_INNER = CHAMFER_OUTER_EDGE - lattice.GAP_UNDERLAP
RIM_ANNULUS_OUTER = CHAMFER_OUTER_EDGE

#: How many points across that annulus the coverage test samples.
RIM_COVERAGE_RINGS = 3
RIM_COVERAGE_SPOKES = 120

#: How far the rim's inner edge must stand above its outer edge. The shallowest
#: shipped rise is `Generic`'s 0.0295 (0.2500 down to 0.2205); the shared
#: border climbs 0.0695.
RIM_MIN_RISE = 0.02

#: A lip made of geometry: a near-vertical face at the outer edge, tall enough
#: to read from 56 degrees of elevation.
#:
#: The shared-border tiles carry a 0.0135 cutbank, under this floor; they pass
#: on the material arm below. A rim with no outline material needs this height
#: for its shadow to draw the edge.
RIM_CUTBANK_MIN = 0.02

#: A face counts as a cutbank when its normal is this close to horizontal.
RIM_CUTBANK_NZ = 0.25

#: A lip made of material: a material confined to this band at the outer edge
#: and used nowhere further in, so the tile is outlined rather than feathered.
#: Every shared-border tile has exactly one (Desert's `Mat_Desert_gravel`,
#: Pasture's `Mat_Pasture_mud`, and so on), each spanning 2.5968 to 2.5981.
RIM_OUTLINE_BAND = 0.02

# --- the border ------------------------------------------------------------

#: Where the drawn border begins on a land tile, as a hexagonal apothem.
#:
#: The border a player sees between two land hexes is 0.25 wide on each side of
#: the lattice line: the tile's own half of the gutter sand (apothem 2.5981 out
#: to 2.7231, drawn by the renderer), and inside that the rim's chamfer, which
#: runs from the art apothem inward by the same half gutter and draws the lip.
#: Roads, settlements and the paths between hexes are laid over that band, so
#: nothing a tile carries may stand on it: every vertex of every part except
#: the ones built to meet it (`BORDER_PARTS`) must measure at most
#: 2.5981 - 0.125 = 2.4731 in the hexagon's own metric, where the rim's inner
#: edge and every ground's outermost ring sit.
#:
#: Measured in the hexagon's metric, not radially: mid-edge the border is 13%
#: closer than at the corners.
BORDER_APOTHEM = CHAMFER_OUTER_EDGE - CHAMFER_WIDTH

#: The same line on a water tile, in the blend's own (world-sized) frame.
#:
#: A sea tile fills its whole lattice cell and has no chamfer or gutter of its
#: own, but the lane is still there at a coast: a road or a settlement on the
#: lattice line is drawn half over the land's gutter and half over the water
#: cell. So a sea tile keeps the same half gutter clear inside its cell edge:
#: 2.7231 - 0.125 = 2.5981, which is where a land tile's art would have ended.
#: (The exporter writes water at 1/LATTICE_SCALE; in a shipped sea `.glb` this
#: line is 2.4788.)
WATER_BORDER_APOTHEM = lattice.LATTICE_APOTHEM - CHAMFER_WIDTH

#: The parts built to meet the border, which it therefore does not bind: the
#: slab (`Hex_<Terrain>` itself, skipped by the measurer), the rim that draws
#: the border, and on water the wave sheet that fills the cell.
BORDER_PARTS = ("_rim",)
WATER_BORDER_PARTS = ("_waves",)

#: A river's water and its cut cross the border at a mouth, by design, to meet
#: the next tile's: the seam is pinned at 0.60 of water and 0.70 of cut centred
#: on the edge midpoint (see art/README.md, "The faceted re-cut"). So past the
#: border line these parts are held to that notch instead of being exempt:
#: within 0.35 of an edge midpoint along the edge, and no higher than the
#: rim's outer edge, where the gutter sand takes over.
MOUTH_PARTS = ("_channel", "_water")
MOUTH_HALF_WIDTH = 0.35
MOUTH_TOP_Z = CHAMFER_OUTER_HEIGHT + RIM_TIE_BREAK

#: Named parts that reach the border by design, each with its reason. An entry
#: covers that object on that tile only.
BORDER_BY_DESIGN = {
    # The harbour pier's whole job is to reach the land it trades with: its
    # shore end is set 0.027 inside the water cell so it comes down on the
    # beach's crest rather than into the sea (`PIER_SHORE_GAP`, ocean.ts). It
    # never crosses the lattice line, so it never reaches the land's gutter.
    ("Port", "Port_deck"): "the pier lands on the beach at its own harbour edge",
}


def border_apothem_for(terrain):
    return WATER_BORDER_APOTHEM if terrain in WATER else BORDER_APOTHEM


def border_role(terrain, name):
    """'border' for a part built to meet the border, 'mouth', 'design', or 'art'."""
    parts = BORDER_PARTS + (WATER_BORDER_PARTS if terrain in WATER else ())
    if name == f"Hex_{terrain}" or name.endswith(parts):
        return "border"
    if any((key, name) in BORDER_BY_DESIGN for key in _keys(terrain)):
        return "design"
    if terrain not in WATER and name.endswith(MOUTH_PARTS):
        return "mouth"
    return "art"


def _mouth_offset(x, y):
    """How far along its edge a point sits from that edge's midpoint."""
    k = max(range(6), key=lambda i: x * math.cos(math.pi / 3.0 * i) + y * math.sin(math.pi / 3.0 * i))
    t = math.pi / 3.0 * k
    return abs(-x * math.sin(t) + y * math.cos(t))


def border_overshoot(terrain, name, x, y, z):
    """How far past the drawn border vertex (x, y, z) of part `name` stands.

    Zero or less means it is inside. Coordinates are relative to the tile
    centre, in the frame `circumradius_for` describes.
    """
    role = border_role(terrain, name)
    if role in ("border", "design"):
        return 0.0
    over = apothem(x, y) - border_apothem_for(terrain)
    if role == "mouth" and over > TOL:
        if _mouth_offset(x, y) <= MOUTH_HALF_WIDTH + TOL and z <= MOUTH_TOP_Z + TOL:
            return 0.0
    return over


def border_intrusions(terrain, parts):
    """The worst vertex of every part that crosses the border, worst first.

    `parts` is an iterable of (name, [(x, y, z), ...]) relative to the tile
    centre. Returns (name, apothem, z, overshoot) per offending part.
    """
    worst = {}
    for name, verts in parts:
        for x, y, z in verts:
            over = border_overshoot(terrain, name, x, y, z)
            if over > TOL and over > worst.get(name, (0.0,))[0]:
                worst[name] = (over, apothem(x, y), z)
    return [
        (name, round(a, 4), round(z, 4), round(over, 4))
        for name, (over, a, z) in sorted(worst.items(), key=lambda kv: -kv[1][0])
    ]


# --- height ----------------------------------------------------------------

#: Nothing on a tile may reach above this.
#:
#: At 56 degrees of elevation height reads at 56% and occludes the tiles
#: behind. Set just above the tallest part, `Mountains_massif` at 2.290.
PROP_CEILING_Z = 2.30

# --- tolerance -------------------------------------------------------------

#: Geometry is compared at millimetre scale: Blender writes single-precision
#: floats and the exporter rounds to four places.
TOL = 1e-3

# --- known drift -----------------------------------------------------------
#
# Measured deviations that exist today, each recorded with its actual value so
# anything new that drifts the same way still fails. Delete an entry when its
# tile is rebuilt.
KNOWN_DRIFT = {
    # Generic carries a bevel modifier on its slab that rounds the corners in,
    # so it measures 0.0144 short of the art circumradius. Cosmetic: the gutter
    # is 0.25 wide and this errs inward, away from the neighbour.
    ("Generic", "slab_circumradius"): 2.9856,
    # Generic's rim is a bare 0.030 feather in one material (`Mat_Generic`,
    # spanning the whole chamfer), so it has neither of the two lips the rule
    # below accepts: no cutbank and no material confined to the outer band.
    # Intended on this tile only, a shop counter rather than a landscape.
    # Every rule but the lip applies.
    ("Generic", "rim_lip"): "bare feather, one material, no cutbank",
    # Lake carries no rim mesh here; `gen/lake.py` builds one, and this entry
    # goes when that lands.
    ("Lake", "rim"): "derived from the desert after the rims were authored",
    # The shared border stops at t = 0.9519, 1.182 from the socket, so it
    # clears the 1.05 keep-clear radius on every tile.
}


def apothem(x, y):
    """How far out a point is, in the tile hexagon's own metric.

    The rim is a hexagonal ring of constant width, so its corners stand
    2/sqrt(3) further out than its edge midpoints. This returns the apothem of
    the smallest concentric hexagon containing the point, constant along the
    ring.

    The board's hexagons are pointy-top with a corner due north (`orientation_ok`
    is what holds them there), so their six edges face 0, 60, ... degrees and
    the metric is the largest projection onto those six normals.
    """
    return max(
        x * math.cos(math.pi / 3.0 * k) + y * math.sin(math.pi / 3.0 * k) for k in range(6)
    )


def circumradius_for(terrain):
    return WATER_CIRCUMRADIUS if terrain in WATER else LAND_CIRCUMRADIUS


def slab_z_for(terrain):
    """(top, bottom) the slab is expected to occupy."""
    if terrain in WATER:
        return WATER_TOP_Z, WATER_BOTTOM_Z
    return LAND_TOP_Z, LAND_BOTTOM_Z


def socket_offset_for(terrain):
    """Where the chip socket mounts, or None for a tile that carries no chip."""
    if terrain in WATER:
        return None
    if terrain in CENTRED_SOCKET_TERRAINS:
        return (0.0, 0.0)
    return SOCKET_OFFSET


#: Recipe-built tiles (`make compose-tiles`) and the terrain each is built on.
#: `check_hexes` fills it from `art/recipes/` before measuring them. A composed
#: tile carries its base tile's slab, rim and ground, so the base's recorded
#: drift is the composed tile's too (the lake's trade towns inherit its missing
#: rim). Nothing else is inherited.
DERIVES_FROM = {}


def _keys(terrain):
    base = DERIVES_FROM.get(terrain)
    return (terrain,) if base is None else (terrain, base)


def _allowed(terrain, rule):
    for key in _keys(terrain):
        if (key, rule) in KNOWN_DRIFT:
            return KNOWN_DRIFT[(key, rule)]
    return None


def _waived(terrain, rule):
    """True when a rule is waived outright rather than held to a drifted value.

    A rim rule has no number to hold, so those entries carry their reason as
    the value and this asks only whether one is present.
    """
    return any((key, rule) in KNOWN_DRIFT for key in _keys(terrain))


def rim_name_for(terrain):
    """The mesh every land tile's border is drawn by."""
    return f"{terrain}{RIM_SUFFIX}"


def rim_violations(m):
    """Every way measurement `m` breaks the rim contract.

    Split out from `violations`: a missing rim is easy to miss in the viewport.

    Water tiles have no land surface to ramp and fill their whole lattice cell,
    so none of this applies to them.
    """
    terrain = m["terrain"]
    if terrain in WATER:
        return []

    rim = m.get("rim")
    if rim is None:
        if _waived(terrain, "rim"):
            return []
        return [
            f"no {rim_name_for(terrain)} mesh: every land tile carries a rim, "
            f"the chamfer from apothem {CHAMFER_OUTER_EDGE:.4f} inward "
            f"{CHAMFER_WIDTH:.3f} down to {CHAMFER_OUTER_HEIGHT:.3f} "
            f"(see art/README.md, 'Terrain rims')"
        ]

    out = []
    name = rim["name"]

    # --- the slab has to be out of the way --------------------------------
    # `slab_top_z` already failed above if this is wrong; a chamfer under a
    # 0.250 slab top renders as nothing.
    if m["slab_top_z"] > CHAMFER_OUTER_HEIGHT + TOL and not _allowed(terrain, "slab_top_z"):
        out.append(
            f"slab top {m['slab_top_z']:.4f} buries {name}: min-clamp the six "
            f"top vertices to {CHAMFER_OUTER_HEIGHT:.3f}"
        )

    # --- and so does everything else at chamfer height ---------------------
    # A ground apron left at its authored height lies over the chamfer and
    # hides it. Only geometry at the chamfer's own height counts
    # (`check_hexes` caps the scan at the rim's inner edge), so a palm frond
    # over the lip is fine.
    if not _waived(terrain, "rim_buried"):
        for who, z, a in m.get("rim_buried_by", []):
            out.append(
                f"{who} sits at z={z:.4f} at apothem {a:.4f}, on {name} between "
                f"the gutter {CHAMFER_OUTER_HEIGHT:.3f} and the chamfer's own "
                f"inner edge: sink or trim it"
            )

    # --- the outer edge meets the sand ------------------------------------
    if not _close(rim["apothem_max"], CHAMFER_OUTER_EDGE):
        out.append(
            f"{name} reaches apothem {rim['apothem_max']:.4f}, not the art "
            f"apothem {CHAMFER_OUTER_EDGE:.4f}"
        )
    lo = CHAMFER_OUTER_HEIGHT - TOL
    hi = CHAMFER_OUTER_HEIGHT + RIM_TIE_BREAK + TOL
    if not (lo <= rim["outer_z_min"] and rim["outer_z_max"] <= hi):
        out.append(
            f"{name} outer edge z {rim['outer_z_min']:.4f}..{rim['outer_z_max']:.4f} "
            f"is outside {CHAMFER_OUTER_HEIGHT:.3f} (+{RIM_TIE_BREAK:.4f} tie-break)"
        )

    # --- and climbs away from it ------------------------------------------
    rise = rim["inner_z_min"] - rim["outer_z_max"]
    if rise < RIM_MIN_RISE - TOL:
        out.append(
            f"{name} inner edge rises {rise:.4f} above its outer edge, "
            f"under the {RIM_MIN_RISE:.3f} a chamfer has to climb"
        )

    # --- opaque over the overlap ------------------------------------------
    if rim["annulus_gaps"]:
        total = RIM_COVERAGE_RINGS * RIM_COVERAGE_SPOKES
        out.append(
            f"{name} leaves {rim['annulus_gaps']} of {total} samples uncovered "
            f"between apothem {RIM_ANNULUS_INNER:.4f} and {RIM_ANNULUS_OUTER:.4f}, "
            f"where the slab and the gutter sand are coplanar and a hole z-fights"
        )

    # --- and reads as an edge rather than a fade --------------------------
    if not _waived(terrain, "rim_lip"):
        has_cutbank = rim["cutbank"] >= RIM_CUTBANK_MIN - TOL
        if not has_cutbank and not rim["outline_material"]:
            out.append(
                f"{name} has no visible lip: its cutbank is {rim['cutbank']:.4f} "
                f"(needs {RIM_CUTBANK_MIN:.3f}) and no material is confined to "
                f"the outer {RIM_OUTLINE_BAND:.3f}"
            )

    return out


def _close(a, b, tol=TOL):
    return abs(a - b) <= tol


def violations(m):
    """Every way measurement `m` breaks the contract, as readable strings.

    `m` is what `check_hexes.measure` produces. Empty list means the tile
    passes. Rules are checked independently so one failure does not mask the
    rest.
    """
    terrain = m["terrain"]
    water = terrain in WATER
    out = []

    # --- the slab ---------------------------------------------------------
    if not m.get("slab_is_mesh", True):
        out.append(f"Hex_{terrain} must be the terrain slab MESH, not a {m.get('slab_type')}")

    want_r = circumradius_for(terrain)
    got_r = m["slab_circumradius"]
    drift_r = _allowed(terrain, "slab_circumradius")
    if drift_r is not None:
        if not _close(got_r, drift_r):
            out.append(
                f"slab circumradius {got_r:.4f} != known drift {drift_r:.4f} "
                f"(contract wants {want_r:.4f}; fix the tile and drop the KNOWN_DRIFT entry)"
            )
    elif not _close(got_r, want_r):
        out.append(f"slab circumradius {got_r:.4f} != {want_r:.4f}")

    want_top, want_bottom = slab_z_for(terrain)
    for rule, got, want in (
        ("slab_top_z", m["slab_top_z"], want_top),
        ("slab_bottom_z", m["slab_bottom_z"], want_bottom),
    ):
        drift = _allowed(terrain, rule)
        target = want if drift is None else drift
        if not _close(got, target):
            note = "" if drift is None else f" (known drift; contract wants {want:.4f})"
            out.append(f"{rule} {got:.4f} != {target:.4f}{note}")

    # Thickness is checked against the slab's own faces rather than the two
    # constants, so a slab moved bodily in z fails on top/bottom above and is
    # not reported a third time here.
    thickness = m["slab_top_z"] - m["slab_bottom_z"]
    want_thickness = want_top - want_bottom
    if not _close(thickness, want_thickness, tol=2 * TOL) and not _allowed(terrain, "slab_top_z"):
        out.append(f"slab thickness {thickness:.4f} != {want_thickness:.4f}")

    # --- the border --------------------------------------------------------
    # Art must not cross onto the drawn border: that is where the roads, the
    # settlements and the path between hexes are drawn. Measured per vertex in
    # the hexagon's own metric (see BORDER_APOTHEM for why not the radius).
    line = border_apothem_for(terrain)
    for name, a, z, over in m.get("border_intrusions", []):
        out.append(
            f"{name} reaches apothem {a:.4f} at z={z:.4f}, {over:.4f} past the "
            f"border at {line:.4f}: move or trim it inward"
        )

    # --- height ------------------------------------------------------------
    if m["tallest_z"] > PROP_CEILING_Z + TOL:
        out.append(
            f"tallest geometry {m['tallest_z']:.4f} > ceiling {PROP_CEILING_Z:.4f} "
            f"({m.get('tallest_object')})"
        )

    # --- the chip socket ---------------------------------------------------
    want_offset = socket_offset_for(terrain)
    socket = m.get("socket")
    if want_offset is None:
        if socket is not None:
            out.append(f"water tile carries a chip socket {socket['name']}")
    elif socket is None:
        out.append(f"missing chip socket Token_{terrain}")
    else:
        if socket["type"] != "EMPTY":
            out.append(f"{socket['name']} is a {socket['type']}, expected an EMPTY")
        if socket.get("empty_display_type") not in (None, "CIRCLE"):
            out.append(f"{socket['name']} is a {socket['empty_display_type']} empty, expected CIRCLE")
        dx, dy, dz = socket["offset"]
        if not (_close(dx, want_offset[0]) and _close(dy, want_offset[1])):
            out.append(
                f"chip socket at ({dx:.4f}, {dy:.4f}) != "
                f"({want_offset[0]:.4f}, {want_offset[1]:.4f})"
            )
        if not _close(dz, SOCKET_Z):
            out.append(f"chip socket z {dz:.4f} != {SOCKET_Z:.4f}")

        # --- keep-clear ---------------------------------------------------
        allowed = _allowed(terrain, "chip_keep_clear")
        for name, z, r in m.get("keep_clear_intrusions", []):
            if name == allowed:
                continue
            out.append(
                f"{name} reaches z={z:.4f} at r={r:.3f} from the chip socket, "
                f"above the chip underside {CHIP_UNDERSIDE_Z:.2f} "
                f"inside the keep-clear radius {KEEP_CLEAR_RADIUS:.2f}"
            )

    # --- the rim ----------------------------------------------------------
    out.extend(rim_violations(m))

    # --- ground features on the lattice -------------------------------------
    # A pond, a pool, a creek, a bar: the ground's own triangles, never a
    # polygon laid on top or a sheet the terrain cuts along a contour. The
    # measuring and the rule are `featurelattice`'s; see its module header.
    out.extend(m.get("lattice_features", []))

    return out


def orientation_ok(corner_angles):
    """True if the slab is pointy-top with a corner due north.

    `corner_angles` are the slab's corner bearings in radians, measured from
    +x. A pointy-top hex has a corner at 90 degrees; a flat-top has an edge
    there. Edge 0 being the +x edge follows from the same six corners.
    """
    north = math.pi / 2.0
    return any(abs(((a - north + math.pi) % (2 * math.pi)) - math.pi) <= 1e-3 for a in corner_angles)
