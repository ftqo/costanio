import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";
import {
  CJK_LOCALES,
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  LANG_STORAGE_KEY,
  RELEASED_LOCALES,
  isLocale,
  isReleased,
  matchLocale,
  resolveLocale,
  storedLocale,
  storeLocale,
  applyDocumentLocale,
  activateLocale,
  currentLocale,
  loadCatalog,
  type Locale,
} from "./i18n";
import { formatList, formatNumber, resetIntlCaches } from "./intl";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const DRAFT_LOCALES = LOCALES.filter((l) => l !== "en");

/**
 * The message ids whose `msgstr` is empty in one locale's catalogue on disk.
 *
 * Reads the file, not the compiled catalogue, where @lingui/vite-plugin has
 * already replaced blanks with the English source.
 *
 * The id is not the `msgid`: the po file holds the source text and Lingui's id
 * is a hash of text and context (except for `js-lingui-explicit-id` entries).
 * So this runs the same `generateMessageId` as the compiler.
 *
 * Its own small parser rather than an import from `src/locales/catalog.test.ts`,
 * since importing a test file re-registers its (slow) suites.
 */
function poBlankIds(locale: string): string[] {
  const src = readFileSync(
    join(import.meta.dirname, "..", "locales", locale, "messages.po"),
    "utf8",
  );
  const out: string[] = [];
  // Entries are separated by blank lines; the obsolete `#~` block is skipped.
  for (const block of src.split("\n\n")) {
    if (block.includes("#~")) continue;
    const field = (name: string): string | null => {
      const lines = block.split("\n");
      const at = lines.findIndex((l) => l.startsWith(`${name} "`));
      if (at < 0) return null;
      let text = /^\S+ "(.*)"$/.exec(lines[at])?.[1] ?? "";
      for (let i = at + 1; i < lines.length; i++) {
        const cont = /^"(.*)"$/.exec(lines[i]);
        if (!cont) break;
        text += cont[1];
      }
      return text;
    };
    const msgid = field("msgid");
    if (msgid === null || msgid === "") continue; // header entry
    if (field("msgstr") !== "") continue;
    const explicit = block.includes("js-lingui-explicit-id");
    out.push(
      explicit ? msgid : generateMessageId(unescapePo(msgid), field("msgctxt") ?? undefined),
    );
  }
  return out;
}

/** Unescape a po body far enough to hash it the way the compiler does. */
function unescapePo(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * The ids whose English source selects on a plural category.
 *
 * These cannot be compared across locales by string equality: a blank falls
 * back to the English source, but the arm is chosen under the reader's CLDR
 * categories (zh-Hans has only `other`, so "1 second left" renders "1 seconds
 * left"). Only the equality check is skipped.
 *
 * For a keyed message (`js-lingui-explicit-id`) the msgid is the key and the
 * English is in en/messages.po's msgstr, so both are checked.
 */
function pluralIds(): Set<string> {
  const src = readFileSync(join(import.meta.dirname, "..", "locales", "en", "messages.po"), "utf8");
  const out = new Set<string>();
  const body = (lines: string[], at: number): string => {
    let text = /^\S+ "(.*)"$/.exec(lines[at])?.[1] ?? "";
    for (let i = at + 1; i < lines.length; i++) {
      const cont = /^"(.*)"$/.exec(lines[i]);
      if (!cont) break;
      text += cont[1];
    }
    return text;
  };
  for (const block of src.split("\n\n")) {
    if (block.includes("#~")) continue;
    const lines = block.split("\n");
    const at = lines.findIndex((l) => l.startsWith('msgid "'));
    if (at < 0) continue;
    const text = body(lines, at);
    if (text === "") continue;
    const strAt = lines.findIndex((l) => l.startsWith('msgstr "'));
    const english = strAt < 0 ? "" : body(lines, strAt);
    const isPlural = /\{\s*\w+\s*,\s*(plural|selectordinal)\s*,/;
    if (!isPlural.test(text) && !isPlural.test(english)) continue;
    const ctx = lines.find((l) => l.startsWith('msgctxt "'));
    const explicit = block.includes("js-lingui-explicit-id");
    out.add(
      explicit
        ? text
        : generateMessageId(unescapePo(text), ctx ? /"(.*)"/.exec(ctx)?.[1] : undefined),
    );
  }
  return out;
}

/**
 * Render one message with every argument satisfied.
 *
 * The catalogue's ICU plurals and selects name their arguments differently; a
 * proxy answering 1 to everything satisfies all of them. Only that formatting
 * completes matters.
 */
function render(
  i18n: { _: (d: { id: string; values: Record<string, unknown> }) => string },
  id: string,
): string {
  const anyValue = new Proxy({}, { get: () => 1, has: () => true }) as Record<string, unknown>;
  return i18n._({ id, values: anyValue });
}

describe("matchLocale", () => {
  it("takes an exact tag", () => {
    expect(matchLocale("ja")).toBe("ja");
    expect(matchLocale("zh-Hans")).toBe("zh-Hans");
    expect(matchLocale("en")).toBe("en");
  });

  it("is case and separator insensitive", () => {
    expect(matchLocale("JA")).toBe("ja");
    expect(matchLocale("zh_hans")).toBe("zh-Hans");
  });

  it("falls back to the bare language, so ja-JP resolves to ja", () => {
    expect(matchLocale("ja-JP")).toBe("ja");
    expect(matchLocale("en-GB")).toBe("en");
    expect(matchLocale("en-US")).toBe("en");
  });

  it("routes the Simplified-writing Chinese regions to zh-Hans", () => {
    // A Singaporean or mainland browser never sends the tag we ship under.
    for (const tag of ["zh", "zh-CN", "zh-SG", "zh-Hans-CN"]) {
      expect(matchLocale(tag), tag).toBe("zh-Hans");
    }
  });

  it("refuses Traditional Chinese rather than serving it Simplified", () => {
    // We do not ship zh-Hant, and English beats the wrong Chinese.
    for (const tag of ["zh-Hant", "zh-TW", "zh-HK", "zh-MO"]) {
      expect(matchLocale(tag), tag).toBeNull();
    }
  });

  it("keeps an explicit Hans script even where the region writes Traditional", () => {
    // Simplified readers in Hong Kong or Macau. An explicit script subtag
    // decides; the region is only a guess.
    for (const tag of ["zh-Hans-HK", "zh-Hans-MO", "zh_hans_hk"]) {
      expect(matchLocale(tag), tag).toBe("zh-Hans");
    }
    // An explicit Hant is refused wherever it appears.
    for (const tag of ["zh-Hant-CN", "zh-Hant-SG"]) {
      expect(matchLocale(tag), tag).toBeNull();
    }
  });

  it("resolves every regional variant of a shipped language", () => {
    // Lookup rather than equality: adding de and es needed no code change.
    for (const tag of ["de", "de-DE", "de-AT", "de-CH", "de_DE"]) {
      expect(matchLocale(tag), tag).toBe("de");
    }
    for (const tag of ["es", "es-ES", "es-MX", "es-419", "es-AR"]) {
      expect(matchLocale(tag), tag).toBe("es");
    }
  });

  it("returns null for anything unshipped or empty", () => {
    // Needs a plausible browser language that is not in LOCALES; recheck when a
    // language lands.
    expect(matchLocale("ko")).toBeNull();
    expect(matchLocale("ko-KR")).toBeNull();
    expect(matchLocale("")).toBeNull();
    expect(matchLocale(null)).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });
});

describe("resolveLocale", () => {
  it("falls all the way through to English", () => {
    expect(resolveLocale({ stored: null })).toBe("en");
    // No stored choice, no hint, no browser language we ship.
    expect(resolveLocale({ stored: null, navigator: ["ko-KR", "th-TH"] })).toBe("en");
  });

  it("infers a language from the browser", () => {
    // A browser set to a released language gets it on first visit.
    expect(resolveLocale({ stored: null, navigator: ["de", "fr"] })).toBe("de");
    expect(resolveLocale({ stored: null, navigator: ["de-DE", "en-US"] })).toBe("de");
    expect(resolveLocale({ stored: null, navigator: ["ja-JP", "en-US"] })).toBe("ja");
    expect(resolveLocale({ stored: null, navigator: ["zh-CN"] })).toBe("zh-Hans");
    expect(resolveLocale({ stored: null, navigator: ["pt-BR"] })).toBe("pt-BR");
    // The browser's order is honoured: English-first stays English.
    expect(resolveLocale({ stored: null, navigator: ["en-GB", "de-DE"] })).toBe("en");
    // Unshipped tags are skipped rather than stopping the walk.
    expect(resolveLocale({ stored: null, navigator: ["ko-KR", "pl-PL", "en"] })).toBe("pl");
    // Traditional Chinese is refused and falls through to the next tag.
    expect(resolveLocale({ stored: null, navigator: ["zh-TW", "ja"] })).toBe("ja");
    expect(resolveLocale({ stored: null, navigator: ["zh-TW"] })).toBe("en");
  });

  it("infers every released language", () => {
    // A locale left out of RELEASED_LOCALES would never be inferred. Checks a
    // subset, not equality, since holding a locale back is supported: nothing
    // may be released that is not a shipped locale.
    const unshipped = RELEASED_LOCALES.filter((l) => !isLocale(l));
    expect(unshipped, `released but not in LOCALES: ${unshipped.join(", ")}`).toEqual([]);
    for (const loc of RELEASED_LOCALES) {
      expect(resolveLocale({ stored: null, navigator: [loc] }), loc).toBe(loc);
      expect(isReleased(loc), loc).toBe(true);
    }
  });

  it("gates inference on release", () => {
    // Empty today (every locale is released); these assertions cover a locale
    // held back while being translated.
    for (const loc of LOCALES.filter((l) => !RELEASED_LOCALES.includes(l))) {
      expect(resolveLocale({ stored: null, navigator: [loc] }), loc).toBe("en");
      expect(resolveLocale({ stored: null, query: loc }), loc).toBe(loc);
    }
  });

  it("prefers the ?lang= hint over the browser", () => {
    // Nothing stamps ?lang= now, but a hand-typed one must still work.
    expect(resolveLocale({ stored: null, query: "zh-Hans", navigator: ["en"] })).toBe("zh-Hans");
    // It outranks a browser language too.
    expect(resolveLocale({ stored: null, query: "pl", navigator: ["de-DE"] })).toBe("pl");
  });

  it("lets an explicit choice outrank the ?lang= hint", () => {
    // ?lang= wins only without a stored preference: a pasted link must not
    // switch the UI of a player who picked English in Settings.
    expect(resolveLocale({ stored: "en", query: "ja", navigator: ["ja"] })).toBe("en");
  });

  it("ignores an unshipped ?lang= rather than erroring", () => {
    expect(resolveLocale({ stored: null, query: "ko", navigator: ["en"] })).toBe("en");
    expect(resolveLocale({ stored: null, query: "nonsense" })).toBe("en");
  });
});

describe("stored preference", () => {
  it("round-trips through localStorage", () => {
    expect(storedLocale()).toBeNull();
    storeLocale("ja");
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("ja");
    expect(storedLocale()).toBe("ja");
  });

  it("ignores a stored value we no longer ship", () => {
    localStorage.setItem(LANG_STORAGE_KEY, "ko");
    expect(storedLocale()).toBeNull();
    expect(resolveLocale({ navigator: ["en"] })).toBe("en");
  });
});

describe("catalogues", () => {
  it("ships a self-named label for every locale", () => {
    for (const l of LOCALES) {
      expect(LOCALE_LABELS[l], l).toBeTruthy();
    }
    expect(LOCALE_LABELS["zh-Hans"]).toBe("简体中文");
    expect(LOCALE_LABELS.ja).toBe("日本語");
    expect(LOCALE_LABELS.de).toBe("Deutsch");
    expect(LOCALE_LABELS.es).toBe("Español");
  });

  it("recognises exactly the shipped locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ja")).toBe(true);
    expect(isLocale("de")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("pl")).toBe(true);
    expect(isLocale("ko")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it("falls back to English for a message the translation is missing", async () => {
    // A half-translated catalogue degrades to English, never to a message id.
    const { i18n } = await import("@lingui/core");
    await activateLocale("ja");
    expect(currentLocale()).toBe("ja");
    const rendered = i18n._({ id: "error.NOT_YOUR_TURN", message: "It's not your turn." });
    expect(rendered).not.toBe("error.NOT_YOUR_TURN");
    expect(rendered.length).toBeGreaterThan(0);
    await activateLocale("en");
  });

  it("stamps the document so the per-script CSS can key off it", () => {
    applyDocumentLocale("ja");
    expect(document.documentElement.lang).toBe("ja");
    expect(document.documentElement.dir).toBe("ltr");
    applyDocumentLocale("en");
    expect(document.documentElement.lang).toBe("en");
  });
});

/**
 * What releasing every catalogue requires, checked against every locale since a
 * stranger's browser can land in any of them:
 *
 *  1. A blank msgstr renders English, not an empty string. Catalogues have
 *     intentional blanks (where the English is the right translation) and
 *     genuine gaps.
 *  2. A locale missing from `lingui.config.ts` silently compiles to English
 *     under its own name. `catalog.test.ts` compares the lists; this checks the
 *     rendered output.
 *  3. No message id reaches a player.
 */
describe("every released catalogue, at runtime", () => {
  /** What English renders for every id, so a locale can be compared against it. */
  const englishRenders = new Map<string, string>();

  beforeAll(async () => {
    const { i18n } = await import("@lingui/core");
    await activateLocale("en");
    for (const id of Object.keys(await loadCatalog("en"))) {
      englishRenders.set(id, render(i18n, id));
    }
  });

  // activateLocale mutates the shared global i18n instance; restore English.
  afterEach(async () => {
    await activateLocale("en");
  });

  // 30s rather than the 5s default: this activates every catalogue (~2,100
  // entries each), and a timeout would read as a hang.
  it("renders English where a translation is blank, never an empty string", async () => {
    // Blanks (intentional copies like `{0}`, `Pips`, `2:1 {resource}`, and
    // untranslated entries) must render the English. Asserts the outcome
    // rather than any one fallback layer (compile-time resolution, the macro's
    // source at the call site).
    const { i18n } = await import("@lingui/core");
    // Read once: all locales share one English source.
    const plurals = pluralIds();
    for (const locale of DRAFT_LOCALES) {
      const blanks = poBlankIds(locale);
      // Every locale has some intentional blanks; none would mean they were
      // filled with English copies, which catalog.test.ts forbids.
      expect(blanks.length, `${locale} has no blank entries to fall back from`).toBeGreaterThan(0);

      await activateLocale(locale);
      expect(currentLocale()).toBe(locale);
      for (const id of blanks) {
        const en = englishRenders.get(id);
        expect(en, `${locale}: ${id} is blank but has no English source`).toBeDefined();
        const rendered = render(i18n, id);
        // Plurals are not compared for equality: the fallback is selected under
        // the target locale's CLDR categories (see pluralIds). Not blank and not
        // a bare id still apply.
        if (!plurals.has(id)) {
          expect(rendered, `${locale}: ${id}`).toBe(en);
        }
        expect(rendered, `${locale}: ${id}`).not.toBe("");
        expect(rendered, `${locale}: ${id}`).not.toBe(id);
      }
    }
  }, 30_000);

  it("never compiles an entry to nothing, in any locale", async () => {
    // The same guarantee one layer down: no compiled key may be absent, empty
    // or its own id.
    const enIds = Object.keys(await loadCatalog("en"));
    for (const locale of LOCALES) {
      const cat = await loadCatalog(locale);
      for (const id of enIds) {
        const v = cat[id];
        expect(v, `${locale}: ${id} absent`).toBeDefined();
        expect(v, `${locale}: ${id} empty`).not.toBe("");
        expect(v, `${locale}: ${id} is its own id`).not.toBe(id);
        if (Array.isArray(v)) expect(v.length, `${locale}: ${id} empty`).toBeGreaterThan(0);
      }
    }
  }, 30_000);

  it("renders in its own language", async () => {
    // A locale missing from lingui.config.ts compiles to English under its own
    // name with no error. catalog.test.ts checks the config lists; this checks
    // the output.
    const { i18n } = await import("@lingui/core");
    const en = await loadCatalog("en");
    for (const locale of DRAFT_LOCALES) {
      const cat = await loadCatalog(locale);
      const own = Object.keys(en).filter(
        (id) => JSON.stringify(cat[id]) !== JSON.stringify(en[id]),
      );
      // ~2,100 entries per catalogue, a few dozen blank. An English catalogue
      // would score zero here.
      expect(own.length, `${locale} differs from English in too few entries`).toBeGreaterThan(1500);

      await activateLocale(locale);
      let differs = 0;
      for (const id of own) {
        if (render(i18n, id) !== englishRenders.get(id)) differs++;
      }
      expect(differs, `${locale} renders English under its own name`).toBeGreaterThan(
        own.length * 0.9,
      );
    }
  });

  it("never renders a bare message id, in any locale", async () => {
    // Neither `sM7v0M` nor `error.NOT_YOUR_TURN` may reach the screen. Keyed
    // and hashed ids are both walked.
    const { i18n } = await import("@lingui/core");
    const ids = Object.keys(await loadCatalog("en"));
    const explicit = ids.filter((id) => /^[a-z][A-Za-z0-9]*\./.test(id));
    expect(explicit.length).toBeGreaterThan(100);
    for (const locale of LOCALES) {
      await activateLocale(locale);
      for (const id of ids) {
        const rendered = render(i18n, id);
        expect(rendered, `${locale}: ${id}`).not.toBe(id);
        expect(rendered.length, `${locale}: ${id}`).toBeGreaterThan(0);
      }
    }
  });

  it("loads every locale without throwing, and stamps the document each time", async () => {
    for (const loc of LOCALES) {
      await expect(activateLocale(loc), loc).resolves.toBeUndefined();
      expect(currentLocale(), loc).toBe(loc);
      // `<html lang>` drives the CJK font stack, letter-spacing and uppercase
      // suppression in index.css. activateLocale sets it, so a Settings switch
      // cannot leave typography behind.
      expect(document.documentElement.lang, loc).toBe(loc);
      expect(document.documentElement.dir, loc).toBe("ltr");
    }
  });

  it("ships a complete catalogue for every locale", async () => {
    // activateLocale loads one catalogue instead of merging English under it.
    // That is safe only while every compiled catalogue has the full key set
    // with nothing blank; if this fails, the merge has to come back.
    const enKeys = Object.keys(await loadCatalog("en")).sort();
    expect(enKeys.length).toBeGreaterThan(2000);
    for (const loc of DRAFT_LOCALES) {
      const cat = await loadCatalog(loc);
      expect(Object.keys(cat).sort(), `${loc}: key set differs from en`).toEqual(enKeys);
      const blank = Object.entries(cat)
        .filter(([, v]) => v === "" || v === null || v === undefined)
        .map(([k]) => k);
      expect(blank, `${loc}: blank compiled entries`).toEqual([]);
    }
  });

  it("preloads the resolved locale's catalogue from index.html's head", () => {
    // First paint waits on this chunk (LocaleProvider holds the tree), and Vite
    // emits no modulepreload for the app's own chunks, so index.html's inline
    // script preloads it. Run that script with the map the build injects
    // (costan-catalog-preload in vite.config.ts) and check a link comes out.
    const html = readFileSync(join(import.meta.dirname, "..", "..", "index.html"), "utf8");
    const inline = /<script>([\s\S]*?)<\/script>/.exec(html);
    expect(inline, "index.html no longer opens with an inline script").toBeTruthy();
    // Our own index.html; running it tests behaviour, not appearance.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function(inline![1]);

    const w = window as unknown as { __COSTAN_CATALOGS__?: Record<string, string> };
    const links = () =>
      [...document.head.querySelectorAll("link[rel=modulepreload]")].map((l) =>
        l.getAttribute("href"),
      );
    try {
      w.__COSTAN_CATALOGS__ = { en: "/assets/en-aaaa.js", pl: "/assets/pl-bbbb.js" };

      localStorage.setItem(LANG_STORAGE_KEY, "pl");
      run();
      expect(links(), "the stored choice is what gets preloaded").toEqual(["/assets/pl-bbbb.js"]);

      // No stored choice and an unshipped browser language: English.
      document.head.querySelectorAll("link[rel=modulepreload]").forEach((l) => l.remove());
      localStorage.clear();
      run();
      expect(links()).toEqual(["/assets/en-aaaa.js"]);

      // A build with no map (or dev) gets a slower first paint, not a broken one.
      document.head.querySelectorAll("link[rel=modulepreload]").forEach((l) => l.remove());
      delete w.__COSTAN_CATALOGS__;
      run();
      expect(links()).toEqual([]);
    } finally {
      delete w.__COSTAN_CATALOGS__;
      document.head.querySelectorAll("link[rel=modulepreload]").forEach((l) => l.remove());
    }
  });

  it("keeps index.html's pre-paint stamp agreeing with the real chain", () => {
    // index.html stamps `<html lang>` inline before the bundle loads, so the
    // first frame uses the right font stack. Its copy of the locale list and
    // match logic must agree with matchLocale. This runs the script's own
    // `match` against discriminating tags: exact hits, subtag drops,
    // separators, Simplified regions, the Traditional refusal, unshipped tags.
    const html = readFileSync(join(import.meta.dirname, "..", "..", "index.html"), "utf8");
    const list = /var LOCALES = (\[[^\]]*\]);/.exec(html);
    expect(list, "index.html no longer declares a LOCALES array").toBeTruthy();
    expect(JSON.parse(list![1])).toEqual([...LOCALES]);
    expect(html, "the pre-paint stamp ignores the browser's own languages").toContain(
      "navigator.languages",
    );

    const chunk = /var LOCALES = [\s\S]*?\n {10}};/.exec(html);
    // Evaluating our own index.html is the only way to compare behaviour
    // rather than two copies of a regex.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const match = new Function(`${chunk![0]}\nreturn match;`)() as (t: string) => string | null;
    for (const tag of [
      "en",
      "ja",
      "JA",
      "ja-JP",
      "zh-Hans",
      "zh_hans",
      "zh",
      "zh-CN",
      "zh-SG",
      "zh-Hans-CN",
      "zh-Hant",
      "zh-TW",
      "zh-HK",
      "zh-MO",
      "zh-Hans-HK",
      "zh-Hans-MO",
      "zh-Hant-CN",
      "de-AT",
      "pt-BR",
      "pt-PT",
      "es-419",
      "uk-UA",
      "ko-KR",
      "nonsense",
      "",
    ]) {
      expect(match(tag), tag).toBe(matchLocale(tag));
    }
  });

  it("stamps a lang the CJK rules can match, and only for CJK", async () => {
    // index.css matches `:root:lang(zh-Hans)` and `:root:lang(ja)` against the
    // exact attribute value, so the locale id itself must be written.
    for (const loc of CJK_LOCALES) {
      await activateLocale(loc);
      expect(document.documentElement.lang).toBe(loc);
      expect(document.documentElement.matches(`:lang(${loc})`), loc).toBe(true);
    }
    // A Latin locale must not match them, or it loses uppercase headings.
    for (const loc of ["de", "pl", "tr", "pt-BR"] as Locale[]) {
      await activateLocale(loc);
      for (const cjk of CJK_LOCALES) {
        expect(document.documentElement.matches(`:lang(${cjk})`), `${loc} vs ${cjk}`).toBe(false);
      }
    }
  });
});

describe("Intl formatting follows the app's locale, not the browser's", () => {
  beforeEach(() => resetIntlCaches());

  it("formats numbers per locale", () => {
    expect(formatNumber(1234567, undefined, "en")).toBe("1,234,567");
  });

  it("uses the locale's own list grammar instead of an English join", () => {
    expect(formatList(["wood"], "conjunction", "en")).toBe("wood");
    expect(formatList(["wood", "ore"], "conjunction", "en")).toBe("wood and ore");
    // Japanese joins with an ideographic comma and no conjunction.
    expect(formatList(["wood", "ore"], "conjunction", "ja")).not.toContain("and");
  });
});

describe("a catalogue chunk that never arrives", () => {
  // LocaleProvider holds the tree until `activateLocale` resolves. A chunk that
  // fails to load (a redeploy removed it, a dropped request) must not leave the
  // page blank.
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The fallback path logs on purpose; the suite does not need to read it.
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errors.mockRestore();
    vi.doUnmock("@/locales/pl/messages.po");
    vi.doUnmock("@/locales/en/messages.po");
    vi.resetModules();
  });

  /**
   * A fresh copy of the module under a fresh Lingui instance. The mock must be
   * in place before the dynamic import, and the active catalogue lives in
   * @lingui/core, so both are re-instantiated.
   */
  async function freshI18n() {
    vi.resetModules();
    return await import("./i18n");
  }

  const failsToLoad = () => {
    throw new Error("Failed to fetch dynamically imported module");
  };

  it("degrades to English instead of rejecting", async () => {
    vi.doMock("@/locales/pl/messages.po", failsToLoad);
    const m = await freshI18n();
    // The strict entry point still rejects.
    await expect(m.activateLocale("pl")).rejects.toThrow();
    // The one the UI uses does not.
    await expect(m.activateLocaleOrFallback("pl")).resolves.toBe("en");
    expect(m.currentLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps the current language when a switch fails", async () => {
    // Someone reading Japanese who picks Polish and loses the request stays in
    // Japanese.
    vi.doMock("@/locales/pl/messages.po", failsToLoad);
    const m = await freshI18n();
    await m.activateLocale("ja");
    await expect(m.activateLocaleOrFallback("pl")).resolves.toBe("ja");
    expect(m.currentLocale()).toBe("ja");
    expect(document.documentElement.lang).toBe("ja");
  });

  it("renders untranslated when the English catalogue fails", async () => {
    // A failed English chunk must not blank every language.
    vi.doMock("@/locales/en/messages.po", failsToLoad);
    const m = await freshI18n();
    await expect(m.activateLocaleOrFallback("en")).resolves.toBe("en");
    expect(m.currentLocale()).toBe("en");
    // The macros keep the English source at the call site, so an empty
    // catalogue still renders words.
    const { i18n } = await import("@lingui/core");
    expect(i18n._({ id: "someHash", message: "Roll the dice." })).toBe("Roll the dice.");
  });

  it("degrades for a locale whose chunk fails even when English is fine", async () => {
    vi.doMock("@/locales/pl/messages.po", failsToLoad);
    const m = await freshI18n();
    for (const loc of ["pl"] as const) {
      await expect(m.activateLocaleOrFallback(loc), loc).resolves.toBe("en");
    }
    // An unaffected locale is untouched.
    await expect(m.activateLocaleOrFallback("de")).resolves.toBe("de");
  });
});
