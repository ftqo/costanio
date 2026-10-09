/**
 * Puts the resolved locale into React and keeps it there.
 *
 * Mounted above the router so the first paint is already in the right
 * language; a flash of English is worse than a slightly longer loading screen.
 *
 * The resolution chain is in lib/i18n.ts and is pure. This component feeds it
 * the ?lang= hint and the browser's languages, and holds the result.
 */
import * as React from "react";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import {
  activateLocaleOrFallback,
  currentLocale,
  navigatorLocales,
  resolveLocale,
  storeLocale,
  storedLocale,
  type Locale,
} from "./i18n";

interface LocaleCtx {
  locale: Locale;
  /**
   * Switch language. `persist` writes the choice to localStorage, the only
   * place a preference is kept (the server stores none). The settings control
   * persists; the ?lang= hint does not.
   */
  setLocale: (loc: Locale, opts?: { persist?: boolean }) => Promise<void>;
  /** Whether the player has ever made an explicit choice. */
  explicit: boolean;
}

const Ctx = React.createContext<LocaleCtx | null>(null);

/**
 * The ?lang= hint, read from `location.search` rather than the router.
 *
 * The router's validators declare `lang` on every externally linkable route
 * (see router.tsx), but this provider sits above the router and must resolve
 * before the first route renders. Both parse the same string.
 */
function queryLang(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("lang");
  } catch {
    return null;
  }
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(() =>
    resolveLocale({ query: queryLang(), navigator: navigatorLocales() }),
  );
  const [ready, setReady] = React.useState(false);
  const [explicit, setExplicit] = React.useState(() => storedLocale() !== null);

  // First activation: load the catalogue for the already-correct sync state.
  //
  // `ready` is set on both settlements because it gates everything below.
  // `activateLocaleOrFallback` resolves to whatever catalogue is live and does
  // not reject; the rejection handler is a backstop, since an error boundary
  // cannot catch a rejected promise in an effect (see lib/ErrorBoundary).
  React.useEffect(() => {
    void activateLocaleOrFallback(locale).then(
      (active) => {
        setLocaleState(active);
        setReady(true);
      },
      () => setReady(true),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, on mount
  }, []);

  const setLocale = React.useCallback(async (loc: Locale, opts?: { persist?: boolean }) => {
    // State changes only once the catalogue is live, so the picker never
    // names a language the UI is not in.
    const active = await activateLocaleOrFallback(loc);
    setLocaleState(active);
    // Only a locale that loaded is stored, so a failed load does not stick
    // and the next visit retries it.
    if (opts?.persist && active === loc) {
      // localStorage is the only persistence: per browser, the same for guests
      // and signed-in accounts.
      storeLocale(active);
      setExplicit(true);
    }
  }, []);

  const value = React.useMemo<LocaleCtx>(
    () => ({ locale, setLocale, explicit }),
    [locale, setLocale, explicit],
  );

  // Hold the first paint until the catalogue is in. This is a real chunk fetch
  // (~68 kB gzip); index.html preloads the resolved locale's catalogue in the
  // head so it overlaps the entry chunk. Holding beats a flash of English, and
  // the wait is bounded because `ready` is set on failure too.
  if (!ready) return null;

  return (
    <Ctx.Provider value={value}>
      <I18nProvider i18n={i18n}>{children}</I18nProvider>
    </Ctx.Provider>
  );
}

/**
 * The active locale and the way to change it.
 *
 * Falls back to reading the live i18n instance when no provider is mounted,
 * which is what unit tests that render a single component get. Changing the
 * locale without a provider is a no-op beyond activating the catalogue.
 */
export function useLocale(): LocaleCtx {
  const ctx = React.useContext(Ctx);
  if (ctx) return ctx;
  return {
    locale: currentLocale(),
    setLocale: async (loc: Locale) => {
      await activateLocaleOrFallback(loc);
    },
    explicit: false,
  };
}
