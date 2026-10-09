"""Take the fold out of every river tile's water sheet, in the blends.

    blender --background --factory-startup \
        --python tools/blender/unfold_river_water.py -- [--dry-run] [tile ...]

Then `make export-tiles` (which re-exports the .glb and meshopt-compresses it)
and `make check-hexes`.

A tile named after `--` is a blend stem (`river_hills_ne_se`); with none it
walks every `art/hexes/river_*.blend`. `--dry-run` measures and reports without
writing; the report is the same either way.

At bends tighter than the 0.300 bank, the swept water grid folds onto itself
(coplanar overlapping triangles). `river_fold` computes the repair; this
applies it to the blends. See `river_fold`'s docstring and art/README.md's
"The fold in the water, and what it cost to take out".

## What it will not touch

  * A headwater's tarn. `river_mountains_src_*` carries a reach, a throat and
    a tarn with rivulets in one mesh; only the reach is repaired, up to the
    station the throat is welded to, which is frozen like a mouth. The tarn's
    dark disc over its light sheet is intended (see art/README.md and
    riverArt.test.ts).
  * `_channel`, `_margin`, `_ground` and the slab. The trough's outer lip is
    coincident with the holes in `_ground` and the slab, so narrowing it would
    open a gap. Narrowing the water only exposes bed.
  * Any Z. Only x and y are rewritten; the heights (0.1930 sheet, 0.1867 dark
    thalweg, 0.072 bed) are untouched.
"""

import glob
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import river_fold  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HEXES = os.path.join(REPO, "art", "hexes")


def water_of(objects):
    """The one `*_water` mesh on a tile, or None."""
    found = [o for o in objects if o.type == "MESH" and o.name.endswith("_water")]
    return found[0] if len(found) == 1 else None


def ribbon_block(mesh):
    """The station grid a water mesh is, as (stations, columns).

    Two shapes come back. A two-mouth tile's water is a ribbon end to end, so
    the block is the whole mesh. A headwater's is a reach welded to a tarn;
    only the reach (the quads the file opens with) is a ribbon, and the block
    stops at the station the throat is welded to, which is frozen like a mouth.

    None when neither reading holds, so unknown meshes are left alone.
    """
    whole = river_fold.grid_shape(len(mesh.vertices), len(mesh.polygons))
    if whole is not None:
        stations, columns = whole
        if all(
            river_fold.ribbon_row(
                [list(p.vertices) for p in mesh.polygons], i, columns
            )
            for i in range(stations - 1)
        ):
            return stations, columns
    lead = river_fold.leading_ribbon([list(p.vertices) for p in mesh.polygons])
    return lead


def repair(mesh):
    """Rewrite one water mesh's ribbon in place. Returns a report dict, or None
    when the mesh carries no ribbon this understands."""
    block = ribbon_block(mesh)
    if block is None:
        return None
    stations, columns = block

    co = [v.co for v in mesh.vertices]
    rows = [
        [(co[i * columns + j].x, co[i * columns + j].y) for j in range(columns)]
        for i in range(stations)
    ]
    before = len(river_fold.overlapping_pairs(rows))
    fixed, factors, _, leftover = river_fold.unfold(rows)

    widths = [
        ((row[0][0] - row[-1][0]) ** 2 + (row[0][1] - row[-1][1]) ** 2) ** 0.5
        for row in fixed
    ]
    moved = max(
        ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5
        for ra, rb in zip(rows, fixed)
        for a, b in zip(ra, rb)
    )
    return {
        "stations": stations,
        "columns": columns,
        "whole": stations * columns == len(mesh.vertices),
        "before": before,
        "after": leftover,
        "clamped": sum(1 for f in factors if min(f) < 0.999),
        "narrowest": min(widths),
        "moved": moved,
        "rows": fixed,
    }


def write(mesh, rows):
    columns = len(rows[0])
    for i, row in enumerate(rows):
        for j, (x, y) in enumerate(row):
            co = mesh.vertices[i * columns + j].co
            co.x, co.y = x, y
    mesh.update()


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    dry = "--dry-run" in argv
    names = [a for a in argv if not a.startswith("-")]
    blends = (
        [os.path.join(HEXES, f"{n}.blend") for n in names]
        if names
        else sorted(glob.glob(os.path.join(HEXES, "river_*.blend")))
    )

    total_before = total_after = 0
    changed, skipped = [], []
    for blend in blends:
        stem = os.path.splitext(os.path.basename(blend))[0]
        if not os.path.exists(blend):
            raise SystemExit(f"no such tile: {blend}")
        bpy.ops.wm.open_mainfile(filepath=blend)
        water = water_of(bpy.data.objects)
        if water is None:
            skipped.append((stem, "no single _water mesh"))
            continue
        report = repair(water.data)
        if report is None:
            skipped.append((stem, "water is not a swept ribbon"))
            continue
        total_before += report["before"]
        total_after += report["after"]
        print(
            f"{stem:26s} {report['stations']:3d}x{report['columns']}"
            f"{'' if report['whole'] else ' (reach only)':14s} "
            f"folds {report['before']:4d} -> {report['after']:2d}  "
            f"clamped {report['clamped']:2d} stations  "
            f"narrowest {report['narrowest']:.3f}  moved {report['moved']:.3f}"
        )
        if report["before"] == 0 and report["moved"] < 1e-9:
            continue
        if dry:
            changed.append(stem)
            continue
        write(water.data, report["rows"])
        bpy.ops.wm.save_mainfile(filepath=blend)
        changed.append(stem)

    for stem, why in skipped:
        print(f"SKIPPED {stem}: {why}")
    print(f"FOLDS {total_before} -> {total_after}")
    print(f"{'WOULD WRITE' if dry else 'WROTE'} {len(changed)} blends")
    if total_after:
        raise SystemExit(f"{total_after} overlapping triangle pairs left")


main()
