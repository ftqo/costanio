"""Measure every per-tile blend and hold it to the hex contract.

    blender --background --factory-startup --python tools/blender/check_hexes.py

Prints a table of what each tile measures and then every way it breaks
`hexcontract`. Exit status is non-zero if any tile fails, so `make` can gate on
it. `--json` dumps the raw measurements instead, for working out what a new
number should be before writing it into the contract.

Measured on evaluated meshes, so a bevel or subdivision counts the way the
exporter bakes it.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import export_assets  # noqa: E402
import featurelattice  # noqa: E402
import hexcontract  # noqa: E402
import naming  # noqa: E402
import recipes  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HEXES = os.path.join(REPO, "art", "hexes")
MODELS = os.path.join(REPO, "frontend", "public", "models")


def evaluated_verts(obj, depsgraph):
    """World-space vertices of `obj` with its modifiers applied."""
    if obj.type != "MESH":
        return []
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    matrix = ev.matrix_world
    out = [matrix @ v.co.copy() for v in mesh.vertices]
    ev.to_mesh_clear()
    return out


def evaluated_faces(obj, depsgraph):
    """(verts, faces, material names) in world space, modifiers applied.

    `faces` are (vertex indices, material slot, world-space normal z), which is
    everything the rim rules need: the slot says which material draws the face,
    and the normal's z says whether it is a surface or a cutbank.
    """
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    matrix = ev.matrix_world
    rot = matrix.to_3x3()
    verts = [matrix @ v.co.copy() for v in mesh.vertices]
    faces = [
        (list(p.vertices), p.material_index, (rot @ p.normal).normalized().z)
        for p in mesh.polygons
    ]
    mats = [m.name if m else None for m in mesh.materials]
    ev.to_mesh_clear()
    return verts, faces, mats


def _point_in_polygon(px, py, ring):
    """Crossing count, on a ring of (x, y). Robust enough at millimetre scale."""
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > py) != (y2 > py):
            if px < x1 + (py - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
    return inside


def measure_rim(terrain, root, centre, depsgraph):
    """Everything `hexcontract.rim_violations` needs, or None if there is no rim.

    Measured on the evaluated mesh, like the rest of this file.
    """
    rim = None
    for obj in export_assets.descendants(root):
        if obj.type == "MESH" and obj.name == hexcontract.rim_name_for(terrain):
            rim = obj
    if rim is None:
        return None

    verts, faces, mats = evaluated_faces(rim, depsgraph)
    if not verts or not faces:
        return None
    aps = [hexcontract.apothem(v.x - centre.x, v.y - centre.y) for v in verts]
    apothem_min, apothem_max = min(aps), max(aps)

    outer = [verts[i].z for i in range(len(verts)) if aps[i] >= apothem_max - hexcontract.TOL]
    inner = [verts[i].z for i in range(len(verts)) if aps[i] <= apothem_min + hexcontract.TOL]

    # --- the lip, as geometry: the tallest near-vertical face ---------------
    cutbank, cutbank_at = 0.0, None
    for vi, _slot, nz in faces:
        if abs(nz) > hexcontract.RIM_CUTBANK_NZ:
            continue
        zs = [verts[i].z for i in vi]
        drop = max(zs) - min(zs)
        if drop > cutbank:
            cutbank = drop
            cutbank_at = sum(aps[i] for i in vi) / len(vi)

    # --- the lip, as material: one confined to the outer band ---------------
    band = hexcontract.CHAMFER_OUTER_EDGE - hexcontract.RIM_OUTLINE_BAND
    spans = {}
    for vi, slot, _nz in faces:
        lo, hi = spans.get(slot, (1e9, -1e9))
        spans[slot] = (min([lo] + [aps[i] for i in vi]), max([hi] + [aps[i] for i in vi]))
    outline = None
    for slot in sorted(spans):
        lo, hi = spans[slot]
        if lo >= band and hi >= hexcontract.CHAMFER_OUTER_EDGE - hexcontract.TOL:
            outline = mats[slot] if slot < len(mats) else f"slot {slot}"
            break

    # --- opacity over the overlap ------------------------------------------
    # Only surfaces count. A cutbank is vertical and projects to a sliver, so
    # it covers nothing seen from above; the rings are sampled inside it.
    rings = [
        [(verts[i].x - centre.x, verts[i].y - centre.y) for i in vi]
        for vi, _slot, nz in faces
        if abs(nz) > hexcontract.RIM_CUTBANK_NZ
    ]
    span = hexcontract.RIM_ANNULUS_OUTER - hexcontract.RIM_ANNULUS_INNER
    steps = max(1, hexcontract.RIM_COVERAGE_RINGS - 1)
    gaps = 0
    for ring_i in range(hexcontract.RIM_COVERAGE_RINGS):
        want = hexcontract.RIM_ANNULUS_INNER + span * (0.05 + 0.85 * ring_i / steps)
        for spoke in range(hexcontract.RIM_COVERAGE_SPOKES):
            th = 2.0 * math.pi * spoke / hexcontract.RIM_COVERAGE_SPOKES
            # `apothem` is homogeneous of degree one, so the radius that lands
            # on `want` along this bearing is one division rather than a search.
            r = want / hexcontract.apothem(math.cos(th), math.sin(th))
            px, py = r * math.cos(th), r * math.sin(th)
            if not any(_point_in_polygon(px, py, ring) for ring in rings):
                gaps += 1

    return {
        "name": rim.name,
        "apothem_min": round(apothem_min, 4),
        "apothem_max": round(apothem_max, 4),
        "outer_z_min": round(min(outer), 4),
        "outer_z_max": round(max(outer), 4),
        "inner_z_min": round(min(inner), 4),
        "inner_z_max": round(max(inner), 4),
        "cutbank": round(cutbank, 4),
        "cutbank_apothem": None if cutbank_at is None else round(cutbank_at, 4),
        "outline_material": outline,
        "annulus_gaps": gaps,
    }


#: The objects that are the tile's lattice: its ground, and the pieces of it a
#: basin is split into (the lake's and the oasis's bed and bank rings), or on a
#: sea tile the wave sheet.
LATTICE_PARTS = featurelattice.LATTICE_PARTS  # the river's split lattice included; see there
WATER_LATTICE_PARTS = ("_waves",)


def measure_features(terrain, shipping, root, centre, depsgraph):
    """Every ground feature held to the lattice rule (`featurelattice`).

    Returns the violation strings, so the table's caller can list them with
    the rest of the contract.
    """
    water = terrain in hexcontract.WATER
    own = WATER_LATTICE_PARTS if water else LATTICE_PARTS
    parts, points, ground = [], [], []
    for obj in shipping:
        if obj is root:
            continue
        verts, faces, mats = evaluated_faces(obj, depsgraph)
        local = [(v.x - centre.x, v.y - centre.y, v.z) for v in verts]
        tris = []
        for vi, slot, _nz in faces:
            mat = mats[slot] if slot < len(mats) else None
            for k in range(1, len(vi) - 1):
                tris.append(((local[vi[0]], local[vi[k]], local[vi[k + 1]]), mat))
        parts.append((obj.name, tris))
        if obj.name.endswith(own):
            points += [(x, y) for x, y, _z in local]
            if water:
                # A sea tile's lattice is its wave sheet's, at half the step: a
                # sand bar is too small for 0.45 cells, and every midpoint of a
                # sheet edge is a vertex of the same lattice halved.
                for (a, b, c), _m in tris:
                    for u, v in ((a, b), (b, c), (c, a)):
                        points.append(((u[0] + v[0]) / 2.0, (u[1] + v[1]) / 2.0))
            else:
                ground += [t for t, m in tris if not (m and featurelattice.WATER_MATERIAL.match(m))]
    directions = (
        featurelattice.WATER_LATTICE_DIRECTIONS if water else featurelattice.LATTICE_DIRECTIONS
    )
    out = featurelattice.violations(terrain, parts, points, directions)
    if not water and not featurelattice.exempt_reason(terrain):
        for name, sheet in featurelattice.water_bodies(parts):
            n, worst = featurelattice.ground_through(sheet, ground)
            if n:
                out.append(
                    f"{name}: ground above the water at {n} samples, by up to "
                    f"{worst:.4f} (see featurelattice.carve_basin)"
                )
    return out


def measure(terrain, depsgraph):
    root = bpy.data.objects.get(f"Hex_{terrain}")
    if root is None:
        return None
    centre = root.matrix_world.translation

    shipping = [
        o
        for o in export_assets.descendants(root)
        if export_assets.is_tile_child(o.name) and o.type == "MESH"
    ]

    def radius(v):
        return math.hypot(v.x - centre.x, v.y - centre.y)

    # The slab is the hex object itself, not a child.
    slab = evaluated_verts(root, depsgraph)

    # How far out the art reaches, in the hexagon's own metric, and what
    # crosses the drawn border. The slab is the border's floor, not art on
    # it, so it is left out of both.
    border_reach, border_obj = 0.0, None
    tallest, tallest_obj = -1e9, None
    parts = []
    for obj in shipping:
        if obj is root:
            continue
        local = [(v.x - centre.x, v.y - centre.y, v.z) for v in evaluated_verts(obj, depsgraph)]
        parts.append((obj.name, local))
        role = hexcontract.border_role(terrain, obj.name)
        for x, y, z in local:
            if role == "art":
                a = hexcontract.apothem(x, y)
                if a > border_reach:
                    border_reach, border_obj = a, obj.name
            # The slab's own top face is the ground, not something standing on
            # it, so it never sets the height ceiling.
            if z > tallest:
                tallest, tallest_obj = z, obj.name
    border_intrusions = hexcontract.border_intrusions(terrain, parts)

    socket = None
    for obj in export_assets.descendants(root):
        if naming.socket_terrain(obj.name) or obj.name == f"Token_{terrain}":
            d = obj.matrix_world.translation - centre
            socket = {
                "name": obj.name,
                "type": obj.type,
                "empty_display_type": getattr(obj, "empty_display_type", None),
                "offset": [round(d.x, 4), round(d.y, 4), round(d.z, 4)],
            }

    intrusions = []
    if socket is not None:
        sx, sy, _ = socket["offset"]
        worst = {}
        for obj in shipping:
            for v in evaluated_verts(obj, depsgraph):
                r = math.hypot(v.x - centre.x - sx, v.y - centre.y - sy)
                if r <= hexcontract.KEEP_CLEAR_RADIUS and v.z > hexcontract.CHIP_UNDERSIDE_Z:
                    if v.z > worst.get(obj.name, (0.0, 0.0))[0]:
                        worst[obj.name] = (v.z, r)
        intrusions = [
            (name, round(z, 4), round(r, 4))
            for name, (z, r) in sorted(worst.items(), key=lambda kv: -kv[1][0])
        ]

    rim = measure_rim(terrain, root, centre, depsgraph)
    features = measure_features(terrain, shipping, root, centre, depsgraph)

    # What else is out over the chamfer, at chamfer height: a ground apron
    # left there hides the rim. The ceiling is the rim's own inner edge;
    # geometry above it (a palm frond over the lip) is not this rule's concern.
    buried_by = []
    if rim is not None:
        ceiling = rim["inner_z_max"] + hexcontract.TOL
        worst = {}
        for obj in shipping:
            if obj is root or obj.name == rim["name"]:
                continue
            for v in evaluated_verts(obj, depsgraph):
                a = hexcontract.apothem(v.x - centre.x, v.y - centre.y)
                if a < hexcontract.RIM_ANNULUS_INNER - hexcontract.TOL:
                    continue
                if not hexcontract.CHAMFER_OUTER_HEIGHT + hexcontract.TOL < v.z <= ceiling:
                    continue
                if v.z > worst.get(obj.name, (0.0, 0.0))[0]:
                    worst[obj.name] = (v.z, a)
        buried_by = [
            (name, round(z, 4), round(a, 4))
            for name, (z, a) in sorted(worst.items(), key=lambda kv: -kv[1][0])
        ]

    corner_angles = []
    if slab:
        top = max(v.z for v in slab)
        for v in slab:
            if abs(v.z - top) <= hexcontract.TOL and radius(v) > hexcontract.TOL:
                corner_angles.append(math.atan2(v.y - centre.y, v.x - centre.x))

    return {
        "terrain": terrain,
        "resource": naming.TERRAIN_TO_RESOURCE.get(terrain, terrain.lower()),
        "water": terrain in hexcontract.WATER,
        "slab_is_mesh": root.type == "MESH",
        "slab_type": root.type,
        "slab_circumradius": round(max((radius(v) for v in slab), default=0.0), 4),
        "slab_top_z": round(max((v.z for v in slab), default=0.0), 4),
        "slab_bottom_z": round(min((v.z for v in slab), default=0.0), 4),
        "border_reach": round(border_reach, 4),
        "border_reach_object": border_obj,
        "border_intrusions": border_intrusions,
        "tallest_z": round(tallest, 4),
        "tallest_object": tallest_obj,
        "socket": socket,
        "keep_clear_intrusions": intrusions,
        "rim": rim,
        "rim_buried_by": buried_by,
        "lattice_features": features,
        "meshes": len(shipping),
        "pointy_top": hexcontract.orientation_ok(corner_angles),
    }


def open_composed(path, terrain):
    """Load a recipe-built tile's shipped .glb into an empty scene, shaped like a blend.

    A composed tile has no blend: its source is a recipe, and what ships is
    the compressed .glb, so that is what is measured. Two things differ from
    an authored blend and are put back here:

      * compression moves the slab onto an unnamed child of the `Hex_*` root
        (quantisation needs a node of its own to scale), so the root is an
        empty; the child that carries the `Hex_*` mesh is made the root again
        and the tile's other parts re-parented under it, world transforms kept.
      * glTF has no empty display type, so the importer makes the socket a
        plain-axes empty; the contract asks for the circle a blend authors.
    """
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    name = f"Hex_{terrain}"
    root = bpy.data.objects.get(name)
    if root is None:
        return None
    if root.type != "MESH":
        slab = next(
            (c for c in root.children if c.type == "MESH" and c.data.name.startswith(name)),
            None,
        )
        if slab is None:
            return None
        root.name = f"{name}__import_root"
        slab.name = name
        # Bake the child's own offset (quantisation's) into the mesh so the
        # slab object sits where the blend's does, at the tile centre: the
        # socket is measured from it.
        slab.parent = None
        slab.data.transform(slab.matrix_world.copy())
        slab.matrix_world = root.matrix_world.copy()
        slab.data.transform(root.matrix_world.inverted())
        for child in list(root.children):
            if child is slab:
                continue
            world = child.matrix_world.copy()
            child.parent = slab
            child.matrix_world = world
    token = bpy.data.objects.get(f"Token_{terrain}")
    if token is not None and token.type == "EMPTY":
        token.empty_display_type = "CIRCLE"
    return bpy.data.objects.get(name)


def main():
    want_json = "--json" in sys.argv
    rows, failures = [], {}

    for terrain in sorted(naming.TERRAIN_TO_RESOURCE):
        blend = os.path.join(HEXES, f"{terrain.lower()}.blend")
        if not os.path.exists(blend):
            failures[terrain] = [f"no {os.path.relpath(blend, REPO)}"]
            continue
        bpy.ops.wm.open_mainfile(filepath=blend)
        m = measure(terrain, bpy.context.evaluated_depsgraph_get())
        if m is None:
            failures[terrain] = [f"blend has no Hex_{terrain}"]
            continue
        rows.append(m)
        bad = hexcontract.violations(m)
        if not m["pointy_top"]:
            bad.append("slab is not pointy-top (no corner due north)")
        if bad:
            failures[terrain] = bad

    # The recipe-built tiles, measured off what ships. Each inherits its base
    # terrain's recorded drift and nothing else (`hexcontract.DERIVES_FROM`).
    composed = recipes.recipes()
    for r in composed:
        hexcontract.DERIVES_FROM[r["terrain"]] = r["base"]
    for r in composed:
        path = os.path.join(MODELS, r["file"])
        if not os.path.exists(path):
            failures[r["terrain"]] = [f"no {r['file']}: run make compose-tiles"]
            continue
        if open_composed(path, r["terrain"]) is None:
            failures[r["terrain"]] = [f"{r['file']} has no Hex_{r['terrain']}"]
            continue
        m = measure(r["terrain"], bpy.context.evaluated_depsgraph_get())
        if m is None:
            failures[r["terrain"]] = [f"{r['file']} has no Hex_{r['terrain']}"]
            continue
        rows.append(m)
        bad = hexcontract.violations(m)
        if not m["pointy_top"]:
            bad.append("slab is not pointy-top (no corner due north)")
        if bad:
            failures[r["terrain"]] = bad

    if want_json:
        print(json.dumps(rows, indent=1))
        return

    head = (
        f"{'terrain':22s}{'wat':4s}{'circumR':>9s}{'top_z':>8s}{'bot_z':>8s}"
        f"{'thick':>7s}{'border':>8s}{'tallest':>8s}  {'rim':16s}  {'socket':14s}  furthest out"
    )
    print(head)
    print("-" * (len(head) + 12))
    for m in rows:
        s = m["socket"]["offset"][:2] if m["socket"] else None
        # The rim column: the rule a new tile most often skips.
        r = m.get("rim")
        if m["water"]:
            rim = "n/a water"
        elif r is None:
            rim = "MISSING"
        else:
            lip = "cutbank" if r["cutbank"] >= hexcontract.RIM_CUTBANK_MIN else "outline"
            lip = lip if (r["cutbank"] or r["outline_material"]) else "none"
            rim = f"{r['inner_z_min']:.3f}>{r['outer_z_max']:.4f} {lip}"
        print(
            f"{m['terrain']:22s}{'Y' if m['water'] else '.':4s}"
            f"{m['slab_circumradius']:9.4f}{m['slab_top_z']:8.4f}{m['slab_bottom_z']:8.4f}"
            f"{m['slab_top_z'] - m['slab_bottom_z']:7.4f}{m['border_reach']:8.4f}"
            f"{m['tallest_z']:8.3f}  {rim:16s}  {str(s):14s}  {m['border_reach_object']}"
        )

    print()
    if failures:
        for terrain in sorted(failures):
            for line in failures[terrain]:
                print(f"FAIL {terrain}: {line}")
        print(f"CONTRACT FAILED {len(failures)} of {len(naming.TERRAIN_TO_RESOURCE) + len(composed)} tiles")
        sys.exit(1)
    print(f"CONTRACT OK all {len(rows)} tiles hold")


main()
