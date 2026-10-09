"""Measure how much of each hex reads as brown, green, gold or its own colour.

    blender art/board.blend --background --python tools/blender/hex_color_audit.py
    blender art/hexes/fields.blend --background --python tools/blender/hex_color_audit.py

Run against `art/board.blend` (the linked assembly, `make board`) to audit
every tile at once, or against one `art/hexes/<terrain>.blend` to audit that
tile alone. Naming terrains after `--` narrows whichever file is open.

It measures area, not face count (faces vary widely in size): each face
projected onto XY, summed per material. The game camera sits at 56 degrees of
elevation, where near-flat ground dominates (see `render_hexes.py`).

The slab `Hex_<Terrain>` is excluded (its top is covered and its bottom never
seen), as are chips, tokens and `Ref_*` mirror geometry.

Buckets are cut by hue and lightness rather than material name. The important
cut is between `gold` and `brown` in the 15-65 degree band: dark
low-saturation earth is brown, bright saturated straw is gold.

Prints a per-material table, bucket totals, and a `BUCKET <hex> <name> <area>`
line per bucket that a test or a script can grep rather than parse.
"""

import sys
import colorsys
from collections import defaultdict

import bpy

#: Meshes that are staging, mirror geometry, or buried. See the docstring.
SKIP_PREFIXES = ("Chip_", "Ref_", "Token_", "Beach_", "Connector_", "Robber_", "Ocean_")


def base_color(mat):
    """The Principled BSDF base colour, the only colour that ships."""
    if not mat or not mat.node_tree:
        return None
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if not bsdf:
        return None
    c = bsdf.inputs["Base Color"].default_value
    return (c[0], c[1], c[2])


def classify(rgb):
    """Bucket a base colour the way an eye at board distance does."""
    h, l, s = colorsys.rgb_to_hls(*rgb)
    hdeg = h * 360.0
    if s < 0.12:
        return "neutral"
    if 65 <= hdeg <= 175:
        return "green"
    if 40 <= hdeg < 65:
        # Straw and soil share this band. Brightness and saturation split them.
        return "gold" if (l > 0.33 and s > 0.35) else "brown"
    if 15 <= hdeg < 40:
        return "gold" if (l > 0.55 and s > 0.45) else "brown"
    if hdeg < 15 or hdeg > 330:
        return "red"
    return "other"


def projected_area(obj, poly):
    """Shoelace of the face's XY projection, in world space."""
    mw = obj.matrix_world
    verts = [mw @ obj.data.vertices[i].co for i in poly.vertices]
    a = 0.0
    for i in range(len(verts)):
        x1, y1 = verts[i].x, verts[i].y
        x2, y2 = verts[(i + 1) % len(verts)].x, verts[(i + 1) % len(verts)].y
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def descendants(obj):
    yield obj
    for child in obj.children:
        yield from descendants(child)


def audit(terrain):
    """Return (per_material, per_object_material) areas for one hex."""
    root = bpy.data.objects.get(f"Hex_{terrain}")
    if root is None:
        return None, None
    per_mat = defaultdict(float)
    per_obj = defaultdict(float)
    for obj in descendants(root):
        # The slab itself is `Hex_<Terrain>`; its top is covered and its bottom
        # never seen.
        if obj.type != "MESH" or obj is root or obj.name.startswith(SKIP_PREFIXES):
            continue
        mats = obj.data.materials
        for poly in obj.data.polygons:
            area = projected_area(obj, poly)
            mat = mats[poly.material_index] if mats else None
            name = mat.name if mat else "<none>"
            per_mat[name] += area
            per_obj[(obj.name, name)] += area
    return per_mat, per_obj


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if argv:
        terrains = argv
    else:
        terrains = sorted(
            o.name[len("Hex_") :]
            for o in bpy.data.objects
            if o.name.startswith("Hex_") and o.type == "MESH"
        )

    for terrain in terrains:
        per_mat, per_obj = audit(terrain)
        if per_mat is None:
            print(f"!! no Hex_{terrain}")
            continue
        total = sum(per_mat.values()) or 1.0
        print("=" * 86)
        print(f"{terrain}   visible projected area {total:.3f}")
        print("=" * 86)
        buckets = defaultdict(float)
        rows = []
        for name, area in per_mat.items():
            rgb = base_color(bpy.data.materials.get(name))
            cls = classify(rgb) if rgb else "?"
            buckets[cls] += area
            rows.append((area, name, rgb, cls))
        for area, name, rgb, cls in sorted(rows, reverse=True):
            rgbs = f"({rgb[0]:.2f},{rgb[1]:.2f},{rgb[2]:.2f})" if rgb else "?"
            print(f"  {name:32s} {area:8.3f}  {100 * area / total:5.1f}%  {rgbs:20s} {cls}")

        print("  --- buckets ---")
        for cls, area in sorted(buckets.items(), key=lambda kv: -kv[1]):
            print(f"  {cls:10s} {area:8.3f}  {100 * area / total:5.1f}%")

        print("  --- brown and green, by the object carrying them ---")
        for (oname, mname), area in sorted(per_obj.items(), key=lambda kv: -kv[1]):
            rgb = base_color(bpy.data.materials.get(mname))
            cls = classify(rgb) if rgb else "?"
            if cls in ("brown", "green"):
                print(f"  {oname:24s} {mname:30s} {cls:6s} {area:8.3f}")

        # Greppable, so a check can assert a ratio without parsing the table.
        for cls, area in sorted(buckets.items()):
            print(f"BUCKET {terrain} {cls} {area:.4f}")
        print(f"BUCKET {terrain} TOTAL {total:.4f}")


main()
