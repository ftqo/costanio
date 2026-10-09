"""Build `art/robbers.blend` from `robber_designs.py`.

    blender --background --factory-startup --python tools/blender/build_robbers.py
    # or: make robbers

Generated, not authored: do not model in the blend, the next run overwrites
it. Change a profile in `robber_designs.py` and re-run. These are candidates
to review, kept as profiles so they diff and regenerate.

The file lays the set out as a lineup on a grid, plus a row of the base
robber in each finish, so opening it shows the whole set at once.
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import robber_designs as rd  # noqa: E402
from robber_kit import BASE_HEIGHT, BASE_RADIUS  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "art", "robbers.blend")

#: Grid the lineup is laid out on. Wide enough that neighbours do not touch
#: at 0.45 radius, tight enough that the whole set frames in one shot.
COLS = 5
PITCH = 1.4

#: The recolour channel. `Robber_Body` is the mass, `Robber_Shade` what sits
#: under or behind it, `Robber_Detail` the accent. Defaults to
#: `robber_designs.MONOCHROME`, the shipped near-black.
BASE_COLORS = rd.MONOCHROME

#: Finishes: the same geometry under different Principled settings, per slot.
#:
#: `palette.json` carries only color, roughness and metalness (`PaletteEntry`
#: in `frontend/src/lib/board3d/palette.ts`), which covers matte, chrome and
#: pitch. Glass needs transmission and IOR added to the schema before it can
#: be a runtime restyle.
FINISHES = {
    "matte": {
        slot: {"color": c, "metallic": 0.0, "roughness": 0.6} for slot, c in BASE_COLORS.items()
    },
    "chrome": {
        "body": {"color": (0.78, 0.79, 0.82), "metallic": 1.0, "roughness": 0.12},
        "shade": {"color": (0.35, 0.36, 0.39), "metallic": 1.0, "roughness": 0.30},
        "detail": {"color": (0.95, 0.93, 0.86), "metallic": 1.0, "roughness": 0.05},
    },
    "pitch": {
        # Flat black: high roughness and a colour near zero. The three slots
        # barely differ, so only the outline reads.
        "body": {"color": (0.012, 0.012, 0.014), "metallic": 0.0, "roughness": 0.95},
        "shade": {"color": (0.006, 0.006, 0.007), "metallic": 0.0, "roughness": 0.95},
        "detail": {"color": (0.020, 0.020, 0.023), "metallic": 0.0, "roughness": 0.85},
    },
    # Not a shipping finish: a studio clay for judging form, since near-black
    # art reads as a dark lump in review renders. `render_robbers.py` shoots
    # study frames in this and board frames in `matte`.
    "clay": {
        "body": {"color": (0.52, 0.47, 0.44), "metallic": 0.0, "roughness": 0.75},
        "shade": {"color": (0.31, 0.28, 0.27), "metallic": 0.0, "roughness": 0.85},
        "detail": {"color": (0.72, 0.66, 0.60), "metallic": 0.0, "roughness": 0.65},
    },
    "glass": {
        "body": {
            "color": (0.62, 0.72, 0.78), "metallic": 0.0, "roughness": 0.05,
            "transmission": 1.0, "ior": 1.45,
        },
        # Opaque foot: a fully transmissive plinth reads as a puddle instead of
        # as a piece standing on the tile.
        "shade": {"color": (0.10, 0.12, 0.14), "metallic": 0.0, "roughness": 0.35},
        "detail": {
            "color": (0.75, 0.80, 0.72), "metallic": 0.0, "roughness": 0.03,
            "transmission": 1.0, "ior": 1.55,
        },
    },
}


def material(name, spec):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    r, g, b = spec["color"]
    bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    bsdf.inputs["Metallic"].default_value = spec["metallic"]
    bsdf.inputs["Roughness"].default_value = spec["roughness"]
    if "transmission" in bsdf.inputs or "Transmission Weight" in bsdf.inputs:
        key = "Transmission Weight" if "Transmission Weight" in bsdf.inputs else "transmission"
        bsdf.inputs[key].default_value = spec.get("transmission", 0.0)
    bsdf.inputs["IOR"].default_value = spec.get("ior", 1.5)
    mat.blend_method = "BLEND" if spec.get("transmission") else "OPAQUE"
    return mat


def materials_for(finish, design=None, chroma=rd.BASE_CHROMA):
    """The three slot materials for a finish, in `rd.SLOTS` order.

    Matte is the design's own colours in the named chroma; every other finish
    overrides all three and is shared across the set. A finish and a chroma
    are the same channel, and a finish wins.

    Materials are named per design and per chroma (`Robber_shard_verdant_Body`)
    because Blender and glTF key materials by name; a shared name would give
    every design the colours built last.
    """
    if finish != "matte":
        return [material(f"Robber_{finish}_{s.capitalize()}", FINISHES[finish][s]) for s in rd.SLOTS]
    colors = rd.colors(design, chroma) if design else BASE_COLORS
    stem = "Robber"
    if design and rd.is_colored(design):
        stem = f"Robber_{design}" if chroma == rd.BASE_CHROMA else f"Robber_{design}_{chroma}"
    return [
        material(f"{stem}_{s.capitalize()}",
                 {"color": colors[s], "metallic": 0.0, "roughness": 0.6})
        for s in rd.SLOTS
    ]


def node_name(design, chroma=rd.BASE_CHROMA):
    """What a piece is called in the blend and in the glTF.

    Double underscore before the chroma, so a name works as a prefix without
    matching its own variants (`thumbnail.ts` selects by node-name prefix).
    """
    return f"Robber_{design}__{chroma}"


def make(name, parts, finish="matte", suffix="", chroma=rd.BASE_CHROMA):
    """One object per design: parts merged, one material slot each."""
    verts, faces, slots = [], [], []
    for p in parts:
        off = len(verts)
        verts += list(p.verts)
        faces += [tuple(i + off for i in f) for f in p.faces]
        slots += [rd.SLOTS.index(p.slot)] * len(p.faces)

    mesh = bpy.data.meshes.new(f"Robber_{name}{suffix}")
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    for mat in materials_for(finish, design=name, chroma=chroma):
        mesh.materials.append(mat)
    for poly, slot in zip(mesh.polygons, slots):
        poly.material_index = slot
    # Flat shading: these are faceted pieces.
    for poly in mesh.polygons:
        poly.use_smooth = False

    obj = bpy.data.objects.new(f"Robber_{name}{suffix}", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def clear():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(coll):
            coll.remove(item)


def main():
    clear()

    # The base robber first, apart from the grid, as the reference.
    base = make("classic", rd.classic())
    base.location = (-PITCH * 1.6, PITCH * 1.6, 0.0)

    for i, name in enumerate(rd.ORDER):
        obj = make(name, rd.build(name))
        obj.location = (PITCH * (i % COLS), -PITCH * (i // COLS), 0.0)

    # The finish row: same geometry, four material sets.
    for i, finish in enumerate(f for f in FINISHES if f != "matte"):
        obj = make("classic", rd.classic(), finish=finish, suffix=f"_{finish}")
        obj.location = (-PITCH * 1.6, PITCH * (1.6 - 1.2 * (i + 1)), 0.0)

    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print(f"WROTE {OUT}: {len(rd.ORDER)} designs + classic in {len(FINISHES)} finishes")
    print(f"envelope: {BASE_HEIGHT} tall, {BASE_RADIUS} radius")


# Guarded, because `render_robbers.py` imports this module for `make` and
# `FINISHES` and must not have the open board wiped and overwritten by a save.
if __name__ == "__main__":
    main()
