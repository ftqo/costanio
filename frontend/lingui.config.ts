import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";
import type { CatalogType } from "@lingui/conf";

/**
 * A tie-break for Lingui's ordering.
 *
 * `orderBy: "message"` compares source text then context, and leaves ties
 * (e.g. two ids both "You don't hold that card.") in worker-pool order, which
 * varies between runs. Adding the unique message id as the last key makes the
 * output byte-identical run to run.
 *
 * It wraps the formatter because `@lingui/conf`'s runtime validation rejects a
 * comparator for `orderBy`; the po writer emits entries in key order anyway.
 *
 * `en-US` is pinned, as Lingui does, so the sort ignores the machine's locale.
 */
const collator = new Intl.Collator("en-US");

const po = formatter({ origins: true, lineNumbers: true });

const stableOrder = (catalog: CatalogType): CatalogType =>
  Object.fromEntries(
    Object.entries(catalog).sort(
      ([aId, a], [bId, b]) =>
        collator.compare(a.message ?? "", b.message ?? "") ||
        collator.compare(a.context ?? "", b.context ?? "") ||
        collator.compare(aId, bId),
    ),
  );

/**
 * Message extraction for the SPA.
 *
 * Catalogues are gettext `.po` files under src/locales/<locale>/messages.po and
 * are imported directly by the app: @lingui/vite-plugin compiles them at build
 * time, so there is no `lingui compile` step.
 *
 * `en` is the source locale, generated from every `t` / `<Trans>` / `msg` call
 * by `npm run i18n:extract`. A message with no translation falls back to this
 * source text (see src/lib/i18n.ts).
 */
export default defineConfig({
  sourceLocale: "en",
  // Must equal LOCALES in src/lib/i18n.ts: for an unlisted locale the vite
  // plugin silently compiles an English catalogue under its name.
  // src/locales/catalog.test.ts asserts the two lists agree.
  locales: [
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
  ],
  // The stock po formatter with entries in a total order (see `collator`).
  // `formatOptions` is ignored for an object format, so the two defaults
  // (origins, line numbers) are passed explicitly to match `format: "po"`.
  format: {
    ...po,
    serialize: (catalog, ctx) => po.serialize(stableOrder(catalog), ctx),
  },
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["<rootDir>/src"],
      exclude: [
        "**/node_modules/**",
        "**/*.test.ts",
        "**/*.test.tsx",
        // Holds no messages of its own, and re-exports Lingui's own Trans, which
        // the extractor reads as a macro call with no id.
        "**/lib/linguiRuntime.tsx",
      ],
    },
  ],
  // The macros compile to our own thin runtime so a component with no
  // <I18nProvider> above it (as in component tests) falls back to the global
  // i18n instance instead of throwing. See src/lib/linguiRuntime.tsx.
  runtimeConfigModule: {
    Trans: ["@/lib/linguiRuntime", "Trans"],
    useLingui: ["@/lib/linguiRuntime", "useLingui"],
  },
});
