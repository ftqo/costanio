/**
 * Locale-aware formatting of things that are not sentences: numbers, dates and
 * lists.
 *
 * These take the app's locale explicitly. A bare `n.toLocaleString()` follows
 * the browser's locale, which differs when a player picks another language.
 *
 * Formatters are memoised per locale/options, since constructing an
 * `Intl.NumberFormat` is not cheap and these run inside render.
 */
import { currentLocale, type Locale } from "./i18n";

const numberCache = new Map<string, Intl.NumberFormat>();
const dateCache = new Map<string, Intl.DateTimeFormat>();
const listCache = new Map<string, Intl.ListFormat>();

function keyed<T>(cache: Map<string, T>, loc: string, opts: object | undefined, make: () => T): T {
  const key = `${loc}|${opts ? JSON.stringify(opts) : ""}`;
  let f = cache.get(key);
  if (!f) {
    f = make();
    cache.set(key, f);
  }
  return f;
}

/** "1,240" / "1 240" / "1,240" depending on the locale. */
export function formatNumber(
  n: number,
  opts?: Intl.NumberFormatOptions,
  locale: Locale = currentLocale(),
): string {
  return keyed(numberCache, locale, opts, () => new Intl.NumberFormat(locale, opts)).format(n);
}

/** A date, in the app's language. Accepts a Date, epoch ms, or an ISO string. */
export function formatDate(
  value: Date | number | string,
  opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
  locale: Locale = currentLocale(),
): string {
  const d = value instanceof Date ? value : new Date(value);
  return keyed(dateCache, locale, opts, () => new Intl.DateTimeFormat(locale, opts)).format(d);
}

/**
 * "Iris, Marco and Nils" in English, and the locale's own list grammar
 * elsewhere.
 *
 * `type: "conjunction"` is "and", `"disjunction"` is "or".
 */
export function formatList(
  parts: readonly string[],
  type: Intl.ListFormatType = "conjunction",
  locale: Locale = currentLocale(),
): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  const opts = { style: "long" as const, type };
  return keyed(listCache, locale, opts, () => new Intl.ListFormat(locale, opts)).format(parts);
}

/** Clear the memo tables. Only needed when tests switch locale mid-run. */
export function resetIntlCaches(): void {
  numberCache.clear();
  dateCache.clear();
  listCache.clear();
}
