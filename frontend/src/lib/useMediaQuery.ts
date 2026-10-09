import * as React from "react";

// Subscribe to a CSS media query, re-rendering when it starts or stops matching.
// Where matchMedia is unavailable (SSR, bare jsdom) it reports false and never
// subscribes. For layout decisions CSS alone cannot express.
export function useMediaQuery(query: string): boolean {
  const read = React.useCallback(
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(query).matches
        : false,
    [query],
  );
  const [matches, setMatches] = React.useState(read);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // resync in case the query flipped between render and effect
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
