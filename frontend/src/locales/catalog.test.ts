import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LOCALES } from "@/lib/i18n";
import linguiConfig from "../../lingui.config";

const dir = join(import.meta.dirname, "");
const frontendDir = resolve(dir, "../..");

function po(locale: string): string {
  return readFileSync(join(dir, locale, "messages.po"), "utf8");
}

/**
 * Every live entry of a catalogue in file order, keyed by context and id, with
 * continuation lines joined. Unlike `translations` below this keeps `msgctxt`
 * and skips the `#~` obsolete block. A list, so duplicate keys stay visible.
 */
function entryList(src: string): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  let ctxt = "";
  let id: string | null = null;
  let str: string | null = null;
  let field: "ctxt" | "id" | "str" | null = null;
  const flush = () => {
    if (id) out.push({ key: JSON.stringify([ctxt, id]), text: str ?? "" });
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

/** `entryList` collapsed to a lookup. Last one wins, as a `.po` reader would. */
function entries(src: string): Map<string, string> {
  return new Map(entryList(src).map((e) => [e.key, e.text]));
}

/** Every `msgstr "..."` body in a catalogue, ignoring the header entry. */
function translations(src: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  let id = "";
  for (const line of src.split("\n")) {
    const mid = /^msgid "(.*)"$/.exec(line);
    if (mid) id = mid[1];
    const mstr = /^msgstr "(.*)"$/.exec(line);
    if (mstr && id) out.push({ id, text: mstr[1] });
  }
  return out;
}

/**
 * The argument names one message interpolates, at any depth.
 *
 * A scanner rather than `/\{\w+\}/`, which would read a one-word select or
 * plural arm (`{cargo, select, 1 {marble} other {…}}`) as a `{marble}`
 * placeholder. Arm bodies are scanned for their own arguments.
 */
export function placeholders(text: string): string[] {
  const out: string[] = [];
  const walk = (s: string, i: number, stopAtClose: boolean): number => {
    while (i < s.length) {
      const c = s[i];
      if (c === "}" && stopAtClose) return i + 1;
      if (c !== "{") {
        i++;
        continue;
      }
      // An argument: `{name}` or `{name, type, …}`.
      const m = /^\{\s*([A-Za-z0-9_]+)\s*(?=[},])(,\s*(plural|select|selectordinal)\s*,)?/.exec(
        s.slice(i),
      );
      if (!m) {
        i++;
        continue;
      }
      out.push(m[1]);
      i += m[0].length;
      if (!m[2]) {
        // `{name}` or `{name, number}`: skip to its close.
        while (i < s.length && s[i] !== "}") i++;
        i++;
        continue;
      }
      // Cases: `key {message}` repeated, then the closing `}`.
      while (i < s.length) {
        while (i < s.length && /\s/.test(s[i])) i++;
        if (s[i] === "}") {
          i++;
          break;
        }
        while (i < s.length && s[i] !== "{" && s[i] !== "}") i++;
        if (s[i] === "{") i = walk(s, i + 1, true);
      }
    }
    return i;
  };
  walk(text, 0, false);
  return out;
}

/**
 * The plural categories a locale can actually select, plus `other`.
 *
 * From Intl.PluralRules (i.e. from CLDR, via the runtime's own ICU data), not
 * from a table in this file. 10000 is the ceiling because nothing this app
 * counts goes higher; it is what excludes Spanish, French, Portuguese and
 * Italian `many`, which CLDR defines only for compact millions.
 */
export function requiredPluralCategories(locale: string): string[] {
  const rules = new Intl.PluralRules(locale);
  const seen = new Set<string>();
  for (let n = 0; n <= 10000; n++) seen.add(rules.select(n));
  seen.add("other");
  return [...seen].sort();
}

/**
 * The arm names of every ICU `plural` in one message, outermost first.
 *
 * Brace-counted rather than matched with a regex, because arms nest: a plural
 * inside a select inside a plural is one message the log already writes.
 * Explicit `=0` / `=1` arms are dropped, since they are exact-value overrides
 * rather than categories and can never stand in for one.
 */
export function pluralArms(text: string): string[][] {
  const out: string[][] = [];
  const open = /\{\s*[A-Za-z0-9_]+\s*,\s*plural\s*,/g;
  while (open.exec(text)) {
    let i = open.lastIndex;
    let depth = 1;
    let body = "";
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) break;
      }
      body += c;
      i++;
    }
    out.push([...body.matchAll(/(?:^|[\s}])(zero|one|two|few|many|other)\s*\{/g)].map((x) => x[1]));
  }
  return out;
}

describe("message catalogues", () => {
  it("ships a catalogue for every locale the app offers", () => {
    for (const l of LOCALES) {
      expect(() => po(l), l).not.toThrow();
    }
  });

  it("keeps en/messages.po saying exactly what the source code says", { timeout: 120_000 }, () => {
    // `lingui extract` does not overwrite an existing msgstr in the source
    // locale without `--overwrite`, so an edited English string could leave
    // en/messages.po stale with no error, and translators would translate the
    // old text. `npm run i18n:extract` passes `--overwrite`; this catches an
    // edit with no extract run.
    //
    // It extracts for real, into a temp dir: only the extractor's babel pass
    // can read `msg({ id, message })`. The temp config imports the real one
    // and changes only the output path and locale list.
    const out = mkdtempSync(join(tmpdir(), "costan-i18n-"));
    try {
      const cfg = join(out, "lingui.config.ts");
      writeFileSync(
        cfg,
        `import config from ${JSON.stringify(join(frontendDir, "lingui.config.ts"))};
export default {
  ...config,
  locales: ["en"],
  catalogs: [
    {
      ...config.catalogs[0],
      path: ${JSON.stringify(join(out, "{locale}", "messages"))},
      include: [${JSON.stringify(join(frontendDir, "src"))}],
    },
  ],
};
`,
      );
      const run = spawnSync(
        join(frontendDir, "node_modules", ".bin", "lingui"),
        ["extract", "--overwrite", "--config", cfg],
        { cwd: frontendDir, encoding: "utf8" },
      );
      expect(run.status, `lingui extract failed:\n${run.stdout}\n${run.stderr}`).toBe(0);

      const fresh = entries(readFileSync(join(out, "en", "messages.po"), "utf8"));
      const committed = entries(po("en"));
      const drifted: string[] = [];
      for (const [key, text] of fresh) {
        if (committed.get(key) !== text) {
          drifted.push(
            `${key}\n    committed: ${committed.get(key) ?? "(absent)"}\n    source:    ${text}`,
          );
        }
      }
      expect(
        drifted,
        "en/messages.po is stale. Run `npm run i18n:extract`, then reconcile every locale: a " +
          "translation of English the source no longer contains is worse than no translation, " +
          "because an empty msgstr falls back to the real English and a stale one lies.",
      ).toEqual([]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("never lets one catalogue carry the same message twice", () => {
    // A `.po` can hold two entries with the same (msgctxt, msgid), usually from
    // a text merge that kept both hunks. The compiler silently keeps one, the
    // other checks here read through a Map and never see it, and the next
    // `lingui extract` may keep the empty copy and drop the translation.
    // Covers `en` too, and does not judge which copy is right: keep one by hand.
    for (const locale of LOCALES) {
      const seen = new Map<string, number>();
      for (const { key } of entryList(po(locale))) seen.set(key, (seen.get(key) ?? 0) + 1);
      const dupes = [...seen].filter(([, n]) => n > 1).map(([key, n]) => `${key} x${n}`);
      expect(dupes, `${locale}/messages.po has duplicate entries`).toEqual([]);
    }
  });

  it("keeps em dashes out of every catalogue", () => {
    for (const locale of LOCALES) {
      expect(po(locale).includes("\u2014"), locale).toBe(false);
    }
  });

  it("never lets a translation be a bare message id", () => {
    // Catches a player seeing `error.NOT_YOUR_TURN` from a hand-edited
    // catalogue. `en` is exempt: most messages are keyed by their own text.
    for (const locale of LOCALES.filter((l) => l !== "en")) {
      for (const { id, text } of translations(po(locale))) {
        if (!text) continue;
        expect(text, `${locale}: ${id}`).not.toBe(id);
      }
    }
  });

  it("keeps every locale's placeholders, tags and plural arguments", () => {
    // A dropped `{name}` leaves a hole, a dropped `<0/>` loses a card or die
    // icon, and a renamed plural argument throws at format time.
    //
    // Placeholders compare as a set (a language may name something once where
    // English names it twice, as some `card.improveShort.*` entries in `zh-Hans`
    // and `ja` do). Tags and plural arguments compare exactly: the code
    // addresses both by name.
    const source = new Map(translations(po("en")).map((t) => [t.id, t.text]));
    const set = (s: string) => [...new Set(placeholders(s))].sort();
    const tags = (s: string) => (s.match(/<\/?\d+\/?>/g) ?? []).sort();
    const args = (s: string) =>
      (s.match(/\{[A-Za-z0-9_]+,\s*(?:plural|select|selectordinal)/g) ?? []).sort();
    for (const locale of LOCALES.filter((l) => l !== "en")) {
      for (const { id, text } of translations(po(locale))) {
        const en = source.get(id);
        if (!text || en === undefined) continue;
        expect(set(text), `${locale}: ${id}: placeholders`).toEqual(set(en));
        expect(tags(text), `${locale}: ${id}: rich-text tags`).toEqual(tags(en));
        expect(args(text), `${locale}: ${id}: ICU arguments`).toEqual(args(en));
      }
    }
  });

  it("keeps lingui.config.ts's locale list identical to LOCALES", () => {
    // @lingui/vite-plugin compiles a locale missing from the config's
    // `locales` into a catalogue of English without any error, so the app runs
    // "in Polish" with English strings. The two lists exist because the bundle
    // and the extractor CLI cannot import each other's module format. Order
    // does not matter to either.
    const configured = [...(linguiConfig.locales ?? [])].sort();
    expect(configured, "lingui.config.ts locales vs LOCALES in lib/i18n.ts").toEqual(
      [...LOCALES].sort(),
    );
  });

  it("gives every ICU plural all the categories its locale can reach", () => {
    // The placeholder guard above compares argument names only, so a Polish
    // entry with just English's `one` and `other` would pass it and show the
    // wrong noun beside a 3 or a 22.
    //
    // Required: the CLDR categories (from Intl.PluralRules) the locale selects
    // for counts under ten thousand, plus `other`, which ICU always requires.
    // A superset is fine (an explicit `=0` arm, say); only missing arms fail.
    for (const locale of LOCALES.filter((l) => l !== "en")) {
      const required = requiredPluralCategories(locale);
      for (const { id, text } of translations(po(locale))) {
        if (!text) continue; // untranslated: falls back to English, which is complete
        for (const got of pluralArms(text)) {
          const missing = required.filter((c) => !got.includes(c));
          expect(missing, `${locale}: ${id}: plural arms ${JSON.stringify(got)}`).toEqual([]);
        }
      }
    }
  });
});

describe("placeholders", () => {
  it("does not read a one-word select arm as a placeholder", () => {
    expect(placeholders("{player} loaded {cargo, select, 1 {marble} other {a cargo}}")).toEqual([
      "player",
      "cargo",
    ]);
  });
  it("finds arguments nested inside arms", () => {
    expect(
      placeholders("{n, plural, one {# card from {name}} other {# cards from {name}}} <0/>"),
    ).toEqual(["n", "name", "name"]);
  });
});
