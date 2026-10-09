"""Export the Wagons trade-town PARTS for the export-time composer.

    blender --background --factory-startup --python tools/blender/export_trade_parts.py

Reads `art/trade/parts.blend` and writes, under `art/trade/parts/`:

  town_tile.glb           the plaza every direction shares (tile frame, never turned)
  town_w.glb, town_sw.glb the two town layouts the six directions are made from
  laketown_<dir>.glb      the lake towns, one per direction, tile frame
  spots.json              heroes, spots, per-ground rules and every part's role

None of these ship. They are the composer's input, so they are
not in `naming.TERRAIN_TO_RESOURCE` and never reach the manifest; the composed
tiles are what ship. The glb files go through `export_assets.export_glb` with
`staged=False` (authored at the origin, square), so they are byte-for-byte what
the tile exporter would have written for the same objects.

The names are the contract: `naming.parse_trade_part`, `parse_trade_hero`,
`parse_trade_spot` and `parse_trade_river_spot`.
"""

import json
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import export_assets  # noqa: E402
import naming  # noqa: E402

REPO = export_assets.REPO
SOURCE = os.path.join(REPO, "art", "trade", "parts.blend")
OUT = os.path.join(REPO, "art", "trade", "parts")


def tri_count(obj):
    if obj.type != "MESH":
        return 0
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def both(x, y):
    """A tile-frame point in both frames: Blender (x, y) and glTF file (x, z=-y)."""
    return {"blender": [round(x, 4), round(y, 4)], "file": [round(x, 4), round(-y, 4)]}


def footprint_r(obj):
    """Radius of the part's footprint about its own origin (its seat)."""
    if obj.type != "MESH" or not obj.data.vertices:
        return 0.0
    s = max(obj.scale.x, obj.scale.y)
    return round(max(math.hypot(v.co.x, v.co.y) for v in obj.data.vertices) * s, 4)


def roots():
    """(glb stem, root object) for every part root in the blend, in a stable order."""
    out = []
    for name in ["Town_Tile", "Town_W", "Town_SW"] + [f"LakeTown_{d}" for d in naming.TRADE_LAKE_DIRS]:
        obj = bpy.data.objects.get(name)
        if obj is not None:
            out.append((name.lower(), obj))
    return out


def export_parts():
    parts = {}
    os.makedirs(OUT, exist_ok=True)
    for stem, root in roots():
        group = export_assets.descendants(root)
        meshes = [o for o in group if o.type == "MESH"]
        for obj in meshes:
            parsed = naming.parse_trade_part(obj.name)
            if parsed is None:
                raise SystemExit(f"TRADE_PARTS {obj.name} is not a trade part name")
            kind, key, part, num, role = parsed
            parts[obj.name] = {
                "file": f"{stem}.glb",
                "role": role,
                "tris": tri_count(obj),
                "seat": both(obj.location.x, obj.location.y),
                "yaw": round(math.degrees(obj.rotation_euler.z), 3),
                "footprint_r": footprint_r(obj),
                "materials": [m.name for m in obj.data.materials if m],
            }
            for key_ in ("corner_deg",):
                if key_ in obj:
                    parts[obj.name][key_] = obj[key_]
        export_assets.export_glb([root] + meshes, os.path.join(OUT, f"{stem}.glb"), staged=False)
        print("TRADE_PARTS", stem, len(meshes), "meshes", sum(tri_count(o) for o in meshes), "tris")
    return parts


def prop_list(obj, key):
    raw = obj.get(key, "")
    return [s for s in str(raw).split(",") if s]


def heroes_and_spots():
    grounds = {}
    for g in naming.TRADE_GROUNDS:
        info = bpy.data.objects.get(f"Ground_{g}")
        entry = {"heroes": {}, "spots": {}, "river_spots": {}}
        if info is not None:
            entry["yard_material"] = info.get("yard_material")
            entry["keep"] = json.loads(info.get("keep", "{}"))
            if "note" in info:
                entry["note"] = info["note"]
        grounds[g] = entry
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
        hero = naming.parse_trade_hero(obj.name)
        if hero:
            g, h = hero
            sel = obj.get("select_r", -1.0)
            grounds[g]["heroes"][h] = {
                "nodes": prop_list(obj, "nodes"),
                "anchor": both(obj.location.x, obj.location.y),
                "select_r": None if sel is None or sel < 0 else round(sel, 4),
                "footprint_r": round(obj.get("footprint_r", 0.0), 4),
                "ground_bound": bool(obj.get("ground_bound", False)),
                "fixed": bool(obj.get("fixed", False)),
                "drape": bool(obj.get("drape", False)),
                "note": obj.get("note", ""),
            }
            continue
        spot = naming.parse_trade_spot(obj.name)
        river = naming.parse_trade_river_spot(obj.name)
        if spot or river:
            if spot:
                g, key, h, alt = spot
                bucket = grounds[g]["spots"].setdefault(key, {})
            else:
                g, key, h, alt = river
                bucket = grounds[g]["river_spots"].setdefault(key, {})
            rec = both(obj.location.x, obj.location.y)
            rec["yaw"] = round(math.degrees(obj.rotation_euler.z), 3)
            rec["scale"] = round(obj.scale.x, 4)
            rec["stays"] = bool(obj.get("stays", False))
            bucket[h + ("_alt" if alt else "")] = rec
    return grounds


def main():
    bpy.ops.wm.open_mainfile(filepath=SOURCE)
    parts = export_parts()
    doc = {
        "version": 1,
        "frame": "Blender tile frame (hex centre origin, +z up, chip socket (0, 1.5, 0.26)); "
        "file = glTF frame (x, z=-y); yaws CCW about Blender +z == about three.js +y",
        "dir_angle": naming.TRADE_DIR_ANGLE,
        "layout": {d: list(v) for d, v in naming.TRADE_LAYOUT.items()},
        "chip": {"blender": [0.0, 1.5], "keep_clear_r": 1.05, "underside_z": 0.249},
        "parts": parts,
        "grounds": heroes_and_spots(),
    }
    with open(os.path.join(OUT, "spots.json"), "w") as fh:
        json.dump(doc, fh, indent=1, sort_keys=True)
        fh.write("\n")
    print("TRADE_PARTS spots.json", sum(len(g["spots"]) for g in doc["grounds"].values()), "directions")


main()
