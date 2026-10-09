"""Build `art/cargo.blend` from `cargo_kit.py`.

    blender --background --factory-startup --python tools/blender/gen/cargo.py

Generated, not authored: do not model in the blend, the next run overwrites
it. Change a number in `cargo_kit.py`, re-run, then `make export-assets`. The
pieces must agree with numbers owned elsewhere (the hold recess on
`art/vessels`, the harbour basin on `art/harbors`), which is easier to test in
python than in a binary.

The script:

 1. Appends `Seat_Body` and `Seat_Shade` from `art/pieces.blend` rather than
    recreating them, which would cause a `PALETTE_CONFLICT`.
 2. Recalculates every normal outward (`cargo_kit` returns closed manifolds),
    so no face needs hand winding.
 3. Parks the three pieces apart as object locations, which
    `export_assets.recenter` subtracts on export (ROOT).
"""

import os
import sys

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(TOOLS, "..", ".."))
sys.path.insert(0, TOOLS)

import cargo_kit as ck  # noqa: E402

PIECES = os.path.join(REPO, "art", "pieces.blend")
OUT = os.path.join(REPO, "art", "cargo.blend")

#: One collection per piece, named like the export prefix (as in
#: `art/fishing.blend` and `art/camels.blend`).
COLLECTIONS = {"Haul_": "Haul", "Spice_": "Spice", "Marker_": "Marker"}

#: The seat slots, copied not created. See the docstring.
SEAT_SLOTS = ("Seat_Body", "Seat_Shade")


def clear():
    for coll in (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.collections,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for item in list(coll):
            coll.remove(item)


def append_seat_slots():
    """Bring `Seat_Body` and `Seat_Shade` in from the stock piece set."""
    with bpy.data.libraries.load(PIECES) as (src, dst):
        missing = [n for n in SEAT_SLOTS if n not in src.materials]
        if missing:
            raise SystemExit(f"{PIECES} has no {missing}")
        dst.materials = list(SEAT_SLOTS)
    print("APPENDED", [m.name for m in dst.materials], "from", os.path.relpath(PIECES, REPO))


def flat_material(name, spec):
    """One flat Principled colour. No textures anywhere in this pack."""
    mat = bpy.data.materials.new(name)
    # No `use_nodes = True`: it is the default and deprecated from Blender 6.0.
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*spec["color"], 1.0)
    bsdf.inputs["Roughness"].default_value = spec["roughness"]
    bsdf.inputs["Metallic"].default_value = spec["metalness"]
    return mat


def build(name, verts, faces, material):
    """One object, one mesh, one material slot, every polygon flat."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()

    # Outward, once, for every closed manifold `cargo_kit` returns, so that
    # module need not wind faces by hand.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    mesh.materials.append(material)
    for poly in mesh.polygons:
        poly.material_index = 0
        # Flat shading (house style), set explicitly.
        poly.use_smooth = False

    obj = bpy.data.objects.new(name, mesh)
    for prefix, coll_name in COLLECTIONS.items():
        if name.startswith(prefix):
            bpy.data.collections[coll_name].objects.link(obj)
            obj.location = (*ck.LAYOUT[prefix], 0.0)
            return obj
    raise SystemExit(f"{name} matches none of {sorted(COLLECTIONS)}")


def main():
    clear()
    append_seat_slots()
    for coll_name in COLLECTIONS.values():
        bpy.context.scene.collection.children.link(bpy.data.collections.new(coll_name))

    for name, spec in ck.MATERIALS.items():
        flat_material(name, spec)

    for name, builder, material in ck.PARTS:
        verts, faces = builder()
        obj = build(name, verts, faces, bpy.data.materials[material])
        lo, hi = ck.bounds(verts)
        print(
            f"PART {name:14s} f={len(faces):4d} v={len(verts):4d} {material:16s} "
            f"size=({hi[0] - lo[0]:.3f}, {hi[1] - lo[1]:.3f}, {hi[2] - lo[2]:.3f}) "
            f"base_z={lo[2]:.4f} at={tuple(round(c, 3) for c in obj.location)}"
        )

    bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
    print("WROTE", OUT)
    print(f"stacking: sack pitch {ck.SACK_PITCH}, tier {ck.SACK_TIER}; marker {ck.MARKER_STACK}")


# Guarded so the module can be imported for `build` without wiping the open
# file, the way `build_robbers.py` is.
if __name__ == "__main__":
    main()
