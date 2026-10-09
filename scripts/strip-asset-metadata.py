#!/usr/bin/env python3
"""Strip authoring metadata from every asset the site serves.

    python3 scripts/strip-asset-metadata.py            # rewrite in place
    python3 scripts/strip-asset-metadata.py --check     # exit 1 if any is dirty

Walks frontend/public (or the paths named on the command line) and rewrites
each .glb, .gif, .mp3, .png, .webp and .jpg without its build fingerprint
(generator stamps, PNG text chunks such as Blender's source-file path, EXIF,
XMP, comments). Only container metadata is touched; pixel and audio data are
copied byte for byte. See tools/blender/assetmeta.py for what is removed and
what is kept. To sweep every tracked asset, not only served ones:

    git ls-files -z '*.png' '*.jpg' '*.jpeg' '*.webp' '*.gif' '*.glb' \
        | xargs -0 python3 scripts/strip-asset-metadata.py

The .glb exporters already strip on export. This script covers assets from
elsewhere (sound effects, decoration GIFs). scripts/lint.sh runs --check.
"""

import argparse
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools", "blender"))

import assetmeta  # noqa: E402

DEFAULT_ROOT = os.path.join(REPO, "frontend", "public")


def walk(paths):
    for path in paths:
        if os.path.isfile(path):
            yield path
            continue
        for dirpath, dirnames, filenames in os.walk(path):
            dirnames.sort()
            for name in sorted(filenames):
                if name.lower().endswith(assetmeta.HANDLED):
                    yield os.path.join(dirpath, name)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="*", default=[DEFAULT_ROOT])
    ap.add_argument(
        "--check",
        action="store_true",
        help="report what would change and exit non-zero, writing nothing",
    )
    args = ap.parse_args()

    dirty = []
    for path in walk(args.paths or [DEFAULT_ROOT]):
        with open(path, "rb") as fh:
            data = fh.read()
        out = assetmeta.strip_file_bytes(path, data)
        if out == data:
            continue
        dirty.append(path)
        rel = os.path.relpath(path, REPO)
        if args.check:
            print(f"DIRTY {rel}: {len(data) - len(out)} bytes of metadata")
        else:
            with open(path, "wb") as fh:
                fh.write(out)
            print(f"STRIPPED {rel}: {len(data) - len(out)} bytes")

    if args.check and dirty:
        print(f"\n{len(dirty)} asset(s) still carry metadata: run {sys.argv[0]}")
        return 1
    if not dirty:
        print("every served asset is already clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
