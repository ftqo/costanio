"""Export every tile .glb from its own per-tile blend.

    blender --background --factory-startup --python tools/blender/export_tiles.py

The per-tile files are where tiles are AUTHORED, so they have to be where tiles
are exported from -- otherwise a tile edited in `art/hexes/pasture.blend` never
reaches the game, and two files quietly disagree about what the pasture looks
like. That divergence is the whole bug class the split existed to remove, and
it is now the rule for every asset: one blend, one .glb.

This is the FAST half, for the live watcher: name a terrain after `--` and it
re-exports that one tile. `make export-assets` runs `export_assets.py`, which
walks every blend in the pipeline -- these and the families beside them --
and is the only thing that can write the manifest and the write-once palette,
because both are properties of every blend at once.

Byte-for-byte the same exporter: this drives `export_assets.export_tiles`
against one per-tile blend at a time, which is exactly what `split_verify.py`
does to prove the split ships identical bytes. Nothing here reimplements the
export, so the two cannot drift.
"""

import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import export_assets  # noqa: E402
import naming  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def wanted():
    """Terrains named after `--`, or all of them.

    The live watcher re-exports ONE tile per save, because opening every
    blend and exporting every .glb takes about a second and a half and the
    point of a watcher is that the loop feels immediate.
    """
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    names = [a for a in argv if not a.startswith("-")]
    if not names:
        return sorted(naming.TERRAIN_TO_RESOURCE)
    out = []
    for name in names:
        match = next(
            (t for t in naming.TERRAIN_TO_RESOURCE if t.lower() == name.lower()), None
        )
        if match is None:
            raise SystemExit(f"unknown terrain {name!r}")
        out.append(match)
    return out


def main():
    written, missing = [], []
    for terrain in wanted():
        blend = export_assets.hex_blend(terrain)
        if not os.path.exists(blend):
            missing.append(terrain)
            print(f"MISSING {terrain}: no {os.path.relpath(blend, REPO)}")
            continue
        bpy.ops.wm.open_mainfile(filepath=blend)
        for resource in export_assets.export_tiles():
            written.append(resource)

    print("TILES_WRITTEN", len(written))
    if missing:
        print("TILES_MISSING", missing)
        sys.exit(1)


main()
