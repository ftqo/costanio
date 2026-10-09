import { describe, it, expect } from "vitest";
import { langSearch, router } from "./router";

describe("?lang= survives search validation", () => {
  // A link's language hint must survive the router's search validation. It
  // is declared on the root route so every route keeps it.
  it("is validated on the root route, so every route keeps it", () => {
    const root = router.routeTree;
    expect(root.options.validateSearch).toBe(langSearch);
  });

  it("keeps a tag we ship", () => {
    expect(langSearch({ lang: "ja" })).toEqual({ lang: "ja" });
    expect(langSearch({ lang: "zh-Hans" })).toEqual({ lang: "zh-Hans" });
  });

  it("passes an unknown tag through rather than erroring", () => {
    // Only checks for a non-empty string. Whether the locale ships is
    // lib/i18n's question (it falls through the chain); an unknown language
    // must still open the page.
    expect(langSearch({ lang: "de" })).toEqual({ lang: "de" });
  });

  it("drops an absent or empty value", () => {
    expect(langSearch({})).toEqual({ lang: undefined });
    expect(langSearch({ lang: "" })).toEqual({ lang: undefined });
    expect(langSearch({ lang: 7 })).toEqual({ lang: undefined });
  });
});
