// The card-title layer's gate: every title, in every catalogue, laid out.
//
// The fitter is arithmetic, so all 390 titles (30 cards x 13 locales) can be
// checked for overflow, cropping and ellipsis in a unit test.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { LOCALES, type Locale } from "./i18n";
import {
  fitCardTitle,
  titleCase,
  titleFace,
  titleScript,
  titleUppercases,
  TITLE,
} from "./cardTitle";
import metrics from "./titleMetrics.json";

const localesDir = resolve(import.meta.dirname, "../locales");
const TITLE_CONTEXTS = new Set(["development card", "progress card", "Raiders card"]);

/** Every card title in one catalogue, translated where a translation exists. */
function titles(locale: string): string[] {
  const src = readFileSync(join(localesDir, locale, "messages.po"), "utf8");
  const out: string[] = [];
  let ctxt = "";
  let id: string | null = null;
  let str: string | null = null;
  let field: "ctxt" | "id" | "str" | null = null;
  const flush = () => {
    if (id && TITLE_CONTEXTS.has(ctxt)) out.push(str || id);
    ctxt = "";
    id = null;
    str = null;
    field = null;
  };
  for (const line of src.split("\n")) {
    if (line.startsWith("#~")) continue;
    if (line.startsWith("#") || line.trim() === "") {
      if (id) flush();
      continue;
    }
    const one = (re: RegExp) => re.exec(line)?.[1];
    const c = one(/^msgctxt "(.*)"$/);
    if (c !== undefined) {
      ctxt = c;
      field = "ctxt";
      continue;
    }
    const i = one(/^msgid "(.*)"$/);
    if (i !== undefined) {
      id = i;
      field = "id";
      continue;
    }
    const s = one(/^msgstr "(.*)"$/);
    if (s !== undefined) {
      str = s;
      field = "str";
      continue;
    }
    const cont = one(/^"(.*)"$/);
    if (cont !== undefined && field) {
      if (field === "ctxt") ctxt += cont;
      else if (field === "id") id = (id ?? "") + cont;
      else str = (str ?? "") + cont;
    }
  }
  if (id) flush();
  return out;
}

const ALL: [Locale, string[]][] = LOCALES.map((l) => [l, titles(l)]);

describe("card titles fit, in every locale", () => {
  it("finds thirty-five titles in every catalogue", () => {
    for (const [loc, ts] of ALL) expect(ts.length, loc).toBe(35);
  });

  it.each(ALL)("%s never overflows the measured width", (loc, ts) => {
    for (const t of ts) {
      const layout = fitCardTitle(t, loc);
      expect(layout.overflows, `${loc}: ${t}`).toBe(false);
    }
  });

  it.each(ALL)("%s never needs more than two lines, or the shrink floor", (loc, ts) => {
    for (const t of ts) {
      const layout = fitCardTitle(t, loc);
      expect(layout.lines.length, `${loc}: ${t}`).toBeLessThanOrEqual(2);
      // Every line must be non-empty; an empty line is a crop.
      for (const line of layout.lines) expect(line.length, `${loc}: ${t}`).toBeGreaterThan(0);
      expect(layout.scale, `${loc}: ${t}`).toBeGreaterThan(TITLE.shrinkFloor);
    }
  });

  it("never crops or ellipsises: the drawn lines rebuild the title", () => {
    for (const [loc, ts] of ALL) {
      for (const t of ts) {
        const layout = fitCardTitle(t, loc);
        // The drawn lines rejoin to the title exactly: a space split consumed a
        // space, a soft-hyphen split consumed the seam and added a hyphen, a
        // zero-width split consumed the seam and added nothing.
        const want = titleCase(t, loc).replace(/[\u00AD\u200B]/g, "");
        const [a, b] = layout.lines;
        const rebuilds = [a, `${a} ${b}`, `${a}${b}`, `${a?.replace(/-$/, "")}${b}`];
        expect(rebuilds, `${loc}: ${t}`).toContain(want);
        expect(layout.lines.join(""), `${loc}: ${t}`).not.toMatch(/…|\.\.\./);
      }
    }
  });

  it("holds two lines to the decided 0.85 step, and one line to full size", () => {
    for (const [loc, ts] of ALL) {
      for (const t of ts) {
        const layout = fitCardTitle(t, loc);
        if (layout.lines.length === 1) {
          expect(layout.scale, `${loc}: ${t}`).toBeLessThanOrEqual(1);
        } else {
          // Two lines and still shrinking would mean the split failed; per the
          // spec it never does.
          expect(layout.scale, `${loc}: ${t}`).toBe(TITLE.twoLineScale);
        }
      }
    }
  });
});

describe("per-script rules", () => {
  it("routes each locale to a face that has its script", () => {
    expect(titleFace("en")).toBe("latn");
    expect(titleFace("de")).toBe("latn");
    expect(titleFace("ru")).toBe("cyrl");
    expect(titleFace("uk")).toBe("cyrl");
    expect(titleFace("zh-Hans")).toBe("sc");
    expect(titleFace("ja")).toBe("jp");
  });

  it("gives Chinese and Japanese different faces", () => {
    // Half the codepoints the two sets share draw differently; Japanese in the
    // SC face would use mainland forms.
    expect(fitCardTitle("騎士", "ja").family).not.toBe(fitCardTitle("骑士", "zh-Hans").family);
  });

  it("has a real glyph for every character of every title, not tofu", () => {
    const faces = metrics.faces as unknown as Record<string, { advance: Record<string, number> }>;
    for (const [loc, ts] of ALL) {
      const primary = faces[titleFace(loc)];
      for (const t of ts) {
        for (const ch of titleCase(t, loc)) {
          if (/[\u00AD\u200B]/.test(ch)) continue;
          const has = primary.advance[ch] !== undefined || faces.latn.advance[ch] !== undefined;
          expect(
            has,
            `${loc}: ${t}: U+${ch.codePointAt(0)!.toString(16).toUpperCase()} (${ch})`,
          ).toBe(true);
        }
      }
    }
  });

  it("ships a Cyrillic face for every Cyrillic title glyph", () => {
    const faces = metrics.faces as unknown as Record<string, { advance: Record<string, number> }>;
    expect(faces.latn.advance["А"]).toBeUndefined();
    expect(faces.cyrl.advance["А"]).toBeDefined();
    for (const t of titles("ru")) {
      for (const ch of titleCase(t, "ru")) {
        if (/[Ѐ-ӿ]/.test(ch)) expect(faces.cyrl.advance[ch], `${t}: ${ch}`).toBeDefined();
      }
    }
  });

  it("ships a Devanagari face", () => {
    // As with the Cyrillic face: falling through to `latn`, which has no
    // Devanagari, would render every Hindi card as tofu.
    const faces = metrics.faces as unknown as Record<string, { advance: Record<string, number> }>;
    expect(titleFace("hi")).toBe("deva");
    expect(titleScript("hi")).toBe("devanagari");
    expect(faces.latn.advance["\u0915"]).toBeUndefined();
    expect(faces.deva.advance["\u0915"]).toBeDefined();
    for (const t of titles("hi")) {
      for (const ch of t) {
        if (/[\u0900-\u097F]/.test(ch)) expect(faces.deva.advance[ch], `${t}: ${ch}`).toBeDefined();
      }
    }
  });

  it("leaves Devanagari uncased and untracked", () => {
    // Caseless: Unicode defines no case mapping in U+0900-U+097F, so the
    // transform is switched off.
    expect(titleUppercases("hi")).toBe(false);
    expect(titleCase("\u0936\u0942\u0930\u0935\u0940\u0930", "hi")).toBe(
      "\u0936\u0942\u0930\u0935\u0940\u0930",
    );
    // Untracked: letter-spacing cuts the shirorekha, the headstroke across a
    // Devanagari word.
    const hi = fitCardTitle("\u0936\u0942\u0930\u0935\u0940\u0930", "hi");
    expect(hi.tracking).toBe(TITLE.devaTracking);
    expect(hi.tracking).toBe(0);
    // Baseline-sitting, so it holds the alphabetic baseline, not the CJK
    // optical centre.
    expect(hi.baseline).toBe(TITLE.baseline);
  });

  it("fits every Hindi title on one line at full size", () => {
    // The advance-sum model over-measures Devanagari (a conjunct is narrower
    // than its codepoints; up to 36% high on this set against HarfBuzz). The
    // error only runs that way, so while every title fits at scale 1 on the
    // inflated number, the model decides exactly as a true measurement would.
    for (const t of titles("hi")) {
      const l = fitCardTitle(t, "hi");
      expect(l.lines.length, `${t}`).toBe(1);
      expect(l.scale, `${t}`).toBe(1);
      expect(l.overflows, `${t}`).toBe(false);
    }
  });

  it("does not uppercase CJK, and does uppercase everything with case", () => {
    expect(titleUppercases("ja")).toBe(false);
    expect(titleUppercases("zh-Hans")).toBe(false);
    expect(titleUppercases("ru")).toBe(true);
    expect(titleCase("きょ", "ja")).toBe("きょ");
    expect(titleCase("Knight", "en")).toBe("KNIGHT");
  });

  it("uppercases Turkish i to the dotted capital", () => {
    // Python's str.upper() and locale-invariant toUpperCase() both get this
    // wrong.
    expect(titleCase("Ticaret Tekeli", "tr")).toBe("TİCARET TEKELİ");
  });

  it("gives CJK its own tracking and its own vertical placement", () => {
    const en = fitCardTitle("Knight", "en");
    const ja = fitCardTitle("騎士", "ja");
    expect(en.tracking).toBe(TITLE.tracking);
    expect(ja.tracking).toBe(TITLE.cjkTracking);
    // Cap height means nothing for Han, so CJK is not placed on the alphabetic
    // baseline.
    expect(ja.baseline).not.toBe(TITLE.baseline);
  });

  it("aligns CJK and Latin optical centres within 1%", () => {
    // A CJK title placed by the Latin baseline sits visibly low.
    const latinCentre = TITLE.baseline - TITLE.capHeight / 2;
    for (const loc of ["zh-Hans", "ja"] as const) {
      for (const t of titles(loc)) {
        const l = fitCardTitle(t, loc);
        const face = (metrics.faces as unknown as Record<string, { inkCentre: number }>)[
          titleFace(loc)
        ];
        const centre = l.baseline - face.inkCentre * l.fontSize;
        expect(Math.abs(centre - latinCentre), `${loc}: ${t}`).toBeLessThan(0.01);
      }
    }
  });

  it("never wraps a CJK title", () => {
    for (const loc of ["zh-Hans", "ja"] as const) {
      for (const t of titles(loc)) {
        expect(fitCardTitle(t, loc).lines.length, `${loc}: ${t}`).toBe(1);
        expect(titleScript(loc)).toBe("cjk");
      }
    }
  });
});

describe("break opportunities are data", () => {
  it("breaks a German compound at its authored seam", () => {
    const l = fitCardTitle("Rohstoff\u00ADmonopol", "de");
    expect(l.lines).toEqual(["ROHSTOFF-", "MONOPOL"]);
  });

  it("breaks an Italian elision without drawing a hyphen", () => {
    const l = fitCardTitle("Anno dell'\u200Babbondanza", "it");
    expect(l.lines).toEqual(["ANNO DELL'", "ABBONDANZA"]);
  });

  it("shrinks rather than crops when there is no seam at all", () => {
    // The fallback: small, never cut short.
    const l = fitCardTitle("Grondstoffenmonopolie", "nl");
    expect(l.lines.length).toBe(1);
    expect(l.scale).toBeLessThan(1);
    expect(l.lines[0]).toBe("GRONDSTOFFENMONOPOLIE");
  });

  it("carries the seam in every catalogue that needs one", () => {
    // Every unbreakable title that would otherwise shrink, so a new compound
    // translation does not silently land on the shrink ladder.
    for (const [loc, ts] of ALL) {
      if (titleScript(loc) === "cjk") continue;
      for (const t of ts) {
        const l = fitCardTitle(t, loc);
        expect(
          l.scale,
          `${loc}: ${t} has no break opportunity and is shrinking`,
        ).toBeGreaterThanOrEqual(TITLE.twoLineScale);
      }
    }
  });
});

describe("the shipped fonts and metrics are current", () => {
  it("regenerates to exactly what is committed", () => {
    // Without this a renamed card ships a tofu box and nothing here notices.
    const script = resolve(import.meta.dirname, "../../scripts/gen-title-fonts.py");
    if (!existsSync(script)) return;

    // Run via `uvx`, which fetches fontTools into a throwaway env; the system
    // python3 has no fontTools and there is no CI to fall back on (see
    // CONTRIBUTING.md). Only a missing `uvx` (ENOENT) is skipped, with a
    // warning.
    const args = ["--from", "fonttools", "--with", "brotli", "python", script, "--check"];
    try {
      execFileSync("uvx", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 });
    } catch (e) {
      const err = e as { stderr?: Buffer; code?: string };
      if (err.code === "ENOENT") {
        console.warn(
          "cardTitle: uvx not installed, skipping font check; run " +
            `\`uvx ${args.join(" ")}\` by hand.`,
        );
        return;
      }
      throw new Error(err.stderr?.toString() ?? "", { cause: e });
    }
  }, 600_000);
});
