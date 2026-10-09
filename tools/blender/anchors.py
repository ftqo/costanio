"""Where each exported group's origin belongs.

Imports no bpy, so it unit-tests without Blender.

The blend is a showcase: `Hex_Forest` sits on hex (-2, 1), `Settlement_A` on
one of its vertices, the number chips on a staging grid off to the side. The
renderer computes a world position for every instance and expects the art
centred on the origin, so each exported group is moved there first.

An exported file holds several independent items (every number chip, every
harbour marker), so anchoring is per item, not per file. An item is a
parenting component: the objects reachable from one root, where a root is an
object whose parent is outside the exported set.
"""

import math

import lattice

# Hex circumradius in blend units, and the lattice it generates. Must match
# HEX_SIZE in the generated manifest.
HEX = 3.0
COL = HEX * math.sqrt(3.0)  # centre-to-centre in +x
ROW = HEX * 1.5  # centre-to-centre in +y

# The same two at the lattice spacing rather than the tile-art spacing. The
# showcase board is authored on the lattice, so anchors that name a lattice
# feature use these.
LCOL = COL * lattice.LATTICE_SCALE
LHEX = HEX * lattice.LATTICE_SCALE

# Anchor rules.
ROOT = "root"  # the root's own origin; the art already puts it on the anchor
HEX_PARENT = "hex"  # the centre of the Hex_* the root is parented to

# Roots whose rule is not ROOT, keyed by name prefix.
#
# The pieces were modelled in place on the showcase board with their object
# origin at the world origin, so the anchor is the lattice feature the renderer
# places them on: a vertex for buildings, an edge midpoint for roads.
#
# Not listed (ROOT is right): the robber (its origin is its centre), the beach
# pieces (generated in reference pose) and the city-improvement props
# (authored at the origin; their only consumer, the shop camera in
# lib/board3d/thumbnail.ts, sets its own yaw, so they are absent from
# AUTHORED_TURN too).
RULES = {
    "Settlement_A": (LCOL, LHEX),  # vertex, N corner of hex (1, 0)
    "City_A": (LCOL / 2, LHEX / 2),  # vertex, S corner of the hex above it
    "Road_A": (LCOL * 0.75, LHEX * 0.75),  # midpoint of the edge between them
    "Road_B": (LCOL * 0.25, LHEX * 0.75),  # midpoint of the mirrored edge
    # The trading-post art is modelled on the dock in the dock's frame and
    # instanced at the dock's placement, so it anchors on its hex and keeps
    # its offset along the pier.
    "Dock_": HEX_PARENT,
    # The harbour ratio signs: same pier, same rule.
    "Hwedge_": HEX_PARENT,
    # The ocean props keep their authored offset within their hex.
    "Ocean_": HEX_PARENT,
}

# Viewport-only mirrors of what the renderer builds at runtime (lattice gap,
# coastline, harbour token; see lattice.py), so terrain art is authored
# against the shipped board. Excluded from every export.
REFERENCE_PREFIX = "Ref_"


def is_reference(name):
    """True for viewport-only mirror geometry, which never ships."""
    return name.startswith(REFERENCE_PREFIX)

# How far a recentred item's bounding box may sit from the origin. Loose enough
# for off-centre art (the robber on its chip socket), tight enough to catch an
# item left on a staging grid 17 units out.
MAX_RESIDUAL = HEX


def scale_cancel_for(terrain):
    """Factor an item's authored scale must be multiplied by on the way out.

    Water tiles are authored a full lattice cell wide (sea tiles have no
    gutter), and `tileScale` scales them by `LATTICE_SCALE` at load time, so
    the export divides that factor back out.

    `terrain` is the `Hex_*` suffix of the item's nearest hex ancestor, or None
    for anything not on a tile.
    """
    if terrain in lattice.WATER_TERRAINS:
        return 1.0 / lattice.LATTICE_SCALE
    return 1.0


# Families whose authored yaw must not ship. The showcase chips were turned to
# suit the composition, which would ship some upside down (and swap 6 and 9).
UPRIGHT = ("Chip_",)


def is_upright(name):
    """True if the item's authored yaw should be cancelled on export."""
    return name.startswith(UPRIGHT)


# Families that were modelled in place on the showcase board, and the yaw the
# composition left them at.
#
# Each has an identity object transform with the turn baked into its mesh, so
# the yaw is invisible in the outliner.
#
# `planPieces` aligns a road with `rotationY = -atan2(dz, dx)`, which assumes
# the bar lies along +x; both roads were modelled on a showcase edge, 30
# degrees off (`Road_B` mirrored at -30). `Settlement_A` sits at -20 degrees
# and `City_A` at +15, measured by the doorway (`Seat_Detail`) normal against
# a board front of 90. The export turns them back to reference pose and the
# renderer turns them into place.
AUTHORED_TURN = {
    "Road_A": -math.pi / 6.0,
    "Road_B": math.pi / 6.0,
    "Settlement_A": -math.radians(20.0),
    "City_A": math.radians(15.0),
}


# Both tables above describe only `art/pieces.blend`. A culture piece set under
# `art/pieces/<set>.blend` uses the same object names but is authored at the
# origin, square to the board, so neither table applies. `staged` is therefore
# a property of the file, not the name.
def turn_for(name, staged=True):
    """Rotation about +Z, in radians, that puts an item in its reference pose.

    The renderer turns one canonical copy of each family into place, so art
    modelled off that orientation is turned back here.

    `staged=False` for art authored square in its own file: nothing to cancel.
    """
    if not staged:
        return 0.0
    for prefix, turn in AUTHORED_TURN.items():
        if name.startswith(prefix):
            return turn
    return 0.0


def rule_for(name, staged=True):
    """The anchor rule for a root object, by name prefix.

    `staged=False` for art authored at the origin in its own file: ROOT.
    """
    if not staged:
        return ROOT
    for prefix, rule in RULES.items():
        if name.startswith(prefix):
            return rule
    return ROOT


def roots(names_to_parents, exported):
    """Roots of `exported`: objects whose parent is outside the set.

    `names_to_parents` maps an object name to its parent's name (or None).
    Returns names in the order given, so exports stay deterministic.
    """
    inside = set(exported)
    return [n for n in exported if names_to_parents.get(n) not in inside]


def hex_ancestor(name, names_to_parents, is_hex):
    """Nearest ancestor (including `name`) that is a Hex_*, or None."""
    seen = set()
    cur = name
    while cur is not None and cur not in seen:
        if is_hex(cur):
            return cur
        seen.add(cur)
        cur = names_to_parents.get(cur)
    return None
