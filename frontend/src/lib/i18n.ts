/**
 * The app's language: which locales exist, how one is chosen, and how it is
 * loaded. Message lookup goes through Lingui's `t` / `Trans` macros; this module
 * picks the active catalogue and handles `<html lang>` and storage.
 *
 * Resolution, in order:
 *
 *   1. localStorage["costan.lang"]: the player's explicit choice.
 *   2. ?lang=<tag>: a hint for this navigation. It never writes storage, so a
 *      link cannot permanently switch someone's UI.
 *   3. navigator.languages, matched by lookup rather than equality, so zh-SG
 *      resolves to zh-Hans and ja-JP to ja.
 *   4. en.
 *
 * So ?lang= wins only for a visitor with no stored preference.
 *
 * Language is client-side only. The server stores none (no `lang` column or
 * field on /api/users/me), so a choice lives in this browser and does not
 * follow an account to another device.
 */
import { i18n } from "@lingui/core";

/** Locales with a catalogue in the bundle. `en` is the source locale. */
export const LOCALES = [
  "en",
  "zh-Hans",
  "ja",
  "de",
  "es",
  "fr",
  "pt-BR",
  "it",
  "nl",
  "tr",
  "uk",
  "ru",
  "pl",
  "hu",
  "cs",
  "sv",
  "hi",
  "vi",
] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * Locales offered to players: what the picker lists, and what browser-language
 * inference may land on.
 *
 * Every locale is released. That is safe because the catalogues are complete
 * and integrity-checked (plural categories, placeholders, no bare ids), and a
 * blank entry renders the English source (see `activateLocale`).
 *
 * Kept separate from `LOCALES` so a new language can be in the bundle,
 * reachable by ?lang= for translators, without being offered to anyone else.
 */
export const RELEASED_LOCALES: readonly Locale[] = LOCALES;

export function isReleased(loc: Locale): boolean {
  return RELEASED_LOCALES.includes(loc);
}

/**
 * The name of each language in that language, so a reader can find their own
 * without reading the current UI.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-Hans": "简体中文",
  ja: "日本語",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  "pt-BR": "Português (BR)",
  it: "Italiano",
  nl: "Nederlands",
  tr: "Türkçe",
  uk: "Українська",
  ru: "Русский",
  pl: "Polski",
  hu: "Magyar",
  cs: "Čeština",
  sv: "Svenska",
  hi: "हिन्दी",
  vi: "Tiếng Việt",
};

/**
 * Short forms for the picker's trigger below ~420px, where `Português (BR)` does
 * not fit beside the header's other controls.
 *
 * Still each language's own script (Cyrillic and CJK do not take a Latin `RU`).
 * Ukrainian is `УКР`, since Latin `UK` reads as a country or English. The
 * trigger always carries the full `LOCALE_LABELS` name for assistive tech (see
 * LanguagePicker).
 */
export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  en: "EN",
  "zh-Hans": "中文",
  ja: "日本語",
  de: "DE",
  es: "ES",
  fr: "FR",
  "pt-BR": "PT",
  it: "IT",
  nl: "NL",
  tr: "TR",
  uk: "УКР",
  ru: "РУС",
  pl: "PL",
  hu: "HU",
  cs: "CS",
  sv: "SV",
  hi: "हिं",
  vi: "VI",
};

/**
 * Scripts we set per-locale typography for. CJK needs a different font stack,
 * no uppercasing and different letter-spacing from Latin; see index.css.
 */
export const CJK_LOCALES: readonly Locale[] = ["zh-Hans", "ja"];

export const LANG_STORAGE_KEY = "costan.lang";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/**
 * Best shipped locale for one BCP-47 tag, by progressively dropping subtags.
 *
 * Exact match first, then the script-bearing prefix, then the bare language.
 * Chinese maps to Simplified unless the tag says Traditional; we do not ship
 * zh-Hant, and English beats the wrong Chinese.
 */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const norm = tag.trim();
  if (!norm) return null;
  const lower = norm.toLowerCase();

  for (const loc of LOCALES) {
    if (loc.toLowerCase() === lower) return loc;
  }

  const [lang, ...rest] = lower.split(/[-_]/);
  if (lang === "zh") {
    // zh-Hans, zh-CN, zh-SG, zh-Hans-CN, zh-Hans-HK -> Simplified.
    // zh-Hant, zh-TW, zh-HK, zh-MO -> Traditional, which we do not ship.
    // An explicit script subtag decides; the region is only a guess when no
    // script is given.
    const script = rest.includes("hans") ? "hans" : rest.includes("hant") ? "hant" : null;
    const hasHant = script ? script === "hant" : ["tw", "hk", "mo"].some((r) => rest.includes(r));
    return hasHant ? null : "zh-Hans";
  }
  for (const loc of LOCALES) {
    if (loc.toLowerCase().split("-")[0] === lang) return loc;
  }
  return null;
}

/** The player's stored choice, or null if they have never made one. */
export function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null; // private mode / storage disabled: fall through the chain
  }
}

export function storeLocale(loc: Locale): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, loc);
  } catch {
    /* best effort, exactly like the theme preference */
  }
}

/** Signals the chain resolves over. All optional; every one may be absent. */
export interface LocaleSignals {
  /** ?lang=, already read off the router's typed search params. */
  query?: string | null;
  /** navigator.languages, in the browser's own order of preference. */
  navigator?: readonly string[];
  /** The player's explicit choice. Defaults to reading localStorage. */
  stored?: Locale | null;
}

/** Run the chain. Pure, so the ordering is testable without a browser. */
export function resolveLocale(signals: LocaleSignals = {}): Locale {
  const stored = signals.stored !== undefined ? signals.stored : storedLocale();
  if (stored) return stored;

  const fromQuery = matchLocale(signals.query);
  if (fromQuery) return fromQuery;

  // Inference only lands on a released language. Every catalogue is released
  // today; the gate keeps an unfinished language added to LOCALES from being
  // served to strangers.
  for (const tag of signals.navigator ?? []) {
    const m = matchLocale(tag);
    if (m && isReleased(m)) return m;
  }
  return DEFAULT_LOCALE;
}

/** navigator.languages, defensively (jsdom and old Safari both disagree). */
export function navigatorLocales(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  const list = navigator.languages;
  // `navigator.languages` is genuinely absent or non-array in jsdom and old
  // Safari despite its type. `Array.isArray` narrows to `any[]`, which trips
  // no-unsafe-return on a value that is `readonly string[]` either way.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  if (Array.isArray(list) && list.length) return list;
  return navigator.language ? [navigator.language] : [];
}

/**
 * Tell the document which language it is in.
 *
 * `lang` drives the per-script CSS (`:lang(ja)` font stacks, uppercase
 * suppression), screen reader voice choice, and locale-correct
 * `text-transform`. No shipped locale is RTL and the board HUD assumes LTR, so
 * `dir` is always "ltr".
 */
export function applyDocumentLocale(loc: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = loc;
  document.documentElement.dir = "ltr";
}

/** Compiled catalogues, imported lazily so a locale is its own Vite chunk. */
const CATALOGS: Record<Locale, () => Promise<{ messages: Record<string, unknown> }>> = {
  en: () => import("@/locales/en/messages.po"),
  "zh-Hans": () => import("@/locales/zh-Hans/messages.po"),
  ja: () => import("@/locales/ja/messages.po"),
  de: () => import("@/locales/de/messages.po"),
  es: () => import("@/locales/es/messages.po"),
  fr: () => import("@/locales/fr/messages.po"),
  "pt-BR": () => import("@/locales/pt-BR/messages.po"),
  it: () => import("@/locales/it/messages.po"),
  nl: () => import("@/locales/nl/messages.po"),
  tr: () => import("@/locales/tr/messages.po"),
  uk: () => import("@/locales/uk/messages.po"),
  ru: () => import("@/locales/ru/messages.po"),
  pl: () => import("@/locales/pl/messages.po"),
  hu: () => import("@/locales/hu/messages.po"),
  cs: () => import("@/locales/cs/messages.po"),
  sv: () => import("@/locales/sv/messages.po"),
  hi: () => import("@/locales/hi/messages.po"),
  vi: () => import("@/locales/vi/messages.po"),
};

/**
 * One locale's compiled catalogue, as the bundle holds it.
 *
 * Keys are Lingui message ids, which for a message with no explicit id are a
 * hash of its source text and context. The `.po` shows the source text as
 * `msgid` (the hash is recomputed on parse), so a test asking what a locale
 * renders for an entry has to come through here.
 */
export async function loadCatalog(loc: Locale): Promise<Record<string, unknown>> {
  return (await CATALOGS[loc]()).messages;
}

/**
 * Catalogues already in memory, so switching back to a language skips the
 * module registry. A failed load is not recorded, so a retry really retries.
 */
const loaded = new Map<Locale, Record<string, unknown>>();

/**
 * The last catalogue that actually loaded, or null before the first one does.
 *
 * Not `i18n.locale`: anything can call `loadAndActivate` (the test setup, and
 * the last-resort branch below with no messages). This records that one of our
 * catalogues is on screen, which the fallback needs to know.
 */
let loadedLocale: Locale | null = null;

/**
 * Load a locale and make it current.
 *
 * Loads only the target catalogue. @lingui/vite-plugin resolves a blank
 * `msgstr` to the English source at compile time (`fallbackLocales` /
 * `sourceLocale`, see vite.config.ts), so every compiled catalogue already has
 * the full key set; merging `en` underneath would add nothing but a second
 * 68 kB download. `i18n.test.ts` asserts the key sets agree and no compiled
 * entry is blank.
 *
 * Rejects if the chunk never arrives. Anything holding UI behind this wants
 * `activateLocaleOrFallback` instead.
 */
export async function activateLocale(loc: Locale): Promise<void> {
  let messages = loaded.get(loc);
  if (!messages) {
    messages = (await CATALOGS[loc]()).messages;
    loaded.set(loc, messages);
  }
  i18n.loadAndActivate({ locale: loc, messages: messages as never });
  loadedLocale = loc;
  applyDocumentLocale(loc);
}

/**
 * Activate a locale, degrading rather than throwing when the chunk does not
 * arrive. Resolves to the locale actually live, which may not be the one asked
 * for.
 *
 * A dynamic import can fail for reasons unrelated to the catalogue (a tab open
 * across a deploy asking for a removed chunk, a dropped request). Without this,
 * LocaleProvider's `ready` never flips and the page stays blank.
 *
 * Fallback order: keep the catalogue already on screen, then English, then no
 * catalogue at all. Even the last is legible, since the macros keep the English
 * source at the call site.
 */
export async function activateLocaleOrFallback(loc: Locale): Promise<Locale> {
  try {
    await activateLocale(loc);
    return loc;
  } catch (err) {
    console.error(`[i18n] catalogue for ${loc} failed to load`, err);
  }

  // A failed switch keeps the language already on screen.
  if (loadedLocale) {
    applyDocumentLocale(loadedLocale);
    return loadedLocale;
  }

  if (loc !== DEFAULT_LOCALE) {
    try {
      await activateLocale(DEFAULT_LOCALE);
      return DEFAULT_LOCALE;
    } catch (err) {
      console.error("[i18n] English catalogue failed to load", err);
    }
  }

  // Untranslated, but rendering: source text, from the call sites.
  i18n.loadAndActivate({ locale: DEFAULT_LOCALE, messages: {} });
  applyDocumentLocale(DEFAULT_LOCALE);
  return DEFAULT_LOCALE;
}

/** The active locale, for Intl formatters and for `lang=` attributes. */
export function currentLocale(): Locale {
  return isLocale(i18n.locale) ? i18n.locale : DEFAULT_LOCALE;
}
