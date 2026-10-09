"""Perceptual colour distance, for keeping two chromas apart.

A port of `cosmetics/ciede2000.go`, so chromas are graded on the same scale as
seat colours (`ColorThreshold = 12`).

The input differs: robber slot colours are linear RGB (as in Blender's Base
Color and `palette.json`), so the sRGB decode step is skipped.

No bpy, so it tests without launching Blender.
"""

import math

#: Minimum ΔE2000 between two chromas of the same design, on the slot that
#: carries the design (its `body`). From `cosmetics.ColorThreshold`.
CHROMA_THRESHOLD = 12.0


def linear_to_lab(rgb):
    """Linear RGB (0..1, Blender's own space) to CIE L*a*b*, D65."""
    r, g, b = rgb
    x = r * 0.4124 + g * 0.3576 + b * 0.1805
    y = r * 0.2126 + g * 0.7152 + b * 0.0722
    z = r * 0.0193 + g * 0.1192 + b * 0.9505
    xn, yn, zn = 0.95047, 1.0, 1.08883

    def f(t):
        return t ** (1 / 3) if t > 216 / 24389 else t * (841 / 108) + 4 / 29

    fx, fy, fz = f(x / xn), f(y / yn), f(z / zn)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def delta_e(lab1, lab2):
    """CIE ΔE 2000. ~1 is just noticeable; see CHROMA_THRESHOLD."""
    d2r = math.pi / 180
    l1, a1, b1 = lab1
    l2, a2, b2 = lab2

    c1, c2 = math.hypot(a1, b1), math.hypot(a2, b2)
    avg_c = (c1 + c2) / 2

    def p7(x):
        return x ** 7

    g = 0.5 * (1 - math.sqrt(p7(avg_c) / (p7(avg_c) + p7(25))))
    a1p, a2p = a1 * (1 + g), a2 * (1 + g)
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)

    def hp(b, ap):
        if b == 0 and ap == 0:
            return 0.0
        h = math.atan2(b, ap) * 180 / math.pi
        return h + 360 if h < 0 else h

    h1p, h2p = hp(b1, a1p), hp(b2, a2p)
    dlp = l2 - l1
    dcp = c2p - c1p

    if c1p * c2p == 0:
        dhp = 0.0
    elif abs(h2p - h1p) <= 180:
        dhp = h2p - h1p
    elif h2p - h1p > 180:
        dhp = h2p - h1p - 360
    else:
        dhp = h2p - h1p + 360
    dhp_big = 2 * math.sqrt(c1p * c2p) * math.sin(dhp / 2 * d2r)

    avg_lp = (l1 + l2) / 2
    avg_cp = (c1p + c2p) / 2
    if c1p * c2p == 0:
        avg_hp = h1p + h2p
    elif abs(h1p - h2p) > 180:
        avg_hp = (h1p + h2p + 360) / 2
    else:
        avg_hp = (h1p + h2p) / 2

    t = (
        1
        - 0.17 * math.cos((avg_hp - 30) * d2r)
        + 0.24 * math.cos((2 * avg_hp) * d2r)
        + 0.32 * math.cos((3 * avg_hp + 6) * d2r)
        - 0.20 * math.cos((4 * avg_hp - 63) * d2r)
    )
    d_theta = 30 * math.exp(-(((avg_hp - 275) / 25) ** 2))
    rc = 2 * math.sqrt(p7(avg_cp) / (p7(avg_cp) + p7(25)))
    sl = 1 + (0.015 * (avg_lp - 50) ** 2) / math.sqrt(20 + (avg_lp - 50) ** 2)
    sc = 1 + 0.045 * avg_cp
    sh = 1 + 0.015 * avg_cp * t
    rt = -math.sin(2 * d_theta * d2r) * rc

    return math.sqrt(
        (dlp / sl) ** 2
        + (dcp / sc) ** 2
        + (dhp_big / sh) ** 2
        + rt * (dcp / sc) * (dhp_big / sh)
    )


def distance(rgb1, rgb2):
    """ΔE2000 between two linear RGB colours."""
    return delta_e(linear_to_lab(rgb1), linear_to_lab(rgb2))
