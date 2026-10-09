"""Export the robber prototypes as `frontend/public/models/robbers.glb`.

    blender --background --factory-startup --python tools/blender/export_robbers_glb.py

For the frontend's shot rig: `thumbnail.ts` loads a `.glb` and takes every node
whose name starts with a prefix.

Not part of `export_assets.py`, which exports the shipping board; these are
prototypes regenerated from `robber_designs.py` and must not reach the
manifest.

Every design and chroma is exported at the origin under its own name
(`Robber_shard__verdant`), so a shot selects one by prefix. They overlap in the
file; nothing loads two at once. See `build_robbers.node_name` for the double
underscore.
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assetmeta  # noqa: E402
import build_robbers as br  # noqa: E402
import robber_designs as rd  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "frontend", "public", "models", "robbers.glb")


def main():
    br.clear()
    count = 0
    for name in ["classic"] + rd.ORDER:
        for chroma in rd.chromas(name):
            # One node per design and chroma, duplicating geometry, because the
            # shot rig selects by node name. The shipping path applies chroma
            # colours to one mesh at load instead.
            obj = br.make(name, rd.build(name), chroma=chroma)
            obj.name = br.node_name(name, chroma)
            obj.data.name = obj.name
            obj.location = (0.0, 0.0, 0.0)
            count += 1

    for obj in bpy.data.objects:
        obj.select_set(True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        # Flat-shaded pieces: no UVs, tangents or animation to carry.
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
    # Drop the exporter's signature (see assetmeta).
    assetmeta.strip_path(OUT)
    print(f"WROTE {OUT}: {count} pieces ({len(rd.ORDER) + 1} designs)")


if __name__ == "__main__":
    main()
