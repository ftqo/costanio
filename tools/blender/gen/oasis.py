"""Generate `art/hexes/oasis.blend`: the Caravans oasis hex.

    blender --background --factory-startup --python tools/blender/gen/oasis.py

The blend is an output of this script (like `gen/castle.py` for the castle):
do not model in it, the next run overwrites it. Change a number here and
re-run, then `make export-tiles` (or `make export-assets`) and
`make check-hexes`.

## Structure

The pond is a recess cut from the ground's own lattice triangles:

  * `Oasis_sand` is the shared 631-point lattice every land tile is drawn on,
    sampled from `ground_z`; the pond is the lattice triangles whose centroid
    is inside the outline, carved under the sheet by
    `featurelattice.carve_basin` (edge 4 mm under, inside into a bowl);
  * `Oasis_water` is exactly those triangles, flat at z = 0.190 and toned
    triangle by triangle, so its shore is a staircase of lattice edges and
    no ground corner under it can come up through it;
  * `Oasis_bank` is the ring of lattice triangles round it, falling from the
    apron to the waterline, plus the 4 mm lip from the sheet down to them;
    the green verge is the next ring out, in the sand;
  * the slab's top face is cut under the water and its bank, along lattice
    vertices at the apron's height, so the cut edge is always covered.

The cut changes nothing `hexcontract` measures (circumradius, top and bottom
z, thickness, orientation, reach, height, chip keep-clear): it only adds
vertices at 0.220 inside radius 3.0. `audit()` re-measures from the built mesh
before saving. The Rivers tiles cut their slab the same way at the same 0.190
water height.

## Layout constraints

1. The chip socket owns the north. `Token_Oasis` mounts at (0, +1.5) and
   nothing may reach above z = 0.25 within 1.05 of it
   (`hexcontract.KEEP_CLEAR_RADIUS`). So the pond is pushed south:
   `POND = (0.0, -0.95)` puts the water sheet's nearest point 1.4211 from
   the socket, measured by `audit()`. The bank lip comes to 1.278 but sits at
   0.2425 and up, under the chip. Every prop's centre is held 1.75 from the
   socket (keep-clear radius plus the widest prop's reach).

2. A still pond must not swell. `ocean.ts` displaces only `Mat_Ocean_water`
   (`ocean.test.ts` pins that), so the sheet wears `Mat_Oasis_water`, the
   same colour as `Mat_Lake_water` (`scenarioArt.test.ts`).

3. The dunes are gated, not clamped: a `min()` under the socket leaves a
   lens-shaped bite. The dune amplitude is multiplied by a smoothstep that is
   zero inside r = 1.05 of the socket and one by 1.60. The same gate flattens
   an apron around the water for the palms and the bank.

## House style

Every polygon is flat-shaded, no modifiers, no textures, colour is a flat
Principled base colour per material. A rock is 12 verts / 7 faces, a reed
clump 21 / 7.
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
import hexcontract  # noqa: E402
import lattice  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(_HERE)))
OUT = os.path.join(REPO, "art", "hexes", "oasis.blend")

# --- the tile ---------------------------------------------------------------

TERRAIN = "Oasis"
PREFIX = "Oasis_"

HEX_R = lattice.HEX_SIZE  # 3.0, the art circumradius
APOTHEM = lattice.TILE_APOTHEM  # 2.598076, centre to edge midpoint
SLAB_TOP = lattice.GAP_SAND_Z  # 0.220
SLAB_BOTTOM = lattice.GAP_BOTTOM_Z  # -0.250

#: Where the tile is staged in the showcase board: cell (1, 0), shared with the
#: desert and the lake.
CELL = (1, 0)

#: The ground's nominal height, under the 0.25 chip underside, so anything the
#: socket gate flattens is safe by construction.
GROUND_Z = 0.2450

#: Where the ground stops climbing and levels off to meet the rim, and the
#: height it levels off at: the chamfer's inner edge, at the shipped rims'
#: handover height. `Oasis_rim` carries the last 0.125 down to the sand.
EDGE_Z = 0.2900
EDGE_S = 0.920

# --- the rim ----------------------------------------------------------------
#
# Reproduced from `Desert_rim`, ring by ring, but in the oasis palette (desert
# sand is warmer: (0.97, 0.719, 0.46) against (0.847, 0.729, 0.533)). The shape
# is exact:
#
#   s = 0.9519  the inner edge, level with the ground it drapes on
#   s = 0.9800  a shoulder, jittered by the tile's own dune field
#   s = 0.9995  the top of the cutbank, flat
#   s = 1.0000  the outer edge, on the gutter sand
#
# The last band moves 0.0013 outward while dropping 0.0135, a near-vertical
# wall at the lip, in a dark material used nowhere else on the tile: the
# tile's outline. `hexcontract.rim_violations` checks for it.

#: One station per boundary vertex of the ground lattice, so the rim's inner
#: ring and the ground's outer ring share their vertices exactly and cannot
#: crack apart. The shared border uses 42 (7 per edge), which lands on every
#: other point of the lattice's outer ring (14 per edge); the ring between is
#: collinear and level with it at EDGE_Z, so nothing can open.
RIM_STATIONS = 42
RIM_INNER_S = 0.951897
RIM_SHOULDER_S = 0.979994
RIM_LIP_S = 0.999500
RIM_OUTER_S = 1.000000
RIM_INNER_Z = EDGE_Z
RIM_SHOULDER_Z = 0.2565
RIM_SHOULDER_JITTER = 0.0135
RIM_LIP_Z = 0.2340

#: 0.220 plus the tie-break. Three surfaces meet at 0.220 under the rim (slab
#: top, gutter sand, this), so the rim floats half a millimetre, as on the
#: other shared-border tiles.
RIM_OUTER_Z = SLAB_TOP + 0.0005

#: Dune height, and the two gates that hold it off the socket and the water.
#:
#: Dunes only rise: `dune()` is remapped to [0, 1], since ground under the
#: slab's opaque 0.220 top would show the slab's colour. The audit checks the
#: ground's minimum against the slab top.
DUNE_AMP = 0.190
SOCKET_GATE = (1.05, 1.60)
POND_GATE = (1.00, 1.90)

#: The chip mount and its keep-clear disc.
SOCKET = (0.0, 1.5)
SOCKET_Z = 0.26
KEEP_CLEAR = 1.05
CHIP_UNDERSIDE = 0.25
#: What a prop's centre is held to: KEEP_CLEAR plus the widest prop's reach.
PROP_CLEAR = 1.75


# --- the pond ---------------------------------------------------------------

#: Centre and mean radius of the cut: the hole in the ground, and the lip the
#: bank hangs from. South of the tile centre, for constraint 1 in the header.
POND = (0.0, -0.95)
POND_R = 1.22
#: How many segments the outline is drawn with, and how far it wanders off a
#: circle: three harmonics take the radius from 0.96 to 1.24. The profile below
#: scales the same outline, so the bank keeps a constant width.
POND_SIDES = 18
POND_WOBBLE = ((3, 0.070, 0.0), (5, 0.038, 1.1), (7, 0.018, 2.3))

#: The sheet. Below the slab top (0.220), as on the lake.
WATER_Z = 0.1900
#: Which lattice triangles are water: those whose centroid is inside the
#: outline scaled to this. The outline only selects triangles.
WATER_S = 0.895

# --- materials --------------------------------------------------------------
#
# Colour, roughness, at the values `frontend/public/models/palette.json`
# carries, so a rebuild is not a restyle. `Mat_Oasis_water` matches
# `Mat_Lake_water`; `Mat_Oasis_bank` is the damp sand of the cutbank.
MATERIALS = {
    "Mat_Oasis_slab": ((0.451, 0.361, 0.243), 0.95),
    "Mat_Oasis_sand": ((0.847, 0.729, 0.533), 0.95),
    "Mat_Oasis_sand_shade": ((0.714, 0.588, 0.412), 0.95),
    "Mat_Oasis_crust": ((0.573, 0.451, 0.31), 0.95),
    "Mat_Oasis_verge": ((0.259, 0.318, 0.18), 0.88),
    "Mat_Oasis_shallows": ((0.376, 0.353, 0.243), 0.88),
    "Mat_Oasis_bed": ((0.129, 0.161, 0.145), 0.9),
    "Mat_Oasis_trunk": ((0.325, 0.224, 0.133), 0.88),
    "Mat_Oasis_frond": ((0.204, 0.4, 0.169), 0.8),
    "Mat_Oasis_grass": ((0.376, 0.478, 0.243), 0.9),
    "Mat_Oasis_reed": ((0.322, 0.494, 0.208), 0.82),
    "Mat_Oasis_stone": ((0.498, 0.435, 0.361), 0.95),
    "Mat_Oasis_bank": ((0.478, 0.373, 0.259), 0.9),
    "Mat_Oasis_water": ((0.047, 0.286, 0.325), 0.14),
    # The pond's middle tone: the lake's shoal colour, under its own name.
    "Mat_Lake_shoal": ((0.098, 0.404, 0.42), 0.14),
    # And its shallows: the goldfield creek's pale water, likewise by name.
    "Mat_Gold_water": ((0.353, 0.478, 0.478), 0.3),
    # The rim's outline: the dark band on the cutbank. The desert's ratio
    # (`Mat_Desert_gravel` is 0.69 of the red and 0.73 of the green and blue of
    # `Mat_Desert_sand_lit`) applied to this tile's sand.
    "Mat_Oasis_gravel": ((0.583, 0.529, 0.387), 0.95),
}


# --- scene plumbing ---------------------------------------------------------


def wipe():
    """Empty the factory scene. Never `read_factory_settings` (see art/README)."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.collections):
        for item in list(block):
            block.remove(item)


def make_materials():
    for name, (color, roughness) in MATERIALS.items():
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


# --- the pond outline -------------------------------------------------------


def pond_radius(angle):
    """The cut's radius at `angle`, wobbled off a circle."""
    r = POND_R
    for freq, amp, phase in POND_WOBBLE:
        r += POND_R * amp * math.sin(freq * angle + phase)
    return r


def pond_outline(s=1.0):
    """`POND_SIDES` points around the outline, scaled by `s` about the centre."""
    out = []
    for i in range(POND_SIDES):
        a = 2.0 * math.pi * i / POND_SIDES
        r = pond_radius(a) * s
        out.append((POND[0] + r * math.cos(a), POND[1] + r * math.sin(a)))
    return out


def pond_s(x, y):
    """Where (x, y) sits on the pond's radial profile. 1.0 is the cut line."""
    dx, dy = x - POND[0], y - POND[1]
    d = math.hypot(dx, dy)
    if d < 1e-9:
        return 0.0
    return d / pond_radius(math.atan2(dy, dx))


# --- the ground surface -----------------------------------------------------


def dune(x, y):
    """Deterministic smooth relief, roughly in [-1, 1].

    Three sines with incommensurable frequencies rather than a noise texture,
    so the tile is identical across runs and Blender versions.
    """
    return (
        0.55 * math.sin(0.92 * x + 1.7) * math.cos(0.81 * y - 0.4)
        + 0.30 * math.sin(1.63 * y + 2.9) * math.cos(1.44 * x + 0.8)
        + 0.15 * math.sin(1.91 * (0.7 * x + 0.7 * y) + 1.2)
    )


def ground_z(x, y):
    """The sand's surface. Flat under the chip, flat around the water."""
    gate = smoothstep(math.dist((x, y), SOCKET), *SOCKET_GATE)
    gate *= smoothstep(pond_s(x, y), *POND_GATE)
    z = GROUND_Z + DUNE_AMP * 0.5 * (dune(x, y) + 1.0) * gate
    # The skirt ends at the rim's inner edge, at the rim's starting height. It
    # starts at 0.920: at 0.9046 the boundary is 1.05 from the chip socket, and
    # climbing toward 0.290 there would push ground through the chip.
    skirt = smoothstep(hex_s(x, y), EDGE_S, RIM_INNER_S)
    return z * (1.0 - skirt) + EDGE_Z * skirt


def ground_material(x, y, z):
    """Which sand a face wears, from where it is and how high it stands.

    The second test runs at about one cycle per two triangles, so adjacent
    facets differ rather than each dune being one wash.
    """
    if pond_s(x, y) < 1.30:
        # The damp crust between the green verge and dry dune sand.
        return "Mat_Oasis_crust"
    if z < GROUND_Z + 0.012 or dune(x * 1.7 + 4.0, y * 1.7 - 2.0) < -0.30:
        return "Mat_Oasis_sand_shade"
    return "Mat_Oasis_sand"


# --- the lattice cut ------------------------------------------------------
#
# The ground is the shared lattice every land tile is drawn on (631 points,
# 3/14 apart, ring 14 on the rim's inner edge), sampled from `ground_z`, and
# the pond is a set of that lattice's own triangles: the ones whose centroid is
# inside the outline at `WATER_S`. `featurelattice.carve_basin` lowers them
# under the sheet (the edge a lip under it, the inside into a bowl), so the
# visible shore is the sheet's own boundary, a staircase of lattice edges.

_CUT = {}


def pond_cut():
    """The lattice ground, carved, and everything the builders need from it."""
    if _CUT:
        return _CUT
    pts = featurelattice.shared_lattice()
    keys = sorted(pts)
    index = {k: i for i, k in enumerate(keys)}
    verts = [[pts[k][0], pts[k][1], ground_z(*pts[k])] for k in keys]
    tris = [tuple(index[k] for k in t) for t in featurelattice.shared_lattice_triangles(pts)]
    rim_ring = {index[k] for k in keys if max(abs(k[0]), abs(k[1]), abs(k[0] + k[1])) >= 13}

    def allowed(n):
        return not any(v in rim_ring for v in tris[n]) and all(
            math.dist(verts[v][:2], SOCKET) > KEEP_CLEAR + 0.05 for v in tris[n]
        )

    ok = {n for n in range(len(tris)) if allowed(n)}
    region = featurelattice.region_from_polygons(
        verts, tris, lambda x, y: pond_s(x, y) < WATER_S
    )
    region = featurelattice.tidy_region(tris, region & ok, allowed=ok)
    cut = featurelattice.carve_basin(
        verts, tris, region, level=WATER_Z, lip=0.004, bowl=(0.020, 0.034, 0.048)
    )
    bank = featurelattice.bank_triangles(tris, region, cut["edge"])
    shore = featurelattice.shore_ring(tris, region, cut["edge"])
    # The bank's top is the old verge shelf: level with the apron, under the
    # chip's 0.25 underside, wherever the relief round it has started to rise.
    for v in shore:
        verts[v][2] = min(verts[v][2], GROUND_Z)
    # The second ring out is the verge the water leaves as it falls.
    verge = featurelattice.bank_triangles(tris, region | bank, shore)
    _CUT.update(
        verts=verts, tris=tris, region=region, bank=bank, verge=verge, cut=cut,
        hole=featurelattice.region_outline(verts, tris, region | bank),
    )
    return _CUT


def stand_z(x, y):
    """What a prop stands on: the carved lattice."""
    c = pond_cut()
    z = featurelattice.height_at(c["verts"], c["tris"], x, y)
    return ground_z(x, y) if z is None else z


# --- the slab ---------------------------------------------------------------


def build_slab(collection, location):
    """`Hex_Oasis`: the terrain slab, its top face cut under the pond.

    The slab's top is opaque at 0.220 and the water sits at 0.190, so the top
    is cut under the water and its bank ring, on lattice vertices at the
    apron's 0.245. What `hexcontract` measures is unchanged: corners at radius
    3.0 and z 0.220, underside one hexagon at -0.250.
    """
    verts, faces, face_mats = [], [], []
    c = pond_cut()

    top = [hex_corner(k) for k in range(6)]
    hole = [tuple(c["verts"][v][:2]) for v in c["hole"]]
    inside_hole = set(c["region"]) | set(c["bank"])

    # The top face, as a hexagon with a hole, triangulated by CDT.
    pts = [Vector(p) for p in top] + [Vector(p) for p in hole]
    edges = [(i, (i + 1) % 6) for i in range(6)]
    edges += [(6 + i, 6 + (i + 1) % len(hole)) for i in range(len(hole))]
    out_verts, _, out_faces, _, _, _ = delaunay_2d_cdt(pts, edges, [], 0, 1e-5)

    lattice_tris = [[c["verts"][v] for v in c["tris"][n]] for n in inside_hole]

    def in_hole(x, y):
        for a, b, cc in lattice_tris:
            d = (b[1] - cc[1]) * (a[0] - cc[0]) + (cc[0] - b[0]) * (a[1] - cc[1])
            l1 = ((b[1] - cc[1]) * (x - cc[0]) + (cc[0] - b[0]) * (y - cc[1])) / d
            l2 = ((cc[1] - a[1]) * (x - cc[0]) + (a[0] - cc[0]) * (y - cc[1])) / d
            if min(l1, l2, 1 - l1 - l2) >= -1e-9:
                return True
        return False

    index = {}
    for tri in out_faces:
        cx = sum(out_verts[i].x for i in tri) / len(tri)
        cy = sum(out_verts[i].y for i in tri) / len(tri)
        if in_hole(cx, cy):
            continue
        face = []
        for i in tri:
            if i not in index:
                index[i] = len(verts)
                verts.append((out_verts[i].x, out_verts[i].y, SLAB_TOP))
            face.append(index[i])
        faces.append(orient(tuple(face), verts))
        face_mats.append("Mat_Oasis_slab")

    # The underside and the six walls, exactly as they were.
    base = len(verts)
    for x, y in top:
        verts.append((x, y, SLAB_BOTTOM))
    faces.append(tuple(range(base + 5, base - 1, -1)))
    face_mats.append("Mat_Oasis_slab")

    rim = {}
    for k, (x, y) in enumerate(top):
        rim[k] = len(verts)
        verts.append((x, y, SLAB_TOP))
    for k in range(6):
        a, b = rim[k], rim[(k + 1) % 6]
        cc, d = base + (k + 1) % 6, base + k
        # Wound outward, from this edge's own midpoint (see the lake).
        mx = (verts[a][0] + verts[b][0]) / 2.0
        my = (verts[a][1] + verts[b][1]) / 2.0
        faces.append(orient((a, b, cc, d), verts, (mx, my, 0.0)))
        face_mats.append("Mat_Oasis_slab")

    return add(f"Hex_{TERRAIN}", verts, faces, face_mats, collection, location=location)


# --- the ground -------------------------------------------------------------


def build_ground(collection, parent):
    """`Oasis_sand`: the lattice, sampled from the dunes, with the bed carved in.

    Every lattice triangle but the bank ring (which is `Oasis_bank`). It ends
    on ring 14, the rim's inner edge, like every shipped land ground, so it
    does not cover the chamfer.
    """
    c = pond_cut()
    V = c["verts"]
    verts, faces, face_mats = [], [], []
    index = {}
    for n, tri in enumerate(c["tris"]):
        if n in c["bank"]:
            continue
        face = []
        for i in tri:
            if i not in index:
                index[i] = len(verts)
                verts.append(tuple(V[i]))
            face.append(index[i])
        faces.append(orient(tuple(face), verts))
        cx = sum(V[i][0] for i in tri) / 3.0
        cy = sum(V[i][1] for i in tri) / 3.0
        z = sum(V[i][2] for i in tri) / 3.0
        if n in c["region"]:
            face_mats.append("Mat_Oasis_bed")
        elif n in c["verge"]:
            face_mats.append("Mat_Oasis_verge")
        else:
            face_mats.append(ground_material(cx, cy, z))
    return add(f"{PREFIX}sand", verts, faces, face_mats, collection, parent)


# --- the rim ----------------------------------------------------------------


def rim_ring(s):
    """`RIM_STATIONS` points on the tile hexagon scaled to `s`, corner 0 first.

    Every point has `hex_s == s` exactly: a hexagon's boundary is straight
    between its corners, so the inner ring can share the ground's boundary
    vertices and the outer ring lands on the art apothem.
    """
    out = []
    per = RIM_STATIONS // 6
    for k in range(6):
        ax, ay = hex_corner(k, HEX_R * s)
        bx, by = hex_corner(k + 1, HEX_R * s)
        for j in range(per):
            t = j / per
            out.append((ax + (bx - ax) * t, ay + (by - ay) * t))
    return out


def rim_shoulder_z(x, y):
    """The shoulder ring's height: the tile's own dune field, run fast.

    Tied to `dune` so the rim's relief matches the sand, sampled at 2.6x so it
    varies face by face (the desert's shoulder wanders 0.244 to 0.270) rather
    than reading as one smooth moulding.
    """
    field = dune(x * 2.6 + 1.4, y * 2.6 - 0.6)
    return RIM_SHOULDER_Z + RIM_SHOULDER_JITTER * max(-1.0, min(1.0, field))


def rim_material(band, x, y):
    """Which sand a rim face wears.

    Band 2 is the cutbank, and `Mat_Oasis_gravel` appears only there, which
    makes the lip an outline (what `hexcontract` checks). The split within each
    band uses the same high-frequency field as `ground_material`.
    """
    dark = dune(x * 3.1 + 4.0, y * 3.1 - 2.0) < 0.05
    if band == 0:
        # The damp crust just inside the lip, as the desert's rim uses its
        # stone: one darker material for the whole inner band.
        return "Mat_Oasis_crust"
    if band == 1:
        return "Mat_Oasis_sand_shade" if dark else "Mat_Oasis_sand"
    return "Mat_Oasis_gravel" if dark else "Mat_Oasis_sand_shade"


def build_rim(collection, parent):
    """`Oasis_rim`: the chamfer, the shoulder and the cutbank at the lip."""
    rings = [
        [(x, y, RIM_INNER_Z) for x, y in rim_ring(RIM_INNER_S)],
        [(x, y, rim_shoulder_z(x, y)) for x, y in rim_ring(RIM_SHOULDER_S)],
        [(x, y, RIM_LIP_Z) for x, y in rim_ring(RIM_LIP_S)],
        [(x, y, RIM_OUTER_Z) for x, y in rim_ring(RIM_OUTER_S)],
    ]

    verts, faces, face_mats = [], [], []
    for ring in rings:
        verts.extend(ring)
    n = RIM_STATIONS
    for band in range(3):
        inner, outer = band * n, (band + 1) * n
        for i in range(n):
            j = (i + 1) % n
            quad = (inner + i, inner + j, outer + j, outer + i)
            cx = sum(verts[v][0] for v in quad) / 4.0
            cy = sum(verts[v][1] for v in quad) / 4.0
            # The cutbank is near-vertical, so it is wound outward from the
            # tile centre rather than toward +Z.
            up = (cx, cy, 0.0) if band == 2 else (0.0, 0.0, 1.0)
            faces.append(orient(quad, verts, up))
            face_mats.append(rim_material(band, cx, cy))

    return add(f"{PREFIX}rim", verts, faces, face_mats, collection, parent)


# --- the recess -------------------------------------------------------------


def build_bank(collection, parent):
    """`Oasis_bank`: the ring of lattice triangles round the water, and its lip.

    The ground's own triangles with a corner on the water's edge, falling from
    the apron to just under the waterline, in the damp sand of the cutbank
    (the green verge is the ring outside it, in `Oasis_sand`); plus the 4 mm
    vertical lip from the sheet's edge down to them.
    """
    c = pond_cut()
    V = c["verts"]
    verts, faces, face_mats = [], [], []
    for n in sorted(c["bank"]):
        tri = c["tris"][n]
        base = len(verts)
        verts.extend(tuple(V[i]) for i in tri)
        faces.append(orient((base, base + 1, base + 2), verts))
        face_mats.append("Mat_Oasis_bank")
    _pos, _faces, _tones, lips = featurelattice.water_sheet(
        V, c["tris"], c["region"], WATER_Z, c["cut"]["depth"], 3.0
    )
    for quad in lips:
        base = len(verts)
        verts.extend(quad)
        faces.append((base, base + 1, base + 2, base + 3))
        # The wet margin: the few millimetres of bank under the waterline.
        face_mats.append("Mat_Oasis_shallows")
    return add(f"{PREFIX}bank", verts, faces, face_mats, collection, parent)


def build_water(collection, parent):
    """`Oasis_water`: the lattice triangles of the pond, flat at WATER_Z.

    One height, exactly. Three tones triangle by triangle: the deep middle, the
    lake's shoal colour, and the goldfield creek's pale water against the bank.
    It does not wear `Mat_Ocean_water`, which `ocean.ts` displaces.
    """
    c = pond_cut()
    pos, tri_faces, tones, _lips = featurelattice.water_sheet(
        c["verts"], c["tris"], c["region"], WATER_Z, c["cut"]["depth"], 3.0
    )
    names = ("Mat_Oasis_water", "Mat_Lake_shoal", "Mat_Gold_water")
    faces = [orient(f, pos) for f in tri_faces]
    return add(f"{PREFIX}water", pos, faces, [names[t] for t in tones], collection, parent)


# --- props ------------------------------------------------------------------


def build_palm(name, x, y, height, bearing, lean, collection, parent):
    """A tapered trunk, six fronds and a coconut cluster: 45 faces."""
    base = stand_z(x, y)
    verts, faces, face_mats = [], [], []

    sides, segs = 6, 3
    radii = (0.086, 0.069, 0.055, 0.045)
    levels = (0.0, 0.36, 0.68, 1.0)
    rings = []
    for r, t in zip(radii, levels):
        off = lean * (t**1.7)
        ring = []
        for k in range(sides):
            a = 2.0 * math.pi * k / sides + bearing
            ring.append(
                (
                    x + off * math.cos(bearing) + r * math.cos(a),
                    y + off * math.sin(bearing) + r * math.sin(a),
                    base + height * t,
                )
            )
        rings.append([len(verts) + i for i in range(len(ring))])
        verts.extend(ring)
    for band in range(segs):
        a, b = rings[band], rings[band + 1]
        for i in range(sides):
            j = (i + 1) % sides
            faces.append((a[i], a[j], b[j], b[i]))
            face_mats.append("Mat_Oasis_trunk")
    faces.append(tuple(rings[-1]))
    face_mats.append("Mat_Oasis_trunk")

    crown = Vector(
        (
            x + lean * math.cos(bearing),
            y + lean * math.sin(bearing),
            base + height,
        )
    )

    # Six fronds, each a three-face blade: a wedge off the crown, a middle
    # panel and a drooping tip.
    for k in range(6):
        a = bearing + 2.0 * math.pi * k / 6.0 + 0.21 * math.sin(3.1 * k)
        d = Vector((math.cos(a), math.sin(a), 0.0))
        s = Vector((-math.sin(a), math.cos(a), 0.0))
        p0 = crown + d * 0.05 + Vector((0, 0, 0.030))
        l1 = crown + d * 0.20 + s * 0.100 + Vector((0, 0, 0.062))
        r1 = crown + d * 0.20 - s * 0.100 + Vector((0, 0, 0.062))
        l2 = crown + d * 0.32 + s * 0.086 + Vector((0, 0, 0.012))
        r2 = crown + d * 0.32 - s * 0.086 + Vector((0, 0, 0.012))
        tip = crown + d * 0.44 + Vector((0, 0, -0.080))
        i0 = len(verts)
        verts.extend([tuple(p0), tuple(l1), tuple(r1), tuple(l2), tuple(r2), tuple(tip)])
        for face in ((i0, i0 + 1, i0 + 2), (i0 + 1, i0 + 3, i0 + 4, i0 + 2), (i0 + 3, i0 + 5, i0 + 4)):
            # Normal up: built left-to-right off the crown it would face down.
            faces.append(orient(face, verts))
            face_mats.append("Mat_Oasis_frond")

    # The coconuts: one octahedron slung under the crown (level with the cap it
    # reads as a blemish).
    c = crown + Vector((0, 0, -0.062))
    i0 = len(verts)
    verts.extend(
        [
            tuple(c + Vector((0, 0, 0.044))),
            tuple(c + Vector((0.042, 0, 0))),
            tuple(c + Vector((0, 0.042, 0))),
            tuple(c + Vector((-0.042, 0, 0))),
            tuple(c + Vector((0, -0.042, 0))),
            tuple(c + Vector((0, 0, -0.044))),
        ]
    )
    for a, b in ((1, 2), (2, 3), (3, 4), (4, 1)):
        faces.append((i0, i0 + a, i0 + b))
        face_mats.append("Mat_Oasis_trunk")
        faces.append((i0 + 5, i0 + b, i0 + a))
        face_mats.append("Mat_Oasis_trunk")

    return add(name, verts, faces, face_mats, collection, parent)


def build_bush(name, x, y, spread, height, turn, collection, parent):
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
        face_mats.append("Mat_Oasis_grass")
    return add(name, verts, faces, face_mats, collection, parent)


def build_reeds(name, x, y, z, height, turn, collection, parent):
    """Seven blades out of the shallows: 21 verts, 7 faces."""
    verts, faces, face_mats = [], [], []
    for k in range(7):
        a = turn + 2.399963 * k
        r = 0.030 + 0.052 * ((k * 3) % 7) / 6.0
        cx, cy = x + r * math.cos(a), y + r * math.sin(a)
        h = height * (0.62 + 0.38 * ((k * 5) % 7) / 6.0)
        lean = 0.055 * math.sin(1.7 * k)
        i0 = len(verts)
        verts.append((cx - 0.020 * math.sin(a), cy + 0.020 * math.cos(a), z))
        verts.append((cx + 0.020 * math.sin(a), cy - 0.020 * math.cos(a), z))
        verts.append((cx + lean * math.cos(a), cy + lean * math.sin(a), z + h))
        faces.append((i0, i0 + 1, i0 + 2))
        face_mats.append("Mat_Oasis_reed")
    return add(name, verts, faces, face_mats, collection, parent)


def build_rock(name, x, y, radius, height, turn, collection, parent):
    """A blunt boulder: 12 verts, 7 faces."""
    base = stand_z(x, y)
    verts, faces, face_mats = [], [], []
    low, high = [], []
    for k in range(6):
        a = turn + 2.0 * math.pi * k / 6.0
        rl = radius * (0.86 + 0.24 * ((k * 5) % 6) / 5.0)
        rh = radius * (0.42 + 0.20 * ((k * 3) % 6) / 5.0)
        low.append(len(verts))
        verts.append((x + rl * math.cos(a), y + rl * math.sin(a), base - 0.012))
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
        # would flip the far three).
        mx = (verts[low[k]][0] + verts[low[j]][0]) / 2.0 - x
        my = (verts[low[k]][1] + verts[low[j]][1]) / 2.0 - y
        faces.append(orient((low[k], low[j], high[j], high[k]), verts, (mx, my, 0.35)))
        face_mats.append("Mat_Oasis_stone")
    faces.append(orient(tuple(high), verts))
    face_mats.append("Mat_Oasis_stone")
    return add(name, verts, faces, face_mats, collection, parent)


# --- placement --------------------------------------------------------------
#
# Every position is measured against three things and the audit re-checks all
# of them: inside the drawn border with the prop's own reach to spare, 1.75
# from the chip socket, and outside the pond's lip.
#
# "Inside the border" is `hexcontract.BORDER_APOTHEM`, 2.4731 in the hexagon's
# own metric: the rim's inner edge. The palms crowd the water; the rocks and
# the shade grass hold the dune side.

PALMS = (
    # name, x, y, height, bearing, lean. Every one leans over the water.
    ("Oasis_palm_01", -1.55, -0.20, 1.24, 5.55, 0.125),
    ("Oasis_palm_02", -0.90, -1.97, 1.38, 0.90, 0.150),
    ("Oasis_palm_03", 1.50, -0.60, 1.15, 3.55, 0.110),
    ("Oasis_palm_04", 0.64, -2.06, 1.06, 1.95, 0.095),
)

BUSHES = (
    ("Oasis_bush_01", -1.48, -1.64, 0.42, 0.42, 0.4),
    ("Oasis_bush_02", 1.29, -1.88, 0.38, 0.36, 1.9),
    ("Oasis_bush_03", -1.10, 0.05, 0.34, 0.33, 3.1),
    ("Oasis_bush_04", 1.95, -0.30, 0.36, 0.31, 5.0),
)

#: Reeds stand in the water: each is placed on the pond's outline at `REED_S`,
#: where the bed measures 0.1850, with their feet 1mm under that. Both are under
#: `WATER_Z`, and `audit` fails otherwise.
REED_S = 0.855
REED_Z = 0.1840
REEDS = (
    ("Oasis_reeds_01", 0.35, 0.52, 3.0),
    ("Oasis_reeds_02", 1.55, 0.47, 1.1),
    ("Oasis_reeds_03", 2.60, 0.54, 2.2),
    ("Oasis_reeds_04", 3.60, 0.45, 0.5),
    ("Oasis_reeds_05", 4.55, 0.50, 4.4),
)

ROCKS = (
    ("Oasis_rock_01", 2.10, 0.80, 0.34, 0.22, 0.3),
    ("Oasis_rock_02", -2.10, 0.60, 0.30, 0.19, 1.4),
    ("Oasis_rock_03", 1.68, -1.58, 0.26, 0.16, 2.6),
    ("Oasis_rock_04", -2.00, -1.20, 0.31, 0.20, 0.9),
    ("Oasis_rock_05", 0.26, -2.39, 0.24, 0.15, 3.8),
)


def build():
    wipe()
    make_materials()

    collection = bpy.data.collections.new(f"Tile_{TERRAIN}")
    bpy.context.scene.collection.children.link(collection)

    hx, hy = lattice.axial_to_xy(*CELL)
    hexobj = build_slab(collection, (hx, hy, 0.0))

    token = bpy.data.objects.new(f"Token_{TERRAIN}", None)
    token.empty_display_type = "CIRCLE"
    token.empty_display_size = 1.0
    token.location = (SOCKET[0], SOCKET[1], SOCKET_Z)
    collection.objects.link(token)
    token.parent = hexobj

    build_ground(collection, hexobj)
    build_rim(collection, hexobj)
    build_bank(collection, hexobj)
    build_water(collection, hexobj)

    for name, x, y, h, bearing, lean in PALMS:
        build_palm(name, x, y, h, bearing, lean, collection, hexobj)
    for name, x, y, spread, h, turn in BUSHES:
        build_bush(name, x, y, spread, h, turn, collection, hexobj)
    c = pond_cut()
    shore = sorted(c["cut"]["edge"])
    for name, angle, height, turn in REEDS:
        # On the water's own edge: the lattice vertex of the shore nearest
        # where the reed stood on the old outline, just under the sheet.
        r = pond_radius(angle) * REED_S
        want = (POND[0] + r * math.cos(angle), POND[1] + r * math.sin(angle))
        v = min(shore, key=lambda i: math.dist(c["verts"][i][:2], want))
        x, y, _z = c["verts"][v]
        build_reeds(name, x, y, REED_Z, height, turn, collection, hexobj)
    for name, x, y, radius, h, turn in ROCKS:
        build_rock(name, x, y, radius, h, turn, collection, hexobj)

    return hexobj


# --- the audit --------------------------------------------------------------


def audit_rim(hexobj, sand):
    """The rim rules, re-measured here so a bad edit fails during the build.

    `make check-hexes` is the gate (`hexcontract.rim_violations`); this takes
    the same measurement while the generator has the mesh, from the built
    geometry rather than the constants.
    """
    centre = hexobj.matrix_world.translation
    rim = bpy.data.objects[f"{PREFIX}rim"]
    pts = [(rim.matrix_world @ v.co) for v in rim.data.vertices]
    s = [hex_s(p.x - centre.x, p.y - centre.y) for p in pts]
    inner_s, outer_s = min(s), max(s)
    inner_z = [pts[i].z for i in range(len(pts)) if s[i] <= inner_s + 4e-4]
    outer_z = [pts[i].z for i in range(len(pts)) if s[i] >= outer_s - 4e-4]

    mats = [m.name for m in rim.data.materials]
    spans = {}
    for p in rim.data.polygons:
        lo, hi = spans.get(mats[p.material_index], (9.9, -9.9))
        vs = [s[i] for i in p.vertices]
        spans[mats[p.material_index]] = (min(lo, *vs), max(hi, *vs))
    outline = sorted(k for k, (lo, _) in spans.items() if lo >= RIM_LIP_S - 1e-6)

    cutbank = max(
        max(pts[i].z for i in p.vertices) - min(pts[i].z for i in p.vertices)
        for p in rim.data.polygons
        if abs((rim.matrix_world.to_3x3() @ p.normal).normalized().z) < 0.25
    )
    ground_s = max(hex_s((sand.matrix_world @ v.co).x - centre.x,
                         (sand.matrix_world @ v.co).y - centre.y)
                   for v in sand.data.vertices)

    print(
        f"AUDIT rim s={inner_s:.6f}..{outer_s:.6f} inner_z={min(inner_z):.4f} "
        f"outer_z={min(outer_z):.4f}..{max(outer_z):.4f} cutbank={cutbank:.4f} "
        f"outline={outline} ground_ends_at={ground_s:.6f}"
    )

    # Compared at tenths of a millimetre: Blender stores single-precision
    # floats and the exporter rounds to four places.
    if abs(outer_s - 1.0) > 1e-4:
        raise SystemExit(f"the rim stops at s={outer_s:.6f}, not the art apothem")
    if max(abs(z - RIM_OUTER_Z) for z in outer_z) > 1e-4:
        raise SystemExit(f"the rim's outer edge is at {sorted(set(outer_z))}, not {RIM_OUTER_Z}")
    if min(inner_z) - max(outer_z) < 0.020:
        raise SystemExit(
            f"the rim climbs {min(inner_z) - max(outer_z):.4f}, under the 0.020 a "
            f"chamfer has to climb to read as one"
        )
    if len(outline) != 1:
        raise SystemExit(
            f"the lip needs exactly one material confined to the cutbank, got {outline}"
        )
    if cutbank < 0.0130:
        raise SystemExit(f"the cutbank is {cutbank:.4f}, under the shared border's 0.0135")
    if ground_s > RIM_INNER_S + 1e-4:
        raise SystemExit(
            f"the ground runs to s={ground_s:.6f}, over the rim's inner edge at "
            f"{RIM_INNER_S}: it would bury the chamfer"
        )


def audit(hexobj):
    """Re-measure the contract from the built mesh, not from the constants.

    `make check-hexes` does the same from outside; this fails a bad edit while
    the generator is still running.
    """
    centre = hexobj.matrix_world.translation
    faces = 0
    reach, tallest, tallest_obj = 0.0, -9.9, None
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
            reach = max(reach, math.hypot(dx, dy))
            if obj is not hexobj and z > tallest:
                tallest, tallest_obj = z, obj.name
            r = math.hypot(dx - SOCKET[0], dy - SOCKET[1])
            if r <= KEEP_CLEAR and z > CHIP_UNDERSIDE:
                intrusion = (obj.name, round(z, 4), round(r, 4))
            if obj.name == f"{PREFIX}water":
                water_z.add(round(z, 6))
                water_reach = max(water_reach, math.hypot(dx - POND[0], dy - POND[1]))
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

    print(f"AUDIT faces={faces} reach={reach:.4f} tallest={tallest:.4f} ({tallest_obj})")
    print(
        f"AUDIT slab circumR={slab_r:.4f} top={slab_top:.4f} bottom={slab_bottom:.4f} "
        f"verts={len(slab.vertices)} faces={len(slab.polygons)}"
    )
    print(
        f"AUDIT pond centre={POND} cut_r_mean={POND_R:.3f} water_z={sorted(water_z)} "
        f"water_r={water_reach:.4f} water_to_socket={water_to_socket:.4f}"
    )
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
        if obj.type == "MESH":
            print(f"  {obj.name:22s} {len(obj.data.polygons):5d} faces")

    if smooth:
        raise SystemExit(f"smooth-shaded polygons on {smooth}")
    if reach > HEX_R + 1e-3:
        raise SystemExit(f"art reaches {reach:.4f}, past the {HEX_R:.2f} gutter line")
    # The border, in the hexagon's own metric: every part but the slab and the
    # rim stays inside the rim's inner edge (see the placement note).
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj is hexobj or obj.name == f"{PREFIX}rim":
            continue
        worst = max(
            hex_s((obj.matrix_world @ v.co).x - centre.x, (obj.matrix_world @ v.co).y - centre.y)
            for v in obj.data.vertices
        ) * APOTHEM
        if worst > hexcontract.BORDER_APOTHEM + 1e-3:
            raise SystemExit(
                f"{obj.name} reaches apothem {worst:.4f}, past the drawn border at "
                f"{hexcontract.BORDER_APOTHEM:.4f}"
            )
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
    sand = bpy.data.objects[f"{PREFIX}sand"]
    sand_z = [(sand.matrix_world @ v.co).z for v in sand.data.vertices]
    print(f"AUDIT ground {min(sand_z):.4f}..{max(sand_z):.4f}")
    # Under the slab top is allowed only in the pond's own bed, which is where
    # the slab is cut: anywhere else Mat_Oasis_slab would show through.
    c = pond_cut()
    wet = {v for n in c["region"] for v in c["tris"][n]}
    dry = [c["verts"][i][2] for i in range(len(c["verts"])) if i not in wet]
    if min(dry) < SLAB_TOP - 1e-6:
        raise SystemExit(
            f"the ground dips to {min(dry):.4f}, under the slab's own top face "
            f"at {SLAB_TOP:.4f}: Mat_Oasis_slab would show through the sand there"
        )
    audit_rim(hexobj, sand)
    water = bpy.data.objects[f"{PREFIX}water"]
    if water.data.polygons[0].normal.z <= 0.99:
        raise SystemExit("the water sheet's normal does not point up")
    if REED_Z >= WATER_Z:
        raise SystemExit(f"reeds are planted at {REED_Z}, not under the {WATER_Z} sheet")
    for name, x, y, *_ in PALMS + BUSHES + ROCKS:
        if math.dist((x, y), SOCKET) < PROP_CLEAR:
            raise SystemExit(f"{name} centre is inside the {PROP_CLEAR} prop clearance")
        if pond_s(x, y) < 1.0:
            raise SystemExit(f"{name} stands in the pond")


def main():
    hexobj = build()
    audit(hexobj)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
    print("WROTE", os.path.relpath(OUT, REPO))


main()
