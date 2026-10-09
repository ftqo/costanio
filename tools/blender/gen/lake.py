"""Generate `art/hexes/lake.blend`: the Fishermen lake hex.

    blender --background --factory-startup --python tools/blender/gen/lake.py

The blend is an output of this script (like `gen/oasis.py` for the oasis): do
not model in it, the next run overwrites it. Change a number here and re-run,
then `make export-tiles` (or `make export-assets`) and `make check-hexes`.

## Structure

The lake is a recess cut out of the ground's own lattice, like the oasis pond:

  * `Lake_ground` is the shared 631-point lattice, sampled from `ground_z`,
    its ring 14 on `Pasture_rim`'s own inner vertices;
  * `Lake_water` is the lattice triangles whose centroid is inside the
    outline, flat at z = 0.190 and toned triangle by triangle (open water,
    shoal, shallows), so its shore is a staircase of lattice edges;
  * `Lake_bed` is the same triangles carved under it
    (`featurelattice.carve_basin`), so no ground corner can come through;
  * `Lake_bank` is the ring of lattice triangles round the water in the
    lake's mud, plus the 4 mm lip down to them; the green verge is the next
    ring out;
  * the slab's top face is cut under the water and its bank, along lattice
    vertices at the shore's height;
  * `Lake_rim` is `Pasture_rim`'s mesh, appended and rebuilt in this tile's
    frame, with the same cutbank at the slab edge.

## Materials

The lake replaces a desert on the board, but the oasis is already water in a
sand basin, so this tile is a lake in green country: the ground and rim wear
the pasture's materials (`Mat_Pasture_grass_lit`, `_grass_mid`, `_grass_dk`,
`_clover`, `_dirt`, `_mud`), appended from `art/hexes/pasture.blend` so they
cannot cause a `PALETTE_CONFLICT`. `Mat_Lake_bank` and `_bank_shade` ring the
water as darker wet meadow inside `BANK_FRINGE_S`.

The rim is appended rather than rebuilt because the pasture's middle ring
wanders in hexagonal radius (0.960, 0.968, 0.975) as well as height and carries
several materials per band, which an approximation does not reproduce.

`Hex_Lake` wears `Mat_Pasture` so the 0.47-tall slab wall matches the tile.
`Mat_Port_deck` and `Mat_Port_frame` come from `art/hexes/port.blend` for the
jetty and the boat. Every material already has a `palette.json` entry.

## Layout constraints

1. The chip socket owns the north. `Token_Lake` mounts at (0, +1.5) and
   nothing may reach above z = 0.25 within 1.05 of it
   (`hexcontract.KEEP_CLEAR_RADIUS`). So the water is pushed south and
   `NORTH_GATE` shrinks the outline's radius by up to 42% on the northern
   side. `audit()` measures the result from the built mesh.

   The ground rises to `RIM_TOP_Z` = 0.290 at the rim, above the 0.25 chip
   underside, so the ramp must not start inside the keep-clear disc. The
   furthest a point 1.05 from the socket reaches is hexagonal radius 0.9040,
   so `EDGE_RAMP` starts at 0.9100 and the ground under the chip is flat
   0.2450.

2. A still lake must not swell. `ocean.ts` displaces only `Mat_Ocean_water`
   (`ocean.test.ts` pins that), so the sheet wears `Mat_Lake_water`, the same
   colour as the oasis pond.

3. The relief is real: gaussian lobes on top of the dune field (a headland
   west of the water, a ridge east, a swell south-west). Both gates apply to
   them.
"""

import math
import os
import sys

import bpy
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

import featurelattice  # noqa: E402
import lattice  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(_HERE)))
HEXES = os.path.join(REPO, "art", "hexes")
OUT = os.path.join(HEXES, "lake.blend")

# --- the tile ---------------------------------------------------------------

TERRAIN = "Lake"
PREFIX = "Lake_"

HEX_R = lattice.HEX_SIZE  # 3.0, the art circumradius
APOTHEM = lattice.TILE_APOTHEM  # 2.598076, centre to edge midpoint
SLAB_TOP = lattice.GAP_SAND_Z  # 0.220
SLAB_BOTTOM = lattice.GAP_BOTTOM_Z  # -0.250

#: Where the tile is staged in the showcase board: cell (1, 0), shared with the
#: desert and the oasis (`render_lake.py` hides the other two).
CELL = (1, 0)

#: The ground's nominal height, under the 0.25 chip underside, so anything the
#: socket gate flattens is safe by construction.
GROUND_Z = 0.2450

#: The chip mount and its keep-clear disc.
SOCKET = (0.0, 1.5)
SOCKET_Z = 0.26
KEEP_CLEAR = 1.05
CHIP_UNDERSIDE = 0.25
#: What a prop's centre is held to: the keep-clear radius plus the widest prop's
#: reach.
PROP_CLEAR = 1.75
#: Which objects `audit()` holds to the ground: everything but the surfaces.
PROP_PREFIXES = ("Lake_tree", "Lake_grass", "Lake_rock", "Lake_jetty", "Lake_boat")

# --- the rim ----------------------------------------------------------------
#
# The rim is copied from `Pasture_rim` (`append_rim`); these numbers are what
# `audit()` checks the appended mesh against. `Pasture_rim` and `Desert_rim`
# are the same mesh: five rings from hexagonal radius 0.9519 at z 0.2900, a band
# wandering in radius (0.960/0.968/0.975) and height, across 0.980, to 0.2340
# at 0.9995, then a vertical cutbank to 0.2205 (a +0.0005 tie-break over the
# 0.2200 gutter sand).

#: Chamfer inner edge: the art apothem less half the gutter, as a fraction.
RIM_INNER_S = (APOTHEM - lattice.LATTICE_GAP / 2.0) / APOTHEM  # 0.951882
#: Where the ground hands over to the rim.
RIM_TOP_Z = 0.2900
#: The outer edge, where the cutbank lands.
RIM_OUTER_Z = 0.2205
#: Points per hexagon edge on every rim ring, and therefore on the ground's own
#: outer boundary: the two loops share their vertices, so no T-junction can
#: open a hairline between the ground and its border. Seven, as on `Pasture_rim`.
RIM_SEGS = 7

#: Where the ground starts climbing to meet the rim. Held outside the reach of
#: the chip's keep-clear disc; see constraint 1 in the header.
EDGE_RAMP = (0.9100, RIM_INNER_S)

# --- the ground -------------------------------------------------------------

#: Dune height, and the two gates that hold the relief off the socket and the
#: water. Dunes only rise (`dune()` is remapped to [0, 1]): ground below the
#: slab's 0.2200 cap would show the slab's colour through.
DUNE_AMP = 0.200
SOCKET_GATE = (1.05, 1.28)
LAKE_GATE = (1.00, 1.26)

#: Three gaussian lobes on top of the dunes, so the tile has a horizon rather
#: than a wash: (x, y, radius, amplitude). Gated exactly as the dunes are.
LOBES = (
    (-2.10, 0.62, 1.22, 0.420),  # the west knoll, the tile's high point
    (2.26, -0.55, 1.10, 0.310),  # the east rise
    (-0.95, -2.40, 1.00, 0.215),  # the south-west swell
    (1.55, 1.75, 0.95, 0.270),  # the north-east shoulder, beside the chip
    (-1.45, 1.90, 0.92, 0.240),  # and the north-west one, so the northern
    # third (held flat by the socket gate) is not one plate.
)
#: Kept close to `Pasture_ground`'s relief (0.2256..0.4780) so the tile matches
#: its neighbours; the knoll gives the basin a high side.

#: A shallow ripple where the socket gate holds the dunes off (the flat around
#: the chip), so it does not render as one bright facet. It only cuts down from
#: `GROUND_Z`, keeping the ground under the chip between 0.2330 and 0.2450,
#: clear of the 0.2500 chip underside and the 0.2200 slab top.
MICRO_AMP = 0.012


# --- the lake ---------------------------------------------------------------

#: Centre and mean radius of the cut: the hole in the ground, and the lip the
#: bank hangs from. South of the tile centre, for constraint 1 in the header.
LAKE = (0.0, -0.65)
LAKE_R = 1.50
#: How many segments the outline is drawn with, and how far it wanders off a
#: circle (a perfect circle reads as a decal). The profile below scales the
#: same outline, so the bank keeps a constant width.
LAKE_SIDES = 26
LAKE_WOBBLE = ((3, 0.075, 0.0), (5, 0.042, 1.1), (7, 0.021, 2.3), (2, 0.055, 0.6))
#: How hard the northern side is pulled back, and how sharply, so the lake can
#: stay wide and still leave a dry shore under the chip.
NORTH_GATE = (0.42, 1.6)

#: The sheet. Below the slab top (0.220), as in `gen/oasis.py`.
WATER_Z = 0.1900
#: Which lattice triangles are water: those whose centroid is inside the
#: outline scaled to this. The outline only selects triangles.
WATER_S = 0.9325

#: Where the green turf fringe gives way to damp crust, and the crust to the
#: outer ground, as multiples of the outline. They sit outside the two lattice
#: rings the bank and verge take (a lattice cell is about 0.14 of the outline).
BANK_FRINGE_S = 1.300
#: The poached ring of trodden mud round the water; kept thin, as on
#: `Pasture_pond`.
CRUST_S = 1.430
#: How far the two boundaries above wander. A clean offset curve comes out as
#: a sawtooth ring on the lattice; wandering the threshold breaks it up.
FRINGE_WANDER = 0.200

# --- materials --------------------------------------------------------------
#
# Appended, not retyped, to avoid a `PALETTE_CONFLICT` between blends.
APPEND = {
    # Nothing from the pasture: `append_rim` brings its seven materials as
    # slots, and appending one again would silently create `Mat_Pasture.001`.
    # The jetty and the boat use the harbour's timber.
    "port.blend": ("Mat_Port_deck", "Mat_Port_frame"),
}

#: The tile's own names, at the values `frontend/public/models/palette.json`
#: carries, so a rebuild is not a restyle. Every one is worn below
#: (`palette.test.ts` fails an override nothing wears).
#: What the slab wears: whatever `Hex_Pasture` wears, checked by name.
SLAB_MATERIAL = "Mat_Pasture"

MATERIALS = {
    "Mat_Lake_bank": ((0.3, 0.47, 0.18), 0.92),
    "Mat_Lake_bank_shade": ((0.15, 0.27, 0.1), 0.92),
    "Mat_Lake_verge": ((0.235, 0.4, 0.157), 0.88),
    "Mat_Lake_mud": ((0.3, 0.255, 0.17), 0.94),
    "Mat_Lake_shallows": ((0.18, 0.255, 0.235), 0.88),
    "Mat_Lake_bed": ((0.07, 0.18, 0.196), 0.9),
    "Mat_Lake_water": ((0.047, 0.286, 0.325), 0.14),
    # The one name this tile adds: a lighter shoal tone so the surface is not
    # one flat colour (as `gen/rivers.py` splits `Mat_River_water` and
    # `_water_dk`).
    "Mat_Lake_shoal": ((0.098, 0.404, 0.420), 0.14),
    # The shallows tone of the mosaic: the goldfield creek's pale water, by
    # its own name and value, which the oasis pond wears too.
    "Mat_Gold_water": ((0.353, 0.478, 0.478), 0.3),
    "Mat_Lake_reed": ((0.353, 0.545, 0.176), 0.82),
    "Mat_Lake_grass": ((0.4, 0.51, 0.22), 0.9),
    "Mat_Lake_stone": ((0.25, 0.258, 0.243), 0.95),
    "Mat_Lake_trunk": ((0.271, 0.18, 0.106), 0.88),
    "Mat_Lake_leaf": ((0.235, 0.443, 0.153), 0.8),
}


# --- scene plumbing ---------------------------------------------------------


def wipe():
    """Empty the factory scene. Never `read_factory_settings` (see art/README)."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.collections):
        for item in list(block):
            block.remove(item)


def append_materials():
    """Take the borrowed materials from the tiles that already ship them."""
    for blend, names in APPEND.items():
        path = os.path.join(HEXES, blend)
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            missing = [n for n in names if n not in src.materials]
            if missing:
                raise SystemExit(f"{blend} has no material {missing}")
            dst.materials = list(names)
        for name in names:
            if name not in bpy.data.materials:
                raise SystemExit(f"append of {name} from {blend} produced nothing")


def append_rim():
    """Append `Pasture_rim` and return it as (verts, faces, face_mats).

    The rim depends only on the hexagon (five rings between hexagonal radius
    0.9519 and 1.0). Its geometry is read back in the tile's own frame (world
    minus the pasture hex's centre) and the source object is deleted. The six
    material slots come with it, so no `.001` duplicates appear.
    """
    path = os.path.join(HEXES, "pasture.blend")
    before = set(bpy.data.objects)
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        if "Pasture_rim" not in src.objects:
            raise SystemExit("pasture.blend has no Pasture_rim")
        if "Hex_Pasture" not in src.objects:
            raise SystemExit("pasture.blend has no Hex_Pasture")
        dst.objects = ["Pasture_rim", "Hex_Pasture"]
    brought = {o.name: o for o in set(bpy.data.objects) - before}
    rim, hexp = brought.get("Pasture_rim"), brought.get("Hex_Pasture")
    if rim is None or hexp is None:
        raise SystemExit("append of Pasture_rim produced nothing")

    # `Hex_Pasture` is appended for its origin (the rim is read in world space)
    # and brings the slab colour with it.
    slab = [m.name for m in hexp.data.materials]
    if slab != [SLAB_MATERIAL]:
        raise SystemExit(f"Hex_Pasture wears {slab}, expected [{SLAB_MATERIAL!r}]")

    origin = hexp.matrix_world.translation
    mats = [m.name for m in rim.data.materials]
    verts = [tuple(rim.matrix_world @ v.co - origin) for v in rim.data.vertices]
    faces = [tuple(p.vertices) for p in rim.data.polygons]
    face_mats = [mats[p.material_index] for p in rim.data.polygons]
    smooth = [p.index for p in rim.data.polygons if p.use_smooth]
    meshes = [rim.data, hexp.data]
    for obj in (rim, hexp):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in meshes:
        # The materials survive (used just below); the pasture's meshes do not.
        bpy.data.meshes.remove(mesh)
    if smooth:
        raise SystemExit(f"Pasture_rim ships smooth-shaded polygons {smooth}")
    return verts, faces, face_mats


def make_materials():
    for name, (color, roughness) in MATERIALS.items():
        if name in bpy.data.materials:
            raise SystemExit(f"{name} was appended as well as authored here")
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = 0.0
        mat.diffuse_color = (*color, 1.0)


def add(name, verts, faces, face_mats, collection, parent=None, location=(0, 0, 0)):
    """One flat-shaded object, its material slots in first-seen order."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    mesh.validate(verbose=False)
    slots = []
    for mat in face_mats:
        if mat not in slots:
            slots.append(mat)
    for mat in slots:
        mesh.materials.append(bpy.data.materials[mat])
    index = {m: i for i, m in enumerate(slots)}
    for poly, mat in zip(mesh.polygons, face_mats):
        poly.material_index = index[mat]
        poly.use_smooth = False
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    collection.objects.link(obj)
    if parent is not None:
        # No `matrix_parent_inverse`: children are authored in the tile's own
        # frame, so the numbers here are "from the tile centre".
        obj.parent = parent
    return obj


def orient(face, verts, up=(0.0, 0.0, 1.0)):
    """Wind `face` so its normal points along `up`."""
    a, b, c = (Vector(verts[i]) for i in face[:3])
    if (b - a).cross(c - a).dot(Vector(up)) < 0:
        return tuple(reversed(face))
    return tuple(face)


# --- the hexagon ------------------------------------------------------------


def hex_corner(k, radius=HEX_R):
    """Corner k of a pointy-top hexagon: corner 0 is due north."""
    a = math.pi / 2.0 + math.pi / 3.0 * k
    return (radius * math.cos(a), radius * math.sin(a))


def hex_ring(s, per_edge):
    """`6 * per_edge` points around the hexagon at fractional radius `s`."""
    out = []
    for k in range(6):
        a = hex_corner(k, HEX_R * s)
        b = hex_corner(k + 1, HEX_R * s)
        for j in range(per_edge):
            t = j / per_edge
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def hex_s(x, y):
    """Hexagonal radius: 1.0 exactly on the tile's own boundary."""
    return max(
        (x * math.cos(math.pi / 3.0 * k) + y * math.sin(math.pi / 3.0 * k)) / APOTHEM
        for k in range(6)
    )


def smoothstep(x, lo, hi):
    if hi <= lo:
        return 1.0 if x >= hi else 0.0
    t = min(1.0, max(0.0, (x - lo) / (hi - lo)))
    return t * t * (3.0 - 2.0 * t)


# --- the lake outline -------------------------------------------------------


def lake_radius(angle):
    """The cut's radius at `angle`: wobbled off a circle, gated to the north."""
    r = LAKE_R
    for freq, amp, phase in LAKE_WOBBLE:
        r += LAKE_R * amp * math.sin(freq * angle + phase)
    amount, power = NORTH_GATE
    north = max(0.0, math.sin(angle))
    return r * (1.0 - amount * north**power)


def lake_outline(s=1.0):
    """`LAKE_SIDES` points around the outline, scaled by `s` about the centre."""
    out = []
    for i in range(LAKE_SIDES):
        a = 2.0 * math.pi * i / LAKE_SIDES
        r = lake_radius(a) * s
        out.append((LAKE[0] + r * math.cos(a), LAKE[1] + r * math.sin(a)))
    return out


def lake_s(x, y):
    """Where (x, y) sits on the lake's radial profile. 1.0 is the cut line."""
    dx, dy = x - LAKE[0], y - LAKE[1]
    d = math.hypot(dx, dy)
    if d < 1e-9:
        return 0.0
    return d / lake_radius(math.atan2(dy, dx))


# --- the ground surface -----------------------------------------------------


def dune(x, y):
    """Deterministic smooth relief, roughly in [-1, 1].

    Three sines with incommensurable frequencies rather than a noise texture,
    so the tile is identical across runs and Blender versions.
    """
    return (
        0.55 * math.sin(0.88 * x - 0.6) * math.cos(0.79 * y + 1.9)
        + 0.30 * math.sin(1.57 * y - 2.2) * math.cos(1.41 * x + 0.5)
        + 0.15 * math.sin(1.87 * (0.7 * x - 0.7 * y) + 2.4)
    )


def relief(x, y):
    """Dunes plus the three lobes, before the gates. Never negative."""
    z = DUNE_AMP * 0.5 * (dune(x, y) + 1.0)
    for lx, ly, radius, amp in LOBES:
        d = math.dist((x, y), (lx, ly)) / radius
        z += amp * math.exp(-2.3 * d * d)
    return z


def ground_z(x, y):
    """The surface. Level under the chip, level around the water, up at the rim."""
    water_gate = smoothstep(lake_s(x, y), *LAKE_GATE)
    gate = smoothstep(math.dist((x, y), SOCKET), *SOCKET_GATE) * water_gate
    micro = -MICRO_AMP * 0.5 * (1.0 + dune(x * 2.9 + 5.0, y * 2.9 - 1.0)) * water_gate
    z = GROUND_Z + relief(x, y) * gate + micro
    ramp = smoothstep(hex_s(x, y), *EDGE_RAMP)
    return z * (1.0 - ramp) + RIM_TOP_Z * ramp


def ground_material(x, y, z):
    """Which surface a face wears, from where it is and how high it stands.

    The noise runs at about one cycle per two triangles, so adjacent facets
    differ (as on `Pasture_ground`) rather than each rise being one wash.
    """
    s = lake_s(x, y)
    grain = dune(x * 1.7 - 3.0, y * 1.7 + 2.0)
    wander = FRINGE_WANDER * dune(x * 2.3 + 1.0, y * 2.3 - 4.0)
    if s < BANK_FRINGE_S + wander:
        # Wet meadow: `Mat_Lake_bank_shade` at the waterline and `Mat_Lake_bank`
        # behind it, darker than any pasture grass.
        if grain < 0.10 or s > BANK_FRINGE_S - 0.06:
            return "Mat_Lake_bank_shade"
        return "Mat_Lake_bank"
    if s < CRUST_S + wander:
        # Poached ground: the trodden, muddy ring between wet meadow and clean
        # pasture.
        return "Mat_Pasture_mud" if grain < 0.35 else "Mat_Pasture_dirt"
    if grain < -0.55:
        return "Mat_Pasture_dirt"
    if grain < -0.25:
        return "Mat_Pasture_grass_dk"
    if z > GROUND_Z + 0.240 and grain > 0.45:
        # The tops of the rises, where the sun and the sheep both get at it.
        return "Mat_Pasture_clover"
    if z < GROUND_Z + 0.100 or grain < 0.35:
        return "Mat_Pasture_grass_mid"
    return "Mat_Pasture_grass_lit"


# --- the lattice cut ------------------------------------------------------
#
# The ground is the shared lattice every land tile is drawn on (631 points,
# 3/14 apart, ring 14 on the rim's inner edge and on `Pasture_rim`'s own
# vertices), sampled from `ground_z`, and the lake is a set of that lattice's
# own triangles: the ones whose centroid is inside the outline at `WATER_S`.
# `featurelattice.carve_basin` lowers them under the sheet (the edge 4 mm, the
# inside into a bowl), so the visible shore is the sheet's own boundary, a
# staircase of lattice edges.

_CUT = {}


def lake_cut(rim_geometry):
    """The lattice ground, carved, and everything the builders need from it."""
    if _CUT:
        return _CUT
    verts, tris, keys = featurelattice.lattice_ground(ground_z)
    ring = [featurelattice.lattice_ring(k) for k in keys]
    # Ring 14 is the rim's inner ring: take its coordinates from the appended
    # mesh so the two share vertices exactly.
    inner = [(x, y) for x, y, z in rim_geometry[0] if abs(z - RIM_TOP_Z) < 1e-6]
    for i, v in enumerate(verts):
        if ring[i] == 14:
            near = min(inner, key=lambda p: (p[0] - v[0]) ** 2 + (p[1] - v[1]) ** 2)
            if math.dist(near, v[:2]) < 2e-3:
                v[0], v[1] = near
            v[2] = RIM_TOP_Z

    def allowed(n):
        return all(ring[v] < 13 for v in tris[n]) and all(
            math.dist(verts[v][:2], SOCKET) > KEEP_CLEAR + 0.05 for v in tris[n]
        )

    ok = {n for n in range(len(tris)) if allowed(n)}
    region = featurelattice.region_from_polygons(verts, tris, lambda x, y: lake_s(x, y) < WATER_S)
    region = featurelattice.tidy_region(tris, region & ok, allowed=ok)
    cut = featurelattice.carve_basin(
        verts, tris, region, level=WATER_Z, lip=0.004, bowl=(0.022, 0.040, 0.060)
    )
    bank = featurelattice.bank_triangles(tris, region, cut["edge"])
    shore = featurelattice.shore_ring(tris, region, cut["edge"])
    # The bank's top is the old verge shelf: level with the apron, under the
    # chip's 0.25 underside, wherever the relief round it has started to rise.
    for v in shore:
        verts[v][2] = min(verts[v][2], GROUND_Z)
    verge = featurelattice.bank_triangles(tris, region | bank, shore)
    _CUT.update(
        verts=verts, tris=tris, region=region, bank=bank, verge=verge, cut=cut,
        hole=featurelattice.region_outline(verts, tris, region | bank),
    )
    return _CUT


def stand_z(x, y):
    """What a prop stands on: the carved lattice where there is one."""
    if _CUT:
        z = featurelattice.height_at(_CUT["verts"], _CUT["tris"], x, y)
        if z is not None:
            return z
    return ground_z(x, y)


# --- the slab ---------------------------------------------------------------


def build_slab(collection, location):
    """`Hex_Lake`: the terrain slab, its top face cut under the lake.

    The slab's top is opaque at 0.220 and the water sits at 0.190, so the top
    is cut under the water and its bank ring, on lattice vertices at the
    shore's 0.245. What `hexcontract` measures is unchanged: corners at radius
    3.0 and z 0.220, underside one hexagon at -0.250.
    """
    verts, faces, face_mats = [], [], []
    c = _CUT

    top = [hex_corner(k) for k in range(6)]
    hole = [tuple(c["verts"][v][:2]) for v in c["hole"]]
    inside = [[c["verts"][v] for v in c["tris"][n]] for n in set(c["region"]) | set(c["bank"])]

    pts = [Vector(p) for p in top] + [Vector(p) for p in hole]
    edges = [(i, (i + 1) % 6) for i in range(6)]
    edges += [(6 + i, 6 + (i + 1) % len(hole)) for i in range(len(hole))]
    out_verts, _, out_faces, _, _, _ = delaunay_2d_cdt(pts, edges, [], 0, 1e-5)

    index = {}
    for tri in out_faces:
        cx = sum(out_verts[i].x for i in tri) / len(tri)
        cy = sum(out_verts[i].y for i in tri) / len(tri)
        if featurelattice.height_at([list(p) for t in inside for p in t],
                                    [(3 * k, 3 * k + 1, 3 * k + 2) for k in range(len(inside))],
                                    cx, cy) is not None:
            continue
        face = []
        for i in tri:
            if i not in index:
                index[i] = len(verts)
                verts.append((out_verts[i].x, out_verts[i].y, SLAB_TOP))
            face.append(index[i])
        faces.append(orient(tuple(face), verts))
        face_mats.append(SLAB_MATERIAL)

    # The underside and the six walls, exactly as they were.
    base = len(verts)
    for x, y in top:
        verts.append((x, y, SLAB_BOTTOM))
    faces.append(tuple(range(base + 5, base - 1, -1)))
    face_mats.append(SLAB_MATERIAL)

    rim = {}
    for k, (x, y) in enumerate(top):
        rim[k] = len(verts)
        verts.append((x, y, SLAB_TOP))
    for k in range(6):
        a, b = rim[k], rim[(k + 1) % 6]
        cc, d = base + (k + 1) % 6, base + k
        # Wound outward from this edge's own midpoint. Materials are
        # double-sided, but stored normals should still point out.
        mx = (verts[a][0] + verts[b][0]) / 2.0
        my = (verts[a][1] + verts[b][1]) / 2.0
        faces.append(orient((a, b, cc, d), verts, (mx, my, 0.0)))
        face_mats.append(SLAB_MATERIAL)

    return add(f"Hex_{TERRAIN}", verts, faces, face_mats, collection, location=location)


# --- the ground -------------------------------------------------------------


def _lattice_object(name, which, mat_of, collection, parent, own_verts=False):
    c = _CUT
    V = c["verts"]
    verts, faces, face_mats = [], [], []
    index = {}
    for n in which:
        tri = c["tris"][n]
        face = []
        for i in tri:
            if own_verts or i not in index:
                index[i] = len(verts)
                verts.append(tuple(V[i]))
            face.append(index[i])
        faces.append(orient(tuple(face), verts))
        face_mats.append(mat_of(n, tri))
    return verts, faces, face_mats


def build_ground(collection, parent, geometry):
    """`Lake_ground`: the lattice shore, stopped at the rim.

    Every lattice triangle that is neither the bed (`Lake_bed`) nor the bank
    ring (`Lake_bank`). Ring 14 is the rim's own inner ring, vertex for vertex,
    so no hairline opens at 0.290.
    """
    c = _CUT
    V = c["verts"]
    keep = [n for n in range(len(c["tris"])) if n not in c["region"] and n not in c["bank"]]

    def mat(n, tri):
        if n in c["verge"]:
            return "Mat_Lake_verge"
        cx = sum(V[i][0] for i in tri) / 3.0
        cy = sum(V[i][1] for i in tri) / 3.0
        z = sum(V[i][2] for i in tri) / 3.0
        return ground_material(cx, cy, z)

    verts, faces, face_mats = _lattice_object("", keep, mat, collection, parent)
    return add(f"{PREFIX}ground", verts, faces, face_mats, collection, parent)


# --- the rim ----------------------------------------------------------------


def build_rim(collection, parent, geometry):
    """`Lake_rim`: the pasture's rim.

    Four bands between five rings: the inner band is `Mat_Pasture_grass_dk`,
    the second mixes clover, dirt and grass_mid, the third grass_lit and
    grass_mid, and the 1.35cm vertical cutbank is dirt and mud (nearly edge-on
    to the camera, so the lip reads as a green line).

    `geometry` is `Pasture_rim` read back vertex for vertex; this only names
    it and parents it to the slab.
    """
    verts, faces, face_mats = geometry
    return add(f"{PREFIX}rim", verts, faces, face_mats, collection, parent)


# --- the recess -------------------------------------------------------------


def build_bank(collection, parent):
    """`Lake_bank`: the ring of lattice triangles round the water, and its lip.

    The ground's own triangles with a corner on the water's edge, falling
    from the shore to just under the waterline in the lake's mud (the green
    verge is the ring outside it, in `Lake_ground`), plus the 4 mm vertical lip
    from the sheet's edge down to them, in the wet margin's colour.
    """
    c = _CUT
    verts, faces, face_mats = _lattice_object(
        "", sorted(c["bank"]), lambda n, t: "Mat_Lake_mud", collection, parent, own_verts=True
    )
    _pos, _faces, _tones, lips = featurelattice.water_sheet(
        c["verts"], c["tris"], c["region"], WATER_Z, c["cut"]["depth"], 4.0
    )
    for quad in lips:
        base = len(verts)
        verts.extend(quad)
        faces.append((base, base + 1, base + 2, base + 3))
        face_mats.append("Mat_Lake_shallows")
    return add(f"{PREFIX}bank", verts, faces, face_mats, collection, parent)


def build_bed(collection, parent):
    """`Lake_bed`: the lattice triangles under the water, carved into a bowl.

    Opaque water in this style means none of it is seen; it is modelled so the
    recess is real (and so a translucent palette would have a bed to show).
    """
    c = _CUT
    verts, faces, face_mats = _lattice_object(
        "", sorted(c["region"]),
        lambda n, t: "Mat_Lake_bed" if all(c["cut"]["depth"].get(v, 0) > 0 for v in t) else "Mat_Lake_shallows",
        collection, parent,
    )
    return add(f"{PREFIX}bed", verts, faces, face_mats, collection, parent)


def build_water(collection, parent):
    """`Lake_water`: the lattice triangles of the lake, flat at WATER_Z.

    Every vertex at one height (`audit()` refuses to save otherwise). Colour
    varies triangle by triangle: open water, shoal, and pale shallows against
    the bank. It does not wear `Mat_Ocean_water`, which `ocean.ts` displaces.
    """
    c = _CUT
    pos, tri_faces, tones, _lips = featurelattice.water_sheet(
        c["verts"], c["tris"], c["region"], WATER_Z, c["cut"]["depth"], 4.0
    )
    names = ("Mat_Lake_water", "Mat_Lake_shoal", "Mat_Gold_water")
    faces = [orient(f, pos) for f in tri_faces]
    return add(f"{PREFIX}water", pos, faces, [names[t] for t in tones], collection, parent)


# --- props ------------------------------------------------------------------


def build_tree(name, x, y, trunk_h, crown_h, radius, turn, collection, parent):
    """A six-sided trunk under two stacked crown drums: 25 faces.

    A broadleaf read from its outline.
    """
    base = stand_z(x, y)
    verts, faces, face_mats = [], [], []

    low, high = [], []
    for k in range(6):
        a = turn + 2.0 * math.pi * k / 6.0
        low.append(len(verts))
        verts.append((x + 0.085 * math.cos(a), y + 0.085 * math.sin(a), base - 0.01))
        high.append(len(verts))
        verts.append(
            (x + 0.062 * math.cos(a), y + 0.062 * math.sin(a), base + trunk_h)
        )
    for k in range(6):
        j = (k + 1) % 6
        mx = (verts[low[k]][0] + verts[low[j]][0]) / 2.0 - x
        my = (verts[low[k]][1] + verts[low[j]][1]) / 2.0 - y
        faces.append(orient((low[k], low[j], high[j], high[k]), verts, (mx, my, 0.2)))
        face_mats.append("Mat_Lake_trunk")

    # Two drums: a wide skirt and a narrower cap, offset a little.
    prev = None
    for level, (rad, lift) in enumerate(((1.0, 0.0), (0.72, 0.58), (0.30, 1.0))):
        ring = []
        for k in range(6):
            a = turn + 2.0 * math.pi * k / 6.0 + 0.22 * level
            ring.append(len(verts))
            verts.append(
                (
                    x + radius * rad * math.cos(a),
                    y + radius * rad * math.sin(a),
                    base + trunk_h + crown_h * lift,
                )
            )
        if prev is not None:
            for k in range(6):
                j = (k + 1) % 6
                mx = (verts[prev[k]][0] + verts[prev[j]][0]) / 2.0 - x
                my = (verts[prev[k]][1] + verts[prev[j]][1]) / 2.0 - y
                faces.append(
                    orient((prev[k], prev[j], ring[j], ring[k]), verts, (mx, my, 0.35))
                )
                face_mats.append("Mat_Lake_leaf")
        prev = ring
    faces.append(orient(tuple(prev), verts))
    face_mats.append("Mat_Lake_leaf")
    # The skirt's underside, so the crown is not hollow when seen from a low
    # bearing across the water.
    faces.append(tuple(reversed(range(12, 18))))
    face_mats.append("Mat_Lake_leaf")
    return add(name, verts, faces, face_mats, collection, parent)


def build_grass(name, x, y, spread, height, turn, collection, parent):
    """Nine thin blades: 27 verts, 9 faces.

    Blades rather than closed tufts, which read as pyramids at board distance.
    """
    base = stand_z(x, y)
    verts, faces, face_mats = [], [], []
    for k in range(9):
        a = turn + 2.399963 * k
        r = spread * (0.10 + 0.42 * ((k * 4) % 9) / 8.0)
        cx, cy = x + r * math.cos(a), y + r * math.sin(a)
        h = height * (0.55 + 0.45 * ((k * 5) % 9) / 8.0)
        lean = 0.30 * height * math.sin(1.9 * k + turn)
        i0 = len(verts)
        verts.append((cx - 0.030 * math.sin(a), cy + 0.030 * math.cos(a), base))
        verts.append((cx + 0.030 * math.sin(a), cy - 0.030 * math.cos(a), base))
        verts.append((cx + lean * math.cos(a), cy + lean * math.sin(a), base + h))
        faces.append((i0, i0 + 1, i0 + 2))
        face_mats.append("Mat_Lake_grass")
    return add(name, verts, faces, face_mats, collection, parent)


def build_reeds(name, x, y, z, height, turn, collection, parent):
    """Seven blades out of the shallows: 21 verts, 7 faces."""
    verts, faces, face_mats = [], [], []
    for k in range(7):
        a = turn + 2.399963 * k
        r = 0.030 + 0.058 * ((k * 3) % 7) / 6.0
        cx, cy = x + r * math.cos(a), y + r * math.sin(a)
        h = height * (0.62 + 0.38 * ((k * 5) % 7) / 6.0)
        lean = 0.060 * math.sin(1.7 * k)
        i0 = len(verts)
        verts.append((cx - 0.020 * math.sin(a), cy + 0.020 * math.cos(a), z))
        verts.append((cx + 0.020 * math.sin(a), cy - 0.020 * math.cos(a), z))
        verts.append((cx + lean * math.cos(a), cy + lean * math.sin(a), z + h))
        faces.append((i0, i0 + 1, i0 + 2))
        face_mats.append("Mat_Lake_reed")
    return add(name, verts, faces, face_mats, collection, parent)


def build_rock(name, x, y, radius, height, turn, collection, parent, base=None):
    """A blunt boulder: 12 verts, 7 faces.

    `base` overrides the ground for the two that stand in the lake, whose feet
    are on the bed rather than on the shore.
    """
    base = stand_z(x, y) if base is None else base
    verts, faces, face_mats = [], [], []
    low, high = [], []
    for k in range(6):
        a = turn + 2.0 * math.pi * k / 6.0
        rl = radius * (0.86 + 0.24 * ((k * 5) % 6) / 5.0)
        rh = radius * (0.42 + 0.20 * ((k * 3) % 6) / 5.0)
        low.append(len(verts))
        verts.append((x + rl * math.cos(a), y + rl * math.sin(a), base - 0.014))
        high.append(len(verts))
        verts.append(
            (
                x + rh * math.cos(a + 0.28),
                y + rh * math.sin(a + 0.28),
                base + height * (0.80 + 0.20 * ((k * 2) % 6) / 5.0),
            )
        )
    for k in range(6):
        j = (k + 1) % 6
        # Outward from this face's own midpoint (one shared reference vector
        # would flip the opposite three).
        mx = (verts[low[k]][0] + verts[low[j]][0]) / 2.0 - x
        my = (verts[low[k]][1] + verts[low[j]][1]) / 2.0 - y
        faces.append(orient((low[k], low[j], high[j], high[k]), verts, (mx, my, 0.35)))
        face_mats.append("Mat_Lake_stone")
    faces.append(orient(tuple(high), verts))
    face_mats.append("Mat_Lake_stone")
    return add(name, verts, faces, face_mats, collection, parent)


def _box(verts, faces, face_mats, centre, half, mat, turn=0.0):
    """An axis-box, rotated about z by `turn`. Six quads, wound outward."""
    cx, cy, cz = centre
    hx, hy, hz = half
    c, s = math.cos(turn), math.sin(turn)
    i0 = len(verts)
    for sz in (-1, 1):
        for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            x, y = dx * hx, dy * hy
            verts.append((cx + x * c - y * s, cy + x * s + y * c, cz + sz * hz))
    quads = (
        (0, 1, 2, 3),  # bottom
        (4, 5, 6, 7),  # top
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (2, 3, 7, 6),
        (3, 0, 4, 7),
    )
    for q in quads:
        face = tuple(i0 + i for i in q)
        cxx = sum(verts[i][0] for i in face) / 4.0 - cx
        cyy = sum(verts[i][1] for i in face) / 4.0 - cy
        czz = sum(verts[i][2] for i in face) / 4.0 - cz
        faces.append(orient(face, verts, (cxx, cyy, czz)))
        face_mats.append(mat)


def build_jetty(name, collection, parent):
    """`Lake_jetty`: five planks on six piles, walking out over the water.

    Timber is `Mat_Port_deck` and `Mat_Port_frame`, appended from the harbour.
    Laid along a bearing out of the shore: the inboard end sits on the bank
    lip and the outboard end over open water.
    """
    verts, faces, face_mats = [], [], []
    a = JETTY_BEARING
    shore = (
        LAKE[0] + lake_radius(a) * JETTY_SHORE_S * math.cos(a),
        LAKE[1] + lake_radius(a) * JETTY_SHORE_S * math.sin(a),
    )
    # Inward along the same bearing: the deck runs from the bank toward the
    # middle of the lake.
    dx, dy = -math.cos(a), -math.sin(a)
    turn = math.atan2(dy, dx)

    for k in range(JETTY_PLANKS):
        t = (k + 0.5) / JETTY_PLANKS
        cx = shore[0] + dx * JETTY_LEN * t
        cy = shore[1] + dy * JETTY_LEN * t
        _box(
            verts,
            faces,
            face_mats,
            (cx, cy, JETTY_DECK_Z),
            (JETTY_LEN / JETTY_PLANKS * 0.44, JETTY_W / 2.0, 0.018),
            "Mat_Port_deck",
            turn,
        )

    for k in range(3):
        t = (k + 0.4) / 3.0
        px = shore[0] + dx * JETTY_LEN * t
        py = shore[1] + dy * JETTY_LEN * t
        for side in (-1, 1):
            ox = px - side * math.sin(turn) * (JETTY_W / 2.0 - 0.035)
            oy = py + side * math.cos(turn) * (JETTY_W / 2.0 - 0.035)
            top = JETTY_DECK_Z - 0.018
            foot = 0.110
            _box(
                verts,
                faces,
                face_mats,
                (ox, oy, (top + foot) / 2.0),
                (0.030, 0.030, (top - foot) / 2.0),
                "Mat_Port_frame",
                turn,
            )

    # Two mooring posts standing proud of the outboard end.
    for side in (-1, 1):
        px = shore[0] + dx * JETTY_LEN * 0.94
        py = shore[1] + dy * JETTY_LEN * 0.94
        ox = px - side * math.sin(turn) * (JETTY_W / 2.0 + 0.02)
        oy = py + side * math.cos(turn) * (JETTY_W / 2.0 + 0.02)
        _box(
            verts,
            faces,
            face_mats,
            (ox, oy, (0.128 + JETTY_DECK_Z + 0.16) / 2.0),
            (0.036, 0.036, (JETTY_DECK_Z + 0.16 - 0.128) / 2.0),
            "Mat_Port_frame",
            turn,
        )
    return add(name, verts, faces, face_mats, collection, parent)


def build_boat(name, x, y, turn, collection, parent):
    """`Lake_boat`: an open rowing boat, moored. 33 faces.

    A hull with a real sheer line: eight gunwale points, the same eight pulled
    in and dropped for the floor, and two thwarts across it. The gunwale is
    above the water and the floor below it, so the boat sits in the lake.
    """
    verts, faces, face_mats = [], [], []
    half_l, half_w = 0.40, 0.165
    c, s = math.cos(turn), math.sin(turn)

    def at(u, v, z):
        return (x + (u * c - v * s), y + (u * s + v * c), z)

    # Eight points around the sheer: pointed at bow and stern, widest amidships.
    plan = (
        (1.00, 0.00),
        (0.62, 0.62),
        (0.05, 1.00),
        (-0.58, 0.72),
        (-1.00, 0.00),
        (-0.58, -0.72),
        (0.05, -1.00),
        (0.62, -0.62),
    )
    gun, keel, floor = [], [], []
    for pu, pv in plan:
        rise = 0.030 * abs(pu) ** 2
        gun.append(len(verts))
        verts.append(at(pu * half_l, pv * half_w, BOAT_GUNWALE_Z + rise))
        keel.append(len(verts))
        verts.append(at(pu * half_l * 0.62, pv * half_w * 0.55, BOAT_KEEL_Z))
        floor.append(len(verts))
        verts.append(at(pu * half_l * 0.62, pv * half_w * 0.55, BOAT_FLOOR_Z))
    for i in range(8):
        j = (i + 1) % 8
        mx = (verts[gun[i]][0] + verts[gun[j]][0]) / 2.0 - x
        my = (verts[gun[i]][1] + verts[gun[j]][1]) / 2.0 - y
        faces.append(orient((gun[i], gun[j], keel[j], keel[i]), verts, (mx, my, 0.0)))
        face_mats.append("Mat_Port_frame")
    faces.append(orient(tuple(keel), verts, (0.0, 0.0, -1.0)))
    face_mats.append("Mat_Port_frame")
    faces.append(orient(tuple(floor), verts))
    face_mats.append("Mat_Port_deck")

    for u in (0.34, -0.34):
        _box(
            verts,
            faces,
            face_mats,
            at(u * half_l * 2.0, 0.0, BOAT_GUNWALE_Z - 0.012),
            (0.030, half_w * 0.80, 0.014),
            "Mat_Port_deck",
            turn,
        )
    return add(name, verts, faces, face_mats, collection, parent)


# --- placement --------------------------------------------------------------
#
# Every position is measured against three things and `audit()` re-checks all
# of them: inside the hexagon with the prop's own reach to spare, `PROP_CLEAR`
# from the chip socket, and outside the lake's lip.

#: The jetty: which bearing off the lake centre it leaves the shore on, where
#: on the profile its inboard end sits, and how far out it walks.
JETTY_BEARING = -0.30
JETTY_SHORE_S = 1.03
JETTY_LEN = 1.00
JETTY_W = 0.30
JETTY_PLANKS = 5
#: Deck height: 3.8cm above the ground lip, 9.3cm above the water.
JETTY_DECK_Z = 0.2830

#: The moored boat, in three heights. The hull's outer skin crosses the
#: waterline; its inside floor is above it, or the opaque water would show
#: through the gunwale.
BOAT_GUNWALE_Z = 0.2440
BOAT_KEEL_Z = 0.1700
BOAT_FLOOR_Z = 0.2020

TREES = (
    # name, x, y, trunk height, crown height, crown radius, turn
    ("Lake_tree_01", -1.86, 0.95, 0.44, 0.70, 0.40, 0.4),
    ("Lake_tree_02", 1.90, 1.02, 0.38, 0.60, 0.35, 2.1),
    ("Lake_tree_03", -1.95, -0.58, 0.34, 0.54, 0.32, 3.7),
)

GRASS = (
    ("Lake_grass_01", -1.52, 0.30, 0.40, 0.40, 0.4),
    ("Lake_grass_02", 1.56, 0.34, 0.36, 0.34, 1.9),
    ("Lake_grass_03", -1.95, -1.15, 0.32, 0.31, 3.1),
    ("Lake_grass_04", 2.00, -0.45, 0.34, 0.30, 5.0),
    ("Lake_grass_05", -1.85, 1.35, 0.33, 0.29, 2.4),
)

#: Reeds stand in the water: each is placed on the lake's own outline at
#: `REED_S`, and their feet are set under the sheet so no blade ends in mid
#: air. `audit()` fails if that stops being true.
REED_S = 0.905
REED_Z = 0.1830
REEDS = (
    # name, bearing off the lake centre, height, turn
    ("Lake_reeds_01", 1.05, 0.50, 3.0),
    ("Lake_reeds_02", 1.95, 0.46, 1.1),
    ("Lake_reeds_03", 2.62, 0.53, 2.2),
    ("Lake_reeds_04", 3.55, 0.44, 0.5),
    ("Lake_reeds_05", 4.35, 0.49, 4.4),
    ("Lake_reeds_06", 5.30, 0.45, 1.6),
)

ROCKS = (
    ("Lake_rock_01", -2.10, 0.30, 0.28, 0.20, 0.3),
    ("Lake_rock_02", -1.80, 1.30, 0.26, 0.17, 1.4),
    ("Lake_rock_03", 2.00, -1.05, 0.28, 0.21, 2.6),
    ("Lake_rock_04", 2.05, 0.52, 0.22, 0.14, 5.2),
)

#: Two boulders standing in the lake: the south shore (water to hexagonal radius
#: 0.81, rim from 0.9519) is too narrow, and a boulder breaking the surface
#: shows the water has depth.
#: (name, bearing, profile fraction, radius, height, turn)
BOULDERS = (
    ("Lake_rock_05", 3.95, 0.860, 0.22, 0.215, 3.8),
    ("Lake_rock_06", 5.60, 0.830, 0.17, 0.170, 5.2),
)


def build():
    wipe()
    append_materials()
    make_materials()

    collection = bpy.data.collections.new(f"Tile_{TERRAIN}")
    bpy.context.scene.collection.children.link(collection)

    rim = append_rim()
    lake_cut(rim)

    hx, hy = lattice.axial_to_xy(*CELL)
    hexobj = build_slab(collection, (hx, hy, 0.0))

    token = bpy.data.objects.new(f"Token_{TERRAIN}", None)
    token.empty_display_type = "CIRCLE"
    token.empty_display_size = 1.0
    token.location = (SOCKET[0], SOCKET[1], SOCKET_Z)
    collection.objects.link(token)
    token.parent = hexobj

    build_ground(collection, hexobj, rim)
    build_rim(collection, hexobj, rim)
    build_bank(collection, hexobj)
    build_bed(collection, hexobj)
    build_water(collection, hexobj)

    for name, x, y, th, ch, radius, turn in TREES:
        build_tree(name, x, y, th, ch, radius, turn, collection, hexobj)
    for name, x, y, spread, h, turn in GRASS:
        build_grass(name, x, y, spread, h, turn, collection, hexobj)
    shore = sorted(_CUT["cut"]["edge"])
    for name, angle, height, turn in REEDS:
        # On the water's own edge: the lattice vertex of the shore nearest
        # where the reed stood on the old outline, just under the sheet.
        r = lake_radius(angle) * REED_S
        want = (LAKE[0] + r * math.cos(angle), LAKE[1] + r * math.sin(angle))
        v = min(shore, key=lambda i: math.dist(_CUT["verts"][i][:2], want))
        x, y, _z = _CUT["verts"][v]
        build_reeds(name, x, y, REED_Z, height, turn, collection, hexobj)
    for name, x, y, radius, h, turn in ROCKS:
        build_rock(name, x, y, radius, h, turn, collection, hexobj)
    for name, angle, s, radius, h, turn in BOULDERS:
        r = lake_radius(angle) * s
        build_rock(
            name,
            LAKE[0] + r * math.cos(angle),
            LAKE[1] + r * math.sin(angle),
            radius,
            h,
            turn,
            collection,
            hexobj,
            base=stand_z(
                LAKE[0] + r * math.cos(angle), LAKE[1] + r * math.sin(angle)
            ),
        )

    build_jetty("Lake_jetty", collection, hexobj)
    a = JETTY_BEARING
    bx = LAKE[0] + lake_radius(a) * (JETTY_SHORE_S - 0.30) * math.cos(a)
    by = LAKE[1] + lake_radius(a) * (JETTY_SHORE_S - 0.30) * math.sin(a)
    off = a + math.pi / 2.0
    build_boat(
        "Lake_boat",
        bx + 0.34 * math.cos(off),
        by + 0.34 * math.sin(off),
        a + math.pi / 2.0,
        collection,
        hexobj,
    )

    return hexobj


# --- the audit --------------------------------------------------------------


def audit(hexobj):
    """Re-measure the contract from the built mesh, not from the constants.

    `make check-hexes` does the same from outside; this fails a bad edit while
    the generator is still running.
    """
    centre = hexobj.matrix_world.translation
    faces = 0
    reach, reach_obj = 0.0, None
    tallest, tallest_obj = -9.9, None
    intrusion = None
    smooth = []
    water_z, water_reach, water_to_socket = set(), 0.0, 9.9

    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        faces += len(obj.data.polygons)
        if any(p.use_smooth for p in obj.data.polygons):
            smooth.append(obj.name)
        for v in obj.data.vertices:
            w = obj.matrix_world @ v.co
            dx, dy, z = w.x - centre.x, w.y - centre.y, w.z
            d = math.hypot(dx, dy)
            if d > reach:
                reach, reach_obj = d, obj.name
            if obj is not hexobj and z > tallest:
                tallest, tallest_obj = z, obj.name
            r = math.hypot(dx - SOCKET[0], dy - SOCKET[1])
            if r <= KEEP_CLEAR and z > CHIP_UNDERSIDE:
                intrusion = (obj.name, round(z, 4), round(r, 4))
            if obj.name == f"{PREFIX}water":
                water_z.add(round(z, 6))
                water_reach = max(water_reach, math.hypot(dx - LAKE[0], dy - LAKE[1]))
                water_to_socket = min(water_to_socket, r)

    slab = hexobj.data
    slab_top = max((hexobj.matrix_world @ v.co).z for v in slab.vertices)
    slab_bottom = min((hexobj.matrix_world @ v.co).z for v in slab.vertices)
    slab_r = max(
        math.hypot(
            (hexobj.matrix_world @ v.co).x - centre.x,
            (hexobj.matrix_world @ v.co).y - centre.y,
        )
        for v in slab.vertices
    )

    print(
        f"AUDIT faces={faces} reach={reach:.4f} ({reach_obj}) "
        f"tallest={tallest:.4f} ({tallest_obj})"
    )
    print(
        f"AUDIT slab circumR={slab_r:.4f} top={slab_top:.4f} bottom={slab_bottom:.4f} "
        f"verts={len(slab.vertices)} faces={len(slab.polygons)}"
    )
    lip = min(
        math.hypot(x - SOCKET[0], y - SOCKET[1]) for x, y in lake_outline(1.0)
    )
    print(
        f"AUDIT lake centre={LAKE} mean_r={LAKE_R:.3f} "
        f"r={min(lake_radius(2 * math.pi * i / 360) for i in range(360)):.4f}.."
        f"{max(lake_radius(2 * math.pi * i / 360) for i in range(360)):.4f} "
        f"water_z={sorted(water_z)} water_r={water_reach:.4f} "
        f"water_to_socket={water_to_socket:.4f} lip_to_socket={lip:.4f}"
    )
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
        if obj.type == "MESH":
            mats = ",".join(m.name for m in obj.data.materials)
            print(f"  {obj.name:18s} {len(obj.data.polygons):5d} faces  {mats}")

    if smooth:
        raise SystemExit(f"smooth-shaded polygons on {smooth}")
    if reach > HEX_R + 1e-3:
        raise SystemExit(f"art reaches {reach:.4f} ({reach_obj}), past the gutter line")
    if tallest > 2.30 + 1e-3:
        raise SystemExit(f"tallest {tallest:.4f} above the 2.30 prop ceiling")
    if intrusion is not None:
        raise SystemExit(f"chip keep-clear broken by {intrusion}")
    if abs(slab_r - HEX_R) > 1e-3:
        raise SystemExit(f"slab circumradius {slab_r:.4f} != {HEX_R:.4f}")
    if abs(slab_top - SLAB_TOP) > 1e-3 or abs(slab_bottom - SLAB_BOTTOM) > 1e-3:
        raise SystemExit(f"slab z {slab_bottom:.4f}..{slab_top:.4f} off contract")
    if len(water_z) != 1:
        raise SystemExit(f"the water sheet is not flat: {sorted(water_z)}")
    if water_z.pop() >= SLAB_TOP:
        raise SystemExit("the water sheet is not below the slab top")
    if water_to_socket <= KEEP_CLEAR:
        raise SystemExit(f"water reaches {water_to_socket:.4f} of the chip socket")

    ground = bpy.data.objects[f"{PREFIX}ground"]
    gz = [(ground.matrix_world @ v.co).z for v in ground.data.vertices]
    print(f"AUDIT ground {min(gz):.4f}..{max(gz):.4f}")
    # The shore under the slab top would let the slab's own colour through:
    # only the bed and the bank go under it, and the slab is cut there.
    if min(gz) < SLAB_TOP - 1e-6:
        raise SystemExit(
            f"the ground dips to {min(gz):.4f}, under the slab's own top face at "
            f"{SLAB_TOP:.4f}: the slab's own colour would show through the shore"
        )

    rim = bpy.data.objects[f"{PREFIX}rim"]
    rz = [(rim.matrix_world @ v.co).z for v in rim.data.vertices]
    if len(rim.data.polygons) != 168 or len(rim.data.vertices) != 210:
        raise SystemExit(
            f"the rim is {len(rim.data.vertices)}v/{len(rim.data.polygons)}f, not the "
            f"210/168 `Pasture_rim` ships: it is no longer that mesh"
        )
    print(f"AUDIT rim {min(rz):.4f}..{max(rz):.4f} faces={len(rim.data.polygons)}")
    if abs(min(rz) - RIM_OUTER_Z) > 1e-6:
        raise SystemExit(f"the rim's outer edge is {min(rz):.4f}, not {RIM_OUTER_Z}")
    if min(rz) <= SLAB_TOP:
        raise SystemExit("the rim's outer edge is not above the gutter sand")

    # The ground and the rim must share their boundary loop, or gutter sand
    # shows through the seam.
    gset = {(round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5)) for v in ground.data.vertices}
    inner = [
        (round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5))
        for v in rim.data.vertices
        if abs(v.co.z - RIM_TOP_Z) < 1e-6
    ]
    if len(inner) != 6 * RIM_SEGS:
        raise SystemExit(f"the rim's inner ring is {len(inner)} points")
    for point in inner:
        if point not in gset:
            raise SystemExit(f"the ground does not meet the rim at {point}")

    water = bpy.data.objects[f"{PREFIX}water"]
    if water.data.polygons[0].normal.z <= 0.99:
        raise SystemExit("the water sheet's normal does not point up")
    if REED_Z >= WATER_Z:
        raise SystemExit(f"reeds are planted at {REED_Z}, not under the {WATER_Z} sheet")
    if not BOAT_KEEL_Z < WATER_Z < BOAT_GUNWALE_Z:
        raise SystemExit("the boat's hull does not cross the waterline")
    if BOAT_FLOOR_Z <= WATER_Z:
        raise SystemExit("the boat's floor is under the water sheet")
    for name, x, y, *_ in TREES + GRASS + ROCKS:
        if math.dist((x, y), SOCKET) < PROP_CLEAR:
            raise SystemExit(f"{name} centre is inside the {PROP_CLEAR} prop clearance")
        if lake_s(x, y) < 1.0:
            raise SystemExit(f"{name} stands in the lake")

    # Every prop stands on the ground, which stops at the rim's inner ring
    # (0.9519); past it a prop floats over the sloping rim. Measured per vertex,
    # not from a nominal radius.
    for obj in bpy.data.objects:
        if obj.type != "MESH" or not obj.name.startswith(PROP_PREFIXES):
            continue
        s_max = max(hex_s(v.co.x, v.co.y) for v in obj.data.vertices)
        if s_max > RIM_INNER_S:
            raise SystemExit(
                f"{obj.name} reaches hexagonal radius {s_max:.4f}, past the rim's "
                f"inner ring at {RIM_INNER_S:.4f}: its foot is over sloping rim"
            )

    used = set()
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            used.update(m.name for m in obj.data.materials)
    idle = sorted(set(MATERIALS) - used)
    if idle:
        raise SystemExit(f"authored but unused: {idle}")


def main():
    hexobj = build()
    audit(hexobj)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
    print("WROTE", os.path.relpath(OUT, REPO))


main()
