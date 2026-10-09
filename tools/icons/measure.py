"""Score a set of eight resource icons against itself, pair by pair.

    python3 tools/icons/measure.py OUT.html [set=DIR ...]

Writes a self-contained page that rasterises every icon and prints one JSON
blob into `document.title`-adjacent `<pre id="out">`. Drive it with a headless
browser and read that element; there is no other output.

A browser is used because the app draws icons as CSS-sized `<img>`: an SVG is
rasterised at the target size and a PNG bake is downsampled to it. Each icon is
decoded by the browser as the app does and drawn into a 13 or 26 px canvas.

The four numbers:

  silhouette RMS   Every paint forced to black, so only the outline is left:
                   two icons can differ in colour and still be the same blob.
                   Higher is better.
  IoU              Intersection over union of the two silhouettes, the
                   size-normalised control on RMS. Lower is better.
  dE               Mean CIELAB distance between the two icons composited over
                   the same background, on the white `ResCard` well and on the
                   `#2a2e3c` dark panel. Higher is better.
  dE(ink)          The same, averaged only over pixels where either icon has
                   ink, so an icon is not rewarded for drawing less.

A set is scored by its worst pair: min over the 28 pairs for the distances and
max for IoU.
"""

import base64
import json
import mimetypes
import os
import sys

NAMES = ["wood", "brick", "sheep", "wheat", "ore", "cloth", "paper", "coin"]
# Every size an `icon` slot is drawn at, from cardShots.ts: 13 for the cost
# chips in the location menu, 18 for the flying cards and harbour badges, 26
# for `ResCard` (hand, trade lanes, discard box, recipes; the only one with a
# light well behind it) and 36 for the artist grid tile.
SIZES = [13, 18, 26, 36]
# The two grounds an icon is actually drawn on: the white well inside a
# `ResCard`, and the dark panel behind the rail.
BACKGROUNDS = {"white": "#ffffff", "dark": "#2a2e3c"}


def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    with open(path, "rb") as fh:
        return f"data:{mime};base64," + base64.b64encode(fh.read()).decode("ascii")


def find(dirpath, name):
    """The one file in `dirpath` that is this resource's icon.

    Sets differ in extension and prefix (`icon_wood.webp`, `wood-o0055-96.png`),
    so match the resource name as a token. An `icon` token wins when a
    directory holds several matches (`hex_wood` beside `icon_wood`).
    """
    hits = []
    for fn in sorted(os.listdir(dirpath)):
        stem, ext = os.path.splitext(fn)
        if ext.lower() not in (".svg", ".png", ".webp"):
            continue
        tokens = stem.replace("-", "_").split("_")
        if name in tokens:
            hits.append(os.path.join(dirpath, fn))
    preferred = [p for p in hits if "icon" in os.path.basename(p).replace("-", "_").split("_")]
    if preferred:
        hits = preferred
    if len(hits) != 1:
        raise SystemExit(f"{dirpath}: expected exactly one {name} icon, found {hits}")
    return hits[0]


PAGE = """<!doctype html><meta charset=utf8><title>icon metrics</title>
<body style="background:#111;color:#eee;font:12px monospace">
<pre id="out">running</pre>
<script>
const SETS = %(sets)s, NAMES = %(names)s, SIZES = %(sizes)s, BGS = %(bgs)s;

// sRGB -> CIELAB (D65). CIE76 is enough to rank pairs; finer formulae only
// re-weight differences already well above threshold at this scale.
function lab(r, g, b) {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = f(r), G = f(g), B = f(b);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let Y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
  let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const k = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  X = k(X); Y = k(Y); Z = k(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

function load(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("load " + src.slice(0, 60)));
    im.src = src;
  });
}

// Draw the icon into an s x s cell the way the app does: the browser decodes
// it and scales it to the box, with smoothing on, then RGBA is read back.
function raster(im, s) {
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.clearRect(0, 0, s, s);
  x.drawImage(im, 0, 0, s, s);
  return x.getImageData(0, 0, s, s).data;
}

function overBg(px, bg) {
  const n = px.length / 4, out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = px[i * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = px[i * 4 + k] * a + bg[k] * (1 - a);
  }
  return out;
}

function hex2rgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

async function main() {
  const result = {};
  for (const [setName, files] of Object.entries(SETS)) {
    result[setName] = {};
    const imgs = {};
    for (const n of NAMES) imgs[n] = await load(files[n]);
    for (const s of SIZES) {
      const px = {}, alpha = {}, labs = {};
      for (const n of NAMES) {
        px[n] = raster(imgs[n], s);
        const a = new Float64Array(s * s);
        for (let i = 0; i < s * s; i++) a[i] = px[n][i * 4 + 3] / 255;
        alpha[n] = a;
        labs[n] = {};
        for (const [bgName, bgHex] of Object.entries(BGS)) {
          const comp = overBg(px[n], hex2rgb(bgHex));
          const L = new Float64Array(s * s * 3);
          for (let i = 0; i < s * s; i++) {
            const v = lab(comp[i * 3], comp[i * 3 + 1], comp[i * 3 + 2]);
            L[i * 3] = v[0]; L[i * 3 + 1] = v[1]; L[i * 3 + 2] = v[2];
          }
          labs[n][bgName] = L;
        }
      }
      // Ink coverage: mean alpha over the whole cell, averaged over the eight.
      // Not a distance; it is context for the other numbers.
      let ink = 0;
      for (const n of NAMES) {
        let t = 0;
        for (let i = 0; i < s * s; i++) t += alpha[n][i];
        ink += t / (s * s);
      }
      ink /= NAMES.length;

      const pairs = [];
      for (let i = 0; i < NAMES.length; i++) {
        for (let j = i + 1; j < NAMES.length; j++) {
          const A = NAMES[i], B = NAMES[j];
          let se = 0, inter = 0, uni = 0;
          for (let p = 0; p < s * s; p++) {
            // Silhouette: paint forced to black, so the cell value is just
            // 255*(1-alpha) and the difference is the difference in coverage.
            const d = (alpha[A][p] - alpha[B][p]) * 255;
            se += d * d;
            const a = alpha[A][p] >= 0.5, b = alpha[B][p] >= 0.5;
            if (a && b) inter++;
            if (a || b) uni++;
          }
          // Reported 0..100, as a percentage of the full 0..255 range.
          const rec = { a: A, b: B, sil: Math.sqrt(se / (s * s)) / 2.55, iou: uni ? inter / uni : 1 };
          for (const bgName of Object.keys(BGS)) {
            const LA = labs[A][bgName], LB = labs[B][bgName];
            let sum = 0, inkSum = 0, inkN = 0;
            for (let p = 0; p < s * s; p++) {
              const dL = LA[p * 3] - LB[p * 3], da = LA[p * 3 + 1] - LB[p * 3 + 1],
                    db = LA[p * 3 + 2] - LB[p * 3 + 2];
              const de = Math.sqrt(dL * dL + da * da + db * db);
              sum += de;
              // Union ink mask: a pixel counts if either icon puts paint
              // there.
              if (Math.max(alpha[A][p], alpha[B][p]) > 0.02) { inkSum += de; inkN++; }
            }
            rec["de_" + bgName] = sum / (s * s);
            rec["deink_" + bgName] = inkN ? inkSum / inkN : 0;
          }
          pairs.push(rec);
        }
      }
      const mean = (k) => pairs.reduce((t, p) => t + p[k], 0) / pairs.length;
      const worst = (k, hi) => pairs.reduce((w, p) => (hi ? p[k] > w[k] : p[k] < w[k]) ? p : w, pairs[0]);
      const summary = { ink, n: pairs.length };
      for (const k of ["sil", "de_white", "de_dark", "deink_white", "deink_dark"]) {
        const w = worst(k, false);
        summary[k] = { mean: mean(k), worst: w[k], pair: w.a + "/" + w.b };
      }
      const wi = worst("iou", true);
      summary.iou = { mean: mean("iou"), worst: wi.iou, pair: wi.a + "/" + wi.b };
      result[setName][s] = { summary, pairs };
    }
  }
  document.getElementById("out").textContent = JSON.stringify(result);
  document.title = "done";
}
main().catch((e) => {
  document.getElementById("out").textContent = "ERROR " + e.message;
  document.title = "done";
});
</script>
"""


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    out = sys.argv[1]
    sets = {}
    for spec in sys.argv[2:]:
        label, _, dirpath = spec.partition("=")
        sets[label] = {n: data_uri(find(dirpath, n)) for n in NAMES}
    html = PAGE % {
        "sets": json.dumps(sets),
        "names": json.dumps(NAMES),
        "sizes": json.dumps(SIZES),
        "bgs": json.dumps(BACKGROUNDS),
    }
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w") as fh:
        fh.write(html)
    print("WROTE", out, len(html), "bytes,", len(sets), "sets")


if __name__ == "__main__":
    main()
