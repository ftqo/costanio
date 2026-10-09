"""Link every per-tile blend into one assembly you can look at.

    blender --background --factory-startup --python tools/blender/build_board.py

Writes `art/board.blend`: all eleven tiles, linked, staged on the lattice.

This file is for viewing; edit the per-tile files. Linked data is read-only, so
a tile is judged among its neighbours while edits stay in one tile's file.
Re-run after editing a tile.

No restaging: each tile blend keeps its world transform, which is already an
exact lattice cell (the water tiles carry their 1.0481 lattice-cell scale).

It does not show what the runtime adds (gutter sand, coastline, harbour ratio
sign) or the palette's colour overrides; `make board-shot` renders those.
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import naming  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HEXES = os.path.join(REPO, "art", "hexes")
OUT = os.path.join(REPO, "art", "board.blend")


def clear():
    """Empty the factory scene, cube, camera, light and all."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def link_tile(terrain):
    """Link every object of one tile blend into a collection of its own."""
    path = os.path.join(HEXES, f"{terrain.lower()}.blend")
    if not os.path.exists(path):
        print(f"SKIP {terrain}: no {os.path.relpath(path, REPO)}")
        return 0

    with bpy.data.libraries.load(path, link=True) as (source, target):
        target.objects = list(source.objects)

    # A collection per tile, so one tile can be hidden while judging another.
    collection = bpy.data.collections.new(f"Tile_{terrain}")
    bpy.context.scene.collection.children.link(collection)

    linked = 0
    for obj in target.objects:
        if obj is None:
            continue
        collection.objects.link(obj)
        linked += 1
    print(f"LINK {terrain:11s} {linked:3d} objects <- {os.path.relpath(path, REPO)}")
    return linked


def main():
    clear()
    total = sum(link_tile(t) for t in sorted(naming.TERRAIN_TO_RESOURCE))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
    print(f"BOARD {os.path.relpath(OUT, REPO)}: {total} linked objects")


main()
