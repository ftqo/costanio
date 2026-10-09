"""Twenty robbers, plus the shipped one restated as a recolourable base.

    make robbers        # build art/robbers.blend and photograph the set

Each design is a function returning a list of `Part`s: a mesh and the
material slot it wears. `bpy` appears nowhere in this file, so the shapes and
their envelope test run without launching Blender (`make test-tools`).

## Requirements

The robber belongs to nobody and marks a blocked hex. It is seen from 56
degrees of elevation at about a finger's height on screen, usually on a number
chip. So:

- The silhouette is the design: detail below ~0.1 units does not survive the
  camera. The designs differ in outline (squat or tall, round or angular, one
  mass or two).
- It must not read as a player's piece: no settlement or knight outlines, no
  `Seat_*` materials.
- It sits on a chip without burying the number: a wide foot within the base
  robber's radius.

## The envelope

The shipped `Robber_body` is 1.5 tall, stands in a 0.45 radius, and is lathed
at 10 sides. Every design matches its height band, footprint and facet size.
`test_robber_designs.py` fails a design that drifts out of the envelope.

Squat designs (the keg, the bear) may be shorter if they carry the same
visual weight, so the test bands `silhouette_area` rather than height alone.

## Slots

Three materials shared by all twenty: `Robber_Body`, `Robber_Shade`,
`Robber_Detail` (the recolour channel; see `classic()` and
`build_robbers.py`'s FINISHES). Body is the mass; Shade is what sits under or
behind it (plinths, recesses, rags, the dark of a hood); Detail is the one
accent.
"""

import math
from collections import namedtuple

from robber_kit import (
    SIDES,
    merge,
    arc_tube,
    blob,
    box,
    cylinder,
    jitter_radii,
    lathe,
    ngon,
    prism,
    rot_x,
    rot_y,
    rot_z,
    scale,
    scallop,
    taper,
    translate,
)

#: A mesh and the material slot it wears.
Part = namedtuple("Part", "slot verts faces")

SLOTS = ("body", "shade", "detail")

DESIGNS = {}
ORDER = []

#: The colour a design wears, per slot, as linear RGB (Blender's Base Color and
#: `palette.json` are both linear). A design absent from `CHROMAS` falls back to
#: this, the shipped `Mat_Robber` near-black.
MONOCHROME = {
    "body": (0.080, 0.080, 0.085),
    "shade": (0.045, 0.045, 0.050),
    "detail": (0.140, 0.135, 0.145),
}

#: Design -> chroma id -> the three slot colours.
#:
#: ## What a chroma is
#:
#: A design is a shape (the crystal, the barrel, the tower); a chroma is one
#: colourway of it. A design is bought wearing its `base` chroma and may be
#: upgraded with other chromas; a chroma is not sold on its own.
#:
#: A chroma costs no bytes: the geometry ships once and the three colours are
#: applied at load, as `applyPalette` and seat tints do. A chroma that needs
#: its own mesh is a design.
#:
#: Rules (`test_robber_designs.py` enforces all three):
#:
#: 1. Every design has a `base`, what it is bought wearing.
#: 2. Every chroma fills all three slots.
#: 3. Chromas of one design stay `CHROMA_THRESHOLD` apart in ΔE2000 on the slot
#:    that carries the design, the same threshold the seat palette uses.
#:
#: Ids are lowercase and stable: they form item ids (`robber.shard.verdant`)
#: stored in entitlements, so renaming one is a migration.
CHROMAS = {
    "shard": {
        # Every crystal chroma keeps the same three-value structure (saturated
        # spire, dark rubble, pale small shards) and moves only the hue.
        "base": {
            "body": (0.075, 0.230, 0.330),
            "shade": (0.030, 0.055, 0.075),
            "detail": (0.320, 0.560, 0.640),
        },
        # Green, toward blue rather than yellow, so it stands out on Pasture
        # and Forest.
        "verdant": {
            "body": (0.055, 0.245, 0.150),
            "shade": (0.025, 0.062, 0.042),
            "detail": (0.300, 0.575, 0.400),
        },
        # Pink, rose quartz: the spire keeps a red bias so it does not go lilac,
        # and the pale shards carry more value than chroma.
        "rose": {
            "body": (0.340, 0.085, 0.185),
            "shade": (0.072, 0.028, 0.045),
            "detail": (0.640, 0.370, 0.470),
        },
    },
    "hourglass": {
        "base": {
            "body": (0.400, 0.520, 0.560),
            "shade": (0.055, 0.045, 0.038),
            "detail": (0.620, 0.420, 0.130),
        },
    },
    "brazier": {
        "base": {
            "body": (0.060, 0.058, 0.062),
            "shade": (0.230, 0.055, 0.020),
            "detail": (0.950, 0.420, 0.070),
        },
    },
    "crow": {
        "base": {
            "body": (0.038, 0.036, 0.042),
            "shade": (0.105, 0.062, 0.030),
            "detail": (0.780, 0.520, 0.060),
        },
    },
    "keg": {
        "base": {
            "body": (0.230, 0.115, 0.045),
            "shade": (0.075, 0.045, 0.028),
            "detail": (0.180, 0.185, 0.200),
        },
    },
    "sentinel": {
        "base": {
            "body": (0.230, 0.220, 0.200),
            "shade": (0.070, 0.066, 0.062),
            "detail": (0.330, 0.315, 0.285),
        },
    },
    "brigand": {
        "base": {
            "body": (0.075, 0.105, 0.070),
            "shade": (0.040, 0.032, 0.028),
            "detail": (0.320, 0.055, 0.045),
        },
    },
}

#: The chroma every design is bought wearing.
BASE_CHROMA = "base"

#: The slot a design's identity lives in, so two chromas must differ on it.
#: Shade is near-black on every design and detail is a small accent.
IDENTITY_SLOT = "body"


def chromas(name):
    """Every chroma id for a design, base first."""
    have = CHROMAS.get(name)
    if not have:
        return [BASE_CHROMA]
    return [BASE_CHROMA] + sorted(c for c in have if c != BASE_CHROMA)


def colors(name, chroma=BASE_CHROMA):
    """The three slot colours a design wears in a chroma."""
    have = CHROMAS.get(name)
    if not have:
        return MONOCHROME
    return have.get(chroma) or have[BASE_CHROMA]


def is_colored(name):
    """True for a design that carries its own palette rather than the black."""
    return name in CHROMAS


def item_id(name, chroma=BASE_CHROMA):
    """The catalog id for a design in a chroma.

    `robber.shard` is the design (bought, arrives in its base chroma) and
    `robber.shard.verdant` is an upgrade to it. The shape mirrors
    `cosmetics.Item.ID` ("<slot>.<name>"), with the chroma as a third segment.
    """
    return f"robber.{name}" if chroma == BASE_CHROMA else f"robber.{name}.{chroma}"


def design(name, blurb):
    """Register a design. Definition order is display and layout order."""

    def wrap(fn):
        fn.blurb = blurb
        DESIGNS[name] = fn
        ORDER.append(name)
        return fn

    return wrap


# --- mesh-level adapters ---------------------------------------------------
#
# The kit's transforms take and return vertex lists; a design wants to move a
# whole `(verts, faces)` mesh. These keep the faces attached.


def at(mesh, delta):
    return (translate(mesh[0], delta), mesh[1])


def tilt(mesh, angle, about=(0.0, 0.0, 0.0)):
    """Lean about +Y. Every leaning piece here leans with this."""
    return (rot_y(mesh[0], angle, about), mesh[1])


def roll(mesh, angle, about=(0.0, 0.0, 0.0)):
    return (rot_x(mesh[0], angle, about), mesh[1])


def spin(mesh, angle):
    return (rot_z(mesh[0], angle), mesh[1])


def sized(mesh, factor, about=(0.0, 0.0, 0.0)):
    return (scale(mesh[0], factor, about), mesh[1])


def rough(mesh, seed, amount=0.06):
    """Knock a lathe off round. Stones want it; a hat does not."""
    return (jitter_radii(mesh[0], seed, amount), mesh[1])


def waved(mesh, z, lobes, depth, phase=0.0):
    return (scallop(mesh[0], z, lobes, depth, phase), mesh[1])


def pinched(mesh, at_z, amount):
    return (taper(mesh[0], at_z, amount), mesh[1])


def part(slot, mesh):
    return Part(slot, mesh[0], mesh[1])


def planted(parts):
    """Drop a whole design so its lowest vertex is exactly z=0.

    For designs built by leaning something: a tilt about the origin swings a
    corner below the floor. The envelope test insists on z=0 because
    `seating` places the piece by its anchor, not its lowest point.
    """
    low = min(z for p in parts for _, _, z in p.verts)
    return [Part(p.slot, translate(p.verts, (0.0, 0.0, -low)), p.faces) for p in parts]


def band(radius, z0, z1, slot="detail", sides=SIDES):
    """A hoop around a piece: a barrel band, a hatband, a sack tie."""
    return part(slot, cylinder(radius, z0, z1, sides=sides))


def around(mesh, count, radius, z, start=0.0):
    """`count` copies of a mesh spaced round the axis at `radius`, height `z`.

    Crenellations, tripod legs, hourglass posts. Returns one merged mesh: the
    copies never need to be addressed apart.
    """
    return merge(*(spin(at(mesh, (radius, 0.0, z)), start + math.tau * k / count) for k in range(count)))


# --- the base --------------------------------------------------------------


def classic():
    """The shipped robber, split into the three recolour slots.

    The profile is `Robber_body` measured out of `art/pieces.blend` and
    shifted so its contact point is z=0, so the geometry is the piece the game
    already draws. The split: the plinth is Shade, the hat above the pinch at
    z=1.0 is Detail, the figure between is Body, so finishes can treat plinth
    and hat separately from the mass.
    """
    plinth = lathe([(0.0, 0.0), (0.45, 0.0), (0.45, 0.09), (0.31, 0.19)])
    figure = lathe(
        [(0.31, 0.19), (0.30, 0.27), (0.18, 0.36), (0.135, 0.72), (0.165, 0.92), (0.125, 1.00)]
    )
    hat = lathe([(0.125, 1.00), (0.26, 1.14), (0.215, 1.33), (0.105, 1.45), (0.0, 1.50)])
    return [part("shade", plinth), part("body", figure), part("detail", hat)]


# --- the twenty ------------------------------------------------------------


@design("hooded", "An empty hooded cowl, leaning forward.")
def hooded():
    robe = lathe(
        [(0.0, 0.0), (0.43, 0.0), (0.44, 0.06), (0.41, 0.34), (0.35, 0.72), (0.29, 1.00), (0.26, 1.10)]
    )
    # The lean is the design: a cowl bent toward the board.
    cowl = tilt(
        lathe([(0.26, 0.0), (0.31, 0.09), (0.25, 0.25), (0.11, 0.37), (0.0, 0.41)]),
        0.26,
    )
    cowl = at(cowl, (0.0, 0.0, 1.10))
    # The opening: a disc sunk in the hood's front.
    face = at(
        tilt(lathe([(0.0, 0.0), (0.15, 0.0), (0.15, 0.02)]), math.pi / 2 + 0.26),
        (0.15, 0.0, 1.26),
    )
    return [part("body", robe), part("body", cowl), part("shade", face)]


@design("brigand", "A wide flat hat over narrow shoulders.")
def brigand():
    plinth = lathe([(0.0, 0.0), (0.42, 0.0), (0.42, 0.08), (0.30, 0.16)])
    figure = lathe([(0.30, 0.16), (0.28, 0.30), (0.20, 0.56), (0.18, 0.88), (0.22, 1.02), (0.20, 1.09)])
    # The brim (0.46) is wider than the base robber's plinth, so from above the
    # piece is a disc rather than a cone.
    brim = lathe([(0.0, 1.09), (0.46, 1.15), (0.46, 1.18), (0.0, 1.22)])
    crown = lathe([(0.23, 1.18), (0.25, 1.34), (0.20, 1.42), (0.0, 1.46)])
    # The hatband takes the accent and the hat goes dark (a bright brim reads
    # as a toadstool).
    return [
        part("shade", plinth),
        part("body", figure),
        part("shade", brim),
        part("shade", crown),
        band(0.255, 1.19, 1.26, "detail"),
    ]


@design("wraith", "A ragged cloak with no figure inside.")
def wraith():
    robe = lathe([(0.46, 0.0), (0.34, 0.32), (0.24, 0.62), (0.18, 0.96), (0.22, 1.14), (0.16, 1.24)])
    # Ragged rather than turned: five deep lobes on the hem, which at board
    # scale is the difference between cloth and a lampshade.
    robe = waved(robe, 0.0, 5, 0.10)
    head = lathe([(0.16, 1.24), (0.21, 1.33), (0.10, 1.46), (0.0, 1.50)])
    # Two sleeves trailing off the shoulders, mirrored, so the piece is not
    # rotationally symmetric. Angled past vertical and dropped well clear of
    # the head so they read as cloth, not ears.
    sleeve = tilt(lathe([(0.10, 0.0), (0.08, 0.16), (0.05, 0.30), (0.0, 0.38)]), 2.25)
    sleeves = merge(at(sleeve, (0.19, 0.04, 0.90)), spin(at(sleeve, (0.19, -0.04, 0.84)), math.pi))
    return [part("body", robe), part("body", head), part("shade", sleeves)]


@design("sentinel", "A watchtower: a crenellated drum on a plinth.")
def sentinel():
    plinth = lathe([(0.0, 0.0), (0.44, 0.0), (0.44, 0.10), (0.36, 0.17)])
    shaft = lathe([(0.32, 0.17), (0.29, 0.96), (0.35, 1.08), (0.35, 1.28)])
    # Six merlons, not ten: at this size the gaps have to be as wide as the
    # teeth or the top reads as a plain ring with a rough edge.
    merlons = around(box((0.15, 0.13, 0.22)), 6, 0.30, 1.38)
    door = at(tilt(box((0.13, 0.10, 0.24)), math.pi / 2), (0.29, 0.0, 0.42))
    return [
        part("shade", plinth),
        part("body", shaft),
        part("detail", merlons),
        part("shade", door),
    ]


@design("menhir", "A standing stone, capped, with its spoil round the foot.")
def menhir():
    # Not a lathe: a five-sided slab, flat from one bearing and thick from
    # another, so it looks carved as the board orbits. Near-parallel sides, a
    # blunt top, barely off plumb (a taper and lean read as a fin).
    face = [(-0.29, -0.18), (0.26, -0.21), (0.32, 0.04), (0.14, 0.23), (-0.27, 0.18)]
    shaft = rough(pinched(prism(face, 0.0, 1.10), 0.0, -0.13), 3, 0.05)
    # The cap is a course of its own, wider than the stone under it, so the top
    # reads as capped rather than as merely stopping.
    cap = rough(sized(prism(face, 1.10, 1.30), (1.10, 1.10, 1.0)), 7, 0.04)
    shaft, cap = tilt(shaft, 0.05), tilt(cap, 0.05)
    # Tucked against the stone: the rubble sets the piece's radius, and must
    # stay inside the envelope.
    rubble = merge(
        rough(blob(0.13, (0.26, 0.11, 0.0), squash=0.42), 11, 0.18),
        rough(blob(0.11, (-0.24, -0.21, 0.0), squash=0.45), 13, 0.18),
        rough(blob(0.09, (0.04, -0.27, 0.0), squash=0.45), 17, 0.18),
    )
    return planted([part("body", shaft), part("detail", cap), part("shade", rubble)])


@design("cairn", "Five stacked stones.")
def cairn():
    # Radii fall fast and heights do not, so the stack tapers without becoming
    # a cone: the outline should be a set of steps.
    spec = [
        (0.41, 0.00, 0.30, 1),
        (0.35, 0.30, 0.28, 2),
        (0.30, 0.58, 0.26, 3),
        (0.24, 0.84, 0.24, 4),
        (0.17, 1.08, 0.22, 5),
    ]
    parts = []
    for i, (r, z0, h, seed) in enumerate(spec):
        stone = lathe([(r * 0.86, z0), (r, z0 + h * 0.35), (r * 0.94, z0 + h * 0.8), (r * 0.7, z0 + h)])
        stone = rough(stone, seed, 0.09)
        # Each stone turned and nudged off the axis, so the stack looks
        # balanced rather than machined.
        stone = at(spin(stone, 0.4 * i), (0.02 * math.cos(i * 2.1), 0.02 * math.sin(i * 2.1), 0.0))
        parts.append(part("detail" if i == len(spec) - 1 else ("body" if i % 2 == 0 else "shade"), stone))
    return parts


@design("keg", "A squat banded barrel.")
def keg():
    staves = lathe(
        [
            (0.0, 0.0), (0.31, 0.0), (0.31, 0.06), (0.41, 0.36),
            (0.43, 0.64), (0.39, 0.98), (0.31, 1.22), (0.0, 1.26),
        ]
    )
    spigot = at(tilt(lathe([(0.06, 0.0), (0.05, 0.10), (0.07, 0.13)]), math.pi / 2), (0.38, 0.0, 0.40))
    return [
        part("body", staves),
        band(0.325, 0.06, 0.14, "detail"),
        band(0.425, 0.46, 0.56, "detail"),
        band(0.335, 1.10, 1.19, "detail"),
        part("shade", spigot),
    ]


@design("lantern", "A hooded lamp on a post, unlit.")
def lantern():
    foot = lathe([(0.0, 0.0), (0.36, 0.0), (0.36, 0.07), (0.20, 0.15)])
    post = lathe([(0.10, 0.15), (0.09, 0.74)])
    # Six panels rather than a lathe, because the glass has to catch light in
    # flat facets; a round housing at this size just goes grey.
    housing = prism(ngon(0.25, 6), 0.74, 1.16)
    cap = lathe([(0.31, 1.16), (0.27, 1.23), (0.10, 1.37)])
    finial = lathe([(0.07, 1.37), (0.10, 1.42), (0.0, 1.50)])
    return [
        part("shade", foot),
        part("body", post),
        part("detail", housing),
        part("body", cap),
        part("detail", finial),
    ]


@design("swagbag", "A tied, overstuffed sack.")
def swagbag():
    sack = rough(
        lathe(
            [
                (0.0, 0.0), (0.30, 0.0), (0.42, 0.24), (0.44, 0.52),
                (0.34, 0.82), (0.16, 1.00), (0.14, 1.08),
            ]
        ),
        2,
        0.035,
    )
    gather = waved(lathe([(0.14, 1.14), (0.27, 1.34), (0.20, 1.43), (0.0, 1.46)]), 1.34, 5, 0.035)
    coins = merge(
        blob(0.09, (0.36, 0.06, 0.0), squash=0.35),
        blob(0.075, (0.30, -0.20, 0.0), squash=0.35),
    )
    return [
        part("body", sack),
        band(0.165, 1.02, 1.15, "shade"),
        part("body", gather),
        part("detail", coins),
    ]


@design("bruin", "A broad, low, seated bear.")
def bruin():
    # Shoulders, then a neck, then a head. The pinch at 0.86 makes it read as
    # an animal rather than a sack (like `swagbag`).
    body = lathe([(0.0, 0.0), (0.36, 0.0), (0.42, 0.12), (0.41, 0.40), (0.36, 0.66), (0.24, 0.86)])
    head = lathe([(0.20, 0.86), (0.30, 0.98), (0.31, 1.16), (0.24, 1.30), (0.10, 1.38), (0.0, 1.39)])
    # Long enough to break the head's outline from the side, and dropped below
    # the head's midline so it reads as a muzzle rather than as a spout.
    snout = at(
        tilt(lathe([(0.0, 0.0), (0.15, 0.0), (0.14, 0.12), (0.10, 0.22), (0.0, 0.24)]), math.pi / 2 + 0.18),
        (0.20, 0.0, 1.06),
    )
    # On top of the skull and forward of its centre, where ears are.
    ears = merge(
        blob(0.10, (0.10, 0.15, 1.28), squash=0.85),
        blob(0.10, (0.10, -0.15, 1.28), squash=0.85),
    )
    haunch = blob(0.17, squash=0.85)
    haunches = merge(at(haunch, (0.02, 0.31, 0.02)), at(haunch, (0.02, -0.31, 0.02)))
    return [
        part("body", body),
        part("body", head),
        part("shade", haunches),
        part("detail", snout),
        part("detail", ears),
    ]


@design("skullpost", "A skull on a stake.")
def skullpost():
    foot = rough(lathe([(0.0, 0.0), (0.35, 0.0), (0.33, 0.09), (0.14, 0.18)]), 5, 0.08)
    stake = lathe([(0.10, 0.18), (0.085, 1.02)], sides=6)
    cranium = lathe([(0.11, 1.02), (0.23, 1.12), (0.27, 1.26), (0.22, 1.40), (0.10, 1.47), (0.0, 1.48)])
    jaw = at(box((0.30, 0.26, 0.11)), (0.05, 0.0, 1.10))
    socket = tilt(cylinder(0.06, 0.0, 0.05, sides=6), math.pi / 2)
    eyes = merge(at(socket, (0.22, 0.10, 1.28)), at(socket, (0.22, -0.10, 1.28)))
    return [
        part("shade", foot),
        part("body", stake),
        part("detail", cranium),
        part("detail", jaw),
        part("shade", eyes),
    ]


@design("anvil", "An anvil on a stump with a hammer standing in it.")
def anvil():
    stump = rough(lathe([(0.0, 0.0), (0.40, 0.0), (0.42, 0.11), (0.37, 0.56), (0.36, 0.64)]), 9, 0.05)
    # Drawn as a side elevation and swept across, because an anvil is a
    # profile: the horn on one end and the step on the other are the read, and
    # a lathe cannot say either.
    side = [
        (-0.26, 0.00), (0.19, 0.00), (0.19, 0.06), (0.12, 0.14), (0.40, 0.23),
        (0.14, 0.27), (0.14, 0.31), (-0.30, 0.31), (-0.30, 0.25), (-0.16, 0.20),
        (-0.16, 0.08), (-0.26, 0.03),
    ]
    body = at(roll(prism(side, -0.13, 0.13), math.pi / 2), (0.0, 0.0, 0.64))
    # The hammer stands in it, bringing the piece up to the base robber's
    # height.
    haft = at(tilt(cylinder(0.045, 0.0, 0.62, sides=6), -0.30), (-0.16, 0.0, 0.90))
    head = at(tilt(box((0.20, 0.11, 0.11)), -0.30), (-0.34, 0.0, 1.46))
    return planted([part("shade", stump), part("body", body), part("body", haft), part("detail", head)])


@design("toadstool", "A toadstool cap on a bulbous stalk.")
def toadstool():
    stalk = lathe([(0.0, 0.0), (0.27, 0.0), (0.25, 0.12), (0.15, 0.42), (0.14, 0.82), (0.19, 1.02)])
    gills = lathe([(0.19, 1.02), (0.42, 1.11)])
    cap = waved(
        lathe([(0.44, 1.10), (0.41, 1.30), (0.25, 1.43), (0.0, 1.49)]),
        1.10,
        8,
        0.035,
    )
    spots = merge(
        blob(0.07, (0.16, 0.14, 1.30), squash=0.45),
        blob(0.06, (-0.20, 0.08, 1.26), squash=0.45),
    )
    return [part("body", stalk), part("shade", gills), part("detail", cap), part("shade", spots)]


@design("crow", "A crow on a stump, side-on.")
def crow():
    stump = rough(lathe([(0.0, 0.0), (0.34, 0.0), (0.34, 0.11), (0.27, 0.46), (0.29, 0.54)]), 6, 0.06)
    body = at(
        tilt(lathe([(0.0, 0.0), (0.11, 0.02), (0.24, 0.20), (0.26, 0.44), (0.19, 0.60)]), -0.14),
        (0.02, 0.0, 0.54),
    )
    head = at(tilt(lathe([(0.19, 0.0), (0.20, 0.10), (0.13, 0.22), (0.0, 0.26)]), -0.14), (0.10, 0.0, 1.14))
    beak = at(
        tilt(lathe([(0.08, 0.0), (0.05, 0.10), (0.0, 0.17)], sides=6), math.pi / 2),
        (0.20, 0.0, 1.24),
    )
    # The tail is the asymmetry that makes it a bird from every bearing: it
    # sticks out behind and down, so the piece has a front.
    tail = at(tilt(pinched(box((0.34, 0.15, 0.06)), 0.0, -0.9), 0.55), (-0.27, 0.0, 0.80))
    return planted(
        [
            part("shade", stump),
            part("body", body),
            part("body", head),
            part("detail", beak),
            part("body", tail),
        ]
    )


@design("hourglass", "An hourglass in a three-post frame.")
def hourglass():
    base = lathe([(0.0, 0.0), (0.37, 0.0), (0.37, 0.11), (0.31, 0.15)])
    top = lathe([(0.31, 1.35), (0.37, 1.39), (0.37, 1.50), (0.0, 1.50)])
    # Cut at the waist: the glass is opaque at this scale, so the lower bulb
    # wears the sand's colour instead of modelling sand inside. The two halves
    # share the waist ring.
    upper = lathe([(0.07, 0.75), (0.25, 1.15), (0.29, 1.35)])
    lower = lathe([(0.29, 0.15), (0.25, 0.35), (0.07, 0.75)])
    posts = around(cylinder(0.05, 0.0, 1.35, sides=6), 3, 0.30, 0.10)
    # Slotted by role: the glass is the mass, the frame (caps and posts) the
    # dark, the sand the accent.
    return [
        part("shade", base),
        part("shade", top),
        part("body", upper),
        part("detail", lower),
        part("shade", posts),
    ]


@design("brazier", "A fire bowl on three legs, burning.")
def brazier():
    leg = tilt(cylinder(0.055, 0.0, 0.64, sides=6), -0.36)
    legs = around(leg, 3, 0.24, 0.0)
    bowl = lathe([(0.12, 0.52), (0.34, 0.76), (0.39, 0.92), (0.37, 0.99)])
    coals = lathe([(0.36, 0.94), (0.30, 1.00), (0.0, 1.03)])
    # The flame leans and waves, so it is not read as a spike. It is the tall
    # part of the piece and the only lit thing on the board.
    flame = waved(
        lathe([(0.22, 0.96), (0.27, 1.10), (0.16, 1.28), (0.09, 1.40), (0.0, 1.50)]),
        1.10,
        5,
        0.045,
    )
    flame = tilt(flame, 0.10, (0.0, 0.0, 0.96))
    return planted([part("body", legs), part("body", bowl), part("shade", coals), part("detail", flame)])


@design("shard", "A crystal cluster breaking through the tile.")
def shard():
    rubble = rough(lathe([(0.0, 0.0), (0.42, 0.0), (0.38, 0.09), (0.30, 0.13)]), 8, 0.10)
    # Five sides, so the facets are wide enough to catch visibly different
    # light and read as crystal.
    main = tilt(lathe([(0.29, 0.06), (0.24, 0.62), (0.14, 1.14), (0.0, 1.48)], sides=5), 0.07)
    left = at(tilt(lathe([(0.17, 0.0), (0.13, 0.38), (0.0, 0.66)], sides=5), -0.32), (-0.23, 0.06, 0.08))
    right = at(
        tilt(spin(lathe([(0.13, 0.0), (0.10, 0.30), (0.0, 0.52)], sides=5), 0.6), 0.30),
        (0.24, -0.10, 0.08),
    )
    return planted([part("shade", rubble), part("body", main), part("detail", left), part("detail", right)])


@design("padlock", "A padlock on a plinth.")
def padlock():
    plinth = lathe([(0.0, 0.0), (0.40, 0.0), (0.40, 0.06), (0.30, 0.10)])
    # A plate, not a drum: 0.36 deep against 0.84 wide, so it does not read as
    # a bucket (the set already has a barrel).
    body = sized(prism(ngon(0.31, 8, phase=math.pi / 8), 0.10, 0.82), (1.0, 0.52, 1.0))
    # The shackle stands proud of the case: narrower case, arc centred above
    # the case's top face.
    shackle = at(arc_tube(0.36, 0.05, 0.0, math.pi, steps=14, sides=6), (0.0, 0.0, 0.82))
    keyhole = at(tilt(cylinder(0.085, 0.0, 0.04, sides=8), math.pi / 2), (0.15, 0.0, 0.46))
    tongue = at(box((0.05, 0.09, 0.16)), (0.16, 0.0, 0.34))
    return [
        part("shade", plinth),
        part("body", body),
        part("detail", shackle),
        part("shade", keyhole),
        part("shade", tongue),
    ]


@design("scarecrow", "A crossed post in a sack hood, arms out over the hex.")
def scarecrow():
    foot = rough(lathe([(0.0, 0.0), (0.31, 0.0), (0.29, 0.07), (0.13, 0.14)]), 4, 0.08)
    post = lathe([(0.09, 0.14), (0.08, 1.08)], sides=6)
    # The crossbar (0.78 across, the widest in the set) makes it read as a bar
    # from above.
    bar = at(box((0.78, 0.10, 0.09)), (0.0, 0.0, 1.06))
    head = rough(lathe([(0.10, 1.06), (0.21, 1.19), (0.22, 1.33), (0.14, 1.44), (0.16, 1.50)]), 10, 0.05)
    rag = pinched(box((0.11, 0.07, 0.36)), 0.0, -0.5)
    rags = merge(at(tilt(rag, 0.12), (-0.30, 0.0, 0.84)), at(tilt(rag, -0.10), (0.31, 0.0, 0.88)))
    return [
        part("shade", foot),
        part("body", post),
        part("body", bar),
        part("detail", head),
        part("shade", rags),
    ]


@design("ashcone", "A smoking ash cone.")
def ashcone():
    cone = rough(lathe([(0.45, 0.0), (0.40, 0.19), (0.29, 0.52), (0.20, 0.80), (0.19, 0.88)]), 1, 0.045)
    crater = lathe([(0.19, 0.88), (0.13, 0.81), (0.0, 0.83)])
    # Three puffs, each bigger and further off the axis than the last, so the
    # smoke leans away and the piece is not a symmetrical stack.
    puffs = []
    for i, (r, x, z) in enumerate(((0.15, 0.02, 0.86), (0.20, 0.07, 1.05), (0.25, 0.14, 1.24))):
        puffs.append(rough(blob(r, (x, 0.0, z), squash=0.62), 20 + i, 0.13))
    plume = merge(*puffs)
    return [part("body", cone), part("shade", crater), part("detail", plume)]


def build(name):
    """Every part of a design, or of the base when `name` is 'classic'."""
    return classic() if name == "classic" else DESIGNS[name]()


def whole(name):
    """One merged mesh for a design, for measuring it."""
    return merge(*((p.verts, p.faces) for p in build(name)))
