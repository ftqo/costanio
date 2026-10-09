"""The recipe-built tiles, as `make check-hexes` needs to know them.

Imports no bpy, so it unit-tests without launching Blender.

`frontend/scripts/compose-tiles.ts` writes these tiles out of hand-authored
components (see art/README.md, "Recipe-built tiles"); it is the authority on
what a recipe MEANS. This module only answers the questions the hex check
asks of each one: which file ships, what its terrain is called inside that
file, and which authored terrain it is built on -- the last because a
composed tile inherits its base tile's recorded drift (`hexcontract.DERIVES_FROM`).
"""

import json
import os
import re

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RECIPES = os.path.join(REPO, "art", "recipes")

_KEY = re.compile(r"^(trade|river)_([a-z]+)_([a-z_]+)$")


def terrain_for_key(key):
    """`trade_hills_nw` -> `Trade_Hills_NW`: the compose script's rule, and naming.py's.

    A segment of one or two letters is a compass point or a variant letter and
    is upper case; anything longer is capitalised.
    """
    return "_".join(s.upper() if len(s) <= 2 else s[0].upper() + s[1:] for s in key.split("_"))


def recipes(root=RECIPES):
    """Every recipe, sorted: dicts of key, kind, ground, variant, terrain, base, file."""
    with open(os.path.join(root, "parts.json")) as handle:
        parts = json.load(handle)
    out = []
    for name in sorted(os.listdir(root)):
        if not name.endswith(".json") or name == "parts.json":
            continue
        key = name[: -len(".json")]
        m = _KEY.match(key)
        if not m:
            raise ValueError(f"{name}: a recipe is named trade_<ground>_<dir> or river_<ground>_<shape>")
        kind, ground, variant = m.groups()
        if ground not in parts["grounds"]:
            raise ValueError(f"{name}: no ground {ground!r} in parts.json")
        out.append(
            {
                "key": key,
                "kind": kind,
                "ground": ground,
                "variant": variant,
                "terrain": terrain_for_key(key),
                "base": parts["grounds"][ground]["terrain"],
                "file": f"tiles/{key}.glb",
            }
        )
    return out
