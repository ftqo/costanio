"""Export the chosen robber designs as one shipping `.glb` per skin.

    python3 tools/robbers/export_skins.py
    make compress-models        # then this: what ships is meshopt-compressed

Writes `frontend/public/models/robbers/<design>.glb`, the files the store
sells and the board draws (`frontend/src/lib/robbers.ts`).

`tools/blender/export_robbers_glb.py` writes one gitignored `robbers.glb` with
every candidate for the dev shot harness. This writes the shipping art, one
file per design, so the board fetches only the skin in play.

It needs no Blender: the designs are lathe profiles and `robber_kit` is
arithmetic, so a design change is just `make robber-skins`.

## Output

One node per skin, named `Robber_<design>` (the prefix `subsetByPrefix`
selects on), holding three primitives, one per material slot. Materials are
`Mat_RobberSkin_{Body,Shade,Detail}` with their colour in `baseColorFactor`.
They are not in `palette.json`: `applyPalette` leaves unknown materials alone,
so a skin keeps its authored colour.

Flat normals, by duplicating vertices per triangle: the facets are the design.
"""

import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "tools", "blender"))

import robber_designs as rd  # noqa: E402

OUT_DIR = os.path.join(REPO, "frontend", "public", "models", "robbers")

#: The designs that ship, and what they cost in Pips.
#:
#: Every one of these is a design `robber_designs.CHROMAS` gives a colour to.
#: The monochrome designs are candidates and are not sold.
#:
#: The brigand and the sentinel are the cheap entry points (about a fortnight
#: of casual play); the rest cost three to five times that. Prices sit above
#: the 300-500 band in `docs/cosmetics.md`; at 30 Pips/day the crystal is about
#: eleven weeks of play.
SKINS = {
    "brigand": ("Brigand", 350),
    "sentinel": ("Sentinel", 400),
    "keg": ("Keg", 900),
    "crow": ("Crow", 1200),
    "hourglass": ("Hourglass", 1600),
    "brazier": ("Brazier", 1800),
    "shard": ("Crystal", 2400),
}

#: Material per slot. Not in palette.json (see the module docstring).
MATERIAL = {
    "body": "Mat_RobberSkin_Body",
    "shade": "Mat_RobberSkin_Shade",
    "detail": "Mat_RobberSkin_Detail",
}

#: Roughness/metalness for a skin, matching the shipped Mat_Robber entry so a
#: bought robber is lit like the one it replaces.
ROUGHNESS, METALNESS = 0.6, 0.0


def triangles(faces):
    """Every face as a triangle fan. Quads and n-gons both arrive here."""
    for f in faces:
        for k in range(1, len(f) - 1):
            yield (f[0], f[k], f[k + 1])


def flat_mesh(verts, faces):
    """Positions and normals for flat-shaded triangles, in glTF's axes.

    Blender is Z-up and glTF is Y-up; this applies the same conversion as
    Blender's exporter: (x, y, z) -> (x, z, -y).
    """
    pos, nrm = [], []
    for tri in triangles(faces):
        a, b, c = (verts[i] for i in tri)
        p = [(v[0], v[2], -v[1]) for v in (a, b, c)]
        ux, uy, uz = (p[1][i] - p[0][i] for i in range(3))
        vx, vy, vz = (p[2][i] - p[0][i] for i in range(3))
        n = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
        length = math.sqrt(sum(c * c for c in n)) or 1.0
        n = tuple(c / length for c in n)
        pos.extend(p)
        nrm.extend([n, n, n])
    return pos, nrm


def write_glb(path, design, parts, colors):
    """One .glb: a node per skin, a primitive per material slot."""
    buf = bytearray()
    accessors, materials, primitives = [], [], []
    buffer_views = []

    for slot in ("body", "shade", "detail"):
        chunk = [p for p in parts if p.slot == slot]
        if not chunk:
            continue
        pos, nrm = [], []
        for part in chunk:
            p, n = flat_mesh(part.verts, part.faces)
            pos.extend(p)
            nrm.extend(n)
        if not pos:
            continue

        first = len(accessors)
        for data, kind in ((pos, "POSITION"), (nrm, "NORMAL")):
            offset = len(buf)
            for v in data:
                buf.extend(struct.pack("<3f", *v))
            buffer_views.append(
                {"buffer": 0, "byteOffset": offset, "byteLength": len(buf) - offset}
            )
            acc = {
                "bufferView": len(buffer_views) - 1,
                "componentType": 5126,  # FLOAT
                "count": len(data),
                "type": "VEC3",
            }
            if kind == "POSITION":
                # min/max are required on POSITION, and they are also what the
                # frontend's envelope test measures the shipped file with.
                acc["min"] = [min(v[i] for v in data) for i in range(3)]
                acc["max"] = [max(v[i] for v in data) for i in range(3)]
            accessors.append(acc)

        rgb = colors[slot]
        materials.append(
            {
                "name": MATERIAL[slot],
                "pbrMetallicRoughness": {
                    # glTF baseColorFactor is linear, and so are the design
                    # colours (Blender Base Color and palette.json both are),
                    # so these pass through untouched.
                    "baseColorFactor": [rgb[0], rgb[1], rgb[2], 1.0],
                    "metallicFactor": METALNESS,
                    "roughnessFactor": ROUGHNESS,
                },
            }
        )
        primitives.append(
            {
                "attributes": {"POSITION": first, "NORMAL": first + 1},
                "material": len(materials) - 1,
            }
        )

    while len(buf) % 4:
        buf.append(0)

    gltf = {
        "asset": {"version": "2.0", "generator": "tools/robbers/export_skins.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": f"Robber_{design}", "mesh": 0}],
        "meshes": [{"name": f"Robber_{design}", "primitives": primitives}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(buf)}],
    }

    js = json.dumps(gltf, separators=(",", ":")).encode("utf8")
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(buf)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A))
        fh.write(js)
        fh.write(struct.pack("<II", len(buf), 0x004E4942))
        fh.write(buf)
    return total


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for design, (label, price) in sorted(SKINS.items()):
        parts = rd.build(design)
        colors = rd.colors(design, rd.BASE_CHROMA)
        path = os.path.join(OUT_DIR, f"{design}.glb")
        size = write_glb(path, design, parts, colors)
        print(f"{design:10s} {label:10s} {price:4d} Pips  {size / 1024:6.1f} KB  {path}")


if __name__ == "__main__":
    main()
