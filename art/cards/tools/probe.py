"""Pixel instruments. exec() inside Blender; uses the bundled numpy.

probe(path)            -> whole-frame stats, both encodings, plus bottom band
region(path, x0,x1,y0,y1) -> mean/max luminance of a normalised rectangle
"""
import bpy
import numpy as np


def _load(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    a = a[::-1, :, :3]              # flip to top-down
    bpy.data.images.remove(img)
    # Blender 5 returns image.pixels unconverted whatever colorspace_settings
    # says, so the array is raw sRGB; decode by hand.
    return np.where(a <= 0.04045, a / 12.92, np.power((a + 0.055) / 1.055, 2.4))


def _lum(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def _srgb(a):
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(np.clip(a, 1e-8, None), 1 / 2.4) - 0.055)


def probe(path, label=""):
    a = _load(path)
    h, w, _ = a.shape
    lin = _lum(a)
    enc = _lum(_srgb(a))
    band_lin = lin[int(h * 0.8):, :]
    band_enc = enc[int(h * 0.8):, :]
    print("%-22s %dx%d" % (label or path.split('/')[-1], w, h))
    print("   linear   mean %.4f  p50 %.4f  p99 %.4f  max %.4f"
          % (lin.mean(), np.median(lin), np.percentile(lin, 99), lin.max()))
    print("   encoded  mean %.4f  p50 %.4f  p99 %.4f  max %.4f"
          % (enc.mean(), np.median(enc), np.percentile(enc, 99), enc.max()))
    print("   band20   lin mean %.4f max %.4f | enc mean %.4f max %.4f"
          % (band_lin.mean(), band_lin.max(), band_enc.mean(), band_enc.max()))
    return dict(lin=lin, enc=enc)


def region(path, x0, x1, y0, y1, label="", cache={}):
    a = cache.get(path)
    if a is None:
        a = _load(path)
        cache[path] = a
    h, w, _ = a.shape
    s = a[int(y0 * h):max(int(y1 * h), int(y0 * h) + 1),
          int(x0 * w):max(int(x1 * w), int(x0 * w) + 1)]
    lin = _lum(s)
    enc = _lum(_srgb(s))
    print("   %-20s lin %.4f (max %.4f)  enc %.4f  rgb %.3f/%.3f/%.3f"
          % (label, lin.mean(), lin.max(), enc.mean(),
             s[..., 0].mean(), s[..., 1].mean(), s[..., 2].mean()))
    return lin.mean(), enc.mean()
