#!/usr/bin/env python3
"""Build the card-title webfonts and the metric table the fitter reads.

    python3 frontend/scripts/gen-title-fonts.py            # rebuild
    python3 frontend/scripts/gen-title-fonts.py --check     # exit 1 if stale

Card titles are a closed character set read from the message catalogues, so a
CJK subset is tens of kilobytes instead of megabytes. Rerun after any title
changes, or the new glyphs render as tofu.

Five faces, all SIL OFL 1.1:

  Vollkorn SC Bold  Latin and Cyrillic, from one file (the site's title face).
                    Subset into two files because the fitter keys its advance
                    table on the face a locale's titles use (`titleFace` in
                    cardTitle.ts).
  Noto Serif SC     Simplified Chinese, weight 700 pinned out of the variable.
  Noto Serif JP     Japanese, likewise. Shared codepoints draw differently in
                    the two, so both are needed.
  Noto Serif        Devanagari, for hi. Both axes are pinned (wght=700,
  Devanagari        wdth=100); a partial pin leaves the font variable and
                    subsetting it raises a KeyError in fontTools.

Only the subsets are committed. Sources are fetched into a gitignored cache,
pinned by sha256.

Outputs:
  frontend/public/fonts/{vollkornsc,vollkornsc-cyrl,notoserifsc,notoserifjp,
                         notoserifdevanagari}-titles.woff2
  frontend/src/lib/titleMetrics.json   advances + cap heights, per face

The metric table lets the fitter choose one line, two lines or a shrink
without measuring the DOM: with kerning off (the title sets
`font-kerning: none`), a rendered advance is exactly the font's advance times
the size plus tracking.

That does not hold for Devanagari: conjuncts shape narrower than their parts,
so summed advances over-measure (up to 36% on the Hindi set). The error only
ever over-measures (checked against HarfBuzz), so a title may wrap or shrink
early but never overflow. The widest Hindi title sums to 7.14 em against a
9.80 em budget, so no title is affected today. Measuring shaped grapheme
clusters would fix it if that changes.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.dirname(HERE)
REPO = os.path.dirname(FRONTEND)
LOCALES = os.path.join(FRONTEND, "src", "locales")
FONT_OUT = os.path.join(FRONTEND, "public", "fonts")
METRICS_OUT = os.path.join(FRONTEND, "src", "lib", "titleMetrics.json")
CACHE = os.path.join(HERE, ".fontcache")

TITLE_CONTEXTS = ("development card", "progress card", "Raiders card")

# Locale -> the face its non-Latin characters belong to. Everything else, and
# every Latin character in every locale, goes to the Latin face (Vollkorn SC).
CJK_FACE = {"zh-Hans": "sc", "ja": "jp", "ko": "kr"}

SOURCES = {
    "latn": {
        "url": "https://github.com/google/fonts/raw/main/ofl/vollkornsc/VollkornSC-Bold.ttf",
        "out": "vollkornsc-titles.woff2",
        "family": "Costan Title",
    },
    "cyrl": {
        # The same file as `latn`: Vollkorn SC carries Cyrillic. Cached once.
        "url": "https://github.com/google/fonts/raw/main/ofl/vollkornsc/VollkornSC-Bold.ttf",
        "out": "vollkornsc-titles-cyrl.woff2",
        "family": "Costan Title",
    },
    "sc": {
        "url": "https://github.com/notofonts/noto-cjk/raw/main/Serif/Variable/TTF/Subset/NotoSerifSC-VF.ttf",
        "instance": "wght=700",
        "out": "notoserifsc-titles.woff2",
        "family": "Costan Title SC",
    },
    "jp": {
        "url": "https://github.com/notofonts/noto-cjk/raw/main/Serif/Variable/TTF/Subset/NotoSerifJP-VF.ttf",
        "instance": "wght=700",
        "out": "notoserifjp-titles.woff2",
        "family": "Costan Title JP",
    },
    "kr": {
        "url": "https://github.com/notofonts/noto-cjk/raw/main/Serif/Variable/TTF/Subset/NotoSerifKR-VF.ttf",
        "instance": "wght=700",
        "out": "notoserifkr-titles.woff2",
        "family": "Costan Title KR",
    },
    "deva": {
        "url": "https://github.com/google/fonts/raw/main/ofl/notoserifdevanagari/"
               "NotoSerifDevanagari%5Bwdth%2Cwght%5D.ttf",
        # Both axes: a partial pin leaves the font variable, and subsetting it
        # raises `KeyError: 'NullMark'` in gvar.
        "instance": "wght=700,wdth=100",
        # Devanagari needs its GSUB/GPOS tables (conjuncts, i-matra reordering,
        # vowel sign placement); the other faces drop theirs.
        "keep_layout": True,
        "out": "notoserifdevanagari-titles.woff2",
        "family": "Costan Title Deva",
    },
}

PINS = os.path.join(HERE, "title-fonts.lock.json")


# --- catalogue ------------------------------------------------------------

_STR = re.compile(r'"(?:[^"\\]|\\.)*"')


def _field(block, name):
    m = re.search(r"^%s ((?:\"(?:[^\"\\\\]|\\\\.)*\"\s*)+)" % name, block, re.M)
    if not m:
        return None
    return "".join(json.loads(s) for s in _STR.findall(m.group(1)))


def titles(po_path):
    """Every card title in one catalogue, translated where a translation exists."""
    out = []
    for block in open(po_path, encoding="utf-8").read().split("\n\n"):
        if "msgctxt" not in block:
            continue
        ctx = _field(block, "msgctxt")
        if ctx not in TITLE_CONTEXTS:
            continue
        msgid = _field(block, "msgid")
        msgstr = _field(block, "msgstr")
        out.append(msgstr or msgid)
    return out


def all_titles():
    """{locale: [title, ...]} over every catalogue in the tree."""
    out = {}
    for name in sorted(os.listdir(LOCALES)):
        po = os.path.join(LOCALES, name, "messages.po")
        if os.path.isfile(po):
            out[name] = titles(po)
    return out


def upper(s, locale):
    """The casing CSS `text-transform: uppercase` would apply, per locale.

    Turkish is the one that differs and the one Python gets wrong: `i` uppercases
    to `İ`, not `I`. CSS is locale-sensitive through `lang=` and does this
    correctly; the subset has to contain what CSS will ask for.
    """
    if locale.split("-")[0] in ("tr", "az"):
        s = s.replace("i", "İ").replace("ı", "I")
    return s.upper()


def script_of(ch):
    o = ord(ch)
    if 0x0400 <= o <= 0x052F or 0x2DE0 <= o <= 0x2DFF or 0xA640 <= o <= 0xA69F:
        return "cyrl"
    if (
        0x3000 <= o <= 0x30FF          # CJK punctuation, hiragana, katakana
        or 0x3400 <= o <= 0x4DBF       # extension A
        or 0x4E00 <= o <= 0x9FFF       # unified ideographs
        or 0xF900 <= o <= 0xFAFF       # compatibility ideographs
        or 0xFF00 <= o <= 0xFF60       # fullwidth forms
        or 0x20000 <= o <= 0x2FA1F     # extensions B+
    ):
        return "cjk"
    if 0xAC00 <= o <= 0xD7AF or 0x1100 <= o <= 0x11FF or 0x3130 <= o <= 0x318F:
        return "hang"
    if 0x0900 <= o <= 0x097F or 0xA8E0 <= o <= 0xA8FF or 0x1CD0 <= o <= 0x1CFF:
        return "deva"
    return "latn"


def charsets():
    """{face: sorted set of characters}, both cases, over every locale."""
    sets = {k: set() for k in SOURCES}
    for locale, ts in all_titles().items():
        cjk = CJK_FACE.get(locale)
        for t in ts:
            for ch in t + upper(t, locale):
                if ch in ("­", "\n"):
                    continue  # break opportunities, never drawn
                s = script_of(ch)
                if s in ("cyrl", "deva"):
                    # Routed by script, not locale (unlike CJK).
                    sets[s].add(ch)
                elif s in ("cjk", "hang"):
                    if cjk:
                        sets[cjk].add(ch)
                    # A CJK character in a non-CJK catalogue is a bug; the
                    # checker below reports it.
                else:
                    sets["latn"].add(ch)
    # The fitter draws U+002D itself at a soft-hyphen break, so it is added
    # even though no catalogue contains it. Not for `deva`: Hindi titles do
    # not hyphenate, and unicode-range sends U+002D to the Latin face, which is
    # what `lineWidth` falls through to.
    for f in ("latn", "cyrl"):
        if sets[f]:
            sets[f].add("-")
    return {k: "".join(sorted(v)) for k, v in sets.items()}


# --- fetching -------------------------------------------------------------


def pins():
    return json.load(open(PINS)) if os.path.exists(PINS) else {}


def source_file(face, lock, write_lock):
    src = SOURCES[face]
    if "path" in src:
        return src["path"]
    os.makedirs(CACHE, exist_ok=True)
    dest = os.path.join(CACHE, os.path.basename(src["url"]))
    if not os.path.exists(dest):
        print(f"fetching {src['url']}", file=sys.stderr)
        with urllib.request.urlopen(src["url"]) as r, open(dest, "wb") as f:
            f.write(r.read())
    digest = hashlib.sha256(open(dest, "rb").read()).hexdigest()
    want = lock.get(face)
    if want and want != digest:
        raise SystemExit(
            f"{face}: {dest} is sha256 {digest}, lock says {want}. "
            "Delete the cache to refetch, or update title-fonts.lock.json."
        )
    if not want:
        write_lock[face] = digest
    return dest


# --- subsetting -----------------------------------------------------------


def subset(face, text, lock, write_lock, out_dir):
    from fontTools import subset as ftsubset
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer

    src = SOURCES[face]
    path = source_file(face, lock, write_lock)
    font = TTFont(path, lazy=False)
    if "instance" in src:
        # Comma-separated: every axis must be pinned, or subsetting raises a
        # KeyError in gvar.
        axes = {}
        for part in src["instance"].split(","):
            axis, _, val = part.partition("=")
            axes[axis.strip()] = float(val)
        font = instancer.instantiateVariableFont(font, axes, inplace=True)

    opts = ftsubset.Options()
    opts.flavor = "woff2"
    opts.desubroutinize = True
    opts.drop_tables += ["DSIG"]
    if not src.get("keep_layout"):
        opts.layout_features = []      # no shaping needed for a set of capitals
    # No hinting: titles draw at 60 px and up (or as a tiny thumbnail), and the
    # instructions are a third of the subset's bytes.
    opts.hinting = False
    opts.notdef_outline = False
    opts.name_IDs = [1, 2, 3, 4, 5, 6, 13, 14]   # keep the licence in the file
    opts.recalc_bounds = True
    subsetter = ftsubset.Subsetter(options=opts)
    subsetter.populate(text=text)
    subsetter.subset(font)

    out = os.path.join(out_dir, src["out"])
    os.makedirs(out_dir, exist_ok=True)
    font.save(out)
    return out, font


def metrics(face, font, text):
    """Advance widths in em plus the cap height, for the fitter."""
    upem = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    adv = {}
    missing = []
    for ch in text:
        gname = cmap.get(ord(ch))
        if gname is None:
            missing.append(ch)
            continue
        adv[ch] = round(hmtx[gname][0] / upem, 5)
    out = {
        "family": SOURCES[face]["family"],
        "capHeight": round(getattr(font["OS/2"], "sCapHeight", upem) / upem, 5),
        "advance": adv,
    }

    # Han and kana have no cap height, so measure the ink instead: the median
    # glyph height and centre. The title layer puts that centre on the Latin
    # block's optical centre (83.4% of card height).
    glyf = font["glyf"] if "glyf" in font else None
    heights, centres = [], []
    for ch in text:
        if script_of(ch) not in ("cjk", "hang"):
            continue
        g = glyf[cmap[ord(ch)]] if glyf else None
        if g is None or g.numberOfContours == 0:
            continue
        heights.append((g.yMax - g.yMin) / upem)
        centres.append((g.yMax + g.yMin) / 2 / upem)
    if heights:
        heights.sort()
        centres.sort()
        out["inkHeight"] = round(heights[len(heights) // 2], 5)
        out["inkCentre"] = round(centres[len(centres) // 2], 5)
    return out, missing


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="do not write; fail if the committed output is stale")
    args = ap.parse_args()

    sets = charsets()
    lock, write_lock = pins(), {}
    out = {"faces": {}}
    stale = []
    with tempfile.TemporaryDirectory() as tmp:
        out_dir = tmp if args.check else FONT_OUT
        for face in ("latn", "cyrl", "deva", "sc", "jp", "kr"):
            text = sets[face]
            if not text:
                print(f"{face}: no characters in any catalogue, skipping",
                      file=sys.stderr)
                continue
            path, font = subset(face, text, lock, write_lock, out_dir)
            m, missing = metrics(face, font, text)
            if missing:
                raise SystemExit(
                    f"{face}: {SOURCES[face]['out']} has no glyph for "
                    + " ".join(f"U+{ord(c):04X} ({c})" for c in missing)
                )
            out["faces"][face] = m
            print(f"{face}: {len(text)} chars -> {SOURCES[face]['out']} "
                  f"{os.path.getsize(path):,} B", file=sys.stderr)
            if args.check:
                shipped = os.path.join(FONT_OUT, SOURCES[face]["out"])
                if not os.path.exists(shipped) or \
                        open(shipped, "rb").read() != open(path, "rb").read():
                    stale.append(SOURCES[face]["out"])

    if write_lock and not args.check:
        lock.update(write_lock)
        with open(PINS, "w") as f:
            json.dump(lock, f, indent=2, sort_keys=True)
            f.write("\n")

    text = json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    if args.check:
        have = open(METRICS_OUT, encoding="utf-8").read() \
            if os.path.exists(METRICS_OUT) else ""
        if have != text:
            stale.append("titleMetrics.json")
        if stale:
            raise SystemExit(
                "stale, run frontend/scripts/gen-title-fonts.py: " + ", ".join(stale))
        print("title fonts and metrics are current", file=sys.stderr)
        return
    with open(METRICS_OUT, "w", encoding="utf-8") as f:
        f.write(text)


if __name__ == "__main__":
    main()
