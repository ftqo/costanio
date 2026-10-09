"""Prove the per-tile blends ship exactly what the monolith ships.

    blender --background --factory-startup --python tools/blender/split_verify.py

Opens each `art/hexes/<terrain>.blend` in turn, exports its tile through the
real exporter into a scratch directory, and byte-compares the result against
the committed `frontend/public/models/tiles/<resource>.glb`.

The split must change nothing, so this diffs the shipped bytes. If a tile
differs, the split is wrong, not the export.

Exit status is non-zero if any tile differs, so `make` can gate on it.
"""

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import export_assets  # noqa: E402
import naming  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HEXES = os.path.join(REPO, "art", "hexes")
SHIPPED = os.path.join(REPO, "frontend", "public", "models", "tiles")


def digest(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def compress(path):
    """Put a freshly exported tile through the same meshopt pass the shipped
    tiles went through.

    `make export-assets` writes plain float32 geometry and
    `frontend/scripts/compress-models.mjs` compresses it afterwards, so the
    scratch copy gets the same pass before the byte comparison.
    """
    script = os.path.join(REPO, "frontend", "scripts", "compress-models.mjs")
    subprocess.run(
        ["node", script, os.path.dirname(path)],
        cwd=os.path.join(REPO, "frontend"),
        check=True,
        stdout=subprocess.DEVNULL,
    )


def main():
    scratch = tempfile.mkdtemp(prefix="split_verify_")
    # Point the exporter's module-level TILES at the scratch tree.
    export_assets.TILES = scratch

    ok, bad, missing = [], [], []
    for terrain in sorted(naming.TERRAIN_TO_RESOURCE):
        resource = naming.TERRAIN_TO_RESOURCE[terrain]
        blend = os.path.join(HEXES, f"{terrain.lower()}.blend")
        if not os.path.exists(blend):
            missing.append(terrain)
            print(f"MISSING {terrain}: no {os.path.relpath(blend, REPO)}")
            continue

        bpy.ops.wm.open_mainfile(filepath=blend)
        written = export_assets.export_tiles()
        if resource not in written:
            missing.append(terrain)
            print(f"MISSING {terrain}: {blend} exported no {resource}")
            continue

        fresh = os.path.join(scratch, f"{resource}.glb")
        compress(fresh)
        shipped = os.path.join(SHIPPED, f"{resource}.glb")
        a, b = digest(fresh), digest(shipped)
        if a == b:
            ok.append(resource)
            print(f"SAME {resource:10s} {a[:16]} {os.path.getsize(fresh)} bytes")
        else:
            bad.append(resource)
            print(
                f"DIFF {resource:10s} split={a[:16]} ({os.path.getsize(fresh)} bytes) "
                f"shipped={b[:16]} ({os.path.getsize(shipped)} bytes)"
            )

    shutil.rmtree(scratch, ignore_errors=True)
    print(f"VERIFY same={len(ok)} diff={len(bad)} missing={len(missing)}")
    if bad or missing:
        print("VERIFY FAILED", "diff=", bad, "missing=", missing)
        sys.exit(1)
    print("VERIFY OK all tiles byte-identical to shipped")


main()
