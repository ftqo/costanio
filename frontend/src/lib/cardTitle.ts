// Laying out a card's name over its untitled art, in the player's language:
// how many lines, how big, and where to break.
//
// The geometry is measured off the finished English cards and frozen here as
// the title spec. `art/cards/tools/title.py` is the reference implementation;
// this file is fitted to its constants, not the other way round.
//
// The fit is arithmetic: with kerning off, a rendered advance is the font's
// advance times the size plus tracking, so with the subset fonts' advances
// (titleMetrics.json, from frontend/scripts/gen-title-fonts.py) the layout is
// a pure function of the string. No reflow, no dependence on webfont loading,
// and every title in every catalogue can be unit tested.
import metrics from "./titleMetrics.json";

type Face = {
  family: string;
  capHeight: number;
  advance: Record<string, number>;
  inkHeight?: number;
  inkCentre?: number;
};
const FACES = metrics.faces as unknown as Record<string, Face>;

/**
 * The measured title treatment, as fractions of the 1000x1400 card. Numbers
 * marked "Spec" were decoded from a finished card; the rest are explained
 * where they are used.
 */
export const TITLE = {
  /** Card aspect: width as a fraction of height. */
  aspect: 1000 / 1400,
  /** Spec: cap height 62 px on a 1400 px card. */
  capHeight: 0.0443,
  /** Spec: alphabetic baseline at y = 1199. */
  baseline: 0.8564,
  /** Spec: MAX_W, the widest the title may run, as a fraction of card width. */
  maxWidth: 0.85,
  /** Spec: derived from "ALCHEMIST" measuring 602 px tracked against 564 solid. */
  tracking: 0.053,
  /** Spec: display tracking for a short CJK title, which fills its em box. */
  cjkTracking: 0.15,
  /**
   * Devanagari takes no tracking: the shirorekha (the headstroke joining a
   * word) is drawn per glyph to meet its neighbour exactly, so any
   * letter-spacing cuts it. 0.053 em at a 62 px cap is a ~3 px gap in every
   * word.
   */
  devaTracking: 0,
  /** Spec: leading for the two-line case. */
  leading: 1.05,
  /** The vertical-room decision. See fitCardTitle. */
  twoLineScale: 0.85,
  /** Spec: the shrink ladder, kept as the third resort. */
  shrinkStep: 0.94,
  shrinkFloor: 0.32,
  /**
   * Spec: the optical centre of the Latin single-line block. Cap top at
   * 81.21%, baseline at 85.64%, so the centre is 83.43%. CJK is positioned to
   * agree with this rather than by a baseline it does not share.
   */
  opticalCentre: 0.8343,
  /**
   * Spec: a CJK glyph fills its em box where a Latin cap fills 0.69 of it, so
   * matching cap height would make it look like a caption. The ideographic ink
   * is drawn 1.5x the Latin cap height instead.
   */
  cjkGlyphScale: 1.5,
  ink: "#F9F5ED",
  /**
   * Pure black (it was `#423C37`). The outline separates the ink from the art,
   * and at drawn sizes (46x64 in hand, 56x80 as a shop tile) warmth is not
   * visible. Ink-against-surround separation, measured as the art pipeline does
   * (a strip just inside the silhouette against just outside, in linear light):
   *
   *     #423C37  0.97 stops     #1A1614  1.09 stops     #000000  1.16 stops
   *
   * Black won on every card and size tested (deserter, printer, wedding,
   * warlord, knight, spy). Band-wide RMS contrast over the title block shows no
   * difference, since the art dominates it; do not evaluate with that metric.
   */
  outline: "#000000",
  /**
   * Spec: the ink is fattened 1.6 px and the dark outline stands 9.1 px proud
   * of the unfattened glyph, at 1000 px wide. A stroke straddles the outline, so
   * stroke width is twice the spread, over an em of 89.5 px (the 62 px cap over
   * Gelasio's 0.693 cap ratio; Vollkorn SC's 0.676 makes strokes 2.5% heavier,
   * which is not visible).
   *
   * Two copies rather than `paint-order: stroke fill`, matching the Blender
   * scene's two FONT curves at different `offset`s; one element cannot draw both.
   *
   * Em-relative here where `title.py` is absolute, so a shrunk title keeps its
   * weight here. That is the better direction: a non-shrinking outline closes
   * the counters.
   */
  inkStroke: 0.036,
  outlineStroke: 0.203,
  /** Spec: the hairline rule and its two end dots, all in card fractions. */
  rule: {
    top: 0.9086,
    height: 3 / 1400,
    width: 0.43,
    dot: 10 / 1000,
    dotOffset: 0.23,
    color: "#BFBCB5",
  },
  /**
   * Spec: a ramp from transparent at 50.71% of card height to #35302F at the
   * bottom edge. The untitled masters do not carry it, and it keeps the ink
   * readable on bright cards (knight measures 0.41 mean luminance in the band,
   * victory_point 0.24, spy 0.01).
   *
   * The alphas are not the spec's 0 to 0.62: Blender composites in linear light
   * and CSS in sRGB. For art value v and linear alpha a, the baked result is
   * `lin2srgb(srgb2lin(v)(1-a) + scrim_lin a)`, and the matching sRGB alpha is
   * `(v - that) / (v - scrim_srgb)`, solved per channel over bright art
   * (v = 0.5, 0.7, 0.9) and averaged at each stop.
   *
   * The sRGB alpha comes out lower than the linear one, and the ramp is no
   * longer linear, hence a stop list.
   */
  scrim: {
    color: "#35302F",
    stops: [
      { at: 0.5071, alpha: 0 },
      { at: 0.6, alpha: 0.071 },
      { at: 0.7, alpha: 0.153 },
      { at: 0.8, alpha: 0.243 },
      { at: 0.9, alpha: 0.342 },
      { at: 1.0, alpha: 0.454 },
    ],
  },
} as const;

/** A break the fitter is allowed to use, supplied as data in the catalogue. */
const SOFT_HYPHEN = "\u00AD"; // breaks, and draws a hyphen
const ZERO_WIDTH_SPACE = "\u200B"; // breaks, and draws nothing

export type TitleScript = "latin" | "cyrillic" | "cjk" | "devanagari";

/** Every break character, for stripping the ones a layout did not use. */
const BREAKS = /[\u00AD\u200B]/g;

const CYRILLIC_LOCALES: readonly string[] = ["ru", "uk", "be", "bg", "sr", "mk"];

/**
 * Locales whose titles are set in Devanagari. Only `hi` ships; the others are
 * listed because a missing entry falls through to `latn`, whose Vollkorn SC has
 * no Devanagari, and every card renders as tofu with nothing failing. (`ko`
 * has the same latent problem.)
 */
const DEVANAGARI_LOCALES: readonly string[] = ["hi", "mr", "ne", "sa", "kok", "mai", "bho"];

/** Which of the subset faces a locale's titles are set in. */
export function titleFace(locale: string): string {
  if (locale === "zh-Hans" || locale === "zh") return "sc";
  if (locale === "ja") return "jp";
  if (locale === "ko") return "kr";
  const base = locale.split("-")[0] ?? locale;
  if (DEVANAGARI_LOCALES.includes(base)) return "deva";
  return CYRILLIC_LOCALES.includes(base) ? "cyrl" : "latn";
}

export function titleScript(locale: string): TitleScript {
  const face = titleFace(locale);
  if (face === "sc" || face === "jp" || face === "kr") return "cjk";
  if (face === "deva") return "devanagari";
  return face === "cyrl" ? "cyrillic" : "latin";
}

/**
 * Whether this script has case, which decides `text-transform: uppercase`.
 *
 * Off for CJK: some engines fold small kana (`ゃ ゅ ょ っ`) to full size,
 * changing a Japanese word's reading.
 *
 * Off for Devanagari, which has no case mappings (U+0900-U+097F), so a Latin
 * run inside a Hindi title is not shouted while the rest stays as written.
 */
export function titleUppercases(locale: string): boolean {
  const script = titleScript(locale);
  return script !== "cjk" && script !== "devanagari";
}

/**
 * The casing the browser will apply, reproduced for measurement. Locale-aware
 * because Turkish uppercases `i` to `İ`; CSS does this via `lang=`, so the
 * model must too.
 */
export function titleCase(text: string, locale: string): string {
  if (!titleUppercases(locale)) return text;
  const base = locale.split("-")[0];
  if (base === "tr" || base === "az") {
    return text.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
  }
  return text.toLocaleUpperCase(locale);
}

/**
 * Width of one line, in em, including the trailing tracking the box carries.
 *
 * Exact for Latin, Cyrillic and CJK, where glyphs map one-to-one to codepoints
 * with kerning off. Not exact for Devanagari: GSUB forms conjuncts narrower than
 * their parts, and the i-matra is reordered and may be swapped for a variant.
 *
 * Measured with HarfBuzz against the shipped subset over all thirty Hindi
 * titles plus i-matra cases:
 *
 *  - The sum is always >= the shaped width (0% with no conjunct, up to 36%
 *    with one: धर्माध्यक्ष, "Bishop", 4.374 em summed, 3.214 shaped). So a
 *    Devanagari title may wrap or shrink a step early but never overflows.
 *  - The widest Hindi title sums to 7.14 em against a 9.80 em budget, and all
 *    thirty take the same branch as under true measurement.
 *
 * A future title over ~9.8 em summed would be set one step small. The fix
 * would be keying the `deva` advance table on shaped grapheme clusters, here
 * and in gen-title-fonts.py.
 */
function lineWidth(text: string, locale: string, tracking: number): number {
  const primary = FACES[titleFace(locale)] ?? FACES.latn;
  const latin = FACES.latn;
  let total = 0;
  for (const ch of text) {
    // The locale's face first, then the Latin face, as the CSS font stack falls
    // through per glyph. A missing advance means a stale subset (the catalogue
    // test names it); 0.6 em avoids NaN meanwhile.
    total += primary.advance[ch] ?? latin.advance[ch] ?? 0.6;
  }
  return total + tracking * [...text].length;
}

export interface TitleLayout {
  /** One or two lines, already cased and with the break characters resolved. */
  lines: string[];
  /** Multiplier on the base cap height. 1 is the measured spec size. */
  scale: number;
  /** Font size, as a fraction of card height. */
  fontSize: number;
  /** Distance from the top of the card to the *last* line's baseline. */
  baseline: number;
  /** Leading between the two lines, in em. */
  leading: number;
  /** letter-spacing, in em. */
  tracking: number;
  script: TitleScript;
  family: string;
  /** True if the title still exceeds the measured width at the shrink floor. */
  overflows: boolean;
}

/**
 * Where to draw a card's name, given the string and the locale.
 *
 * Two lines first, then shrink; never crop or ellipsise. Six of thirty English
 * titles exceed the measured width on one line.
 *
 * ## Vertical room
 *
 * Two lines at full size do not fit the quiet bottom fifth: holding the last
 * baseline at 85.64% with 1.05 em leading puts the first cap top at 74%. The
 * options were growing the band to ~26% or a size step; this takes the size
 * step, `twoLineScale` = 0.85:
 *
 *  1. Every card face is composed with its bottom 20% quiet; growing the band
 *     would mean recomposing every card.
 *  2. Neither option stays inside the band. At 0.85x the second line intrudes
 *     3.8% of card height rather than 6%, into a region the scrim darkens to
 *     about 0.3 alpha, behind a 9.1 px outline.
 *  3. Two-line titles land at a 53 px cap, larger than the 43 px the old
 *     shrink-only pipeline gave COMMERCIAL HARBOR.
 *  4. It is one constant; if the band ever grows, set it back to 1.0.
 */
export function fitCardTitle(raw: string, locale: string): TitleLayout {
  const script = titleScript(locale);
  const face = FACES[titleFace(locale)] ?? FACES.latn;
  const tracking =
    script === "cjk"
      ? TITLE.cjkTracking
      : script === "devanagari"
        ? TITLE.devaTracking
        : TITLE.tracking;

  // Font size at scale 1, as a fraction of card height. Latin and Cyrillic put
  // the cap at the measured 4.43%, which also matches faces with different cap
  // ratios. CJK has no cap height, so it is sized by the ideographic ink.
  //
  // Devanagari uses the cap-height path: Noto Serif Devanagari reports a real
  // sCapHeight (0.715) and the script sits on the alphabetic baseline. The
  // shirorekha then lands at 0.625 em (87% of the Latin cap), but the matras
  // extend well above and below (ि to 0.898 em, the virama to -0.284), so the
  // title does not read small.
  const unitSize =
    script === "cjk"
      ? (TITLE.capHeight * TITLE.cjkGlyphScale) / (face.inkHeight ?? 0.94)
      : TITLE.capHeight / face.capHeight;

  const text = titleCase(raw, locale);
  const budgetEm = (TITLE.maxWidth * TITLE.aspect) / unitSize;

  const plain = text.replace(BREAKS, "");

  const fit = (lines: string[], scale: number) =>
    Math.max(...lines.map((l) => lineWidth(l, locale, tracking))) <= budgetEm / scale;

  let lines = [plain];
  let scale = 1;

  if (!fit(lines, 1)) {
    // A CJK title (two to six glyphs) never wraps; a two-line short title looks
    // broken. Shrink instead, which in practice never triggers.
    const split = script === "cjk" ? null : bestSplit(text, locale, tracking);
    if (split) {
      lines = split;
      scale = TITLE.twoLineScale;
    }
    while (!fit(lines, scale) && scale > TITLE.shrinkFloor) {
      scale = Math.max(TITLE.shrinkFloor, scale * TITLE.shrinkStep);
    }
  }

  const fontSize = unitSize * scale;
  // The last line's baseline. Latin, Cyrillic and Devanagari (all
  // baseline-sitting) hold the spec's 85.64%. CJK is placed by its ink, so its
  // em box centre lands on the Latin block's optical centre.
  const baseline =
    script === "cjk" ? TITLE.opticalCentre + (face.inkCentre ?? 0.38) * fontSize : TITLE.baseline;

  return {
    lines,
    scale,
    fontSize,
    baseline,
    leading: TITLE.leading,
    tracking,
    script,
    family: face.family,
    overflows: !fit(lines, scale),
  };
}

/**
 * The two-line split that makes the wider line as narrow as possible.
 *
 * Break opportunities come from the data: a space; a soft hyphen, which gives
 * German or Dutch compounds a seam (`ROHSTOFF-` / `MONOPOL`, `GRONDSTOFFEN-` /
 * `MONOPOLIE`) and draws the hyphen; and a zero-width space for a seam with no
 * hyphen (Italian `ANNO DELL'ABBONDANZA`, after the elided article).
 *
 * Not `text-wrap: balance`: it cannot find compound seams, browser hyphenation
 * is unreliable, and the fitter needs the line widths to pick a size anyway.
 */
function bestSplit(text: string, locale: string, tracking: number): string[] | null {
  const opportunities: { at: number; skip: number; hyphen: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") opportunities.push({ at: i, skip: 1, hyphen: false });
    else if (ch === SOFT_HYPHEN) opportunities.push({ at: i, skip: 1, hyphen: true });
    else if (ch === ZERO_WIDTH_SPACE) opportunities.push({ at: i, skip: 1, hyphen: false });
  }
  if (opportunities.length === 0) return null;

  let best: { lines: string[]; wide: number } | null = null;
  for (const o of opportunities) {
    const head = text.slice(0, o.at).replace(BREAKS, "") + (o.hyphen ? "-" : "");
    const tail = text.slice(o.at + o.skip).replace(BREAKS, "");
    if (!head || !tail) continue;
    const wide = Math.max(lineWidth(head, locale, tracking), lineWidth(tail, locale, tracking));
    if (!best || wide < best.wide) best = { lines: [head, tail], wide };
  }
  return best?.lines ?? null;
}
