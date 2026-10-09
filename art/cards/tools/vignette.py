"""Put the card's border vignette on a finished render.

    blender --background --python art/cards/tools/vignette.py -- in.png out.png

Not a compositor node: a mask-and-blur vignette darkens the whole frame,
including the centre. This image pass touches only the outer band and leaves
everything inside it byte for byte identical. `BAND` is the fraction of the
short edge the frame occupies; pixels further in are not written.

Blender is only the host for reading and writing PNGs; there is no scene.
"""

import sys

import bpy

BAND = 0.085        # fraction of the short edge the frame reaches in
FLOOR = 0.42        # how dark the very edge gets
GAMMA = 1.6         # >1 keeps the falloff tight to the edge


def smooth(t):
    """Smoothstep, so the frame has no visible start line."""
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    return t * t * (3.0 - 2.0 * t)


def apply(src, dst):
    img = bpy.data.images.load(src)
    w, h = img.size
    px = list(img.pixels)

    band_px = BAND * min(w, h)
    edge = int(band_px) + 2          # only these rows/columns are ever touched

    for y in range(h):
        dy = min(y, h - 1 - y)
        row = y * w * 4
        if dy >= edge:
            # A row in the middle of the image: only its two ends are in the
            # band, so walk those and never touch the run between them.
            xs = list(range(edge)) + list(range(w - edge, w))
        else:
            xs = range(w)
        for x in xs:
            dx = min(x, w - 1 - x)
            d = dx if dx < dy else dy
            t = smooth(d / band_px)
            f = FLOOR + (1.0 - FLOOR) * (t ** (1.0 / GAMMA))
            if f >= 1.0:
                continue
            i = row + x * 4
            px[i] *= f
            px[i + 1] *= f
            px[i + 2] *= f

    out = bpy.data.images.new("framed", width=w, height=h, alpha=True)
    out.pixels = px
    out.file_format = 'PNG'
    out.filepath_raw = dst
    out.save()
    print(f"[vignette] {src} -> {dst}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 2:
        raise SystemExit("usage: vignette.py -- <in.png> <out.png>")
    apply(argv[0], argv[1])


main()
