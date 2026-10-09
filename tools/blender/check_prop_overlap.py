"""Survey one tile: what each piece costs, how far out it reaches, what it hits.

    blender --background --factory-startup art/hexes/fields.blend \
        --python tools/blender/check_prop_overlap.py -- --prefix Fields

Three questions the other checkers do not ask:

1. What is on the tile. Every evaluated mesh, its face count, how many faces
   are smooth-shaded (should be zero; the board is flat-shaded), and its tallest
   point. `check_hexes.py` measures the contract; this measures the budget.

2. How far out it reaches. Hexagonal distance `t`: the largest of the six edge
   normals dotted into the point, over the apothem, measured from the hex
   centre. `t = 1` is the art hexagon's edge. Props stay inside `t = 0.88`, so
   the `past.88` column counts faces whose centre has crossed it. The ground
   and the rim are expected to score there.

3. What overlaps what. Every prop mesh is split into connected islands (one
   bush, one sheaf, one crop row) and each island's world-space AABB is tested
   against every other object's. Boxes can intersect while meshes do not, so a
   hit is a question to check at the board's 56-degree camera, not a verdict.
   A crop row against a hedge is fine; a hedge inside the flock is not.

The chip, the slab and the tile's own ground and rim are excluded from the
overlap pass: they are supposed to have things standing on them.
"""
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


PREFIX = opt("--prefix", "")
NEAR = float(opt("--near", "0.88"))
LIMIT = int(opt("--limit", "0"))          # 0 = print every overlapping pair

APOTHEM = 3.0 * math.sqrt(3) / 2
EDGE_NORMALS = [(math.cos(math.radians(60 * k)), math.sin(math.radians(60 * k))) for k in range(6)]

hexes = [o for o in bpy.data.objects if o.name.startswith("Hex_")]
CENTRE = hexes[0].matrix_world.translation if hexes else Vector((0, 0, 0))


def hex_t(p):
    """Hexagonal distance of a world point, from the hex centre."""
    dx, dy = p.x - CENTRE.x, p.y - CENTRE.y
    return max(dx * nx + dy * ny for nx, ny in EDGE_NORMALS) / APOTHEM


def islands(me):
    """Connected components of a mesh, as lists of polygon indices."""
    parent = list(range(len(me.polygons)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    by_vert = {}
    for p in me.polygons:
        for v in p.vertices:
            by_vert.setdefault(v, []).append(p.index)
    for group in by_vert.values():
        root = find(group[0])
        for other in group[1:]:
            r = find(other)
            if r != root:
                parent[r] = root
            root = find(root)
    out = {}
    for p in me.polygons:
        out.setdefault(find(p.index), []).append(p.index)
    return list(out.values())


def is_scenery(name):
    """True for a prop: something that stands ON the tile rather than being it."""
    return not (name.startswith("Hex_") or name.startswith("Chip_")
                or name.endswith("_ground") or name.endswith("_rim"))


dg = bpy.context.evaluated_depsgraph_get()
print("hex centre (%.4f, %.4f)" % (CENTRE.x, CENTRE.y))
print("%-24s %6s %7s %7s %8s %7s" % ("object", "faces", "smooth", "maxT", "past%.2f" % NEAR, "maxZ"))

total = 0
boxes = {}
for o in sorted(bpy.data.objects, key=lambda o: o.name):
    if o.type != "MESH":
        continue
    if PREFIX and not (o.name.startswith(PREFIX) or o.name.startswith("Hex_") or o.name.startswith("Chip_")):
        continue
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    M = ev.matrix_world
    if not me.polygons:
        ev.to_mesh_clear()
        continue
    smooth = sum(1 for p in me.polygons if p.use_smooth)
    pts = [M @ v.co for v in me.vertices]
    past = sum(1 for p in me.polygons if hex_t(M @ p.center) > NEAR)
    print("%-24s %6d %7d %7.3f %8d %7.3f" % (
        o.name, len(me.polygons), smooth, max(hex_t(p) for p in pts), past, max(p.z for p in pts)))
    total += len(me.polygons)
    if is_scenery(o.name):
        rows = []
        for faces in islands(me):
            vs = sorted({v for fi in faces for v in me.polygons[fi].vertices})
            q = [M @ me.vertices[v].co for v in vs]
            rows.append((Vector((min(p.x for p in q), min(p.y for p in q), min(p.z for p in q))),
                         Vector((max(p.x for p in q), max(p.y for p in q), max(p.z for p in q)))))
        boxes[o.name] = rows
    ev.to_mesh_clear()
print("TOTAL faces:", total)

print("\n=== prop-vs-prop island overlaps ===")
names = sorted(boxes)
hits = 0
for i in range(len(names)):
    for j in range(i + 1, len(names)):
        a_name, b_name = names[i], names[j]
        for ia, a in enumerate(boxes[a_name]):
            for ib, b in enumerate(boxes[b_name]):
                lo = Vector((max(a[0].x, b[0].x), max(a[0].y, b[0].y), max(a[0].z, b[0].z)))
                hi = Vector((min(a[1].x, b[1].x), min(a[1].y, b[1].y), min(a[1].z, b[1].z)))
                d = hi - lo
                if d.x > 0 and d.y > 0 and d.z > 0:
                    hits += 1
                    if not LIMIT or hits <= LIMIT:
                        print("  %s#%02d x %s#%02d by (%.4f, %.4f, %.4f)" % (
                            a_name, ia, b_name, ib, d.x, d.y, d.z))
print("total overlapping island pairs:", hits)
