"""Rewrite `art/beach.blend`'s beach meshes from `lattice.py`.

    make beach-mirror

The beach in that file mirrors `frontend/src/lib/board3d/beachGeometry.ts`
(see lattice.py): four canonical objects that ship in beach.glb, so
`assetAnchors.test.ts` can check art against renderer, plus the `Ref_Beach_*`
staging the exporter drops. Each is `lattice.beach_strip` or
`lattice.beach_connector` in local coordinates, turned into place by its
object transform.

To change the beach: change the TypeScript, change lattice.py to match
(`test_lattice.py` fails until you do), run this, re-export.

It replaces mesh data in place on the objects it recognises by name, and
leaves materials, object transforms and `Beach_path_swatch` alone. It refuses
to run if a mesh it would rewrite has a vertex count the mirror does not
produce, since that means the naming convention has drifted.
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lattice  # noqa: E402  (after the path insert)

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BLEND = os.path.join(REPO, "art", "beach.blend")


def kind_of(name):
    """`dry` or `wet` off the name's suffix, or None if it is not a beach."""
    for kind in lattice.BEACH_KINDS:
        if name.endswith("_" + kind):
            return kind
    return None


def shape_of(name):
    """Which of the two cross-sections a name asks for.

    The convention the blend already uses: `..._e<n>_<kind>` is a strip along an
    edge, `..._c<n>_<kind>` is the wedge at a corner. `Connector_beach_*` is
    always a wedge, and is named `_c0_` too.
    """
    body = name.rsplit("_", 1)[0]
    tail = body.rsplit("_", 1)[-1]
    if tail.startswith("e") and tail[1:].isdigit():
        return "strip"
    if tail.startswith("c") and tail[1:].isdigit():
        return "connector"
    return None


def targets():
    """Every object in the open blend whose mesh this file owns."""
    out = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        # `Ref_Beach_*` is staging the exporter drops; terrain art is modelled
        # against it, so it carries the same cross-section as the shipped four.
        if not obj.name.startswith(("Beach_", "Connector_beach", "Ref_Beach_")):
            continue
        kind = kind_of(obj.name)
        shape = shape_of(obj.name)
        if kind is None or shape is None:
            # `Beach_path_swatch` lands here: it only carries a material.
            continue
        out.append((obj, kind, shape))
    return out


def rebuild(obj, kind, shape):
    """Replace one object's mesh with the mirror's, keeping its materials."""
    verts, faces = (
        lattice.beach_strip(kind) if shape == "strip" else lattice.beach_connector(kind)
    )
    mesh = obj.data
    if len(mesh.vertices) != len(verts) or len(mesh.polygons) != len(faces):
        raise SystemExit(
            f"REFUSING {obj.name}: has {len(mesh.vertices)}v/{len(mesh.polygons)}f, "
            f"the mirror builds {len(verts)}v/{len(faces)}f -- the naming has drifted"
        )
    materials = [m for m in mesh.materials]
    mesh.clear_geometry()
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for material in materials:
        mesh.materials.append(material)
    return max(v[2] for v in verts)


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    crest = None
    rebuilt = 0
    for obj, kind, shape in sorted(targets(), key=lambda t: t[0].name):
        crest = rebuild(obj, kind, shape)
        rebuilt += 1
        print(f"REBUILT {obj.name} ({shape}, {kind})")
    if not rebuilt:
        raise SystemExit("REFUSING: found no beach meshes to rebuild")
    bpy.ops.wm.save_mainfile(filepath=BLEND)
    print(f"BEACH_MIRROR {rebuilt} meshes, crest {crest:.4f}")


if __name__ == "__main__":
    main()
